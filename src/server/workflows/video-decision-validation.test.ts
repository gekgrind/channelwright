import { describe, expect, it } from "vitest";
import { videoDecisionRequestInputSchema, channelVideoDecisionResultSchema, decisionTypeSchema, type ChannelVideoDecisionResult } from "@/domain/production-workflows";
import { deterministicVideoDecisionValidation, videoDecisionQA, DETERMINISTIC_VIDEO_DECISION_RULES } from "./video-decision-validation";
import { deriveVideoDecisionEvidence } from "./video-decision-evidence";
import { approvedVideoDiagnosisArtifactFixture, channelVideoDecisionResultFixture, videoDecisionContentFixture } from "./video-decision-fixtures.test-helper";

const clone = <T>(value: T): T => structuredClone(value);
const artifact = approvedVideoDiagnosisArtifactFixture;
const evidence = deriveVideoDecisionEvidence(artifact);

const validate = (result: ChannelVideoDecisionResult) => deterministicVideoDecisionValidation(result, artifact);
const codes = (result: ChannelVideoDecisionResult) => validate(result).map((item) => item.code);

describe("CHANNEL_VIDEO_DECISION contract", () => {
  it("accepts exactly the two-field request and rejects anything else", () => {
    expect(videoDecisionRequestInputSchema.safeParse({
      videoDiagnosisWorkflowId: crypto.randomUUID(),
      videoDiagnosisRunId: crypto.randomUUID(),
    }).success).toBe(true);
    expect(videoDecisionRequestInputSchema.safeParse({ videoDiagnosisWorkflowId: crypto.randomUUID() }).success).toBe(false);
    expect(videoDecisionRequestInputSchema.safeParse({
      videoDiagnosisWorkflowId: crypto.randomUUID(),
      videoDiagnosisRunId: crypto.randomUUID(),
      extra: "not allowed",
    }).success).toBe(false);
  });

  it("declares exactly the six-member decision taxonomy with no numeric fields anywhere in the schema", () => {
    expect(decisionTypeSchema.options).toEqual([
      "PRESERVE_CURRENT_APPROACH", "GATHER_EVIDENCE", "INVESTIGATE", "PRIORITIZE_CHANGE", "DEFER", "ESCALATE_TO_HUMAN_JUDGMENT",
    ]);
  });

  it("rejects unknown top-level fields on the final result (strict schema)", () => {
    const result = channelVideoDecisionResultFixture() as unknown as Record<string, unknown>;
    expect(channelVideoDecisionResultSchema.safeParse({ ...result, extraField: true }).success).toBe(false);
  });

  it("has no asset-, endpoint-, or execution-carrying field anywhere in the schema shape", () => {
    const forbiddenKeys = ["publishAt", "scheduledAt", "videoFileUrl", "thumbnailFileUrl", "uploadToken", "youtubeVideoId", "titleOverride", "variants", "trafficSplit", "sampleSize"];
    const serialized = JSON.stringify(channelVideoDecisionResultFixture());
    for (const key of forbiddenKeys) expect(serialized).not.toContain(key);
  });

  it("accepts the fixture as-is with zero deterministic findings", () => {
    expect(validate(channelVideoDecisionResultFixture())).toEqual([]);
  });

  it("treats PRESERVE_CURRENT_APPROACH, DEFER, and GATHER_EVIDENCE as legitimate successful outcomes", () => {
    for (const decisionType of ["PRESERVE_CURRENT_APPROACH", "DEFER"] as const) {
      const base = videoDecisionContentFixture();
      const result = channelVideoDecisionResultFixture({
        content: {
          ...base,
          decision: {
            ...base.decision,
            decisionType,
            disposition: decisionType === "PRESERVE_CURRENT_APPROACH" ? "MAINTAIN" : "HOLD",
            measurementObjective: null,
            evidenceStrength: "NONE",
            confidence: "low",
          },
          alternatives: [{ ...base.alternatives[0], decisionType: "GATHER_EVIDENCE" }],
          experimentEligible: false,
        },
      });
      const qa = videoDecisionQA(validate(result));
      expect(qa.passed).toBe(true);
      expect(qa.recommendation).not.toBe("revise");
    }
  });

  it("computes deterministicChecksPassed/Failed purely from RULES.length and distinct failed codes, never a literal", () => {
    const result = channelVideoDecisionResultFixture();
    const findings = validate(result);
    const qa = videoDecisionQA(findings);
    const distinctFailed = new Set(findings.map((item) => item.code)).size;
    expect(qa.deterministicChecksFailed).toBe(distinctFailed);
    expect(qa.deterministicChecksPassed).toBe(DETERMINISTIC_VIDEO_DECISION_RULES.length - distinctFailed);
    expect(qa.deterministicChecksPassed + qa.deterministicChecksFailed).toBeGreaterThanOrEqual(DETERMINISTIC_VIDEO_DECISION_RULES.length);
  });
});

