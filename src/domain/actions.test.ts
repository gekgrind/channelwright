import { describe, expect, it } from "vitest";
import { workflowActionSchema } from "./actions";
import { viabilityReportSchema } from "./contracts";

const preferences = {
  name: "Test channel", niche: "Business", targetAudience: "Founders", videoStyle: "Documentary",
  preferredVoice: "Measured", targetDurationMinutes: 10, postingFrequency: "Weekly",
  monetizationGoal: "Sponsors", language: "English", productionComplexity: "BALANCED",
  distributionTargets: { youtube: true, tiktok: false, instagramFacebookReels: false },
};

describe("workflow action validation", () => {
  it("requires a concept for user-defined onboarding", () => {
    expect(workflowActionSchema.safeParse({ type: "CREATE_CHANNEL", mode: "USER_DEFINED", preferences }).success).toBe(false);
  });

  it("requires feedback for script changes", () => {
    expect(workflowActionSchema.safeParse({ type: "SCRIPT_DECISION", videoId: crypto.randomUUID(), decision: "REQUEST_CHANGES" }).success).toBe(false);
  });

  it("requires feedback for platform plan changes", () => {
    expect(workflowActionSchema.safeParse({ type: "PLATFORM_ARTIFACT_DECISION", videoId: crypto.randomUUID(), target: "TIKTOK", artifactVersion: 1, decision: "REQUEST_CHANGES" }).success).toBe(false);
  });

  it("requires and validates a supported reference-channel URL", () => {
    expect(workflowActionSchema.safeParse({ type: "CREATE_CHANNEL", mode: "REFERENCE_CHANNEL", preferences }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ type: "CREATE_CHANNEL", mode: "REFERENCE_CHANNEL", preferences, referenceChannel: { url: "https://www.youtube.com/watch?v=private-network-trick" } }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ type: "CREATE_CHANNEL", mode: "REFERENCE_CHANNEL", preferences, referenceChannel: { url: "https://youtube.com/@original-example" } }).success).toBe(true);
  });

  it("requires a replacement concept when switching from a reference report to user-defined mode", () => {
    expect(workflowActionSchema.safeParse({ type: "REFERENCE_REPORT_DECISION", channelId: crypto.randomUUID(), reportVersion: 1, decision: "SWITCH_TO_USER_DEFINED" }).success).toBe(false);
  });

  it("requires feedback for build specification and artifact changes", () => {
    expect(workflowActionSchema.safeParse({ type: "BUILD_SPEC_DECISION", buildProjectId: crypto.randomUUID(), specificationVersion: 1, decision: "REQUEST_CHANGES" }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ type: "BUILD_ARTIFACT_DECISION", buildProjectId: crypto.randomUUID(), artifactVersion: 1, decision: "REQUEST_CHANGES" }).success).toBe(false);
  });

  it("requires feedback for monetization plan changes", () => {
    expect(workflowActionSchema.safeParse({ type: "MONETIZATION_PLAN_DECISION", channelId: crypto.randomUUID(), planVersion: 1, decision: "REQUEST_CHANGES" }).success).toBe(false);
  });
});

describe("viability gate validation", () => {
  it("rejects GO when any hard gate is not affirmative", () => {
    const gate = (status: string) => ({ status, score: 80, evidence: ["Evidence"] });
    const result = viabilityReportSchema.safeParse({
      recommendation: "GO", overallScore: 80,
      gates: { contentRunway: gate("YES"), audienceDemand: gate("WEAK"), monetization: gate("YES"), differentiation: gate("STRONG"), productionEconomics: gate("STRONG") },
      scores: { audienceDemand: 80, competition: 70, monetization: 80, contentDepth: 80, productionFeasibility: 80, differentiationPotential: 80, trendStability: 80 },
      strengths: [], risks: [], findings: [], repairable: false, recommendedChanges: [], revisedConceptExamples: [],
      summary: "This deliberately invalid report should never be eligible for an automatic GO recommendation.", modelVersion: "test",
    });
    expect(result.success).toBe(false);
  });
});
