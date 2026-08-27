import {
  channelVideoScriptResultSchema,
  videoScriptQAResultSchema,
  type ApprovedVideoBriefArtifact,
  type ChannelVideoScriptResult,
  type VideoScriptQAResult,
} from "@/domain/production-workflows";
import { deterministicViewerValueGate, resolveViewerValueGate } from "@/domain/viewer-value";
import { canonicalEquals } from "./canonical-json";
import { hasConsistentEvidenceIdentity, mergeSemanticQAFindings } from "./evidence-qa";
import type { ModelUsage } from "./openai-research-model";
import type { VideoScriptSemanticQAOutput } from "./video-script-model";

type Finding = VideoScriptQAResult["findings"][number];

/** Deterministic rule count used to report a checks-passed figure. */
export const DETERMINISTIC_VIDEO_SCRIPT_RULE_COUNT = 36;

const FABRICATED_VIEWS = /\b(?:will|should|expect(?:ed)?\s+to)\s+(?:get|reach|receive|hit)\b[^.]{0,40}\b(?:views?|subscribers?)\b|\b\d[\d,.]*\s*(?:k|m|million|thousand)?\+?\s*(?:views?|subscribers?)\s+(?:in|within|per|guaranteed|expected)\b/i;
const FABRICATED_REVENUE = /\b(?:cpm|rpm)\b\s*(?:of|is|=|:)?\s*\$?\d|\b(?:earn|earning|earnings|make|makes|making|generate|generates|generating|revenue|profit|income|payout)\b[^.]{0,40}\$\s*\d|\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|mo|year|yr|day)\b[^.]{0,40}\b(?:revenue|income|profit|earnings|payout)\b/i;
const FABRICATED_SEARCH_VOLUME = /\b(?:search(?:es)?\s+volume|monthly\s+searches|searched\s+\d[\d,.]*\s*times|\d[\d,.]*\s*(?:monthly\s+)?searches)\b/i;
const MONETARY_GUARANTEE = /\bguarantee(?:d|s)?\b[^.]{0,60}\$\s*\d|\bmake\s+\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|week|day|year)\b|\brisk[-\s]free\s+(?:income|profit)\b/i;
// Backstop for the one dangerous language family a paraphrased forbidden claim
// most often uses: an absolute guarantee of a zero/none/never outcome. This is a
// deterministic net for that family only, NOT a general semantic claim matcher —
// paraphrase detection is the independent semantic critic's job.
// ponytail: guarantee-language heuristic; the semantic (cross-provider) critic is the general layer.
const OUTCOME_GUARANTEE = /\b(?:guarantee[sd]?|guaranteed|ensures?|will\s+(?:never|always)|100%|completely\s+eliminat)\b[^.]{0,60}\b(?:no|zero|never|any|every|all|without)\b/i;
const FABRICATED_RETENTION = /\b\d{1,3}\s*%\s*(?:audience\s+)?retention\b|\bretention\b[^.]{0,40}\b\d{1,3}\s*%|\b(?:average\s+view\s+duration|watch\s+time)\b[^.]{0,40}\b\d+\s*(?:%|minutes?|seconds?)\b|\bviewers?\s+will\s+(?:stay|watch)\b[^.]{0,40}\b\d+\s*(?:%|minutes?)\b/i;

/**
 * Downstream artifacts this stage must not produce. Scoped to Channelwright
 * *producing* the artifact: narration that discusses thumbnails or publishing as
 * a subject is not a scope violation, so only system-directed production verbs
 * match. Note there is deliberately no "script leakage" rule here — producing
 * the script is exactly this stage's job.
 */