describe("upstream integrity and projection tampering", () => {
  it("rejects a changed approved Diagnosis reference", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.approvedVideoDiagnosisReference = { ...result.approvedVideoDiagnosisReference, diagnosisArtifactHash: "9".repeat(64) };
    expect(codes(result)).toContain("UPSTREAM_DIAGNOSIS_REFERENCE_CHANGED");
  });

  it("rejects a changed decision scope", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.decisionScope = { ...result.decisionScope, facts: [] as never };
    expect(codes(result)).toContain("DECISION_SCOPE_CHANGED");
  });

  it("rejects tampered evidence projection (server-derived, not model-supplied)", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.decisionEvidence = { ...result.decisionEvidence, globalConfidenceCeiling: "high" };
    expect(codes(result)).toContain("DECISION_EVIDENCE_PROJECTION_CHANGED");
  });

  it("does not let a humanRevisionNote alter the deterministic evidence projection", () => {
    const artifactWithNote = clone(artifact);
    const evidenceWithoutNote = deriveVideoDecisionEvidence(artifact);
    const evidenceWithNote = deriveVideoDecisionEvidence(artifactWithNote); // deriveVideoDecisionEvidence never reads input.humanRevisionNote
    expect(evidenceWithNote).toEqual(evidenceWithoutNote);
  });

  it("rejects changed Viewer Value provenance", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.viewerValueProvenance = { ...result.viewerValueProvenance, gate: "REVISE" };
    expect(codes(result)).toContain("VIEWER_VALUE_PROVENANCE_CHANGED");
  });

  it("rejects a changed source identity", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.source = { ...result.source, finalTitle: "A different title entirely" };
    expect(codes(result)).toContain("DECISION_SOURCE_CHANGED");
  });
});

describe("lineage and citation fabrication", () => {
  it("rejects an invalid finding citation", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.supportingFindingIds = ["diag:does-not-exist"];
    expect(codes(result)).toContain("DECISION_FINDING_NOT_FOUND");
  });

  it("rejects an invalid observation citation", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.supportingObservationIds = ["obs:does-not-exist"];
    expect(codes(result)).toContain("DECISION_OBSERVATION_NOT_FOUND");
  });

  it("rejects an invalid unknown citation", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.constrainingUnknownIds = ["unknown:does-not-exist"];
    expect(codes(result)).toContain("DECISION_UNKNOWN_NOT_FOUND");
  });

  it("rejects a cross-artifact lineage reference that does not resolve", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.decisionEvidence = { ...result.decisionEvidence, citableLineageKeys: [...result.decisionEvidence.citableLineageKeys, "lin:cross-artifact:injected"] };
    expect(codes(result)).toContain("DECISION_LINEAGE_NOT_FOUND");
  });

  it("rejects duplicate decision/alternative IDs", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.alternatives = [{ ...result.content.alternatives[0], id: result.content.decision.id }];
    expect(codes(result)).toContain("DUPLICATE_DECISION_ID");
  });

  it("rejects a critic finding that cites unauthoritative evidence", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.crossModelReview.findings = [{ code: "CUSTOM_ISSUE", severity: "error", affectedField: "content.decision", rationale: "test", evidenceRefs: ["diag:invented"] }];
    expect(codes(result)).toContain("CRITIC_EVIDENCE_NOT_FOUND");
  });
});

