import { randomUUID } from "node:crypto";
import type { ChannelPreferences, ChannelStrategy } from "@/domain/contracts";
import type { ReferenceChannelReport } from "@/domain/studio-contracts";
import { businessStrategyQaSchema, businessStrategySchema, type BusinessStrategy, type BusinessStrategyQa } from "@/domain/strategy-contracts";

export function createBusinessStrategy(
  concept: string,
  channelStrategy: ChannelStrategy,
  preferences: ChannelPreferences,
  referenceReport?: ReferenceChannelReport,
): BusinessStrategy {
  const audience = preferences.targetAudience;
  const brand = referenceReport?.brandDirection;
  return businessStrategySchema.parse({
    connectedJourney: {
      youtubeContent: `Evidence-led ${preferences.niche} videos earn attention from ${audience}.`,
      pillarVideo: `A definitive Pillar Video turns the channel thesis into a complete decision framework.`,
      freeResourceOptIn: "A relevant resource CTA offers a practical next step in exchange for explicit email consent.",
      resourceDelivery: "A scoped delivery workflow provides secure resource access and records consent and delivery state.",
      paidProductOffer: "The resource outcome creates a natural, optional transition to a separately approved paid-product specification.",
      additionalMonetization: "Advertising, aligned sponsorships, affiliates, services, and licensing are evaluated separately rather than assumed.",
    },
    brandSystem: {
      name: `${preferences.name} operating system`,
      colors: brand?.colors ?? [{ name: "Workshop navy", hex: "#17233A", use: "Primary structure" }, { name: "Blueprint", hex: "#EAF1F7", use: "Canvas" }, { name: "Proof", hex: "#F2B441", use: "Evidence and decisions" }],
      typography: { display: brand?.typography.display ?? "Editorial grotesk", body: brand?.typography.body ?? "Readable humanist sans", utility: "Technical monospace" },
      spacing: brand?.spacing ?? [4, 8, 16, 24, 40],
      voice: brand?.voice ?? [preferences.preferredVoice, "Clear about evidence and uncertainty"],
      imageryGuidance: brand?.imageryGuidance ?? ["Original diagrams and licensed documentary imagery", "No imitation of competitor thumbnail systems"],
      reusableComponents: ["Evidence card", "Decision checkpoint", "Resource preview", "Source ledger"],
      originalityNotes: ["Create original names, layouts, marks, scripts, offers, and product experiences", "Reference inputs define market context, never a visual cloning instruction"],
    },
    pillarVideo: {
      title: `The complete system behind ${preferences.niche}`,
      coreViewerProblem: `${audience} lacks a reliable end-to-end model for making decisions in ${preferences.niche}.`,
      highValuePromise: "Leave with a sourced mental model, a practical diagnostic, and a concrete first action.",
      originalThesis: `${concept} becomes useful when incentives, sequence, constraints, and trade-offs are made visible together.`,
      searchAndDiscoveryIntent: [`${preferences.niche} explained`, `${preferences.niche} framework`],
      titleDirections: [`${preferences.niche}: the complete system`, `The ${preferences.niche} decision most people get wrong`],
      thumbnailDirections: ["One original causal diagram with a single highlighted constraint", "A before/after decision map using the approved brand tokens"],
      openingHook: `Most advice about ${preferences.niche} starts after the most important decision has already been made.`,
      narrativeStructure: ["Name the costly default", "Reveal the underlying system", "Test it against evidence", "Apply the decision framework", "Offer the next practical step"],
      evidenceRequirements: ["Current primary or authoritative sources for factual claims", "Explicit contradiction and unknown tracking"],
      ctaPlacement: ["Soft resource invitation after the framework is demonstrated", "Clear resource CTA after the viewer payoff"],
      freeResourceConnection: "The resource operationalizes the Pillar Video framework without requiring the paid product.",
      paidProductConnection: "The paid option addresses implementation depth only after the resource delivers standalone value.",
      repurposingOpportunities: ["Short-form explanation of one constraint", "Newsletter decision memo", "Diagram-led community post"],
      successMetrics: ["Qualified resource opt-in rate", "Viewer retention through the framework payoff", "Resource activation or completion rate"],
    },
    freeResourceOptions: [
      {
        id: randomUUID(), name: `${preferences.niche} decision map`, promise: "Find the constraint that should determine your next move", intendedAudience: audience,
        problemSolved: "Turns a complex topic into a sequenced decision instead of a generic checklist", format: "Interactive decision worksheet", whyItFits: "Extends the channel's evidence-to-decision teaching method",
        pillarVideoConnection: "Uses the same constraints and decision points introduced in the Pillar Video", buildComplexity: "LOW",
        frontendBehavior: ["Responsive guided worksheet", "Progress and result summary", "Accessible printable view"],
        backendBehavior: ["Validated email capture", "Owner/channel-scoped signup", "Signed resource access token"],
        deliveryMethod: "Immediate secure access plus optional provider-delivered email", ctaExamples: ["Map your next decision", "Use the free decision map"],
        transitionToPaid: "Offer deeper implementation templates only after the user receives a useful result", risksAndMaintenance: ["Examples require periodic review", "Avoid presenting outputs as professional advice"],
      },
      {
        id: randomUUID(), name: `${preferences.niche} readiness calculator`, promise: "Score readiness and identify one evidence-backed next action", intendedAudience: audience,
        problemSolved: "Replaces vague readiness claims with transparent questions and an explainable result", format: "Browser calculator", whyItFits: "Creates personalized utility from the channel framework",
        pillarVideoConnection: "Scores the variables explained in the Pillar Video", buildComplexity: "MEDIUM",
        frontendBehavior: ["Keyboard-accessible questionnaire", "Transparent score explanation", "Result comparison"],
        backendBehavior: ["Versioned scoring rules", "Scoped result storage", "Rate-limited secure delivery"],
        deliveryMethod: "Authenticated session or expiring signed access link", ctaExamples: ["Calculate your readiness", "Get your next-step score"],
        transitionToPaid: "Map optional implementation help to the result without hiding the free explanation", risksAndMaintenance: ["Scoring assumptions require validation", "Must disclose that the score is directional"],
      },
      {
        id: randomUUID(), name: `${preferences.niche} evidence library`, promise: "Start with a curated, source-linked set of proven examples", intendedAudience: audience,
        problemSolved: "Reduces research time while preserving source context", format: "Searchable mini-database", whyItFits: "Reinforces the evidence-led channel promise",
        pillarVideoConnection: "Expands the cases referenced in the Pillar Video", buildComplexity: "HIGH",
        frontendBehavior: ["Search and filters", "Source and access-date display", "Mobile reading view"],
        backendBehavior: ["Curated record management", "Object-reference storage", "Change and expiry tracking"],
        deliveryMethod: "Authenticated application access", ctaExamples: ["Browse the evidence library", "Explore the source-backed examples"],
        transitionToPaid: "Offer workflow tools built on the library, not access to facts the user was promised for free", risksAndMaintenance: ["Ongoing curation cost", "Link rot and licensing review"],
      },
    ],
    paidProductOptions: [
      {
        id: randomUUID(), name: `${preferences.niche} implementation system`, transformation: "Move from an identified constraint to a completed, measurable operating workflow", idealCustomer: audience,
        problem: "The user understands the framework but lacks implementation structure", desiredOutcome: "A working process, templates, and review cadence tailored to one priority", format: "Guided application with templates",
        minimumViableScope: ["One end-to-end workflow", "Editable templates", "Progress checkpoints"], featuresAndContent: ["Implementation planner", "Decision log", "Review dashboard"],
        pricingHypotheses: ["$49-$149 one-time; hypothesis only", "$19-$39 monthly only if ongoing value is validated"], validationPlan: ["Interview activated resource users", "Test a manual paid pilot before software scope"],
        freeResourceRelationship: "Imports or starts from the free resource result without withholding the free result", requirements: { frontend: ["Application workspace"], backend: ["Scoped project API"], authentication: ["Customer account or secure magic link"], storage: ["Project records and object references"], payments: ["Verified checkout and webhook adapter"], fulfillment: ["Idempotent entitlement grant"], support: ["Documented help and contact route"] },
        deliveryAndRefundConsiderations: ["State access and support terms before checkout", "Define refund and entitlement-revocation behavior"], expansionOpportunities: ["Team workspace", "Specialized workflow packs"],
        buildComplexity: "HIGH", risks: ["Overbuilding before validation", "Support load"], dependencies: ["Approved product specification", "Payment provider", "Authentication and entitlement storage"],
      },
      {
        id: randomUUID(), name: `${preferences.niche} working session`, transformation: "Complete one high-value decision and leave with an implementation plan", idealCustomer: audience,
        problem: "The user needs guided application more than additional content", desiredOutcome: "A reviewed decision, prioritized actions, and documented next steps", format: "Live workshop plus durable toolkit",
        minimumViableScope: ["One facilitated session", "Preparation worksheet", "Takeaway implementation plan"], featuresAndContent: ["Workshop curriculum", "Decision template", "Follow-up checklist"],
        pricingHypotheses: ["$99-$299 pilot; hypothesis only"], validationPlan: ["Offer a small paid cohort", "Measure completion, refund requests, and follow-through"],
        freeResourceRelationship: "Uses the completed free resource as workshop preparation", requirements: { frontend: ["Sales page and scheduling handoff"], backend: ["Order and attendance records"], authentication: [], storage: ["Secure participant materials"], payments: ["Verified checkout"], fulfillment: ["Access email and calendar instructions"], support: ["Rescheduling and refund process"] },
        deliveryAndRefundConsiderations: ["Publish attendance, cancellation, and refund rules", "Do not expose participant data"], expansionOpportunities: ["Recorded cohort materials", "Private team sessions"],
        buildComplexity: "MEDIUM", risks: ["Founder delivery capacity", "Scheduling friction"], dependencies: ["Validated workshop promise", "Scheduling and email provider"],
      },
    ],
    monetizationOverview: [
      { stream: "Free-to-paid product funnel", factBasis: ["Connected strategy artifacts exist"], assumptions: ["Demand and willingness to pay are unverified"], fit: "HIGH", timing: "After resource activation evidence", priority: 1 },
      { stream: "Aligned sponsorships", factBasis: [channelStrategy.monetizationApproaches.join("; ")], assumptions: ["Audience scale and advertiser demand are unknown"], fit: "MEDIUM", timing: "After consistent audience evidence", priority: 2 },
      { stream: "Affiliate offers", factBasis: ["Possible only when a genuinely useful product fits the content"], assumptions: ["Conversion and reputation impact are unknown"], fit: "MEDIUM", timing: "After trust and disclosure standards are established", priority: 3 },
      { stream: "Services or consulting", factBasis: ["Can validate high-value problems before software investment"], assumptions: ["Operator capacity and customer fit are unknown"], fit: "MEDIUM", timing: "Early validation option", priority: 4 },
    ],
    originalityRules: ["Use reference research only for category understanding and gap analysis", "Create original names, value propositions, scripts, visual systems, resources, products, and pages"],
    fixture: true,
  });
}

