import {
  channelVideoReleaseResultSchema,
  videoReleaseQAResultSchema,
  type ApprovedVideoPackagingArtifact,
  type ChannelVideoReleaseResult,
  type VideoReleaseQAResult,
} from "@/domain/production-workflows";
import { deterministicViewerValueGate, resolveViewerValueGate } from "@/domain/viewer-value";
import { canonicalEquals } from "./canonical-json";
import { hasConsistentEvidenceIdentity, mergeSemanticQAFindings } from "./evidence-qa";
import type { ModelUsage } from "./openai-research-model";
import type { VideoReleaseSemanticQAOutput } from "./video-release-model";

type Finding = VideoReleaseQAResult["findings"][number];

/** Deterministic rule count used to report a checks-passed figure. */
export const DETERMINISTIC_VIDEO_RELEASE_RULE_COUNT = 40;

const FABRICATED_VIEWS = /\b(?:will|should|expect(?:ed)?\s+to)\s+(?:get|reach|receive|hit)\b[^.]{0,40}\b(?:views?|subscribers?)\b|\b\d[\d,.]*\s*(?:k|m|million|thousand)?\+?\s*(?:views?|subscribers?)\s+(?:in|within|per|guaranteed|expected)\b/i;
const FABRICATED_REVENUE = /\b(?:cpm|rpm)\b\s*(?:of|is|=|:)?\s*\$?\d|\b(?:earn|earning|earnings|make|makes|making|generate|generates|generating|revenue|profit|income|payout)\b[^.]{0,40}\$\s*\d|\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|mo|year|yr|day)\b[^.]{0,40}\b(?:revenue|income|profit|earnings|payout)\b/i;
const FABRICATED_SEARCH_VOLUME = /\b(?:search(?:es)?\s+volume|monthly\s+searches|searched\s+\d[\d,.]*\s*times|\d[\d,.]*\s*(?:monthly\s+)?searches)\b/i;
const MONETARY_GUARANTEE = /\bguarantee(?:d|s)?\b[^.]{0,60}\$\s*\d|\bmake\s+\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|week|day|year)\b|\brisk[-\s]free\s+(?:income|profit)\b/i;
const FABRICATED_RETENTION = /\b\d{1,3}\s*%\s*(?:audience\s+)?retention\b|\bretention\b[^.]{0,40}\b\d{1,3}\s*%|\b(?:average\s+view\s+duration|watch\s+time)\b[^.]{0,40}\b\d+\s*(?:%|minutes?|seconds?)\b|\bviewers?\s+will\s+(?:stay|watch)\b[^.]{0,40}\b\d+\s*(?:%|minutes?)\b/i;

/**
 * Downstream actions this decision-and-record stage must never perform. The
 * release legitimately DISCUSSES publishing, scheduling, and distribution as its
 * subject (a publish window, a distribution plan, a hand-off to a later
 * publishing stage), so these patterns match only system-directed EXECUTION —
 * provider OAuth, an actual upload/publish through an API, external scheduling,
 * rendering, media/thumbnail/recut generation, and performance ingestion.
 */
