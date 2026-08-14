import { createSupabaseAdminClient } from "@/server/supabase-admin";
import type { RenderQueue, RenderCompletion } from "./render-queue";

export class ProductionRenderQueue implements RenderQueue {
  async claim(workerId: string, leaseSeconds: number) {
    const { data, error } = await createSupabaseAdminClient().rpc("claim_render_job", { p_worker_id: workerId, p_lease_seconds: leaseSeconds });
    if (error) throw new Error(`Render claim failed: ${error.message}`);
    return data ?? null;
  }

  async heartbeat(jobId: string, leaseToken: string, leaseSeconds: number) {
    const { data, error } = await createSupabaseAdminClient().rpc("heartbeat_render_job", { p_job_id: jobId, p_lease_token: leaseToken, p_lease_seconds: leaseSeconds });
    if (error) throw new Error(`Render heartbeat failed: ${error.message}`);
    return Boolean(data);
  }

  async complete(jobId: string, leaseToken: string, completion: RenderCompletion) {
    const { data, error } = await createSupabaseAdminClient().rpc("complete_render_job", { p_job_id: jobId, p_lease_token: leaseToken, p_completion: completion });
    if (error) throw new Error(`Render finalization failed: ${error.message}`);
    return data as { masterId: string; version: number };
  }

  async fail(jobId: string, leaseToken: string, failure: { code: string; message: string; retryable: boolean }) {
    const { data, error } = await createSupabaseAdminClient().rpc("fail_render_job", { p_job_id: jobId, p_lease_token: leaseToken, p_error_code: failure.code, p_error_message: failure.message.slice(0, 4000), p_retryable: failure.retryable });
    if (error) throw new Error(`Render failure persistence failed: ${error.message}`);
    return data;
  }
}
