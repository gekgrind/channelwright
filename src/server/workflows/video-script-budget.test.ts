import { describe, expect, it } from "vitest";
import type { ModelRole, ModelInvocationContext, ModelInvocationResult, StructuredModelProvider } from "@/server/ai/provider";
import { StaticRoleRouter } from "@/server/ai/role-router";
import { channelVideoScriptConfig } from "./video-script-config";
import { RoutedVideoScriptModel } from "./video-script-model";
import type { ResearchUsageCounters, ResearchUsageMeter, ResearchUsageReservation } from "./research-usage";
import { approvedVideoBriefArtifactFixture, videoScriptResultFixture } from "./video-script-fixtures.test-helper";

/**
 * Proves the documented full retry graph (4 script-output + 8 review-output
 * calls) completes under reserve-before-call accounting with conservative
 * failed-call charging, without exceeding the aggregate output budget or the
 * 100,000 database ceiling. This is the accounting proof the previous
 * call-count-only config test could not give (Codex P1).
 */

const DB_OUTPUT_CEILING = 100_000; // migration 202608160001: outputTokens <= 100000

/** Mirrors the database reserve/finalize arithmetic exactly. */
class FakeBudgetMeter implements ResearchUsageMeter {
  readonly used: Record<string, number> = {};
  private readonly reserved: Record<string, number> = {};
  private readonly ops = new Map<string, ResearchUsageCounters>();
  private seq = 0;
  constructor(private readonly limits: Record<string, number>) {}
  async ensure() {}
  async reserve(input: { reservation?: ResearchUsageCounters }): Promise<ResearchUsageReservation> {
    const reservation = input.reservation ?? {};
    for (const [key, value] of Object.entries(reservation)) {
      const limit = this.limits[key];
      if (limit !== undefined && (this.used[key] ?? 0) + (this.reserved[key] ?? 0) + (value ?? 0) > limit) {
        throw new Error(`RESEARCH_RESOURCE_BUDGET_EXHAUSTED:${key}`);
      }
    }
    const operationId = `op-${this.seq++}`;
    for (const [key, value] of Object.entries(reservation)) this.reserved[key] = (this.reserved[key] ?? 0) + (value ?? 0);
    this.ops.set(operationId, reservation);
    return { operationId, status: "RESERVED", idempotentReplay: false };
  }
  async finalize(reservation: ResearchUsageReservation, _status: "SUCCEEDED" | "FAILED", actual: ResearchUsageCounters) {
    const held = this.ops.get(reservation.operationId) ?? {};
    for (const [key, value] of Object.entries(held)) this.reserved[key] = (this.reserved[key] ?? 0) - (value ?? 0);
    // finalize enforces actual <= reservation per key; a FAILED call is charged
    // its full reservation (conservative), a SUCCEEDED call its actual output.
    for (const [key, value] of Object.entries(actual)) this.used[key] = (this.used[key] ?? 0) + (value ?? 0);
  }
  async record() {}
}

/** Returns full-ceiling output on success (worst case); `fail` throws before output. */
function provider(id: "openai" | "anthropic", role: string, outcomes: Array<"ok" | "fail">): StructuredModelProvider {
  let index = 0;
  return {
    id, model: `${id}-${role.toLowerCase()}`,
    async invoke<T>(_schema: unknown, context: ModelInvocationContext): Promise<ModelInvocationResult<T>> {
      const outcome = outcomes[index++] ?? "ok";
      if (outcome === "fail") throw Object.assign(new Error("provider transient failure"), { code: "TIMEOUT" });
      return {
        value: {} as T,
        usage: { model: context.role, inputTokens: 0, outputTokens: context.maxOutputTokens, totalTokens: context.maxOutputTokens },
        provider: id, model: `${id}-${role.toLowerCase()}`, rawUsage: {},
      };
    },
  };
}

