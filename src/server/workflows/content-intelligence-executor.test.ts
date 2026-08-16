import { describe, expect, it, vi } from "vitest";
import type { ClaimedWorkflowStep, ModelAttribution } from "@/domain/production-workflows";
import { ChannelContentIntelligenceExecutor } from "./content-intelligence-executor";
import { approvedStrategyArtifactFixture, approvedStrategyReferenceFixture, contentResultFixture, discoveryBundleFixture, viewerValueFixture } from "./content-fixtures.test-helper";
import type { ContentCritique } from "./content-model";
import type { ResearchUsageMeter } from "./research-usage";

const STEPS = [
  "validate-approved-strategy", "expand-content-pillars", "discover-youtube-topics", "assess-topic-opportunities",
  "synthesize-backlog", "initial-content-qa", "bounded-content-revision", "final-content-qa", "finalize-content-intelligence",
] as const;

const base: ClaimedWorkflowStep = {
  id: crypto.randomUUID(), ownerId: approvedStrategyReferenceFixture.approvedBy, workflowId: crypto.randomUUID(), runId: crypto.randomUUID(),
  workflowType: "CHANNEL_CONTENT_INTELLIGENCE", definitionVersion: 1, stepKey: "validate-approved-strategy", capability: "approved-strategy-validation",
  attemptCount: 1, maxAttempts: 2, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  input: { strategyWorkflowId: approvedStrategyReferenceFixture.strategyWorkflowId, strategyRunId: approvedStrategyReferenceFixture.strategyRunId, approvedStrategyReference: approvedStrategyReferenceFixture },
  priorOutputs: {},
};

const usage = { model: "generator-model", inputTokens: 100, outputTokens: 50, totalTokens: 150 };
const criticUsage = { model: "critic-model", inputTokens: 80, outputTokens: 40, totalTokens: 120 };

const attribution = (provider: "openai" | "anthropic", model: string, role: ModelAttribution["role"], operation: string): ModelAttribution =>
  ({ provider, model, role, operation, invokedAt: "2026-08-15T12:33:00.000Z" });

const plan = { expansions: contentResultFixture.pillarExpansions };
const assessment = { topics: contentResultFixture.topics };
const synthesis = {
  scores: contentResultFixture.scores,
  backlog: contentResultFixture.backlog,
  nextVideoRecommendation: contentResultFixture.nextVideoRecommendation,
  risks: contentResultFixture.risks,
  assumptions: contentResultFixture.assumptions,
  openQuestions: contentResultFixture.openQuestions,
  recommendedNextAction: contentResultFixture.recommendedNextAction,
};

type QaValue = { score: number; findings: Array<{ severity: "error" | "warning" | "info"; code: string; message: string; evidenceIds: string[] }>; recommendation: "accept" | "revise" | "human_review_required" };
const cleanQa: QaValue = { score: 92, findings: [], recommendation: "accept" };
const reviseQa: QaValue = { score: 60, findings: [{ severity: "error", code: "REVISE_THIS", message: "Sharpen it.", evidenceIds: [] }], recommendation: "revise" };

const quietCritic: ContentCritique = { overallAssessment: "No material concern found.", findings: [], strongestConcern: null, recommendationChallenged: false };
const loudCritic: ContentCritique = {
  overallAssessment: "Differentiation on the second topic is asserted rather than demonstrated.",
  findings: [{
    code: "DIFFERENTIATION_ASSERTED_NOT_SHOWN", severity: "warning", affectedField: "topics[1].differentiatedContribution",
    rationale: "The cited sample shows one adjacent channel, which does not support the confident wording.",
    evidenceIds: ["yt:video:contentvid002"],
  }],
  strongestConcern: "Differentiation rests on a thinner sample than the wording implies.",
  recommendationChallenged: false,
};

