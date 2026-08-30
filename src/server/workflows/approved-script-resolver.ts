import "server-only";

import {
  approvedVideoScriptArtifactSchema,
  approvedVideoScriptReferenceSchema,
  type ApprovedVideoScriptArtifact,
  type ApprovedVideoScriptReference,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

export interface ApprovedScriptResolver {
  resolve(
    workflowId: string,
    runId: string,
    expected: ApprovedVideoScriptReference,
  ): Promise<ApprovedVideoScriptArtifact>;
}

export class ApprovedScriptIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Re-resolves the exact approved video-script artifact from authoritative
 * database state, then proves the reference persisted at workflow start has not
 * drifted from it. The database RPC owns every ownership, approval, hash, QA,
 * lineage, and viewer-value check; this client only detects drift.
 *
 * Comparison is canonical (key-order independent), so a reordered JSON encoding
 * is never mistaken for tampering while any identity, hash, QA, or lineage change
 * still fails closed. Database messages are never surfaced to the caller.
 */
export class SupabaseApprovedScriptResolver implements ApprovedScriptResolver {
  async resolve(workflowId: string, runId: string, expected: ApprovedVideoScriptReference) {
    const { data, error } = await createSupabaseAdminClient().rpc("resolve_approved_video_script_artifact", {
      p_workflow_id: workflowId,
      p_run_id: runId,
    });
    if (error) throw new ApprovedScriptIntegrityError("APPROVED_SCRIPT_INVALID", "The exact approved video-script artifact could not be revalidated.");
    const artifact = approvedVideoScriptArtifactSchema.parse(data);
    const persisted = approvedVideoScriptReferenceSchema.parse(expected);
    if (!canonicalEquals(artifact.reference, persisted)) {
      throw new ApprovedScriptIntegrityError("UPSTREAM_SCRIPT_INTEGRITY_MISMATCH", "The persisted approved video-script reference no longer matches authoritative state.");
    }
    return artifact;
  }
}
