import {
  channelContentIntelligenceResultSchema,
  contentQAResultSchema,
  type ApprovedStrategyArtifact,
  type ContentQAResult,
  type ContentTopicOpportunity,
  type TopicDiscoveryBundle,
} from "@/domain/production-workflows";
import { deterministicViewerValueGate, resolveViewerValueGate } from "@/domain/viewer-value";
import { canonicalEquals } from "./canonical-json";
import { hasConsistentEvidenceIdentity, mergeSemanticQAFindings } from "./evidence-qa";
import type { ModelUsage } from "./openai-research-model";
import type { ContentSemanticQAOutput } from "./content-model";

type Finding = ContentQAResult["findings"][number];

/** Deterministic rule count used to report a checks-passed figure. */
export const DETERMINISTIC_CONTENT_RULE_COUNT = 22;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for", "from", "how", "i", "in", "is", "it",
  "its", "of", "on", "or", "that", "the", "their", "them", "these", "they", "this", "to", "was", "what", "when", "where",
  "which", "who", "why", "will", "with", "you", "your", "best", "guide", "tips", "ultimate", "complete", "top", "video",
]);

/** Normalized content-bearing tokens; numbers are dropped so "5 ways" and "7 ways" collide. */
export function topicTokens(topic: Pick<ContentTopicOpportunity, "workingConcept" | "workingAngle" | "viewerQuestion">) {
  return new Set(
    `${topic.workingConcept} ${topic.workingAngle} ${topic.viewerQuestion}`
      .toLocaleLowerCase("en-US")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token)),
  );
}

export function jaccardSimilarity(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Above this the two concepts serve effectively the same viewer intent. */
export const DUPLICATE_TOPIC_SIMILARITY = 0.7;

const FABRICATED_VIEWS = /\b(?:will|should|expect(?:ed)?\s+to)\s+(?:get|reach|receive|hit)\b[^.]{0,40}\b(?:views?|subscribers?)\b|\b\d[\d,.]*\s*(?:k|m|million|thousand)?\+?\s*(?:views?|subscribers?)\s+(?:in|within|per|guaranteed|expected)\b/i;
// Scoped to asserted channel earnings. A price like "tools under $5 per month"
// is a normal topic subject, so a bare currency-per-period no longer matches;
// the claim must be about earning, making, generating, or revenue.
const FABRICATED_REVENUE = /\b(?:cpm|rpm)\b\s*(?:of|is|=|:)?\s*\$?\d|\b(?:earn|earning|earnings|make|makes|making|generate|generates|generating|revenue|profit|income|payout)\b[^.]{0,40}\$\s*\d|\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|mo|year|yr|day)\b[^.]{0,40}\b(?:revenue|income|profit|earnings|payout)\b/i;
const FABRICATED_SEARCH_VOLUME = /\b(?:search(?:es)?\s+volume|monthly\s+searches|searched\s+\d[\d,.]*\s*times|\d[\d,.]*\s*(?:monthly\s+)?searches)\b/i;
const MONETARY_GUARANTEE = /\bguarantee(?:d|s)?\b[^.]{0,60}\$\s*\d|\bmake\s+\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|week|day|year)\b|\brisk[-\s]free\s+(?:income|profit)\b/i;
// Scoped to Channelwright *producing* a downstream artifact. A topic that is
// legitimately about thumbnails or scripts as a subject (a channel covering
// YouTube growth) is not a scope violation. Verbs a topic would naturally use
// ("design", "create", "write") are excluded; only system-directed production is.
const DOWNSTREAM_SCOPE = /\b(?:generate|generates|produce|produces|deliver|delivers|attach|attaches|output|outputs)\b[^.]{0,40}\b(?:thumbnail|storyboard|voiceover script|title variant|content calendar|publishing schedule)\b|\b(?:final|full)\s+script\b/i;

function allText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allText);
  if (value && typeof value === "object") return Object.values(value).flatMap(allText);
  return [];
}

/**
 * The deterministic half of CONTENT_INTELLIGENCE QA. Every rule here is
 * mechanically checkable; judgement calls (is this genuinely useful, is the
 * differentiation real) belong to independent semantic QA.
 *
 * Several intended rules are enforced more strongly by the typed contract than
 * they could be here — recommendation reason counts, presence of assumptions and
 * uncertainties, and fabricated-performance KPI shapes all fail Zod parsing
 * outright, which is terminal in the worker rather than merely a QA finding.
 */
