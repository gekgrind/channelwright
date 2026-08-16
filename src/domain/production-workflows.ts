import { z } from "zod";
import { viewerValueAssessmentSchema } from "./viewer-value";

export const workflowTypeSchema = z.enum(["CHANNEL_CONCEPT_VALIDATION", "CHANNEL_RESEARCH", "CHANNEL_STRATEGY", "CHANNEL_CONTENT_INTELLIGENCE"]);
export type ProductionWorkflowType = z.infer<typeof workflowTypeSchema>;

export const workflowStatusSchema = z.enum(["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "BLOCKED", "COMPLETED", "FAILED", "CANCELED"]);
export const workflowStepStatusSchema = z.enum(["BLOCKED", "QUEUED", "LEASED", "RETRY_WAIT", "WAITING_FOR_APPROVAL", "COMPLETED", "FAILED", "CANCELED"]);
export const workflowAttemptStatusSchema = z.enum(["STARTED", "SUCCEEDED", "FAILED", "LEASE_EXPIRED", "CANCELED"]);
export const workflowApprovalStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "REVISION_REQUESTED"]);

const nullableText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable();
const evidenceIdsSchema = z.array(z.string().regex(/^yt:(?:video|channel):[A-Za-z0-9_-]+$/)).max(100);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const channelResearchConstraintsSchema = z.object({
  faceless: z.boolean().optional(),
  preferredVideoLength: z.string().trim().min(1).max(100).optional(),
  postingFrequency: z.string().trim().min(1).max(100).optional(),
  geography: z.string().trim().min(2).max(100).optional(),
  language: z.string().trim().min(2).max(100).optional(),
}).strict();

export const channelResearchInputSchema = z.object({
  channelConcept: z.string().trim().min(10).max(2_000).optional(),
  niche: z.string().trim().min(2).max(500).optional(),
  targetAudience: z.string().trim().min(2).max(1_000).optional(),
  goals: z.array(z.string().trim().min(2).max(300)).max(10).optional(),
  constraints: channelResearchConstraintsSchema.optional(),
  humanRevisionNote: z.string().trim().min(1).max(2_000).optional(),
}).strict().superRefine((input, context) => {
  if (!input.channelConcept && !input.niche) context.addIssue({ code: "custom", path: ["channelConcept"], message: "A channel concept or niche is required." });
});

export const researchEvidenceSchema = z.object({
  id: z.string().regex(/^yt:(?:video|channel):[A-Za-z0-9_-]+$/),
  provider: z.literal("YOUTUBE_DATA_API_V3"),
  sourceType: z.enum(["video", "channel"]),
  sourceId: z.string().min(1).max(200),
  url: z.string().url().max(500),
  title: nullableText(500),
  channelTitle: nullableText(500),
  publishedAt: z.string().datetime().nullable(),
  retrievedAt: z.string().datetime(),
  metrics: z.record(z.string(), z.union([z.number(), z.string().max(500), z.null()])),
  query: z.string().min(1).max(500),
  rawReference: z.string().min(1).max(500),
  origin: z.enum(["LIVE", "CACHE"]),
}).strict();

export const researchProviderUsageSchema = z.object({
  provider: z.literal("YOUTUBE_DATA_API_V3"),
  cacheStatus: z.enum(["HIT", "MISS"]),
  cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
  searchQueries: z.number().int().min(0).max(4),
  providerRequests: z.number().int().min(0).max(12),
  quotaUnits: z.number().int().min(0).max(500),
  videosExamined: z.number().int().min(0).max(50),
  channelsExamined: z.number().int().min(0).max(50),
  retrievedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  budgetExhausted: z.boolean(),
}).strict();

export const researchEvidenceBundleSchema = z.object({
  normalizedQueries: z.array(z.string().min(1).max(500)).min(1).max(4),
  evidence: z.array(researchEvidenceSchema).min(1).max(50),
  completionStatus: z.enum(["complete", "partial"]),
  limitations: z.array(z.string().min(1).max(500)).max(12),
  usage: researchProviderUsageSchema,
}).strict();

const viabilityCriterionSchema = z.object({
  verdict: z.enum(["strong", "moderate", "weak", "unknown"]),
  rationale: z.string().min(1).max(3_000),
  evidenceIds: evidenceIdsSchema,
}).strict();

