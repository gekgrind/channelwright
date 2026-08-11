import { createHash } from "node:crypto";
import type { FreeResourceOption, PaidProductOption } from "@/domain/strategy-contracts";
import { buildArtifactSchema, buildQaSchema, buildSpecificationSchema, type BuildArtifact, type BuildQa, type BuildSpecification } from "@/domain/build-contracts";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function createResourceBuildSpecification(option: FreeResourceOption): BuildSpecification {
  return buildSpecificationSchema.parse({
    projectType: "FREE_RESOURCE", name: option.name, promise: option.promise, audience: option.intendedAudience, format: option.format,
    frontend: [...option.frontendBehavior, "Opt-in landing page", "Thank-you and secure resource-access states"],
    backend: [...option.backendBehavior, "Server-side input validation", "Duplicate-safe consent and delivery records"],
    database: ["Owner/channel-scoped subscribers", "Append-only consent events", "Retryable delivery events"],
    authentication: option.deliveryMethod.toLowerCase().includes("authenticated") ? ["Authenticated resource access"] : ["Expiring signed resource-access token"],
    storage: ["Durable object reference and metadata; no binary JSON payload"], administration: ["Owner-scoped subscriber and delivery status view", "Delivery revocation control"],
    tests: ["Cross-owner build access rejection", "Email validation and duplicate handling", "Expired/revoked access denial", "Fixture/live labeling"],
    setupAndDeployment: ["Provider and object-storage environment checklist", "Rollback creates a new immutable version"],
    approvedTemplates: ["cw-resource-shell-v1", "cw-opt-in-funnel-v1", "cw-secure-delivery-v1"],
    dependencyAllowlist: ["next", "react", "zod", "@supabase/supabase-js"],
    resourceLimits: { maxFiles: 40, maxBytes: 2_000_000, maxBuildSeconds: 120 },
    securityControls: ["Isolated build workspace", "Dependency allowlist", "Secret scan", "Static analysis", "Sanitized preview content", "Server-only provider credentials", "Rate-limit and bot-protection boundary"],
    deploymentBlockers: ["No live object storage, email provider, public rate limiter, bot defense, or production repository is configured and tested"], fixture: true,
  });
}

export function reviseBuildSpecification(specification: BuildSpecification, feedback: string): BuildSpecification {
  const next = structuredClone(specification);
  next.frontend.push(`User revision: ${feedback}`);
  return buildSpecificationSchema.parse(next);
}

export function createPaidProductBuildSpecification(option: PaidProductOption): BuildSpecification {
  return buildSpecificationSchema.parse({
    projectType: "PAID_PRODUCT", name: option.name, promise: option.transformation, audience: option.idealCustomer, format: option.format,
    frontend: [...option.requirements.frontend, "Sales and checkout initiation", "Entitlement-gated product workspace", "Customer account and access status"],
    backend: [...option.requirements.backend, "Provider-neutral checkout adapter", "Verified webhook event ingestion", "Idempotent entitlement fulfillment", "Refund and revocation handling"],
    database: ["Products and prices", "Purchases and verified commerce events", "Customer entitlements", ...option.requirements.storage],
    authentication: option.requirements.authentication.length ? option.requirements.authentication : ["Customer identity required for product access"],
    storage: option.requirements.storage, administration: ["Product and price status", "Purchase and entitlement audit view", ...option.requirements.support],
    tests: ["Browser redirect cannot grant entitlement", "Duplicate webhook fulfillment is idempotent", "Refund revokes access", "Cross-owner commerce access is rejected"],
    setupAndDeployment: ["Payment-provider webhook and secret checklist", "Customer support and refund procedure", "Rollback creates a new artifact version"],
    approvedTemplates: ["cw-product-shell-v1", "cw-commerce-adapter-v1", "cw-entitlement-gate-v1"], dependencyAllowlist: ["next", "react", "zod", "@supabase/supabase-js"],
    resourceLimits: { maxFiles: 80, maxBytes: 4_000_000, maxBuildSeconds: 180 },
    securityControls: ["Isolated build workspace", "Dependency allowlist", "Secret scan", "Static analysis", "Server-only payment secrets", "Verified signed webhooks", "Idempotent fulfillment", "Entitlement required for access"],
    deploymentBlockers: ["No live payment provider, verified webhook endpoint, customer authentication, object storage, or production repository is configured and tested"], fixture: true,
  });
}

