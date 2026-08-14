import { z } from "zod";
import type { RenderInput } from "@/video/schemas/render-input";

export const assetKindSchema = z.enum(["IMAGE", "VIDEO", "NARRATION", "MUSIC", "OTHER"]);
export const assetStatusSchema = z.enum(["UPLOADING", "READY", "QUARANTINED", "FAILED"]);
export const rightsStatusSchema = z.enum(["UNKNOWN", "PENDING", "VERIFIED", "RESTRICTED", "REJECTED"]);
export const renderJobStatusSchema = z.enum(["QUEUED", "LEASED", "RETRY_WAIT", "SUCCEEDED", "FAILED", "CANCELLED"]);
export const masterStatusSchema = z.enum(["INSPECTION_PENDING", "QA_BLOCKED", "REVIEW_REQUIRED", "APPROVED", "EXPORT_READY"]);
export const qaCategorySchema = z.enum(["TECHNICAL", "RIGHTS", "CONTENT", "VISUAL", "AUDIO", "PLATFORM"]);
export const qaVerdictSchema = z.enum(["PASS", "FAIL", "BLOCKED", "UNKNOWN"]);

export const mediaProductionActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CREATE_RENDER_JOB"),
    videoId: z.string().uuid(),
    scriptVersion: z.number().int().positive(),
    assetVersionIds: z.array(z.string().uuid()).max(256).default([]),
  }),
  z.object({ type: z.literal("RETRY_RENDER_JOB"), jobId: z.string().uuid() }),
  z.object({ type: z.literal("CANCEL_RENDER_JOB"), jobId: z.string().uuid() }),
  z.object({
    type: z.literal("RECORD_MASTER_QA"), masterId: z.string().uuid(), masterVersion: z.number().int().positive(),
    category: z.enum(["RIGHTS", "CONTENT", "VISUAL", "AUDIO", "PLATFORM"]), verdict: z.enum(["PASS", "FAIL", "BLOCKED"]),
    finding: z.string().trim().min(3).max(2000),
  }),
  z.object({ type: z.literal("APPROVE_PRODUCTION_MASTER"), masterId: z.string().uuid(), masterVersion: z.number().int().positive() }),
]);

export type MediaProductionAction = z.infer<typeof mediaProductionActionSchema>;

export interface MediaAssetVersionRecord {
  id: string;
  ownerId: string;
  assetId: string;
  version: number;
  kind: z.infer<typeof assetKindSchema>;
  status: z.infer<typeof assetStatusSchema>;
  provider: string;
  provenance: Record<string, unknown>;
  rightsStatus: z.infer<typeof rightsStatusSchema>;
  checksumSha256: string;
  mimeType: string;
  byteSize: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  storageBucket: string;
  storageKey: string;
  createdAt: string;
}

export interface RenderInputVersionRecord {
  id: string;
  ownerId: string;
  videoId: string;
  version: number;
  sourceScriptVersion: number;
  inputHash: string;
  input: RenderInput;
  assetVersionIds: string[];
  createdAt: string;
}

export interface RenderJobRecord {
  id: string;
  ownerId: string;
  renderInputId: string;
  status: z.infer<typeof renderJobStatusSchema>;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  leasedBy: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  cancellationRequestedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaInspectionRecord {
  id: string;
  masterId: string;
  checksumSha256: string;
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
  videoStreamCount: number;
  audioStreamCount: number;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  pixelFormat: string | null;
  durationSeconds: number;
  fileSize: number;
  audioSampleRate: number | null;
  audioChannels: number | null;
  integratedLoudnessLufs: number | null;
  truePeakDbfs: number | null;
  maxVolumeDbfs: number | null;
  silenceRatio: number | null;
  inspectedAt: string;
}

export interface QaReportRecord {
  id: string;
  masterId: string;
  category: z.infer<typeof qaCategorySchema>;
  verdict: z.infer<typeof qaVerdictSchema>;
  automated: boolean;
  findings: Array<{ code: string; severity: "INFO" | "WARNING" | "BLOCKER"; message: string }>;
  createdAt: string;
}

export interface ProductionMasterRecord {
  id: string;
  ownerId: string;
  videoId: string;
  renderInputId: string;
  renderJobId: string;
  version: number;
  status: z.infer<typeof masterStatusSchema>;
  checksumSha256: string;
  mimeType: "video/mp4";
  byteSize: number;
  durationSeconds: number;
  storageBucket: string;
  storageKey: string;
  inspection: MediaInspectionRecord | null;
  qaReports: QaReportRecord[];
  approvedAt: string | null;
  createdAt: string;
}

export interface MediaProductionSnapshot {
  assets: MediaAssetVersionRecord[];
  renderInputs: RenderInputVersionRecord[];
  renderJobs: RenderJobRecord[];
  masters: ProductionMasterRecord[];
  evidence: "FIXTURE" | "LOCAL_FILESYSTEM" | "SUPABASE_DATABASE";
}

export const emptyMediaProduction = (evidence: MediaProductionSnapshot["evidence"] = "FIXTURE"): MediaProductionSnapshot => ({
  assets: [], renderInputs: [], renderJobs: [], masters: [], evidence,
});

export const isMediaProductionAction = (value: { type: string }): value is MediaProductionAction =>
  ["CREATE_RENDER_JOB", "RETRY_RENDER_JOB", "CANCEL_RENDER_JOB", "RECORD_MASTER_QA", "APPROVE_PRODUCTION_MASTER"].includes(value.type);
