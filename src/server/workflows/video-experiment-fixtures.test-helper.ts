import {
  approvedVideoDecisionArtifactSchema,
  approvedVideoDiagnosisArtifactSchema,
  channelVideoDecisionResultSchema,
  channelVideoExperimentResultSchema,
  type ApprovedVideoDecisionArtifact,
  type ApprovedVideoDiagnosisArtifact,
  type ChannelVideoDecisionResult,
  type ChannelVideoExperimentResult,
  type VideoExperimentContent,
} from "@/domain/production-workflows";
import { deriveVideoDecisionEvidence } from "./video-decision-evidence";
import { approvedVideoDiagnosisArtifactFixture } from "./video-decision-fixtures.test-helper";
import { deriveVideoExperimentConstraints } from "./video-experiment-constraints";
import { channelVideoDiagnosisResultFixture, videoDiagnosisAnalysisFixture } from "./video-diagnosis-fixtures.test-helper";

const DECISION_RUN_ID = "f9a3d4c5-6e7f-4182-9b3c-4d5e6f7a8b91";
const DECISION_WORKFLOW_ID = "f9a3d4c5-6e7f-4182-9b3c-4d5e6f7a8b92";
const SUPPORTED_FINDING_ID = "diag:opening-promise-echo";

// A Diagnosis with one SUPPORTED_INFERENCE finding in OPENING_PROMISE (which
// Diagnosis always marks AVAILABLE) so the category resolves to MODERATE
// evidence strength -- the minimum that lets a Decision be INVESTIGATE, and
// therefore experiment-eligible.
const supportedFinding = {
  id: SUPPORTED_FINDING_ID,
  category: "OPENING_PROMISE" as const,
  severity: "medium" as const,
  epistemicStatus: "SUPPORTED_INFERENCE" as const,
  confidence: "medium" as const,
  claim: "The spoken opening states a concrete promise that the packaged title echoes verbatim.",
  observationIds: ["obs:fact:release-promise"],
  lineageRefs: [],
  supportingEvidence: ["The approved script opening and the final title name the same viewer outcome."],
  contradictoryEvidence: [],
  alternativeExplanations: [],
  additionalEvidenceNeeded: [],
};

const analysis = videoDiagnosisAnalysisFixture({ findings: [supportedFinding] });
const unresolvedUnknownIds = analysis.unknowns.map((item) => item.id);
const diagnosisResult = channelVideoDiagnosisResultFixture({
  analysis: {
    ...analysis,
    summary: {
      outcome: "MIXED",
      strongestFindingIds: [SUPPORTED_FINDING_ID],
      unresolvedUnknownIds,
      overallConfidence: "medium",
      narrative: "One opening-promise alignment inference is supported; retention-side questions remain open.",
      decisionDeferred: true,
    },
  },
});

export const approvedVideoDiagnosisArtifactForExperimentFixture: ApprovedVideoDiagnosisArtifact = approvedVideoDiagnosisArtifactSchema.parse({
  reference: approvedVideoDiagnosisArtifactFixture.reference,
  diagnosisResult,
  decisionScope: approvedVideoDiagnosisArtifactFixture.decisionScope,
});

const decisionEvidence = deriveVideoDecisionEvidence(approvedVideoDiagnosisArtifactForExperimentFixture);
const openingCategoryOrNull = decisionEvidence.categories.find((item) => item.category === "OPENING_PROMISE");
if (!openingCategoryOrNull) throw new Error("Fixture invariant broken: OPENING_PROMISE must be an available Diagnosis category.");
const openingCategory: NonNullable<typeof openingCategoryOrNull> = openingCategoryOrNull;

