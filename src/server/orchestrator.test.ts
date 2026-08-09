import { describe, expect, it } from "vitest";
import { ChannelwrightOrchestrator, WorkflowError } from "./orchestrator";
import { MemoryWorkspaceRepository } from "./repository";
import { reviewPlatformPackage } from "./agents/fixtures";

const preferences = {
  name: "Systems Lab", niche: "Business", targetAudience: "Independent founders",
  videoStyle: "Editorial documentary", preferredVoice: "Measured", targetDurationMinutes: 10,
  postingFrequency: "Weekly", monetizationGoal: "Sponsors", language: "English", productionComplexity: "BALANCED" as const,
  distributionTargets: { youtube: true as const, tiktok: false, instagramFacebookReels: false },
};
const run = () => new ChannelwrightOrchestrator(new MemoryWorkspaceRepository());

describe("channel orchestration", () => {
  it("advances GO to a persisted strategy", async () => {
    const result = await run().execute("user-1", "go-1", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences });
    expect(result.channels[0].state).toBe("READY_FOR_VIDEO_PRODUCTION");
    expect(result.channels[0].strategy?.contentPillars).toHaveLength(3);
  });

  it.each(["Fixture caution concept", "Daily AI News"])("pauses %s for human review", async (concept) => {
    const result = await run().execute("user-1", `pause-${concept}`, { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept, preferences });
    expect(result.channels[0].state).toBe("CONCEPT_REVIEW_REQUIRED");
  });

  it("persists an override separately from STOP", async () => {
    const orchestrator = run();
    const created = await orchestrator.execute("user-1", "stop", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Daily AI News", preferences });
    const channel = created.channels[0];
    const result = await orchestrator.execute("user-1", "override", { type: "CONCEPT_DECISION", channelId: channel.id, decision: "OVERRIDE_AND_CONTINUE" });
    expect(result.channels[0].state).toBe("READY_FOR_VIDEO_PRODUCTION");
    expect(result.channels[0].decisions[0]).toMatchObject({ systemRecommendation: "STOP_RECOMMENDED", decision: "OVERRIDE_AND_CONTINUE" });
  });

  it("revises without destroying version history", async () => {
    const orchestrator = run();
    const created = await orchestrator.execute("user-1", "stop", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Daily AI News", preferences });
    const result = await orchestrator.execute("user-1", "revise", { type: "REVISE_CONCEPT", channelId: created.channels[0].id, concept: "AI operations explained for independent retailers" });
    expect(result.channels[0].concepts).toHaveLength(2);
    expect(result.channels[0].concepts.map((item) => item.version)).toEqual([1, 2]);
  });

  it("discovers multiple candidates and requires selection", async () => {
    const result = await run().execute("user-1", "discover", { type: "CREATE_CHANNEL", mode: "AGENT_DISCOVERED", preferences });
    expect(result.channels[0].state).toBe("CONCEPT_SELECTION_REQUIRED");
    expect(result.channels[0].candidates).toHaveLength(3);
  });

  it("switches a rejected user concept into discovery without restarting setup", async () => {
    const orchestrator = run();
    const created = await orchestrator.execute("user-1", "stop-to-discovery", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Daily AI News", preferences });
    const result = await orchestrator.execute("user-1", "alternatives", { type: "CONCEPT_DECISION", channelId: created.channels[0].id, decision: "REQUEST_ALTERNATIVES" });
    expect(result.channels[0].state).toBe("CONCEPT_SELECTION_REQUIRED");
    expect(result.channels[0].decisions[0]).toMatchObject({ systemRecommendation: "STOP_RECOMMENDED", decision: "REQUEST_ALTERNATIVES" });
    expect(result.channels[0].preferences.targetAudience).toBe("Independent founders");
  });

  it("is idempotent and detects key reuse", async () => {
    const orchestrator = run();
    await orchestrator.execute("user-1", "same", { type: "CREATE_CHANNEL", mode: "AGENT_DISCOVERED", preferences });
    const repeated = await orchestrator.execute("user-1", "same", { type: "CREATE_CHANNEL", mode: "AGENT_DISCOVERED", preferences });
    expect(repeated.channels).toHaveLength(1);
    await expect(orchestrator.execute("user-1", "same", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "A sufficiently detailed different concept", preferences })).rejects.toBeInstanceOf(WorkflowError);
  });

  it("scopes idempotency and activity history to the authenticated owner", async () => {
    const orchestrator = run();
    await orchestrator.execute("user-1", "shared-key", { type: "CREATE_CHANNEL", mode: "AGENT_DISCOVERED", preferences });
    await orchestrator.execute("user-2", "shared-key", { type: "CREATE_CHANNEL", mode: "AGENT_DISCOVERED", preferences: { ...preferences, name: "Second Studio" } });

    const first = await orchestrator.snapshot("user-1");
    const second = await orchestrator.snapshot("user-2");
    expect(first.channels).toHaveLength(1);
    expect(second.channels).toHaveLength(1);
    expect(first.agentRuns).toHaveLength(1);
    expect(second.agentRuns).toHaveLength(1);
    expect(first.agentRuns.every((item) => item.ownerId === "user-1")).toBe(true);
    expect(second.agentRuns.every((item) => item.ownerId === "user-2")).toBe(true);
    expect(first.auditEvents.every((item) => item.ownerId === "user-1")).toBe(true);
    expect(second.auditEvents.every((item) => item.ownerId === "user-2")).toBe(true);
  });
});

describe("video orchestration", () => {
  it("runs through QA, pauses for approval, and versions requested changes", async () => {
    const orchestrator = run();
    const ready = await orchestrator.execute("user-1", "channel", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences });
    const videoResult = await orchestrator.execute("user-1", "video", { type: "CREATE_VIDEO", channelId: ready.channels[0].id, topic: "Why loyalty programs change customer behavior" });
    expect(videoResult.videos[0].state).toBe("SCRIPT_REVIEW_REQUIRED");
    const revised = await orchestrator.execute("user-1", "revise-script", { type: "SCRIPT_DECISION", videoId: videoResult.videos[0].id, decision: "REQUEST_CHANGES", feedback: "Make the opening more concrete" });
    expect(revised.videos[0].scripts.map((script) => script.version)).toEqual([1, 2]);
    const approved = await orchestrator.execute("user-1", "approve", { type: "SCRIPT_DECISION", videoId: revised.videos[0].id, decision: "APPROVE" });
    expect(approved.videos[0].state).toBe("SCRIPT_APPROVED");
  });

  it("freezes inherited targets without retroactive channel mutation", async () => {
    const repository = new MemoryWorkspaceRepository();
    const orchestrator = new ChannelwrightOrchestrator(repository);
    const selected = { ...preferences, distributionTargets: { youtube: true as const, tiktok: true, instagramFacebookReels: false } };
    const ready = await orchestrator.execute("user-1", "target-channel", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences: selected });
    const created = await orchestrator.execute("user-1", "target-video", { type: "CREATE_VIDEO", channelId: ready.channels[0].id, topic: "Why loyalty programs change customer behavior" });
    const stored = await repository.load();
    stored.channels[0].preferences.distributionTargets = { youtube: true, tiktok: false, instagramFacebookReels: true };
    await repository.save(stored);
    const snapshot = await orchestrator.snapshot("user-1");
    expect(created.videos[0].distributionTargets).toEqual(selected.distributionTargets);
    expect(snapshot.videos[0].distributionTargets).toEqual(selected.distributionTargets);
  });

  it("creates only selected plans after script approval and keeps platform packages distinct", async () => {
    const orchestrator = run();
    const selected = { ...preferences, distributionTargets: { youtube: true as const, tiktok: true, instagramFacebookReels: true } };
    const ready = await orchestrator.execute("user-1", "both-channel", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences: selected });
    const created = await orchestrator.execute("user-1", "both-video", { type: "CREATE_VIDEO", channelId: ready.channels[0].id, topic: "Why loyalty programs change customer behavior" });
    expect(created.videos[0].platformArtifacts).toHaveLength(0);
    const approved = await orchestrator.execute("user-1", "both-approve", { type: "SCRIPT_DECISION", videoId: created.videos[0].id, decision: "APPROVE" });
    const artifacts = approved.videos[0].platformArtifacts;
    expect(artifacts.map((artifact) => artifact.target)).toEqual(["TIKTOK", "INSTAGRAM_FACEBOOK_REELS"]);
    expect(artifacts.every((artifact) => artifact.status === "REVIEW_REQUIRED" && artifact.fixture)).toBe(true);
    expect(artifacts[0].package?.hook).not.toBe(artifacts[1].package?.hook);
    expect(artifacts[0].package).toHaveProperty("platformCaption");
    expect(artifacts[1].package).toHaveProperty("instagramCaption");
  });

  it("keeps YouTube-only orchestration unchanged", async () => {
    const orchestrator = run();
    const ready = await orchestrator.execute("user-1", "youtube-channel", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences });
    const created = await orchestrator.execute("user-1", "youtube-video", { type: "CREATE_VIDEO", channelId: ready.channels[0].id, topic: "Why loyalty programs change customer behavior" });
    const approved = await orchestrator.execute("user-1", "youtube-approve", { type: "SCRIPT_DECISION", videoId: created.videos[0].id, decision: "APPROVE" });
    expect(approved.videos[0].state).toBe("SCRIPT_APPROVED");
    expect(approved.videos[0].platformArtifacts).toHaveLength(0);
  });

  it("versions requested platform changes and binds approval to the exact artifact version", async () => {
    const orchestrator = run();
    const selected = { ...preferences, distributionTargets: { youtube: true as const, tiktok: true, instagramFacebookReels: false } };
    const ready = await orchestrator.execute("user-1", "version-channel", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences: selected });
    const created = await orchestrator.execute("user-1", "version-video", { type: "CREATE_VIDEO", channelId: ready.channels[0].id, topic: "Why loyalty programs change customer behavior" });
    const planned = await orchestrator.execute("user-1", "version-script", { type: "SCRIPT_DECISION", videoId: created.videos[0].id, decision: "APPROVE" });
    const videoId = planned.videos[0].id;
    const revised = await orchestrator.execute("user-1", "version-revise", { type: "PLATFORM_ARTIFACT_DECISION", videoId, target: "TIKTOK", artifactVersion: 1, decision: "REQUEST_CHANGES", feedback: "Make the first beat more concrete" });
    expect(revised.videos[0].platformArtifacts.map((artifact) => artifact.version)).toEqual([1, 2]);
    await expect(orchestrator.execute("user-1", "stale-approve", { type: "PLATFORM_ARTIFACT_DECISION", videoId, target: "TIKTOK", artifactVersion: 1, decision: "APPROVE" })).rejects.toMatchObject({ status: 409 });
    const approved = await orchestrator.execute("user-1", "version-approve", { type: "PLATFORM_ARTIFACT_DECISION", videoId, target: "TIKTOK", artifactVersion: 2, decision: "APPROVE" });
    expect(approved.videos[0].platformArtifacts.at(-1)?.status).toBe("APPROVED");
    expect(approved.videos[0].platformApprovals.at(-1)).toMatchObject({ artifactVersion: 2, sourceScriptVersion: 1, decision: "APPROVE" });
  });

  it("does not duplicate a platform decision on idempotent retry and rejects cross-owner access", async () => {
    const orchestrator = run();
    const selected = { ...preferences, distributionTargets: { youtube: true as const, tiktok: true, instagramFacebookReels: false } };
    const ready = await orchestrator.execute("user-1", "retry-channel", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences: selected });
    const created = await orchestrator.execute("user-1", "retry-video", { type: "CREATE_VIDEO", channelId: ready.channels[0].id, topic: "Why loyalty programs change customer behavior" });
    const planned = await orchestrator.execute("user-1", "retry-script", { type: "SCRIPT_DECISION", videoId: created.videos[0].id, decision: "APPROVE" });
    const action = { type: "PLATFORM_ARTIFACT_DECISION" as const, videoId: planned.videos[0].id, target: "TIKTOK" as const, artifactVersion: 1, decision: "APPROVE" as const };
    await orchestrator.execute("user-1", "same-platform-decision", action);
    const repeated = await orchestrator.execute("user-1", "same-platform-decision", action);
    expect(repeated.videos[0].platformApprovals).toHaveLength(1);
    await expect(orchestrator.execute("user-2", "foreign-platform-decision", action)).rejects.toMatchObject({ status: 404 });
  });

  it("fails unsupported-claim QA for one package without invalidating the other", async () => {
    const orchestrator = run();
    const selected = { ...preferences, distributionTargets: { youtube: true as const, tiktok: true, instagramFacebookReels: true } };
    const ready = await orchestrator.execute("user-1", "qa-channel", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences: selected });
    const created = await orchestrator.execute("user-1", "qa-video", { type: "CREATE_VIDEO", channelId: ready.channels[0].id, topic: "Why loyalty programs change customer behavior" });
    const planned = await orchestrator.execute("user-1", "qa-script", { type: "SCRIPT_DECISION", videoId: created.videos[0].id, decision: "APPROVE" });
    const video = planned.videos[0];
    const tiktok = structuredClone(video.platformArtifacts[0].package!);
    tiktok.claimReferences = ["unsupported-claim"];
    expect(reviewPlatformPackage(tiktok, video.research!).verdict).toBe("REVISE");
    expect(video.platformArtifacts[1].qa?.verdict).toBe("PASS");
    expect(video.platformArtifacts[1].status).toBe("REVIEW_REQUIRED");
  });
});
