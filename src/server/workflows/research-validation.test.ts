import { describe, expect, it } from "vitest";
import { deterministicResearchValidation, mergeResearchQA } from "./research-validation";
import { evidenceFixture, resultFixture } from "./research-fixtures.test-helper";

describe("research validation and QA", () => {
  it("rejects nonexistent evidence references", () => {
    const result = { ...resultFixture, recommendation: { ...resultFixture.recommendation, evidenceIds: ["yt:video:missing"] } };
    expect(deterministicResearchValidation(result, [evidenceFixture], new Date("2026-08-13T12:00:00Z"))).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error", code: "EVIDENCE_REFERENCE_NOT_FOUND" })]));
  });

  it("detects a strong hundred-video verdict that contradicts topic depth", () => {
    const result = { ...resultFixture, viability: { ...resultFixture.viability, hundredVideoPotential: { ...resultFixture.viability.hundredVideoPotential, verdict: "strong" as const } }, contentPotential: { ...resultFixture.contentPotential, estimatedTopicDepth: 60 } };
    expect(deterministicResearchValidation(result, [evidenceFixture], new Date("2026-08-13T12:00:00Z"))).toEqual(expect.arrayContaining([expect.objectContaining({ code: "TOPIC_DEPTH_CONTRADICTION" })]));
  });

  it("does not trust evidence IDs invented by the independent QA model", () => {
    const qa = mergeResearchQA([], { score: 95, recommendation: "accept", findings: [{ severity: "warning", code: "MODEL_NOTE", message: "Check this source.", evidenceIds: ["yt:video:invented"] }] }, { model: "test", inputTokens: 10, outputTokens: 5, totalTokens: 15 }, [evidenceFixture]);
    expect(qa.passed).toBe(false);
    expect(qa.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "QA_EVIDENCE_REFERENCE_NOT_FOUND" })]));
  });

  it("rejects confidence and coverage metadata that exceed the retrieved sample", () => {
    const result = {
      ...resultFixture,
      evidenceSummary: { ...resultFixture.evidenceSummary, representativeVideosObserved: 8, independentChannelsObserved: 4 },
      recommendation: { ...resultFixture.recommendation, confidence: "high" as const },
    };
    const findings = deterministicResearchValidation(result, [evidenceFixture], new Date("2026-08-13T12:00:00Z"));
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "EVIDENCE_COVERAGE_MISMATCH", severity: "error" }),
      expect.objectContaining({ code: "CONFIDENCE_EXCEEDS_COVERAGE", severity: "error" }),
    ]));
  });
});