describe("VIDEO_SCRIPT output-token budget survives the full retry graph (P1)", () => {
  it("the production retry sequence fits the budget under conservative charging", async () => {
    const budget = channelVideoScriptConfig();
    const meter = new FakeBudgetMeter({
      synthesisCalls: budget.maxAggregateSynthesisCalls,
      qaCalls: budget.maxAggregateQaCalls,
      revisionCalls: budget.maxAggregateRevisionCalls,
      inputTokens: budget.maxAggregateInputTokens,
      outputTokens: budget.maxAggregateOutputTokens,
      totalTokens: budget.maxAggregateTotalTokens,
    });
    // Production semantics rerun the WHOLE step on failure. Each QA step runs
    // critique first (success) then the semantic QA (which fails), so the retry
    // reruns critique (success) + QA (success). The critic therefore succeeds on
    // every call while the QA call fails once per QA step; the draft and revision
    // steps each fail once then succeed.
    const router = new StaticRoleRouter({
      GENERATOR: provider("openai", "GENERATOR", ["fail", "ok"]),
      REVISION: provider("openai", "REVISION", ["fail", "ok"]),
      CRITIC: provider("anthropic", "CRITIC", ["ok", "ok", "ok", "ok"]),
      QA: provider("anthropic", "QA", ["fail", "ok", "fail", "ok"]),
    } as Partial<Record<ModelRole, StructuredModelProvider>>);
    const model = new RoutedVideoScriptModel(router, budget, meter);

    const input = {
      videoBriefWorkflowId: approvedVideoBriefArtifactFixture.reference.briefWorkflowId,
      videoBriefRunId: approvedVideoBriefArtifactFixture.reference.briefRunId,
      approvedVideoBriefReference: approvedVideoBriefArtifactFixture.reference,
    } as never;
    const upstream = approvedVideoBriefArtifactFixture;
    const script = videoScriptResultFixture();
    const qaResult = { findings: [] } as never;

    // Only the intended transient provider failures may throw. A budget rejection
    // is thrown from reserve() before the provider call with a different message,
    // so it fails these assertions immediately instead of being swallowed.
    const TRANSIENT = /provider transient failure/;
    const ok = (fn: () => Promise<unknown>) => fn();
    const fails = (fn: () => Promise<unknown>) => expect(fn()).rejects.toThrow(TRANSIENT);

    // Draft step: attempt 1 fails, attempt 2 succeeds.
    await fails(() => model.draftScript(input, upstream));
    await ok(() => model.draftScript(input, upstream));
    // Initial QA step: critic ok + QA fail (attempt 1), then critic ok + QA ok (attempt 2).
    await ok(() => model.critique(input, upstream, script));
    await fails(() => model.qa(input, upstream, script, []));
    await ok(() => model.critique(input, upstream, script));
    await ok(() => model.qa(input, upstream, script, []));
    // Revision step: attempt 1 fails, attempt 2 succeeds.
    await fails(() => model.reviseScript(input, upstream, script, qaResult));
    await ok(() => model.reviseScript(input, upstream, script, qaResult));
    // Final QA step: critic ok + QA fail (attempt 1), then critic ok + QA ok (attempt 2).
    await ok(() => model.critique(input, upstream, script));
    await fails(() => model.qa(input, upstream, script, []));
    await ok(() => model.critique(input, upstream, script));
    await ok(() => model.qa(input, upstream, script, []));

    // No reservation was rejected, and the summed conservative output — every call
    // charged its full role ceiling, failed or not — stays inside both ceilings.
    const worstCaseOutput = 4 * budget.modelScriptOutputTokens + 8 * budget.modelReviewOutputTokens;
    expect(meter.used.outputTokens).toBe(worstCaseOutput);
    expect(meter.used.outputTokens).toBeLessThanOrEqual(budget.maxAggregateOutputTokens);
    expect(meter.used.outputTokens).toBeLessThanOrEqual(DB_OUTPUT_CEILING);
    expect(budget.maxAggregateOutputTokens).toBeLessThanOrEqual(DB_OUTPUT_CEILING);
    // Call counts: 2 GENERATOR synthesis, 2 REVISION, 8 QA-kind (4 critic + 4 qa).
    expect(meter.used.synthesisCalls).toBe(2);
    expect(meter.used.qaCalls).toBe(8);
    expect(meter.used.revisionCalls).toBe(2);
  });

  it("a single flat 18,000 output ceiling could NOT prove the path (documents why the fix was needed)", () => {
    // 12 calls x 18,000 = 216,000, over twice the 100,000 database ceiling.
    expect(12 * 18_000).toBeGreaterThan(DB_OUTPUT_CEILING);
    // The role-split defaults, by contrast, fit.
    const budget = channelVideoScriptConfig();
    expect(4 * budget.modelScriptOutputTokens + 8 * budget.modelReviewOutputTokens).toBeLessThanOrEqual(budget.maxAggregateOutputTokens);
  });
});
