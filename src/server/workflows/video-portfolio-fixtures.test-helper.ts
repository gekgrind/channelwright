import {
  approvedVideoExperimentSetSchema,
  channelVideoPortfolioResultSchema,
  type ApprovedVideoExperimentArtifact,
  type ApprovedVideoExperimentSet,
  type ChannelVideoPortfolioResult,
  type PortfolioCandidate,
  type PortfolioLineageWorkflowType,
  type VideoPortfolioContent,
} from "@/domain/production-workflows";
import { buildPortfolioScope } from "./approved-experiment-resolver";
import { approvedVideoDecisionArtifactFixture } from "./video-experiment-fixtures.test-helper";
import {
  committedItems,
  deriveCapacityUtilization,
  derivePortfolioReady,
  derivePortfolioRequiresHumanJudgment,
  deriveVideoPortfolioConstraints,
} from "./video-portfolio-candidates";

const HEX = "0123456789abcdef";
/** Deterministic, readable, schema-valid UUIDs so fixtures are stable across runs. */
export function fixtureUuid(seed: number): string {
  const body = Array.from({ length: 32 }, (_, index) => HEX[(seed * 7 + index * 11 + 3) % 16]).join("");
  return `${body.slice(0, 8)}-${body.slice(8, 12)}-4${body.slice(13, 16)}-a${body.slice(17, 20)}-${body.slice(20, 32)}`;
}

const SHA = (seed: number) => Array.from({ length: 64 }, (_, index) => HEX[(seed * 13 + index * 5 + 1) % 16]).join("");

const LINEAGE_TYPES: PortfolioLineageWorkflowType[] = [
  "CHANNEL_RESEARCH", "CHANNEL_STRATEGY", "CHANNEL_CONTENT_INTELLIGENCE",
  "CHANNEL_VIDEO_BRIEF", "CHANNEL_VIDEO_SCRIPT", "CHANNEL_VIDEO_PACKAGING",
  "CHANNEL_VIDEO_RELEASE", "CHANNEL_VIDEO_PERFORMANCE", "CHANNEL_VIDEO_DIAGNOSIS",
  "CHANNEL_VIDEO_DECISION", "CHANNEL_VIDEO_EXPERIMENT",
];

export type CandidateOverrides = Partial<Omit<PortfolioCandidate, "candidateId" | "experimentRunId" | "experimentWorkflowId" | "lineage">> & {
  topicId?: string;
};

/**
 * One resolved candidate exactly as the database resolver would project it. The
 * index seeds every identifier so fixtures stay distinct and deterministic.
 */
export function buildApprovedExperimentArtifact(index: number, overrides: CandidateOverrides = {}): ApprovedVideoExperimentArtifact {
  const experimentRunId = fixtureUuid(100 + index);
  const experimentWorkflowId = fixtureUuid(200 + index);
  const { topicId, ...candidateOverrides } = overrides;
  return {
    reference: {
      experimentWorkflowId,
      experimentRunId,
      workflowDefinitionVersion: 1,
      outputSchemaVersion: 1,
      approvalId: fixtureUuid(300 + index),
      approvedBy: fixtureUuid(1),
      approvedAt: "2026-09-06T10:00:00.000Z",
      finalQaState: "accept",
      finalQaScore: 100,
      experimentArtifactHash: SHA(400 + index),
      experimentProvenanceHash: SHA(500 + index),
      parentRunId: null,
      rootRunId: experimentRunId,
      experimentType: candidateOverrides.experimentType ?? "CONTROLLED_COMPARISON",
      portfolioEligible: true,
      // The flat upstream summary the resolver projects, drawn from the same
      // approved-Decision reference the Experiment fixtures already build.
      upstreamVideoDecision: {
        decisionWorkflowId: approvedVideoDecisionArtifactFixture.reference.decisionWorkflowId,
        decisionRunId: approvedVideoDecisionArtifactFixture.reference.decisionRunId,
        decisionArtifactHash: approvedVideoDecisionArtifactFixture.reference.decisionArtifactHash,
        decisionProvenanceHash: approvedVideoDecisionArtifactFixture.reference.decisionProvenanceHash,
        decisionType: approvedVideoDecisionArtifactFixture.reference.decisionType,
        experimentEligible: true,
      },
    },
    candidate: {
      candidateId: `cand:${experimentRunId}`,
      experimentWorkflowId,
      experimentRunId,
      experimentId: `experiment:opening-promise-${index}`,
      title: `Opening promise clarity test ${index}`,
      experimentType: "CONTROLLED_COMPARISON",
      disposition: "RUN_COMPARISON",
      measurementOnly: false,
      controlKind: "SIMULTANEOUS_CONTROL",
      category: "OPENING_PROMISE",
      unitOfAssignment: "VIDEO",
      treatmentMechanism: "PROMISE_FRAMING",
      primaryMetric: "AVERAGE_PERCENTAGE_VIEWED",
      primaryMetricDirection: "INCREASE",
      evidenceStrength: "MODERATE",
      confidenceInDesign: "medium",
      requiresHumanJudgment: false,
      experimentReady: true,
      viewerValueState: "PRESERVED",
      promiseIntegrityRisk: "NONE",
      escalationRequired: false,
      evidenceCanChangeShippingDecision: true,
      decisionId: `decision:opening-promise-${index}`,
      decisionType: "INVESTIGATE",
      viewerValueContractHash: SHA(2600 + index),
      lineage: {
        decisionRunId: fixtureUuid(700 + index),
        diagnosisRunId: fixtureUuid(1200 + index),
        performanceRunId: fixtureUuid(1700 + index),
        releaseRunId: fixtureUuid(2200 + index),
        topicId: topicId ?? `topic:evergreen-subject-${index}`,
        pillarId: `pillar:core-${index}`,
        finalTitle: `Video ${index}`,
      },
      ...candidateOverrides,
    },
    artifacts: LINEAGE_TYPES.map((workflowType, position) => ({
      workflowType,
      runId: workflowType === "CHANNEL_VIDEO_EXPERIMENT" ? experimentRunId : fixtureUuid(3000 + index * 20 + position),
      artifactHash: SHA(4000 + index * 20 + position),
      schemaVersion: 1,
    })),
  };
}

