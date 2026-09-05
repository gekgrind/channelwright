import {
  approvedVideoDiagnosisArtifactSchema,
  channelVideoDecisionResultSchema,
  videoDecisionCritiqueStepSchema,
  videoDecisionDraftSchema,
  videoDecisionEvidenceSchema,
  videoDecisionInputSchema,
  videoDecisionQAStepSchema,
  type ChannelVideoDecisionResult,
  type ClaimedWorkflowStep,
  type VideoDecisionContent,
  type VideoDecisionEvidence,
} from "@/domain/production-workflows";
import { assertDistinctRoleProviders, EnvironmentRoleRouter } from "@/server/ai/role-router";
import { SupabaseApprovedDiagnosisResolver, type ApprovedDiagnosisResolver } from "./approved-diagnosis-resolver";
import type { WorkflowStepExecutor } from "./concept-validation-executor";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import { channelVideoDecisionConfig } from "./video-decision-config";
import { DECISION_TYPE_DISPOSITION, DECISION_TYPE_EXPERIMENT_ELIGIBLE, deriveVideoDecisionEvidence } from "./video-decision-evidence";
import { RoutedVideoDecisionModel, type VideoDecisionModel } from "./video-decision-model";
import { deterministicVideoDecisionValidation, videoDecisionQA } from "./video-decision-validation";

export class VideoDecisionExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

