import "server-only";

import {
  approvedStrategyArtifactSchema,
  approvedStrategyReferenceSchema,
  type ApprovedStrategyArtifact,
  type ApprovedStrategyReference,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

export interface ApprovedStrategyResolver {
  resolve(workflowId: string, runId: string, expected: ApprovedStrategyReference): Promise<ApprovedStrategyArtifact>;
}

export class ApprovedStrategyIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Re-resolves the exact approved strategy artifact from authoritative database
 * state and compares it against the reference persisted at workflow start. The
 * database RPC owns every ownership, approval, hash, and lineage check; this
 * client only proves that the persisted reference has not drifted from it.
 *
 * Comparison is canonical (key-order independent) so a reordered JSON encoding
 * is never mistaken for tampering, while any identity, hash, QA, or lineage
 * change — including a change to the transitively carried upstream research
 * reference — still fails closed.
 */
export class SupabaseApprovedStrategyResolver implements ApprovedStrategyResolver {
  async resolve(workflowId: string, runId: string, expected: ApprovedStrategyReference) {
    const { data, error } = await createSupabaseAdminClient().rpc("resolve_approved_strategy_artifact", {
      p_workflow_id: workflowId,
      p_run_id: runId,
    });
    if (error) throw new ApprovedStrategyIntegrityError("APPROVED_STRATEGY_INVALID", "The exact approved strategy artifact could not be revalidated.");
    const artifact = approvedStrategyArtifactSchema.parse(data);
    const persisted = approvedStrategyReferenceSchema.parse(expected);
    if (!canonicalEquals(artifact.reference, persisted)) {
      throw new ApprovedStrategyIntegrityError("UPSTREAM_STRATEGY_INTEGRITY_MISMATCH", "The persisted approved-strategy reference no longer matches authoritative state.");
    }
    return artifact;
  }
}
