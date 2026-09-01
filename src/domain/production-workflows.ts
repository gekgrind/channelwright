import { z } from "zod";
import { originalContributionKindSchema, viewerNeedKindSchema, viewerValueAssessmentSchema, viewerValueProvenanceSchema } from "./viewer-value";

export const workflowTypeSchema = z.enum(["CHANNEL_CONCEPT_VALIDATION", "CHANNEL_RESEARCH", "CHANNEL_STRATEGY", "CHANNEL_CONTENT_INTELLIGENCE", "CHANNEL_VIDEO_BRIEF", "CHANNEL_VIDEO_SCRIPT", "CHANNEL_VIDEO_PACKAGING", "CHANNEL_VIDEO_RELEASE"]);
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

// ---------------------------------------------------------------------------
// CHANNEL_VIDEO_BRIEF
//
// The quality gate between "what should we make?" and "let's produce it".
// It consumes one exact approved CHANNEL_CONTENT_INTELLIGENCE artifact plus one
// eligible topic from that artifact's ranked backlog, and produces the creative
// and production direction for a single video.
//
// It deliberately produces no final title, thumbnail copy or asset, script,
// storyboard, media, voiceover, recut, upload, or publish action. Those stay
// downstream, and deterministic QA rejects them as scope violations. The
// contract is shaped so those later stages inherit structured input rather than
// re-deriving it.
// ---------------------------------------------------------------------------

/** Immutable reference to the exact approved content-intelligence artifact. */
export const approvedContentIntelligenceReferenceSchema = z.object({
  contentWorkflowId: z.string().uuid(),
  contentRunId: z.string().uuid(),
  workflowDefinitionVersion: z.number().int().positive(),
  outputSchemaVersion: z.literal(1),
  approvalId: z.string().uuid(),
  approvedBy: z.string().uuid(),
  approvedAt: z.string().datetime(),
  finalQaState: z.enum(["accept", "human_review_required"]),
  finalQaScore: z.number().int().min(0).max(100),
  contentArtifactHash: sha256Schema,
  contentProvenanceHash: sha256Schema,
  parentRunId: z.string().uuid().nullable(),
  rootRunId: z.string().uuid(),
  // Transitive provenance: content intelligence already proved its own upstream
  // strategy, which in turn already proved its upstream research. One reference
  // therefore anchors the whole RESEARCH -> STRATEGY -> CONTENT chain.
  upstreamStrategy: approvedStrategyReferenceSchema,
}).strict();

/**
 * Which backlog topic this brief is for, and how it was chosen. The Viewer Value
 * provenance is lifted from the upstream topic's own assessment, so a brief that
 * silently changes the promise no longer matches its source contract hash.
 */
export const selectedVideoOpportunitySchema = z.object({
  topicId: topicIdSchema,
  pillarId: pillarIdSchema,
  backlogRank: z.number().int().min(1).max(CONTENT_BACKLOG_MAX),
  tier: z.enum(["PRIORITY", "STRONG", "VIABLE", "HOLD"]),
  selectionSource: z.enum(["NEXT_VIDEO_RECOMMENDATION", "OPERATOR_SELECTED"]),
  inheritedViewerValueProvenance: viewerValueProvenanceSchema,
}).strict();

export const videoBriefRequestInputSchema = z.object({
  contentIntelligenceWorkflowId: z.string().uuid(),
  contentIntelligenceRunId: z.string().uuid(),
  /** Absent means "use the artifact's authoritative nextVideoRecommendation". */
  topicId: topicIdSchema.optional(),
}).strict();

export const videoBriefInputSchema = videoBriefRequestInputSchema.extend({
  approvedContentReference: approvedContentIntelligenceReferenceSchema,
  selectedTopicId: topicIdSchema,
  humanRevisionNote: z.string().trim().min(1).max(2_000).optional(),
}).strict();

/** Resolver output: the authoritative upstream artifact and the resolved topic. */
export const approvedContentOpportunityArtifactSchema = z.object({
  reference: approvedContentIntelligenceReferenceSchema,
  contentResult: channelContentIntelligenceResultSchema,
  discoveryBundle: topicDiscoveryBundleSchema,
  selectedTopic: contentTopicOpportunitySchema,
  selection: selectedVideoOpportunitySchema,
}).strict();

const sectionIdSchema = z.string().regex(/^beat:[a-z0-9][a-z0-9-]{0,58}$/);
const claimIdSchema = z.string().regex(/^claim:[a-z0-9][a-z0-9-]{0,58}$/);
const hookConceptIdSchema = z.string().regex(/^hook:[a-z0-9][a-z0-9-]{0,58}$/);

export const videoBriefSourceSchema = z.object({
  topicId: topicIdSchema,
  pillarId: pillarIdSchema,
  pillarName: z.string().min(1).max(300),
  workingConcept: z.string().min(1).max(400),
  workingAngle: z.string().min(1).max(400),
  strategicContext: z.string().min(1).max(900),
  sourceEvidenceIds: citedEvidenceIdsSchema,
}).strict();

/**
 * Who this is for, described in terms the upstream evidence can actually
 * support. `demographicPrecisionLimit` forces the brief to state what it does
 * not know rather than inventing an age range or income bracket.
 */
export const videoBriefViewerSchema = z.object({
  primaryViewer: z.string().min(1).max(600),
  viewerState: z.string().min(1).max(600),
  viewerQuestion: z.string().min(1).max(400),
  viewerIntent: z.enum(["LEARN", "SOLVE", "DECIDE", "COMPARE", "EXPLORE", "STAY_INFORMED", "BE_ENTERTAINED", "OTHER"]),
  needKind: viewerNeedKindSchema,
  needStatement: z.string().min(1).max(600),
  alreadyKnows: z.array(z.string().min(1).max(400)).min(1).max(8),
  stillNeeds: z.array(z.string().min(1).max(400)).min(1).max(8),
  assumptions: z.array(z.string().min(1).max(400)).min(1).max(8),
  uncertainties: z.array(z.string().min(1).max(400)).min(1).max(8),
  demographicPrecisionLimit: z.string().min(1).max(600),
}).strict();

/** Non-exhaustive; multiple kinds legitimately apply to one video. */
export const videoValueTypeSchema = z.enum([
  "EDUCATION", "PROBLEM_SOLVING", "DECISION_SUPPORT", "ENTERTAINMENT", "INSPIRATION", "DISCOVERY", "OTHER",
]);

/**
 * The promise must be specific enough to QA. "Learn everything you need to
 * know" cannot be checked against the content architecture; "decide whether to
 * self-host or use a managed service, using a 4-factor cost model" can.
 */
export const viewerPromiseSchema = z.object({
  statement: z.string().min(20).max(600),
  outcomeKind: z.enum(["UNDERSTAND", "ACHIEVE", "DECIDE", "AVOID", "BE_ABLE_TO"]),
  whyItMatters: z.string().min(1).max(600),
  transformation: z.object({
    before: z.string().min(1).max(500),
    after: z.string().min(1).max(500),
  }).strict(),
  concreteValue: z.string().min(1).max(600),
  valueTypes: z.array(z.object({ kind: videoValueTypeSchema, label: z.string().min(1).max(200).nullable() }).strict()).min(1).max(6),
  /** What this video deliberately does not promise; keeps the hook honest. */
  explicitNonPromises: z.array(z.string().min(1).max(400)).min(1).max(6),
  /** How a reviewer could tell whether the finished video kept the promise. */
  verifiability: z.string().min(1).max(600),
}).strict();

export const videoOriginalContributionSchema = z.object({
  kinds: z.array(z.object({ kind: originalContributionKindSchema, label: z.string().min(1).max(200).nullable() }).strict()).min(1).max(6),
  statement: z.string().min(1).max(700),
  comparedToExisting: z.string().min(1).max(700),
  whyMoreUseful: z.string().min(1).max(700),
  evidenceIds: contentEvidenceIdsSchema,
}).strict();

/**
 * Every material claim the video intends to make, and whether the current
 * evidence actually supports it. RESEARCH_REQUIRED is the honest answer when it
 * does not; fabricating support is the failure mode this exists to prevent.
 */
export const evidencePlanItemSchema = z.object({
  claimId: claimIdSchema,
  claim: z.string().min(1).max(600),
  status: z.enum(["SUPPORTED", "STRATEGIC_ASSUMPTION", "PRODUCTION_ASSUMPTION", "RESEARCH_REQUIRED", "MUST_NOT_CLAIM"]),
  materiality: z.enum(["core", "supporting", "incidental"]),
  evidenceIds: contentEvidenceIdsSchema,
  rationale: z.string().min(1).max(600),
  /** What would have to be established before this claim may be scripted. */
  researchNote: z.string().min(1).max(600).nullable(),
}).strict();

