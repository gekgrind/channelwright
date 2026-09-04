import { describe, expect, it, vi } from "vitest";
import { getWorkflowDefinition, WORKFLOW_FINALIZER_STEP, type ClaimedWorkflowStep, type VideoDiagnosisAnalysis, type VideoDiagnosisCritique } from "@/domain/production-workflows";
import type { ModelInvocationContext, StructuredModelProvider } from "@/server/ai/provider";
import { StaticRoleRouter } from "@/server/ai/role-router";
import type { ApprovedPerformanceResolver } from "./approved-performance-resolver";
import type { ResearchUsageMeter } from "./research-usage";
import { channelVideoDiagnosisConfig } from "./video-diagnosis-config";
import { ChannelVideoDiagnosisExecutor } from "./video-diagnosis-executor";
import { approvedVideoPerformanceArtifactFixture, videoDiagnosisAnalysisFixture } from "./video-diagnosis-fixtures.test-helper";
import { RoutedVideoDiagnosisModel, type VideoDiagnosisModel } from "./video-diagnosis-model";
import { deriveVideoDiagnosisObservations } from "./video-diagnosis-observations";

const usage = { model: "test", inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const analyst = { provider: "openai" as const, model: "analyst", role: "GENERATOR" as const, operation: "video_diagnosis_analysis", invokedAt: "2026-09-16T10:01:00.000Z" };
const critic = { provider: "anthropic" as const, model: "critic", role: "CRITIC" as const, operation: "video_diagnosis_critique", invokedAt: "2026-09-16T10:01:30.000Z" };

function step(stepKey: string, priorOutputs: Record<string, unknown> = {}): ClaimedWorkflowStep {
  return {
    id: "e7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a70", ownerId: approvedVideoPerformanceArtifactFixture.reference.approvedBy,
    workflowId: "e7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a71", runId: "e7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a72",
    workflowType: "CHANNEL_VIDEO_DIAGNOSIS", definitionVersion: 1, stepKey, capability: "test", attemptCount: 1, maxAttempts: 2,
    leaseToken: "e7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a73", leaseExpiresAt: "2026-09-16T11:00:00.000Z",
    input: { videoPerformanceWorkflowId: approvedVideoPerformanceArtifactFixture.reference.performanceWorkflowId, videoPerformanceRunId: approvedVideoPerformanceArtifactFixture.reference.performanceRunId, approvedVideoPerformanceReference: approvedVideoPerformanceArtifactFixture.reference },
    priorOutputs,
  };
}

function dependencies(options: { safe?: boolean; resolveError?: Error } = {}) {
  const calls: string[] = [];
  const resolver: ApprovedPerformanceResolver = {
    resolve: vi.fn(async () => {
      if (options.resolveError) throw options.resolveError;
      return approvedVideoPerformanceArtifactFixture;
    }),
  };
  const model: VideoDiagnosisModel = {
    analyze: vi.fn(async () => { calls.push("ANALYST"); return { value: videoDiagnosisAnalysisFixture(), usage, attribution: analyst }; }),
    critique: vi.fn(async () => { calls.push("CRITIC"); return { value: { safeToFinalize: options.safe ?? true, summary: options.safe === false ? "Blocking overstatement." : "No blocking issue.", findings: options.safe === false ? [{ code: "CAUSAL_OVERSTATEMENT", severity: "error" as const, affectedField: "analysis.findings", rationale: "The claim exceeds the evidence.", evidenceRefs: [] }] : [] }, usage, attribution: critic }; }),
    routing: () => [{ role: "GENERATOR", provider: "openai", model: "analyst" }, { role: "CRITIC", provider: "anthropic", model: "critic" }],
  };
  return { resolver, model, calls };
}

async function executeThroughQa(options: { safe?: boolean } = {}) {
  const deps = dependencies(options);
  const executor = new ChannelVideoDiagnosisExecutor(deps.resolver, deps.model, undefined, () => new Date("2026-09-16T10:02:00.000Z"));
  const validated = await executor.execute(step("validate-approved-performance"));
  const derived = await executor.execute(step("derive-diagnosis-observations", { "validate-approved-performance": validated }));
  const draft = await executor.execute(step("draft-video-diagnosis", { "validate-approved-performance": validated, "derive-diagnosis-observations": derived }));
  const reviewed = await executor.execute(step("critique-video-diagnosis", { "validate-approved-performance": validated, "derive-diagnosis-observations": derived, "draft-video-diagnosis": draft }));
  const qa = await executor.execute(step("final-video-diagnosis-qa", { "validate-approved-performance": validated, "derive-diagnosis-observations": derived, "draft-video-diagnosis": draft, "critique-video-diagnosis": reviewed }));
  return { deps, executor, validated, derived, draft, reviewed, qa };
}

describe("CHANNEL_VIDEO_DIAGNOSIS executor", () => {
  it("registers the approved seven-stage no-revision graph", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_DIAGNOSIS", 1);
    expect(definition.steps.map((item) => item.key)).toEqual(["validate-approved-performance", "derive-diagnosis-observations", "draft-video-diagnosis", "critique-video-diagnosis", "final-video-diagnosis-qa", "finalize-video-diagnosis", "review-video-diagnosis"]);
    expect(definition.steps.filter((item) => item.maxAttempts === 2).map((item) => item.key)).toEqual(["draft-video-diagnosis", "critique-video-diagnosis"]);
    expect(WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_DIAGNOSIS).toBe("finalize-video-diagnosis");
    expect(definition.steps.some((item) => item.key.includes("revision"))).toBe(false);
  });

  it("executes exactly one ANALYST and one independent CRITIC on the normal path", async () => {
    const run = await executeThroughQa();
    expect(run.deps.calls).toEqual(["ANALYST", "CRITIC"]);
    const output = await run.executor.execute(step("finalize-video-diagnosis", { "validate-approved-performance": run.validated, "derive-diagnosis-observations": run.derived, "draft-video-diagnosis": run.draft, "critique-video-diagnosis": run.reviewed, "final-video-diagnosis-qa": run.qa }));
    expect((output as { workflowType: string }).workflowType).toBe("CHANNEL_VIDEO_DIAGNOSIS");
  });

  it("performs zero model calls when immutable Performance resolution fails", async () => {
    const deps = dependencies({ resolveError: Object.assign(new Error("bad provenance"), { retryable: false }) });
    const executor = new ChannelVideoDiagnosisExecutor(deps.resolver, deps.model);
    await expect(executor.execute(step("validate-approved-performance"))).rejects.toThrow("bad provenance");
    expect(deps.calls).toEqual([]);
  });

  it("fails closed after critic disagreement and never invokes revision", async () => {
    const run = await executeThroughQa({ safe: false });
    expect((run.qa as { qa: { passed: boolean } }).qa.passed).toBe(false);
    await expect(run.executor.execute(step("finalize-video-diagnosis", { "validate-approved-performance": run.validated, "derive-diagnosis-observations": run.derived, "draft-video-diagnosis": run.draft, "critique-video-diagnosis": run.reviewed, "final-video-diagnosis-qa": run.qa }))).rejects.toMatchObject({ code: "VIDEO_DIAGNOSIS_QA_REJECTED", retryable: false });
    expect(run.deps.calls).toEqual(["ANALYST", "CRITIC"]);
  });
});

