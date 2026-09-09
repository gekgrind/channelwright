import { describe, expect, it, vi } from "vitest";
import {
  channelVideoIntelligenceResultSchema,
  getWorkflowDefinition,
  videoIntelligenceInputSchema,
  WORKFLOW_FINALIZER_STEP,
  type ApprovedVideoPortfolioSet,
  type ClaimedWorkflowStep,
  type VideoIntelligenceContent,
  type VideoIntelligenceCritique,
} from "@/domain/production-workflows";
import { assertDistinctRoleProviders, ModelRoutingError, StaticRoleRouter } from "@/server/ai/role-router";
import type { StructuredModelProvider } from "@/server/ai/provider";
import type { ApprovedPortfolioResolver } from "./approved-portfolio-resolver";
import { deriveVideoIntelligenceConstraints } from "./video-intelligence-cycles";
import { channelVideoIntelligenceConfig, WORKFLOW_STEP_OUTPUT_CEILING_BYTES } from "./video-intelligence-config";
import { ChannelVideoIntelligenceExecutor, VideoIntelligenceExecutionError } from "./video-intelligence-executor";
import {
  buildApprovedPortfolioArtifact,
  buildApprovedPortfolioSet,
  buildDefaultPortfolioSet,
  buildIntelligenceContent,
  buildLearning,
  FIXTURE_HORIZON_LABEL,
} from "./video-intelligence-fixtures.test-helper";
import type { VideoIntelligenceModel } from "./video-intelligence-model";
import { deterministicVideoIntelligenceValidation, videoIntelligenceQA, videoIntelligenceQaStepEnvelopeBytes } from "./video-intelligence-validation";

