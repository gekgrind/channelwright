import { z } from "zod";

export const referenceChannelRequestSchema = z.object({
  url: z.string().trim().url().max(500),
  likedAspects: z.string().trim().max(1000).optional(),
  restrictions: z.string().trim().max(1000).optional(),
});

export const referenceSourceKindSchema = z.enum(["HANDLE", "CHANNEL_ID", "CUSTOM_PATH", "USER_PATH"]);

export const referenceChannelSourceSchema = z.object({
  id: z.string().uuid(),
  inputUrl: z.string().url(),
  canonicalUrl: z.string().url(),
  stableChannelId: z.string().min(3).max(160),
  sourceKind: referenceSourceKindSchema,
  lookupValue: z.string().min(1).max(160),
  title: z.string().min(1).max(200),
  handle: z.string().max(160).nullable(),
  provider: z.string().min(1),
  fixture: z.boolean(),
  resolvedAt: z.string().datetime(),
  accessWarnings: z.array(z.string()),
});

export const evidenceConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]);

export const researchProvenanceSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  provider: z.string().min(1),
  accessedAt: z.string().datetime(),
  fixture: z.boolean(),
  supports: z.array(z.string()).min(1),
  confidence: evidenceConfidenceSchema,
});

const evidenceItemSchema = z.object({
  finding: z.string().min(1),
  evidence: z.array(z.string()).min(1),
  confidence: evidenceConfidenceSchema,
});

const candidateSchema = z.object({
  name: z.string().min(1),
  promise: z.string().min(1),
  audience: z.string().min(1),
  rationale: z.string().min(1),
  complexity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  risks: z.array(z.string()),
});

export const referenceChannelReportSchema = z.object({
  sourceIdentity: z.object({
    stableChannelId: z.string().min(3),
    title: z.string().min(1),
    canonicalUrl: z.string().url(),
    handle: z.string().nullable(),
  }),
  researchDate: z.string().datetime(),
  dataSources: z.array(researchProvenanceSchema).min(1),
  publiclyObservablePositioning: z.string().min(20),
  likelyAudience: z.object({ description: z.string().min(10), problems: z.array(z.string()).min(1), confidence: evidenceConfidenceSchema }),
  recurringTopics: z.array(evidenceItemSchema).min(1),
  contentClusters: z.array(z.string()).min(1),
  videoFormats: z.array(evidenceItemSchema).min(1),
  approximateCadence: z.object({ description: z.string().min(1), confidence: evidenceConfidenceSchema, evidence: z.array(z.string()).min(1) }),
  observedPatterns: z.object({
    titles: z.array(z.string()), hooks: z.array(z.string()), thumbnails: z.array(z.string()),
    structures: z.array(z.string()), callsToAction: z.array(z.string()),
  }),
  notableVideos: z.array(z.object({ title: z.string(), url: z.string().url(), role: z.enum(["HIGH_PERFORMING", "REPRESENTATIVE"]), publicSignals: z.array(z.string()), confidence: evidenceConfidenceSchema })),
  demandSignals: z.array(evidenceItemSchema),
  contentRunway: z.array(z.string()).min(3),
  visibleMonetizationSignals: z.array(evidenceItemSchema),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  risks: z.array(z.string()),
  marketGaps: z.array(z.string()),
  opportunities: z.array(z.string()),
  originalDifferentiationRecommendations: z.array(z.string()).min(2),
  mustNotCopy: z.array(z.string()).min(2),
  proposedOriginalConcept: z.object({ name: z.string().min(2), positioning: z.string().min(20), valueProposition: z.string().min(20) }),
  brandDirection: z.object({
    direction: z.string().min(10),
    colors: z.array(z.object({ name: z.string(), hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/), use: z.string() })).min(3),
    typography: z.object({ display: z.string(), body: z.string() }),
    spacing: z.array(z.number().int().positive()).min(3),
    voice: z.array(z.string()).min(2),
    imageryGuidance: z.array(z.string()).min(2),
  }),
  pillarVideoCandidates: z.array(candidateSchema.extend({ thesis: z.string().min(10) })).min(2),
  freeResourceCandidates: z.array(candidateSchema.extend({ format: z.string(), deliveryMethod: z.string(), transitionToPaid: z.string() })).min(2),
  paidProductCandidates: z.array(candidateSchema.extend({ format: z.string(), pricingHypothesis: z.string(), validationPlan: z.string() })).min(2),
  potentialRevenueStreams: z.array(z.object({ stream: z.string(), evidence: z.array(z.string()), assumptions: z.array(z.string()) })).min(2),
  citations: z.array(z.object({ claim: z.string(), sourceIds: z.array(z.string()).min(1) })),
  contradictions: z.array(z.string()),
  unknowns: z.array(z.string()).min(1),
  incompleteDataWarnings: z.array(z.string()).min(1),
  fixture: z.boolean(),
});

export const referenceReportQaSchema = z.object({
  verdict: z.enum(["PASS", "REVISE"]),
  checkedAt: z.string().datetime(),
  findings: z.array(z.object({ severity: z.enum(["INFO", "WARNING", "BLOCKER"]), category: z.string(), message: z.string() })),
  summary: z.string().min(1),
});

export const referenceReportSectionSchema = z.enum([
  "POSITIONING", "AUDIENCE", "TOPICS", "PATTERNS", "DEMAND", "MONETIZATION", "DIFFERENTIATION",
  "ORIGINAL_CONCEPT", "BRAND", "PILLAR_VIDEOS", "FREE_RESOURCES", "PAID_PRODUCTS", "REVENUE_STREAMS",
]);

export type ReferenceChannelRequest = z.infer<typeof referenceChannelRequestSchema>;
export type ReferenceChannelSource = z.infer<typeof referenceChannelSourceSchema>;
export type ReferenceChannelReport = z.infer<typeof referenceChannelReportSchema>;
export type ReferenceReportQa = z.infer<typeof referenceReportQaSchema>;
export type ReferenceReportSection = z.infer<typeof referenceReportSectionSchema>;