export const channelResearchResultSchema = z.object({
  schemaVersion: z.literal(1),
  workflowType: z.literal("CHANNEL_RESEARCH"),
  researchObjective: z.string().min(1).max(2_000),
  suppliedConcept: z.string().min(1).max(2_000).nullable(),
  concept: z.object({ normalizedConcept: z.string().min(1).max(1_000), summary: z.string().min(1).max(3_000) }).strict(),
  category: z.object({ niche: z.string().min(1).max(500), audienceValue: z.string().min(1).max(2_000) }).strict(),
  viability: z.object({
    hundredVideoPotential: viabilityCriterionSchema,
    audienceDemand: viabilityCriterionSchema,
    monetizationPotential: viabilityCriterionSchema,
  }).strict(),
  audience: z.object({ targetViewer: z.string().min(1).max(2_000), demandSignals: z.array(z.string().min(1).max(1_000)).max(20), evidenceIds: evidenceIdsSchema }).strict(),
  competitiveLandscape: z.object({
    summary: z.string().min(1).max(3_000),
    examples: z.array(z.object({ name: z.string().min(1).max(500), relevance: z.string().min(1).max(1_500), evidenceIds: evidenceIdsSchema }).strict()).max(12),
  }).strict(),
  contentPotential: z.object({
    pillars: z.array(z.object({ name: z.string().min(1).max(300), description: z.string().min(1).max(1_000), exampleTopics: z.array(z.string().min(1).max(500)).min(1).max(20) }).strict()).min(1).max(12),
    estimatedTopicDepth: z.number().int().min(0).max(10_000).nullable(),
    evidenceIds: evidenceIdsSchema,
  }).strict(),
  differentiation: z.object({
    originalityAssessment: z.string().min(1).max(2_000),
    opportunities: z.array(z.string().min(1).max(1_000)).max(12),
    evidenceIds: evidenceIdsSchema,
  }).strict(),
  sustainability: z.object({
    repeatability: z.string().min(1).max(1_500),
    evergreenTrendBalance: z.string().min(1).max(1_500),
    productionDifficulty: z.enum(["high", "medium", "low", "unknown"]),
    creatorDependency: z.enum(["high", "medium", "low", "unknown"]),
    defensibility: z.string().min(1).max(1_500),
    evidenceIds: evidenceIdsSchema,
  }).strict(),
  monetization: z.object({
    paths: z.array(z.object({ type: z.string().min(1).max(300), rationale: z.string().min(1).max(1_500), confidence: z.enum(["high", "medium", "low"]), evidenceIds: evidenceIdsSchema }).strict()).max(12),
  }).strict(),
  risks: z.array(z.object({ risk: z.string().min(1).max(1_000), severity: z.enum(["high", "medium", "low"]), mitigation: z.string().min(1).max(1_000).nullable(), evidenceIds: evidenceIdsSchema }).strict()).max(20),
  assumptions: z.array(z.string().min(1).max(1_000)).max(20),
  uncertainties: z.array(z.string().min(1).max(1_000)).max(20),
  evidenceSummary: z.object({
    evidenceIds: evidenceIdsSchema,
    independentChannelsObserved: z.number().int().min(0).max(50),
    representativeVideosObserved: z.number().int().min(0).max(50),
    oldestRetrievedAt: z.string().datetime(),
    newestRetrievedAt: z.string().datetime(),
    completionStatus: z.enum(["complete", "partial"]),
    limitations: z.array(z.string().min(1).max(500)).max(12),
  }).strict(),
  recommendation: z.object({
    verdict: z.enum(["strong_opportunity", "promising", "needs_refinement", "weak_opportunity", "insufficient_evidence"]),
    rationale: z.string().min(1).max(3_000), confidence: z.enum(["high", "medium", "low"]), evidenceIds: evidenceIdsSchema,
    reasons: z.array(z.string().min(1).max(1_000)).min(1).max(12),
    unansweredQuestions: z.array(z.string().min(1).max(1_000)).max(20),
    nextAction: z.string().min(1).max(1_500),
  }).strict(),
}).strict();

export const researchQAFindingSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
  message: z.string().min(1).max(2_000),
  evidenceIds: evidenceIdsSchema,
}).strict();

export const researchQAResultSchema = z.object({
  passed: z.boolean(),
  score: z.number().int().min(0).max(100),
  findings: z.array(researchQAFindingSchema).max(50),
  recommendation: z.enum(["accept", "revise", "human_review_required"]),
  deterministicChecksPassed: z.number().int().min(0).max(100),
  deterministicChecksFailed: z.number().int().min(0).max(100),
  modelUsage: z.object({ model: z.string().min(1).max(200), inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0), totalTokens: z.number().int().min(0) }).strict(),
}).strict();

export const researchDraftSchema = z.object({
  result: channelResearchResultSchema,
  modelUsage: z.object({ model: z.string().min(1).max(200), inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0), totalTokens: z.number().int().min(0) }).strict(),
}).strict();

export const researchRevisionSchema = z.object({
  attempted: z.boolean(),
  reason: z.string().min(1).max(1_000),
  result: channelResearchResultSchema,
  modelUsage: z.object({ model: z.string().min(1).max(200), inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0), totalTokens: z.number().int().min(0) }).strict(),
}).strict();

export const approvedResearchReferenceSchema = z.object({
  researchWorkflowId: z.string().uuid(),
  researchRunId: z.string().uuid(),
  workflowDefinitionVersion: z.number().int().positive(),
  outputSchemaVersion: z.literal(1),
  approvalId: z.string().uuid(),
  approvedBy: z.string().uuid(),
  approvedAt: z.string().datetime(),
  finalQaState: z.enum(["accept", "human_review_required"]),
  finalQaScore: z.number().int().min(0).max(100),
  researchArtifactHash: sha256Schema,
  evidenceProvenanceHash: sha256Schema,
  parentRunId: z.string().uuid().nullable(),
  rootRunId: z.string().uuid(),
}).strict();

export const channelStrategyRequestInputSchema = z.object({
  researchWorkflowId: z.string().uuid(),
  researchRunId: z.string().uuid(),
}).strict();

export const channelStrategyInputSchema = channelStrategyRequestInputSchema.extend({
  approvedResearchReference: approvedResearchReferenceSchema,
  humanRevisionNote: z.string().trim().min(1).max(2_000).optional(),
}).strict();

const strategyClaimSchema = z.object({
  statement: z.string().min(1).max(3_000),
  evidenceIds: evidenceIdsSchema,
}).strict();

const strategyAudienceSchema = z.object({
  description: z.string().min(1).max(2_000),
  needs: z.array(z.string().min(1).max(1_000)).min(1).max(12),
  motivations: z.array(z.string().min(1).max(1_000)).max(12),
  painPoints: z.array(z.string().min(1).max(1_000)).max(12),
  desiredOutcomes: z.array(z.string().min(1).max(1_000)).max(12),
  viewingIntent: z.array(z.string().min(1).max(1_000)).max(12),
  reasonsToSubscribe: z.array(z.string().min(1).max(1_000)).max(12),
  reasonsNotToSubscribe: z.array(z.string().min(1).max(1_000)).max(12),
  evidenceIds: evidenceIdsSchema,
}).strict();

