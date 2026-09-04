import {
  approvedVideoReleaseArtifactSchema,
  channelVideoPerformanceResultSchema,
  videoPerformanceDraftSchema,
  videoPerformanceInputSchema,
  videoPerformanceQAStepSchema,
  videoPerformanceRevisionSchema,
  type ChannelVideoPerformanceResult,
  type ClaimedWorkflowStep,
  type CrossModelDisposition,
  type CrossModelReview,
} from "@/domain/production-workflows";
import { assertDistinctRoleProviders, EnvironmentRoleRouter } from "@/server/ai/role-router";
import { SupabaseApprovedReleaseResolver, type ApprovedReleaseResolver } from "./approved-release-resolver";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import { channelVideoPerformanceConfig } from "./video-performance-config";
import { RoutedVideoPerformanceModel, type VideoPerformanceModel } from "./video-performance-model";
import {
  deterministicVideoPerformanceValidation,
  hasUnrevisableVideoPerformanceFailure,
  mergeVideoPerformanceQA,
  newlyIntroducedVideoPerformanceErrors,
} from "./video-performance-validation";
import type { WorkflowStepExecutor } from "./concept-validation-executor";

export class VideoPerformanceExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

function requirePrior<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T): T {
  const value = step.priorOutputs[key];
  if (!value) throw new VideoPerformanceExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${key} is missing.`);
  return parse(value);
}

/** Projects independent-critic findings onto the QA finding shape for the merge. */
function criticToQaFindings(criticFindings: Array<{ severity: "error" | "warning" | "info"; code: string; affectedField: string; rationale: string; evidenceIds: string[] }>) {
  return criticFindings.map((finding) => ({ severity: finding.severity, code: finding.code, message: `${finding.affectedField}: ${finding.rationale}`, evidenceIds: finding.evidenceIds }));
}

/**
 * The critic's top-level verdict booleans are approval authority, not just a log
 * line: a critic can declare the conclusions unsupported or a benchmark
 * fabricated without itemizing a matching error finding. Each false verdict
 * becomes a deterministic error finding so the merged QA can never pass over the
 * independent critic's explicit rejection.
 */
function criticVerdictFindings(critique: { conclusionsFollowFromData: boolean; noFabricatedBenchmarksOrPredictions: boolean }): Array<{ severity: "error"; code: string; affectedField: string; rationale: string; evidenceIds: string[] }> {
  const findings: Array<{ severity: "error"; code: string; affectedField: string; rationale: string; evidenceIds: string[] }> = [];
  if (!critique.conclusionsFollowFromData) findings.push({ severity: "error", code: "CRITIC_CONCLUSIONS_UNSUPPORTED", affectedField: "kpiHypothesisOutcomes", rationale: "The independent critic determined the record's conclusions do not follow from the operator's numbers.", evidenceIds: [] });
  if (!critique.noFabricatedBenchmarksOrPredictions) findings.push({ severity: "error", code: "CRITIC_FABRICATED_INPUT", affectedField: "performanceSummary", rationale: "The independent critic determined the record cites a fabricated benchmark or a forward-looking performance prediction.", evidenceIds: [] });
  return findings;
}

export class ChannelVideoPerformanceExecutor implements WorkflowStepExecutor {
  constructor(
    private readonly injectedResolver?: ApprovedReleaseResolver,
    private readonly injectedModel?: VideoPerformanceModel,
    private readonly injectedUsageMeter?: ResearchUsageMeter,
  ) {}

  private dependencies(step: ClaimedWorkflowStep) {
    const budget = channelVideoPerformanceConfig();
    const usageMeter = this.injectedUsageMeter ?? new SupabaseResearchUsageMeter(step, budget);
    const resolver = this.injectedResolver ?? new SupabaseApprovedReleaseResolver();
    // Provider credentials are resolved lazily per role by the router, so a
    // misconfigured role fails loudly instead of routing elsewhere. This stage
    // performs no external evidence retrieval, so it needs no YouTube key.
    let model = this.injectedModel;
    if (!model) {
      const router = new EnvironmentRoleRouter("VIDEO_PERFORMANCE");
      // Fail closed before any spend if the record author and the independent
      // critic would resolve to the same provider. The GENERATOR authors the
      // initial draft and the REVISION authors the accepted final record, so BOTH
      // must differ from the CRITIC.
      assertDistinctRoleProviders(router, "GENERATOR", "CRITIC");
      assertDistinctRoleProviders(router, "REVISION", "CRITIC");
      model = new RoutedVideoPerformanceModel(router, budget, usageMeter);
    }
    return { resolver, model, usageMeter, budget };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    console.info("video_performance_stage", { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_VIDEO_PERFORMANCE") throw new VideoPerformanceExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Video-performance executor received a different workflow type.");
    const input = videoPerformanceInputSchema.parse(step.input);
    const { resolver, model, usageMeter, budget } = this.dependencies(step);
    await usageMeter.ensure();

    // The first worker step independently re-resolves the authoritative upstream
    // approved release. Nothing the browser submitted is trusted except the
    // operator's own performance snapshot, which is re-stamped verbatim below.
    if (step.stepKey === "validate-approved-release") {
      const output = approvedVideoReleaseArtifactSchema.parse(
        await resolver.resolve(input.videoReleaseWorkflowId, input.videoReleaseRunId, input.approvedVideoReleaseReference),
      );
      this.log(step, {
        upstreamReleaseRunId: output.reference.releaseRunId,
        upstreamPackagingRunId: output.reference.upstreamVideoPackaging.packagingRunId,
        releaseArtifactHash: output.reference.releaseArtifactHash,
        topicId: output.scope.releaseTopicId,
        boundHypotheses: output.scope.kpiBindings.length,
        inheritedViewerValueGate: output.scope.inheritedViewerValueProvenance.gate,
      });
      return output;
    }
    const upstream = requirePrior(step, "validate-approved-release", (value) => approvedVideoReleaseArtifactSchema.parse(value));

    if (step.stepKey === "draft-video-performance") {
      const call = await model.draftRecord(input, upstream);
      const result = channelVideoPerformanceResultSchema.parse({
        ...call.value,
        // The operator snapshot, identity, provenance, and the inherited
        // viewer-value contract are stamped by Channelwright, never accepted from
        // model output.
        measuredSnapshot: input.performanceSnapshot,
        upstreamVideoRelease: upstream.reference,
        performanceScope: upstream.scope,
        crossModelReview: null,
        modelProvenance: [call.attribution],
      });
      const output = videoPerformanceDraftSchema.parse({ result, modelUsage: call.usage });
      this.log(step, {
        role: "GENERATOR", provider: call.attribution.provider, model: call.attribution.model,
        outcomes: result.kpiHypothesisOutcomes.length, coverage: result.snapshotIntegrity.coverage,
        strategySignal: result.strategyRevisitSignal.recommendation, totalTokens: call.usage.totalTokens,
      });
      return output;
    }
    const draft = requirePrior(step, "draft-video-performance", (value) => videoPerformanceDraftSchema.parse(value));

    if (step.stepKey === "initial-video-performance-qa") {
      const deterministic = deterministicVideoPerformanceValidation(draft.result, upstream, input.performanceSnapshot, budget.maxResultPayloadBytes);
      const critique = await model.critique(input, upstream, draft.result);
      const semantic = await model.qa(input, upstream, draft.result, deterministic);
      const known = new Set(upstream.discoveryBundle.evidence.map((item) => item.id));
      const criticFindings = [...criticVerdictFindings(critique.value), ...critique.value.findings].map((finding) => ({
        ...finding,
        evidenceIds: finding.evidenceIds.filter((id) => known.has(id)),
        disposition: "CRITIC_RAISED_ISSUE" as CrossModelDisposition,
      }));
      const merged = mergeVideoPerformanceQA(deterministic, semantic.value, semantic.usage, upstream, criticToQaFindings(criticFindings));
      const generator = draft.result.modelProvenance.find((item) => item.operation === "video_performance_synthesis")
        ?? draft.result.modelProvenance[draft.result.modelProvenance.length - 1];
      const review: CrossModelReview = {
        generator: generator ?? critique.attribution,
        critic: critique.attribution,
        outcome: deterministic.some((finding) => finding.severity === "error") && criticFindings.length === 0
          ? "OVERRIDDEN_BY_DETERMINISTIC_RULE"
          : criticFindings.length === 0 ? "AGREED" : "CRITIC_RAISED_ISSUE",
        findings: criticFindings.slice(0, 12),
        summary: critique.value.overallAssessment,
      };
      this.log(step, {
        criticProvider: critique.attribution.provider, criticModel: critique.attribution.model,
        qaProvider: semantic.attribution.provider, qaModel: semantic.attribution.model,
        criticFindingCount: criticFindings.length, conclusionsFollowFromData: critique.value.conclusionsFollowFromData, noFabricatedBenchmarksOrPredictions: critique.value.noFabricatedBenchmarksOrPredictions,
        deterministicErrors: deterministic.filter((finding) => finding.severity === "error").length,
        qaOutcome: merged.recommendation, qaScore: merged.score, unrevisable: hasUnrevisableVideoPerformanceFailure(deterministic),
      });
      return videoPerformanceQAStepSchema.parse({ qa: merged, crossModelReview: review });
    }
    const initial = requirePrior(step, "initial-video-performance-qa", (value) => videoPerformanceQAStepSchema.parse(value));

    if (step.stepKey === "bounded-video-performance-revision") {
      // A corrupted provenance, an altered snapshot, an overstated verdict, or a
      // fabricated input is not cosmetically fixable; it fails closed here rather
      // than being rewritten into apparent compliance.
      if (hasUnrevisableVideoPerformanceFailure(initial.qa.findings)) {
        throw new VideoPerformanceExecutionError("VIDEO_PERFORMANCE_INTEGRITY_UNREVISABLE", false, "A blocking viewer-value, provenance, snapshot-integrity, adjudication, or fabrication failure cannot be resolved by automated revision.");
      }
      const material = !initial.qa.passed
        || initial.qa.findings.some((finding) => finding.severity === "error")
        || initial.qa.recommendation === "revise";
      if (!material) {
        return videoPerformanceRevisionSchema.parse({
          attempted: false,
          reason: "Initial video performance QA and the independent critic found no material issue requiring automated revision.",
          result: { ...draft.result, crossModelReview: { ...initial.crossModelReview, outcome: initial.crossModelReview.findings.length ? "CRITIC_RAISED_ISSUE" : "AGREED" } },
          modelUsage: { model: "none", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        });
      }
      const reservation = await usageMeter.reserve({ key: "video-performance:automated-revision", kind: "AUTOMATED_REVISION", reservation: { automatedRevisions: 1 } });
      let revised: Awaited<ReturnType<VideoPerformanceModel["reviseRecord"]>>;
      try {
        revised = await model.reviseRecord(input, upstream, draft.result, initial.qa);
        await usageMeter.finalize(reservation, "SUCCEEDED", { automatedRevisions: 1 });
      } catch (error) {
        await usageMeter.finalize(reservation, "FAILED", { automatedRevisions: 1, failedOperations: 1 });
        throw error;
      }
      const provenance = [...draft.result.modelProvenance, revised.attribution].slice(-8);
      const candidate = channelVideoPerformanceResultSchema.parse({
        ...revised.value,
        measuredSnapshot: input.performanceSnapshot,
        upstreamVideoRelease: upstream.reference,
        performanceScope: upstream.scope,
        crossModelReview: { ...initial.crossModelReview, outcome: "REVISED" satisfies CrossModelDisposition, findings: initial.crossModelReview.findings.map((finding) => ({ ...finding, disposition: "REVISED" as CrossModelDisposition })) },
        modelProvenance: provenance,
      });
      const before = deterministicVideoPerformanceValidation(draft.result, upstream, input.performanceSnapshot, budget.maxResultPayloadBytes);
      const after = deterministicVideoPerformanceValidation(candidate, upstream, input.performanceSnapshot, budget.maxResultPayloadBytes);
      const introduced = newlyIntroducedVideoPerformanceErrors(before, after);
      const discarded = introduced.length > 0;
      const output = videoPerformanceRevisionSchema.parse({
        attempted: true,
        reason: discarded
          ? `The bounded video performance revision was discarded because it introduced deterministic errors: ${introduced.map((finding) => finding.code).join(", ")}.`
          : "One bounded automated revision was performed in response to material QA and cross-model findings.",
        result: discarded
          ? { ...draft.result, crossModelReview: { ...initial.crossModelReview, outcome: "OVERRIDDEN_BY_DETERMINISTIC_RULE" satisfies CrossModelDisposition } }
          : candidate,
        modelUsage: revised.usage,
      });
      this.log(step, { role: "REVISION", provider: revised.attribution.provider, model: revised.attribution.model, revisionAccepted: !discarded, introducedErrorCodes: introduced.map((finding) => finding.code), totalTokens: revised.usage.totalTokens });
      return output;
    }
    const revision = requirePrior(step, "bounded-video-performance-revision", (value) => videoPerformanceRevisionSchema.parse(value));

    if (step.stepKey === "final-video-performance-qa") {
      const deterministic = deterministicVideoPerformanceValidation(revision.result, upstream, input.performanceSnapshot, budget.maxResultPayloadBytes);
      // The independent critic reviews the FINAL record after the bounded
      // revision, not only the initial draft, so an overstated verdict or
      // fabricated benchmark introduced during revision still faces cross-model
      // review before it can finalize.
      const critique = await model.critique(input, upstream, revision.result);
      const semantic = await model.qa(input, upstream, revision.result, deterministic);
      const known = new Set(upstream.discoveryBundle.evidence.map((item) => item.id));
      const criticFindings = [...criticVerdictFindings(critique.value), ...critique.value.findings].map((finding) => ({
        ...finding,
        evidenceIds: finding.evidenceIds.filter((id) => known.has(id)),
        disposition: "CRITIC_RAISED_ISSUE" as CrossModelDisposition,
      }));
      const merged = mergeVideoPerformanceQA(deterministic, semantic.value, semantic.usage, upstream, criticToQaFindings(criticFindings));
      const author = revision.result.modelProvenance.find((item) => item.role === "REVISION")
        ?? revision.result.modelProvenance.find((item) => item.operation === "video_performance_synthesis")
        ?? revision.result.modelProvenance[revision.result.modelProvenance.length - 1];
      this.log(step, {
        role: "QA", criticProvider: critique.attribution.provider, provider: semantic.attribution.provider, model: semantic.attribution.model,
        acceptedAuthorRole: author?.role, acceptedAuthorProvider: author?.provider,
        criticFindingCount: criticFindings.length, qaOutcome: merged.recommendation, qaScore: merged.score,
      });
      // The one bounded revision is spent: a clean-but-still-improvable result
      // goes to a human rather than looping.
      const resolved = merged.passed && merged.recommendation === "revise" ? { ...merged, recommendation: "human_review_required" as const } : merged;
      return videoPerformanceQAStepSchema.parse({
        qa: resolved,
        crossModelReview: {
          generator: author ?? critique.attribution,
          critic: critique.attribution,
          outcome: resolved.recommendation === "human_review_required" ? "HUMAN_REVIEW_REQUIRED"
            : deterministic.some((finding) => finding.severity === "error") && criticFindings.length === 0 ? "OVERRIDDEN_BY_DETERMINISTIC_RULE"
              : criticFindings.length === 0 ? "AGREED" : "CRITIC_RAISED_ISSUE",
          findings: criticFindings.slice(0, 12),
          summary: critique.value.overallAssessment,
        },
      });
    }

    if (step.stepKey === "finalize-video-performance") {
      const final = requirePrior(step, "final-video-performance-qa", (value) => videoPerformanceQAStepSchema.parse(value));
      if (!final.qa.passed || final.qa.recommendation === "revise") {
        throw new VideoPerformanceExecutionError("VIDEO_PERFORMANCE_QA_REJECTED", false, "Final QA did not accept the video performance record; nothing was advanced to human review.");
      }
      const output = channelVideoPerformanceResultSchema.parse({
        ...revision.result,
        crossModelReview: final.crossModelReview,
      }) satisfies ChannelVideoPerformanceResult;
      this.log(step, {
        humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: final.qa.score,
        topicId: output.performanceScope.releaseTopicId,
        viewerValueGate: output.viewerValue.gate,
        outcomes: output.kpiHypothesisOutcomes.map((outcome) => `${outcome.binding.metric}:${outcome.verdict}`),
        strategySignal: output.strategyRevisitSignal.recommendation,
        fabricationGuardOutcome: output.measurementIntegrity.fabricationGuardOutcome,
        crossModelOutcome: output.crossModelReview?.outcome,
        providers: [...new Set(output.modelProvenance.map((item) => item.provider))],
      });
      return output;
    }
    throw new VideoPerformanceExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported video-performance step ${step.stepKey}.`);
  }
}
