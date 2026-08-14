import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "@/domain/entities";
import { MemoryWorkspaceRepository } from "@/server/repository";
import { FixtureMediaOrchestrator } from "./fixture-media-orchestrator";

const ownerId = "0f802c92-fc5b-413f-bfbd-0a8b852cde44";
const videoId = "8fd692fa-20cb-46aa-a479-a78a6da26d64";

const repository = () => {
  const workspace = emptyWorkspace();
  workspace.videos.push({
    id: videoId, ownerId, channelId: "266deab1-ac67-4182-9596-d25ab6067a65", topic: "Transactional media production", state: "SCRIPT_APPROVED",
    scripts: [{ version: 1, title: "Durable rendering", hook: "A render is not a filename.", sections: [
      { heading: "Persist", purpose: "Explain", narration: "Persist the exact input.", claimRefs: [], estimatedSeconds: 2 },
      { heading: "Render", purpose: "Explain", narration: "Lease work outside the request.", claimRefs: [], estimatedSeconds: 2 },
      { heading: "Inspect", purpose: "Explain", narration: "Probe the actual media.", claimRefs: [], estimatedSeconds: 2 },
    ], cta: "Review the exact master.", outro: "Unknown checks remain blocked.", estimatedSeconds: 6 }],
    approvals: [{ id: "bc2a175d-0e03-455b-a91d-6f32487d5a95", decision: "APPROVE", scriptVersion: 1, createdAt: new Date().toISOString() }],
    distributionTargets: { youtube: true, tiktok: false, instagramFacebookReels: false }, platformArtifacts: [], platformApprovals: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  return new MemoryWorkspaceRepository(workspace);
};

describe("fixture media orchestration", () => {
  it("returns identical retries without duplicate inputs or jobs and conflicts on changed input", async () => {
    const store = repository(); const orchestrator = new FixtureMediaOrchestrator(store);
    const action = { type: "CREATE_RENDER_JOB" as const, videoId, scriptVersion: 1, assetVersionIds: [] };
    await orchestrator.execute(ownerId, "render-key", action);
    await orchestrator.execute(ownerId, "render-key", action);
    const snapshot = await store.load();
    expect(snapshot.mediaProduction.renderInputs).toHaveLength(1);
    expect(snapshot.mediaProduction.renderJobs).toHaveLength(1);
    await expect(orchestrator.execute(ownerId, "render-key", { ...action, scriptVersion: 2 })).rejects.toMatchObject({ status: 409 });
  });

  it("does not expose another owner's approved video", async () => {
    const orchestrator = new FixtureMediaOrchestrator(repository());
    await expect(orchestrator.execute("263e9110-e6c6-47dd-a334-c957abfca79b", "other", { type: "CREATE_RENDER_JOB", videoId, scriptVersion: 1, assetVersionIds: [] })).rejects.toMatchObject({ status: 404 });
  });
});
