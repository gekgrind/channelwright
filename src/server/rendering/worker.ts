import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ObjectStorage } from "@/server/media/storage";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH, calculateDurationInFrames } from "@/video/schemas/render-input";
import { resolveRenderAssets } from "./asset-resolver";
import { evaluateTechnicalMediaQa, inspectMedia } from "./media-inspection";
import { renderVideo } from "./render-video";
import type { ClaimedRenderJob, RenderQueue } from "./render-queue";
import { readWorkerQaConfig } from "./config";

const log = (event: string, detail: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));

export interface WorkerOptions { workerId: string; leaseSeconds: number; workRoot?: string }

export async function processRenderJob(job: ClaimedRenderJob, queue: RenderQueue, storage: ObjectStorage, options: WorkerOptions) {
  const workRoot = path.resolve(options.workRoot ?? process.env.RENDER_WORK_ROOT ?? path.join(process.cwd(), ".data", "render-work"));
  const workspace = path.resolve(workRoot, job.id);
  const relative = path.relative(workRoot, workspace);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unsafe render workspace path");
  const publicDirectory = path.join(workspace, "public"); const outputPath = path.join(workspace, "output", "master.mp4");
  await mkdir(publicDirectory, { recursive: true });
  let leaseActive = true;
  const heartbeat = setInterval(() => {
    void queue.heartbeat(job.id, job.leaseToken, options.leaseSeconds).then((active) => { leaseActive = active; }).catch(() => { leaseActive = false; });
  }, Math.max(1_000, Math.floor(options.leaseSeconds * 1000 / 3)));
  try {
    log("render_job_started", { jobId: job.id, attempt: job.attemptCount, workerId: options.workerId, storageEvidence: storage.evidence });
    const resolvedInput = await resolveRenderAssets(job, storage, publicDirectory);
    await renderVideo(resolvedInput, outputPath, { publicDir: publicDirectory });
    if (!leaseActive || !(await queue.heartbeat(job.id, job.leaseToken, options.leaseSeconds))) throw new Error("Render lease was lost before durable finalization");
    const inspection = await inspectMedia(outputPath);
    const expectedDuration = calculateDurationInFrames(resolvedInput) / VIDEO_FPS;
    const qaConfig = readWorkerQaConfig();
    const technicalQa = evaluateTechnicalMediaQa(inspection, { width: VIDEO_WIDTH, height: VIDEO_HEIGHT, fps: VIDEO_FPS, durationSeconds: expectedDuration, audioRequired: resolvedInput.audioTracks.length > 0, ...qaConfig });
    const bytes = await readFile(outputPath);
    const stored = await storage.putVerified({ ownerId: job.ownerId, bytes, contentType: "video/mp4", expectedChecksumSha256: inspection.checksumSha256, purpose: "masters" });
    try {
      const allRightsVerified = job.assets.every((asset) => asset.rightsStatus === "VERIFIED");
      const result = await queue.complete(job.id, job.leaseToken, {
        storageBucket: stored.bucket, storageKey: stored.key, checksumSha256: stored.checksumSha256,
        byteSize: stored.byteSize, durationSeconds: inspection.durationSeconds,
        inspection: { ...inspection, id: undefined, masterId: undefined, inspectedAt: undefined } as never,
        qaReports: [
          { category: "TECHNICAL", verdict: technicalQa.verdict, automated: true, findings: technicalQa.findings },
          { category: "RIGHTS", verdict: allRightsVerified ? "PASS" : "BLOCKED", automated: true, findings: allRightsVerified ? [] : [{ code: "RIGHTS_UNVERIFIED", severity: "BLOCKER", message: "Every source asset requires verified provenance and rights" }] },
          { category: "CONTENT", verdict: "UNKNOWN", automated: false, findings: [{ code: "CONTENT_REVIEW_REQUIRED", severity: "BLOCKER", message: "Claims and content require exact-version review" }] },
          { category: "VISUAL", verdict: "UNKNOWN", automated: false, findings: [{ code: "VISUAL_REVIEW_REQUIRED", severity: "BLOCKER", message: "Subjective visual quality has not been reviewed" }] },
          { category: "AUDIO", verdict: resolvedInput.audioTracks.length === 0 ? "PASS" : "UNKNOWN", automated: false, findings: resolvedInput.audioTracks.length === 0 ? [] : [{ code: "AUDIO_REVIEW_REQUIRED", severity: "BLOCKER", message: "Technical measurements do not establish subjective audio quality" }] },
          { category: "PLATFORM", verdict: "UNKNOWN", automated: false, findings: [{ code: "PLATFORM_QA_REQUIRED", severity: "BLOCKER", message: "Platform-specific QA has not been performed" }] },
        ],
      });
      log("render_job_completed", { jobId: job.id, masterId: result.masterId, masterVersion: result.version, technicalVerdict: technicalQa.verdict });
      return result;
    } catch (error) {
      // Completion may have committed even if its response was lost. Keep the immutable object for reconciliation.
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown render failure";
    await queue.fail(job.id, job.leaseToken, { code: "RENDER_ATTEMPT_FAILED", message, retryable: !message.includes("ownership") && !message.includes("rights") && !message.includes("unsupported") }).catch((persistenceError) => log("render_failure_persistence_failed", { jobId: job.id, message: persistenceError instanceof Error ? persistenceError.message : "unknown" }));
    log("render_job_failed", { jobId: job.id, attempt: job.attemptCount, message });
    throw error;
  } finally {
    clearInterval(heartbeat);
    const cleanupRelative = path.relative(workRoot, workspace);
    if (cleanupRelative && !cleanupRelative.startsWith("..") && !path.isAbsolute(cleanupRelative)) await rm(workspace, { recursive: true, force: true });
  }
}
