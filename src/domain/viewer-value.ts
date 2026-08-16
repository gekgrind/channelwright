import { z } from "zod";

/**
 * Channelwright Viewer Value doctrine.
 *
 * Everything Channelwright recommends, plans, scripts, produces, packages, or
 * publishes must deliver identifiable value to an intended viewer. This module
 * is deliberately stage-agnostic: CONTENT_INTELLIGENCE creates the first
 * assessment, and every later stage (video strategy, script, packaging,
 * production, publishing) re-evaluates the same contract so value drift is
 * detectable rather than assumed away.
 *
 * The contract is extensible on purpose. Taxonomies carry an `OTHER` member
 * with a required label so a new kind of value never invalidates a persisted
 * artifact, and no list here is claimed to be exhaustive.
 */

/** Provider-agnostic evidence reference, e.g. `yt:video:<id>`, `yt:search:<hash>`. */
export const evidenceReferenceSchema = z.string().regex(/^[a-z][a-z0-9]{0,15}:[a-z][a-z0-9]{0,23}:[A-Za-z0-9_-]{1,128}$/);
export const evidenceReferenceListSchema = z.array(evidenceReferenceSchema).max(100);

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const boundedList = (maximum: number, items: number) => z.array(boundedText(maximum)).max(items);

/** Non-exhaustive taxonomy of how content can be worth a viewer's time. */
export const viewerValueKindSchema = z.enum([
  "ANSWERS_QUESTION",
  "SOLVES_PROBLEM",
  "TEACHES_SKILL",
  "IMPROVES_DECISION",
  "SAVES_TIME",
  "PREVENTS_MISTAKE",
  "PROVIDES_ANALYSIS",
  "ORIGINAL_SYNTHESIS",
  "PRACTICAL_GUIDANCE",
  "ENTERTAINS",
  "STORYTELLING",
  "PERSPECTIVE",
  "INSIGHT",
  "OTHER",
]);

/** Non-exhaustive taxonomy of how content can contribute beyond existing videos. */
export const originalContributionKindSchema = z.enum([
  "CROSS_SOURCE_SYNTHESIS",
  "CLEARER_EXPLANATION",
  "BETTER_ORGANIZATION",
  "UNIQUE_FRAMEWORK",
  "DIRECT_COMPARISON",
  "PRACTICAL_WALKTHROUGH",
  "ORIGINAL_ANALYSIS",
  "BETTER_EXAMPLES",
  "UNDERSERVED_AUDIENCE_ADAPTATION",
  "UPDATED_EVIDENCE",
  "STRONGER_PROBLEM_SOLVING_ANGLE",
  "OTHER",
]);

export const viewerNeedKindSchema = z.enum(["PROBLEM", "QUESTION", "DECISION", "CURIOSITY", "JOB_TO_BE_DONE", "DESIRE", "OTHER"]);

/**
 * A single judged dimension. `not_applicable` exists because value is
 * format-sensitive: a narrative documentary is not less valuable because it
 * lacks a checklist. An unjustified `not_applicable` is a QA concern, not a
 * schema one.
 */
export const viewerValueDimensionSchema = z.object({
  verdict: z.enum(["strong", "adequate", "weak", "absent", "not_applicable"]),
  rationale: boundedText(600),
  evidenceIds: evidenceReferenceListSchema,
}).strict();

const labelledKinds = <T extends z.ZodTypeAny>(kind: T) => z.object({
  kind,
  label: boundedText(200).nullable(),
}).strict();