export const evidencePlanSchema = z.object({
  items: z.array(evidencePlanItemSchema).min(1).max(20),
  gaps: z.array(z.string().min(1).max(400)).max(10),
  sufficiency: z.enum(["SUFFICIENT_TO_SCRIPT", "SUFFICIENT_WITH_NOTED_GAPS", "RESEARCH_REQUIRED_BEFORE_SCRIPT"]),
  sufficiencyRationale: z.string().min(1).max(600),
}).strict();

/**
 * High-level direction, not assets. A tutorial, an investigative explainer, a
 * documentary, and a comparison should not collapse into one template, so these
 * fields are descriptive rather than enumerated where the shape genuinely varies.
 */
export const creativeDirectionSchema = z.object({
  format: z.enum(["TUTORIAL", "EXPLAINER", "INVESTIGATION", "DOCUMENTARY", "COMPARISON", "CASE_STUDY", "DEMONSTRATION", "ESSAY", "LIST_WITH_ANALYSIS", "INTERVIEW", "NARRATIVE", "OTHER"]),
  formatLabel: z.string().min(1).max(200).nullable(),
  formatRationale: z.string().min(1).max(600),
  tone: z.string().min(1).max(400),
  pacing: z.enum(["deliberate", "measured", "brisk", "varied"]),
  pacingRationale: z.string().min(1).max(600),
  narrativeApproach: z.string().min(1).max(600),
  presentationStyle: z.string().min(1).max(600),
  informationDensity: z.enum(["high", "medium", "low"]),
  visualStrategy: z.string().min(1).max(700),
  demonstrationOpportunities: z.array(z.string().min(1).max(400)).max(8),
  proofMoments: z.array(z.string().min(1).max(400)).min(1).max(8),
  emotionalArc: z.string().min(1).max(600).nullable(),
  credibilityStrategy: z.string().min(1).max(700),
  useOfExamples: z.string().min(1).max(600),
  storytellingOpportunities: z.array(z.string().min(1).max(400)).max(6),
  productionComplexity: z.enum(["high", "medium", "low"]),
  productionComplexityRationale: z.string().min(1).max(600),
}).strict();

/**
 * Structured beats, not narration. `informationToCommunicate` is a list of
 * points, and a short example line is tolerated only where it clarifies intent —
 * deterministic QA rejects anything script-shaped.
 */
export const contentBeatSchema = z.object({
  sectionId: sectionIdSchema,
  title: z.string().min(1).max(200),
  role: z.enum(["OPENING", "CONTEXT", "CORE", "PROOF", "DEMONSTRATION", "COUNTERPOINT", "RESOLUTION", "PAYOFF", "NEXT_ACTION", "OTHER"]),
  purpose: z.string().min(1).max(500),
  viewerQuestion: z.string().min(1).max(400),
  valueDelivered: z.string().min(1).max(500),
  evidenceRequired: contentEvidenceIdsSchema,
  claimIds: z.array(claimIdSchema).max(8),
  informationToCommunicate: z.array(z.string().min(1).max(400)).min(1).max(8),
  transitionIntent: z.string().min(1).max(400),
  retentionRisk: z.string().min(1).max(400),
  visualTreatment: z.string().min(1).max(400),
  /** Relative share of the video, not a duration promise. */
  relativeWeight: z.enum(["major", "moderate", "minor"]),
}).strict();

export const contentArchitectureSchema = z.object({
  structureRationale: z.string().min(1).max(700),
  beats: z.array(contentBeatSchema).min(3).max(14),
  payoffLocation: sectionIdSchema,
}).strict();

/** Strategic hook concepts, never finished opening copy or a final title. */
export const hookStrategySchema = z.object({
  audienceTension: z.string().min(1).max(600),
  curiosityMechanism: z.string().min(1).max(600),
  problemOrOpportunity: z.string().min(1).max(600),
  expectedPayoff: z.string().min(1).max(600),
  payoffLocation: sectionIdSchema,
  credibilityNeed: z.string().min(1).max(600),
  communicateImmediately: z.array(z.string().min(1).max(300)).min(1).max(6),
  risks: z.array(z.string().min(1).max(400)).min(1).max(6),
  concepts: z.array(z.object({
    conceptId: hookConceptIdSchema,
    approach: z.string().min(1).max(400),
    rationale: z.string().min(1).max(500),
    /** How the video actually keeps what this hook implies. */
    payoffAlignment: z.string().min(1).max(500),
    deceptionRisk: z.enum(["none", "low", "material"]),
  }).strict()).min(1).max(5),
}).strict();

/**
 * Retention as continuous value delivery. There is deliberately no field for a
 * predicted retention percentage or watch time: those would be fabrications.
 */
export const retentionArchitectureSchema = z.object({
  earlyAbandonmentRisks: z.array(z.string().min(1).max(400)).min(1).max(6),
  dragRisks: z.array(z.object({ sectionId: sectionIdSchema, risk: z.string().min(1).max(400), mitigation: z.string().min(1).max(400) }).strict()).max(8),
  informationOrderDecisions: z.array(z.string().min(1).max(400)).min(1).max(8),
  proofTiming: z.string().min(1).max(500),
  demonstrationTiming: z.string().min(1).max(500).nullable(),
  openQuestionSequencing: z.array(z.string().min(1).max(400)).max(6),
  patternChanges: z.array(z.string().min(1).max(400)).max(6),
  cognitiveLoadRisks: z.array(z.string().min(1).max(400)).max(6),
  payoffTiming: z.string().min(1).max(500),
}).strict();

export const ctaStrategySchema = z.object({
  objective: z.enum(["SUBSCRIBE", "COMMENT", "NEXT_VIDEO", "FREE_RESOURCE", "TOOL", "EMAIL_LIST", "PRODUCT", "NONE"]),
  rationale: z.string().min(1).max(600),
  placement: z.string().min(1).max(400).nullable(),
  viewerBenefit: z.string().min(1).max(500).nullable(),
  trustRisk: z.string().min(1).max(500).nullable(),
}).strict();

/**
 * Monetization relevance only. There is no field for predicted revenue, and
 * NONE is a legitimate and often correct answer.
 */
export const monetizationAlignmentSchema = z.object({
  relevance: z.enum(["NONE", "SPONSORSHIP", "AFFILIATE", "LEAD_GENERATION", "DIGITAL_PRODUCT", "MEMBERSHIP", "SERVICES", "OTHER"]),
  label: z.string().min(1).max(200).nullable(),
  rationale: z.string().min(1).max(600),
  sponsorCategory: z.string().min(1).max(300).nullable(),
  affiliateRelevance: z.string().min(1).max(400).nullable(),
  leadMagnetOpportunity: z.string().min(1).max(400).nullable(),
  paidProductAlignment: z.string().min(1).max(400).nullable(),
  /** Explicitly judged, so monetization cannot quietly outrank viewer value. */
  viewerValueImpact: z.enum(["none", "neutral", "supports", "competes"]),
  viewerValueImpactRationale: z.string().min(1).max(500),
}).strict();

/** Concept only. The resource itself belongs to a later stage. */
export const supportingResourceSchema = z.object({
  resourceKind: z.enum(["CHECKLIST", "WORKSHEET", "TEMPLATE", "CALCULATOR", "PROMPT_PACK", "REFERENCE_GUIDE", "COMPARISON_TABLE", "CHEAT_SHEET", "PLANNING_DOCUMENT", "OTHER"]),
  label: z.string().min(1).max(200).nullable(),
  concept: z.string().min(1).max(600),
  viewerBenefit: z.string().min(1).max(500),
  whyItImprovesTheVideo: z.string().min(1).max(500),
  placement: z.string().min(1).max(400),
  pricingRecommendation: z.enum(["FREE", "POTENTIALLY_PAID"]),
  pricingRationale: z.string().min(1).max(400),
}).strict();

