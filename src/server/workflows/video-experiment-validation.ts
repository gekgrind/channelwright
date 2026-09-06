import {
  channelVideoExperimentResultSchema,
  videoExperimentQAResultSchema,
  type ApprovedVideoDecisionArtifact,
  type ChannelVideoExperimentResult,
  type VideoExperimentConstraints,
  type VideoExperimentQAResult,
} from "@/domain/production-workflows";
import { canonicalEquals } from "./canonical-json";
import {
  ACQUISITION_METRICS,
  deriveExperimentReady,
  deriveVideoExperimentConstraints,
  EXPERIMENT_TYPE_CONTROL_KIND,
  EXPERIMENT_TYPE_DISPOSITION,
  EXPERIMENT_TYPE_MEASUREMENT_ONLY,
  EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE,
  SATISFACTION_METRICS,
} from "./video-experiment-constraints";

export type Finding = { severity: "error" | "warning" | "info"; code: string; message: string; evidenceIds: string[] };

export type ExperimentValidationContext = {
  result: ChannelVideoExperimentResult;
  artifact: ApprovedVideoDecisionArtifact;
  expectedConstraints: VideoExperimentConstraints;
  maxPayloadBytes: number;
};

export type ExperimentRule = { code: string; severity: Finding["severity"]; check: (ctx: ExperimentValidationContext) => string[] };

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const;
const PROMISE_RISK_ORDER = { NONE: 0, POSSIBLE: 1, LIKELY: 2 } as const;
const EVIDENCE_STRENGTH_CEILING = { STRONG: "high", MODERATE: "medium", WEAK: "low", NONE: "low" } as const;

const CAUSAL_CERTAINTY = /\b(?:causes?|caused|proves?|proven cause|resulted in|led to|is the reason|responsible for|directly driv(?:e|es|en|ing)|made viewers|definitively explains)\b/i;
const NUMBER = /(?<![A-Za-z0-9_.:-])-?\d+(?:\.\d+)?%?(?![A-Za-z0-9_.:-])/g;
const YEAR = /^20\d\d$/;
const FABRICATED_STAT = /\b(?:statistical(?:ly)? significan\w*|p[-\s]?values?|confidence intervals?|significance (?:level|threshold|test)|power analysis|statistically powered|alpha of|effect sizes? of|chi[-\s]?squared?|t[-\s]?tests?)\b/i;
const FABRICATED_SAMPLE = /\b(?:n\s*=\s*\d|sample sizes? of|a sample of \d|at least [\d,]+\s*(?:views|impressions|viewers|sessions|subscribers|clicks|comments|responses)|[\d,]+\s*(?:views|impressions|viewers|sessions)\s*(?:per|minimum|required|needed|or more)|minimum of [\d,]+|[\d,]+\s*data points)/i;
const FABRICATED_FORECAST = /\b(?:\d+(?:\.\d+)?\s*x\s*(?:lift|increase|improvement|return)|expected (?:lift|roi|return|gain|increase) of|projected (?:roi|revenue|lift|views|growth)|\d+(?:\.\d+)?\s*%\s*(?:lift|increase|improvement|uplift|gain)|lift of \d|uplift of \d|(?:expect|expects|expecting|anticipat\w+|predict\w*)\s+(?:a |an |some |roughly |around |about )?(?:\d|significant|large|modest|small|substantial|meaningful|noticeable)?\s*(?:lift|uplift|increase|improvement|gain|bump|jump|boost)\b|\ba (?:lift|uplift|bump|gain) of\b)/i;

