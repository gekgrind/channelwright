import { describe, expect, it } from "vitest";
import { contentTopicScoreSchema } from "@/domain/production-workflows";
import { normalizeTopicScore } from "./content-intelligence-executor";
import { deterministicContentValidation } from "./content-validation";
import { approvedStrategyArtifactFixture, contentResultFixture, discoveryBundleFixture } from "./content-fixtures.test-helper";

const component = (dimension: "STRATEGY_ALIGNMENT" | "AUDIENCE_NEED" | "VIEWER_VALUE" | "DIFFERENTIATION" | "PRODUCTION_FEASIBILITY", score: number, weight: number) =>
  ({ dimension, score, weight, rationale: "r", basis: "EVIDENCE" as const, evidenceIds: [] });

const base = (components: ReturnType<typeof component>[]) => ({ topicId: "topic:x" as const, components, tier: "STRONG" as const });

describe("Channelwright score arbitration", () => {
  it("normalizes weights that do not sum to one, which live generators routinely produce", () => {
    // Observed live: gpt-4.1 emitted weights summing to 0.96 on every topic.
    const normalized = normalizeTopicScore(base([
      component("STRATEGY_ALIGNMENT", 9, 0.2), component("AUDIENCE_NEED", 8, 0.2),
      component("VIEWER_VALUE", 9, 0.2), component("DIFFERENTIATION", 7, 0.2),
      component("PRODUCTION_FEASIBILITY", 6, 0.16),
    ]));
    const sum = normalized.components.reduce((total, item) => total + item.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.02);
    expect(contentTopicScoreSchema.safeParse(normalized).success).toBe(true);
  });

  it("derives the weighted total from the components rather than trusting a model's arithmetic", () => {
    const normalized = normalizeTopicScore(base([
      component("STRATEGY_ALIGNMENT", 10, 0.5), component("AUDIENCE_NEED", 0, 0.5),
      component("VIEWER_VALUE", 10, 0.5), component("DIFFERENTIATION", 0, 0.5),
      component("PRODUCTION_FEASIBILITY", 10, 0.5),
    ]));
    const expected = normalized.components.reduce((total, item) => total + item.score * item.weight, 0);
    expect(Math.abs(normalized.weightedTotal - expected)).toBeLessThanOrEqual(0.05);
  });

  it("produces scores the deterministic rules accept, closing the live failure", () => {
    const scores = contentResultFixture.scores.map((score) => normalizeTopicScore({
      topicId: score.topicId,
      tier: score.tier,
      // Deliberately degraded weights, as observed from a live generator.
      components: score.components.map((item) => ({ ...item, weight: item.weight * 0.96 })),
    }));
    const findings = deterministicContentValidation({ ...contentResultFixture, scores }, approvedStrategyArtifactFixture, discoveryBundleFixture, 60_000);
    expect(findings.filter((finding) => finding.code === "SCORING_WEIGHTS_INVALID")).toEqual([]);
    expect(findings.filter((finding) => finding.code === "SCORING_ARITHMETIC_INVALID")).toEqual([]);
  });

  it("falls back to equal weights when a generator emits all-zero weights", () => {
    const normalized = normalizeTopicScore(base([
      component("STRATEGY_ALIGNMENT", 8, 0), component("AUDIENCE_NEED", 8, 0),
      component("VIEWER_VALUE", 8, 0), component("DIFFERENTIATION", 8, 0),
      component("PRODUCTION_FEASIBILITY", 8, 0),
    ]));
    expect(normalized.components.every((item) => item.weight === 0.2)).toBe(true);
    expect(normalized.weightedTotal).toBe(8);
  });

  it("keeps the deterministic rules as a backstop against a revision that reintroduces bad arithmetic", () => {
    const tampered = contentResultFixture.scores.map((score, index) => index === 0 ? { ...score, weightedTotal: 9.9 } : score);
    const findings = deterministicContentValidation({ ...contentResultFixture, scores: tampered }, approvedStrategyArtifactFixture, discoveryBundleFixture, 60_000);
    expect(findings.map((finding) => finding.code)).toContain("SCORING_ARITHMETIC_INVALID");
  });
});