export function deterministicContentValidation(
  resultValue: unknown,
  upstream: ApprovedStrategyArtifact,
  discovery: TopicDiscoveryBundle,
  maxPayloadBytes: number,
): Finding[] {
  const result = channelContentIntelligenceResultSchema.parse(resultValue);
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], code: string, message: string, evidenceIds: string[] = []) => findings.push({ severity, code, message, evidenceIds });

  if (!canonicalEquals(result.upstreamStrategy, upstream.reference)) {
    add("error", "UPSTREAM_STRATEGY_REFERENCE_CHANGED", "The backlog changed the exact approved-strategy reference.");
  }

  const known = new Map(discovery.evidence.map((item) => [item.id, item]));
  const cited = new Set<string>([
    ...result.topics.flatMap((topic) => [...topic.evidenceIds, ...topic.competitionSignal.evidenceIds, ...allViewerValueEvidence(topic)]),
    ...result.scores.flatMap((score) => score.components.flatMap((component) => component.evidenceIds)),
    ...result.nextVideoRecommendation.evidenceIds,
  ]);
  const missing = [...cited].filter((id) => !known.has(id));
  if (missing.length) add("error", "EVIDENCE_REFERENCE_NOT_FOUND", "The backlog cites evidence IDs outside the current discovery bundle.", missing.slice(0, 20));

  for (const item of discovery.evidence) {
    // Search observations describe a query rather than a resource, so they carry
    // no canonical URL and cannot use the shared video/channel identity helper.
    const consistent = item.sourceType === "search"
      ? item.id === `yt:search:${item.sourceId}` && item.url === null
      : hasConsistentEvidenceIdentity({ id: item.id, url: item.url ?? "", sourceType: item.sourceType, sourceId: item.sourceId });
    if (!consistent) add("error", "EVIDENCE_IDENTITY_MISMATCH", `Discovery evidence identity is inconsistent for ${item.id}.`, [item.id]);
  }

  const strategyPillarNames = new Set(upstream.strategyResult.contentPillars.map((pillar) => pillar.name.toLocaleLowerCase("en-US").trim()));
  const expandedPillars = new Map(result.pillarExpansions.map((pillar) => [pillar.pillarId, pillar]));
  for (const expansion of result.pillarExpansions) {
    if (!strategyPillarNames.has(expansion.pillarName.toLocaleLowerCase("en-US").trim())) {
      add("error", "PILLAR_NOT_IN_APPROVED_STRATEGY", `Pillar expansion "${expansion.pillarName}" is not an approved strategy pillar.`);
    }
  }
  for (const topic of result.topics) {
    if (!expandedPillars.has(topic.pillarId)) add("error", "TOPIC_PILLAR_NOT_IN_STRATEGY", `Topic ${topic.topicId} is not associated with an expanded approved pillar.`);
    const ownPillarEvidence = topic.evidenceIds.filter((id) => known.get(id)?.pillarId === topic.pillarId);
    if (ownPillarEvidence.length === 0) {
      add("error", "TOPIC_EVIDENCE_NOT_INDEPENDENTLY_DISCOVERED", `Topic ${topic.topicId} cites no discovery evidence retrieved for its own pillar.`);
    }
    if (topic.shelfLife.classification !== "EVERGREEN" && !topic.shelfLife.decayNote) {
      add("error", "TIMELY_TOPIC_MISSING_DECAY_TREATMENT", `Topic ${topic.topicId} is not evergreen but carries no freshness or decay note.`);
    }
  }

  // Viewer Value Gate: the deterministic floor overrules an optimistic model.
  for (const topic of result.topics) {
    const deterministic = deterministicViewerValueGate(topic.viewerValue);
    const resolved = resolveViewerValueGate(deterministic.gate, topic.viewerValue.gate);
    if (resolved !== topic.viewerValue.gate) {
      add("error", "VIEWER_VALUE_GATE_UNDERSTATED", `Topic ${topic.topicId} claims gate ${topic.viewerValue.gate} but deterministic rules require ${resolved}: ${deterministic.reasons.join(" ")}`);
    }
    if (resolved === "REJECT") add("error", "VIEWER_VALUE_GATE_REJECTED", `Topic ${topic.topicId} fails the Viewer Value Gate: ${deterministic.reasons.join(" ")}`);
    else if (resolved === "REVISE") add("warning", "VIEWER_VALUE_GATE_REVISION_REQUIRED", `Topic ${topic.topicId} needs a stronger viewer-value case: ${deterministic.reasons.join(" ")}`);
    if (topic.viewerValue.integrityFindings.some((item) => item.severity === "blocking")) {
      add("error", "CONTENT_INTEGRITY_BLOCKING_RISK", `Topic ${topic.topicId} depends on a blocking content-integrity risk.`);
    }
  }

  // Originality: near-duplicate concepts serving the same viewer intent.
  const fingerprints = result.topics.map((topic) => ({ topicId: topic.topicId, tokens: topicTokens(topic) }));
  for (let left = 0; left < fingerprints.length; left += 1) {
    for (let right = left + 1; right < fingerprints.length; right += 1) {
      const similarity = jaccardSimilarity(fingerprints[left].tokens, fingerprints[right].tokens);
      if (similarity >= DUPLICATE_TOPIC_SIMILARITY) {
        add("error", "DUPLICATE_TOPIC_CONCEPT", `Topics ${fingerprints[left].topicId} and ${fingerprints[right].topicId} serve effectively the same viewer intent (similarity ${similarity.toFixed(2)}).`);
      }
    }
  }

  // Scoring must decompose: no aggregate number without consistent components.
  const scoredTopics = new Set(result.scores.map((score) => score.topicId));
  for (const topic of result.topics) if (!scoredTopics.has(topic.topicId)) add("error", "TOPIC_SCORE_MISSING", `Topic ${topic.topicId} has no score decomposition.`);
  for (const score of result.scores) {
    if (!result.topics.some((topic) => topic.topicId === score.topicId)) add("error", "SCORE_TOPIC_UNKNOWN", `Score references unknown topic ${score.topicId}.`);
    const dimensions = new Set(score.components.map((component) => component.dimension));
    if (dimensions.size !== score.components.length) add("error", "SCORING_DIMENSION_DUPLICATED", `Score for ${score.topicId} repeats a dimension.`);
    const weightSum = score.components.reduce((total, component) => total + component.weight, 0);
    if (Math.abs(weightSum - 1) > 0.02) add("error", "SCORING_WEIGHTS_INVALID", `Score weights for ${score.topicId} sum to ${weightSum.toFixed(3)} rather than 1.`);
    const expected = score.components.reduce((total, component) => total + component.score * component.weight, 0);
    if (Math.abs(expected - score.weightedTotal) > 0.05) add("error", "SCORING_ARITHMETIC_INVALID", `Weighted total for ${score.topicId} is ${score.weightedTotal} but its components produce ${expected.toFixed(2)}.`);
  }

  const backlogIds = result.backlog.map((entry) => entry.topicId);
  for (const entry of result.backlog) if (!result.topics.some((topic) => topic.topicId === entry.topicId)) add("error", "BACKLOG_TOPIC_UNKNOWN", `Backlog references unknown topic ${entry.topicId}.`);
  if (new Set(backlogIds).size !== backlogIds.length) add("error", "BACKLOG_TOPIC_DUPLICATED", "The backlog lists the same topic more than once.");
  const ranks = result.backlog.map((entry) => entry.rank).sort((left, right) => left - right);
  if (ranks.some((rank, index) => rank !== index + 1)) add("error", "BACKLOG_RANKS_INVALID", "Backlog ranks must be unique and contiguous from 1.");
  if (!backlogIds.includes(result.nextVideoRecommendation.topicId)) add("error", "RECOMMENDATION_TOPIC_NOT_IN_BACKLOG", "The recommended next video is not present in the backlog.");

  const recommended = result.topics.find((topic) => topic.topicId === result.nextVideoRecommendation.topicId);
  if (recommended && deterministicViewerValueGate(recommended.viewerValue).gate !== "PASS") {
    add("error", "RECOMMENDATION_FAILS_VIEWER_VALUE", "The recommended next video does not pass the Viewer Value Gate.");
  }
  const upstreamQa = Math.min(upstream.reference.finalQaScore, upstream.reference.upstreamResearch.finalQaScore);
  if (upstreamQa < 80 && result.nextVideoRecommendation.confidence === "high") {
    add("error", "CONFIDENCE_EXCEEDS_UPSTREAM_EVIDENCE", "High recommendation confidence exceeds the bounded upstream research and strategy QA state.");
  }
  if (discovery.completionStatus === "partial" && result.nextVideoRecommendation.confidence === "high") {
    add("warning", "CONFIDENCE_EXCEEDS_PARTIAL_DISCOVERY", "The discovery bundle is partial, so high confidence is not fully supported.");
  }

  const text = allText(result).join("\n");
  if (FABRICATED_VIEWS.test(text)) add("error", "FABRICATED_PERFORMANCE_PREDICTION", "The backlog predicts future views or subscribers.");
  if (FABRICATED_REVENUE.test(text)) add("error", "FABRICATED_REVENUE_PREDICTION", "The backlog asserts revenue, CPM, or RPM figures.");
  if (FABRICATED_SEARCH_VOLUME.test(text)) add("error", "FABRICATED_SEARCH_VOLUME", "The backlog asserts search-volume data no configured provider supplies.");
  if (MONETARY_GUARANTEE.test(text)) add("error", "UNSUPPORTED_MONETARY_GUARANTEE", "The backlog contains an unsupported monetary guarantee.");
  if (DOWNSTREAM_SCOPE.test(text)) add("error", "DOWNSTREAM_SCOPE_VIOLATION", "The backlog produced a downstream packaging or production artifact.");

  const payloadBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (payloadBytes > maxPayloadBytes) {
    add("error", "RESULT_PAYLOAD_TOO_LARGE", `The backlog serializes to ${payloadBytes} bytes, above the ${maxPayloadBytes}-byte durable-output margin.`);
  }
  return findings;
}

