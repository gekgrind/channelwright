import type {
  ApprovedStrategyArtifact,
  ApprovedStrategyReference,
  ChannelContentIntelligenceResult,
  ContentTopicOpportunity,
  CrossModelReview,
  TopicDiscoveryBundle,
} from "@/domain/production-workflows";
import type { ViewerValueAssessment } from "@/domain/viewer-value";
import { evidenceBundleFixture } from "./research-fixtures.test-helper";
import { approvedResearchReferenceFixture, strategyResultFixture } from "./strategy-fixtures.test-helper";

const PILLAR_ONE = "pillar:operating-systems";
const PILLAR_TWO = "pillar:incentive-systems";
const VIDEO_ONE = "yt:video:contentvid001";
const VIDEO_TWO = "yt:video:contentvid002";
const CHANNEL_ONE = "yt:channel:contentchan01";
const SEARCH_ONE = "yt:search:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SEARCH_TWO = "yt:search:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export const approvedStrategyReferenceFixture: ApprovedStrategyReference = {
  strategyWorkflowId: crypto.randomUUID(),
  strategyRunId: crypto.randomUUID(),
  workflowDefinitionVersion: 1,
  outputSchemaVersion: 1,
  approvalId: crypto.randomUUID(),
  approvedBy: crypto.randomUUID(),
  approvedAt: "2026-08-15T12:00:00.000Z",
  finalQaState: "accept",
  finalQaScore: 88,
  strategyArtifactHash: "e".repeat(64),
  strategyProvenanceHash: "f".repeat(64),
  parentRunId: null,
  rootRunId: crypto.randomUUID(),
  upstreamResearch: approvedResearchReferenceFixture,
};

export const approvedStrategyArtifactFixture: ApprovedStrategyArtifact = {
  reference: approvedStrategyReferenceFixture,
  strategyResult: strategyResultFixture,
  researchEvidenceBundle: evidenceBundleFixture,
};

const retrievedAt = "2026-08-15T12:30:00.000Z";

export const discoveryBundleFixture: TopicDiscoveryBundle = {
  normalizedQueries: ["how small businesses coordinate work", "why incentive programs fail"],
  evidence: [
    {
      id: SEARCH_ONE, provider: "YOUTUBE_DATA_API_V3", sourceType: "search", sourceId: SEARCH_ONE.slice("yt:search:".length),
      url: null, title: null, channelTitle: null, publishedAt: null, retrievedAt,
      metrics: { retainedResults: 2, returnedItems: 12 }, query: "how small businesses coordinate work", pillarId: PILLAR_ONE,
      rawReference: "youtube.search.list", origin: "LIVE",
    },
    {
      id: SEARCH_TWO, provider: "YOUTUBE_DATA_API_V3", sourceType: "search", sourceId: SEARCH_TWO.slice("yt:search:".length),
      url: null, title: null, channelTitle: null, publishedAt: null, retrievedAt,
      metrics: { retainedResults: 1, returnedItems: 9 }, query: "why incentive programs fail", pillarId: PILLAR_TWO,
      rawReference: "youtube.search.list", origin: "LIVE",
    },
    {
      id: VIDEO_ONE, provider: "YOUTUBE_DATA_API_V3", sourceType: "video", sourceId: "contentvid001",
      url: "https://www.youtube.com/watch?v=contentvid001", title: "How a bakery actually schedules its week",
      channelTitle: "Operations Explained", publishedAt: "2026-05-01T00:00:00.000Z", retrievedAt,
      metrics: { viewCount: 48120, likeCount: 1420, commentCount: 96 }, query: "how small businesses coordinate work",
      pillarId: PILLAR_ONE, rawReference: "youtube.videos.list:contentvid001", origin: "LIVE",
    },
    {
      id: VIDEO_TWO, provider: "YOUTUBE_DATA_API_V3", sourceType: "video", sourceId: "contentvid002",
      url: "https://www.youtube.com/watch?v=contentvid002", title: "Why staff bonus schemes backfire",
      channelTitle: "Operations Explained", publishedAt: "2026-06-11T00:00:00.000Z", retrievedAt,
      metrics: { viewCount: 20310, likeCount: 802, commentCount: 51 }, query: "why incentive programs fail",
      pillarId: PILLAR_TWO, rawReference: "youtube.videos.list:contentvid002", origin: "LIVE",
    },
    {
      id: CHANNEL_ONE, provider: "YOUTUBE_DATA_API_V3", sourceType: "channel", sourceId: "contentchan01",
      url: "https://www.youtube.com/channel/contentchan01", title: "Operations Explained", channelTitle: "Operations Explained",
      publishedAt: "2023-02-01T00:00:00.000Z", retrievedAt,
      metrics: { subscriberCount: 91000, videoCount: 142, viewCount: 8200000 }, query: "how small businesses coordinate work",
      pillarId: PILLAR_ONE, rawReference: "youtube.channels.list:contentchan01", origin: "LIVE",
    },
  ],
  completionStatus: "complete",
  limitations: [],
  usage: {
    provider: "YOUTUBE_DATA_API_V3", cacheHits: 0, cacheMisses: 1, searchQueries: 2, providerRequests: 4,
    quotaUnits: 202, videosExamined: 2, channelsExamined: 1, retrievedAt, budgetExhausted: false,
  },
};