const OAUTH_LEAKAGE = /\boauth\b|\bauthorize\s+(?:the\s+)?(?:youtube|channel|google|upload|api|account)\b|\b(?:access|refresh)\s+token\b|\bclient\s+secret\b/i;
const PUBLISH_EXECUTION = /\b(?:upload|uploads|uploading|publish|publishes|publishing)\b[^.]{0,30}\b(?:via|through|using|with)\b[^.]{0,20}\b(?:api|endpoint|provider|youtube\s+data\s+api)\b|\bpush\s+(?:the\s+)?video\s+live\b|\bgo\s+live\s+now\b|\b(?:call|calls|invoke|invokes|hit|hits)\b[^.]{0,30}\b(?:youtube|provider)\s+(?:data\s+)?api\b|\bupload\s+the\s+video\s+now\b|\bpublish(?:es|ed)?\s+(?:it\s+)?immediately\b/i;
const EXTERNAL_SCHEDULING = /\bschedule[sd]?\b[^.]{0,30}\b(?:via|through|using)\b[^.]{0,20}\b(?:api|provider|youtube)\b|\bschedule[sd]?\s+(?:the\s+)?(?:upload|publish|video)\s+(?:via|through|on\s+youtube|with\s+the\s+api)\b|\bprovider\s+scheduling\s+api\b/i;
const RENDER_WORKER_LEAKAGE = /\brender\s+(?:worker|job|queue|farm)\b|\bqueue[sd]?\s+(?:a\s+)?render\b|\bremotion\b|\benqueue\s+(?:the\s+)?render\b|\brender\s+the\s+(?:video|master|final\s+cut)\b/i;
const ASSET_GENERATION_LEAKAGE = /\b(?:generate|generates|render|renders|synthesize|synthesizes|produce|produces)\b[^.]{0,40}\b(?:image|images|voiceover\s+audio|voice\s+track|audio\s+file|video\s+file|footage|clip\s+file|b-?roll\s+footage)\b|\btext-to-(?:speech|image|video)\b/i;
const THUMBNAIL_GENERATION = /\b(?:generate|generates|render|renders|produce|produces|create|creates|design|designs|synthesize|synthesizes|export|exports)\b[^.]{0,40}\bthumbnail\s+(?:image|images|art|artwork|graphic|asset|png|jpe?g|file)\b|\bthumbnail\.(?:png|jpe?g|webp)\b/i;
const RECUT_GENERATION = /\b(?:generate|generates|produce|produces|create|creates|render|renders|cut|cuts|edit|edits)\b[^.]{0,30}\b(?:recut|re-cut|reels?|tiktok|vertical\s+(?:cut|version|edit)|youtube\s+shorts?|cross-?platform\s+(?:cut|recut|version|edit))\b|\bcross-?platform\s+recut\b/i;
const PERFORMANCE_INGESTION = /\b(?:ingest|ingests|ingesting|pull|pulls|fetch|fetches|retrieve|retrieves|import|imports)\b[^.]{0,40}\b(?:analytics|performance|views?|impressions|watch[-\s]?time|retention|ctr|subscribers?)\s+(?:data|numbers|figures|stats|statistics|metrics)\b|\byoutube\s+analytics\s+api\b|\bperformance\s+ingestion\b|\bactual\s+(?:views|impressions|retention|watch[-\s]?time|ctr)\b/i;

const VAGUE_PROMISE = /\beverything\s+(?:you\s+need\s+to\s+know|about\s+\w+)\b|\ball\s+you\s+need\s+to\s+know\b|\bthe\s+ultimate\s+guide\b|\bcomplete\s+guide\s+to\s+everything\b|\blearn\s+it\s+all\b|\banything\s+and\s+everything\b/i;

function allText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allText);
  if (value && typeof value === "object") return Object.values(value).flatMap(allText);
  return [];
}