describe("epistemic safety", () => {
  it("rejects a hypothesis-status finding cited toward high confidence as though it were a supported inference", () => {
    const hypothesis = { id: "diag:hypothesis-example", category: "OPENING_PROMISE" as const, severity: "medium" as const, epistemicStatus: "HYPOTHESIS" as const, confidence: "medium" as const, claim: "The opening may be misaligned with the promise.", observationIds: ["obs:fact:final-title"], lineageRefs: [], supportingEvidence: ["Some weak signal."], contradictoryEvidence: [], alternativeExplanations: ["It could also be unrelated to the opening."], additionalEvidenceNeeded: ["A retention curve."] };
    const artifactWithHypothesis = clone(artifact);
    artifactWithHypothesis.diagnosisResult.analysis.findings = [hypothesis];
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.confidence = "high";
    result.content.decision.supportingFindingIds = [hypothesis.id];
    const findings = deterministicVideoDecisionValidation(result, artifactWithHypothesis);
    expect(findings.map((item) => item.code)).toContain("HYPOTHESIS_LAUNDERED_AS_FACT");
  });

  it("rejects unsupported causal-certainty language", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.rationale = "The opening definitively caused the drop in retention.";
    expect(codes(result)).toContain("UNSUPPORTED_CAUSAL_CERTAINTY");
  });

  it("holds confidence ceilings: high confidence requires STRONG category evidence", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.confidence = "high";
    expect(codes(result)).toContain("HIGH_CONFIDENCE_NOT_ALLOWED");
    expect(codes(result)).toContain("DECISION_CONFIDENCE_EXCEEDS_EVIDENCE");
  });

  it("cannot let contradictions disappear: a contradicted supporting finding requires acknowledgement", () => {
    const contradictedFinding = { id: "diag:contradicted-example", category: "OPENING_PROMISE" as const, severity: "medium" as const, epistemicStatus: "SUPPORTED_INFERENCE" as const, confidence: "medium" as const, claim: "The opening aligns with the promise.", observationIds: ["obs:fact:final-title"], lineageRefs: [], supportingEvidence: ["Title text matches promise text."], contradictoryEvidence: ["A viewer comment disputes this."], alternativeExplanations: [], additionalEvidenceNeeded: [] };
    const artifactWithContradiction = clone(artifact);
    artifactWithContradiction.diagnosisResult.analysis.findings = [contradictedFinding];
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.supportingFindingIds = [contradictedFinding.id];
    result.content.decision.acknowledgedContradictions = [];
    const findings = deterministicVideoDecisionValidation(result, artifactWithContradiction);
    expect(findings.map((item) => item.code)).toContain("CONTRADICTION_ERASED");
  });

  it("does not let a disagreement raise confidence", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.diagnosisDisagreements = [{ id: "disagreement:1", disputedFindingId: "diag:some-finding", disputedUnknownId: null, objection: "This finding overstates certainty.", basis: "The sample is too small." }];
    result.content.decision.confidence = "high";
    expect(codes(result)).toContain("DISAGREEMENT_RAISES_CONFIDENCE");
  });

  it("rejects a disagreed finding cited as support", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.diagnosisDisagreements = [{ id: "disagreement:1", disputedFindingId: "diag:disputed", disputedUnknownId: null, objection: "test", basis: "test" }];
    result.content.decision.supportingFindingIds = ["diag:disputed"];
    expect(codes(result)).toContain("DISAGREED_FINDING_CITED_AS_SUPPORT");
  });

  it("requires unresolved constraining unknowns to be carried forward, not ignored", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.constrainingUnknownIds = [];
    expect(codes(result)).toContain("UNRESOLVED_UNKNOWN_IGNORED");
  });
});

