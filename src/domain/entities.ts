import type {
  ChannelPreferences, ChannelState, ChannelStrategy, ConceptCandidate, ConceptMode, ConceptResearch,
  ContentStrategy, DistributionTargets, PlatformArtifactStatus, PlatformPackage, PlatformQa, PlatformTarget,
  Script, ScriptQa, ViabilityReport, VideoResearch, VideoState,
} from "./contracts";
import type { ReferenceChannelReport, ReferenceChannelRequest, ReferenceChannelSource, ReferenceReportQa, ReferenceReportSection } from "./studio-contracts";
import type { BusinessStrategy, BusinessStrategyQa, OfferType } from "./strategy-contracts";
import type { BuildArtifact, BuildProjectState, BuildQa, BuildSpecification } from "./build-contracts";
import type { MonetizationPlan, MonetizationQa } from "./monetization-contracts";
import { emptyMediaProduction, type MediaProductionSnapshot } from "./media-production";

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
  entityId: string; inputHash: string; startedAt: string; completedAt?: string; costUsd: number; fixture: boolean; error?: string;
  provider: string; model: string; outputVersion: number; usage: Record<string, number>;
  sourceProvenance: Array<{ sourceId: string; url: string; accessedAt: string }>;
  errorCode: string | null; retryOf: string | null;
}

export interface AuditEvent { id: string; ownerId: string; type: string; entityId: string; at: string; detail: Record<string, unknown>; }

export interface ConversationMessage {
  id: string; ownerId: string; channelId: string; role: "USER" | "SYSTEM"; content: string;
  targetType: "REFERENCE_REPORT" | "BUSINESS_STRATEGY" | "MONETIZATION_PLAN" | "BUILD_SPECIFICATION" | "BUILD_ARTIFACT" | "SCRIPT";
  targetId: string; createdAt: string;
}

export interface StructuredChangeRequest {
  id: string; ownerId: string; channelId: string; messageId: string;
  targetType: ConversationMessage["targetType"]; targetId: string; createdVersion: number;
  status: "APPLIED_AS_NEW_VERSION"; instructions: string; createdAt: string;
}

export interface Channel {
  id: string; ownerId: string; state: ChannelState; mode: ConceptMode; preferences: ChannelPreferences;
  concepts: ConceptVersion[]; selectedConceptVersionId?: string; decisions: ConceptDecision[];
  candidates: ConceptCandidate[]; strategy?: ChannelStrategy; createdAt: string; updatedAt: string;
  referenceSource?: ReferenceChannelSource;
  referenceRequest?: ReferenceChannelRequest;
  referenceReports: ReferenceReportVersion[];
  referenceReportDecisions: ReferenceReportDecision[];
  businessStrategies: BusinessStrategyVersion[];
  businessStrategyDecisions: BusinessStrategyDecision[];
  offerSelections: OfferSelection[];
  monetizationPlans: MonetizationPlanVersion[];
  monetizationPlanDecisions: MonetizationPlanDecision[];
}

export interface BusinessStrategyVersion {
  id: string; ownerId: string; channelId: string; version: number; parentVersion?: number;
  status: "QA_REQUIRED" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED";
  strategy: BusinessStrategy; qa: BusinessStrategyQa; changeInstructions?: string; createdAt: string;
}

export interface BusinessStrategyDecision {
  id: string; ownerId: string; channelId: string; strategyId: string; strategyVersion: number;
  decision: "APPROVE" | "REQUEST_CHANGES"; feedback?: string; createdAt: string;
}

export interface OfferSelection {
  id: string; ownerId: string; channelId: string; strategyVersion: number; offerType: OfferType;
  candidateId: string; decision: "SELECT"; createdAt: string;
}

