import {
  approvedVideoDecisionArtifactSchema,
  channelVideoExperimentResultSchema,
  videoExperimentConstraintsSchema,
  videoExperimentCritiqueStepSchema,
  videoExperimentDraftSchema,
  videoExperimentInputSchema,
  videoExperimentQAStepSchema,
  type ChannelVideoExperimentResult,
  type ClaimedWorkflowStep,
  type VideoExperimentConstraints,
  type VideoExperimentContent,
} from "@/domain/production-workflows";
import { assertDistinctRoleProviders, EnvironmentRoleRouter } from "@/server/ai/role-router";
import { SupabaseApprovedDecisionResolver, type ApprovedDecisionResolver } from "./approved-decision-resolver";
import type { WorkflowStepExecutor } from "./concept-validation-executor";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import { channelVideoExperimentConfig } from "./video-experiment-config";
import {
  deriveExperimentReady,
  deriveVideoExperimentConstraints,
  EXPERIMENT_TYPE_CONTROL_KIND,
  EXPERIMENT_TYPE_DISPOSITION,
  EXPERIMENT_TYPE_MEASUREMENT_ONLY,
  EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE,
} from "./video-experiment-constraints";
import { RoutedVideoExperimentModel, type VideoExperimentModel } from "./video-experiment-model";
import { deterministicVideoExperimentValidation, videoExperimentQA } from "./video-experiment-validation";

export class VideoExperimentExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

