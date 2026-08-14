import {
  channelStrategyResultSchema,
  strategyQAResultSchema,
  type ApprovedResearchArtifact,
  type ChannelStrategyResult,
  type ResearchQAResult,
} from "@/domain/production-workflows";
import type { ModelUsage } from "./openai-research-model";
import type { StrategySemanticQAOutput } from "./openai-strategy-model";

type Finding = ResearchQAResult["findings"][number];

function claimReferences(result: ChannelStrategyResult) {
  const thesis = Object.values(result.strategicThesis).flatMap((value) => Array.isArray(value) ? value.flatMap((item) => item.evidenceIds) : value.evidenceIds);
  return [
    ...thesis,
    ...result.targetAudience.primary.evidenceIds,
    ...(result.targetAudience.secondary?.evidenceIds ?? []),
    ...Object.values(result.positioning).flatMap((value) => Array.isArray(value) ? [] : value.evidenceIds),
    ...Object.values(result.channelPromise).flatMap((value) => Array.isArray(value) ? value.flatMap((item) => typeof item === "string" ? [] : item.evidenceIds) : value.evidenceIds),
    ...Object.values(result.valueProposition).flatMap((value) => value?.evidenceIds ?? []),
    ...result.contentPillars.flatMap((item) => item.evidenceIds),
    ...result.monetizationArchitecture.flatMap((item) => item.evidenceIds),
    ...result.strategicRisks.flatMap((item) => item.evidenceIds),
    ...result.recommendation.evidenceIds,
  ];
}

function allText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allText);
  if (value && typeof value === "object") return Object.values(value).flatMap(allText);
  return [];
}