export const channelStrategyContentSchema = z.object({
  schemaVersion: z.literal(1),
  workflowType: z.literal("CHANNEL_STRATEGY"),
  strategicThesis: z.object({
    channelConcept: strategyClaimSchema,
    strategicRationale: strategyClaimSchema,
    marketOpportunitySummary: strategyClaimSchema,
    whyThisChannelShouldExist: strategyClaimSchema,
    successConditions: z.array(strategyClaimSchema).min(1).max(12),
  }).strict(),
  targetAudience: z.object({
    primary: strategyAudienceSchema,
    secondary: strategyAudienceSchema.nullable(),
    demographicPrecisionLimit: z.string().min(1).max(1_500),
  }).strict(),
  positioning: z.object({
    category: strategyClaimSchema,
    positioningStatement: strategyClaimSchema,
    competitiveFrame: strategyClaimSchema,
    differentiation: strategyClaimSchema,
    defensibility: strategyClaimSchema,
    strategicWhitespace: strategyClaimSchema,
    deliberatelyNot: z.array(z.string().min(1).max(1_000)).min(1).max(12),
  }).strict(),
  channelPromise: z.object({
    corePromise: strategyClaimSchema,
    supportingPromise: strategyClaimSchema,
    viewerValue: strategyClaimSchema,
    credibilityRequirements: z.array(z.string().min(1).max(1_000)).min(1).max(12),
    promiseRisks: z.array(strategyClaimSchema).max(12),
  }).strict(),
  valueProposition: z.object({
    functionalValue: strategyClaimSchema,
    emotionalValue: strategyClaimSchema.nullable(),
    informationalOrEntertainmentValue: strategyClaimSchema,
    recurringReasonToReturn: strategyClaimSchema,
    advantageOverSubstitutes: strategyClaimSchema,
  }).strict(),
  contentPillars: z.array(z.object({
    name: z.string().min(1).max(300),
    purpose: z.string().min(1).max(1_500),
    audienceNeedServed: z.string().min(1).max(1_500),
    strategicRationale: z.string().min(1).max(1_500),
    evidenceIds: evidenceIdsSchema,
    differentiationRole: z.string().min(1).max(1_500),
    monetizationRelevance: z.string().min(1).max(1_500).nullable(),
    risks: z.array(z.string().min(1).max(1_000)).max(8),
    sustainability: z.string().min(1).max(1_500),
  }).strict()).min(2).max(8),
  monetizationArchitecture: z.array(z.object({
    path: z.enum(["YOUTUBE_ADVERTISING", "SPONSORSHIPS", "AFFILIATE_REVENUE", "DIGITAL_PRODUCTS", "MEMBERSHIPS", "SERVICES", "LICENSING", "LEAD_GENERATION", "OTHER"]),
    label: z.string().min(1).max(300),
    rationale: z.string().min(1).max(1_500),
    prerequisites: z.array(z.string().min(1).max(1_000)).max(12),
    maturityStage: z.enum(["LAUNCH", "EARLY_VALIDATION", "GROWTH", "MATURE"]),
    dependencies: z.array(z.string().min(1).max(1_000)).max(12),
    risks: z.array(z.string().min(1).max(1_000)).max(12),
    confidence: z.enum(["high", "medium", "low"]),
    evidenceIds: evidenceIdsSchema,
  }).strict()).max(12),
  strategicObjectives: z.object({
    launch: z.array(z.string().min(1).max(1_000)).min(1).max(12),
    earlyValidation: z.array(z.string().min(1).max(1_000)).min(1).max(12),
    growth: z.array(z.string().min(1).max(1_000)).max(12),
    monetization: z.array(z.string().min(1).max(1_000)).max(12),
    strategicLearning: z.array(z.string().min(1).max(1_000)).min(1).max(12),
  }).strict(),
  kpiFramework: z.array(z.object({
    metric: z.enum(["IMPRESSIONS", "CLICK_THROUGH_RATE", "AVERAGE_VIEW_DURATION", "AUDIENCE_RETENTION", "RETURNING_VIEWERS", "SUBSCRIBERS", "PUBLISHING_CONSISTENCY", "REVENUE_INDICATOR", "CONVERSION_INDICATOR", "OTHER"]),
    label: z.string().min(1).max(300),
    purpose: z.string().min(1).max(1_000),
    futureMeasurementRequirement: z.string().min(1).max(1_000),
    baselineState: z.literal("UNAVAILABLE"),
    observedValue: z.null(),
    proposedTarget: z.string().min(1).max(500).nullable(),
    targetIsHypothesis: z.literal(true),
    assumptions: z.array(z.string().min(1).max(1_000)).max(8),
  }).strict()).min(1).max(20),
  strategicRisks: z.array(z.object({
    category: z.enum(["MARKET", "COMPETITION", "DIFFERENTIATION", "CONTENT_SUSTAINABILITY", "MONETIZATION", "PLATFORM_DEPENDENCY", "EXECUTION", "EVIDENCE_LIMITATION"]),
    risk: z.string().min(1).max(1_500),
    severity: z.enum(["high", "medium", "low"]),
    mitigation: z.string().min(1).max(1_500).nullable(),
    evidenceIds: evidenceIdsSchema,
  }).strict()).min(1).max(24),
  assumptionsAndUncertainties: z.object({
    assumptions: z.array(z.string().min(1).max(1_000)).min(1).max(24),
    uncertainties: z.array(z.string().min(1).max(1_000)).min(1).max(24),
    unansweredQuestions: z.array(z.string().min(1).max(1_000)).max(24),
    evidenceGaps: z.array(z.string().min(1).max(1_000)).min(1).max(24),
    confidenceLimitations: z.array(z.string().min(1).max(1_000)).min(1).max(24),
  }).strict(),
  recommendation: z.object({
    decision: z.enum(["PROCEED", "PROCEED_WITH_CONDITIONS", "REVISE_POSITIONING", "NARROW_SCOPE", "BROADEN_SCOPE", "GATHER_ADDITIONAL_RESEARCH", "DO_NOT_PROCEED"]),
    reasons: z.array(z.string().min(1).max(1_000)).min(1).max(12),
    confidence: z.enum(["high", "medium", "low"]),
    conditions: z.array(z.string().min(1).max(1_000)).max(12),
    evidenceIds: evidenceIdsSchema,
  }).strict(),
}).strict();

