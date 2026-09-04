import {
  channelVideoDiagnosisResultSchema,
  videoDiagnosisQAResultSchema,
  type ApprovedVideoPerformanceArtifact,
  type ChannelVideoDiagnosisResult,
  type DiagnosisObservationSet,
  type VideoDiagnosisQAResult,
} from "@/domain/production-workflows";
import { canonicalEquals } from "./canonical-json";
import { DIAGNOSIS_DERIVATION_RULES, deriveVideoDiagnosisObservations } from "./video-diagnosis-observations";

type Finding = { severity: "error" | "warning" | "info"; code: string; message: string; evidenceIds: string[] };

const CAUSAL_CERTAINTY = /\b(?:causes?|caused|proves?|proven cause|resulted in|led to|is the reason|responsible for|directly driv(?:e|es|en|ing)|made viewers|definitively explains)\b/i;
const DECISION_LANGUAGE = /\b(?:recommend(?:ed|ation)?|next action|should (?:change|publish|test|edit|replace|optimize)|experiment|re-?title|re-?upload|schedule)\b/i;
const COMPARATIVE = /\b(?:strong|weak|stronger|weaker|better|worse|outperform(?:ed|ing)?|underperform(?:ed|ing)?)\b/i;
const NUMBER = /(?<![A-Za-z0-9_.:-])-?\d+(?:\.\d+)?%?(?![A-Za-z0-9_.:-])/g;
const MISSING_DATA_CLAIMS = [
  { unknownId: "unknown:retention-curve", pattern: /\b(?:early abandonment|retention drop|dropped? off|drop(?:ped)? at)\b/i },
  { unknownId: "unknown:traffic-sources", pattern: /\b(?:browse features?|suggested videos?|search traffic|external traffic|traffic[- ]source attribution)\b/i },
  { unknownId: "unknown:audience-segments", pattern: /\b(?:audience segment|new viewers?|returning-viewer segment|subscriber segment)\b/i },
  { unknownId: "unknown:downstream-attribution", pattern: /\b(?:end[- ]screen attribution|downstream conversion attribution)\b/i },
] as const;

function freeText(result: ChannelVideoDiagnosisResult) {
  const analysis = result.analysis;
  return [
    ...analysis.findings.flatMap((finding) => [finding.claim, ...finding.supportingEvidence, ...finding.contradictoryEvidence, ...finding.alternativeExplanations, ...finding.additionalEvidenceNeeded]),
    ...analysis.unknowns.flatMap((unknown) => [unknown.blockedClaim, ...unknown.dataRequired]),
    analysis.viewerValueAnalysis.performanceVersusValue,
    analysis.summary.narrative,
  ];
}

function exactNumericStrings(observationIds: string[], observations: ChannelVideoDiagnosisResult["observations"]) {
  const values = new Set<string>();
  for (const observation of observations) {
    if (!observationIds.includes(observation.id) || typeof observation.value !== "number") continue;
    values.add(String(observation.value));
    values.add(`${observation.value}%`);
  }
  return values;
}

function comparisonEvidenceSupportsCategory(finding: ChannelVideoDiagnosisResult["analysis"]["findings"][number], artifact: ApprovedVideoPerformanceArtifact) {
  const allowedMetrics: Partial<Record<typeof finding.category, Set<string>>> = {
    PACKAGING: new Set(["CLICK_THROUGH_RATE"]),
    RETENTION_STRUCTURE: new Set(["AVERAGE_VIEW_DURATION", "AUDIENCE_RETENTION"]),
    DISTRIBUTION: new Set(["IMPRESSIONS", "VIEWS", "RETURNING_VIEWERS"]),
    CONVERSION_OUTCOME: new Set(["SUBSCRIBERS", "CONVERSION_INDICATOR", "REVENUE_INDICATOR"]),
  };
  const allowed = allowedMetrics[finding.category];
  if (!allowed) return false;
  return finding.observationIds.some((id) => {
    const baseline = /^obs:baseline:(\d+)$/.exec(id);
    if (baseline) return allowed.has(artifact.performanceResult.measuredSnapshot.operatorBaselines[Number(baseline[1])]?.metric ?? "");
    const outcome = /^obs:kpi-outcome:(\d+)$/.exec(id);
    return outcome ? allowed.has(artifact.performanceResult.kpiHypothesisOutcomes[Number(outcome[1])]?.binding.metric ?? "") : false;
  });
}

