import { describe, expect, it } from "vitest";
import { deterministicVideoPerformanceValidation, hasUnrevisableVideoPerformanceFailure } from "./video-performance-validation";
import {
  approvedVideoReleaseArtifactFixture,
  channelVideoPerformanceResultFixture,
  operatorPerformanceSnapshotFixture,
  performanceKpiBindingsFixture,
  performanceScopeFixture,
  PERFORMANCE_STRATEGY_RUN_ID,
} from "./video-performance-fixtures.test-helper";
import { approvedVideoReleaseArtifactSchema, type OperatorPerformanceSnapshot } from "@/domain/production-workflows";

const MAX = 200_000;

const errors = (
  result: unknown,
  snapshot: OperatorPerformanceSnapshot = operatorPerformanceSnapshotFixture(),
  max: number = MAX,
) =>
  new Set(
    deterministicVideoPerformanceValidation(result, approvedVideoReleaseArtifactFixture, snapshot, max)
      .filter((f) => f.severity === "error")
      .map((f) => f.code),
  );

/** Snapshot echoed verbatim into the record, so echo checks stay quiet while a targeted rule fires. */
const paired = (snapshotOverrides: Partial<OperatorPerformanceSnapshot>) => {
  const snapshot = operatorPerformanceSnapshotFixture(snapshotOverrides);
  return { snapshot, result: channelVideoPerformanceResultFixture({ measuredSnapshot: snapshot }) };
};

const withMetrics = (overrides: Partial<OperatorPerformanceSnapshot["metrics"]>) =>
  paired({ metrics: { ...operatorPerformanceSnapshotFixture().metrics, ...overrides } });