export const channelVideoBriefContentSchema = z.object({
  schemaVersion: z.literal(1),
  workflowType: z.literal("CHANNEL_VIDEO_BRIEF"),
  source: videoBriefSourceSchema,
  viewer: videoBriefViewerSchema,
  viewerPromise: viewerPromiseSchema,
  originalContribution: videoOriginalContributionSchema,
  evidencePlan: evidencePlanSchema,
  creativeDirection: creativeDirectionSchema,
  contentArchitecture: contentArchitectureSchema,
  hookStrategy: hookStrategySchema,
  retentionArchitecture: retentionArchitectureSchema,
  ctaStrategy: ctaStrategySchema,
  monetizationAlignment: monetizationAlignmentSchema,
  /** Null is the correct answer when a companion resource would be artificial. */
  supportingResource: supportingResourceSchema.nullable(),
  /** This stage's own Viewer Value judgement, under the same shared doctrine. */
  viewerValue: viewerValueAssessmentSchema,
  risks: z.array(z.object({
    risk: z.string().min(1).max(500),
    severity: z.enum(["high", "medium", "low"]),
    mitigation: z.string().min(1).max(500).nullable(),
  }).strict()).min(1).max(10),
  assumptions: z.array(z.string().min(1).max(400)).min(1).max(12),
  openQuestions: z.array(z.string().min(1).max(400)).min(1).max(12),
  recommendedNextAction: z.string().min(1).max(500),
}).strict();

export const channelVideoBriefResultSchema = channelVideoBriefContentSchema.extend({
  upstreamContentIntelligence: approvedContentIntelligenceReferenceSchema,
  selectedTopic: selectedVideoOpportunitySchema,
  crossModelReview: crossModelReviewSchema.nullable(),
  // A finalized brief is always model-generated: the synthesis step stamps at
  // least the generator's attribution. An empty trail would mean an artifact
  // with no accountable author, which must never persist.
  modelProvenance: z.array(modelAttributionSchema).min(1).max(8),
}).strict();

export const videoBriefQAFindingSchema = researchQAFindingSchema;
export const videoBriefQAResultSchema = researchQAResultSchema;

export const videoBriefDraftSchema = z.object({
  result: channelVideoBriefResultSchema,
  modelUsage: researchDraftSchema.shape.modelUsage,
}).strict();

export const videoBriefQAStepSchema = z.object({
  qa: videoBriefQAResultSchema,
  crossModelReview: crossModelReviewSchema,
}).strict();

export const videoBriefRevisionSchema = z.object({
  attempted: z.boolean(),
  reason: z.string().min(1).max(1_000),
  result: channelVideoBriefResultSchema,
  modelUsage: researchDraftSchema.shape.modelUsage,
}).strict();

// ---------------------------------------------------------------------------
// CHANNEL_VIDEO_SCRIPT
//
// The first concrete production artifact: it turns one exact approved
// CHANNEL_VIDEO_BRIEF into a structured, timed, evidence-disciplined script for
// a single video. Unlike the brief, which deliberately produces no narration,
// the script stage IS the stage that writes spoken words. It stays bounded to
// scripting: it produces no final title, no thumbnail copy or imagery, no
// storyboard or shot list, no generated media (image/voice/video), no upload,
// and no publishing action. Deterministic QA rejects those as scope violations.
//
// It reasons only over evidence already inherited through the approved brief and
// its upstream chain (zero external retrieval). Every claim the script relies on
// maps to an evidence-plan claim in the approved brief and inherits that claim's
// status: a MUST_NOT_CLAIM claim may never become a factual script assertion, and
// a RESEARCH_REQUIRED (or assumption) claim may never be asserted as established
// fact.
//
// Size discipline: this result becomes a durable step output and the run's
// `output_payload`, both bounded at 64 KiB by the workflow engine. Narration and
// collection sizes are capped so a realistic single-video script fits with
// margin, and deterministic QA additionally rejects an oversized payload before
// persistence so the failure is a typed QA error rather than PAYLOAD_TOO_LARGE.
// ---------------------------------------------------------------------------

/** Immutable reference to the exact approved video-brief artifact. */
export const approvedVideoBriefReferenceSchema = z.object({
  briefWorkflowId: z.string().uuid(),
  briefRunId: z.string().uuid(),
  workflowDefinitionVersion: z.number().int().positive(),
  outputSchemaVersion: z.literal(1),
  approvalId: z.string().uuid(),
  approvedBy: z.string().uuid(),
  approvedAt: z.string().datetime(),
  finalQaState: z.enum(["accept", "human_review_required"]),
  finalQaScore: z.number().int().min(0).max(100),
  briefArtifactHash: sha256Schema,
  briefProvenanceHash: sha256Schema,
  parentRunId: z.string().uuid().nullable(),
  rootRunId: z.string().uuid(),
  // Transitive provenance: the video brief already proved its own upstream
  // content-intelligence artifact, which anchors the whole
  // RESEARCH -> STRATEGY -> CONTENT -> VIDEO_BRIEF chain. One reference therefore
  // carries the entire lineage.
  upstreamContentIntelligence: approvedContentIntelligenceReferenceSchema,
}).strict();

export const videoScriptRequestInputSchema = z.object({
  videoBriefWorkflowId: z.string().uuid(),
  videoBriefRunId: z.string().uuid(),
}).strict();

export const videoScriptInputSchema = videoScriptRequestInputSchema.extend({
  approvedVideoBriefReference: approvedVideoBriefReferenceSchema,
  humanRevisionNote: z.string().trim().min(1).max(2_000).optional(),
}).strict();

/**
 * Which brief this script is for, carried from authoritative resolver state. The
 * inherited Viewer Value provenance is lifted from the approved brief's own
 * assessment, so a script that silently changes the promise no longer matches
 * its source contract hash.
 */
export const selectedVideoBriefScopeSchema = z.object({
  briefTopicId: topicIdSchema,
  pillarId: pillarIdSchema,
  inheritedViewerValueProvenance: viewerValueProvenanceSchema,
}).strict();

/** Resolver output: the authoritative approved brief and its inherited evidence. */
export const approvedVideoBriefArtifactSchema = z.object({
  reference: approvedVideoBriefReferenceSchema,
  briefResult: channelVideoBriefResultSchema,
  discoveryBundle: topicDiscoveryBundleSchema,
  scope: selectedVideoBriefScopeSchema,
}).strict();

const scriptSectionIdSchema = z.string().regex(/^scriptsec:[a-z0-9][a-z0-9-]{0,58}$/);

/** Roles mirror the brief's content-architecture beat roles. */
const scriptSectionRoleSchema = z.enum(["OPENING", "CONTEXT", "CORE", "PROOF", "DEMONSTRATION", "COUNTERPOINT", "RESOLUTION", "PAYOFF", "NEXT_ACTION", "OTHER"]);

/**
 * How each material claim the script relies on is handled. The inherited status
 * is the approved brief's own evidence-plan status for that claim; the treatment
 * is how the narration presents it. Deterministic QA enforces that an unproven
 * status can never be treated as established fact, and that a MUST_NOT_CLAIM
 * claim is omitted entirely.
 */
export const scriptClaimUsageSchema = z.object({
  claimId: claimIdSchema,
  inheritedStatus: z.enum(["SUPPORTED", "STRATEGIC_ASSUMPTION", "PRODUCTION_ASSUMPTION", "RESEARCH_REQUIRED", "MUST_NOT_CLAIM"]),
  treatment: z.enum(["ASSERTED_AS_FACT", "PRESENTED_AS_HYPOTHESIS", "ATTRIBUTED", "HEDGED", "OMITTED"]),
  scriptSectionIds: z.array(scriptSectionIdSchema).max(20),
  rationale: z.string().min(1).max(600),
}).strict();

/**
 * The scripted opening. This is real narration, not a strategy note: it is the
 * hook the viewer will hear. It must keep the approved brief's promise rather
 * than manufacturing a curiosity gap the video does not pay off.
 */
export const scriptOpeningHookSchema = z.object({
  sectionId: scriptSectionIdSchema,
  briefBeatId: sectionIdSchema,
  spokenOpening: z.string().min(1).max(1_500),
  onScreenText: z.string().min(1).max(300).nullable(),
  durationSeconds: z.number().int().min(1).max(120),
  curiosityMechanism: z.string().min(1).max(500),
  promiseEchoed: z.boolean(),
  deceptionRisk: z.enum(["none", "low", "material"]),
  /** Any brief claims the hook itself asserts; each is tracked in claimUsage. */
  claimIds: z.array(claimIdSchema).max(6),
}).strict();

/**
 * One timed script section, mapped to exactly one approved brief content beat.
 * `narration` is the spoken script; `visualDirection` carries only the visual
 * intent inherited from the brief, never generated media or a formal shot list.
 */
