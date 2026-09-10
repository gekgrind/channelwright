import {
  approvedVideoPortfolioSetSchema,
  channelVideoIntelligenceResultSchema,
  videoIntelligenceConstraintsSchema,
  videoIntelligenceCritiqueStepSchema,
  videoIntelligenceDraftSchema,
  videoIntelligenceInputSchema,
  videoIntelligenceQAStepSchema,
  type ChannelVideoIntelligenceResult,
  type ClaimedWorkflowStep,
  type VideoIntelligenceConstraints,
  type VideoIntelligenceContent,
} from "@/domain/production-workflows";
import { assertDistinctRoleProviders, EnvironmentRoleRouter } from "@/server/ai/role-router";
import { SupabaseApprovedPortfolioResolver, type ApprovedPortfolioResolver } from "./approved-portfolio-resolver";
import type { WorkflowStepExecutor } from "./concept-validation-executor";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import { channelVideoIntelligenceConfig, WORKFLOW_STEP_OUTPUT_CEILING_BYTES } from "./video-intelligence-config";
import {
  cyclesWithCommittedAtRisk,
  deriveIntelligenceReady,
  deriveIntelligenceRequiresHumanJudgment,
  deriveVideoIntelligenceConstraints,
} from "./video-intelligence-cycles";
import { RoutedVideoIntelligenceModel, type VideoIntelligenceModel } from "./video-intelligence-model";
import { deterministicVideoIntelligenceValidation, videoIntelligenceQA, videoIntelligenceQaStepEnvelopeBytes } from "./video-intelligence-validation";

export class VideoIntelligenceExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

