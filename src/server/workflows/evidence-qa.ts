import type { ResearchEvidence, ResearchQAResult } from "@/domain/production-workflows";
import type { SemanticQAOutput } from "./openai-responses";

type Finding = ResearchQAResult["findings"][number];

export function expectedEvidenceUrl(item: Pick<ResearchEvidence, "sourceType" | "sourceId">) {
  return item.sourceType === "video"
    ? `https://www.youtube.com/watch?v=${item.sourceId}`
    : `https://www.youtube.com/channel/${item.sourceId}`;
}

export function expectedEvidenceId(item: Pick<ResearchEvidence, "sourceType" | "sourceId">) {
  return `yt:${item.sourceType}:${item.sourceId}`;
}

export function hasConsistentEvidenceIdentity(item: Pick<ResearchEvidence, "id" | "url" | "sourceType" | "sourceId">) {
  return item.id === expectedEvidenceId(item) && item.url === expectedEvidenceUrl(item);
}

export function mergeSemanticQAFindings(deterministic: Finding[], semantic: SemanticQAOutput, knownEvidenceIds: Set<string>, unknownReferenceMessage: string) {
  const semanticFindings: Finding[] = semantic.findings.map((finding) => ({ ...finding, evidenceIds: finding.evidenceIds.filter((id) => knownEvidenceIds.has(id)) }));
  for (const finding of semantic.findings) {
    if (finding.evidenceIds.some((id) => !knownEvidenceIds.has(id))) {
      semanticFindings.push({ severity: "error", code: "QA_EVIDENCE_REFERENCE_NOT_FOUND", message: unknownReferenceMessage, evidenceIds: [] });
    }
  }
  const findings = [...deterministic, ...semanticFindings];
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const score = Math.max(0, Math.min(semantic.score, 100 - errors * 25 - warnings * 5));
  return {
    findings,
    errors,
    warnings,
    score,
    recommendation: errors ? ("revise" as const) : semantic.recommendation,
  };
}
