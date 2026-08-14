import { describe, expect, it } from "vitest";
import type { ClaimedWorkflowStep } from "@/domain/production-workflows";
import { ChannelConceptValidationExecutor } from "./concept-validation-executor";

const base = {
  id: crypto.randomUUID(), ownerId: crypto.randomUUID(), workflowId: crypto.randomUUID(), runId: crypto.randomUUID(),
  workflowType: "CHANNEL_CONCEPT_VALIDATION" as const, definitionVersion: 1, capability: "strategist",
  attemptCount: 1, maxAttempts: 3, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  input: { proposedConcept: "Explain the hidden systems behind ordinary local businesses", audienceContext: "Independent operators", monetizationPaths: ["Sponsor partnerships"] },
  priorOutputs: {},
};

describe("deterministic channel concept validation", () => {
  it("keeps current audience demand explicitly provider-blocked", async () => {
    const result = await new ChannelConceptValidationExecutor().execute({ ...base, stepKey: "assess-audience-demand" } as ClaimedWorkflowStep);
    expect(result).toMatchObject({ status: "PROVIDER_DATA_REQUIRED" });
    expect(JSON.stringify(result)).toContain("no live market-data provider");
  });

  it("synthesizes typed output without pretending the concept passed", async () => {
    const executor = new ChannelConceptValidationExecutor();
    const contentDepth = await executor.execute({ ...base, stepKey: "assess-content-depth" } as ClaimedWorkflowStep);
    const audienceDemand = await executor.execute({ ...base, stepKey: "assess-audience-demand" } as ClaimedWorkflowStep);
    const monetization = await executor.execute({ ...base, stepKey: "assess-monetization" } as ClaimedWorkflowStep);
    const output = await executor.execute({ ...base, stepKey: "synthesize-validation", priorOutputs: { "assess-content-depth": contentDepth, "assess-audience-demand": audienceDemand, "assess-monetization": monetization } } as ClaimedWorkflowStep);
    expect(output).toMatchObject({ recommendation: "RESEARCH_REQUIRED", providerBoundary: "NO_LIVE_YOUTUBE_OR_MARKET_PROVIDER_DATA" });
  });
});

