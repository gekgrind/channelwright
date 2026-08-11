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
const createReadyChannel = async (orchestrator: ChannelwrightOrchestrator, key: string, channelPreferences = preferences) => {
  const pending = await orchestrator.execute("user-1", `${key}-channel`, { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences: channelPreferences });
  return orchestrator.execute("user-1", `${key}-strategy-approve`, { type: "BUSINESS_STRATEGY_DECISION", channelId: pending.channels[0].id, strategyVersion: 1, decision: "APPROVE" });
};

describe("channel orchestration", () => {
  it("advances GO to a persisted three-fundamentals strategy and human gate", async () => {
    const result = await run().execute("user-1", "go-1", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences });
    expect(result.channels[0].state).toBe("BUSINESS_STRATEGY_REVIEW_REQUIRED");
    expect(result.channels[0].strategy?.contentPillars).toHaveLength(3);
    expect(result.channels[0].businessStrategies[0].strategy.freeResourceOptions).toHaveLength(3);
    expect(result.channels[0].businessStrategies[0].strategy.paidProductOptions).toHaveLength(2);
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
    expect(result.channels[0].state).toBe("BUSINESS_STRATEGY_REVIEW_REQUIRED");
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
    expect(first.agentRuns.every((item) => item.entityId !== "workspace" && item.provider && item.model && item.outputVersion > 0 && item.usage.calls === 1 && item.errorCode === null)).toBe(true);
    expect(first.auditEvents.every((item) => item.ownerId === "user-1")).toBe(true);
    expect(second.auditEvents.every((item) => item.ownerId === "user-2")).toBe(true);
  });

  it("resolves a reference URL into an honestly labeled fixture report and pauses for review", async () => {
    const result = await run().execute("user-1", "reference", {
      type: "CREATE_CHANNEL", mode: "REFERENCE_CHANNEL", preferences,
      referenceChannel: { url: "https://youtube.com/@reference-example", likedAspects: "Clear explanations", restrictions: "Do not imitate thumbnails" },
    });
    const channel = result.channels[0];
    expect(channel.state).toBe("REFERENCE_CHANNEL_REVIEW_REQUIRED");
    expect(channel.referenceSource).toMatchObject({ fixture: true, sourceKind: "HANDLE", canonicalUrl: "https://www.youtube.com/@reference-example" });
    expect(channel.referenceReports[0]).toMatchObject({ version: 1, status: "REVIEW_REQUIRED", report: { fixture: true } });
    expect(channel.referenceReports[0].report.incompleteDataWarnings[0]).toContain("did not retrieve YouTube data");
    expect(result.agentRuns.map((item) => item.agent)).toEqual(["REFERENCE_CHANNEL_RESOLVER", "REFERENCE_CHANNEL_RESEARCH", "INDEPENDENT_RESEARCH_QA"]);
  });

  it("creates immutable reference-report revisions and approves only the current exact version", async () => {
    const orchestrator = run();
    const created = await orchestrator.execute("user-1", "reference-version", { type: "CREATE_CHANNEL", mode: "REFERENCE_CHANNEL", preferences, referenceChannel: { url: "https://youtube.com/@reference-example" } });
    const channelId = created.channels[0].id;
    const revised = await orchestrator.execute("user-1", "reference-revise", { type: "REVISE_REFERENCE_REPORT", channelId, reportVersion: 1, section: "DIFFERENTIATION", instructions: "Focus on operators rather than general viewers" });
    expect(revised.channels[0].referenceReports.map((item) => item.version)).toEqual([1, 2]);
    expect(revised.channels[0].referenceReports[0].report.originalDifferentiationRecommendations).not.toEqual(revised.channels[0].referenceReports[1].report.originalDifferentiationRecommendations);
    await expect(orchestrator.execute("user-1", "stale-reference-approval", { type: "REFERENCE_REPORT_DECISION", channelId, reportVersion: 1, decision: "APPROVE" })).rejects.toMatchObject({ status: 409 });
    const approved = await orchestrator.execute("user-1", "reference-approval", { type: "REFERENCE_REPORT_DECISION", channelId, reportVersion: 2, decision: "APPROVE" });
    expect(approved.channels[0].state).toBe("BUSINESS_STRATEGY_REVIEW_REQUIRED");
    expect(approved.channels[0].referenceReports[1].status).toBe("APPROVED");
    expect(approved.channels[0].concepts[0].source).toBe("REFERENCE_CHANNEL");
  });

  it("keeps reference actions owner-scoped and idempotent", async () => {
    const orchestrator = run();
    const created = await orchestrator.execute("user-1", "reference-owner", { type: "CREATE_CHANNEL", mode: "REFERENCE_CHANNEL", preferences, referenceChannel: { url: "https://youtube.com/@reference-example" } });
    const action = { type: "REVISE_REFERENCE_REPORT" as const, channelId: created.channels[0].id, reportVersion: 1, section: "BRAND" as const, instructions: "Make the voice more practical" };
    await orchestrator.execute("user-1", "reference-same", action);
    const repeated = await orchestrator.execute("user-1", "reference-same", action);
    expect(repeated.channels[0].referenceReports).toHaveLength(2);
    await expect(orchestrator.execute("user-2", "reference-foreign", action)).rejects.toMatchObject({ status: 404 });
  });

  it("keeps provider resolution failures visible and retryable without fabricating a report", async () => {
    const repository = new MemoryWorkspaceRepository();
    const failingProvider = {
      mode: "live" as const,
      providerName: "test-live-provider",
      resolve: async () => { throw new Error("Channel could not be resolved by the provider"); },
      research: async () => { throw new Error("Research must not run after resolution fails"); },
    };
    const orchestrator = new ChannelwrightOrchestrator(repository, failingProvider);
    const failed = await orchestrator.execute("user-1", "reference-failure", { type: "CREATE_CHANNEL", mode: "REFERENCE_CHANNEL", preferences, referenceChannel: { url: "https://youtube.com/@unresolved-example" } });
    expect(failed.channels[0]).toMatchObject({ state: "FAILED", referenceReports: [] });
    expect(failed.agentRuns[0]).toMatchObject({ status: "FAILED", fixture: false, provider: "test-live-provider", errorCode: "REFERENCE_PROVIDER_FAILED" });
    const retried = await orchestrator.execute("user-1", "reference-failure-retry", { type: "RETRY_REFERENCE_RESEARCH", channelId: failed.channels[0].id });
    expect(retried.channels[0].state).toBe("FAILED");
    expect(retried.agentRuns[1].retryOf).toBe(retried.agentRuns[0].id);
  });

  it("versions and approves the connected business strategy, then selects offers by exact version", async () => {
    const orchestrator = run();
    const created = await orchestrator.execute("user-1", "strategy-channel", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences });
    const channelId = created.channels[0].id;
    const revised = await orchestrator.execute("user-1", "strategy-revise", { type: "BUSINESS_STRATEGY_DECISION", channelId, strategyVersion: 1, decision: "REQUEST_CHANGES", feedback: "Make the Pillar Video more specific to independent operators" });
    expect(revised.channels[0].businessStrategies.map((item) => item.version)).toEqual([1, 2]);
    await expect(orchestrator.execute("user-1", "strategy-stale", { type: "BUSINESS_STRATEGY_DECISION", channelId, strategyVersion: 1, decision: "APPROVE" })).rejects.toMatchObject({ status: 409 });
    const approved = await orchestrator.execute("user-1", "strategy-approve", { type: "BUSINESS_STRATEGY_DECISION", channelId, strategyVersion: 2, decision: "APPROVE" });
    const strategy = approved.channels[0].businessStrategies[1].strategy;
    expect(approved.channels[0].state).toBe("READY_FOR_VIDEO_PRODUCTION");
    const selected = await orchestrator.execute("user-1", "select-resource", { type: "SELECT_STRATEGY_OFFER", channelId, strategyVersion: 2, offerType: "FREE_RESOURCE", candidateId: strategy.freeResourceOptions[0].id });
    expect(selected.channels[0].offerSelections[0]).toMatchObject({ strategyVersion: 2, offerType: "FREE_RESOURCE", decision: "SELECT" });
  });

  it("creates the Pillar Video as a special project bound to the approved strategy", async () => {
    const orchestrator = run();
    const ready = await createReadyChannel(orchestrator, "pillar");
    const created = await orchestrator.execute("user-1", "pillar-video", { type: "CREATE_PILLAR_VIDEO", channelId: ready.channels[0].id, strategyVersion: 1 });
    expect(created.videos[0]).toMatchObject({ kind: "PILLAR", sourceBusinessStrategyVersion: 1, state: "SCRIPT_REVIEW_REQUIRED" });
    await expect(orchestrator.execute("user-1", "pillar-duplicate", { type: "CREATE_PILLAR_VIDEO", channelId: ready.channels[0].id, strategyVersion: 1 })).rejects.toMatchObject({ status: 409 });
  });
});

