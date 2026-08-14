import { describe, expect, it } from "vitest";
import { getWorkflowDefinition, serializeWorkflowSteps, workflowStartRequestSchema } from "./production-workflows";

describe("production workflow registry", () => {
  it("registers a versioned concept-validation workflow with an explicit approval gate", () => {
    const definition = getWorkflowDefinition("CHANNEL_CONCEPT_VALIDATION", 1);
    expect(definition.steps.map((step) => step.key)).toEqual([
      "assess-content-depth", "assess-audience-demand", "assess-monetization", "synthesize-validation", "approve-validation",
    ]);
    expect(definition.steps.at(-1)).toMatchObject({ kind: "APPROVAL", dependsOn: ["synthesize-validation"] });
  });

  it("strictly validates workflow input", () => {
    const valid = workflowStartRequestSchema.safeParse({
      operation: "START_WORKFLOW",
      workflowType: "CHANNEL_CONCEPT_VALIDATION",
      input: { proposedConcept: "Explain the hidden systems behind ordinary local businesses" },
    });
    expect(valid.success).toBe(true);
    expect(workflowStartRequestSchema.safeParse({ operation: "START_WORKFLOW", workflowType: "UNKNOWN", input: {} }).success).toBe(false);
    expect(workflowStartRequestSchema.safeParse({
      operation: "START_WORKFLOW", workflowType: "CHANNEL_CONCEPT_VALIDATION",
      input: { proposedConcept: "Too short", unexpected: true },
    }).success).toBe(false);
  });

  it("serializes bounded retry policy and dependency metadata", () => {
    const steps = serializeWorkflowSteps(getWorkflowDefinition("CHANNEL_CONCEPT_VALIDATION", 1));
    expect(steps.every((step) => step.maxAttempts >= 1 && step.maxAttempts <= 3)).toBe(true);
    expect(steps[1].dependsOn).toEqual([steps[0].key]);
  });
});

