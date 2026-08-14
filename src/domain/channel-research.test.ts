import { describe, expect, it } from "vitest";
import { channelResearchInputSchema, channelResearchResultSchema, getWorkflowDefinition, workflowApprovalDecisionSchema, workflowStartRequestSchema } from "./production-workflows";
import { resultFixture } from "@/server/workflows/research-fixtures.test-helper";

describe("CHANNEL_RESEARCH contract", () => {
  it("accepts an existing concept without replacing it with a required niche", () => {
    expect(channelResearchInputSchema.parse({ channelConcept: "Faceless investigations of hidden business systems" })).toMatchObject({ channelConcept: expect.stringContaining("hidden business") });
  });

  it("requires a concept or niche and keeps the start union typed", () => {
    expect(channelResearchInputSchema.safeParse({ goals: ["Growth"] }).success).toBe(false);
    expect(workflowStartRequestSchema.safeParse({ operation: "START_WORKFLOW", workflowType: "CHANNEL_RESEARCH", definitionVersion: 1, input: { channelConcept: "too short" } }).success).toBe(false);
  });

  it("runtime-validates the complete strategic result", () => {
    expect(channelResearchResultSchema.parse(resultFixture).viability.audienceDemand.verdict).toBe("moderate");
    expect(channelResearchResultSchema.safeParse({ ...resultFixture, recommendation: { ...resultFixture.recommendation, verdict: "guaranteed" } }).success).toBe(false);
  });

  it("registers a finite revision and independent QA graph", () => {
    const definition = getWorkflowDefinition("CHANNEL_RESEARCH", 1);
    expect(definition.steps.map((step) => step.key)).toEqual(["retrieve-youtube-evidence", "draft-research", "initial-qa", "bounded-revision", "final-qa", "synthesize-validation", "review-research"]);
    expect(definition.steps.filter((step) => step.key.includes("qa"))).toHaveLength(2);
  });

  it("requires notes for a human revision request", () => {
    expect(workflowApprovalDecisionSchema.safeParse({ decision: "REQUEST_REVISION" }).success).toBe(false);
    expect(workflowApprovalDecisionSchema.safeParse({ decision: "REQUEST_REVISION", note: "Validate a broader competitor set." }).success).toBe(true);
  });
});