function dependencies(options: { qa?: QaValue[]; critic?: ContentCritique } = {}) {
  const qaSequence = options.qa ?? [cleanQa, cleanQa];
  const resolver = { resolve: vi.fn().mockResolvedValue(approvedStrategyArtifactFixture) };
  const provider = { discover: vi.fn().mockResolvedValue(discoveryBundleFixture) };
  const qa = vi.fn();
  for (const value of qaSequence) qa.mockResolvedValueOnce({ value, usage: criticUsage, attribution: attribution("anthropic", "qa-model", "QA", "content_semantic_qa") });
  qa.mockResolvedValue({ value: qaSequence[qaSequence.length - 1], usage: criticUsage, attribution: attribution("anthropic", "qa-model", "QA", "content_semantic_qa") });
  const content = (() => {
    const copy: Record<string, unknown> = { ...contentResultFixture };
    delete copy.upstreamStrategy; delete copy.crossModelReview; delete copy.modelProvenance;
    return copy;
  })();
  const model = {
    expandPillars: vi.fn().mockResolvedValue({ value: plan, usage, attribution: attribution("openai", "generator-model", "GENERATOR", "content_pillar_expansion") }),
    assessTopics: vi.fn().mockResolvedValue({ value: assessment, usage, attribution: attribution("openai", "generator-model", "GENERATOR", "content_topic_assessment") }),
    synthesizeBacklog: vi.fn().mockResolvedValue({ value: synthesis, usage, attribution: attribution("openai", "generator-model", "GENERATOR", "content_backlog_synthesis") }),
    critique: vi.fn().mockResolvedValue({ value: options.critic ?? quietCritic, usage: criticUsage, attribution: attribution("anthropic", "critic-model", "CRITIC", "content_cross_model_critique") }),
    reviseBacklog: vi.fn().mockResolvedValue({ value: content, usage, attribution: attribution("openai", "generator-model", "REVISION", "content_backlog_revision") }),
    qa,
    routing: vi.fn().mockReturnValue([{ role: "GENERATOR", provider: "openai", model: "generator-model" }, { role: "CRITIC", provider: "anthropic", model: "critic-model" }]),
  };
  const reservation = { operationId: crypto.randomUUID(), status: "RESERVED" as const, idempotentReplay: false };
  const meter: ResearchUsageMeter = { ensure: vi.fn(), reserve: vi.fn().mockResolvedValue(reservation), finalize: vi.fn(), record: vi.fn() };
  return { resolver, provider, model, meter, reservation };
}

async function runThrough(executor: ChannelContentIntelligenceExecutor, steps: readonly string[] = STEPS) {
  const outputs: Record<string, unknown> = {};
  for (const stepKey of steps) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
  return outputs;
}