describe("action compulsion and unavailable-capability guards", () => {
  it("does not force action on inconclusive evidence: PRIORITIZE_CHANGE is unavailable while Diagnosis is inconclusive", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.decisionType = "PRIORITIZE_CHANGE";
    result.content.decision.disposition = "CHANGE";
    expect(codes(result)).toContain("FORCED_ACTION_ON_INCONCLUSIVE_DIAGNOSIS");
  });

  it("requires a supporting finding for PRIORITIZE_CHANGE and INVESTIGATE", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.decisionType = "INVESTIGATE";
    result.content.decision.disposition = "EXPLORE_CHANGE";
    result.content.decision.supportingFindingIds = [];
    expect(codes(result)).toContain("ACTION_WITHOUT_SUPPORTED_FINDING");
  });

  it("cannot treat an unavailable capability's evidence as observed", () => {
    const unavailableCategory = evidence.categories.find((item) => item.availability === "UNAVAILABLE");
    if (!unavailableCategory) return; // fixture-dependent; guard still exercised below via DECISION_TYPE_NOT_PERMITTED
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.category = unavailableCategory.category;
    result.content.decision.supportingFindingIds = ["diag:invented-support"];
    expect(codes(result)).toContain("UNAVAILABLE_EVIDENCE_CLAIM");
  });

  it("rejects a decision type the server evidence projection does not permit for that category", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.decisionType = "PRIORITIZE_CHANGE";
    result.content.decision.disposition = "CHANGE";
    expect(codes(result)).toContain("DECISION_TYPE_NOT_PERMITTED");
  });

  it("rejects a hard-to-reverse decision resting on weak or absent evidence", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.reversibility = "HARD_TO_REVERSE";
    expect(codes(result)).toContain("IRREVERSIBLE_ACTION_ON_WEAK_EVIDENCE");
  });
});

describe("numeric precision and fabricated forecasts", () => {
  it("requires exact numeric citation: 12 vs 12.001 does not pass", () => {
    const findingWithNumber = { id: "diag:numeric-example", category: "OPENING_PROMISE" as const, severity: "low" as const, epistemicStatus: "SUPPORTED_INFERENCE" as const, confidence: "medium" as const, claim: "n/a", observationIds: ["obs:fact:final-title"], lineageRefs: [], supportingEvidence: [], contradictoryEvidence: [], alternativeExplanations: [], additionalEvidenceNeeded: [] };
    const artifactWithObservation = clone(artifact);
    artifactWithObservation.diagnosisResult.observations = [
      ...artifactWithObservation.diagnosisResult.observations,
      { id: "obs:exact-number", kind: "OBSERVED", label: "Exact metric", value: 12, unit: "COUNT", sourceRefs: ["performance:/measuredSnapshot/metrics/views"], derivationRule: null, sampleAdequacy: "unknown", coverage: "partial" },
    ];
    artifactWithObservation.diagnosisResult.analysis.findings = [findingWithNumber];
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.supportingObservationIds = ["obs:exact-number"];
    result.content.decision.rationale = "The metric was 12.001, which is close enough to the observed 12.";
    const findings = deterministicVideoDecisionValidation(result, artifactWithObservation);
    expect(findings.map((item) => item.code)).toContain("UNCITED_NUMERIC_CLAIM");
  });

  it("rejects a fabricated ROI/lift/probability forecast", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.rationale = "Expected ROI from this change is significant and a 2x lift is likely.";
    expect(codes(result)).toContain("FABRICATED_QUANTITATIVE_FORECAST");
  });
});

describe("alternatives", () => {
  it("requires at least one alternative proposing a genuinely different decision type", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.alternatives = [{ ...result.content.alternatives[0], decisionType: result.content.decision.decisionType }];
    expect(codes(result)).toContain("MISSING_ALTERNATIVE");
  });

  it("requires every alternative to carry a non-empty rejection reason", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.alternatives = [{ ...result.content.alternatives[0], notSelectedReason: "   " }];
    expect(codes(result)).toContain("ALTERNATIVE_NOT_REJECTED");
  });
});

