import { z } from "zod";

export const buildComplexitySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const brandSystemSchema = z.object({
  name: z.string().min(2),
  colors: z.array(z.object({ name: z.string(), hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/), use: z.string() })).min(3),
  typography: z.object({ display: z.string(), body: z.string(), utility: z.string() }),
  spacing: z.array(z.number().int().positive()).min(3),
  voice: z.array(z.string()).min(2),
  imageryGuidance: z.array(z.string()).min(2),
  reusableComponents: z.array(z.string()).min(3),
  originalityNotes: z.array(z.string()).min(2),
});

export const pillarVideoPlanSchema = z.object({
  title: z.string().min(5),
  coreViewerProblem: z.string().min(10),
  highValuePromise: z.string().min(10),
  originalThesis: z.string().min(10),
  searchAndDiscoveryIntent: z.array(z.string()).min(2),
  titleDirections: z.array(z.string()).min(2),
  thumbnailDirections: z.array(z.string()).min(2),
  openingHook: z.string().min(10),
  narrativeStructure: z.array(z.string()).min(4),
  evidenceRequirements: z.array(z.string()).min(2),
  ctaPlacement: z.array(z.string()).min(2),
  freeResourceConnection: z.string().min(10),
  paidProductConnection: z.string().min(10),
  repurposingOpportunities: z.array(z.string()).min(2),
  successMetrics: z.array(z.string()).min(2),
});

export const freeResourceOptionSchema = z.object({
  id: z.string().uuid(), name: z.string().min(2), promise: z.string().min(10), intendedAudience: z.string().min(3),
  problemSolved: z.string().min(10), format: z.string().min(2), whyItFits: z.string().min(10),
  pillarVideoConnection: z.string().min(10), buildComplexity: buildComplexitySchema,
  frontendBehavior: z.array(z.string()).min(1), backendBehavior: z.array(z.string()).min(1),
  deliveryMethod: z.string().min(5), ctaExamples: z.array(z.string()).min(2),
  transitionToPaid: z.string().min(10), risksAndMaintenance: z.array(z.string()),
});

export const paidProductOptionSchema = z.object({
  id: z.string().uuid(), name: z.string().min(2), transformation: z.string().min(10), idealCustomer: z.string().min(3),
  problem: z.string().min(10), desiredOutcome: z.string().min(10), format: z.string().min(2), minimumViableScope: z.array(z.string()).min(2),
  featuresAndContent: z.array(z.string()).min(2), pricingHypotheses: z.array(z.string()).min(1), validationPlan: z.array(z.string()).min(2),
  freeResourceRelationship: z.string().min(10), requirements: z.object({ frontend: z.array(z.string()), backend: z.array(z.string()), authentication: z.array(z.string()), storage: z.array(z.string()), payments: z.array(z.string()), fulfillment: z.array(z.string()), support: z.array(z.string()) }),
  deliveryAndRefundConsiderations: z.array(z.string()).min(2), expansionOpportunities: z.array(z.string()),
  buildComplexity: buildComplexitySchema, risks: z.array(z.string()), dependencies: z.array(z.string()),
});

export const monetizationStreamSchema = z.object({
  stream: z.string().min(2), factBasis: z.array(z.string()), assumptions: z.array(z.string()),
  fit: z.enum(["HIGH", "MEDIUM", "LOW"]), timing: z.string(), priority: z.number().int().positive(),
});

export const businessStrategySchema = z.object({
  connectedJourney: z.object({
    youtubeContent: z.string().min(5), pillarVideo: z.string().min(5), freeResourceOptIn: z.string().min(5),
    resourceDelivery: z.string().min(5), paidProductOffer: z.string().min(5), additionalMonetization: z.string().min(5),
  }),
  brandSystem: brandSystemSchema,
  pillarVideo: pillarVideoPlanSchema,
  freeResourceOptions: z.array(freeResourceOptionSchema).min(2),
  paidProductOptions: z.array(paidProductOptionSchema).min(2),
  monetizationOverview: z.array(monetizationStreamSchema).min(3),
  originalityRules: z.array(z.string()).min(2),
  fixture: z.boolean(),
});

export const businessStrategyQaSchema = z.object({
  verdict: z.enum(["PASS", "REVISE"]), checkedAt: z.string().datetime(),
  findings: z.array(z.object({ severity: z.enum(["INFO", "WARNING", "BLOCKER"]), category: z.string(), message: z.string() })),
  summary: z.string().min(1),
});

export const offerTypeSchema = z.enum(["FREE_RESOURCE", "PAID_PRODUCT"]);

export type BusinessStrategy = z.infer<typeof businessStrategySchema>;
export type BusinessStrategyQa = z.infer<typeof businessStrategyQaSchema>;
export type FreeResourceOption = z.infer<typeof freeResourceOptionSchema>;
export type PaidProductOption = z.infer<typeof paidProductOptionSchema>;
export type OfferType = z.infer<typeof offerTypeSchema>;