describe("multi-model CHANNEL_CONTENT_INTELLIGENCE executor", () => {
  it("routes generation and independent critique to different providers across the full graph", async () => {
    const { resolver, provider, model, meter } = dependencies();
    const outputs = await runThrough(new ChannelContentIntelligenceExecutor(resolver, provider, model, meter));
    const result = outputs["finalize-content-intelligence"] as typeof contentResultFixture;
    expect(model.critique).toHaveBeenCalledTimes(1);
    expect(model.qa).toHaveBeenCalledTimes(2);
    expect(result.modelProvenance.map((item) => `${item.provider}:${item.role}`)).toEqual([
      "openai:GENERATOR", "openai:GENERATOR", "openai:GENERATOR",
    ]);
    expect(result.crossModelReview?.generator.provider).toBe("openai");
    expect(result.crossModelReview?.critic.provider).toBe("anthropic");
    expect(result.crossModelReview?.outcome).toBe("AGREED");
  });

  it("records a critic finding as CRITIC_RAISED_ISSUE when nothing needs revision", async () => {
    const { resolver, provider, model, meter } = dependencies({ critic: loudCritic });
    const outputs = await runThrough(new ChannelContentIntelligenceExecutor(resolver, provider, model, meter));
    const result = outputs["finalize-content-intelligence"] as typeof contentResultFixture;
    expect(result.crossModelReview?.outcome).toBe("CRITIC_RAISED_ISSUE");
    expect(result.crossModelReview?.findings[0].code).toBe("DIFFERENTIATION_ASSERTED_NOT_SHOWN");
    expect(result.crossModelReview?.summary).toContain("asserted rather than demonstrated");
  });

  it("marks the review REVISED and adds the reviser to provenance when a revision is accepted", async () => {
    const { resolver, provider, model, meter } = dependencies({ qa: [reviseQa, cleanQa], critic: loudCritic });
    const outputs = await runThrough(new ChannelContentIntelligenceExecutor(resolver, provider, model, meter));
    const result = outputs["finalize-content-intelligence"] as typeof contentResultFixture;
    expect(result.crossModelReview?.outcome).toBe("REVISED");
    expect(result.crossModelReview?.findings.every((finding) => finding.disposition === "REVISED")).toBe(true);
    expect(result.modelProvenance.at(-1)).toMatchObject({ role: "REVISION", provider: "openai" });
    expect(model.reviseBacklog).toHaveBeenCalledTimes(1);
  });

  it("keeps deterministic rules authoritative when a revision degrades the artifact", async () => {
    const { resolver, provider, model, meter } = dependencies({ qa: [reviseQa, cleanQa], critic: loudCritic });
    const degraded = (() => {
      const copy: Record<string, unknown> = { ...contentResultFixture };
      delete copy.upstreamStrategy; delete copy.crossModelReview; delete copy.modelProvenance;
      copy.scores = contentResultFixture.scores.map((score, index) => index === 0 ? { ...score, weightedTotal: 9.9 } : score);
      return copy;
    })();
    model.reviseBacklog = vi.fn().mockResolvedValue({ value: degraded, usage, attribution: attribution("openai", "generator-model", "REVISION", "content_backlog_revision") });
    const outputs = await runThrough(new ChannelContentIntelligenceExecutor(resolver, provider, model, meter));
    const revision = outputs["bounded-content-revision"] as { attempted: boolean; reason: string; result: { crossModelReview?: { outcome: string } } };
    expect(revision.reason).toContain("SCORING_ARITHMETIC_INVALID");
    expect(revision.result.crossModelReview?.outcome).toBe("OVERRIDDEN_BY_DETERMINISTIC_RULE");
  });

  it("a critic cannot rescue a premise the deterministic viewer-value gate rejects", async () => {
    const { resolver, provider, model, meter } = dependencies({ critic: quietCritic });
    const deceptive = contentResultFixture.topics.map((topic, index) => index === 0 ? {
      ...topic,
      viewerValue: viewerValueFixture({
        integrityFindings: [{ risk: "UNSUPPORTED_INCOME_CLAIM", label: null, severity: "blocking", explanation: "Promises an income figure with no basis.", evidenceIds: [] }],
        gate: "REJECT",
      }),
    } : topic);
    model.assessTopics = vi.fn().mockResolvedValue({ value: { topics: deceptive }, usage, attribution: attribution("openai", "generator-model", "GENERATOR", "content_topic_assessment") });
    const executor = new ChannelContentIntelligenceExecutor(resolver, provider, model, meter);
    const outputs = await runThrough(executor, STEPS.slice(0, 6));
    // The critic reported nothing, yet the run still fails closed.
    expect(model.critique).toHaveBeenCalledTimes(1);
    await expect(executor.execute({ ...base, stepKey: "bounded-content-revision", priorOutputs: outputs }))
      .rejects.toMatchObject({ code: "CONTENT_INTEGRITY_UNREVISABLE", retryable: false });
    expect(model.reviseBacklog).not.toHaveBeenCalled();
  });

  it("records OVERRIDDEN_BY_DETERMINISTIC_RULE when the critic is silent but deterministic rules fail", async () => {
    const { resolver, provider, model, meter } = dependencies({ critic: quietCritic });
    const unscored = { ...synthesis, scores: [contentResultFixture.scores[0]] };
    model.synthesizeBacklog = vi.fn().mockResolvedValue({ value: unscored, usage, attribution: attribution("openai", "generator-model", "GENERATOR", "content_backlog_synthesis") });
    const outputs = await runThrough(new ChannelContentIntelligenceExecutor(resolver, provider, model, meter), STEPS.slice(0, 6));
    const initial = outputs["initial-content-qa"] as { qa: { passed: boolean }; crossModelReview: { outcome: string } };
    expect(initial.qa.passed).toBe(false);
    expect(initial.crossModelReview.outcome).toBe("OVERRIDDEN_BY_DETERMINISTIC_RULE");
  });

  it("filters critic evidence citations to the discovery bundle", async () => {
    const inventing: ContentCritique = {
      ...loudCritic,
      findings: [{ ...loudCritic.findings[0], evidenceIds: ["yt:video:ghost", "yt:video:contentvid002"] }],
    };
    const { resolver, provider, model, meter } = dependencies({ critic: inventing });
    const outputs = await runThrough(new ChannelContentIntelligenceExecutor(resolver, provider, model, meter), STEPS.slice(0, 6));
    const initial = outputs["initial-content-qa"] as { crossModelReview: { findings: Array<{ evidenceIds: string[] }> } };
    expect(initial.crossModelReview.findings[0].evidenceIds).toEqual(["yt:video:contentvid002"]);
  });

  it("promotes a warning-only final QA to human review and records it on the review", async () => {
    const warningQa: QaValue = { score: 88, findings: [], recommendation: "revise" };
    const { resolver, provider, model, meter } = dependencies({ qa: [cleanQa, warningQa] });
    const outputs = await runThrough(new ChannelContentIntelligenceExecutor(resolver, provider, model, meter), STEPS.slice(0, 8));
    const final = outputs["final-content-qa"] as { qa: { recommendation: string }; crossModelReview: { outcome: string } };
    expect(final.qa.recommendation).toBe("human_review_required");
    expect(final.crossModelReview.outcome).toBe("HUMAN_REVIEW_REQUIRED");
  });

  it("charges the critic and QA calls to the same run budget under their own provider identities", async () => {
    const { resolver, provider, model, meter } = dependencies({ critic: loudCritic });
    await runThrough(new ChannelContentIntelligenceExecutor(resolver, provider, model, meter), STEPS.slice(0, 6));
    // The executor delegates model accounting to RoutedContentModel, so with an
    // injected model only the workflow-level reservations appear here.
    expect(meter.ensure).toHaveBeenCalled();
    expect(model.critique).toHaveBeenCalledTimes(1);
  });

  it("fails closed when final QA still holds a material error", async () => {
    const { resolver, provider, model, meter } = dependencies({ qa: [reviseQa, reviseQa] });
    const executor = new ChannelContentIntelligenceExecutor(resolver, provider, model, meter);
    const outputs = await runThrough(executor, STEPS.slice(0, 8));
    await expect(executor.execute({ ...base, stepKey: "finalize-content-intelligence", priorOutputs: outputs }))
      .rejects.toMatchObject({ code: "CONTENT_QA_REJECTED", retryable: false });
  });

  it("charges a failed revision conservatively and rethrows without advancing", async () => {
    const { resolver, provider, model, meter, reservation } = dependencies({ qa: [reviseQa, cleanQa] });
    model.reviseBacklog = vi.fn().mockRejectedValue(new Error("provider exploded"));
    const executor = new ChannelContentIntelligenceExecutor(resolver, provider, model, meter);
    const outputs = await runThrough(executor, STEPS.slice(0, 6));
    await expect(executor.execute({ ...base, stepKey: "bounded-content-revision", priorOutputs: outputs })).rejects.toThrow("provider exploded");
    expect(meter.finalize).toHaveBeenCalledWith(reservation, "FAILED", { automatedRevisions: 1, failedOperations: 1 });
  });

  it("refuses a step from a different workflow type and a missing prior output", async () => {
    const { resolver, provider, model, meter } = dependencies();
    const executor = new ChannelContentIntelligenceExecutor(resolver, provider, model, meter);
    await expect(executor.execute({ ...base, workflowType: "CHANNEL_STRATEGY" })).rejects.toMatchObject({ code: "WORKFLOW_STEP_NOT_SUPPORTED", retryable: false });
    await expect(executor.execute({ ...base, stepKey: "expand-content-pillars", priorOutputs: {} })).rejects.toMatchObject({ code: "WORKFLOW_CONTEXT_MISSING", retryable: false });
  });
});
