import { createHash, randomUUID } from "node:crypto";
import type {
  ChannelPreferences, ChannelStrategy, ConceptCandidate, ConceptResearch, ContentStrategy,
  PlatformPackage, PlatformQa, ReelsPackage, Script, ScriptQa, TikTokPackage, ViabilityReport, VideoResearch,
} from "@/domain/contracts";
import {
  channelStrategySchema, conceptCandidateSchema, conceptResearchSchema, contentStrategySchema,
  platformQaSchema, reelsPackageSchema, scriptQaSchema, scriptSchema, tiktokPackageSchema,
  viabilityReportSchema, videoResearchSchema,
} from "@/domain/contracts";
import { platformConstraints } from "@/domain/platform-constraints";

const now = () => new Date().toISOString();
const stableUuid = (seed: string) => {
  const value = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  value[12] = "4";
  value[16] = ((Number.parseInt(value[16], 16) & 0x3) | 0x8).toString(16);
  return `${value.slice(0, 8).join("")}-${value.slice(8, 12).join("")}-${value.slice(12, 16).join("")}-${value.slice(16, 20).join("")}-${value.slice(20).join("")}`;
};
const fixtureSource = (supports: string[]) => ({
  title: "Deterministic fixture evidence — not live market research",
  url: "https://example.com/channelwright-fixture",
  accessedAt: now(),
  supports,
});

export function researchConcept(concept: string, preferences: ChannelPreferences): ConceptResearch {
  return conceptResearchSchema.parse({
    summary: `Fixture research maps the audience, repeatable formats, production burden, and revenue paths for “${concept}”. It demonstrates the contract only and is not current market evidence.`,
    demandSignals: ["Adjacent explanatory and documentary formats have a fixture demand signal", `The supplied audience is ${preferences.targetAudience}`],
    comparableChannels: ["Fixture Channel Alpha", "Fixture Channel Beta"],
    contentAngles: ["Case-study breakdowns", "Myth-versus-reality explainers", "Ranked lessons and comparisons"],
    monetizationPaths: [preferences.monetizationGoal, "Relevant affiliate partnerships", "Niche sponsorships"],
    risks: ["Live competitor saturation is not known in fixture mode", "Media rights require per-video review"],
    sources: [fixtureSource(["contract-shape", "workflow-demonstration"])],
    fixture: true,
    researchedAt: now(),
  });
}

type Profile = "go" | "caution" | "stop";
const profileFor = (concept: string): Profile => {
  const value = concept.toLowerCase();
  if (value.includes("daily ai news") || value.includes("celebrity news") || value.includes("fixture stop")) return "stop";
  if (value.includes("failed startup") || value.includes("general finance") || value.includes("fixture caution")) return "caution";
  return "go";
};

export function evaluateConcept(concept: string): ViabilityReport {
  const profile = profileFor(concept);
  const values = profile === "go"
    ? { recommendation: "GO", overall: 86, demand: 88, competition: 72, money: 84, depth: 93, feasibility: 89, diff: 78, trend: 81 }
    : profile === "caution"
      ? { recommendation: "CAUTION", overall: 64, demand: 76, competition: 42, money: 78, depth: 91, feasibility: 74, diff: 49, trend: 65 }
      : { recommendation: "STOP_RECOMMENDED", overall: 43, demand: 79, competition: 18, money: 66, depth: 82, feasibility: 38, diff: 22, trend: 31 };
  const hardStatus = profile === "stop" ? "NO" : profile === "caution" ? "WEAK" : "YES";
  const strategicStatus = profile === "go" ? "STRONG" : "WEAK";
  return viabilityReportSchema.parse({
    recommendation: values.recommendation,
    overallScore: values.overall,
    gates: {
      contentRunway: { status: profile === "stop" ? "WEAK" : "YES", score: values.depth, evidence: ["Fixture taxonomy contains recurring series, cases, comparisons, and explainers beyond title generation"] },
      audienceDemand: { status: profile === "stop" ? "YES" : hardStatus, score: values.demand, evidence: ["Fixture adjacent-category engagement signal; live validation remains required"] },
      monetization: { status: profile === "stop" ? "WEAK" : hardStatus, score: values.money, evidence: ["At least one plausible sponsor, affiliate, product, or advertising path was mapped"] },
      differentiation: { status: strategicStatus, score: values.diff, evidence: [profile === "go" ? "A specific audience and repeatable editorial lens are present" : "The current framing is readily interchangeable with established formats"] },
      productionEconomics: { status: profile === "stop" ? "WEAK" : profile === "caution" ? "MODERATE" : "STRONG", score: values.feasibility, evidence: ["Fixture estimate considers research, narration, media licensing, and publishing cadence"] },
    },
    scores: {
      audienceDemand: values.demand, competition: values.competition, monetization: values.money,
      contentDepth: values.depth, productionFeasibility: values.feasibility,
      differentiationPotential: values.diff, trendStability: values.trend,
    },
    strengths: ["The concept supports structured storytelling", "Several revenue paths can be tested"],
    risks: profile === "go" ? ["Live evidence is still required before committing budget"] : ["Weak differentiation", "Acquisition or production economics may be unfavorable"],
    findings: ["Research suggests an addressable format", "Fixture scores illustrate deterministic gate behavior", "No success or failure prediction is implied"],
    repairable: profile !== "go",
    recommendedChanges: profile === "go" ? [] : ["Narrow the channel to a specific audience", "Use a defensible recurring editorial lens"],
    revisedConceptExamples: profile === "stop" ? ["AI news for independent retailers", "The business decisions behind celebrity brands"] : ["Failed startup autopsies for bootstrapped founders"],
    summary: `Fixture evaluation returns ${values.recommendation}. This advisory result demonstrates workflow behavior; it is not a live market forecast.`,
    modelVersion: "fixture-viability-v1",
  });
}