// Experiment legitimately DESCRIBES an asset change as its treatment ("the new
// thumbnail leads with the outcome"), so -- unlike Decision -- it does not ban an
// asset-mutation verb family. It bans only publishing-pipeline execution and
// provider/account actions, which always belong to a later stage.
// "publish window" / "publish timing" is a legitimate experimental dimension
// (PUBLISH_WINDOW is a unitOfAssignment value), so bare "publish" is not banned:
// only an imperative publish / upload / go-live / schedule-the-publish action is.
const EXPERIMENT_EXECUTION_LEAKED = new RegExp(
  "\\b(?:(?:re-?)?publish(?:es|ing|ed)?\\s+(?:it\\b|this\\b|the (?:video|cut|edit|change|treatment|thumbnail|title|winner))|unpublish|re-?upload|upload the (?:video|file|cut)|go live\\b|push (?:it |this )?live|roll ?out (?:this|the winner|it)\\b|ship it\\b|schedule the (?:publish|upload|go-live|release)|send (?:a |the )?notification|notify (?:subscribers|the audience)|spend (?:on )?ads?\\b|run (?:an? )?ad(?: campaign)?\\b|buy ads\\b|boost this (?:video|post)|promote this video|change (?:the )?(?:youtube|channel|account) settings|connect (?:the )?(?:oauth|api|account|integration)|grant (?:oauth|api|access))",
  "i",
);
const PORTFOLIO_LEAKED = /\b(?:portfolio|across (?:all|the|multiple|our|several|many) (?:channels|videos|experiments)\b|allocate (?:budget|resources|effort|capacity) across|prioriti[sz]e (?:experiments?|videos?) across|experiment (?:roadmap|backlog|calendar|pipeline|slate)|content calendar|slate of experiments|sequence of experiments|which experiments? (?:to run|come) next)/i;
const INTELLIGENCE_LEAKED = /\b(?:channel strategy|strategic pivot|rewrite the strategy|revise the channel(?: strategy| positioning)?|channel[- ]wide (?:learning|pattern|insight|takeaway)|meta[- ]analysis of (?:all|every)|across the (?:entire )?channel history|update (?:the )?positioning)/i;
const DECISION_OVERRIDE = /\b(?:the (?:decision|call) (?:should|ought to|must|needs to) (?:instead |actually |really |now )?be\b|revise the decision|the decision was wrong|change the decision to|reject the decision|override the decision|we should (?:actually |instead )?(?:preserve|defer|escalate|gather evidence|do nothing) instead|the approved decision is (?:incorrect|mistaken|premature|wrong))/i;
const STOPPING_TRIGGER = /\b(?:guardrail|viewer value|satisfaction|retention|watch ?time|percentage viewed|harm|degrad|misleading|deceptive|trust|promise|complaint|dislike|drop-?off|abandon)/i;
const VIEWER_VALUE_GAMING_TERMS = /\b(?:satisf|retention|watch ?time|mislead|deceptiv|trust|promise|clickbait|bait|padding|overstat|outrage|sensational)/i;
const PROMISE_HARM_TERM = /\b(?:promise|mislead|deceptiv|trust|satisfaction|retention|watch ?time|percentage viewed|complaint|dislike)/i;
const NO_CHANGE_TREATMENT = /^\s*(nothing|none|n\/?a|no change|measurement only|observe only|no manipulation)\b/i;

function freeText(result: ChannelVideoExperimentResult): string[] {
  const { experiment, alternatives, decisionDisagreements, viewerValueSafeguards } = result.content;
  return [
    experiment.title, experiment.hypothesis, experiment.targetVariable,
    experiment.decisionLinkage.hypothesisUnderTest, experiment.decisionLinkage.testsDecisionStatement,
    experiment.controlCondition.description, experiment.controlCondition.comparability,
    experiment.treatmentCondition.description, experiment.treatmentCondition.whatChanges, ...experiment.treatmentCondition.whatStaysConstant,
    ...experiment.heldConstant,
    ...experiment.knownConfounders.flatMap((item) => [item.confounder, item.mitigation]),
    experiment.primaryMetric.rationale,
    ...experiment.guardrailMetrics.flatMap((item) => [item.protects, item.degradationSignal]),
    ...experiment.viewerValueGuardrails,
    experiment.expectedDirection.justification,
    experiment.observationWindow.description, experiment.observationWindow.rationale, experiment.observationWindow.minimumBeforeReading,
    experiment.exposureRequirement.description, experiment.exposureRequirement.caveat,
    ...experiment.stoppingConditions, ...experiment.failureConditions, ...experiment.invalidationConditions,
    ...(experiment.rollbackPlan ? [experiment.rollbackPlan.trigger, experiment.rollbackPlan.action] : []),
    ...experiment.evidenceRequiredToInterpret,
    experiment.interpretationPlan.ifPrimaryFavorable, experiment.interpretationPlan.ifPrimaryUnfavorable, experiment.interpretationPlan.ifInconclusive,
    ...experiment.knownUnknowns,
    ...alternatives.flatMap((item) => [item.statement, item.targetVariable, item.notSelectedReason]),
    ...decisionDisagreements.flatMap((item) => [item.objection, item.basis]),
    viewerValueSafeguards.metricGamingRisk, viewerValueSafeguards.guardedMetricGaming,
  ];
}

