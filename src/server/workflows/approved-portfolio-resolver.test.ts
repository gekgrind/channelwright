import { describe, expect, it } from "vitest";
import { videoIntelligenceScopeSchema } from "@/domain/production-workflows";
import { buildIntelligenceScope } from "./approved-portfolio-resolver";
import {
  buildApprovedPortfolioArtifact,
  buildApprovedPortfolioSet,
  fixtureUuid,
} from "./video-intelligence-fixtures.test-helper";

describe("intelligence scope projection", () => {
  const artifacts = [buildApprovedPortfolioArtifact(0), buildApprovedPortfolioArtifact(1)];

  it("derives every scope fact from a server-authoritative cycle projection", () => {
    const scope = buildIntelligenceScope(artifacts);
    expect(videoIntelligenceScopeSchema.safeParse(scope).success).toBe(true);
    expect(scope.cycles).toHaveLength(2);
    expect(scope.facts.every((fact) => fact.sourceRef.startsWith("portfolio:"))).toBe(true);
    const committedFact = scope.facts.find((fact) => fact.key === `fact:${artifacts[0].cycle.cycleId}:committed-count`);
    expect(committedFact?.value).toBe(artifacts[0].cycle.committedCount);
  });

  it("carries exactly three artifact identities per cycle: the two channel anchors plus the allocation itself", () => {
    const scope = buildIntelligenceScope(artifacts);
    for (const [index, cycle] of scope.cycles.entries()) {
      expect(cycle.artifacts.map((artifact) => artifact.workflowType).sort()).toEqual(["CHANNEL_RESEARCH", "CHANNEL_STRATEGY", "CHANNEL_VIDEO_PORTFOLIO"]);
      expect(cycle.artifacts.find((artifact) => artifact.workflowType === "CHANNEL_VIDEO_PORTFOLIO")?.runId).toBe(artifacts[index].cycle.portfolioRunId);
    }
  });

  it("rejects a scope whose cycles descend from different approved strategies", () => {
    const mixed = [buildApprovedPortfolioArtifact(0), buildApprovedPortfolioArtifact(1, { strategyRunId: fixtureUuid(999) })];
    expect(() => buildIntelligenceScope(mixed)).toThrow();
  });

  it("rejects a scope carrying the same portfolio run twice", () => {
    expect(() => buildIntelligenceScope([artifacts[0], artifacts[0]])).toThrow();
  });

  it("rejects a scope whose portfolio artifact does not identify its own cycle", () => {
    const scope = buildIntelligenceScope(artifacts);
    const broken = {
      ...scope,
      cycles: [
        { ...scope.cycles[0], artifacts: scope.cycles[0].artifacts.map((artifact) => artifact.workflowType === "CHANNEL_VIDEO_PORTFOLIO" ? { ...artifact, runId: fixtureUuid(4242) } : artifact) },
        scope.cycles[1],
      ],
    };
    expect(videoIntelligenceScopeSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a horizon shorter than two cycles at the set boundary", () => {
    expect(() => buildApprovedPortfolioSet([artifacts[0]])).toThrow();
  });

  it("rejects a horizon longer than four cycles at the set boundary", () => {
    expect(() => buildApprovedPortfolioSet(Array.from({ length: 5 }, (_, index) => buildApprovedPortfolioArtifact(index)))).toThrow();
  });

  it("requires the projected commitments to cover exactly the allocation's committed count", () => {
    expect(() => buildApprovedPortfolioSet([
      buildApprovedPortfolioArtifact(0, { committedCount: 5 }),
      buildApprovedPortfolioArtifact(1),
    ])).toThrow();
  });
});
