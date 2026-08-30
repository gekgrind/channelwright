import "server-only";

import {
  approvedVideoBriefArtifactSchema,
  approvedVideoBriefReferenceSchema,
  type ApprovedVideoBriefArtifact,
  type ApprovedVideoBriefReference,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

export interface ApprovedBriefResolver {
  resolve(
    workflowId: string,
    runId: string,
    expected: ApprovedVideoBriefReference,
  ): Promise<ApprovedVideoBriefArtifact>;
}

export class ApprovedBriefIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Re-resolves the exact approved video-brief artifact from authoritative
 * database state, then proves the reference persisted at workflow start has not
 * drifted from it. The database RPC owns every ownership, approval, hash, QA,
 * lineage, and viewer-value check; this client only detects drift.
 *
 * Comparison is canonical (key-order independent), so a reordered JSON encoding
 * is never mistaken for tampering while any identity, hash, QA, or lineage change
 * still fails closed. Database messages are never surfaced to the caller.
 */
export class SupabaseApprovedBriefResolver implements ApprovedBriefResolver {
  async resolve(workflowId: string, runId: string, expected: ApprovedVideoBriefReference) {
    const { data, error } = await createSupabaseAdminClient().rpc("resolve_approved_video_brief_artifact", {
      p_workflow_id: workflowId,
      p_run_id: runId,
    });
    if (error) throw new ApprovedBriefIntegrityError("APPROVED_BRIEF_INVALID", "The exact approved video-brief artifact could not be revalidated.");
    const artifact = approvedVideoBriefArtifactSchema.parse(data);
    const persisted = approvedVideoBriefReferenceSchema.parse(expected);
    if (!canonicalEquals(artifact.reference, persisted)) {
      throw new ApprovedBriefIntegrityError("UPSTREAM_BRIEF_INTEGRITY_MISMATCH", "The persisted approved video-brief reference no longer matches authoritative state.");
    }
    return artifact;
  }
}