function expectedSource(artifact: ApprovedVideoDecisionArtifact) {
  const decision = artifact.decisionResult;
  const diagnosis = artifact.reference.upstreamVideoDiagnosis;
  const performance = diagnosis.upstreamVideoPerformance;
  return {
    decisionWorkflowId: artifact.reference.decisionWorkflowId,
    decisionRunId: artifact.reference.decisionRunId,
    diagnosisWorkflowId: diagnosis.diagnosisWorkflowId,
    diagnosisRunId: diagnosis.diagnosisRunId,
    performanceWorkflowId: performance.performanceWorkflowId,
    performanceRunId: performance.performanceRunId,
    releaseWorkflowId: performance.upstreamVideoRelease.releaseWorkflowId,
    releaseRunId: performance.upstreamVideoRelease.releaseRunId,
    topicId: decision.source.topicId,
    pillarId: decision.source.pillarId,
    finalTitle: decision.source.finalTitle,
    subjectIdentity: `decision:${artifact.reference.decisionRunId}`,
  };
}

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const rule = (code: string, severity: Finding["severity"], check: (ctx: ExperimentValidationContext) => string[]): ExperimentRule => ({ code, severity, check });

/**
 * The single authoritative rule catalogue. `deterministicChecksPassed` /
 * `deterministicChecksFailed` are always computed from this array's length and
 * from distinct failed codes -- never from a hand-maintained literal -- so an
 * added or removed rule can never silently drift the reported count out of sync
 * with what actually ran (the CHANNEL_VIDEO_PERFORMANCE P3 defect class).
 */
