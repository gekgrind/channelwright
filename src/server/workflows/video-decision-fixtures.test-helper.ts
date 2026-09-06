import {
  approvedVideoDiagnosisArtifactSchema,
  channelVideoDecisionResultSchema,
  type ApprovedVideoDiagnosisArtifact,
  type ChannelVideoDecisionResult,
  type VideoDecisionContent,
} from "@/domain/production-workflows";
import { approvedVideoPerformanceArtifactFixture, channelVideoDiagnosisResultFixture } from "./video-diagnosis-fixtures.test-helper";
import { deriveVideoDecisionEvidence } from "./video-decision-evidence";

const DIAGNOSIS_RUN_ID = "e8f2d3b4-5e6f-4071-8a2b-3d4e5f6a7b81";
const DIAGNOSIS_WORKFLOW_ID = "e8f2d3b4-5e6f-4071-8a2b-3d4e5f6a7b82";

const performanceArtifact = approvedVideoPerformanceArtifactFixture;
const diagnosisResult = channelVideoDiagnosisResultFixture();

export const approvedVideoDiagnosisArtifactFixture: ApprovedVideoDiagnosisArtifact = approvedVideoDiagnosisArtifactSchema.parse({
  reference: {
    diagnosisWorkflowId: DIAGNOSIS_WORKFLOW_ID,
    diagnosisRunId: DIAGNOSIS_RUN_ID,
    workflowDefinitionVersion: 1,
    outputSchemaVersion: 1,
    approvalId: "e8f2d3b4-5e6f-4071-8a2b-3d4e5f6a7b83",
    approvedBy: "e8f2d3b4-5e6f-4071-8a2b-3d4e5f6a7b84",
    approvedAt: "2026-09-17T10:00:00.000Z",
    finalQaState: "accept",
    finalQaScore: 95,
    diagnosisArtifactHash: "b".repeat(64),
    diagnosisProvenanceHash: "c".repeat(64),
    parentRunId: null,
    rootRunId: DIAGNOSIS_RUN_ID,
    upstreamVideoPerformance: performanceArtifact.reference,
  },
  diagnosisResult,
  decisionScope: {
    artifacts: [
      ...performanceArtifact.diagnosisScope.artifacts,
      { workflowType: "CHANNEL_VIDEO_DIAGNOSIS", runId: DIAGNOSIS_RUN_ID, artifactHash: "b".repeat(64), schemaVersion: 1 },
    ],
    entries: performanceArtifact.diagnosisScope.entries,
    facts: [
      ...performanceArtifact.diagnosisScope.facts,
      { key: "fact:diagnosis-outcome", value: diagnosisResult.analysis.summary.outcome, sourceRef: "diagnosis:/analysis/summary/outcome" },
      { key: "fact:diagnosis-overall-confidence", value: diagnosisResult.analysis.summary.overallConfidence, sourceRef: "diagnosis:/analysis/summary/overallConfidence" },
    ],
  },
});