export function buildApprovedExperimentSet(overrides: CandidateOverrides[] = [{}, {}]): ApprovedVideoExperimentSet {
  const artifacts = overrides.map((override, index) => buildApprovedExperimentArtifact(index + 1, override));
  return approvedVideoExperimentSetSchema.parse({ artifacts, portfolioScope: buildPortfolioScope(artifacts) });
}

export const FIXTURE_CYCLE_LABEL = "2026 autumn learning cycle";

type ContentOverrides = {
  items?: VideoPortfolioContent["allocation"]["items"];
  allocation?: Partial<VideoPortfolioContent["allocation"]>;
  alternatives?: VideoPortfolioContent["alternatives"];
  viewerValueSafeguards?: Partial<VideoPortfolioContent["viewerValueSafeguards"]>;
  skipServerStamping?: boolean;
};

/**
 * A valid allocation over the supplied candidate set: the first candidate is
 * committed, the rest deferred for capacity. Server-derived fields are stamped
 * exactly as the executor stamps them unless a test deliberately opts out to
 * exercise a tamper rule.
 */
export function buildPortfolioContent(set: ApprovedVideoExperimentSet, slots = 1, overrides: ContentOverrides = {}): VideoPortfolioContent {
  const constraints = deriveVideoPortfolioConstraints(set, FIXTURE_CYCLE_LABEL, slots);
  const candidates = constraints.candidates;
  const items = overrides.items ?? candidates.map((candidate, index) => (index < slots
    ? {
      candidateId: candidate.candidateId,
      disposition: "COMMITTED" as const,
      rank: index + 1,
      selectionBasis: "DECISION_BOUND_EVIDENCE_GAP" as const,
      rationale: "This run closes the evidence gap that currently blocks the pending decision on the opening promise.",
      viewerValueDisposition: "PRESERVED_NO_ACTION_NEEDED" as const,
      justifiedByPredictedGrowthAlone: false,
      revisitCondition: null,
      citedCandidateIds: [],
    }
    : {
      candidateId: candidate.candidateId,
      disposition: "DEFERRED" as const,
      rank: null,
      selectionBasis: "CAPACITY_EXHAUSTED" as const,
      rationale: "The declared cycle capacity is already committed, so this run waits rather than diluting either reading.",
      viewerValueDisposition: candidate.viewerValueState === "AT_RISK"
        ? "ESCALATED_FOR_HUMAN_JUDGMENT" as const
        : candidate.viewerValueState === "UNKNOWN"
          ? "UNKNOWN_REQUIRES_EVIDENCE" as const
          : "PRESERVED_NO_ACTION_NEEDED" as const,
      justifiedByPredictedGrowthAlone: false,
      revisitCondition: "Revisit when a committed run reaches its interpretation point and frees the slot.",
      citedCandidateIds: [],
    }));

  const baseAllocation = {
    id: "portfolio:autumn-learning-cycle",
    cycleLabel: FIXTURE_CYCLE_LABEL,
    objective: "Reduce the largest open uncertainty about the opening promise before committing further production effort.",
    allocationHypothesis: "Concentrating the cycle on one interpretable comparison produces a usable read sooner than splitting attention.",
    items,
    committedCount: 0,
    deferredCount: 0,
    excludedCount: 0,
    capacityUtilization: "UNDER_CAPACITY" as const,
    sequencingNotes: "Committed runs start together; deferred runs wait for a freed slot rather than overlapping on the same surface.",
    portfolioRisks: [{ risk: "A freed slot could tempt an unplanned mid-cycle addition.", mitigation: "Any addition re-enters through a fresh allocation rather than being appended.", residualRisk: "LOW" as const }],
    viewerValueGuardrails: ["No committed run may proceed if viewer satisfaction signals degrade during the cycle."],
    reviewTrigger: "Revisit the whole allocation if any committed run breaches a guardrail or is invalidated.",
    knownUnknowns: ["Whether operator capacity holds for the full cycle."],
    requiresHumanJudgment: false,
    executionDeferred: true as const,
    ...overrides.allocation,
  };

  const allocation = overrides.skipServerStamping
    ? baseAllocation
    : (() => {
      const withCounts = {
        ...baseAllocation,
        committedCount: items.filter((item) => item.disposition === "COMMITTED").length,
        deferredCount: items.filter((item) => item.disposition === "DEFERRED").length,
        excludedCount: items.filter((item) => item.disposition === "EXCLUDED").length,
        ...(overrides.allocation ?? {}),
      };
      return {
        ...withCounts,
        capacityUtilization: overrides.allocation?.capacityUtilization ?? deriveCapacityUtilization(withCounts, constraints),
        requiresHumanJudgment: overrides.allocation?.requiresHumanJudgment ?? derivePortfolioRequiresHumanJudgment(withCounts, constraints),
      };
    })();

  const committed = new Set(committedItems(allocation).map((item) => item.candidateId));
  const alternatives = overrides.alternatives ?? [{
    id: "alt:spread-across-every-candidate",
    statement: "Commit every candidate at once and read them in parallel.",
    committedCandidateIds: candidates.map((candidate) => candidate.candidateId),
    notSelectedBecause: "EXCEEDS_CAPACITY" as const,
    notSelectedReason: "The declared capacity cannot carry every candidate, and overlapping surfaces would confound the readings.",
  }];

  return {
    allocation,
    alternatives,
    viewerValueSafeguards: {
      anyCandidateAtRisk: constraints.atRiskCandidateIds.length > 0,
      committedAtRiskCandidateIds: constraints.atRiskCandidateIds.filter((id) => committed.has(id)),
      metricGamingRisk: "Committing only acquisition-side readings would let click growth hide a worse viewing experience.",
      guardedMetricGaming: "The committed run carries a retention primary metric, so satisfaction is measured alongside reach.",
      escalationRequired: constraints.viewerValueEscalationRequired,
      ...overrides.viewerValueSafeguards,
    },
    portfolioReady: overrides.skipServerStamping ? false : derivePortfolioReady(allocation, constraints),
  };
}

