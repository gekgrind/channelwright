import { z } from "zod";

export const conceptModeSchema = z.enum(["USER_DEFINED", "AGENT_DISCOVERED", "REFERENCE_CHANNEL"]);
export const recommendationSchema = z.enum(["GO", "CAUTION", "STOP_RECOMMENDED"]);
export const hardGateStatusSchema = z.enum(["YES", "WEAK", "NO"]);
export const strategicGateStatusSchema = z.enum(["STRONG", "MODERATE", "WEAK"]);

export const channelStateSchema = z.enum([
  "DRAFT",
  "CONCEPT_RESEARCH_PENDING",
  "CONCEPT_REVIEW_REQUIRED",
  "CONCEPT_DISCOVERY_PENDING",
  "CONCEPT_SELECTION_REQUIRED",
  "REFERENCE_CHANNEL_RESEARCH_PENDING",
  "REFERENCE_CHANNEL_REVIEW_REQUIRED",
  "CONCEPT_ACCEPTED",
  "CHANNEL_STRATEGY_PENDING",
  "BUSINESS_STRATEGY_REVIEW_REQUIRED",
  "READY_FOR_VIDEO_PRODUCTION",
  "FAILED",
]);

export const videoStateSchema = z.enum([
  "DRAFT",
  "STRATEGY_PENDING",
  "RESEARCH_PENDING",
  "SCRIPT_PENDING",
  "SCRIPT_QA_PENDING",
  "SCRIPT_REVIEW_REQUIRED",
  "SCRIPT_APPROVED",
  "FAILED",
  "CANCELLED",
]);

export const distributionTargetsSchema = z.object({
  youtube: z.literal(true).default(true),
  tiktok: z.boolean().default(false),
  instagramFacebookReels: z.boolean().default(false),
});

export const youtubeOnlyDistributionTargets = {
  youtube: true,
  tiktok: false,
  instagramFacebookReels: false,
} as const;

export const channelPreferencesSchema = z.object({
  name: z.string().trim().min(2).max(80),
  niche: z.string().trim().min(2).max(160),
  targetAudience: z.string().trim().max(240).default("Curious general viewers"),
  videoStyle: z.string().trim().max(120).default("Narrated visual documentary"),
  preferredVoice: z.string().trim().max(80).default("Warm, authoritative"),
  targetDurationMinutes: z.number().int().min(3).max(120).default(10),
  postingFrequency: z.string().trim().max(80).default("Weekly"),
  monetizationGoal: z.string().trim().max(160).default("Ads and aligned sponsorships"),
  language: z.string().trim().max(40).default("English"),
  productionComplexity: z.enum(["LEAN", "BALANCED", "PREMIUM"]).default("BALANCED"),
  distributionTargets: distributionTargetsSchema.default(youtubeOnlyDistributionTargets),
});

export const sourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  accessedAt: z.string().datetime(),
  supports: z.array(z.string()).min(1),
});

export const conceptResearchSchema = z.object({
  summary: z.string().min(20),
  demandSignals: z.array(z.string()),
  comparableChannels: z.array(z.string()),
  contentAngles: z.array(z.string()),
  monetizationPaths: z.array(z.string()),
  risks: z.array(z.string()),
  sources: z.array(sourceSchema),
  fixture: z.boolean(),
  researchedAt: z.string().datetime(),
});

const scoredGate = <T extends z.ZodTypeAny>(status: T) =>
  z.object({ status, score: z.number().int().min(0).max(100), evidence: z.array(z.string()).min(1) });

