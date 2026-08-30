import {
  channelVideoPackagingResultSchema,
  videoPackagingQAResultSchema,
  type ApprovedVideoScriptArtifact,
  type ChannelVideoPackagingResult,
  type VideoPackagingQAResult,
} from "@/domain/production-workflows";
import { deterministicViewerValueGate, resolveViewerValueGate } from "@/domain/viewer-value";
import { canonicalEquals } from "./canonical-json";
import { hasConsistentEvidenceIdentity, mergeSemanticQAFindings } from "./evidence-qa";
import type { ModelUsage } from "./openai-research-model";
import type { VideoPackagingSemanticQAOutput } from "./video-packaging-model";

type Finding = VideoPackagingQAResult["findings"][number];

/** Deterministic rule count used to report a checks-passed figure. */
export const DETERMINISTIC_VIDEO_PACKAGING_RULE_COUNT = 34;

const FABRICATED_VIEWS = /\b(?:will|should|expect(?:ed)?\s+to)\s+(?:get|reach|receive|hit)\b[^.]{0,40}\b(?:views?|subscribers?)\b|\b\d[\d,.]*\s*(?:k|m|million|thousand)?\+?\s*(?:views?|subscribers?)\s+(?:in|within|per|guaranteed|expected)\b/i;
const FABRICATED_REVENUE = /\b(?:cpm|rpm)\b\s*(?:of|is|=|:)?\s*\$?\d|\b(?:earn|earning|earnings|make|makes|making|generate|generates|generating|revenue|profit|income|payout)\b[^.]{0,40}\$\s*\d|\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|mo|year|yr|day)\b[^.]{0,40}\b(?:revenue|income|profit|earnings|payout)\b/i;
const FABRICATED_SEARCH_VOLUME = /\b(?:search(?:es)?\s+volume|monthly\s+searches|searched\s+\d[\d,.]*\s*times|\d[\d,.]*\s*(?:monthly\s+)?searches)\b/i;
const MONETARY_GUARANTEE = /\bguarantee(?:d|s)?\b[^.]{0,60}\$\s*\d|\bmake\s+\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|week|day|year)\b|\brisk[-\s]free\s+(?:income|profit)\b/i;
const FABRICATED_RETENTION = /\b\d{1,3}\s*%\s*(?:audience\s+)?retention\b|\bretention\b[^.]{0,40}\b\d{1,3}\s*%|\b(?:average\s+view\s+duration|watch\s+time)\b[^.]{0,40}\b\d+\s*(?:%|minutes?|seconds?)\b|\bviewers?\s+will\s+(?:stay|watch)\b[^.]{0,40}\b\d+\s*(?:%|minutes?)\b/i;

/**
 * Downstream artifacts and actions this stage must not produce. Scoped to
 * Channelwright *producing* the artifact: packaging legitimately discusses
 * titles, thumbnails, and descriptions as its own subject, so only system-
 * directed production verbs and explicit selection/generation match.
 */
// Title SELECTION: packaging produces candidates only; naming one as final/chosen is a scope violation.
const TITLE_SELECTION = /\b(?:final|chosen|selected|winning)\s+title\b|\b(?:final|selected|chosen)title\b|\bwe\s+(?:recommend|select|choose|pick)\s+(?:the\s+)?(?:following\s+)?title\b|\btitle\s+to\s+use\s*[:=]/i;
// Thumbnail IMAGE/asset generation (not the concept/copy/visual-intent this stage does produce).
const THUMBNAIL_GENERATION = /\b(?:generate|generates|render|renders|produce|produces|create|creates|design|designs|synthesize|synthesizes|export|exports)\b[^.]{0,40}\bthumbnail\s+(?:image|images|art|artwork|graphic|asset|png|jpe?g|file)\b|\btext-to-image\b|\bgenerated\s+thumbnail\s+(?:image|art|asset)\b|\bthumbnail\.(?:png|jpe?g|webp)\b/i;
const STORYBOARD_LEAKAGE = /\b(?:generate|generates|produce|produces|render|renders|create|creates)\b[^.]{0,40}\b(?:storyboard|shot\s+list)\b|\bstoryboard\s*[:=]|\bshot\s+list\s*[:=]/i;
const ASSET_GENERATION_LEAKAGE = /\b(?:generate|generates|render|renders|synthesize|synthesizes|produce|produces)\b[^.]{0,40}\b(?:image|images|b-?roll\s+footage|voiceover\s+audio|voice\s+track|audio\s+file|video\s+file|footage|clip\s+file)\b|\btext-to-(?:speech|video)\b/i;
const PUBLISHING_LEAKAGE = /\b(?:upload|uploads|uploading|publish|publishes|publishing|schedule[sd]?\s+for\s+release)\b[^.]{0,40}\b(?:video|youtube|channel)\b|\bready\s+to\s+(?:publish|upload|export)\b|\bpublishing\s+schedule\b|\boauth\b|\bauthorize\s+(?:the\s+)?(?:youtube|channel|upload)\b/i;
// Render-worker / live media provider: this stage never touches rendering or a media provider.
const RENDER_WORKER_LEAKAGE = /\brender\s+(?:worker|job|queue|farm)\b|\bqueue[sd]?\s+(?:a\s+)?render\b|\bremotion\b|\benqueue\s+(?:the\s+)?render\b/i;

