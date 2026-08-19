import {
  channelVideoBriefResultSchema,
  videoBriefQAResultSchema,
  type ApprovedContentOpportunityArtifact,
  type ChannelVideoBriefResult,
  type VideoBriefQAResult,
} from "@/domain/production-workflows";
import { deterministicViewerValueGate, resolveViewerValueGate } from "@/domain/viewer-value";
import { canonicalEquals } from "./canonical-json";
import { hasConsistentEvidenceIdentity, mergeSemanticQAFindings } from "./evidence-qa";
import type { ModelUsage } from "./openai-research-model";
import type { VideoBriefSemanticQAOutput } from "./video-brief-model";

type Finding = VideoBriefQAResult["findings"][number];

/** Deterministic rule count used to report a checks-passed figure. */
export const DETERMINISTIC_VIDEO_BRIEF_RULE_COUNT = 28;

const FABRICATED_VIEWS = /\b(?:will|should|expect(?:ed)?\s+to)\s+(?:get|reach|receive|hit)\b[^.]{0,40}\b(?:views?|subscribers?)\b|\b\d[\d,.]*\s*(?:k|m|million|thousand)?\+?\s*(?:views?|subscribers?)\s+(?:in|within|per|guaranteed|expected)\b/i;
const FABRICATED_REVENUE = /\b(?:cpm|rpm)\b\s*(?:of|is|=|:)?\s*\$?\d|\b(?:earn|earning|earnings|make|makes|making|generate|generates|generating|revenue|profit|income|payout)\b[^.]{0,40}\$\s*\d|\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|mo|year|yr|day)\b[^.]{0,40}\b(?:revenue|income|profit|earnings|payout)\b/i;
const FABRICATED_SEARCH_VOLUME = /\b(?:search(?:es)?\s+volume|monthly\s+searches|searched\s+\d[\d,.]*\s*times|\d[\d,.]*\s*(?:monthly\s+)?searches)\b/i;
const MONETARY_GUARANTEE = /\bguarantee(?:d|s)?\b[^.]{0,60}\$\s*\d|\bmake\s+\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|week|day|year)\b|\brisk[-\s]free\s+(?:income|profit)\b/i;
/** Retention and watch-time outcomes are unknowable here; asserting them is fabrication. */
const FABRICATED_RETENTION = /\b\d{1,3}\s*%\s*(?:audience\s+)?retention\b|\bretention\b[^.]{0,40}\b\d{1,3}\s*%|\b(?:average\s+view\s+duration|watch\s+time)\b[^.]{0,40}\b\d+\s*(?:%|minutes?|seconds?)\b|\bviewers?\s+will\s+(?:stay|watch)\b[^.]{0,40}\b\d+\s*(?:%|minutes?)\b/i;

/**
 * Downstream artifacts this stage must not produce. Scoped to Channelwright
 * *producing* the artifact: a video legitimately about thumbnails or scripting
 * as a subject is not a scope violation, so only system-directed production
 * verbs match.
 */
const TITLE_LEAKAGE = /\b(?:final|recommended|proposed|chosen)\s+title\b|\btitle\s*(?:option|variant|candidate)s?\s*[:=]|\btitleText\b/i;
const THUMBNAIL_LEAKAGE = /\b(?:generate|generates|produce|produces|render|renders|create|creates|design|designs)\b[^.]{0,40}\bthumbnail\b|\bthumbnail\s+(?:copy|text|overlay)\s*[:=]/i;
const STORYBOARD_LEAKAGE = /\b(?:generate|generates|produce|produces|render|renders|create|creates)\b[^.]{0,40}\b(?:storyboard|shot\s+list)\b|\bstoryboard\s*[:=]/i;
const SCRIPT_LEAKAGE = /\b(?:final|full|complete|finished)\s+script\b|\b(?:write|writes|generate|generates|produce|produces)\b[^.]{0,30}\b(?:the\s+)?(?:script|narration|voiceover)\b|\b(?:narration|voiceover)\s*[:=]/i;
const PUBLISHING_LEAKAGE = /\b(?:upload|uploads|uploading|publish|publishes|publishing|schedule[sd]?\s+for\s+release)\b[^.]{0,40}\b(?:video|youtube|channel)\b|\bready\s+to\s+(?:publish|upload|export)\b|\bpublishing\s+schedule\b/i;