const usage = { model: "test", inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const analyst = { provider: "openai" as const, model: "analyst", role: "GENERATOR" as const, operation: "video_intelligence_synthesis", invokedAt: "2026-09-18T10:01:00.000Z" };
const critic = { provider: "anthropic" as const, model: "critic", role: "CRITIC" as const, operation: "video_intelligence_critique", invokedAt: "2026-09-18T10:01:30.000Z" };

const SET = buildDefaultPortfolioSet();

function step(stepKey: string, priorOutputs: Record<string, unknown> = {}, set: ApprovedVideoPortfolioSet = SET): ClaimedWorkflowStep {
  return {
    id: "b8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a90", ownerId: set.artifacts[0].reference.approvedBy,
    workflowId: "b8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a91", runId: "b8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a92",
    workflowType: "CHANNEL_VIDEO_INTELLIGENCE", definitionVersion: 1, stepKey, capability: "test", attemptCount: 1, maxAttempts: 2,
    leaseToken: "b8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a93", leaseExpiresAt: "2026-09-18T11:00:00.000Z",
    input: {
      horizonLabel: FIXTURE_HORIZON_LABEL,
      portfolioSelections: set.artifacts.map((artifact) => ({ portfolioWorkflowId: artifact.reference.portfolioWorkflowId, portfolioRunId: artifact.reference.portfolioRunId })),
      approvedVideoPortfolioReferences: set.artifacts.map((artifact) => artifact.reference),
      // Stamped by start_workflow as lower(btrim(horizonLabel)) and returned verbatim by claim_workflow_step.
      intelligenceHorizonKey: FIXTURE_HORIZON_LABEL.trim().toLowerCase(),
    },
    priorOutputs,
  };
}

function dependencies(options: { safe?: boolean; resolveError?: Error; content?: VideoIntelligenceContent; critique?: VideoIntelligenceCritique; set?: ApprovedVideoPortfolioSet } = {}) {
  const set = options.set ?? SET;
  const calls: string[] = [];
  const resolver: ApprovedPortfolioResolver = {
    resolve: vi.fn(async () => {
      if (options.resolveError) throw options.resolveError;
      return set;
    }),
  };
  const model: VideoIntelligenceModel = {
    analyze: vi.fn(async () => { calls.push("ANALYST"); return { value: options.content ?? buildIntelligenceContent(set), usage, attribution: analyst }; }),
    critique: vi.fn(async () => { calls.push("CRITIC"); return { value: options.critique ?? { safeToFinalize: options.safe ?? true, summary: options.safe === false ? "A lesson rests on one cycle." : "No blocking issue.", findings: options.safe === false ? [{ code: "SINGLE_CYCLE_LESSON", severity: "error" as const, affectedField: "content.record.learnings", rationale: "Not channel-level.", evidenceRefs: [] }] : [] } satisfies VideoIntelligenceCritique, usage, attribution: critic }; }),
    routing: () => [{ role: "GENERATOR", provider: "openai", model: "analyst" }, { role: "CRITIC", provider: "anthropic", model: "critic" }],
  };
  return { resolver, model, calls, set };
}

async function executeThroughQa(options: Parameters<typeof dependencies>[0] = {}) {
  const deps = dependencies(options);
  const executor = new ChannelVideoIntelligenceExecutor(deps.resolver, deps.model, undefined, () => new Date("2026-09-18T10:02:00.000Z"));
  const validated = await executor.execute(step("validate-approved-portfolios", {}, deps.set));
  const derived = await executor.execute(step("derive-intelligence-constraints", { "validate-approved-portfolios": validated }, deps.set));
  const prior: Record<string, unknown> = { "validate-approved-portfolios": validated, "derive-intelligence-constraints": derived };
  const draft = await executor.execute(step("draft-video-intelligence", prior, deps.set));
  prior["draft-video-intelligence"] = draft;
  const critique = await executor.execute(step("critique-video-intelligence", prior, deps.set));
  prior["critique-video-intelligence"] = critique;
  const qa = await executor.execute(step("final-video-intelligence-qa", prior, deps.set));
  prior["final-video-intelligence-qa"] = qa;
  return { executor, deps, prior, validated, derived, draft, critique, qa };
}

describe("CHANNEL_VIDEO_INTELLIGENCE workflow registration", () => {
  it("registers the canonical seven-step graph with the human approval gate last", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_INTELLIGENCE", 1);
    expect(definition.steps.map((entry) => entry.key)).toEqual([
      "validate-approved-portfolios", "derive-intelligence-constraints", "draft-video-intelligence",
      "critique-video-intelligence", "final-video-intelligence-qa", "finalize-video-intelligence",
      "review-video-intelligence",
    ]);
    expect(definition.steps.at(-1)).toMatchObject({ kind: "APPROVAL", capability: "human" });
    expect(WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_INTELLIGENCE).toBe("finalize-video-intelligence");
  });

  it("makes no automated revision available: there is no revision step in the graph", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_INTELLIGENCE", 1);
    expect(definition.steps.some((entry) => /revision/i.test(entry.key))).toBe(false);
    expect(channelVideoIntelligenceConfig().maxAutomatedRevisions).toBe(0);
    expect(channelVideoIntelligenceConfig().maxAggregateRevisionCalls).toBe(0);
  });

  it("performs zero external retrieval", () => {
    const budget = channelVideoIntelligenceConfig();
    expect(budget.maxAggregateProviderRequests).toBe(0);
    expect(budget.maxAggregateSearches).toBe(0);
    expect(budget.maxAggregateProviderQuotaUnits).toBe(0);
  });
});