export const viewerValueContractSchema = z.object({
  schemaVersion: z.literal(1),
  intendedViewer: boundedText(600),
  viewerNeed: z.object({
    kind: viewerNeedKindSchema,
    statement: boundedText(600),
    urgency: z.enum(["high", "medium", "low", "unknown"]),
    urgencyRationale: boundedText(600),
    evidenceIds: evidenceReferenceListSchema,
  }).strict(),
  valuePromise: z.object({
    statement: boundedText(600),
    kinds: z.array(labelledKinds(viewerValueKindSchema)).min(1).max(8),
    viewerOutcome: boundedText(600),
    specificity: viewerValueDimensionSchema,
  }).strict(),
  originalContribution: z.object({
    kinds: z.array(labelledKinds(originalContributionKindSchema)).min(1).max(8),
    statement: boundedText(600),
    assessment: viewerValueDimensionSchema,
  }).strict(),
  differentiation: viewerValueDimensionSchema,
  evidenceSupport: viewerValueDimensionSchema,
  actionability: viewerValueDimensionSchema,
  trustworthiness: viewerValueDimensionSchema,
  sustainability: viewerValueDimensionSchema,
}).strict();

/** Non-exhaustive integrity risks whose presence makes a concept fail closed. */
export const contentIntegrityRiskSchema = z.enum([
  "UNSUPPORTED_INCOME_CLAIM",
  "GUARANTEED_OUTCOME",
  "FABRICATED_EVENT",
  "FABRICATED_STATISTIC",
  "FABRICATED_TESTIMONIAL",
  "FABRICATED_SEARCH_VOLUME",
  "FABRICATED_DEMOGRAPHICS",
  "FABRICATED_PERFORMANCE_PREDICTION",
  "MISLEADING_PACKAGING",
  "FALSE_AUTHORITY",
  "HEALTH_OUTCOME_CLAIM",
  "FALSE_URGENCY",
  "INAUTHENTIC_MASS_PRODUCED",
  "OTHER",
]);

export const contentIntegrityFindingSchema = z.object({
  risk: contentIntegrityRiskSchema,
  label: boundedText(200).nullable(),
  severity: z.enum(["blocking", "material", "advisory"]),
  explanation: boundedText(600),
  evidenceIds: evidenceReferenceListSchema,
}).strict();

/**
 * Policy signals are produced here and consumed by later production/publishing
 * stages. Categories are intentionally generic so evolving platform policy is
 * configuration and QA prompting, not hard-coded business logic.
 */
export const policySignalSchema = z.object({
  category: z.enum(["ORIGINALITY", "MISLEADING_METADATA", "SYNTHETIC_MEDIA_DISCLOSURE", "ADVERTISER_FRIENDLINESS", "COMMUNITY_GUIDELINES", "OTHER"]),
  label: boundedText(200).nullable(),
  status: z.enum(["OK", "REVIEW_REQUIRED", "AT_RISK", "NOT_ASSESSED"]),
  note: boundedText(600),
}).strict();

export const viewerValueGateSchema = z.enum(["PASS", "REVISE", "REJECT"]);

export const viewerValueAssessmentSchema = z.object({
  schemaVersion: z.literal(1),
  contract: viewerValueContractSchema,
  strengths: z.array(boundedText(400)).min(1).max(5),
  weaknesses: boundedList(400, 5),
  assumptions: z.array(boundedText(400)).min(1).max(5),
  uncertainties: z.array(boundedText(400)).min(1).max(5),
  improvementSuggestions: boundedList(400, 4),
  integrityFindings: z.array(contentIntegrityFindingSchema).max(12),
  policySignals: z.array(policySignalSchema).max(8),
  gate: viewerValueGateSchema,
  gateReasons: z.array(boundedText(400)).min(1).max(4),
}).strict();

/**
 * Carried by every downstream artifact so a later stage can re-run the same
 * standard against the same contract and detect drift. `contractHash` is a
 * canonical SHA-256 of the originating `viewerValueContract`: if a script
 * silently changes the promise, the hash no longer matches its source.
 */
export const viewerValueProvenanceSchema = z.object({
  originStage: z.enum(["CONTENT_INTELLIGENCE", "VIDEO_STRATEGY", "SCRIPT", "PACKAGING", "PRODUCTION", "PUBLISHING"]),
  originWorkflowType: z.string().min(1).max(80),
  originRunId: z.string().uuid(),
  subjectId: z.string().min(1).max(120),
  contractHash: z.string().regex(/^[a-f0-9]{64}$/),
  gate: viewerValueGateSchema,
  assessedAt: z.string().datetime(),
}).strict();