export const scriptSectionSchema = z.object({
  sectionId: scriptSectionIdSchema,
  briefBeatId: sectionIdSchema,
  title: z.string().min(1).max(200),
  role: scriptSectionRoleSchema,
  narration: z.string().min(1).max(2_000),
  onScreenText: z.string().min(1).max(300).nullable(),
  visualDirection: z.string().min(1).max(400).nullable(),
  startSeconds: z.number().int().min(0).max(36_000),
  durationSeconds: z.number().int().min(1).max(3_600),
  deliversValue: z.string().min(1).max(400),
  retentionTechnique: z.string().min(1).max(400),
  claimIds: z.array(claimIdSchema).max(8),
  evidenceIds: contentEvidenceIdsSchema,
}).strict();

/** Timing totals. No retention or watch-time prediction: those would be fabrication. */
export const scriptTimingSchema = z.object({
  totalDurationSeconds: z.number().int().min(1).max(36_000),
  estimatedWordCount: z.number().int().min(1).max(20_000),
  wordsPerMinute: z.number().int().min(60).max(240).nullable(),
  pacingNote: z.string().min(1).max(500),
}).strict();

export const scriptCallToActionSchema = z.object({
  objective: z.enum(["SUBSCRIBE", "COMMENT", "NEXT_VIDEO", "FREE_RESOURCE", "TOOL", "EMAIL_LIST", "PRODUCT", "NONE"]),
  spokenCta: z.string().min(1).max(600).nullable(),
  placementSectionId: scriptSectionIdSchema.nullable(),
  viewerBenefit: z.string().min(1).max(500).nullable(),
  trustRisk: z.string().min(1).max(500).nullable(),
}).strict();

export const channelVideoScriptContentSchema = z.object({
  schemaVersion: z.literal(1),
  workflowType: z.literal("CHANNEL_VIDEO_SCRIPT"),
  source: z.object({
    briefTopicId: topicIdSchema,
    pillarId: pillarIdSchema,
    pillarName: z.string().min(1).max(300),
    workingConcept: z.string().min(1).max(400),
    /** The promise this script keeps; must match the approved brief's promise. */
    scriptedPromise: z.string().min(20).max(600),
    /** The approved brief beats this script covers; every beat must be mapped. */
    coveredBriefBeatIds: z.array(sectionIdSchema).min(1).max(14),
  }).strict(),
  openingHook: scriptOpeningHookSchema,
  sections: z.array(scriptSectionSchema).min(3).max(14),
  claimUsage: z.array(scriptClaimUsageSchema).min(1).max(20),
  timing: scriptTimingSchema,
  callToAction: scriptCallToActionSchema,
  /** This stage's own Viewer Value judgement, under the same shared doctrine. */
  viewerValue: viewerValueAssessmentSchema,
  evidenceDiscipline: z.object({
    researchRequiredClaimsDeferred: z.array(claimIdSchema).max(20),
    mustNotClaimOmitted: z.array(claimIdSchema).max(20),
    summary: z.string().min(1).max(600),
  }).strict(),
  risks: z.array(z.object({
    risk: z.string().min(1).max(500),
    severity: z.enum(["high", "medium", "low"]),
    mitigation: z.string().min(1).max(500).nullable(),
  }).strict()).min(1).max(10),
  assumptions: z.array(z.string().min(1).max(400)).min(1).max(12),
  openQuestions: z.array(z.string().min(1).max(400)).min(1).max(12),
  recommendedNextAction: z.string().min(1).max(500),
}).strict();

export const channelVideoScriptResultSchema = channelVideoScriptContentSchema.extend({
  upstreamVideoBrief: approvedVideoBriefReferenceSchema,
  scriptScope: selectedVideoBriefScopeSchema,
  crossModelReview: crossModelReviewSchema.nullable(),
  // A finalized script is always model-generated: the synthesis step stamps at
  // least the generator's attribution. An empty trail would mean an artifact
  // with no accountable author, which must never persist.
  modelProvenance: z.array(modelAttributionSchema).min(1).max(8),
}).strict();

export const videoScriptQAFindingSchema = researchQAFindingSchema;
export const videoScriptQAResultSchema = researchQAResultSchema;

export const videoScriptDraftSchema = z.object({
  result: channelVideoScriptResultSchema,
  modelUsage: researchDraftSchema.shape.modelUsage,
}).strict();

export const videoScriptQAStepSchema = z.object({
  qa: videoScriptQAResultSchema,
  crossModelReview: crossModelReviewSchema,
}).strict();

export const videoScriptRevisionSchema = z.object({
  attempted: z.boolean(),
  reason: z.string().min(1).max(1_000),
  result: channelVideoScriptResultSchema,
  modelUsage: researchDraftSchema.shape.modelUsage,
}).strict();

// ---------------------------------------------------------------------------
// CHANNEL_VIDEO_PACKAGING
//
// The distribution-packaging artifact: it turns one exact approved
// CHANNEL_VIDEO_SCRIPT into PROVIDER-NEUTRAL packaging direction for a single
// video — title candidates (candidates only, never a selection), thumbnail
// concepts (copy + visual intent, never a generated image or media asset), a
// description, chapters/timestamps DERIVED FROM the approved script's own
// timing, tags, and an end-screen/CTA placement plan — plus its own
// viewer-value assessment under the shared doctrine.
//
// It deliberately produces no generated thumbnail image or media, no chosen
// title, no upload/publish/OAuth action, no render-worker instruction, and no
// live-media-provider call. Deterministic QA rejects those as scope violations.
// The MISLEADING_PACKAGING viewer-value guard is enforced here: a title or
// thumbnail whose curiosity the video never pays off fails closed.
//
// It reasons only over evidence already inherited through the approved script
// and its upstream chain (zero external retrieval). Chapter timestamps must be
// derived from the approved script's section timing, never invented.
//
// Size discipline: this result becomes a durable step output and the run's
// `output_payload`, both bounded at 64 KiB by the workflow engine. Collection
// sizes are capped so a realistic packaging artifact fits with margin, and
// deterministic QA additionally rejects an oversized payload before persistence
// so the failure is a typed QA error rather than PAYLOAD_TOO_LARGE.
// ---------------------------------------------------------------------------

/** Immutable reference to the exact approved video-script artifact. */
export const approvedVideoScriptReferenceSchema = z.object({
  scriptWorkflowId: z.string().uuid(),
  scriptRunId: z.string().uuid(),
  workflowDefinitionVersion: z.number().int().positive(),
  outputSchemaVersion: z.literal(1),
  approvalId: z.string().uuid(),
  approvedBy: z.string().uuid(),
  approvedAt: z.string().datetime(),
  finalQaState: z.enum(["accept", "human_review_required"]),
  finalQaScore: z.number().int().min(0).max(100),
  scriptArtifactHash: sha256Schema,
  scriptProvenanceHash: sha256Schema,
  parentRunId: z.string().uuid().nullable(),
  rootRunId: z.string().uuid(),
  // Transitive provenance: the video script already proved its own upstream
  // video brief, which anchors the whole
  // RESEARCH -> STRATEGY -> CONTENT -> VIDEO_BRIEF -> VIDEO_SCRIPT chain. One
  // reference therefore carries the entire lineage.
  upstreamVideoBrief: approvedVideoBriefReferenceSchema,
}).strict();

export const videoPackagingRequestInputSchema = z.object({
  videoScriptWorkflowId: z.string().uuid(),
  videoScriptRunId: z.string().uuid(),
}).strict();

export const videoPackagingInputSchema = videoPackagingRequestInputSchema.extend({
  approvedVideoScriptReference: approvedVideoScriptReferenceSchema,
  humanRevisionNote: z.string().trim().min(1).max(2_000).optional(),
}).strict();

/**
 * The approved script's timing this packaging stage is entitled to derive
 * chapters from. One entry per script section, carrying only the identity and
 * timing needed to validate that chapter timestamps are derived rather than
 * invented.
 */
export const scriptSectionTimingSchema = z.object({
  sectionId: scriptSectionIdSchema,
  title: z.string().min(1).max(200),
  startSeconds: z.number().int().min(0).max(36_000),
  durationSeconds: z.number().int().min(1).max(3_600),
}).strict();

/**
 * Which script this packaging is for, carried from authoritative resolver state.
 * The inherited Viewer Value provenance is lifted from the approved script's own
 * assessment, so packaging that silently changes the promise no longer matches
 * its source contract hash. `scriptTiming` is the authoritative timeline chapters
 * must derive from.
 */