function viewerValueEvidence(result: ChannelVideoReleaseResult) {
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

/** The exact upstream strategy identity every KPI/hypothesis binding must anchor to. */
function transitiveStrategyRunId(upstream: ApprovedVideoPackagingArtifact) {
  return upstream.reference.upstreamVideoScript.upstreamVideoBrief.upstreamContentIntelligence.upstreamStrategy.strategyRunId;
}

/**
 * The deterministic half of CHANNEL_VIDEO_RELEASE QA, and the authoritative one.
 * Every rule here is mechanically checkable; judgement calls (is the selected
 * title genuinely the most honest, does the thumbnail imply a payoff the video
 * delivers) belong to semantic QA, which cannot clear anything decided here.
 */
export function deterministicVideoReleaseValidation(
  resultValue: unknown,
  upstream: ApprovedVideoPackagingArtifact,
  maxPayloadBytes: number,
): Finding[] {
  const result = channelVideoReleaseResultSchema.parse(resultValue);
  const packaging = upstream.packagingResult;
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], code: string, message: string, evidenceIds: string[] = []) => findings.push({ severity, code, message, evidenceIds });

  // --- Upstream identity and provenance -----------------------------------
  if (!canonicalEquals(result.upstreamVideoPackaging, upstream.reference)) {
    add("error", "UPSTREAM_PACKAGING_REFERENCE_CHANGED", "The release changed the exact approved video-packaging reference.");
  }
  if (!canonicalEquals(result.releaseScope, upstream.scope)) {
    add("error", "RELEASE_SCOPE_IDENTITY_CHANGED", "The release altered the resolved topic, pillar, packaged promise, selectable candidate set, or inherited viewer-value provenance.");
  }
  if (!canonicalEquals(result.releaseScope.inheritedViewerValueProvenance, upstream.scope.inheritedViewerValueProvenance)) {
    add("error", "VIEWER_VALUE_PROVENANCE_ALTERED", "The inherited Viewer Value provenance or contract hash was altered.");
  }
  if (result.source.packagingTopicId !== upstream.scope.packagingTopicId) {
    add("error", "SOURCE_TOPIC_MISMATCH", `The release source cites topic ${result.source.packagingTopicId} but the resolved topic is ${upstream.scope.packagingTopicId}.`);
  }
  if (result.source.pillarId !== upstream.scope.pillarId) {
    add("error", "SOURCE_PILLAR_MISMATCH", `The release source cites pillar ${result.source.pillarId} but the resolved topic belongs to ${upstream.scope.pillarId}.`);
  }
  // The release promise must match the approved packaging's promise verbatim;
  // drift here is a value-integrity failure, not a stylistic warning.
  if (result.source.releasePromise !== packaging.source.packagedPromise) {
    add("error", "RELEASE_PROMISE_DIVERGES", "The release promise does not match the approved packaging's promise verbatim.");
  }

  // --- Title selection: an EXACT member of the packaging candidate set ------
  const titleById = new Map(packaging.titleCandidates.map((candidate) => [candidate.candidateId, candidate]));
  const selectedTitle = titleById.get(result.titleDecision.selectedCandidateId);
  if (!upstream.scope.titleCandidateIds.includes(result.titleDecision.selectedCandidateId) || !selectedTitle) {
    add("error", "TITLE_NOT_A_CANDIDATE", `The release selected title ${result.titleDecision.selectedCandidateId}, which is not one of the approved packaging's title candidates.`);
  } else {
    if (result.titleDecision.selectedTitleText !== selectedTitle.text) {
      add("error", "TITLE_TEXT_ALTERED", "The selected title text does not match the approved candidate's text verbatim.");
    }
    if (selectedTitle.deceptionRisk === "material") {
      add("error", "MISLEADING_RELEASE_SELECTION", `The release selected title ${selectedTitle.candidateId}, which the packaging flagged as a material deception risk.`);
    }
  }
  if (result.titleDecision.deceptionRisk === "material") {
    add("error", "MISLEADING_RELEASE_SELECTION", "The release records a material deception risk on the selected title.");
  }
  if (result.reconciledMetadata.finalTitle !== result.titleDecision.selectedTitleText) {
    add("error", "RECONCILED_TITLE_MISMATCH", "The reconciled final title does not match the selected title.");
  }

  // --- Thumbnail selection: an EXACT member of the packaging concept set -----
  const thumbById = new Map(packaging.thumbnailConcepts.map((concept) => [concept.conceptId, concept]));
  const selectedThumb = thumbById.get(result.thumbnailDecision.selectedConceptId);
  if (!upstream.scope.thumbnailConceptIds.includes(result.thumbnailDecision.selectedConceptId) || !selectedThumb) {
    add("error", "THUMBNAIL_NOT_A_CANDIDATE", `The release selected thumbnail ${result.thumbnailDecision.selectedConceptId}, which is not one of the approved packaging's thumbnail concepts.`);
  } else if (selectedThumb.deceptionRisk === "material") {
    add("error", "MISLEADING_RELEASE_SELECTION", `The release selected thumbnail ${selectedThumb.conceptId}, which the packaging flagged as a material deception risk.`);
  }
  if (result.thumbnailDecision.deceptionRisk === "material") {
    add("error", "MISLEADING_RELEASE_SELECTION", "The release records a material deception risk on the selected thumbnail.");
  }

  // --- Misleading / deceptive-packaging guard re-run at selection time ------
  if (result.releaseIntegrity.misleadingGuardOutcome !== "PASS") {
    add("error", "MISLEADING_GUARD_FAILED", "The release's re-run of the misleading-packaging guard did not pass; it cannot be finalized.");
  }
  if (result.viewerValue.integrityFindings.some((item) => item.risk === "MISLEADING_PACKAGING" && item.severity !== "advisory")) {
    add("error", "MISLEADING_RELEASE_RISK", "The release depends on a material or blocking MISLEADING_PACKAGING integrity risk.");
  }

  // --- Reconciled metadata derived from the approved packaging --------------
  const chapterById = new Map(packaging.chapters.map((chapter) => [chapter.chapterId, chapter]));
  if (result.reconciledMetadata.chapters.length !== packaging.chapters.length) {
    add("error", "CHAPTERS_NOT_DERIVED", "The reconciled chapters do not match the approved packaging's chapter set.");
  }
  for (const chapter of result.reconciledMetadata.chapters) {
    const source = chapterById.get(chapter.chapterId);
    if (!source) {
      add("error", "CHAPTER_NOT_DERIVED", `Chapter ${chapter.chapterId} is not present in the approved packaging.`);
    } else if (chapter.startSeconds !== source.startSeconds || chapter.title !== source.title || chapter.sourceScriptSectionId !== source.sourceScriptSectionId) {
      add("error", "CHAPTER_ALTERED", `Chapter ${chapter.chapterId} was altered from the approved packaging.`);
    }
  }
  const packagingTags = new Set(packaging.tags);
  const inventedTags = result.reconciledMetadata.tags.filter((tag) => !packagingTags.has(tag));
  if (inventedTags.length) {
    add("error", "TAGS_NOT_DERIVED", "The reconciled metadata introduces tags absent from the approved packaging.", []);
  }

  // --- Publish window is a bounded intent, never a dispatch -----------------
  const earliest = Date.parse(result.publishWindow.earliest);
  const latest = Date.parse(result.publishWindow.latest);
  if (Number.isFinite(earliest) && Number.isFinite(latest) && earliest > latest) {
    add("error", "PUBLISH_WINDOW_INVERTED", "The recommended publish window ends before it begins.");
  }

  // --- KPI / hypothesis bindings anchor to the exact strategy identity -------
  const strategyRunId = transitiveStrategyRunId(upstream);
  for (const binding of result.kpiHypothesisBindings) {
    if (binding.strategyRunId !== strategyRunId) {
      add("error", "KPI_STRATEGY_IDENTITY_MISMATCH", `A KPI/hypothesis binding cites strategy run ${binding.strategyRunId}, which is not the release's upstream strategy ${strategyRunId}.`);
    }
  }

  // --- Evidence integrity --------------------------------------------------
  const known = new Map(upstream.discoveryBundle.evidence.map((item) => [item.id, item]));
  const cited = new Set<string>(viewerValueEvidence(result));
  const missing = [...cited].filter((id) => !known.has(id));
  if (missing.length) add("error", "EVIDENCE_REFERENCE_NOT_FOUND", "The release cites evidence IDs outside the approved upstream discovery bundle.", missing.slice(0, 20));

  for (const item of upstream.discoveryBundle.evidence) {
    const consistent = item.sourceType === "search"
      ? item.id === `yt:search:${item.sourceId}` && item.url === null
      : hasConsistentEvidenceIdentity({ id: item.id, url: item.url ?? "", sourceType: item.sourceType, sourceId: item.sourceId });
    if (!consistent) add("error", "EVIDENCE_IDENTITY_MISMATCH", `Upstream evidence identity is inconsistent for ${item.id}.`, [item.id]);
  }

  // --- Vague promise -------------------------------------------------------
  if (VAGUE_PROMISE.test(result.source.releasePromise)) {
    add("error", "RELEASE_PROMISE_VAGUE", "The release promise is too vague to verify against the selected packaging.");
  }

  // --- Viewer Value Gate: deterministic floor overrules an optimistic model -
  const deterministic = deterministicViewerValueGate(result.viewerValue);
  const resolved = resolveViewerValueGate(deterministic.gate, result.viewerValue.gate);
  if (resolved !== result.viewerValue.gate) {
    add("error", "VIEWER_VALUE_GATE_UNDERSTATED", `The release claims gate ${result.viewerValue.gate} but deterministic rules require ${resolved}: ${deterministic.reasons.join(" ")}`);
  }
  if (resolved === "REJECT") add("error", "VIEWER_VALUE_GATE_REJECTED", `The release fails the Viewer Value Gate: ${deterministic.reasons.join(" ")}`);
  else if (resolved === "REVISE") add("error", "VIEWER_VALUE_GATE_REVISION_REQUIRED", `The release needs a stronger viewer-value case before it can finalize: ${deterministic.reasons.join(" ")}`);
  if (result.viewerValue.integrityFindings.some((item) => item.severity === "blocking")) {
    add("error", "CONTENT_INTEGRITY_BLOCKING_RISK", "The release depends on a blocking content-integrity risk.");
  }

  // --- Fabrication and downstream scope ------------------------------------
  const text = allText(result).join("\n");
  if (FABRICATED_VIEWS.test(text)) add("error", "FABRICATED_PERFORMANCE_PREDICTION", "The release predicts future views or subscribers.");
  if (FABRICATED_REVENUE.test(text)) add("error", "FABRICATED_REVENUE_PREDICTION", "The release asserts revenue, CPM, or RPM figures.");
  if (FABRICATED_SEARCH_VOLUME.test(text)) add("error", "FABRICATED_SEARCH_VOLUME", "The release asserts search-volume data no configured provider supplies.");
  if (FABRICATED_RETENTION.test(text)) add("error", "FABRICATED_RETENTION_PREDICTION", "The release predicts a specific retention percentage or watch time.");
  if (MONETARY_GUARANTEE.test(text)) add("error", "UNSUPPORTED_MONETARY_GUARANTEE", "The release contains an unsupported monetary guarantee.");
  if (OAUTH_LEAKAGE.test(text)) add("error", "OAUTH_SCOPE_VIOLATION", "The release referenced provider OAuth or credential authorization, which belongs to a downstream publishing stage.");
  if (PUBLISH_EXECUTION.test(text)) add("error", "PUBLISH_EXECUTION_SCOPE_VIOLATION", "The release attempted to upload or publish the video; this stage records a decision only.");
  if (EXTERNAL_SCHEDULING.test(text)) add("error", "EXTERNAL_SCHEDULING_SCOPE_VIOLATION", "The release attempted to schedule through a provider API; the publish window is an intent only.");
  if (RENDER_WORKER_LEAKAGE.test(text)) add("error", "RENDER_WORKER_SCOPE_VIOLATION", "The release referenced a render worker or rendering job, which belongs to a downstream stage.");
  if (ASSET_GENERATION_LEAKAGE.test(text)) add("error", "ASSET_GENERATION_SCOPE_VIOLATION", "The release attempted to generate media assets, which belong to a downstream stage.");
  if (THUMBNAIL_GENERATION.test(text)) add("error", "THUMBNAIL_GENERATION_SCOPE_VIOLATION", "The release attempted to generate a thumbnail image, which belongs to a downstream stage.");
  if (RECUT_GENERATION.test(text)) add("error", "RECUT_GENERATION_SCOPE_VIOLATION", "The release attempted to generate a cross-platform recut, which belongs to a downstream stage.");
  if (PERFORMANCE_INGESTION.test(text)) add("error", "PERFORMANCE_INGESTION_SCOPE_VIOLATION", "The release attempted to ingest or assert measured performance data, which belongs to a downstream measurement stage.");

  const payloadBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (payloadBytes > maxPayloadBytes) {
    add("error", "RESULT_PAYLOAD_TOO_LARGE", `The release serializes to ${payloadBytes} bytes, above the ${maxPayloadBytes}-byte durable-output margin.`);
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
export function mergeVideoReleaseQA(
  deterministic: Finding[],
  semantic: VideoReleaseSemanticQAOutput,
  modelUsage: ModelUsage,
  upstream: ApprovedVideoPackagingArtifact,
  criticFindings: Finding[] = [],
): VideoReleaseQAResult {
  const { findings, errors, score, recommendation } = mergeSemanticQAFindings(
    deterministic,
    { ...semantic, findings: [...semantic.findings, ...criticFindings] },
    new Set(upstream.discoveryBundle.evidence.map((item) => item.id)),
    "The video release QA model cited an unknown evidence ID.",
  );
  const failingRules = new Set(deterministic.map((item) => item.code)).size;
  const ranked = [...findings].sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]);
  return videoReleaseQAResultSchema.parse({
    passed: errors === 0 && score >= 75,
    score,
    findings: ranked.slice(0, 50),
    recommendation,
    deterministicChecksPassed: Math.max(0, DETERMINISTIC_VIDEO_RELEASE_RULE_COUNT - failingRules),
    deterministicChecksFailed: failingRules,
    modelUsage,
  });
}