export const channelStrategyResultSchema = channelStrategyContentSchema.extend({
  upstreamResearch: approvedResearchReferenceSchema,
}).strict();

export const approvedResearchArtifactSchema = z.object({
  reference: approvedResearchReferenceSchema,
  researchResult: channelResearchResultSchema,
  evidenceBundle: researchEvidenceBundleSchema,
}).strict();

export const strategyQAFindingSchema = researchQAFindingSchema;
export const strategyQAResultSchema = researchQAResultSchema;

export const strategyDraftSchema = z.object({
  result: channelStrategyResultSchema,
  modelUsage: researchDraftSchema.shape.modelUsage,
}).strict();

export const strategyRevisionSchema = z.object({
  attempted: z.boolean(),
  reason: z.string().min(1).max(1_000),
  result: channelStrategyResultSchema,
  modelUsage: researchDraftSchema.shape.modelUsage,
}).strict();

// ---------------------------------------------------------------------------
// CHANNEL_CONTENT_INTELLIGENCE
//
// Size discipline: this result becomes a durable step output and the run's
// `output_payload`, both bounded at 64 KiB by the workflow engine. Every
// collection below is capped so a realistic artifact fits with margin, and
// deterministic QA additionally rejects an oversized payload before persistence
// so the failure is a typed QA error rather than PAYLOAD_TOO_LARGE.
// ---------------------------------------------------------------------------

export const approvedStrategyReferenceSchema = z.object({
  strategyWorkflowId: z.string().uuid(),
  strategyRunId: z.string().uuid(),
  workflowDefinitionVersion: z.number().int().positive(),
  outputSchemaVersion: z.literal(1),
  approvalId: z.string().uuid(),
  approvedBy: z.string().uuid(),
  approvedAt: z.string().datetime(),
  finalQaState: z.enum(["accept", "human_review_required"]),
  finalQaScore: z.number().int().min(0).max(100),
  strategyArtifactHash: sha256Schema,
  strategyProvenanceHash: sha256Schema,
  parentRunId: z.string().uuid().nullable(),
  rootRunId: z.string().uuid(),
  // Transitive provenance: strategy already proved its own upstream research.
  upstreamResearch: approvedResearchReferenceSchema,
}).strict();

export const CONTENT_BACKLOG_MIN = 5;
export const CONTENT_BACKLOG_MAX = 8;

export const contentIntelligenceRequestInputSchema = z.object({
  strategyWorkflowId: z.string().uuid(),
  strategyRunId: z.string().uuid(),
  targetBacklogSize: z.number().int().min(CONTENT_BACKLOG_MIN).max(CONTENT_BACKLOG_MAX).optional(),
  pillarFilter: z.array(z.string().trim().min(1).max(300)).min(1).max(8).optional(),
}).strict();

export const contentIntelligenceInputSchema = contentIntelligenceRequestInputSchema.extend({
  approvedStrategyReference: approvedStrategyReferenceSchema,
  humanRevisionNote: z.string().trim().min(1).max(2_000).optional(),
}).strict();

const contentEvidenceIdSchema = z.string().regex(/^yt:(?:video|channel|search):[A-Za-z0-9_-]{1,64}$/);
const contentEvidenceIdsSchema = z.array(contentEvidenceIdSchema).max(40);
const citedEvidenceIdsSchema = z.array(contentEvidenceIdSchema).min(1).max(20);
const topicIdSchema = z.string().regex(/^topic:[a-z0-9][a-z0-9-]{0,58}$/);
const pillarIdSchema = z.string().regex(/^pillar:[a-z0-9][a-z0-9-]{0,58}$/);

export const topicDiscoveryEvidenceSchema = z.object({
  id: contentEvidenceIdSchema,
  provider: z.literal("YOUTUBE_DATA_API_V3"),
  sourceType: z.enum(["video", "channel", "search"]),
  sourceId: z.string().min(1).max(200),
  // Search observations describe a query, not a canonical resource, so they carry no URL.
  url: z.string().url().max(500).nullable(),
  title: nullableText(300),
  channelTitle: nullableText(300),
  publishedAt: z.string().datetime().nullable(),
  retrievedAt: z.string().datetime(),
  metrics: z.record(z.string(), z.union([z.number(), z.string().max(200), z.null()])),
  query: z.string().min(1).max(300),
  pillarId: pillarIdSchema,
  rawReference: z.string().min(1).max(300),
  origin: z.enum(["LIVE", "CACHE"]),
}).strict();

export const contentDiscoveryUsageSchema = z.object({
  provider: z.literal("YOUTUBE_DATA_API_V3"),
  cacheHits: z.number().int().min(0).max(40),
  cacheMisses: z.number().int().min(0).max(40),
  searchQueries: z.number().int().min(0).max(24),
  providerRequests: z.number().int().min(0).max(60),
  quotaUnits: z.number().int().min(0).max(3_000),
  videosExamined: z.number().int().min(0).max(200),
  channelsExamined: z.number().int().min(0).max(200),
  retrievedAt: z.string().datetime(),
  budgetExhausted: z.boolean(),
}).strict();

export const topicDiscoveryBundleSchema = z.object({
  normalizedQueries: z.array(z.string().min(1).max(300)).min(1).max(24),
  evidence: z.array(topicDiscoveryEvidenceSchema).min(1).max(90),
  completionStatus: z.enum(["complete", "partial"]),
  limitations: z.array(z.string().min(1).max(300)).max(24),
  usage: contentDiscoveryUsageSchema,
}).strict();

export const approvedStrategyArtifactSchema = z.object({
  reference: approvedStrategyReferenceSchema,
  strategyResult: channelStrategyResultSchema,
  researchEvidenceBundle: researchEvidenceBundleSchema,
}).strict();

