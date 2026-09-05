import "server-only";

import {
  approvedVideoDiagnosisArtifactSchema,
  approvedVideoDiagnosisReferenceSchema,
  type ApprovedVideoDiagnosisArtifact,
  type ApprovedVideoDiagnosisReference,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

/**
 * Resolves the exact approved CHANNEL_VIDEO_DIAGNOSIS artifact a Decision run is
 * built from. All invariant enforcement (owner isolation, completed/finalized,
 * human-approved, final-QA-valid, finalizer-output equality, immutable/
 * recomputed hashes, provenance hash, lineage, latest/non-superseded, and full
 * transitive nine-artifact hash verification) lives in the database RPC. This
 * resolver's only application-side responsibility is a defense-in-depth
 * canonical-equality check between the reference persisted at start_workflow
 * time and what the database resolves right now.
 */
export interface ApprovedDiagnosisResolver {
  resolve(workflowId: string, runId: string, expected: ApprovedVideoDiagnosisReference): Promise<ApprovedVideoDiagnosisArtifact>;
}

export class ApprovedDiagnosisIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

export class SupabaseApprovedDiagnosisResolver implements ApprovedDiagnosisResolver {
  async resolve(workflowId: string, runId: string, expected: ApprovedVideoDiagnosisReference) {
    const { data, error } = await createSupabaseAdminClient().rpc("resolve_approved_video_diagnosis_artifact", {
      p_workflow_id: workflowId,
      p_run_id: runId,
    });
    if (error) throw new ApprovedDiagnosisIntegrityError("APPROVED_DIAGNOSIS_INVALID", "The exact approved video-diagnosis artifact could not be revalidated.");
    const artifact = approvedVideoDiagnosisArtifactSchema.parse(data);
    const persisted = approvedVideoDiagnosisReferenceSchema.parse(expected);
    if (!canonicalEquals(artifact.reference, persisted)) {
      throw new ApprovedDiagnosisIntegrityError("UPSTREAM_DIAGNOSIS_INTEGRITY_MISMATCH", "The persisted approved Diagnosis reference no longer matches authoritative database state.");
    }
    return artifact;
  }
}
