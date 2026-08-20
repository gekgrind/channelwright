import { describe, expect, it } from "vitest";
import { channelVideoBriefResultSchema } from "./production-workflows";
import { videoBriefResultFixture } from "@/server/workflows/video-brief-fixtures.test-helper";

/**
 * Product-doctrine conformance for CHANNEL_VIDEO_BRIEF.
 *
 * `docs/PRODUCT_DOCTRINE.md` is a binding constraint: Channelwright is the AI
 * operating system for a YouTube media business, not AI YouTube automation.
 * These assertions keep the brief a business decision record rather than a
 * video-generation request, so a future change that hollows it out fails here
 * instead of silently drifting.
 */

const brief = videoBriefResultFixture();
const shape = channelVideoBriefResultSchema.shape;

describe("Video Brief conforms to the Channelwright product doctrine", () => {
  it("states who the video is for without inventing demographics", () => {
    expect(brief.viewer.primaryViewer.length).toBeGreaterThan(20);
    expect(brief.viewer.needStatement.length).toBeGreaterThan(10);
    // Doctrine: evidence before strategy. The brief must say what it does not know.
    expect(shape.viewer).toBeDefined();
    expect(brief.viewer.demographicPrecisionLimit.length).toBeGreaterThan(10);
    expect(brief.viewer.uncertainties.length).toBeGreaterThan(0);
  });

  it("records the strategic reason the video should exist", () => {
    // Doctrine: strategy before production - "Why should this video exist?"
    expect(brief.source.strategicContext.length).toBeGreaterThan(20);
    expect(brief.source.pillarName.length).toBeGreaterThan(0);
  });

  it("carries a specific, checkable viewer promise", () => {
    // Doctrine: viewer value is mandatory, and a promise must be verifiable.
    expect(brief.viewerPromise.statement.length).toBeGreaterThanOrEqual(20);
    expect(brief.viewerPromise.verifiability.length).toBeGreaterThan(10);
    expect(brief.viewerPromise.explicitNonPromises.length).toBeGreaterThan(0);
    expect(brief.viewerPromise.valueTypes.length).toBeGreaterThan(0);
  });

  it("states a differentiated contribution rather than imitating competitors", () => {
    // Doctrine: originality over imitation.
    expect(brief.originalContribution.comparedToExisting.length).toBeGreaterThan(20);
    expect(brief.originalContribution.whyMoreUseful.length).toBeGreaterThan(20);
    expect(brief.originalContribution.kinds.length).toBeGreaterThan(0);
  });

  it("stays anchored to the approved channel strategy and its research", () => {
    // Doctrine: the channel is a business asset; decisions accumulate.
    expect(brief.upstreamContentIntelligence.contentRunId).toBeTruthy();
    expect(brief.upstreamContentIntelligence.upstreamStrategy.strategyRunId).toBeTruthy();
    expect(brief.upstreamContentIntelligence.upstreamStrategy.upstreamResearch.researchRunId).toBeTruthy();
  });

  it("ties claims to Content Intelligence evidence and names what is unproven", () => {
    // Doctrine: evidence provenance is preserved and inspectable.
    expect(brief.source.sourceEvidenceIds.length).toBeGreaterThan(0);
    expect(brief.evidencePlan.items.length).toBeGreaterThan(0);
    const statuses = new Set(brief.evidencePlan.items.map((i) => i.status));
    expect(statuses.has("SUPPORTED")).toBe(true);
    // An honest brief can say "we do not know this yet".
    expect(["RESEARCH_REQUIRED", "MUST_NOT_CLAIM"].some((s) => statuses.has(s as never))).toBe(true);
  });

  it("inherits Viewer Value provenance and re-runs the gate at this stage", () => {
    expect(brief.selectedTopic.inheritedViewerValueProvenance.contractHash).toMatch(/^[a-f0-9]{64}$/);
    expect(brief.selectedTopic.inheritedViewerValueProvenance.originStage).toBe("CONTENT_INTELLIGENCE");
    expect(brief.viewerValue.gate).toBeDefined();
    expect(brief.viewerValue.gateReasons.length).toBeGreaterThan(0);
  });

  it("records explicit production constraints instead of promising output", () => {
    // Doctrine: durable operations, and human agency on irreversible steps.
    expect(brief.creativeDirection.productionComplexity).toBeDefined();
    expect(brief.creativeDirection.productionComplexityRationale.length).toBeGreaterThan(10);
    expect(brief.risks.length).toBeGreaterThan(0);
    expect(brief.recommendedNextAction.length).toBeGreaterThan(10);
  });

  it("keeps monetization a strategy question, never a revenue promise", () => {
    // Doctrine: monetization is part of strategy, balanced against trust.
    expect(brief.monetizationAlignment.viewerValueImpact).toBeDefined();
    expect(brief.monetizationAlignment.rationale.length).toBeGreaterThan(10);
    // NONE must remain a legitimate answer.
    expect(channelVideoBriefResultSchema.safeParse({
      ...brief, monetizationAlignment: { ...brief.monetizationAlignment, relevance: "NONE" },
    }).success).toBe(true);
  });

  it("cannot represent a performance, revenue, or reach prediction", () => {
    // Doctrine: Channelwright is not a content mill chasing volume metrics.
    const keys = JSON.stringify(Object.keys(shape));
    for (const forbidden of ["predictedViews", "expectedViews", "projectedRevenue", "estimatedRpm", "searchVolume", "retentionPercent", "watchTime"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("does not carry any downstream production artifact", () => {
    // Doctrine boundary: this stage approves direction, not output. Packaging,
    // script, storyboard, media, and publishing remain separate decisions.
    const keys = Object.keys(shape);
    for (const forbidden of ["title", "titles", "thumbnail", "script", "storyboard", "voiceover", "uploadPlan", "publishAt", "scheduledFor"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("preserves a durable decision record for later stages to inherit", () => {
    // Doctrine: learn across time. The artifact must be auditable after the fact.
    expect(brief.modelProvenance.length).toBeGreaterThan(0);
    for (const entry of brief.modelProvenance) {
      expect(entry.provider).toBeTruthy();
      expect(entry.model).toBeTruthy();
      expect(entry.invokedAt).toBeTruthy();
    }
    expect(brief.assumptions.length).toBeGreaterThan(0);
    expect(brief.openQuestions.length).toBeGreaterThan(0);
  });
});