export function deterministicStrategyValidation(resultValue: unknown, upstream: ApprovedResearchArtifact): Finding[] {
  const result = channelStrategyResultSchema.parse(resultValue);
  const findings: Finding[] = [];
  if (JSON.stringify(result.upstreamResearch) !== JSON.stringify(upstream.reference)) {
    findings.push({ severity: "error", code: "UPSTREAM_RESEARCH_REFERENCE_CHANGED", message: "The strategy changed the exact approved-research reference.", evidenceIds: [] });
  }
  const known = new Map(upstream.evidenceBundle.evidence.map((item) => [item.id, item]));
  const missing = [...new Set(claimReferences(result).filter((id) => !known.has(id)))];
  if (missing.length) findings.push({ severity: "error", code: "EVIDENCE_REFERENCE_NOT_FOUND", message: "The strategy cites evidence IDs outside the exact approved research artifact.", evidenceIds: missing });
  for (const item of upstream.evidenceBundle.evidence) {
    const expectedUrl = item.sourceType === "video" ? `https://www.youtube.com/watch?v=${item.sourceId}` : `https://www.youtube.com/channel/${item.sourceId}`;
    if (item.id !== `yt:${item.sourceType}:${item.sourceId}` || item.url !== expectedUrl) {
      findings.push({ severity: "error", code: "EVIDENCE_IDENTITY_MISMATCH", message: `Upstream evidence identity is inconsistent for ${item.id}.`, evidenceIds: [item.id] });
    }
  }
  const required: Array<[string, string[]]> = [
    ["AUDIENCE_SUPPORT_MISSING", result.targetAudience.primary.evidenceIds],
    ["POSITIONING_SUPPORT_MISSING", result.positioning.positioningStatement.evidenceIds],
    ["DIFFERENTIATION_SUPPORT_MISSING", result.positioning.differentiation.evidenceIds],
    ["RECOMMENDATION_SUPPORT_MISSING", result.recommendation.evidenceIds],
  ];
  for (const [code, ids] of required) if (!ids.length) findings.push({ severity: "error", code, message: "A major strategic conclusion lacks an upstream evidence reference.", evidenceIds: [] });
  result.contentPillars.forEach((item, index) => { if (!item.evidenceIds.length) findings.push({ severity: "error", code: "CONTENT_PILLAR_SUPPORT_MISSING", message: `Content pillar ${index + 1} is disconnected from approved research.`, evidenceIds: [] }); });
  result.monetizationArchitecture.forEach((item, index) => { if (!item.evidenceIds.length) findings.push({ severity: "warning", code: "MONETIZATION_HYPOTHESIS_UNSUPPORTED", message: `Monetization path ${index + 1} has no direct public-evidence support and must remain a hypothesis.`, evidenceIds: [] }); });
  if (result.upstreamResearch.finalQaScore < 80 && result.recommendation.confidence === "high") findings.push({ severity: "error", code: "CONFIDENCE_EXCEEDS_RESEARCH_QA", message: "High strategy confidence exceeds the bounded upstream research QA state.", evidenceIds: result.recommendation.evidenceIds });
  if (result.kpiFramework.some((item) => item.observedValue !== null || item.baselineState !== "UNAVAILABLE" || item.targetIsHypothesis !== true)) findings.push({ severity: "error", code: "FABRICATED_PERFORMANCE_METRIC", message: "Strategy KPIs must not contain observed values or pretend a baseline exists.", evidenceIds: [] });
  const text = allText(result).join("\n");
  if (/\b(?:cpm|rpm)\b\s*(?:of|is|=|:)?\s*\$?\d|\$\s*\d+(?:[,.]\d+)*(?:\s*(?:per|monthly|annually|revenue|income))/i.test(text)) findings.push({ severity: "error", code: "FABRICATED_REVENUE_ESTIMATE", message: "The strategy contains an unsupported revenue or CPM/RPM estimate.", evidenceIds: [] });
  if (/\b(?:aged?|ages)\s+\d{1,2}\s*(?:-|to)\s*\d{1,2}\b|\b\d{1,3}%\s+(?:male|female)\b/i.test(text)) findings.push({ severity: "error", code: "INVENTED_DEMOGRAPHIC_PRECISION", message: "The strategy contains demographic precision unsupported by the bounded research contract.", evidenceIds: [] });
  if (/\b(?:video title|thumbnail|hook|full script|storyboard|episode idea|content calendar)\b/i.test(text)) findings.push({ severity: "error", code: "DOWNSTREAM_ARTIFACT_SCOPE_VIOLATION", message: "The strategy generated a downstream content-production artifact.", evidenceIds: [] });
  if (!result.assumptionsAndUncertainties.evidenceGaps.length || !result.assumptionsAndUncertainties.confidenceLimitations.length) findings.push({ severity: "error", code: "UNCERTAINTY_DISCLOSURE_MISSING", message: "Evidence gaps and confidence limitations must remain explicit.", evidenceIds: [] });
  return findings;
}

export function mergeStrategyQA(deterministic: Finding[], semantic: StrategySemanticQAOutput, modelUsage: ModelUsage, upstream: ApprovedResearchArtifact) {
  const known = new Set(upstream.evidenceBundle.evidence.map((item) => item.id));
  const semanticFindings: Finding[] = semantic.findings.map((finding) => ({ ...finding, evidenceIds: finding.evidenceIds.filter((id) => known.has(id)) }));
  for (const finding of semantic.findings) if (finding.evidenceIds.some((id) => !known.has(id))) semanticFindings.push({ severity: "error", code: "QA_EVIDENCE_REFERENCE_NOT_FOUND", message: "The strategy QA model cited an unknown upstream evidence ID.", evidenceIds: [] });
  const findings = [...deterministic, ...semanticFindings];
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const score = Math.max(0, Math.min(semantic.score, 100 - errors * 25 - warnings * 5));
  return strategyQAResultSchema.parse({
    passed: errors === 0 && score >= 75,
    score,
    findings,
    recommendation: errors ? "revise" : semantic.recommendation,
    deterministicChecksPassed: Math.max(0, 12 - deterministic.length),
    deterministicChecksFailed: deterministic.length,
    modelUsage,
  });
}
