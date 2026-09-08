import { describe, expect, it, vi } from "vitest";
import {
  channelVideoPortfolioResultSchema,
  getWorkflowDefinition,
  videoPortfolioInputSchema,
  videoPortfolioRequestInputSchema,
  WORKFLOW_FINALIZER_STEP,
  type ApprovedVideoExperimentSet,
  type ClaimedWorkflowStep,
  type VideoPortfolioContent,
  type VideoPortfolioCritique,
} from "@/domain/production-workflows";
import { assertDistinctRoleProviders, ModelRoutingError, StaticRoleRouter } from "@/server/ai/role-router";
import type { StructuredModelProvider } from "@/server/ai/provider";
import type { ApprovedExperimentResolver } from "./approved-experiment-resolver";
import { deriveVideoPortfolioConstraints } from "./video-portfolio-candidates";
import { channelVideoPortfolioConfig, WORKFLOW_STEP_OUTPUT_CEILING_BYTES } from "./video-portfolio-config";
import { ChannelVideoPortfolioExecutor, VideoPortfolioExecutionError } from "./video-portfolio-executor";
import {
  buildApprovedExperimentSet,
  buildPortfolioContent,
  buildPortfolioResult,
  FIXTURE_CYCLE_LABEL,
} from "./video-portfolio-fixtures.test-helper";
import type { VideoPortfolioModel } from "./video-portfolio-model";
import { deterministicVideoPortfolioValidation, videoPortfolioQA, videoPortfolioQaStepEnvelopeBytes } from "./video-portfolio-validation";

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
      // Stamped by start_workflow as lower(btrim(cycleLabel)) and returned verbatim by claim_workflow_step.
      portfolioCycleKey: FIXTURE_CYCLE_LABEL.trim().toLowerCase(),
    },
    priorOutputs,
  };
}

