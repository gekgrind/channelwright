import { randomUUID } from "node:crypto";
import type { MediaInspectionRecord, QaReportRecord, RenderJobRecord } from "@/domain/media-production";
import type { RenderInput } from "@/video/schemas/render-input";

export interface ClaimedRenderJob extends RenderJobRecord {
  leaseToken: string;
  input: RenderInput;
  assets: Array<{ id: string; ownerId: string; storageKey: string; checksumSha256: string; mimeType: string; byteSize: number; status: "READY" | "QUARANTINED" | "FAILED"; rightsStatus: "UNKNOWN" | "PENDING" | "VERIFIED" | "RESTRICTED" | "REJECTED" }>;
}

export interface RenderCompletion {
  storageBucket: string;
  storageKey: string;
  checksumSha256: string;
  byteSize: number;
  durationSeconds: number;
  inspection: Omit<MediaInspectionRecord, "id" | "masterId" | "inspectedAt">;
  qaReports: Array<Omit<QaReportRecord, "id" | "masterId" | "createdAt">>;
}

export interface RenderQueue {
  claim(workerId: string, leaseSeconds: number): Promise<ClaimedRenderJob | null>;
  heartbeat(jobId: string, leaseToken: string, leaseSeconds: number): Promise<boolean>;
  complete(jobId: string, leaseToken: string, completion: RenderCompletion): Promise<{ masterId: string; version: number }>;
  fail(jobId: string, leaseToken: string, error: { code: string; message: string; retryable: boolean }): Promise<RenderJobRecord>;
}

interface MemoryJob extends RenderJobRecord {
  input: RenderInput;
  assets: ClaimedRenderJob["assets"];
  leaseToken: string | null;
  completedMaster: { masterId: string; version: number } | null;
}

export class MemoryRenderQueue implements RenderQueue {
  private readonly jobs = new Map<string, MemoryJob>();

  enqueue(input: RenderInput, ownerId = "0f802c92-fc5b-413f-bfbd-0a8b852cde44", maxAttempts = 3, assets: ClaimedRenderJob["assets"] = []) {
    const createdAt = new Date().toISOString();
    const job: MemoryJob = { id: randomUUID(), ownerId, renderInputId: randomUUID(), status: "QUEUED", attemptCount: 0, maxAttempts, availableAt: createdAt, leasedBy: null, leaseExpiresAt: null, lastHeartbeatAt: null, cancellationRequestedAt: null, errorCode: null, errorMessage: null, createdAt, updatedAt: createdAt, input, assets, leaseToken: null, completedMaster: null };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  get(jobId: string) { const job = this.jobs.get(jobId); return job ? structuredClone(job) : undefined; }

  async claim(workerId: string, leaseSeconds: number) {
    const currentTime = Date.now();
    for (const job of this.jobs.values()) {
      if (job.status === "LEASED" && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) <= currentTime) {
        job.status = job.attemptCount >= job.maxAttempts ? "FAILED" : "RETRY_WAIT";
        job.availableAt = new Date(currentTime).toISOString();
        job.leasedBy = null; job.leaseToken = null; job.leaseExpiresAt = null;
        job.errorCode = "LEASE_EXPIRED"; job.errorMessage = "Worker lease expired before completion";
      }
    }
    const job = [...this.jobs.values()]
      .filter((candidate) => ["QUEUED", "RETRY_WAIT"].includes(candidate.status) && Date.parse(candidate.availableAt) <= currentTime && candidate.attemptCount < candidate.maxAttempts)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!job) return null;
    job.status = "LEASED"; job.attemptCount += 1; job.leasedBy = workerId; job.leaseToken = randomUUID();
    job.lastHeartbeatAt = new Date(currentTime).toISOString(); job.leaseExpiresAt = new Date(currentTime + leaseSeconds * 1000).toISOString(); job.updatedAt = new Date(currentTime).toISOString();
    return structuredClone({ ...job, leaseToken: job.leaseToken });
  }

  async heartbeat(jobId: string, leaseToken: string, leaseSeconds: number) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "LEASED" || job.leaseToken !== leaseToken || (job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) <= Date.now())) return false;
    job.lastHeartbeatAt = new Date().toISOString(); job.leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    return true;
  }

  async complete(jobId: string, leaseToken: string, _completion?: RenderCompletion) {
    void _completion;
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("Render job not found");
    if (job.completedMaster) return structuredClone(job.completedMaster);
    if (job.status !== "LEASED" || job.leaseToken !== leaseToken) throw new Error("Render lease is not active");
    job.status = "SUCCEEDED"; job.leasedBy = null; job.leaseToken = null; job.leaseExpiresAt = null; job.updatedAt = new Date().toISOString();
    job.completedMaster = { masterId: randomUUID(), version: 1 };
    return structuredClone(job.completedMaster);
  }

  async fail(jobId: string, leaseToken: string, error: { code: string; message: string; retryable: boolean }) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "LEASED" || job.leaseToken !== leaseToken) throw new Error("Render lease is not active");
    const retry = error.retryable && job.attemptCount < job.maxAttempts;
    job.status = retry ? "RETRY_WAIT" : "FAILED";
    job.availableAt = new Date(Date.now() + (retry ? Math.min(60_000, 2 ** job.attemptCount * 1000) : 0)).toISOString();
    job.errorCode = error.code; job.errorMessage = error.message; job.leasedBy = null; job.leaseToken = null; job.leaseExpiresAt = null; job.updatedAt = new Date().toISOString();
    return structuredClone(job);
  }
}
