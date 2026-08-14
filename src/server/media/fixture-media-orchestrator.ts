import { createHash, randomUUID } from "node:crypto";
import type { MediaProductionAction } from "@/domain/media-production";
import { buildRenderInput } from "@/server/rendering/render-input-builder";
import type { WorkspaceRepository } from "@/server/repository";
import { WorkflowError } from "@/server/orchestrator";

const now = () => new Date().toISOString();
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class FixtureMediaOrchestrator {
  constructor(private readonly repository: WorkspaceRepository) {}

  async execute(ownerId: string, idempotencyKey: string, action: MediaProductionAction) {
    const workspace = await this.repository.load();
    const scopedKey = `${ownerId}:${idempotencyKey}`;
    const inputFingerprint = fingerprint({ ownerId, action });
    const prior = workspace.idempotency[scopedKey];
    if (prior) {
      if (prior.fingerprint !== inputFingerprint) throw new WorkflowError("Idempotency key was already used for a different request", 409);
      return this.ownerSnapshot(workspace, ownerId);
    }

    if (action.type === "CREATE_RENDER_JOB") {
      const video = workspace.videos.find((item) => item.id === action.videoId && item.ownerId === ownerId);
      if (!video) throw new WorkflowError("Video project not found", 404);
      const script = video.scripts.find((item) => item.version === action.scriptVersion);
      const approval = video.approvals.find((item) => item.scriptVersion === action.scriptVersion && item.decision === "APPROVE");
      if (!script || !approval || video.state !== "SCRIPT_APPROVED") throw new WorkflowError("Rendering requires an approved exact script version", 409);
      const selectedAssets = action.assetVersionIds.map((id) => workspace.mediaProduction.assets.find((asset) => asset.id === id && asset.ownerId === ownerId));
      if (selectedAssets.some((asset) => !asset || asset.status !== "READY" || asset.rightsStatus !== "VERIFIED")) throw new WorkflowError("Every render asset must be owned, ready, and rights-verified", 409);

      const input = buildRenderInput({ videoId: video.id, script, assets: selectedAssets.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)) });
      const version = workspace.mediaProduction.renderInputs.filter((item) => item.videoId === video.id).length + 1;
      const createdAt = now();
      const renderInputId = randomUUID();
      workspace.mediaProduction.renderInputs.push({ id: renderInputId, ownerId, videoId: video.id, version, sourceScriptVersion: script.version, inputHash: fingerprint(input), input, assetVersionIds: action.assetVersionIds, createdAt });
      workspace.mediaProduction.renderJobs.push({ id: randomUUID(), ownerId, renderInputId, status: "QUEUED", attemptCount: 0, maxAttempts: 3, availableAt: createdAt, leasedBy: null, leaseExpiresAt: null, lastHeartbeatAt: null, cancellationRequestedAt: null, errorCode: null, errorMessage: null, createdAt, updatedAt: createdAt });
    } else {
      const job = "jobId" in action ? workspace.mediaProduction.renderJobs.find((item) => item.id === action.jobId && item.ownerId === ownerId) : undefined;
      if (action.type === "RETRY_RENDER_JOB") {
        if (!job) throw new WorkflowError("Render job not found", 404);
        if (!["FAILED", "RETRY_WAIT"].includes(job.status)) throw new WorkflowError("Only a failed or waiting render can be retried", 409);
        Object.assign(job, { status: "QUEUED" as const, availableAt: now(), leasedBy: null, leaseExpiresAt: null, errorCode: null, errorMessage: null, updatedAt: now() });
      } else if (action.type === "CANCEL_RENDER_JOB") {
        if (!job) throw new WorkflowError("Render job not found", 404);
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status)) throw new WorkflowError("The render job is already final", 409);
        Object.assign(job, { status: "CANCELLED" as const, cancellationRequestedAt: now(), leasedBy: null, leaseExpiresAt: null, updatedAt: now() });
      } else if (action.type === "RECORD_MASTER_QA") {
        const master = workspace.mediaProduction.masters.find((item) => item.id === action.masterId && item.ownerId === ownerId && item.version === action.masterVersion);
        if (!master) throw new WorkflowError("Production master version not found", 404);
        master.qaReports = master.qaReports.filter((report) => report.category !== action.category);
        master.qaReports.push({ id: randomUUID(), masterId: master.id, category: action.category, verdict: action.verdict, automated: false, findings: [{ code: "HUMAN_REVIEW", severity: action.verdict === "PASS" ? "INFO" : "BLOCKER", message: action.finding }], createdAt: now() });
        master.status = master.qaReports.length === 6 && master.qaReports.every((report) => report.verdict === "PASS") ? "REVIEW_REQUIRED" : "QA_BLOCKED";
      } else {
        const master = workspace.mediaProduction.masters.find((item) => item.id === action.masterId && item.ownerId === ownerId && item.version === action.masterVersion);
        if (!master) throw new WorkflowError("Production master version not found", 404);
        if (master.qaReports.some((report) => report.verdict !== "PASS")) throw new WorkflowError("Every required QA category must pass before exact-version approval", 409);
        Object.assign(master, { status: "EXPORT_READY" as const, approvedAt: now() });
      }
    }

    workspace.idempotency[scopedKey] = { fingerprint: inputFingerprint, completedAt: now() };
    await this.repository.save(workspace);
    return this.ownerSnapshot(workspace, ownerId);
  }

  private ownerSnapshot(workspace: Awaited<ReturnType<WorkspaceRepository["load"]>>, ownerId: string) {
    return {
      mediaProduction: {
        ...workspace.mediaProduction,
        assets: workspace.mediaProduction.assets.filter((item) => item.ownerId === ownerId),
        renderInputs: workspace.mediaProduction.renderInputs.filter((item) => item.ownerId === ownerId),
        renderJobs: workspace.mediaProduction.renderJobs.filter((item) => item.ownerId === ownerId),
        masters: workspace.mediaProduction.masters.filter((item) => item.ownerId === ownerId),
      },
    };
  }
}
