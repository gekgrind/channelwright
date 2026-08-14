import {
  channelResearchResultSchema,
  researchQAResultSchema,
  type ChannelResearchResult,
  type ResearchEvidence,
  type ResearchEvidenceBundle,
  type ResearchQAResult,
} from "@/domain/production-workflows";
import type { ModelUsage, SemanticQAOutput } from "./openai-research-model";

type Finding = ResearchQAResult["findings"][number];

function allReferences(result: ChannelResearchResult) {
  return [
    ...result.viability.hundredVideoPotential.evidenceIds,
    ...result.viability.audienceDemand.evidenceIds,
    ...result.viability.monetizationPotential.evidenceIds,
    ...result.audience.evidenceIds,
    ...result.competitiveLandscape.examples.flatMap((item) => item.evidenceIds),
    ...result.contentPotential.evidenceIds,
    ...result.differentiation.evidenceIds,
    ...result.sustainability.evidenceIds,
    ...result.monetization.paths.flatMap((item) => item.evidenceIds),
    ...result.risks.flatMap((item) => item.evidenceIds),
    ...result.evidenceSummary.evidenceIds,
    ...result.recommendation.evidenceIds,
  ];
}

export function deterministicResearchValidation(resultValue: unknown, evidence: ResearchEvidence[], now = new Date(), evidenceContext?: Pick<ResearchEvidenceBundle, "completionStatus" | "limitations">): Finding[] {
  const result = channelResearchResultSchema.parse(resultValue);
  const findings: Finding[] = [];
  const known = new Map(evidence.map((item) => [item.id, item]));
  const missing = [...new Set(allReferences(result).filter((id) => !known.has(id)))];
  if (missing.length) findings.push({ severity: "error", code: "EVIDENCE_REFERENCE_NOT_FOUND", message: "The result cites evidence IDs that were not retrieved.", evidenceIds: missing });
  for (const item of evidence) {
    const expected = item.sourceType === "video" ? `https://www.youtube.com/watch?v=${item.sourceId}` : `https://www.youtube.com/channel/${item.sourceId}`;
    if (item.url !== expected || item.id !== `yt:${item.sourceType}:${item.sourceId}`) findings.push({ severity: "error", code: "EVIDENCE_IDENTITY_MISMATCH", message: `Evidence identity fields disagree for ${item.id}.`, evidenceIds: [item.id] });
    if (now.getTime() - new Date(item.retrievedAt).getTime() > 86_400_000) findings.push({ severity: "warning", code: "EVIDENCE_STALE", message: `Evidence ${item.id} was retrieved more than 24 hours ago.`, evidenceIds: [item.id] });
  }
  const videoCount = evidence.filter((item) => item.sourceType === "video").length;
  const channelCount = new Set(evidence.map((item) => item.channelTitle).filter((value): value is string => Boolean(value))).size;
  const retrievalTimes = evidence.map((item) => new Date(item.retrievedAt).getTime()).filter(Number.isFinite);
  const oldestRetrievedAt = new Date(Math.min(...retrievalTimes)).toISOString();
  const newestRetrievedAt = new Date(Math.max(...retrievalTimes)).toISOString();
  if (result.evidenceSummary.representativeVideosObserved !== videoCount || result.evidenceSummary.independentChannelsObserved !== channelCount) {
    findings.push({ severity: "error", code: "EVIDENCE_COVERAGE_MISMATCH", message: "The reported evidence coverage does not match the retrieved evidence.", evidenceIds: result.evidenceSummary.evidenceIds });
  }
  if (result.evidenceSummary.oldestRetrievedAt !== oldestRetrievedAt || result.evidenceSummary.newestRetrievedAt !== newestRetrievedAt) {
    findings.push({ severity: "error", code: "EVIDENCE_FRESHNESS_MISMATCH", message: "The reported evidence freshness does not match provider retrieval timestamps.", evidenceIds: result.evidenceSummary.evidenceIds });
  }
  if (evidenceContext && (result.evidenceSummary.completionStatus !== evidenceContext.completionStatus || JSON.stringify(result.evidenceSummary.limitations) !== JSON.stringify(evidenceContext.limitations))) {
    findings.push({ severity: "error", code: "EVIDENCE_COMPLETENESS_MISMATCH", message: "The result does not accurately disclose provider completeness and limitations.", evidenceIds: result.evidenceSummary.evidenceIds });
  }
  if (evidenceContext?.completionStatus === "partial" && result.recommendation.confidence === "high") {
    findings.push({ severity: "error", code: "PARTIAL_EVIDENCE_OVERCONFIDENT", message: "A partial provider result cannot support high recommendation confidence.", evidenceIds: result.recommendation.evidenceIds });
  }
  if (result.recommendation.confidence === "high" && (videoCount < 5 || channelCount < 3)) {
    findings.push({ severity: "error", code: "CONFIDENCE_EXCEEDS_COVERAGE", message: "High recommendation confidence requires at least five representative videos across three observed channels.", evidenceIds: result.recommendation.evidenceIds });
  }
  if (videoCount < 3 || channelCount < 2) {
    findings.push({ severity: "warning", code: "EVIDENCE_COVERAGE_LIMITED", message: "The bounded sample contains fewer than three videos or two independent channels; conclusions must remain cautious.", evidenceIds: evidence.map((item) => item.id) });
  }
  const required: Array<[string, string[]]> = [
    ["HUNDRED_VIDEO_SUPPORT_MISSING", result.viability.hundredVideoPotential.evidenceIds],
    ["AUDIENCE_DEMAND_SUPPORT_MISSING", result.viability.audienceDemand.evidenceIds],
    ["MONETIZATION_SUPPORT_MISSING", result.viability.monetizationPotential.evidenceIds],
  ];
  for (const [code, ids] of required) if (ids.length === 0) findings.push({ severity: "warning", code, message: "A required viability conclusion has no linked evidence and must be treated as uncertain.", evidenceIds: [] });
  if (result.recommendation.verdict !== "insufficient_evidence" && result.recommendation.evidenceIds.length === 0) findings.push({ severity: "error", code: "RECOMMENDATION_UNSUPPORTED", message: "A directional recommendation requires linked evidence.", evidenceIds: [] });
  if (result.viability.hundredVideoPotential.verdict === "strong" && (result.contentPotential.estimatedTopicDepth ?? 0) < 100) findings.push({ severity: "error", code: "TOPIC_DEPTH_CONTRADICTION", message: "Strong hundred-video potential conflicts with an estimated topic depth below 100 or unknown.", evidenceIds: result.viability.hundredVideoPotential.evidenceIds });
  return findings;
}

export function mergeResearchQA(deterministic: Finding[], semantic: SemanticQAOutput, modelUsage: ModelUsage, evidence: ResearchEvidence[]): ResearchQAResult {
  const known = new Set(evidence.map((item) => item.id));
  const semanticFindings: Finding[] = semantic.findings.map((finding) => ({ ...finding, evidenceIds: finding.evidenceIds.filter((id) => known.has(id)) }));
  for (const finding of semantic.findings) {
    const unknown = finding.evidenceIds.filter((id) => !known.has(id));
    if (unknown.length) semanticFindings.push({ severity: "error", code: "QA_EVIDENCE_REFERENCE_NOT_FOUND", message: "The QA model cited evidence IDs that do not exist.", evidenceIds: [] });
  }
  const findings = [...deterministic, ...semanticFindings];
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const score = Math.max(0, Math.min(semantic.score, 100 - errors * 25 - warnings * 5));
  const recommendation = errors ? "revise" : semantic.recommendation;
  return researchQAResultSchema.parse({
    passed: errors === 0 && score >= 70,
    score,
    findings,
    recommendation,
    deterministicChecksPassed: Math.max(0, 6 - deterministic.length),
    deterministicChecksFailed: deterministic.length,
    modelUsage,
  });
}
