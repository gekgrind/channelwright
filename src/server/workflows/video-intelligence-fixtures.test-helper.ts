import {
  approvedVideoPortfolioSetSchema,
  channelVideoIntelligenceResultSchema,
  type ApprovedVideoPortfolioArtifact,
  type ApprovedVideoPortfolioSet,
  type ChannelLearning,
  type ChannelVideoIntelligenceResult,
  type IntelligenceAlternative,
  type IntelligenceCommitment,
  type IntelligenceCycle,
  type StrategyReviewSignal,
  type VideoIntelligenceContent,
} from "@/domain/production-workflows";
import { buildIntelligenceScope } from "./approved-portfolio-resolver";
import {
  cyclesWithCommittedAtRisk,
  deriveIntelligenceReady,
  deriveIntelligenceRequiresHumanJudgment,
  deriveVideoIntelligenceConstraints,
} from "./video-intelligence-cycles";

const HEX = "0123456789abcdef";
/** Deterministic, readable, schema-valid UUIDs so fixtures are stable across runs. */
export function fixtureUuid(seed: number): string {
  const body = Array.from({ length: 32 }, (_, index) => HEX[(seed * 7 + index * 11 + 3) % 16]).join("");
  return `${body.slice(0, 8)}-${body.slice(8, 12)}-4${body.slice(13, 16)}-a${body.slice(17, 20)}-${body.slice(20, 32)}`;
}

const SHA = (seed: number) => Array.from({ length: 64 }, (_, index) => HEX[(seed * 13 + index * 5 + 1) % 16]).join("");

export const FIXTURE_HORIZON_LABEL = "2026 Learning Horizon";
/** Every fixture cycle descends from this one approved strategy: the channel anchor. */
export const FIXTURE_STRATEGY_RUN_ID = fixtureUuid(11);
export const FIXTURE_STRATEGY_HASH = SHA(11);
export const FIXTURE_RESEARCH_RUN_ID = fixtureUuid(12);
export const FIXTURE_RESEARCH_HASH = SHA(12);

export function buildCommitment(index: number, overrides: Partial<IntelligenceCommitment> = {}): IntelligenceCommitment {
  return {
    candidateId: `cand:${fixtureUuid(700 + index)}`,
    experimentType: "CONTROLLED_COMPARISON",
    category: "OPENING_PROMISE",
    treatmentMechanism: "PROMISE_FRAMING",
    primaryMetric: "AVERAGE_PERCENTAGE_VIEWED",
    primaryMetricDirection: "INCREASE",
    selectionBasis: "DECISION_BOUND_EVIDENCE_GAP",
    viewerValueDisposition: "PRESERVED_NO_ACTION_NEEDED",
    viewerValueState: "PRESERVED",
    promiseIntegrityRisk: "NONE",
    decisionType: "INVESTIGATE",
    pillarId: "pillar:evidence",
    ...overrides,
  };
}

export type CycleOverrides = Partial<Omit<IntelligenceCycle, "cycleId" | "portfolioRunId" | "portfolioWorkflowId">>;

/**
 * One resolved cycle exactly as the database resolver would project it. The index
 * seeds every identifier so fixtures stay distinct and deterministic, and
 * `committedCount` is kept consistent with `commitments` because the schema
 * refines that pair.
 */
export function buildApprovedPortfolioArtifact(index: number, overrides: CycleOverrides = {}): ApprovedVideoPortfolioArtifact {
  const portfolioRunId = fixtureUuid(100 + index);
  const portfolioWorkflowId = fixtureUuid(200 + index);
  const commitments = overrides.commitments ?? [buildCommitment(index * 2), buildCommitment(index * 2 + 1, { category: "PACKAGING", primaryMetric: "IMPRESSION_CLICK_THROUGH_RATE", treatmentMechanism: "THUMBNAIL_OR_TITLE" })];
  const strategyRunId = overrides.strategyRunId ?? FIXTURE_STRATEGY_RUN_ID;
  return {
    reference: {
      portfolioWorkflowId,
      portfolioRunId,
      workflowDefinitionVersion: 1,
      outputSchemaVersion: 1,
      approvalId: fixtureUuid(300 + index),
      approvedBy: fixtureUuid(1),
      approvedAt: "2026-09-07T10:00:00.000Z",
      finalQaState: "accept",
      finalQaScore: 100,
      portfolioArtifactHash: SHA(400 + index),
      portfolioProvenanceHash: SHA(500 + index),
      parentRunId: null,
      rootRunId: portfolioRunId,
      portfolioReady: true,
      strategyAnchor: { strategyRunId, strategyArtifactHash: FIXTURE_STRATEGY_HASH },
      researchAnchor: { researchRunId: FIXTURE_RESEARCH_RUN_ID, researchArtifactHash: FIXTURE_RESEARCH_HASH },
    },
    cycle: {
      cycleId: `cycle:${portfolioRunId}`,
      portfolioWorkflowId,
      portfolioRunId,
      cycleLabel: `Cycle ${index + 1}`,
      allocatedAt: `2026-0${index + 1}-01T10:00:00.000Z`,
      concurrentExperimentSlots: 2,
      candidateCount: 2,
      committedCount: commitments.length,
      deferredCount: 0,
      excludedCount: 0,
      capacityUtilization: "AT_CAPACITY",
      globalConfidenceCeiling: "medium",
      requiresHumanJudgment: false,
      anyCandidateAtRisk: false,
      committedAtRiskCount: 0,
      strategyRunId,
      ...overrides,
      commitments,
    },
    artifacts: [
      { workflowType: "CHANNEL_RESEARCH", runId: FIXTURE_RESEARCH_RUN_ID, artifactHash: FIXTURE_RESEARCH_HASH, schemaVersion: 1 },
      { workflowType: "CHANNEL_STRATEGY", runId: strategyRunId, artifactHash: FIXTURE_STRATEGY_HASH, schemaVersion: 1 },
      { workflowType: "CHANNEL_VIDEO_PORTFOLIO", runId: portfolioRunId, artifactHash: SHA(400 + index), schemaVersion: 1 },
    ],
  };
}

