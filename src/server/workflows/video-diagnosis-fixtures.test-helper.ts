import {
  approvedVideoPerformanceArtifactSchema,
  channelVideoDiagnosisResultSchema,
  type ApprovedVideoPerformanceArtifact,
  type ChannelVideoDiagnosisResult,
  type VideoDiagnosisAnalysis,
} from "@/domain/production-workflows";
import { approvedVideoReleaseReferenceFixture, channelVideoPerformanceResultFixture } from "./video-performance-fixtures.test-helper";
import { deriveVideoDiagnosisObservations } from "./video-diagnosis-observations";

const PERFORMANCE_RUN_ID = "d7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a70";
const PERFORMANCE_WORKFLOW_ID = "d7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a71";
const release = approvedVideoReleaseReferenceFixture;
const packaging = release.upstreamVideoPackaging;
const script = packaging.upstreamVideoScript;
const brief = script.upstreamVideoBrief;
const content = brief.upstreamContentIntelligence;
const strategy = content.upstreamStrategy;
const research = strategy.upstreamResearch;
const performance = channelVideoPerformanceResultFixture();

export const approvedVideoPerformanceArtifactFixture: ApprovedVideoPerformanceArtifact = approvedVideoPerformanceArtifactSchema.parse({
  reference: {
    performanceWorkflowId: PERFORMANCE_WORKFLOW_ID,
    performanceRunId: PERFORMANCE_RUN_ID,
    workflowDefinitionVersion: 1,
    outputSchemaVersion: 1,
    approvalId: "d7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a72",
    approvedBy: "d7f1c2a3-4d5e-4f60-9a1b-2c3d4e5f6a73",
    approvedAt: "2026-09-16T10:00:00.000Z",
    finalQaState: "accept",
    finalQaScore: 93,
    performanceArtifactHash: "9".repeat(64),
    performanceProvenanceHash: "a".repeat(64),
    parentRunId: null,
    rootRunId: PERFORMANCE_RUN_ID,
    upstreamVideoRelease: release,
  },
  performanceResult: performance,
  diagnosisScope: {
    artifacts: [
      { workflowType: "CHANNEL_RESEARCH", runId: research.researchRunId, artifactHash: research.researchArtifactHash, schemaVersion: 1 },
      { workflowType: "CHANNEL_STRATEGY", runId: strategy.strategyRunId, artifactHash: strategy.strategyArtifactHash, schemaVersion: 1 },
      { workflowType: "CHANNEL_CONTENT_INTELLIGENCE", runId: content.contentRunId, artifactHash: content.contentArtifactHash, schemaVersion: 1 },
      { workflowType: "CHANNEL_VIDEO_BRIEF", runId: brief.briefRunId, artifactHash: brief.briefArtifactHash, schemaVersion: 1 },
      { workflowType: "CHANNEL_VIDEO_SCRIPT", runId: script.scriptRunId, artifactHash: script.scriptArtifactHash, schemaVersion: 1 },
      { workflowType: "CHANNEL_VIDEO_PACKAGING", runId: packaging.packagingRunId, artifactHash: packaging.packagingArtifactHash, schemaVersion: 1 },
      { workflowType: "CHANNEL_VIDEO_RELEASE", runId: release.releaseRunId, artifactHash: release.releaseArtifactHash, schemaVersion: 1 },
      { workflowType: "CHANNEL_VIDEO_PERFORMANCE", runId: PERFORMANCE_RUN_ID, artifactHash: "9".repeat(64), schemaVersion: 1 },
    ],
    entries: [
      { key: `lin:pillar:${performance.source.pillarId}`, locator: { kind: "STABLE_ID", entityType: "PILLAR", id: performance.source.pillarId }, parentKeys: [], label: performance.source.pillarName },
      { key: `lin:topic:${performance.source.releaseTopicId}`, locator: { kind: "STABLE_ID", entityType: "TOPIC", id: performance.source.releaseTopicId }, parentKeys: [`lin:pillar:${performance.source.pillarId}`], label: performance.source.workingConcept },
      { key: "lin:title:title:method-first", locator: { kind: "STABLE_ID", entityType: "TITLE_CANDIDATE", id: "title:method-first" }, parentKeys: [`lin:topic:${performance.source.releaseTopicId}`], label: performance.source.finalTitle },
      { key: "lin:strategy-kpi:0", locator: { kind: "ARTIFACT_LOCAL", entityType: "STRATEGY_KPI", workflowType: "CHANNEL_STRATEGY", runId: strategy.strategyRunId, artifactHash: strategy.strategyArtifactHash, schemaVersion: 1, jsonPointer: "/kpiFramework/0" }, parentKeys: [], label: "Click-through rate" },
    ],
    facts: [
      { key: "fact:final-title", value: performance.source.finalTitle, sourceRef: "performance:/source/finalTitle" },
      { key: "fact:release-promise", value: performance.source.releasePromise, sourceRef: "performance:/source/releasePromise" },
      { key: "fact:opening-spoken", value: "Here is the exact scheduling method and the gap it exposes.", sourceRef: "script:/openingHook/spokenOpening" },
    ],
  },
});

