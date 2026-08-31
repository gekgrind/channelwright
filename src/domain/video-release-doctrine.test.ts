import { describe, expect, it } from "vitest";
import { channelVideoReleaseResultSchema } from "./production-workflows";
import { packagingResultFixture, videoReleaseResultFixture, RELEASE_STRATEGY_RUN_ID } from "@/server/workflows/video-release-fixtures.test-helper";

/**
 * Product-doctrine conformance for CHANNEL_VIDEO_RELEASE.
 *
 * `docs/PRODUCT_DOCTRINE.md` is a binding constraint: Channelwright is the AI
 * operating system for a YouTube media business, not AI YouTube automation.
 * Release is the distribution / release-decision artifact, so these assertions
 * keep it a disciplined, honest decision-and-durable-record — never a publisher,
 * uploader, scheduler, renderer, or generator.
 */

const release = videoReleaseResultFixture();
const shape = channelVideoReleaseResultSchema.shape;

describe("Video Release conforms to the Channelwright product doctrine", () => {
  it("keeps the exact promise the approved packaging made", () => {
    expect(release.source.releasePromise).toBe(packagingResultFixture.source.packagedPromise);
    expect(release.source.releasePromise.length).toBeGreaterThanOrEqual(20);
  });

  it("selects one title from the approved candidates, never invents one", () => {
    const candidateIds = packagingResultFixture.titleCandidates.map((candidate) => candidate.candidateId);
    expect(candidateIds).toContain(release.titleDecision.selectedCandidateId);
    const selected = packagingResultFixture.titleCandidates.find((candidate) => candidate.candidateId === release.titleDecision.selectedCandidateId)!;
    expect(release.titleDecision.selectedTitleText).toBe(selected.text);
    expect(release.reconciledMetadata.finalTitle).toBe(selected.text);
  });

  it("selects one thumbnail concept from the approved concepts", () => {
    const conceptIds = packagingResultFixture.thumbnailConcepts.map((concept) => concept.conceptId);
    expect(conceptIds).toContain(release.thumbnailDecision.selectedConceptId);
  });

  it("re-runs the misleading-packaging guard at selection time", () => {
    expect(release.releaseIntegrity.deceptionGuardRerun).toBe(true);
    expect(release.releaseIntegrity.misleadingGuardOutcome).toBe("PASS");
  });

  it("binds to strategy KPI/hypothesis identity and intent only, never a measured outcome", () => {
    expect(release.kpiHypothesisBindings.length).toBeGreaterThan(0);
    for (const binding of release.kpiHypothesisBindings) {
      expect(binding.strategyRunId).toBe(RELEASE_STRATEGY_RUN_ID);
      expect(binding.targetIsHypothesis).toBe(true);
      expect(binding.measurementDeferred).toBe(true);
    }
    // The KPI binding schema carries no measured/observed/baseline value field.
    const bindingKeys = JSON.stringify(Object.keys(release.kpiHypothesisBindings[0]));
    for (const forbidden of ["observedValue", "baseline", "actual", "measured", "result"]) {
      expect(bindingKeys.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("re-runs the Viewer Value gate at this stage and inherits provenance from packaging", () => {
    expect(release.releaseScope.inheritedViewerValueProvenance.contractHash).toMatch(/^[a-f0-9]{64}$/);
    expect(release.releaseScope.inheritedViewerValueProvenance.originStage).toBe("PACKAGING");
    expect(release.viewerValue.gate).toBeDefined();
    expect(release.viewerValue.gateReasons.length).toBeGreaterThan(0);
  });

  it("preserves complete transitive provenance back through packaging and the chain", () => {
    expect(release.upstreamVideoPackaging.packagingRunId).toBeTruthy();
    expect(release.upstreamVideoPackaging.upstreamVideoScript.scriptRunId).toBeTruthy();
    expect(release.upstreamVideoPackaging.upstreamVideoScript.upstreamVideoBrief.briefRunId).toBeTruthy();
    expect(release.upstreamVideoPackaging.upstreamVideoScript.upstreamVideoBrief.upstreamContentIntelligence.contentRunId).toBeTruthy();
    expect(release.upstreamVideoPackaging.upstreamVideoScript.upstreamVideoBrief.upstreamContentIntelligence.upstreamStrategy.strategyRunId).toBeTruthy();
  });

  it("is a decision record, not a publishing or generation system", () => {
    const keys = Object.keys(shape);
    for (const forbidden of ["oauthToken", "uploadJob", "publishedAt", "scheduledDispatch", "renderJob", "generatedThumbnail", "recut", "recutJob", "performanceData", "measuredViews"]) {
      expect(keys).not.toContain(forbidden);
    }
    // The publish window is an intent, not a dispatch.
    expect(release.publishWindow.earliest).toBeTruthy();
    expect(release.publishWindow.latest).toBeTruthy();
  });

  it("cannot represent a performance, revenue, or reach prediction", () => {
    const keys = JSON.stringify(Object.keys(shape));
    for (const forbidden of ["predictedViews", "expectedViews", "projectedRevenue", "estimatedRpm", "searchVolume", "retentionPercent", "watchTime"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("preserves a durable decision record for later stages to inherit", () => {
    expect(release.modelProvenance.length).toBeGreaterThan(0);
    for (const entry of release.modelProvenance) {
      expect(entry.provider).toBeTruthy();
      expect(entry.model).toBeTruthy();
      expect(entry.invokedAt).toBeTruthy();
    }
    expect(release.assumptions.length).toBeGreaterThan(0);
    expect(release.openQuestions.length).toBeGreaterThan(0);
    expect(release.recommendedNextAction.length).toBeGreaterThan(10);
  });
});