function requirePrior<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T): T {
  const value = step.priorOutputs[key];
  if (!value) throw new VideoExperimentExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${key} is missing.`);
  return parse(value);
}

/**
 * Recomputes every field the server derives from the experiment shape and the
 * approved-Decision constraints rather than trusting the model's own copy of
 * them -- disposition, measurement-only, evidence strength, category, control
 * kind, decision linkage, inherited Viewer Value state, escalation, readiness,
 * and portfolio eligibility. Mirrors the Decision executor's
 * `stampServerDerivedFields`: the model can still get these wrong, but the
 * durable artifact never does.
 */
function stampServerDerivedFields(content: VideoExperimentContent, constraints: VideoExperimentConstraints): VideoExperimentContent {
  const experimentType = content.experiment.experimentType;
  const measurementOnly = EXPERIMENT_TYPE_MEASUREMENT_ONLY[experimentType];
  const escalationRequired = constraints.viewerValueEscalationRequired || constraints.viewerValueState === "AT_RISK";
  // ROUND 6: the measurement-only-coupled semantic declarations are NOT a model
  // input surface -- they are re-derived from the server-stamped measurementOnly
  // flag (itself derived from experimentType). An observational probe assigns no
  // treatment and therefore has no adoption/preservation condition; a comparison
  // experiment keeps the model's declared adoption/preservation criteria for the
  // deterministic validator to check.
  const semanticIntent = measurementOnly
    ? {
      ...content.experiment.semanticIntent,
      treatmentMechanism: "MEASUREMENT_ONLY" as const,
      prolongsContentForRetention: false,
      addedLengthCarriesProportionalValue: "NOT_APPLICABLE" as const,
      withholdsPromisedValueForRetention: false,
      manufacturesAntagonismForEngagement: false,
      usesScarcityOrUrgencyClaim: false,
      scarcityBasis: null,
      evidenceCanChangeShippingDecision: true,
      adoptionCondition: "NONE_MEASUREMENT_ONLY" as const,
      preservationCondition: "NONE_MEASUREMENT_ONLY" as const,
    }
    : content.experiment.semanticIntent;
  const experiment = {
    ...content.experiment,
    disposition: EXPERIMENT_TYPE_DISPOSITION[experimentType],
    measurementOnly,
    evidenceStrength: constraints.evidenceStrength,
    category: constraints.decisionCategory,
    semanticIntent,
    controlCondition: { ...content.experiment.controlCondition, kind: EXPERIMENT_TYPE_CONTROL_KIND[experimentType] },
    decisionLinkage: {
      ...content.experiment.decisionLinkage,
      decisionId: constraints.decisionId,
      decisionType: constraints.decisionType,
      testsDecisionStatement: constraints.decisionStatement,
    },
  };
  return {
    ...content,
    experiment,
    viewerValueSafeguards: { ...content.viewerValueSafeguards, inheritedState: constraints.viewerValueState, escalationRequired },
    experimentReady: deriveExperimentReady(experiment, constraints.viewerValueState),
    portfolioEligible: EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE[experimentType],
  };
}

export class ChannelVideoExperimentExecutor implements WorkflowStepExecutor {
  constructor(
    private readonly injectedResolver?: ApprovedDecisionResolver,
    private readonly injectedModel?: VideoExperimentModel,
    private readonly injectedUsageMeter?: ResearchUsageMeter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private dependencies(step: ClaimedWorkflowStep) {
    const budget = channelVideoExperimentConfig();
    const resolver = this.injectedResolver ?? new SupabaseApprovedDecisionResolver();
    const usageMeter = this.injectedUsageMeter ?? new SupabaseResearchUsageMeter(step, budget);
    let model = this.injectedModel;
    if (!model) {
      const router = new EnvironmentRoleRouter("VIDEO_EXPERIMENT");
      assertDistinctRoleProviders(router, "GENERATOR", "CRITIC");
      model = new RoutedVideoExperimentModel(router, budget, usageMeter);
    }
    return { budget, resolver, model };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    console.info("video_experiment_stage", { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_VIDEO_EXPERIMENT") throw new VideoExperimentExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Video-experiment executor received a different workflow type.");
    const input = videoExperimentInputSchema.parse(step.input);

    if (step.stepKey === "validate-approved-decision") {
      const resolver = this.injectedResolver ?? new SupabaseApprovedDecisionResolver();
      const artifact = approvedVideoDecisionArtifactSchema.parse(await resolver.resolve(input.videoDecisionWorkflowId, input.videoDecisionRunId, input.approvedVideoDecisionReference));
      this.log(step, { decisionRunId: artifact.reference.decisionRunId, diagnosisRunId: artifact.reference.upstreamVideoDiagnosis.diagnosisRunId, decisionType: artifact.reference.decisionType, artifactHash: artifact.reference.decisionArtifactHash, lineageEntries: artifact.experimentScope.entries.length });
      return artifact;
    }

    const artifact = requirePrior(step, "validate-approved-decision", (value) => approvedVideoDecisionArtifactSchema.parse(value));
    if (step.stepKey === "derive-experiment-constraints") {
      const constraints = deriveVideoExperimentConstraints(artifact);
      this.log(step, { decisionType: constraints.decisionType, category: constraints.decisionCategory, permittedExperimentTypes: constraints.permittedExperimentTypes, viewerValueState: constraints.viewerValueState, evidenceStrength: constraints.evidenceStrength });
      return constraints;
    }

    const constraints = requirePrior(step, "derive-experiment-constraints", (value) => videoExperimentConstraintsSchema.parse(value));
    const { budget, model } = this.dependencies(step);
    if (step.stepKey === "draft-video-experiment") {
      const call = await model.analyze(artifact, constraints, input.humanRevisionNote);
      const content = stampServerDerivedFields(call.value, constraints);
      const output = videoExperimentDraftSchema.parse({ content, modelUsage: call.usage, analyst: call.attribution });
      this.log(step, { role: "ANALYST", provider: call.attribution.provider, model: call.attribution.model, experimentType: content.experiment.experimentType, category: content.experiment.category, totalTokens: call.usage.totalTokens });
      return output;
    }

    const draft = requirePrior(step, "draft-video-experiment", (value) => videoExperimentDraftSchema.parse(value));
    if (step.stepKey === "critique-video-experiment") {
      const call = await model.critique(artifact, constraints, draft.content);
      const output = videoExperimentCritiqueStepSchema.parse({ critique: call.value, modelUsage: call.usage, critic: call.attribution });
      this.log(step, { role: "CRITIC", provider: call.attribution.provider, model: call.attribution.model, safeToFinalize: call.value.safeToFinalize, findings: call.value.findings.length, totalTokens: call.usage.totalTokens });
      return output;
    }

    const critique = requirePrior(step, "critique-video-experiment", (value) => videoExperimentCritiqueStepSchema.parse(value));
    if (step.stepKey === "final-video-experiment-qa") {
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
      const decision = artifact.decisionResult;
      const diagnosis = artifact.reference.upstreamVideoDiagnosis;
      const performance = diagnosis.upstreamVideoPerformance;
      const result = channelVideoExperimentResultSchema.parse({
        schemaVersion: 1,
        workflowType: "CHANNEL_VIDEO_EXPERIMENT",
        designedAt: this.now().toISOString(),
        source: {
          decisionWorkflowId: artifact.reference.decisionWorkflowId,
          decisionRunId: artifact.reference.decisionRunId,
          diagnosisWorkflowId: diagnosis.diagnosisWorkflowId,
          diagnosisRunId: diagnosis.diagnosisRunId,
          performanceWorkflowId: performance.performanceWorkflowId,
          performanceRunId: performance.performanceRunId,
          releaseWorkflowId: performance.upstreamVideoRelease.releaseWorkflowId,
          releaseRunId: performance.upstreamVideoRelease.releaseRunId,
          topicId: decision.source.topicId,
          pillarId: decision.source.pillarId,
          finalTitle: decision.source.finalTitle,
          subjectIdentity: `decision:${artifact.reference.decisionRunId}`,
        },
        approvedVideoDecisionReference: artifact.reference,
        experimentScope: artifact.experimentScope,
        experimentConstraints: constraints,
        content: draft.content,
        viewerValueProvenance: decision.viewerValueProvenance,
        crossModelReview,
        modelProvenance: [draft.analyst, critique.critic],
      });
      const qa = videoExperimentQA(deterministicVideoExperimentValidation(result, artifact, constraints, budget.maxResultPayloadBytes));
      this.log(step, { deterministicOnly: true, passed: qa.passed, score: qa.score, errors: qa.findings.filter((item) => item.severity === "error").map((item) => item.code) });
      return videoExperimentQAStepSchema.parse({ qa, crossModelReview, result });
    }

    if (step.stepKey === "finalize-video-experiment") {
      const qaStep = requirePrior(step, "final-video-experiment-qa", (value) => videoExperimentQAStepSchema.parse(value));
      if (!qaStep.qa.passed || qaStep.qa.recommendation === "revise") throw new VideoExperimentExecutionError("VIDEO_EXPERIMENT_QA_REJECTED", false, "Deterministic final QA rejected the experiment design; no automated revision or partial final artifact is allowed.");
      const result = channelVideoExperimentResultSchema.parse(qaStep.result) satisfies ChannelVideoExperimentResult;
      this.log(step, { humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: qaStep.qa.score, experimentType: result.content.experiment.experimentType, experimentReady: result.content.experimentReady, portfolioEligible: result.content.portfolioEligible, providers: result.modelProvenance.map((item) => item.provider) });
      return result;
    }

    throw new VideoExperimentExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported video-experiment step ${step.stepKey}.`);
  }
}
