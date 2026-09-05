import {
  channelVideoDecisionResultSchema,
  videoDecisionQAResultSchema,
  type ApprovedVideoDiagnosisArtifact,
  type ChannelVideoDecisionResult,
  type VideoDecisionEvidence,
  type VideoDecisionQAResult,
} from "@/domain/production-workflows";
import { canonicalEquals } from "./canonical-json";
import {
  DECISION_TYPE_DISPOSITION,
  DECISION_TYPE_EXPERIMENT_ELIGIBLE,
  deriveVideoDecisionEvidence,
  permittedDecisionTypesFor,
} from "./video-decision-evidence";

export type Finding = { severity: "error" | "warning" | "info"; code: string; message: string; evidenceIds: string[] };

export type DecisionValidationContext = {
  result: ChannelVideoDecisionResult;
  artifact: ApprovedVideoDiagnosisArtifact;
  expectedEvidence: VideoDecisionEvidence;
  maxPayloadBytes: number;
};

export type DecisionRule = { code: string; severity: Finding["severity"]; check: (ctx: DecisionValidationContext) => string[] };

const CAUSAL_CERTAINTY = /\b(?:causes?|caused|proves?|proven cause|resulted in|led to|is the reason|responsible for|directly driv(?:e|es|en|ing)|made viewers|definitively explains)\b/i;
const EXPERIMENT_DESIGN_LEAKED = /\b(?:variant[s]?|treatment group|control group|a\/b test|traffic split|sample size|statistical significance|holdout|canary rollout|rollout sequence)\b/i;
const EXECUTION_LEAKED = /\b(?:publish|unpublish|re-?upload|schedule (?:the|a) (?:publish|video)|change the title|edit the (?:description|thumbnail|tags|script)|boost|promote this video|send (?:a )?notification|spend (?:on )?ads?)\b/i;
const NUMBER = /(?<![A-Za-z0-9_.:-])-?\d+(?:\.\d+)?%?(?![A-Za-z0-9_.:-])/g;
const FABRICATED_QUANT = /\b(?:\d+(?:\.\d+)?x lift|expected (?:return|lift|roi)|projected (?:roi|revenue|views|lift)|\d+(?:\.\d+)?% (?:lift|increase|improvement) is expected|likely to (?:increase|improve) by \d)/i;

function freeText(result: ChannelVideoDecisionResult): string[] {
  const { decision, alternatives, diagnosisDisagreements, viewerValueImpact } = result.content;
  return [
    decision.statement, decision.rationale, decision.evidenceBasis, decision.expectedLearningValue,
    ...decision.acknowledgedContradictions, ...decision.evidenceToStrengthen, ...decision.evidenceThatWouldReverse,
    ...(decision.measurementObjective ? [decision.measurementObjective.objective, decision.measurementObjective.boundedScope] : []),
    ...alternatives.flatMap((alt) => [alt.statement, alt.notSelectedReason]),
    ...diagnosisDisagreements.flatMap((item) => [item.objection, item.basis]),
    viewerValueImpact.metricGainVersusViewerBenefit,
  ];
}

function exactNumericStrings(ids: string[], artifact: ApprovedVideoDiagnosisArtifact): Set<string> {
  const values = new Set<string>();
  for (const observation of artifact.diagnosisResult.observations) {
    if (!ids.includes(observation.id) || typeof observation.value !== "number") continue;
    values.add(String(observation.value));
    values.add(`${observation.value}%`);
  }
  return values;
}

function expectedSource(artifact: ApprovedVideoDiagnosisArtifact) {
  const diagnosis = artifact.diagnosisResult;
  return {
    diagnosisWorkflowId: artifact.reference.diagnosisWorkflowId,
    diagnosisRunId: artifact.reference.diagnosisRunId,
    performanceWorkflowId: artifact.reference.upstreamVideoPerformance.performanceWorkflowId,
    performanceRunId: artifact.reference.upstreamVideoPerformance.performanceRunId,
    releaseWorkflowId: artifact.reference.upstreamVideoPerformance.upstreamVideoRelease.releaseWorkflowId,
    releaseRunId: artifact.reference.upstreamVideoPerformance.upstreamVideoRelease.releaseRunId,
    topicId: diagnosis.source.topicId,
    pillarId: diagnosis.source.pillarId,
    finalTitle: diagnosis.source.finalTitle,
    subjectIdentity: `diagnosis:${artifact.reference.diagnosisRunId}`,
  };
}