export function createResourceBuildArtifact(specification: BuildSpecification, projectId: string, version: number, feedback?: string): BuildArtifact {
  const files = [
    ["app/resource/page.tsx", "FRONTEND", "cw-resource-shell-v1", 4200],
    ["app/opt-in/page.tsx", "FRONTEND", "cw-opt-in-funnel-v1", 5100],
    ["app/thank-you/page.tsx", "FRONTEND", "cw-opt-in-funnel-v1", 3600],
    ["app/api/subscribe/route.ts", "BACKEND", "cw-secure-delivery-v1", 4800],
    ["supabase/resource-schema.sql", "DATABASE", "cw-secure-delivery-v1", 3900],
    ["tests/funnel.test.ts", "TEST", "cw-opt-in-funnel-v1", 4400],
    ["README-deployment.md", "DOCUMENTATION", "cw-resource-shell-v1", 2800],
    ["resource/content.json", "RESOURCE", "cw-resource-shell-v1", 6200],
  ] as const;
  const revision = feedback ? ` Revision direction: ${feedback}` : "";
  return buildArtifactSchema.parse({
    artifactKind: "RESOURCE_AND_FUNNEL",
    fileManifest: files.map(([path, kind, templateId, bytes]) => ({ path, kind, templateId, bytes, sha256: digest(`${projectId}:${version}:${path}:${revision}`) })),
    resourcePreview: { title: specification.name, format: specification.format, summary: `${specification.promise}.${revision}`, accessMode: specification.authentication.some((item) => item.toLowerCase().includes("authenticated")) ? "AUTHENTICATED" : "SIGNED_LINK", objectReference: null },
    pages: {
      optIn: { headline: specification.promise, body: `Use the ${specification.name} to make one clearer next decision.`, benefits: ["Apply the Pillar Video framework", "Keep a useful result even if you never buy anything"], formLabel: "Email address", callToAction: "Get secure access", consentLanguage: "Send me this resource and the delivery email. I can unsubscribe at any time.", states: ["EMPTY", "LOADING", "SUCCESS", "DUPLICATE", "FAILURE"] },
      thankYou: { headline: "Your resource is ready", body: "Your signup was recorded without exposing subscriber data. Use the secure access action below.", benefits: ["Access the resource now", "Keep the delivery email as a backup"], callToAction: "Open the resource", states: ["SUCCESS", "FAILURE"] },
      resourceAccess: { headline: specification.name, body: specification.promise, benefits: ["Private, scoped access", "Versioned content and clear provenance"], callToAction: "Start the resource", states: ["LOADING", "SUCCESS", "FAILURE"] },
    },
    backendPlan: {
      validation: ["Normalize and validate email server-side", "Reject oversized or malformed input"],
      ownerScoping: ["Resolve owner and channel from the immutable build project", "Never accept owner identifiers from public form data"],
      abuseProtection: ["Per-IP and per-build rate limits", "Bot-challenge adapter", "Uniform duplicate response"],
      duplicateHandling: "Upsert the normalized channel-scoped email and append consent/delivery events idempotently",
      delivery: ["Hash expiring delivery tokens at rest", "Use signed object URLs or authenticated access", "Keep email-provider credentials server-only"],
      auditEvents: ["SUBSCRIBER_CAPTURED", "CONSENT_RECORDED", "DELIVERY_QUEUED", "DELIVERY_FAILED", "RESOURCE_ACCESSED", "ACCESS_REVOKED"],
    },
    databasePlan: specification.database, adminControls: specification.administration, tests: specification.tests,
    setupDocumentation: specification.setupAndDeployment, previewReference: `fixture-preview://${projectId}/v${version}`,
    fixture: true,
    executionEvidence: { mode: "FIXTURE_CONTRACT", isolatedWorkspace: "NOT_RUN", dependencyAllowlist: "NOT_RUN", secretScan: "NOT_RUN", staticAnalysis: "NOT_RUN", tests: "NOT_RUN", resourceLimits: "NOT_RUN" },
    deploymentBlockers: specification.deploymentBlockers,
  });
}