export function discoverConcepts(preferences: ChannelPreferences): ConceptCandidate[] {
  const concepts = [
    ["The Hidden Systems Behind Everyday Businesses", preferences.niche, "See the operational machinery most customers never notice."],
    ["Failed Startup Autopsies for Independent Founders", "Business case studies", "Turn expensive company failures into practical founder lessons."],
    ["Tools Tested Against Real Professional Workflows", "Technology and work", "Replace feature lists with evidence from realistic jobs-to-be-done."],
  ] as const;
  return concepts.map(([concept, niche, promise]) => conceptCandidateSchema.parse({ id: randomUUID(), concept, niche, promise, viability: evaluateConcept(concept) }));
}

export function createChannelStrategy(concept: string, preferences: ChannelPreferences, risks: string[]): ChannelStrategy {
  return channelStrategySchema.parse({
    positioning: `${concept}, told through evidence-led visual stories for ${preferences.targetAudience}.`,
    targetViewer: preferences.targetAudience,
    channelPromise: `Every episode makes ${preferences.niche} clearer, more useful, and memorable.`,
    differentiation: "A repeatable evidence-to-insight structure with transparent uncertainty and original synthesis.",
    contentPillars: ["Deep-dive case studies", "Systems explained", "Comparisons and counterfactuals"],
    videoFormats: ["Narrated visual documentary", "Evidence-led breakdown"],
    visualStyle: preferences.videoStyle,
    narrationStyle: preferences.preferredVoice,
    monetizationApproaches: [preferences.monetizationGoal, "Aligned sponsorships", "Curated resources"],
    recurringSeries: ["Inside the system", "What actually happened", "The expensive lesson"],
    riskNotes: risks,
  });
}

export function createContentStrategy(topic: string, concept: string, preferences: ChannelPreferences): ContentStrategy {
  return contentStrategySchema.parse({
    targetViewer: preferences.targetAudience,
    viewerProblem: `They want a trustworthy, concise understanding of ${topic}.`,
    angle: `Explain ${topic} through the channel's ${concept} lens, separating evidence from inference.`,
    viewerPromise: "The viewer leaves with a useful mental model, not a recycled list.",
    thesis: `${topic} becomes understandable when its incentives, sequence, and trade-offs are made visible.`,
    emotionalDriver: "Curiosity followed by earned clarity",
    hook: `The obvious story about ${topic} misses the mechanism that mattered most.`,
    sections: ["The popular version", "The hidden mechanism", "The evidence", "What it changes"],
    monetizationOpportunity: preferences.monetizationGoal,
    risks: ["Do not overstate fixture claims", "Verify every external fact before production"],
  });
}

