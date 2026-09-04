import "server-only";

import {
  approvedVideoPerformanceArtifactSchema,
  approvedVideoPerformanceReferenceSchema,
  type ApprovedVideoPerformanceArtifact,
  type ApprovedVideoPerformanceReference,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

export interface ApprovedPerformanceResolver {
  resolve(workflowId: string, runId: string, expected: ApprovedVideoPerformanceReference): Promise<ApprovedVideoPerformanceArtifact>;
}

export class ApprovedPerformanceIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

export class SupabaseApprovedPerformanceResolver implements ApprovedPerformanceResolver {
  async resolve(workflowId: string, runId: string, expected: ApprovedVideoPerformanceReference) {
    const { data, error } = await createSupabaseAdminClient().rpc("resolve_approved_video_performance_artifact", {
      p_workflow_id: workflowId,
      p_run_id: runId,
    });
    if (error) throw new ApprovedPerformanceIntegrityError("APPROVED_PERFORMANCE_INVALID", "The exact approved video-performance artifact could not be revalidated.");
    const artifact = approvedVideoPerformanceArtifactSchema.parse(data);
    const persisted = approvedVideoPerformanceReferenceSchema.parse(expected);
    if (!canonicalEquals(artifact.reference, persisted)) {
      throw new ApprovedPerformanceIntegrityError("UPSTREAM_PERFORMANCE_INTEGRITY_MISMATCH", "The persisted approved Performance reference no longer matches authoritative database state.");
    }
    return artifact;
  }
}
