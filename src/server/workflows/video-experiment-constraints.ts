import {
  experimentTypeSchema,
  videoExperimentConstraintsSchema,
  type ApprovedVideoDecisionArtifact,
  type DecisionType,
  type Experiment,
  type ExperimentControlKind,
  type ExperimentDisposition,
  type ExperimentMetric,
  type ExperimentType,
  type VideoExperimentConstraints,
} from "@/domain/production-workflows";

/** All four experiment shapes the taxonomy defines. */
export const ALL_EXPERIMENT_TYPES = experimentTypeSchema.options;

/** Deterministic map: experiment type -> disposition. The model cannot choose its own disposition. */
export const EXPERIMENT_TYPE_DISPOSITION: Record<ExperimentType, ExperimentDisposition> = {
  CONTROLLED_COMPARISON: "RUN_COMPARISON",
  SEQUENTIAL_COMPARISON: "RUN_COMPARISON",
  HOLDOUT_COMPARISON: "RUN_HOLDOUT",
  OBSERVATIONAL_PROBE: "OBSERVE_ONLY",
};

/** Deterministic map: experiment type -> the control condition kind that shape requires. */
export const EXPERIMENT_TYPE_CONTROL_KIND: Record<ExperimentType, ExperimentControlKind> = {
  CONTROLLED_COMPARISON: "SIMULTANEOUS_CONTROL",
  SEQUENTIAL_COMPARISON: "HISTORICAL_BASELINE",
  HOLDOUT_COMPARISON: "HOLDOUT",
  OBSERVATIONAL_PROBE: "NONE_OBSERVATIONAL",
};

/** Deterministic map: experiment type -> whether it manipulates nothing (measurement only). */
export const EXPERIMENT_TYPE_MEASUREMENT_ONLY: Record<ExperimentType, boolean> = {
  CONTROLLED_COMPARISON: false,
  SEQUENTIAL_COMPARISON: false,
  HOLDOUT_COMPARISON: false,
  OBSERVATIONAL_PROBE: true,
};

/**
 * Deterministic map: experiment type -> whether its result is a portfolio-trackable
 * comparative outcome. Comparison experiments feed CHANNEL_VIDEO_PORTFOLIO; a pure
 * observational probe produces a measurement that feeds a future Diagnosis/Decision,
 * not a portfolio comparison. This is the smallest safe downstream contract v1
 * commits to -- the exact CHANNEL_VIDEO_PORTFOLIO consumption shape is deliberately
 * left to that vertical.
 */
export const EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE: Record<ExperimentType, boolean> = {
  CONTROLLED_COMPARISON: true,
  SEQUENTIAL_COMPARISON: true,
  HOLDOUT_COMPARISON: true,
  OBSERVATIONAL_PROBE: false,
};

/**
 * Deterministic map: approved decision type -> the experiment shapes it may license.
 * Only INVESTIGATE and PRIORITIZE_CHANGE are ever experiment-eligible (enforced by
 * the resolver and the Decision contract). PRIORITIZE_CHANGE has already resolved to
 * act, so it must be tested with a real comparison -- a pure observational probe is
 * not permitted. INVESTIGATE is exploratory and may use any shape, including an
 * observational probe to collect a currently-missing measurement.
 */
export const DECISION_TYPE_PERMITTED_EXPERIMENT_TYPES: Record<DecisionType, readonly ExperimentType[]> = {
  INVESTIGATE: ["OBSERVATIONAL_PROBE", "SEQUENTIAL_COMPARISON", "CONTROLLED_COMPARISON", "HOLDOUT_COMPARISON"],
  PRIORITIZE_CHANGE: ["SEQUENTIAL_COMPARISON", "CONTROLLED_COMPARISON", "HOLDOUT_COMPARISON"],
  PRESERVE_CURRENT_APPROACH: [],
  GATHER_EVIDENCE: [],
  DEFER: [],
  ESCALATE_TO_HUMAN_JUDGMENT: [],
};

export function permittedExperimentTypesFor(decisionType: DecisionType): ExperimentType[] {
  return [...DECISION_TYPE_PERMITTED_EXPERIMENT_TYPES[decisionType]];
}

/** Acquisition-side metrics: raising these while satisfaction falls is the classic metric-gaming failure. */
export const ACQUISITION_METRICS: ReadonlySet<ExperimentMetric> = new Set<ExperimentMetric>([
  "IMPRESSIONS", "IMPRESSION_CLICK_THROUGH_RATE", "VIEWS", "SUBSCRIBERS_GAINED", "SEARCH_IMPRESSION_SHARE",
]);

