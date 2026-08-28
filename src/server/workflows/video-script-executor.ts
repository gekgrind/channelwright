import {
  approvedVideoBriefArtifactSchema,
  channelVideoScriptResultSchema,
  videoScriptDraftSchema,
  videoScriptInputSchema,
  videoScriptQAStepSchema,
  videoScriptRevisionSchema,
  type ChannelVideoScriptResult,
  type ClaimedWorkflowStep,
  type CrossModelDisposition,
  type CrossModelReview,
} from "@/domain/production-workflows";
import { assertDistinctRoleProviders, EnvironmentRoleRouter } from "@/server/ai/role-router";
import { SupabaseApprovedBriefResolver, type ApprovedBriefResolver } from "./approved-brief-resolver";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import { channelVideoScriptConfig } from "./video-script-config";
import { RoutedVideoScriptModel, type VideoScriptModel } from "./video-script-model";
import {
  deterministicVideoScriptValidation,
  hasUnrevisableVideoScriptFailure,
  mergeVideoScriptQA,
  newlyIntroducedVideoScriptErrors,
} from "./video-script-validation";
import type { WorkflowStepExecutor } from "./concept-validation-executor";

export class VideoScriptExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

function requirePrior<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T): T {
  const value = step.priorOutputs[key];
  if (!value) throw new VideoScriptExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${key} is missing.`);
  return parse(value);
}

export class ChannelVideoScriptExecutor implements WorkflowStepExecutor {
  constructor(
    private readonly injectedResolver?: ApprovedBriefResolver,
    private readonly injectedModel?: VideoScriptModel,
    private readonly injectedUsageMeter?: ResearchUsageMeter,
  ) {}

  private dependencies(step: ClaimedWorkflowStep) {
    const budget = channelVideoScriptConfig();
    const usageMeter = this.injectedUsageMeter ?? new SupabaseResearchUsageMeter(step, budget);
    const resolver = this.injectedResolver ?? new SupabaseApprovedBriefResolver();
    // Provider credentials are resolved lazily per role by the router, so a
    // misconfigured role fails loudly instead of routing elsewhere. This stage
    // performs no external evidence retrieval, so it needs no YouTube key.
    let model = this.injectedModel;
    if (!model) {
      const router = new EnvironmentRoleRouter("VIDEO_SCRIPT");
      // Fail closed before any spend if the generator and independent critic
      // would resolve to the same provider (or a role has no model configured).
      assertDistinctRoleProviders(router, "GENERATOR", "CRITIC");
      model = new RoutedVideoScriptModel(router, budget, usageMeter);
    }
    return { resolver, model, usageMeter, budget };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    console.info("video_script_stage", { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_VIDEO_SCRIPT") throw new VideoScriptExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Video-script executor received a different workflow type.");
    const input = videoScriptInputSchema.parse(step.input);
    const { resolver, model, usageMeter, budget } = this.dependencies(step);
    await usageMeter.ensure();

    // The first worker step independently re-resolves the authoritative upstream
    // approved brief. Nothing the browser submitted is trusted.
    if (step.stepKey === "validate-approved-brief") {
      const output = approvedVideoBriefArtifactSchema.parse(
        await resolver.resolve(input.videoBriefWorkflowId, input.videoBriefRunId, input.approvedVideoBriefReference),
      );
      this.log(step, {
        upstreamBriefRunId: output.reference.briefRunId,
        upstreamContentRunId: output.reference.upstreamContentIntelligence.contentRunId,
        briefArtifactHash: output.reference.briefArtifactHash,
        topicId: output.scope.briefTopicId,
        inheritedViewerValueGate: output.scope.inheritedViewerValueProvenance.gate,
      });
      return output;
    }
    const upstream = requirePrior(step, "validate-approved-brief", (value) => approvedVideoBriefArtifactSchema.parse(value));

    if (step.stepKey === "draft-video-script") {
      const call = await model.draftScript(input, upstream);
      const result = channelVideoScriptResultSchema.parse({
        ...call.value,
        // Identity, provenance, and the inherited viewer-value contract are
        // stamped by Channelwright, never accepted from model output.
        upstreamVideoBrief: upstream.reference,
        scriptScope: upstream.scope,
        crossModelReview: null,
        modelProvenance: [call.attribution],
      });
      const output = videoScriptDraftSchema.parse({ result, modelUsage: call.usage });
      this.log(step, { role: "GENERATOR", provider: call.attribution.provider, model: call.attribution.model, sectionCount: result.sections.length, totalDurationSeconds: result.timing.totalDurationSeconds, totalTokens: call.usage.totalTokens });
      return output;
    }
    const draft = requirePrior(step, "draft-video-script", (value) => videoScriptDraftSchema.parse(value));

    if (step.stepKey === "initial-video-script-qa") {
      // Deterministic validation runs first and is authoritative. The independent
      // critic and semantic QA are advisory layers on top of it: they can add
      // findings, but they cannot clear a deterministic failure.
      const deterministic = deterministicVideoScriptValidation(draft.result, upstream, budget.maxResultPayloadBytes);
      const critique = await model.critique(input, upstream, draft.result);
      const semantic = await model.qa(input, upstream, draft.result, deterministic);
      const known = new Set(upstream.discoveryBundle.evidence.map((item) => item.id));
      const criticFindings = critique.value.findings.map((finding) => ({
        ...finding,
        evidenceIds: finding.evidenceIds.filter((id) => known.has(id)),
        disposition: "CRITIC_RAISED_ISSUE" as CrossModelDisposition,
      }));
      const merged = mergeVideoScriptQA(
        deterministic,
        {
          ...semantic.value,
          findings: [
            ...semantic.value.findings,
            ...criticFindings.map((finding) => ({ severity: finding.severity, code: finding.code, message: `${finding.affectedField}: ${finding.rationale}`, evidenceIds: finding.evidenceIds })),
          ].slice(0, 40),
        },
        semantic.usage,
        upstream,
      );
      const generator = draft.result.modelProvenance.find((item) => item.operation === "video_script_synthesis")
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
        qaOutcome: merged.recommendation, qaScore: merged.score, unrevisable: hasUnrevisableVideoScriptFailure(deterministic),
      });
      return videoScriptQAStepSchema.parse({ qa: merged, crossModelReview: review });
    }
    const initial = requirePrior(step, "initial-video-script-qa", (value) => videoScriptQAStepSchema.parse(value));

    if (step.stepKey === "bounded-video-script-revision") {
      // A dishonest or unsupported premise is not cosmetically fixable; it fails
      // closed here rather than being rewritten into apparent compliance.
      if (hasUnrevisableVideoScriptFailure(initial.qa.findings)) {
        throw new VideoScriptExecutionError("VIDEO_SCRIPT_INTEGRITY_UNREVISABLE", false, "A blocking viewer-value, provenance, or evidence-integrity failure cannot be resolved by automated revision.");
      }
      const material = !initial.qa.passed
        || initial.qa.findings.some((finding) => finding.severity === "error")
        || initial.qa.recommendation === "revise";
      if (!material) {
        return videoScriptRevisionSchema.parse({
          attempted: false,
          reason: "Initial video script QA and the independent critic found no material issue requiring automated revision.",
          result: { ...draft.result, crossModelReview: { ...initial.crossModelReview, outcome: initial.crossModelReview.findings.length ? "CRITIC_RAISED_ISSUE" : "AGREED" } },
          modelUsage: { model: "none", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        });
      }
      const reservation = await usageMeter.reserve({ key: "video-script:automated-revision", kind: "AUTOMATED_REVISION", reservation: { automatedRevisions: 1 } });
      let revised: Awaited<ReturnType<VideoScriptModel["reviseScript"]>>;
      try {
        revised = await model.reviseScript(input, upstream, draft.result, initial.qa);
        await usageMeter.finalize(reservation, "SUCCEEDED", { automatedRevisions: 1 });
      } catch (error) {
        await usageMeter.finalize(reservation, "FAILED", { automatedRevisions: 1, failedOperations: 1 });
        throw error;
      }
      const provenance = [...draft.result.modelProvenance, revised.attribution].slice(-8);
      const candidate = channelVideoScriptResultSchema.parse({
        ...revised.value,
        upstreamVideoBrief: upstream.reference,
        scriptScope: upstream.scope,
        crossModelReview: { ...initial.crossModelReview, outcome: "REVISED" satisfies CrossModelDisposition, findings: initial.crossModelReview.findings.map((finding) => ({ ...finding, disposition: "REVISED" as CrossModelDisposition })) },
        modelProvenance: provenance,
      });
      const before = deterministicVideoScriptValidation(draft.result, upstream, budget.maxResultPayloadBytes);
      const after = deterministicVideoScriptValidation(candidate, upstream, budget.maxResultPayloadBytes);
      const introduced = newlyIntroducedVideoScriptErrors(before, after);
      const discarded = introduced.length > 0;
      const output = videoScriptRevisionSchema.parse({
        attempted: true,
        reason: discarded
          ? `The bounded video script revision was discarded because it introduced deterministic errors: ${introduced.map((finding) => finding.code).join(", ")}.`
          : "One bounded automated revision was performed in response to material QA and cross-model findings.",
        result: discarded
          ? { ...draft.result, crossModelReview: { ...initial.crossModelReview, outcome: "OVERRIDDEN_BY_DETERMINISTIC_RULE" satisfies CrossModelDisposition } }
          : candidate,
        modelUsage: revised.usage,
      });
      this.log(step, { role: "REVISION", provider: revised.attribution.provider, model: revised.attribution.model, revisionAccepted: !discarded, introducedErrorCodes: introduced.map((finding) => finding.code), totalTokens: revised.usage.totalTokens });
      return output;
    }
    const revision = requirePrior(step, "bounded-video-script-revision", (value) => videoScriptRevisionSchema.parse(value));

    if (step.stepKey === "final-video-script-qa") {
      const deterministic = deterministicVideoScriptValidation(revision.result, upstream, budget.maxResultPayloadBytes);
      // The independent critic reviews the FINAL artifact after the bounded
      // revision, not only the initial draft, so a forbidden or unsupported claim
      // introduced during revision still faces cross-model review before it can
      // finalize. Its error-severity findings can fail the merged QA.
      const critique = await model.critique(input, upstream, revision.result);
      const semantic = await model.qa(input, upstream, revision.result, deterministic);
      const known = new Set(upstream.discoveryBundle.evidence.map((item) => item.id));
      const criticFindings = critique.value.findings.map((finding) => ({
        ...finding,
        evidenceIds: finding.evidenceIds.filter((id) => known.has(id)),
        disposition: "CRITIC_RAISED_ISSUE" as CrossModelDisposition,
      }));
      const merged = mergeVideoScriptQA(
        deterministic,
        {
          ...semantic.value,
          findings: [
            ...semantic.value.findings,
            ...criticFindings.map((finding) => ({ severity: finding.severity, code: finding.code, message: `${finding.affectedField}: ${finding.rationale}`, evidenceIds: finding.evidenceIds })),
          ].slice(0, 40),
        },
        semantic.usage,
        upstream,
      );
      const generator = revision.result.modelProvenance.find((item) => item.operation === "video_script_synthesis")
        ?? revision.result.modelProvenance[revision.result.modelProvenance.length - 1];
      this.log(step, {
        role: "QA", criticProvider: critique.attribution.provider, provider: semantic.attribution.provider, model: semantic.attribution.model,
        criticFindingCount: criticFindings.length, qaOutcome: merged.recommendation, qaScore: merged.score,
      });
      // The one bounded revision is spent: a clean-but-still-improvable result
      // goes to a human rather than looping.
      const resolved = merged.passed && merged.recommendation === "revise" ? { ...merged, recommendation: "human_review_required" as const } : merged;
      return videoScriptQAStepSchema.parse({
        qa: resolved,
        crossModelReview: {
          generator: generator ?? critique.attribution,
          critic: critique.attribution,
          outcome: resolved.recommendation === "human_review_required" ? "HUMAN_REVIEW_REQUIRED"
            : deterministic.some((finding) => finding.severity === "error") && criticFindings.length === 0 ? "OVERRIDDEN_BY_DETERMINISTIC_RULE"
              : criticFindings.length === 0 ? "AGREED" : "CRITIC_RAISED_ISSUE",
          findings: criticFindings.slice(0, 12),
          summary: critique.value.overallAssessment,
        },
      });
    }

    if (step.stepKey === "finalize-video-script") {
      const final = requirePrior(step, "final-video-script-qa", (value) => videoScriptQAStepSchema.parse(value));
      if (!final.qa.passed || final.qa.recommendation === "revise") {
        throw new VideoScriptExecutionError("VIDEO_SCRIPT_QA_REJECTED", false, "Final QA did not accept the video script; nothing was advanced to human review.");
      }
      const output = channelVideoScriptResultSchema.parse({
        ...revision.result,
        crossModelReview: final.crossModelReview,
      }) satisfies ChannelVideoScriptResult;
      this.log(step, {
        humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: final.qa.score,
        topicId: output.scriptScope.briefTopicId,
        viewerValueGate: output.viewerValue.gate,
        sectionCount: output.sections.length,
        totalDurationSeconds: output.timing.totalDurationSeconds,
        deferredResearchClaims: output.evidenceDiscipline.researchRequiredClaimsDeferred.length,
        crossModelOutcome: output.crossModelReview?.outcome,
        providers: [...new Set(output.modelProvenance.map((item) => item.provider))],
      });
      return output;
    }
    throw new VideoScriptExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported video-script step ${step.stepKey}.`);
  }
}