export function videoDecisionContentForExperimentFixture(): ChannelVideoDecisionResult["content"] {
  return {
    decision: {
      id: "decision:primary",
      decisionType: "INVESTIGATE",
      disposition: "EXPLORE_CHANGE",
      category: "OPENING_PROMISE",
      statement: "Investigate whether the echoed opening promise actually holds viewers through the early window.",
      rationale: "The promise is stated and echoed, but no retention evidence yet shows whether viewers stay for it.",
      evidenceBasis: "One supported alignment inference for OPENING_PROMISE, with retention questions still open.",
      supportingFindingIds: [SUPPORTED_FINDING_ID],
      supportingObservationIds: [],
      constrainingUnknownIds: openingCategory.constrainingUnknownIds,
      acknowledgedContradictions: [],
      confidence: "low",
      reversibility: "EASILY_REVERSIBLE",
      risk: "low",
      urgency: "low",
      expectedLearningValue: "A retention read clarifies whether the opening promise is worth reworking or already effective.",
      evidenceStrength: openingCategory.evidenceStrength,
      evidenceToStrengthen: ["Absolute-audience-retention data tied to this exact video."],
      evidenceThatWouldReverse: ["A flat early retention curve would point to preserving the current opening instead."],
      measurementObjective: null,
      requiresHumanJudgment: false,
      executionDeferred: true,
    },
    alternatives: [
      {
        id: "alt:preserve",
        decisionType: "PRESERVE_CURRENT_APPROACH",
        statement: "Keep the current opening without further measurement.",
        supportingFindingIds: [],
        contradictingFindingIds: [],
        blockingUnknownIds: openingCategory.constrainingUnknownIds,
        notSelectedBecause: "PREMATURE",
        notSelectedReason: "There is no retention evidence either way, so preserving forgoes a cheap chance to learn.",
      },
    ],
    diagnosisDisagreements: [],
    viewerValueImpact: {
      inheritedState: decisionEvidence.viewerValueState,
      promiseIntegrityRisk: "NONE",
      metricGainVersusViewerBenefit: "No metric-gain claim is made; the decision only proposes investigation.",
      escalationRequired: false,
    },
    experimentEligible: true,
  };
}

export const approvedVideoDecisionResultForExperimentFixture: ChannelVideoDecisionResult = channelVideoDecisionResultSchema.parse({
  schemaVersion: 1,
  workflowType: "CHANNEL_VIDEO_DECISION",
  decidedAt: "2026-09-18T09:00:00.000Z",
  source: {
    diagnosisWorkflowId: approvedVideoDiagnosisArtifactForExperimentFixture.reference.diagnosisWorkflowId,
    diagnosisRunId: approvedVideoDiagnosisArtifactForExperimentFixture.reference.diagnosisRunId,
    performanceWorkflowId: approvedVideoDiagnosisArtifactForExperimentFixture.reference.upstreamVideoPerformance.performanceWorkflowId,
    performanceRunId: approvedVideoDiagnosisArtifactForExperimentFixture.reference.upstreamVideoPerformance.performanceRunId,
    releaseWorkflowId: approvedVideoDiagnosisArtifactForExperimentFixture.reference.upstreamVideoPerformance.upstreamVideoRelease.releaseWorkflowId,
    releaseRunId: approvedVideoDiagnosisArtifactForExperimentFixture.reference.upstreamVideoPerformance.upstreamVideoRelease.releaseRunId,
    topicId: diagnosisResult.source.topicId,
    pillarId: diagnosisResult.source.pillarId,
    finalTitle: diagnosisResult.source.finalTitle,
    subjectIdentity: `diagnosis:${approvedVideoDiagnosisArtifactForExperimentFixture.reference.diagnosisRunId}`,
  },
  approvedVideoDiagnosisReference: approvedVideoDiagnosisArtifactForExperimentFixture.reference,
  decisionScope: approvedVideoDiagnosisArtifactForExperimentFixture.decisionScope,
  decisionEvidence,
  content: videoDecisionContentForExperimentFixture(),
  viewerValueProvenance: diagnosisResult.viewerValueProvenance,
  crossModelReview: {
    analyst: { provider: "openai", model: "analyst-test", role: "GENERATOR", operation: "video_decision_analysis", invokedAt: "2026-09-18T09:00:00.000Z" },
    critic: { provider: "anthropic", model: "critic-test", role: "CRITIC", operation: "video_decision_critique", invokedAt: "2026-09-18T09:00:30.000Z" },
    outcome: "AGREED", safeToFinalize: true, findings: [], summary: "No blocking issue was found.",
  },
  modelProvenance: [
    { provider: "openai", model: "analyst-test", role: "GENERATOR", operation: "video_decision_analysis", invokedAt: "2026-09-18T09:00:00.000Z" },
    { provider: "anthropic", model: "critic-test", role: "CRITIC", operation: "video_decision_critique", invokedAt: "2026-09-18T09:00:30.000Z" },
  ],
});

