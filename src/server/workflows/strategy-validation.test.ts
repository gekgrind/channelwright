import { describe, expect, it } from "vitest";
import { deterministicStrategyValidation } from "./strategy-validation";
import { approvedResearchArtifactFixture, strategyResultFixture } from "./strategy-fixtures.test-helper";

describe("deterministic CHANNEL_STRATEGY QA", () => {
  it("accepts a bounded evidence-traceable strategy contract", () => {
    expect(deterministicStrategyValidation(strategyResultFixture, approvedResearchArtifactFixture).filter((item) => item.severity === "error")).toEqual([]);
  });

  it("rejects invented evidence and a changed upstream reference", () => {
    const invalid = {
      ...strategyResultFixture,
      upstreamResearch: { ...strategyResultFixture.upstreamResearch, researchArtifactHash: "c".repeat(64) },
      recommendation: { ...strategyResultFixture.recommendation, evidenceIds: ["yt:video:not-approved"] },
    };
    expect(deterministicStrategyValidation(invalid, approvedResearchArtifactFixture).map((item) => item.code)).toEqual(expect.arrayContaining(["UPSTREAM_RESEARCH_REFERENCE_CHANGED", "EVIDENCE_REFERENCE_NOT_FOUND"]));
  });

  it("rejects fabricated revenue, demographics, and downstream content artifacts", () => {
    const invalid = {
      ...strategyResultFixture,
      targetAudience: { ...strategyResultFixture.targetAudience, demographicPrecisionLimit: "Primary viewers are ages 25-34." },
      strategicObjectives: { ...strategyResultFixture.strategicObjectives, monetization: ["Target $10,000 monthly revenue and create a video title calendar."] },
    };
    expect(deterministicStrategyValidation(invalid, approvedResearchArtifactFixture).map((item) => item.code)).toEqual(expect.arrayContaining(["FABRICATED_REVENUE_ESTIMATE", "INVENTED_DEMOGRAPHIC_PRECISION", "DOWNSTREAM_ARTIFACT_SCOPE_VIOLATION"]));
  });
});