describe("video orchestration", () => {
  it("runs through QA, pauses for approval, and versions requested changes", async () => {
    const orchestrator = run();
    const ready = await createReadyChannel(orchestrator, "standard");
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
    const ready = await createReadyChannel(orchestrator, "target", selected);
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
    const ready = await createReadyChannel(orchestrator, "both", selected);
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
    const ready = await createReadyChannel(orchestrator, "youtube");
    const created = await orchestrator.execute("user-1", "youtube-video", { type: "CREATE_VIDEO", channelId: ready.channels[0].id, topic: "Why loyalty programs change customer behavior" });
    const approved = await orchestrator.execute("user-1", "youtube-approve", { type: "SCRIPT_DECISION", videoId: created.videos[0].id, decision: "APPROVE" });
    expect(approved.videos[0].state).toBe("SCRIPT_APPROVED");
    expect(approved.videos[0].platformArtifacts).toHaveLength(0);
  });

  it("versions requested platform changes and binds approval to the exact artifact version", async () => {
    const orchestrator = run();
    const selected = { ...preferences, distributionTargets: { youtube: true as const, tiktok: true, instagramFacebookReels: false } };
    const ready = await createReadyChannel(orchestrator, "version", selected);
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
    const ready = await createReadyChannel(orchestrator, "retry", selected);
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
    const ready = await createReadyChannel(orchestrator, "qa", selected);
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

describe("resource and funnel build orchestration", () => {
  const createResourceBuild = async (orchestrator: ChannelwrightOrchestrator, key: string) => {
    const ready = await createReadyChannel(orchestrator, key);
    const channel = ready.channels[0];
    const option = channel.businessStrategies[0].strategy.freeResourceOptions[0];
    await orchestrator.execute("user-1", `${key}-select`, { type: "SELECT_STRATEGY_OFFER", channelId: channel.id, strategyVersion: 1, offerType: "FREE_RESOURCE", candidateId: option.id });
    return orchestrator.execute("user-1", `${key}-build`, { type: "CREATE_RESOURCE_BUILD", channelId: channel.id, strategyVersion: 1 });
  };

  it("versions the specification, runs constrained fixture QA, and retains deployment blockers", async () => {
    const orchestrator = run();
    const created = await createResourceBuild(orchestrator, "resource");
    const projectId = created.buildProjects[0].id;
    expect(created.buildProjects[0]).toMatchObject({ state: "SPEC_REVIEW", projectType: "FREE_RESOURCE" });
    const revised = await orchestrator.execute("user-1", "resource-spec-revise", { type: "BUILD_SPEC_DECISION", buildProjectId: projectId, specificationVersion: 1, decision: "REQUEST_CHANGES", feedback: "Make the worksheet printable" });
    expect(revised.buildProjects[0].specifications.map((item) => item.version)).toEqual([1, 2]);
    const built = await orchestrator.execute("user-1", "resource-spec-approve", { type: "BUILD_SPEC_DECISION", buildProjectId: projectId, specificationVersion: 2, decision: "APPROVE" });
    const artifact = built.buildProjects[0].artifacts[0];
    expect(built.buildProjects[0].state).toBe("USER_REVIEW");
    expect(artifact.qa.verdict).toBe("PASS");
    expect(artifact.artifact.fileManifest.every((file) => !file.path.includes(".."))).toBe(true);
    expect(artifact.artifact.executionEvidence).toEqual({ mode: "FIXTURE_CONTRACT", isolatedWorkspace: "NOT_RUN", dependencyAllowlist: "NOT_RUN", secretScan: "NOT_RUN", staticAnalysis: "NOT_RUN", tests: "NOT_RUN", resourceLimits: "NOT_RUN" });
    expect(artifact.artifact.deploymentBlockers[0]).toContain("No live object storage");
  });

  it("captures duplicate-safe fixture consent, versions artifact changes, restores as new, and blocks deployment after approval", async () => {
    const orchestrator = run();
    const created = await createResourceBuild(orchestrator, "funnel");
    const projectId = created.buildProjects[0].id;
    await orchestrator.execute("user-1", "funnel-spec-approve", { type: "BUILD_SPEC_DECISION", buildProjectId: projectId, specificationVersion: 1, decision: "APPROVE" });
    await orchestrator.execute("user-1", "capture-1", { type: "CAPTURE_FIXTURE_SUBSCRIBER", buildProjectId: projectId, email: " Person@Example.com ", consent: true, source: "fixture-preview-v1" });
    const duplicate = await orchestrator.execute("user-1", "capture-2", { type: "CAPTURE_FIXTURE_SUBSCRIBER", buildProjectId: projectId, email: "person@example.com", consent: true, source: "fixture-preview-v1" });
    expect(duplicate.subscribers).toHaveLength(1);
    expect(duplicate.consentEvents).toHaveLength(1);
    expect(duplicate.deliveryEvents[0]).toMatchObject({ status: "DELIVERED_FIXTURE", provider: "fixture-no-email" });
    const revised = await orchestrator.execute("user-1", "artifact-revise", { type: "BUILD_ARTIFACT_DECISION", buildProjectId: projectId, artifactVersion: 1, decision: "REQUEST_CHANGES", feedback: "Clarify the consent copy" });
    expect(revised.buildProjects[0].artifacts.map((item) => item.version)).toEqual([1, 2]);
    const restored = await orchestrator.execute("user-1", "artifact-restore", { type: "BUILD_ARTIFACT_DECISION", buildProjectId: projectId, artifactVersion: 1, decision: "RESTORE_AS_NEW_VERSION" });
    expect(restored.buildProjects[0].artifacts.at(-1)).toMatchObject({ version: 3, restoredFromVersion: 1 });
    const approved = await orchestrator.execute("user-1", "artifact-approve", { type: "BUILD_ARTIFACT_DECISION", buildProjectId: projectId, artifactVersion: 3, decision: "APPROVE" });
    expect(approved.buildProjects[0].state).toBe("DEPLOYMENT_BLOCKED");
    await expect(orchestrator.execute("user-2", "foreign-build", { type: "BUILD_ARTIFACT_DECISION", buildProjectId: projectId, artifactVersion: 3, decision: "APPROVE" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("paid-product build and commerce orchestration", () => {
  const createApprovedProductBuild = async (orchestrator: ChannelwrightOrchestrator, key: string) => {
    const ready = await createReadyChannel(orchestrator, key);
    const channel = ready.channels[0];
    const option = channel.businessStrategies[0].strategy.paidProductOptions[0];
    await orchestrator.execute("user-1", `${key}-select-product`, { type: "SELECT_STRATEGY_OFFER", channelId: channel.id, strategyVersion: 1, offerType: "PAID_PRODUCT", candidateId: option.id });
    const project = await orchestrator.execute("user-1", `${key}-product-build`, { type: "CREATE_PRODUCT_BUILD", channelId: channel.id, strategyVersion: 1 });
    const projectId = project.buildProjects[0].id;
    const built = await orchestrator.execute("user-1", `${key}-product-spec`, { type: "BUILD_SPEC_DECISION", buildProjectId: projectId, specificationVersion: 1, decision: "APPROVE" });
    expect(built.buildProjects[0].artifacts[0].artifact.commercePlan).toMatchObject({ providerNeutralBoundary: true });
    return orchestrator.execute("user-1", `${key}-product-artifact`, { type: "BUILD_ARTIFACT_DECISION", buildProjectId: projectId, artifactVersion: 1, decision: "APPROVE" });
  };

  it("does not grant access from checkout creation and fulfills only a verified fixture event", async () => {
    const orchestrator = run();
    const approved = await createApprovedProductBuild(orchestrator, "commerce");
    const project = approved.buildProjects[0];
    const activated = await orchestrator.execute("user-1", "activate-product", { type: "ACTIVATE_FIXTURE_PRODUCT", buildProjectId: project.id, artifactVersion: 1, amountMinor: 9900, currency: "USD" });
    expect(activated.prices[0]).toMatchObject({ amountMinor: 9900, pricingHypothesis: true, active: true });
    const checkout = await orchestrator.execute("user-1", "create-checkout", { type: "CREATE_FIXTURE_CHECKOUT", productId: activated.products[0].id, priceId: activated.prices[0].id, customerReference: "customer@example.com" });
    expect(checkout.purchases[0].status).toBe("PENDING");
    expect(checkout.entitlements).toHaveLength(0);
    const checkoutId = checkout.purchases[0].checkoutId;
    const paid = await orchestrator.execute("user-1", "payment-event", { type: "PROCESS_FIXTURE_COMMERCE_EVENT", checkoutId, providerEventId: "fixture-event-paid-1", eventType: "PAYMENT_CONFIRMED" });
    expect(paid.purchases[0]).toMatchObject({ status: "PAID" });
    expect(paid.entitlements[0]).toMatchObject({ status: "ACTIVE", subjectReference: "customer@example.com" });
    const replay = await orchestrator.execute("user-1", "payment-replay-different-request-key", { type: "PROCESS_FIXTURE_COMMERCE_EVENT", checkoutId, providerEventId: "fixture-event-paid-1", eventType: "PAYMENT_CONFIRMED" });
    expect(replay.entitlements).toHaveLength(1);
    expect(replay.commerceEvents).toHaveLength(1);
    const refunded = await orchestrator.execute("user-1", "refund-event", { type: "PROCESS_FIXTURE_COMMERCE_EVENT", checkoutId, providerEventId: "fixture-event-refund-1", eventType: "PAYMENT_REFUNDED" });
    expect(refunded.purchases[0].status).toBe("REFUNDED");
    expect(refunded.entitlements[0].status).toBe("REFUNDED");
  });

  it("rejects cross-owner fixture checkout and commerce access", async () => {
    const orchestrator = run();
    const approved = await createApprovedProductBuild(orchestrator, "commerce-owner");
    const activated = await orchestrator.execute("user-1", "activate-owner-product", { type: "ACTIVATE_FIXTURE_PRODUCT", buildProjectId: approved.buildProjects[0].id, artifactVersion: 1, amountMinor: 4900, currency: "USD" });
    await expect(orchestrator.execute("user-2", "foreign-checkout", { type: "CREATE_FIXTURE_CHECKOUT", productId: activated.products[0].id, priceId: activated.prices[0].id, customerReference: "other@example.com" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("monetization orchestration", () => {
  it("evaluates the broad revenue set, versions assumptions, and approves the exact plan", async () => {
    const orchestrator = run();
    const ready = await createReadyChannel(orchestrator, "monetization");
    const channelId = ready.channels[0].id;
    const created = await orchestrator.execute("user-1", "monetization-plan", { type: "GENERATE_MONETIZATION_PLAN", channelId, strategyVersion: 1 });
    expect(created.channels[0].monetizationPlans[0]).toMatchObject({ version: 1, status: "REVIEW_REQUIRED", plan: { fixture: true } });
    expect(created.channels[0].monetizationPlans[0].plan.streams).toHaveLength(13);
    expect(created.channels[0].monetizationPlans[0].plan.streams.every((item) => item.assumptionsAndEstimates.length > 0)).toBe(true);
    const revised = await orchestrator.execute("user-1", "monetization-revise", { type: "MONETIZATION_PLAN_DECISION", channelId, planVersion: 1, decision: "REQUEST_CHANGES", feedback: "Lower the priority of services because delivery capacity is limited" });
    expect(revised.channels[0].monetizationPlans.map((item) => item.version)).toEqual([1, 2]);
    await expect(orchestrator.execute("user-1", "monetization-stale", { type: "MONETIZATION_PLAN_DECISION", channelId, planVersion: 1, decision: "APPROVE" })).rejects.toMatchObject({ status: 409 });
    const approved = await orchestrator.execute("user-1", "monetization-approve", { type: "MONETIZATION_PLAN_DECISION", channelId, planVersion: 2, decision: "APPROVE" });
    expect(approved.channels[0].monetizationPlans[1].status).toBe("APPROVED");
  });

  it("rejects cross-owner plan decisions", async () => {
    const orchestrator = run();
    const ready = await createReadyChannel(orchestrator, "monetization-owner");
    const channelId = ready.channels[0].id;
    await orchestrator.execute("user-1", "monetization-owner-plan", { type: "GENERATE_MONETIZATION_PLAN", channelId, strategyVersion: 1 });
    await expect(orchestrator.execute("user-2", "monetization-foreign", { type: "MONETIZATION_PLAN_DECISION", channelId, planVersion: 1, decision: "APPROVE" })).rejects.toMatchObject({ status: 404 });
  });

  it("persists conversational instructions as an owner-scoped structured change request", async () => {
    const orchestrator = run();
    const ready = await createReadyChannel(orchestrator, "monetization-conversation");
    const channelId = ready.channels[0].id;
    await orchestrator.execute("user-1", "monetization-conversation-plan", { type: "GENERATE_MONETIZATION_PLAN", channelId, strategyVersion: 1 });
    const revised = await orchestrator.execute("user-1", "monetization-conversation-revise", { type: "MONETIZATION_PLAN_DECISION", channelId, planVersion: 1, decision: "REQUEST_CHANGES", feedback: "Move affiliates below the owned-product path", source: "CONVERSATION" });
    expect(revised.conversationMessages[0]).toMatchObject({ channelId, role: "USER", targetType: "MONETIZATION_PLAN", content: "Move affiliates below the owned-product path" });
    expect(revised.changeRequests[0]).toMatchObject({ targetType: "MONETIZATION_PLAN", createdVersion: 2, status: "APPLIED_AS_NEW_VERSION" });
    const foreign = await orchestrator.snapshot("user-2");
    expect(foreign.conversationMessages).toHaveLength(0);
    expect(foreign.changeRequests).toHaveLength(0);
  });
});