export const approvedVideoDecisionArtifactFixture: ApprovedVideoDecisionArtifact = approvedVideoDecisionArtifactSchema.parse({
  reference: {
    decisionWorkflowId: DECISION_WORKFLOW_ID,
    decisionRunId: DECISION_RUN_ID,
    workflowDefinitionVersion: 1,
    outputSchemaVersion: 1,
    approvalId: "f9a3d4c5-6e7f-4182-9b3c-4d5e6f7a8b93",
    approvedBy: approvedVideoDiagnosisArtifactFixture.reference.approvedBy,
    approvedAt: "2026-09-18T09:30:00.000Z",
    finalQaState: "accept",
    finalQaScore: 92,
    decisionArtifactHash: "d".repeat(64),
    decisionProvenanceHash: "e".repeat(64),
    parentRunId: null,
    rootRunId: DECISION_RUN_ID,
    decisionType: "INVESTIGATE",
    experimentEligible: true,
    upstreamVideoDiagnosis: approvedVideoDiagnosisArtifactForExperimentFixture.reference,
  },
  decisionResult: approvedVideoDecisionResultForExperimentFixture,
  experimentScope: {
    artifacts: [
      ...approvedVideoDiagnosisArtifactForExperimentFixture.decisionScope.artifacts,
      { workflowType: "CHANNEL_VIDEO_DECISION", runId: DECISION_RUN_ID, artifactHash: "d".repeat(64), schemaVersion: 1 },
    ],
    entries: approvedVideoDiagnosisArtifactForExperimentFixture.decisionScope.entries,
    facts: [
      ...approvedVideoDiagnosisArtifactForExperimentFixture.decisionScope.facts,
      { key: "fact:decision-type", value: "INVESTIGATE", sourceRef: "decision:/content/decision/decisionType" },
      { key: "fact:decision-category", value: "OPENING_PROMISE", sourceRef: "decision:/content/decision/category" },
      { key: "fact:experiment-eligible", value: true, sourceRef: "decision:/content/experimentEligible" },
    ],
  },
});

const constraints = deriveVideoExperimentConstraints(approvedVideoDecisionArtifactFixture);

/** A minimal, deterministically-valid experiment: an OBSERVATIONAL_PROBE that manipulates nothing. */
export function videoExperimentContentFixture(overrides: Partial<VideoExperimentContent> = {}): VideoExperimentContent {
  return {
    experiment: {
      id: "experiment:opening-retention-probe",
      experimentType: "OBSERVATIONAL_PROBE",
      disposition: "OBSERVE_ONLY",
      measurementOnly: true,
      category: "OPENING_PROMISE",
      title: "Retention-curve probe for the opening promise",
      hypothesis: "If the opening promise is misaligned with what viewers want, the early retention curve will show a disproportionate drop relative to the channel's typical shape.",
      decisionLinkage: {
        decisionId: constraints.decisionId,
        decisionType: "INVESTIGATE",
        hypothesisUnderTest: "The echoed opening promise retains viewers through the early window.",
        testsDecisionStatement: constraints.decisionStatement,
      },
      targetVariable: "Early-window audience retention for this exact video.",
      unitOfAssignment: "NONE_OBSERVATIONAL",
      controlCondition: {
        kind: "NONE_OBSERVATIONAL",
        description: "No control condition; this is a passive measurement of one already-published video.",
        comparability: "Interpretation compares the observed curve to the channel's own typical early-retention shape, described qualitatively.",
      },
      treatmentCondition: {
        description: "No treatment; the probe only instruments retention measurement.",
        whatChanges: "Nothing changes; this probe only reads retention data already produced by the video.",
        whatStaysConstant: ["The published video", "the title and thumbnail", "the description and chapters"],
      },
      heldConstant: [],
      knownConfounders: [],
      primaryMetric: {
        metric: "AVERAGE_PERCENTAGE_VIEWED",
        unit: "PERCENT",
        direction: "CHANGE",
        rationale: "Early-window percentage viewed is the closest available signal to whether the opening holds attention.",
      },
      guardrailMetrics: [
        {
          metric: "SURVEY_SATISFACTION",
          unit: "SCORE",
          protects: "Viewer satisfaction and trust in the opening promise.",
          degradationSignal: "Qualitative viewer feedback turns negative about the opening feeling misleading.",
        },
      ],
      viewerValueGuardrails: [
        "The probe reads only aggregate retention data already visible to the operator; it introduces no change that could mislead viewers or erode trust.",
      ],
      expectedDirection: {
        statedDirection: "UNKNOWN",
        magnitudeClaim: "QUALITATIVE_ONLY",
        justification: "The Decision established only that the promise is echoed, not whether it retains viewers, so the direction is genuinely unknown.",
      },
      observationWindow: {
        description: "One standard YouTube retention-reporting window for a single published video.",
        rationale: "Retention data stabilises only after impressions accrue across the video's initial distribution.",
        minimumBeforeReading: "Wait until the retention curve stops shifting materially from day to day.",
      },
      exposureRequirement: {
        description: "Enough accumulated views for the retention curve to be stable; the operator confirms the video has cleared its initial view surge.",
        sufficiencyBasis: "OPERATOR_MUST_CONFIRM",
        caveat: "If the video is still gaining views quickly, the curve is not yet trustworthy.",
      },
      stoppingConditions: [
        "The operator reports the retention export is unavailable or unreliable for this video.",
        "A Viewer Value or satisfaction signal degrades during the window, indicating the video itself changed.",
      ],
      failureConditions: [
        "The retention curve shows no disproportionate early drop, so the opening-promise concern is not supported.",
      ],
      invalidationConditions: [
        "YouTube changes retention reporting during the window, making the shape non-comparable to the channel's history.",
      ],
      rollbackPlan: null,
      evidenceRequiredToInterpret: [
        "Absolute-audience-retention curve for this exact video at second-level or bucket-level granularity.",
      ],
      interpretationPlan: {
        ifPrimaryFavorable: "A clean early curve supports preserving the opening and closing this line of investigation.",
        ifPrimaryUnfavorable: "A disproportionate early drop justifies a follow-up Decision about reworking the opening.",
        ifInconclusive: "If the curve is ambiguous, gather an additional window before drawing a conclusion.",
        guardrailPrecedence: true,
      },
      knownUnknowns: [
        "Whether an early retention dip reflects the opening promise or unrelated pacing elsewhere in the video.",
      ],
      supportingDecisionFindingIds: [SUPPORTED_FINDING_ID],
      supportingObservationIds: [],
      constrainingUnknownIds: constraints.citableUnknownIds,
      evidenceStrength: constraints.evidenceStrength,
      confidenceInDesign: "low",
      requiresHumanJudgment: false,
      executionDeferred: true,
    },
    alternatives: [
      {
        id: "alt:sequential",
        experimentType: "SEQUENTIAL_COMPARISON",
        statement: "Rework the opening on the next handful of videos and compare early retention to the recent baseline.",
        targetVariable: "Opening-promise framing on upcoming videos.",
        notSelectedBecause: "PREMATURE",
        notSelectedReason: "The Decision only calls for investigation; changing the opening before reading the current curve would act on an untested hypothesis.",
      },
    ],
    decisionDisagreements: [],
    viewerValueSafeguards: {
      inheritedState: constraints.viewerValueState,
      promiseIntegrityRisk: "NONE",
      metricGamingRisk: "The probe measures retention passively; there is no primary metric to inflate and no change that could trade trust for reach.",
      guardedMetricGaming: "No treatment is applied, so metric gaming is structurally impossible for this probe.",
      escalationRequired: false,
    },
    experimentReady: true,
    portfolioEligible: false,
    ...overrides,
  };
}

