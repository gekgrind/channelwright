import { describe, expect, it } from "vitest";
import { channelStrategyResultSchema, getWorkflowDefinition, workflowStartRequestSchema } from "./production-workflows";
import { strategyResultFixture } from "@/server/workflows/strategy-fixtures.test-helper";

describe("CHANNEL_STRATEGY contracts", () => {
  it("requires an exact research workflow and run identity", () => {
    const valid = workflowStartRequestSchema.parse({ operation: "START_WORKFLOW", workflowType: "CHANNEL_STRATEGY", definitionVersion: 1, input: { researchWorkflowId: crypto.randomUUID(), researchRunId: crypto.randomUUID() } });
    expect(valid.workflowType).toBe("CHANNEL_STRATEGY");
    expect(() => workflowStartRequestSchema.parse({ operation: "START_WORKFLOW", workflowType: "CHANNEL_STRATEGY", definitionVersion: 1, input: { useLatestResearch: true } })).toThrow();
  });

  it("registers the architecture-preserving lifecycle", () => {
    expect(getWorkflowDefinition("CHANNEL_STRATEGY", 1).steps.map((step) => step.key)).toEqual([
      "validate-approved-research", "draft-strategy", "initial-strategy-qa", "bounded-strategy-revision", "final-strategy-qa", "finalize-strategy", "review-strategy",
    ]);
  });

  it("enforces unavailable observed KPI values and a typed recommendation", () => {
    expect(channelStrategyResultSchema.parse(strategyResultFixture).recommendation.decision).toBe("PROCEED_WITH_CONDITIONS");
    expect(() => channelStrategyResultSchema.parse({ ...strategyResultFixture, kpiFramework: [{ ...strategyResultFixture.kpiFramework[0], observedValue: 42 }] })).toThrow();
    expect(() => channelStrategyResultSchema.parse({ ...strategyResultFixture, recommendation: { ...strategyResultFixture.recommendation, decision: "GO_VIRAL" } })).toThrow();
  });
});
