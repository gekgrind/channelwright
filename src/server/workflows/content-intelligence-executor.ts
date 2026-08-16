import {
  approvedStrategyArtifactSchema,
  channelContentIntelligenceResultSchema,
  contentDraftSchema,
  contentIntelligenceInputSchema,
  contentQAStepSchema,
  contentRevisionSchema,
  topicDiscoveryBundleSchema,
  type ChannelContentIntelligenceResult,
  type ClaimedWorkflowStep,
  type ContentTopicScore,
  type CrossModelDisposition,
  type CrossModelReview,
  type ModelAttribution,
} from "@/domain/production-workflows";
import { EnvironmentRoleRouter } from "@/server/ai/role-router";
import { SupabaseApprovedStrategyResolver, type ApprovedStrategyResolver } from "./approved-strategy-resolver";
import { channelContentIntelligenceConfig } from "./content-config";
import { RoutedContentModel, pillarExpansionPlanSchema, topicAssessmentSchema, type ContentModel } from "./content-model";
import { deterministicContentValidation, hasUnrevisableFailure, mergeContentQA, newlyIntroducedContentErrors } from "./content-validation";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import { SupabaseTopicDiscoveryCache } from "./topic-discovery-cache";
import { YouTubeTopicDiscoveryProvider, type TopicDiscoveryProvider } from "./youtube-topic-discovery";
import type { WorkflowStepExecutor } from "./concept-validation-executor";

