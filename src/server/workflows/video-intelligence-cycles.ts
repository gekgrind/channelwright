import {
  videoIntelligenceConstraintsSchema,
  type ApprovedVideoPortfolioSet,
  type ChannelLearning,
  type ChannelLearningRecord,
  type IntelligenceAdoptionStance,
  type IntelligenceCycle,
  type IntelligencePatternClass,
  type IntelligenceViewerValueImplication,
  type IntelligenceViewerValueTrend,
  type VideoIntelligenceConstraints,
} from "@/domain/production-workflows";

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const;

/**
 * Which adoption stances a learning's Viewer Value implication permits.
 *
 * The channel-level metric-gaming failure this vertical exists to prevent is a
 * channel that observes "this degrades the viewer experience but the numbers went
 * up" and encodes it as a durable channel practice. A learning whose implication
 * is DEGRADES_VIEWER_EXPERIENCE can therefore never be adopted as channel
 * practice or even held provisionally -- the only legal stances are rejecting it
 * or demanding more evidence. This is a structural bar, not a prose warning.
 */
export const IMPLICATION_PERMITTED_ADOPTION_STANCES: Record<IntelligenceViewerValueImplication, readonly IntelligenceAdoptionStance[]> = {
  PROTECTS_VIEWER_EXPERIENCE: ["ADOPT_AS_CHANNEL_PRACTICE", "TREAT_AS_PROVISIONAL", "REQUIRES_MORE_EVIDENCE"],
  NEUTRAL: ["ADOPT_AS_CHANNEL_PRACTICE", "TREAT_AS_PROVISIONAL", "REQUIRES_MORE_EVIDENCE"],
  UNKNOWN_REQUIRES_EVIDENCE: ["TREAT_AS_PROVISIONAL", "REQUIRES_MORE_EVIDENCE"],
  DEGRADES_VIEWER_EXPERIENCE: ["REJECT_AS_HARMFUL", "REQUIRES_MORE_EVIDENCE"],
};

/**
 * Pattern classes that make a claim about the channel's Viewer Value exposure.
 * A learning in one of these classes cannot record a NEUTRAL implication: the
 * class already asserts the viewer is implicated, so "neutral" is a contradiction
 * the deterministic validator catches rather than a nuance.
 */
export const VIEWER_VALUE_BEARING_PATTERN_CLASSES: ReadonlySet<IntelligencePatternClass> = new Set<IntelligencePatternClass>([
  "VIEWER_VALUE_RISK_RECURS",
]);

/** Cycles that actually committed at least one at-risk experiment, in chronological order. */
export function cyclesWithCommittedAtRisk(cycles: readonly IntelligenceCycle[]): string[] {
  return chronological(cycles).filter((cycle) => cycle.committedAtRiskCount > 0).map((cycle) => cycle.cycleId);
}

/** Cycles in allocation order. `allocatedAt` is the immutable timestamp on each approved allocation, never a model claim. */
export function chronological(cycles: readonly IntelligenceCycle[]): IntelligenceCycle[] {
  return [...cycles].sort((left, right) =>
    left.allocatedAt === right.allocatedAt
      ? left.portfolioRunId.localeCompare(right.portfolioRunId)
      : left.allocatedAt.localeCompare(right.allocatedAt));
}

/**
 * The channel's Viewer Value trajectory across the horizon, derived purely from
 * how many at-risk experiments each cycle actually committed.
 *
 * Split the chronology in half (the later half takes the odd cycle) and compare
 * at-risk commitment rates. A channel committing proportionally more at-risk work
 * later in the horizon is DETERIORATING, which forces human escalation regardless
 * of what the record's prose says about it. A horizon in which nothing was ever
 * committed carries no signal at all and says so rather than claiming stability.
 */
