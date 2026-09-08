import {
  channelVideoPortfolioResultSchema,
  videoPortfolioQAResultSchema,
  type ApprovedVideoExperimentSet,
  type ChannelVideoPortfolioResult,
  type VideoPortfolioConstraints,
  type VideoPortfolioQAResult,
} from "@/domain/production-workflows";
import { canonicalEquals } from "./canonical-json";
import {
  committedItems,
  deriveCapacityUtilization,
  derivePortfolioReady,
  derivePortfolioRequiresHumanJudgment,
  DISPOSITION_PERMITTED_SELECTION_BASES,
  CITATION_REQUIRED_BASES,
  PORTFOLIO_METRIC_FAMILY,
  STATE_PERMITTED_VIEWER_VALUE_DISPOSITIONS,
  VIEWER_BENEFIT_FAMILIES,
} from "./video-portfolio-candidates";

export type Finding = { severity: "error" | "warning" | "info"; code: string; message: string; evidenceIds: string[] };

export type PortfolioValidationContext = {
  result: ChannelVideoPortfolioResult;
  set: ApprovedVideoExperimentSet;
  expectedConstraints: VideoPortfolioConstraints;
  maxPayloadBytes: number;
};

export type PortfolioRule = { code: string; severity: Finding["severity"]; check: (ctx: PortfolioValidationContext) => string[] };

