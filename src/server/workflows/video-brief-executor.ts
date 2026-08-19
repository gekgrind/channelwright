import {
  approvedContentOpportunityArtifactSchema,
  channelVideoBriefResultSchema,
  videoBriefDraftSchema,
  videoBriefInputSchema,
  videoBriefQAStepSchema,
  videoBriefRevisionSchema,
  type ChannelVideoBriefResult,
  type ClaimedWorkflowStep,
  type CrossModelDisposition,
  type CrossModelReview,
  type ModelAttribution,
} from "@/domain/production-workflows";
import { EnvironmentRoleRouter } from "@/server/ai/role-router";
import { SupabaseApprovedContentResolver, type ApprovedContentResolver } from "./approved-content-resolver";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import { channelVideoBriefConfig } from "./video-brief-config";
import { RoutedVideoBriefModel, viewerPromiseDesignSchema, type VideoBriefModel } from "./video-brief-model";
import {
  deterministicVideoBriefValidation,
  hasUnrevisableVideoBriefFailure,
  mergeVideoBriefQA,
  newlyIntroducedVideoBriefErrors,
} from "./video-brief-validation";
import type { WorkflowStepExecutor } from "./concept-validation-executor";

export class VideoBriefExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

function requirePrior<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T): T {
  const value = step.priorOutputs[key];
  if (!value) throw new VideoBriefExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${key} is missing.`);
  return parse(value);
}

const attributionOf = (value: unknown) => (value as { attribution?: ModelAttribution }).attribution;

function parseViewerPromiseStep(value: unknown) {
  return { design: viewerPromiseDesignSchema.parse((value as { design?: unknown }).design), attribution: attributionOf(value) };
}

export class ChannelVideoBriefExecutor implements WorkflowStepExecutor {
  constructor(
    private readonly injectedResolver?: ApprovedContentResolver,
    private readonly injectedModel?: VideoBriefModel,
    private readonly injectedUsageMeter?: ResearchUsageMeter,
  ) {}

  private dependencies(step: ClaimedWorkflowStep) {
    const budget = channelVideoBriefConfig();
    const usageMeter = this.injectedUsageMeter ?? new SupabaseResearchUsageMeter(step, budget);
    const resolver = this.injectedResolver ?? new SupabaseApprovedContentResolver();
    // Provider credentials are resolved lazily per role by the router, so a
    // misconfigured role fails loudly instead of routing elsewhere. This stage
    // performs no external evidence retrieval, so it needs no YouTube key.
    const model = this.injectedModel ?? new RoutedVideoBriefModel(new EnvironmentRoleRouter("VIDEO_BRIEF"), budget, usageMeter);
    return { resolver, model, usageMeter, budget };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    console.info("video_brief_stage", { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_VIDEO_BRIEF") throw new VideoBriefExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Video-brief executor received a different workflow type.");
    const input = videoBriefInputSchema.parse(step.input);
    const { resolver, model, usageMeter, budget } = this.dependencies(step);
    await usageMeter.ensure();

    // The first worker step independently re-resolves the authoritative upstream
    // artifact and selected topic. Nothing the browser submitted is trusted.
    if (step.stepKey === "validate-approved-content") {
      const output = approvedContentOpportunityArtifactSchema.parse(
        await resolver.resolve(input.contentIntelligenceWorkflowId, input.contentIntelligenceRunId, input.selectedTopicId, input.approvedContentReference),
      );
      this.log(step, {
        upstreamContentRunId: output.reference.contentRunId,
        upstreamStrategyRunId: output.reference.upstreamStrategy.strategyRunId,
        upstreamResearchRunId: output.reference.upstreamStrategy.upstreamResearch.researchRunId,
        contentArtifactHash: output.reference.contentArtifactHash,
        selectedTopicId: output.selection.topicId,
        selectionSource: output.selection.selectionSource,
        inheritedViewerValueGate: output.selection.inheritedViewerValueProvenance.gate,
      });
      return output;
    }
    const upstream = requirePrior(step, "validate-approved-content", (value) => approvedContentOpportunityArtifactSchema.parse(value));

    if (step.stepKey === "design-viewer-promise") {
      const call = await model.designViewerPromise(input, upstream);
      this.log(step, { role: "GENERATOR", provider: call.attribution.provider, model: call.attribution.model, outcomeKind: call.value.viewerPromise.outcomeKind, totalTokens: call.usage.totalTokens });
      return { design: call.value, modelUsage: call.usage, attribution: call.attribution };
    }
    const promise = requirePrior(step, "design-viewer-promise", parseViewerPromiseStep);

    if (step.stepKey === "build-video-brief") {
      const call = await model.buildBrief(input, upstream, promise.design);
      const provenance = [promise.attribution, call.attribution].filter(Boolean) as ModelAttribution[];
      const result = channelVideoBriefResultSchema.parse({
        ...call.value,
        // Identity, provenance, and the inherited viewer-value contract hash are
        // stamped by Channelwright, never accepted from model output.
        upstreamContentIntelligence: upstream.reference,
        selectedTopic: upstream.selection,
        crossModelReview: null,
        modelProvenance: provenance,
      });
      const output = videoBriefDraftSchema.parse({ result, modelUsage: call.usage });
      this.log(step, { role: "GENERATOR", provider: call.attribution.provider, model: call.attribution.model, beatCount: result.contentArchitecture.beats.length, format: result.creativeDirection.format, totalTokens: call.usage.totalTokens });
      return output;
    }
    const draft = requirePrior(step, "build-video-brief", (value) => videoBriefDraftSchema.parse(value));

    if (step.stepKey === "initial-video-brief-qa") {
      // Deterministic validation runs first and is authoritative. The independent
      // critic and semantic QA are advisory layers on top of it: they can add
      // findings, but they cannot clear a deterministic failure.
      const deterministic = deterministicVideoBriefValidation(draft.result, upstream, budget.maxResultPayloadBytes);
      const critique = await model.critique(input, upstream, draft.result);
      const semantic = await model.qa(input, upstream, draft.result, deterministic);
      const known = new Set(upstream.discoveryBundle.evidence.map((item) => item.id));
      const criticFindings = critique.value.findings.map((finding) => ({
        ...finding,
        evidenceIds: finding.evidenceIds.filter((id) => known.has(id)),
        disposition: "CRITIC_RAISED_ISSUE" as CrossModelDisposition,
      }));
      const merged = mergeVideoBriefQA(
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
      const generator = draft.result.modelProvenance.find((item) => item.operation === "video_brief_synthesis")
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
        criticFindingCount: criticFindings.length, worthProducing: critique.value.worthProducing, promiseChallenged: critique.value.promiseChallenged,
        deterministicErrors: deterministic.filter((finding) => finding.severity === "error").length,
        qaOutcome: merged.recommendation, qaScore: merged.score, unrevisable: hasUnrevisableVideoBriefFailure(deterministic),
      });
      return videoBriefQAStepSchema.parse({ qa: merged, crossModelReview: review });
    }
    const initial = requirePrior(step, "initial-video-brief-qa", (value) => videoBriefQAStepSchema.parse(value));

    if (step.stepKey === "bounded-video-brief-revision") {
      // A deceptive or unsupported premise is not cosmetically fixable; it fails
      // closed here rather than being rewritten into apparent compliance.
      if (hasUnrevisableVideoBriefFailure(initial.qa.findings)) {
        throw new VideoBriefExecutionError("VIDEO_BRIEF_INTEGRITY_UNREVISABLE", false, "A blocking viewer-value, provenance, or content-integrity failure cannot be resolved by automated revision.");
      }
      // A failing verdict is material even with zero errors: warning pressure
      // alone can push the merged score below the pass threshold, and treating
      // only errors as material would dead-end the run after full spend.
      const material = !initial.qa.passed
        || initial.qa.findings.some((finding) => finding.severity === "error")
        || initial.qa.recommendation === "revise";
      if (!material) {
        return videoBriefRevisionSchema.parse({
          attempted: false,
          reason: "Initial video brief QA and the independent critic found no material issue requiring automated revision.",
          result: { ...draft.result, crossModelReview: { ...initial.crossModelReview, outcome: initial.crossModelReview.findings.length ? "CRITIC_RAISED_ISSUE" : "AGREED" } },
          modelUsage: { model: "none", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        });
      }
      const reservation = await usageMeter.reserve({ key: "video-brief:automated-revision", kind: "AUTOMATED_REVISION", reservation: { automatedRevisions: 1 } });
      let revised: Awaited<ReturnType<VideoBriefModel["reviseBrief"]>>;
      try {
        revised = await model.reviseBrief(input, upstream, draft.result, initial.qa);
        await usageMeter.finalize(reservation, "SUCCEEDED", { automatedRevisions: 1 });
      } catch (error) {
        await usageMeter.finalize(reservation, "FAILED", { automatedRevisions: 1, failedOperations: 1 });
        throw error;
      }
      const provenance = [...draft.result.modelProvenance, revised.attribution].slice(-8);
      const candidate = channelVideoBriefResultSchema.parse({
        ...revised.value,
        upstreamContentIntelligence: upstream.reference,
        selectedTopic: upstream.selection,
        crossModelReview: { ...initial.crossModelReview, outcome: "REVISED" satisfies CrossModelDisposition, findings: initial.crossModelReview.findings.map((finding) => ({ ...finding, disposition: "REVISED" as CrossModelDisposition })) },
        modelProvenance: provenance,
      });
      const before = deterministicVideoBriefValidation(draft.result, upstream, budget.maxResultPayloadBytes);
      const after = deterministicVideoBriefValidation(candidate, upstream, budget.maxResultPayloadBytes);
      const introduced = newlyIntroducedVideoBriefErrors(before, after);
      const discarded = introduced.length > 0;
      const output = videoBriefRevisionSchema.parse({
        attempted: true,
        reason: discarded
          ? `The bounded video brief revision was discarded because it introduced deterministic errors: ${introduced.map((finding) => finding.code).join(", ")}.`
          : "One bounded automated revision was performed in response to material QA and cross-model findings.",
        result: discarded
          ? { ...draft.result, crossModelReview: { ...initial.crossModelReview, outcome: "OVERRIDDEN_BY_DETERMINISTIC_RULE" satisfies CrossModelDisposition } }
          : candidate,
        modelUsage: revised.usage,
      });
      this.log(step, { role: "REVISION", provider: revised.attribution.provider, model: revised.attribution.model, revisionAccepted: !discarded, introducedErrorCodes: introduced.map((finding) => finding.code), totalTokens: revised.usage.totalTokens });
      return output;
    }
    const revision = requirePrior(step, "bounded-video-brief-revision", (value) => videoBriefRevisionSchema.parse(value));

    if (step.stepKey === "final-video-brief-qa") {
      const deterministic = deterministicVideoBriefValidation(revision.result, upstream, budget.maxResultPayloadBytes);
      const semantic = await model.qa(input, upstream, revision.result, deterministic);
      const merged = mergeVideoBriefQA(deterministic, semantic.value, semantic.usage, upstream);
      this.log(step, { role: "QA", provider: semantic.attribution.provider, model: semantic.attribution.model, qaOutcome: merged.recommendation, qaScore: merged.score });
      // The one bounded revision is spent: a clean-but-still-improvable result
      // goes to a human rather than looping.
      const resolved = merged.passed && merged.recommendation === "revise" ? { ...merged, recommendation: "human_review_required" as const } : merged;
      return videoBriefQAStepSchema.parse({
        qa: resolved,
        crossModelReview: {
          ...revision.result.crossModelReview ?? { generator: semantic.attribution, critic: null, findings: [], summary: "No independent critique was recorded for this artifact." },
          outcome: resolved.recommendation === "human_review_required" ? "HUMAN_REVIEW_REQUIRED" : (revision.result.crossModelReview?.outcome ?? "AGREED"),
        },
      });
    }

    if (step.stepKey === "finalize-video-brief") {
      const final = requirePrior(step, "final-video-brief-qa", (value) => videoBriefQAStepSchema.parse(value));
      if (!final.qa.passed || final.qa.recommendation === "revise") {
        throw new VideoBriefExecutionError("VIDEO_BRIEF_QA_REJECTED", false, "Final QA did not accept the video brief; nothing was advanced to human review.");
      }
      const output = channelVideoBriefResultSchema.parse({
        ...revision.result,
        crossModelReview: final.crossModelReview,
      }) satisfies ChannelVideoBriefResult;
      this.log(step, {
        humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: final.qa.score,
        selectedTopicId: output.selectedTopic.topicId,
        viewerValueGate: output.viewerValue.gate,
        evidenceSufficiency: output.evidencePlan.sufficiency,
        researchRequiredClaims: output.evidencePlan.items.filter((item) => item.status === "RESEARCH_REQUIRED").length,
        crossModelOutcome: output.crossModelReview?.outcome,
        providers: [...new Set(output.modelProvenance.map((item) => item.provider))],
      });
      return output;
    }
    throw new VideoBriefExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported video-brief step ${step.stepKey}.`);
  }
}