/**
 * A promise too vague to check against the content architecture. These are the
 * phrasings that reliably signal a non-promise; semantic QA judges the rest.
 */
const VAGUE_PROMISE = /\beverything\s+(?:you\s+need\s+to\s+know|about\s+\w+)\b|\ball\s+you\s+need\s+to\s+know\b|\bthe\s+ultimate\s+guide\b|\bcomplete\s+guide\s+to\s+everything\b|\blearn\s+it\s+all\b|\bmaster\s+\w+\s+completely\b|\banything\s+and\s+everything\b/i;

function allText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allText);
  if (value && typeof value === "object") return Object.values(value).flatMap(allText);
  return [];
}

function viewerValueEvidence(result: ChannelVideoBriefResult) {
  const contract = result.viewerValue.contract;
  return [
    ...contract.viewerNeed.evidenceIds,
    ...contract.valuePromise.specificity.evidenceIds,
    ...contract.originalContribution.assessment.evidenceIds,
    ...contract.differentiation.evidenceIds,
    ...contract.evidenceSupport.evidenceIds,
    ...contract.actionability.evidenceIds,
    ...contract.trustworthiness.evidenceIds,
    ...contract.sustainability.evidenceIds,
    ...result.viewerValue.integrityFindings.flatMap((item) => item.evidenceIds),
  ];
}

/**
 * The deterministic half of CHANNEL_VIDEO_BRIEF QA, and the authoritative one.
 * Every rule here is mechanically checkable; judgement calls (is this genuinely
 * worth producing, is the differentiation real) belong to semantic QA, which
 * cannot clear anything decided here.
 *
 * Several intended rules are enforced more strongly by the typed contract than
 * they could be here: there is no field in which to predict views, revenue, or
 * retention, so those shapes fail Zod parsing outright rather than becoming QA
 * findings. The regex rules below catch the same claims made in free text.
 */
