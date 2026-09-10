import {
  videoPortfolioConstraintsSchema,
  type ApprovedVideoExperimentSet,
  type ExperimentMetric,
  type PortfolioAllocation,
  type PortfolioCandidate,
  type PortfolioDisposition,
  type PortfolioSelectionBasis,
  type PortfolioViewerValueDisposition,
  type VideoPortfolioConstraints,
} from "@/domain/production-workflows";

export type MetricFamily = "ACQUISITION" | "RETENTION" | "ENGAGEMENT" | "LOYALTY" | "OTHER";

/**
 * Metric -> viewer-facing family. A cycle whose committed primary metrics are
 * entirely acquisition-side is optimising for clicks with nothing defending the
 * viewer's experience, which is the portfolio-level shape of the metric-gaming
 * failure the Viewer Value doctrine names.
 */
export const PORTFOLIO_METRIC_FAMILY: Record<ExperimentMetric, MetricFamily> = {
  IMPRESSIONS: "ACQUISITION",
  IMPRESSION_CLICK_THROUGH_RATE: "ACQUISITION",
  VIEWS: "ACQUISITION",
  UNIQUE_VIEWERS: "ACQUISITION",
  SUBSCRIBERS_GAINED: "ACQUISITION",
  SEARCH_IMPRESSION_SHARE: "ACQUISITION",
  AVERAGE_VIEW_DURATION: "RETENTION",
  AVERAGE_PERCENTAGE_VIEWED: "RETENTION",
  WATCH_TIME_HOURS: "RETENTION",
  LIKES_RATE: "ENGAGEMENT",
  COMMENTS_RATE: "ENGAGEMENT",
  SHARES: "ENGAGEMENT",
  RETURNING_VIEWERS_RATE: "LOYALTY",
  SURVEY_SATISFACTION: "LOYALTY",
  OTHER: "OTHER",
};

/** Families whose presence among the committed set means the cycle is defending viewer experience, not just acquiring clicks. */
export const VIEWER_BENEFIT_FAMILIES: ReadonlySet<MetricFamily> = new Set<MetricFamily>(["RETENTION", "LOYALTY"]);

/**
 * Which selection bases are legal for which disposition. A basis is not decorative:
 * `CAPACITY_EXHAUSTED` cannot explain a commitment, and `VIEWER_VALUE_RISK` /
 * `NOT_READY` can never explain one either. Enforced deterministically so the
 * rationale prose cannot launder an illegal placement.
 */
export const DISPOSITION_PERMITTED_SELECTION_BASES: Record<PortfolioDisposition, readonly PortfolioSelectionBasis[]> = {
  COMMITTED: [
    "DECISION_BOUND_EVIDENCE_GAP",
    "HIGHEST_UNCERTAINTY_REDUCTION",
    "VIEWER_VALUE_PROTECTION",
    "CHEAPEST_INTERPRETABLE_TEST",
    "BLOCKS_DOWNSTREAM_DECISIONS",
    "OTHER_DISCLOSED",
  ],
  DEFERRED: [
    "CAPACITY_EXHAUSTED",
    "CONFOUND_COLLISION",
    "SEQUENCING_DEPENDENCY",
    "REDUNDANT_WITH_COMMITTED",
    "OTHER_DISCLOSED",
  ],
  EXCLUDED: [
    "VIEWER_VALUE_RISK",
    "NOT_READY",
    "REDUNDANT_WITH_COMMITTED",
    "CONFOUND_COLLISION",
    "OTHER_DISCLOSED",
  ],
};

/** Bases that cite another candidate and are incoherent without one. */
export const CITATION_REQUIRED_BASES: ReadonlySet<PortfolioSelectionBasis> = new Set<PortfolioSelectionBasis>([
  "REDUNDANT_WITH_COMMITTED",
  "SEQUENCING_DEPENDENCY",
  "CONFOUND_COLLISION",
]);

/**
 * Which viewer-value dispositions a candidate's server-projected state permits.
 * A candidate the Experiment vertical marked AT_RISK can never be recorded as
 * "preserved, no action needed" however favourable its metrics look, and an
 * UNKNOWN state can never be silently upgraded to preserved.
 */
export const STATE_PERMITTED_VIEWER_VALUE_DISPOSITIONS: Record<PortfolioCandidate["viewerValueState"], readonly PortfolioViewerValueDisposition[]> = {
  PRESERVED: ["PRESERVED_NO_ACTION_NEEDED", "ESCALATED_FOR_HUMAN_JUDGMENT"],
  AT_RISK: ["ESCALATED_FOR_HUMAN_JUDGMENT", "EXCLUDED_FOR_VIEWER_VALUE_RISK"],
  UNKNOWN: ["UNKNOWN_REQUIRES_EVIDENCE", "ESCALATED_FOR_HUMAN_JUDGMENT", "EXCLUDED_FOR_VIEWER_VALUE_RISK"],
};

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const;

/**
 * The surface a candidate's treatment occupies. Two committed experiments on the
 * same surface contaminate each other's reading, so this is a structural property
 * of the slate rather than a judgement the allocation model gets to make.
 *
 * Channel-wide surfaces (segment, traffic surface, publish window) collide with
 * each other regardless of which video they came from; per-video surfaces collide
 * only within the same video subject. A measurement-only probe manipulates
 * nothing and never collides.
 */
