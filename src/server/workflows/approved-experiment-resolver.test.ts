import { describe, expect, it, vi } from "vitest";
import type { ApprovedVideoExperimentArtifact } from "@/domain/production-workflows";
import { ApprovedExperimentIntegrityError, buildPortfolioScope, SupabaseApprovedExperimentResolver } from "./approved-experiment-resolver";
import { buildApprovedExperimentArtifact, buildApprovedExperimentSet } from "./video-portfolio-fixtures.test-helper";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/server/supabase-admin", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));

function selectionsFor(artifacts: ApprovedVideoExperimentArtifact[]) {
  return artifacts.map((artifact) => ({ experimentWorkflowId: artifact.reference.experimentWorkflowId, experimentRunId: artifact.reference.experimentRunId }));
}

function stubResolution(artifacts: ApprovedVideoExperimentArtifact[]) {
  rpc.mockReset();
  for (const artifact of artifacts) rpc.mockResolvedValueOnce({ data: artifact, error: null });
}

describe("approved-Experiment resolution for CHANNEL_VIDEO_PORTFOLIO", () => {
  it("resolves every selection through the database RPC, once each, in request order", async () => {
    const artifacts = [buildApprovedExperimentArtifact(1), buildApprovedExperimentArtifact(2)];
    stubResolution(artifacts);
    const set = await new SupabaseApprovedExperimentResolver().resolve(selectionsFor(artifacts), artifacts.map((artifact) => artifact.reference));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["resolve_approved_video_experiment_artifact", "resolve_approved_video_experiment_artifact"]);
    expect(rpc.mock.calls[0][1]).toEqual({ p_workflow_id: artifacts[0].reference.experimentWorkflowId, p_run_id: artifacts[0].reference.experimentRunId });
    expect(set.artifacts.map((artifact) => artifact.candidate.experimentRunId)).toEqual(artifacts.map((artifact) => artifact.reference.experimentRunId));
  });

  it("fails closed when the database cannot revalidate a candidate", async () => {
    const artifacts = [buildApprovedExperimentArtifact(1)];
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "UPSTREAM_EXPERIMENT_NOT_PORTFOLIO_ELIGIBLE" } });
    await expect(new SupabaseApprovedExperimentResolver().resolve(selectionsFor(artifacts), artifacts.map((artifact) => artifact.reference)))
      .rejects.toMatchObject({ code: "APPROVED_EXPERIMENT_INVALID", retryable: false });
  });

  it("rejects a persisted reference that no longer matches authoritative database state", async () => {
    const artifacts = [buildApprovedExperimentArtifact(1)];
    stubResolution(artifacts);
    const drifted = structuredClone(artifacts[0].reference);
    drifted.finalQaScore = 41;
    await expect(new SupabaseApprovedExperimentResolver().resolve(selectionsFor(artifacts), [drifted]))
      .rejects.toBeInstanceOf(ApprovedExperimentIntegrityError);
  });

  it("rejects a resolution whose reference set does not cover the selections", async () => {
    const artifacts = [buildApprovedExperimentArtifact(1), buildApprovedExperimentArtifact(2)];
    rpc.mockReset();
    await expect(new SupabaseApprovedExperimentResolver().resolve(selectionsFor(artifacts), [artifacts[0].reference]))
      .rejects.toMatchObject({ code: "UPSTREAM_EXPERIMENT_INTEGRITY_MISMATCH" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects the same approved Experiment run appearing twice in one portfolio", async () => {
    const artifact = buildApprovedExperimentArtifact(1);
    stubResolution([artifact, artifact]);
    await expect(new SupabaseApprovedExperimentResolver().resolve(
      [...selectionsFor([artifact]), ...selectionsFor([artifact])],
      [artifact.reference, artifact.reference],
    )).rejects.toMatchObject({ code: "UPSTREAM_EXPERIMENT_DUPLICATE" });
  });

  it("rejects a resolution that is not shaped like an approved-Experiment artifact", async () => {
    const artifacts = [buildApprovedExperimentArtifact(1)];
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: { reference: artifacts[0].reference }, error: null });
    await expect(new SupabaseApprovedExperimentResolver().resolve(selectionsFor(artifacts), artifacts.map((artifact) => artifact.reference))).rejects.toThrow();
  });

  describe("portfolio scope", () => {
    it("projects one eleven-artifact lineage chain per candidate, anchored on that candidate's own experiment run", () => {
      const set = buildApprovedExperimentSet([{}, {}]);
      expect(set.portfolioScope.candidates).toHaveLength(2);
      for (const [index, candidate] of set.portfolioScope.candidates.entries()) {
        expect(candidate.artifacts).toHaveLength(11);
        expect(candidate.experimentRunId).toBe(set.artifacts[index].candidate.experimentRunId);
        const experimentLink = candidate.artifacts.find((artifact) => artifact.workflowType === "CHANNEL_VIDEO_EXPERIMENT");
        expect(experimentLink?.runId).toBe(candidate.experimentRunId);
      }
    });

    it("records a re-derivable fact per candidate for type, viewer-value state and readiness", () => {
      const set = buildApprovedExperimentSet([{ viewerValueState: "AT_RISK", experimentReady: false }]);
      const keys = set.portfolioScope.facts.map((fact) => fact.key);
      const candidateId = set.artifacts[0].candidate.candidateId;
      expect(keys).toContain(`fact:${candidateId}:experiment-type`);
      expect(set.portfolioScope.facts.find((fact) => fact.key === `fact:${candidateId}:viewer-value-state`)?.value).toBe("AT_RISK");
      expect(set.portfolioScope.facts.find((fact) => fact.key === `fact:${candidateId}:experiment-ready`)?.value).toBe(false);
    });

    it("rejects a scope whose candidate lineage is missing a workflow in the chain", () => {
      const artifact = buildApprovedExperimentArtifact(1);
      const truncated = { ...artifact, artifacts: artifact.artifacts.slice(0, 10) };
      expect(() => buildPortfolioScope([truncated])).toThrow();
    });
  });
});
