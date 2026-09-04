import { describe, expect, it } from "vitest";
import {
  channelVideoDiagnosisResultSchema,
  videoDiagnosisAnalysisSchema,
  videoDiagnosisFindingSchema,
  videoDiagnosisRequestInputSchema,
  videoDiagnosisScopeSchema,
  workflowStartRequestSchema,
  type ChannelVideoDiagnosisResult,
} from "@/domain/production-workflows";
import { approvedVideoPerformanceArtifactFixture, channelVideoDiagnosisResultFixture, videoDiagnosisAnalysisFixture } from "./video-diagnosis-fixtures.test-helper";
import { deriveVideoDiagnosisObservations } from "./video-diagnosis-observations";
import { deterministicVideoDiagnosisValidation } from "./video-diagnosis-validation";

const clone = <T>(value: T): T => structuredClone(value);
const validate = (result: ChannelVideoDiagnosisResult, max = 60_000) => deterministicVideoDiagnosisValidation(result, approvedVideoPerformanceArtifactFixture, deriveVideoDiagnosisObservations(approvedVideoPerformanceArtifactFixture), max);
const codes = (result: ChannelVideoDiagnosisResult, max?: number) => validate(result, max).map((item) => item.code);

function supportedFinding() {
  return videoDiagnosisFindingSchema.parse({
    id: "diag:packaging-association", category: "PACKAGING", severity: "medium", epistemicStatus: "SUPPORTED_INFERENCE", confidence: "medium",
    claim: "The approved click-through outcome supports a bounded packaging association for this observation window.",
    observationIds: ["obs:metric:click-through-rate", "obs:kpi-outcome:0"], lineageRefs: ["lin:title:title:method-first"],
    supportingEvidence: ["The exact approved KPI outcome and structured CTR observation are cited."], contradictoryEvidence: [], alternativeExplanations: [], additionalEvidenceNeeded: ["A comparable operator baseline would narrow uncertainty."],
  });
}

describe("CHANNEL_VIDEO_DIAGNOSIS contract", () => {
  it("accepts only the two exact Performance identifiers", () => {
    const request = { videoPerformanceWorkflowId: approvedVideoPerformanceArtifactFixture.reference.performanceWorkflowId, videoPerformanceRunId: approvedVideoPerformanceArtifactFixture.reference.performanceRunId };
    expect(videoDiagnosisRequestInputSchema.parse(request)).toEqual(request);
    expect(videoDiagnosisRequestInputSchema.safeParse({ ...request, performanceArtifact: {} }).success).toBe(false);
    expect(videoDiagnosisRequestInputSchema.safeParse({ ...request, artifactHash: "a".repeat(64) }).success).toBe(false);
    expect(videoDiagnosisRequestInputSchema.safeParse({ ...request, diagnosis: {} }).success).toBe(false);
  });

  it("routes strict workflow-start validation to Diagnosis", () => {
    const parsed = workflowStartRequestSchema.parse({ operation: "START_WORKFLOW", workflowType: "CHANNEL_VIDEO_DIAGNOSIS", definitionVersion: 1, input: { videoPerformanceWorkflowId: approvedVideoPerformanceArtifactFixture.reference.performanceWorkflowId, videoPerformanceRunId: approvedVideoPerformanceArtifactFixture.reference.performanceRunId } });
    expect(parsed.workflowType).toBe("CHANNEL_VIDEO_DIAGNOSIS");
  });

  it("has no schema representation for recommendations, actions, or experiments", () => {
    const result = channelVideoDiagnosisResultFixture();
    expect(channelVideoDiagnosisResultSchema.safeParse({ ...result, recommendation: "Change the title" }).success).toBe(false);
    expect(videoDiagnosisAnalysisSchema.safeParse({ ...result.analysis, experiment: "Try another thumbnail" }).success).toBe(false);
  });

  it("accepts a zero-finding inconclusive diagnosis only with typed unknowns", () => {
    expect(videoDiagnosisAnalysisSchema.safeParse(videoDiagnosisAnalysisFixture()).success).toBe(true);
    expect(videoDiagnosisAnalysisSchema.safeParse(videoDiagnosisAnalysisFixture({ unknowns: [], summary: { outcome: "INCONCLUSIVE", strongestFindingIds: [], unresolvedUnknownIds: [], overallConfidence: "low", narrative: "Evidence remains incomplete.", decisionDeferred: true } })).success).toBe(false);
  });

  it("caps hypothesis confidence and requires alternatives and missing evidence", () => {
    const base = supportedFinding();
    expect(videoDiagnosisFindingSchema.safeParse({ ...base, epistemicStatus: "HYPOTHESIS", confidence: "high", alternativeExplanations: [], additionalEvidenceNeeded: [] }).success).toBe(false);
  });

  it("rejects duplicate lineage keys and missing lineage parents", () => {
    const scope = approvedVideoPerformanceArtifactFixture.diagnosisScope;
    expect(videoDiagnosisScopeSchema.safeParse({ ...scope, entries: [...scope.entries, clone(scope.entries[0])] }).success).toBe(false);
    const changed = clone(scope); changed.entries[1].parentKeys = ["lin:missing"];
    expect(videoDiagnosisScopeSchema.safeParse(changed).success).toBe(false);
  });

  it("rejects duplicated artifact types, duplicate locators, and artifact-local identity drift", () => {
    const scope = clone(approvedVideoPerformanceArtifactFixture.diagnosisScope);
    scope.artifacts[7] = clone(scope.artifacts[0]);
    expect(videoDiagnosisScopeSchema.safeParse(scope).success).toBe(false);
    const duplicateLocator = clone(approvedVideoPerformanceArtifactFixture.diagnosisScope);
    duplicateLocator.entries.push({ ...clone(duplicateLocator.entries[0]), key: "lin:pillar:duplicate-key" });
    expect(videoDiagnosisScopeSchema.safeParse(duplicateLocator).success).toBe(false);
    const driftedLocator = clone(approvedVideoPerformanceArtifactFixture.diagnosisScope);
    const local = driftedLocator.entries.find((entry) => entry.locator.kind === "ARTIFACT_LOCAL")!;
    if (local.locator.kind === "ARTIFACT_LOCAL") local.locator.artifactHash = "f".repeat(64);
    expect(videoDiagnosisScopeSchema.safeParse(driftedLocator).success).toBe(false);
  });
});