function allViewerValueEvidence(topic: ContentTopicOpportunity) {
  const contract = topic.viewerValue.contract;
  return [
    ...contract.viewerNeed.evidenceIds,
    ...contract.valuePromise.specificity.evidenceIds,
    ...contract.originalContribution.assessment.evidenceIds,
    ...contract.differentiation.evidenceIds,
    ...contract.evidenceSupport.evidenceIds,
    ...contract.actionability.evidenceIds,
    ...contract.trustworthiness.evidenceIds,
    ...contract.sustainability.evidenceIds,
    ...topic.viewerValue.integrityFindings.flatMap((item) => item.evidenceIds),
  ];
}

/** Semantic findings are filtered against known evidence exactly as research and strategy QA do. */
export function mergeContentQA(
  deterministic: Finding[],
  semantic: ContentSemanticQAOutput,
  modelUsage: ModelUsage,
  discovery: TopicDiscoveryBundle,
): ContentQAResult {
  const { findings, errors, score, recommendation } = mergeSemanticQAFindings(
    deterministic,
    semantic,
    new Set(discovery.evidence.map((item) => item.id)),
    "The content QA model cited an unknown discovery evidence ID.",
  );
  const failingRules = new Set(deterministic.map((item) => item.code)).size;
  return contentQAResultSchema.parse({
    passed: errors === 0 && score >= 75,
    score,
    findings: findings.slice(0, 50),
    recommendation,
    // Counted by distinct failing rule code: one bad topic can emit several
    // findings for the same rule, which previously drove "checks passed" to zero.
    deterministicChecksPassed: Math.max(0, DETERMINISTIC_CONTENT_RULE_COUNT - failingRules),
    deterministicChecksFailed: failingRules,
    modelUsage,
  });
}

