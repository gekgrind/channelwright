import { describe, expect, it, vi } from "vitest";
import { getWorkflowDefinition, WORKFLOW_FINALIZER_STEP, decisionTypeSchema, type ClaimedWorkflowStep, type VideoDecisionContent, type VideoDecisionCritique } from "@/domain/production-workflows";
import type { ModelInvocationContext, StructuredModelProvider } from "@/server/ai/provider";
import { assertDistinctRoleProviders, ModelRoutingError, StaticRoleRouter } from "@/server/ai/role-router";
import type { ApprovedDiagnosisResolver } from "./approved-diagnosis-resolver";
import type { ResearchUsageMeter } from "./research-usage";
import { channelVideoDecisionConfig } from "./video-decision-config";
import { DECISION_TYPE_EXPERIMENT_ELIGIBLE, deriveVideoDecisionEvidence, permittedDecisionTypesFor } from "./video-decision-evidence";
import { ChannelVideoDecisionExecutor } from "./video-decision-executor";
import { approvedVideoDiagnosisArtifactFixture, videoDecisionContentFixture } from "./video-decision-fixtures.test-helper";
import { RoutedVideoDecisionModel, type VideoDecisionModel } from "./video-decision-model";
import { videoDecisionQA } from "./video-decision-validation";

const usage = { model: "test", inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const analyst = { provider: "openai" as const, model: "analyst", role: "GENERATOR" as const, operation: "video_decision_analysis", invokedAt: "2026-09-17T10:01:00.000Z" };
const critic = { provider: "anthropic" as const, model: "critic", role: "CRITIC" as const, operation: "video_decision_critique", invokedAt: "2026-09-17T10:01:30.000Z" };

function step(stepKey: string, priorOutputs: Record<string, unknown> = {}): ClaimedWorkflowStep {
  return {
    id: "f7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a70", ownerId: approvedVideoDiagnosisArtifactFixture.reference.approvedBy,
    workflowId: "f7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a71", runId: "f7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a72",
    workflowType: "CHANNEL_VIDEO_DECISION", definitionVersion: 1, stepKey, capability: "test", attemptCount: 1, maxAttempts: 2,
    leaseToken: "f7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a73", leaseExpiresAt: "2026-09-17T11:00:00.000Z",
    input: { videoDiagnosisWorkflowId: approvedVideoDiagnosisArtifactFixture.reference.diagnosisWorkflowId, videoDiagnosisRunId: approvedVideoDiagnosisArtifactFixture.reference.diagnosisRunId, approvedVideoDiagnosisReference: approvedVideoDiagnosisArtifactFixture.reference },
    priorOutputs,
  };
}

function dependencies(options: { safe?: boolean; resolveError?: Error; content?: VideoDecisionContent } = {}) {
  const calls: string[] = [];
  const resolver: ApprovedDiagnosisResolver = {
    resolve: vi.fn(async () => {
      if (options.resolveError) throw options.resolveError;
      return approvedVideoDiagnosisArtifactFixture;
    }),
  };
  const model: VideoDecisionModel = {
    analyze: vi.fn(async () => { calls.push("ANALYST"); return { value: options.content ?? videoDecisionContentFixture(), usage, attribution: analyst }; }),
    critique: vi.fn(async () => { calls.push("CRITIC"); return { value: { safeToFinalize: options.safe ?? true, summary: options.safe === false ? "Blocking overstatement." : "No blocking issue.", findings: options.safe === false ? [{ code: "CAUSAL_OVERSTATEMENT", severity: "error" as const, affectedField: "content.decision", rationale: "The claim exceeds the evidence.", evidenceRefs: [] }] : [] } satisfies VideoDecisionCritique, usage, attribution: critic }; }),
    routing: () => [{ role: "GENERATOR", provider: "openai", model: "analyst" }, { role: "CRITIC", provider: "anthropic", model: "critic" }],
  };
  return { resolver, model, calls };
}

async function executeThroughQa(options: { safe?: boolean; content?: VideoDecisionContent } = {}) {
  const deps = dependencies(options);
  const executor = new ChannelVideoDecisionExecutor(deps.resolver, deps.model, undefined, () => new Date("2026-09-17T10:02:00.000Z"));
  const validated = await executor.execute(step("validate-approved-diagnosis"));
  const derived = await executor.execute(step("derive-decision-evidence", { "validate-approved-diagnosis": validated }));
  const draft = await executor.execute(step("draft-video-decision", { "validate-approved-diagnosis": validated, "derive-decision-evidence": derived }));
  const reviewed = await executor.execute(step("critique-video-decision", { "validate-approved-diagnosis": validated, "derive-decision-evidence": derived, "draft-video-decision": draft }));
  const qa = await executor.execute(step("final-video-decision-qa", { "validate-approved-diagnosis": validated, "derive-decision-evidence": derived, "draft-video-decision": draft, "critique-video-decision": reviewed }));
  return { deps, executor, validated, derived, draft, reviewed, qa };
}

describe("CHANNEL_VIDEO_DECISION executor", () => {
  it("registers the approved seven-stage no-revision graph", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_DECISION", 1);
    expect(definition.steps.map((item) => item.key)).toEqual(["validate-approved-diagnosis", "derive-decision-evidence", "draft-video-decision", "critique-video-decision", "final-video-decision-qa", "finalize-video-decision", "review-video-decision"]);
    expect(definition.steps.filter((item) => item.maxAttempts === 2).map((item) => item.key)).toEqual(["draft-video-decision", "critique-video-decision"]);
    expect(WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_DECISION).toBe("finalize-video-decision");
    expect(definition.steps.some((item) => item.key.includes("revision"))).toBe(false);
  });

  it("executes exactly one ANALYST and one independent CRITIC on the normal path", async () => {
    const run = await executeThroughQa();
    expect(run.deps.calls).toEqual(["ANALYST", "CRITIC"]);
    const output = await run.executor.execute(step("finalize-video-decision", { "validate-approved-diagnosis": run.validated, "derive-decision-evidence": run.derived, "draft-video-decision": run.draft, "critique-video-decision": run.reviewed, "final-video-decision-qa": run.qa }));
    expect((output as { workflowType: string }).workflowType).toBe("CHANNEL_VIDEO_DECISION");
  });

  it("fits exactly two normal calls and four structural retry calls with no revision step", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_DECISION", 1);
    const structuralMax = definition.steps.filter((item) => item.kind === "WORKER").reduce((sum, item) => sum + item.maxAttempts, 0);
    // 1 (validate) + 1 (derive) + 2 (draft) + 2 (critique) + 1 (final-qa) + 1 (finalize) = 8 worker-attempt slots,
    // of which exactly 4 belong to the two model-calling steps (draft + critique at maxAttempts 2 each).
    expect(structuralMax).toBe(8);
    expect(definition.steps.filter((item) => item.maxAttempts === 2).reduce((sum, item) => sum + item.maxAttempts, 0)).toBe(4);
  });

  it("performs zero model calls when immutable Diagnosis resolution fails", async () => {
    const deps = dependencies({ resolveError: Object.assign(new Error("bad provenance"), { retryable: false }) });
    const executor = new ChannelVideoDecisionExecutor(deps.resolver, deps.model);
    await expect(executor.execute(step("validate-approved-diagnosis"))).rejects.toThrow("bad provenance");
    expect(deps.calls).toEqual([]);
  });

  it("performs zero model calls while only deriving decision evidence", async () => {
    const deps = dependencies();
    const executor = new ChannelVideoDecisionExecutor(deps.resolver, deps.model);
    const validated = await executor.execute(step("validate-approved-diagnosis"));
    await executor.execute(step("derive-decision-evidence", { "validate-approved-diagnosis": validated }));
    expect(deps.calls).toEqual([]);
  });

  it("fails closed after critic disagreement and never invokes revision", async () => {
    const run = await executeThroughQa({ safe: false });
    expect((run.qa as { qa: { passed: boolean } }).qa.passed).toBe(false);
    await expect(run.executor.execute(step("finalize-video-decision", { "validate-approved-diagnosis": run.validated, "derive-decision-evidence": run.derived, "draft-video-decision": run.draft, "critique-video-decision": run.reviewed, "final-video-decision-qa": run.qa }))).rejects.toMatchObject({ code: "VIDEO_DECISION_QA_REJECTED", retryable: false });
    expect(run.deps.calls).toEqual(["ANALYST", "CRITIC"]);
  });

  it("stamps every server-derived field regardless of what the model returned", async () => {
    const base = videoDecisionContentFixture();
    const wrong: VideoDecisionContent = {
      ...base,
      decision: { ...base.decision, disposition: "CHANGE", evidenceStrength: "STRONG" },
      viewerValueImpact: { ...base.viewerValueImpact, escalationRequired: true },
      experimentEligible: true,
    };
    const run = await executeThroughQa({ content: wrong });
    const draftResult = run.draft as { content: VideoDecisionContent };
    expect(draftResult.content.decision.disposition).toBe("LEARN_MORE"); // server mapping for GATHER_EVIDENCE
    expect(draftResult.content.decision.evidenceStrength).toBe("NONE"); // server-derived from OPENING_PROMISE category
    expect(draftResult.content.viewerValueImpact.escalationRequired).toBe(false);
    expect(draftResult.content.experimentEligible).toBe(false);
    expect((run.qa as { qa: { passed: boolean } }).qa.passed).toBe(true);
  });

  it("computes experiment eligibility correctly across every decision type", () => {
    for (const decisionType of decisionTypeSchema.options) {
      const expected = decisionType === "INVESTIGATE" || decisionType === "PRIORITIZE_CHANGE";
      expect(DECISION_TYPE_EXPERIMENT_ELIGIBLE[decisionType]).toBe(expected);
    }
  });

  it("truncating the reported findings list cannot flip fail into pass", () => {
    const manyErrors = Array.from({ length: 60 }, (_, index) => ({ severity: "error" as const, code: `CODE_${index}`, message: "x", evidenceIds: [] }));
    const qa = videoDecisionQA(manyErrors);
    expect(qa.findings.length).toBe(50); // truncated for storage
    expect(qa.passed).toBe(false); // but pass/fail is computed from the full untruncated list
    expect(qa.recommendation).toBe("revise");
  });
});