export function buildPortfolioResult(set: ApprovedVideoExperimentSet, slots = 1, overrides: ContentOverrides & { content?: VideoPortfolioContent } = {}): ChannelVideoPortfolioResult {
  const constraints = deriveVideoPortfolioConstraints(set, FIXTURE_CYCLE_LABEL, slots);
  const content = overrides.content ?? buildPortfolioContent(set, slots, overrides);
  return channelVideoPortfolioResultSchema.parse({
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_PORTFOLIO",
    allocatedAt: "2026-09-07T12:00:00.000Z",
    source: {
      cycleLabel: constraints.cycleLabel,
      candidateCount: constraints.candidates.length,
      experimentRunIds: constraints.candidates.map((candidate) => candidate.experimentRunId),
      subjectIdentity: `portfolio-cycle:${constraints.cycleLabel}`,
    },
    approvedVideoExperimentReferences: set.artifacts.map((artifact) => artifact.reference),
    portfolioScope: set.portfolioScope,
    portfolioConstraints: constraints,
    content,
    crossModelReview: {
      analyst: { provider: "openai", model: "gpt-test", role: "GENERATOR", operation: "video_portfolio_allocation", invokedAt: "2026-09-07T11:59:00.000Z" },
      critic: { provider: "anthropic", model: "claude-test", role: "CRITIC", operation: "video_portfolio_critique", invokedAt: "2026-09-07T11:59:30.000Z" },
      outcome: "AGREED",
      safeToFinalize: true,
      findings: [],
      summary: "The allocation stays inside capacity, keeps the committed readings interpretable, and escalates nothing it should not.",
    },
    modelProvenance: [
      { provider: "openai", model: "gpt-test", role: "GENERATOR", operation: "video_portfolio_allocation", invokedAt: "2026-09-07T11:59:00.000Z" },
      { provider: "anthropic", model: "claude-test", role: "CRITIC", operation: "video_portfolio_critique", invokedAt: "2026-09-07T11:59:30.000Z" },
    ],
  });
}
