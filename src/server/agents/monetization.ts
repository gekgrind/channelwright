import type { BusinessStrategy } from "@/domain/strategy-contracts";
import { monetizationPlanSchema, monetizationQaSchema, type MonetizationPlan, type MonetizationQa } from "@/domain/monetization-contracts";

const labels = [
  ["FREE_TO_PAID_PRODUCT", "HIGH", "After resource activation evidence"], ["SERVICES_CONSULTING", "HIGH", "Early validation option"],
  ["SPONSORSHIPS", "MEDIUM", "After consistent audience evidence"], ["AFFILIATES", "MEDIUM", "After trust and disclosure standards"],
  ["COURSES_WORKSHOPS", "MEDIUM", "After a paid pilot validates the outcome"], ["YOUTUBE_ADVERTISING", "MEDIUM", "After current program eligibility is independently verified"],
  ["MEMBERSHIP_COMMUNITY", "LOW", "After recurring audience demand is proven"], ["NEWSLETTER_SPONSORSHIP", "LOW", "After a permissioned engaged list exists"],
  ["LICENSING", "LOW", "After original IP has demonstrated reusable value"], ["LEAD_GENERATION", "LOW", "Only where consent, buyer fit, and reputation risk are acceptable"],
  ["PARTNERSHIPS", "LOW", "After complementary partners are validated"], ["CONTENT_SYNDICATION", "LOW", "After rights and incremental value are clear"],
  ["MERCHANDISING", "NOT_RECOMMENDED", "Only if audience identity and demand later justify inventory risk"],
] as const;

export function createMonetizationPlan(strategy: BusinessStrategy): MonetizationPlan {
  const now = new Date().toISOString();
  return monetizationPlanSchema.parse({
    executiveSummary: "Prioritize revenue paths that validate a real audience problem before adding operational complexity. Fixture rankings are planning hypotheses, not forecasts.",
    streams: labels.map(([stream, fit, timing], index) => ({
      stream, channelFit: fit,
      verifiedFacts: ["This fixture plan contains no live audience, eligibility, conversion, sponsor, or revenue data"],
      assumptionsAndEstimates: [`The approved strategy suggests ${stream.toLowerCase().replaceAll("_", " ")} may fit`, "Audience size, conversion, pricing, and time-to-revenue remain unknown"],
      eligibilityDependencies: stream === "YOUTUBE_ADVERTISING" ? ["Verify current YouTube Partner Program rules from official YouTube sources before acting"] : ["Validate demand, audience fit, and any provider or legal requirements"],
      timeToFirstRevenue: "Unknown; estimate only after live validation", setupEffort: index < 2 ? "MEDIUM" : index < 8 ? "HIGH" : "MEDIUM",
      ongoingEffort: index < 3 ? "MEDIUM" : "HIGH", marginCharacteristics: "Unknown until delivery cost, acquisition cost, refunds, and support are measured",
      reputationAndPlatformRisk: ["Misaligned promotion can erode audience trust", "Platform or provider terms can change"],
      requiredIntegrations: stream === "FREE_TO_PAID_PRODUCT" ? ["Email delivery", "Verified payment adapter", "Entitlements"] : ["None selected in fixture mode"],
      recommendedTiming: timing, priority: index + 1,
      nextActions: [index < 2 ? "Run a small manual validation test" : "Collect audience evidence before implementation"],
      metrics: ["Qualified interest", "Time and cost to deliver", "Conversion or response rate", "Refund, churn, or reputation signals"],
    })),
    rankingMethod: "Fixture ranking weighs strategic fit, implementation effort, reputation and platform risk, and likely time to useful validation without estimating private revenue.",
    contradictions: strategy.monetizationOverview.flatMap((item) => item.assumptions.map((assumption) => `${item.stream}: ${assumption}`)),
    unknowns: ["Current audience size and demographics", "Eligibility", "Conversion rates", "Sponsor demand", "Affiliate economics", "Customer willingness to pay", "Support and fulfillment cost"],
    sourceProvenance: [{ title: "Channelwright monetization contract fixture", url: "https://fixtures.channelwright.invalid/monetization/v1", accessedAt: now, fixture: true, supports: ["Contract shape", "Deterministic workflow demonstration"] }],
    fixture: true,
  });
}

export function reviseMonetizationPlan(plan: MonetizationPlan, feedback: string): MonetizationPlan {
  const next = structuredClone(plan);
  next.executiveSummary = `${next.executiveSummary} Revision direction: ${feedback}`;
  next.unknowns.push(`User revision requires validation: ${feedback}`);
  return monetizationPlanSchema.parse(next);
}

export function reviewMonetizationPlan(plan: MonetizationPlan): MonetizationQa {
  const findings: MonetizationQa["findings"] = [];
  const distinct = new Set(plan.streams.map((item) => item.stream));
  if (distinct.size < 10) findings.push({ severity: "BLOCKER", category: "coverage", message: "The plan must evaluate the broad monetization set rather than assume one product path." });
  if (plan.streams.some((item) => item.assumptionsAndEstimates.length === 0)) findings.push({ severity: "BLOCKER", category: "uncertainty", message: "Assumptions and estimates must be explicit for every stream." });
  if (plan.fixture) findings.push({ severity: "WARNING", category: "evidence", message: "No live eligibility, audience, revenue, sponsor, conversion, or profitability evidence was retrieved." });
  const verdict = findings.some((item) => item.severity === "BLOCKER") ? "REVISE" : "PASS";
  return monetizationQaSchema.parse({ verdict, checkedAt: new Date().toISOString(), findings, summary: verdict === "PASS" ? "The plan passes coverage and uncertainty QA as a fixture hypothesis set; live validation remains required." : "The monetization plan requires revision." });
}
