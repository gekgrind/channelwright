import { createHash } from "node:crypto";
import {
  approvedVideoReleaseArtifactSchema,
  channelVideoPerformanceResultSchema,
  type ApprovedVideoReleaseArtifact,
  type ApprovedVideoReleaseReference,
  type ChannelVideoPerformanceResult,
  type OperatorPerformanceSnapshot,
  type ReleasedVideoKpiBindingIdentity,
  type SelectedVideoReleaseScope,
} from "@/domain/production-workflows";
import { canonicalJson } from "./canonical-json";
import { discoveryBundleFixture, viewerValueFixture } from "./content-fixtures.test-helper";
import {
  approvedVideoPackagingReferenceFixture,
  RELEASE_STRATEGY_RUN_ID,
  videoReleaseResultFixture,
} from "./video-release-fixtures.test-helper";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** The approved release this measurement vertical consumes. */
export const releaseResultForPerformanceFixture = videoReleaseResultFixture();

const RELEASE_RUN_ID = "b7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a70";

/** The exact upstream strategy identity carried transitively through the whole chain. */
export const PERFORMANCE_STRATEGY_RUN_ID = RELEASE_STRATEGY_RUN_ID;

export const approvedVideoReleaseReferenceFixture: ApprovedVideoReleaseReference = {
  releaseWorkflowId: "b7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a71",
  releaseRunId: RELEASE_RUN_ID,
  workflowDefinitionVersion: 1,
  outputSchemaVersion: 1,
  approvalId: "b7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a72",
  approvedBy: "b7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a73",
  approvedAt: "2026-08-19T10:00:00.000Z",
  finalQaState: "accept",
  finalQaScore: 91,
  releaseArtifactHash: "7".repeat(64),
  releaseProvenanceHash: "8".repeat(64),
  parentRunId: null,
  rootRunId: RELEASE_RUN_ID,
  upstreamVideoPackaging: approvedVideoPackagingReferenceFixture,
};

/** Identity-only projection of the release's bound KPI/hypothesis set. */
export const performanceKpiBindingsFixture: ReleasedVideoKpiBindingIdentity[] =
  releaseResultForPerformanceFixture.kpiHypothesisBindings.map((binding) => ({
    metric: binding.metric,
    label: binding.label,
    hypothesis: binding.hypothesis,
    strategyRunId: binding.strategyRunId,
  }));

export const performanceScopeFixture: SelectedVideoReleaseScope = {
  releaseTopicId: releaseResultForPerformanceFixture.source.packagingTopicId,
  pillarId: releaseResultForPerformanceFixture.source.pillarId,
  releasePromise: releaseResultForPerformanceFixture.source.releasePromise,
  finalTitle: releaseResultForPerformanceFixture.reconciledMetadata.finalTitle,
  strategyRunId: PERFORMANCE_STRATEGY_RUN_ID,
  kpiBindings: performanceKpiBindingsFixture,
  inheritedViewerValueProvenance: {
    originStage: "RELEASE",
    originWorkflowType: "CHANNEL_VIDEO_RELEASE",
    originRunId: RELEASE_RUN_ID,
    subjectId: releaseResultForPerformanceFixture.source.packagingTopicId,
    contractHash: sha256(canonicalJson(releaseResultForPerformanceFixture.viewerValue.contract)),
    gate: "PASS",
    assessedAt: "2026-08-19T10:00:00.000Z",
  },
};

export const approvedVideoReleaseArtifactFixture: ApprovedVideoReleaseArtifact =
  approvedVideoReleaseArtifactSchema.parse({
    reference: approvedVideoReleaseReferenceFixture,
    releaseResult: releaseResultForPerformanceFixture,
    discoveryBundle: discoveryBundleFixture,
    scope: performanceScopeFixture,
  });

/**
 * An internally consistent operator snapshot: views never exceed impressions,
 * average view duration fits inside the video, the observation window is ordered,
 * and the implied and reported retention agree. Rich coverage (seven core
 * metrics). No operator baseline entries, so hypotheses can only be adjudicated
 * qualitatively.
 */
