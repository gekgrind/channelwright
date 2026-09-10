import { describe, expect, it, vi } from "vitest";
import { getWorkflowDefinition, WORKFLOW_FINALIZER_STEP, experimentTypeSchema, type ClaimedWorkflowStep, type VideoExperimentContent, type VideoExperimentCritique } from "@/domain/production-workflows";
import type { ModelInvocationContext, StructuredModelProvider } from "@/server/ai/provider";
import { assertDistinctRoleProviders, ModelRoutingError, StaticRoleRouter } from "@/server/ai/role-router";
import type { ApprovedDecisionResolver } from "./approved-decision-resolver";
import type { ResearchUsageMeter } from "./research-usage";
import { channelVideoExperimentConfig } from "./video-experiment-config";
import { deriveVideoExperimentConstraints, EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE } from "./video-experiment-constraints";
import { ChannelVideoExperimentExecutor } from "./video-experiment-executor";
import { approvedVideoDecisionArtifactFixture, videoExperimentContentFixture } from "./video-experiment-fixtures.test-helper";
import { RoutedVideoExperimentModel, type VideoExperimentModel } from "./video-experiment-model";
import { videoExperimentQA } from "./video-experiment-validation";

const usage = { model: "test", inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const analyst = { provider: "openai" as const, model: "analyst", role: "GENERATOR" as const, operation: "video_experiment_design", invokedAt: "2026-09-18T10:01:00.000Z" };
const critic = { provider: "anthropic" as const, model: "critic", role: "CRITIC" as const, operation: "video_experiment_critique", invokedAt: "2026-09-18T10:01:30.000Z" };

function step(stepKey: string, priorOutputs: Record<string, unknown> = {}): ClaimedWorkflowStep {
  return {
    id: "a8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a80", ownerId: approvedVideoDecisionArtifactFixture.reference.approvedBy,
    workflowId: "a8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a81", runId: "a8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a82",
    workflowType: "CHANNEL_VIDEO_EXPERIMENT", definitionVersion: 1, stepKey, capability: "test", attemptCount: 1, maxAttempts: 2,
    leaseToken: "a8a1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a83", leaseExpiresAt: "2026-09-18T11:00:00.000Z",
    input: { videoDecisionWorkflowId: approvedVideoDecisionArtifactFixture.reference.decisionWorkflowId, videoDecisionRunId: approvedVideoDecisionArtifactFixture.reference.decisionRunId, approvedVideoDecisionReference: approvedVideoDecisionArtifactFixture.reference },
    priorOutputs,
  };
}

function dependencies(options: { safe?: boolean; resolveError?: Error; content?: VideoExperimentContent } = {}) {
  const calls: string[] = [];
  const resolver: ApprovedDecisionResolver = {
    resolve: vi.fn(async () => {
      if (options.resolveError) throw options.resolveError;
      return approvedVideoDecisionArtifactFixture;
    }),
  };
  const model: VideoExperimentModel = {
    analyze: vi.fn(async () => { calls.push("ANALYST"); return { value: options.content ?? videoExperimentContentFixture(), usage, attribution: analyst }; }),
    critique: vi.fn(async () => { calls.push("CRITIC"); return { value: { safeToFinalize: options.safe ?? true, summary: options.safe === false ? "Uncontrolled confounder." : "No blocking issue.", findings: options.safe === false ? [{ code: "CONFOUNDED_DESIGN", severity: "error" as const, affectedField: "content.experiment", rationale: "The comparison is confounded.", evidenceRefs: [] }] : [] } satisfies VideoExperimentCritique, usage, attribution: critic }; }),
    routing: () => [{ role: "GENERATOR", provider: "openai", model: "analyst" }, { role: "CRITIC", provider: "anthropic", model: "critic" }],
  };
  return { resolver, model, calls };
}

async function executeThroughQa(options: { safe?: boolean; content?: VideoExperimentContent } = {}) {
  const deps = dependencies(options);
  const executor = new ChannelVideoExperimentExecutor(deps.resolver, deps.model, undefined, () => new Date("2026-09-18T10:02:00.000Z"));
  const validated = await executor.execute(step("validate-approved-decision"));
  const derived = await executor.execute(step("derive-experiment-constraints", { "validate-approved-decision": validated }));
  const draft = await executor.execute(step("draft-video-experiment", { "validate-approved-decision": validated, "derive-experiment-constraints": derived }));
  const reviewed = await executor.execute(step("critique-video-experiment", { "validate-approved-decision": validated, "derive-experiment-constraints": derived, "draft-video-experiment": draft }));
  const qa = await executor.execute(step("final-video-experiment-qa", { "validate-approved-decision": validated, "derive-experiment-constraints": derived, "draft-video-experiment": draft, "critique-video-experiment": reviewed }));
  return { deps, executor, validated, derived, draft, reviewed, qa };
}

describe("CHANNEL_VIDEO_EXPERIMENT executor", () => {
  it("registers the approved seven-stage no-revision graph", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_EXPERIMENT", 1);
    expect(definition.steps.map((item) => item.key)).toEqual(["validate-approved-decision", "derive-experiment-constraints", "draft-video-experiment", "critique-video-experiment", "final-video-experiment-qa", "finalize-video-experiment", "review-video-experiment"]);
    expect(definition.steps.filter((item) => item.maxAttempts === 2).map((item) => item.key)).toEqual(["draft-video-experiment", "critique-video-experiment"]);
    expect(WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_EXPERIMENT).toBe("finalize-video-experiment");
    expect(definition.steps.some((item) => item.key.includes("revision"))).toBe(false);
  });

  it("executes exactly one ANALYST and one independent CRITIC on the normal path", async () => {
    const run = await executeThroughQa();
    expect(run.deps.calls).toEqual(["ANALYST", "CRITIC"]);
    const output = await run.executor.execute(step("finalize-video-experiment", { "validate-approved-decision": run.validated, "derive-experiment-constraints": run.derived, "draft-video-experiment": run.draft, "critique-video-experiment": run.reviewed, "final-video-experiment-qa": run.qa }));
    expect((output as { workflowType: string }).workflowType).toBe("CHANNEL_VIDEO_EXPERIMENT");
    expect((run.qa as { qa: { passed: boolean } }).qa.passed).toBe(true);
  });

  it("fits exactly two normal calls and four structural retry calls with no revision step", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_EXPERIMENT", 1);
    const structuralMax = definition.steps.filter((item) => item.kind === "WORKER").reduce((sum, item) => sum + item.maxAttempts, 0);
    expect(structuralMax).toBe(8);
    expect(definition.steps.filter((item) => item.maxAttempts === 2).reduce((sum, item) => sum + item.maxAttempts, 0)).toBe(4);
  });

  it("performs zero model calls when immutable Decision resolution fails", async () => {
    const deps = dependencies({ resolveError: Object.assign(new Error("bad eligibility"), { retryable: false }) });
    const executor = new ChannelVideoExperimentExecutor(deps.resolver, deps.model);
    await expect(executor.execute(step("validate-approved-decision"))).rejects.toThrow("bad eligibility");
    expect(deps.calls).toEqual([]);
  });

  it("performs zero model calls while only deriving experiment constraints", async () => {
    const deps = dependencies();
    const executor = new ChannelVideoExperimentExecutor(deps.resolver, deps.model);
    const validated = await executor.execute(step("validate-approved-decision"));
    await executor.execute(step("derive-experiment-constraints", { "validate-approved-decision": validated }));
    expect(deps.calls).toEqual([]);
  });

  it("fails closed after critic disagreement and never invokes revision", async () => {
    const run = await executeThroughQa({ safe: false });
    expect((run.qa as { qa: { passed: boolean } }).qa.passed).toBe(false);
    await expect(run.executor.execute(step("finalize-video-experiment", { "validate-approved-decision": run.validated, "derive-experiment-constraints": run.derived, "draft-video-experiment": run.draft, "critique-video-experiment": run.reviewed, "final-video-experiment-qa": run.qa }))).rejects.toMatchObject({ code: "VIDEO_EXPERIMENT_QA_REJECTED", retryable: false });
    expect(run.deps.calls).toEqual(["ANALYST", "CRITIC"]);
  });

  it("stamps every server-derived field regardless of what the model returned", async () => {
    const base = videoExperimentContentFixture();
    const wrong: VideoExperimentContent = {
      ...base,
      experiment: {
        ...base.experiment,
        disposition: "RUN_COMPARISON",
        measurementOnly: false,
        evidenceStrength: "STRONG",
        category: "RETENTION_STRUCTURE",
        controlCondition: { ...base.experiment.controlCondition, kind: "SIMULTANEOUS_CONTROL" },
        decisionLinkage: { ...base.experiment.decisionLinkage, decisionId: "decision:forged", decisionType: "PRIORITIZE_CHANGE" },
      },
      viewerValueSafeguards: { ...base.viewerValueSafeguards, inheritedState: "AT_RISK", escalationRequired: true },
      experimentReady: false,
      portfolioEligible: true,
    };
    const run = await executeThroughQa({ content: wrong });
    const draftResult = run.draft as { content: VideoExperimentContent };
    expect(draftResult.content.experiment.disposition).toBe("OBSERVE_ONLY");
    expect(draftResult.content.experiment.measurementOnly).toBe(true);
    expect(draftResult.content.experiment.evidenceStrength).toBe("MODERATE");
    expect(draftResult.content.experiment.category).toBe("OPENING_PROMISE");
    expect(draftResult.content.experiment.controlCondition.kind).toBe("NONE_OBSERVATIONAL");
    expect(draftResult.content.experiment.decisionLinkage.decisionId).toBe("decision:primary");
    expect(draftResult.content.experiment.decisionLinkage.decisionType).toBe("INVESTIGATE");
    expect(draftResult.content.viewerValueSafeguards.inheritedState).toBe("PRESERVED");
    expect(draftResult.content.viewerValueSafeguards.escalationRequired).toBe(false);
    expect(draftResult.content.experimentReady).toBe(true);
    expect(draftResult.content.portfolioEligible).toBe(false);
    expect((run.qa as { qa: { passed: boolean } }).qa.passed).toBe(true);
  });

  it("computes portfolio eligibility correctly across every experiment shape", () => {
    for (const experimentType of experimentTypeSchema.options) {
      const expected = experimentType !== "OBSERVATIONAL_PROBE";
      expect(EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE[experimentType]).toBe(expected);
    }
  });

  it("truncating the reported findings list cannot flip fail into pass", () => {
    const manyErrors = Array.from({ length: 60 }, (_, index) => ({ severity: "error" as const, code: `CODE_${index}`, message: "x", evidenceIds: [] }));
    const qa = videoExperimentQA(manyErrors);
    expect(qa.findings.length).toBe(50);
    expect(qa.passed).toBe(false);
    expect(qa.recommendation).toBe("revise");
  });
});