const VAGUE_PROMISE = /\beverything\s+(?:you\s+need\s+to\s+know|about\s+\w+)\b|\ball\s+you\s+need\s+to\s+know\b|\bthe\s+ultimate\s+guide\b|\bcomplete\s+guide\s+to\s+everything\b|\blearn\s+it\s+all\b|\banything\s+and\s+everything\b/i;

function allText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allText);
  if (value && typeof value === "object") return Object.values(value).flatMap(allText);
  return [];
}

function viewerValueEvidence(result: ChannelVideoPackagingResult) {
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
 * The deterministic half of CHANNEL_VIDEO_PACKAGING QA, and the authoritative
 * one. Every rule here is mechanically checkable; judgement calls (is a title
 * genuinely honest, does a thumbnail imply a payoff the script delivers) belong
 * to semantic QA, which cannot clear anything decided here.
 */
export function deterministicVideoPackagingValidation(
  resultValue: unknown,
  upstream: ApprovedVideoScriptArtifact,
  maxPayloadBytes: number,
): Finding[] {
  const result = channelVideoPackagingResultSchema.parse(resultValue);
  const script = upstream.scriptResult;
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], code: string, message: string, evidenceIds: string[] = []) => findings.push({ severity, code, message, evidenceIds });

  // --- Upstream identity and provenance -----------------------------------
  if (!canonicalEquals(result.upstreamVideoScript, upstream.reference)) {
    add("error", "UPSTREAM_SCRIPT_REFERENCE_CHANGED", "The packaging changed the exact approved video-script reference.");
  }
  if (!canonicalEquals(result.packagingScope, upstream.scope)) {
    add("error", "PACKAGING_SCOPE_IDENTITY_CHANGED", "The packaging altered the resolved topic, pillar, inherited viewer-value provenance, or script timing.");
  }
  if (!canonicalEquals(result.packagingScope.inheritedViewerValueProvenance, upstream.scope.inheritedViewerValueProvenance)) {
    add("error", "VIEWER_VALUE_PROVENANCE_ALTERED", "The inherited Viewer Value provenance or contract hash was altered.");
  }
  if (result.source.scriptTopicId !== upstream.scope.scriptTopicId) {
    add("error", "SOURCE_TOPIC_MISMATCH", `The packaging source cites topic ${result.source.scriptTopicId} but the resolved topic is ${upstream.scope.scriptTopicId}.`);
  }
  if (result.source.pillarId !== upstream.scope.pillarId) {
    add("error", "SOURCE_PILLAR_MISMATCH", `The packaging source cites pillar ${result.source.pillarId} but the resolved topic belongs to ${upstream.scope.pillarId}.`);
  }
  // The contract states the packaged promise must match the approved script's
  // promise; drift here is a value-integrity failure, not a stylistic warning.
  if (result.source.packagedPromise !== script.source.scriptedPromise) {
    add("error", "PACKAGED_PROMISE_DIVERGES", "The packaged promise does not match the approved script's promise verbatim.");
  }

  // --- Evidence integrity --------------------------------------------------
  const known = new Map(upstream.discoveryBundle.evidence.map((item) => [item.id, item]));
  const cited = new Set<string>([
    ...result.titleCandidates.flatMap((candidate) => candidate.evidenceIds),
    ...result.thumbnailConcepts.flatMap((concept) => concept.evidenceIds),
    ...viewerValueEvidence(result),
  ]);
  const missing = [...cited].filter((id) => !known.has(id));
  if (missing.length) add("error", "EVIDENCE_REFERENCE_NOT_FOUND", "The packaging cites evidence IDs outside the approved upstream discovery bundle.", missing.slice(0, 20));

  for (const item of upstream.discoveryBundle.evidence) {
    const consistent = item.sourceType === "search"
      ? item.id === `yt:search:${item.sourceId}` && item.url === null
      : hasConsistentEvidenceIdentity({ id: item.id, url: item.url ?? "", sourceType: item.sourceType, sourceId: item.sourceId });
    if (!consistent) add("error", "EVIDENCE_IDENTITY_MISMATCH", `Upstream evidence identity is inconsistent for ${item.id}.`, [item.id]);
  }

  // --- Chapters derived from the approved script timing --------------------
  // The approved script's own section timeline is authoritative. A chapter must
  // point at a real script section and use that section's start time; a
  // timestamp that is not derived from the script is a fabrication.
  const sectionStart = new Map(script.sections.map((section) => [section.sectionId, section.startSeconds]));
  const chapterIds = result.chapters.map((chapter) => chapter.chapterId);
  if (new Set(chapterIds).size !== chapterIds.length) add("error", "DUPLICATE_CHAPTER_IDENTITY", "The packaging lists the same chapter identifier more than once.");
  for (const chapter of result.chapters) {
    if (!sectionStart.has(chapter.sourceScriptSectionId)) {
      add("error", "CHAPTER_SECTION_UNKNOWN", `Chapter ${chapter.chapterId} maps to script section ${chapter.sourceScriptSectionId}, which is not in the approved script.`);
    } else if (chapter.startSeconds !== sectionStart.get(chapter.sourceScriptSectionId)) {
      add("error", "CHAPTER_TIMING_NOT_DERIVED", `Chapter ${chapter.chapterId} starts at ${chapter.startSeconds}s but its script section ${chapter.sourceScriptSectionId} starts at ${sectionStart.get(chapter.sourceScriptSectionId)}s.`);
    }
    if (chapter.startSeconds >= script.timing.totalDurationSeconds) {
      add("error", "CHAPTER_OUTSIDE_TIMELINE", `Chapter ${chapter.chapterId} starts at ${chapter.startSeconds}s, at or beyond the script's ${script.timing.totalDurationSeconds}s total duration.`);
    }
  }
  const ordered = [...result.chapters].sort((left, right) => left.startSeconds - right.startSeconds);
  if (ordered[0]?.startSeconds !== 0) add("error", "CHAPTERS_DO_NOT_START_AT_ZERO", "YouTube chapters must begin with a chapter at 0 seconds.");
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].startSeconds === ordered[index - 1].startSeconds) {
      add("error", "DUPLICATE_CHAPTER_TIMESTAMP", `Two chapters share the start time ${ordered[index].startSeconds}s.`);
      break;
    }
  }
  // The chapters must not silently reorder the script: a chapter's order by start
  // time must match its source section's order in the script timeline.
  const sectionOrder = new Map(script.sections.map((section, position) => [section.sectionId, position]));
  for (let index = 1; index < ordered.length; index += 1) {
    const prev = sectionOrder.get(ordered[index - 1].sourceScriptSectionId);
    const curr = sectionOrder.get(ordered[index].sourceScriptSectionId);
    if (prev !== undefined && curr !== undefined && curr <= prev) {
      add("error", "CHAPTER_ORDER_DIVERGES_FROM_SCRIPT", "Chapter order does not follow the approved script's section order.");
      break;
    }
  }

  // --- Misleading-packaging guard -----------------------------------------
  // A title or thumbnail whose curiosity the video never pays off is the exact
  // MISLEADING_PACKAGING risk the shared doctrine names. A material deception
  // risk fails closed here rather than being softened into apparent compliance.
  for (const candidate of result.titleCandidates) {
    if (candidate.deceptionRisk === "material") add("error", "MISLEADING_TITLE", `Title candidate ${candidate.candidateId} carries a material deception risk.`);
  }
  for (const concept of result.thumbnailConcepts) {
    if (concept.deceptionRisk === "material") add("error", "MISLEADING_THUMBNAIL", `Thumbnail concept ${concept.conceptId} carries a material deception risk.`);
  }
  if (result.viewerValue.integrityFindings.some((item) => item.risk === "MISLEADING_PACKAGING" && item.severity !== "advisory")) {
    add("error", "MISLEADING_PACKAGING_RISK", "The packaging depends on a material or blocking MISLEADING_PACKAGING integrity risk.");
  }

  // --- End-screen / CTA consistency ---------------------------------------
  if (result.endScreenPlan.ctaObjective === "NONE" && result.endScreenPlan.elements.length > 0) {
    add("warning", "END_SCREEN_INCONSISTENT", "The end-screen CTA objective is NONE but end-screen elements are still planned.");
  }

  // --- Vague promise -------------------------------------------------------
  if (VAGUE_PROMISE.test(result.source.packagedPromise)) {
    add("error", "PACKAGED_PROMISE_VAGUE", "The packaged promise is too vague to verify against the packaging.");
  }

  // --- Viewer Value Gate: deterministic floor overrules an optimistic model -
  const deterministic = deterministicViewerValueGate(result.viewerValue);
  const resolved = resolveViewerValueGate(deterministic.gate, result.viewerValue.gate);
  if (resolved !== result.viewerValue.gate) {
    add("error", "VIEWER_VALUE_GATE_UNDERSTATED", `The packaging claims gate ${result.viewerValue.gate} but deterministic rules require ${resolved}: ${deterministic.reasons.join(" ")}`);
  }
  if (resolved === "REJECT") add("error", "VIEWER_VALUE_GATE_REJECTED", `The packaging fails the Viewer Value Gate: ${deterministic.reasons.join(" ")}`);
  else if (resolved === "REVISE") add("error", "VIEWER_VALUE_GATE_REVISION_REQUIRED", `The packaging needs a stronger viewer-value case before it can finalize: ${deterministic.reasons.join(" ")}`);
  if (result.viewerValue.integrityFindings.some((item) => item.severity === "blocking")) {
    add("error", "CONTENT_INTEGRITY_BLOCKING_RISK", "The packaging depends on a blocking content-integrity risk.");
  }

  // --- Fabrication and downstream scope ------------------------------------
  const text = allText(result).join("\n");
  if (FABRICATED_VIEWS.test(text)) add("error", "FABRICATED_PERFORMANCE_PREDICTION", "The packaging predicts future views or subscribers.");
  if (FABRICATED_REVENUE.test(text)) add("error", "FABRICATED_REVENUE_PREDICTION", "The packaging asserts revenue, CPM, or RPM figures.");
  if (FABRICATED_SEARCH_VOLUME.test(text)) add("error", "FABRICATED_SEARCH_VOLUME", "The packaging asserts search-volume data no configured provider supplies.");
  if (FABRICATED_RETENTION.test(text)) add("error", "FABRICATED_RETENTION_PREDICTION", "The packaging predicts a specific retention percentage or watch time.");
  if (MONETARY_GUARANTEE.test(text)) add("error", "UNSUPPORTED_MONETARY_GUARANTEE", "The packaging contains an unsupported monetary guarantee.");
  if (TITLE_SELECTION.test(text)) add("error", "TITLE_SELECTION_SCOPE_VIOLATION", "The packaging selected a single title; this stage produces candidates only.");
  if (THUMBNAIL_GENERATION.test(text)) add("error", "THUMBNAIL_GENERATION_SCOPE_VIOLATION", "The packaging attempted to generate a thumbnail image, which belongs to a downstream stage.");
  if (STORYBOARD_LEAKAGE.test(text)) add("error", "STORYBOARD_SCOPE_VIOLATION", "The packaging produced a storyboard or shot list, which belongs to a downstream stage.");
  if (ASSET_GENERATION_LEAKAGE.test(text)) add("error", "ASSET_GENERATION_SCOPE_VIOLATION", "The packaging attempted to generate media assets, which belong to a downstream stage.");
  if (PUBLISHING_LEAKAGE.test(text)) add("error", "PUBLISHING_SCOPE_VIOLATION", "The packaging asserted an upload, publishing, OAuth, or release-readiness action.");
  if (RENDER_WORKER_LEAKAGE.test(text)) add("error", "RENDER_WORKER_SCOPE_VIOLATION", "The packaging referenced a render worker or rendering job, which belongs to a downstream stage.");

  const payloadBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (payloadBytes > maxPayloadBytes) {
    add("error", "RESULT_PAYLOAD_TOO_LARGE", `The packaging serializes to ${payloadBytes} bytes, above the ${maxPayloadBytes}-byte durable-output margin.`);
  }
  return findings;
}

