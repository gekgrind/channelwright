import {
  channelVideoIntelligenceResultSchema,
  videoIntelligenceQAResultSchema,
  type ApprovedVideoPortfolioSet,
  type ChannelVideoIntelligenceResult,
  type VideoIntelligenceConstraints,
  type VideoIntelligenceQAResult,
} from "@/domain/production-workflows";
import { canonicalEquals } from "./canonical-json";
import {
  chronological,
  cyclesWithCommittedAtRisk,
  deriveIntelligenceReady,
  deriveIntelligenceRequiresHumanJudgment,
  deriveViewerValueTrend,
  IMPLICATION_PERMITTED_ADOPTION_STANCES,
  learningExceedsEvidenceCeiling,
  VIEWER_VALUE_BEARING_PATTERN_CLASSES,
} from "./video-intelligence-cycles";

export type Finding = { severity: "error" | "warning" | "info"; code: string; message: string; evidenceIds: string[] };

export type IntelligenceValidationContext = {
  result: ChannelVideoIntelligenceResult;
  set: ApprovedVideoPortfolioSet;
  expectedConstraints: VideoIntelligenceConstraints;
  maxPayloadBytes: number;
};

export type IntelligenceRule = { code: string; severity: Finding["severity"]; check: (ctx: IntelligenceValidationContext) => string[] };