export interface MonetizationPlanVersion { id: string; ownerId: string; channelId: string; version: number; parentVersion?: number; strategyVersion: number; status: "QA_REQUIRED" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED"; plan: MonetizationPlan; qa: MonetizationQa; changeInstructions?: string; createdAt: string; }
export interface MonetizationPlanDecision { id: string; ownerId: string; channelId: string; planId: string; planVersion: number; decision: "APPROVE" | "REQUEST_CHANGES"; feedback?: string; createdAt: string; }

export interface ReferenceReportVersion {
  id: string; ownerId: string; channelId: string; version: number; parentVersion?: number;
  changedSection?: ReferenceReportSection; changeInstructions?: string;
  status: "QA_REQUIRED" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED";
  report: ReferenceChannelReport; qa: ReferenceReportQa; createdAt: string;
}

export interface ReferenceReportDecision {
  id: string; ownerId: string; channelId: string; reportId: string; reportVersion: number;
  decision: "APPROVE" | "REJECT_DIRECTION" | "SWITCH_TO_USER_DEFINED" | "SWITCH_TO_DISCOVERY";
  feedback?: string; createdAt: string;
}

export interface VideoProject {
  id: string; ownerId: string; channelId: string; topic: string; state: VideoState;
  kind?: "STANDARD" | "PILLAR"; sourceBusinessStrategyVersion?: number;
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
  buildProjects: BuildProject[]; subscribers: Subscriber[]; consentEvents: ConsentEvent[]; deliveryEvents: DeliveryEvent[];
  products: Product[]; prices: Price[]; purchases: Purchase[]; entitlements: Entitlement[]; commerceEvents: CommerceEvent[];
  conversationMessages: ConversationMessage[]; changeRequests: StructuredChangeRequest[];
  mediaProduction: MediaProductionSnapshot;
  idempotency: Record<string, { fingerprint: string; completedAt: string }>;
}

export interface BuildProject {
  id: string; ownerId: string; channelId: string; strategyVersion: number; offerCandidateId: string;
  projectType: "FREE_RESOURCE" | "PAID_PRODUCT"; state: BuildProjectState;
  specifications: Array<{ id: string; version: number; specification: BuildSpecification; decision?: "APPROVE" | "REQUEST_CHANGES"; feedback?: string; createdAt: string }>;
  artifacts: Array<{ id: string; version: number; parentVersion?: number; restoredFromVersion?: number; artifact: BuildArtifact; qa: BuildQa; status: "USER_REVIEW" | "APPROVED" | "FAILED"; changeInstructions?: string; createdAt: string }>;
  decisions: Array<{ id: string; artifactVersion: number; decision: "APPROVE" | "REQUEST_CHANGES" | "RESTORE_AS_NEW_VERSION"; feedback?: string; createdAt: string }>;
  createdAt: string; updatedAt: string;
}

export interface Subscriber { id: string; ownerId: string; channelId: string; buildProjectId: string; normalizedEmail: string; status: "ACTIVE" | "UNSUBSCRIBED"; consentAt: string; consentSource: string; createdAt: string; }
export interface ConsentEvent { id: string; ownerId: string; channelId: string; buildProjectId: string; subscriberId: string; consented: true; source: string; occurredAt: string; }
export interface DeliveryEvent { id: string; ownerId: string; channelId: string; buildProjectId: string; subscriberId: string; status: "QUEUED" | "DELIVERED_FIXTURE" | "FAILED" | "REVOKED"; provider: string; tokenHash: string; expiresAt: string; createdAt: string; }

export interface Product { id: string; ownerId: string; channelId: string; buildProjectId: string; buildArtifactVersion: number; name: string; status: "DRAFT" | "ACTIVE" | "ARCHIVED"; fixture: true; createdAt: string; }
export interface Price { id: string; ownerId: string; channelId: string; productId: string; provider: string; currency: string; amountMinor: number; pricingHypothesis: true; active: boolean; createdAt: string; }
export interface Purchase { id: string; ownerId: string; channelId: string; productId: string; priceId: string; provider: string; checkoutId: string; customerReference: string; status: "PENDING" | "PAID" | "REFUNDED" | "FAILED"; verifiedAt?: string; createdAt: string; }
export interface Entitlement { id: string; ownerId: string; channelId: string; productId: string; purchaseId: string; subjectReference: string; status: "ACTIVE" | "REVOKED" | "REFUNDED"; grantedAt: string; revokedAt?: string; }
export interface CommerceEvent { id: string; ownerId: string; channelId: string; provider: string; providerEventId: string; purchaseId: string; type: "PAYMENT_CONFIRMED" | "PAYMENT_REFUNDED"; verified: true; occurredAt: string; }

export const emptyWorkspace = (): WorkspaceSnapshot => ({ channels: [], videos: [], buildProjects: [], subscribers: [], consentEvents: [], deliveryEvents: [], products: [], prices: [], purchases: [], entitlements: [], commerceEvents: [], conversationMessages: [], changeRequests: [], agentRuns: [], auditEvents: [], mediaProduction: emptyMediaProduction(), idempotency: {} });