function requirePrior<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T): T {
  const value = step.priorOutputs[key];
  if (!value) throw new VideoIntelligenceExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${key} is missing.`);
  return parse(value);
}

/**
 * Recomputes every field the server derives from the cycle projections and the
 * operator's declared horizon rather than trusting the model's own copy of them --
 * the horizon label, the learning and cycle counts, the Viewer Value trajectory,
 * the at-risk cycle set, escalation, and readiness. Mirrors the Portfolio
 * executor's `stampServerDerivedFields`: the model can still get these wrong, but
 * the durable artifact never does.
 *
 * `requiresHumanJudgment` is stamped BEFORE `intelligenceReady` is derived,
 * because readiness depends on the record having actually escalated when it must.
 */
function stampServerDerivedFields(content: VideoIntelligenceContent, constraints: VideoIntelligenceConstraints): VideoIntelligenceContent {
  const withCounts = {
    ...content.record,
    horizonLabel: constraints.horizonLabel,
    learningCount: content.record.learnings.length,
    cyclesConsidered: constraints.cycles.length,
    viewerValueTrend: constraints.viewerValueTrend,
  };
  const record = {
    ...withCounts,
    requiresHumanJudgment: deriveIntelligenceRequiresHumanJudgment(withCounts, constraints),
  };
  return {
    ...content,
    record,
    viewerValueSafeguards: {
      ...content.viewerValueSafeguards,
      trend: constraints.viewerValueTrend,
      cyclesWithCommittedAtRiskIds: cyclesWithCommittedAtRisk(constraints.cycles),
      escalationRequired: constraints.escalationRequired,
    },
    intelligenceReady: deriveIntelligenceReady(record, constraints),
  };
}

export class ChannelVideoIntelligenceExecutor implements WorkflowStepExecutor {
  constructor(
    private readonly injectedResolver?: ApprovedPortfolioResolver,
    private readonly injectedModel?: VideoIntelligenceModel,
    private readonly injectedUsageMeter?: ResearchUsageMeter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private dependencies(step: ClaimedWorkflowStep) {
    const budget = channelVideoIntelligenceConfig();
    const usageMeter = this.injectedUsageMeter ?? new SupabaseResearchUsageMeter(step, budget);
    let model = this.injectedModel;
    if (!model) {
      const router = new EnvironmentRoleRouter("VIDEO_INTELLIGENCE");
      assertDistinctRoleProviders(router, "GENERATOR", "CRITIC");
      model = new RoutedVideoIntelligenceModel(router, budget, usageMeter);
    }
    return { budget, model };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    console.info("video_intelligence_stage", { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_VIDEO_INTELLIGENCE") throw new VideoIntelligenceExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Video-intelligence executor received a different workflow type.");
    const input = videoIntelligenceInputSchema.parse(step.input);

    if (step.stepKey === "validate-approved-portfolios") {
      const resolver = this.injectedResolver ?? new SupabaseApprovedPortfolioResolver();
      const set = approvedVideoPortfolioSetSchema.parse(await resolver.resolve(input.portfolioSelections, input.approvedVideoPortfolioReferences));
      this.log(step, { cycleCount: set.artifacts.length, portfolioRunIds: set.artifacts.map((artifact) => artifact.cycle.portfolioRunId), horizonLabel: input.horizonLabel, anchoredStrategyRunId: set.artifacts[0].reference.strategyAnchor.strategyRunId });
      return set;
    }

    const set = requirePrior(step, "validate-approved-portfolios", (value) => approvedVideoPortfolioSetSchema.parse(value));
    if (step.stepKey === "derive-intelligence-constraints") {
      const constraints = deriveVideoIntelligenceConstraints(set, input.horizonLabel);
      this.log(step, { cycles: constraints.cycles.length, totalCommitted: constraints.totalCommittedExperiments, viewerValueTrend: constraints.viewerValueTrend, atRiskCycles: constraints.cyclesWithCommittedAtRiskIds.length, evidenceCeiling: constraints.evidenceCeiling, escalationRequired: constraints.escalationRequired });
      return constraints;
    }

    const constraints = requirePrior(step, "derive-intelligence-constraints", (value) => videoIntelligenceConstraintsSchema.parse(value));
    const { budget, model } = this.dependencies(step);
    if (step.stepKey === "draft-video-intelligence") {
      const call = await model.analyze(constraints, input.humanRevisionNote);
      const content = stampServerDerivedFields(call.value, constraints);
      const output = videoIntelligenceDraftSchema.parse({ content, modelUsage: call.usage, analyst: call.attribution });
      this.log(step, { role: "ANALYST", provider: call.attribution.provider, model: call.attribution.model, learnings: content.record.learningCount, signal: content.record.strategyReviewSignal.signal, totalTokens: call.usage.totalTokens });
      return output;
    }

    const draft = requirePrior(step, "draft-video-intelligence", (value) => videoIntelligenceDraftSchema.parse(value));
    if (step.stepKey === "critique-video-intelligence") {
      const call = await model.critique(constraints, draft.content);
      const output = videoIntelligenceCritiqueStepSchema.parse({ critique: call.value, modelUsage: call.usage, critic: call.attribution });
      this.log(step, { role: "CRITIC", provider: call.attribution.provider, model: call.attribution.model, safeToFinalize: call.value.safeToFinalize, findings: call.value.findings.length, totalTokens: call.usage.totalTokens });
      return output;
    }

    const critique = requirePrior(step, "critique-video-intelligence", (value) => videoIntelligenceCritiqueStepSchema.parse(value));
    if (step.stepKey === "final-video-intelligence-qa") {
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
      const result = channelVideoIntelligenceResultSchema.parse({
        schemaVersion: 1,
        workflowType: "CHANNEL_VIDEO_INTELLIGENCE",
        synthesizedAt: this.now().toISOString(),
        source: {
          horizonLabel: constraints.horizonLabel,
          cycleCount: constraints.cycles.length,
          portfolioRunIds: constraints.cycles.map((cycle) => cycle.portfolioRunId),
          anchoredStrategyRunId: constraints.anchoredStrategyRunId,
          subjectIdentity: `channel-strategy:${constraints.anchoredStrategyRunId}`,
        },
        approvedVideoPortfolioReferences: set.artifacts.map((artifact) => artifact.reference),
        intelligenceScope: set.intelligenceScope,
        intelligenceConstraints: constraints,
        content: draft.content,
        crossModelReview,
        modelProvenance: [draft.analyst, critique.critic],
      });
      const qa = videoIntelligenceQA(deterministicVideoIntelligenceValidation(result, set, constraints, budget.maxResultPayloadBytes));
      const stepOutput = videoIntelligenceQAStepSchema.parse({ qa, crossModelReview, result });
      // The nested `result` already passed `maxResultPayloadBytes`, but the object
      // actually persisted by `complete_workflow_step` is this whole envelope --
      // `qa` plus a second serialization of `crossModelReview` on top of `result`.
      // Measure that exact object against the database's hard step-output ceiling
      // and fail with a deterministic typed error BEFORE the persistence attempt,
      // rather than letting a schema-valid record die as an opaque
      // PAYLOAD_TOO_LARGE after QA has already accepted it.
      const envelopeBytes = videoIntelligenceQaStepEnvelopeBytes(stepOutput);
      if (envelopeBytes > WORKFLOW_STEP_OUTPUT_CEILING_BYTES) {
        throw new VideoIntelligenceExecutionError("VIDEO_INTELLIGENCE_STEP_OUTPUT_TOO_LARGE", false, `The final-QA step output serializes to ${envelopeBytes} bytes, above the ${WORKFLOW_STEP_OUTPUT_CEILING_BYTES}-byte workflow-step ceiling; the accepted channel learning record and its independent critic review do not fit one persisted step envelope.`);
      }
      this.log(step, { deterministicOnly: true, passed: qa.passed, score: qa.score, envelopeBytes, errors: qa.findings.filter((item) => item.severity === "error").map((item) => item.code) });
      return stepOutput;
    }

    if (step.stepKey === "finalize-video-intelligence") {
      const qaStep = requirePrior(step, "final-video-intelligence-qa", (value) => videoIntelligenceQAStepSchema.parse(value));
      if (!qaStep.qa.passed || qaStep.qa.recommendation === "revise") throw new VideoIntelligenceExecutionError("VIDEO_INTELLIGENCE_QA_REJECTED", false, "Deterministic final QA rejected the channel learning record; no automated revision or partial final artifact is allowed.");
      const result = channelVideoIntelligenceResultSchema.parse(qaStep.result) satisfies ChannelVideoIntelligenceResult;
      this.log(step, { humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: qaStep.qa.score, learnings: result.content.record.learningCount, signal: result.content.record.strategyReviewSignal.signal, viewerValueTrend: result.content.record.viewerValueTrend, intelligenceReady: result.content.intelligenceReady, requiresHumanJudgment: result.content.record.requiresHumanJudgment, providers: result.modelProvenance.map((item) => item.provider) });
      return result;
    }

    throw new VideoIntelligenceExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported video-intelligence step ${step.stepKey}.`);
  }
}