describe("deterministic observation and epistemic layer", () => {
  it("derives exact immutable observations and explicit missing-data capabilities", () => {
    const set = deriveVideoDiagnosisObservations(approvedVideoPerformanceArtifactFixture);
    expect(set.observations.find((item) => item.id === "obs:derived:net-subscribers")?.value).toBe(70);
    expect(set.observations.find((item) => item.id === "obs:derived:implied-average-percentage-viewed")?.value).toBe(40);
    expect(set.capabilities.find((item) => item.category === "AUDIENCE_FIT")?.availability).toBe("UNAVAILABLE");
    expect(set.deterministicUnknowns.map((item) => item.id)).toEqual(expect.arrayContaining(["unknown:retention-curve", "unknown:traffic-sources", "unknown:audience-segments", "unknown:downstream-attribution"]));
  });

  it("accepts a conservative zero-finding artifact", () => expect(validate(channelVideoDiagnosisResultFixture())).toEqual([]));

  it("rejects server observation drift", () => {
    const result = clone(channelVideoDiagnosisResultFixture()); result.observations[0].value = 999;
    expect(codes(result)).toContain("SERVER_OBSERVATIONS_CHANGED");
  });

  it("rejects removed deterministic unknowns", () => {
    const result = clone(channelVideoDiagnosisResultFixture()); result.analysis.unknowns.shift();
    expect(codes(result)).toContain("DETERMINISTIC_UNKNOWN_MISSING");
  });

  it("rejects a finding that cites invented observations or lineage", () => {
    const result = clone(channelVideoDiagnosisResultFixture());
    result.analysis.findings = [{ ...supportedFinding(), observationIds: ["obs:invented"], lineageRefs: ["lin:invented"] }];
    expect(codes(result)).toEqual(expect.arrayContaining(["FINDING_OBSERVATION_NOT_FOUND", "FINDING_LINEAGE_NOT_FOUND"]));
  });

  it("rejects unsupported comparisons", () => {
    const result = clone(channelVideoDiagnosisResultFixture());
    result.analysis.findings = [{ ...supportedFinding(), claim: "Packaging was stronger for this video.", observationIds: ["obs:metric:click-through-rate"] }];
    expect(codes(result)).toContain("COMPARISON_WITHOUT_BASELINE");
  });

  it("rejects free-text numbers that do not round-trip to cited values", () => {
    const result = clone(channelVideoDiagnosisResultFixture());
    result.analysis.findings = [{ ...supportedFinding(), claim: "The click-through rate was 99%." }];
    expect(codes(result)).toContain("UNCITED_NUMERIC_CLAIM");
  });

  it("rejects causal certainty", () => {
    const result = clone(channelVideoDiagnosisResultFixture());
    result.analysis.findings = [{ ...supportedFinding(), claim: "The thumbnail caused the click-through result." }];
    expect(codes(result)).toContain("UNSUPPORTED_CAUSAL_CERTAINTY");
  });

  it("rejects findings in unavailable categories", () => {
    const result = clone(channelVideoDiagnosisResultFixture());
    result.analysis.findings = [{ ...supportedFinding(), category: "AUDIENCE_FIT" }];
    expect(codes(result)).toContain("UNAVAILABLE_CAPABILITY_USED");
  });

  it("forbids high confidence with unknown adequacy or missing evidence", () => {
    const result = clone(channelVideoDiagnosisResultFixture()); result.analysis.findings = [{ ...supportedFinding(), confidence: "high" }];
    expect(codes(result)).toContain("HIGH_CONFIDENCE_NOT_ALLOWED");
  });

  it("blocks recommendation/action/experiment language", () => {
    const result = clone(channelVideoDiagnosisResultFixture()); result.analysis.summary.narrative = "The next action should change the title.";
    expect(codes(result)).toContain("DECISION_SCOPE_VIOLATION");
  });

  it("preserves Viewer Value provenance and separates it from performance", () => {
    const result = clone(channelVideoDiagnosisResultFixture()); result.viewerValueProvenance.contractHash = "f".repeat(64);
    expect(codes(result)).toContain("VIEWER_VALUE_PROVENANCE_CHANGED");
  });

  it("fails closed on critic disagreement and provider collision", () => {
    const result = clone(channelVideoDiagnosisResultFixture()); result.crossModelReview.safeToFinalize = false;
    result.modelProvenance[1].provider = result.modelProvenance[0].provider;
    expect(codes(result)).toEqual(expect.arrayContaining(["CRITIC_REJECTED_DIAGNOSIS", "MODEL_PROVIDER_INDEPENDENCE_REQUIRED"]));
  });

  it("rejects invented or missing blocking critic evidence", () => {
    const result = clone(channelVideoDiagnosisResultFixture());
    result.crossModelReview.findings = [{ code: "INVENTED_REFERENCE", severity: "error", affectedField: "analysis.findings", rationale: "The draft invented evidence.", evidenceRefs: ["obs:invented"] }];
    expect(codes(result)).toContain("CRITIC_EVIDENCE_NOT_FOUND");
    result.crossModelReview.findings[0].evidenceRefs = [];
    expect(codes(result)).toContain("CRITIC_EVIDENCE_NOT_FOUND");
  });

  it("enforces the pre-persistence payload ceiling", () => expect(codes(channelVideoDiagnosisResultFixture(), 100)).toContain("RESULT_PAYLOAD_TOO_LARGE"));

  it("keeps retention/source/segment/attribution adversarial cases unknown without their datasets", () => {
    const set = deriveVideoDiagnosisObservations(approvedVideoPerformanceArtifactFixture);
    expect(set.capabilities.find((item) => item.category === "RETENTION_STRUCTURE")?.explanation).toContain("aggregate");
    expect(set.capabilities.find((item) => item.category === "DISTRIBUTION")?.explanation).toContain("Traffic-source attribution is unavailable");
    expect(set.capabilities.find((item) => item.category === "AUDIENCE_FIT")?.availability).toBe("UNAVAILABLE");
    expect(set.capabilities.find((item) => item.category === "CONVERSION_OUTCOME")?.explanation).toContain("end-screen");
    expect(set.deterministicUnknowns.map((item) => item.id)).toEqual(expect.arrayContaining(["unknown:provider-video-identity", "unknown:publication-timestamp"]));
  });
});