/** A minimal, deterministically-valid decision content: GATHER_EVIDENCE on OPENING_PROMISE, which Diagnosis always marks AVAILABLE. */
export function videoDecisionContentFixture(overrides: Partial<VideoDecisionContent> = {}): VideoDecisionContent {
  const evidence = deriveVideoDecisionEvidence(approvedVideoDiagnosisArtifactFixture);
  const category = evidence.categories.find((item) => item.category === "OPENING_PROMISE");
  if (!category) throw new Error("Fixture invariant broken: OPENING_PROMISE must be present.");
  return {
    decision: {
      id: "decision:primary",
      decisionType: "GATHER_EVIDENCE",
      disposition: "LEARN_MORE",
      category: "OPENING_PROMISE",
      statement: "Gather retention-curve evidence before judging the opening promise.",
      rationale: "No supported or hypothesis findings exist for OPENING_PROMISE, and the Diagnosis outcome is inconclusive.",
      evidenceBasis: "Diagnosis reported an inconclusive outcome with no findings for this category.",
      supportingFindingIds: [],
      supportingObservationIds: [],
      constrainingUnknownIds: category.constrainingUnknownIds,
      acknowledgedContradictions: [],
      confidence: "low",
      reversibility: "EASILY_REVERSIBLE",
      risk: "low",
      urgency: "low",
      expectedLearningValue: "A retention curve would clarify whether the opening promise is actually retaining viewers.",
      evidenceStrength: category.evidenceStrength,
      evidenceToStrengthen: ["Retention curve or time-bucket data tied to the exact video."],
      evidenceThatWouldReverse: ["A retention curve showing no early drop would support preserving the current approach instead."],
      measurementObjective: {
        objective: "Determine whether viewers who see the opening drop off before the promised payoff.",
        boundedScope: "Retention curve for this exact video only, no experiment design.",
        experimentDesignDeferred: true,
      },
      requiresHumanJudgment: false,
      executionDeferred: true,
    },
    alternatives: [
      {
        id: "alt:preserve",
        decisionType: "PRESERVE_CURRENT_APPROACH",
        statement: "Keep the current opening as-is without further measurement.",
        supportingFindingIds: [],
        contradictingFindingIds: [],
        blockingUnknownIds: category.constrainingUnknownIds,
        notSelectedBecause: "INSUFFICIENT_EVIDENCE",
        notSelectedReason: "There is no evidence either way, so passively preserving forgoes a cheap opportunity to learn.",
      },
    ],
    diagnosisDisagreements: [],
    viewerValueImpact: {
      inheritedState: evidence.viewerValueState,
      promiseIntegrityRisk: "NONE",
      metricGainVersusViewerBenefit: "No metric-gain claim is made; this decision only proposes gathering evidence.",
      escalationRequired: false,
    },
    experimentEligible: false,
    ...overrides,
  };
}

export function channelVideoDecisionResultFixture(overrides: Partial<ChannelVideoDecisionResult> = {}): ChannelVideoDecisionResult {
  const artifact = approvedVideoDiagnosisArtifactFixture;
  const evidence = deriveVideoDecisionEvidence(artifact);
  return channelVideoDecisionResultSchema.parse({
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_DECISION",
    decidedAt: "2026-09-17T10:01:00.000Z",
    source: {
      diagnosisWorkflowId: artifact.reference.diagnosisWorkflowId,
      diagnosisRunId: artifact.reference.diagnosisRunId,
      performanceWorkflowId: artifact.reference.upstreamVideoPerformance.performanceWorkflowId,
      performanceRunId: artifact.reference.upstreamVideoPerformance.performanceRunId,
      releaseWorkflowId: artifact.reference.upstreamVideoPerformance.upstreamVideoRelease.releaseWorkflowId,
      releaseRunId: artifact.reference.upstreamVideoPerformance.upstreamVideoRelease.releaseRunId,
      topicId: artifact.diagnosisResult.source.topicId,
      pillarId: artifact.diagnosisResult.source.pillarId,
      finalTitle: artifact.diagnosisResult.source.finalTitle,
      subjectIdentity: `diagnosis:${artifact.reference.diagnosisRunId}`,
    },
    approvedVideoDiagnosisReference: artifact.reference,
    decisionScope: artifact.decisionScope,
    decisionEvidence: evidence,
    content: videoDecisionContentFixture(),
    viewerValueProvenance: artifact.diagnosisResult.viewerValueProvenance,
    crossModelReview: {
      analyst: { provider: "openai", model: "analyst-test", role: "GENERATOR", operation: "video_decision_analysis", invokedAt: "2026-09-17T10:01:00.000Z" },
      critic: { provider: "anthropic", model: "critic-test", role: "CRITIC", operation: "video_decision_critique", invokedAt: "2026-09-17T10:01:30.000Z" },
      outcome: "AGREED", safeToFinalize: true, findings: [], summary: "No blocking issue was found.",
    },
    modelProvenance: [
      { provider: "openai", model: "analyst-test", role: "GENERATOR", operation: "video_decision_analysis", invokedAt: "2026-09-17T10:01:00.000Z" },
      { provider: "anthropic", model: "critic-test", role: "CRITIC", operation: "video_decision_critique", invokedAt: "2026-09-17T10:01:30.000Z" },
    ],
    ...overrides,
  });
}