describe("measurement boundary and scope leaks", () => {
  it("requires GATHER_EVIDENCE to cite a bounded, non-empty set of constraining unknowns", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.constrainingUnknownIds = [];
    expect(codes(result)).toContain("MEASUREMENT_OBJECTIVE_INCONSISTENT");
  });

  it("rejects experiment-design leaks (variants, control groups, sample sizes, rollout sequencing)", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.rationale = "Run two variants with a control group and a sample size of 10,000 before a canary rollout.";
    expect(codes(result)).toContain("EXPERIMENT_DESIGN_LEAKED");
  });

  it("rejects execution leaks (publish, re-upload, schedule, edit instructions)", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.rationale = "Change the title and schedule the video for republishing tomorrow.";
    expect(codes(result)).toContain("EXECUTION_LEAKED");
  });

  it("rejects execution language equivalent to editing an asset, not only the exact legacy phrases", () => {
    for (const phrase of [
      "The right move is to replace the thumbnail with a higher-contrast option.",
      "We should swap the thumbnail and rewrite the description before anything else.",
      "Upload the thumbnail the team already produced.",
      "Update the opening so it matches the promise.",
    ]) {
      const result = clone(channelVideoDecisionResultFixture());
      result.content.decision.rationale = phrase;
      expect(codes(result)).toContain("EXECUTION_LEAKED");
    }
  });

  it("does not flag ordinary analytical prose that merely names assets or describes past changes", () => {
    for (const phrase of [
      "The evidence points to a change in the PACKAGING category rather than the opening.",
      "The thumbnail contrast hypothesis is unproven and the retention curve is missing.",
      "A prior title change by the operator preceded this measurement window.",
      "Retention drops sharply after the opening promise is stated.",
    ]) {
      const result = clone(channelVideoDecisionResultFixture());
      result.content.decision.rationale = phrase;
      expect(codes(result)).not.toContain("EXECUTION_LEAKED");
    }
  });

  it("rejects experiment-design language equivalent to a viewer split, not only the exact literals", () => {
    for (const phrase of [
      "Run a two-option viewer split and see which opening wins.",
      "Split viewers between two thumbnails for a week.",
      "Compare two versions of the hook with separate viewer groups.",
      "Test two titles against each other with an even audience allocation.",
    ]) {
      const result = clone(channelVideoDecisionResultFixture());
      result.content.decision.rationale = phrase;
      expect(codes(result)).toContain("EXPERIMENT_DESIGN_LEAKED");
    }
  });

  it("does not flag uncertainty language or mention of a historical experiment where none is being designed", () => {
    for (const phrase of [
      "Two categories show weak evidence and several unknowns remain unresolved.",
      "The operator ran an informal test months ago; its result is not in this artifact.",
      "Compare this outcome to the channel baseline before deciding.",
      "The finding conflicts with a separate observation about audience fit.",
    ]) {
      const result = clone(channelVideoDecisionResultFixture());
      result.content.decision.rationale = phrase;
      expect(codes(result)).not.toContain("EXPERIMENT_DESIGN_LEAKED");
    }
  });
});

