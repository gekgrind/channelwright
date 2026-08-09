import { createHash, randomUUID } from "node:crypto";
import type { WorkflowAction } from "@/domain/actions";
import type { Channel, ConceptDecision, PlatformAdaptationArtifact, VideoProject, WorkspaceSnapshot } from "@/domain/entities";
import { transitionChannel, transitionVideo } from "@/domain/state-machines";
import type { WorkspaceRepository } from "./repository";
import {
  createChannelStrategy, createContentStrategy, discoverConcepts, evaluateConcept, researchConcept,
  createReelsPackage, createTikTokPackage, researchVideo, reviewPlatformPackage, reviewScript, writeScript,
} from "./agents/fixtures";

const timestamp = () => new Date().toISOString();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class WorkflowError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); this.name = "WorkflowError"; }
}

export class ChannelwrightOrchestrator {
  constructor(private readonly repository: WorkspaceRepository) {}

  async snapshot(ownerId: string) {
    return this.forOwner(await this.repository.load(), ownerId);
  }

  async execute(ownerId: string, idempotencyKey: string, action: WorkflowAction) {
    const workspace = await this.repository.load();
    const inheritedDistributionTargets = action.type === "CREATE_VIDEO"
      ? workspace.channels.find((channel) => channel.id === action.channelId && channel.ownerId === ownerId)?.preferences.distributionTargets
      : undefined;
    const fingerprint = hash({ ownerId, action, inheritedDistributionTargets });
    const scopedIdempotencyKey = `${ownerId}:${idempotencyKey}`;
    const prior = workspace.idempotency[scopedIdempotencyKey];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new WorkflowError("Idempotency key was already used for a different request", 409);
      return this.forOwner(workspace, ownerId);
    }

    switch (action.type) {
      case "CREATE_CHANNEL": this.createChannel(workspace, ownerId, action); break;
      case "CONCEPT_DECISION": this.handleConceptDecision(workspace, ownerId, action); break;
      case "REVISE_CONCEPT": this.reviseConcept(workspace, ownerId, action); break;
      case "SELECT_CONCEPT": this.selectConcept(workspace, ownerId, action); break;
      case "CREATE_VIDEO": this.createVideo(workspace, ownerId, action); break;
      case "SCRIPT_DECISION": this.handleScriptDecision(workspace, ownerId, action); break;
      case "PLATFORM_ARTIFACT_DECISION": this.handlePlatformArtifactDecision(workspace, ownerId, action); break;
    }