// --- Fabricated-quantity detection ------------------------------------------
// An allocation argument is qualitative. Any asserted magnitude, forecast,
// duration, or measurement in allocation prose is fabricated: Portfolio has no
// analytics input and no numeric field in its contract. Ranks and slot counts are
// structured integers and never appear in the scanned prose, so a bare number
// used as an ordinal label ("rank 1", "slot 2", "phase 3") stays legal while any
// number next to a measurement noun does not.
const CARDINAL = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion";
const QUANTITY_NOUN = "%|percent|per ?cent|percentage points?|points?|pp|x|hours?|hrs?|days?|weeks?|months?|quarters?|years?|minutes?|mins?|seconds?|secs?|viewers?|views?|impressions?|sessions?|subscribers?|clicks?|comments?|likes?|shares?|samples?|participants?|responses?|data ?points?|dollars?|usd";
const DIGIT_RUN = /(?<![\p{L}\p{N}_:.-])\d[\d,]*(?:\.\d+)?/gu;
const YEAR = /^20\d\d$/;
const LABEL_BEFORE = /\b(?:rank|slot|position|priority|tier|phase|step|stage|wave|round|batch|cycle|option|variant|candidate|item|group|figure|table)s?\s*[#-]?\s*$/i;
const QUANTITY_AFTER = new RegExp("^\\s*[- ]?(?:" + QUANTITY_NOUN + ")(?:\\b|(?![\\p{L}\\p{N}]))", "iu");
const STRUCTURAL_NOUN_AFTER = /^\s*[- ]?(?:parts?|steps?|stages?|phases?|slots?|ranks?|tiers?|waves?|rounds?|candidates?|experiments?|items?)\b/i;
const SPELLED_QUANTITY = new RegExp("\\b(?:" + CARDINAL + ")(?:[- ](?:" + CARDINAL + "))?\\s+(?:" + QUANTITY_NOUN + ")\\b", "i");
const MAGNITUDE_CONTEXT = new RegExp(
  "\\b(?:at least|at most|no (?:fewer|less|more) than|up to|over|under|around|roughly|approximately|about|nearly|minimum of|maximum of|target(?:ing)? (?:of )?|a target of|baseline (?:of|is|was|sits at)|currently (?:at|around|about)|sits at|stands at|on the order of|in the range of)\\s+(?:\\$?\\d|(?:" + CARDINAL + ")\\b)",
  "i",
);
const FABRICATED_STAT = /\b(?:statistical(?:ly)? significan\w*|p[-\s]?values?|confidence intervals?|significance (?:level|threshold|test)|power analysis|statistically powered|effect sizes? of|minimum detectable effect|\bmde\b|sample sizes?)/i;
const FABRICATED_FORECAST = /\b(?:\d+(?:\.\d+)?\s*x\s*(?:lift|increase|improvement|return)|expects? (?:a |an |some |roughly |around |about |significant |large |modest |small |substantial |meaningful )*(?:lift|uplift|roi|return|gain|increase|improvement|bump|jump|boost|rise)|anticipat\w+ (?:a |an |some )?(?:lift|uplift|increase|improvement|gain|bump)|expected (?:lift|roi|return|gain|increase|improvement|value) of|projected (?:roi|revenue|lift|views|growth|return)|\d+(?:\.\d+)?\s*%\s*(?:lift|increase|improvement|uplift|gain)|(?:lift|uplift|bump|gain|increase|improvement) of (?:\d|about|roughly|around|approximately)|(?:double|triple|halve|quadruple) (?:the |our )?(?:ctr|click[- ]?through|retention|views|watch ?time|subscribers|engagement)|highest (?:expected |projected )?(?:roi|return on investment)|best (?:expected |projected )(?:return|roi))/i;
const CAUSAL_CERTAINTY = /\b(?:will definitely (?:increase|improve|raise|lift|grow)|is guaranteed to (?:increase|improve|raise|lift|grow|win)|certainly causes?|definitively (?:causes?|explains?|proves?)|conclusively prov\w+|proven to (?:increase|improve|cause))/i;

// --- Scope-boundary detection -----------------------------------------------
// Portfolio decides which approved experiments a cycle carries. It never
// executes, never redesigns an experiment, never revisits a Decision, and never
// rewrites channel strategy.
const EXECUTION_LEAKED = /\b(?:publish|upload|go[- ]live|schedule the (?:video|upload|post|release)|push (?:it |this |the video )?live|re[- ]?upload|send (?:a |the )?notification|notify subscribers|run (?:an? )?ad|ad spend|boost the post|connect (?:the |your )?(?:youtube |google )?account|oauth|api key|set the thumbnail live|change the (?:live |published )title)\b/i;
const EXPERIMENT_REDESIGN_LEAKED = /\b(?:change the (?:treatment|control|primary metric|guardrail|hypothesis|stopping condition|rollback)|redesign (?:the |this )?experiment|revise the (?:experiment|treatment|control|design)|swap the (?:control|treatment)|widen the (?:guardrail|window)|drop the (?:guardrail|control|stopping condition)|add a (?:new )?(?:variant|arm|treatment) to|the experiment should (?:instead |actually )?(?:test|measure|use)|re[- ]?scope the experiment)\b/i;
const DECISION_REWRITTEN = /\b(?:the (?:decision|call) (?:should|ought to|must|needs to) (?:instead |actually |really |now )?be\b|revise the decision|the decision was wrong|change the decision to|reject the decision|override the decision|the approved decision is (?:incorrect|mistaken|premature|wrong)|re[- ]?diagnose|the diagnosis was (?:wrong|incorrect|mistaken))/i;
const INTELLIGENCE_LEAKED = /\b(?:rewrite the (?:channel )?strategy|revise the channel(?: strategy| positioning)?|strategic pivot|change the channel(?:'s)? positioning|update (?:the )?positioning|redefine the (?:audience|niche|pillars)|new content pillar)\b/i;

// --- Growth-only argument -----------------------------------------------------
// The prose consistency signal for `justifiedByPredictedGrowthAlone`. A commitment
// argued purely from expected metric upside, with nothing about evidence,
// learning, uncertainty, decision-boundedness, or viewer value anywhere in the
// rationale, contradicts a `false` declaration.
const GROWTH_ARGUMENT = /\b(?:biggest|largest|greatest|highest|most|best)\s+(?:expected\s+|projected\s+|potential\s+|likely\s+)?(?:upside|growth|gain|return|payoff|impact|lift|win|roi|revenue|reach|views|subscribers|ctr|click[- ]?through)|\b(?:expected|projected|likely|potential)\s+(?:growth|upside|gain|return|payoff|lift|revenue|reach)\b|\b(?:grow|maximis|maximiz|boost|drive)\w*\s+(?:the\s+)?(?:channel|views|subscribers|revenue|reach|ctr|click[- ]?through|watch ?time)\b|\bfastest\s+(?:growth|path to growth|way to grow)\b/i;
const EVIDENCE_ANCHOR = /\b(?:evidence|uncertain\w*|unknown|learn\w*|inform\w*|decision|diagnos\w*|hypothes\w*|confound\w*|interpret\w*|viewer value|satisfaction|retention|trust|promise|guardrail|reversib\w*|blocks?\b|depend\w*|prerequisite|sequenc\w*|redundan\w*|capacity|ready|readiness|risk)/i;

function quantityFindings(text: string): boolean {
  if (FABRICATED_STAT.test(text) || MAGNITUDE_CONTEXT.test(text) || SPELLED_QUANTITY.test(text)) return true;
  DIGIT_RUN.lastIndex = 0;
  for (const match of text.matchAll(DIGIT_RUN)) {
    const digits = match[0];
    const index = match.index ?? 0;
    if (YEAR.test(digits.replace(/,/g, ""))) continue;
    const before = text.slice(Math.max(0, index - 40), index);
    const after = text.slice(index + digits.length);
    if (QUANTITY_AFTER.test(after)) return true;
    if (STRUCTURAL_NOUN_AFTER.test(after)) continue;
    if (LABEL_BEFORE.test(before)) continue;
    return true;
  }
  return false;
}

/** Every model-authored prose surface in the allocation. Operator-supplied values (cycle label) and server-derived ids are deliberately excluded. */
function freeText(result: ChannelVideoPortfolioResult): string[] {
  const { allocation, alternatives, viewerValueSafeguards } = result.content;
  return [
    allocation.objective,
    allocation.allocationHypothesis,
    allocation.sequencingNotes,
    allocation.reviewTrigger,
    ...allocation.items.flatMap((item) => [item.rationale, ...(item.revisitCondition ? [item.revisitCondition] : [])]),
    ...allocation.portfolioRisks.flatMap((risk) => [risk.risk, risk.mitigation]),
    ...allocation.viewerValueGuardrails,
    ...allocation.knownUnknowns,
    ...alternatives.flatMap((alternative) => [alternative.statement, alternative.notSelectedReason]),
    viewerValueSafeguards.metricGamingRisk,
    viewerValueSafeguards.guardedMetricGaming,
  ];
}

const rule = (code: string, severity: Finding["severity"], check: (ctx: PortfolioValidationContext) => string[]): PortfolioRule => ({ code, severity, check });

/**
 * The single authoritative rule catalogue. `deterministicChecksPassed` /
 * `deterministicChecksFailed` are always computed from this array's length and
 * from distinct failed codes -- never from a hand-maintained literal -- so an
 * added or removed rule can never silently drift the reported count out of sync
 * with what actually ran.
 */
export const DETERMINISTIC_VIDEO_PORTFOLIO_RULES: PortfolioRule[] = [
  // --- Upstream integrity ----------------------------------------------------
  rule("UPSTREAM_EXPERIMENT_REFERENCES_CHANGED", "error", ({ result, set }) =>
    canonicalEquals(result.approvedVideoExperimentReferences, set.artifacts.map((artifact) => artifact.reference))
      ? []
      : ["The portfolio changed the exact approved Experiment references."]),
  rule("PORTFOLIO_SCOPE_CHANGED", "error", ({ result, set }) =>
    canonicalEquals(result.portfolioScope, set.portfolioScope) ? [] : ["The portfolio changed the authoritative compact lineage projection."]),
  rule("PORTFOLIO_CONSTRAINTS_CHANGED", "error", ({ result, expectedConstraints }) =>
    canonicalEquals(result.portfolioConstraints, expectedConstraints) ? [] : ["The portfolio changed the server-derived allocation constraints."]),
  rule("CANDIDATE_NOT_PORTFOLIO_ELIGIBLE", "error", ({ result }) =>
    result.approvedVideoExperimentReferences.filter((reference) => reference.portfolioEligible !== true).map((reference) => `Experiment run ${reference.experimentRunId} is not portfolio-eligible.`)),
  rule("SOURCE_SUMMARY_MISMATCH", "error", ({ result, expectedConstraints }) => {
    const expectedRunIds = expectedConstraints.candidates.map((candidate) => candidate.experimentRunId);
    const problems: string[] = [];
    if (result.source.cycleLabel !== expectedConstraints.cycleLabel) problems.push("source.cycleLabel does not match the operator-declared cycle.");
    if (result.source.candidateCount !== expectedConstraints.candidates.length) problems.push("source.candidateCount does not match the resolved candidate set.");
    if (!canonicalEquals(result.source.experimentRunIds, expectedRunIds)) problems.push("source.experimentRunIds does not match the resolved candidate set.");
    return problems;
  }),

  // --- Allocation coverage and structure -------------------------------------
  rule("CANDIDATE_NOT_ALLOCATED", "error", ({ result, expectedConstraints }) => {
    const allocated = new Set(result.content.allocation.items.map((item) => item.candidateId));
    return expectedConstraints.candidates.filter((candidate) => !allocated.has(candidate.candidateId)).map((candidate) => `Candidate ${candidate.candidateId} was silently dropped from the allocation.`);
  }),
  rule("UNKNOWN_CANDIDATE_ALLOCATED", "error", ({ result, expectedConstraints }) => {
    const known = new Set(expectedConstraints.citableCandidateIds);
    return result.content.allocation.items.filter((item) => !known.has(item.candidateId)).map((item) => `${item.candidateId} is not a resolved candidate of this portfolio.`);
  }),
  rule("DUPLICATE_CANDIDATE_ALLOCATED", "error", ({ result }) => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const item of result.content.allocation.items) {
      if (seen.has(item.candidateId)) duplicates.push(`${item.candidateId} is allocated more than once.`);
      seen.add(item.candidateId);
    }
    return duplicates;
  }),
  rule("CAPACITY_EXCEEDED", "error", ({ result, expectedConstraints }) => {
    const committed = committedItems(result.content.allocation).length;
    return committed > expectedConstraints.concurrentExperimentSlots
      ? [`The allocation commits ${committed} experiments against ${expectedConstraints.concurrentExperimentSlots} declared slots.`]
      : [];
  }),
  rule("COMMIT_RANK_INVALID", "error", ({ result }) => {
    const committed = committedItems(result.content.allocation);
    const ranks = committed.map((item) => item.rank);
    return ranks.every((rank, index) => rank === index + 1) ? [] : ["Committed ranks must be dense and unique starting at 1."];
  }),
  rule("ALLOCATION_COUNTS_MISMATCH", "error", ({ result }) => {
    const allocation = result.content.allocation;
    const actual = {
      committedCount: allocation.items.filter((item) => item.disposition === "COMMITTED").length,
      deferredCount: allocation.items.filter((item) => item.disposition === "DEFERRED").length,
      excludedCount: allocation.items.filter((item) => item.disposition === "EXCLUDED").length,
    };
    return (["committedCount", "deferredCount", "excludedCount"] as const)
      .filter((key) => allocation[key] !== actual[key])
      .map((key) => `${key} does not match the server-counted dispositions.`);
  }),
  rule("CAPACITY_UTILIZATION_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.allocation.capacityUtilization === deriveCapacityUtilization(result.content.allocation, expectedConstraints)
      ? []
      : ["capacityUtilization does not match the server-derived utilisation of the declared slots."]),
  rule("CYCLE_LABEL_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.allocation.cycleLabel === expectedConstraints.cycleLabel ? [] : ["The allocation renamed the operator-declared cycle."]),
  rule("SELECTION_BASIS_ILLEGAL_FOR_DISPOSITION", "error", ({ result }) =>
    result.content.allocation.items
      .filter((item) => !DISPOSITION_PERMITTED_SELECTION_BASES[item.disposition].includes(item.selectionBasis))
      .map((item) => `${item.candidateId}: ${item.selectionBasis} cannot explain a ${item.disposition} placement.`)),
  rule("DEFERRED_WITHOUT_REVISIT_CONDITION", "error", ({ result }) =>
    result.content.allocation.items
      .filter((item) => item.disposition === "DEFERRED" && (item.revisitCondition ?? "").trim().length === 0)
      .map((item) => `${item.candidateId} is deferred with no condition under which it is revisited.`)),
  rule("CITED_CANDIDATE_UNSUPPORTED", "error", ({ result, expectedConstraints }) => {
    const known = new Set(expectedConstraints.citableCandidateIds);
    return result.content.allocation.items.flatMap((item) =>
      item.citedCandidateIds.filter((id) => !known.has(id) || id === item.candidateId).map((id) => `${item.candidateId} cites ${id}, which is not a distinct resolved candidate.`));
  }),
  rule("CITATION_REQUIRED_BASIS_UNSUPPORTED", "error", ({ result }) =>
    result.content.allocation.items
      .filter((item) => CITATION_REQUIRED_BASES.has(item.selectionBasis) && item.citedCandidateIds.length === 0)
      .map((item) => `${item.candidateId} claims ${item.selectionBasis} without naming the candidate it relates to.`)),

  // --- Confounding -----------------------------------------------------------
  rule("CONFOUND_COLLISION_COMMITTED", "error", ({ result, expectedConstraints }) => {
    const committed = new Set(committedItems(result.content.allocation).map((item) => item.candidateId));
    return expectedConstraints.confoundCollisionGroups
      .filter((group) => group.candidateIds.filter((id) => committed.has(id)).length > 1)
      .map((group) => `Two committed experiments share assignment surface ${group.key}; each would contaminate the other's reading.`);
  }),
  rule("NOT_READY_CANDIDATE_COMMITTED", "error", ({ result, expectedConstraints }) => {
    const committed = new Set(committedItems(result.content.allocation).map((item) => item.candidateId));
    return expectedConstraints.notReadyCandidateIds.filter((id) => committed.has(id)).map((id) => `${id} did not pass Experiment's structural readiness bar and cannot be committed.`);
  }),

  // --- Viewer Value ----------------------------------------------------------
  rule("AT_RISK_CANDIDATE_COMMITTED_WITHOUT_ESCALATION", "error", ({ result, expectedConstraints }) => {
    const committed = new Set(committedItems(result.content.allocation).map((item) => item.candidateId));
    const offending = expectedConstraints.atRiskCandidateIds.filter((id) => committed.has(id));
    return offending.length > 0 && !result.content.allocation.requiresHumanJudgment
      ? [`Viewer-Value-at-risk candidates ${offending.join(", ")} are committed without escalating the allocation to human judgment.`]
      : [];
  }),
  rule("HUMAN_JUDGMENT_CANDIDATE_COMMITTED_WITHOUT_ESCALATION", "error", ({ result, expectedConstraints }) => {
    const committed = new Set(committedItems(result.content.allocation).map((item) => item.candidateId));
    const offending = expectedConstraints.humanJudgmentCandidateIds.filter((id) => committed.has(id));
    return offending.length > 0 && !result.content.allocation.requiresHumanJudgment
      ? [`Candidates ${offending.join(", ")} require human judgment and are committed without escalating the allocation.`]
      : [];
  }),
  rule("VIEWER_VALUE_DISPOSITION_CONTRADICTS_PROJECTION", "error", ({ result, expectedConstraints }) => {
    const byId = new Map(expectedConstraints.candidates.map((candidate) => [candidate.candidateId, candidate]));
    return result.content.allocation.items.flatMap((item) => {
      const candidate = byId.get(item.candidateId);
      if (!candidate) return [];
      return STATE_PERMITTED_VIEWER_VALUE_DISPOSITIONS[candidate.viewerValueState].includes(item.viewerValueDisposition)
        ? []
        : [`${item.candidateId} records ${item.viewerValueDisposition} against a server-projected Viewer Value state of ${candidate.viewerValueState}.`];
    });
  }),
  rule("VIEWER_VALUE_EXCLUSION_CONTRADICTED", "error", ({ result }) =>
    result.content.allocation.items
      .filter((item) => item.viewerValueDisposition === "EXCLUDED_FOR_VIEWER_VALUE_RISK" && item.disposition !== "EXCLUDED")
      .map((item) => `${item.candidateId} is recorded as excluded for Viewer Value risk but is ${item.disposition}.`)),
  rule("GROWTH_ONLY_JUSTIFICATION_COMMITTED", "error", ({ result }) =>
    committedItems(result.content.allocation)
      .filter((item) => item.justifiedByPredictedGrowthAlone)
      .map((item) => `${item.candidateId} is committed on predicted growth alone, which is never a sufficient basis.`)),
  rule("GROWTH_ONLY_ARGUMENT_UNDECLARED", "error", ({ result }) =>
    committedItems(result.content.allocation)
      .filter((item) => !item.justifiedByPredictedGrowthAlone && GROWTH_ARGUMENT.test(item.rationale) && !EVIDENCE_ANCHOR.test(item.rationale))
      .map((item) => `${item.candidateId} argues purely from predicted growth while declaring justifiedByPredictedGrowthAlone false.`)),
  rule("PORTFOLIO_METRIC_GAMING_UNGUARDED", "error", ({ result, expectedConstraints }) => {
    const byId = new Map(expectedConstraints.candidates.map((candidate) => [candidate.candidateId, candidate]));
    const committed = committedItems(result.content.allocation)
      .map((item) => byId.get(item.candidateId))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .filter((candidate) => !candidate.measurementOnly);
    if (committed.length === 0) return [];
    const families = committed.map((candidate) => PORTFOLIO_METRIC_FAMILY[candidate.primaryMetric]);
    if (families.some((family) => VIEWER_BENEFIT_FAMILIES.has(family))) return [];
    const safeguards = result.content.viewerValueSafeguards;
    const acknowledged = /\b(?:acquisition|click|ctr|impression|reach|no (?:retention|satisfaction|loyalty)|without (?:a )?(?:retention|satisfaction|loyalty)|satisfaction|retention|loyalty|returning viewers)\b/i;
    return acknowledged.test(safeguards.metricGamingRisk) && acknowledged.test(safeguards.guardedMetricGaming)
      ? []
      : ["Every committed experiment optimises an acquisition- or engagement-side metric with nothing defending retention, satisfaction, or returning viewers, and the safeguards do not name that exposure."];
  }),
  rule("NO_VIEWER_VALUE_GUARDRAIL", "error", ({ result }) =>
    result.content.allocation.viewerValueGuardrails.filter((guardrail) => guardrail.trim().length > 0).length === 0
      ? ["The cycle carries no Viewer Value guardrail."]
      : []),
  rule("NO_PORTFOLIO_RISK", "error", ({ result }) =>
    result.content.allocation.portfolioRisks.filter((risk) => risk.mitigation.trim().length > 0).length === 0
      ? ["The cycle records no portfolio-level risk with a mitigation."]
      : []),

  // --- Epistemic discipline --------------------------------------------------
  rule("FABRICATED_QUANTITY_IN_ALLOCATION", "error", ({ result }) =>
    freeText(result).some((text) => quantityFindings(text))
      ? ["The allocation asserts a quantity; Portfolio has no analytics input and no numeric field in its contract."]
      : []),
  rule("FABRICATED_RETURN_FORECAST", "error", ({ result }) =>
    freeText(result).some((text) => FABRICATED_FORECAST.test(text))
      ? ["The allocation forecasts a lift, return, or ROI that no Channelwright contract can produce."]
      : []),
  rule("CAUSAL_CERTAINTY_CLAIMED", "error", ({ result }) =>
    freeText(result).some((text) => CAUSAL_CERTAINTY.test(text)) ? ["The allocation claims causal certainty about an untested experiment."] : []),

  // --- Scope boundary --------------------------------------------------------
  rule("PORTFOLIO_EXECUTION_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => EXECUTION_LEAKED.test(text)) ? ["The allocation contains publishing / provider execution instructions Portfolio is never allowed to issue."] : []),
  rule("EXPERIMENT_REDESIGN_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => EXPERIMENT_REDESIGN_LEAKED.test(text)) ? ["The allocation redesigns an approved experiment, which is CHANNEL_VIDEO_EXPERIMENT's responsibility."] : []),
  rule("DECISION_REWRITTEN_IN_PORTFOLIO", "error", ({ result }) =>
    freeText(result).some((text) => DECISION_REWRITTEN.test(text)) ? ["The allocation revisits a Decision or Diagnosis rather than allocating capacity."] : []),
  rule("INTELLIGENCE_RESPONSIBILITY_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => INTELLIGENCE_LEAKED.test(text)) ? ["The allocation performs channel-strategy work reserved for CHANNEL_VIDEO_INTELLIGENCE."] : []),

  // --- Derived-field tampering ----------------------------------------------
  rule("REQUIRES_HUMAN_JUDGMENT_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.allocation.requiresHumanJudgment === derivePortfolioRequiresHumanJudgment(result.content.allocation, expectedConstraints)
      ? []
      : ["requiresHumanJudgment does not match the server-derived escalation state of this slate."]),
  rule("PORTFOLIO_READY_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.portfolioReady === derivePortfolioReady(result.content.allocation, expectedConstraints)
      ? []
      : ["portfolioReady does not match the server-derived readiness of this allocation."]),
  rule("VIEWER_VALUE_SAFEGUARDS_MISMATCH", "error", ({ result, expectedConstraints }) => {
    const committed = new Set(committedItems(result.content.allocation).map((item) => item.candidateId));
    const safeguards = result.content.viewerValueSafeguards;
    const problems: string[] = [];
    if (safeguards.anyCandidateAtRisk !== (expectedConstraints.atRiskCandidateIds.length > 0)) problems.push("anyCandidateAtRisk does not match the resolved candidate set.");
    if (safeguards.escalationRequired !== expectedConstraints.viewerValueEscalationRequired) problems.push("escalationRequired does not match the server-derived escalation requirement.");
    if (!canonicalEquals(safeguards.committedAtRiskCandidateIds, expectedConstraints.atRiskCandidateIds.filter((id) => committed.has(id)))) problems.push("committedAtRiskCandidateIds does not match the committed at-risk candidates.");
    return problems;
  }),

  // --- Alternatives ----------------------------------------------------------
  rule("MISSING_ALTERNATIVE", "error", ({ result }) => {
    const committed = [...committedItems(result.content.allocation).map((item) => item.candidateId)].sort();
    return result.content.alternatives.some((alternative) => !canonicalEquals([...alternative.committedCandidateIds].sort(), committed))
      ? []
      : ["At least one alternative must propose a genuinely different committed set."];
  }),
  rule("ALTERNATIVE_NOT_REJECTED", "error", ({ result }) =>
    result.content.alternatives.filter((alternative) => alternative.notSelectedReason.trim().length === 0).map((alternative) => `${alternative.id} has no rejection basis.`)),
  rule("ALTERNATIVE_CITES_UNKNOWN_CANDIDATE", "error", ({ result, expectedConstraints }) => {
    const known = new Set(expectedConstraints.citableCandidateIds);
    return result.content.alternatives.flatMap((alternative) =>
      alternative.committedCandidateIds.filter((id) => !known.has(id)).map((id) => `${alternative.id} names ${id}, which is not a resolved candidate.`));
  }),

  // --- Model authority / payload --------------------------------------------
  rule("CRITIC_REJECTED_PORTFOLIO", "error", ({ result }) =>
    !result.crossModelReview.safeToFinalize || result.crossModelReview.findings.some((item) => item.severity === "error")
      ? ["The independent critic found a blocking issue; automated revision is forbidden."]
      : []),
  rule("MODEL_PROVIDER_INDEPENDENCE_REQUIRED", "error", ({ result }) =>
    result.modelProvenance.length !== 2 || result.modelProvenance[0].provider === result.modelProvenance[1].provider
      ? ["Portfolio requires exactly one allocator and one distinct-provider critic attribution."]
      : []),
  rule("RESULT_PAYLOAD_TOO_LARGE", "error", ({ result, maxPayloadBytes }) =>
    Buffer.byteLength(JSON.stringify(result), "utf8") > maxPayloadBytes ? ["Portfolio exceeds the pre-persistence payload ceiling."] : []),
];

/**
 * `expectedConstraints` is deliberately REQUIRED rather than defaulted. Unlike the
 * sibling verticals, a portfolio's constraints depend on operator input (the cycle
 * label and the declared slot count) that is not recoverable from the upstream
 * artifacts alone, so any default would have to read it back out of the very
 * result being checked -- which would quietly turn the tamper rules
 * self-referential. Callers pass the constraints derived from the run's own input
 * at `derive-portfolio-constraints`.
 */
export function deterministicVideoPortfolioValidation(
  result: ChannelVideoPortfolioResult,
  set: ApprovedVideoExperimentSet,
  expectedConstraints: VideoPortfolioConstraints,
  maxPayloadBytes = 60_000,
): Finding[] {
  const ctx: PortfolioValidationContext = { result, set, expectedConstraints, maxPayloadBytes };
  return DETERMINISTIC_VIDEO_PORTFOLIO_RULES.flatMap((portfolioRule) =>
    portfolioRule.check(ctx).map((message) => ({ severity: portfolioRule.severity, code: portfolioRule.code, message, evidenceIds: [] as string[] })));
}

export function videoPortfolioQA(findings: Finding[]): VideoPortfolioQAResult {
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const distinctFailedCodes = new Set(findings.map((item) => item.code)).size;
  return videoPortfolioQAResultSchema.parse({
    passed: errors === 0,
    score: Math.max(0, 100 - errors * 20 - warnings * 5),
    findings: findings.slice(0, 50),
    recommendation: errors === 0 ? (warnings === 0 ? "accept" : "human_review_required") : "revise",
    deterministicChecksPassed: Math.max(0, DETERMINISTIC_VIDEO_PORTFOLIO_RULES.length - distinctFailedCodes),
    deterministicChecksFailed: distinctFailedCodes,
    modelUsage: { model: "deterministic", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
}

export function parseVideoPortfolioResult(value: unknown) {
  return channelVideoPortfolioResultSchema.parse(value);
}

/**
 * The exact object the `final-video-portfolio-qa` step persists through
 * `complete_workflow_step`. `crossModelReview` is present twice -- once on its
 * own and once inside `result` -- so this envelope is always strictly larger
 * than `result`, which is why `maxResultPayloadBytes` alone cannot keep the
 * persisted step output under the database ceiling.
 */
export type VideoPortfolioQaStepEnvelope = { qa: unknown; crossModelReview: unknown; result: unknown };

/** UTF-8 byte size of the serialized QA step envelope -- what Postgres measures as `octet_length(p_output::text)`. */
export function videoPortfolioQaStepEnvelopeBytes(envelope: VideoPortfolioQaStepEnvelope): number {
  return Buffer.byteLength(JSON.stringify(envelope), "utf8");
}
