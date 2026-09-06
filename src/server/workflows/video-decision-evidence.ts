import {
  decisionTypeSchema,
  videoDecisionEvidenceSchema,
  type ApprovedVideoDiagnosisArtifact,
  type DecisionCategoryEvidence,
  type DecisionType,
  type VideoDecisionEvidence,
} from "@/domain/production-workflows";

/** All six decision types the taxonomy defines. */
export const ALL_DECISION_TYPES = decisionTypeSchema.options;

/** Category-level evidence strength, computed once, never left to the model. */
export type CategoryEvidenceStrength = DecisionCategoryEvidence["evidenceStrength"];

/** Deterministic map: evidence strength -> the decision types that strength can support. */
export const EVIDENCE_STRENGTH_PERMITTED_DECISION_TYPES: Record<CategoryEvidenceStrength, readonly DecisionType[]> = {
  STRONG: ALL_DECISION_TYPES,
  MODERATE: ALL_DECISION_TYPES.filter((type) => type !== "PRIORITIZE_CHANGE"),
  WEAK: ALL_DECISION_TYPES.filter((type) => type !== "PRIORITIZE_CHANGE"),
  NONE: ["PRESERVE_CURRENT_APPROACH", "GATHER_EVIDENCE", "DEFER", "ESCALATE_TO_HUMAN_JUDGMENT"],
};

/** Deterministic map: evidence strength -> the confidence ceiling that strength can support. */
export const EVIDENCE_STRENGTH_CONFIDENCE_CEILING: Record<CategoryEvidenceStrength, "high" | "medium" | "low"> = {
  STRONG: "high",
  MODERATE: "medium",
  WEAK: "low",
  NONE: "low",
};

/** Deterministic map: decision type -> disposition. The model cannot choose its own disposition. */
export const DECISION_TYPE_DISPOSITION: Record<DecisionType, "MAINTAIN" | "LEARN_MORE" | "EXPLORE_CHANGE" | "CHANGE" | "HOLD" | "ESCALATE"> = {
  PRESERVE_CURRENT_APPROACH: "MAINTAIN",
  GATHER_EVIDENCE: "LEARN_MORE",
  INVESTIGATE: "EXPLORE_CHANGE",
  PRIORITIZE_CHANGE: "CHANGE",
  DEFER: "HOLD",
  ESCALATE_TO_HUMAN_JUDGMENT: "ESCALATE",
};

/** Deterministic map: decision type -> whether it hands off eligible input to CHANNEL_VIDEO_EXPERIMENT. The only Experiment-facing contract v1 defines. */
export const DECISION_TYPE_EXPERIMENT_ELIGIBLE: Record<DecisionType, boolean> = {
  PRESERVE_CURRENT_APPROACH: false,
  GATHER_EVIDENCE: false,
  INVESTIGATE: true,
  PRIORITIZE_CHANGE: true,
  DEFER: false,
  ESCALATE_TO_HUMAN_JUDGMENT: false,
};

/** Categories that are unavailable can only support the same bounded decision set as zero evidence. */
export function permittedDecisionTypesFor(availability: "AVAILABLE" | "UNAVAILABLE", strength: CategoryEvidenceStrength): DecisionType[] {
  if (availability === "UNAVAILABLE") return [...EVIDENCE_STRENGTH_PERMITTED_DECISION_TYPES.NONE];
  return [...EVIDENCE_STRENGTH_PERMITTED_DECISION_TYPES[strength]];
}

function categoryEvidenceStrength(supportedCount: number, hypothesisCount: number, contradictedCount: number, hasHighConfidenceSupport: boolean): CategoryEvidenceStrength {
  if (supportedCount === 0 && hypothesisCount === 0) return "NONE";
  if (supportedCount > 0 && contradictedCount === 0) return hasHighConfidenceSupport ? "STRONG" : "MODERATE";
  if (supportedCount > 0 && contradictedCount > 0) return "MODERATE";
  return "WEAK";
}

/**
 * Derives what is decidable, category by category, purely from the resolved
 * immutable Diagnosis artifact. The model never decides what evidence exists,
 * what a category's confidence ceiling is, or which decision types are legal
 * for it -- those are server-derived here and re-derived at final QA.
 */
export function deriveVideoDecisionEvidence(artifact: ApprovedVideoDiagnosisArtifact): VideoDecisionEvidence {
  const diagnosis = artifact.diagnosisResult;
  const findings = diagnosis.analysis.findings;
  const unknowns = diagnosis.analysis.unknowns;

  const categories: DecisionCategoryEvidence[] = diagnosis.capabilities.map((capability) => {
    const categoryFindings = findings.filter((finding) => finding.category === capability.category);
    const supportedFindingIds = categoryFindings.filter((finding) => finding.epistemicStatus === "SUPPORTED_INFERENCE").map((finding) => finding.id);
    const hypothesisFindingIds = categoryFindings.filter((finding) => finding.epistemicStatus === "HYPOTHESIS").map((finding) => finding.id);
    const contradictedFindingIds = categoryFindings.filter((finding) => finding.contradictoryEvidence.length > 0).map((finding) => finding.id);
    const constrainingUnknownIds = unknowns.filter((unknown) => unknown.affectedCategories.includes(capability.category)).map((unknown) => unknown.id);
    const hasHighConfidenceSupport = categoryFindings.some((finding) => finding.epistemicStatus === "SUPPORTED_INFERENCE" && finding.confidence === "high");
    const strength = capability.availability === "UNAVAILABLE"
      ? "NONE"
      : categoryEvidenceStrength(supportedFindingIds.length, hypothesisFindingIds.length, contradictedFindingIds.length, hasHighConfidenceSupport);
    const confidenceCeiling = constrainingUnknownIds.length > 0 && strength === "STRONG" ? "medium" : EVIDENCE_STRENGTH_CONFIDENCE_CEILING[strength];
    return {
      category: capability.category,
      availability: capability.availability,
      supportedFindingIds,
      hypothesisFindingIds,
      contradictedFindingIds,
      constrainingUnknownIds,
      confidenceCeiling,
      evidenceStrength: strength,
      permittedDecisionTypes: permittedDecisionTypesFor(capability.availability, strength),
    };
  });

  const viewerValueState = diagnosis.analysis.viewerValueAnalysis.state;
  const globalConfidenceCeiling = viewerValueState === "UNKNOWN" && diagnosis.analysis.summary.overallConfidence === "high"
    ? "medium"
    : diagnosis.analysis.summary.overallConfidence;

  return videoDecisionEvidenceSchema.parse({
    categories,
    evidenceRequirements: [...new Set(unknowns.flatMap((unknown) => unknown.dataRequired))],
    globalConfidenceCeiling,
    diagnosisOutcome: diagnosis.analysis.summary.outcome,
    viewerValueState,
    citableFindingIds: findings.map((finding) => finding.id),
    citableUnknownIds: unknowns.map((unknown) => unknown.id),
    citableObservationIds: diagnosis.observations.map((observation) => observation.id),
    citableLineageKeys: artifact.decisionScope.entries.map((entry) => entry.key),
  });
}
