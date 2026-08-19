import "server-only";

import {
  approvedContentIntelligenceReferenceSchema,
  approvedContentOpportunityArtifactSchema,
  type ApprovedContentIntelligenceReference,
  type ApprovedContentOpportunityArtifact,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

export interface ApprovedContentResolver {
  resolve(
    workflowId: string,
    runId: string,
    topicId: string,
    expected: ApprovedContentIntelligenceReference,
  ): Promise<ApprovedContentOpportunityArtifact>;
}

export class ApprovedContentIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Re-resolves the exact approved content-intelligence artifact and selected
 * topic from authoritative database state, then proves the reference persisted
 * at workflow start has not drifted from it. The database RPC owns every
 * ownership, approval, hash, QA, lineage, topic-membership, and viewer-value
 * check; this client only detects drift.
 *
 * Comparison is canonical (key-order independent), so a reordered JSON encoding
 * is never mistaken for tampering while any identity, hash, QA, lineage, or
 * selected-topic change still fails closed. Database messages are never
 * surfaced to the caller.
 */
export class SupabaseApprovedContentResolver implements ApprovedContentResolver {
  async resolve(workflowId: string, runId: string, topicId: string, expected: ApprovedContentIntelligenceReference) {
    const { data, error } = await createSupabaseAdminClient().rpc("resolve_approved_content_artifact", {
      p_workflow_id: workflowId,
      p_run_id: runId,
      p_topic_id: topicId,
    });
    if (error) throw new ApprovedContentIntegrityError("APPROVED_CONTENT_INVALID", "The exact approved content-intelligence artifact could not be revalidated.");
    const artifact = approvedContentOpportunityArtifactSchema.parse(data);
    const persisted = approvedContentIntelligenceReferenceSchema.parse(expected);
    if (!canonicalEquals(artifact.reference, persisted)) {
      throw new ApprovedContentIntegrityError("UPSTREAM_CONTENT_INTEGRITY_MISMATCH", "The persisted approved content-intelligence reference no longer matches authoritative state.");
    }
    if (artifact.selection.topicId !== topicId || artifact.selectedTopic.topicId !== topicId) {
      throw new ApprovedContentIntegrityError("SELECTED_TOPIC_IDENTITY_MISMATCH", "The resolved topic identity does not match the topic pinned at workflow start.");
    }
    return artifact;
  }
}