export const pillarExpansionSchema = z.object({
  pillarId: pillarIdSchema,
  pillarName: z.string().min(1).max(300),
  audienceProblem: z.string().min(1).max(600),
  rationale: z.string().min(1).max(600),
  subtopicClusters: z.array(z.object({
    name: z.string().min(1).max(200),
    viewerIntent: z.string().min(1).max(400),
    exampleQuestions: z.array(z.string().min(1).max(300)).min(1).max(6),
  }).strict()).min(1).max(6),
  discoveryQueries: z.array(z.string().min(1).max(200)).min(1).max(6),
  assumptions: z.array(z.string().min(1).max(400)).max(6),
}).strict();

export const contentScoreDimensionSchema = z.enum([
  "STRATEGY_ALIGNMENT", "AUDIENCE_NEED", "VIEWER_VALUE", "EVIDENCE_STRENGTH", "DIFFERENTIATION",
  "OPPORTUNITY", "COMPETITION", "SHELF_LIFE", "MONETIZATION_FIT", "PRODUCTION_FEASIBILITY", "CHANNEL_SUSTAINABILITY",
]);

/** No aggregate score exists without its decomposition; every component states its own basis. */
export const contentScoreComponentSchema = z.object({
  dimension: contentScoreDimensionSchema,
  score: z.number().int().min(0).max(10),
  weight: z.number().min(0).max(1),
  rationale: z.string().min(1).max(600),
  basis: z.enum(["EVIDENCE", "STRATEGY", "ASSUMPTION", "HEURISTIC"]),
  evidenceIds: contentEvidenceIdsSchema,
}).strict();

export const contentTopicScoreSchema = z.object({
  topicId: topicIdSchema,
  components: z.array(contentScoreComponentSchema).min(5).max(11),
  weightedTotal: z.number().min(0).max(10),
  tier: z.enum(["PRIORITY", "STRONG", "VIABLE", "HOLD"]),
}).strict();

export const contentTopicOpportunitySchema = z.object({
  topicId: topicIdSchema,
  pillarId: pillarIdSchema,
  workingConcept: z.string().min(1).max(400),
  workingAngle: z.string().min(1).max(400),
  viewerQuestion: z.string().min(1).max(400),
  viewerIntent: z.enum(["LEARN", "SOLVE", "DECIDE", "COMPARE", "EXPLORE", "STAY_INFORMED", "BE_ENTERTAINED", "OTHER"]),
  proposedViewerValue: z.string().min(1).max(600),
  differentiatedContribution: z.string().min(1).max(600),
  // A topic must cite its own discovery evidence; inherited research evidence alone is not validation.
  evidenceIds: citedEvidenceIdsSchema,
  competitionSignal: z.object({
    level: z.enum(["high", "medium", "low", "unknown"]),
    rationale: z.string().min(1).max(600),
    evidenceIds: contentEvidenceIdsSchema,
  }).strict(),
  saturationAssessment: z.string().min(1).max(600),
  differentiationOpportunity: z.string().min(1).max(600),
  shelfLife: z.object({
    classification: z.enum(["EVERGREEN", "SEMI_EVERGREEN", "TIMELY", "EVENT_DRIVEN"]),
    rationale: z.string().min(1).max(600),
    decayNote: z.string().min(1).max(600).nullable(),
  }).strict(),
  productionComplexity: z.enum(["high", "medium", "low"]),
  strategicFit: z.string().min(1).max(600),
  monetizationRelevance: z.string().min(1).max(600).nullable(),
  assumptions: z.array(z.string().min(1).max(400)).min(1).max(8),
  uncertainties: z.array(z.string().min(1).max(400)).min(1).max(8),
  viewerValue: viewerValueAssessmentSchema,
}).strict();

export const nextVideoRecommendationSchema = z.object({
  topicId: topicIdSchema,
  reasons: z.array(z.string().min(1).max(500)).min(3).max(8),
  viewerValueRationale: z.string().min(1).max(600),
  strategyAlignment: z.string().min(1).max(600),
  competitiveRationale: z.string().min(1).max(600),
  differentiationRationale: z.string().min(1).max(600),
  feasibilityRationale: z.string().min(1).max(600),
  evidenceIds: citedEvidenceIdsSchema,
  confidence: z.enum(["high", "medium", "low"]),
  conditions: z.array(z.string().min(1).max(500)).max(8),
}).strict();

export const channelContentIntelligenceContentSchema = z.object({
  schemaVersion: z.literal(1),
  workflowType: z.literal("CHANNEL_CONTENT_INTELLIGENCE"),
  pillarExpansions: z.array(pillarExpansionSchema).min(1).max(8),
  topics: z.array(contentTopicOpportunitySchema).min(1).max(CONTENT_BACKLOG_MAX),
  scores: z.array(contentTopicScoreSchema).min(1).max(CONTENT_BACKLOG_MAX),
  backlog: z.array(z.object({
    topicId: topicIdSchema,
    rank: z.number().int().min(1).max(CONTENT_BACKLOG_MAX),
    tier: z.enum(["PRIORITY", "STRONG", "VIABLE", "HOLD"]),
    inclusionRationale: z.string().min(1).max(600),
  }).strict()).min(1).max(CONTENT_BACKLOG_MAX),
  nextVideoRecommendation: nextVideoRecommendationSchema,
  risks: z.array(z.object({
    risk: z.string().min(1).max(600),
    severity: z.enum(["high", "medium", "low"]),
    mitigation: z.string().min(1).max(600).nullable(),
  }).strict()).min(1).max(12),
  assumptions: z.array(z.string().min(1).max(500)).min(1).max(16),
  openQuestions: z.array(z.string().min(1).max(500)).min(1).max(16),
  recommendedNextAction: z.string().min(1).max(600),
}).strict();

/**
 * Compact model provenance. Enough to audit which specialist produced or
 * reviewed an artifact, without turning the durable payload into a log.
 */