const dimension = (verdict: "strong" | "adequate" | "weak" | "absent" | "not_applicable", rationale: string, evidenceIds: string[] = []) => ({ verdict, rationale, evidenceIds });

export function viewerValueFixture(overrides: Partial<ViewerValueAssessment> = {}): ViewerValueAssessment {
  return {
    schemaVersion: 1,
    contract: {
      schemaVersion: 1,
      intendedViewer: "An owner or operator of a small service business who schedules staff themselves.",
      viewerNeed: { kind: "PROBLEM", statement: "Weekly scheduling consumes hours and still produces gaps.", urgency: "high", urgencyRationale: "Scheduling recurs weekly and directly costs the operator time.", evidenceIds: [VIDEO_ONE] },
      valuePromise: {
        statement: "Show the actual scheduling system a comparable business runs, step by step.",
        kinds: [{ kind: "SOLVES_PROBLEM", label: null }, { kind: "PRACTICAL_GUIDANCE", label: null }],
        viewerOutcome: "The viewer can rebuild their own weekly schedule using a named, repeatable method.",
        specificity: dimension("strong", "The promise names one concrete recurring task and a reproducible method.", [VIDEO_ONE]),
      },
      originalContribution: {
        kinds: [{ kind: "PRACTICAL_WALKTHROUGH", label: null }, { kind: "BETTER_ORGANIZATION", label: null }],
        statement: "Existing videos describe scheduling principles; this walks one real system end to end.",
        assessment: dimension("strong", "Observed comparable videos stay at the principle level.", [VIDEO_ONE, CHANNEL_ONE]),
      },
      differentiation: dimension("strong", "The observed sample explains why, not how; this shows the mechanism.", [VIDEO_ONE]),
      evidenceSupport: dimension("adequate", "Claims about the competitive gap rest on the retrieved sample only.", [VIDEO_ONE, SEARCH_ONE]),
      actionability: dimension("strong", "The viewer leaves with a method they can apply the same week.", [VIDEO_ONE]),
      trustworthiness: dimension("strong", "No outcome, income, or performance claim is made.", []),
      sustainability: dimension("adequate", "The same treatment extends across other recurring operations.", [CHANNEL_ONE]),
    },
    strengths: ["Serves a recurring, concrete operator problem."],
    weaknesses: ["Depends on access to a realistic worked example."],
    assumptions: ["Viewers schedule staff themselves rather than delegating it."],
    uncertainties: ["Whether operators prefer a walkthrough over a summary is unknown."],
    improvementSuggestions: ["Name the business type explicitly in the framing."],
    integrityFindings: [],
    policySignals: [{ category: "ORIGINALITY", label: null, status: "OK", note: "Original walkthrough rather than a restatement of observed videos." }],
    gate: "PASS",
    gateReasons: ["Clear recurring need, specific promise, and a genuine contribution beyond the observed sample."],
    ...overrides,
  };
}

function topic(overrides: Partial<ContentTopicOpportunity> = {}): ContentTopicOpportunity {
  return {
    topicId: "topic:weekly-schedule-walkthrough",
    pillarId: PILLAR_ONE,
    workingConcept: "A full walkthrough of how one small service business builds its weekly staff schedule.",
    workingAngle: "Follow the real sequence of decisions rather than listing scheduling principles.",
    viewerQuestion: "How do I build a weekly staff schedule that does not leave gaps?",
    viewerIntent: "SOLVE",
    proposedViewerValue: "The viewer can reproduce a named weekly scheduling method for their own business.",
    differentiatedContribution: "Shows the decision sequence and its failure points, which the observed sample omits.",
    evidenceIds: [VIDEO_ONE, SEARCH_ONE],
    competitionSignal: { level: "medium", rationale: "One established channel covers adjacent scheduling principles.", evidenceIds: [CHANNEL_ONE] },
    saturationAssessment: "The principle-level treatment is well covered; the mechanism-level treatment is not.",
    differentiationOpportunity: "Own the operational mechanism rather than the motivational framing.",
    shelfLife: { classification: "EVERGREEN", rationale: "Weekly scheduling is a permanent operating task.", decayNote: null },
    productionComplexity: "medium",
    strategicFit: "Directly serves the approved operating-systems pillar.",
    monetizationRelevance: "May later suit scheduling-software sponsorship once audience fit is demonstrated.",
    assumptions: ["A representative worked example can be sourced or reconstructed."],
    uncertainties: ["Preferred depth for this audience is unproven."],
    viewerValue: viewerValueFixture(),
    ...overrides,
  };
}

