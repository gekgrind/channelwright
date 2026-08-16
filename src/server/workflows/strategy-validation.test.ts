import { describe, expect, it } from "vitest";
import type { ApprovedResearchArtifact } from "@/domain/production-workflows";
import { deterministicStrategyValidation, mergeStrategyQA } from "./strategy-validation";
import { approvedResearchArtifactFixture, strategyResultFixture } from "./strategy-fixtures.test-helper";

const usage = { model: "strategy-test", inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const codes = (result: unknown, upstream: ApprovedResearchArtifact = approvedResearchArtifactFixture) =>
  deterministicStrategyValidation(result, upstream).map((item) => item.code);

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

  it("accepts a reordered upstream reference so key order alone is never tampering", () => {
    const reordered = Object.fromEntries(Object.entries(strategyResultFixture.upstreamResearch).reverse());
    expect(codes({ ...strategyResultFixture, upstreamResearch: reordered })).not.toContain("UPSTREAM_RESEARCH_REFERENCE_CHANGED");
  });

  it("requires evidence behind every major strategic conclusion", () => {
    expect(codes({ ...strategyResultFixture, targetAudience: { ...strategyResultFixture.targetAudience, primary: { ...strategyResultFixture.targetAudience.primary, evidenceIds: [] } } })).toContain("AUDIENCE_SUPPORT_MISSING");
    expect(codes({ ...strategyResultFixture, positioning: { ...strategyResultFixture.positioning, positioningStatement: { ...strategyResultFixture.positioning.positioningStatement, evidenceIds: [] } } })).toContain("POSITIONING_SUPPORT_MISSING");
    expect(codes({ ...strategyResultFixture, positioning: { ...strategyResultFixture.positioning, differentiation: { ...strategyResultFixture.positioning.differentiation, evidenceIds: [] } } })).toContain("DIFFERENTIATION_SUPPORT_MISSING");
    expect(codes({ ...strategyResultFixture, recommendation: { ...strategyResultFixture.recommendation, evidenceIds: [] } })).toContain("RECOMMENDATION_SUPPORT_MISSING");
  });

  it("rejects a content pillar disconnected from approved research", () => {
    const pillars = strategyResultFixture.contentPillars.map((pillar, index) => index === 1 ? { ...pillar, evidenceIds: [] } : pillar);
    expect(codes({ ...strategyResultFixture, contentPillars: pillars })).toContain("CONTENT_PILLAR_SUPPORT_MISSING");
  });

  it("downgrades an unsupported monetization path to a warning rather than an error", () => {
    const monetization = strategyResultFixture.monetizationArchitecture.map((item) => ({ ...item, evidenceIds: [] }));
    const findings = deterministicStrategyValidation({ ...strategyResultFixture, monetizationArchitecture: monetization }, approvedResearchArtifactFixture);
    const monetizationFinding = findings.find((item) => item.code === "MONETIZATION_HYPOTHESIS_UNSUPPORTED");
    expect(monetizationFinding?.severity).toBe("warning");
    expect(findings.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("rejects confidence that exceeds the bounded upstream research QA state", () => {
    const reference = { ...approvedResearchArtifactFixture.reference, finalQaScore: 70 };
    const upstream = { ...approvedResearchArtifactFixture, reference };
    const overconfident = { ...strategyResultFixture, upstreamResearch: reference, recommendation: { ...strategyResultFixture.recommendation, confidence: "high" as const } };
    expect(codes(overconfident, upstream)).toContain("CONFIDENCE_EXCEEDS_RESEARCH_QA");
    const measured = { ...overconfident, recommendation: { ...strategyResultFixture.recommendation, confidence: "medium" as const } };
    expect(codes(measured, upstream)).not.toContain("CONFIDENCE_EXCEEDS_RESEARCH_QA");
  });

  it("detects upstream evidence whose identity no longer matches its canonical URL", () => {
    const [first, ...rest] = approvedResearchArtifactFixture.evidenceBundle.evidence;
    const tampered = { ...approvedResearchArtifactFixture, evidenceBundle: { ...approvedResearchArtifactFixture.evidenceBundle, evidence: [{ ...first, url: "https://www.youtube.com/watch?v=someone-elses-id" }, ...rest] } };
    expect(codes(strategyResultFixture, tampered)).toContain("EVIDENCE_IDENTITY_MISMATCH");
  });

  it("makes fabricated KPI baselines unrepresentable at the schema boundary", () => {
    // The typed contract pins baselineState/observedValue/targetIsHypothesis, so a
    // fabricated metric fails validation outright instead of becoming a QA finding.
    const fabricated = { ...strategyResultFixture, kpiFramework: [{ ...strategyResultFixture.kpiFramework[0], baselineState: "MEASURED", observedValue: 42, targetIsHypothesis: false }] };
    expect(() => deterministicStrategyValidation(fabricated, approvedResearchArtifactFixture)).toThrow();
  });

  it("makes missing uncertainty disclosure unrepresentable at the schema boundary", () => {
    const undisclosed = { ...strategyResultFixture, assumptionsAndUncertainties: { ...strategyResultFixture.assumptionsAndUncertainties, evidenceGaps: [], confidenceLimitations: [] } };
    expect(() => deterministicStrategyValidation(undisclosed, approvedResearchArtifactFixture)).toThrow();
  });
});

describe("merged CHANNEL_STRATEGY QA", () => {
  it("accepts a clean strategy when both layers agree", () => {
    const merged = mergeStrategyQA([], { score: 92, findings: [], recommendation: "accept" }, usage, approvedResearchArtifactFixture);
    expect(merged).toMatchObject({ passed: true, score: 92, recommendation: "accept", deterministicChecksFailed: 0 });
  });

  it("forces revision whenever any deterministic error survives, overriding the model", () => {
    const deterministic = deterministicStrategyValidation({ ...strategyResultFixture, recommendation: { ...strategyResultFixture.recommendation, evidenceIds: [] } }, approvedResearchArtifactFixture);
    const merged = mergeStrategyQA(deterministic, { score: 99, findings: [], recommendation: "accept" }, usage, approvedResearchArtifactFixture);
    expect(merged.recommendation).toBe("revise");
    expect(merged.passed).toBe(false);
    expect(merged.score).toBeLessThanOrEqual(75);
  });

  it("strips and flags QA findings that cite evidence outside the approved bundle", () => {
    const merged = mergeStrategyQA([], { score: 90, findings: [{ severity: "warning", code: "SOMETHING", message: "m", evidenceIds: ["yt:video:not-approved"] }], recommendation: "accept" }, usage, approvedResearchArtifactFixture);
    expect(merged.findings.map((item) => item.code)).toContain("QA_EVIDENCE_REFERENCE_NOT_FOUND");
    expect(merged.findings.find((item) => item.code === "SOMETHING")?.evidenceIds).toEqual([]);
    expect(merged.passed).toBe(false);
  });

  it("keeps a warning-only strategy below the automatic-accept score ceiling", () => {
    const merged = mergeStrategyQA([{ severity: "warning", code: "MONETIZATION_HYPOTHESIS_UNSUPPORTED", message: "m", evidenceIds: [] }], { score: 100, findings: [], recommendation: "accept" }, usage, approvedResearchArtifactFixture);
    expect(merged.score).toBe(95);
    expect(merged.passed).toBe(true);
  });

  it("never reports a negative score", () => {
    const many = Array.from({ length: 10 }, () => ({ severity: "error" as const, code: "BAD_THING", message: "m", evidenceIds: [] }));
    expect(mergeStrategyQA(many, { score: 10, findings: [], recommendation: "revise" }, usage, approvedResearchArtifactFixture).score).toBe(0);
  });
});