export function buildApprovedPortfolioSet(artifacts: ApprovedVideoPortfolioArtifact[]): ApprovedVideoPortfolioSet {
  return approvedVideoPortfolioSetSchema.parse({ artifacts, intelligenceScope: buildIntelligenceScope(artifacts) });
}

/** The default two-cycle horizon: same strategy anchor, nothing at risk, medium evidence ceiling. */
export function buildDefaultPortfolioSet(count = 2): ApprovedVideoPortfolioSet {
  return buildApprovedPortfolioSet(Array.from({ length: count }, (_, index) => buildApprovedPortfolioArtifact(index)));
}

export type ContentOverrides = {
  learnings?: ChannelLearning[];
  strategyReviewSignal?: StrategyReviewSignal;
  alternatives?: IntelligenceAlternative[];
  record?: Partial<VideoIntelligenceContent["record"]>;
  viewerValueSafeguards?: Partial<VideoIntelligenceContent["viewerValueSafeguards"]>;
  /** Skips the server-derived stamping so a test can assert the tamper rules fire. */
  skipServerStamping?: boolean;
};

export function buildLearning(index: number, cycleIds: string[], overrides: Partial<ChannelLearning> = {}): ChannelLearning {
  return {
    id: `learning:pattern-${index}`,
    patternClass: "EVIDENCE_GAP_PERSISTS_ACROSS_CYCLES",
    statement: "The same opening-promise uncertainty was carried into every cycle in this horizon without ever being closed.",
    evidenceBasis: "Each cycle committed a decision-bound comparison in the opening-promise category and none of them removed the constraining unknown.",
    supportingCycleIds: cycleIds,
    contradictingCycleIds: [],
    confidence: "medium",
    viewerValueImplication: "NEUTRAL",
    adoptionStance: "TREAT_AS_PROVISIONAL",
    justifiedByAudienceGrowthAlone: false,
    whatWouldFalsifyThis: "A cycle that closes the opening-promise unknown without a further comparison would falsify this.",
    ...overrides,
  };
}