export const selectedVideoScriptScopeSchema = z.object({
  scriptTopicId: topicIdSchema,
  pillarId: pillarIdSchema,
  scriptDurationSeconds: z.number().int().min(1).max(36_000),
  scriptTiming: z.array(scriptSectionTimingSchema).min(1).max(14),
  inheritedViewerValueProvenance: viewerValueProvenanceSchema,
}).strict();

/** Resolver output: the authoritative approved script and its inherited evidence. */
export const approvedVideoScriptArtifactSchema = z.object({
  reference: approvedVideoScriptReferenceSchema,
  scriptResult: channelVideoScriptResultSchema,
  discoveryBundle: topicDiscoveryBundleSchema,
  scope: selectedVideoScriptScopeSchema,
}).strict();

const titleCandidateIdSchema = z.string().regex(/^title:[a-z0-9][a-z0-9-]{0,58}$/);
const thumbnailConceptIdSchema = z.string().regex(/^thumb:[a-z0-9][a-z0-9-]{0,58}$/);
const chapterIdSchema = z.string().regex(/^chapter:[a-z0-9][a-z0-9-]{0,58}$/);

/**
 * A title CANDIDATE, never a selection. There is deliberately no `selected`,
 * `chosen`, or `final` field: choosing a title is a human decision downstream.
 * `deceptionRisk` is judged so a curiosity-gap title the video never pays off
 * can be rejected by the MISLEADING_PACKAGING guard.
 */
export const titleCandidateSchema = z.object({
  candidateId: titleCandidateIdSchema,
  text: z.string().min(1).max(100),
  angle: z.string().min(1).max(300),
  rationale: z.string().min(1).max(500),
  /** How this title keeps the script's promise rather than overstating it. */
  promiseAlignment: z.string().min(1).max(500),
  curiosityMechanism: z.string().min(1).max(400),
  deceptionRisk: z.enum(["none", "low", "material"]),
  evidenceIds: contentEvidenceIdsSchema,
}).strict();

/**
 * A thumbnail CONCEPT: on-thumbnail copy plus prose visual intent. There is
 * deliberately no field for a generated image, an asset URL, or media of any
 * kind — producing the thumbnail image belongs to a downstream stage, and
 * deterministic QA rejects any attempt to generate one here.
 */
export const thumbnailConceptSchema = z.object({
  conceptId: thumbnailConceptIdSchema,
  copyText: z.string().min(1).max(120).nullable(),
  visualIntent: z.string().min(1).max(600),
  rationale: z.string().min(1).max(500),
  promiseAlignment: z.string().min(1).max(500),
  deceptionRisk: z.enum(["none", "low", "material"]),
  evidenceIds: contentEvidenceIdsSchema,
}).strict();

/**
 * One chapter/timestamp, DERIVED FROM the approved script's timing. `startSeconds`
 * must equal the start time of the referenced script section; deterministic QA
 * rejects a timestamp that is not derived from the approved script timeline.
 */
export const packagingChapterSchema = z.object({
  chapterId: chapterIdSchema,
  sourceScriptSectionId: scriptSectionIdSchema,
  startSeconds: z.number().int().min(0).max(36_000),
  title: z.string().min(1).max(100),
}).strict();

export const packagingDescriptionSchema = z.object({
  /** The opening lines that appear above the fold; must keep the promise. */
  summary: z.string().min(1).max(600),
  body: z.string().min(1).max(3_000),
  /** Keywords woven in naturally; never a keyword-stuffed block. */
  keywords: z.array(z.string().min(1).max(60)).max(20),
  resourceMentions: z.array(z.string().min(1).max(300)).max(8),
}).strict();

/** End-screen / CTA placement PLAN, not a rendered end screen. */
export const endScreenPlanSchema = z.object({
  ctaObjective: z.enum(["SUBSCRIBE", "COMMENT", "NEXT_VIDEO", "FREE_RESOURCE", "TOOL", "EMAIL_LIST", "PRODUCT", "NONE"]),
  rationale: z.string().min(1).max(500),
  elements: z.array(z.object({
    kind: z.enum(["SUBSCRIBE_ELEMENT", "NEXT_VIDEO", "PLAYLIST", "FREE_RESOURCE_LINK", "EXTERNAL_LINK", "OTHER"]),
    label: z.string().min(1).max(200).nullable(),
    placement: z.string().min(1).max(300),
    viewerBenefit: z.string().min(1).max(400),
    trustRisk: z.string().min(1).max(400).nullable(),
  }).strict()).max(6),
}).strict();

export const channelVideoPackagingContentSchema = z.object({
  schemaVersion: z.literal(1),
  workflowType: z.literal("CHANNEL_VIDEO_PACKAGING"),
  source: z.object({
    scriptTopicId: topicIdSchema,
    pillarId: pillarIdSchema,
    pillarName: z.string().min(1).max(300),
    workingConcept: z.string().min(1).max(400),
    /** The promise this packaging keeps; must match the approved script's promise. */
    packagedPromise: z.string().min(20).max(600),
  }).strict(),
  titleCandidates: z.array(titleCandidateSchema).min(3).max(8),
  thumbnailConcepts: z.array(thumbnailConceptSchema).min(2).max(6),
  description: packagingDescriptionSchema,
  chapters: z.array(packagingChapterSchema).min(3).max(14),
  tags: z.array(z.string().min(1).max(60)).min(1).max(30),
  endScreenPlan: endScreenPlanSchema,
  /** This stage's own Viewer Value judgement, under the same shared doctrine. */
  viewerValue: viewerValueAssessmentSchema,
  packagingIntegrity: z.object({
    /** Title/thumbnail concepts deliberately withheld as too deceptive to offer. */
    rejectedForDeception: z.array(z.string().min(1).max(200)).max(12),
    summary: z.string().min(1).max(600),
  }).strict(),
  risks: z.array(z.object({
    risk: z.string().min(1).max(500),
    severity: z.enum(["high", "medium", "low"]),
    mitigation: z.string().min(1).max(500).nullable(),
  }).strict()).min(1).max(10),
  assumptions: z.array(z.string().min(1).max(400)).min(1).max(12),
  openQuestions: z.array(z.string().min(1).max(400)).min(1).max(12),
  recommendedNextAction: z.string().min(1).max(500),
}).strict();

export const channelVideoPackagingResultSchema = channelVideoPackagingContentSchema.extend({
  upstreamVideoScript: approvedVideoScriptReferenceSchema,
  packagingScope: selectedVideoScriptScopeSchema,
  crossModelReview: crossModelReviewSchema.nullable(),
  // A finalized packaging is always model-generated: the synthesis step stamps
  // at least the generator's attribution. An empty trail would mean an artifact
  // with no accountable author, which must never persist.
  modelProvenance: z.array(modelAttributionSchema).min(1).max(8),
}).strict();

export const videoPackagingQAFindingSchema = researchQAFindingSchema;
export const videoPackagingQAResultSchema = researchQAResultSchema;

export const videoPackagingDraftSchema = z.object({
  result: channelVideoPackagingResultSchema,
  modelUsage: researchDraftSchema.shape.modelUsage,
}).strict();

export const videoPackagingQAStepSchema = z.object({
  qa: videoPackagingQAResultSchema,
  crossModelReview: crossModelReviewSchema,
}).strict();

export const videoPackagingRevisionSchema = z.object({
  attempted: z.boolean(),
  reason: z.string().min(1).max(1_000),
  result: channelVideoPackagingResultSchema,
  modelUsage: researchDraftSchema.shape.modelUsage,
}).strict();

// ---------------------------------------------------------------------------
// CHANNEL_VIDEO_RELEASE
//
// The distribution / release-decision artifact: it turns one exact approved
// CHANNEL_VIDEO_PACKAGING into a human-approved, immutable RELEASE RECORD — the
// final release decision made before any external publishing occurs. Unlike
// packaging (which deliberately produces candidates and never a selection),
// release IS the selection stage: it SELECTS exactly one title from the approved
// packaging's title candidates and one thumbnail concept, reconciles the final
// metadata, recommends a publish window, plans playlist/series placement and the
// distribution surfaces, binds the release to the strategy KPI(s)/hypothesis it
// tests (identity and intent only), re-runs the misleading/deceptive-packaging
// guard at selection time, and carries its own viewer-value/integrity assessment.
//
// It is a DECISION and DURABLE-RECORD system, not a publishing system. It
// deliberately performs no provider OAuth, no live publish/upload, no scheduling
// through an external provider API, no media rendering, no TTS/image/video
// generation, no thumbnail image generation, no cross-platform recut generation,
// and no performance ingestion or measurement. Deterministic QA rejects those as
// scope violations. The selected title and thumbnail must be EXACT members of the
// approved packaging's candidate set — a release can never invent a new title.
//
// It reasons only over the approved packaging and its upstream chain (zero
// external retrieval). Chapters and the reconciled metadata are DERIVED FROM the
// approved packaging, never invented.
//
// Size discipline: this result becomes a durable step output and the run's
// `output_payload`, both bounded at 64 KiB by the workflow engine. Collection
// sizes are capped so a realistic release record fits with margin, and
// deterministic QA additionally rejects an oversized payload before persistence
// so the failure is a typed QA error rather than PAYLOAD_TOO_LARGE.
// ---------------------------------------------------------------------------

