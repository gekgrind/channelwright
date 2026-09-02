import "server-only";

import {
  approvedVideoReleaseArtifactSchema,
  approvedVideoReleaseReferenceSchema,
  type ApprovedVideoReleaseArtifact,
  type ApprovedVideoReleaseReference,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

export interface ApprovedReleaseResolver {
  resolve(
    workflowId: string,
    runId: string,
    expected: ApprovedVideoReleaseReference,
  ): Promise<ApprovedVideoReleaseArtifact>;
}

export class ApprovedReleaseIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Re-resolves the exact approved video-release artifact from authoritative
 * database state, then proves the reference persisted at workflow start has not
 * drifted from it. The database RPC owns every ownership, approval, hash, QA,
 * lineage, and viewer-value check; this client only detects drift.
 *
 * Comparison is canonical (key-order independent), so a reordered JSON encoding
 * is never mistaken for tampering while any identity, hash, QA, or lineage change
 * still fails closed. Database messages are never surfaced to the caller.
 */
export class SupabaseApprovedReleaseResolver implements ApprovedReleaseResolver {
  async resolve(workflowId: string, runId: string, expected: ApprovedVideoReleaseReference) {
    const { data, error } = await createSupabaseAdminClient().rpc("resolve_approved_video_release_artifact", {
      p_workflow_id: workflowId,
      p_run_id: runId,
    });
    if (error) throw new ApprovedReleaseIntegrityError("APPROVED_RELEASE_INVALID", "The exact approved video-release artifact could not be revalidated.");
    const artifact = approvedVideoReleaseArtifactSchema.parse(data);
    const persisted = approvedVideoReleaseReferenceSchema.parse(expected);
    if (!canonicalEquals(artifact.reference, persisted)) {
      throw new ApprovedReleaseIntegrityError("UPSTREAM_RELEASE_INTEGRITY_MISMATCH", "The persisted approved video-release reference no longer matches authoritative state.");
    }
    return artifact;
  }
}
