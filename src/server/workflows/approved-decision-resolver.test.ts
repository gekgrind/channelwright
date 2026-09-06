import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/server/supabase-admin", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));

const { SupabaseApprovedDecisionResolver, ApprovedDecisionIntegrityError } = await import("./approved-decision-resolver");
const { approvedVideoDecisionArtifactFixture } = await import("./video-experiment-fixtures.test-helper");

const resolver = new SupabaseApprovedDecisionResolver();
const ok = (data: unknown) => rpc.mockResolvedValueOnce({ data, error: null });

const resolve = () => resolver.resolve(
  approvedVideoDecisionArtifactFixture.reference.decisionWorkflowId,
  approvedVideoDecisionArtifactFixture.reference.decisionRunId,
  approvedVideoDecisionArtifactFixture.reference,
);

describe("approved decision resolver", () => {
  it("accepts an artifact whose authoritative reference matches the persisted one", async () => {
    ok(approvedVideoDecisionArtifactFixture);
    await expect(resolve()).resolves.toEqual(approvedVideoDecisionArtifactFixture);
    expect(rpc).toHaveBeenCalledWith("resolve_approved_video_decision_artifact", {
      p_workflow_id: approvedVideoDecisionArtifactFixture.reference.decisionWorkflowId,
      p_run_id: approvedVideoDecisionArtifactFixture.reference.decisionRunId,
    });
  });

  it("accepts a reordered authoritative reference, because key order is not tampering", async () => {
    ok({ ...approvedVideoDecisionArtifactFixture, reference: Object.fromEntries(Object.entries(approvedVideoDecisionArtifactFixture.reference).reverse()) });
    await expect(resolve()).resolves.toMatchObject({ reference: approvedVideoDecisionArtifactFixture.reference });
  });

  it("fails closed when the database refuses to resolve the artifact", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "UPSTREAM_DECISION_NOT_EXPERIMENT_ELIGIBLE: the approved Decision is not eligible for experimentation" } });
    await expect(resolve()).rejects.toBeInstanceOf(ApprovedDecisionIntegrityError);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "NOT_FOUND: exact CHANNEL_VIDEO_DECISION run" } });
    await expect(resolve()).rejects.toMatchObject({ code: "APPROVED_DECISION_INVALID", retryable: false });
  });

  it("does not leak the database message to the caller", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "cross-owner leak: owner 123 attempted access" } });
    await expect(resolve()).rejects.toThrow("The exact approved video-decision artifact could not be revalidated.");
  });

  it("rejects every provenance-significant drift between authoritative and persisted state", async () => {
    const drifts = [
      { decisionRunId: crypto.randomUUID() },
      { decisionWorkflowId: crypto.randomUUID() },
      { approvedBy: crypto.randomUUID() },
      { approvalId: crypto.randomUUID() },
      { decisionArtifactHash: "1".repeat(64) },
      { decisionProvenanceHash: "2".repeat(64) },
      { finalQaScore: 51 },
      { finalQaState: "human_review_required" as const },
      { rootRunId: crypto.randomUUID() },
      { parentRunId: crypto.randomUUID() },
      { workflowDefinitionVersion: 2 },
      { decisionType: "PRIORITIZE_CHANGE" as const },
    ];
    for (const drift of drifts) {
      ok({ ...approvedVideoDecisionArtifactFixture, reference: { ...approvedVideoDecisionArtifactFixture.reference, ...drift } });
      await expect(resolve()).rejects.toMatchObject({ code: "UPSTREAM_DECISION_INTEGRITY_MISMATCH" });
    }
  });

  it("rejects a mutated transitive upstream Diagnosis reference", async () => {
    ok({
      ...approvedVideoDecisionArtifactFixture,
      reference: {
        ...approvedVideoDecisionArtifactFixture.reference,
        upstreamVideoDiagnosis: { ...approvedVideoDecisionArtifactFixture.reference.upstreamVideoDiagnosis, diagnosisArtifactHash: "3".repeat(64) },
      },
    });
    await expect(resolve()).rejects.toMatchObject({ code: "UPSTREAM_DECISION_INTEGRITY_MISMATCH" });
  });

  it("rejects an authoritative payload that does not satisfy the artifact contract", async () => {
    ok({ reference: approvedVideoDecisionArtifactFixture.reference, decisionResult: { nonsense: true }, experimentScope: null });
    await expect(resolve()).rejects.toBeTruthy();
  });

  it("rejects an authoritative reference whose experimentEligible literal is not true", async () => {
    ok({ ...approvedVideoDecisionArtifactFixture, reference: { ...approvedVideoDecisionArtifactFixture.reference, experimentEligible: false } });
    await expect(resolve()).rejects.toBeTruthy();
  });
});