/** Immutable reference to the exact approved video-packaging artifact. */
export const approvedVideoPackagingReferenceSchema = z.object({
  packagingWorkflowId: z.string().uuid(),
  packagingRunId: z.string().uuid(),
  workflowDefinitionVersion: z.number().int().positive(),
  outputSchemaVersion: z.literal(1),
  approvalId: z.string().uuid(),
  approvedBy: z.string().uuid(),
  approvedAt: z.string().datetime(),
  finalQaState: z.enum(["accept", "human_review_required"]),
  finalQaScore: z.number().int().min(0).max(100),
  packagingArtifactHash: sha256Schema,
  packagingProvenanceHash: sha256Schema,
  parentRunId: z.string().uuid().nullable(),
  rootRunId: z.string().uuid(),
  // Transitive provenance: the packaging already proved its own upstream video
  // script, which anchors the whole
  // RESEARCH -> STRATEGY -> CONTENT -> VIDEO_BRIEF -> VIDEO_SCRIPT -> VIDEO_PACKAGING
  // chain. One reference therefore carries the entire lineage, including the
  // strategy identity the KPI/hypothesis binding must anchor to.
  upstreamVideoScript: approvedVideoScriptReferenceSchema,
}).strict();

export const videoReleaseRequestInputSchema = z.object({
  videoPackagingWorkflowId: z.string().uuid(),
  videoPackagingRunId: z.string().uuid(),
}).strict();

export const videoReleaseInputSchema = videoReleaseRequestInputSchema.extend({
  approvedVideoPackagingReference: approvedVideoPackagingReferenceSchema,
  humanRevisionNote: z.string().trim().min(1).max(2_000).optional(),
}).strict();

/**
 * Which packaging this release is for, carried from authoritative resolver state.
 * The inherited Viewer Value provenance is lifted from the approved packaging's
 * own assessment, so a release that silently changes the promise no longer
 * matches its source contract hash. `titleCandidateIds`/`thumbnailConceptIds` are
 * the authoritative selectable sets: the release's selection must be an exact
 * member of them, so the DB — not the caller — decides what may be chosen.
 */
export const selectedVideoPackagingScopeSchema = z.object({
  packagingTopicId: topicIdSchema,
  pillarId: pillarIdSchema,
  packagedPromise: z.string().min(20).max(600),
  titleCandidateIds: z.array(titleCandidateIdSchema).min(1).max(8),
  thumbnailConceptIds: z.array(thumbnailConceptIdSchema).min(1).max(6),
  inheritedViewerValueProvenance: viewerValueProvenanceSchema,
}).strict();

/** Resolver output: the authoritative approved packaging and its inherited evidence. */
export const approvedVideoPackagingArtifactSchema = z.object({
  reference: approvedVideoPackagingReferenceSchema,
  packagingResult: channelVideoPackagingResultSchema,
  discoveryBundle: topicDiscoveryBundleSchema,
  scope: selectedVideoPackagingScopeSchema,
}).strict();

/** KPI/hypothesis identity this release tests. Identity and intent only. */
export const releaseKpiMetricSchema = z.enum([
  "IMPRESSIONS", "CLICK_THROUGH_RATE", "AVERAGE_VIEW_DURATION", "AUDIENCE_RETENTION",
  "RETURNING_VIEWERS", "SUBSCRIBERS", "PUBLISHING_CONSISTENCY", "REVENUE_INDICATOR",
  "CONVERSION_INDICATOR", "OTHER",
]);

/**
 * A binding of this release to one strategy KPI and the hypothesis it tests.
 * `strategyRunId` anchors the binding to the exact upstream strategy identity
 * carried transitively through the chain, so a release cannot bind to a KPI from
 * a strategy it does not descend from. There is deliberately no measured value,
 * baseline, or ingestion field: measurement is a later vertical, and both
 * `targetIsHypothesis` and `measurementDeferred` are fixed literals so this stage
 * can never assert a performance outcome.
 */
export const releaseKpiHypothesisBindingSchema = z.object({
  metric: releaseKpiMetricSchema,
  label: z.string().min(1).max(300),
  hypothesis: z.string().min(1).max(600),
  rationale: z.string().min(1).max(600),
  strategyRunId: z.string().uuid(),
  targetIsHypothesis: z.literal(true),
  measurementDeferred: z.literal(true),
}).strict();

/** The selected title, an EXACT member of the packaging's candidate set. */
export const releaseTitleDecisionSchema = z.object({
  selectedCandidateId: titleCandidateIdSchema,
  selectedTitleText: z.string().min(1).max(100),
  rationale: z.string().min(1).max(600),
  promiseAlignment: z.string().min(1).max(500),
  deceptionRisk: z.enum(["none", "low", "material"]),
}).strict();

/** The selected thumbnail concept, an EXACT member of the packaging's concept set. */
export const releaseThumbnailDecisionSchema = z.object({
  selectedConceptId: thumbnailConceptIdSchema,
  rationale: z.string().min(1).max(600),
  promiseAlignment: z.string().min(1).max(500),
  deceptionRisk: z.enum(["none", "low", "material"]),
}).strict();

/**
 * A RECOMMENDED publish window — an intent, not a dispatch. The window is bounded
 * ISO timestamps plus rationale; nothing here schedules through a provider API,
 * and deterministic QA rejects any external-scheduling action.
 */
export const releasePublishWindowSchema = z.object({
  timezone: z.string().min(1).max(60),
  earliest: z.string().datetime(),
  latest: z.string().datetime(),
  cadenceRationale: z.string().min(1).max(600),
  rationale: z.string().min(1).max(600),
}).strict();

/** Playlist / series placement intent. A decision to be executed later, not now. */
export const releasePlaylistPlacementSchema = z.object({
  seriesName: z.string().min(1).max(200).nullable(),
  playlistName: z.string().min(1).max(200).nullable(),
  episodeIntent: z.string().min(1).max(300).nullable(),
  placementRationale: z.string().min(1).max(600),
}).strict();

/** One planned distribution surface for the single approved video. Intent only. */
export const releaseDistributionSurfaceSchema = z.object({
  surface: z.enum(["YOUTUBE_LONG_FORM", "YOUTUBE_PLAYLIST", "YOUTUBE_COMMUNITY_POST", "CHANNEL_TRAILER_SLOT", "EMAIL_LIST", "COMMUNITY_OR_FORUM", "OTHER"]),
  label: z.string().min(1).max(200).nullable(),
  intent: z.string().min(1).max(500),
  rationale: z.string().min(1).max(500),
  viewerValueImpact: z.enum(["supports", "neutral", "competes"]),
}).strict();

/**
 * The final reconciled metadata for the release record. `finalTitle` must equal
 * the selected title text verbatim, and chapters must be derived from the
 * approved packaging's own chapters. This is the durable metadata a later
 * publishing stage would consume; it is not itself a publish action.
 */
export const releaseReconciledMetadataSchema = z.object({
  finalTitle: z.string().min(1).max(100),
  finalDescription: z.object({
    summary: z.string().min(1).max(600),
    body: z.string().min(1).max(3_000),
  }).strict(),
  tags: z.array(z.string().min(1).max(60)).min(1).max(30),
  chapters: z.array(packagingChapterSchema).min(3).max(14),
  categoryHint: z.string().min(1).max(120).nullable(),
  language: z.string().min(1).max(60).nullable(),
}).strict();