const TITLE_LEAKAGE = /\b(?:final|recommended|proposed|chosen)\s+title\b|\btitle\s*(?:option|variant|candidate)s?\s*[:=]|\btitleText\b/i;
const THUMBNAIL_LEAKAGE = /\b(?:generate|generates|produce|produces|render|renders|create|creates|design|designs)\b[^.]{0,40}\bthumbnail\b|\bthumbnail\s+(?:copy|text|overlay)\s*[:=]/i;
const STORYBOARD_LEAKAGE = /\b(?:generate|generates|produce|produces|render|renders|create|creates)\b[^.]{0,40}\b(?:storyboard|shot\s+list)\b|\bstoryboard\s*[:=]|\bshot\s+list\s*[:=]/i;
const ASSET_GENERATION_LEAKAGE = /\b(?:generate|generates|render|renders|synthesize|synthesizes|produce|produces)\b[^.]{0,40}\b(?:image|images|b-?roll\s+footage|voiceover\s+audio|voice\s+track|audio\s+file|video\s+file|footage|clip\s+file)\b|\btext-to-(?:speech|image|video)\b/i;
const PUBLISHING_LEAKAGE = /\b(?:upload|uploads|uploading|publish|publishes|publishing|schedule[sd]?\s+for\s+release)\b[^.]{0,40}\b(?:video|youtube|channel)\b|\bready\s+to\s+(?:publish|upload|export)\b|\bpublishing\s+schedule\b/i;

const VAGUE_PROMISE = /\beverything\s+(?:you\s+need\s+to\s+know|about\s+\w+)\b|\ball\s+you\s+need\s+to\s+know\b|\bthe\s+ultimate\s+guide\b|\bcomplete\s+guide\s+to\s+everything\b|\blearn\s+it\s+all\b|\bmaster\s+\w+\s+completely\b|\banything\s+and\s+everything\b/i;

const UNPROVEN_STATUSES = new Set(["RESEARCH_REQUIRED", "STRATEGIC_ASSUMPTION", "PRODUCTION_ASSUMPTION"]);

function allText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allText);
  if (value && typeof value === "object") return Object.values(value).flatMap(allText);
  return [];
}

