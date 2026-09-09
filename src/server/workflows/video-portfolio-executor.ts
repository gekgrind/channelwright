import {
  approvedVideoExperimentSetSchema,
  channelVideoPortfolioResultSchema,
  videoPortfolioConstraintsSchema,
  videoPortfolioCritiqueStepSchema,
  videoPortfolioDraftSchema,
  videoPortfolioInputSchema,
  videoPortfolioQAStepSchema,
  type ChannelVideoPortfolioResult,
  type ClaimedWorkflowStep,
  type VideoPortfolioConstraints,
  type VideoPortfolioContent,
} from "@/domain/production-workflows";
import { assertDistinctRoleProviders, EnvironmentRoleRouter } from "@/server/ai/role-router";
import { SupabaseApprovedExperimentResolver, type ApprovedExperimentResolver } from "./approved-experiment-resolver";
import type { WorkflowStepExecutor } from "./concept-validation-executor";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import { channelVideoPortfolioConfig, WORKFLOW_STEP_OUTPUT_CEILING_BYTES } from "./video-portfolio-config";
import {
  committedItems,
  deriveCapacityUtilization,
  derivePortfolioReady,
  derivePortfolioRequiresHumanJudgment,
  deriveVideoPortfolioConstraints,
} from "./video-portfolio-candidates";
import { RoutedVideoPortfolioModel, type VideoPortfolioModel } from "./video-portfolio-model";
import { deterministicVideoPortfolioValidation, videoPortfolioQA, videoPortfolioQaStepEnvelopeBytes } from "./video-portfolio-validation";

export class VideoPortfolioExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