export const channelVideoReleaseContentSchema = z.object({
  schemaVersion: z.literal(1),
  workflowType: z.literal("CHANNEL_VIDEO_RELEASE"),
  source: z.object({
    packagingTopicId: topicIdSchema,
    pillarId: pillarIdSchema,
    pillarName: z.string().min(1).max(300),
    workingConcept: z.string().min(1).max(400),
    /** The promise this release keeps; must match the approved packaging's promise. */
    releasePromise: z.string().min(20).max(600),
  }).strict(),
  titleDecision: releaseTitleDecisionSchema,
  thumbnailDecision: releaseThumbnailDecisionSchema,
  publishWindow: releasePublishWindowSchema,
  playlistPlacement: releasePlaylistPlacementSchema,
  distributionSurfaces: z.array(releaseDistributionSurfaceSchema).min(1).max(8),
  reconciledMetadata: releaseReconciledMetadataSchema,
  kpiHypothesisBindings: z.array(releaseKpiHypothesisBindingSchema).min(1).max(8),
  /** This stage's own Viewer Value judgement, under the same shared doctrine. */
  viewerValue: viewerValueAssessmentSchema,
  releaseIntegrity: z.object({
    /** The misleading/deceptive-packaging guard is re-run at selection time. */
    deceptionGuardRerun: z.literal(true),
    misleadingGuardOutcome: z.enum(["PASS", "FAIL"]),
    /** Title/thumbnail options considered but rejected as too deceptive to release. */
    rejectedForDeception: z.array(z.string().min(1).max(200)).max(12),
    summary: z.string().min(1).max(600),
  }).strict(),
  risks: z.array(z.object({
    risk: z.string().min(1).max(500),
    severity: z.enum(["high", "medium", "low"]),
    mitigation: z.string().min(1).max(500).nullable(),
  }).strict()).min(1).max(10),
  assumptions: z.array(z.string().min(1).max(400)).min(1).max(12),
  openQuestions: z.array(z.string().min(1).max(400)).min(1).max(12),
  recommendedNextAction: z.string().min(1).max(500),
}).strict();

export const channelVideoReleaseResultSchema = channelVideoReleaseContentSchema.extend({
  upstreamVideoPackaging: approvedVideoPackagingReferenceSchema,
  releaseScope: selectedVideoPackagingScopeSchema,
  crossModelReview: crossModelReviewSchema.nullable(),
  // A finalized release is always model-generated: the synthesis step stamps at
  // least the generator's attribution. An empty trail would mean a release record
  // with no accountable author, which must never persist.
  modelProvenance: z.array(modelAttributionSchema).min(1).max(8),
}).strict();

export const videoReleaseQAFindingSchema = researchQAFindingSchema;
export const videoReleaseQAResultSchema = researchQAResultSchema;

export const videoReleaseDraftSchema = z.object({
  result: channelVideoReleaseResultSchema,
  modelUsage: researchDraftSchema.shape.modelUsage,
}).strict();

export const videoReleaseQAStepSchema = z.object({
  qa: videoReleaseQAResultSchema,
  crossModelReview: crossModelReviewSchema,
}).strict();

export const videoReleaseRevisionSchema = z.object({
  attempted: z.boolean(),
  reason: z.string().min(1).max(1_000),
  result: channelVideoReleaseResultSchema,
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
        : request.workflowType === "CHANNEL_VIDEO_BRIEF" ? videoBriefRequestInputSchema
          : request.workflowType === "CHANNEL_VIDEO_SCRIPT" ? videoScriptRequestInputSchema
            : request.workflowType === "CHANNEL_VIDEO_PACKAGING" ? videoPackagingRequestInputSchema
              : request.workflowType === "CHANNEL_VIDEO_RELEASE" ? videoReleaseRequestInputSchema
                : channelConceptValidationInputSchema;
  const parsed = schema.safeParse(request.input);
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ ...issue, path: ["input", ...issue.path] });
}).transform((request) => request as
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_CONCEPT_VALIDATION"; definitionVersion: 1; input: ChannelConceptValidationInput }
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_RESEARCH"; definitionVersion: 1; input: ChannelResearchInput }
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_STRATEGY"; definitionVersion: 1; input: ChannelStrategyRequestInput }
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_CONTENT_INTELLIGENCE"; definitionVersion: 1; input: ContentIntelligenceRequestInput }
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_VIDEO_BRIEF"; definitionVersion: 1; input: VideoBriefRequestInput }
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_VIDEO_SCRIPT"; definitionVersion: 1; input: VideoScriptRequestInput }
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_VIDEO_PACKAGING"; definitionVersion: 1; input: VideoPackagingRequestInput }
  | { operation: "START_WORKFLOW"; workflowType: "CHANNEL_VIDEO_RELEASE"; definitionVersion: 1; input: VideoReleaseRequestInput });

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
export type ApprovedContentIntelligenceReference = z.infer<typeof approvedContentIntelligenceReferenceSchema>;
export type ApprovedContentOpportunityArtifact = z.infer<typeof approvedContentOpportunityArtifactSchema>;
export type SelectedVideoOpportunity = z.infer<typeof selectedVideoOpportunitySchema>;
export type VideoBriefRequestInput = z.infer<typeof videoBriefRequestInputSchema>;
export type VideoBriefInput = z.infer<typeof videoBriefInputSchema>;
export type ChannelVideoBriefContent = z.infer<typeof channelVideoBriefContentSchema>;
export type ChannelVideoBriefResult = z.infer<typeof channelVideoBriefResultSchema>;
export type VideoBriefQAResult = z.infer<typeof videoBriefQAResultSchema>;
export type EvidencePlanItem = z.infer<typeof evidencePlanItemSchema>;
export type ContentBeat = z.infer<typeof contentBeatSchema>;
export type ApprovedVideoBriefReference = z.infer<typeof approvedVideoBriefReferenceSchema>;
export type ApprovedVideoBriefArtifact = z.infer<typeof approvedVideoBriefArtifactSchema>;
export type SelectedVideoBriefScope = z.infer<typeof selectedVideoBriefScopeSchema>;
export type VideoScriptRequestInput = z.infer<typeof videoScriptRequestInputSchema>;
export type VideoScriptInput = z.infer<typeof videoScriptInputSchema>;
export type ChannelVideoScriptContent = z.infer<typeof channelVideoScriptContentSchema>;
export type ChannelVideoScriptResult = z.infer<typeof channelVideoScriptResultSchema>;
export type VideoScriptQAResult = z.infer<typeof videoScriptQAResultSchema>;
export type ScriptSection = z.infer<typeof scriptSectionSchema>;
export type ScriptClaimUsage = z.infer<typeof scriptClaimUsageSchema>;
export type ApprovedVideoScriptReference = z.infer<typeof approvedVideoScriptReferenceSchema>;
export type ApprovedVideoScriptArtifact = z.infer<typeof approvedVideoScriptArtifactSchema>;
export type SelectedVideoScriptScope = z.infer<typeof selectedVideoScriptScopeSchema>;
export type VideoPackagingRequestInput = z.infer<typeof videoPackagingRequestInputSchema>;
export type VideoPackagingInput = z.infer<typeof videoPackagingInputSchema>;
export type ChannelVideoPackagingContent = z.infer<typeof channelVideoPackagingContentSchema>;
export type ChannelVideoPackagingResult = z.infer<typeof channelVideoPackagingResultSchema>;
export type VideoPackagingQAResult = z.infer<typeof videoPackagingQAResultSchema>;
export type TitleCandidate = z.infer<typeof titleCandidateSchema>;
export type ThumbnailConcept = z.infer<typeof thumbnailConceptSchema>;
export type PackagingChapter = z.infer<typeof packagingChapterSchema>;
export type ApprovedVideoPackagingReference = z.infer<typeof approvedVideoPackagingReferenceSchema>;
export type ApprovedVideoPackagingArtifact = z.infer<typeof approvedVideoPackagingArtifactSchema>;
export type SelectedVideoPackagingScope = z.infer<typeof selectedVideoPackagingScopeSchema>;
export type VideoReleaseRequestInput = z.infer<typeof videoReleaseRequestInputSchema>;
export type VideoReleaseInput = z.infer<typeof videoReleaseInputSchema>;
export type ChannelVideoReleaseContent = z.infer<typeof channelVideoReleaseContentSchema>;
export type ChannelVideoReleaseResult = z.infer<typeof channelVideoReleaseResultSchema>;
export type VideoReleaseQAResult = z.infer<typeof videoReleaseQAResultSchema>;
export type ReleaseKpiHypothesisBinding = z.infer<typeof releaseKpiHypothesisBindingSchema>;
export type ReleaseTitleDecision = z.infer<typeof releaseTitleDecisionSchema>;
export type ReleaseThumbnailDecision = z.infer<typeof releaseThumbnailDecisionSchema>;
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