const rule = (code: string, severity: Finding["severity"], check: (ctx: DecisionValidationContext) => string[]): DecisionRule => ({ code, severity, check });

/**
 * The single authoritative rule catalogue. `deterministicChecksPassed` /
 * `deterministicChecksFailed` are always computed from this array's length and
 * from distinct failed codes -- never from a hand-maintained literal -- so an
 * added or removed rule can never silently drift the reported count out of
 * sync with what actually ran (the CHANNEL_VIDEO_PERFORMANCE P3 defect class).
 */
export const DETERMINISTIC_VIDEO_DECISION_RULES: DecisionRule[] = [
  // --- Upstream integrity -----------------------------------------------
  rule("UPSTREAM_DIAGNOSIS_REFERENCE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.approvedVideoDiagnosisReference, artifact.reference) ? [] : ["The decision changed the exact approved Diagnosis reference."]),
  rule("DECISION_SCOPE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.decisionScope, artifact.decisionScope) ? [] : ["The decision changed the authoritative compact lineage projection."]),
  rule("DECISION_EVIDENCE_PROJECTION_CHANGED", "error", ({ result, expectedEvidence }) =>
    canonicalEquals(result.decisionEvidence, expectedEvidence) ? [] : ["The decision changed server-derived evidence projection."]),
  rule("VIEWER_VALUE_PROVENANCE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.viewerValueProvenance, artifact.diagnosisResult.viewerValueProvenance) ? [] : ["Viewer Value provenance differs from the exact approved Diagnosis artifact."]),
  rule("DECISION_SOURCE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.source, expectedSource(artifact)) ? [] : ["The decision source identity does not match authoritative Diagnosis state."]),
  // A human revision note enters only via videoDecisionInputSchema.humanRevisionNote, which
  // deriveVideoDecisionEvidence never reads (it takes only the resolved artifact) -- so there is no
  // code path for it to alter decisionEvidence. video-decision-validation.test.ts asserts that
  // directly (DECISION_EVIDENCE_PROJECTION_CHANGED, above, is what would catch a regression here).

  // --- Lineage / citation fabrication ------------------------------------
  rule("DECISION_FINDING_NOT_FOUND", "error", ({ result, expectedEvidence }) => {
    const known = new Set(expectedEvidence.citableFindingIds);
    const cited = [...result.content.decision.supportingFindingIds, ...result.content.alternatives.flatMap((a) => [...a.supportingFindingIds, ...a.contradictingFindingIds])];
    return cited.filter((id) => !known.has(id)).map((id) => `${id} is not an authoritative Diagnosis finding.`);
  }),
  rule("DECISION_OBSERVATION_NOT_FOUND", "error", ({ result, expectedEvidence }) => {
    const known = new Set(expectedEvidence.citableObservationIds);
    return result.content.decision.supportingObservationIds.filter((id) => !known.has(id)).map((id) => `${id} is not an authoritative Diagnosis observation.`);
  }),
  rule("DECISION_UNKNOWN_NOT_FOUND", "error", ({ result, expectedEvidence }) => {
    const known = new Set(expectedEvidence.citableUnknownIds);
    const cited = [...result.content.decision.constrainingUnknownIds, ...result.content.alternatives.flatMap((a) => a.blockingUnknownIds), ...result.content.diagnosisDisagreements.map((d) => d.disputedUnknownId).filter((id): id is string => id !== null)];
    return cited.filter((id) => !known.has(id)).map((id) => `${id} is not an authoritative Diagnosis unknown.`);
  }),
  rule("DECISION_LINEAGE_NOT_FOUND", "error", ({ result }) => {
    const known = new Set(result.decisionScope.entries.map((entry) => entry.key));
    const cited = result.decisionEvidence.citableLineageKeys;
    return cited.filter((key) => !known.has(key)).map((key) => `${key} is not in the authoritative lineage projection.`);
  }),
  rule("DUPLICATE_DECISION_ID", "error", ({ result }) => {
    const ids = [result.content.decision.id, ...result.content.alternatives.map((a) => a.id)];
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of ids) { if (seen.has(id)) duplicates.push(id); seen.add(id); }
    return duplicates.map((id) => `${id} is used more than once across decision and alternatives.`);
  }),
  rule("CRITIC_EVIDENCE_NOT_FOUND", "error", ({ result, expectedEvidence }) => {
    const known = new Set([...expectedEvidence.citableFindingIds, ...expectedEvidence.citableUnknownIds, ...expectedEvidence.citableObservationIds, ...expectedEvidence.citableLineageKeys]);
    const messages: string[] = [];
    for (const finding of result.crossModelReview.findings) {
      if (finding.severity === "error" && finding.evidenceRefs.length === 0) messages.push(`Blocking critic issue ${finding.code} must cite authoritative evidence.`);
      for (const ref of finding.evidenceRefs) if (!known.has(ref)) messages.push(`Critic issue ${finding.code} cites unknown evidence ${ref}.`);
    }
    return messages;
  }),

  // --- Disagreement / findings interaction -------------------------------
  rule("DISAGREED_FINDING_CITED_AS_SUPPORT", "error", ({ result }) => {
    const disputed = new Set(result.content.diagnosisDisagreements.map((item) => item.disputedFindingId));
    return result.content.decision.supportingFindingIds.filter((id) => disputed.has(id)).map((id) => `${id} is both disputed and cited as support.`);
  }),
  rule("DISAGREEMENT_RAISES_CONFIDENCE", "error", ({ result, expectedEvidence }) => {
    if (result.content.diagnosisDisagreements.length === 0 || result.content.decision.confidence !== "high") return [];
    const category = expectedEvidence.categories.find((item) => item.category === result.content.decision.category);
    return category && category.evidenceStrength === "STRONG" ? [] : ["A recorded objection to a Diagnosis finding cannot itself justify raising confidence."];
  }),

  // --- Epistemic safety ----------------------------------------------------
  rule("HYPOTHESIS_LAUNDERED_AS_FACT", "error", ({ result, artifact }) => {
    const hypotheses = new Set(artifact.diagnosisResult.analysis.findings.filter((f) => f.epistemicStatus === "HYPOTHESIS").map((f) => f.id));
    return result.content.decision.confidence === "high" && result.content.decision.supportingFindingIds.some((id) => hypotheses.has(id))
      ? ["A hypothesis-status finding was cited toward high confidence as though it were a supported inference."]
      : [];
  }),
  rule("UNSUPPORTED_CAUSAL_CERTAINTY", "error", ({ result }) =>
    freeText(result).some((text) => CAUSAL_CERTAINTY.test(text)) ? ["The decision uses causal-certainty wording the contract forbids."] : []),
  rule("DECISION_CONFIDENCE_EXCEEDS_EVIDENCE", "error", ({ result, expectedEvidence }) => {
    const order = { low: 0, medium: 1, high: 2 } as const;
    const category = expectedEvidence.categories.find((item) => item.category === result.content.decision.category);
    if (!category) return ["The decision category does not exist in the server-derived evidence projection."];
    const ceiling = order[category.confidenceCeiling] < order[expectedEvidence.globalConfidenceCeiling] ? category.confidenceCeiling : expectedEvidence.globalConfidenceCeiling;
    return order[result.content.decision.confidence] > order[ceiling] ? [`Decision confidence ${result.content.decision.confidence} exceeds the evidence-entitled ceiling ${ceiling}.`] : [];
  }),
  rule("HIGH_CONFIDENCE_NOT_ALLOWED", "error", ({ result, expectedEvidence }) => {
    if (result.content.decision.confidence !== "high") return [];
    const category = expectedEvidence.categories.find((item) => item.category === result.content.decision.category);
    return category && category.evidenceStrength !== "STRONG" ? ["High confidence requires STRONG category evidence."] : [];
  }),
  rule("CONTRADICTION_ERASED", "error", ({ result, expectedEvidence }) => {
    const category = expectedEvidence.categories.find((item) => item.category === result.content.decision.category);
    if (!category || category.contradictedFindingIds.length === 0) return [];
    const acknowledgedIds = new Set(result.content.decision.supportingFindingIds.filter((id) => category.contradictedFindingIds.includes(id)));
    return category.contradictedFindingIds.some((id) => acknowledgedIds.has(id)) && result.content.decision.acknowledgedContradictions.length === 0
      ? ["A cited finding carries contradictory evidence that was not acknowledged."]
      : [];
  }),
  rule("CONTRADICTION_WITHOUT_EFFECT", "error", ({ result }) =>
    result.content.decision.acknowledgedContradictions.length > 0 && result.content.decision.confidence === "high"
      ? ["Acknowledged contradictions were recorded but did not constrain confidence."]
      : []),
  rule("UNRESOLVED_UNKNOWN_IGNORED", "error", ({ result, expectedEvidence }) => {
    const category = expectedEvidence.categories.find((item) => item.category === result.content.decision.category);
    if (!category) return [];
    const declared = new Set(result.content.decision.constrainingUnknownIds);
    return category.constrainingUnknownIds.filter((id) => !declared.has(id)).map((id) => `Constraining unknown ${id} was not carried into the decision.`);
  }),

  // --- Action compulsion ----------------------------------------------------
  rule("FORCED_ACTION_ON_INCONCLUSIVE_DIAGNOSIS", "error", ({ result, expectedEvidence }) =>
    (expectedEvidence.diagnosisOutcome === "INCONCLUSIVE" || expectedEvidence.diagnosisOutcome === "INSUFFICIENT_EVIDENCE") && result.content.decision.decisionType === "PRIORITIZE_CHANGE"
      ? ["PRIORITIZE_CHANGE is not available while the Diagnosis outcome is inconclusive or evidence-insufficient."]
      : []),
  rule("ACTION_WITHOUT_SUPPORTED_FINDING", "error", ({ result }) =>
    (result.content.decision.decisionType === "PRIORITIZE_CHANGE" || result.content.decision.decisionType === "INVESTIGATE") && result.content.decision.supportingFindingIds.length === 0
      ? [`${result.content.decision.decisionType} requires at least one cited supporting finding.`]
      : []),
  rule("IRREVERSIBLE_ACTION_ON_WEAK_EVIDENCE", "error", ({ result, expectedEvidence }) => {
    if (result.content.decision.reversibility !== "HARD_TO_REVERSE") return [];
    const category = expectedEvidence.categories.find((item) => item.category === result.content.decision.category);
    return category && (category.evidenceStrength === "WEAK" || category.evidenceStrength === "NONE")
      ? ["A hard-to-reverse decision cannot rest on weak or absent category evidence."]
      : [];
  }),
  rule("UNAVAILABLE_CAPABILITY_DECISION", "error", ({ result, expectedEvidence }) => {
    const category = expectedEvidence.categories.find((item) => item.category === result.content.decision.category);
    return category && category.availability === "UNAVAILABLE" && !permittedDecisionTypesFor("UNAVAILABLE", category.evidenceStrength).includes(result.content.decision.decisionType)
      ? [`${result.content.decision.decisionType} is not available for an unavailable capability category.`]
      : [];
  }),
  rule("DECISION_TYPE_NOT_PERMITTED", "error", ({ result, expectedEvidence }) => {
    const category = expectedEvidence.categories.find((item) => item.category === result.content.decision.category);
    if (!category) return ["The decision category does not exist in the server-derived evidence projection."];
    return category.permittedDecisionTypes.includes(result.content.decision.decisionType) ? [] : [`${result.content.decision.decisionType} is not a server-permitted decision type for ${category.category}.`];
  }),

  // --- Numeric / fake precision ----------------------------------------------
  rule("UNCITED_NUMERIC_CLAIM", "error", ({ result, artifact }) => {
    const allowed = exactNumericStrings(result.content.decision.supportingObservationIds, artifact);
    const messages: string[] = [];
    for (const text of freeText(result)) for (const token of text.match(NUMBER) ?? []) if (!allowed.has(token)) messages.push(`Numeric claim ${token} is not an exact cited observation value.`);
    return messages;
  }),
  rule("FABRICATED_QUANTITATIVE_FORECAST", "error", ({ result }) =>
    freeText(result).some((text) => FABRICATED_QUANT.test(text)) ? ["The decision states a fabricated lift, ROI, probability, or expected-return forecast."] : []),

  // --- Alternatives -------------------------------------------------------
  rule("MISSING_ALTERNATIVE", "error", ({ result }) =>
    result.content.alternatives.some((alt) => alt.decisionType !== result.content.decision.decisionType) ? [] : ["At least one alternative must propose a genuinely different decision type."]),
  rule("ALTERNATIVE_NOT_REJECTED", "error", ({ result }) =>
    result.content.alternatives.filter((alt) => alt.notSelectedReason.trim().length === 0).map((alt) => `${alt.id} has no rejection basis.`)),

  // --- Measurement boundary -------------------------------------------------
  rule("MEASUREMENT_OBJECTIVE_INCONSISTENT", "error", ({ result }) =>
    result.content.decision.decisionType === "GATHER_EVIDENCE" && result.content.decision.constrainingUnknownIds.length === 0
      ? ["GATHER_EVIDENCE requires at least one cited constraining unknown to bound its measurement objective."]
      : []),
  rule("UNAVAILABLE_EVIDENCE_CLAIM", "error", ({ result, expectedEvidence }) => {
    const category = expectedEvidence.categories.find((item) => item.category === result.content.decision.category);
    return category && category.availability === "UNAVAILABLE" && result.content.decision.supportingFindingIds.length > 0
      ? ["A decision cannot cite supporting findings for an unavailable evidence category."]
      : [];
  }),
  rule("EXPERIMENT_DESIGN_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => EXPERIMENT_DESIGN_LEAKED.test(text)) ? ["The decision contains experiment-design detail reserved for CHANNEL_VIDEO_EXPERIMENT."] : []),
  rule("EXECUTION_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => EXECUTION_LEAKED.test(text)) ? ["The decision contains execution instructions Decision is never allowed to issue."] : []),

  // --- Derived-field tampering ------------------------------------------
  rule("DISPOSITION_MISMATCH", "error", ({ result }) =>
    result.content.decision.disposition === DECISION_TYPE_DISPOSITION[result.content.decision.decisionType] ? [] : ["Disposition does not match the server-derived mapping for this decision type."]),
  rule("EVIDENCE_STRENGTH_MISMATCH", "error", ({ result, expectedEvidence }) => {
    const category = expectedEvidence.categories.find((item) => item.category === result.content.decision.category);
    return category && result.content.decision.evidenceStrength !== category.evidenceStrength ? ["Evidence strength does not match the server-derived category projection."] : [];
  }),
  rule("EXPERIMENT_ELIGIBILITY_MISMATCH", "error", ({ result }) =>
    result.content.experimentEligible === DECISION_TYPE_EXPERIMENT_ELIGIBLE[result.content.decision.decisionType] ? [] : ["experimentEligible does not match the server-derived mapping for this decision type."]),
  rule("ESCALATION_FLAG_MISMATCH", "error", ({ result, expectedEvidence }) => {
    const required = expectedEvidence.viewerValueState === "AT_RISK" || result.content.decision.decisionType === "ESCALATE_TO_HUMAN_JUDGMENT";
    return result.content.viewerValueImpact.escalationRequired === required ? [] : ["escalationRequired does not match the server-derived Viewer Value escalation rule."];
  }),

  // --- Viewer Value ---------------------------------------------------------
  rule("VIEWER_VALUE_STATE_CHANGED", "error", ({ result, expectedEvidence }) =>
    result.content.viewerValueImpact.inheritedState === expectedEvidence.viewerValueState ? [] : ["Inherited Viewer Value state does not match the authoritative Diagnosis state."]),
  rule("VIEWER_VALUE_ESCALATION_REQUIRED", "error", ({ result, expectedEvidence }) => {
    if (expectedEvidence.viewerValueState !== "AT_RISK") return [];
    const safeTypes = new Set(["PRESERVE_CURRENT_APPROACH", "GATHER_EVIDENCE", "ESCALATE_TO_HUMAN_JUDGMENT"]);
    return safeTypes.has(result.content.decision.decisionType) && result.content.decision.requiresHumanJudgment ? [] : ["Viewer Value AT_RISK requires an escalation-safe decision type with requiresHumanJudgment set."];
  }),
  rule("VIEWER_VALUE_CONFIDENCE_CAP", "error", ({ result, expectedEvidence }) =>
    expectedEvidence.viewerValueState === "UNKNOWN" && result.content.decision.confidence === "high"
      ? ["Confidence cannot be high while Viewer Value state is unknown."]
      : []),
  rule("METRIC_GAIN_OVERRIDES_VIEWER_VALUE", "error", ({ result, expectedEvidence }) =>
    expectedEvidence.viewerValueState === "AT_RISK" && result.content.decision.decisionType === "PRIORITIZE_CHANGE"
      ? ["Favorable metrics cannot override an at-risk Viewer Value state to prioritize a change."]
      : []),

  // --- Model authority / payload -------------------------------------------
  rule("CRITIC_REJECTED_DECISION", "error", ({ result }) =>
    !result.crossModelReview.safeToFinalize || result.crossModelReview.findings.some((item) => item.severity === "error")
      ? ["The independent critic found a blocking issue; automated revision is forbidden."]
      : []),
  rule("MODEL_PROVIDER_INDEPENDENCE_REQUIRED", "error", ({ result }) =>
    result.modelProvenance.length !== 2 || result.modelProvenance[0].provider === result.modelProvenance[1].provider
      ? ["Decision requires exactly one analyst and one distinct-provider critic attribution."]
      : []),
  rule("RESULT_PAYLOAD_TOO_LARGE", "error", ({ result, maxPayloadBytes }) =>
    Buffer.byteLength(JSON.stringify(result), "utf8") > maxPayloadBytes ? ["Decision exceeds the pre-persistence payload ceiling."] : []),
];

export function deterministicVideoDecisionValidation(
  result: ChannelVideoDecisionResult,
  artifact: ApprovedVideoDiagnosisArtifact,
  expectedEvidence: VideoDecisionEvidence = deriveVideoDecisionEvidence(artifact),
  maxPayloadBytes = 40_000,
): Finding[] {
  const ctx: DecisionValidationContext = { result, artifact, expectedEvidence, maxPayloadBytes };
  return DETERMINISTIC_VIDEO_DECISION_RULES.flatMap((decisionRule) =>
    decisionRule.check(ctx).map((message) => ({ severity: decisionRule.severity, code: decisionRule.code, message, evidenceIds: [] as string[] })));
}

export function videoDecisionQA(findings: Finding[]): VideoDecisionQAResult {
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const distinctFailedCodes = new Set(findings.map((item) => item.code)).size;
  return videoDecisionQAResultSchema.parse({
    passed: errors === 0,
    score: Math.max(0, 100 - errors * 20 - warnings * 5),
    findings: findings.slice(0, 50),
    recommendation: errors === 0 ? (warnings === 0 ? "accept" : "human_review_required") : "revise",
    deterministicChecksPassed: Math.max(0, DETERMINISTIC_VIDEO_DECISION_RULES.length - distinctFailedCodes),
    deterministicChecksFailed: distinctFailedCodes,
    modelUsage: { model: "deterministic", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
}

export function parseVideoDecisionResult(value: unknown) {
  return channelVideoDecisionResultSchema.parse(value);
}