export const viabilityReportSchema = z.object({
  recommendation: recommendationSchema,
  overallScore: z.number().int().min(0).max(100),
  gates: z.object({
    contentRunway: scoredGate(hardGateStatusSchema),
    audienceDemand: scoredGate(hardGateStatusSchema),
    monetization: scoredGate(hardGateStatusSchema),
    differentiation: scoredGate(strategicGateStatusSchema),
    productionEconomics: scoredGate(strategicGateStatusSchema),
  }),
  scores: z.object({
    audienceDemand: z.number().int().min(0).max(100),
    competition: z.number().int().min(0).max(100),
    monetization: z.number().int().min(0).max(100),
    contentDepth: z.number().int().min(0).max(100),
    productionFeasibility: z.number().int().min(0).max(100),
    differentiationPotential: z.number().int().min(0).max(100),
    trendStability: z.number().int().min(0).max(100),
  }),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),
  findings: z.array(z.string()),
  repairable: z.boolean(),
  recommendedChanges: z.array(z.string()),
  revisedConceptExamples: z.array(z.string()),
  summary: z.string().min(20),
  modelVersion: z.string(),
}).superRefine((report, context) => {
  if (report.recommendation !== "GO") return;
  const hardGates = [report.gates.contentRunway, report.gates.audienceDemand, report.gates.monetization];
  if (hardGates.some((gate) => gate.status !== "YES")) {
    context.addIssue({ code: "custom", path: ["recommendation"], message: "GO requires YES on all three hard viability gates" });
  }
});

export const conceptCandidateSchema = z.object({
  id: z.string().uuid(),
  concept: z.string().min(10),
  niche: z.string().min(2),
  promise: z.string().min(10),
  viability: viabilityReportSchema,
});

export const channelStrategySchema = z.object({
  positioning: z.string(),
  targetViewer: z.string(),
  channelPromise: z.string(),
  differentiation: z.string(),
  contentPillars: z.array(z.string()).min(3),
  videoFormats: z.array(z.string()).min(2),
  visualStyle: z.string(),
  narrationStyle: z.string(),
  monetizationApproaches: z.array(z.string()),
  recurringSeries: z.array(z.string()).min(2),
  riskNotes: z.array(z.string()),
});

export const contentStrategySchema = z.object({
  targetViewer: z.string(),
  viewerProblem: z.string(),
  angle: z.string(),
  viewerPromise: z.string(),
  thesis: z.string(),
  emotionalDriver: z.string(),
  hook: z.string(),
  sections: z.array(z.string()).min(3),
  monetizationOpportunity: z.string(),
  risks: z.array(z.string()),
});

export const videoResearchSchema = z.object({
  topic: z.string(),
  thesis: z.string(),
  summary: z.string(),
  claims: z.array(z.object({ id: z.string(), claim: z.string(), sourceIds: z.array(z.string()), confidence: z.number().min(0).max(1) })),
  sources: z.array(sourceSchema),
  contradictions: z.array(z.string()),
  unknowns: z.array(z.string()),
  copyrightConcerns: z.array(z.string()),
});

export const scriptSchema = z.object({
  version: z.number().int().positive(),
  title: z.string(),
  hook: z.string(),
  sections: z.array(z.object({ heading: z.string(), purpose: z.string(), narration: z.string(), claimRefs: z.array(z.string()), estimatedSeconds: z.number().positive() })).min(3),
  cta: z.string(),
  outro: z.string(),
  estimatedSeconds: z.number().positive(),
});

export const scriptQaSchema = z.object({
  verdict: z.enum(["PASS", "REVISE"]),
  scores: z.object({ factualSupport: z.number(), hook: z.number(), pacing: z.number(), originality: z.number(), channelFit: z.number() }),
  findings: z.array(z.object({ severity: z.enum(["INFO", "WARNING", "BLOCKER"]), category: z.string(), message: z.string() })),
  summary: z.string(),
});

export const platformTargetSchema = z.enum(["TIKTOK", "INSTAGRAM_FACEBOOK_REELS"]);
export const platformArtifactStatusSchema = z.enum(["GENERATING", "QA_REQUIRED", "REVIEW_REQUIRED", "APPROVED", "FAILED"]);
export const platformQaSchema = z.object({
  verdict: z.enum(["PASS", "REVISE"]),
  checkedAt: z.string().datetime(),
  findings: z.array(z.object({
    severity: z.enum(["INFO", "WARNING", "BLOCKER"]),
    category: z.string().min(1),
    message: z.string().min(1),
  })),
  summary: z.string().min(1),
});

