import { z } from "zod";

export const buildProjectStateSchema = z.enum(["DRAFT", "SPEC_REVIEW", "BUILDING", "QA", "USER_REVIEW", "APPROVED", "DEPLOYMENT_BLOCKED", "READY_TO_DEPLOY", "DEPLOYED"]);

export const buildSpecificationSchema = z.object({
  projectType: z.enum(["FREE_RESOURCE", "PAID_PRODUCT"]),
  name: z.string().min(2), promise: z.string().min(10), audience: z.string().min(3), format: z.string().min(2),
  frontend: z.array(z.string()).min(1), backend: z.array(z.string()).min(1), database: z.array(z.string()),
  authentication: z.array(z.string()), storage: z.array(z.string()), administration: z.array(z.string()).min(1),
  tests: z.array(z.string()).min(2), setupAndDeployment: z.array(z.string()).min(2),
  approvedTemplates: z.array(z.string()).min(1), dependencyAllowlist: z.array(z.string()),
  resourceLimits: z.object({ maxFiles: z.number().int().positive(), maxBytes: z.number().int().positive(), maxBuildSeconds: z.number().int().positive() }),
  securityControls: z.array(z.string()).min(4), deploymentBlockers: z.array(z.string()).min(1), fixture: z.boolean(),
});

export const fileManifestEntrySchema = z.object({
  path: z.string().min(1).max(240).refine((value) => !value.startsWith("/") && !value.includes(".."), "Manifest paths must stay inside the isolated workspace"),
  kind: z.enum(["FRONTEND", "BACKEND", "DATABASE", "TEST", "DOCUMENTATION", "RESOURCE"]),
  templateId: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative(),
});

const pagePreviewSchema = z.object({
  headline: z.string().min(5), body: z.string().min(10), benefits: z.array(z.string()).min(2),
  formLabel: z.string().optional(), callToAction: z.string().min(2), consentLanguage: z.string().optional(),
  states: z.array(z.enum(["EMPTY", "LOADING", "SUCCESS", "DUPLICATE", "FAILURE"])).min(1),
});

export const buildArtifactSchema = z.object({
  artifactKind: z.enum(["RESOURCE_AND_FUNNEL", "PAID_PRODUCT_APPLICATION"]),
  fileManifest: z.array(fileManifestEntrySchema).min(4),
  resourcePreview: z.object({ title: z.string(), format: z.string(), summary: z.string(), accessMode: z.enum(["SIGNED_LINK", "AUTHENTICATED"]), objectReference: z.string().nullable() }),
  pages: z.object({ optIn: pagePreviewSchema, thankYou: pagePreviewSchema, resourceAccess: pagePreviewSchema }),
  backendPlan: z.object({ validation: z.array(z.string()), ownerScoping: z.array(z.string()), abuseProtection: z.array(z.string()), duplicateHandling: z.string(), delivery: z.array(z.string()), auditEvents: z.array(z.string()) }),
  productPreview: z.object({ transformation: z.string(), minimumViableScope: z.array(z.string()), features: z.array(z.string()), accessMode: z.literal("ENTITLEMENT_REQUIRED") }).optional(),
  commercePlan: z.object({ providerNeutralBoundary: z.boolean(), checkout: z.array(z.string()), webhookVerification: z.array(z.string()), fulfillment: z.array(z.string()), refundsAndRevocation: z.array(z.string()) }).optional(),
  databasePlan: z.array(z.string()), adminControls: z.array(z.string()), tests: z.array(z.string()).min(2),
  setupDocumentation: z.array(z.string()).min(2), previewReference: z.string(), fixture: z.boolean(),
  executionEvidence: z.object({
    mode: z.enum(["FIXTURE_CONTRACT", "EXECUTED"]),
    isolatedWorkspace: z.enum(["NOT_RUN", "PASSED", "FAILED"]), dependencyAllowlist: z.enum(["NOT_RUN", "PASSED", "FAILED"]),
    secretScan: z.enum(["NOT_RUN", "PASSED", "FAILED"]), staticAnalysis: z.enum(["NOT_RUN", "PASSED", "FAILED"]),
    tests: z.enum(["NOT_RUN", "PASSED", "FAILED"]), resourceLimits: z.enum(["NOT_RUN", "PASSED", "FAILED"]),
  }),
  deploymentBlockers: z.array(z.string()).min(1),
});

export const buildQaSchema = z.object({
  verdict: z.enum(["PASS", "REVISE"]), checkedAt: z.string().datetime(),
  findings: z.array(z.object({ severity: z.enum(["INFO", "WARNING", "BLOCKER"]), category: z.string(), message: z.string() })), summary: z.string(),
});

export type BuildProjectState = z.infer<typeof buildProjectStateSchema>;
export type BuildSpecification = z.infer<typeof buildSpecificationSchema>;
export type BuildArtifact = z.infer<typeof buildArtifactSchema>;
export type BuildQa = z.infer<typeof buildQaSchema>;
