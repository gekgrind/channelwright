import { describe, expect, it } from "vitest";
import { channelVideoPackagingResultSchema } from "./production-workflows";
import { videoPackagingResultFixture } from "@/server/workflows/video-packaging-fixtures.test-helper";
import { scriptResultFixture } from "@/server/workflows/video-packaging-fixtures.test-helper";

/**
 * Product-doctrine conformance for CHANNEL_VIDEO_PACKAGING.
 *
 * `docs/PRODUCT_DOCTRINE.md` is a binding constraint: Channelwright is the AI
 * operating system for a YouTube media business, not AI YouTube automation.
 * Packaging is the distribution-direction artifact, so these assertions keep it a
 * disciplined, honest, provider-neutral packaging document rather than a
 * thumbnail generator, a title picker, or a publishing action.
 */

const packaging = videoPackagingResultFixture();
const shape = channelVideoPackagingResultSchema.shape;

describe("Video Packaging conforms to the Channelwright product doctrine", () => {
  it("keeps the exact promise the approved script made", () => {
    expect(packaging.source.packagedPromise).toBe(scriptResultFixture.source.scriptedPromise);
    expect(packaging.source.packagedPromise.length).toBeGreaterThanOrEqual(20);
  });

  it("offers title candidates only and never a selection", () => {
    expect(packaging.titleCandidates.length).toBeGreaterThanOrEqual(3);
    const keys = Object.keys(shape);
    for (const forbidden of ["selectedTitle", "chosenTitle", "finalTitle", "title"]) {
      expect(keys).not.toContain(forbidden);
    }
    // Each candidate is judged for deception so misleading packaging can be rejected.
    for (const candidate of packaging.titleCandidates) expect(candidate.deceptionRisk).toBeDefined();
  });

  it("produces thumbnail concepts, never a generated image or media asset", () => {
    expect(packaging.thumbnailConcepts.length).toBeGreaterThanOrEqual(2);
    const candidateKeys = JSON.stringify(Object.keys(shape));
    for (const forbidden of ["thumbnailImage", "generatedThumbnail", "thumbnailUrl", "renderJob", "mediaAsset"]) {
      expect(candidateKeys).not.toContain(forbidden);
    }
    for (const concept of packaging.thumbnailConcepts) expect(concept.visualIntent.length).toBeGreaterThan(0);
  });

  it("derives chapters from the approved script's own section timing", () => {
    const starts = new Map(scriptResultFixture.sections.map((section) => [section.sectionId, section.startSeconds]));
    for (const chapter of packaging.chapters) {
      expect(starts.get(chapter.sourceScriptSectionId)).toBe(chapter.startSeconds);
    }
    // A chapter must begin at 0 seconds, as YouTube requires.
    expect([...packaging.chapters].sort((a, b) => a.startSeconds - b.startSeconds)[0].startSeconds).toBe(0);
  });

  it("re-runs the Viewer Value gate at this stage and inherits provenance from the script", () => {
    expect(packaging.packagingScope.inheritedViewerValueProvenance.contractHash).toMatch(/^[a-f0-9]{64}$/);
    expect(packaging.packagingScope.inheritedViewerValueProvenance.originStage).toBe("SCRIPT");
    expect(packaging.viewerValue.gate).toBeDefined();
    expect(packaging.viewerValue.gateReasons.length).toBeGreaterThan(0);
  });

  it("stays anchored to the whole approved upstream chain", () => {
    expect(packaging.upstreamVideoScript.scriptRunId).toBeTruthy();
    expect(packaging.upstreamVideoScript.upstreamVideoBrief.briefRunId).toBeTruthy();
    expect(packaging.upstreamVideoScript.upstreamVideoBrief.upstreamContentIntelligence.contentRunId).toBeTruthy();
  });

  it("cannot represent a performance, revenue, or reach prediction", () => {
    const keys = JSON.stringify(Object.keys(shape));
    for (const forbidden of ["predictedViews", "expectedViews", "projectedRevenue", "estimatedRpm", "searchVolume", "retentionPercent", "watchTime"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("does not carry any downstream production or publishing artifact", () => {
    const keys = Object.keys(shape);
    for (const forbidden of ["uploadPlan", "publishAt", "scheduledFor", "renderJob", "oauthToken", "storyboard", "generatedAudio", "generatedVideo"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("preserves a durable decision record for later stages to inherit", () => {
    expect(packaging.modelProvenance.length).toBeGreaterThan(0);
    for (const entry of packaging.modelProvenance) {
      expect(entry.provider).toBeTruthy();
      expect(entry.model).toBeTruthy();
      expect(entry.invokedAt).toBeTruthy();
    }
    expect(packaging.assumptions.length).toBeGreaterThan(0);
    expect(packaging.openQuestions.length).toBeGreaterThan(0);
    expect(packaging.recommendedNextAction.length).toBeGreaterThan(10);
  });
});
