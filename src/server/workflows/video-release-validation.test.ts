import { describe, expect, it } from "vitest";
import { deterministicVideoReleaseValidation } from "./video-release-validation";
import { approvedVideoPackagingArtifactFixture, videoReleaseResultFixture, RELEASE_STRATEGY_RUN_ID } from "./video-release-fixtures.test-helper";

const MAX = 60_000;
const codes = (result: unknown) => new Set(deterministicVideoReleaseValidation(result, approvedVideoPackagingArtifactFixture, MAX).filter((f) => f.severity === "error").map((f) => f.code));

describe("deterministic video release validation", () => {
  it("passes the clean fixture with no error findings", () => {
    expect([...codes(videoReleaseResultFixture())]).toEqual([]);
  });

  it("rejects a release promise that diverges from the approved packaging promise", () => {
    const result = videoReleaseResultFixture({ source: { ...videoReleaseResultFixture().source, releasePromise: "A totally different promise the packaging never made at all." } });
    expect(codes(result)).toContain("RELEASE_PROMISE_DIVERGES");
  });

  it("rejects a selected title that is not one of the approved candidates", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({ titleDecision: { ...base.titleDecision, selectedCandidateId: "title:not-a-candidate" } });
    expect(codes(result)).toContain("TITLE_NOT_A_CANDIDATE");
  });

  it("rejects a selected title whose text was altered from the approved candidate", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({
      titleDecision: { ...base.titleDecision, selectedTitleText: "A silently reworded title" },
      reconciledMetadata: { ...base.reconciledMetadata, finalTitle: "A silently reworded title" },
    });
    expect(codes(result)).toContain("TITLE_TEXT_ALTERED");
  });

  it("rejects a reconciled final title that does not match the selected title", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({ reconciledMetadata: { ...base.reconciledMetadata, finalTitle: "A different final title entirely" } });
    expect(codes(result)).toContain("RECONCILED_TITLE_MISMATCH");
  });

  it("rejects a selected thumbnail that is not one of the approved concepts", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({ thumbnailDecision: { ...base.thumbnailDecision, selectedConceptId: "thumb:not-a-concept" } });
    expect(codes(result)).toContain("THUMBNAIL_NOT_A_CANDIDATE");
  });

  it("rejects a selection recorded with a material deception risk (guard re-run)", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({ titleDecision: { ...base.titleDecision, deceptionRisk: "material" } });
    expect(codes(result)).toContain("MISLEADING_RELEASE_SELECTION");
  });

  it("rejects a failed misleading-guard outcome", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({ releaseIntegrity: { ...base.releaseIntegrity, misleadingGuardOutcome: "FAIL" } });
    expect(codes(result)).toContain("MISLEADING_GUARD_FAILED");
  });

  it("rejects a KPI binding anchored to a strategy the release does not descend from", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({
      kpiHypothesisBindings: base.kpiHypothesisBindings.map((binding, index) => index === 0 ? { ...binding, strategyRunId: "00000000-0000-4000-8000-000000000000" } : binding),
    });
    expect(codes(result)).toContain("KPI_STRATEGY_IDENTITY_MISMATCH");
  });

  it("accepts KPI bindings anchored to the exact upstream strategy identity", () => {
    const result = videoReleaseResultFixture();
    for (const binding of result.kpiHypothesisBindings) expect(binding.strategyRunId).toBe(RELEASE_STRATEGY_RUN_ID);
    expect(codes(result).has("KPI_STRATEGY_IDENTITY_MISMATCH")).toBe(false);
  });

  it("rejects reconciled chapters that were altered from the approved packaging", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({
      reconciledMetadata: { ...base.reconciledMetadata, chapters: base.reconciledMetadata.chapters.map((c, i) => i === 1 ? { ...c, startSeconds: 99 } : c) },
    });
    expect(codes(result)).toContain("CHAPTER_ALTERED");
  });

  it("rejects reconciled tags absent from the approved packaging", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({ reconciledMetadata: { ...base.reconciledMetadata, tags: [...base.reconciledMetadata.tags, "an-invented-tag"] } });
    expect(codes(result)).toContain("TAGS_NOT_DERIVED");
  });

  it("rejects an inverted publish window", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({ publishWindow: { ...base.publishWindow, earliest: "2026-09-05T13:00:00.000Z", latest: "2026-09-01T13:00:00.000Z" } });
    expect(codes(result)).toContain("PUBLISH_WINDOW_INVERTED");
  });

  it("rejects a provider OAuth authorization action", () => {
    const result = videoReleaseResultFixture({ recommendedNextAction: "Authorize the YouTube channel via OAuth, then upload." });
    expect(codes(result)).toContain("OAUTH_SCOPE_VIOLATION");
  });

  it("rejects an upload/publish-through-the-API execution action", () => {
    const result = videoReleaseResultFixture({ recommendedNextAction: "Publish the video through the YouTube Data API immediately." });
    const set = codes(result);
    expect(set.has("PUBLISH_EXECUTION_SCOPE_VIOLATION") || set.has("OAUTH_SCOPE_VIOLATION")).toBe(true);
  });

  it("rejects a cross-platform recut generation action", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({
      distributionSurfaces: base.distributionSurfaces.map((surface, index) => index === 0 ? { ...surface, intent: "Generate a vertical cut for Shorts from the master." } : surface),
    });
    expect(codes(result)).toContain("RECUT_GENERATION_SCOPE_VIOLATION");
  });

  it("rejects a performance-ingestion action", () => {
    const result = videoReleaseResultFixture({ recommendedNextAction: "Ingest the actual views and retention data after launch." });
    expect(codes(result)).toContain("PERFORMANCE_INGESTION_SCOPE_VIOLATION");
  });

  it("rejects an altered inherited viewer-value provenance", () => {
    const base = videoReleaseResultFixture();
    const result = videoReleaseResultFixture({
      releaseScope: { ...base.releaseScope, inheritedViewerValueProvenance: { ...base.releaseScope.inheritedViewerValueProvenance, contractHash: "0".repeat(64) } },
    });
    const set = codes(result);
    expect(set.has("VIEWER_VALUE_PROVENANCE_ALTERED") || set.has("RELEASE_SCOPE_IDENTITY_CHANGED")).toBe(true);
  });
});