describe("Experiment model accounting", () => {
  it("requires distinct providers for GENERATOR and CRITIC before any spend", () => {
    const router = new StaticRoleRouter({}, { id: "openai", model: "shared", invoke: async () => { throw new Error("should not be called"); } });
    expect(() => assertDistinctRoleProviders(router, "GENERATOR", "CRITIC")).toThrow(ModelRoutingError);
  });

  it("reserves before each call and conservatively settles a provider failure", async () => {
    const events: string[] = [];
    const provider = (id: "openai" | "anthropic", value: VideoExperimentContent | VideoExperimentCritique, fails = false): StructuredModelProvider => ({
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
    const router = new StaticRoleRouter({ GENERATOR: provider("openai", videoExperimentContentFixture()), CRITIC: provider("anthropic", { safeToFinalize: true, summary: "No issue.", findings: [] }, true) });
    const model = new RoutedVideoExperimentModel(router, channelVideoExperimentConfig(), meter, () => new Date("2026-09-18T10:00:00.000Z"));
    const constraints = deriveVideoExperimentConstraints(approvedVideoDecisionArtifactFixture);
    await model.analyze(approvedVideoDecisionArtifactFixture, constraints, undefined);
    await expect(model.critique(approvedVideoDecisionArtifactFixture, constraints, videoExperimentContentFixture())).rejects.toThrow("timeout");
    expect(events).toEqual(["reserve:MODEL_SYNTHESIS", "invoke:GENERATOR", "finalize:SUCCEEDED:0", "reserve:MODEL_QA", "invoke:CRITIC", "finalize:FAILED:1"]);
  });

  it("keeps the four-call retry graph inside the zero-revision aggregate output ceiling", () => {
    const budget = channelVideoExperimentConfig();
    expect(budget.maxAggregateSynthesisCalls).toBe(2);
    expect(budget.maxAggregateQaCalls).toBe(2);
    expect(budget.maxAggregateRevisionCalls).toBe(0);
    expect(budget.maxAutomatedRevisions).toBe(0);
    expect(2 * budget.modelAnalysisOutputTokens + 2 * budget.modelReviewOutputTokens).toBeLessThanOrEqual(budget.maxAggregateOutputTokens);
  });

  it("rejects malformed structured model output as a terminal schema failure", async () => {
    const deps = dependencies();
    deps.model.analyze = vi.fn(async () => ({ value: { nonsense: true } as unknown as VideoExperimentContent, usage, attribution: analyst }));
    const executor = new ChannelVideoExperimentExecutor(deps.resolver, deps.model);
    const validated = await executor.execute(step("validate-approved-decision"));
    const derived = await executor.execute(step("derive-experiment-constraints", { "validate-approved-decision": validated }));
    await expect(executor.execute(step("draft-video-experiment", { "validate-approved-decision": validated, "derive-experiment-constraints": derived }))).rejects.toBeTruthy();
  });
});