export function videoDiagnosisAnalysisFixture(overrides: Partial<VideoDiagnosisAnalysis> = {}): VideoDiagnosisAnalysis {
  const required = deriveVideoDiagnosisObservations(approvedVideoPerformanceArtifactFixture).deterministicUnknowns;
  return {
    findings: [],
    unknowns: required,
    viewerValueAnalysis: { state: "PRESERVED", observationIds: ["obs:fact:release-promise"], performanceVersusValue: "The approved performance record preserves the promise evidence; favorable response metrics do not replace the separate Viewer Value judgment." },
    summary: { outcome: "INCONCLUSIVE", strongestFindingIds: [], unresolvedUnknownIds: required.map((item) => item.id), overallConfidence: "low", narrative: "The available aggregate evidence does not support a more specific diagnosis.", decisionDeferred: true },
    ...overrides,
  };
}

export function channelVideoDiagnosisResultFixture(overrides: Partial<ChannelVideoDiagnosisResult> = {}): ChannelVideoDiagnosisResult {
  const artifact = approvedVideoPerformanceArtifactFixture;
  const set = deriveVideoDiagnosisObservations(artifact);
  return channelVideoDiagnosisResultSchema.parse({
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_DIAGNOSIS",
    diagnosedAt: "2026-09-16T10:01:00.000Z",
    source: {
      performanceWorkflowId: artifact.reference.performanceWorkflowId,
      performanceRunId: artifact.reference.performanceRunId,
      releaseWorkflowId: artifact.reference.upstreamVideoRelease.releaseWorkflowId,
      releaseRunId: artifact.reference.upstreamVideoRelease.releaseRunId,
      topicId: artifact.performanceResult.source.releaseTopicId,
      pillarId: artifact.performanceResult.source.pillarId,
      finalTitle: artifact.performanceResult.source.finalTitle,
      subjectIdentity: `performance:${artifact.reference.performanceRunId}`,
    },
    upstreamVideoPerformance: artifact.reference,
    diagnosisScope: artifact.diagnosisScope,
    observations: set.observations,
    capabilities: set.capabilities,
    analysis: videoDiagnosisAnalysisFixture(),
    viewerValueProvenance: artifact.performanceResult.performanceScope.inheritedViewerValueProvenance,
    crossModelReview: {
      analyst: { provider: "openai", model: "analyst-test", role: "GENERATOR", operation: "video_diagnosis_analysis", invokedAt: "2026-09-16T10:01:00.000Z" },
      critic: { provider: "anthropic", model: "critic-test", role: "CRITIC", operation: "video_diagnosis_critique", invokedAt: "2026-09-16T10:01:30.000Z" },
      outcome: "AGREED", safeToFinalize: true, findings: [], summary: "No blocking epistemic issue was found.",
    },
    modelProvenance: [
      { provider: "openai", model: "analyst-test", role: "GENERATOR", operation: "video_diagnosis_analysis", invokedAt: "2026-09-16T10:01:00.000Z" },
      { provider: "anthropic", model: "critic-test", role: "CRITIC", operation: "video_diagnosis_critique", invokedAt: "2026-09-16T10:01:30.000Z" },
    ],
    ...overrides,
  });
}