export const DETERMINISTIC_VIDEO_EXPERIMENT_RULES: ExperimentRule[] = [
  // --- Upstream integrity ----------------------------------------------------
  rule("UPSTREAM_DECISION_REFERENCE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.approvedVideoDecisionReference, artifact.reference) ? [] : ["The experiment changed the exact approved Decision reference."]),
  rule("EXPERIMENT_SCOPE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.experimentScope, artifact.experimentScope) ? [] : ["The experiment changed the authoritative compact lineage projection."]),
  rule("EXPERIMENT_CONSTRAINTS_PROJECTION_CHANGED", "error", ({ result, expectedConstraints }) =>
    canonicalEquals(result.experimentConstraints, expectedConstraints) ? [] : ["The experiment changed the server-derived constraints projection."]),
  rule("VIEWER_VALUE_PROVENANCE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.viewerValueProvenance, artifact.decisionResult.viewerValueProvenance) ? [] : ["Viewer Value provenance differs from the exact approved Decision artifact."]),
  rule("EXPERIMENT_SOURCE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.source, expectedSource(artifact)) ? [] : ["The experiment source identity does not match authoritative Decision state."]),

  // --- Decision fidelity / eligibility -------------------------------------
  rule("EXPERIMENT_ON_INELIGIBLE_DECISION", "error", ({ artifact, expectedConstraints }) =>
    artifact.reference.experimentEligible === true && (expectedConstraints.decisionType === "INVESTIGATE" || expectedConstraints.decisionType === "PRIORITIZE_CHANGE")
      ? []
      : ["An experiment was designed for a Decision that is not experiment-eligible."]),
  rule("EXPERIMENT_CATEGORY_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.experiment.category === expectedConstraints.decisionCategory ? [] : ["The experiment category does not match the approved Decision's category."]),
  rule("EXPERIMENT_DECISION_LINKAGE_MISMATCH", "error", ({ result, expectedConstraints }) => {
    const linkage = result.content.experiment.decisionLinkage;
    return linkage.decisionId === expectedConstraints.decisionId && linkage.decisionType === expectedConstraints.decisionType
      ? []
      : ["decisionLinkage does not identify the exact approved Decision."];
  }),
  rule("DECISION_REWRITTEN", "error", ({ result }) =>
    freeText(result).some((text) => DECISION_OVERRIDE.test(text)) ? ["The experiment restates, overrides, or contradicts the approved Decision instead of testing it."] : []),
  rule("EXPERIMENT_TYPE_NOT_PERMITTED", "error", ({ result, expectedConstraints }) =>
    expectedConstraints.permittedExperimentTypes.includes(result.content.experiment.experimentType)
      ? []
      : [`${result.content.experiment.experimentType} is not a server-permitted experiment shape for a ${expectedConstraints.decisionType} decision.`]),
  rule("DISAGREED_DECISION_ELEMENT_AS_BASIS", "error", ({ result }) => {
    const disputed = new Set(result.content.decisionDisagreements.map((item) => item.disputedFindingId).filter((id): id is string => id !== null));
    return result.content.experiment.supportingDecisionFindingIds.filter((id) => disputed.has(id)).map((id) => `${id} is both disputed and cited as experiment support.`);
  }),
  rule("DISAGREEMENT_RAISES_CONFIDENCE", "error", ({ result }) =>
    result.content.decisionDisagreements.length > 0 && result.content.experiment.confidenceInDesign === "high"
      ? ["A recorded objection to the Decision cannot itself justify high design confidence."]
      : []),

  // --- Lineage / citation fabrication ------------------------------------
  rule("EXPERIMENT_FINDING_NOT_FOUND", "error", ({ result, expectedConstraints }) => {
    const known = new Set(expectedConstraints.citableFindingIds);
    const cited = [
      ...result.content.experiment.supportingDecisionFindingIds,
      ...result.content.decisionDisagreements.map((item) => item.disputedFindingId).filter((id): id is string => id !== null),
    ];
    return cited.filter((id) => !known.has(id)).map((id) => `${id} is not a finding the approved Decision cited.`);
  }),
  rule("EXPERIMENT_OBSERVATION_NOT_FOUND", "error", ({ result, expectedConstraints }) => {
    const known = new Set(expectedConstraints.citableObservationIds);
    return result.content.experiment.supportingObservationIds.filter((id) => !known.has(id)).map((id) => `${id} is not an observation the approved Decision cited.`);
  }),
  rule("EXPERIMENT_UNKNOWN_NOT_FOUND", "error", ({ result, expectedConstraints }) => {
    const known = new Set(expectedConstraints.citableUnknownIds);
    return result.content.experiment.constrainingUnknownIds.filter((id) => !known.has(id)).map((id) => `${id} is not a constraining unknown the approved Decision carried.`);
  }),
  rule("EXPERIMENT_LINEAGE_NOT_FOUND", "error", ({ result }) => {
    const known = new Set(result.experimentScope.entries.map((entry) => entry.key));
    return result.experimentConstraints.citableLineageKeys.filter((key) => !known.has(key)).map((key) => `${key} is not in the authoritative lineage projection.`);
  }),
  rule("DUPLICATE_EXPERIMENT_ID", "error", ({ result }) => {
    const ids = [result.content.experiment.id, ...result.content.alternatives.map((item) => item.id)];
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of ids) { if (seen.has(id)) duplicates.push(id); seen.add(id); }
    return duplicates.map((id) => `${id} is used more than once across the experiment and its alternatives.`);
  }),
  rule("CRITIC_EVIDENCE_NOT_FOUND", "error", ({ result, expectedConstraints }) => {
    const known = new Set([
      ...expectedConstraints.citableFindingIds, ...expectedConstraints.citableUnknownIds,
      ...expectedConstraints.citableObservationIds, ...expectedConstraints.citableLineageKeys,
    ]);
    const messages: string[] = [];
    for (const finding of result.crossModelReview.findings) {
      if (finding.severity === "error" && finding.evidenceRefs.length === 0) messages.push(`Blocking critic issue ${finding.code} must cite authoritative evidence.`);
      for (const ref of finding.evidenceRefs) if (!known.has(ref)) messages.push(`Critic issue ${finding.code} cites unknown evidence ${ref}.`);
    }
    return messages;
  }),

  // --- Epistemic safety / fake precision --------------------------------
  rule("UNSUPPORTED_CAUSAL_CERTAINTY", "error", ({ result }) =>
    freeText(result).some((text) => CAUSAL_CERTAINTY.test(text)) ? ["The experiment uses causal-certainty wording the contract forbids."] : []),
  rule("FABRICATED_QUANTITY_IN_DESIGN", "error", ({ result }) => {
    const messages: string[] = [];
    for (const text of freeText(result)) for (const token of text.match(NUMBER) ?? []) if (!YEAR.test(token)) messages.push(`Numeric quantity ${token} appears in the design; experiment design must stay qualitative.`);
    return messages;
  }),
  rule("FABRICATED_STATISTICAL_CLAIM", "error", ({ result }) =>
    freeText(result).some((text) => FABRICATED_STAT.test(text)) ? ["The experiment states statistical-significance / power claims no data supports."] : []),
  rule("FABRICATED_SAMPLE_SIZE", "error", ({ result }) =>
    freeText(result).some((text) => FABRICATED_SAMPLE.test(text)) ? ["The experiment fabricates a sample size or exposure count; exposure sufficiency must stay qualitative and operator-confirmed."] : []),
  rule("FABRICATED_EFFECT_FORECAST", "error", ({ result }) =>
    freeText(result).some((text) => FABRICATED_FORECAST.test(text)) ? ["The experiment states a fabricated lift, ROI, or expected-effect forecast; no such quantity exists in this contract."] : []),
  rule("MAGNITUDE_CLAIM_NOT_QUALITATIVE", "error", ({ result }) =>
    result.content.experiment.expectedDirection.magnitudeClaim === "QUALITATIVE_ONLY" ? [] : ["expectedDirection.magnitudeClaim must remain QUALITATIVE_ONLY."]),

  // --- Causal interpretability / control -------------------------------
  rule("CONTROL_KIND_MISMATCH", "error", ({ result }) => {
    const experiment = result.content.experiment;
    return experiment.controlCondition.kind === EXPERIMENT_TYPE_CONTROL_KIND[experiment.experimentType]
      ? []
      : ["The control condition kind does not match the server-derived kind for this experiment shape."];
  }),
  rule("CONTROL_TREATMENT_INDISTINGUISHABLE", "error", ({ result }) => {
    const experiment = result.content.experiment;
    if (experiment.experimentType === "OBSERVATIONAL_PROBE") return [];
    if (experiment.treatmentCondition.whatChanges.trim().length === 0) return ["A comparison experiment must state what the treatment changes."];
    return normalize(experiment.treatmentCondition.description) === normalize(experiment.controlCondition.description)
      || normalize(experiment.treatmentCondition.whatChanges) === normalize(experiment.controlCondition.description)
      ? ["The treatment and control conditions are described identically; the comparison would not be interpretable."]
      : [];
  }),
  rule("UNCONTROLLED_CONFOUNDER", "error", ({ result }) => {
    const experiment = result.content.experiment;
    if (experiment.experimentType === "OBSERVATIONAL_PROBE") return [];
    if (experiment.knownConfounders.length === 0) return ["A comparison experiment must name at least one known confounder and its mitigation."];
    return experiment.knownConfounders
      .filter((item) => item.residualRisk === "HIGH" && item.mitigation.trim().length === 0)
      .map((item) => `Confounder "${item.confounder}" has HIGH residual risk and no mitigation.`);
  }),
  rule("NOTHING_HELD_CONSTANT", "error", ({ result }) => {
    const experiment = result.content.experiment;
    return experiment.experimentType !== "OBSERVATIONAL_PROBE" && experiment.heldConstant.length === 0
      ? ["A comparison experiment must hold something constant to keep the comparison interpretable."]
      : [];
  }),
  rule("OBSERVATIONAL_PROBE_MANIPULATES", "error", ({ result }) => {
    const experiment = result.content.experiment;
    if (experiment.experimentType !== "OBSERVATIONAL_PROBE") return [];
    const messages: string[] = [];
    if (experiment.unitOfAssignment !== "NONE_OBSERVATIONAL") messages.push("An observational probe cannot assign a treatment unit.");
    if (!NO_CHANGE_TREATMENT.test(experiment.treatmentCondition.whatChanges)) messages.push("An observational probe changes nothing; treatmentCondition.whatChanges must say so.");
    if (experiment.rollbackPlan !== null) messages.push("An observational probe has nothing to roll back.");
    return messages;
  }),

  // --- Stopping / failure / invalidation / rollback -------------------
  rule("STOPPING_CONDITIONS_INCOHERENT", "error", ({ result }) => {
    const stopping = result.content.experiment.stoppingConditions;
    const guardrailMetricTerms = result.content.experiment.guardrailMetrics.map((item) => item.metric.toLowerCase());
    if (stopping.length < 2) return ["At least two pre-committed stopping conditions are required."];
    const anyGuardTrigger = stopping.some((text) => STOPPING_TRIGGER.test(text) || guardrailMetricTerms.some((metric) => text.toLowerCase().includes(metric)));
    return anyGuardTrigger ? [] : ["No stopping condition is tied to a guardrail metric or a Viewer Value harm signal."];
  }),
  rule("MISSING_FAILURE_CONDITION", "error", ({ result }) =>
    result.content.experiment.failureConditions.length === 0 ? ["The experiment declares no condition under which the hypothesis is not supported."] : []),
  rule("MISSING_INVALIDATION_CONDITION", "error", ({ result }) =>
    result.content.experiment.invalidationConditions.length === 0 ? ["The experiment declares no condition that would make the result itself uninterpretable."] : []),
  rule("ROLLBACK_PLAN_MISSING", "error", ({ result }) => {
    const experiment = result.content.experiment;
    return experiment.experimentType !== "OBSERVATIONAL_PROBE" && experiment.rollbackPlan === null
      ? ["A manipulation experiment requires a rollback plan."]
      : [];
  }),
  rule("TREATMENT_NOT_EASILY_REVERSIBLE", "error", ({ result, expectedConstraints }) => {
    const experiment = result.content.experiment;
    if (experiment.experimentType === "OBSERVATIONAL_PROBE" || experiment.rollbackPlan === null) return [];
    const riskyState = expectedConstraints.viewerValueState !== "PRESERVED" || expectedConstraints.decisionReversibility === "HARD_TO_REVERSE";
    return riskyState && experiment.rollbackPlan.reversibility !== "EASILY_REVERSIBLE"
      ? ["When Viewer Value is not preserved or the decision change is hard to reverse, the experiment treatment must be easily reversible."]
      : [];
  }),

  // --- Viewer Value (hard constraint) ----------------------------------
  rule("VIEWER_VALUE_STATE_CHANGED", "error", ({ result, expectedConstraints }) =>
    result.content.viewerValueSafeguards.inheritedState === expectedConstraints.viewerValueState ? [] : ["Inherited Viewer Value state does not match the approved Decision state."]),
  rule("PROMISE_INTEGRITY_RISK_INCONSISTENT", "error", ({ result, expectedConstraints }) => {
    const safeguards = result.content.viewerValueSafeguards;
    if (safeguards.inheritedState === "AT_RISK" && safeguards.promiseIntegrityRisk === "NONE") return ["Viewer Value inherited state is AT_RISK; promiseIntegrityRisk cannot be NONE."];
    return PROMISE_RISK_ORDER[safeguards.promiseIntegrityRisk] < PROMISE_RISK_ORDER[expectedConstraints.promiseIntegrityRisk]
      ? ["The experiment understates the promise-integrity risk the approved Decision recorded."]
      : [];
  }),
  rule("MISSING_VIEWER_VALUE_GUARDRAIL", "error", ({ result }) =>
    result.content.experiment.viewerValueGuardrails.length === 0 ? ["The experiment declares no Viewer Value guardrail."] : []),
  rule("NO_SATISFACTION_GUARDRAIL_METRIC", "error", ({ result }) => {
    const experiment = result.content.experiment;
    return ACQUISITION_METRICS.has(experiment.primaryMetric.metric) && !experiment.guardrailMetrics.some((item) => SATISFACTION_METRICS.has(item.metric))
      ? ["The primary metric is acquisition-side, but no guardrail metric protects satisfaction, retention, or viewer trust."]
      : [];
  }),
  rule("METRIC_GAMING_UNGUARDED", "error", ({ result }) => {
    const experiment = result.content.experiment;
    if (experiment.interpretationPlan.guardrailPrecedence !== true) return ["interpretationPlan.guardrailPrecedence must be true so a guardrail breach overrides a favorable primary result."];
    return ACQUISITION_METRICS.has(experiment.primaryMetric.metric) && !experiment.viewerValueGuardrails.some((text) => VIEWER_VALUE_GAMING_TERMS.test(text))
      ? ["An acquisition-side primary metric requires an explicit Viewer Value guardrail addressing metric gaming (misleading hooks, padding, outrage bait, or trust erosion)."]
      : [];
  }),
  rule("VIEWER_VALUE_ESCALATION_REQUIRED", "error", ({ result, expectedConstraints }) => {
    const escalationRequired = expectedConstraints.viewerValueEscalationRequired || expectedConstraints.viewerValueState === "AT_RISK";
    if (!escalationRequired) return [];
    return result.content.experiment.requiresHumanJudgment && result.content.viewerValueSafeguards.escalationRequired
      ? []
      : ["Viewer Value escalation is required: requiresHumanJudgment and viewerValueSafeguards.escalationRequired must both be set."];
  }),
  rule("ESCALATION_FLAG_MISMATCH", "error", ({ result, expectedConstraints }) => {
    const required = expectedConstraints.viewerValueEscalationRequired || expectedConstraints.viewerValueState === "AT_RISK";
    return result.content.viewerValueSafeguards.escalationRequired === required ? [] : ["viewerValueSafeguards.escalationRequired does not match the server-derived Viewer Value escalation rule."];
  }),
  rule("AT_RISK_REQUIRES_CONSERVATIVE_DESIGN", "error", ({ result, expectedConstraints }) =>
    expectedConstraints.viewerValueState === "AT_RISK" && result.content.experiment.experimentType === "SEQUENTIAL_COMPARISON"
      ? ["Viewer Value is AT_RISK: a forward-only sequential comparison exposes every viewer to the change; use a holdout, a simultaneous control, or an observational probe."]
      : []),
  rule("VIEWER_VALUE_CONFIDENCE_CAP", "error", ({ result, expectedConstraints }) =>
    expectedConstraints.viewerValueState === "UNKNOWN" && result.content.experiment.confidenceInDesign === "high"
      ? ["Design confidence cannot be high while Viewer Value state is unknown."]
      : []),
  rule("PROMISE_HARM_STOPPING_MISSING", "error", ({ result, expectedConstraints }) => {
    const risky = expectedConstraints.viewerValueState === "AT_RISK" || expectedConstraints.promiseIntegrityRisk !== "NONE";
    if (!risky) return [];
    return result.content.experiment.stoppingConditions.some((text) => PROMISE_HARM_TERM.test(text))
      ? []
      : ["A Viewer-Value-risky experiment must include a stopping condition tied to promise integrity, trust, or satisfaction harm."];
  }),

  // --- Confidence entitlement -----------------------------------------
  rule("DESIGN_CONFIDENCE_EXCEEDS_CEILING", "error", ({ result, expectedConstraints }) => {
    const strengthCeiling = EVIDENCE_STRENGTH_CEILING[expectedConstraints.evidenceStrength];
    const ceilings = [expectedConstraints.globalConfidenceCeiling, expectedConstraints.categoryConfidenceCeiling, strengthCeiling] as const;
    const ceiling = ceilings.reduce((lowest, current) => (CONFIDENCE_ORDER[current] < CONFIDENCE_ORDER[lowest] ? current : lowest));
    return CONFIDENCE_ORDER[result.content.experiment.confidenceInDesign] > CONFIDENCE_ORDER[ceiling]
      ? [`Design confidence ${result.content.experiment.confidenceInDesign} exceeds the evidence-entitled ceiling ${ceiling}.`]
      : [];
  }),
  rule("HIGH_CONFIDENCE_NOT_ALLOWED", "error", ({ result, expectedConstraints }) =>
    result.content.experiment.confidenceInDesign === "high" && (expectedConstraints.evidenceStrength === "WEAK" || expectedConstraints.evidenceStrength === "NONE")
      ? ["High design confidence requires at least MODERATE category evidence in the approved Decision."]
      : []),

  // --- Measurement grounding ----------------------------------------
  rule("MISSING_INTERPRETIVE_EVIDENCE", "error", ({ result }) =>
    result.content.experiment.evidenceRequiredToInterpret.length === 0 ? ["The experiment names no evidence required to interpret its result."] : []),
  rule("UNRESOLVED_UNKNOWN_IGNORED", "error", ({ result, expectedConstraints }) => {
    const carried = new Set(result.content.experiment.constrainingUnknownIds);
    return expectedConstraints.citableUnknownIds.filter((id) => !carried.has(id)).map((id) => `Constraining unknown ${id} from the approved Decision was not carried into the experiment.`);
  }),

  // --- Alternatives -----------------------------------------------
  rule("MISSING_ALTERNATIVE", "error", ({ result }) => {
    const experiment = result.content.experiment;
    return result.content.alternatives.some((item) => item.experimentType !== experiment.experimentType || normalize(item.targetVariable) !== normalize(experiment.targetVariable))
      ? []
      : ["At least one alternative must propose a genuinely different experiment shape or target variable."];
  }),
  rule("ALTERNATIVE_NOT_REJECTED", "error", ({ result }) =>
    result.content.alternatives.filter((item) => item.notSelectedReason.trim().length === 0).map((item) => `${item.id} has no rejection basis.`)),

  // --- Scope boundary -------------------------------------------
  rule("EXPERIMENT_EXECUTION_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => EXPERIMENT_EXECUTION_LEAKED.test(text)) ? ["The experiment contains publishing / provider execution instructions Experiment is never allowed to issue."] : []),
  rule("PORTFOLIO_RESPONSIBILITY_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => PORTFOLIO_LEAKED.test(text)) ? ["The experiment performs cross-video / portfolio prioritization reserved for CHANNEL_VIDEO_PORTFOLIO."] : []),
  rule("INTELLIGENCE_RESPONSIBILITY_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => INTELLIGENCE_LEAKED.test(text)) ? ["The experiment performs channel-wide strategy / meta-learning work reserved for CHANNEL_VIDEO_INTELLIGENCE."] : []),

  // --- Derived-field tampering --------------------------------
  rule("DISPOSITION_MISMATCH", "error", ({ result }) =>
    result.content.experiment.disposition === EXPERIMENT_TYPE_DISPOSITION[result.content.experiment.experimentType] ? [] : ["disposition does not match the server-derived mapping for this experiment shape."]),
  rule("MEASUREMENT_ONLY_MISMATCH", "error", ({ result }) =>
    result.content.experiment.measurementOnly === EXPERIMENT_TYPE_MEASUREMENT_ONLY[result.content.experiment.experimentType] ? [] : ["measurementOnly does not match the server-derived mapping for this experiment shape."]),
  rule("EVIDENCE_STRENGTH_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.experiment.evidenceStrength === expectedConstraints.evidenceStrength ? [] : ["evidenceStrength does not match the approved Decision's category evidence strength."]),
  rule("EXPERIMENT_READY_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.experimentReady === deriveExperimentReady(result.content.experiment, expectedConstraints.viewerValueState) ? [] : ["experimentReady does not match the server-derived readiness of this design."]),
  rule("PORTFOLIO_ELIGIBILITY_MISMATCH", "error", ({ result }) =>
    result.content.portfolioEligible === EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE[result.content.experiment.experimentType] ? [] : ["portfolioEligible does not match the server-derived mapping for this experiment shape."]),

  // --- Model authority / payload -----------------------------
  rule("CRITIC_REJECTED_EXPERIMENT", "error", ({ result }) =>
    !result.crossModelReview.safeToFinalize || result.crossModelReview.findings.some((item) => item.severity === "error")
      ? ["The independent critic found a blocking issue; automated revision is forbidden."]
      : []),
  rule("MODEL_PROVIDER_INDEPENDENCE_REQUIRED", "error", ({ result }) =>
    result.modelProvenance.length !== 2 || result.modelProvenance[0].provider === result.modelProvenance[1].provider
      ? ["Experiment requires exactly one analyst and one distinct-provider critic attribution."]
      : []),
  rule("RESULT_PAYLOAD_TOO_LARGE", "error", ({ result, maxPayloadBytes }) =>
    Buffer.byteLength(JSON.stringify(result), "utf8") > maxPayloadBytes ? ["Experiment exceeds the pre-persistence payload ceiling."] : []),
];

export function deterministicVideoExperimentValidation(
  result: ChannelVideoExperimentResult,
  artifact: ApprovedVideoDecisionArtifact,
  expectedConstraints: VideoExperimentConstraints = deriveVideoExperimentConstraints(artifact),
  maxPayloadBytes = 48_000,
): Finding[] {
  const ctx: ExperimentValidationContext = { result, artifact, expectedConstraints, maxPayloadBytes };
  return DETERMINISTIC_VIDEO_EXPERIMENT_RULES.flatMap((experimentRule) =>
    experimentRule.check(ctx).map((message) => ({ severity: experimentRule.severity, code: experimentRule.code, message, evidenceIds: [] as string[] })));
}

export function videoExperimentQA(findings: Finding[]): VideoExperimentQAResult {
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const distinctFailedCodes = new Set(findings.map((item) => item.code)).size;
  return videoExperimentQAResultSchema.parse({
    passed: errors === 0,
    score: Math.max(0, 100 - errors * 20 - warnings * 5),
    findings: findings.slice(0, 50),
    recommendation: errors === 0 ? (warnings === 0 ? "accept" : "human_review_required") : "revise",
    deterministicChecksPassed: Math.max(0, DETERMINISTIC_VIDEO_EXPERIMENT_RULES.length - distinctFailedCodes),
    deterministicChecksFailed: distinctFailedCodes,
    modelUsage: { model: "deterministic", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
}

export function parseVideoExperimentResult(value: unknown) {
  return channelVideoExperimentResultSchema.parse(value);
}
