import type { ChannelResearchResult, ResearchEvidence, ResearchEvidenceBundle, ResearchQAResult } from "@/domain/production-workflows";

export const evidenceFixture: ResearchEvidence = {
  id: "yt:video:video123", provider: "YOUTUBE_DATA_API_V3", sourceType: "video", sourceId: "video123",
  url: "https://www.youtube.com/watch?v=video123", title: "How local businesses really work", channelTitle: "Business Lab",
  publishedAt: "2026-08-01T12:00:00.000Z", retrievedAt: "2026-08-13T12:00:00.000Z",
  metrics: { viewCount: 125000, likeCount: 5000, commentCount: 300 }, query: "hidden business systems",
  rawReference: "youtube.videos.list:video123", origin: "LIVE",
};

export const evidenceBundleFixture: ResearchEvidenceBundle = {
  normalizedQueries: ["hidden business systems"], evidence: [evidenceFixture], completionStatus: "complete", limitations: [],
  usage: { provider: "YOUTUBE_DATA_API_V3", cacheStatus: "MISS", cacheKey: "a".repeat(64), searchQueries: 1, providerRequests: 3, quotaUnits: 3, videosExamined: 1, channelsExamined: 1, retrievedAt: "2026-08-13T12:00:00.000Z", expiresAt: "2026-08-13T18:00:00.000Z", budgetExhausted: false },
};

export const resultFixture: ChannelResearchResult = {
  schemaVersion: 1, workflowType: "CHANNEL_RESEARCH",
  researchObjective: "Evaluate current evidence for a faceless business-systems education channel.",
  suppliedConcept: "Faceless investigations of hidden business systems",
  concept: { normalizedConcept: "Faceless investigations of hidden business systems", summary: "A visual business-education channel grounded in recurring operational questions." },
  category: { niche: "Business education", audienceValue: "Makes opaque operating systems understandable and useful." },
  viability: {
    hundredVideoPotential: { verdict: "moderate", rationale: "Recurring operational systems provide breadth, but a full 100-topic inventory is still an inference.", evidenceIds: [evidenceFixture.id] },
    audienceDemand: { verdict: "moderate", rationale: "A current comparable video shows meaningful public demand.", evidenceIds: [evidenceFixture.id] },
    monetizationPotential: { verdict: "unknown", rationale: "Public YouTube evidence does not establish sponsor rates or buyer conversion.", evidenceIds: [evidenceFixture.id] },
  },
  audience: { targetViewer: "Curious aspiring operators", demandSignals: ["Comparable explanatory videos attract public views and engagement."], evidenceIds: [evidenceFixture.id] },
  competitiveLandscape: { summary: "Existing business-education videos validate interest without proving an uncontested position.", examples: [{ name: "Business Lab", relevance: "Publishes adjacent operational explainers.", evidenceIds: [evidenceFixture.id] }] },
  contentPotential: { pillars: [{ name: "Operating systems", description: "How ordinary firms coordinate work.", exampleTopics: ["How restaurants turn tables", "How loyalty programs shape demand"] }], estimatedTopicDepth: 120, evidenceIds: [evidenceFixture.id] },
  differentiation: { originalityAssessment: "Originality depends on first-principles visual explanations rather than copying existing formats.", opportunities: ["Use primary operational diagrams and cross-industry comparisons."], evidenceIds: [evidenceFixture.id] },
  sustainability: { repeatability: "A repeatable research template can cover many industries.", evergreenTrendBalance: "Core operating systems are evergreen, with selective timely examples.", productionDifficulty: "medium", creatorDependency: "low", defensibility: "Trust, research quality, and a proprietary visual system can compound.", evidenceIds: [evidenceFixture.id] },
  monetization: { paths: [{ type: "Sponsorships", rationale: "Relevant business software may sponsor an established audience, but pricing is unverified.", confidence: "low", evidenceIds: [evidenceFixture.id] }] },
  risks: [{ risk: "Visual research may be production intensive.", severity: "medium", mitigation: "Use repeatable diagrams and licensed stock.", evidenceIds: [evidenceFixture.id] }],
  assumptions: ["The creator can sustain weekly desk research and visual production."],
  uncertainties: ["Public evidence does not reveal retention, conversion, sponsor rates, or profit."],
  evidenceSummary: { evidenceIds: [evidenceFixture.id], independentChannelsObserved: 1, representativeVideosObserved: 1, oldestRetrievedAt: evidenceFixture.retrievedAt, newestRetrievedAt: evidenceFixture.retrievedAt, completionStatus: "complete", limitations: [] },
  recommendation: { verdict: "promising", rationale: "Proceed to a 100-topic inventory and offer validation before committing substantial capital.", confidence: "medium", evidenceIds: [evidenceFixture.id], reasons: ["Current adjacent content shows observable audience activity."], unansweredQuestions: ["Can the team produce a differentiated 100-topic inventory?"], nextAction: "Validate a complete topic inventory and several audience-aligned offers." },
};

export const qaFixture: ResearchQAResult = {
  passed: true, score: 90, findings: [], recommendation: "accept", deterministicChecksPassed: 6, deterministicChecksFailed: 0,
  modelUsage: { model: "test-model", inputTokens: 100, outputTokens: 40, totalTokens: 140 },
};