// --- Fabricated-quantity detection ------------------------------------------
// A channel learning statement is qualitative. Intelligence has no analytics
// input whatsoever -- it reads closed-vocabulary projections of prior
// allocations, nothing numeric about audience behaviour -- and its contract has
// no numeric field beyond server-derived counts. Any asserted magnitude,
// forecast, duration, or measurement in record prose is therefore fabricated.
// Cycle ordinals ("cycle 2", "the third horizon") stay legal because they label
// rather than measure.
const CARDINAL = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion";
const QUANTITY_NOUN = "%|percent|per ?cent|percentage points?|points?|pp|x|hours?|hrs?|days?|weeks?|months?|quarters?|years?|minutes?|mins?|seconds?|secs?|viewers?|views?|impressions?|sessions?|subscribers?|clicks?|comments?|likes?|shares?|samples?|participants?|responses?|data ?points?|dollars?|usd";
const DIGIT_RUN = /(?<![\p{L}\p{N}_:.-])\d[\d,]*(?:\.\d+)?/gu;
const YEAR = /^20\d\d$/;
const LABEL_BEFORE = /\b(?:cycle|horizon|rank|slot|position|priority|tier|phase|step|stage|wave|round|batch|option|variant|candidate|item|group|learning|question|figure|table)s?\s*[#-]?\s*$/i;
const QUANTITY_AFTER = new RegExp("^\\s*[- ]?(?:" + QUANTITY_NOUN + ")(?:\\b|(?![\\p{L}\\p{N}]))", "iu");
const STRUCTURAL_NOUN_AFTER = /^\s*[- ]?(?:parts?|steps?|stages?|phases?|slots?|ranks?|tiers?|waves?|rounds?|cycles?|horizons?|candidates?|experiments?|learnings?|items?|allocations?)\b/i;
const SPELLED_QUANTITY = new RegExp("\\b(?:" + CARDINAL + ")(?:[- ](?:" + CARDINAL + "))?\\s+(?:" + QUANTITY_NOUN + ")\\b", "i");
const MAGNITUDE_CONTEXT = new RegExp(
  "\\b(?:at least|at most|no (?:fewer|less|more) than|up to|over|under|around|roughly|approximately|about|nearly|minimum of|maximum of|target(?:ing)? (?:of )?|a target of|baseline (?:of|is|was|sits at)|currently (?:at|around|about)|sits at|stands at|on the order of|in the range of)\\s+(?:\\$?\\d|(?:" + CARDINAL + ")\\b)",
  "i",
);
const FABRICATED_STAT = /\b(?:statistical(?:ly)? significan\w*|p[-\s]?values?|confidence intervals?|significance (?:level|threshold|test)|power analysis|statistically powered|effect sizes? of|minimum detectable effect|\bmde\b|sample sizes?)/i;
const FABRICATED_FORECAST = /\b(?:\d+(?:\.\d+)?\s*x\s*(?:lift|increase|improvement|return)|expects? (?:a |an |some |roughly |around |about |significant |large |modest |small |substantial |meaningful )*(?:lift|uplift|roi|return|gain|increase|improvement|bump|jump|boost|rise)|anticipat\w+ (?:a |an |some )?(?:lift|uplift|increase|improvement|gain|bump)|expected (?:lift|roi|return|gain|increase|improvement|value) of|projected (?:roi|revenue|lift|views|growth|return)|\d+(?:\.\d+)?\s*%\s*(?:lift|increase|improvement|uplift|gain)|(?:lift|uplift|bump|gain|increase|improvement) of (?:\d|about|roughly|around|approximately)|(?:double|triple|halve|quadruple) (?:the |our )?(?:ctr|click[- ]?through|retention|views|watch ?time|subscribers|engagement)|highest (?:expected |projected )?(?:roi|return on investment)|best (?:expected |projected )(?:return|roi))/i;
const CAUSAL_CERTAINTY = /\b(?:will definitely (?:increase|improve|raise|lift|grow)|is guaranteed to (?:increase|improve|raise|lift|grow|win)|certainly causes?|definitively (?:causes?|explains?|proves?)|conclusively prov\w+|proven to (?:increase|improve|cause))/i;

// --- Scope-boundary detection -----------------------------------------------
// Intelligence synthesizes what a channel has learned and signals whether the
// anchored strategy warrants review. It authors no strategy, no backlog, no
// research conclusion, no allocation, no experiment, no production content, and
// executes nothing.

/**
 * CHANNEL_STRATEGY's artifact. Intelligence may NAME a contradicted element on
 * the structured `contradictedElements` surface; writing the replacement -- new
 * positioning, a redefined audience, a new pillar set, a rewritten promise or KPI
 * framework -- is Strategy's job and is rejected here. Deliberately narrower than
 * a ban on the word "strategy": naming "the strategy's audience assumption is
 * contradicted" is exactly this workflow's output.
 */
const STRATEGY_AUTHORSHIP_LEAKED = /\b(?:rewrite the (?:channel )?strategy|revise the (?:channel )?(?:strategy|positioning)|redefine the (?:audience|niche|pillars?|promise|positioning)|redefin\w* (?:our|the channel(?:'s)?) (?:audience|niche|positioning)|the new (?:positioning|audience|niche|promise|thesis) (?:is|should be|becomes)|(?:set|change|update) the (?:channel(?:'s)? )?(?:positioning|promise|thesis) to|new (?:content )?pillars? (?:is|are|should be|:)|add a (?:new )?(?:content )?pillar|replace the (?:pillars?|positioning|promise|thesis)|reposition the channel as|the channel should now be about|pivot the channel to)/i;

/**
 * CHANNEL_CONTENT_INTELLIGENCE's artifact -- the prospective backlog. Naming a
 * topic to make, a next video, or a ranked backlog is that workflow's output, not
 * a retrospective learning.
 */
const CONTENT_BACKLOG_LEAKED = /\b(?:next video should be|make a video (?:about|on)|the next (?:topic|video) (?:is|should be)|content backlog|topic backlog|video ideas?|recommended topics?|shortlist of topics?|produce a video (?:about|on)|script an? (?:video|episode)|title (?:idea|should be)|thumbnail (?:concept|should)|publish(?:ing)? (?:calendar|schedule))\b/i;

/** CHANNEL_RESEARCH's artifact. Intelligence reads no market evidence and may invent no market conclusion. */
const RESEARCH_CONCLUSION_INVENTED = /\b(?:the market (?:is|shows|wants|demands)|competitors? (?:are|is|have|has|show)|search (?:volume|demand|interest) (?:is|shows|for)|audience demand (?:is|shows)|the niche (?:is|has) (?:saturated|underserved|growing)|industry benchmark|category benchmark|according to (?:our )?research)\b/i;

/** CHANNEL_VIDEO_PORTFOLIO's artifact. Allocating capacity, committing, deferring, ranking or sequencing a slate is Portfolio's. */
const PORTFOLIO_ALLOCATION_LEAKED = /\b(?:commit (?:to )?(?:this|these|the) experiments?|allocate (?:the |our |remaining )?(?:capacity|slots?)|defer (?:this|these|the) experiments?|next cycle should (?:run|commit|prioriti[sz]e)|prioriti[sz]e (?:these|the following) experiments?|run (?:these|the following) experiments? next|experiment slate|rank the experiments?|capacity plan|which experiments? to run next)\b/i;

/** CHANNEL_VIDEO_EXPERIMENT / DECISION / DIAGNOSIS artifacts. */
const EXPERIMENT_REDESIGN_LEAKED = /\b(?:change the (?:treatment|control|primary metric|guardrail|hypothesis|stopping condition|rollback)|redesign (?:the |this |that )?experiments?|revise the (?:experiment|treatment|control|design)|swap the (?:control|treatment)|widen the (?:guardrail|window)|drop the (?:guardrail|control|stopping condition)|add a (?:new )?(?:variant|arm|treatment) to|the experiment should (?:instead |actually )?(?:test|measure|use))\b/i;
const DECISION_REWRITTEN = /\b(?:the (?:decision|call) (?:should|ought to|must|needs to) (?:instead |actually |really |now )?be\b|revise the decisions?|the decision was wrong|change the decision to|reject the decision|override the decision|the approved decision is (?:incorrect|mistaken|premature|wrong)|re[- ]?diagnose|the diagnosis was (?:wrong|incorrect|mistaken)|re[- ]?run the diagnosis)/i;

/** Any execution whatsoever. Intelligence is a durable record; an operator acts on it. */
const EXECUTION_LEAKED = /\b(?:publish|upload|go[- ]live|schedule the (?:video|upload|post|release)|push (?:it |this |the video )?live|re[- ]?upload|send (?:a |the )?notification|notify subscribers|run (?:an? )?ad|ad spend|boost the post|connect (?:the |your )?(?:youtube |google )?account|oauth|api key|set the thumbnail live|change the (?:live |published )title|start a (?:new )?(?:strategy|research) (?:run|workflow)|kick off a strategy)\b/i;

// --- Growth-only argument ----------------------------------------------------
// The prose consistency signal for `justifiedByAudienceGrowthAlone`. A learning
// argued purely from audience/metric upside, with nothing about evidence,
// uncertainty, viewer response, capability, or measurement quality anywhere in
// its statement or evidence basis, contradicts a `false` declaration.
const GROWTH_ARGUMENT = /\b(?:biggest|largest|greatest|highest|most|best)\s+(?:expected\s+|projected\s+|potential\s+|likely\s+)?(?:upside|growth|gain|return|payoff|impact|lift|win|roi|revenue|reach|views|subscribers|ctr|click[- ]?through)|\b(?:expected|projected|likely|potential)\s+(?:growth|upside|gain|return|payoff|lift|revenue|reach)\b|\b(?:grow|maximis|maximiz|boost|drive)\w*\s+(?:the\s+)?(?:channel|views|subscribers|revenue|reach|ctr|click[- ]?through|watch ?time)\b|\bfastest\s+(?:growth|path to growth|way to grow)\b|\bwhat\s+(?:grows|grew)\s+(?:the\s+)?(?:channel|audience)\b/i;
const EVIDENCE_ANCHOR = /\b(?:evidence|uncertain\w*|unknown|learn\w*|inform\w*|decision|diagnos\w*|hypothes\w*|confound\w*|interpret\w*|viewer value|satisfaction|retention|trust|promise|guardrail|reversib\w*|capacity|measure\w*|instrument\w*|falsif\w*|contradict\w*|assumption|pillar|categor\w*|mechanis\w*|risk)/i;

const normalize = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();

/** Every model-authored free-text surface in the record. Server-derived scalars and ids are excluded by construction. */
function freeText(result: ChannelVideoIntelligenceResult): string[] {
  const record = result.content.record;
  return [
    record.objective,
    record.reviewTrigger,
    ...record.viewerValueGuardrails,
    ...record.learnings.flatMap((learning) => [learning.statement, learning.evidenceBasis, learning.whatWouldFalsifyThis]),
    ...record.openQuestions.flatMap((question) => [question.question, question.whyItMatters, question.howItCouldBeAnswered]),
    ...record.channelRisks.flatMap((risk) => [risk.risk, risk.mitigation]),
    record.strategyReviewSignal.rationale,
    ...record.strategyReviewSignal.contradictedElements.map((entry) => entry.contradictionSummary),
    ...result.content.alternatives.flatMap((alternative) => [alternative.statement, alternative.notSelectedReason]),
    result.content.viewerValueSafeguards.metricGamingRisk,
    result.content.viewerValueSafeguards.guardedMetricGaming,
  ];
}

/** A digit that measures rather than labels. Ordinals after a structural noun, and bare years, are legal. */
function quantityFindings(text: string): boolean {
  if (SPELLED_QUANTITY.test(text) || MAGNITUDE_CONTEXT.test(text)) return true;
  for (const match of text.matchAll(DIGIT_RUN)) {
    const token = match[0];
    if (YEAR.test(token)) continue;
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + token.length);
    if (LABEL_BEFORE.test(before) || STRUCTURAL_NOUN_AFTER.test(after)) continue;
    if (QUANTITY_AFTER.test(after)) return true;
    return true;
  }
  return false;
}

