import "server-only";

import {
  approvedResearchArtifactSchema,
  approvedResearchReferenceSchema,
  type ApprovedResearchArtifact,
  type ApprovedResearchReference,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

export interface ApprovedResearchResolver {
  resolve(workflowId: string, runId: string, expected: ApprovedResearchReference): Promise<ApprovedResearchArtifact>;
}

export class ApprovedResearchIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

export class SupabaseApprovedResearchResolver implements ApprovedResearchResolver {
  async resolve(workflowId: string, runId: string, expected: ApprovedResearchReference) {
    const { data, error } = await createSupabaseAdminClient().rpc("resolve_approved_research_artifact", {
      p_workflow_id: workflowId,
      p_run_id: runId,
    });
    if (error) throw new ApprovedResearchIntegrityError("APPROVED_RESEARCH_INVALID", "The exact approved research artifact could not be revalidated.");
    const artifact = approvedResearchArtifactSchema.parse(data);
    const persisted = approvedResearchReferenceSchema.parse(expected);
    if (!canonicalEquals(artifact.reference, persisted)) {
      throw new ApprovedResearchIntegrityError("UPSTREAM_RESEARCH_INTEGRITY_MISMATCH", "The persisted approved-research reference no longer matches authoritative state.");
    }
    return artifact;
  }
}