export const modelAttributionSchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  model: z.string().min(1).max(200),
  role: z.enum(["GENERATOR", "STRATEGIST", "CRITIC", "VIEWER_VALUE_REVIEWER", "QA", "REVISION"]),
  operation: z.string().min(1).max(80),
  invokedAt: z.string().datetime(),
}).strict();

export const crossModelDispositionSchema = z.enum([
  "AGREED",
  "CRITIC_RAISED_ISSUE",
  "REVISED",
  "OVERRIDDEN_BY_DETERMINISTIC_RULE",
  "HUMAN_REVIEW_REQUIRED",
]);

/**
 * A single critic observation. `rationale` is a concise, user-safe summary; no
 * hidden chain-of-thought is requested from the provider or persisted here.
 */
export const crossModelFindingSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
  severity: z.enum(["error", "warning", "info"]),
  affectedField: z.string().min(1).max(200),
  // Bounded at 900 because live critics legitimately need to name the field, the
  // claim, and why the evidence does not support it. Still a concise summary,
  // never unrestricted chain-of-thought.
  rationale: z.string().min(1).max(900),
  evidenceIds: contentEvidenceIdsSchema,
  disposition: crossModelDispositionSchema,
}).strict();

export const crossModelReviewSchema = z.object({
  generator: modelAttributionSchema,
  /** Null when no independent critic reviewed this artifact; never a stand-in. */
  critic: modelAttributionSchema.nullable(),
  outcome: crossModelDispositionSchema,
  findings: z.array(crossModelFindingSchema).max(12),
  // Live critics produce a thorough single-paragraph assessment; 2500 keeps it a
  // bounded summary while accommodating real output.
  summary: z.string().min(1).max(2_500),
}).strict();

export const channelContentIntelligenceResultSchema = channelContentIntelligenceContentSchema.extend({
  upstreamStrategy: approvedStrategyReferenceSchema,
  crossModelReview: crossModelReviewSchema.nullable(),
  modelProvenance: z.array(modelAttributionSchema).max(8),
}).strict();

export const contentQAFindingSchema = researchQAFindingSchema;
export const contentQAResultSchema = researchQAResultSchema;

export const contentDraftSchema = z.object({
  result: channelContentIntelligenceResultSchema,
  modelUsage: researchDraftSchema.shape.modelUsage,
}).strict();

/** Initial QA persists both the merged verdict and the independent critic's record. */
export const contentQAStepSchema = z.object({
  qa: contentQAResultSchema,
  crossModelReview: crossModelReviewSchema,
}).strict();

export const contentRevisionSchema = z.object({
  attempted: z.boolean(),
  reason: z.string().min(1).max(1_000),
  result: channelContentIntelligenceResultSchema,
  modelUsage: researchDraftSchema.shape.modelUsage,
}).strict();

export const channelConceptValidationInputSchema = z.object({
  proposedConcept: z.string().trim().min(20).max(2_000),
  audienceContext: z.string().trim().min(3).max(2_000).optional(),
  nicheContext: z.string().trim().min(3).max(2_000).optional(),
  monetizationPaths: z.array(z.string().trim().min(2).max(200)).max(10).optional(),
}).strict();

export const workflowStartRequestSchema = z.object({
  operation: z.literal("START_WORKFLOW"),
  workflowType: workflowTypeSchema,
  definitionVersion: z.literal(1).default(1),
  input: z.unknown(),
}).strict().superRefine((request, context) => {
  const schema = request.workflowType === "CHANNEL_RESEARCH" ? channelResearchInputSchema
    : request.workflowType === "CHANNEL_STRATEGY" ? channelStrategyRequestInputSchema
      : request.workflowType === "CHANNEL_CONTENT_INTELLIGENCE" ? contentIntelligenceRequestInputSchema
        : channelConceptValidationInputSchema;
  const parsed = schema.safeParse(request.input);
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ ...issue, path: ["input", ...issue.path] });
}).transform((request) => request as
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_CONCEPT_VALIDATION"; definitionVersion: 1; input: ChannelConceptValidationInput }
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_RESEARCH"; definitionVersion: 1; input: ChannelResearchInput }
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_STRATEGY"; definitionVersion: 1; input: ChannelStrategyRequestInput }
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_CONTENT_INTELLIGENCE"; definitionVersion: 1; input: ContentIntelligenceRequestInput });

export const workflowApprovalDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "REQUEST_REVISION"]),
  note: z.string().trim().min(1).max(2_000).optional(),
}).strict().superRefine((decision, context) => {
  if (decision.decision === "REQUEST_REVISION" && !decision.note) context.addIssue({ code: "custom", path: ["note"], message: "Revision instructions are required." });
});

const criterionSchema = z.object({
  status: z.enum(["NEEDS_EVIDENCE", "PROVIDER_DATA_REQUIRED", "PLAUSIBLE_HYPOTHESIS", "NEEDS_HYPOTHESIS"]),
  conclusion: z.string().min(1).max(2_000),
  evidenceRequired: z.array(z.string().min(1).max(500)).min(1).max(12),
  suppliedSignals: z.array(z.string().min(1).max(500)).max(12),
}).strict();

export const channelConceptValidationOutputSchema = z.object({
  schemaVersion: z.literal(1),
  workflowType: z.literal("CHANNEL_CONCEPT_VALIDATION"),
  concept: z.string(),
  contentDepth: criterionSchema,
  audienceDemand: criterionSchema,
  monetization: criterionSchema,
  recommendation: z.literal("RESEARCH_REQUIRED"),
  providerBoundary: z.literal("NO_LIVE_YOUTUBE_OR_MARKET_PROVIDER_DATA"),
  summary: z.string().min(1).max(2_000),
}).strict();