export function deriveViewerValueTrend(cycles: readonly IntelligenceCycle[]): IntelligenceViewerValueTrend {
  const ordered = chronological(cycles);
  const totalCommitted = ordered.reduce((sum, cycle) => sum + cycle.committedCount, 0);
  if (totalCommitted === 0) return "INSUFFICIENT_SIGNAL";
  const split = Math.floor(ordered.length / 2);
  const earlier = ordered.slice(0, split);
  const later = ordered.slice(split);
  const rate = (window: readonly IntelligenceCycle[]) => {
    const committed = window.reduce((sum, cycle) => sum + cycle.committedCount, 0);
    return committed === 0 ? null : window.reduce((sum, cycle) => sum + cycle.committedAtRiskCount, 0) / committed;
  };
  const earlierRate = rate(earlier);
  const laterRate = rate(later);
  if (earlierRate === null || laterRate === null) return "INSUFFICIENT_SIGNAL";
  if (laterRate > earlierRate) return "DETERIORATING";
  if (laterRate < earlierRate) return "IMPROVING";
  return laterRate > 0 ? "DETERIORATING" : "STABLE";
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/**
 * Derives what a legal channel learning record may look like, purely from the
 * resolved immutable cycle projections and the operator's declared horizon. The
 * model never decides which cycles exist, in what order they happened, which
 * diagnosis categories / treatment mechanisms / pillars were actually observed,
 * how the Viewer Value exposure moved, or what the evidence ceiling is -- those
 * are derived here and re-derived at final QA.
 */
export function deriveVideoIntelligenceConstraints(set: ApprovedVideoPortfolioSet, horizonLabel: string): VideoIntelligenceConstraints {
  const cycles = set.artifacts.map((artifact) => artifact.cycle);
  const anchor = set.artifacts[0].reference.strategyAnchor;
  const commitments = cycles.flatMap((cycle) => cycle.commitments);
  const evidenceCeiling = cycles.reduce<"high" | "medium" | "low">(
    (lowest, cycle) => (CONFIDENCE_ORDER[cycle.globalConfidenceCeiling] < CONFIDENCE_ORDER[lowest] ? cycle.globalConfidenceCeiling : lowest),
    "high",
  );
  const viewerValueTrend = deriveViewerValueTrend(cycles);
  return videoIntelligenceConstraintsSchema.parse({
    horizonLabel,
    anchoredStrategyRunId: anchor.strategyRunId,
    anchoredStrategyArtifactHash: anchor.strategyArtifactHash,
    cycles,
    citableCycleIds: cycles.map((cycle) => cycle.cycleId),
    chronology: chronological(cycles).map((cycle) => cycle.cycleId),
    cyclesWithCommittedAtRiskIds: cyclesWithCommittedAtRisk(cycles),
    observedCategories: unique(commitments.map((commitment) => commitment.category)),
    observedTreatmentMechanisms: unique(commitments.map((commitment) => commitment.treatmentMechanism)),
    observedPillarIds: unique(commitments.map((commitment) => commitment.pillarId)),
    totalCommittedExperiments: commitments.length,
    viewerValueTrend,
    escalationRequired: viewerValueTrend === "DETERIORATING" || cycles.some((cycle) => cycle.committedAtRiskCount > 0 || cycle.requiresHumanJudgment),
    evidenceCeiling,
  });
}

/**
 * Whether this horizon escalates to a human beyond the standard approval gate. A
 * record synthesized over cycles that committed at-risk work, or whose Viewer
 * Value exposure is worsening, always does -- regardless of how encouraging the
 * learnings read.
 */
export function deriveIntelligenceRequiresHumanJudgment(record: ChannelLearningRecord, constraints: VideoIntelligenceConstraints): boolean {
  return constraints.escalationRequired
    || constraints.viewerValueTrend === "DETERIORATING"
    || record.learnings.some((learning) => learning.viewerValueImplication === "DEGRADES_VIEWER_EXPERIENCE");
}

/** A learning may never claim more confidence than the weakest cycle it rests on. */
export function learningExceedsEvidenceCeiling(learning: ChannelLearning, constraints: VideoIntelligenceConstraints): boolean {
  return CONFIDENCE_ORDER[learning.confidence] > CONFIDENCE_ORDER[constraints.evidenceCeiling];
}

/**
 * Whether the record meets the mandatory structural bar and is safe to hand to an
 * operator. Every clause here is also a blocking deterministic QA rule, so a
 * finalized artifact always has this true -- it is retained as the explicit
 * downstream signal and a tamper-detection anchor, mirroring `derivePortfolioReady`.
 */
export function deriveIntelligenceReady(record: ChannelLearningRecord, constraints: VideoIntelligenceConstraints): boolean {
  const citable = new Set(constraints.citableCycleIds);
  const learningIds = new Set(record.learnings.map((learning) => learning.id));
  const growthOnlyIds = new Set(record.learnings.filter((learning) => learning.justifiedByAudienceGrowthAlone).map((learning) => learning.id));
  const everyCitationKnown = record.learnings.every((learning) =>
    learning.supportingCycleIds.every((id) => citable.has(id)) && learning.contradictingCycleIds.every((id) => citable.has(id)));
  const signal = record.strategyReviewSignal;
  return everyCitationKnown
    && record.learnings.every((learning) => IMPLICATION_PERMITTED_ADOPTION_STANCES[learning.viewerValueImplication].includes(learning.adoptionStance))
    && !record.learnings.some((learning) => learningExceedsEvidenceCeiling(learning, constraints))
    && !record.learnings.some((learning) => learning.justifiedByAudienceGrowthAlone && learning.confidence === "high")
    && signal.anchoredStrategyRunId === constraints.anchoredStrategyRunId
    && signal.contradictedElements.every((entry) => entry.supportingLearningIds.every((id) => learningIds.has(id) && !growthOnlyIds.has(id)))
    && record.viewerValueGuardrails.length >= 1
    && record.channelRisks.length >= 1
    && record.openQuestions.length >= 1
    && (constraints.viewerValueTrend !== "DETERIORATING" || record.requiresHumanJudgment);
}
