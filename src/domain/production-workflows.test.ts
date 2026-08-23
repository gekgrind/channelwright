import { describe, expect, it } from "vitest";
import { channelVideoBriefResultSchema, getWorkflowDefinition, serializeWorkflowSteps, workflowStartRequestSchema } from "./production-workflows";

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

  it("routes the exact CHANNEL_VIDEO_BRIEF start payload through its strict input contract", () => {
    const contentIntelligenceWorkflowId = "11111111-1111-4111-8111-111111111111";
    const contentIntelligenceRunId = "22222222-2222-4222-8222-222222222222";

    const withTopic = workflowStartRequestSchema.safeParse({
      operation: "START_WORKFLOW", workflowType: "CHANNEL_VIDEO_BRIEF", definitionVersion: 1,
      input: { contentIntelligenceWorkflowId, contentIntelligenceRunId, topicId: "topic:self-host-vs-managed" },
    });
    expect(withTopic.success).toBe(true);
    if (withTopic.success) {
      expect(withTopic.data.workflowType).toBe("CHANNEL_VIDEO_BRIEF");
      expect(withTopic.data.input).toEqual({ contentIntelligenceWorkflowId, contentIntelligenceRunId, topicId: "topic:self-host-vs-managed" });
    }

    const withoutTopic = workflowStartRequestSchema.safeParse({
      operation: "START_WORKFLOW", workflowType: "CHANNEL_VIDEO_BRIEF", definitionVersion: 1,
      input: { contentIntelligenceWorkflowId, contentIntelligenceRunId },
    });
    expect(withoutTopic.success).toBe(true);
    if (withoutTopic.success) expect(withoutTopic.data.input).toEqual({ contentIntelligenceWorkflowId, contentIntelligenceRunId });

    for (const input of [
      { proposedConcept: "A concept-validation payload must not reach the video-brief route" },
      { contentIntelligenceWorkflowId: "not-a-uuid", contentIntelligenceRunId },
      { contentIntelligenceWorkflowId, contentIntelligenceRunId, topicId: "not-a-topic-id" },
      { contentIntelligenceWorkflowId, contentIntelligenceRunId, unexpected: true },
    ]) {
      expect(workflowStartRequestSchema.safeParse({
        operation: "START_WORKFLOW", workflowType: "CHANNEL_VIDEO_BRIEF", definitionVersion: 1, input,
      }).success).toBe(false);
    }
  });

  it("requires at least one accountable model attribution on a VIDEO_BRIEF result", () => {
    expect(channelVideoBriefResultSchema.shape.modelProvenance.safeParse([]).success).toBe(false);
    expect(channelVideoBriefResultSchema.shape.modelProvenance.safeParse([{
      provider: "openai",
      model: "configured-model",
      role: "GENERATOR",
      operation: "video_brief_synthesis",
      invokedAt: "2026-08-15T10:00:00.000Z",
    }]).success).toBe(true);
  });

  it("serializes bounded retry policy and dependency metadata", () => {
    const steps = serializeWorkflowSteps(getWorkflowDefinition("CHANNEL_CONCEPT_VALIDATION", 1));
    expect(steps.every((step) => step.maxAttempts >= 1 && step.maxAttempts <= 3)).toBe(true);
    expect(steps[1].dependsOn).toEqual([steps[0].key]);
  });
});