describe("deterministic video performance validation", () => {
  it("passes the clean fixture with no error findings", () => {
    expect([...errors(channelVideoPerformanceResultFixture())]).toEqual([]);
  });

  it("rejects a measured snapshot that does not echo the operator snapshot verbatim", () => {
    const result = channelVideoPerformanceResultFixture({
      measuredSnapshot: operatorPerformanceSnapshotFixture({ sourceNote: "Silently reworded note." }),
    });
    expect(errors(result)).toContain("SNAPSHOT_ECHO_ALTERED");
  });

  it("accepts a valid snapshot where views exceed thumbnail impressions", () => {
    // YouTube impressions exclude view-producing surfaces (external, notifications,
    // etc.), so views > impressions is not a deterministic contradiction.
    const { snapshot, result } = withMetrics({ impressions: 5_000, views: 6_000 });
    expect([...errors(result, snapshot)]).toEqual([]);
  });

  it("flags an integrity claim that deterministic checks contradict", () => {
    const base = operatorPerformanceSnapshotFixture();
    const { snapshot, result } = paired({
      observationWindow: { ...base.observationWindow, start: "2026-09-20T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
    });
    // fixture declares internallyConsistent: true, but the window is inverted
    expect(errors(result, snapshot)).toContain("SNAPSHOT_INTEGRITY_UNDERSTATED");
  });

  it("rejects an average view duration longer than the video", () => {
    const { snapshot, result } = paired({ videoDurationSeconds: 120, metrics: { ...operatorPerformanceSnapshotFixture().metrics, averageViewDurationSeconds: 240 } });
    expect(errors(result, snapshot)).toContain("SNAPSHOT_AVD_EXCEEDS_DURATION");
  });

  it("rejects an inverted observation window", () => {
    const base = operatorPerformanceSnapshotFixture();
    const { snapshot, result } = paired({
      observationWindow: { ...base.observationWindow, start: "2026-09-20T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
    });
    expect(errors(result, snapshot)).toContain("SNAPSHOT_WINDOW_INVERTED");
  });

  it("rejects a coverage grade richer than the metrics present", () => {
    const { snapshot, result } = withMetrics({ impressions: null, subscribersGained: null, estimatedRevenueUsdIndicator: null });
    // fixture declares RICH; four core metrics remain -> PARTIAL
    expect(errors(result, snapshot)).toContain("SNAPSHOT_COVERAGE_OVERSTATED");
  });

  it("rejects an outcome that adjudicates a hypothesis the release never bound", () => {
    const base = channelVideoPerformanceResultFixture();
    const result = channelVideoPerformanceResultFixture({
      kpiHypothesisOutcomes: base.kpiHypothesisOutcomes.map((o, i) =>
        i === 0 ? { ...o, binding: { ...o.binding, label: "A hypothesis the release never carried" } } : o,
      ),
    });
    expect(errors(result)).toContain("HYPOTHESIS_NOT_FROM_RELEASE");
  });

  it("rejects a record that leaves a bound hypothesis unadjudicated", () => {
    const base = channelVideoPerformanceResultFixture();
    const result = channelVideoPerformanceResultFixture({ kpiHypothesisOutcomes: [base.kpiHypothesisOutcomes[0]] });
    expect(errors(result)).toContain("HYPOTHESIS_COVERAGE_INCOMPLETE");
  });

  it("rejects a bound hypothesis adjudicated more than once", () => {
    const base = channelVideoPerformanceResultFixture();
    const result = channelVideoPerformanceResultFixture({
      kpiHypothesisOutcomes: [base.kpiHypothesisOutcomes[0], { ...base.kpiHypothesisOutcomes[0] }],
    });
    expect(errors(result)).toContain("HYPOTHESIS_ADJUDICATED_TWICE");
  });

  it("rejects a SUPPORTED verdict resting on a purely qualitative comparison basis", () => {
    const base = channelVideoPerformanceResultFixture();
    const result = channelVideoPerformanceResultFixture({
      kpiHypothesisOutcomes: base.kpiHypothesisOutcomes.map((o, i) => (i === 0 ? { ...o, verdict: "SUPPORTED" } : o)),
    });
    expect(errors(result)).toContain("QUALITATIVE_VERDICT_OVERSTATED");
  });

  it("rejects a strategy-revisit signal anchored to a different strategy identity", () => {
    const base = channelVideoPerformanceResultFixture();
    const result = channelVideoPerformanceResultFixture({
      strategyRevisitSignal: { ...base.strategyRevisitSignal, strategyRunId: "00000000-0000-4000-8000-000000000000" },
    });
    expect(errors(result)).toContain("KPI_STRATEGY_IDENTITY_MISMATCH");
  });

  it("accepts outcomes and signal anchored to the exact upstream strategy identity", () => {
    const result = channelVideoPerformanceResultFixture();
    expect(result.strategyRevisitSignal.strategyRunId).toBe(PERFORMANCE_STRATEGY_RUN_ID);
    expect(errors(result).has("KPI_STRATEGY_IDENTITY_MISMATCH")).toBe(false);
  });

  it("rejects a final title that diverges from the approved release", () => {
    const base = channelVideoPerformanceResultFixture();
    const result = channelVideoPerformanceResultFixture({ source: { ...base.source, finalTitle: "A different final title" } });
    expect(errors(result)).toContain("SOURCE_TITLE_MISMATCH");
  });

  it("rejects a release promise that diverges from the approved release", () => {
    const base = channelVideoPerformanceResultFixture();
    const result = channelVideoPerformanceResultFixture({ source: { ...base.source, releasePromise: "A promise the release never made." } });
    expect(errors(result)).toContain("RELEASE_PROMISE_DIVERGES");
  });

  it("rejects a changed upstream release reference", () => {
    const base = channelVideoPerformanceResultFixture();
    const result = channelVideoPerformanceResultFixture({
      upstreamVideoRelease: { ...base.upstreamVideoRelease, finalQaScore: 50 },
    });
    expect(errors(result)).toContain("UPSTREAM_RELEASE_REFERENCE_CHANGED");
  });

  it("rejects any reference to ingesting or calling an analytics API", () => {
    const result = channelVideoPerformanceResultFixture({
      recommendedNextAction: "Pull the metrics from the YouTube Analytics API for a fuller picture.",
    });
    expect(errors(result)).toContain("ANALYTICS_INGESTION_SCOPE_VIOLATION");
  });

  it("rejects any reference to provider OAuth authorization", () => {
    const result = channelVideoPerformanceResultFixture({
      recommendedNextAction: "Authorize the YouTube account, then revisit this record.",
    });
    expect(errors(result)).toContain("OAUTH_SCOPE_VIOLATION");
  });

  it("rejects a forward-looking prediction about a future video", () => {
    const result = channelVideoPerformanceResultFixture({
      performanceSummary: "The next video will reach 100k views on the strength of this packaging.",
    });
    expect(errors(result)).toContain("FORWARD_PREDICTION_SCOPE_VIOLATION");
  });

  it("rejects an attempt to mutate the approved release record", () => {
    const result = channelVideoPerformanceResultFixture({
      recommendedNextAction: "Rewrite the selected title to something punchier before the next push.",
    });
    expect(errors(result)).toContain("RELEASE_RECORD_MUTATION_SCOPE_VIOLATION");
  });

  it("rejects an industry benchmark the operator did not supply", () => {
    const result = channelVideoPerformanceResultFixture({
      performanceSummary: "The industry average CTR is around 4 for this niche, so this looks strong.",
    });
    expect(errors(result)).toContain("FABRICATED_BENCHMARK");
  });

  it("rejects a record that serializes above the durable-output margin", () => {
    expect(errors(channelVideoPerformanceResultFixture(), operatorPerformanceSnapshotFixture(), 2_000)).toContain("RESULT_PAYLOAD_TOO_LARGE");
  });

  // --- Authoritative numbers are preserved verbatim (no float tolerance) -----

  it("accepts an observed value that echoes the snapshot exactly", () => {
    const result = channelVideoPerformanceResultFixture();
    expect(errors(result).has("OBSERVED_VALUE_NOT_FROM_SNAPSHOT")).toBe(false);
  });

  it("rejects an observed value perturbed below the old relative tolerance (12 -> 12.001)", () => {
    const base = channelVideoPerformanceResultFixture();
    const result = channelVideoPerformanceResultFixture({
      kpiHypothesisOutcomes: base.kpiHypothesisOutcomes.map((o, i) => (i === 0 ? { ...o, observedValue: 12.001 } : o)),
    });
    expect(errors(result)).toContain("OBSERVED_VALUE_NOT_FROM_SNAPSHOT");
  });

  // --- Operator baseline: verbatim value + metric/unit compatibility --------

  /** outcome[0] (CLICK_THROUGH_RATE) adjudicated against an operator baseline. */
  const withCtrBaseline = (
    baselineOverrides: Partial<OperatorPerformanceSnapshot["operatorBaselines"][number]> = {},
    outcomeOverrides: Record<string, unknown> = {},
  ) => {
    const baseFixture = channelVideoPerformanceResultFixture();
    const snapshot = operatorPerformanceSnapshotFixture({
      operatorBaselines: [{
        metric: "CLICK_THROUGH_RATE",
        label: "Channel CTR baseline",
        value: 8,
        unit: "PERCENT",
        basisNote: "Trailing 10-video median from the operator's own Studio export.",
        ...baselineOverrides,
      }],
    });
    const result = channelVideoPerformanceResultFixture({
      measuredSnapshot: snapshot,
      kpiHypothesisOutcomes: baseFixture.kpiHypothesisOutcomes.map((o, i) => (i === 0
        ? { ...o, comparisonBasis: "OPERATOR_SUPPLIED_BASELINE", baselineValue: 8, verdict: "SUPPORTED", ...outcomeOverrides }
        : o)),
    });
    return { snapshot, result };
  };

  it("accepts a definitive verdict resting on an operator baseline in the metric's canonical unit", () => {
    const { snapshot, result } = withCtrBaseline();
    expect([...errors(result, snapshot)]).toEqual([]);
  });

  it("rejects a baseline value perturbed below the old relative tolerance (8 -> 8.0005)", () => {
    const { snapshot, result } = withCtrBaseline({}, { baselineValue: 8.0005 });
    expect(errors(result, snapshot)).toContain("BASELINE_NOT_OPERATOR_SUPPLIED");
  });

  it("rejects CLICK_THROUGH_RATE adjudicated against a baseline entered as COUNT", () => {
    const { snapshot, result } = withCtrBaseline({ unit: "COUNT" });
    expect(errors(result, snapshot)).toContain("BASELINE_UNIT_INCOMPATIBLE");
  });

  it("rejects AUDIENCE_RETENTION adjudicated against a baseline entered as SECONDS", () => {
    const baseFixture = channelVideoPerformanceResultFixture();
    const snapshot = operatorPerformanceSnapshotFixture({
      operatorBaselines: [{
        metric: "AUDIENCE_RETENTION",
        label: "Channel retention baseline",
        value: 35,
        unit: "SECONDS",
        basisNote: "Trailing median average-percentage-viewed from the operator's Studio export.",
      }],
    });
    const result = channelVideoPerformanceResultFixture({
      measuredSnapshot: snapshot,
      kpiHypothesisOutcomes: baseFixture.kpiHypothesisOutcomes.map((o, i) => (i === 1
        ? { ...o, comparisonBasis: "OPERATOR_SUPPLIED_BASELINE", baselineValue: 35, verdict: "SUPPORTED" }
        : o)),
    });
    expect(errors(result, snapshot)).toContain("BASELINE_UNIT_INCOMPATIBLE");
  });

  // --- Duplicate operator baseline identity (order-independent) -------------

  /** Two CLICK_THROUGH_RATE baselines; `order` controls which is first. */
  const dupCtrBaseline = (order: "validFirst" | "invalidFirst") => {
    const valid = { metric: "CLICK_THROUGH_RATE" as const, label: "CTR baseline (current)", value: 8, unit: "PERCENT" as const, basisNote: "Trailing 10-video median." };
    const stale = { metric: "CLICK_THROUGH_RATE" as const, label: "CTR baseline (older)", value: 4, unit: "PERCENT" as const, basisNote: "An earlier export kept by mistake." };
    const operatorBaselines = order === "validFirst" ? [valid, stale] : [stale, valid];
    const snapshot = operatorPerformanceSnapshotFixture({ operatorBaselines });
    const baseFixture = channelVideoPerformanceResultFixture();
    const result = channelVideoPerformanceResultFixture({
      measuredSnapshot: snapshot,
      kpiHypothesisOutcomes: baseFixture.kpiHypothesisOutcomes.map((o, i) => (i === 0
        ? { ...o, comparisonBasis: "OPERATOR_SUPPLIED_BASELINE", baselineValue: 8, verdict: "SUPPORTED" }
        : o)),
    });
    return { snapshot, result };
  };

  it("still accepts exactly one operator baseline for a metric", () => {
    const { snapshot, result } = withCtrBaseline();
    expect([...errors(result, snapshot)]).toEqual([]);
  });

  it("rejects two operator baselines for the same metric", () => {
    const { snapshot, result } = dupCtrBaseline("validFirst");
    expect(errors(result, snapshot)).toContain("DUPLICATE_OPERATOR_BASELINE");
  });

  it("fails identically no matter which duplicate baseline is listed first", () => {
    const a = errors(dupCtrBaseline("validFirst").result, dupCtrBaseline("validFirst").snapshot);
    const b = errors(dupCtrBaseline("invalidFirst").result, dupCtrBaseline("invalidFirst").snapshot);
    expect(a.has("DUPLICATE_OPERATOR_BASELINE")).toBe(true);
    expect([...a].sort()).toEqual([...b].sort());
  });

  it("classifies a duplicate operator baseline as unrevisable", () => {
    const { snapshot, result } = dupCtrBaseline("invalidFirst");
    const findings = deterministicVideoPerformanceValidation(result, approvedVideoReleaseArtifactFixture, snapshot, MAX);
    expect(findings.some((f) => f.code === "DUPLICATE_OPERATOR_BASELINE")).toBe(true);
    expect(hasUnrevisableVideoPerformanceFailure(findings)).toBe(true);
  });

  // --- Corrupted upstream evidence identity is unrevisable -----------------

  it("classifies corrupted upstream evidence identity as unrevisable via the real validator", () => {
    const corruptedUpstream = approvedVideoReleaseArtifactSchema.parse({
      ...approvedVideoReleaseArtifactFixture,
      discoveryBundle: {
        ...approvedVideoReleaseArtifactFixture.discoveryBundle,
        evidence: approvedVideoReleaseArtifactFixture.discoveryBundle.evidence.map((e) =>
          e.sourceType === "video" ? { ...e, url: "https://www.youtube.com/watch?v=tamperedid" } : e),
      },
    });
    const findings = deterministicVideoPerformanceValidation(
      channelVideoPerformanceResultFixture(), corruptedUpstream, operatorPerformanceSnapshotFixture(), MAX,
    );
    expect(findings.some((f) => f.code === "EVIDENCE_IDENTITY_MISMATCH")).toBe(true);
    expect(hasUnrevisableVideoPerformanceFailure(findings)).toBe(true);
  });

  // --- NET_SUBSCRIBERS is only derivable from BOTH components --------------

  describe("NET_SUBSCRIBERS requires both subscribersGained and subscribersLost", () => {
    const SUBS_BINDING = {
      metric: "SUBSCRIBERS" as const,
      label: "Subscriber conversion",
      hypothesis: "The method-forward packaging converts more viewers into subscribers than a benefit-only framing.",
      strategyRunId: PERFORMANCE_STRATEGY_RUN_ID,
    };
    const upstreamWithSubs = approvedVideoReleaseArtifactSchema.parse({
      ...approvedVideoReleaseArtifactFixture,
      scope: { ...performanceScopeFixture, kpiBindings: [...performanceKpiBindingsFixture, SUBS_BINDING] },
    });

    const subsCase = (
      metricsOverride: Partial<OperatorPerformanceSnapshot["metrics"]>,
      subsOutcome: Record<string, unknown>,
    ) => {
      const snapshot = operatorPerformanceSnapshotFixture({
        metrics: { ...operatorPerformanceSnapshotFixture().metrics, ...metricsOverride },
      });
      const baseFixture = channelVideoPerformanceResultFixture();
      const result = channelVideoPerformanceResultFixture({
        measuredSnapshot: snapshot,
        performanceScope: upstreamWithSubs.scope,
        kpiHypothesisOutcomes: [
          ...baseFixture.kpiHypothesisOutcomes,
          {
            binding: SUBS_BINDING,
            metricObserved: "NONE",
            observedValue: null,
            observedUnit: "NONE",
            comparisonBasis: "NO_BASELINE_QUALITATIVE",
            baselineValue: null,
            verdict: "NOT_ENOUGH_DATA",
            interpretation: "Net subscriber adjudication for this window.",
            confidence: "low",
            caveats: [],
            ...subsOutcome,
          },
        ],
      });
      return new Set(
        deterministicVideoPerformanceValidation(result, upstreamWithSubs, snapshot, MAX)
          .filter((f) => f.severity === "error").map((f) => f.code),
      );
    };

    it("derives the correct net value when both components are present", () => {
      const codes = subsCase(
        { subscribersGained: 80, subscribersLost: 10 },
        { metricObserved: "NET_SUBSCRIBERS", observedValue: 70, observedUnit: "COUNT", verdict: "INCONCLUSIVE" },
      );
      expect(codes.has("OBSERVED_VALUE_NOT_FROM_SNAPSHOT")).toBe(false);
      expect(codes.has("HYPOTHESIS_OVERSTATED_WITHOUT_DATA")).toBe(false);
    });

    it("does not derive a net value when subscribersLost is missing", () => {
      const codes = subsCase(
        { subscribersGained: 80, subscribersLost: null },
        { metricObserved: "NET_SUBSCRIBERS", observedValue: 80, observedUnit: "COUNT", verdict: "SUPPORTED" },
      );
      expect(codes).toContain("OBSERVED_VALUE_NOT_FROM_SNAPSHOT");
      expect(codes).toContain("HYPOTHESIS_OVERSTATED_WITHOUT_DATA");
    });

    it("does not derive a net value when subscribersGained is missing", () => {
      const codes = subsCase(
        { subscribersGained: null, subscribersLost: 10 },
        { metricObserved: "NET_SUBSCRIBERS", observedValue: -10, observedUnit: "COUNT", verdict: "REFUTED" },
      );
      expect(codes).toContain("OBSERVED_VALUE_NOT_FROM_SNAPSHOT");
    });

    it("does not manufacture a synthetic zero when both components are missing", () => {
      const codes = subsCase(
        { subscribersGained: null, subscribersLost: null },
        { metricObserved: "NET_SUBSCRIBERS", observedValue: 0, observedUnit: "COUNT", verdict: "SUPPORTED" },
      );
      expect(codes).toContain("OBSERVED_VALUE_NOT_FROM_SNAPSHOT");
    });

    it("cannot carry a SUPPORTED verdict on partial subscriber data", () => {
      const codes = subsCase(
        { subscribersGained: 80, subscribersLost: null },
        { metricObserved: "NET_SUBSCRIBERS", observedValue: 80, observedUnit: "COUNT", verdict: "SUPPORTED" },
      );
      expect(codes).toContain("HYPOTHESIS_OVERSTATED_WITHOUT_DATA");
    });
  });
});