export type ChannelConceptValidationInput = z.infer<typeof channelConceptValidationInputSchema>;
export type ChannelConceptValidationOutput = z.infer<typeof channelConceptValidationOutputSchema>;
export type ChannelResearchInput = z.infer<typeof channelResearchInputSchema>;
export type ResearchEvidence = z.infer<typeof researchEvidenceSchema>;
export type ResearchEvidenceBundle = z.infer<typeof researchEvidenceBundleSchema>;
export type ChannelResearchResult = z.infer<typeof channelResearchResultSchema>;
export type ResearchQAResult = z.infer<typeof researchQAResultSchema>;
export type ApprovedResearchReference = z.infer<typeof approvedResearchReferenceSchema>;
export type ApprovedResearchArtifact = z.infer<typeof approvedResearchArtifactSchema>;
export type ChannelStrategyRequestInput = z.infer<typeof channelStrategyRequestInputSchema>;
export type ChannelStrategyInput = z.infer<typeof channelStrategyInputSchema>;
export type ChannelStrategyContent = z.infer<typeof channelStrategyContentSchema>;
export type ChannelStrategyResult = z.infer<typeof channelStrategyResultSchema>;
export type StrategyQAResult = z.infer<typeof strategyQAResultSchema>;
export type ApprovedStrategyReference = z.infer<typeof approvedStrategyReferenceSchema>;
export type ApprovedStrategyArtifact = z.infer<typeof approvedStrategyArtifactSchema>;
export type ContentIntelligenceRequestInput = z.infer<typeof contentIntelligenceRequestInputSchema>;
export type ContentIntelligenceInput = z.infer<typeof contentIntelligenceInputSchema>;
export type TopicDiscoveryEvidence = z.infer<typeof topicDiscoveryEvidenceSchema>;
export type TopicDiscoveryBundle = z.infer<typeof topicDiscoveryBundleSchema>;
export type ContentTopicOpportunity = z.infer<typeof contentTopicOpportunitySchema>;
export type ContentTopicScore = z.infer<typeof contentTopicScoreSchema>;
export type ChannelContentIntelligenceContent = z.infer<typeof channelContentIntelligenceContentSchema>;
export type ChannelContentIntelligenceResult = z.infer<typeof channelContentIntelligenceResultSchema>;
export type ContentQAResult = z.infer<typeof contentQAResultSchema>;
export type ModelAttribution = z.infer<typeof modelAttributionSchema>;
export type CrossModelFinding = z.infer<typeof crossModelFindingSchema>;
export type CrossModelReview = z.infer<typeof crossModelReviewSchema>;
export type CrossModelDisposition = z.infer<typeof crossModelDispositionSchema>;
export type WorkflowStartRequest = z.infer<typeof workflowStartRequestSchema>;
export type WorkflowApprovalDecision = z.infer<typeof workflowApprovalDecisionSchema>;

export interface WorkflowStepDefinition {
  key: string;
  kind: "WORKER" | "APPROVAL";
  capability: string;
  dependsOn: string[];
  maxAttempts: number;
  retryBaseSeconds: number;
}

export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
  type: ProductionWorkflowType;
  version: number;
  objective: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  steps: readonly WorkflowStepDefinition[];
}

const channelConceptValidationDefinition: WorkflowDefinition<ChannelConceptValidationInput, ChannelConceptValidationOutput> = {
  type: "CHANNEL_CONCEPT_VALIDATION",
  version: 1,
  objective: "Evaluate a proposed channel concept against content depth, audience demand, and monetization readiness",
  inputSchema: channelConceptValidationInputSchema,
  outputSchema: channelConceptValidationOutputSchema,
  steps: [
    { key: "assess-content-depth", kind: "WORKER", capability: "strategist", dependsOn: [], maxAttempts: 3, retryBaseSeconds: 2 },
    { key: "assess-audience-demand", kind: "WORKER", capability: "researcher", dependsOn: ["assess-content-depth"], maxAttempts: 3, retryBaseSeconds: 2 },
    { key: "assess-monetization", kind: "WORKER", capability: "monetization-strategist", dependsOn: ["assess-audience-demand"], maxAttempts: 3, retryBaseSeconds: 2 },
    { key: "synthesize-validation", kind: "WORKER", capability: "strategist", dependsOn: ["assess-monetization"], maxAttempts: 3, retryBaseSeconds: 2 },
    { key: "approve-validation", kind: "APPROVAL", capability: "human", dependsOn: ["synthesize-validation"], maxAttempts: 1, retryBaseSeconds: 0 },
  ],
};