/**
 * Integrity failures are not cosmetically fixable: an idea whose core premise is
 * deceptive must fail closed rather than be rewritten into compliance. Viewer
 * value weakness, by contrast, is exactly what one bounded revision is for.
 */
export const UNREVISABLE_CONTENT_CODES = new Set([
  "VIEWER_VALUE_GATE_REJECTED",
  "CONTENT_INTEGRITY_BLOCKING_RISK",
  "UNSUPPORTED_MONETARY_GUARANTEE",
  "FABRICATED_SEARCH_VOLUME",
  "UPSTREAM_STRATEGY_REFERENCE_CHANGED",
]);

export function hasUnrevisableFailure(findings: Finding[]) {
  return findings.some((finding) => finding.severity === "error" && UNREVISABLE_CONTENT_CODES.has(finding.code));
}

/**
 * Includes the message because code plus evidence IDs alone could not tell apart
 * the same rule violated on two different topics with no citations, letting a
 * revision reintroduce a violation and have it look pre-existing.
 */
export function findingFingerprint(finding: Finding) {
  return `${finding.code}:${[...finding.evidenceIds].sort().join(",")}:${finding.message}`;
}

export function newlyIntroducedContentErrors(before: Finding[], after: Finding[]) {
  const existing = new Set(before.filter((finding) => finding.severity === "error").map(findingFingerprint));
  return after.filter((finding) => finding.severity === "error" && !existing.has(findingFingerprint(finding)));
}
