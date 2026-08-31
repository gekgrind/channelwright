import { createHash } from "node:crypto";
import {
  approvedVideoPackagingArtifactSchema,
  channelVideoReleaseResultSchema,
  type ApprovedVideoPackagingArtifact,
  type ApprovedVideoPackagingReference,
  type ChannelVideoReleaseResult,
  type SelectedVideoPackagingScope,
} from "@/domain/production-workflows";
import { canonicalJson } from "./canonical-json";
import { discoveryBundleFixture, viewerValueFixture } from "./content-fixtures.test-helper";
import { videoPackagingResultFixture } from "./video-packaging-fixtures.test-helper";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** The approved packaging this release vertical consumes. */
export const packagingResultFixture = videoPackagingResultFixture();

const PACKAGING_RUN_ID = "9c4e2f1a-3d5c-4e4a-9c3f-4e6f7a8b9c01";

/** The exact upstream strategy identity carried transitively through the chain. */
export const RELEASE_STRATEGY_RUN_ID =
  packagingResultFixture.upstreamVideoScript.upstreamVideoBrief.upstreamContentIntelligence.upstreamStrategy.strategyRunId;

export const approvedVideoPackagingReferenceFixture: ApprovedVideoPackagingReference = {
  packagingWorkflowId: "9c4e2f1a-3d5c-4e4a-9c3f-4e6f7a8b9c00",
  packagingRunId: PACKAGING_RUN_ID,
  workflowDefinitionVersion: 1,
  outputSchemaVersion: 1,
  approvalId: "9c4e2f1a-3d5c-4e4a-9c3f-4e6f7a8b9c02",
  approvedBy: "9c4e2f1a-3d5c-4e4a-9c3f-4e6f7a8b9c03",
  approvedAt: "2026-08-18T10:00:00.000Z",
  finalQaState: "accept",
  finalQaScore: 90,
  packagingArtifactHash: "5".repeat(64),
  packagingProvenanceHash: "6".repeat(64),
  parentRunId: null,
  rootRunId: PACKAGING_RUN_ID,
  upstreamVideoScript: packagingResultFixture.upstreamVideoScript,
};

export const releaseScopeFixture: SelectedVideoPackagingScope = {
  packagingTopicId: packagingResultFixture.source.scriptTopicId,
  pillarId: packagingResultFixture.source.pillarId,
  packagedPromise: packagingResultFixture.source.packagedPromise,
  titleCandidateIds: packagingResultFixture.titleCandidates.map((candidate) => candidate.candidateId),
  thumbnailConceptIds: packagingResultFixture.thumbnailConcepts.map((concept) => concept.conceptId),
  inheritedViewerValueProvenance: {
    originStage: "PACKAGING",
    originWorkflowType: "CHANNEL_VIDEO_PACKAGING",
    originRunId: PACKAGING_RUN_ID,
    subjectId: packagingResultFixture.source.scriptTopicId,
    contractHash: sha256(canonicalJson(packagingResultFixture.viewerValue.contract)),
    gate: "PASS",
    assessedAt: "2026-08-18T10:00:00.000Z",
  },
};

export const approvedVideoPackagingArtifactFixture: ApprovedVideoPackagingArtifact =
  approvedVideoPackagingArtifactSchema.parse({
    reference: approvedVideoPackagingReferenceFixture,
    packagingResult: packagingResultFixture,
    discoveryBundle: discoveryBundleFixture,
    scope: releaseScopeFixture,
  });

/**
 * A complete, deterministically clean release record for the approved packaging.
 * Tests mutate one field at a time so a failure names exactly one rule. The
 * selected title and thumbnail are EXACT members of the packaging's candidate
 * sets, the reconciled title equals the selected candidate verbatim, chapters are
 * carried from the packaging, and no publishing, scheduling, OAuth, rendering, or
 * generation action is asserted.
 */