/**
 * Integrity failures are not cosmetically fixable: a release whose promise is
 * dishonest, whose provenance is corrupted, which selects a title outside the
 * approved candidate set, which invents evidence, or which misleads a viewer must
 * fail closed rather than be rewritten into apparent compliance. Weak viewer
 * value, by contrast, is exactly what one bounded revision is for.
 */
export const UNREVISABLE_VIDEO_RELEASE_CODES = new Set([
  "UPSTREAM_PACKAGING_REFERENCE_CHANGED",
  "RELEASE_SCOPE_IDENTITY_CHANGED",
  "VIEWER_VALUE_PROVENANCE_ALTERED",
  "VIEWER_VALUE_GATE_REJECTED",
  "CONTENT_INTEGRITY_BLOCKING_RISK",
  "MISLEADING_RELEASE_RISK",
  "MISLEADING_RELEASE_SELECTION",
  "KPI_STRATEGY_IDENTITY_MISMATCH",
  "UNSUPPORTED_MONETARY_GUARANTEE",
  "FABRICATED_SEARCH_VOLUME",
  "EVIDENCE_REFERENCE_NOT_FOUND",
]);

export function hasUnrevisableVideoReleaseFailure(findings: Finding[]) {
  return findings.some((finding) => finding.severity === "error" && UNREVISABLE_VIDEO_RELEASE_CODES.has(finding.code));
}

/**
 * Includes the message because code plus evidence IDs alone could not tell apart
 * the same rule violated in two different places with no citations, letting a
 * revision reintroduce a violation and have it look pre-existing.
 */
export function videoReleaseFindingFingerprint(finding: Finding) {
  return `${finding.code}:${[...finding.evidenceIds].sort().join(",")}:${finding.message}`;
}

export function newlyIntroducedVideoReleaseErrors(before: Finding[], after: Finding[]) {
  const existing = new Set(before.filter((finding) => finding.severity === "error").map(videoReleaseFindingFingerprint));
  return after.filter((finding) => finding.severity === "error" && !existing.has(videoReleaseFindingFingerprint(finding)));
}