export function deterministicVideoBriefValidation(
  resultValue: unknown,
  upstream: ApprovedContentOpportunityArtifact,
  maxPayloadBytes: number,
): Finding[] {
  const result = channelVideoBriefResultSchema.parse(resultValue);
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], code: string, message: string, evidenceIds: string[] = []) => findings.push({ severity, code, message, evidenceIds });

  // --- Upstream identity and provenance -----------------------------------
  if (!canonicalEquals(result.upstreamContentIntelligence, upstream.reference)) {
    add("error", "UPSTREAM_CONTENT_REFERENCE_CHANGED", "The brief changed the exact approved content-intelligence reference.");
  }
  if (!canonicalEquals(result.selectedTopic, upstream.selection)) {
    add("error", "SELECTED_TOPIC_IDENTITY_CHANGED", "The brief altered the selected topic identity, rank, tier, selection source, or inherited viewer-value provenance.");
  }
  if (!canonicalEquals(result.selectedTopic.inheritedViewerValueProvenance, upstream.selection.inheritedViewerValueProvenance)) {
    add("error", "VIEWER_VALUE_PROVENANCE_ALTERED", "The inherited Viewer Value provenance or contract hash was altered.");
  }
  if (result.source.topicId !== upstream.selectedTopic.topicId) {
    add("error", "SOURCE_TOPIC_MISMATCH", `The brief source cites topic ${result.source.topicId} but the resolved topic is ${upstream.selectedTopic.topicId}.`);
  }
  if (result.source.pillarId !== upstream.selectedTopic.pillarId) {
    add("error", "SOURCE_PILLAR_MISMATCH", `The brief source cites pillar ${result.source.pillarId} but the resolved topic belongs to ${upstream.selectedTopic.pillarId}.`);
  }

  // --- Evidence integrity --------------------------------------------------
  const known = new Map(upstream.discoveryBundle.evidence.map((item) => [item.id, item]));
  const cited = new Set<string>([
    ...result.source.sourceEvidenceIds,
    ...result.originalContribution.evidenceIds,
    ...result.evidencePlan.items.flatMap((item) => item.evidenceIds),
    ...result.contentArchitecture.beats.flatMap((beat) => beat.evidenceRequired),
    ...viewerValueEvidence(result),
  ]);
  const missing = [...cited].filter((id) => !known.has(id));
  if (missing.length) add("error", "EVIDENCE_REFERENCE_NOT_FOUND", "The brief cites evidence IDs outside the approved upstream discovery bundle.", missing.slice(0, 20));

  for (const item of upstream.discoveryBundle.evidence) {
    const consistent = item.sourceType === "search"
      ? item.id === `yt:search:${item.sourceId}` && item.url === null
      : hasConsistentEvidenceIdentity({ id: item.id, url: item.url ?? "", sourceType: item.sourceType, sourceId: item.sourceId });
    if (!consistent) add("error", "EVIDENCE_IDENTITY_MISMATCH", `Upstream evidence identity is inconsistent for ${item.id}.`, [item.id]);
  }

  // A core claim with no evidence must say so rather than passing as supported.
  for (const item of result.evidencePlan.items) {
    if (item.status === "SUPPORTED" && item.evidenceIds.length === 0) {
      add("error", "UNSUPPORTED_CLAIM_MISSING_RESEARCH_STATE", `Claim ${item.claimId} is marked SUPPORTED but cites no evidence; it must be RESEARCH_REQUIRED or MUST_NOT_CLAIM.`);
    }
    if (item.status === "RESEARCH_REQUIRED" && !item.researchNote) {
      add("error", "RESEARCH_REQUIRED_MISSING_NOTE", `Claim ${item.claimId} is RESEARCH_REQUIRED but states nothing about what must be established.`);
    }
  }
  const claimIds = result.evidencePlan.items.map((item) => item.claimId);
  if (new Set(claimIds).size !== claimIds.length) add("error", "DUPLICATE_CLAIM_IDENTITY", "The evidence plan lists the same claim identifier more than once.");
  const knownClaims = new Set(claimIds);
  const forbidden = new Set(result.evidencePlan.items.filter((item) => item.status === "MUST_NOT_CLAIM").map((item) => item.claimId));
  for (const beat of result.contentArchitecture.beats) {
    for (const claimId of beat.claimIds) {
      if (!knownClaims.has(claimId)) add("error", "BEAT_CLAIM_UNKNOWN", `Beat ${beat.sectionId} references unknown claim ${claimId}.`);
      else if (forbidden.has(claimId)) add("error", "BEAT_USES_FORBIDDEN_CLAIM", `Beat ${beat.sectionId} plans to make claim ${claimId}, which is marked MUST_NOT_CLAIM.`);
    }
  }

  // --- Content architecture integrity -------------------------------------
  const sectionIds = result.contentArchitecture.beats.map((beat) => beat.sectionId);
  if (new Set(sectionIds).size !== sectionIds.length) add("error", "DUPLICATE_SECTION_IDENTITY", "The content architecture lists the same section identifier more than once.");
  const knownSections = new Set(sectionIds);
  if (!knownSections.has(result.contentArchitecture.payoffLocation)) {
    add("error", "MALFORMED_CONTENT_ARCHITECTURE", `The declared payoff location ${result.contentArchitecture.payoffLocation} is not one of the defined beats.`);
  }
  if (!knownSections.has(result.hookStrategy.payoffLocation)) {
    add("error", "HOOK_PAYOFF_LOCATION_UNKNOWN", `The hook payoff location ${result.hookStrategy.payoffLocation} is not one of the defined beats.`);
  }
  for (const drag of result.retentionArchitecture.dragRisks) {
    if (!knownSections.has(drag.sectionId)) add("error", "RETENTION_SECTION_UNKNOWN", `Retention planning references unknown section ${drag.sectionId}.`);
  }
  if (!result.contentArchitecture.beats.some((beat) => beat.role === "OPENING")) {
    add("warning", "MALFORMED_CONTENT_ARCHITECTURE", "The content architecture defines no opening beat.");
  }

  // --- Viewer promise ------------------------------------------------------
  const promiseText = `${result.viewerPromise.statement} ${result.viewerPromise.concreteValue}`;
  if (VAGUE_PROMISE.test(promiseText)) {
    add("error", "VIEWER_PROMISE_VAGUE", "The viewer promise is too vague to verify against the content architecture.");
  }
  if (result.viewerPromise.explicitNonPromises.length === 0) {
    add("error", "VIEWER_PROMISE_MISSING_NON_PROMISES", "The brief does not state what this video deliberately does not promise.");
  }

  // --- Viewer Value Gate: deterministic floor overrules an optimistic model -
  const deterministic = deterministicViewerValueGate(result.viewerValue);
  const resolved = resolveViewerValueGate(deterministic.gate, result.viewerValue.gate);
  if (resolved !== result.viewerValue.gate) {
    add("error", "VIEWER_VALUE_GATE_UNDERSTATED", `The brief claims gate ${result.viewerValue.gate} but deterministic rules require ${resolved}: ${deterministic.reasons.join(" ")}`);
  }
  if (resolved === "REJECT") add("error", "VIEWER_VALUE_GATE_REJECTED", `The brief fails the Viewer Value Gate: ${deterministic.reasons.join(" ")}`);
  else if (resolved === "REVISE") add("warning", "VIEWER_VALUE_GATE_REVISION_REQUIRED", `The brief needs a stronger viewer-value case: ${deterministic.reasons.join(" ")}`);
  if (result.viewerValue.integrityFindings.some((item) => item.severity === "blocking")) {
    add("error", "CONTENT_INTEGRITY_BLOCKING_RISK", "The brief depends on a blocking content-integrity risk.");
  }
  if (result.viewerValue.contract.originalContribution.assessment.verdict === "absent") {
    add("error", "ORIGINAL_CONTRIBUTION_MISSING", "The brief identifies no original contribution beyond videos that already exist.");
  }

  // --- Hook honesty --------------------------------------------------------
  for (const concept of result.hookStrategy.concepts) {
    if (concept.deceptionRisk === "material") {
      add("error", "DECEPTIVE_HOOK", `Hook concept ${concept.conceptId} carries a material deception risk.`);
    }
  }

  // --- Monetization may not outrank viewer value ---------------------------
  if (result.monetizationAlignment.viewerValueImpact === "competes") {
    add("error", "MONETIZATION_OVERRIDES_VIEWER_VALUE", "Monetization alignment competes with viewer value rather than supporting it.");
  }
  if (result.monetizationAlignment.relevance === "NONE"
    && (result.monetizationAlignment.sponsorCategory || result.monetizationAlignment.affiliateRelevance || result.monetizationAlignment.paidProductAlignment)) {
    add("warning", "MONETIZATION_INCONSISTENT", "Monetization relevance is NONE but a sponsor, affiliate, or product alignment is still asserted.");
  }

  // --- Confidence may not exceed the bounded upstream evidence -------------
  const upstreamQa = Math.min(
    upstream.reference.finalQaScore,
    upstream.reference.upstreamStrategy.finalQaScore,
    upstream.reference.upstreamStrategy.upstreamResearch.finalQaScore,
  );
  if (upstreamQa < 80 && result.evidencePlan.sufficiency === "SUFFICIENT_TO_SCRIPT") {
    add("error", "CONFIDENCE_EXCEEDS_UPSTREAM_EVIDENCE", "Declaring the evidence sufficient to script exceeds the bounded upstream research, strategy, and content QA state.");
  }
  if (upstream.discoveryBundle.completionStatus === "partial" && result.evidencePlan.sufficiency === "SUFFICIENT_TO_SCRIPT") {
    add("warning", "CONFIDENCE_EXCEEDS_PARTIAL_DISCOVERY", "The upstream discovery bundle is partial, so declaring the evidence sufficient to script is not fully supported.");
  }

  // --- Fabrication and downstream scope ------------------------------------
  const text = allText(result).join("\n");
  if (FABRICATED_VIEWS.test(text)) add("error", "FABRICATED_PERFORMANCE_PREDICTION", "The brief predicts future views or subscribers.");
  if (FABRICATED_REVENUE.test(text)) add("error", "FABRICATED_REVENUE_PREDICTION", "The brief asserts revenue, CPM, or RPM figures.");
  if (FABRICATED_SEARCH_VOLUME.test(text)) add("error", "FABRICATED_SEARCH_VOLUME", "The brief asserts search-volume data no configured provider supplies.");
  if (FABRICATED_RETENTION.test(text)) add("error", "FABRICATED_RETENTION_PREDICTION", "The brief predicts a specific retention percentage or watch time.");
  if (MONETARY_GUARANTEE.test(text)) add("error", "UNSUPPORTED_MONETARY_GUARANTEE", "The brief contains an unsupported monetary guarantee.");
  if (TITLE_LEAKAGE.test(text)) add("error", "TITLE_SCOPE_VIOLATION", "The brief produced final title copy, which belongs to the downstream packaging stage.");
  if (THUMBNAIL_LEAKAGE.test(text)) add("error", "THUMBNAIL_SCOPE_VIOLATION", "The brief produced thumbnail copy or imagery, which belongs to a downstream stage.");
  if (STORYBOARD_LEAKAGE.test(text)) add("error", "STORYBOARD_SCOPE_VIOLATION", "The brief produced a storyboard or shot list, which belongs to a downstream stage.");
  if (SCRIPT_LEAKAGE.test(text)) add("error", "SCRIPT_SCOPE_VIOLATION", "The brief produced script, narration, or voiceover content, which belongs to the downstream script stage.");
  if (PUBLISHING_LEAKAGE.test(text)) add("error", "PUBLISHING_SCOPE_VIOLATION", "The brief asserted an upload, publishing, or release-readiness action.");

  const payloadBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (payloadBytes > maxPayloadBytes) {
    add("error", "RESULT_PAYLOAD_TOO_LARGE", `The brief serializes to ${payloadBytes} bytes, above the ${maxPayloadBytes}-byte durable-output margin.`);
  }
  return findings;
}