const channelVideoBriefDefinition: WorkflowDefinition<VideoBriefRequestInput, ChannelVideoBriefResult> = {
  type: "CHANNEL_VIDEO_BRIEF",
  version: 1,
  objective: "Turn one exact approved CHANNEL_CONTENT_INTELLIGENCE topic into a viewer-value-gated, evidence-aware, independently critiqued production brief for a single video",
  inputSchema: videoBriefRequestInputSchema,
  outputSchema: channelVideoBriefResultSchema,
  steps: [
    { key: "validate-approved-content", kind: "WORKER", capability: "approved-content-validation", dependsOn: [], maxAttempts: 2, retryBaseSeconds: 5 },
    { key: "design-viewer-promise", kind: "WORKER", capability: "viewer-promise-design", dependsOn: ["validate-approved-content"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "build-video-brief", kind: "WORKER", capability: "video-brief-synthesis", dependsOn: ["design-viewer-promise"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "initial-video-brief-qa", kind: "WORKER", capability: "independent-video-brief-qa", dependsOn: ["build-video-brief"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "bounded-video-brief-revision", kind: "WORKER", capability: "video-brief-revision", dependsOn: ["initial-video-brief-qa"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "final-video-brief-qa", kind: "WORKER", capability: "independent-video-brief-qa", dependsOn: ["bounded-video-brief-revision"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "finalize-video-brief", kind: "WORKER", capability: "video-brief-finalizer", dependsOn: ["final-video-brief-qa"], maxAttempts: 1, retryBaseSeconds: 0 },
    { key: "review-video-brief", kind: "APPROVAL", capability: "human", dependsOn: ["finalize-video-brief"], maxAttempts: 1, retryBaseSeconds: 0 },
  ],
};

const channelVideoScriptDefinition: WorkflowDefinition<VideoScriptRequestInput, ChannelVideoScriptResult> = {
  type: "CHANNEL_VIDEO_SCRIPT",
  version: 1,
  objective: "Turn one exact approved CHANNEL_VIDEO_BRIEF into a viewer-value-gated, evidence-disciplined, independently critiqued, structured and timed script for a single video",
  inputSchema: videoScriptRequestInputSchema,
  outputSchema: channelVideoScriptResultSchema,
  steps: [
    { key: "validate-approved-brief", kind: "WORKER", capability: "approved-brief-validation", dependsOn: [], maxAttempts: 2, retryBaseSeconds: 5 },
    { key: "draft-video-script", kind: "WORKER", capability: "video-script-synthesis", dependsOn: ["validate-approved-brief"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "initial-video-script-qa", kind: "WORKER", capability: "independent-video-script-qa", dependsOn: ["draft-video-script"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "bounded-video-script-revision", kind: "WORKER", capability: "video-script-revision", dependsOn: ["initial-video-script-qa"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "final-video-script-qa", kind: "WORKER", capability: "independent-video-script-qa", dependsOn: ["bounded-video-script-revision"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "finalize-video-script", kind: "WORKER", capability: "video-script-finalizer", dependsOn: ["final-video-script-qa"], maxAttempts: 1, retryBaseSeconds: 0 },
    { key: "review-video-script", kind: "APPROVAL", capability: "human", dependsOn: ["finalize-video-script"], maxAttempts: 1, retryBaseSeconds: 0 },
  ],
};

const channelVideoPackagingDefinition: WorkflowDefinition<VideoPackagingRequestInput, ChannelVideoPackagingResult> = {
  type: "CHANNEL_VIDEO_PACKAGING",
  version: 1,
  objective: "Turn one exact approved CHANNEL_VIDEO_SCRIPT into viewer-value-gated, evidence-disciplined, independently critiqued, provider-neutral packaging direction for a single video",
  inputSchema: videoPackagingRequestInputSchema,
  outputSchema: channelVideoPackagingResultSchema,
  steps: [
    { key: "validate-approved-script", kind: "WORKER", capability: "approved-script-validation", dependsOn: [], maxAttempts: 2, retryBaseSeconds: 5 },
    { key: "draft-video-packaging", kind: "WORKER", capability: "video-packaging-synthesis", dependsOn: ["validate-approved-script"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "initial-video-packaging-qa", kind: "WORKER", capability: "independent-video-packaging-qa", dependsOn: ["draft-video-packaging"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "bounded-video-packaging-revision", kind: "WORKER", capability: "video-packaging-revision", dependsOn: ["initial-video-packaging-qa"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "final-video-packaging-qa", kind: "WORKER", capability: "independent-video-packaging-qa", dependsOn: ["bounded-video-packaging-revision"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "finalize-video-packaging", kind: "WORKER", capability: "video-packaging-finalizer", dependsOn: ["final-video-packaging-qa"], maxAttempts: 1, retryBaseSeconds: 0 },
    { key: "review-video-packaging", kind: "APPROVAL", capability: "human", dependsOn: ["finalize-video-packaging"], maxAttempts: 1, retryBaseSeconds: 0 },
  ],
};

const channelVideoReleaseDefinition: WorkflowDefinition<VideoReleaseRequestInput, ChannelVideoReleaseResult> = {
  type: "CHANNEL_VIDEO_RELEASE",
  version: 1,
  objective: "Turn one exact approved CHANNEL_VIDEO_PACKAGING into a viewer-value-gated, evidence-disciplined, independently critiqued, human-approved immutable release decision for a single video",
  inputSchema: videoReleaseRequestInputSchema,
  outputSchema: channelVideoReleaseResultSchema,
  steps: [
    { key: "validate-approved-packaging", kind: "WORKER", capability: "approved-packaging-validation", dependsOn: [], maxAttempts: 2, retryBaseSeconds: 5 },
    { key: "draft-video-release", kind: "WORKER", capability: "video-release-synthesis", dependsOn: ["validate-approved-packaging"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "initial-video-release-qa", kind: "WORKER", capability: "independent-video-release-qa", dependsOn: ["draft-video-release"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "bounded-video-release-revision", kind: "WORKER", capability: "video-release-revision", dependsOn: ["initial-video-release-qa"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "final-video-release-qa", kind: "WORKER", capability: "independent-video-release-qa", dependsOn: ["bounded-video-release-revision"], maxAttempts: 2, retryBaseSeconds: 10 },
    { key: "finalize-video-release", kind: "WORKER", capability: "video-release-finalizer", dependsOn: ["final-video-release-qa"], maxAttempts: 1, retryBaseSeconds: 0 },
    { key: "review-video-release", kind: "APPROVAL", capability: "human", dependsOn: ["finalize-video-release"], maxAttempts: 1, retryBaseSeconds: 0 },
  ],
};

const registry = new Map<string, WorkflowDefinition>([
  [`${channelConceptValidationDefinition.type}:${channelConceptValidationDefinition.version}`, channelConceptValidationDefinition],
  [`${channelResearchDefinition.type}:${channelResearchDefinition.version}`, channelResearchDefinition],
  [`${channelStrategyDefinition.type}:${channelStrategyDefinition.version}`, channelStrategyDefinition],
  [`${channelContentIntelligenceDefinition.type}:${channelContentIntelligenceDefinition.version}`, channelContentIntelligenceDefinition],
  [`${channelVideoBriefDefinition.type}:${channelVideoBriefDefinition.version}`, channelVideoBriefDefinition],
  [`${channelVideoScriptDefinition.type}:${channelVideoScriptDefinition.version}`, channelVideoScriptDefinition],
  [`${channelVideoPackagingDefinition.type}:${channelVideoPackagingDefinition.version}`, channelVideoPackagingDefinition],
  [`${channelVideoReleaseDefinition.type}:${channelVideoReleaseDefinition.version}`, channelVideoReleaseDefinition],
]);

/** Canonical finalizer per workflow type; its output becomes the run's durable `output_payload`. */
export const WORKFLOW_FINALIZER_STEP: Record<ProductionWorkflowType, string> = {
  CHANNEL_CONCEPT_VALIDATION: "synthesize-validation",
  CHANNEL_RESEARCH: "synthesize-validation",
  CHANNEL_STRATEGY: "finalize-strategy",
  CHANNEL_CONTENT_INTELLIGENCE: "finalize-content-intelligence",
  CHANNEL_VIDEO_BRIEF: "finalize-video-brief",
  CHANNEL_VIDEO_SCRIPT: "finalize-video-script",
  CHANNEL_VIDEO_PACKAGING: "finalize-video-packaging",
  CHANNEL_VIDEO_RELEASE: "finalize-video-release",
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