    workspace.idempotency[scopedIdempotencyKey] = { fingerprint, completedAt: timestamp() };
    await this.repository.save(workspace);
    return this.forOwner(workspace, ownerId);
  }

  private createChannel(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "CREATE_CHANNEL" }>) {
    const createdAt = timestamp();
    const channel: Channel = {
      id: randomUUID(), ownerId, state: "DRAFT", mode: action.mode, preferences: action.preferences,
      concepts: [], decisions: [], candidates: [], createdAt, updatedAt: createdAt,
    };
    workspace.channels.push(channel);
    this.audit(workspace, ownerId, "CHANNEL_CREATED", channel.id, { mode: action.mode, distributionTargets: action.preferences.distributionTargets });

    if (action.mode === "USER_DEFINED") {
      const concept = action.concept!;
      channel.concepts.push({ id: randomUUID(), version: 1, concept, niche: action.preferences.niche, source: "USER_DEFINED", createdAt });
      channel.state = transitionChannel(channel.state, "CONCEPT_RESEARCH_PENDING");
      this.evaluateUserConcept(workspace, channel);
    } else {
      channel.state = transitionChannel(channel.state, "CONCEPT_DISCOVERY_PENDING");
      this.runDiscovery(workspace, channel);
    }
  }

  private evaluateUserConcept(workspace: WorkspaceSnapshot, channel: Channel) {
    const version = channel.concepts.at(-1)!;
    version.research = this.runAgent(workspace, channel.ownerId, "CONCEPT_RESEARCH", { concept: version.concept }, () => researchConcept(version.concept, channel.preferences));
    version.viability = this.runAgent(workspace, channel.ownerId, "CONCEPT_VIABILITY", { concept: version.concept, research: version.research.summary }, () => evaluateConcept(version.concept));
    this.audit(workspace, channel.ownerId, "VIABILITY_EVALUATED", channel.id, { conceptVersionId: version.id, recommendation: version.viability.recommendation });

    if (version.viability.recommendation === "GO") {
      channel.state = transitionChannel(channel.state, "CONCEPT_ACCEPTED");
      channel.selectedConceptVersionId = version.id;
      this.recordConceptDecision(channel, version.id, version.viability, "ACCEPT");
      this.buildChannelStrategy(workspace, channel);
    } else {
      channel.state = transitionChannel(channel.state, "CONCEPT_REVIEW_REQUIRED");
      this.audit(workspace, channel.ownerId, "WORKFLOW_PAUSED", channel.id, { reason: version.viability.recommendation });
    }
    channel.updatedAt = timestamp();
  }

  private handleConceptDecision(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "CONCEPT_DECISION" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "CONCEPT_REVIEW_REQUIRED") throw new WorkflowError("Channel is not waiting for a concept decision", 409);
    const version = channel.concepts.at(-1)!;
    if (!version.viability) throw new WorkflowError("The concept has no viability report", 409);
    this.recordConceptDecision(channel, version.id, version.viability, action.decision, action.feedback);

    if (action.decision === "OVERRIDE_AND_CONTINUE") {
      channel.state = transitionChannel(channel.state, "CONCEPT_ACCEPTED");
      channel.selectedConceptVersionId = version.id;
      this.audit(workspace, ownerId, "USER_OVERRIDE", channel.id, { systemRecommendation: version.viability.recommendation });
      this.buildChannelStrategy(workspace, channel);
    } else {
      channel.state = transitionChannel(channel.state, "CONCEPT_DISCOVERY_PENDING");
      this.audit(workspace, ownerId, "CONCEPT_DISCOVERY_STARTED", channel.id, { source: "negative-recommendation" });
      this.runDiscovery(workspace, channel);
    }
    channel.updatedAt = timestamp();
  }

  private reviseConcept(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "REVISE_CONCEPT" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "CONCEPT_REVIEW_REQUIRED") throw new WorkflowError("Only a concept under review can be revised", 409);
    const prior = channel.concepts.at(-1)!;
    if (!prior.viability) throw new WorkflowError("The prior concept has no viability report", 409);
    this.recordConceptDecision(channel, prior.id, prior.viability, "REVISE", action.feedback);
    channel.state = transitionChannel(channel.state, "CONCEPT_RESEARCH_PENDING");
    channel.concepts.push({
      id: randomUUID(), version: prior.version + 1, concept: action.concept,
      niche: action.niche ?? channel.preferences.niche, source: "USER_DEFINED", createdAt: timestamp(),
    });
    this.audit(workspace, ownerId, "CONCEPT_REVISED", channel.id, { fromVersion: prior.version, toVersion: prior.version + 1 });
    this.evaluateUserConcept(workspace, channel);
  }

  private runDiscovery(workspace: WorkspaceSnapshot, channel: Channel) {
    channel.candidates = this.runAgent(workspace, channel.ownerId, "CONCEPT_DISCOVERY", { preferences: channel.preferences }, () => discoverConcepts(channel.preferences));
    channel.state = transitionChannel(channel.state, "CONCEPT_SELECTION_REQUIRED");
    this.audit(workspace, channel.ownerId, "CONCEPT_CANDIDATES_PRESENTED", channel.id, { count: channel.candidates.length });
  }

  private selectConcept(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "SELECT_CONCEPT" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "CONCEPT_SELECTION_REQUIRED") throw new WorkflowError("Channel is not waiting for concept selection", 409);
    const candidate = channel.candidates.find((item) => item.id === action.candidateId);
    if (!candidate) throw new WorkflowError("Concept candidate not found", 404);
    const createdAt = timestamp();
    const version = {
      id: randomUUID(), version: channel.concepts.length + 1, concept: candidate.concept, niche: candidate.niche,
      source: "AGENT_DISCOVERED" as const, createdAt,
      research: this.runAgent(workspace, ownerId, "CONCEPT_RESEARCH", { concept: candidate.concept }, () => researchConcept(candidate.concept, channel.preferences)),
      viability: candidate.viability,
    };
    channel.concepts.push(version);
    channel.selectedConceptVersionId = version.id;
    channel.state = transitionChannel(channel.state, "CONCEPT_ACCEPTED");
    this.recordConceptDecision(channel, version.id, candidate.viability, "ACCEPT");
    this.audit(workspace, ownerId, "CONCEPT_SELECTED", channel.id, { candidateId: candidate.id, conceptVersionId: version.id });
    this.buildChannelStrategy(workspace, channel);
  }

  private buildChannelStrategy(workspace: WorkspaceSnapshot, channel: Channel) {
    channel.state = transitionChannel(channel.state, "CHANNEL_STRATEGY_PENDING");
    const version = channel.concepts.find((item) => item.id === channel.selectedConceptVersionId)!;
    channel.strategy = this.runAgent(workspace, channel.ownerId, "CHANNEL_STRATEGY", { concept: version.concept }, () => createChannelStrategy(version.concept, channel.preferences, version.viability?.risks ?? []));
    channel.state = transitionChannel(channel.state, "READY_FOR_VIDEO_PRODUCTION");
    channel.updatedAt = timestamp();
    this.audit(workspace, channel.ownerId, "CHANNEL_STRATEGY_COMPLETED", channel.id, { conceptVersionId: version.id });
  }

  private createVideo(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "CREATE_VIDEO" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "READY_FOR_VIDEO_PRODUCTION" || !channel.strategy) throw new WorkflowError("Channel is not ready for video production", 409);
    const createdAt = timestamp();
    const video: VideoProject = {
      id: randomUUID(), ownerId, channelId: channel.id, topic: action.topic, state: "DRAFT",
      scripts: [], approvals: [], distributionTargets: structuredClone(channel.preferences.distributionTargets),
      platformArtifacts: [], platformApprovals: [], createdAt, updatedAt: createdAt,
    };
    workspace.videos.push(video);
    this.audit(workspace, ownerId, "VIDEO_WORKFLOW_STARTED", video.id, { channelId: channel.id, distributionTargets: video.distributionTargets });
    const concept = channel.concepts.find((item) => item.id === channel.selectedConceptVersionId)!.concept;
    video.state = transitionVideo(video.state, "STRATEGY_PENDING");
    video.strategy = this.runAgent(workspace, ownerId, "CONTENT_STRATEGIST", { topic: video.topic }, () => createContentStrategy(video.topic, concept, channel.preferences));
    video.state = transitionVideo(video.state, "RESEARCH_PENDING");
    video.research = this.runAgent(workspace, ownerId, "VIDEO_RESEARCH", { topic: video.topic }, () => researchVideo(video.topic));
    video.state = transitionVideo(video.state, "SCRIPT_PENDING");
    video.scripts.push(this.runAgent(workspace, ownerId, "SCRIPTWRITER", { topic: video.topic, version: 1 }, () => writeScript(video.topic)));
    video.state = transitionVideo(video.state, "SCRIPT_QA_PENDING");
    video.qa = this.runAgent(workspace, ownerId, "SCRIPT_QA", { videoId: video.id, version: 1 }, reviewScript);
    video.state = transitionVideo(video.state, "SCRIPT_REVIEW_REQUIRED");
    video.updatedAt = timestamp();
    this.audit(workspace, ownerId, "WORKFLOW_PAUSED", video.id, { reason: "HUMAN_SCRIPT_APPROVAL" });
  }

  private handleScriptDecision(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "SCRIPT_DECISION" }>) {
    const video = workspace.videos.find((item) => item.id === action.videoId && item.ownerId === ownerId);
    if (!video) throw new WorkflowError("Video project not found", 404);
    if (video.state !== "SCRIPT_REVIEW_REQUIRED") throw new WorkflowError("Video is not waiting for script review", 409);
    const current = video.scripts.at(-1)!;
    video.approvals.push({ id: randomUUID(), decision: action.decision, feedback: action.feedback, scriptVersion: current.version, createdAt: timestamp() });
    if (action.decision === "APPROVE") {
      video.state = transitionVideo(video.state, "SCRIPT_APPROVED");
      this.audit(workspace, ownerId, "SCRIPT_APPROVED", video.id, { version: current.version });
      this.createSelectedPlatformPlans(workspace, video);
    } else {
      video.state = transitionVideo(video.state, "SCRIPT_PENDING");
      const revised = this.runAgent(workspace, ownerId, "SCRIPTWRITER", { topic: video.topic, version: current.version + 1, feedback: action.feedback }, () => writeScript(video.topic, current.version + 1, action.feedback));
      video.scripts.push(revised);
      video.state = transitionVideo(video.state, "SCRIPT_QA_PENDING");
      video.qa = this.runAgent(workspace, ownerId, "SCRIPT_QA", { videoId: video.id, version: revised.version }, reviewScript);
      video.state = transitionVideo(video.state, "SCRIPT_REVIEW_REQUIRED");
      this.audit(workspace, ownerId, "SCRIPT_REVISION_COMPLETED", video.id, { version: revised.version });
    }
    video.updatedAt = timestamp();
  }

  private createSelectedPlatformPlans(workspace: WorkspaceSnapshot, video: VideoProject) {
    if (!video.research) throw new WorkflowError("Video research is required before platform planning", 409);
    const channel = this.ownedChannel(workspace, video.ownerId, video.channelId);
    const targets = [
      ...(video.distributionTargets.tiktok ? ["TIKTOK" as const] : []),
      ...(video.distributionTargets.instagramFacebookReels ? ["INSTAGRAM_FACEBOOK_REELS" as const] : []),
    ];
    for (const target of targets) this.createPlatformPlan(workspace, video, channel, target, 1);
  }

  private createPlatformPlan(
    workspace: WorkspaceSnapshot,
    video: VideoProject,
    channel: Channel,
    target: PlatformAdaptationArtifact["target"],
    version: number,
    feedback?: string,
  ) {
    const createdAt = timestamp();
    const script = video.scripts.at(-1)!;
    const artifact: PlatformAdaptationArtifact = {
      id: randomUUID(), ownerId: video.ownerId, videoId: video.id, target, version,
      sourceScriptVersion: script.version, sourceMasterVersion: null, kind: "ADAPTATION_PLAN",
      status: "GENERATING", fixture: true, createdAt, updatedAt: createdAt,
    };
    video.platformArtifacts.push(artifact);
    this.audit(workspace, video.ownerId, "PLATFORM_ADAPTATION_STARTED", video.id, { target, version, sourceScriptVersion: script.version, sourceMasterVersion: null });
    try {
      const input = { videoId: video.id, topic: video.topic, script, research: video.research!, preferences: channel.preferences, version, feedback };
      artifact.package = this.runAgent(workspace, video.ownerId, target === "TIKTOK" ? "TIKTOK_OPTIMIZER" : "REELS_OPTIMIZER", input, () => target === "TIKTOK" ? createTikTokPackage(input) : createReelsPackage(input));
      artifact.status = "QA_REQUIRED";
      artifact.qa = this.runAgent(workspace, video.ownerId, "PLATFORM_PACKAGE_QA", { artifactId: artifact.id, target, version }, () => reviewPlatformPackage(artifact.package!, video.research!));
      artifact.status = artifact.qa.verdict === "PASS" ? "REVIEW_REQUIRED" : "FAILED";
      artifact.updatedAt = timestamp();
      this.audit(workspace, video.ownerId, "PLATFORM_ADAPTATION_QA_COMPLETED", video.id, { target, version, verdict: artifact.qa.verdict, status: artifact.status });
    } catch (error) {
      artifact.status = "FAILED";
      artifact.failure = error instanceof Error ? error.message : "Unknown platform adaptation failure";
      artifact.updatedAt = timestamp();
      this.audit(workspace, video.ownerId, "PLATFORM_ADAPTATION_FAILED", video.id, { target, version, error: artifact.failure });
    }
  }

  private handlePlatformArtifactDecision(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "PLATFORM_ARTIFACT_DECISION" }>) {
    const video = workspace.videos.find((item) => item.id === action.videoId && item.ownerId === ownerId);
    if (!video) throw new WorkflowError("Video project not found", 404);
    const artifact = video.platformArtifacts.filter((item) => item.target === action.target).at(-1);
    if (!artifact || artifact.version !== action.artifactVersion) throw new WorkflowError("Platform artifact version is not current", 409);
    if (artifact.status !== "REVIEW_REQUIRED") throw new WorkflowError("Platform artifact is not waiting for review", 409);
    video.platformApprovals.push({
      id: randomUUID(), ownerId, videoId: video.id, artifactId: artifact.id, target: artifact.target,
      artifactVersion: artifact.version, sourceScriptVersion: artifact.sourceScriptVersion,
      decision: action.decision, feedback: action.feedback, createdAt: timestamp(),
    });
    this.audit(workspace, ownerId, "PLATFORM_ARTIFACT_DECISION_RECORDED", video.id, { target: artifact.target, artifactId: artifact.id, artifactVersion: artifact.version, sourceScriptVersion: artifact.sourceScriptVersion, decision: action.decision });
    if (action.decision === "APPROVE") {
      artifact.status = "APPROVED";
      artifact.updatedAt = timestamp();
    } else {
      const channel = this.ownedChannel(workspace, ownerId, video.channelId);
      this.createPlatformPlan(workspace, video, channel, artifact.target, artifact.version + 1, action.feedback);
    }
    video.updatedAt = timestamp();
  }

  private recordConceptDecision(channel: Channel, conceptVersionId: string, viability: NonNullable<Channel["concepts"][number]["viability"]>, decision: ConceptDecision["decision"], feedback?: string) {
    channel.decisions.push({
      id: randomUUID(), conceptVersionId, viabilityReportVersion: viability.modelVersion,
      systemRecommendation: viability.recommendation, decision, feedback, createdAt: timestamp(),
    });
  }

  private runAgent<T>(workspace: WorkspaceSnapshot, ownerId: string, agent: string, input: unknown, operation: () => T): T {
    const startedAt = timestamp();
    const run = { id: randomUUID(), ownerId, agent, status: "STARTED" as const, inputHash: hash(input), startedAt, costUsd: 0, fixture: true };
    workspace.agentRuns.push(run);
    try {
      const output = operation();
      Object.assign(run, { status: "COMPLETED" as const, completedAt: timestamp() });
      return output;
    } catch (error) {
      Object.assign(run, { status: "FAILED" as const, completedAt: timestamp(), error: error instanceof Error ? error.message : "Unknown error" });
      throw error;
    }
  }

  private audit(workspace: WorkspaceSnapshot, ownerId: string, type: string, entityId: string, detail: Record<string, unknown>) {
    workspace.auditEvents.push({ id: randomUUID(), ownerId, type, entityId, at: timestamp(), detail });
  }

  private ownedChannel(workspace: WorkspaceSnapshot, ownerId: string, id: string) {
    const channel = workspace.channels.find((item) => item.id === id && item.ownerId === ownerId);
    if (!channel) throw new WorkflowError("Channel not found", 404);
    return channel;
  }

  private forOwner(workspace: WorkspaceSnapshot, ownerId: string) {
    const channelIds = new Set(workspace.channels.filter((item) => item.ownerId === ownerId).map((item) => item.id));
    return {
      channels: workspace.channels.filter((item) => item.ownerId === ownerId),
      videos: workspace.videos.filter((item) => item.ownerId === ownerId),
      agentRuns: workspace.agentRuns.filter((item) => item.ownerId === ownerId),
      auditEvents: workspace.auditEvents.filter((item) => item.ownerId === ownerId && (channelIds.has(item.entityId) || workspace.videos.some((video) => video.ownerId === ownerId && video.id === item.entityId))),
    };
  }
}
