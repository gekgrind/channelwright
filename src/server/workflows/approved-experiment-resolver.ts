import "server-only";

import {
  approvedVideoExperimentArtifactSchema,
  approvedVideoExperimentReferenceSchema,
  approvedVideoExperimentSetSchema,
  videoPortfolioScopeSchema,
  type ApprovedVideoExperimentArtifact,
  type ApprovedVideoExperimentReference,
  type ApprovedVideoExperimentSet,
  type PortfolioExperimentSelection,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

/**
 * Resolves the exact approved CHANNEL_VIDEO_EXPERIMENT artifacts a Portfolio run
 * is built from. All invariant enforcement per candidate (owner isolation,
 * completed/finalized, human-approved, final-QA-valid, finalizer-output equality,
 * immutable/recomputed hashes, provenance hash, lineage, latest/non-superseded,
 * the `portfolioEligible` downstream-eligibility gate, and full transitive
 * eleven-artifact hash + supersession verification) lives in the database RPC.
 *
 * The RPC deliberately returns a bounded server-extracted projection of each
 * experiment rather than the experiment artifact itself: the allocation model
 * never receives an experiment's mutable prose body, so a Portfolio run is
 * structurally incapable of restating or rewriting an approved design.
 *
 * This resolver's application-side responsibilities are a defense-in-depth
 * canonical-equality check between the references persisted at start_workflow
 * time and what the database resolves right now, plus assembly of the compact
 * portfolio-scope projection from those authoritative per-candidate results.
 */
export interface ApprovedExperimentResolver {
  resolve(selections: readonly PortfolioExperimentSelection[], expected: readonly ApprovedVideoExperimentReference[]): Promise<ApprovedVideoExperimentSet>;
}

export class ApprovedExperimentIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Builds the compact lineage projection the portfolio persists. Every fact is
 * derived from a server-authoritative candidate projection, never from model
 * output, so the durable artifact carries a re-derivable statement of what each
 * candidate was at allocation time.
 */
export function buildPortfolioScope(artifacts: readonly ApprovedVideoExperimentArtifact[]) {
  return videoPortfolioScopeSchema.parse({
    candidates: artifacts.map((artifact) => ({
      candidateId: artifact.candidate.candidateId,
      experimentRunId: artifact.candidate.experimentRunId,
      artifacts: artifact.artifacts,
    })),
    facts: artifacts.flatMap((artifact) => [
      { key: `fact:${artifact.candidate.candidateId}:experiment-type`, value: artifact.candidate.experimentType, sourceRef: `experiment:${artifact.candidate.experimentRunId}/content/experiment/experimentType` },
      { key: `fact:${artifact.candidate.candidateId}:viewer-value-state`, value: artifact.candidate.viewerValueState, sourceRef: `experiment:${artifact.candidate.experimentRunId}/content/viewerValueSafeguards/inheritedState` },
      { key: `fact:${artifact.candidate.candidateId}:experiment-ready`, value: artifact.candidate.experimentReady, sourceRef: `experiment:${artifact.candidate.experimentRunId}/content/experimentReady` },
    ]),
  });
}

export class SupabaseApprovedExperimentResolver implements ApprovedExperimentResolver {
  async resolve(selections: readonly PortfolioExperimentSelection[], expected: readonly ApprovedVideoExperimentReference[]): Promise<ApprovedVideoExperimentSet> {
    if (selections.length !== expected.length) {
      throw new ApprovedExperimentIntegrityError("UPSTREAM_EXPERIMENT_INTEGRITY_MISMATCH", "The persisted approved Experiment references do not cover the selected experiments.");
    }
    const client = createSupabaseAdminClient();
    const artifacts: ApprovedVideoExperimentArtifact[] = [];
    for (const [index, selection] of selections.entries()) {
      const { data, error } = await client.rpc("resolve_approved_video_experiment_artifact", {
        p_workflow_id: selection.experimentWorkflowId,
        p_run_id: selection.experimentRunId,
      });
      if (error) throw new ApprovedExperimentIntegrityError("APPROVED_EXPERIMENT_INVALID", "An exact approved video-experiment artifact could not be revalidated.");
      const artifact = approvedVideoExperimentArtifactSchema.parse(data);
      const persisted = approvedVideoExperimentReferenceSchema.parse(expected[index]);
      if (!canonicalEquals(artifact.reference, persisted)) {
        throw new ApprovedExperimentIntegrityError("UPSTREAM_EXPERIMENT_INTEGRITY_MISMATCH", "A persisted approved Experiment reference no longer matches authoritative database state.");
      }
      artifacts.push(artifact);
    }
    const runIds = new Set(artifacts.map((artifact) => artifact.candidate.experimentRunId));
    if (runIds.size !== artifacts.length) {
      throw new ApprovedExperimentIntegrityError("UPSTREAM_EXPERIMENT_DUPLICATE", "The same approved Experiment run cannot appear twice in one portfolio.");
    }
    return approvedVideoExperimentSetSchema.parse({ artifacts, portfolioScope: buildPortfolioScope(artifacts) });
  }
}