const SEVERITY_RANK: Record<Finding["severity"], number> = { error: 0, warning: 1, info: 2 };

/**
 * Merges deterministic, semantic-QA, and independent-critic findings into one QA
 * verdict. `criticFindings` are decision-critical: they enter the pass/fail
 * evaluation in FULL and are never truncated before it, so a blocking critic
 * error always survives regardless of how many semantic-QA findings exist. Only
 * the persisted `findings` array is capped for storage/display — and errors are
 * ranked first so the cap can never drop a blocking finding.
 */
export function mergeVideoPackagingQA(
  deterministic: Finding[],
  semantic: VideoPackagingSemanticQAOutput,
  modelUsage: ModelUsage,
  upstream: ApprovedVideoScriptArtifact,
  criticFindings: Finding[] = [],
): VideoPackagingQAResult {
  const { findings, errors, score, recommendation } = mergeSemanticQAFindings(
    deterministic,
    { ...semantic, findings: [...semantic.findings, ...criticFindings] },
    new Set(upstream.discoveryBundle.evidence.map((item) => item.id)),
    "The video packaging QA model cited an unknown evidence ID.",
  );
  const failingRules = new Set(deterministic.map((item) => item.code)).size;
  const ranked = [...findings].sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]);
  return videoPackagingQAResultSchema.parse({
    passed: errors === 0 && score >= 75,
    score,
    findings: ranked.slice(0, 50),
    recommendation,
    deterministicChecksPassed: Math.max(0, DETERMINISTIC_VIDEO_PACKAGING_RULE_COUNT - failingRules),
    deterministicChecksFailed: failingRules,
    modelUsage,
  });
}