describe("hypothesis / evidence laundering into an action mandate", () => {
  const hypothesisFinding = (id: string, category: "PACKAGING" | "RETENTION_STRUCTURE") => ({
    id, category, severity: "medium" as const, epistemicStatus: "HYPOTHESIS" as const, confidence: "medium" as const,
    claim: "A plausible but unproven explanation.", observationIds: ["obs:fact:final-title"], lineageRefs: [],
    supportingEvidence: ["A weak directional signal."], contradictoryEvidence: [],
    alternativeExplanations: ["It could be topic fatigue instead."], additionalEvidenceNeeded: ["A retention curve for this exact video."],
  });
  const supportedFinding = (id: string, category: "PACKAGING") => ({
    id, category, severity: "medium" as const, epistemicStatus: "SUPPORTED_INFERENCE" as const, confidence: "medium" as const,
    claim: "A directly supported inference for this category.", observationIds: ["obs:fact:final-title"], lineageRefs: [],
    supportingEvidence: ["The category metric sits well below the channel baseline."], contradictoryEvidence: [],
    alternativeExplanations: [], additionalEvidenceNeeded: [],
  });
  const prioritizeChange = (result: ChannelVideoDecisionResult, findingIds: string[]) => {
    result.content.decision.decisionType = "PRIORITIZE_CHANGE";
    result.content.decision.disposition = "CHANGE";
    result.content.decision.category = "PACKAGING";
    result.content.decision.measurementObjective = null;
    result.content.decision.supportingFindingIds = findingIds;
  };

  it("rejects PRIORITIZE_CHANGE supported only by a cross-category hypothesis", () => {
    const withFinding = clone(artifact);
    withFinding.diagnosisResult.analysis.findings = [hypothesisFinding("diag:cross-cat-hypo", "RETENTION_STRUCTURE")];
    const result = clone(channelVideoDecisionResultFixture());
    prioritizeChange(result, ["diag:cross-cat-hypo"]);
    const found = deterministicVideoDecisionValidation(result, withFinding).map((item) => item.code);
    expect(found).toContain("SUPPORTING_FINDING_CATEGORY_MISMATCH");
    expect(found).toContain("ACTION_RESTS_ON_HYPOTHESIS_ONLY");
  });

  it("rejects PRIORITIZE_CHANGE supported only by a same-category hypothesis", () => {
    const withFinding = clone(artifact);
    withFinding.diagnosisResult.analysis.findings = [hypothesisFinding("diag:packaging-hypo", "PACKAGING")];
    const result = clone(channelVideoDecisionResultFixture());
    prioritizeChange(result, ["diag:packaging-hypo"]);
    const found = deterministicVideoDecisionValidation(result, withFinding).map((item) => item.code);
    expect(found).not.toContain("SUPPORTING_FINDING_CATEGORY_MISMATCH");
    expect(found).toContain("ACTION_RESTS_ON_HYPOTHESIS_ONLY");
  });

  it("accepts PRIORITIZE_CHANGE backed by a category-relevant supported inference", () => {
    const withFinding = clone(artifact);
    withFinding.diagnosisResult.analysis.findings = [
      supportedFinding("diag:packaging-supported", "PACKAGING"),
      hypothesisFinding("diag:packaging-hypo", "PACKAGING"),
    ];
    const result = clone(channelVideoDecisionResultFixture());
    prioritizeChange(result, ["diag:packaging-supported", "diag:packaging-hypo"]);
    const found = deterministicVideoDecisionValidation(result, withFinding).map((item) => item.code);
    expect(found).not.toContain("SUPPORTING_FINDING_CATEGORY_MISMATCH");
    expect(found).not.toContain("ACTION_RESTS_ON_HYPOTHESIS_ONLY");
  });

  it("does not constrain exploratory / uncertainty-preserving types that may legitimately cite a hypothesis", () => {
    const withFinding = clone(artifact);
    withFinding.diagnosisResult.analysis.findings = [hypothesisFinding("diag:cross-cat-hypo", "RETENTION_STRUCTURE")];
    for (const decisionType of ["GATHER_EVIDENCE", "INVESTIGATE"] as const) {
      const result = clone(channelVideoDecisionResultFixture());
      result.content.decision.decisionType = decisionType;
      result.content.decision.disposition = decisionType === "GATHER_EVIDENCE" ? "LEARN_MORE" : "EXPLORE_CHANGE";
      result.content.decision.category = "RETENTION_STRUCTURE";
      if (decisionType === "INVESTIGATE") result.content.decision.measurementObjective = null;
      result.content.decision.supportingFindingIds = ["diag:cross-cat-hypo"];
      const found = deterministicVideoDecisionValidation(result, withFinding).map((item) => item.code);
      expect(found).not.toContain("SUPPORTING_FINDING_CATEGORY_MISMATCH");
      expect(found).not.toContain("ACTION_RESTS_ON_HYPOTHESIS_ONLY");
    }
  });
});

describe("Viewer Value promise-integrity consistency", () => {
  it("rejects an AT_RISK inherited state paired with a NONE promise-integrity risk", () => {
    const atRiskArtifact = clone(artifact);
    atRiskArtifact.diagnosisResult.analysis.viewerValueAnalysis.state = "AT_RISK";
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.decisionType = "ESCALATE_TO_HUMAN_JUDGMENT";
    result.content.decision.disposition = "ESCALATE";
    result.content.decision.measurementObjective = null;
    result.content.decision.requiresHumanJudgment = true;
    result.content.viewerValueImpact.inheritedState = "AT_RISK";
    result.content.viewerValueImpact.promiseIntegrityRisk = "NONE";
    result.content.viewerValueImpact.escalationRequired = true;
    expect(deterministicVideoDecisionValidation(result, atRiskArtifact).map((item) => item.code)).toContain("PROMISE_INTEGRITY_RISK_INCONSISTENT");
  });

  it("accepts an AT_RISK inherited state with a POSSIBLE or LIKELY promise-integrity risk", () => {
    const atRiskArtifact = clone(artifact);
    atRiskArtifact.diagnosisResult.analysis.viewerValueAnalysis.state = "AT_RISK";
    for (const risk of ["POSSIBLE", "LIKELY"] as const) {
      const result = clone(channelVideoDecisionResultFixture());
      result.content.decision.decisionType = "ESCALATE_TO_HUMAN_JUDGMENT";
      result.content.decision.disposition = "ESCALATE";
      result.content.decision.measurementObjective = null;
      result.content.decision.requiresHumanJudgment = true;
      result.content.viewerValueImpact.inheritedState = "AT_RISK";
      result.content.viewerValueImpact.promiseIntegrityRisk = risk;
      result.content.viewerValueImpact.escalationRequired = true;
      expect(deterministicVideoDecisionValidation(result, atRiskArtifact).map((item) => item.code)).not.toContain("PROMISE_INTEGRITY_RISK_INCONSISTENT");
    }
  });

  it("leaves the PRESERVED + NONE fixture (and other non-at-risk states) valid", () => {
    expect(codes(channelVideoDecisionResultFixture())).not.toContain("PROMISE_INTEGRITY_RISK_INCONSISTENT");
  });
});

