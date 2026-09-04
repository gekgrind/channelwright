import {
  approvedVideoPerformanceArtifactSchema,
  channelVideoDiagnosisResultSchema,
  diagnosisObservationSetSchema,
  videoDiagnosisCritiqueStepSchema,
  videoDiagnosisDraftSchema,
  videoDiagnosisInputSchema,
  videoDiagnosisQAStepSchema,
  type ChannelVideoDiagnosisResult,
  type ClaimedWorkflowStep,
  type VideoDiagnosisAnalysis,
} from "@/domain/production-workflows";
import { assertDistinctRoleProviders, EnvironmentRoleRouter } from "@/server/ai/role-router";
import { SupabaseApprovedPerformanceResolver, type ApprovedPerformanceResolver } from "./approved-performance-resolver";
import type { WorkflowStepExecutor } from "./concept-validation-executor";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import { channelVideoDiagnosisConfig } from "./video-diagnosis-config";
import { RoutedVideoDiagnosisModel, type VideoDiagnosisModel } from "./video-diagnosis-model";
import { deriveVideoDiagnosisObservations } from "./video-diagnosis-observations";
import { deterministicVideoDiagnosisValidation, videoDiagnosisQA } from "./video-diagnosis-validation";

export class VideoDiagnosisExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

function requirePrior<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T): T {
  const value = step.priorOutputs[key];
  if (!value) throw new VideoDiagnosisExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${key} is missing.`);
  return parse(value);
}

function preserveDeterministicUnknowns(analysis: VideoDiagnosisAnalysis, required: ReturnType<typeof deriveVideoDiagnosisObservations>["deterministicUnknowns"]): VideoDiagnosisAnalysis {
  const requiredIds = new Set(required.map((item) => item.id));
  const unknowns = [...required, ...analysis.unknowns.filter((item) => !requiredIds.has(item.id))];
  const unresolvedUnknownIds = [...new Set([...required.map((item) => item.id), ...analysis.summary.unresolvedUnknownIds])];
  return { ...analysis, unknowns, summary: { ...analysis.summary, unresolvedUnknownIds } };
}

export class ChannelVideoDiagnosisExecutor implements WorkflowStepExecutor {
  constructor(
    private readonly injectedResolver?: ApprovedPerformanceResolver,
    private readonly injectedModel?: VideoDiagnosisModel,
    private readonly injectedUsageMeter?: ResearchUsageMeter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private dependencies(step: ClaimedWorkflowStep) {
    const budget = channelVideoDiagnosisConfig();
    const resolver = this.injectedResolver ?? new SupabaseApprovedPerformanceResolver();
    const usageMeter = this.injectedUsageMeter ?? new SupabaseResearchUsageMeter(step, budget);
    let model = this.injectedModel;
    if (!model) {
      const router = new EnvironmentRoleRouter("VIDEO_DIAGNOSIS");
      assertDistinctRoleProviders(router, "GENERATOR", "CRITIC");
      model = new RoutedVideoDiagnosisModel(router, budget, usageMeter);
    }
    return { budget, resolver, model };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    console.info("video_diagnosis_stage", { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_VIDEO_DIAGNOSIS") throw new VideoDiagnosisExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Video-diagnosis executor received a different workflow type.");
    const input = videoDiagnosisInputSchema.parse(step.input);

    if (step.stepKey === "validate-approved-performance") {
      const resolver = this.injectedResolver ?? new SupabaseApprovedPerformanceResolver();
      const artifact = approvedVideoPerformanceArtifactSchema.parse(await resolver.resolve(input.videoPerformanceWorkflowId, input.videoPerformanceRunId, input.approvedVideoPerformanceReference));
      this.log(step, { performanceRunId: artifact.reference.performanceRunId, releaseRunId: artifact.reference.upstreamVideoRelease.releaseRunId, artifactHash: artifact.reference.performanceArtifactHash, lineageEntries: artifact.diagnosisScope.entries.length });
      return artifact;
    }

    const artifact = requirePrior(step, "validate-approved-performance", (value) => approvedVideoPerformanceArtifactSchema.parse(value));
    if (step.stepKey === "derive-diagnosis-observations") {
      const observationSet = deriveVideoDiagnosisObservations(artifact);
      this.log(step, { observations: observationSet.observations.length, unavailableCapabilities: observationSet.capabilities.filter((item) => item.availability === "UNAVAILABLE").map((item) => item.category), unknowns: observationSet.deterministicUnknowns.length });
      return observationSet;
    }

    const observationSet = requirePrior(step, "derive-diagnosis-observations", (value) => diagnosisObservationSetSchema.parse(value));
    const { budget, model } = this.dependencies(step);
    if (step.stepKey === "draft-video-diagnosis") {
      const call = await model.analyze(artifact, observationSet);
      const analysis = preserveDeterministicUnknowns(call.value, observationSet.deterministicUnknowns);
      const output = videoDiagnosisDraftSchema.parse({ analysis, modelUsage: call.usage, analyst: call.attribution });
      this.log(step, { role: "ANALYST", provider: call.attribution.provider, model: call.attribution.model, findings: analysis.findings.length, unknowns: analysis.unknowns.length, totalTokens: call.usage.totalTokens });
      return output;
    }

    const draft = requirePrior(step, "draft-video-diagnosis", (value) => videoDiagnosisDraftSchema.parse(value));
    if (step.stepKey === "critique-video-diagnosis") {
      const call = await model.critique(artifact, observationSet, draft.analysis);
      const output = videoDiagnosisCritiqueStepSchema.parse({ critique: call.value, modelUsage: call.usage, critic: call.attribution });
      this.log(step, { role: "CRITIC", provider: call.attribution.provider, model: call.attribution.model, safeToFinalize: call.value.safeToFinalize, findings: call.value.findings.length, totalTokens: call.usage.totalTokens });
      return output;
    }

    const critique = requirePrior(step, "critique-video-diagnosis", (value) => videoDiagnosisCritiqueStepSchema.parse(value));
    if (step.stepKey === "final-video-diagnosis-qa") {
      const crossModelReview = {
        analyst: draft.analyst,
        critic: critique.critic,
        outcome: critique.critique.safeToFinalize
          ? (critique.critique.findings.length === 0 ? "AGREED" as const : "CRITIC_RAISED_ISSUE" as const)
          : "HUMAN_REVIEW_REQUIRED" as const,
        safeToFinalize: critique.critique.safeToFinalize,
        findings: critique.critique.findings,
        summary: critique.critique.summary,
      };
      const result = channelVideoDiagnosisResultSchema.parse({
        schemaVersion: 1,
        workflowType: "CHANNEL_VIDEO_DIAGNOSIS",
        diagnosedAt: this.now().toISOString(),
        source: {
          performanceWorkflowId: artifact.reference.performanceWorkflowId,
          performanceRunId: artifact.reference.performanceRunId,
          releaseWorkflowId: artifact.reference.upstreamVideoRelease.releaseWorkflowId,
          releaseRunId: artifact.reference.upstreamVideoRelease.releaseRunId,
          topicId: artifact.performanceResult.source.releaseTopicId,
          pillarId: artifact.performanceResult.source.pillarId,
          finalTitle: artifact.performanceResult.source.finalTitle,
          subjectIdentity: `performance:${artifact.reference.performanceRunId}`,
        },
        upstreamVideoPerformance: artifact.reference,
        diagnosisScope: artifact.diagnosisScope,
        observations: observationSet.observations,
        capabilities: observationSet.capabilities,
        analysis: draft.analysis,
        viewerValueProvenance: artifact.performanceResult.performanceScope.inheritedViewerValueProvenance,
        crossModelReview,
        modelProvenance: [draft.analyst, critique.critic],
      });
      const qa = videoDiagnosisQA(deterministicVideoDiagnosisValidation(result, artifact, observationSet, budget.maxResultPayloadBytes));
      this.log(step, { deterministicOnly: true, passed: qa.passed, score: qa.score, errors: qa.findings.filter((item) => item.severity === "error").map((item) => item.code) });
      return videoDiagnosisQAStepSchema.parse({ qa, crossModelReview, result });
    }

    if (step.stepKey === "finalize-video-diagnosis") {
      const qaStep = requirePrior(step, "final-video-diagnosis-qa", (value) => videoDiagnosisQAStepSchema.parse(value));
      if (!qaStep.qa.passed || qaStep.qa.recommendation === "revise") throw new VideoDiagnosisExecutionError("VIDEO_DIAGNOSIS_QA_REJECTED", false, "Deterministic final QA rejected the diagnosis; no automated revision or partial final artifact is allowed.");
      const result = channelVideoDiagnosisResultSchema.parse(qaStep.result) satisfies ChannelVideoDiagnosisResult;
      this.log(step, { humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: qaStep.qa.score, outcome: result.analysis.summary.outcome, providers: result.modelProvenance.map((item) => item.provider) });
      return result;
    }

    throw new VideoDiagnosisExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported video-diagnosis step ${step.stepKey}.`);
  }
}