export function buildIntelligenceContent(set: ApprovedVideoPortfolioSet, overrides: ContentOverrides = {}): VideoIntelligenceContent {
  const constraints = deriveVideoIntelligenceConstraints(set, FIXTURE_HORIZON_LABEL);
  const cycleIds = constraints.citableCycleIds;
  const learnings = overrides.learnings ?? [buildLearning(1, [...cycleIds])];
  const strategyReviewSignal: StrategyReviewSignal = overrides.strategyReviewSignal ?? {
    signal: "HOLD",
    anchoredStrategyRunId: constraints.anchoredStrategyRunId,
    contradictedElements: [],
    rationale: "The accumulated evidence narrows what is still unknown but does not contradict any element of the anchored strategy yet.",
    humanDecisionRequired: true,
    revisionAuthoredElsewhere: true,
  };

  const baseRecord = {
    id: "intelligence:learning-horizon",
    horizonLabel: FIXTURE_HORIZON_LABEL,
    objective: "State what this channel has actually learned across the horizon and whether the anchored strategy still holds.",
    learnings,
    strategyReviewSignal,
    openQuestions: [{
      id: "question:opening-promise",
      question: "Does the opening promise still describe what viewers are actually looking for?",
      whyItMatters: "Every committed comparison in this horizon assumed it did, and none of them tested the assumption directly.",
      howItCouldBeAnswered: "A future cycle could commit an observational probe rather than another comparison.",
    }],
    channelRisks: [{
      risk: "Repeating the same category of comparison could keep the channel busy without closing the underlying uncertainty.",
      mitigation: "Name the unclosed unknown explicitly so the next cycle has to confront it rather than route around it.",
      residualRisk: "MEDIUM" as const,
    }],
    viewerValueGuardrails: ["No channel lesson is adopted while its viewer-value implication is unknown."],
    reviewTrigger: "Revisit this record once a cycle closes the opening-promise unknown or a new strategy is approved.",
    learningCount: learnings.length,
    cyclesConsidered: constraints.cycles.length,
    viewerValueTrend: constraints.viewerValueTrend,
    requiresHumanJudgment: false,
    executionDeferred: true as const,
    ...overrides.record,
  };

  const record = overrides.skipServerStamping
    ? baseRecord
    : {
      ...baseRecord,
      learningCount: overrides.record?.learningCount ?? learnings.length,
      cyclesConsidered: overrides.record?.cyclesConsidered ?? constraints.cycles.length,
      viewerValueTrend: overrides.record?.viewerValueTrend ?? constraints.viewerValueTrend,
      requiresHumanJudgment: overrides.record?.requiresHumanJudgment ?? deriveIntelligenceRequiresHumanJudgment(baseRecord, constraints),
    };

  const alternatives = overrides.alternatives ?? [{
    id: "alt:recommend-revision-now",
    statement: "Recommend a strategy review on the strength of this horizon alone.",
    signal: strategyReviewSignal.signal === "REVISE_RECOMMENDED" ? "HOLD" as const : "REVISE_RECOMMENDED" as const,
    notSelectedBecause: "PREMATURE" as const,
    notSelectedReason: "The horizon narrows the uncertainty but has not yet contradicted a named element of the anchored strategy.",
  }];

  return {
    record,
    alternatives,
    viewerValueSafeguards: {
      trend: constraints.viewerValueTrend,
      cyclesWithCommittedAtRiskIds: cyclesWithCommittedAtRisk(constraints.cycles),
      metricGamingRisk: "A channel that keeps learning what raises clicks can drift into treating acquisition as the whole of viewer value.",
      guardedMetricGaming: "Every committed comparison in this horizon carried a retention or satisfaction reading alongside its acquisition metric.",
      escalationRequired: constraints.escalationRequired,
      ...overrides.viewerValueSafeguards,
    },
    intelligenceReady: overrides.skipServerStamping ? false : deriveIntelligenceReady(record, constraints),
  };
}

export function buildIntelligenceResult(set: ApprovedVideoPortfolioSet, overrides: ContentOverrides & { content?: VideoIntelligenceContent } = {}): ChannelVideoIntelligenceResult {
  const constraints = deriveVideoIntelligenceConstraints(set, FIXTURE_HORIZON_LABEL);
  const content = overrides.content ?? buildIntelligenceContent(set, overrides);
  return channelVideoIntelligenceResultSchema.parse({
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_INTELLIGENCE",
    synthesizedAt: "2026-09-08T12:00:00.000Z",
    source: {
      horizonLabel: constraints.horizonLabel,
      cycleCount: constraints.cycles.length,
      portfolioRunIds: constraints.cycles.map((cycle) => cycle.portfolioRunId),
      anchoredStrategyRunId: constraints.anchoredStrategyRunId,
      subjectIdentity: `channel-strategy:${constraints.anchoredStrategyRunId}`,
    },
    approvedVideoPortfolioReferences: set.artifacts.map((artifact) => artifact.reference),
    intelligenceScope: set.intelligenceScope,
    intelligenceConstraints: constraints,
    content,
    crossModelReview: {
      analyst: { provider: "openai", model: "gpt-test", role: "GENERATOR", operation: "video_intelligence_synthesis", invokedAt: "2026-09-08T11:59:00.000Z" },
      critic: { provider: "anthropic", model: "claude-test", role: "CRITIC", operation: "video_intelligence_critique", invokedAt: "2026-09-08T11:59:30.000Z" },
      outcome: "AGREED",
      safeToFinalize: true,
      findings: [],
      summary: "Every learning rests on more than one cycle, no lesson exceeds the evidence ceiling, and the record signals rather than authors strategy.",
    },
    modelProvenance: [
      { provider: "openai", model: "gpt-test", role: "GENERATOR", operation: "video_intelligence_synthesis", invokedAt: "2026-09-08T11:59:00.000Z" },
      { provider: "anthropic", model: "claude-test", role: "CRITIC", operation: "video_intelligence_critique", invokedAt: "2026-09-08T11:59:30.000Z" },
    ],
  });
}