export const contentTopicFixture = topic;

const secondTopic = topic({
  topicId: "topic:bonus-scheme-failure-modes",
  pillarId: PILLAR_TWO,
  workingConcept: "Why staff bonus schemes quietly stop changing behaviour after a few months.",
  workingAngle: "Trace three specific failure modes through their incentive mechanics.",
  viewerQuestion: "Why did my staff bonus scheme stop working?",
  viewerIntent: "LEARN",
  proposedViewerValue: "The viewer can diagnose which failure mode their own scheme has hit.",
  differentiatedContribution: "Names distinct mechanisms instead of restating that incentives are complicated.",
  evidenceIds: [VIDEO_TWO, SEARCH_TWO],
  competitionSignal: { level: "low", rationale: "The observed sample treats bonuses only in passing.", evidenceIds: [VIDEO_TWO] },
  saturationAssessment: "Little mechanism-level coverage appears in the retrieved sample.",
  differentiationOpportunity: "Introduce a reusable diagnostic frame.",
  shelfLife: { classification: "EVERGREEN", rationale: "Incentive design is a durable management problem.", decayNote: null },
  strategicFit: "Serves the approved incentive-systems pillar.",
  monetizationRelevance: null,
  viewerValue: viewerValueFixture({
    contract: {
      ...viewerValueFixture().contract,
      intendedViewer: "A small-business owner whose staff bonus scheme has stopped producing results.",
      viewerNeed: { kind: "QUESTION", statement: "The owner cannot tell why the scheme stopped working.", urgency: "medium", urgencyRationale: "The cost is ongoing but not immediately urgent.", evidenceIds: [VIDEO_TWO] },
      valuePromise: {
        statement: "Give the owner three named failure modes and a way to tell which one applies.",
        kinds: [{ kind: "IMPROVES_DECISION", label: null }, { kind: "PROVIDES_ANALYSIS", label: null }],
        viewerOutcome: "The viewer can diagnose their own scheme against three concrete mechanisms.",
        specificity: dimension("strong", "Three named mechanisms rather than general advice.", [VIDEO_TWO]),
      },
      differentiation: dimension("adequate", "The retrieved sample treats bonuses only in passing.", [VIDEO_TWO]),
      evidenceSupport: dimension("adequate", "The competitive gap rests on a bounded sample.", [VIDEO_TWO, SEARCH_TWO]),
    },
  }),
});

const scoreComponents = (topicId: string) => ({
  topicId,
  components: [
    { dimension: "STRATEGY_ALIGNMENT" as const, score: 9, weight: 0.2, rationale: "Sits inside an approved pillar.", basis: "STRATEGY" as const, evidenceIds: [] },
    { dimension: "AUDIENCE_NEED" as const, score: 8, weight: 0.2, rationale: "Addresses a recurring operator problem.", basis: "EVIDENCE" as const, evidenceIds: [VIDEO_ONE] },
    { dimension: "VIEWER_VALUE" as const, score: 9, weight: 0.2, rationale: "Passes the viewer value gate with a specific promise.", basis: "EVIDENCE" as const, evidenceIds: [VIDEO_ONE] },
    { dimension: "DIFFERENTIATION" as const, score: 7, weight: 0.2, rationale: "Mechanism-level treatment is uncovered in the sample.", basis: "EVIDENCE" as const, evidenceIds: [CHANNEL_ONE] },
    { dimension: "PRODUCTION_FEASIBILITY" as const, score: 6, weight: 0.2, rationale: "Requires sourcing a worked example.", basis: "ASSUMPTION" as const, evidenceIds: [] },
  ],
  weightedTotal: 7.8,
  tier: "PRIORITY" as const,
});

