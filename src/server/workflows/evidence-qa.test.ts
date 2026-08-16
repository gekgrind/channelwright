import { describe, expect, it } from "vitest";
import { expectedEvidenceUrl, hasConsistentEvidenceIdentity, mergeSemanticQAFindings } from "./evidence-qa";

describe("shared evidence identity and QA merging", () => {
  it("derives canonical YouTube URLs per source type", () => {
    expect(expectedEvidenceUrl({ sourceType: "video", sourceId: "abc" })).toBe("https://www.youtube.com/watch?v=abc");
    expect(expectedEvidenceUrl({ sourceType: "channel", sourceId: "xyz" })).toBe("https://www.youtube.com/channel/xyz");
  });

  it("rejects evidence whose identity fields disagree", () => {
    const consistent = { id: "yt:video:abc", url: "https://www.youtube.com/watch?v=abc", sourceType: "video" as const, sourceId: "abc" };
    expect(hasConsistentEvidenceIdentity(consistent)).toBe(true);
    expect(hasConsistentEvidenceIdentity({ ...consistent, url: "https://example.com/abc" })).toBe(false);
    expect(hasConsistentEvidenceIdentity({ ...consistent, id: "yt:video:other" })).toBe(false);
  });

  it("drops invented evidence references, penalizes findings, and forces revision on errors", () => {
    const merged = mergeSemanticQAFindings(
      [{ severity: "warning", code: "DETERMINISTIC_WARNING", message: "Cautious.", evidenceIds: [] }],
      {
        score: 100,
        recommendation: "accept",
        findings: [{ severity: "info", code: "MODEL_NOTE", message: "Check.", evidenceIds: ["yt:video:known", "yt:video:invented"] }],
      },
      new Set(["yt:video:known"]),
      "The QA model cited an unknown evidence ID.",
    );
    expect(merged.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MODEL_NOTE", evidenceIds: ["yt:video:known"] }),
      expect.objectContaining({ code: "QA_EVIDENCE_REFERENCE_NOT_FOUND", severity: "error", message: "The QA model cited an unknown evidence ID." }),
    ]));
    expect(merged.errors).toBe(1);
    expect(merged.warnings).toBe(1);
    expect(merged.score).toBe(70);
    expect(merged.recommendation).toBe("revise");
  });
});