const captionCueSchema = z.object({
  startSeconds: z.number().min(0),
  endSeconds: z.number().positive(),
  text: z.string().min(1),
}).refine((cue) => cue.endSeconds > cue.startSeconds, { message: "Caption cue must end after it starts" });

const shortFormPackageFields = {
  variantId: z.string().uuid(),
  artifactVersion: z.number().int().positive(),
  sourceScriptVersion: z.number().int().positive(),
  sourceMasterVersion: z.string().nullable(),
  intendedAudience: z.string().min(1),
  contentAngle: z.string().min(1),
  targetDurationSeconds: z.number().int().positive(),
  aspectRatio: z.literal("9:16"),
  hook: z.string().min(1),
  condensedNarration: z.array(z.string().min(1)).min(2),
  selectedSegments: z.array(z.object({ sourceSection: z.string().min(1), purpose: z.string().min(1) })).min(1),
  onScreenText: z.array(z.string().min(1)).min(1),
  captionCues: z.array(captionCueSchema).min(1),
  visualInstructions: z.array(z.string().min(1)).min(1),
  pacingNotes: z.array(z.string().min(1)).min(1),
  audioGuidance: z.array(z.string().min(1)).min(1),
  coverText: z.string().min(1),
  discoverabilityTerms: z.array(z.string().min(1)).min(1),
  callToAction: z.string().min(1),
  claimReferences: z.array(z.string()).min(1),
  warnings: z.array(z.string()),
  publicationBlockers: z.array(z.string()).min(1),
  fixture: z.literal(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const tiktokPackageSchema = z.object({
  ...shortFormPackageFields,
  target: z.literal("TIKTOK"),
  platformCaption: z.string().min(1),
  hashtags: z.array(z.string().startsWith("#")).min(1),
  patternInterrupts: z.array(z.string().min(1)).min(1),
});

export const reelsPackageSchema = z.object({
  ...shortFormPackageFields,
  target: z.literal("INSTAGRAM_FACEBOOK_REELS"),
  instagramCaption: z.string().min(1),
  instagramCallToAction: z.string().min(1),
  facebookCaption: z.string().min(1),
  facebookCallToAction: z.string().min(1),
  safeZoneGuidance: z.array(z.string().min(1)).min(1),
});

export const platformPackageSchema = z.discriminatedUnion("target", [tiktokPackageSchema, reelsPackageSchema]);

export type ConceptMode = z.infer<typeof conceptModeSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type ChannelState = z.infer<typeof channelStateSchema>;
export type VideoState = z.infer<typeof videoStateSchema>;
export type ChannelPreferences = z.infer<typeof channelPreferencesSchema>;
export type ConceptResearch = z.infer<typeof conceptResearchSchema>;
export type ViabilityReport = z.infer<typeof viabilityReportSchema>;
export type ConceptCandidate = z.infer<typeof conceptCandidateSchema>;
export type ChannelStrategy = z.infer<typeof channelStrategySchema>;
export type ContentStrategy = z.infer<typeof contentStrategySchema>;
export type VideoResearch = z.infer<typeof videoResearchSchema>;
export type Script = z.infer<typeof scriptSchema>;
export type ScriptQa = z.infer<typeof scriptQaSchema>;
export type DistributionTargets = z.infer<typeof distributionTargetsSchema>;
export type PlatformTarget = z.infer<typeof platformTargetSchema>;
export type PlatformArtifactStatus = z.infer<typeof platformArtifactStatusSchema>;
export type PlatformQa = z.infer<typeof platformQaSchema>;
export type TikTokPackage = z.infer<typeof tiktokPackageSchema>;
export type ReelsPackage = z.infer<typeof reelsPackageSchema>;
export type PlatformPackage = z.infer<typeof platformPackageSchema>;