describe("Decision model accounting", () => {
  it("requires distinct providers for GENERATOR and CRITIC before any spend", () => {
    const router = new StaticRoleRouter({}, { id: "openai", model: "shared", invoke: async () => { throw new Error("should not be called"); } });
    expect(() => assertDistinctRoleProviders(router, "GENERATOR", "CRITIC")).toThrow(ModelRoutingError);
  });

  it("reserves before each call and conservatively settles a provider failure", async () => {
    const events: string[] = [];
    const provider = (id: "openai" | "anthropic", value: VideoDecisionContent | VideoDecisionCritique, fails = false): StructuredModelProvider => ({
      id, model: `${id}-model`,
      invoke: async <T>(_schema: unknown, context: ModelInvocationContext) => {
        events.push(`invoke:${context.role}`);
        if (fails) throw Object.assign(new Error("timeout"), { code: "MODEL_TIMEOUT" });
        return { value: value as T, usage, provider: id, model: `${id}-model`, rawUsage: {} };
      },
    });
    const meter: ResearchUsageMeter = {
      ensure: async () => undefined,
      reserve: async (input) => { events.push(`reserve:${input.kind}`); return { operationId: crypto.randomUUID(), status: "RESERVED", idempotentReplay: false }; },
      finalize: async (_reservation, status, actual) => { events.push(`finalize:${status}:${actual.failedOperations ?? 0}`); },
      record: async () => undefined,
    };
    const router = new StaticRoleRouter({ GENERATOR: provider("openai", videoDecisionContentFixture()), CRITIC: provider("anthropic", { safeToFinalize: true, summary: "No issue.", findings: [] }, true) });
    const model = new RoutedVideoDecisionModel(router, channelVideoDecisionConfig(), meter, () => new Date("2026-09-17T10:00:00.000Z"));
    const evidence = deriveVideoDecisionEvidence(approvedVideoDiagnosisArtifactFixture);
    await model.analyze(approvedVideoDiagnosisArtifactFixture, evidence, undefined);
    await expect(model.critique(approvedVideoDiagnosisArtifactFixture, evidence, videoDecisionContentFixture())).rejects.toThrow("timeout");
    expect(events).toEqual(["reserve:MODEL_SYNTHESIS", "invoke:GENERATOR", "finalize:SUCCEEDED:0", "reserve:MODEL_QA", "invoke:CRITIC", "finalize:FAILED:1"]);
  });

  it("fits exactly two normal calls and four structural retry calls with no revision budget", () => {
    const budget = channelVideoDecisionConfig();
    expect(budget.maxAggregateSynthesisCalls).toBe(2);
    expect(budget.maxAggregateQaCalls).toBe(2);
    expect(budget.maxAggregateRevisionCalls).toBe(0);
    expect(budget.maxAutomatedRevisions).toBe(0);
    expect(2 * budget.modelAnalysisOutputTokens + 2 * budget.modelReviewOutputTokens).toBeLessThanOrEqual(budget.maxAggregateOutputTokens);
  });

  it("rejects malformed structured model output as a terminal schema failure", async () => {
    const deps = dependencies();
    deps.model.analyze = vi.fn(async () => ({ value: { nonsense: true } as unknown as VideoDecisionContent, usage, attribution: analyst }));
    const executor = new ChannelVideoDecisionExecutor(deps.resolver, deps.model);
    const validated = await executor.execute(step("validate-approved-diagnosis"));
    const derived = await executor.execute(step("derive-decision-evidence", { "validate-approved-diagnosis": validated }));
    await expect(executor.execute(step("draft-video-decision", { "validate-approved-diagnosis": validated, "derive-decision-evidence": derived }))).rejects.toBeTruthy();
  });

  it("constrains unavailable categories to the same bounded decision set regardless of evidence strength", () => {
    expect(permittedDecisionTypesFor("UNAVAILABLE", "STRONG")).toEqual(["PRESERVE_CURRENT_APPROACH", "GATHER_EVIDENCE", "DEFER", "ESCALATE_TO_HUMAN_JUDGMENT"]);
  });
});