export function researchVideo(topic: string): VideoResearch {
  return videoResearchSchema.parse({
    topic,
    thesis: `A fixture-backed research outline for ${topic}.`,
    summary: "This deterministic research artifact demonstrates source and claim linkage; replace it with current provider output before publication.",
    claims: [
      { id: "claim-1", claim: "Fixture claim: the outcome followed a sequence of incentives and constraints.", sourceIds: ["source-1"], confidence: 0.7 },
      { id: "claim-2", claim: "Fixture claim: a common explanation omits an operational trade-off.", sourceIds: ["source-1"], confidence: 0.6 },
    ],
    sources: [{ ...fixtureSource(["claim-1", "claim-2"]), title: "Source 1: fixture research record" }],
    contradictions: ["Live research may contradict fixture assumptions"],
    unknowns: ["Current market-specific facts"],
    copyrightConcerns: ["Use licensed or original visuals only"],
  });
}

export function writeScript(topic: string, version = 1, feedback?: string): Script {
  const revision = feedback ? ` Revision direction: ${feedback}` : "";
  const sections = [
    ["The story everyone repeats", "Establish the familiar explanation", `Most accounts of ${topic} begin at the outcome. We begin one decision earlier.${revision}`, ["claim-1"], 85],
    ["The mechanism underneath", "Reveal the causal system", "Follow the incentives, constraints, and feedback loops. That is where the useful story lives.", ["claim-1", "claim-2"], 170],
    ["The evidence and uncertainty", "Separate support from inference", "The available evidence supports part of the thesis, while current facts still require live verification.", ["claim-2"], 145],
    ["The lesson worth keeping", "Deliver viewer payoff", "The durable lesson is a decision framework: inspect incentives, test constraints, and name uncertainty.", [], 100],
  ] as const;
  return scriptSchema.parse({
    version,
    title: `${topic}: the system behind the story`,
    hook: `Everyone remembers how ${topic} ended. Almost nobody follows the mechanism that made the ending likely.`,
    sections: sections.map(([heading, purpose, narration, claimRefs, estimatedSeconds]) => ({ heading, purpose, narration, claimRefs: [...claimRefs], estimatedSeconds })),
    cta: "Subscribe for the next evidence-led breakdown.",
    outro: "That is the mechanism behind the headline.",
    estimatedSeconds: 500,
  });
}

export function reviewScript(): ScriptQa {
  return scriptQaSchema.parse({
    verdict: "PASS",
    scores: { factualSupport: 82, hook: 86, pacing: 84, originality: 88, channelFit: 91 },
    findings: [{ severity: "WARNING", category: "research", message: "Fixture claims must be replaced or verified before production." }],
    summary: "The structured draft passes the demo gate and is ready for human review, subject to live fact verification.",
  });
}

type AdaptationInput = {
  videoId: string;
  topic: string;
  script: Script;
  research: VideoResearch;
  preferences: ChannelPreferences;
  version: number;
  feedback?: string;
};

const sharedAdaptationFields = (input: AdaptationInput, target: "TIKTOK" | "INSTAGRAM_FACEBOOK_REELS") => {
  const createdAt = now();
  const sourceSections = input.script.sections.slice(0, 3);
  const claimReferences = [...new Set(sourceSections.flatMap((section) => section.claimRefs))];
  return {
    variantId: stableUuid(`${input.videoId}:${target}:${input.version}`),
    artifactVersion: input.version,
    sourceScriptVersion: input.script.version,
    sourceMasterVersion: null,
    intendedAudience: input.preferences.targetAudience,
    contentAngle: `A standalone vertical explanation of ${input.topic}, condensed from the approved canonical script.`,
    targetDurationSeconds: 60,
    aspectRatio: "9:16" as const,
    condensedNarration: sourceSections.map((section) => section.narration),
    selectedSegments: sourceSections.map((section) => ({ sourceSection: section.heading, purpose: section.purpose })),
    onScreenText: ["THE STORY", "THE MECHANISM", "THE TAKEAWAY"],
    captionCues: [
      { startSeconds: 0, endSeconds: 4, text: "The obvious explanation misses the mechanism." },
      { startSeconds: 4, endSeconds: 28, text: "Follow the incentives and constraints one step earlier." },
      { startSeconds: 28, endSeconds: 55, text: "Separate what the evidence supports from what still needs verification." },
    ],
    visualInstructions: ["Reframe source material vertically around one focal subject", "Use licensed or original B-roll only", "Keep essential text inside a platform-previewed safe zone"],
    audioGuidance: ["Use original narration", "Use licensed music or platform-cleared audio only", "Keep narration intelligible under music"],
    coverText: "THE MECHANISM MOST PEOPLE MISS",
    discoverabilityTerms: [input.topic, "explained", "systems thinking"],
    callToAction: "Watch the full evidence-led breakdown on YouTube.",
    claimReferences,
    warnings: [...input.research.copyrightConcerns, "Fixture claims require live verification before media production."],
    publicationBlockers: ["No validated YouTube master render exists", "No short-form media file has been rendered or inspected", "No social publishing connection is configured"],
    fixture: true as const,
    createdAt,
    updatedAt: createdAt,
  };
};