export function videoReleaseResultFixture(overrides: Partial<ChannelVideoReleaseResult> = {}): ChannelVideoReleaseResult {
  const selectedTitle = packagingResultFixture.titleCandidates[0];
  const selectedThumb = packagingResultFixture.thumbnailConcepts[0];
  const base: ChannelVideoReleaseResult = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_RELEASE",
    source: {
      packagingTopicId: packagingResultFixture.source.scriptTopicId,
      pillarId: packagingResultFixture.source.pillarId,
      pillarName: packagingResultFixture.source.pillarName,
      workingConcept: packagingResultFixture.source.workingConcept,
      releasePromise: packagingResultFixture.source.packagedPromise,
    },
    titleDecision: {
      selectedCandidateId: selectedTitle.candidateId,
      selectedTitleText: selectedTitle.text,
      rationale: "Leads with the concrete five-step order the video delivers, matching how this audience searches.",
      promiseAlignment: "Promises exactly the ordered method the video builds, no more.",
      deceptionRisk: "none",
    },
    thumbnailDecision: {
      selectedConceptId: selectedThumb.conceptId,
      rationale: "Shows the uncovered gap the video resolves on screen, in one glance.",
      promiseAlignment: "The red gap is the exact problem the video fixes.",
      deceptionRisk: "none",
    },
    publishWindow: {
      timezone: "America/New_York",
      earliest: "2026-09-01T13:00:00.000Z",
      latest: "2026-09-03T15:00:00.000Z",
      cadenceRationale: "Keeps the weekly operating-systems cadence without crowding the prior upload.",
      rationale: "A Tuesday-to-Thursday late-morning window is when this small-business audience tends to plan. This is an intent only; nothing is dispatched here.",
    },
    playlistPlacement: {
      seriesName: "Operating Systems, Explained",
      playlistName: "Scheduling and Staffing",
      episodeIntent: "Add as the staffing-sequence entry after the coverage-basics video.",
      placementRationale: "Groups the video with the sequence a new viewer would binge next.",
    },
    distributionSurfaces: [
      { surface: "YOUTUBE_LONG_FORM", label: null, intent: "The canonical long-form video, surfaced as the channel's primary entry this week.", rationale: "This is the approved video's home surface.", viewerValueImpact: "supports" },
      { surface: "YOUTUBE_COMMUNITY_POST", label: "One-line teaser", intent: "Plan a community post pointing to the video once it is available.", rationale: "Reaches existing subscribers without a separate edit.", viewerValueImpact: "neutral" },
    ],
    reconciledMetadata: {
      finalTitle: selectedTitle.text,
      finalDescription: {
        summary: packagingResultFixture.description.summary,
        body: packagingResultFixture.description.body,
      },
      tags: packagingResultFixture.tags.slice(0, 6),
      chapters: packagingResultFixture.chapters,
      categoryHint: "Education",
      language: "English",
    },
    kpiHypothesisBindings: [
      {
        metric: "CLICK_THROUGH_RATE",
        label: "Title/thumbnail resonance",
        hypothesis: "A method-forward title paired with the gap thumbnail earns more clicks from planning-intent viewers than a benefit-only framing.",
        rationale: "The selected pairing names the concrete method the audience is searching for.",
        strategyRunId: RELEASE_STRATEGY_RUN_ID,
        targetIsHypothesis: true,
        measurementDeferred: true,
      },
      {
        metric: "AUDIENCE_RETENTION",
        label: "Worked-example hold",
        hypothesis: "Chapters that surface the worked example keep planning-intent viewers past the model section.",
        rationale: "The example section is the packaging's strongest promised payoff.",
        strategyRunId: RELEASE_STRATEGY_RUN_ID,
        targetIsHypothesis: true,
        measurementDeferred: true,
      },
    ],
    viewerValue: viewerValueFixture(),
    releaseIntegrity: {
      deceptionGuardRerun: true,
      misleadingGuardOutcome: "PASS",
      rejectedForDeception: ["A 'never lose a shift again' framing was rejected because the method surfaces gaps rather than guaranteeing none."],
      summary: "The selected title and thumbnail were re-checked against the video's promise; the one over-claiming option was withheld.",
    },
    risks: [
      { risk: "A method-forward title may under-sell to viewers who want the failure framing first.", severity: "low", mitigation: "The alternative failure-first candidate remains available for a later test." },
    ],
    assumptions: ["Thumbnail image production and the actual publish happen in later stages, not here."],
    openQuestions: ["Does this audience respond better to method-first or failure-first framing?"],
    recommendedNextAction: "Record the human release approval, then hand the approved release record to a later publishing stage.",
    upstreamVideoPackaging: approvedVideoPackagingReferenceFixture,
    releaseScope: releaseScopeFixture,
    crossModelReview: null,
    modelProvenance: [
      { provider: "openai", model: "test-generator", role: "GENERATOR", operation: "video_release_synthesis", invokedAt: "2026-08-18T10:01:00.000Z" },
    ],
  };
  return channelVideoReleaseResultSchema.parse({ ...base, ...overrides });
}

/** QA findings reuse the research finding schema, which permits only video/channel IDs. */
export const CITABLE_QA_EVIDENCE_ID = discoveryBundleFixture.evidence.find((item) => item.sourceType === "video")!.id;