function viewerValueEvidence(result: ChannelVideoScriptResult) {
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
 * The deterministic half of CHANNEL_VIDEO_SCRIPT QA, and the authoritative one.
 * Every rule here is mechanically checkable; judgement calls (does the narration
 * genuinely keep the promise, is the hook's payoff real) belong to semantic QA,
 * which cannot clear anything decided here.
 */
export function deterministicVideoScriptValidation(
  resultValue: unknown,
  upstream: ApprovedVideoBriefArtifact,
  maxPayloadBytes: number,
): Finding[] {
  const result = channelVideoScriptResultSchema.parse(resultValue);
  const brief = upstream.briefResult;
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], code: string, message: string, evidenceIds: string[] = []) => findings.push({ severity, code, message, evidenceIds });

  // --- Upstream identity and provenance -----------------------------------
  if (!canonicalEquals(result.upstreamVideoBrief, upstream.reference)) {
    add("error", "UPSTREAM_BRIEF_REFERENCE_CHANGED", "The script changed the exact approved video-brief reference.");
  }
  if (!canonicalEquals(result.scriptScope, upstream.scope)) {
    add("error", "SCRIPT_SCOPE_IDENTITY_CHANGED", "The script altered the resolved topic, pillar, or inherited viewer-value provenance.");
  }
  if (!canonicalEquals(result.scriptScope.inheritedViewerValueProvenance, upstream.scope.inheritedViewerValueProvenance)) {
    add("error", "VIEWER_VALUE_PROVENANCE_ALTERED", "The inherited Viewer Value provenance or contract hash was altered.");
  }
  if (result.source.briefTopicId !== upstream.scope.briefTopicId) {
    add("error", "SOURCE_TOPIC_MISMATCH", `The script source cites topic ${result.source.briefTopicId} but the resolved topic is ${upstream.scope.briefTopicId}.`);
  }
  if (result.source.pillarId !== upstream.scope.pillarId) {
    add("error", "SOURCE_PILLAR_MISMATCH", `The script source cites pillar ${result.source.pillarId} but the resolved topic belongs to ${upstream.scope.pillarId}.`);
  }
  // The contract states the scripted promise must match the approved brief's
  // promise; drift here is a value-integrity failure, not a stylistic warning.
  if (result.source.scriptedPromise !== brief.viewerPromise.statement) {
    add("error", "SCRIPTED_PROMISE_DIVERGES", "The scripted promise does not match the approved brief's viewer promise verbatim.");
  }

  // --- Evidence integrity --------------------------------------------------
  const known = new Map(upstream.discoveryBundle.evidence.map((item) => [item.id, item]));
  const cited = new Set<string>([
    ...result.sections.flatMap((section) => section.evidenceIds),
    ...viewerValueEvidence(result),
  ]);
  const missing = [...cited].filter((id) => !known.has(id));
  if (missing.length) add("error", "EVIDENCE_REFERENCE_NOT_FOUND", "The script cites evidence IDs outside the approved upstream discovery bundle.", missing.slice(0, 20));

  for (const item of upstream.discoveryBundle.evidence) {
    const consistent = item.sourceType === "search"
      ? item.id === `yt:search:${item.sourceId}` && item.url === null
      : hasConsistentEvidenceIdentity({ id: item.id, url: item.url ?? "", sourceType: item.sourceType, sourceId: item.sourceId });
    if (!consistent) add("error", "EVIDENCE_IDENTITY_MISMATCH", `Upstream evidence identity is inconsistent for ${item.id}.`, [item.id]);
  }

  // --- Inherited claim discipline -----------------------------------------
  const briefStatus = new Map(brief.evidencePlan.items.map((item) => [item.claimId, item.status]));
  const forbidden = new Set(brief.evidencePlan.items.filter((item) => item.status === "MUST_NOT_CLAIM").map((item) => item.claimId));
  const usageByClaim = new Map(result.claimUsage.map((item) => [item.claimId, item]));

  // The approved brief's evidence plan is the trusted source of truth, not the
  // model's self-description. Every trusted claim must be accounted for, so a
  // forbidden or unproven claim cannot evade enforcement by simply being left out
  // of the model-authored claim metadata.
  for (const item of brief.evidencePlan.items) {
    if (!usageByClaim.has(item.claimId)) {
      add("error", "CLAIM_USAGE_INCOMPLETE", `The approved brief claim ${item.claimId} (${item.status}) is not accounted for in the script's claim usage.`);
    }
  }

  for (const usage of result.claimUsage) {
    if (!briefStatus.has(usage.claimId)) {
      add("error", "CLAIM_USAGE_UNKNOWN", `Claim usage references ${usage.claimId}, which is not in the approved brief's evidence plan.`);
      continue;
    }
    if (usage.inheritedStatus !== briefStatus.get(usage.claimId)) {
      add("error", "INHERITED_CLAIM_STATUS_ALTERED", `Claim ${usage.claimId} inherits status ${usage.inheritedStatus} but the approved brief marked it ${briefStatus.get(usage.claimId)}.`);
    }
    if (usage.inheritedStatus === "MUST_NOT_CLAIM" && (usage.treatment !== "OMITTED" || usage.scriptSectionIds.length > 0)) {
      add("error", "FORBIDDEN_CLAIM_NOT_OMITTED", `Claim ${usage.claimId} is MUST_NOT_CLAIM and must be omitted, not scripted.`);
    }
    if (UNPROVEN_STATUSES.has(usage.inheritedStatus) && usage.treatment === "ASSERTED_AS_FACT") {
      add("error", "UNPROVEN_CLAIM_ASSERTED_AS_FACT", `Claim ${usage.claimId} is ${usage.inheritedStatus} and must not be asserted as established fact.`);
    }
  }

  // Section-level claim references must be known, tracked, and never forbidden.
  const sectionIds = result.sections.map((section) => section.sectionId);
  if (new Set(sectionIds).size !== sectionIds.length) add("error", "DUPLICATE_SECTION_IDENTITY", "The script lists the same section identifier more than once.");
  const knownSections = new Set(sectionIds);

  const narratedClaimIds = new Set<string>([...result.sections.flatMap((section) => section.claimIds), ...result.openingHook.claimIds]);
  for (const claimId of narratedClaimIds) {
    if (!briefStatus.has(claimId)) add("error", "SECTION_CLAIM_UNKNOWN", `A script section references claim ${claimId}, which is not in the approved brief's evidence plan.`);
    else if (forbidden.has(claimId)) add("error", "SCRIPT_USES_FORBIDDEN_CLAIM", `A script section narrates claim ${claimId}, which the approved brief marked MUST_NOT_CLAIM.`);
    if (!usageByClaim.has(claimId)) add("error", "SECTION_CLAIM_NOT_TRACKED", `Claim ${claimId} is narrated but has no claim-usage record stating how it is handled.`);
  }
  for (const usage of result.claimUsage) {
    for (const sectionId of usage.scriptSectionIds) {
      if (!knownSections.has(sectionId)) add("error", "CLAIM_USAGE_SECTION_UNKNOWN", `Claim usage for ${usage.claimId} references unknown section ${sectionId}.`);
    }
  }

  // --- Content architecture mapping ---------------------------------------
  const briefBeatIds = new Set(brief.contentArchitecture.beats.map((beat) => beat.sectionId));
  const openingBeatIds = new Set(brief.contentArchitecture.beats.filter((beat) => beat.role === "OPENING").map((beat) => beat.sectionId));
  const coveredBeats = new Set<string>();
  for (const section of result.sections) {
    if (!briefBeatIds.has(section.briefBeatId)) add("error", "SECTION_BEAT_UNKNOWN", `Section ${section.sectionId} maps to unknown brief beat ${section.briefBeatId}.`);
    else coveredBeats.add(section.briefBeatId);
  }
  for (const beatId of briefBeatIds) {
    if (!coveredBeats.has(beatId)) add("error", "BEAT_NOT_COVERED", `Approved brief beat ${beatId} is not covered by any script section.`);
  }
  for (const beatId of result.source.coveredBriefBeatIds) {
    if (!briefBeatIds.has(beatId)) add("error", "SOURCE_BEAT_UNKNOWN", `The script source lists covered beat ${beatId}, which is not in the approved brief.`);
  }
  // The declared coverage must equal what the sections actually cover, so the
  // source cannot claim a mapping the sections do not deliver (or omit one).
  const declaredCoverage = new Set(result.source.coveredBriefBeatIds);
  if (declaredCoverage.size !== coveredBeats.size || [...coveredBeats].some((beatId) => !declaredCoverage.has(beatId))) {
    add("error", "SOURCE_COVERAGE_MISMATCH", "The script source's declared covered beats do not equal the beats the sections actually map to.");
  }

  // --- Opening hook --------------------------------------------------------
  if (!knownSections.has(result.openingHook.sectionId)) {
    add("error", "HOOK_SECTION_INVALID", `The opening hook references section ${result.openingHook.sectionId}, which is not one of the script sections.`);
  } else {
    const hookSection = result.sections.find((section) => section.sectionId === result.openingHook.sectionId)!;
    if (hookSection.role !== "OPENING") add("error", "HOOK_SECTION_NOT_OPENING", "The opening hook's section is not an OPENING-role section.");
    if (result.openingHook.durationSeconds > hookSection.durationSeconds) add("error", "HOOK_DURATION_EXCEEDS_SECTION", "The opening hook is longer than its own script section.");
  }
  if (!openingBeatIds.has(result.openingHook.briefBeatId)) {
    add("error", "HOOK_BEAT_NOT_OPENING", `The opening hook maps to brief beat ${result.openingHook.briefBeatId}, which is not an OPENING beat.`);
  }
  if (result.openingHook.deceptionRisk === "material") add("error", "DECEPTIVE_HOOK", "The opening hook carries a material deception risk.");
  if (!result.openingHook.promiseEchoed) add("warning", "HOOK_DROPS_PROMISE", "The opening hook does not echo the video's promise.");
  if (!result.sections.some((section) => section.role === "OPENING")) add("warning", "MALFORMED_SCRIPT_STRUCTURE", "The script defines no opening section.");

  // --- Timing consistency --------------------------------------------------
  const durationSum = result.sections.reduce((total, section) => total + section.durationSeconds, 0);
  if (durationSum !== result.timing.totalDurationSeconds) {
    add("error", "TIMING_MISMATCH", `Section durations sum to ${durationSum}s but the script reports a total of ${result.timing.totalDurationSeconds}s.`);
  }
  const ordered = [...result.sections].sort((left, right) => left.startSeconds - right.startSeconds);
  let cursor = 0;
  for (const section of ordered) {
    if (section.startSeconds !== cursor) { add("warning", "NONCONTIGUOUS_TIMELINE", "Script section start times are not a contiguous timeline."); break; }
    cursor += section.durationSeconds;
  }

  // --- Viewer promise ------------------------------------------------------
  if (VAGUE_PROMISE.test(result.source.scriptedPromise)) {
    add("error", "VIEWER_PROMISE_VAGUE", "The scripted promise is too vague to verify against the script.");
  }

  // --- Viewer Value Gate: deterministic floor overrules an optimistic model -
  const deterministic = deterministicViewerValueGate(result.viewerValue);
  const resolved = resolveViewerValueGate(deterministic.gate, result.viewerValue.gate);
  if (resolved !== result.viewerValue.gate) {
    add("error", "VIEWER_VALUE_GATE_UNDERSTATED", `The script claims gate ${result.viewerValue.gate} but deterministic rules require ${resolved}: ${deterministic.reasons.join(" ")}`);
  }
  if (resolved === "REJECT") add("error", "VIEWER_VALUE_GATE_REJECTED", `The script fails the Viewer Value Gate: ${deterministic.reasons.join(" ")}`);
  // A REVISE floor is an error, not a warning: a warning cannot stop merged QA
  // from reporting passed=true, which would let a script whose Viewer Value floor
  // requires revision finalize and reach human approval. As an error it forces
  // the bounded revision and, if still unresolved at final QA, blocks finalization.
  else if (resolved === "REVISE") add("error", "VIEWER_VALUE_GATE_REVISION_REQUIRED", `The script needs a stronger viewer-value case before it can finalize: ${deterministic.reasons.join(" ")}`);
  if (result.viewerValue.integrityFindings.some((item) => item.severity === "blocking")) {
    add("error", "CONTENT_INTEGRITY_BLOCKING_RISK", "The script depends on a blocking content-integrity risk.");
  }
  if (result.viewerValue.contract.originalContribution.assessment.verdict === "absent") {
    add("error", "ORIGINAL_CONTRIBUTION_MISSING", "The script identifies no original contribution beyond videos that already exist.");
  }

  // --- Evidence discipline record consistency ------------------------------
  for (const claimId of [...result.evidenceDiscipline.researchRequiredClaimsDeferred, ...result.evidenceDiscipline.mustNotClaimOmitted]) {
    if (!briefStatus.has(claimId)) add("warning", "EVIDENCE_DISCIPLINE_CLAIM_UNKNOWN", `The evidence-discipline record references claim ${claimId}, which is not in the approved brief.`);
  }

  // --- Call to action ------------------------------------------------------
  if (result.callToAction.placementSectionId && !knownSections.has(result.callToAction.placementSectionId)) {
    add("error", "CTA_PLACEMENT_UNKNOWN", "The call to action is placed in a section that does not exist.");
  }
  if (result.callToAction.objective === "NONE" && result.callToAction.spokenCta) {
    add("warning", "CTA_INCONSISTENT", "The call to action objective is NONE but a spoken CTA is still scripted.");
  }

  // --- Confidence may not exceed the bounded upstream evidence -------------
  if (brief.evidencePlan.sufficiency === "RESEARCH_REQUIRED_BEFORE_SCRIPT") {
    add("warning", "CONFIDENCE_EXCEEDS_UPSTREAM_EVIDENCE", "The approved brief marked its evidence as research-required before scripting; the script must not assert the deferred claims as fact.");
  }

  // --- Fabrication and downstream scope ------------------------------------
  const text = allText(result).join("\n");
  if (FABRICATED_VIEWS.test(text)) add("error", "FABRICATED_PERFORMANCE_PREDICTION", "The script predicts future views or subscribers.");
  if (FABRICATED_REVENUE.test(text)) add("error", "FABRICATED_REVENUE_PREDICTION", "The script asserts revenue, CPM, or RPM figures.");
  if (FABRICATED_SEARCH_VOLUME.test(text)) add("error", "FABRICATED_SEARCH_VOLUME", "The script asserts search-volume data no configured provider supplies.");
  if (FABRICATED_RETENTION.test(text)) add("error", "FABRICATED_RETENTION_PREDICTION", "The script predicts a specific retention percentage or watch time.");
  if (MONETARY_GUARANTEE.test(text)) add("error", "UNSUPPORTED_MONETARY_GUARANTEE", "The script contains an unsupported monetary guarantee.");
  if (OUTCOME_GUARANTEE.test(text)) add("error", "UNSUPPORTED_OUTCOME_GUARANTEE", "The script narrates an absolute outcome guarantee, which no inherited evidence supports.");
  if (TITLE_LEAKAGE.test(text)) add("error", "TITLE_SCOPE_VIOLATION", "The script produced final title copy, which belongs to the downstream packaging stage.");
  if (THUMBNAIL_LEAKAGE.test(text)) add("error", "THUMBNAIL_SCOPE_VIOLATION", "The script produced thumbnail copy or imagery, which belongs to a downstream stage.");
  if (STORYBOARD_LEAKAGE.test(text)) add("error", "STORYBOARD_SCOPE_VIOLATION", "The script produced a storyboard or shot list, which belongs to a downstream stage.");
  if (ASSET_GENERATION_LEAKAGE.test(text)) add("error", "ASSET_GENERATION_SCOPE_VIOLATION", "The script attempted to generate media assets, which belong to a downstream stage.");
  if (PUBLISHING_LEAKAGE.test(text)) add("error", "PUBLISHING_SCOPE_VIOLATION", "The script asserted an upload, publishing, or release-readiness action.");

  const payloadBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (payloadBytes > maxPayloadBytes) {
    add("error", "RESULT_PAYLOAD_TOO_LARGE", `The script serializes to ${payloadBytes} bytes, above the ${maxPayloadBytes}-byte durable-output margin.`);
  }
  return findings;
}

