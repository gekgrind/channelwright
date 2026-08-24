import { describe, expect, it, vi } from "vitest";
import type { ClaimedWorkflowStep } from "@/domain/production-workflows";

const rpc = vi.fn();
vi.mock("@/server/supabase-admin", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));

const { SupabaseResearchUsageMeter, ResearchBudgetError } = await import("./research-usage");

const step = (workflowType: ClaimedWorkflowStep["workflowType"]): ClaimedWorkflowStep => ({
  id: "00000000-0000-4000-8000-000000000001",
  ownerId: "00000000-0000-4000-8000-000000000002",
  workflowId: "00000000-0000-4000-8000-000000000003",
  runId: "00000000-0000-4000-8000-000000000004",
  workflowType,
  definitionVersion: 1,
  stepKey: "design-viewer-promise",
  capability: "viewer-promise-design",
  attemptCount: 1,
  maxAttempts: 2,
  leaseToken: "00000000-0000-4000-8000-000000000005",
  leaseExpiresAt: "2026-08-15T10:00:00.000Z",
  input: {},
  priorOutputs: {},
});

const budget = {
  maxAggregateProviderRequests: 0,
  maxAggregateProviderQuotaUnits: 0,
  maxAggregateSearches: 0,
  maxAggregateSynthesisCalls: 1,
  maxAggregateQaCalls: 2,
  maxAggregateRevisionCalls: 1,
  maxAggregateInputTokens: 1_000,
  maxAggregateOutputTokens: 1_000,
  maxAggregateTotalTokens: 2_000,
};

describe("SupabaseResearchUsageMeter rejected reservation", () => {
  it("maps a REJECTED CHANNEL_VIDEO_BRIEF reservation to the typed terminal budget error", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: null }); // ensure_research_run_budget
    rpc.mockResolvedValueOnce({ data: { status: "REJECTED", exhaustionCode: "RESEARCH_RESOURCE_BUDGET_EXHAUSTED:totalTokens" }, error: null });

    const meter = new SupabaseResearchUsageMeter(step("CHANNEL_VIDEO_BRIEF"), budget);

    await expect(meter.reserve({ key: "video_brief_synthesis", kind: "MODEL_SYNTHESIS" }))
      .rejects.toMatchObject({ code: "VIDEO_BRIEF_RESOURCE_BUDGET_EXHAUSTED", retryable: false });
    expect(rpc).toHaveBeenCalledWith("reserve_research_usage", expect.objectContaining({
      p_operation_key: "design-viewer-promise:attempt:1:video_brief_synthesis",
      p_operation_kind: "MODEL_SYNTHESIS",
    }));
  });

  it("propagates the same rejection as the shared terminal ResearchBudgetError type", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    rpc.mockResolvedValueOnce({ data: { status: "REJECTED", exhaustionCode: "RESEARCH_RESOURCE_BUDGET_EXHAUSTED:totalTokens" }, error: null });

    const meter = new SupabaseResearchUsageMeter(step("CHANNEL_VIDEO_BRIEF"), budget);
    await expect(meter.reserve({ key: "video_brief_synthesis", kind: "MODEL_SYNTHESIS" }))
      .rejects.toBeInstanceOf(ResearchBudgetError);
  });
});