export function deterministicVideoDiagnosisValidation(
  result: ChannelVideoDiagnosisResult,
  artifact: ApprovedVideoPerformanceArtifact,
  expectedObservationSet: DiagnosisObservationSet = deriveVideoDiagnosisObservations(artifact),
  maxPayloadBytes = 60_000,
): Finding[] {
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], code: string, message: string) => findings.push({ severity, code, message, evidenceIds: [] });

  if (!canonicalEquals(result.upstreamVideoPerformance, artifact.reference)) add("error", "UPSTREAM_PERFORMANCE_REFERENCE_CHANGED", "The diagnosis changed the exact approved Performance reference.");
  if (!canonicalEquals(result.diagnosisScope, artifact.diagnosisScope)) add("error", "DIAGNOSIS_SCOPE_CHANGED", "The diagnosis changed the authoritative compact lineage projection.");
  if (!canonicalEquals(result.observations, expectedObservationSet.observations)) add("error", "SERVER_OBSERVATIONS_CHANGED", "The diagnosis changed server-built observations.");
  if (!canonicalEquals(result.capabilities, expectedObservationSet.capabilities)) add("error", "DIAGNOSTIC_CAPABILITIES_CHANGED", "The diagnosis changed server-declared capability availability.");
  if (!canonicalEquals(result.viewerValueProvenance, artifact.performanceResult.performanceScope.inheritedViewerValueProvenance)) add("error", "VIEWER_VALUE_PROVENANCE_CHANGED", "Viewer Value provenance differs from the exact approved Performance artifact.");

  const source = result.source;
  const expectedSource = {
    performanceWorkflowId: artifact.reference.performanceWorkflowId,
    performanceRunId: artifact.reference.performanceRunId,
    releaseWorkflowId: artifact.reference.upstreamVideoRelease.releaseWorkflowId,
    releaseRunId: artifact.reference.upstreamVideoRelease.releaseRunId,
    topicId: artifact.performanceResult.source.releaseTopicId,
    pillarId: artifact.performanceResult.source.pillarId,
    finalTitle: artifact.performanceResult.source.finalTitle,
    subjectIdentity: `performance:${artifact.reference.performanceRunId}`,
  };
  if (!canonicalEquals(source, expectedSource)) add("error", "DIAGNOSIS_SOURCE_CHANGED", "The diagnosis source identity does not match authoritative Performance state.");

  const observationIds = new Set(result.observations.map((item) => item.id));
  if (observationIds.size !== result.observations.length) add("error", "DUPLICATE_OBSERVATION_ID", "Observation IDs must be unique.");
  const lineageKeys = new Set(result.diagnosisScope.entries.map((item) => item.key));
  for (const observation of result.observations) {
    if (observation.kind === "DERIVED" && (!observation.derivationRule || !DIAGNOSIS_DERIVATION_RULES.has(observation.derivationRule))) add("error", "DERIVATION_RULE_NOT_ALLOWED", `${observation.id} uses a rule that is not allowlisted.`);
    for (const ref of observation.sourceRefs) {
      if (ref.startsWith("obs:") && !observationIds.has(ref)) add("error", "OBSERVATION_SOURCE_NOT_FOUND", `${observation.id} cites missing observation ${ref}.`);
      if (ref.startsWith("lin:") && !lineageKeys.has(ref)) add("error", "LINEAGE_REFERENCE_NOT_FOUND", `${observation.id} cites missing lineage ${ref}.`);
    }
  }
  for (const issue of result.crossModelReview.findings) {
    if (issue.severity === "error" && issue.evidenceRefs.length === 0) add("error", "CRITIC_EVIDENCE_NOT_FOUND", `Blocking critic issue ${issue.code} must cite authoritative evidence.`);
    for (const ref of issue.evidenceRefs) {
      if (ref.startsWith("obs:") && !observationIds.has(ref)) add("error", "CRITIC_EVIDENCE_NOT_FOUND", `Critic issue ${issue.code} cites missing observation ${ref}.`);
      if (ref.startsWith("lin:") && !lineageKeys.has(ref)) add("error", "CRITIC_EVIDENCE_NOT_FOUND", `Critic issue ${issue.code} cites missing lineage ${ref}.`);
      if (!ref.startsWith("obs:") && !ref.startsWith("lin:")) add("error", "CRITIC_EVIDENCE_NOT_FOUND", `Critic issue ${issue.code} cites a non-authoritative evidence reference.`);
    }
  }

  const capabilities = new Map(result.capabilities.map((item) => [item.category, item]));
  const findingIds = new Set(result.analysis.findings.map((item) => item.id));
  const deterministicUnknowns = new Map(expectedObservationSet.deterministicUnknowns.map((item) => [item.id, item]));
  const actualUnknowns = new Map(result.analysis.unknowns.map((item) => [item.id, item]));
  for (const [id, unknown] of deterministicUnknowns) {
    if (!actualUnknowns.has(id) || !canonicalEquals(actualUnknowns.get(id), unknown)) add("error", "DETERMINISTIC_UNKNOWN_MISSING", `Required typed unknown ${id} was removed or changed.`);
  }

  for (const finding of result.analysis.findings) {
    const cited = finding.observationIds.map((id) => result.observations.find((item) => item.id === id)).filter(Boolean) as ChannelVideoDiagnosisResult["observations"];
    if (cited.length !== finding.observationIds.length) add("error", "FINDING_OBSERVATION_NOT_FOUND", `${finding.id} cites an observation that does not exist.`);
    if (finding.lineageRefs.some((ref) => !lineageKeys.has(ref))) add("error", "FINDING_LINEAGE_NOT_FOUND", `${finding.id} cites lineage outside the authoritative projection.`);
    if (capabilities.get(finding.category)?.availability === "UNAVAILABLE") add("error", "UNAVAILABLE_CAPABILITY_USED", `${finding.id} makes a ${finding.category} finding even though that capability is unavailable.`);
    if (finding.epistemicStatus === "HYPOTHESIS" && finding.confidence === "high") add("error", "HYPOTHESIS_CONFIDENCE_TOO_HIGH", `${finding.id} gives a hypothesis high confidence.`);
    if (finding.confidence === "high" && cited.some((item) => item.sampleAdequacy !== "sufficient" || item.coverage !== "complete")) add("error", "HIGH_CONFIDENCE_NOT_ALLOWED", `${finding.id} claims high confidence with inadequate or incomplete evidence.`);
    if (finding.confidence === "high" && (finding.additionalEvidenceNeeded.length > 0 || finding.contradictoryEvidence.length > 0)) add("error", "HIGH_CONFIDENCE_NOT_ALLOWED", `${finding.id} claims high confidence despite missing or contradictory evidence.`);
    if (CAUSAL_CERTAINTY.test(finding.claim)) add("error", "UNSUPPORTED_CAUSAL_CERTAINTY", `${finding.id} uses causal-certainty wording the contract forbids.`);
    for (const missing of MISSING_DATA_CLAIMS) if (deterministicUnknowns.has(missing.unknownId) && missing.pattern.test(finding.claim)) add("error", "UNAVAILABLE_EVIDENCE_CLAIM", `${finding.id} makes a claim that requires unavailable ${missing.unknownId.replace("unknown:", "")} evidence.`);
    if (COMPARATIVE.test(finding.claim) && !comparisonEvidenceSupportsCategory(finding, artifact)) add("error", "COMPARISON_WITHOUT_BASELINE", `${finding.id} uses comparative language without an operator baseline or exact approved KPI outcome for that diagnostic category.`);
    const allowedNumbers = exactNumericStrings(finding.observationIds, result.observations);
    for (const text of [finding.claim, ...finding.supportingEvidence, ...finding.contradictoryEvidence]) {
      for (const token of text.match(NUMBER) ?? []) if (!allowedNumbers.has(token)) add("error", "UNCITED_NUMERIC_CLAIM", `${finding.id} contains numeric claim ${token} that is not an exact cited structured value.`);
    }
  }

  if (result.analysis.findings.length === 0 && (result.analysis.unknowns.length === 0 || !["INCONCLUSIVE", "INSUFFICIENT_EVIDENCE"].includes(result.analysis.summary.outcome))) add("error", "ZERO_FINDING_RESULT_INVALID", "A zero-finding diagnosis requires typed unknowns and an inconclusive result.");
  if (result.analysis.summary.strongestFindingIds.some((id) => !findingIds.has(id))) add("error", "SUMMARY_FINDING_NOT_FOUND", "The summary cites a finding that does not exist.");
  if (result.analysis.unknowns.some((item) => item.type === "CONFLICTING_EVIDENCE") && result.analysis.summary.outcome !== "MIXED" && result.analysis.summary.outcome !== "INCONCLUSIVE" && !result.analysis.findings.some((item) => item.contradictoryEvidence.length > 0)) add("error", "CONTRADICTORY_EVIDENCE_NOT_PRESERVED", "Typed conflicting evidence must remain visible in findings or an appropriately qualified summary outcome.");
  if (result.analysis.summary.overallConfidence === "high" && (expectedObservationSet.deterministicUnknowns.length > 0 || result.analysis.findings.some((item) => item.contradictoryEvidence.length > 0))) add("error", "HIGH_CONFIDENCE_NOT_ALLOWED", "Overall high confidence is unavailable while required evidence is missing or contradictory.");
  if (result.analysis.viewerValueAnalysis.state === "PRESERVED" && artifact.performanceResult.viewerValue.gate !== "PASS") add("error", "VIEWER_VALUE_STATE_UNDERSTATED", "Viewer Value cannot be marked preserved when approved Performance did not pass its gate.");
  if (result.analysis.viewerValueAnalysis.observationIds.some((id) => !observationIds.has(id))) add("error", "VIEWER_VALUE_OBSERVATION_NOT_FOUND", "Viewer Value analysis cites a missing observation.");

  const all = freeText(result).join("\n");
  if (DECISION_LANGUAGE.test(all)) add("error", "DECISION_SCOPE_VIOLATION", "Diagnosis contains recommendation, action, or experiment language reserved for CHANNEL_VIDEO_DECISION.");
  if (CAUSAL_CERTAINTY.test(all)) add("error", "UNSUPPORTED_CAUSAL_CERTAINTY", "Diagnosis contains unsupported causal-certainty wording.");
  if (!result.crossModelReview.safeToFinalize || result.crossModelReview.findings.some((item) => item.severity === "error")) add("error", "CRITIC_REJECTED_DIAGNOSIS", "The independent critic found a blocking epistemic issue; automated revision is forbidden.");
  if (result.modelProvenance.length !== 2 || result.modelProvenance[0].provider === result.modelProvenance[1].provider) add("error", "MODEL_PROVIDER_INDEPENDENCE_REQUIRED", "Diagnosis requires exactly one analyst and one distinct-provider critic attribution.");
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > maxPayloadBytes) add("error", "RESULT_PAYLOAD_TOO_LARGE", "Diagnosis exceeds the 60 KiB pre-persistence ceiling.");
  return findings;
}

export function videoDiagnosisQA(findings: Finding[]): VideoDiagnosisQAResult {
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  return videoDiagnosisQAResultSchema.parse({
    passed: errors === 0,
    score: Math.max(0, 100 - errors * 20 - warnings * 5),
    findings: findings.slice(0, 50),
    recommendation: errors === 0 ? (warnings === 0 ? "accept" : "human_review_required") : "revise",
    deterministicChecksPassed: Math.max(0, 24 - new Set(findings.map((item) => item.code)).size),
    deterministicChecksFailed: new Set(findings.map((item) => item.code)).size,
    modelUsage: { model: "deterministic", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
}

export function parseVideoDiagnosisResult(value: unknown) {
  return channelVideoDiagnosisResultSchema.parse(value);
}