function requirePrior<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T): T {
  const value = step.priorOutputs[key];
  if (!value) throw new VideoPortfolioExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${key} is missing.`);
  return parse(value);
}

/**
 * Recomputes every field the server derives from the candidate projections and
 * the operator's declared capacity rather than trusting the model's own copy of
 * them -- the cycle label, the disposition counts, capacity utilisation,
 * escalation, the committed at-risk set, and readiness. Mirrors the Experiment
 * executor's `stampServerDerivedFields`: the model can still get these wrong, but
 * the durable artifact never does.
 *
 * `requiresHumanJudgment` is stamped BEFORE `portfolioReady` is derived, because
 * readiness depends on the slate having actually escalated when it must.
 */
function stampServerDerivedFields(content: VideoPortfolioContent, constraints: VideoPortfolioConstraints): VideoPortfolioContent {
  const items = content.allocation.items;
  const withCounts = {
    ...content.allocation,
    cycleLabel: constraints.cycleLabel,
    committedCount: items.filter((item) => item.disposition === "COMMITTED").length,
    deferredCount: items.filter((item) => item.disposition === "DEFERRED").length,
    excludedCount: items.filter((item) => item.disposition === "EXCLUDED").length,
  };
  const allocation = {
    ...withCounts,
    capacityUtilization: deriveCapacityUtilization(withCounts, constraints),
    requiresHumanJudgment: derivePortfolioRequiresHumanJudgment(withCounts, constraints),
  };
  const committed = new Set(committedItems(allocation).map((item) => item.candidateId));
  return {
    ...content,
    allocation,
    viewerValueSafeguards: {
      ...content.viewerValueSafeguards,
      anyCandidateAtRisk: constraints.atRiskCandidateIds.length > 0,
      committedAtRiskCandidateIds: constraints.atRiskCandidateIds.filter((id) => committed.has(id)),
      escalationRequired: constraints.viewerValueEscalationRequired,
    },
    portfolioReady: derivePortfolioReady(allocation, constraints),
  };
}

export class ChannelVideoPortfolioExecutor implements WorkflowStepExecutor {
  constructor(
    private readonly injectedResolver?: ApprovedExperimentResolver,
    private readonly injectedModel?: VideoPortfolioModel,
    private readonly injectedUsageMeter?: ResearchUsageMeter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private dependencies(step: ClaimedWorkflowStep) {
    const budget = channelVideoPortfolioConfig();
    const usageMeter = this.injectedUsageMeter ?? new SupabaseResearchUsageMeter(step, budget);
    let model = this.injectedModel;
    if (!model) {
      const router = new EnvironmentRoleRouter("VIDEO_PORTFOLIO");
      assertDistinctRoleProviders(router, "GENERATOR", "CRITIC");
      model = new RoutedVideoPortfolioModel(router, budget, usageMeter);
    }
    return { budget, model };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    console.info("video_portfolio_stage", { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_VIDEO_PORTFOLIO") throw new VideoPortfolioExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Video-portfolio executor received a different workflow type.");
    const input = videoPortfolioInputSchema.parse(step.input);

    if (step.stepKey === "validate-approved-experiments") {
      const resolver = this.injectedResolver ?? new SupabaseApprovedExperimentResolver();
      const set = approvedVideoExperimentSetSchema.parse(await resolver.resolve(input.experimentSelections, input.approvedVideoExperimentReferences));
      this.log(step, { candidateCount: set.artifacts.length, experimentRunIds: set.artifacts.map((artifact) => artifact.candidate.experimentRunId), cycleLabel: input.cycleLabel });
      return set;
    }

    const set = requirePrior(step, "validate-approved-experiments", (value) => approvedVideoExperimentSetSchema.parse(value));
    if (step.stepKey === "derive-portfolio-constraints") {
      const constraints = deriveVideoPortfolioConstraints(set, input.cycleLabel, input.concurrentExperimentSlots);
      this.log(step, { slots: constraints.concurrentExperimentSlots, candidates: constraints.candidates.length, atRisk: constraints.atRiskCandidateIds.length, notReady: constraints.notReadyCandidateIds.length, collisionGroups: constraints.confoundCollisionGroups.length, globalConfidenceCeiling: constraints.globalConfidenceCeiling });
      return constraints;
    }

    const constraints = requirePrior(step, "derive-portfolio-constraints", (value) => videoPortfolioConstraintsSchema.parse(value));
    const { budget, model } = this.dependencies(step);
    if (step.stepKey === "draft-video-portfolio") {
      const call = await model.analyze(constraints, input.humanRevisionNote);
      const content = stampServerDerivedFields(call.value, constraints);
      const output = videoPortfolioDraftSchema.parse({ content, modelUsage: call.usage, analyst: call.attribution });
      this.log(step, { role: "ALLOCATOR", provider: call.attribution.provider, model: call.attribution.model, committed: content.allocation.committedCount, deferred: content.allocation.deferredCount, excluded: content.allocation.excludedCount, totalTokens: call.usage.totalTokens });
      return output;
    }

    const draft = requirePrior(step, "draft-video-portfolio", (value) => videoPortfolioDraftSchema.parse(value));
    if (step.stepKey === "critique-video-portfolio") {
      const call = await model.critique(constraints, draft.content);
      const output = videoPortfolioCritiqueStepSchema.parse({ critique: call.value, modelUsage: call.usage, critic: call.attribution });
      this.log(step, { role: "CRITIC", provider: call.attribution.provider, model: call.attribution.model, safeToFinalize: call.value.safeToFinalize, findings: call.value.findings.length, totalTokens: call.usage.totalTokens });
      return output;
    }

    const critique = requirePrior(step, "critique-video-portfolio", (value) => videoPortfolioCritiqueStepSchema.parse(value));
    if (step.stepKey === "final-video-portfolio-qa") {
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
      const result = channelVideoPortfolioResultSchema.parse({
        schemaVersion: 1,
        workflowType: "CHANNEL_VIDEO_PORTFOLIO",
        allocatedAt: this.now().toISOString(),
        source: {
          cycleLabel: constraints.cycleLabel,
          candidateCount: constraints.candidates.length,
          experimentRunIds: constraints.candidates.map((candidate) => candidate.experimentRunId),
          subjectIdentity: `portfolio-cycle:${constraints.cycleLabel}`,
        },
        approvedVideoExperimentReferences: set.artifacts.map((artifact) => artifact.reference),
        portfolioScope: set.portfolioScope,
        portfolioConstraints: constraints,
        content: draft.content,
        crossModelReview,
        modelProvenance: [draft.analyst, critique.critic],
      });
      const qa = videoPortfolioQA(deterministicVideoPortfolioValidation(result, set, constraints, budget.maxResultPayloadBytes));
      const stepOutput = videoPortfolioQAStepSchema.parse({ qa, crossModelReview, result });
      // The nested `result` already passed `maxResultPayloadBytes`, but the object
      // actually persisted by `complete_workflow_step` is this whole envelope --
      // `qa` plus a second serialization of `crossModelReview` on top of `result`.
      // Measure that exact object against the database's hard step-output ceiling
      // and fail with a deterministic typed error BEFORE the persistence attempt,
      // rather than letting a schema-valid allocation die as an opaque
      // PAYLOAD_TOO_LARGE after QA has already accepted it.
      const envelopeBytes = videoPortfolioQaStepEnvelopeBytes(stepOutput);
      if (envelopeBytes > WORKFLOW_STEP_OUTPUT_CEILING_BYTES) {
        throw new VideoPortfolioExecutionError("VIDEO_PORTFOLIO_STEP_OUTPUT_TOO_LARGE", false, `The final-QA step output serializes to ${envelopeBytes} bytes, above the ${WORKFLOW_STEP_OUTPUT_CEILING_BYTES}-byte workflow-step ceiling; the accepted allocation and its independent critic review do not fit one persisted step envelope.`);
      }
      this.log(step, { deterministicOnly: true, passed: qa.passed, score: qa.score, envelopeBytes, errors: qa.findings.filter((item) => item.severity === "error").map((item) => item.code) });
      return stepOutput;
    }

    if (step.stepKey === "finalize-video-portfolio") {
      const qaStep = requirePrior(step, "final-video-portfolio-qa", (value) => videoPortfolioQAStepSchema.parse(value));
      if (!qaStep.qa.passed || qaStep.qa.recommendation === "revise") throw new VideoPortfolioExecutionError("VIDEO_PORTFOLIO_QA_REJECTED", false, "Deterministic final QA rejected the allocation; no automated revision or partial final artifact is allowed.");
      const result = channelVideoPortfolioResultSchema.parse(qaStep.result) satisfies ChannelVideoPortfolioResult;
      this.log(step, { humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: qaStep.qa.score, committed: result.content.allocation.committedCount, capacityUtilization: result.content.allocation.capacityUtilization, portfolioReady: result.content.portfolioReady, requiresHumanJudgment: result.content.allocation.requiresHumanJudgment, providers: result.modelProvenance.map((item) => item.provider) });
      return result;
    }

    throw new VideoPortfolioExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported video-portfolio step ${step.stepKey}.`);
  }
}