export function operatorPerformanceSnapshotFixture(overrides: Partial<OperatorPerformanceSnapshot> = {}): OperatorPerformanceSnapshot {
  const base: OperatorPerformanceSnapshot = {
    measurementSource: "CSV_EXPORT",
    sourceNote: "Exported the YouTube Studio Reach and Engagement tabs on day 14 and transcribed the per-video row.",
    capturedAt: "2026-09-15T09:00:00.000Z",
    observationWindow: {
      start: "2026-09-01T00:00:00.000Z",
      end: "2026-09-15T00:00:00.000Z",
      daysSincePublish: 14,
    },
    videoDurationSeconds: 600,
    metrics: {
      impressions: 50_000,
      views: 6_000,
      uniqueViewers: 5_400,
      clickThroughRatePct: 12,
      averageViewDurationSeconds: 240,
      averagePercentageViewedPct: 40,
      watchTimeHours: 400,
      subscribersGained: 80,
      subscribersLost: 10,
      likes: 220,
      comments: 18,
      shares: 12,
      returningViewersPct: 28,
      estimatedRevenueUsdIndicator: 35,
    },
    operatorBaselines: [],
    operatorContext: "The video sat on the channel homepage for the first three days of the window.",
  };
  return { ...base, ...overrides };
}

/**
 * A complete, deterministically clean performance learning record for the
 * approved release fixture and the snapshot fixture above. Tests mutate one field
 * at a time so a failure names exactly one rule. Every KPI/hypothesis the release
 * bound is adjudicated once, qualitatively (no operator baseline), each observed
 * value echoes the snapshot verbatim, and nothing is fetched, predicted,
 * fabricated, or mutated.
 */
