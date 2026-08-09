import type {
  ChannelPreferences, ChannelState, ChannelStrategy, ConceptCandidate, ConceptMode, ConceptResearch,
  ContentStrategy, DistributionTargets, PlatformArtifactStatus, PlatformPackage, PlatformQa, PlatformTarget,
  Script, ScriptQa, ViabilityReport, VideoResearch, VideoState,
} from "./contracts";

export interface ConceptVersion {
  id: string; version: number; concept: string; niche: string; source: ConceptMode; createdAt: string;
  research?: ConceptResearch; viability?: ViabilityReport;
}

export interface ConceptDecision {
  id: string; conceptVersionId: string; viabilityReportVersion: string;
  systemRecommendation: ViabilityReport["recommendation"];
  decision: "ACCEPT" | "OVERRIDE_AND_CONTINUE" | "REVISE" | "REQUEST_ALTERNATIVES";
  feedback?: string; createdAt: string;
}

export interface AgentRun {
  id: string; ownerId: string; agent: string; status: "STARTED" | "COMPLETED" | "FAILED";
  inputHash: string; startedAt: string; completedAt?: string; costUsd: number; fixture: boolean; error?: string;
}

export interface AuditEvent { id: string; ownerId: string; type: string; entityId: string; at: string; detail: Record<string, unknown>; }

export interface Channel {
  id: string; ownerId: string; state: ChannelState; mode: ConceptMode; preferences: ChannelPreferences;
  concepts: ConceptVersion[]; selectedConceptVersionId?: string; decisions: ConceptDecision[];
  candidates: ConceptCandidate[]; strategy?: ChannelStrategy; createdAt: string; updatedAt: string;
}

export interface VideoProject {
  id: string; ownerId: string; channelId: string; topic: string; state: VideoState;
  strategy?: ContentStrategy; research?: VideoResearch; scripts: Script[]; qa?: ScriptQa;
  approvals: Array<{ id: string; decision: "APPROVE" | "REQUEST_CHANGES"; feedback?: string; scriptVersion: number; createdAt: string }>;
  distributionTargets: DistributionTargets;
  platformArtifacts: PlatformAdaptationArtifact[];
  platformApprovals: PlatformArtifactApproval[];
  createdAt: string; updatedAt: string;
}

export interface PlatformAdaptationArtifact {
  id: string; ownerId: string; videoId: string; target: PlatformTarget; version: number;
  sourceScriptVersion: number; sourceMasterVersion: string | null; kind: "ADAPTATION_PLAN";
  status: PlatformArtifactStatus; package?: PlatformPackage; qa?: PlatformQa; failure?: string;
  fixture: true; createdAt: string; updatedAt: string;
}

export interface PlatformArtifactApproval {
  id: string; ownerId: string; videoId: string; artifactId: string; target: PlatformTarget;
  artifactVersion: number; sourceScriptVersion: number; decision: "APPROVE" | "REQUEST_CHANGES";
  feedback?: string; createdAt: string;
}

export interface WorkspaceSnapshot {
  channels: Channel[]; videos: VideoProject[]; agentRuns: AgentRun[]; auditEvents: AuditEvent[];
  idempotency: Record<string, { fingerprint: string; completedAt: string }>;
}

export const emptyWorkspace = (): WorkspaceSnapshot => ({ channels: [], videos: [], agentRuns: [], auditEvents: [], idempotency: {} });
