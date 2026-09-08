import "server-only";

import {
  approvedVideoDecisionArtifactSchema,
  approvedVideoDecisionReferenceSchema,
  type ApprovedVideoDecisionArtifact,
  type ApprovedVideoDecisionReference,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

/**
 * Resolves the exact approved CHANNEL_VIDEO_DECISION artifact a Experiment run
 * is built from. All invariant enforcement (owner isolation, completed/finalized,
 * human-approved, final-QA-valid, finalizer-output equality, immutable/
 * recomputed hashes, provenance hash, lineage, latest/non-superseded, the
 * `experimentEligible` downstream-eligibility gate, and full transitive
 * ten-artifact hash + supersession verification) lives in the database RPC.
 * This resolver's only application-side responsibility is a defense-in-depth
 * canonical-equality check between the reference persisted at start_workflow
 * time and what the database resolves right now.
 */
export interface ApprovedDecisionResolver {
  resolve(workflowId: string, runId: string, expected: ApprovedVideoDecisionReference): Promise<ApprovedVideoDecisionArtifact>;
}

export class ApprovedDecisionIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

export class SupabaseApprovedDecisionResolver implements ApprovedDecisionResolver {
  async resolve(workflowId: string, runId: string, expected: ApprovedVideoDecisionReference) {
    const { data, error } = await createSupabaseAdminClient().rpc("resolve_approved_video_decision_artifact", {
      p_workflow_id: workflowId,
      p_run_id: runId,
    });
    if (error) throw new ApprovedDecisionIntegrityError("APPROVED_DECISION_INVALID", "The exact approved video-decision artifact could not be revalidated.");
    const artifact = approvedVideoDecisionArtifactSchema.parse(data);
    const persisted = approvedVideoDecisionReferenceSchema.parse(expected);
    if (!canonicalEquals(artifact.reference, persisted)) {
      throw new ApprovedDecisionIntegrityError("UPSTREAM_DECISION_INTEGRITY_MISMATCH", "The persisted approved Decision reference no longer matches authoritative database state.");
    }
    return artifact;
  }
}
