import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/server/supabase-admin", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));

const { SupabaseApprovedStrategyResolver, ApprovedStrategyIntegrityError } = await import("./approved-strategy-resolver");
const { approvedStrategyArtifactFixture, approvedStrategyReferenceFixture } = await import("./content-fixtures.test-helper");

const resolver = new SupabaseApprovedStrategyResolver();
const ok = (data: unknown) => rpc.mockResolvedValueOnce({ data, error: null });

const resolve = () => resolver.resolve(
  approvedStrategyReferenceFixture.strategyWorkflowId,
  approvedStrategyReferenceFixture.strategyRunId,
  approvedStrategyReferenceFixture,
);

describe("approved strategy resolver", () => {
  it("accepts an artifact whose authoritative reference matches the persisted one", async () => {
    ok(approvedStrategyArtifactFixture);
    await expect(resolve()).resolves.toEqual(approvedStrategyArtifactFixture);
    expect(rpc).toHaveBeenCalledWith("resolve_approved_strategy_artifact", {
      p_workflow_id: approvedStrategyReferenceFixture.strategyWorkflowId,
      p_run_id: approvedStrategyReferenceFixture.strategyRunId,
    });
  });

  it("accepts a reordered authoritative reference, because key order is not tampering", async () => {
    ok({ ...approvedStrategyArtifactFixture, reference: Object.fromEntries(Object.entries(approvedStrategyReferenceFixture).reverse()) });
    await expect(resolve()).resolves.toMatchObject({ reference: approvedStrategyReferenceFixture });
  });

  it("fails closed when the database refuses to resolve the artifact", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "UPSTREAM_STRATEGY_NOT_APPROVED: exact strategy run is not human approved" } });
    await expect(resolve()).rejects.toBeInstanceOf(ApprovedStrategyIntegrityError);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "NOT_FOUND: exact CHANNEL_STRATEGY run" } });
    await expect(resolve()).rejects.toMatchObject({ code: "APPROVED_STRATEGY_INVALID", retryable: false });
  });

  it("does not leak the database message to the caller", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "cross-owner leak: owner 123 attempted access" } });
    await expect(resolve()).rejects.toThrow("The exact approved strategy artifact could not be revalidated.");
  });

  it("rejects every provenance-significant drift between authoritative and persisted state", async () => {
    const drifts = [
      { strategyRunId: crypto.randomUUID() },
      { strategyWorkflowId: crypto.randomUUID() },
      { approvedBy: crypto.randomUUID() },
      { approvalId: crypto.randomUUID() },
      { strategyArtifactHash: "1".repeat(64) },
      { strategyProvenanceHash: "2".repeat(64) },
      { finalQaScore: 51 },
      { finalQaState: "human_review_required" as const },
      { rootRunId: crypto.randomUUID() },
      { parentRunId: crypto.randomUUID() },
      { workflowDefinitionVersion: 2 },
    ];
    for (const drift of drifts) {
      ok({ ...approvedStrategyArtifactFixture, reference: { ...approvedStrategyReferenceFixture, ...drift } });
      await expect(resolve()).rejects.toMatchObject({ code: "UPSTREAM_STRATEGY_INTEGRITY_MISMATCH" });
    }
  });

  it("rejects a mutated transitive upstream research reference", async () => {
    ok({
      ...approvedStrategyArtifactFixture,
      reference: {
        ...approvedStrategyReferenceFixture,
        upstreamResearch: { ...approvedStrategyReferenceFixture.upstreamResearch, researchArtifactHash: "3".repeat(64) },
      },
    });
    await expect(resolve()).rejects.toMatchObject({ code: "UPSTREAM_STRATEGY_INTEGRITY_MISMATCH" });
  });

  it("rejects an authoritative payload that does not satisfy the artifact contract", async () => {
    ok({ reference: approvedStrategyReferenceFixture, strategyResult: { nonsense: true }, researchEvidenceBundle: null });
    await expect(resolve()).rejects.toBeTruthy();
  });
});