describe("Diagnosis model accounting", () => {
  it("reserves before each call and conservatively settles a provider failure", async () => {
    const events: string[] = [];
    const provider = (id: "openai" | "anthropic", value: VideoDiagnosisAnalysis | VideoDiagnosisCritique, fails = false): StructuredModelProvider => ({
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
    const router = new StaticRoleRouter({ GENERATOR: provider("openai", videoDiagnosisAnalysisFixture()), CRITIC: provider("anthropic", { safeToFinalize: true, summary: "No issue.", findings: [] }, true) });
    const model = new RoutedVideoDiagnosisModel(router, channelVideoDiagnosisConfig(), meter, () => new Date("2026-09-16T10:00:00.000Z"));
    const set = deriveVideoDiagnosisObservations(approvedVideoPerformanceArtifactFixture);
    await model.analyze(approvedVideoPerformanceArtifactFixture, set);
    await expect(model.critique(approvedVideoPerformanceArtifactFixture, set, videoDiagnosisAnalysisFixture())).rejects.toThrow("timeout");
    expect(events).toEqual(["reserve:MODEL_SYNTHESIS", "invoke:GENERATOR", "finalize:SUCCEEDED:0", "reserve:MODEL_QA", "invoke:CRITIC", "finalize:FAILED:1"]);
  });

  it("fits exactly two normal calls and four structural retry calls with no revision budget", () => {
    const budget = channelVideoDiagnosisConfig();
    expect(budget.maxAggregateSynthesisCalls).toBe(2);
    expect(budget.maxAggregateQaCalls).toBe(2);
    expect(budget.maxAggregateRevisionCalls).toBe(0);
    expect(budget.maxAutomatedRevisions).toBe(0);
    expect(2 * budget.modelAnalysisOutputTokens + 2 * budget.modelReviewOutputTokens).toBeLessThanOrEqual(budget.maxAggregateOutputTokens);
  });
});
