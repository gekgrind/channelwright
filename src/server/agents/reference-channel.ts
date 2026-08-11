import { createHash, randomUUID } from "node:crypto";
import type { ChannelPreferences } from "@/domain/contracts";
import {
  referenceChannelReportSchema, referenceChannelSourceSchema, referenceReportQaSchema,
  type ReferenceChannelReport, type ReferenceChannelRequest, type ReferenceChannelSource,
  type ReferenceReportQa, type ReferenceReportSection,
} from "@/domain/studio-contracts";
import { canonicalizeYouTubeChannelUrl } from "@/domain/youtube-channel-url";

export interface ReferenceResearchProvider {
  readonly mode: "fixture" | "live";
  readonly providerName: string;
  resolve(request: ReferenceChannelRequest): Promise<ReferenceChannelSource>;
  research(source: ReferenceChannelSource, request: ReferenceChannelRequest, preferences: ChannelPreferences): Promise<ReferenceChannelReport>;
}

const stableFixtureId = (value: string) => `fixture-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;

export class FixtureReferenceResearchProvider implements ReferenceResearchProvider {
  readonly mode = "fixture" as const;
  readonly providerName = "deterministic-reference-fixture-v1";

  async resolve(request: ReferenceChannelRequest): Promise<ReferenceChannelSource> {
    const parsed = canonicalizeYouTubeChannelUrl(request.url);
    const now = new Date().toISOString();
    return referenceChannelSourceSchema.parse({
      id: randomUUID(), inputUrl: request.url, canonicalUrl: parsed.canonicalUrl,
      stableChannelId: stableFixtureId(`${parsed.sourceKind}:${parsed.lookupValue.toLowerCase()}`),
      sourceKind: parsed.sourceKind, lookupValue: parsed.lookupValue,
      title: `Fixture reference: ${parsed.lookupValue}`,
      handle: parsed.sourceKind === "HANDLE" ? `@${parsed.lookupValue}` : null,
      provider: this.providerName, fixture: true, resolvedAt: now,
      accessWarnings: ["Fixture resolution did not call YouTube and does not prove that this channel exists."],
    });
  }

  async research(source: ReferenceChannelSource, request: ReferenceChannelRequest, preferences: ChannelPreferences): Promise<ReferenceChannelReport> {
    const now = new Date().toISOString();
    const sourceId = "fixture-reference-source";
    const liked = request.likedAspects ? ` User-supplied inspiration: ${request.likedAspects}` : "";
    const restriction = request.restrictions ? ` Additional user restriction: ${request.restrictions}` : "";
    return referenceChannelReportSchema.parse({
      sourceIdentity: { stableChannelId: source.stableChannelId, title: source.title, canonicalUrl: source.canonicalUrl, handle: source.handle },
      researchDate: now,
      dataSources: [{ sourceId, title: "Deterministic reference-channel fixture", url: source.canonicalUrl, provider: this.providerName, accessedAt: now, fixture: true, supports: ["contract demonstration", "workflow testing"], confidence: "UNKNOWN" }],
      publiclyObservablePositioning: `Fixture-only positioning placeholder for ${source.title}.${liked} No live channel page, video, transcript, or analytics was retrieved.`,
      likelyAudience: { description: preferences.targetAudience, problems: [`Needs useful ${preferences.niche} guidance without recycled summaries`], confidence: "UNKNOWN" },
      recurringTopics: [{ finding: `Evidence-led explanations within ${preferences.niche}`, evidence: [sourceId], confidence: "UNKNOWN" }],
      contentClusters: ["Foundational explanations", "Case-study breakdowns", "Decision frameworks"],
      videoFormats: [{ finding: preferences.videoStyle, evidence: [sourceId], confidence: "UNKNOWN" }],
      approximateCadence: { description: preferences.postingFrequency, confidence: "UNKNOWN", evidence: ["User preference; not observed channel history"] },
      observedPatterns: { titles: ["No live title sample retrieved"], hooks: ["No live hook sample retrieved"], thumbnails: ["No thumbnail assets retrieved"], structures: ["No transcripts retrieved"], callsToAction: ["No live CTA sample retrieved"] },
      notableVideos: [],
      demandSignals: [{ finding: "Demand must be verified by a live research provider", evidence: [sourceId], confidence: "UNKNOWN" }],
      contentRunway: ["Explain the underlying system", "Compare common approaches", "Break down representative cases", "Test a practical framework"],
      visibleMonetizationSignals: [],
      strengths: ["A reference can clarify the market category and user taste"],
      weaknesses: ["Fixture mode has no current public evidence"],
      risks: ["Treating inspiration as evidence", "Copying distinctive expression instead of differentiating"],
      marketGaps: ["A narrower audience and explicit evidence standard can create an original position"],
      opportunities: ["Build a connected education-to-resource-to-product journey"],
      originalDifferentiationRecommendations: ["Use an original evidence-to-decision editorial structure", `Design specifically for ${preferences.targetAudience}`],
      mustNotCopy: ["Channel name, logo, artwork, thumbnails, scripts, products, or distinctive trade dress", `Any protected or distinctive expression from the reference.${restriction}`],
      proposedOriginalConcept: {
        name: `${preferences.name} Original`,
        positioning: `An original ${preferences.niche} channel for ${preferences.targetAudience}, using transparent evidence and practical decision frameworks.`,
        valueProposition: "Turn complex systems into useful decisions, with sources, uncertainty, and an actionable next step made explicit.",
      },
      brandDirection: {
        direction: "Editorial utility with original diagrams, restrained color, and visible source provenance.",
        colors: [{ name: "Ink", hex: "#16211D", use: "Primary text" }, { name: "Paper", hex: "#F4F0E7", use: "Canvas" }, { name: "Signal", hex: "#E7673F", use: "Decisions and calls to action" }],
        typography: { display: "Humanist grotesk", body: "Readable system sans" }, spacing: [4, 8, 16, 24, 40],
        voice: [preferences.preferredVoice, "Evidence first", "Direct about uncertainty"],
        imageryGuidance: ["Use original diagrams and licensed documentary imagery", "Avoid layouts, marks, and thumbnail systems associated with the reference"],
      },
      pillarVideoCandidates: [
        { name: `The complete system behind ${preferences.niche}`, promise: "A durable mental model and first action", audience: preferences.targetAudience, rationale: "Establishes the channel thesis and naturally supports a practical resource", complexity: preferences.productionComplexity === "PREMIUM" ? "HIGH" : "MEDIUM", risks: ["Requires live evidence"], thesis: "The category becomes useful when its incentives, sequence, and trade-offs are made visible." },
        { name: `The costly mistake in ${preferences.niche}`, promise: "Avoid a common decision failure", audience: preferences.targetAudience, rationale: "Creates concrete stakes without relying on imitation", complexity: "MEDIUM", risks: ["Avoid sensational claims"], thesis: "A popular shortcut fails because it ignores one binding constraint." },
      ],
      freeResourceCandidates: [
        { name: "Decision checklist", promise: "Apply the video framework in ten minutes", audience: preferences.targetAudience, rationale: "Low-friction bridge from learning to action", complexity: "LOW", risks: ["Keep examples current"], format: "Interactive checklist", deliveryMethod: "Secure tokenized access", transitionToPaid: "Offer deeper implementation templates after the checklist result" },
        { name: "Readiness calculator", promise: "Identify the highest-leverage next step", audience: preferences.targetAudience, rationale: "Creates personalized utility", complexity: "MEDIUM", risks: ["Do not imply diagnostic certainty"], format: "Browser calculator", deliveryMethod: "Authenticated or signed-link access", transitionToPaid: "Map the result to an optional implementation product" },
      ],
      paidProductCandidates: [
        { name: "Implementation system", promise: "Move from diagnosis to a completed operating workflow", audience: preferences.targetAudience, rationale: "Extends the free decision aid into execution", complexity: "HIGH", risks: ["Validate demand before building"], format: "Templates plus guided application", pricingHypothesis: "$49-$149 one-time hypothesis; validate before pricing", validationPlan: "Interview opt-ins and test a manual presale" },
        { name: "Focused workshop", promise: "Complete one high-value outcome with expert structure", audience: preferences.targetAudience, rationale: "Faster validation and lower initial software scope", complexity: "MEDIUM", risks: ["Delivery capacity"], format: "Cohort workshop", pricingHypothesis: "$99-$299 hypothesis; validate willingness to pay", validationPlan: "Run a small paid pilot with refund terms stated clearly" },
      ],
      potentialRevenueStreams: [
        { stream: "Free-to-paid product funnel", evidence: ["Connected journey requested by user"], assumptions: ["Audience problem and willingness to pay remain unverified"] },
        { stream: "Aligned sponsorships", evidence: [preferences.monetizationGoal], assumptions: ["Audience scale, advertiser demand, and rates remain unknown"] },
      ],
      citations: [{ claim: "This record demonstrates the reference research contract only", sourceIds: [sourceId] }],
      contradictions: ["User preferences may differ from what a live provider observes"],
      unknowns: ["Current videos, publishing cadence, public performance, transcripts, audience composition, and monetization evidence"],
      incompleteDataWarnings: ["Fixture mode did not retrieve YouTube data. Replace or rerun with a configured live provider before relying on market claims."],
      fixture: true,
    });
  }
}

export function reviewReferenceReport(report: ReferenceChannelReport): ReferenceReportQa {
  const findings: ReferenceReportQa["findings"] = [];
  if (report.fixture) findings.push({ severity: "WARNING", category: "provenance", message: "Fixture output contains no live YouTube research and cannot support current market claims." });
  if (!report.mustNotCopy.some((item) => item.toLowerCase().includes("name"))) findings.push({ severity: "BLOCKER", category: "originality", message: "The report must explicitly prohibit copying protected reference-channel identity and expression." });
  if (report.unknowns.length === 0) findings.push({ severity: "BLOCKER", category: "uncertainty", message: "Unknowns must be recorded." });
  const verdict = findings.some((finding) => finding.severity === "BLOCKER") ? "REVISE" : "PASS";
  return referenceReportQaSchema.parse({ verdict, checkedAt: new Date().toISOString(), findings, summary: verdict === "PASS" ? "The report passes contract, originality, and uncertainty QA; fixture evidence remains unsuitable for live market decisions." : "The report requires revision before human review." });
}

export function reviseFixtureReferenceReport(report: ReferenceChannelReport, section: ReferenceReportSection, instructions: string): ReferenceChannelReport {
  const next = structuredClone(report);
  const note = `Revision instruction applied: ${instructions}`;
  switch (section) {
    case "POSITIONING": next.publiclyObservablePositioning = `${next.publiclyObservablePositioning} ${note}`; break;
    case "AUDIENCE": next.likelyAudience.problems.push(note); break;
    case "TOPICS": next.contentClusters.push(note); break;
    case "PATTERNS": next.observedPatterns.structures.push(note); break;
    case "DEMAND": next.demandSignals.push({ finding: note, evidence: ["user-revision"], confidence: "UNKNOWN" }); break;
    case "MONETIZATION": next.visibleMonetizationSignals.push({ finding: note, evidence: ["user-revision"], confidence: "UNKNOWN" }); break;
    case "DIFFERENTIATION": next.originalDifferentiationRecommendations.push(note); break;
    case "ORIGINAL_CONCEPT": next.proposedOriginalConcept.valueProposition = `${next.proposedOriginalConcept.valueProposition} ${note}`; break;
    case "BRAND": next.brandDirection.voice.push(note); break;
    case "PILLAR_VIDEOS": next.pillarVideoCandidates[0].rationale = `${next.pillarVideoCandidates[0].rationale} ${note}`; break;
    case "FREE_RESOURCES": next.freeResourceCandidates[0].rationale = `${next.freeResourceCandidates[0].rationale} ${note}`; break;
    case "PAID_PRODUCTS": next.paidProductCandidates[0].rationale = `${next.paidProductCandidates[0].rationale} ${note}`; break;
    case "REVENUE_STREAMS": next.potentialRevenueStreams[0].assumptions.push(note); break;
  }
  return referenceChannelReportSchema.parse(next);
}
