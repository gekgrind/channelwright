import { describe, expect, it, vi } from "vitest";
import {
  getWorkflowDefinition,
  WORKFLOW_FINALIZER_STEP,
  type ApprovedVideoExperimentSet,
  type ClaimedWorkflowStep,
  type VideoPortfolioContent,
  type VideoPortfolioCritique,
} from "@/domain/production-workflows";
import { assertDistinctRoleProviders, ModelRoutingError, StaticRoleRouter } from "@/server/ai/role-router";
import type { StructuredModelProvider } from "@/server/ai/provider";
import type { ApprovedExperimentResolver } from "./approved-experiment-resolver";
import { channelVideoPortfolioConfig } from "./video-portfolio-config";
import { ChannelVideoPortfolioExecutor, VideoPortfolioExecutionError } from "./video-portfolio-executor";
import {
  buildApprovedExperimentSet,
  buildPortfolioContent,
  FIXTURE_CYCLE_LABEL,
} from "./video-portfolio-fixtures.test-helper";
import type { VideoPortfolioModel } from "./video-portfolio-model";

const usage = { model: "test", inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const analyst = { provider: "openai" as const, model: "allocator", role: "GENERATOR" as const, operation: "video_portfolio_allocation", invokedAt: "2026-09-18T10:01:00.000Z" };
const critic = { provider: "anthropic" as const, model: "critic", role: "CRITIC" as const, operation: "video_portfolio_critique", invokedAt: "2026-09-18T10:01:30.000Z" };

const SET = buildApprovedExperimentSet([{}, {}]);

function step(stepKey: string, priorOutputs: Record<string, unknown> = {}, set: ApprovedVideoExperimentSet = SET, slots = 1): ClaimedWorkflowStep {
  return {
    id: "b8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a80", ownerId: set.artifacts[0].reference.approvedBy,
    workflowId: "b8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a81", runId: "b8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a82",
    workflowType: "CHANNEL_VIDEO_PORTFOLIO", definitionVersion: 1, stepKey, capability: "test", attemptCount: 1, maxAttempts: 2,
    leaseToken: "b8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a83", leaseExpiresAt: "2026-09-18T11:00:00.000Z",
    input: {
      cycleLabel: FIXTURE_CYCLE_LABEL,
      concurrentExperimentSlots: slots,
      experimentSelections: set.artifacts.map((artifact) => ({ experimentWorkflowId: artifact.reference.experimentWorkflowId, experimentRunId: artifact.reference.experimentRunId })),
      approvedVideoExperimentReferences: set.artifacts.map((artifact) => artifact.reference),
    },
    priorOutputs,
  };
}

function dependencies(options: { safe?: boolean; resolveError?: Error; content?: VideoPortfolioContent; set?: ApprovedVideoExperimentSet; slots?: number } = {}) {
  const set = options.set ?? SET;
  const calls: string[] = [];
  const resolver: ApprovedExperimentResolver = {
    resolve: vi.fn(async () => {
      if (options.resolveError) throw options.resolveError;
      return set;
    }),
  };
  const model: VideoPortfolioModel = {
    analyze: vi.fn(async () => { calls.push("ALLOCATOR"); return { value: options.content ?? buildPortfolioContent(set, options.slots ?? 1), usage, attribution: analyst }; }),
    critique: vi.fn(async () => { calls.push("CRITIC"); return { value: { safeToFinalize: options.safe ?? true, summary: options.safe === false ? "Two committed runs share a surface." : "No blocking issue.", findings: options.safe === false ? [{ code: "CONFOUNDED_SLATE", severity: "error" as const, affectedField: "content.allocation", rationale: "Committed runs collide.", evidenceRefs: [] }] : [] } satisfies VideoPortfolioCritique, usage, attribution: critic }; }),
    routing: () => [{ role: "GENERATOR", provider: "openai", model: "allocator" }, { role: "CRITIC", provider: "anthropic", model: "critic" }],
  };
  return { resolver, model, calls, set };
}

async function executeThroughQa(options: Parameters<typeof dependencies>[0] = {}) {
  const deps = dependencies(options);
  const slots = options.slots ?? 1;
  const executor = new ChannelVideoPortfolioExecutor(deps.resolver, deps.model, undefined, () => new Date("2026-09-18T10:02:00.000Z"));
  const at = (key: string, prior: Record<string, unknown>) => step(key, prior, deps.set, slots);
  const validated = await executor.execute(at("validate-approved-experiments", {}));
  const derived = await executor.execute(at("derive-portfolio-constraints", { "validate-approved-experiments": validated }));
  const draft = await executor.execute(at("draft-video-portfolio", { "validate-approved-experiments": validated, "derive-portfolio-constraints": derived }));
  const reviewed = await executor.execute(at("critique-video-portfolio", { "validate-approved-experiments": validated, "derive-portfolio-constraints": derived, "draft-video-portfolio": draft }));
  const qa = await executor.execute(at("final-video-portfolio-qa", { "validate-approved-experiments": validated, "derive-portfolio-constraints": derived, "draft-video-portfolio": draft, "critique-video-portfolio": reviewed }));
  const prior = { "validate-approved-experiments": validated, "derive-portfolio-constraints": derived, "draft-video-portfolio": draft, "critique-video-portfolio": reviewed, "final-video-portfolio-qa": qa };
  return { deps, executor, prior, qa, at };
}

describe("CHANNEL_VIDEO_PORTFOLIO executor", () => {
  it("registers the approved seven-stage no-revision graph", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_PORTFOLIO", 1);
    expect(definition.steps.map((item) => item.key)).toEqual([
      "validate-approved-experiments", "derive-portfolio-constraints", "draft-video-portfolio",
      "critique-video-portfolio", "final-video-portfolio-qa", "finalize-video-portfolio", "review-video-portfolio",
    ]);
    expect(definition.steps.filter((item) => item.maxAttempts === 2).map((item) => item.key)).toEqual(["draft-video-portfolio", "critique-video-portfolio"]);
    expect(WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_PORTFOLIO).toBe("finalize-video-portfolio");
    expect(definition.steps.some((item) => item.key.includes("revision"))).toBe(false);
    expect(definition.steps.at(-1)).toMatchObject({ kind: "APPROVAL", capability: "human" });
  });

  it("executes exactly one ALLOCATOR and one independent CRITIC on the normal path", async () => {
    const run = await executeThroughQa();
    expect(run.deps.calls).toEqual(["ALLOCATOR", "CRITIC"]);
    const output = await run.executor.execute(run.at("finalize-video-portfolio", run.prior));
    expect((output as { workflowType: string }).workflowType).toBe("CHANNEL_VIDEO_PORTFOLIO");
    expect((run.qa as { qa: { passed: boolean } }).qa.passed).toBe(true);
  });

  it("produces a finalizer output the workflow definition's own output schema accepts", async () => {
    const run = await executeThroughQa();
    const output = await run.executor.execute(run.at("finalize-video-portfolio", run.prior));
    expect(() => getWorkflowDefinition("CHANNEL_VIDEO_PORTFOLIO", 1).outputSchema.parse(output)).not.toThrow();
  });

  it("re-stamps the disposition counts, capacity utilisation and readiness the model claimed", async () => {
    const set = SET;
    const tampered = buildPortfolioContent(set, 1);
    tampered.allocation.committedCount = 6;
    tampered.allocation.deferredCount = 0;
    tampered.allocation.capacityUtilization = "UNDER_CAPACITY";
    tampered.portfolioReady = false;
    const run = await executeThroughQa({ content: tampered });
    const draft = run.prior["draft-video-portfolio"] as { content: VideoPortfolioContent };
    expect(draft.content.allocation.committedCount).toBe(1);
    expect(draft.content.allocation.deferredCount).toBe(1);
    expect(draft.content.allocation.capacityUtilization).toBe("AT_CAPACITY");
    expect(draft.content.portfolioReady).toBe(true);
  });

  it("forcibly escalates a slate that commits an at-risk candidate, whatever the model claimed", async () => {
    const set = buildApprovedExperimentSet([{ viewerValueState: "AT_RISK", escalationRequired: true }, {}]);
    const content = buildPortfolioContent(set, 1);
    content.allocation.items[0].viewerValueDisposition = "ESCALATED_FOR_HUMAN_JUDGMENT";
    content.allocation.requiresHumanJudgment = false;
    content.viewerValueSafeguards.anyCandidateAtRisk = false;
    content.viewerValueSafeguards.escalationRequired = false;
    content.viewerValueSafeguards.committedAtRiskCandidateIds = [];
    const run = await executeThroughQa({ set, content });
    const draft = run.prior["draft-video-portfolio"] as { content: VideoPortfolioContent };
    expect(draft.content.allocation.requiresHumanJudgment).toBe(true);
    expect(draft.content.viewerValueSafeguards.anyCandidateAtRisk).toBe(true);
    expect(draft.content.viewerValueSafeguards.escalationRequired).toBe(true);
    expect(draft.content.viewerValueSafeguards.committedAtRiskCandidateIds).toHaveLength(1);
    expect((run.qa as { qa: { passed: boolean } }).qa.passed).toBe(true);
  });

  it("re-stamps the cycle label so an allocation can never rename the operator's cycle", async () => {
    const content = buildPortfolioContent(SET, 1);
    content.allocation.cycleLabel = "some other cycle";
    const run = await executeThroughQa({ content });
    const draft = run.prior["draft-video-portfolio"] as { content: VideoPortfolioContent };
    expect(draft.content.allocation.cycleLabel).toBe(FIXTURE_CYCLE_LABEL);
  });

  it("derives constraints from the resolved candidate set, not from the model", async () => {
    const set = buildApprovedExperimentSet([{ topicId: "topic:shared" }, { topicId: "topic:shared" }]);
    const run = await executeThroughQa({ set, slots: 2 });
    const derived = run.prior["derive-portfolio-constraints"] as { confoundCollisionGroups: unknown[]; concurrentExperimentSlots: number };
    expect(derived.confoundCollisionGroups).toHaveLength(1);
    expect(derived.concurrentExperimentSlots).toBe(2);
  });

  it("refuses to finalize when deterministic QA rejected the allocation", async () => {
    const set = buildApprovedExperimentSet([{ topicId: "topic:shared" }, { topicId: "topic:shared" }]);
    const run = await executeThroughQa({ set, slots: 2 });
    expect((run.qa as { qa: { passed: boolean } }).qa.passed).toBe(false);
    await expect(run.executor.execute(run.at("finalize-video-portfolio", run.prior))).rejects.toMatchObject({ code: "VIDEO_PORTFOLIO_QA_REJECTED", retryable: false });
  });

  it("refuses to finalize over a blocking critic finding, with no automated revision", async () => {
    const run = await executeThroughQa({ safe: false });
    expect((run.qa as { qa: { passed: boolean } }).qa.passed).toBe(false);
    await expect(run.executor.execute(run.at("finalize-video-portfolio", run.prior))).rejects.toMatchObject({ code: "VIDEO_PORTFOLIO_QA_REJECTED" });
    expect(run.deps.calls).toEqual(["ALLOCATOR", "CRITIC"]);
  });

  it("rejects a step whose required prior output is missing", async () => {
    const deps = dependencies();
    const executor = new ChannelVideoPortfolioExecutor(deps.resolver, deps.model);
    await expect(executor.execute(step("derive-portfolio-constraints"))).rejects.toMatchObject({ code: "WORKFLOW_CONTEXT_MISSING", retryable: false });
  });

  it("rejects a step of another workflow type and an unknown step key", async () => {
    const deps = dependencies();
    const executor = new ChannelVideoPortfolioExecutor(deps.resolver, deps.model);
    const foreign = { ...step("validate-approved-experiments"), workflowType: "CHANNEL_VIDEO_EXPERIMENT" as const };
    await expect(executor.execute(foreign)).rejects.toBeInstanceOf(VideoPortfolioExecutionError);
    // An unknown key with no prior outputs fails the prior-output guard first;
    // supplying the priors drives it to the graph's own fall-through.
    const run = await executeThroughQa();
    await expect(run.executor.execute(run.at("invent-an-allocation", run.prior))).rejects.toMatchObject({ code: "WORKFLOW_STEP_NOT_SUPPORTED" });
    await expect(executor.execute(step("invent-an-allocation"))).rejects.toMatchObject({ code: "WORKFLOW_CONTEXT_MISSING" });
  });

  it("propagates an upstream resolution failure as a terminal error before any model spend", async () => {
    const deps = dependencies({ resolveError: Object.assign(new Error("nope"), { code: "APPROVED_EXPERIMENT_INVALID", retryable: false }) });
    const executor = new ChannelVideoPortfolioExecutor(deps.resolver, deps.model);
    await expect(executor.execute(step("validate-approved-experiments"))).rejects.toMatchObject({ code: "APPROVED_EXPERIMENT_INVALID" });
    expect(deps.calls).toEqual([]);
  });

  it("budgets zero retrieval, two synthesis, two QA and no automated revision", () => {
    const budget = channelVideoPortfolioConfig();
    expect(budget.maxAggregateProviderRequests).toBe(0);
    expect(budget.maxAggregateSearches).toBe(0);
    expect(budget.maxAggregateSynthesisCalls).toBe(2);
    expect(budget.maxAggregateQaCalls).toBe(2);
    expect(budget.maxAggregateRevisionCalls).toBe(0);
    expect(budget.maxAutomatedRevisions).toBe(0);
    expect(2 * budget.modelAnalysisOutputTokens + 2 * budget.modelReviewOutputTokens).toBeLessThanOrEqual(budget.maxAggregateOutputTokens);
  });

  it("fails closed when the allocator and critic would resolve to the same provider", () => {
    const provider = { id: "openai", model: "shared" } as unknown as StructuredModelProvider;
    const router = new StaticRoleRouter({ GENERATOR: provider, CRITIC: provider });
    expect(() => assertDistinctRoleProviders(router, "GENERATOR", "CRITIC")).toThrow(ModelRoutingError);
  });
});