function requirePrior<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T): T {
  const value = step.priorOutputs[key];
  if (!value) throw new VideoDecisionExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${key} is missing.`);
  return parse(value);
}

/**
 * Recomputes every field the server derives from the decision type and category
 * rather than trusting the model's own copy of them -- disposition, evidence
 * strength, experiment eligibility, and Viewer Value escalation. Mirrors the
 * Diagnosis executor's `preserveDeterministicUnknowns` pattern: the model can
 * still get these wrong, but the durable artifact never does.
 */
function stampServerDerivedFields(content: VideoDecisionContent, evidence: VideoDecisionEvidence): VideoDecisionContent {
  const category = evidence.categories.find((item) => item.category === content.decision.category);
  const escalationRequired = evidence.viewerValueState === "AT_RISK" || content.decision.decisionType === "ESCALATE_TO_HUMAN_JUDGMENT";
  return {
    ...content,
    decision: {
      ...content.decision,
      disposition: DECISION_TYPE_DISPOSITION[content.decision.decisionType],
      evidenceStrength: category?.evidenceStrength ?? "NONE",
    },
    viewerValueImpact: {
      ...content.viewerValueImpact,
      inheritedState: evidence.viewerValueState,
      escalationRequired,
    },
    experimentEligible: DECISION_TYPE_EXPERIMENT_ELIGIBLE[content.decision.decisionType],
  };
}

export class ChannelVideoDecisionExecutor implements WorkflowStepExecutor {
  constructor(
    private readonly injectedResolver?: ApprovedDiagnosisResolver,
    private readonly injectedModel?: VideoDecisionModel,
    private readonly injectedUsageMeter?: ResearchUsageMeter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private dependencies(step: ClaimedWorkflowStep) {
    const budget = channelVideoDecisionConfig();
    const resolver = this.injectedResolver ?? new SupabaseApprovedDiagnosisResolver();
    const usageMeter = this.injectedUsageMeter ?? new SupabaseResearchUsageMeter(step, budget);
    let model = this.injectedModel;
    if (!model) {
      const router = new EnvironmentRoleRouter("VIDEO_DECISION");
      assertDistinctRoleProviders(router, "GENERATOR", "CRITIC");
      model = new RoutedVideoDecisionModel(router, budget, usageMeter);
    }
    return { budget, resolver, model };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    console.info("video_decision_stage", { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_VIDEO_DECISION") throw new VideoDecisionExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Video-decision executor received a different workflow type.");
    const input = videoDecisionInputSchema.parse(step.input);

    if (step.stepKey === "validate-approved-diagnosis") {
      const resolver = this.injectedResolver ?? new SupabaseApprovedDiagnosisResolver();
      const artifact = approvedVideoDiagnosisArtifactSchema.parse(await resolver.resolve(input.videoDiagnosisWorkflowId, input.videoDiagnosisRunId, input.approvedVideoDiagnosisReference));
      this.log(step, { diagnosisRunId: artifact.reference.diagnosisRunId, performanceRunId: artifact.reference.upstreamVideoPerformance.performanceRunId, artifactHash: artifact.reference.diagnosisArtifactHash, lineageEntries: artifact.decisionScope.entries.length });
      return artifact;
    }

    const artifact = requirePrior(step, "validate-approved-diagnosis", (value) => approvedVideoDiagnosisArtifactSchema.parse(value));
    if (step.stepKey === "derive-decision-evidence") {
      const evidence = deriveVideoDecisionEvidence(artifact);
      this.log(step, { categories: evidence.categories.length, unavailableCategories: evidence.categories.filter((item) => item.availability === "UNAVAILABLE").map((item) => item.category), evidenceRequirements: evidence.evidenceRequirements.length });
      return evidence;
    }

    const evidence = requirePrior(step, "derive-decision-evidence", (value) => videoDecisionEvidenceSchema.parse(value));
    const { budget, model } = this.dependencies(step);
    if (step.stepKey === "draft-video-decision") {
      const call = await model.analyze(artifact, evidence, input.humanRevisionNote);
      const content = stampServerDerivedFields(call.value, evidence);
      const output = videoDecisionDraftSchema.parse({ content, modelUsage: call.usage, analyst: call.attribution });
      this.log(step, { role: "ANALYST", provider: call.attribution.provider, model: call.attribution.model, decisionType: content.decision.decisionType, category: content.decision.category, totalTokens: call.usage.totalTokens });
      return output;
    }

    const draft = requirePrior(step, "draft-video-decision", (value) => videoDecisionDraftSchema.parse(value));
    if (step.stepKey === "critique-video-decision") {
      const call = await model.critique(artifact, evidence, draft.content);
      const output = videoDecisionCritiqueStepSchema.parse({ critique: call.value, modelUsage: call.usage, critic: call.attribution });
      this.log(step, { role: "CRITIC", provider: call.attribution.provider, model: call.attribution.model, safeToFinalize: call.value.safeToFinalize, findings: call.value.findings.length, totalTokens: call.usage.totalTokens });
      return output;
    }

    const critique = requirePrior(step, "critique-video-decision", (value) => videoDecisionCritiqueStepSchema.parse(value));
    if (step.stepKey === "final-video-decision-qa") {
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
      const diagnosis = artifact.diagnosisResult;
      const result = channelVideoDecisionResultSchema.parse({
        schemaVersion: 1,
        workflowType: "CHANNEL_VIDEO_DECISION",
        decidedAt: this.now().toISOString(),
        source: {
          diagnosisWorkflowId: artifact.reference.diagnosisWorkflowId,
          diagnosisRunId: artifact.reference.diagnosisRunId,
          performanceWorkflowId: artifact.reference.upstreamVideoPerformance.performanceWorkflowId,
          performanceRunId: artifact.reference.upstreamVideoPerformance.performanceRunId,
          releaseWorkflowId: artifact.reference.upstreamVideoPerformance.upstreamVideoRelease.releaseWorkflowId,
          releaseRunId: artifact.reference.upstreamVideoPerformance.upstreamVideoRelease.releaseRunId,
          topicId: diagnosis.source.topicId,
          pillarId: diagnosis.source.pillarId,
          finalTitle: diagnosis.source.finalTitle,
          subjectIdentity: `diagnosis:${artifact.reference.diagnosisRunId}`,
        },
        approvedVideoDiagnosisReference: artifact.reference,
        decisionScope: artifact.decisionScope,
        decisionEvidence: evidence,
        content: draft.content,
        viewerValueProvenance: diagnosis.viewerValueProvenance,
        crossModelReview,
        modelProvenance: [draft.analyst, critique.critic],
      });
      const qa = videoDecisionQA(deterministicVideoDecisionValidation(result, artifact, evidence, budget.maxResultPayloadBytes));
      this.log(step, { deterministicOnly: true, passed: qa.passed, score: qa.score, errors: qa.findings.filter((item) => item.severity === "error").map((item) => item.code) });
      return videoDecisionQAStepSchema.parse({ qa, crossModelReview, result });
    }

    if (step.stepKey === "finalize-video-decision") {
      const qaStep = requirePrior(step, "final-video-decision-qa", (value) => videoDecisionQAStepSchema.parse(value));
      if (!qaStep.qa.passed || qaStep.qa.recommendation === "revise") throw new VideoDecisionExecutionError("VIDEO_DECISION_QA_REJECTED", false, "Deterministic final QA rejected the decision; no automated revision or partial final artifact is allowed.");
      const result = channelVideoDecisionResultSchema.parse(qaStep.result) satisfies ChannelVideoDecisionResult;
      this.log(step, { humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: qaStep.qa.score, decisionType: result.content.decision.decisionType, experimentEligible: result.content.experimentEligible, providers: result.modelProvenance.map((item) => item.provider) });
      return result;
    }

    throw new VideoDecisionExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported video-decision step ${step.stepKey}.`);
  }
}