export type ViewerValueKind = z.infer<typeof viewerValueKindSchema>;
export type ViewerValueDimension = z.infer<typeof viewerValueDimensionSchema>;
export type ViewerValueContract = z.infer<typeof viewerValueContractSchema>;
export type ViewerValueAssessment = z.infer<typeof viewerValueAssessmentSchema>;
export type ViewerValueGate = z.infer<typeof viewerValueGateSchema>;
export type ViewerValueProvenance = z.infer<typeof viewerValueProvenanceSchema>;
export type ContentIntegrityFinding = z.infer<typeof contentIntegrityFindingSchema>;
export type PolicySignal = z.infer<typeof policySignalSchema>;

const WEAK_VERDICTS = new Set(["weak", "absent"]);

/** Dimensions that must be genuinely judged; `not_applicable` is never acceptable for these. */
export const ALWAYS_APPLICABLE_DIMENSIONS = ["differentiation", "evidenceSupport", "trustworthiness", "sustainability"] as const;

/**
 * The deterministic half of the Viewer Value Gate. It establishes the floor the
 * model cannot argue its way below; semantic QA judges everything above it.
 * Returns the gate this assessment is *entitled* to, so a model claiming PASS
 * over blocking integrity findings can be overruled.
 */
export function deterministicViewerValueGate(assessment: ViewerValueAssessment): { gate: ViewerValueGate; reasons: string[] } {
  const reasons: string[] = [];
  let reject = false;
  let revise = false;

  for (const finding of assessment.integrityFindings) {
    if (finding.severity === "blocking") { reject = true; reasons.push(`Blocking content-integrity risk ${finding.risk}.`); }
    else if (finding.severity === "material") { revise = true; reasons.push(`Material content-integrity risk ${finding.risk}.`); }
  }

  const { contract } = assessment;
  if (WEAK_VERDICTS.has(contract.trustworthiness.verdict)) { reject = true; reasons.push("Trustworthiness is not established."); }
  for (const dimension of ALWAYS_APPLICABLE_DIMENSIONS) {
    if (contract[dimension].verdict === "not_applicable") { revise = true; reasons.push(`${dimension} cannot be not_applicable.`); }
  }
  if (WEAK_VERDICTS.has(contract.differentiation.verdict)) { revise = true; reasons.push("Differentiation is weak or absent."); }
  if (WEAK_VERDICTS.has(contract.originalContribution.assessment.verdict)) { revise = true; reasons.push("Original contribution is weak or absent."); }
  if (WEAK_VERDICTS.has(contract.valuePromise.specificity.verdict)) { revise = true; reasons.push("The value promise is not specific enough to justify viewer time."); }
  if (WEAK_VERDICTS.has(contract.sustainability.verdict)) { revise = true; reasons.push("The idea does not contribute to a coherent channel."); }
  if (WEAK_VERDICTS.has(contract.evidenceSupport.verdict)) { revise = true; reasons.push("Claims are not traceable to evidence."); }

  if (reject) return { gate: "REJECT", reasons };
  if (revise) return { gate: "REVISE", reasons };
  return { gate: "PASS", reasons: ["No deterministic viewer-value or integrity failure was detected."] };
}

const GATE_SEVERITY: Record<ViewerValueGate, number> = { PASS: 0, REVISE: 1, REJECT: 2 };

/** The stricter of the deterministic floor and the model's own judgement wins. */
export function resolveViewerValueGate(deterministic: ViewerValueGate, claimed: ViewerValueGate): ViewerValueGate {
  return GATE_SEVERITY[deterministic] >= GATE_SEVERITY[claimed] ? deterministic : claimed;
}