/** Semantic findings are filtered against known evidence exactly as the earlier stages do. */
export function mergeVideoScriptQA(
  deterministic: Finding[],
  semantic: VideoScriptSemanticQAOutput,
  modelUsage: ModelUsage,
  upstream: ApprovedVideoBriefArtifact,
): VideoScriptQAResult {
  const { findings, errors, score, recommendation } = mergeSemanticQAFindings(
    deterministic,
    semantic,
    new Set(upstream.discoveryBundle.evidence.map((item) => item.id)),
    "The video script QA model cited an unknown evidence ID.",
  );
  const failingRules = new Set(deterministic.map((item) => item.code)).size;
  return videoScriptQAResultSchema.parse({
    passed: errors === 0 && score >= 75,
    score,
    findings: findings.slice(0, 50),
    recommendation,
    deterministicChecksPassed: Math.max(0, DETERMINISTIC_VIDEO_SCRIPT_RULE_COUNT - failingRules),
    deterministicChecksFailed: failingRules,
    modelUsage,
  });
}

/**
 * Integrity failures are not cosmetically fixable: a script whose premise is
 * dishonest, whose provenance is corrupted, or which invents evidence must fail
 * closed rather than be rewritten into apparent compliance. Weak viewer value,
 * by contrast, is exactly what one bounded revision is for.
 */