export function reviewBusinessStrategy(strategy: BusinessStrategy): BusinessStrategyQa {
  const findings: BusinessStrategyQa["findings"] = [];
  if (strategy.freeResourceOptions.length < 2 || strategy.paidProductOptions.length < 2) findings.push({ severity: "BLOCKER", category: "choice", message: "Users need multiple free and paid options before selection." });
  if (!strategy.originalityRules.some((item) => item.toLowerCase().includes("original"))) findings.push({ severity: "BLOCKER", category: "originality", message: "Original output requirements are missing." });
  if (strategy.fixture) findings.push({ severity: "WARNING", category: "evidence", message: "Pricing, demand, and monetization statements are fixture hypotheses until live evidence validates them." });
  const verdict = findings.some((item) => item.severity === "BLOCKER") ? "REVISE" : "PASS";
  return businessStrategyQaSchema.parse({ verdict, checkedAt: new Date().toISOString(), findings, summary: verdict === "PASS" ? "The connected strategy passes contract and originality QA; fixture hypotheses remain unverified." : "The strategy requires revision before human review." });
}

export function reviseBusinessStrategy(strategy: BusinessStrategy, feedback: string): BusinessStrategy {
  const next = structuredClone(strategy);
  next.pillarVideo.originalThesis = `${next.pillarVideo.originalThesis} Revision direction: ${feedback}`;
  next.originalityRules.push(`User revision: ${feedback}`);
  return businessStrategySchema.parse(next);
}