/** Semantic findings are filtered against known evidence exactly as the earlier stages do. */
export function mergeVideoBriefQA(
  deterministic: Finding[],
  semantic: VideoBriefSemanticQAOutput,
  modelUsage: ModelUsage,
  upstream: ApprovedContentOpportunityArtifact,
): VideoBriefQAResult {
  const { findings, errors, score, recommendation } = mergeSemanticQAFindings(
    deterministic,
    semantic,
    new Set(upstream.discoveryBundle.evidence.map((item) => item.id)),
    "The video brief QA model cited an unknown evidence ID.",
  );
  const failingRules = new Set(deterministic.map((item) => item.code)).size;
  return videoBriefQAResultSchema.parse({
    passed: errors === 0 && score >= 75,
    score,
    findings: findings.slice(0, 50),
    recommendation,
    deterministicChecksPassed: Math.max(0, DETERMINISTIC_VIDEO_BRIEF_RULE_COUNT - failingRules),
    deterministicChecksFailed: failingRules,
    modelUsage,
  });
}

/**
 * Integrity failures are not cosmetically fixable: a brief whose premise is
 * deceptive, whose provenance is corrupted, or which invents evidence must fail
 * closed rather than be rewritten into apparent compliance. Weak viewer value,
 * by contrast, is exactly what one bounded revision is for.
 */