describe("approved Diagnosis adversarial matrix", () => {
  it("high CTR plus claimed catastrophic early abandonment remains unknown without a retention curve", () => {
    const artifact = clone(approvedVideoPerformanceArtifactFixture);
    artifact.performanceResult.measuredSnapshot.metrics.clickThroughRatePct = 18;
    const set = deriveVideoDiagnosisObservations(artifact);
    expect(set.deterministicUnknowns.some((item) => item.id === "unknown:retention-curve")).toBe(true);
    const result = clone(channelVideoDiagnosisResultFixture());
    result.analysis.findings = [{ ...supportedFinding(), category: "OPENING_PROMISE", claim: "High clicks were followed by catastrophic early abandonment." }];
    expect(codes(result)).toContain("UNAVAILABLE_EVIDENCE_CLAIM");
  });

  it("low CTR plus excellent aggregate retention preserves both measurements without causal inference", () => {
    const artifact = clone(approvedVideoPerformanceArtifactFixture);
    artifact.performanceResult.measuredSnapshot.metrics.clickThroughRatePct = 1.2;
    artifact.performanceResult.measuredSnapshot.metrics.averagePercentageViewedPct = 82;
    const set = deriveVideoDiagnosisObservations(artifact);
    expect(set.observations.find((item) => item.id === "obs:metric:click-through-rate")?.value).toBe(1.2);
    expect(set.observations.find((item) => item.id === "obs:metric:average-percentage-viewed")?.value).toBe(82);
    expect(set.deterministicUnknowns.some((item) => item.id === "unknown:retention-curve")).toBe(true);
  });

  it("low impressions plus excellent response does not manufacture traffic-source attribution", () => {
    const artifact = clone(approvedVideoPerformanceArtifactFixture);
    artifact.performanceResult.measuredSnapshot.metrics.impressions = 20;
    artifact.performanceResult.measuredSnapshot.metrics.clickThroughRatePct = 20;
    const set = deriveVideoDiagnosisObservations(artifact);
    expect(set.deterministicUnknowns.some((item) => item.id === "unknown:traffic-sources")).toBe(true);
    const result = clone(channelVideoDiagnosisResultFixture());
    result.analysis.findings = [{ ...supportedFinding(), category: "DISTRIBUTION", claim: "Suggested-video traffic-source attribution was favorable." }];
    expect(codes(result)).toContain("UNAVAILABLE_EVIDENCE_CLAIM");
  });

  it("an apparent retention issue with sparse coverage is insufficient evidence", () => {
    const artifact = clone(approvedVideoPerformanceArtifactFixture);
    artifact.performanceResult.snapshotIntegrity.coverage = "SPARSE";
    artifact.performanceResult.measuredSnapshot.metrics.averagePercentageViewedPct = 12;
    const set = deriveVideoDiagnosisObservations(artifact);
    expect(set.observations.find((item) => item.id === "obs:metric:average-percentage-viewed")?.sampleAdequacy).toBe("insufficient");
    expect(set.deterministicUnknowns.find((item) => item.id === "unknown:sample-adequacy")?.type).toBe("INSUFFICIENT_SAMPLE");
  });

  it("packaging-promise versus opening mismatch permits textual analysis but not performance causation", () => {
    const set = deriveVideoDiagnosisObservations(approvedVideoPerformanceArtifactFixture);
    expect(set.capabilities.find((item) => item.category === "OPENING_PROMISE")?.availability).toBe("AVAILABLE");
    const result = clone(channelVideoDiagnosisResultFixture());
    result.analysis.findings = [{ ...supportedFinding(), category: "OPENING_PROMISE", claim: "The opening mismatch caused weaker retention." }];
    expect(codes(result)).toEqual(expect.arrayContaining(["UNSUPPORTED_CAUSAL_CERTAINTY", "COMPARISON_WITHOUT_BASELINE"]));
  });

  it("a model-invented thumbnail cause is blocking", () => {
    const result = clone(channelVideoDiagnosisResultFixture());
    result.analysis.findings = [{ ...supportedFinding(), claim: "The thumbnail causes the click-through result." }];
    expect(codes(result)).toContain("UNSUPPORTED_CAUSAL_CERTAINTY");
  });

  it("contradictory traffic-source evidence cannot be asserted without source data", () => {
    const result = clone(channelVideoDiagnosisResultFixture());
    result.analysis.findings = [{ ...supportedFinding(), category: "DISTRIBUTION", claim: "Browse features and search traffic point in conflicting directions." }];
    expect(codes(result)).toContain("UNAVAILABLE_EVIDENCE_CLAIM");
  });

  it("an incomplete observation window remains a typed partial-window unknown", () => {
    const artifact = clone(approvedVideoPerformanceArtifactFixture);
    artifact.performanceResult.snapshotIntegrity.coverage = "PARTIAL";
    const set = deriveVideoDiagnosisObservations(artifact);
    expect(set.observations.every((item) => item.coverage === "partial" || item.coverage === "complete")).toBe(true);
    expect(set.deterministicUnknowns.some((item) => item.id === "unknown:partial-window" && item.type === "PARTIAL_WINDOW")).toBe(true);
  });
});
