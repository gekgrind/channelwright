import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/server/supabase-admin", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));

const { SupabaseApprovedDiagnosisResolver, ApprovedDiagnosisIntegrityError } = await import("./approved-diagnosis-resolver");
const { approvedVideoDiagnosisArtifactFixture } = await import("./video-decision-fixtures.test-helper");

const resolver = new SupabaseApprovedDiagnosisResolver();
const ok = (data: unknown) => rpc.mockResolvedValueOnce({ data, error: null });

const resolve = () => resolver.resolve(
  approvedVideoDiagnosisArtifactFixture.reference.diagnosisWorkflowId,
  approvedVideoDiagnosisArtifactFixture.reference.diagnosisRunId,
  approvedVideoDiagnosisArtifactFixture.reference,
);

describe("approved diagnosis resolver", () => {
  it("accepts an artifact whose authoritative reference matches the persisted one", async () => {
    ok(approvedVideoDiagnosisArtifactFixture);
    await expect(resolve()).resolves.toEqual(approvedVideoDiagnosisArtifactFixture);
    expect(rpc).toHaveBeenCalledWith("resolve_approved_video_diagnosis_artifact", {
      p_workflow_id: approvedVideoDiagnosisArtifactFixture.reference.diagnosisWorkflowId,
      p_run_id: approvedVideoDiagnosisArtifactFixture.reference.diagnosisRunId,
    });
  });

  it("accepts a reordered authoritative reference, because key order is not tampering", async () => {
    ok({ ...approvedVideoDiagnosisArtifactFixture, reference: Object.fromEntries(Object.entries(approvedVideoDiagnosisArtifactFixture.reference).reverse()) });
    await expect(resolve()).resolves.toMatchObject({ reference: approvedVideoDiagnosisArtifactFixture.reference });
  });

  it("fails closed when the database refuses to resolve the artifact", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "UPSTREAM_DIAGNOSIS_NOT_APPROVED: exact diagnosis run is not human approved" } });
    await expect(resolve()).rejects.toBeInstanceOf(ApprovedDiagnosisIntegrityError);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "NOT_FOUND: exact CHANNEL_VIDEO_DIAGNOSIS run" } });
    await expect(resolve()).rejects.toMatchObject({ code: "APPROVED_DIAGNOSIS_INVALID", retryable: false });
  });

  it("does not leak the database message to the caller", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "cross-owner leak: owner 123 attempted access" } });
    await expect(resolve()).rejects.toThrow("The exact approved video-diagnosis artifact could not be revalidated.");
  });

  it("rejects every provenance-significant drift between authoritative and persisted state", async () => {
    const drifts = [
      { diagnosisRunId: crypto.randomUUID() },
      { diagnosisWorkflowId: crypto.randomUUID() },
      { approvedBy: crypto.randomUUID() },
      { approvalId: crypto.randomUUID() },
      { diagnosisArtifactHash: "1".repeat(64) },
      { diagnosisProvenanceHash: "2".repeat(64) },
      { finalQaScore: 51 },
      { finalQaState: "human_review_required" as const },
      { rootRunId: crypto.randomUUID() },
      { parentRunId: crypto.randomUUID() },
      { workflowDefinitionVersion: 2 },
    ];
    for (const drift of drifts) {
      ok({ ...approvedVideoDiagnosisArtifactFixture, reference: { ...approvedVideoDiagnosisArtifactFixture.reference, ...drift } });
      await expect(resolve()).rejects.toMatchObject({ code: "UPSTREAM_DIAGNOSIS_INTEGRITY_MISMATCH" });
    }
  });

  it("rejects a mutated transitive upstream Performance reference", async () => {
    ok({
      ...approvedVideoDiagnosisArtifactFixture,
      reference: {
        ...approvedVideoDiagnosisArtifactFixture.reference,
        upstreamVideoPerformance: { ...approvedVideoDiagnosisArtifactFixture.reference.upstreamVideoPerformance, performanceArtifactHash: "3".repeat(64) },
      },
    });
    await expect(resolve()).rejects.toMatchObject({ code: "UPSTREAM_DIAGNOSIS_INTEGRITY_MISMATCH" });
  });

  it("rejects an authoritative payload that does not satisfy the artifact contract", async () => {
    ok({ reference: approvedVideoDiagnosisArtifactFixture.reference, diagnosisResult: { nonsense: true }, decisionScope: null });
    await expect(resolve()).rejects.toBeTruthy();
  });
});
