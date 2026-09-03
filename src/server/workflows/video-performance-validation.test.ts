import { describe, expect, it } from "vitest";
import { deterministicVideoPerformanceValidation } from "./video-performance-validation";
import {
  approvedVideoReleaseArtifactFixture,
  channelVideoPerformanceResultFixture,
  operatorPerformanceSnapshotFixture,
  PERFORMANCE_STRATEGY_RUN_ID,
} from "./video-performance-fixtures.test-helper";
import type { OperatorPerformanceSnapshot } from "@/domain/production-workflows";

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

  it("rejects a snapshot reporting more views than impressions", () => {
    const { snapshot, result } = withMetrics({ views: 999_999 });
    expect(errors(result, snapshot)).toContain("SNAPSHOT_VIEWS_EXCEED_IMPRESSIONS");
  });

  it("flags an integrity claim that deterministic checks contradict", () => {
    const { snapshot, result } = withMetrics({ views: 999_999 });
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
});
