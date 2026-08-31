import "server-only";

import {
  approvedVideoPackagingArtifactSchema,
  approvedVideoPackagingReferenceSchema,
  type ApprovedVideoPackagingArtifact,
  type ApprovedVideoPackagingReference,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

export interface ApprovedPackagingResolver {
  resolve(
    workflowId: string,
    runId: string,
    expected: ApprovedVideoPackagingReference,
  ): Promise<ApprovedVideoPackagingArtifact>;
}

export class ApprovedPackagingIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Re-resolves the exact approved video-packaging artifact from authoritative
 * database state, then proves the reference persisted at workflow start has not
 * drifted from it. The database RPC owns every ownership, approval, hash, QA,
 * lineage, and viewer-value check; this client only detects drift.
 *
 * Comparison is canonical (key-order independent), so a reordered JSON encoding
 * is never mistaken for tampering while any identity, hash, QA, or lineage change
 * still fails closed. Database messages are never surfaced to the caller.
 */
export class SupabaseApprovedPackagingResolver implements ApprovedPackagingResolver {
  async resolve(workflowId: string, runId: string, expected: ApprovedVideoPackagingReference) {
    const { data, error } = await createSupabaseAdminClient().rpc("resolve_approved_video_packaging_artifact", {
      p_workflow_id: workflowId,
      p_run_id: runId,
    });
    if (error) throw new ApprovedPackagingIntegrityError("APPROVED_PACKAGING_INVALID", "The exact approved video-packaging artifact could not be revalidated.");
    const artifact = approvedVideoPackagingArtifactSchema.parse(data);
    const persisted = approvedVideoPackagingReferenceSchema.parse(expected);
    if (!canonicalEquals(artifact.reference, persisted)) {
      throw new ApprovedPackagingIntegrityError("UPSTREAM_PACKAGING_INTEGRITY_MISMATCH", "The persisted approved video-packaging reference no longer matches authoritative state.");
    }
    return artifact;
  }
}