const channelResearchDefinition: WorkflowDefinition<ChannelResearchInput, ChannelResearchResult> = {
  type: "CHANNEL_RESEARCH",
  version: 1,
  objective: "Evaluate an operator-supplied channel concept using current YouTube evidence, typed strategy, independent QA, and human review",
  inputSchema: channelResearchInputSchema,
  outputSchema: channelResearchResultSchema,
  steps: [
    { key: "retrieve-youtube-evidence", kind: "WORKER", capability: "youtube-research", dependsOn: [], maxAttempts: 3, retryBaseSeconds: 10 },
    { key: "draft-research", kind: "WORKER", capability: "research-synthesis", dependsOn: ["retrieve-youtube-evidence"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "initial-qa", kind: "WORKER", capability: "independent-research-qa", dependsOn: ["draft-research"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "bounded-revision", kind: "WORKER", capability: "research-revision", dependsOn: ["initial-qa"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "final-qa", kind: "WORKER", capability: "independent-research-qa", dependsOn: ["bounded-revision"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "synthesize-validation", kind: "WORKER", capability: "research-finalizer", dependsOn: ["final-qa"], maxAttempts: 1, retryBaseSeconds: 0 },
    { key: "review-research", kind: "APPROVAL", capability: "human", dependsOn: ["synthesize-validation"], maxAttempts: 1, retryBaseSeconds: 0 },
  ],
};

const channelStrategyDefinition: WorkflowDefinition<ChannelStrategyRequestInput, ChannelStrategyResult> = {
  type: "CHANNEL_STRATEGY",
  version: 1,
  objective: "Transform one exact approved CHANNEL_RESEARCH artifact into an evidence-traceable, independently QA'd, human-approved channel strategy",
  inputSchema: channelStrategyRequestInputSchema,
  outputSchema: channelStrategyResultSchema,
  steps: [
    { key: "validate-approved-research", kind: "WORKER", capability: "approved-research-validation", dependsOn: [], maxAttempts: 2, retryBaseSeconds: 5 },
    { key: "draft-strategy", kind: "WORKER", capability: "strategy-synthesis", dependsOn: ["validate-approved-research"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "initial-strategy-qa", kind: "WORKER", capability: "independent-strategy-qa", dependsOn: ["draft-strategy"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "bounded-strategy-revision", kind: "WORKER", capability: "strategy-revision", dependsOn: ["initial-strategy-qa"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "final-strategy-qa", kind: "WORKER", capability: "independent-strategy-qa", dependsOn: ["bounded-strategy-revision"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "finalize-strategy", kind: "WORKER", capability: "strategy-finalizer", dependsOn: ["final-strategy-qa"], maxAttempts: 1, retryBaseSeconds: 0 },
    { key: "review-strategy", kind: "APPROVAL", capability: "human", dependsOn: ["finalize-strategy"], maxAttempts: 1, retryBaseSeconds: 0 },
  ],
};

const channelContentIntelligenceDefinition: WorkflowDefinition<ContentIntelligenceRequestInput, ChannelContentIntelligenceResult> = {
  type: "CHANNEL_CONTENT_INTELLIGENCE",
  version: 1,
  objective: "Turn one exact approved CHANNEL_STRATEGY artifact into an evidence-backed, viewer-value-gated, independently QA'd content backlog and next-video recommendation",
  inputSchema: contentIntelligenceRequestInputSchema,
  outputSchema: channelContentIntelligenceResultSchema,
  steps: [
    { key: "validate-approved-strategy", kind: "WORKER", capability: "approved-strategy-validation", dependsOn: [], maxAttempts: 2, retryBaseSeconds: 5 },
    { key: "expand-content-pillars", kind: "WORKER", capability: "content-pillar-expansion", dependsOn: ["validate-approved-strategy"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "discover-youtube-topics", kind: "WORKER", capability: "youtube-topic-discovery", dependsOn: ["expand-content-pillars"], maxAttempts: 3, retryBaseSeconds: 10 },
    { key: "assess-topic-opportunities", kind: "WORKER", capability: "topic-opportunity-assessment", dependsOn: ["discover-youtube-topics"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "synthesize-backlog", kind: "WORKER", capability: "content-backlog-synthesis", dependsOn: ["assess-topic-opportunities"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "initial-content-qa", kind: "WORKER", capability: "independent-content-qa", dependsOn: ["synthesize-backlog"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "bounded-content-revision", kind: "WORKER", capability: "content-revision", dependsOn: ["initial-content-qa"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "final-content-qa", kind: "WORKER", capability: "independent-content-qa", dependsOn: ["bounded-content-revision"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "finalize-content-intelligence", kind: "WORKER", capability: "content-finalizer", dependsOn: ["final-content-qa"], maxAttempts: 1, retryBaseSeconds: 0 },
    { key: "review-content-intelligence", kind: "APPROVAL", capability: "human", dependsOn: ["finalize-content-intelligence"], maxAttempts: 1, retryBaseSeconds: 0 },
  ],
};

const registry = new Map<string, WorkflowDefinition>([
  [`${channelConceptValidationDefinition.type}:${channelConceptValidationDefinition.version}`, channelConceptValidationDefinition],
  [`${channelResearchDefinition.type}:${channelResearchDefinition.version}`, channelResearchDefinition],
  [`${channelStrategyDefinition.type}:${channelStrategyDefinition.version}`, channelStrategyDefinition],
  [`${channelContentIntelligenceDefinition.type}:${channelContentIntelligenceDefinition.version}`, channelContentIntelligenceDefinition],
]);

/** Canonical finalizer per workflow type; its output becomes the run's durable `output_payload`. */
export const WORKFLOW_FINALIZER_STEP: Record<ProductionWorkflowType, string> = {
  CHANNEL_CONCEPT_VALIDATION: "synthesize-validation",
  CHANNEL_RESEARCH: "synthesize-validation",
  CHANNEL_STRATEGY: "finalize-strategy",
  CHANNEL_CONTENT_INTELLIGENCE: "finalize-content-intelligence",
};

export function getWorkflowDefinition(type: ProductionWorkflowType, version: number) {
  const definition = registry.get(`${type}:${version}`);
  if (!definition) throw new Error("WORKFLOW_DEFINITION_NOT_FOUND");
  return definition;
}

export function serializeWorkflowSteps(definition: WorkflowDefinition) {
  return definition.steps.map((step, position) => ({
    key: step.key,
    position,
    kind: step.kind,
    capability: step.capability,
    dependsOn: step.dependsOn,
    maxAttempts: step.maxAttempts,
    retryBaseSeconds: step.retryBaseSeconds,
  }));
}

export type ClaimedWorkflowStep = {
  id: string;
  ownerId: string;
  workflowId: string;
  runId: string;
  workflowType: ProductionWorkflowType;
  definitionVersion: number;
  stepKey: string;
  capability: string;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string;
  leaseExpiresAt: string;
  input: unknown;
  priorOutputs: Record<string, unknown>;
};

export const claimedWorkflowStepSchema: z.ZodType<ClaimedWorkflowStep> = z.object({
  id: z.string().uuid(), ownerId: z.string().uuid(), workflowId: z.string().uuid(), runId: z.string().uuid(),
  workflowType: workflowTypeSchema, definitionVersion: z.number().int().positive(), stepKey: z.string().min(1), capability: z.string().min(1),
  attemptCount: z.number().int().positive(), maxAttempts: z.number().int().positive(), leaseToken: z.string().uuid(), leaseExpiresAt: z.string(),
  input: z.unknown(), priorOutputs: z.record(z.string(), z.unknown()),
}).strict();
