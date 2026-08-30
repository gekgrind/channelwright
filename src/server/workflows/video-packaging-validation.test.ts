import { describe, expect, it } from "vitest";
import { deterministicVideoPackagingValidation } from "./video-packaging-validation";
import { approvedVideoScriptArtifactFixture, videoPackagingResultFixture } from "./video-packaging-fixtures.test-helper";

const MAX = 60_000;
const codes = (result: unknown) => new Set(deterministicVideoPackagingValidation(result, approvedVideoScriptArtifactFixture, MAX).filter((f) => f.severity === "error").map((f) => f.code));

describe("deterministic video packaging validation", () => {
  it("passes the clean fixture with no error findings", () => {
    expect([...codes(videoPackagingResultFixture())]).toEqual([]);
  });

  it("rejects a packaged promise that diverges from the approved script promise", () => {
    const result = videoPackagingResultFixture({ source: { ...videoPackagingResultFixture().source, packagedPromise: "A totally different promise the script never made at all." } });
    expect(codes(result)).toContain("PACKAGED_PROMISE_DIVERGES");
  });

  it("rejects a title candidate carrying a material deception risk (MISLEADING_PACKAGING guard)", () => {
    const base = videoPackagingResultFixture();
    const result = videoPackagingResultFixture({ titleCandidates: base.titleCandidates.map((c, i) => i === 0 ? { ...c, deceptionRisk: "material" as const } : c) });
    expect(codes(result)).toContain("MISLEADING_TITLE");
  });

  it("rejects a thumbnail concept carrying a material deception risk", () => {
    const base = videoPackagingResultFixture();
    const result = videoPackagingResultFixture({ thumbnailConcepts: base.thumbnailConcepts.map((c, i) => i === 0 ? { ...c, deceptionRisk: "material" as const } : c) });
    expect(codes(result)).toContain("MISLEADING_THUMBNAIL");
  });

  it("rejects a chapter whose timing is not derived from the approved script", () => {
    const base = videoPackagingResultFixture();
    const result = videoPackagingResultFixture({ chapters: base.chapters.map((c, i) => i === 1 ? { ...c, startSeconds: 99 } : c) });
    expect(codes(result)).toContain("CHAPTER_TIMING_NOT_DERIVED");
  });

  it("rejects chapters that do not begin at zero seconds", () => {
    const base = videoPackagingResultFixture();
    // Drop the opening chapter so the earliest chapter no longer starts at 0.
    const result = videoPackagingResultFixture({ chapters: base.chapters.filter((c) => c.startSeconds !== 0) });
    expect(codes(result)).toContain("CHAPTERS_DO_NOT_START_AT_ZERO");
  });

  it("rejects a chapter mapped to a script section that does not exist", () => {
    const base = videoPackagingResultFixture();
    const result = videoPackagingResultFixture({ chapters: base.chapters.map((c, i) => i === 2 ? { ...c, sourceScriptSectionId: "scriptsec:ghost" } : c) });
    expect(codes(result)).toContain("CHAPTER_SECTION_UNKNOWN");
  });

  it("rejects selecting a single title (candidates only)", () => {
    const result = videoPackagingResultFixture({ recommendedNextAction: "We recommend the title from candidate one and proceed to production." });
    expect(codes(result)).toContain("TITLE_SELECTION_SCOPE_VIOLATION");
  });

  it("rejects generating a thumbnail image", () => {
    const result = videoPackagingResultFixture({ recommendedNextAction: "Generate the thumbnail image from concept one, then proceed." });
    expect(codes(result)).toContain("THUMBNAIL_GENERATION_SCOPE_VIOLATION");
  });

  it("rejects an upload or publish action", () => {
    const result = videoPackagingResultFixture({ recommendedNextAction: "Upload the video to the YouTube channel once approved." });
    expect(codes(result)).toContain("PUBLISHING_SCOPE_VIOLATION");
  });

  it("rejects a render-worker instruction", () => {
    const result = videoPackagingResultFixture({ recommendedNextAction: "Queue a render job on the render worker after approval." });
    expect(codes(result)).toContain("RENDER_WORKER_SCOPE_VIOLATION");
  });

  it("rejects an altered inherited viewer-value provenance", () => {
    const base = videoPackagingResultFixture();
    const result = videoPackagingResultFixture({
      packagingScope: { ...base.packagingScope, inheritedViewerValueProvenance: { ...base.packagingScope.inheritedViewerValueProvenance, contractHash: "0".repeat(64) } },
    });
    const set = codes(result);
    expect(set.has("VIEWER_VALUE_PROVENANCE_ALTERED") || set.has("PACKAGING_SCOPE_IDENTITY_CHANGED")).toBe(true);
  });
});