export const UNREVISABLE_VIDEO_SCRIPT_CODES = new Set([
  "UPSTREAM_BRIEF_REFERENCE_CHANGED",
  "SCRIPT_SCOPE_IDENTITY_CHANGED",
  "VIEWER_VALUE_PROVENANCE_ALTERED",
  "VIEWER_VALUE_GATE_REJECTED",
  "CONTENT_INTEGRITY_BLOCKING_RISK",
  "UNSUPPORTED_MONETARY_GUARANTEE",
  "UNSUPPORTED_OUTCOME_GUARANTEE",
  "FABRICATED_SEARCH_VOLUME",
  "EVIDENCE_REFERENCE_NOT_FOUND",
]);

export function hasUnrevisableVideoScriptFailure(findings: Finding[]) {
  return findings.some((finding) => finding.severity === "error" && UNREVISABLE_VIDEO_SCRIPT_CODES.has(finding.code));
}

/**
 * Includes the message because code plus evidence IDs alone could not tell apart
 * the same rule violated in two different places with no citations, letting a
 * revision reintroduce a violation and have it look pre-existing.
 */
export function videoScriptFindingFingerprint(finding: Finding) {
  return `${finding.code}:${[...finding.evidenceIds].sort().join(",")}:${finding.message}`;
}

export function newlyIntroducedVideoScriptErrors(before: Finding[], after: Finding[]) {
  const existing = new Set(before.filter((finding) => finding.severity === "error").map(videoScriptFindingFingerprint));
  return after.filter((finding) => finding.severity === "error" && !existing.has(videoScriptFindingFingerprint(finding)));
}