function dependencies(options: { safe?: boolean; resolveError?: Error; content?: VideoPortfolioContent; critique?: VideoPortfolioCritique; set?: ApprovedVideoExperimentSet; slots?: number } = {}) {
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
    critique: vi.fn(async () => { calls.push("CRITIC"); return { value: options.critique ?? { safeToFinalize: options.safe ?? true, summary: options.safe === false ? "Two committed runs share a surface." : "No blocking issue.", findings: options.safe === false ? [{ code: "CONFOUNDED_SLATE", severity: "error" as const, affectedField: "content.allocation", rationale: "Committed runs collide.", evidenceRefs: [] }] : [] } satisfies VideoPortfolioCritique, usage, attribution: critic }; }),
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
  const beforeQa = { "validate-approved-experiments": validated, "derive-portfolio-constraints": derived, "draft-video-portfolio": draft, "critique-video-portfolio": reviewed };
  const qa = await executor.execute(at("final-video-portfolio-qa", beforeQa));
  const prior = { ...beforeQa, "final-video-portfolio-qa": qa };
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

/**
 * F1 repair: the persisted `input_payload` that `start_workflow` writes carries
 * `portfolioCycleKey` (and `approvedVideoExperimentReferences`) on top of the
 * caller request, and `claim_workflow_step` hands that exact object to the
 * executor, which parses it with the STRICT `videoPortfolioInputSchema`. Before
 * the repair that parse rejected `portfolioCycleKey` and every real run died at
 * its first executor step.
 */
describe("CHANNEL_VIDEO_PORTFOLIO persisted-input <-> executor contract (F1)", () => {
  /** The object shape produced by `start_workflow`: `p_input || {approvedVideoExperimentReferences, portfolioCycleKey: lower(btrim(cycleLabel))}`. */
  function persistedInput(set: ApprovedVideoExperimentSet, cycleLabel = FIXTURE_CYCLE_LABEL, slots = 1, extra: Record<string, unknown> = {}) {
    return {
      cycleLabel,
      concurrentExperimentSlots: slots,
      experimentSelections: set.artifacts.map((artifact) => ({ experimentWorkflowId: artifact.reference.experimentWorkflowId, experimentRunId: artifact.reference.experimentRunId })),
      approvedVideoExperimentReferences: set.artifacts.map((artifact) => artifact.reference),
      portfolioCycleKey: cycleLabel.trim().toLowerCase(),
      ...extra,
    };
  }

  it("accepts the exact input_payload shape start_workflow persists, including the server-added portfolioCycleKey", () => {
    const parsed = videoPortfolioInputSchema.parse(persistedInput(SET, "2026 Autumn Learning Cycle"));
    expect(parsed.portfolioCycleKey).toBe("2026 autumn learning cycle");
    expect(parsed.approvedVideoExperimentReferences).toHaveLength(2);
  });

  it("accepts the revision-path shape that also carries humanRevisionNote", () => {
    expect(() => videoPortfolioInputSchema.parse(persistedInput(SET, FIXTURE_CYCLE_LABEL, 1, { humanRevisionNote: "Reconsider whether slot two should defer instead." }))).not.toThrow();
  });

  it("keeps portfolioCycleKey server-authoritative: the public request schema rejects it and the other server-owned field", () => {
    const base = { cycleLabel: FIXTURE_CYCLE_LABEL, concurrentExperimentSlots: 1, experimentSelections: SET.artifacts.map((artifact) => ({ experimentWorkflowId: artifact.reference.experimentWorkflowId, experimentRunId: artifact.reference.experimentRunId })) };
    expect(videoPortfolioRequestInputSchema.safeParse(base).success).toBe(true);
    expect(videoPortfolioRequestInputSchema.safeParse({ ...base, portfolioCycleKey: "attacker supplied" }).success).toBe(false);
    expect(videoPortfolioRequestInputSchema.safeParse({ ...base, approvedVideoExperimentReferences: [{ forged: true }] }).success).toBe(false);
  });

  it("fails closed when the persisted cycle key is not lower(btrim(cycleLabel)) -- the SQL <-> TypeScript drift guard", () => {
    const mismatched = videoPortfolioInputSchema.safeParse(persistedInput(SET, "2026 Autumn", 1, { portfolioCycleKey: "some-other-key" }));
    expect(mismatched.success).toBe(false);
    if (!mismatched.success) expect(mismatched.error.issues.some((issue) => issue.path.join(".") === "portfolioCycleKey")).toBe(true);
    // A key that merely skipped the lower() step is still rejected.
    expect(videoPortfolioInputSchema.safeParse(persistedInput(SET, "2026 Autumn", 1, { portfolioCycleKey: "2026 Autumn" })).success).toBe(false);
  });

  it("drives the executor's first step on the real persisted shape without a schema rejection", async () => {
    const deps = dependencies();
    const executor = new ChannelVideoPortfolioExecutor(deps.resolver, deps.model);
    const claimed: ClaimedWorkflowStep = { ...step("validate-approved-experiments"), input: persistedInput(deps.set) };
    await expect(executor.execute(claimed)).resolves.toBeDefined();
  });
});

/**
 * F2 repair: the `final-video-portfolio-qa` step persists
 * `{ qa, crossModelReview, result }`. `result` already contains
 * `crossModelReview`, so the persisted envelope is strictly larger than
 * `result` and a schema-valid `result` inside `maxResultPayloadBytes` (60 KiB)
 * can still push the envelope past `complete_workflow_step`'s 65_536-byte limit.
 * The executor now measures the real envelope and fails with a deterministic
 * typed error before the persistence attempt.
 */
describe("CHANNEL_VIDEO_PORTFOLIO final-QA step envelope ceiling (F2)", () => {
  const sixCandidates = () => buildApprovedExperimentSet(Array.from({ length: 6 }, (_, index) => ({ topicId: `topic:video-${index}` })));

  function legalReviewFindings(count: number): NonNullable<VideoPortfolioCritique["findings"]> {
    return Array.from({ length: count }, (_, index) => ({
      code: `REVIEW_NOTE_${String(index).padStart(3, "0")}`,
      severity: "warning" as const,
      affectedField: "content.allocation.items",
      rationale: `Non-blocking reviewer note ${index}: the committed slate stays interpretable and inside declared capacity. `.padEnd(900, "x").slice(0, 900),
      evidenceRefs: [] as string[],
    }));
  }
  const legalCritique = (count: number): VideoPortfolioCritique => ({ safeToFinalize: true, summary: "s".repeat(2_500), findings: legalReviewFindings(count) });

  it("keeps the normal-path persisted envelope inside the database step-output ceiling", async () => {
    const run = await executeThroughQa();
    const bytes = videoPortfolioQaStepEnvelopeBytes(run.qa as Parameters<typeof videoPortfolioQaStepEnvelopeBytes>[0]);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(WORKFLOW_STEP_OUTPUT_CEILING_BYTES);
  });

  it("accepts a large legal allocation whose full envelope stays within the ceiling but exceeds the result-only budget", async () => {
    const cfg = channelVideoPortfolioConfig();
    const run = await executeThroughQa({ set: sixCandidates(), slots: 1, critique: legalCritique(9) });
    const stepOutput = run.qa as { qa: { passed: boolean }; result: unknown };
    expect(stepOutput.qa.passed).toBe(true);
    const resultBytes = Buffer.byteLength(JSON.stringify(stepOutput.result), "utf8");
    const envelopeBytes = videoPortfolioQaStepEnvelopeBytes(run.qa as Parameters<typeof videoPortfolioQaStepEnvelopeBytes>[0]);
    expect(resultBytes).toBeLessThanOrEqual(cfg.maxResultPayloadBytes);
    // Genuinely exercises the margin: the envelope is past the result-only budget yet under the DB ceiling.
    expect(envelopeBytes).toBeGreaterThan(cfg.maxResultPayloadBytes);
    expect(envelopeBytes).toBeLessThanOrEqual(WORKFLOW_STEP_OUTPUT_CEILING_BYTES);
  });

  it("rejects a schema-valid allocation whose full envelope exceeds the ceiling, with a deterministic typed error and no persistence attempt", async () => {
    await expect(executeThroughQa({ set: sixCandidates(), slots: 1, critique: legalCritique(13) }))
      .rejects.toMatchObject({ code: "VIDEO_PORTFOLIO_STEP_OUTPUT_TOO_LARGE", retryable: false });
  });

  it("the rejected combination is one the result-level validator would otherwise accept", () => {
    const cfg = channelVideoPortfolioConfig();
    const set = sixCandidates();
    const base = buildPortfolioResult(set, 1);
    const oversized = channelVideoPortfolioResultSchema.parse({
      ...base,
      crossModelReview: { ...base.crossModelReview, outcome: "CRITIC_RAISED_ISSUE" as const, findings: legalReviewFindings(13), summary: "s".repeat(2_500) },
    });
    const constraints = deriveVideoPortfolioConstraints(set, FIXTURE_CYCLE_LABEL, 1);
    const errors = deterministicVideoPortfolioValidation(oversized, set, constraints, cfg.maxResultPayloadBytes).filter((finding) => finding.severity === "error");
    expect(errors).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(oversized), "utf8")).toBeLessThanOrEqual(cfg.maxResultPayloadBytes);
    const envelopeBytes = videoPortfolioQaStepEnvelopeBytes({ qa: videoPortfolioQA([]), crossModelReview: oversized.crossModelReview, result: oversized });
    expect(envelopeBytes).toBeGreaterThan(WORKFLOW_STEP_OUTPUT_CEILING_BYTES);
  });

  it("measures the envelope in UTF-8 bytes, not character count", () => {
    const multibyte = "€".repeat(5_000); // 5,000 chars / 15,000 UTF-8 bytes
    const bytes = videoPortfolioQaStepEnvelopeBytes({ qa: {}, crossModelReview: {}, result: { note: multibyte } });
    expect(bytes).toBeGreaterThanOrEqual(15_000);
    expect(bytes).toBeGreaterThan(multibyte.length);
  });
});