export const UNREVISABLE_VIDEO_BRIEF_CODES = new Set([
  "UPSTREAM_CONTENT_REFERENCE_CHANGED",
  "SELECTED_TOPIC_IDENTITY_CHANGED",
  "VIEWER_VALUE_PROVENANCE_ALTERED",
  "VIEWER_VALUE_GATE_REJECTED",
  "CONTENT_INTEGRITY_BLOCKING_RISK",
  "UNSUPPORTED_MONETARY_GUARANTEE",
  "FABRICATED_SEARCH_VOLUME",
  "EVIDENCE_REFERENCE_NOT_FOUND",
]);

export function hasUnrevisableVideoBriefFailure(findings: Finding[]) {
  return findings.some((finding) => finding.severity === "error" && UNREVISABLE_VIDEO_BRIEF_CODES.has(finding.code));
}

/**
 * Includes the message because code plus evidence IDs alone could not tell apart
 * the same rule violated in two different places with no citations, letting a
 * revision reintroduce a violation and have it look pre-existing.
 */
export function videoBriefFindingFingerprint(finding: Finding) {
  return `${finding.code}:${[...finding.evidenceIds].sort().join(",")}:${finding.message}`;
}

export function newlyIntroducedVideoBriefErrors(before: Finding[], after: Finding[]) {
  const existing = new Set(before.filter((finding) => finding.severity === "error").map(videoBriefFindingFingerprint));
  return after.filter((finding) => finding.severity === "error" && !existing.has(videoBriefFindingFingerprint(finding)));
}
