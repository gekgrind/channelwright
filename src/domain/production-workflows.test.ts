import { describe, expect, it } from "vitest";
import { channelVideoBriefResultSchema, channelVideoScriptResultSchema, getWorkflowDefinition, serializeWorkflowSteps, workflowStartRequestSchema } from "./production-workflows";

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

  it("routes the exact CHANNEL_VIDEO_SCRIPT start payload through its identifiers-only contract", () => {
    const videoBriefWorkflowId = "11111111-1111-4111-8111-111111111111";
    const videoBriefRunId = "22222222-2222-4222-8222-222222222222";

    const valid = workflowStartRequestSchema.safeParse({
      operation: "START_WORKFLOW", workflowType: "CHANNEL_VIDEO_SCRIPT", definitionVersion: 1,
      input: { videoBriefWorkflowId, videoBriefRunId },
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.workflowType).toBe("CHANNEL_VIDEO_SCRIPT");
      expect(valid.data.input).toEqual({ videoBriefWorkflowId, videoBriefRunId });
    }

    // The public start contract accepts only identifiers: no brief object, script,
    // topic, hash, or QA state may be smuggled in.
    for (const input of [
      { proposedConcept: "A concept-validation payload must not reach the video-script route" },
      { videoBriefWorkflowId: "not-a-uuid", videoBriefRunId },
      { videoBriefWorkflowId, videoBriefRunId, unexpected: true },
      { videoBriefWorkflowId, videoBriefRunId, approvedVideoBriefReference: { briefRunId: videoBriefRunId } },
    ]) {
      expect(workflowStartRequestSchema.safeParse({
        operation: "START_WORKFLOW", workflowType: "CHANNEL_VIDEO_SCRIPT", definitionVersion: 1, input,
      }).success).toBe(false);
    }
  });

  it("registers the seven-step CHANNEL_VIDEO_SCRIPT graph with a single human approval gate", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_SCRIPT", 1);
    expect(definition.steps.map((step) => step.key)).toEqual([
      "validate-approved-brief", "draft-video-script", "initial-video-script-qa",
      "bounded-video-script-revision", "final-video-script-qa", "finalize-video-script", "review-video-script",
    ]);
    expect(definition.steps.filter((step) => step.kind === "APPROVAL")).toHaveLength(1);
    expect(definition.steps.at(-1)).toMatchObject({ kind: "APPROVAL", dependsOn: ["finalize-video-script"] });
  });

  it("requires an accountable model trail on a VIDEO_SCRIPT result", () => {
    const attribution = (index: number) => ({
      provider: "openai" as const, model: "configured-model", role: "GENERATOR" as const,
      operation: `video_script_synthesis_${index}`, invokedAt: "2026-08-16T10:00:00.000Z",
    });
    const trail = (count: number) => Array.from({ length: count }, (_unused, index) => attribution(index));
    expect(channelVideoScriptResultSchema.shape.modelProvenance.safeParse(trail(0)).success).toBe(false);
    expect(channelVideoScriptResultSchema.shape.modelProvenance.safeParse(trail(1)).success).toBe(true);
    expect(channelVideoScriptResultSchema.shape.modelProvenance.safeParse(trail(8)).success).toBe(true);
    expect(channelVideoScriptResultSchema.shape.modelProvenance.safeParse(trail(9)).success).toBe(false);
  });

  it("bounds accountable model attribution on a VIDEO_BRIEF result to between one and eight entries", () => {
    const attribution = (index: number) => ({
      provider: "openai" as const,
      model: "configured-model",
      role: "GENERATOR" as const,
      operation: `video_brief_synthesis_${index}`,
      invokedAt: "2026-08-15T10:00:00.000Z",
    });
    const trail = (count: number) => Array.from({ length: count }, (_unused, index) => attribution(index));

    expect(channelVideoBriefResultSchema.shape.modelProvenance.safeParse(trail(0)).success).toBe(false);
    expect(channelVideoBriefResultSchema.shape.modelProvenance.safeParse(trail(1)).success).toBe(true);
    expect(channelVideoBriefResultSchema.shape.modelProvenance.safeParse(trail(8)).success).toBe(true);
    expect(channelVideoBriefResultSchema.shape.modelProvenance.safeParse(trail(9)).success).toBe(false);
  });

  it("serializes bounded retry policy and dependency metadata", () => {
    const steps = serializeWorkflowSteps(getWorkflowDefinition("CHANNEL_CONCEPT_VALIDATION", 1));
    expect(steps.every((step) => step.maxAttempts >= 1 && step.maxAttempts <= 3)).toBe(true);
    expect(steps[1].dependsOn).toEqual([steps[0].key]);
  });
});

