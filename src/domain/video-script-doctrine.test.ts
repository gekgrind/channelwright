import { describe, expect, it } from "vitest";
import { channelVideoScriptResultSchema } from "./production-workflows";
import { videoScriptResultFixture } from "@/server/workflows/video-script-fixtures.test-helper";

/**
 * Product-doctrine conformance for CHANNEL_VIDEO_SCRIPT.
 *
 * `docs/PRODUCT_DOCTRINE.md` is a binding constraint: Channelwright is the AI
 * operating system for a YouTube media business, not AI YouTube automation. The
 * script is the first concrete production artifact, so these assertions keep it a
 * disciplined, evidence-traceable production document rather than a media-
 * generation request or a volume play.
 */

const script = videoScriptResultFixture();
const shape = channelVideoScriptResultSchema.shape;

describe("Video Script conforms to the Channelwright product doctrine", () => {
  it("keeps the exact promise the approved brief made", () => {
    expect(script.source.scriptedPromise.length).toBeGreaterThanOrEqual(20);
    // Doctrine: decisions accumulate; the script may not silently redefine value.
    expect(script.scriptScope.briefTopicId).toBeTruthy();
  });

  it("maps every script section to the approved brief content architecture", () => {
    expect(script.sections.length).toBeGreaterThanOrEqual(3);
    for (const section of script.sections) {
      expect(section.briefBeatId).toMatch(/^beat:/);
      expect(section.narration.length).toBeGreaterThan(0);
    }
    expect(script.source.coveredBriefBeatIds.length).toBeGreaterThan(0);
  });

  it("is structured and timed", () => {
    expect(script.timing.totalDurationSeconds).toBeGreaterThan(0);
    const sum = script.sections.reduce((total, section) => total + section.durationSeconds, 0);
    expect(sum).toBe(script.timing.totalDurationSeconds);
    expect(script.openingHook.spokenOpening.length).toBeGreaterThan(0);
  });

  it("inherits evidence-plan status and never asserts an unproven claim as fact", () => {
    // Doctrine: evidence provenance is preserved; unproven claims stay unproven.
    const statuses = new Set(script.claimUsage.map((usage) => usage.inheritedStatus));
    expect(statuses.has("SUPPORTED")).toBe(true);
    // A must-not-claim claim is tracked as omitted; a research-required claim is
    // never asserted as fact.
    for (const usage of script.claimUsage) {
      if (usage.inheritedStatus === "MUST_NOT_CLAIM") expect(usage.treatment).toBe("OMITTED");
      if (usage.inheritedStatus === "RESEARCH_REQUIRED") expect(usage.treatment).not.toBe("ASSERTED_AS_FACT");
    }
    expect(script.evidenceDiscipline.mustNotClaimOmitted.length).toBeGreaterThan(0);
  });

  it("inherits Viewer Value provenance from the brief and re-runs the gate at this stage", () => {
    expect(script.scriptScope.inheritedViewerValueProvenance.contractHash).toMatch(/^[a-f0-9]{64}$/);
    expect(script.scriptScope.inheritedViewerValueProvenance.originStage).toBe("VIDEO_BRIEF");
    expect(script.viewerValue.gate).toBeDefined();
    expect(script.viewerValue.gateReasons.length).toBeGreaterThan(0);
  });

  it("stays anchored to the whole approved upstream chain", () => {
    expect(script.upstreamVideoBrief.briefRunId).toBeTruthy();
    expect(script.upstreamVideoBrief.upstreamContentIntelligence.contentRunId).toBeTruthy();
    expect(script.upstreamVideoBrief.upstreamContentIntelligence.upstreamStrategy.strategyRunId).toBeTruthy();
  });

  it("cannot represent a performance, revenue, or reach prediction", () => {
    const keys = JSON.stringify(Object.keys(shape));
    for (const forbidden of ["predictedViews", "expectedViews", "projectedRevenue", "estimatedRpm", "searchVolume", "retentionPercent", "watchTime"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("does not carry any downstream production artifact beyond the script", () => {
    // Doctrine boundary: the script is written here; titles, thumbnails, generated
    // media, storyboards, and publishing remain separate decisions.
    const keys = Object.keys(shape);
    for (const forbidden of ["title", "titles", "thumbnail", "storyboard", "shotList", "renderJob", "uploadPlan", "publishAt", "scheduledFor", "generatedAudio", "generatedVideo"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("preserves a durable decision record for later stages to inherit", () => {
    expect(script.modelProvenance.length).toBeGreaterThan(0);
    for (const entry of script.modelProvenance) {
      expect(entry.provider).toBeTruthy();
      expect(entry.model).toBeTruthy();
      expect(entry.invokedAt).toBeTruthy();
    }
    expect(script.assumptions.length).toBeGreaterThan(0);
    expect(script.openQuestions.length).toBeGreaterThan(0);
    expect(script.recommendedNextAction.length).toBeGreaterThan(10);
  });
});