export const contentResultFixture: ChannelContentIntelligenceResult = {
  schemaVersion: 1,
  workflowType: "CHANNEL_CONTENT_INTELLIGENCE",
  upstreamStrategy: approvedStrategyReferenceFixture,
  pillarExpansions: [
    {
      pillarId: PILLAR_ONE, pillarName: "Operating systems",
      audienceProblem: "Operators run recurring work by memory and lose time to avoidable gaps.",
      rationale: "The approved pillar targets how ordinary firms coordinate work.",
      subtopicClusters: [{ name: "Scheduling", viewerIntent: "Rebuild a reliable weekly schedule.", exampleQuestions: ["How do I schedule staff without gaps?"] }],
      discoveryQueries: ["how small businesses coordinate work"],
      assumptions: ["Operators handle scheduling personally."],
    },
    {
      pillarId: PILLAR_TWO, pillarName: "Incentive systems",
      audienceProblem: "Owners cannot tell why a bonus scheme stopped changing behaviour.",
      rationale: "The approved pillar targets how firms shape behaviour.",
      subtopicClusters: [{ name: "Bonus design", viewerIntent: "Diagnose a failing scheme.", exampleQuestions: ["Why did my bonus scheme stop working?"] }],
      discoveryQueries: ["why incentive programs fail"],
      assumptions: ["Owners have already tried at least one scheme."],
    },
  ],
  topics: [topic(), secondTopic],
  scores: [scoreComponents("topic:weekly-schedule-walkthrough"), { ...scoreComponents("topic:bonus-scheme-failure-modes"), weightedTotal: 7.8, tier: "STRONG" }],
  backlog: [
    { topicId: "topic:weekly-schedule-walkthrough", rank: 1, tier: "PRIORITY", inclusionRationale: "Strongest combination of recurring need and uncovered mechanism." },
    { topicId: "topic:bonus-scheme-failure-modes", rank: 2, tier: "STRONG", inclusionRationale: "Distinct pillar with low observed competition." },
  ],
  nextVideoRecommendation: {
    topicId: "topic:weekly-schedule-walkthrough",
    reasons: [
      "It serves the highest-urgency recurring problem observed in the approved strategy's primary audience.",
      "The retrieved sample covers scheduling principles but not the decision mechanism.",
      "It is feasible under the approved faceless walkthrough format.",
    ],
    viewerValueRationale: "The viewer leaves able to rebuild their own weekly schedule.",
    strategyAlignment: "Directly serves the approved operating-systems pillar and channel promise.",
    competitiveRationale: "One established channel covers the adjacent principle-level treatment only.",
    differentiationRationale: "Mechanism-level walkthrough is absent from the observed sample.",
    feasibilityRationale: "Requires one worked example and no on-camera presence.",
    evidenceIds: [VIDEO_ONE, CHANNEL_ONE],
    confidence: "medium",
    conditions: ["A representative worked example must be sourced before production."],
  },
  risks: [{ risk: "The bounded sample may understate competition.", severity: "medium", mitigation: "Re-run discovery before committing to a series." }],
  assumptions: ["The approved strategy's audience definition still holds."],
  openQuestions: ["Which pillar sustains repeat viewing?"],
  recommendedNextAction: "Approve the backlog and brief the recommended walkthrough.",
  crossModelReview: null,
  modelProvenance: [
    { provider: "openai", model: "generator-model", role: "GENERATOR", operation: "content_pillar_expansion", invokedAt: "2026-08-15T12:31:00.000Z" },
    { provider: "openai", model: "generator-model", role: "GENERATOR", operation: "content_topic_assessment", invokedAt: "2026-08-15T12:32:00.000Z" },
    { provider: "openai", model: "generator-model", role: "GENERATOR", operation: "content_backlog_synthesis", invokedAt: "2026-08-15T12:33:00.000Z" },
  ],
};

export const crossModelReviewFixture: CrossModelReview = {
  generator: { provider: "openai", model: "generator-model", role: "GENERATOR", operation: "content_backlog_synthesis", invokedAt: "2026-08-15T12:33:00.000Z" },
  critic: { provider: "anthropic", model: "critic-model", role: "CRITIC", operation: "content_cross_model_critique", invokedAt: "2026-08-15T12:34:00.000Z" },
  outcome: "CRITIC_RAISED_ISSUE",
  findings: [{
    code: "DIFFERENTIATION_ASSERTED_NOT_SHOWN",
    severity: "warning",
    affectedField: "topics[1].differentiatedContribution",
    rationale: "The claim that competitors omit mechanism-level treatment is asserted but the cited evidence only shows one adjacent channel.",
    evidenceIds: ["yt:video:contentvid002"],
    disposition: "CRITIC_RAISED_ISSUE",
  }],
  summary: "The backlog is coherent, but differentiation on the second topic rests on a thinner sample than its confident wording implies.",
};