function requirePrior<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T): T {
  const value = step.priorOutputs[key];
  if (!value) throw new ContentExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${key} is missing.`);
  return parse(value);
}

const attributionOf = (value: unknown) => (value as { attribution?: ModelAttribution }).attribution;

function parsePillarExpansionStep(value: unknown) {
  return { plan: pillarExpansionPlanSchema.parse((value as { plan?: unknown }).plan), attribution: attributionOf(value) };
}

function parseTopicAssessmentStep(value: unknown) {
  return { assessment: topicAssessmentSchema.parse((value as { assessment?: unknown }).assessment), attribution: attributionOf(value) };
}

export class ContentExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Channelwright owns the scoring arithmetic. The generator proposes relative
 * weights; this normalizes them to sum to exactly 1 and derives the weighted
 * total, so an aggregate score can never disagree with its own decomposition.
 * The deterministic rules that check both remain in place as a backstop against
 * a revision that reintroduces the problem.
 */
export function normalizeTopicScore(score: Omit<ContentTopicScore, "weightedTotal">): ContentTopicScore {
  const total = score.components.reduce((sum, component) => sum + component.weight, 0);
  const components = total > 0
    ? score.components.map((component) => ({ ...component, weight: round2(component.weight / total) }))
    : score.components.map((component) => ({ ...component, weight: round2(1 / score.components.length) }));
  // Rounding each weight can leave a cent of drift; absorb it in the largest one.
  const rounded = components.reduce((sum, component) => sum + component.weight, 0);
  const drift = round2(1 - rounded);
  if (drift !== 0) {
    const largest = components.reduce((best, component, index) => component.weight > components[best].weight ? index : best, 0);
    components[largest] = { ...components[largest], weight: round2(components[largest].weight + drift) };
  }
  return {
    ...score,
    components,
    weightedTotal: round2(components.reduce((sum, component) => sum + component.score * component.weight, 0)),
  };
}

export class ChannelContentIntelligenceExecutor implements WorkflowStepExecutor {
  constructor(
    private readonly injectedResolver?: ApprovedStrategyResolver,
    private readonly injectedProvider?: TopicDiscoveryProvider,
    private readonly injectedModel?: ContentModel,
    private readonly injectedUsageMeter?: ResearchUsageMeter,
  ) {}

  private dependencies(step: ClaimedWorkflowStep) {
    const budget = channelContentIntelligenceConfig();
    const usageMeter = this.injectedUsageMeter ?? new SupabaseResearchUsageMeter(step, budget);
    const resolver = this.injectedResolver ?? new SupabaseApprovedStrategyResolver();
    if (this.injectedProvider && this.injectedModel) return { resolver, provider: this.injectedProvider, model: this.injectedModel, usageMeter, budget };
    // Provider credentials and the YouTube key are resolved lazily per role by the
    // router, so a misconfigured role fails loudly instead of routing elsewhere.
    const youtubeApiKey = process.env.YOUTUBE_DATA_API_KEY?.trim();
    if (!youtubeApiKey) throw new ContentExecutionError("YOUTUBE_CREDENTIALS_MISSING", false, "YOUTUBE_DATA_API_KEY is required by the content-intelligence worker.");
    return {
      resolver,
      provider: this.injectedProvider ?? new YouTubeTopicDiscoveryProvider(youtubeApiKey, new SupabaseTopicDiscoveryCache(), budget, fetch, () => new Date(), usageMeter),
      model: this.injectedModel ?? new RoutedContentModel(new EnvironmentRoleRouter("CONTENT"), budget, usageMeter),
      usageMeter,
      budget,
    };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    console.info("content_intelligence_stage", { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_CONTENT_INTELLIGENCE") throw new ContentExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Content-intelligence executor received a different workflow type.");
    const input = contentIntelligenceInputSchema.parse(step.input);
    const { resolver, provider, model, usageMeter, budget } = this.dependencies(step);
    await usageMeter.ensure();

    if (step.stepKey === "validate-approved-strategy") {
      const output = approvedStrategyArtifactSchema.parse(await resolver.resolve(input.strategyWorkflowId, input.strategyRunId, input.approvedStrategyReference));
      this.log(step, { upstreamStrategyRunId: output.reference.strategyRunId, upstreamResearchRunId: output.reference.upstreamResearch.researchRunId, strategyArtifactHash: output.reference.strategyArtifactHash });
      return output;
    }
    const upstream = requirePrior(step, "validate-approved-strategy", (value) => approvedStrategyArtifactSchema.parse(value));

    if (step.stepKey === "expand-content-pillars") {
      const call = await model.expandPillars(input, upstream);
      this.log(step, { role: "GENERATOR", provider: call.attribution.provider, model: call.attribution.model, pillarCount: call.value.expansions.length, totalTokens: call.usage.totalTokens });
      return { plan: call.value, modelUsage: call.usage, attribution: call.attribution };
    }
    const expansion = requirePrior(step, "expand-content-pillars", parsePillarExpansionStep);

    if (step.stepKey === "discover-youtube-topics") {
      const output = await provider.discover(step.ownerId, expansion.plan.expansions.map((item) => ({ pillarId: item.pillarId, queries: item.discoveryQueries })));
      this.log(step, { providerRequests: output.usage.providerRequests, searchQueries: output.usage.searchQueries, evidenceCount: output.evidence.length, completionStatus: output.completionStatus });
      return output;
    }
    const discovery = requirePrior(step, "discover-youtube-topics", (value) => topicDiscoveryBundleSchema.parse(value));

    if (step.stepKey === "assess-topic-opportunities") {
      const call = await model.assessTopics(input, upstream, discovery, expansion.plan);
      this.log(step, { role: "GENERATOR", provider: call.attribution.provider, model: call.attribution.model, topicCount: call.value.topics.length, totalTokens: call.usage.totalTokens });
      return { assessment: call.value, modelUsage: call.usage, attribution: call.attribution };
    }
    const assessed = requirePrior(step, "assess-topic-opportunities", parseTopicAssessmentStep);

    if (step.stepKey === "synthesize-backlog") {
      const call = await model.synthesizeBacklog(input, upstream, discovery, expansion.plan, assessed.assessment);
      const provenance = [expansion.attribution, assessed.attribution, call.attribution].filter(Boolean) as ModelAttribution[];
      const scores = call.value.scores.map(normalizeTopicScore);
      const result = channelContentIntelligenceResultSchema.parse({
        schemaVersion: 1,
        workflowType: "CHANNEL_CONTENT_INTELLIGENCE",
        pillarExpansions: expansion.plan.expansions,
        topics: assessed.assessment.topics,
        scores,
        backlog: call.value.backlog,
        nextVideoRecommendation: call.value.nextVideoRecommendation,
        risks: call.value.risks,
        assumptions: call.value.assumptions,
        openQuestions: call.value.openQuestions,
        recommendedNextAction: call.value.recommendedNextAction,
        upstreamStrategy: upstream.reference,
        crossModelReview: null,
        modelProvenance: provenance,
      });
      const output = contentDraftSchema.parse({ result, modelUsage: call.usage });
      this.log(step, { role: "GENERATOR", provider: call.attribution.provider, model: call.attribution.model, backlogSize: result.backlog.length, totalTokens: call.usage.totalTokens });
      return output;
    }
    const draft = requirePrior(step, "synthesize-backlog", (value) => contentDraftSchema.parse(value));

    if (step.stepKey === "initial-content-qa") {
      // Deterministic validation runs first and is authoritative. The independent
      // critic and semantic QA are advisory layers on top of it: they can add
      // findings, but they cannot clear a deterministic failure.
      const deterministic = deterministicContentValidation(draft.result, upstream, discovery, budget.maxResultPayloadBytes);
      const critique = await model.critique(input, upstream, discovery, draft.result);
      const semantic = await model.qa(input, upstream, discovery, draft.result, deterministic);
      const known = new Set(discovery.evidence.map((item) => item.id));
      const criticFindings = critique.value.findings.map((finding) => ({
        ...finding,
        evidenceIds: finding.evidenceIds.filter((id) => known.has(id)),
        disposition: "CRITIC_RAISED_ISSUE" as CrossModelDisposition,
      }));
      const merged = mergeContentQA(
        // Critic errors join the QA finding set, but only deterministic findings
        // count as deterministic failures.
        deterministic,
        {
          ...semantic.value,
          findings: [
            ...semantic.value.findings,
            ...criticFindings.map((finding) => ({ severity: finding.severity, code: finding.code, message: `${finding.affectedField}: ${finding.rationale}`, evidenceIds: finding.evidenceIds })),
          ].slice(0, 40),
        },
        semantic.usage,
        discovery,
      );
      const generator = draft.result.modelProvenance.find((item) => item.operation === "content_backlog_synthesis")
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
        criticFindingCount: criticFindings.length, recommendationChallenged: critique.value.recommendationChallenged,
        deterministicErrors: deterministic.filter((finding) => finding.severity === "error").length,
        qaOutcome: merged.recommendation, qaScore: merged.score, unrevisable: hasUnrevisableFailure(deterministic),
      });
      return contentQAStepSchema.parse({ qa: merged, crossModelReview: review });
    }
    const initial = requirePrior(step, "initial-content-qa", (value) => contentQAStepSchema.parse(value));

    if (step.stepKey === "bounded-content-revision") {
      // A deceptive or unsupported premise is not cosmetically fixable; it fails
      // closed here rather than being rewritten into apparent compliance.
      if (hasUnrevisableFailure(initial.qa.findings)) {
        throw new ContentExecutionError("CONTENT_INTEGRITY_UNREVISABLE", false, "A blocking viewer-value or content-integrity failure cannot be resolved by automated revision.");
      }
      // Warning pressure alone can push the merged score below the pass threshold
      // with zero errors. Treating only errors as material dead-ended those runs:
      // no revision was attempted, final QA recomputed the same warnings, and the
      // run failed closed after full spend. A failing verdict is material.
      const material = !initial.qa.passed
        || initial.qa.findings.some((finding) => finding.severity === "error")
        || initial.qa.recommendation === "revise";
      if (!material) {
        return contentRevisionSchema.parse({
          attempted: false,
          reason: "Initial content QA and the independent critic found no material issue requiring automated revision.",
          result: { ...draft.result, crossModelReview: { ...initial.crossModelReview, outcome: initial.crossModelReview.findings.length ? "CRITIC_RAISED_ISSUE" : "AGREED" } },
          modelUsage: { model: "none", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        });
      }
      const reservation = await usageMeter.reserve({ key: "content:automated-revision", kind: "AUTOMATED_REVISION", reservation: { automatedRevisions: 1 } });
      let revised: Awaited<ReturnType<ContentModel["reviseBacklog"]>>;
      try {
        revised = await model.reviseBacklog(input, upstream, discovery, draft.result, initial.qa);
        await usageMeter.finalize(reservation, "SUCCEEDED", { automatedRevisions: 1 });
      } catch (error) {
        await usageMeter.finalize(reservation, "FAILED", { automatedRevisions: 1, failedOperations: 1 });
        throw error;
      }
      const provenance = [...draft.result.modelProvenance, revised.attribution].slice(-8);
      const candidate = channelContentIntelligenceResultSchema.parse({
        ...revised.value,
        upstreamStrategy: upstream.reference,
        crossModelReview: { ...initial.crossModelReview, outcome: "REVISED" satisfies CrossModelDisposition, findings: initial.crossModelReview.findings.map((finding) => ({ ...finding, disposition: "REVISED" as CrossModelDisposition })) },
        modelProvenance: provenance,
      });
      const before = deterministicContentValidation(draft.result, upstream, discovery, budget.maxResultPayloadBytes);
      const after = deterministicContentValidation(candidate, upstream, discovery, budget.maxResultPayloadBytes);
      const introduced = newlyIntroducedContentErrors(before, after);
      const discarded = introduced.length > 0;
      const output = contentRevisionSchema.parse({
        attempted: true,
        reason: discarded
          ? `The bounded content revision was discarded because it introduced deterministic errors: ${introduced.map((finding) => finding.code).join(", ")}.`
          : "One bounded automated content revision was performed in response to material QA and cross-model findings.",
        result: discarded
          ? { ...draft.result, crossModelReview: { ...initial.crossModelReview, outcome: "OVERRIDDEN_BY_DETERMINISTIC_RULE" satisfies CrossModelDisposition } }
          : candidate,
        modelUsage: revised.usage,
      });
      this.log(step, { role: "REVISION", provider: revised.attribution.provider, model: revised.attribution.model, revisionAccepted: !discarded, introducedErrorCodes: introduced.map((finding) => finding.code), totalTokens: revised.usage.totalTokens });
      return output;
    }
    const revision = requirePrior(step, "bounded-content-revision", (value) => contentRevisionSchema.parse(value));

    if (step.stepKey === "final-content-qa") {
      const deterministic = deterministicContentValidation(revision.result, upstream, discovery, budget.maxResultPayloadBytes);
      const semantic = await model.qa(input, upstream, discovery, revision.result, deterministic);
      const merged = mergeContentQA(deterministic, semantic.value, semantic.usage, discovery);
      this.log(step, { role: "QA", provider: semantic.attribution.provider, model: semantic.attribution.model, qaOutcome: merged.recommendation, qaScore: merged.score });
      // The one bounded revision is spent: a clean-but-still-improvable result
      // goes to a human rather than looping.
      const resolved = merged.passed && merged.recommendation === "revise" ? { ...merged, recommendation: "human_review_required" as const } : merged;
      return contentQAStepSchema.parse({
        qa: resolved,
        crossModelReview: {
          ...revision.result.crossModelReview ?? { generator: semantic.attribution, critic: null, findings: [], summary: "No independent critique was recorded for this artifact." },
          outcome: resolved.recommendation === "human_review_required" ? "HUMAN_REVIEW_REQUIRED" : (revision.result.crossModelReview?.outcome ?? "AGREED"),
        },
      });
    }

    if (step.stepKey === "finalize-content-intelligence") {
      const final = requirePrior(step, "final-content-qa", (value) => contentQAStepSchema.parse(value));
      if (!final.qa.passed || final.qa.recommendation === "revise") throw new ContentExecutionError("CONTENT_QA_REJECTED", false, "Final QA did not accept the backlog; nothing was advanced to human review.");
      const output = channelContentIntelligenceResultSchema.parse({
        ...revision.result,
        crossModelReview: final.crossModelReview,
      }) satisfies ChannelContentIntelligenceResult;
      this.log(step, {
        humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: final.qa.score, backlogSize: output.backlog.length,
        recommendedTopicId: output.nextVideoRecommendation.topicId,
        crossModelOutcome: output.crossModelReview?.outcome,
        providers: [...new Set(output.modelProvenance.map((item) => item.provider))],
      });
      return output;
    }
    throw new ContentExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported content-intelligence step ${step.stepKey}.`);
  }
}