/** Satisfaction / retention / promise-integrity metrics that a metric-gaming guardrail must protect. */
export const SATISFACTION_METRICS: ReadonlySet<ExperimentMetric> = new Set<ExperimentMetric>([
  "AVERAGE_VIEW_DURATION", "AVERAGE_PERCENTAGE_VIEWED", "WATCH_TIME_HOURS", "RETURNING_VIEWERS_RATE", "SURVEY_SATISFACTION",
]);

/**
 * Whether an experiment design meets the mandatory structural safety bar and is
 * ready to hand to execution / portfolio tracking. Every clause here is also a
 * blocking deterministic QA rule, so a finalized artifact always has this true --
 * it is retained as an explicit downstream signal and a tamper-detection anchor.
 */
export function deriveExperimentReady(experiment: Experiment, viewerValueState: VideoExperimentConstraints["viewerValueState"]): boolean {
  const intent = experiment.semanticIntent;
  // ROUND 6: an outcome-independent design is not ready. A comparison experiment
  // is ready only when its evidence can change the shipping decision and it does
  // not preserve the incumbent regardless of the result; an observational probe
  // is ready only when it is explicitly represented as measurement-only.
  const decisionLinkageReady = experiment.measurementOnly
    ? (intent.adoptionCondition === "NONE_MEASUREMENT_ONLY" && intent.preservationCondition === "NONE_MEASUREMENT_ONLY")
    : (intent.evidenceCanChangeShippingDecision === true
      && intent.preservationCondition !== "ALWAYS_REGARDLESS_OF_RESULT"
      && intent.adoptionCondition !== "NONE_MEASUREMENT_ONLY");
  return experiment.viewerValueGuardrails.length >= 1
    && experiment.guardrailMetrics.length >= 1
    && experiment.stoppingConditions.length >= 2
    && experiment.evidenceRequiredToInterpret.length >= 1
    && experiment.interpretationPlan.guardrailPrecedence === true
    && (experiment.measurementOnly || experiment.rollbackPlan !== null)
    && (experiment.measurementOnly || experiment.knownConfounders.length >= 1)
    && (viewerValueState !== "AT_RISK" || experiment.requiresHumanJudgment)
    && decisionLinkageReady;
}

/**
 * Derives what a valid experiment may look like, purely from the resolved
 * immutable approved Decision artifact. The model never decides which experiment
 * shapes are legal, what the confidence ceiling is, which findings/unknowns it may
 * cite, or the inherited Viewer Value state -- those are server-derived here and
 * re-derived at final QA.
 */
export function deriveVideoExperimentConstraints(artifact: ApprovedVideoDecisionArtifact): VideoExperimentConstraints {
  const decisionResult = artifact.decisionResult;
  const decision = decisionResult.content.decision;
  const evidence = decisionResult.decisionEvidence;
  const viewerValueImpact = decisionResult.content.viewerValueImpact;

  const permittedExperimentTypes = permittedExperimentTypesFor(decision.decisionType);
  if (permittedExperimentTypes.length === 0) {
    throw new Error(`EXPERIMENT_ON_INELIGIBLE_DECISION: ${decision.decisionType} does not license any experiment.`);
  }

  const category = evidence.categories.find((item) => item.category === decision.category);

  return videoExperimentConstraintsSchema.parse({
    decisionId: decision.id,
    decisionType: decision.decisionType,
    decisionCategory: decision.category,
    decisionStatement: decision.statement,
    decisionReversibility: decision.reversibility,
    evidenceStrength: decision.evidenceStrength,
    categoryConfidenceCeiling: category?.confidenceCeiling ?? "low",
    globalConfidenceCeiling: evidence.globalConfidenceCeiling,
    viewerValueState: viewerValueImpact.inheritedState,
    promiseIntegrityRisk: viewerValueImpact.promiseIntegrityRisk,
    viewerValueEscalationRequired: viewerValueImpact.escalationRequired,
    permittedExperimentTypes,
    evidenceRequirements: evidence.evidenceRequirements,
    citableFindingIds: decision.supportingFindingIds,
    citableUnknownIds: decision.constrainingUnknownIds,
    citableObservationIds: decision.supportingObservationIds,
    citableLineageKeys: artifact.experimentScope.entries.map((entry) => entry.key),
    unavailableCategories: evidence.categories.filter((item) => item.availability === "UNAVAILABLE").map((item) => item.category),
  });
}
