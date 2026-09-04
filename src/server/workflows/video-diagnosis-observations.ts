import {
  diagnosisObservationSetSchema,
  type ApprovedVideoPerformanceArtifact,
  type DiagnosisObservation,
  type DiagnosisObservationSet,
  type VideoDiagnosisUnknown,
} from "@/domain/production-workflows";

type MetricSpec = { key: string; pointer: string; label: string; value: number | null; unit: DiagnosisObservation["unit"] };

function adequacy(artifact: ApprovedVideoPerformanceArtifact): DiagnosisObservation["sampleAdequacy"] {
  // V1 has no statistically defensible sampling threshold. Sparse coverage is
  // definitely insufficient; all other samples remain explicitly unknown.
  return artifact.performanceResult.snapshotIntegrity.coverage === "SPARSE" ? "insufficient" : "unknown";
}

function coverage(artifact: ApprovedVideoPerformanceArtifact): DiagnosisObservation["coverage"] {
  return artifact.performanceResult.snapshotIntegrity.coverage === "RICH" ? "complete"
    : artifact.performanceResult.snapshotIntegrity.coverage === "PARTIAL" ? "partial" : "sparse";
}

export const DIAGNOSIS_DERIVATION_RULES = new Set([
  "DIAG_NET_SUBSCRIBERS_V1",
  "DIAG_IMPLIED_AVERAGE_PERCENTAGE_VIEWED_V1",
]);

