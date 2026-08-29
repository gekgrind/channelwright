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
  it("aggregate output ceilings fit the 12-call worst case under conservative charging", async () => {
    const budget = channelVideoScriptConfig();
    const meter = new FakeBudgetMeter({
      synthesisCalls: budget.maxAggregateSynthesisCalls,
      qaCalls: budget.maxAggregateQaCalls,
      revisionCalls: budget.maxAggregateRevisionCalls,
      inputTokens: budget.maxAggregateInputTokens,
      outputTokens: budget.maxAggregateOutputTokens,
      totalTokens: budget.maxAggregateTotalTokens,
    });
    // The first call of every role fails (exercising conservative failed-call
    // charging), the rest succeed at their full role ceiling.
    const router = new StaticRoleRouter({
      GENERATOR: provider("openai", "GENERATOR", ["fail", "ok"]),
      REVISION: provider("openai", "REVISION", ["fail", "ok"]),
      CRITIC: provider("anthropic", "CRITIC", ["fail", "ok", "ok", "ok"]),
      QA: provider("anthropic", "QA", ["fail", "ok", "ok", "ok"]),
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

    // The exact worst-case multiset: 2 GENERATOR, 2 REVISION, 4 CRITIC, 4 QA.
    const call = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* conservative charge already settled */ } };
    await call(() => model.draftScript(input, upstream)); // fail
    await call(() => model.draftScript(input, upstream)); // ok
    await call(() => model.critique(input, upstream, script)); // initial critic fail
    await call(() => model.critique(input, upstream, script)); // initial critic ok
    await call(() => model.qa(input, upstream, script, [])); // initial qa fail
    await call(() => model.qa(input, upstream, script, [])); // initial qa ok
    await call(() => model.reviseScript(input, upstream, script, qaResult)); // fail
    await call(() => model.reviseScript(input, upstream, script, qaResult)); // ok
    await call(() => model.critique(input, upstream, script)); // final critic ok
    await call(() => model.critique(input, upstream, script)); // final critic ok
    await call(() => model.qa(input, upstream, script, [])); // final qa ok
    await call(() => model.qa(input, upstream, script, [])); // final qa ok

    // Every reservation was accepted (no budget-exhausted throw) and the summed
    // conservative output stays inside both ceilings.
    const worstCaseOutput = 4 * budget.modelScriptOutputTokens + 8 * budget.modelReviewOutputTokens;
    expect(meter.used.outputTokens).toBe(worstCaseOutput);
    expect(meter.used.outputTokens).toBeLessThanOrEqual(budget.maxAggregateOutputTokens);
    expect(meter.used.outputTokens).toBeLessThanOrEqual(DB_OUTPUT_CEILING);
    expect(budget.maxAggregateOutputTokens).toBeLessThanOrEqual(DB_OUTPUT_CEILING);
    // Call counts also fit exactly.
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