export function channelVideoPerformanceResultFixture(overrides: Partial<ChannelVideoPerformanceResult> = {}): ChannelVideoPerformanceResult {
  const snapshot = operatorPerformanceSnapshotFixture();
  const base: ChannelVideoPerformanceResult = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_PERFORMANCE",
    source: {
      releaseTopicId: performanceScopeFixture.releaseTopicId,
      pillarId: performanceScopeFixture.pillarId,
      pillarName: releaseResultForPerformanceFixture.source.pillarName,
      workingConcept: releaseResultForPerformanceFixture.source.workingConcept,
      finalTitle: performanceScopeFixture.finalTitle,
      releasePromise: performanceScopeFixture.releasePromise,
    },
    snapshotIntegrity: {
      internallyConsistent: true,
      consistencyNotes: ["Views sit well below impressions and the reported and implied retention agree, so the snapshot reads as coherent."],
      coverage: "RICH",
    },
    kpiHypothesisOutcomes: [
      {
        binding: performanceKpiBindingsFixture[0],
        metricObserved: performanceKpiBindingsFixture[0].metric === "CLICK_THROUGH_RATE" ? "CLICK_THROUGH_RATE" : "AUDIENCE_RETENTION",
        observedValue: performanceKpiBindingsFixture[0].metric === "CLICK_THROUGH_RATE"
          ? snapshot.metrics.clickThroughRatePct
          : snapshot.metrics.averagePercentageViewedPct,
        observedUnit: "PERCENT",
        comparisonBasis: "NO_BASELINE_QUALITATIVE",
        baselineValue: null,
        verdict: "INCONCLUSIVE",
        interpretation: "The click-through rate landed in a healthy-looking range for this window, but with no operator baseline for this channel the result can only be read qualitatively.",
        confidence: "medium",
        caveats: ["Short observation window.", "No operator-supplied baseline to compare against."],
      },
      {
        binding: performanceKpiBindingsFixture[1],
        metricObserved: "AUDIENCE_RETENTION",
        observedValue: snapshot.metrics.averagePercentageViewedPct,
        observedUnit: "PERCENT",
        comparisonBasis: "NO_BASELINE_QUALITATIVE",
        baselineValue: null,
        verdict: "INCONCLUSIVE",
        interpretation: "Average percentage viewed held at a level consistent with viewers reaching the worked example, but without a baseline this stays a qualitative read.",
        confidence: "medium",
        caveats: ["No operator baseline for retention on this channel."],
      },
    ],
    performanceSummary: "In the first two weeks the video drew steady impressions and a solid click-through rate, and roughly two in five minutes were watched on average. With no operator baselines the KPI hypotheses stay inconclusive, but nothing in the snapshot points to a clickbait gap: the click-through strength is not paired with collapsing early retention.",
    learnings: [
      {
        category: "RETENTION_SHAPE",
        observation: "Average percentage viewed settled near the point where the worked example begins, which fits the packaging's bet that the example is the strongest promised payoff.",
        evidenceBasis: "OBSERVED_METRIC",
        changesAnAssumption: false,
        priorAssumption: null,
        updatedUnderstanding: "The worked-example placement looks load-bearing for retention and is worth keeping in future videos.",
        confidence: "medium",
      },
      {
        category: "AUDIENCE",
        observation: "The operator noted homepage placement for the first three days, so early impressions are partly a channel-surface effect rather than title/thumbnail pull alone.",
        evidenceBasis: "OPERATOR_CONTEXT",
        changesAnAssumption: false,
        priorAssumption: null,
        updatedUnderstanding: "Read the click-through rate for this window with the homepage boost in mind.",
        confidence: "medium",
      },
    ],
    strategyRevisitSignal: {
      recommendation: "MONITOR",
      rationale: "One video with no baselines is not enough to move strategy; a second comparable release would make the click-through and retention reads decisive.",
      strategyRunId: PERFORMANCE_STRATEGY_RUN_ID,
      executionDeferred: true,
    },
    nextDecision: {
      decision: "Publish the next video in the same sequence and record an operator baseline for click-through rate and retention so the following measurement can reach a verdict.",
      rationale: "The pieces to interpret this video are all here except a channel baseline; capturing one is the cheapest way to make the next measurement conclusive.",
      supportingOutcomes: ["Click-through rate hypothesis is inconclusive only for lack of a baseline.", "Retention held near the worked example."],
      confidence: "medium",
      isRecommendationOnly: true,
    },
    viewerValue: viewerValueFixture(),
    measurementIntegrity: {
      fabricationGuardRerun: true,
      fabricationGuardOutcome: "PASS",
      noExternalRetrieval: true,
      summary: "Every number in this record is the operator's own snapshot value, cited verbatim. No analytics source was called and no benchmark or projection was introduced.",
    },
    risks: [
      { risk: "Reading a single video without a baseline can over- or under-state how the packaging performed.", severity: "medium", mitigation: "Treat the KPI verdicts as inconclusive until a second comparable release exists." },
    ],
    assumptions: ["The operator snapshot is an accurate transcription of the Studio export for this video."],
    openQuestions: ["Does this audience settle at a higher retention once the homepage boost is removed?"],
    recommendedNextAction: "Record the human approval of this learning record, then capture a channel baseline before the next release is measured.",
    measuredSnapshot: snapshot,
    upstreamVideoRelease: approvedVideoReleaseReferenceFixture,
    performanceScope: performanceScopeFixture,
    crossModelReview: null,
    modelProvenance: [
      { provider: "openai", model: "test-generator", role: "GENERATOR", operation: "video_performance_synthesis", invokedAt: "2026-08-19T10:01:00.000Z" },
    ],
  };
  return channelVideoPerformanceResultSchema.parse({ ...base, ...overrides });
}

/** QA findings reuse the research finding schema, which permits only video/channel IDs. */
export const CITABLE_PERFORMANCE_QA_EVIDENCE_ID = discoveryBundleFixture.evidence.find((item) => item.sourceType === "video")!.id;