export function deriveVideoDiagnosisObservations(artifact: ApprovedVideoPerformanceArtifact): DiagnosisObservationSet {
  const result = artifact.performanceResult;
  const snapshot = result.measuredSnapshot;
  const sampleAdequacy = adequacy(artifact);
  const observationCoverage = coverage(artifact);
  const observations: DiagnosisObservation[] = [];

  const metrics: MetricSpec[] = [
    { key: "impressions", pointer: "impressions", label: "Impressions", value: snapshot.metrics.impressions, unit: "COUNT" },
    { key: "views", pointer: "views", label: "Views", value: snapshot.metrics.views, unit: "COUNT" },
    { key: "unique-viewers", pointer: "uniqueViewers", label: "Unique viewers", value: snapshot.metrics.uniqueViewers, unit: "COUNT" },
    { key: "click-through-rate", pointer: "clickThroughRatePct", label: "Click-through rate", value: snapshot.metrics.clickThroughRatePct, unit: "PERCENT" },
    { key: "average-view-duration", pointer: "averageViewDurationSeconds", label: "Average view duration", value: snapshot.metrics.averageViewDurationSeconds, unit: "SECONDS" },
    { key: "average-percentage-viewed", pointer: "averagePercentageViewedPct", label: "Average percentage viewed", value: snapshot.metrics.averagePercentageViewedPct, unit: "PERCENT" },
    { key: "watch-time", pointer: "watchTimeHours", label: "Watch time", value: snapshot.metrics.watchTimeHours, unit: "HOURS" },
    { key: "subscribers-gained", pointer: "subscribersGained", label: "Subscribers gained", value: snapshot.metrics.subscribersGained, unit: "COUNT" },
    { key: "subscribers-lost", pointer: "subscribersLost", label: "Subscribers lost", value: snapshot.metrics.subscribersLost, unit: "COUNT" },
    { key: "likes", pointer: "likes", label: "Likes", value: snapshot.metrics.likes, unit: "COUNT" },
    { key: "comments", pointer: "comments", label: "Comments", value: snapshot.metrics.comments, unit: "COUNT" },
    { key: "shares", pointer: "shares", label: "Shares", value: snapshot.metrics.shares, unit: "COUNT" },
    { key: "returning-viewers", pointer: "returningViewersPct", label: "Returning viewers", value: snapshot.metrics.returningViewersPct, unit: "PERCENT" },
    { key: "revenue-indicator", pointer: "estimatedRevenueUsdIndicator", label: "Operator-supplied revenue indicator", value: snapshot.metrics.estimatedRevenueUsdIndicator, unit: "USD" },
  ];
  for (const metric of metrics) {
    if (metric.value === null) continue;
    observations.push({
      id: `obs:metric:${metric.key}`,
      kind: "OBSERVED",
      label: metric.label,
      value: metric.value,
      unit: metric.unit,
      sourceRefs: [`performance:/measuredSnapshot/metrics/${metric.pointer}`],
      derivationRule: null,
      sampleAdequacy,
      coverage: observationCoverage,
    });
  }

  if (snapshot.metrics.subscribersGained !== null && snapshot.metrics.subscribersLost !== null) {
    observations.push({
      id: "obs:derived:net-subscribers", kind: "DERIVED", label: "Net subscribers",
      value: snapshot.metrics.subscribersGained - snapshot.metrics.subscribersLost, unit: "COUNT",
      sourceRefs: ["obs:metric:subscribers-gained", "obs:metric:subscribers-lost"],
      derivationRule: "DIAG_NET_SUBSCRIBERS_V1", sampleAdequacy, coverage: observationCoverage,
    });
  }
  if (snapshot.metrics.averageViewDurationSeconds !== null) {
    observations.push({
      id: "obs:derived:implied-average-percentage-viewed", kind: "DERIVED", label: "Implied average percentage viewed",
      value: (snapshot.metrics.averageViewDurationSeconds / snapshot.videoDurationSeconds) * 100, unit: "PERCENT",
      sourceRefs: ["obs:metric:average-view-duration", "performance:/measuredSnapshot/videoDurationSeconds"],
      derivationRule: "DIAG_IMPLIED_AVERAGE_PERCENTAGE_VIEWED_V1", sampleAdequacy, coverage: observationCoverage,
    });
  }

  snapshot.operatorBaselines.forEach((baseline, index) => observations.push({
    id: `obs:baseline:${index}`, kind: "OBSERVED", label: `Operator baseline: ${baseline.label}`,
    value: baseline.value, unit: baseline.unit, sourceRefs: [`performance:/measuredSnapshot/operatorBaselines/${index}`],
    derivationRule: null, sampleAdequacy: "unknown", coverage: observationCoverage,
  }));
  result.kpiHypothesisOutcomes.forEach((outcome, index) => observations.push({
    id: `obs:kpi-outcome:${index}`, kind: "APPROVED_UPSTREAM_INTERPRETATION", label: outcome.binding.label,
    value: outcome.verdict, unit: "TEXT", sourceRefs: [`performance:/kpiHypothesisOutcomes/${index}`],
    derivationRule: null, sampleAdequacy: outcome.verdict === "NOT_ENOUGH_DATA" ? "insufficient" : sampleAdequacy,
    coverage: observationCoverage,
  }));
  artifact.diagnosisScope.facts.forEach((fact) => observations.push({
    id: fact.key.replace(/^fact:/, "obs:fact:"), kind: "OBSERVED", label: fact.key,
    value: fact.value, unit: typeof fact.value === "number" ? "RATIO" : typeof fact.value === "boolean" ? "BOOLEAN" : fact.value === null ? "NONE" : "TEXT",
    sourceRefs: [fact.sourceRef], derivationRule: null, sampleAdequacy: "unknown", coverage: "complete",
  }));

  const hasBaseline = snapshot.operatorBaselines.length > 0;
  const hasCtr = snapshot.metrics.clickThroughRatePct !== null;
  const hasImpressions = snapshot.metrics.impressions !== null;
  const hasRetentionAggregate = snapshot.metrics.averageViewDurationSeconds !== null || snapshot.metrics.averagePercentageViewedPct !== null;
  const hasConversionAggregate = snapshot.metrics.subscribersGained !== null || snapshot.metrics.subscribersLost !== null;
  const capabilities = [
    { category: "PACKAGING" as const, availability: hasCtr && (hasBaseline || result.kpiHypothesisOutcomes.some((item) => item.binding.metric === "CLICK_THROUGH_RATE" && item.verdict !== "NOT_ENOUGH_DATA")) ? "AVAILABLE" as const : "UNAVAILABLE" as const, reasonCode: hasCtr ? "APPROVED_KPI_OUTCOME_AVAILABLE" as const : "OTHER" as const, explanation: hasCtr ? "Packaging associations may use exact CTR plus an operator baseline or approved KPI outcome; causation remains forbidden." : "CTR is absent." },
    { category: "OPENING_PROMISE" as const, availability: "AVAILABLE" as const, reasonCode: "TEXTUAL_ALIGNMENT_AVAILABLE" as const, explanation: "Approved title, promise, and opening text support textual alignment only." },
    { category: "RETENTION_STRUCTURE" as const, availability: hasRetentionAggregate ? "AVAILABLE" as const : "UNAVAILABLE" as const, reasonCode: hasRetentionAggregate ? "AGGREGATE_METRICS_AVAILABLE" as const : "RETENTION_CURVE_MISSING" as const, explanation: hasRetentionAggregate ? "Only aggregate retention metrics are available; localized drops are unavailable." : "No aggregate retention metric or retention curve is available." },
    { category: "DISTRIBUTION" as const, availability: hasImpressions && hasBaseline ? "AVAILABLE" as const : "UNAVAILABLE" as const, reasonCode: "TRAFFIC_SOURCE_DATA_MISSING" as const, explanation: "Traffic-source attribution is unavailable; only bounded aggregate association is permitted when an operator baseline exists." },
    { category: "AUDIENCE_FIT" as const, availability: "UNAVAILABLE" as const, reasonCode: "AUDIENCE_SEGMENT_DATA_MISSING" as const, explanation: "No audience-segment breakdown exists." },
    { category: "CONVERSION_OUTCOME" as const, availability: hasConversionAggregate ? "AVAILABLE" as const : "UNAVAILABLE" as const, reasonCode: hasConversionAggregate ? "AGGREGATE_METRICS_AVAILABLE" as const : "DOWNSTREAM_ATTRIBUTION_MISSING" as const, explanation: hasConversionAggregate ? "Aggregate subscriber outcome is available; end-screen or downstream attribution is not." : "No aggregate subscriber outcome or downstream attribution exists." },
    { category: "VIEWER_VALUE" as const, availability: "AVAILABLE" as const, reasonCode: "APPROVED_KPI_OUTCOME_AVAILABLE" as const, explanation: "Approved Viewer Value provenance is available and performance cannot override it." },
    { category: "LINEAGE_INTEGRITY" as const, availability: "AVAILABLE" as const, reasonCode: "OTHER" as const, explanation: "The database resolved the immutable approved lineage projection." },
  ];

  const deterministicUnknowns: VideoDiagnosisUnknown[] = [
    { id: "unknown:retention-curve", type: "MISSING_METRIC", blockedClaim: "No localized retention-drop or early-abandonment claim can be made.", dataRequired: ["Retention curve or time-bucket data tied to the exact video."], affectedCategories: ["RETENTION_STRUCTURE", "OPENING_PROMISE"] },
    { id: "unknown:traffic-sources", type: "MISSING_METRIC", blockedClaim: "No traffic-source attribution can be made.", dataRequired: ["Traffic-source breakdown for the exact observation window."], affectedCategories: ["DISTRIBUTION"] },
    { id: "unknown:audience-segments", type: "MISSING_METRIC", blockedClaim: "No audience-segment fit claim can be made.", dataRequired: ["New/returning, subscriber, or other audience segment breakdown."], affectedCategories: ["AUDIENCE_FIT"] },
    { id: "unknown:downstream-attribution", type: "MISSING_METRIC", blockedClaim: "No end-screen or downstream conversion attribution can be made.", dataRequired: ["End-screen and downstream conversion event attribution."], affectedCategories: ["CONVERSION_OUTCOME"] },
    { id: "unknown:provider-video-identity", type: "MISSING_METRIC", blockedClaim: "No actual provider video identity is available in v1.", dataRequired: ["A provider-issued immutable video identifier tied to this Release."], affectedCategories: ["DISTRIBUTION", "LINEAGE_INTEGRITY"] },
    { id: "unknown:publication-timestamp", type: "MISSING_METRIC", blockedClaim: "No actual publication timestamp is available in v1.", dataRequired: ["The provider-recorded publication timestamp tied to the exact video."], affectedCategories: ["DISTRIBUTION"] },
  ];
  if (sampleAdequacy !== "sufficient") deterministicUnknowns.push({ id: "unknown:sample-adequacy", type: sampleAdequacy === "insufficient" ? "INSUFFICIENT_SAMPLE" : "OTHER", blockedClaim: "High-confidence diagnosis is unavailable because v1 has no defensible sample-adequacy proof.", dataRequired: ["An operator-approved sample adequacy policy and qualifying sample metadata."], affectedCategories: ["PACKAGING", "RETENTION_STRUCTURE", "DISTRIBUTION", "CONVERSION_OUTCOME"] });
  if (observationCoverage !== "complete") deterministicUnknowns.push({ id: "unknown:partial-window", type: "PARTIAL_WINDOW", blockedClaim: "The observation window has incomplete metric coverage.", dataRequired: ["A complete metric snapshot for the same observation window."], affectedCategories: ["PACKAGING", "RETENTION_STRUCTURE", "DISTRIBUTION", "CONVERSION_OUTCOME"] });

  return diagnosisObservationSetSchema.parse({ observations, capabilities, deterministicUnknowns });
}
