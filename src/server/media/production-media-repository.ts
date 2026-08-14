import "server-only";

import { createHash } from "node:crypto";
import type { MediaProductionAction } from "@/domain/media-production";
import { createSupabaseServerClient } from "@/server/supabase";
import { WorkflowError } from "@/server/orchestrator";
import { buildRenderInput } from "@/server/rendering/render-input-builder";
import type { MediaAssetVersionRecord } from "@/domain/media-production";
import type { MediaProductionSnapshot } from "@/domain/media-production";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class ProductionMediaRepository {
  async execute(ownerId: string, idempotencyKey: string, action: MediaProductionAction) {
    const client = await createSupabaseServerClient();
    let databaseAction: Record<string, unknown> = action;
    if (action.type === "CREATE_RENDER_JOB") {
      const scriptResult = await client.from("script_versions").select("id,video_project_id,version_number,script_payload").eq("video_project_id", action.videoId).eq("version_number", action.scriptVersion).maybeSingle();
      if (scriptResult.error || !scriptResult.data) throw new WorkflowError("Approved source script version not found", 404);
      const approvalResult = await client.from("script_approvals").select("id").eq("video_project_id", action.videoId).eq("script_version_id", scriptResult.data.id).eq("decision", "APPROVE").maybeSingle();
      if (approvalResult.error || !approvalResult.data) throw new WorkflowError("Rendering requires an approved exact script version", 409);
      const assetResult = action.assetVersionIds.length === 0
        ? { data: [], error: null }
        : await client.from("media_asset_versions").select("*").in("id", action.assetVersionIds);
      if (assetResult.error || assetResult.data.length !== action.assetVersionIds.length) throw new WorkflowError("One or more render assets are missing or unowned", 409);
      const assets = assetResult.data.map((row) => ({
        id: row.id, ownerId: row.owner_id, assetId: row.asset_id, version: row.version_number, kind: row.kind, status: row.status,
        provider: row.provider, provenance: row.provenance, rightsStatus: row.rights_status, checksumSha256: row.checksum_sha256,
        mimeType: row.mime_type, byteSize: row.byte_size, durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
        width: row.width, height: row.height, storageBucket: row.storage_bucket, storageKey: row.storage_key, createdAt: row.created_at,
      })) as MediaAssetVersionRecord[];
      databaseAction = { ...action, renderInput: buildRenderInput({ videoId: action.videoId, script: scriptResult.data.script_payload, assets }) };
    }
    const { data, error } = await client.rpc("execute_media_production_action", {
      p_idempotency_key: idempotencyKey,
      p_input_fingerprint: hash({ ownerId, action: databaseAction }),
      p_action: databaseAction,
    });
    if (error) {
      const status = error.message.includes("IDEMPOTENCY_CONFLICT") ? 409
        : error.message.includes("NOT_FOUND") ? 404
          : error.message.includes("NOT_ALLOWED") ? 409 : 500;
      throw new WorkflowError(error.message.replace(/^.*(?:IDEMPOTENCY_CONFLICT|NOT_FOUND|NOT_ALLOWED):?\s*/, ""), status);
    }
    return data;
  }

  async snapshot() {
    const client = await createSupabaseServerClient();
    const [assets, inputs, jobs, masters, inspections, qa] = await Promise.all([
      client.from("media_asset_versions").select("*").order("created_at", { ascending: false }),
      client.from("render_input_versions").select("*").order("created_at", { ascending: false }),
      client.from("render_jobs").select("*").order("created_at", { ascending: false }),
      client.from("production_master_versions").select("*").order("created_at", { ascending: false }),
      client.from("technical_media_inspections").select("*").order("created_at", { ascending: false }),
      client.from("media_qa_reports").select("*").order("created_at", { ascending: false }),
    ]);
    const firstError = [assets, inputs, jobs, masters, inspections, qa].find((result) => result.error)?.error;
    if (firstError) throw new WorkflowError(`Production media snapshot failed: ${firstError.message}`, 500);
    const mediaProduction: MediaProductionSnapshot = {
      evidence: "SUPABASE_DATABASE",
      assets: (assets.data ?? []).map((row) => ({ id: row.id, ownerId: row.owner_id, assetId: row.asset_id, version: row.version_number, kind: row.kind, status: row.status, provider: row.provider, provenance: row.provenance, rightsStatus: row.rights_status, checksumSha256: row.checksum_sha256, mimeType: row.mime_type, byteSize: Number(row.byte_size), durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds), width: row.width, height: row.height, storageBucket: row.storage_bucket, storageKey: row.storage_key, createdAt: row.created_at })),
      renderInputs: (inputs.data ?? []).map((row) => ({ id: row.id, ownerId: row.owner_id, videoId: row.video_project_id, version: row.version_number, sourceScriptVersion: row.source_script_version, inputHash: row.input_hash, input: row.input_payload, assetVersionIds: [], createdAt: row.created_at })),
      renderJobs: (jobs.data ?? []).map((row) => ({ id: row.id, ownerId: row.owner_id, renderInputId: row.render_input_id, status: row.status, attemptCount: row.attempt_count, maxAttempts: row.max_attempts, availableAt: row.available_at, leasedBy: row.leased_by, leaseExpiresAt: row.lease_expires_at, lastHeartbeatAt: row.last_heartbeat_at, cancellationRequestedAt: row.cancellation_requested_at, errorCode: row.error_code, errorMessage: row.error_message, createdAt: row.created_at, updatedAt: row.updated_at })),
      masters: (masters.data ?? []).map((row) => {
        const inspection = (inspections.data ?? []).find((item) => item.master_id === row.id);
        return {
          id: row.id, ownerId: row.owner_id, videoId: row.video_project_id, renderInputId: row.render_input_id, renderJobId: row.render_job_id,
          version: row.version_number, status: row.status, checksumSha256: row.checksum_sha256, mimeType: row.mime_type, byteSize: Number(row.byte_size),
          durationSeconds: Number(row.duration_seconds), storageBucket: row.storage_bucket, storageKey: row.storage_key, approvedAt: row.approved_at, createdAt: row.created_at,
          inspection: inspection ? { id: inspection.id, masterId: inspection.master_id, checksumSha256: inspection.checksum_sha256, container: inspection.container, videoCodec: inspection.video_codec, audioCodec: inspection.audio_codec, videoStreamCount: inspection.video_stream_count, audioStreamCount: inspection.audio_stream_count, width: inspection.width, height: inspection.height, frameRate: inspection.frame_rate === null ? null : Number(inspection.frame_rate), pixelFormat: inspection.pixel_format, durationSeconds: Number(inspection.duration_seconds), fileSize: Number(inspection.file_size), audioSampleRate: inspection.audio_sample_rate, audioChannels: inspection.audio_channels, integratedLoudnessLufs: inspection.integrated_loudness_lufs === null ? null : Number(inspection.integrated_loudness_lufs), truePeakDbfs: inspection.true_peak_dbfs === null ? null : Number(inspection.true_peak_dbfs), maxVolumeDbfs: inspection.max_volume_dbfs === null ? null : Number(inspection.max_volume_dbfs), silenceRatio: inspection.silence_ratio === null ? null : Number(inspection.silence_ratio), inspectedAt: inspection.created_at } : null,
          qaReports: (qa.data ?? []).filter((item) => item.master_id === row.id).filter((item, _index, reports) => !reports.some((candidate) => candidate.master_id === item.master_id && candidate.category === item.category && candidate.version_number > item.version_number)).map((item) => ({ id: item.id, masterId: item.master_id, category: item.category, verdict: item.verdict, automated: item.automated, findings: item.findings, createdAt: item.created_at })),
        };
      }),
    };
    return {
      channels: [], videos: [], buildProjects: [], products: [], agentRuns: [], auditEvents: [], conversationMessages: [],
      mediaProduction,
      capabilities: { workflowPlanning: false, mediaProduction: true, publishing: false },
    };
  }
}
