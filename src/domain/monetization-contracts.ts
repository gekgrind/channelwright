import { z } from "zod";

export const monetizationStreamReportSchema = z.object({
  stream: z.enum(["YOUTUBE_ADVERTISING", "SPONSORSHIPS", "AFFILIATES", "FREE_TO_PAID_PRODUCT", "MEMBERSHIP_COMMUNITY", "SERVICES_CONSULTING", "LICENSING", "COURSES_WORKSHOPS", "NEWSLETTER_SPONSORSHIP", "MERCHANDISING", "LEAD_GENERATION", "PARTNERSHIPS", "CONTENT_SYNDICATION", "OTHER"]),
  channelFit: z.enum(["HIGH", "MEDIUM", "LOW", "NOT_RECOMMENDED"]),
  verifiedFacts: z.array(z.string()), assumptionsAndEstimates: z.array(z.string()),
  eligibilityDependencies: z.array(z.string()), timeToFirstRevenue: z.string(), setupEffort: z.enum(["LOW", "MEDIUM", "HIGH"]),
  ongoingEffort: z.enum(["LOW", "MEDIUM", "HIGH"]), marginCharacteristics: z.string(),
  reputationAndPlatformRisk: z.array(z.string()), requiredIntegrations: z.array(z.string()), recommendedTiming: z.string(),
  priority: z.number().int().positive(), nextActions: z.array(z.string()).min(1), metrics: z.array(z.string()).min(1),
});

export const monetizationPlanSchema = z.object({
  executiveSummary: z.string().min(20), streams: z.array(monetizationStreamReportSchema).min(10),
  rankingMethod: z.string().min(20), contradictions: z.array(z.string()), unknowns: z.array(z.string()).min(1),
  sourceProvenance: z.array(z.object({ title: z.string(), url: z.string().url(), accessedAt: z.string().datetime(), fixture: z.boolean(), supports: z.array(z.string()) })).min(1),
  fixture: z.boolean(),
});

export const monetizationQaSchema = z.object({
  verdict: z.enum(["PASS", "REVISE"]), checkedAt: z.string().datetime(),
  findings: z.array(z.object({ severity: z.enum(["INFO", "WARNING", "BLOCKER"]), category: z.string(), message: z.string() })), summary: z.string(),
});

export type MonetizationPlan = z.infer<typeof monetizationPlanSchema>;
export type MonetizationQa = z.infer<typeof monetizationQaSchema>;