export function assignmentSurfaceKey(candidate: PortfolioCandidate): string | null {
  if (candidate.measurementOnly || candidate.unitOfAssignment === "NONE_OBSERVATIONAL") return null;
  if (candidate.unitOfAssignment === "CHANNEL_SEGMENT" || candidate.unitOfAssignment === "TRAFFIC_SURFACE" || candidate.unitOfAssignment === "PUBLISH_WINDOW") {
    return `unit:${candidate.unitOfAssignment}`;
  }
  return `unit:${candidate.unitOfAssignment}|topic:${candidate.lineage.topicId}`;
}

export function deriveConfoundCollisionGroups(candidates: readonly PortfolioCandidate[]): Array<{ key: string; candidateIds: string[] }> {
  const groups = new Map<string, string[]>();
  for (const candidate of candidates) {
    const key = assignmentSurfaceKey(candidate);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), candidate.candidateId]);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([key, candidateIds]) => ({ key, candidateIds }));
}

/**
 * Derives what a legal allocation may look like, purely from the resolved
 * immutable candidate projections and the operator's declared capacity. The model
 * never decides how many slots exist, which candidates are at risk, which would
 * confound each other, or what the global confidence ceiling is -- those are
 * derived here and re-derived at final QA.
 */
export function deriveVideoPortfolioConstraints(set: ApprovedVideoExperimentSet, cycleLabel: string, concurrentExperimentSlots: number): VideoPortfolioConstraints {
  const candidates = set.artifacts.map((artifact) => artifact.candidate);
  const globalConfidenceCeiling = candidates.reduce<"high" | "medium" | "low">(
    (lowest, candidate) => (CONFIDENCE_ORDER[candidate.confidenceInDesign] < CONFIDENCE_ORDER[lowest] ? candidate.confidenceInDesign : lowest),
    "high",
  );
  return videoPortfolioConstraintsSchema.parse({
    cycleLabel,
    concurrentExperimentSlots,
    candidates,
    citableCandidateIds: candidates.map((candidate) => candidate.candidateId),
    atRiskCandidateIds: candidates.filter((candidate) => candidate.viewerValueState === "AT_RISK").map((candidate) => candidate.candidateId),
    humanJudgmentCandidateIds: candidates.filter((candidate) => candidate.requiresHumanJudgment).map((candidate) => candidate.candidateId),
    notReadyCandidateIds: candidates.filter((candidate) => !candidate.experimentReady).map((candidate) => candidate.candidateId),
    confoundCollisionGroups: deriveConfoundCollisionGroups(candidates),
    globalConfidenceCeiling,
    viewerValueEscalationRequired: candidates.some((candidate) => candidate.escalationRequired || candidate.viewerValueState === "AT_RISK"),
  });
}

/** The committed items of an allocation, in rank order. */
export function committedItems(allocation: PortfolioAllocation) {
  return allocation.items
    .filter((item) => item.disposition === "COMMITTED")
    .sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0));
}

/**
 * Whether this cycle escalates to a human beyond the standard approval gate. An
 * allocation that commits an at-risk or human-judgment-flagged experiment always
 * does, regardless of how favourable the slate looks.
 */
export function derivePortfolioRequiresHumanJudgment(allocation: PortfolioAllocation, constraints: VideoPortfolioConstraints): boolean {
  const committedIds = new Set(committedItems(allocation).map((item) => item.candidateId));
  return constraints.viewerValueEscalationRequired
    || constraints.atRiskCandidateIds.some((id) => committedIds.has(id))
    || constraints.humanJudgmentCandidateIds.some((id) => committedIds.has(id));
}

/**
 * Whether the allocation meets the mandatory structural bar and is safe to hand to
 * an operator. Every clause here is also a blocking deterministic QA rule, so a
 * finalized artifact always has this true -- it is retained as an explicit
 * downstream signal and a tamper-detection anchor, mirroring
 * `deriveExperimentReady`.
 */
export function derivePortfolioReady(allocation: PortfolioAllocation, constraints: VideoPortfolioConstraints): boolean {
  const committed = committedItems(allocation);
  const committedIds = new Set(committed.map((item) => item.candidateId));
  const allocatedIds = new Set(allocation.items.map((item) => item.candidateId));
  const everyCandidateAllocated = constraints.candidates.length === allocation.items.length
    && constraints.candidates.every((candidate) => allocatedIds.has(candidate.candidateId));
  const ranksDense = committed.every((item, index) => item.rank === index + 1);
  const noCollisionCommitted = constraints.confoundCollisionGroups.every(
    (group) => group.candidateIds.filter((id) => committedIds.has(id)).length <= 1,
  );
  return everyCandidateAllocated
    && ranksDense
    && committed.length <= constraints.concurrentExperimentSlots
    && allocation.viewerValueGuardrails.length >= 1
    && allocation.portfolioRisks.length >= 1
    && noCollisionCommitted
    && !constraints.notReadyCandidateIds.some((id) => committedIds.has(id))
    && !committed.some((item) => item.justifiedByPredictedGrowthAlone)
    && (!constraints.atRiskCandidateIds.some((id) => committedIds.has(id)) || allocation.requiresHumanJudgment)
    && (!constraints.humanJudgmentCandidateIds.some((id) => committedIds.has(id)) || allocation.requiresHumanJudgment);
}

/** Capacity utilisation is a fact about the slate, never a model claim. */
export function deriveCapacityUtilization(allocation: PortfolioAllocation, constraints: VideoPortfolioConstraints): PortfolioAllocation["capacityUtilization"] {
  return committedItems(allocation).length >= constraints.concurrentExperimentSlots ? "AT_CAPACITY" : "UNDER_CAPACITY";
}