export function createTikTokPackage(input: AdaptationInput): TikTokPackage {
  const revision = input.feedback ? ` Revision direction: ${input.feedback}` : "";
  return tiktokPackageSchema.parse({
    ...sharedAdaptationFields(input, "TIKTOK"),
    target: "TIKTOK",
    hook: `Stop at the headline and you miss what actually drove ${input.topic}.${revision}`,
    pacingNotes: ["Open on the conflict in the first beat", "Cut or reframe every 2–4 seconds when it improves clarity", "Use one deliberate mid-story pattern interruption"],
    platformCaption: `${input.topic}, explained through the mechanism behind the headline. Fixture adaptation plan—verify claims before production.`,
    hashtags: ["#Explained", "#SystemsThinking", "#LearnOnTikTok"],
    patternInterrupts: ["Switch from headline framing to a simple causal diagram", "Pause before the final decision rule"],
  });
}

export function createReelsPackage(input: AdaptationInput): ReelsPackage {
  const revision = input.feedback ? ` Revision direction: ${input.feedback}` : "";
  return reelsPackageSchema.parse({
    ...sharedAdaptationFields(input, "INSTAGRAM_FACEBOOK_REELS"),
    target: "INSTAGRAM_FACEBOOK_REELS",
    hook: `The useful lesson in ${input.topic} starts one decision earlier.${revision}`,
    pacingNotes: ["Use a clean editorial rhythm", "Let diagrams settle long enough to read", "Land the final framework before the CTA"],
    instagramCaption: `The headline is the outcome. This Reel maps the mechanism behind ${input.topic} and the lesson worth keeping.`,
    instagramCallToAction: "Save this framework, then watch the full breakdown on YouTube.",
    facebookCaption: `A concise visual explanation of the incentives, constraints, and trade-offs behind ${input.topic}.`,
    facebookCallToAction: "Share this with someone who wants the mechanism, not just the headline.",
    safeZoneGuidance: ["Keep titles away from the bottom caption and right-side controls", "Preview the shared 9:16 media in both Instagram and Facebook before export"],
  });
}

export function reviewPlatformPackage(platformPackage: PlatformPackage, research: VideoResearch): PlatformQa {
  const supportedClaims = new Set(research.claims.map((claim) => claim.id));
  const findings: PlatformQa["findings"] = [];
  for (const claimReference of platformPackage.claimReferences) {
    if (!supportedClaims.has(claimReference)) findings.push({ severity: "BLOCKER", category: "claims", message: `Claim reference ${claimReference} is not present in approved research.` });
  }
  const constraints = platformConstraints[platformPackage.target];
  if (platformPackage.targetDurationSeconds < constraints.planningDurationSeconds.min || platformPackage.targetDurationSeconds > constraints.planningDurationSeconds.max) {
    findings.push({ severity: "BLOCKER", category: "duration", message: `Planned duration falls outside the configured ${constraints.planningDurationSeconds.min}–${constraints.planningDurationSeconds.max} second range.` });
  }
  if (platformPackage.sourceMasterVersion === null) findings.push({ severity: "WARNING", category: "master", message: "The plan has no source master because rendering is not implemented." });
  findings.push({ severity: "INFO", category: "fixture", message: "This is deterministic fixture output, not rendered or publish-ready media." });
  const verdict = findings.some((finding) => finding.severity === "BLOCKER") ? "REVISE" : "PASS";
  return platformQaSchema.parse({
    verdict,
    checkedAt: now(),
    findings,
    summary: verdict === "PASS" ? "The adaptation plan passes contract and provenance QA; media production and validation remain blocked." : "The adaptation plan must be revised before human approval.",
  });
}
