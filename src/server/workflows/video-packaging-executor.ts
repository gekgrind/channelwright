import {
  approvedVideoScriptArtifactSchema,
  channelVideoPackagingResultSchema,
  videoPackagingDraftSchema,
  videoPackagingInputSchema,
  videoPackagingQAStepSchema,
  videoPackagingRevisionSchema,
  type ChannelVideoPackagingResult,
  type ClaimedWorkflowStep,
  type CrossModelDisposition,
  type CrossModelReview,
} from "@/domain/production-workflows";
import { assertDistinctRoleProviders, EnvironmentRoleRouter } from "@/server/ai/role-router";
import { SupabaseApprovedScriptResolver, type ApprovedScriptResolver } from "./approved-script-resolver";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import { channelVideoPackagingConfig } from "./video-packaging-config";
import { RoutedVideoPackagingModel, type VideoPackagingModel } from "./video-packaging-model";
import {
  deterministicVideoPackagingValidation,
  hasUnrevisableVideoPackagingFailure,
  mergeVideoPackagingQA,
  newlyIntroducedVideoPackagingErrors,
} from "./video-packaging-validation";
import type { WorkflowStepExecutor } from "./concept-validation-executor";

export class VideoPackagingExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

function requirePrior<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T): T {
  const value = step.priorOutputs[key];
  if (!value) throw new VideoPackagingExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${key} is missing.`);
  return parse(value);
}

/** Projects independent-critic findings onto the QA finding shape for the merge. */
function criticToQaFindings(criticFindings: Array<{ severity: "error" | "warning" | "info"; code: string; affectedField: string; rationale: string; evidenceIds: string[] }>) {
  return criticFindings.map((finding) => ({ severity: finding.severity, code: finding.code, message: `${finding.affectedField}: ${finding.rationale}`, evidenceIds: finding.evidenceIds }));
}

/**
 * The critic's top-level verdict booleans are approval authority, not just a log
 * line: a critic can declare the promise broken or evidence discipline failed
 * without itemizing a matching error finding. Each false verdict becomes a
 * deterministic error finding so the merged QA can never pass over the
 * independent critic's explicit rejection.
 */
function criticVerdictFindings(critique: { keepsPromise: boolean; evidenceDisciplineHeld: boolean }): Array<{ severity: "error"; code: string; affectedField: string; rationale: string; evidenceIds: string[] }> {
  const findings: Array<{ severity: "error"; code: string; affectedField: string; rationale: string; evidenceIds: string[] }> = [];
  if (!critique.keepsPromise) findings.push({ severity: "error", code: "CRITIC_PROMISE_BROKEN", affectedField: "packagedPromise", rationale: "The independent critic determined the packaging does not keep the approved script's promise.", evidenceIds: [] });
  if (!critique.evidenceDisciplineHeld) findings.push({ severity: "error", code: "CRITIC_EVIDENCE_DISCIPLINE_FAILED", affectedField: "evidenceDiscipline", rationale: "The independent critic determined the packaging breaks the script's evidence discipline.", evidenceIds: [] });
  return findings;
}

export class ChannelVideoPackagingExecutor implements WorkflowStepExecutor {
  constructor(
    private readonly injectedResolver?: ApprovedScriptResolver,
    private readonly injectedModel?: VideoPackagingModel,
    private readonly injectedUsageMeter?: ResearchUsageMeter,
  ) {}

  private dependencies(step: ClaimedWorkflowStep) {
    const budget = channelVideoPackagingConfig();
    const usageMeter = this.injectedUsageMeter ?? new SupabaseResearchUsageMeter(step, budget);
    const resolver = this.injectedResolver ?? new SupabaseApprovedScriptResolver();
    // Provider credentials are resolved lazily per role by the router, so a
    // misconfigured role fails loudly instead of routing elsewhere. This stage
    // performs no external evidence retrieval, so it needs no YouTube key.
    let model = this.injectedModel;
    if (!model) {
      const router = new EnvironmentRoleRouter("VIDEO_PACKAGING");
      // Fail closed before any spend if the artifact author and the independent
      // critic would resolve to the same provider. The GENERATOR authors the
      // initial draft and the REVISION authors the accepted final artifact, so
      // BOTH must differ from the CRITIC.
      assertDistinctRoleProviders(router, "GENERATOR", "CRITIC");
      assertDistinctRoleProviders(router, "REVISION", "CRITIC");
      model = new RoutedVideoPackagingModel(router, budget, usageMeter);
    }
    return { resolver, model, usageMeter, budget };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    console.info("video_packaging_stage", { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_VIDEO_PACKAGING") throw new VideoPackagingExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Video-packaging executor received a different workflow type.");
    const input = videoPackagingInputSchema.parse(step.input);
    const { resolver, model, usageMeter, budget } = this.dependencies(step);
    await usageMeter.ensure();

    // The first worker step independently re-resolves the authoritative upstream
    // approved script. Nothing the browser submitted is trusted.
    if (step.stepKey === "validate-approved-script") {
      const output = approvedVideoScriptArtifactSchema.parse(
        await resolver.resolve(input.videoScriptWorkflowId, input.videoScriptRunId, input.approvedVideoScriptReference),
      );
      this.log(step, {
        upstreamScriptRunId: output.reference.scriptRunId,
        upstreamBriefRunId: output.reference.upstreamVideoBrief.briefRunId,
        scriptArtifactHash: output.reference.scriptArtifactHash,
        topicId: output.scope.scriptTopicId,
        scriptDurationSeconds: output.scope.scriptDurationSeconds,
        inheritedViewerValueGate: output.scope.inheritedViewerValueProvenance.gate,
      });
      return output;
    }
    const upstream = requirePrior(step, "validate-approved-script", (value) => approvedVideoScriptArtifactSchema.parse(value));

    if (step.stepKey === "draft-video-packaging") {
      const call = await model.draftPackaging(input, upstream);
      const result = channelVideoPackagingResultSchema.parse({
        ...call.value,
        // Identity, provenance, and the inherited viewer-value contract are
        // stamped by Channelwright, never accepted from model output.
        upstreamVideoScript: upstream.reference,
        packagingScope: upstream.scope,
        crossModelReview: null,
        modelProvenance: [call.attribution],
      });
      const output = videoPackagingDraftSchema.parse({ result, modelUsage: call.usage });
      this.log(step, { role: "GENERATOR", provider: call.attribution.provider, model: call.attribution.model, titleCandidateCount: result.titleCandidates.length, chapterCount: result.chapters.length, totalTokens: call.usage.totalTokens });
      return output;
    }
    const draft = requirePrior(step, "draft-video-packaging", (value) => videoPackagingDraftSchema.parse(value));

    if (step.stepKey === "initial-video-packaging-qa") {
      const deterministic = deterministicVideoPackagingValidation(draft.result, upstream, budget.maxResultPayloadBytes);
      const critique = await model.critique(input, upstream, draft.result);
      const semantic = await model.qa(input, upstream, draft.result, deterministic);
      const known = new Set(upstream.discoveryBundle.evidence.map((item) => item.id));
      const criticFindings = [...criticVerdictFindings(critique.value), ...critique.value.findings].map((finding) => ({
        ...finding,
        evidenceIds: finding.evidenceIds.filter((id) => known.has(id)),
        disposition: "CRITIC_RAISED_ISSUE" as CrossModelDisposition,
      }));
      const merged = mergeVideoPackagingQA(deterministic, semantic.value, semantic.usage, upstream, criticToQaFindings(criticFindings));
      const generator = draft.result.modelProvenance.find((item) => item.operation === "video_packaging_synthesis")
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
        criticFindingCount: criticFindings.length, keepsPromise: critique.value.keepsPromise, evidenceDisciplineHeld: critique.value.evidenceDisciplineHeld,
        deterministicErrors: deterministic.filter((finding) => finding.severity === "error").length,
        qaOutcome: merged.recommendation, qaScore: merged.score, unrevisable: hasUnrevisableVideoPackagingFailure(deterministic),
      });
      return videoPackagingQAStepSchema.parse({ qa: merged, crossModelReview: review });
    }
    const initial = requirePrior(step, "initial-video-packaging-qa", (value) => videoPackagingQAStepSchema.parse(value));

    if (step.stepKey === "bounded-video-packaging-revision") {
      // A dishonest or unsupported premise is not cosmetically fixable; it fails
      // closed here rather than being rewritten into apparent compliance.
      if (hasUnrevisableVideoPackagingFailure(initial.qa.findings)) {
        throw new VideoPackagingExecutionError("VIDEO_PACKAGING_INTEGRITY_UNREVISABLE", false, "A blocking viewer-value, provenance, or evidence-integrity failure cannot be resolved by automated revision.");
      }
      const material = !initial.qa.passed
        || initial.qa.findings.some((finding) => finding.severity === "error")
        || initial.qa.recommendation === "revise";
      if (!material) {
        return videoPackagingRevisionSchema.parse({
          attempted: false,
          reason: "Initial video packaging QA and the independent critic found no material issue requiring automated revision.",
          result: { ...draft.result, crossModelReview: { ...initial.crossModelReview, outcome: initial.crossModelReview.findings.length ? "CRITIC_RAISED_ISSUE" : "AGREED" } },
          modelUsage: { model: "none", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        });
      }
      const reservation = await usageMeter.reserve({ key: "video-packaging:automated-revision", kind: "AUTOMATED_REVISION", reservation: { automatedRevisions: 1 } });
      let revised: Awaited<ReturnType<VideoPackagingModel["revisePackaging"]>>;
      try {
        revised = await model.revisePackaging(input, upstream, draft.result, initial.qa);
        await usageMeter.finalize(reservation, "SUCCEEDED", { automatedRevisions: 1 });
      } catch (error) {
        await usageMeter.finalize(reservation, "FAILED", { automatedRevisions: 1, failedOperations: 1 });
        throw error;
      }
      const provenance = [...draft.result.modelProvenance, revised.attribution].slice(-8);
      const candidate = channelVideoPackagingResultSchema.parse({
        ...revised.value,
        upstreamVideoScript: upstream.reference,
        packagingScope: upstream.scope,
        crossModelReview: { ...initial.crossModelReview, outcome: "REVISED" satisfies CrossModelDisposition, findings: initial.crossModelReview.findings.map((finding) => ({ ...finding, disposition: "REVISED" as CrossModelDisposition })) },
        modelProvenance: provenance,
      });
      const before = deterministicVideoPackagingValidation(draft.result, upstream, budget.maxResultPayloadBytes);
      const after = deterministicVideoPackagingValidation(candidate, upstream, budget.maxResultPayloadBytes);
      const introduced = newlyIntroducedVideoPackagingErrors(before, after);
      const discarded = introduced.length > 0;
      const output = videoPackagingRevisionSchema.parse({
        attempted: true,
        reason: discarded
          ? `The bounded video packaging revision was discarded because it introduced deterministic errors: ${introduced.map((finding) => finding.code).join(", ")}.`
          : "One bounded automated revision was performed in response to material QA and cross-model findings.",
        result: discarded
          ? { ...draft.result, crossModelReview: { ...initial.crossModelReview, outcome: "OVERRIDDEN_BY_DETERMINISTIC_RULE" satisfies CrossModelDisposition } }
          : candidate,
        modelUsage: revised.usage,
      });
      this.log(step, { role: "REVISION", provider: revised.attribution.provider, model: revised.attribution.model, revisionAccepted: !discarded, introducedErrorCodes: introduced.map((finding) => finding.code), totalTokens: revised.usage.totalTokens });
      return output;
    }
    const revision = requirePrior(step, "bounded-video-packaging-revision", (value) => videoPackagingRevisionSchema.parse(value));

    if (step.stepKey === "final-video-packaging-qa") {
      const deterministic = deterministicVideoPackagingValidation(revision.result, upstream, budget.maxResultPayloadBytes);
      // The independent critic reviews the FINAL artifact after the bounded
      // revision, not only the initial draft, so a misleading title or forbidden
      // action introduced during revision still faces cross-model review before it
      // can finalize.
      const critique = await model.critique(input, upstream, revision.result);
      const semantic = await model.qa(input, upstream, revision.result, deterministic);
      const known = new Set(upstream.discoveryBundle.evidence.map((item) => item.id));
      const criticFindings = [...criticVerdictFindings(critique.value), ...critique.value.findings].map((finding) => ({
        ...finding,
        evidenceIds: finding.evidenceIds.filter((id) => known.has(id)),
        disposition: "CRITIC_RAISED_ISSUE" as CrossModelDisposition,
      }));
      const merged = mergeVideoPackagingQA(deterministic, semantic.value, semantic.usage, upstream, criticToQaFindings(criticFindings));
      const author = revision.result.modelProvenance.find((item) => item.role === "REVISION")
        ?? revision.result.modelProvenance.find((item) => item.operation === "video_packaging_synthesis")
        ?? revision.result.modelProvenance[revision.result.modelProvenance.length - 1];
      this.log(step, {
        role: "QA", criticProvider: critique.attribution.provider, provider: semantic.attribution.provider, model: semantic.attribution.model,
        acceptedAuthorRole: author?.role, acceptedAuthorProvider: author?.provider,
        criticFindingCount: criticFindings.length, qaOutcome: merged.recommendation, qaScore: merged.score,
      });
      // The one bounded revision is spent: a clean-but-still-improvable result
      // goes to a human rather than looping.
      const resolved = merged.passed && merged.recommendation === "revise" ? { ...merged, recommendation: "human_review_required" as const } : merged;
      return videoPackagingQAStepSchema.parse({
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

    if (step.stepKey === "finalize-video-packaging") {
      const final = requirePrior(step, "final-video-packaging-qa", (value) => videoPackagingQAStepSchema.parse(value));
      if (!final.qa.passed || final.qa.recommendation === "revise") {
        throw new VideoPackagingExecutionError("VIDEO_PACKAGING_QA_REJECTED", false, "Final QA did not accept the video packaging; nothing was advanced to human review.");
      }
      const output = channelVideoPackagingResultSchema.parse({
        ...revision.result,
        crossModelReview: final.crossModelReview,
      }) satisfies ChannelVideoPackagingResult;
      this.log(step, {
        humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: final.qa.score,
        topicId: output.packagingScope.scriptTopicId,
        viewerValueGate: output.viewerValue.gate,
        titleCandidateCount: output.titleCandidates.length,
        thumbnailConceptCount: output.thumbnailConcepts.length,
        chapterCount: output.chapters.length,
        crossModelOutcome: output.crossModelReview?.outcome,
        providers: [...new Set(output.modelProvenance.map((item) => item.provider))],
      });
      return output;
    }
    throw new VideoPackagingExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported video-packaging step ${step.stepKey}.`);
  }
}