/**
 * Integrity failures are not cosmetically fixable: packaging whose promise is
 * dishonest, whose provenance is corrupted, which invents evidence, or which
 * misleads a viewer must fail closed rather than be rewritten into apparent
 * compliance. Weak viewer value, by contrast, is exactly what one bounded
 * revision is for.
 */
export const UNREVISABLE_VIDEO_PACKAGING_CODES = new Set([
  "UPSTREAM_SCRIPT_REFERENCE_CHANGED",
  "PACKAGING_SCOPE_IDENTITY_CHANGED",
  "VIEWER_VALUE_PROVENANCE_ALTERED",
  "VIEWER_VALUE_GATE_REJECTED",
  "CONTENT_INTEGRITY_BLOCKING_RISK",
  "MISLEADING_PACKAGING_RISK",
  "UNSUPPORTED_MONETARY_GUARANTEE",
  "FABRICATED_SEARCH_VOLUME",
  "EVIDENCE_REFERENCE_NOT_FOUND",
]);

export function hasUnrevisableVideoPackagingFailure(findings: Finding[]) {
  return findings.some((finding) => finding.severity === "error" && UNREVISABLE_VIDEO_PACKAGING_CODES.has(finding.code));
}

/**
 * Includes the message because code plus evidence IDs alone could not tell apart
 * the same rule violated in two different places with no citations, letting a
 * revision reintroduce a violation and have it look pre-existing.
 */
export function videoPackagingFindingFingerprint(finding: Finding) {
  return `${finding.code}:${[...finding.evidenceIds].sort().join(",")}:${finding.message}`;
}

export function newlyIntroducedVideoPackagingErrors(before: Finding[], after: Finding[]) {
  const existing = new Set(before.filter((finding) => finding.severity === "error").map(videoPackagingFindingFingerprint));
  return after.filter((finding) => finding.severity === "error" && !existing.has(videoPackagingFindingFingerprint(finding)));
}