export function channelVideoExperimentResultFixture(overrides: Partial<ChannelVideoExperimentResult> = {}): ChannelVideoExperimentResult {
  const artifact = approvedVideoDecisionArtifactFixture;
  const diagnosis = artifact.reference.upstreamVideoDiagnosis;
  const performance = diagnosis.upstreamVideoPerformance;
  return channelVideoExperimentResultSchema.parse({
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_EXPERIMENT",
    designedAt: "2026-09-18T10:01:00.000Z",
    source: {
      decisionWorkflowId: artifact.reference.decisionWorkflowId,
      decisionRunId: artifact.reference.decisionRunId,
      diagnosisWorkflowId: diagnosis.diagnosisWorkflowId,
      diagnosisRunId: diagnosis.diagnosisRunId,
      performanceWorkflowId: performance.performanceWorkflowId,
      performanceRunId: performance.performanceRunId,
      releaseWorkflowId: performance.upstreamVideoRelease.releaseWorkflowId,
      releaseRunId: performance.upstreamVideoRelease.releaseRunId,
      topicId: artifact.decisionResult.source.topicId,
      pillarId: artifact.decisionResult.source.pillarId,
      finalTitle: artifact.decisionResult.source.finalTitle,
      subjectIdentity: `decision:${artifact.reference.decisionRunId}`,
    },
    approvedVideoDecisionReference: artifact.reference,
    experimentScope: artifact.experimentScope,
    experimentConstraints: constraints,
    content: videoExperimentContentFixture(),
    viewerValueProvenance: artifact.decisionResult.viewerValueProvenance,
    crossModelReview: {
      analyst: { provider: "openai", model: "analyst-test", role: "GENERATOR", operation: "video_experiment_design", invokedAt: "2026-09-18T10:01:00.000Z" },
      critic: { provider: "anthropic", model: "critic-test", role: "CRITIC", operation: "video_experiment_critique", invokedAt: "2026-09-18T10:01:30.000Z" },
      outcome: "AGREED", safeToFinalize: true, findings: [], summary: "No blocking issue was found.",
    },
    modelProvenance: [
      { provider: "openai", model: "analyst-test", role: "GENERATOR", operation: "video_experiment_design", invokedAt: "2026-09-18T10:01:00.000Z" },
      { provider: "anthropic", model: "critic-test", role: "CRITIC", operation: "video_experiment_critique", invokedAt: "2026-09-18T10:01:30.000Z" },
    ],
    ...overrides,
  });
}