export function createPaidProductBuildArtifact(specification: BuildSpecification, projectId: string, version: number, feedback?: string): BuildArtifact {
  const revision = feedback ? ` Revision direction: ${feedback}` : "";
  const files = [
    ["app/product/page.tsx", "FRONTEND", "cw-product-shell-v1", 6200], ["app/account/access/page.tsx", "FRONTEND", "cw-entitlement-gate-v1", 5100],
    ["app/api/checkout/route.ts", "BACKEND", "cw-commerce-adapter-v1", 5400], ["app/api/webhooks/payment/route.ts", "BACKEND", "cw-commerce-adapter-v1", 6700],
    ["server/entitlements.ts", "BACKEND", "cw-entitlement-gate-v1", 4800], ["supabase/commerce-schema.sql", "DATABASE", "cw-commerce-adapter-v1", 5200],
    ["tests/commerce.test.ts", "TEST", "cw-commerce-adapter-v1", 5900], ["README-commerce.md", "DOCUMENTATION", "cw-product-shell-v1", 3300],
  ] as const;
  return buildArtifactSchema.parse({
    artifactKind: "PAID_PRODUCT_APPLICATION",
    fileManifest: files.map(([path, kind, templateId, bytes]) => ({ path, kind, templateId, bytes, sha256: digest(`${projectId}:${version}:${path}:${revision}`) })),
    resourcePreview: { title: specification.name, format: specification.format, summary: `${specification.promise}.${revision}`, accessMode: "AUTHENTICATED", objectReference: null },
    pages: {
      optIn: { headline: specification.promise, body: "Review the product scope, delivery terms, and pricing hypothesis before starting checkout.", benefits: specification.frontend.slice(0, 3), callToAction: "Start fixture checkout", states: ["EMPTY", "LOADING", "SUCCESS", "FAILURE"] },
      thankYou: { headline: "Payment confirmation pending", body: "A browser redirect does not grant access. Channelwright waits for a verified server-side payment event.", benefits: ["Verified fulfillment only", "Idempotent entitlement record"], callToAction: "Check access status", states: ["LOADING", "SUCCESS", "FAILURE"] },
      resourceAccess: { headline: `${specification.name} workspace`, body: "Access requires an active server-side entitlement.", benefits: ["Owner-scoped product data", "Revocable access"], callToAction: "Open product", states: ["LOADING", "SUCCESS", "FAILURE"] },
    },
    productPreview: { transformation: specification.promise, minimumViableScope: specification.frontend.slice(0, 3), features: [...specification.frontend, ...specification.backend].slice(0, 6), accessMode: "ENTITLEMENT_REQUIRED" },
    commercePlan: {
      providerNeutralBoundary: true, checkout: ["Server creates checkout session from an active internal price", "Browser receives only provider checkout URL or fixture reference"],
      webhookVerification: ["Read raw request body", "Verify provider signature before parsing business state", "Reject replayed provider event IDs"],
      fulfillment: ["Resolve internal purchase by provider checkout ID", "Mark paid only from verified event", "Grant one idempotent entitlement"],
      refundsAndRevocation: ["Verified refund event marks purchase refunded", "Revoke or refund the entitlement and record audit history"],
    },
    backendPlan: { validation: ["Validate internal product and price IDs server-side"], ownerScoping: ["Resolve owner from the product record", "Never accept owner identifiers from checkout redirects"], abuseProtection: ["Checkout creation rate limit", "Webhook replay protection"], duplicateHandling: "Unique provider event IDs and checkout IDs make fulfillment idempotent", delivery: ["Entitlement-gated authenticated access"], auditEvents: ["CHECKOUT_CREATED", "PAYMENT_CONFIRMED", "ENTITLEMENT_GRANTED", "PAYMENT_REFUNDED", "ENTITLEMENT_REVOKED"] },
    databasePlan: specification.database, adminControls: specification.administration, tests: specification.tests, setupDocumentation: specification.setupAndDeployment,
    previewReference: `fixture-product-preview://${projectId}/v${version}`, fixture: true,
    executionEvidence: { mode: "FIXTURE_CONTRACT", isolatedWorkspace: "NOT_RUN", dependencyAllowlist: "NOT_RUN", secretScan: "NOT_RUN", staticAnalysis: "NOT_RUN", tests: "NOT_RUN", resourceLimits: "NOT_RUN" },
    deploymentBlockers: specification.deploymentBlockers,
  });
}

export function reviewBuildArtifact(artifact: BuildArtifact): BuildQa {
  const findings: BuildQa["findings"] = [];
  if (artifact.executionEvidence.mode === "EXECUTED" && Object.entries(artifact.executionEvidence).some(([key, value]) => key !== "mode" && value !== "PASSED")) findings.push({ severity: "BLOCKER", category: "build", message: "Every executed constrained-build check must pass." });
  if (!artifact.backendPlan.ownerScoping.some((item) => item.toLowerCase().includes("never accept owner"))) findings.push({ severity: "BLOCKER", category: "ownership", message: "Public input must not control owner scope." });
  if (artifact.artifactKind === "PAID_PRODUCT_APPLICATION" && (!artifact.commercePlan?.providerNeutralBoundary || artifact.productPreview?.accessMode !== "ENTITLEMENT_REQUIRED")) findings.push({ severity: "BLOCKER", category: "commerce", message: "Paid products require provider-neutral verified commerce and entitlement-gated access." });
  if (artifact.fixture) findings.push({ severity: "WARNING", category: "deployment", message: "The preview is structured fixture output. Isolation, scanning, static analysis, tests, and resource-limit enforcement were not run." });
  const verdict = findings.some((item) => item.severity === "BLOCKER") ? "REVISE" : "PASS";
  return buildQaSchema.parse({ verdict, checkedAt: new Date().toISOString(), findings, summary: verdict === "PASS" ? "The fixture artifact passes manifest, security-plan, and preview-contract QA. No generated workspace or live delivery was executed." : "The build requires revision." });
}