describe("CHANNEL_VIDEO_INTELLIGENCE executor", () => {
  it("resolves the approved portfolio set at the first step and never accepts one from the caller", async () => {
    const { deps, validated } = await executeThroughQa();
    expect(deps.resolver.resolve).toHaveBeenCalledOnce();
    expect(validated).toEqual(deps.set);
  });

  it("derives constraints server-side from the resolved cycles", async () => {
    const { derived } = await executeThroughQa();
    expect(derived).toEqual(deriveVideoIntelligenceConstraints(SET, FIXTURE_HORIZON_LABEL));
  });

  it("runs exactly one analyst and one distinct-provider critic", async () => {
    const { deps } = await executeThroughQa();
    expect(deps.calls).toEqual(["ANALYST", "CRITIC"]);
  });

  it("re-stamps every server-derived field rather than trusting the model copy", async () => {
    const constraints = deriveVideoIntelligenceConstraints(SET, FIXTURE_HORIZON_LABEL);
    const tampered = buildIntelligenceContent(SET, {
      record: { horizonLabel: "A different horizon", learningCount: 6, cyclesConsidered: 4, viewerValueTrend: "IMPROVING", requiresHumanJudgment: false },
      viewerValueSafeguards: { trend: "IMPROVING", cyclesWithCommittedAtRiskIds: [], escalationRequired: false },
      skipServerStamping: true,
    });
    const { draft } = await executeThroughQa({ content: tampered });
    const content = (draft as { content: VideoIntelligenceContent }).content;
    expect(content.record.horizonLabel).toBe(FIXTURE_HORIZON_LABEL);
    expect(content.record.learningCount).toBe(content.record.learnings.length);
    expect(content.record.cyclesConsidered).toBe(constraints.cycles.length);
    expect(content.record.viewerValueTrend).toBe(constraints.viewerValueTrend);
    expect(content.viewerValueSafeguards.trend).toBe(constraints.viewerValueTrend);
    expect(content.viewerValueSafeguards.escalationRequired).toBe(constraints.escalationRequired);
    expect(content.intelligenceReady).toBe(true);
  });

  it("stamps escalation from the server-derived trajectory, not from the model", async () => {
    const deteriorating = buildApprovedPortfolioSet([
      buildApprovedPortfolioArtifact(0, { allocatedAt: "2026-01-01T10:00:00.000Z", committedAtRiskCount: 0 }),
      buildApprovedPortfolioArtifact(1, { allocatedAt: "2026-06-01T10:00:00.000Z", committedAtRiskCount: 2, anyCandidateAtRisk: true }),
    ]);
    const content = buildIntelligenceContent(deteriorating, { record: { requiresHumanJudgment: false }, skipServerStamping: true });
    const { draft } = await executeThroughQa({ set: deteriorating, content });
    const stamped = (draft as { content: VideoIntelligenceContent }).content;
    expect(stamped.record.viewerValueTrend).toBe("DETERIORATING");
    expect(stamped.record.requiresHumanJudgment).toBe(true);
  });

  it("produces a final artifact that passes deterministic QA and carries both attributions", async () => {
    const { qa, prior } = await executeThroughQa();
    const envelope = qa as { qa: { passed: boolean; score: number }; result: unknown };
    expect(envelope.qa.passed).toBe(true);
    const result = channelVideoIntelligenceResultSchema.parse(envelope.result);
    expect(result.modelProvenance.map((entry) => entry.provider)).toEqual(["openai", "anthropic"]);
    expect(result.content.intelligenceReady).toBe(true);
    expect(result.source.anchoredStrategyRunId).toBe(SET.artifacts[0].reference.strategyAnchor.strategyRunId);
    expect(prior["final-video-intelligence-qa"]).toBe(qa);
  });

  it("finalizes only after QA passes, and the finalizer output is the durable artifact", async () => {
    const { executor, prior } = await executeThroughQa();
    const finalized = await executor.execute(step("finalize-video-intelligence", prior));
    expect(channelVideoIntelligenceResultSchema.safeParse(finalized).success).toBe(true);
  });

  it("fails terminally when the independent critic blocks, with no automated revision attempted", async () => {
    const { executor, prior, deps } = await executeThroughQa({ safe: false });
    const envelope = prior["final-video-intelligence-qa"] as { qa: { passed: boolean } };
    expect(envelope.qa.passed).toBe(false);
    await expect(executor.execute(step("finalize-video-intelligence", prior))).rejects.toMatchObject({
      code: "VIDEO_INTELLIGENCE_QA_REJECTED", retryable: false,
    });
    expect(deps.calls).toEqual(["ANALYST", "CRITIC"]);
  });

  it("fails terminally when a required prior output is missing", async () => {
    const executor = new ChannelVideoIntelligenceExecutor(dependencies().resolver, dependencies().model);
    await expect(executor.execute(step("derive-intelligence-constraints", {}))).rejects.toMatchObject({
      code: "WORKFLOW_CONTEXT_MISSING", retryable: false,
    });
  });

  it("refuses a step from another workflow type and an unknown step key", async () => {
    const executor = new ChannelVideoIntelligenceExecutor(dependencies().resolver, dependencies().model);
    const foreign = { ...step("validate-approved-portfolios"), workflowType: "CHANNEL_VIDEO_PORTFOLIO" as const };
    await expect(executor.execute(foreign)).rejects.toBeInstanceOf(VideoIntelligenceExecutionError);
    const { prior } = await executeThroughQa();
    await expect(executor.execute(step("invent-a-strategy", prior))).rejects.toMatchObject({ code: "WORKFLOW_STEP_NOT_SUPPORTED" });
  });

  it("propagates a non-retryable resolver integrity failure", async () => {
    const error = Object.assign(new Error("drifted"), { code: "UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH", retryable: false });
    const deps = dependencies({ resolveError: error });
    const executor = new ChannelVideoIntelligenceExecutor(deps.resolver, deps.model);
    await expect(executor.execute(step("validate-approved-portfolios"))).rejects.toMatchObject({ code: "UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH", retryable: false });
  });

  it("rejects a persisted input whose horizon key is not the server normalization", () => {
    const claimed = step("validate-approved-portfolios");
    const forged = { ...(claimed.input as Record<string, unknown>), intelligenceHorizonKey: "FORGED" };
    expect(videoIntelligenceInputSchema.safeParse(forged).success).toBe(false);
    expect(videoIntelligenceInputSchema.safeParse(claimed.input).success).toBe(true);
  });

  it("bounds the persisted final-QA step envelope, not merely the nested result", async () => {
    const { qa } = await executeThroughQa();
    const envelope = qa as { qa: unknown; crossModelReview: unknown; result: unknown };
    const bytes = videoIntelligenceQaStepEnvelopeBytes(envelope);
    expect(bytes).toBeLessThanOrEqual(WORKFLOW_STEP_OUTPUT_CEILING_BYTES);
    // The envelope is always strictly larger than `result` alone, which is why
    // maxResultPayloadBytes cannot be the only guard.
    expect(bytes).toBeGreaterThan(Buffer.byteLength(JSON.stringify(envelope.result), "utf8"));
  });

  it("agrees with the standalone deterministic validator on the same artifact", async () => {
    const { qa } = await executeThroughQa();
    const envelope = qa as { qa: { score: number }; result: unknown };
    const result = channelVideoIntelligenceResultSchema.parse(envelope.result);
    const recomputed = videoIntelligenceQA(deterministicVideoIntelligenceValidation(result, SET, deriveVideoIntelligenceConstraints(SET, FIXTURE_HORIZON_LABEL), channelVideoIntelligenceConfig().maxResultPayloadBytes));
    expect(recomputed.score).toBe(envelope.qa.score);
  });

  it("records a QA rejection rather than finalizing when the model leaks strategy authorship", async () => {
    const leaking = buildIntelligenceContent(SET, {
      learnings: [buildLearning(1, deriveVideoIntelligenceConstraints(SET, FIXTURE_HORIZON_LABEL).citableCycleIds, {
        statement: "Rewrite the channel strategy so the positioning matches what the cycles found.",
      })],
    });
    const { executor, prior } = await executeThroughQa({ content: leaking });
    const envelope = prior["final-video-intelligence-qa"] as { qa: { passed: boolean; findings: Array<{ code: string }> } };
    expect(envelope.qa.passed).toBe(false);
    expect(envelope.qa.findings.map((finding) => finding.code)).toContain("STRATEGY_AUTHORSHIP_LEAKED");
    await expect(executor.execute(step("finalize-video-intelligence", prior))).rejects.toMatchObject({ code: "VIDEO_INTELLIGENCE_QA_REJECTED" });
  });
});

describe("CHANNEL_VIDEO_INTELLIGENCE model routing", () => {
  const provider = (id: string) => ({ id, model: `${id}-model` } as unknown as StructuredModelProvider);

  it("requires the analyst and critic to come from distinct providers", () => {
    const distinct = new StaticRoleRouter({ GENERATOR: provider("openai"), CRITIC: provider("anthropic") });
    expect(() => assertDistinctRoleProviders(distinct, "GENERATOR", "CRITIC")).not.toThrow();
    const shared = provider("openai");
    const same = new StaticRoleRouter({ GENERATOR: shared, CRITIC: shared });
    expect(() => assertDistinctRoleProviders(same, "GENERATOR", "CRITIC")).toThrow(ModelRoutingError);
  });
});