const rule = (code: string, severity: Finding["severity"], check: IntelligenceRule["check"]): IntelligenceRule => ({ code, severity, check });

export const DETERMINISTIC_VIDEO_INTELLIGENCE_RULES: IntelligenceRule[] = [
  // --- Upstream identity and provenance --------------------------------------
  rule("UPSTREAM_REFERENCE_ALTERED", "error", ({ result, set }) =>
    canonicalEquals(result.approvedVideoPortfolioReferences, set.artifacts.map((artifact) => artifact.reference))
      ? []
      : ["The persisted approved Portfolio references do not match the authoritative resolved set."]),
  rule("INTELLIGENCE_SCOPE_ALTERED", "error", ({ result, set }) =>
    canonicalEquals(result.intelligenceScope, set.intelligenceScope) ? [] : ["The intelligence scope does not match the server-assembled lineage projection."]),
  rule("CONSTRAINTS_ALTERED", "error", ({ result, expectedConstraints }) =>
    canonicalEquals(result.intelligenceConstraints, expectedConstraints) ? [] : ["The persisted constraints do not match the server-derived constraints for this horizon."]),
  rule("SOURCE_IDENTITY_MISMATCH", "error", ({ result, expectedConstraints }) => {
    const problems: string[] = [];
    if (result.source.cycleCount !== expectedConstraints.cycles.length) problems.push("cycleCount does not match the resolved cycle set.");
    if (!canonicalEquals([...result.source.portfolioRunIds].sort(), expectedConstraints.cycles.map((cycle) => cycle.portfolioRunId).sort())) problems.push("portfolioRunIds do not match the resolved cycle set.");
    if (result.source.anchoredStrategyRunId !== expectedConstraints.anchoredStrategyRunId) problems.push("anchoredStrategyRunId does not match the server-resolved strategy anchor.");
    if (result.source.horizonLabel !== expectedConstraints.horizonLabel) problems.push("horizonLabel does not match the declared horizon.");
    return problems;
  }),
  rule("STRATEGY_ANCHOR_NOT_SHARED", "error", ({ expectedConstraints }) => {
    const anchors = new Set(expectedConstraints.cycles.map((cycle) => cycle.strategyRunId));
    return anchors.size === 1 && anchors.has(expectedConstraints.anchoredStrategyRunId)
      ? []
      : ["The resolved cycles do not all descend from the anchored CHANNEL_STRATEGY run."];
  }),

  // --- Cross-cycle grounding -------------------------------------------------
  rule("LEARNING_CITES_UNKNOWN_CYCLE", "error", ({ result, expectedConstraints }) => {
    const citable = new Set(expectedConstraints.citableCycleIds);
    return result.content.record.learnings.flatMap((learning) =>
      [...learning.supportingCycleIds, ...learning.contradictingCycleIds]
        .filter((id) => !citable.has(id))
        .map((id) => `${learning.id} cites cycle ${id}, which is not in the resolved horizon.`));
  }),
  rule("ALTERNATIVE_CITES_UNKNOWN_SIGNAL", "error", ({ result }) =>
    result.content.alternatives
      .filter((alternative) => alternative.signal === result.content.record.strategyReviewSignal.signal)
      .map((alternative) => `${alternative.id} restates the selected signal rather than proposing a genuinely different one.`)),
  rule("LEARNING_NOT_CROSS_CYCLE", "error", ({ result }) =>
    result.content.record.learnings
      .filter((learning) => new Set(learning.supportingCycleIds).size < 2)
      .map((learning) => `${learning.id} rests on fewer than two distinct cycles and is not channel-level learning.`)),
  rule("PATTERN_CLASS_NOT_OBSERVED", "error", ({ result, expectedConstraints }) => {
    // A concentration or recurrence claim is only meaningful when the horizon
    // actually committed experiments to observe. An empty horizon can still
    // produce EVIDENCE_GAP / CAPACITY / STRATEGY_ASSUMPTION learnings.
    const observational = new Set(["RECURRING_DIAGNOSIS_CATEGORY", "TREATMENT_MECHANISM_REPEATEDLY_SELECTED", "PILLAR_CONCENTRATION", "VIEWER_VALUE_RISK_RECURS", "CONFOUNDING_LIMITS_INTERPRETATION"]);
    return expectedConstraints.totalCommittedExperiments === 0
      ? result.content.record.learnings
        .filter((learning) => observational.has(learning.patternClass))
        .map((learning) => `${learning.id} claims an observed pattern but no cycle in this horizon committed an experiment.`)
      : [];
  }),
  rule("CONFIDENCE_EXCEEDS_EVIDENCE_CEILING", "error", ({ result, expectedConstraints }) =>
    result.content.record.learnings
      .filter((learning) => learningExceedsEvidenceCeiling(learning, expectedConstraints))
      .map((learning) => `${learning.id} claims ${learning.confidence} confidence above the horizon evidence ceiling of ${expectedConstraints.evidenceCeiling}.`)),

  // --- Viewer Value ----------------------------------------------------------
  rule("HARMFUL_PRACTICE_ADOPTED", "error", ({ result }) =>
    result.content.record.learnings
      .filter((learning) => !IMPLICATION_PERMITTED_ADOPTION_STANCES[learning.viewerValueImplication].includes(learning.adoptionStance))
      .map((learning) => `${learning.id} records adoption stance ${learning.adoptionStance}, which its ${learning.viewerValueImplication} Viewer Value implication does not permit.`)),
  rule("VIEWER_VALUE_IMPLICATION_CONTRADICTS_PATTERN", "error", ({ result }) =>
    result.content.record.learnings
      .filter((learning) => VIEWER_VALUE_BEARING_PATTERN_CLASSES.has(learning.patternClass) && learning.viewerValueImplication === "NEUTRAL")
      .map((learning) => `${learning.id} is classified as a recurring Viewer Value risk but records a neutral implication.`)),
  rule("GROWTH_ONLY_LEARNING_HIGH_CONFIDENCE", "error", ({ result }) =>
    result.content.record.learnings
      .filter((learning) => learning.justifiedByAudienceGrowthAlone && learning.confidence === "high")
      .map((learning) => `${learning.id} is supported only by audience growth and cannot be held with high confidence.`)),
  rule("GROWTH_ONLY_LEARNING_ADOPTED", "error", ({ result }) =>
    result.content.record.learnings
      .filter((learning) => learning.justifiedByAudienceGrowthAlone && learning.adoptionStance === "ADOPT_AS_CHANNEL_PRACTICE")
      .map((learning) => `${learning.id} is supported only by audience growth and cannot become channel practice.`)),
  rule("GROWTH_ONLY_ARGUMENT_UNDECLARED", "error", ({ result }) =>
    result.content.record.learnings
      .filter((learning) => !learning.justifiedByAudienceGrowthAlone
        && GROWTH_ARGUMENT.test(`${learning.statement} ${learning.evidenceBasis}`)
        && !EVIDENCE_ANCHOR.test(`${learning.statement} ${learning.evidenceBasis}`))
      .map((learning) => `${learning.id} argues purely from audience growth while declaring it is not growth-only.`)),
  rule("GROWTH_ONLY_STRATEGY_SIGNAL", "error", ({ result }) => {
    const growthOnly = new Set(result.content.record.learnings.filter((learning) => learning.justifiedByAudienceGrowthAlone).map((learning) => learning.id));
    return result.content.record.strategyReviewSignal.contradictedElements.flatMap((entry) =>
      entry.supportingLearningIds
        .filter((id) => growthOnly.has(id))
        .map((id) => `The strategy review signal rests on ${id}, a learning supported only by audience growth.`));
  }),
  rule("VIEWER_VALUE_TREND_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.record.viewerValueTrend === expectedConstraints.viewerValueTrend
      && result.content.viewerValueSafeguards.trend === expectedConstraints.viewerValueTrend
      && expectedConstraints.viewerValueTrend === deriveViewerValueTrend(expectedConstraints.cycles)
      ? []
      : ["viewerValueTrend does not match the server-derived Viewer Value trajectory of this horizon."]),
  rule("DETERIORATING_TREND_NOT_ESCALATED", "error", ({ result, expectedConstraints }) =>
    expectedConstraints.viewerValueTrend === "DETERIORATING" && !result.content.record.requiresHumanJudgment
      ? ["The channel committed proportionally more at-risk work later in the horizon; the record must escalate to human judgment."]
      : []),
  rule("DETERIORATING_TREND_UNGUARDED", "error", ({ result, expectedConstraints }) =>
    expectedConstraints.viewerValueTrend === "DETERIORATING"
      && !/\b(?:at[- ]risk|viewer value|deteriorat\w*|worsen\w*|degrad\w*|escalat\w*)/i.test(result.content.viewerValueSafeguards.metricGamingRisk)
      ? ["A deteriorating Viewer Value trajectory must be named in the metric-gaming exposure, not left implicit."]
      : []),
  rule("VIEWER_VALUE_SAFEGUARDS_MISMATCH", "error", ({ result, expectedConstraints }) => {
    const safeguards = result.content.viewerValueSafeguards;
    const problems: string[] = [];
    if (!canonicalEquals(safeguards.cyclesWithCommittedAtRiskIds, cyclesWithCommittedAtRisk(expectedConstraints.cycles))) problems.push("cyclesWithCommittedAtRiskIds does not match the resolved cycle set.");
    if (safeguards.escalationRequired !== expectedConstraints.escalationRequired) problems.push("escalationRequired does not match the server-derived escalation requirement.");
    return problems;
  }),
  rule("NO_VIEWER_VALUE_GUARDRAIL", "error", ({ result }) =>
    result.content.record.viewerValueGuardrails.filter((guardrail) => guardrail.trim().length > 0).length === 0
      ? ["The horizon carries no Viewer Value guardrail."]
      : []),
  rule("NO_CHANNEL_RISK", "error", ({ result }) =>
    result.content.record.channelRisks.filter((risk) => risk.mitigation.trim().length > 0).length === 0
      ? ["The record names no channel-level risk with a mitigation."]
      : []),
  rule("NO_OPEN_QUESTION", "error", ({ result }) =>
    result.content.record.openQuestions.length === 0 ? ["A channel learning record must name what the channel still does not know."] : []),

  // --- Strategy signal boundary ----------------------------------------------
  rule("STRATEGY_SIGNAL_ANCHOR_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.record.strategyReviewSignal.anchoredStrategyRunId === expectedConstraints.anchoredStrategyRunId
      ? []
      : ["The strategy review signal is anchored to a strategy run other than the one every cycle descends from."]),
  rule("STRATEGY_SIGNAL_CITES_UNKNOWN_LEARNING", "error", ({ result }) => {
    const learningIds = new Set(result.content.record.learnings.map((learning) => learning.id));
    return result.content.record.strategyReviewSignal.contradictedElements.flatMap((entry) =>
      entry.supportingLearningIds.filter((id) => !learningIds.has(id)).map((id) => `The strategy review signal cites ${id}, which is not a learning in this record.`));
  }),
  rule("REVISION_SIGNAL_WITHOUT_CROSS_CYCLE_EVIDENCE", "error", ({ result }) => {
    if (result.content.record.strategyReviewSignal.signal !== "REVISE_RECOMMENDED") return [];
    const byId = new Map(result.content.record.learnings.map((learning) => [learning.id, learning]));
    return result.content.record.strategyReviewSignal.contradictedElements.flatMap((entry) =>
      entry.supportingLearningIds
        .map((id) => byId.get(id))
        .filter((learning) => learning !== undefined && learning.confidence === "low")
        .map((learning) => `Element ${entry.element} rests on low-confidence learning ${learning!.id}; a strategy review recommendation needs better than that.`));
  }),

  // --- Epistemic discipline --------------------------------------------------
  rule("FABRICATED_QUANTITY_IN_RECORD", "error", ({ result }) =>
    freeText(result).some((text) => quantityFindings(text))
      ? ["The record asserts a quantity; Intelligence has no analytics input and no numeric field in its contract."]
      : []),
  rule("FABRICATED_STATISTICAL_CLAIM", "error", ({ result }) =>
    freeText(result).some((text) => FABRICATED_STAT.test(text)) ? ["The record makes a statistical claim no Channelwright contract can produce."] : []),
  rule("FABRICATED_RETURN_FORECAST", "error", ({ result }) =>
    freeText(result).some((text) => FABRICATED_FORECAST.test(text)) ? ["The record forecasts a lift, return, or ROI that no Channelwright contract can produce."] : []),
  rule("CAUSAL_CERTAINTY_CLAIMED", "error", ({ result }) =>
    freeText(result).some((text) => CAUSAL_CERTAINTY.test(text)) ? ["The record claims causal certainty about an unresolved channel pattern."] : []),

  // --- Scope boundary --------------------------------------------------------
  rule("STRATEGY_AUTHORSHIP_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => STRATEGY_AUTHORSHIP_LEAKED.test(text))
      ? ["The record authors replacement channel strategy; Intelligence signals that strategy needs review, CHANNEL_STRATEGY writes it."]
      : []),
  rule("CONTENT_BACKLOG_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => CONTENT_BACKLOG_LEAKED.test(text))
      ? ["The record proposes topics or a next video, which is CHANNEL_CONTENT_INTELLIGENCE's responsibility."]
      : []),
  rule("RESEARCH_CONCLUSION_INVENTED", "error", ({ result }) =>
    freeText(result).some((text) => RESEARCH_CONCLUSION_INVENTED.test(text))
      ? ["The record asserts a market or competitor conclusion; Intelligence retrieves no evidence and CHANNEL_RESEARCH owns those."]
      : []),
  rule("PORTFOLIO_ALLOCATION_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => PORTFOLIO_ALLOCATION_LEAKED.test(text))
      ? ["The record allocates capacity or prioritises experiments, which is CHANNEL_VIDEO_PORTFOLIO's responsibility."]
      : []),
  rule("EXPERIMENT_REDESIGN_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => EXPERIMENT_REDESIGN_LEAKED.test(text))
      ? ["The record redesigns an approved experiment, which is CHANNEL_VIDEO_EXPERIMENT's responsibility."]
      : []),
  rule("DECISION_REWRITTEN_IN_INTELLIGENCE", "error", ({ result }) =>
    freeText(result).some((text) => DECISION_REWRITTEN.test(text))
      ? ["The record revisits a Decision or Diagnosis rather than synthesizing what the channel learned."]
      : []),
  rule("INTELLIGENCE_EXECUTION_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => EXECUTION_LEAKED.test(text))
      ? ["The record contains publishing / provider / workflow-launch instructions Intelligence is never allowed to issue."]
      : []),

  // --- Derived-field tampering ----------------------------------------------
  rule("LEARNING_COUNT_MISMATCH", "error", ({ result }) =>
    result.content.record.learningCount === result.content.record.learnings.length ? [] : ["learningCount does not match the recorded learnings."]),
  rule("CYCLES_CONSIDERED_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.record.cyclesConsidered === expectedConstraints.cycles.length ? [] : ["cyclesConsidered does not match the resolved cycle set."]),
  rule("HORIZON_LABEL_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.record.horizonLabel === expectedConstraints.horizonLabel ? [] : ["horizonLabel does not match the operator-declared horizon."]),
  rule("REQUIRES_HUMAN_JUDGMENT_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.record.requiresHumanJudgment === deriveIntelligenceRequiresHumanJudgment(result.content.record, expectedConstraints)
      ? []
      : ["requiresHumanJudgment does not match the server-derived escalation state of this horizon."]),
  rule("INTELLIGENCE_READY_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.intelligenceReady === deriveIntelligenceReady(result.content.record, expectedConstraints)
      ? []
      : ["intelligenceReady does not match the server-derived readiness of this record."]),
  rule("CHRONOLOGY_MISMATCH", "error", ({ result, expectedConstraints }) =>
    canonicalEquals(result.intelligenceConstraints.chronology, chronological(expectedConstraints.cycles).map((cycle) => cycle.cycleId))
      ? []
      : ["The recorded chronology does not match the immutable allocation order of the resolved cycles."]),

  // --- Alternatives ----------------------------------------------------------
  rule("MISSING_ALTERNATIVE", "error", ({ result }) =>
    result.content.alternatives.some((alternative) => alternative.signal !== result.content.record.strategyReviewSignal.signal)
      ? []
      : ["At least one alternative must propose a genuinely different strategy review signal."]),
  rule("ALTERNATIVE_NOT_REJECTED", "error", ({ result }) =>
    result.content.alternatives.filter((alternative) => alternative.notSelectedReason.trim().length === 0).map((alternative) => `${alternative.id} has no rejection basis.`)),
  rule("DUPLICATE_LEARNING_STATEMENT", "error", ({ result }) => {
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const learning of result.content.record.learnings) {
      const key = normalize(learning.statement);
      const prior = seen.get(key);
      if (prior) problems.push(`${learning.id} restates ${prior}; a channel learning record must not carry the same lesson twice.`);
      else seen.set(key, learning.id);
    }
    return problems;
  }),

  // --- Model authority / payload --------------------------------------------
  rule("CRITIC_REJECTED_INTELLIGENCE", "error", ({ result }) =>
    !result.crossModelReview.safeToFinalize || result.crossModelReview.findings.some((item) => item.severity === "error")
      ? ["The independent critic found a blocking issue; automated revision is forbidden."]
      : []),
  rule("MODEL_PROVIDER_INDEPENDENCE_REQUIRED", "error", ({ result }) =>
    result.modelProvenance.length !== 2 || result.modelProvenance[0].provider === result.modelProvenance[1].provider
      ? ["Intelligence requires exactly one analyst and one distinct-provider critic attribution."]
      : []),
  rule("RESULT_PAYLOAD_TOO_LARGE", "error", ({ result, maxPayloadBytes }) =>
    Buffer.byteLength(JSON.stringify(result), "utf8") > maxPayloadBytes ? ["The channel learning record exceeds the pre-persistence payload ceiling."] : []),
];

/**
 * `expectedConstraints` is deliberately REQUIRED rather than defaulted. Like
 * Portfolio, an Intelligence record's constraints depend on operator input (the
 * horizon label) that is not recoverable from the upstream artifacts alone, so any
 * default would have to read it back out of the very result being checked --
 * which would quietly turn the tamper rules self-referential. Callers pass the
 * constraints derived from the run's own input at `derive-intelligence-constraints`.
 */
export function deterministicVideoIntelligenceValidation(
  result: ChannelVideoIntelligenceResult,
  set: ApprovedVideoPortfolioSet,
  expectedConstraints: VideoIntelligenceConstraints,
  maxPayloadBytes = 56_000,
): Finding[] {
  const ctx: IntelligenceValidationContext = { result, set, expectedConstraints, maxPayloadBytes };
  return DETERMINISTIC_VIDEO_INTELLIGENCE_RULES.flatMap((intelligenceRule) =>
    intelligenceRule.check(ctx).map((message) => ({ severity: intelligenceRule.severity, code: intelligenceRule.code, message, evidenceIds: [] as string[] })));
}

export function videoIntelligenceQA(findings: Finding[]): VideoIntelligenceQAResult {
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const distinctFailedCodes = new Set(findings.map((item) => item.code)).size;
  return videoIntelligenceQAResultSchema.parse({
    passed: errors === 0,
    score: Math.max(0, 100 - errors * 20 - warnings * 5),
    findings: findings.slice(0, 50),
    recommendation: errors === 0 ? (warnings === 0 ? "accept" : "human_review_required") : "revise",
    deterministicChecksPassed: Math.max(0, DETERMINISTIC_VIDEO_INTELLIGENCE_RULES.length - distinctFailedCodes),
    deterministicChecksFailed: distinctFailedCodes,
    modelUsage: { model: "deterministic", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
}

export function parseVideoIntelligenceResult(value: unknown) {
  return channelVideoIntelligenceResultSchema.parse(value);
}

/**
 * The exact object the `final-video-intelligence-qa` step persists through
 * `complete_workflow_step`. `crossModelReview` is present twice -- once on its own
 * and once inside `result` -- so this envelope is always strictly larger than
 * `result`, which is why `maxResultPayloadBytes` alone cannot keep the persisted
 * step output under the database ceiling.
 */
export type VideoIntelligenceQaStepEnvelope = { qa: unknown; crossModelReview: unknown; result: unknown };

/** UTF-8 byte size of the serialized QA step envelope -- what Postgres measures as `octet_length(p_output::text)`. */
export function videoIntelligenceQaStepEnvelopeBytes(envelope: VideoIntelligenceQaStepEnvelope): number {
  return Buffer.byteLength(JSON.stringify(envelope), "utf8");
}