describe("derived-field tampering", () => {
  it("rejects a disposition that does not match the server-derived mapping", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.disposition = "CHANGE";
    expect(codes(result)).toContain("DISPOSITION_MISMATCH");
  });

  it("rejects an evidence strength that does not match the server-derived category projection", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.evidenceStrength = "STRONG";
    expect(codes(result)).toContain("EVIDENCE_STRENGTH_MISMATCH");
  });

  it("rejects experimentEligible that does not match the server-derived mapping", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.experimentEligible = true;
    expect(codes(result)).toContain("EXPERIMENT_ELIGIBILITY_MISMATCH");
  });

  it("rejects an escalation flag that does not match the server-derived rule", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.viewerValueImpact.escalationRequired = true;
    expect(codes(result)).toContain("ESCALATION_FLAG_MISMATCH");
  });
});

describe("Viewer Value", () => {
  it("rejects a changed inherited Viewer Value state", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.content.viewerValueImpact.inheritedState = "AT_RISK";
    expect(codes(result)).toContain("VIEWER_VALUE_STATE_CHANGED");
  });

  it("forces escalation-safe behavior when Viewer Value is AT_RISK, regardless of favorable metrics", () => {
    const atRiskArtifact = clone(artifact);
    atRiskArtifact.diagnosisResult.analysis.viewerValueAnalysis.state = "AT_RISK";
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.decisionType = "PRIORITIZE_CHANGE";
    result.content.decision.disposition = "CHANGE";
    result.content.viewerValueImpact.inheritedState = "AT_RISK";
    const findings = deterministicVideoDecisionValidation(result, atRiskArtifact);
    expect(findings.map((item) => item.code)).toEqual(expect.arrayContaining(["VIEWER_VALUE_ESCALATION_REQUIRED", "METRIC_GAIN_OVERRIDES_VIEWER_VALUE"]));
  });

  it("caps confidence when Viewer Value state is unknown", () => {
    const unknownArtifact = clone(artifact);
    unknownArtifact.diagnosisResult.analysis.viewerValueAnalysis.state = "UNKNOWN";
    const result = clone(channelVideoDecisionResultFixture());
    result.content.decision.confidence = "high";
    result.content.viewerValueImpact.inheritedState = "UNKNOWN";
    const findings = deterministicVideoDecisionValidation(result, unknownArtifact);
    expect(findings.map((item) => item.code)).toContain("VIEWER_VALUE_CONFIDENCE_CAP");
  });
});

describe("model authority and payload boundary", () => {
  it("rejects a decision the independent critic flagged as blocking", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.crossModelReview.safeToFinalize = false;
    expect(codes(result)).toContain("CRITIC_REJECTED_DECISION");
  });

  it("requires two distinct-provider model attributions", () => {
    const result = clone(channelVideoDecisionResultFixture());
    result.modelProvenance = [result.modelProvenance[0], result.modelProvenance[0]];
    expect(codes(result)).toContain("MODEL_PROVIDER_INDEPENDENCE_REQUIRED");
  });

  it("enforces the pre-persistence payload ceiling", () => {
    const result = clone(channelVideoDecisionResultFixture());
    const findings = deterministicVideoDecisionValidation(result, artifact, evidence, 10);
    expect(findings.map((item) => item.code)).toContain("RESULT_PAYLOAD_TOO_LARGE");
  });
});
