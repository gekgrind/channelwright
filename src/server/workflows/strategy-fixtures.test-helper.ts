import type { ApprovedResearchArtifact, ApprovedResearchReference, ChannelStrategyResult } from "@/domain/production-workflows";
import { evidenceBundleFixture, resultFixture } from "./research-fixtures.test-helper";

export const approvedResearchReferenceFixture: ApprovedResearchReference = {
  researchWorkflowId: crypto.randomUUID(),
  researchRunId: crypto.randomUUID(),
  workflowDefinitionVersion: 1,
  outputSchemaVersion: 1,
  approvalId: crypto.randomUUID(),
  approvedBy: crypto.randomUUID(),
  approvedAt: "2026-08-14T12:00:00.000Z",
  finalQaState: "accept",
  finalQaScore: 90,
  researchArtifactHash: "a".repeat(64),
  evidenceProvenanceHash: "b".repeat(64),
  parentRunId: null,
  rootRunId: crypto.randomUUID(),
};

export const approvedResearchArtifactFixture: ApprovedResearchArtifact = {
  reference: approvedResearchReferenceFixture,
  researchResult: resultFixture,
  evidenceBundle: evidenceBundleFixture,
};

const claim = (statement: string) => ({ statement, evidenceIds: [evidenceBundleFixture.evidence[0].id] });
const audience = {
  description: "Curious aspiring operators who want clear business-system explanations.",
  needs: ["Understand opaque operating systems"], motivations: ["Become a more capable operator"], painPoints: ["Most explanations remain superficial"],
  desiredOutcomes: ["Apply durable operating principles"], viewingIntent: ["Learn through visual explanation"], reasonsToSubscribe: ["Consistent evidence-backed explanations"],
  reasonsNotToSubscribe: ["The subject may feel too technical"], evidenceIds: [evidenceBundleFixture.evidence[0].id],
};

export const strategyResultFixture: ChannelStrategyResult = {
  schemaVersion: 1,
  workflowType: "CHANNEL_STRATEGY",
  upstreamResearch: approvedResearchReferenceFixture,
  strategicThesis: {
    channelConcept: claim("A visual channel explaining hidden systems behind ordinary businesses."),
    strategicRationale: claim("Adjacent public evidence supports interest while differentiation must come from original operational diagrams."),
    marketOpportunitySummary: claim("The bounded sample supports cautious validation, not a complete market census."),
    whyThisChannelShouldExist: claim("Viewers lack clear visual explanations of recurring operating systems."),
    successConditions: [claim("Sustain a repeatable research and visual-production standard.")],
  },
  targetAudience: { primary: audience, secondary: null, demographicPrecisionLimit: "The approved research does not support precise age, gender, income, or geography claims." },
  positioning: {
    category: claim("Visual business education"), positioningStatement: claim("Evidence-backed visual investigations for aspiring operators."), competitiveFrame: claim("Adjacent to business explainers, differentiated by systems analysis."),
    differentiation: claim("First-principles diagrams and cross-industry comparisons."), defensibility: claim("Compounding research quality and a consistent visual language."), strategicWhitespace: claim("Operational mechanics rather than personality-led commentary."), deliberatelyNot: ["Generic entrepreneurship motivation"],
  },
  channelPromise: { corePromise: claim("Make one hidden business system understandable each release."), supportingPromise: claim("Separate public evidence from inference."), viewerValue: claim("Give viewers reusable operating models."), credibilityRequirements: ["Cite public evidence and disclose uncertainty"], promiseRisks: [claim("Weak sourcing would undermine trust.")] },
  valueProposition: { functionalValue: claim("Reusable systems understanding."), emotionalValue: claim("Confidence when reasoning about unfamiliar businesses."), informationalOrEntertainmentValue: claim("Clear visual explanation of opaque systems."), recurringReasonToReturn: claim("A new operating system is decoded each release."), advantageOverSubstitutes: claim("Stronger evidence boundaries and original diagrams.") },
  contentPillars: [
    { name: "Operating systems", purpose: "Explain how ordinary firms coordinate work.", audienceNeedServed: "Practical systems understanding.", strategicRationale: "Matches the approved research's repeatability conclusion.", evidenceIds: [evidenceBundleFixture.evidence[0].id], differentiationRole: "Centers operational mechanics.", monetizationRelevance: "May align with relevant business software sponsors after audience validation.", risks: ["Research intensity"], sustainability: "A repeatable research template supports breadth." },
    { name: "Incentive systems", purpose: "Explain how firms shape behavior.", audienceNeedServed: "Understand why common programs work.", strategicRationale: "Extends the same systems lens without individual episode planning.", evidenceIds: [evidenceBundleFixture.evidence[0].id], differentiationRole: "Connects incentives to operations.", monetizationRelevance: null, risks: ["Oversimplification"], sustainability: "Cross-industry comparisons create a durable field." },
  ],
  monetizationArchitecture: [{ path: "SPONSORSHIPS", label: "Relevant sponsorships", rationale: "Business software may fit an established operator audience, but pricing and conversion remain unknown.", prerequisites: ["Demonstrated audience fit"], maturityStage: "GROWTH", dependencies: ["Brand-safe evidence standards"], risks: ["Sponsor fit may be narrower than assumed"], confidence: "low", evidenceIds: [evidenceBundleFixture.evidence[0].id] }],
  strategicObjectives: { launch: ["Publish a small initial set using the repeatable research standard"], earlyValidation: ["Test whether viewers return for the systems lens"], growth: ["Improve packaging after real channel data exists"], monetization: ["Validate sponsor relevance before outreach"], strategicLearning: ["Learn which systems categories produce sustained attention"] },
  kpiFramework: [{ metric: "AUDIENCE_RETENTION", label: "Audience retention", purpose: "Evaluate whether explanations maintain attention.", futureMeasurementRequirement: "YouTube Analytics after publishing.", baselineState: "UNAVAILABLE", observedValue: null, proposedTarget: null, targetIsHypothesis: true, assumptions: ["No live analytics are ingested in this workflow"] }],
  strategicRisks: [{ category: "EVIDENCE_LIMITATION", risk: "The approved research is a bounded public sample.", severity: "high", mitigation: "Treat conclusions as hypotheses and gather live performance evidence later.", evidenceIds: [evidenceBundleFixture.evidence[0].id] }],
  assumptionsAndUncertainties: { assumptions: ["The team can sustain research-intensive production"], uncertainties: ["Retention and conversion are unknown"], unansweredQuestions: ["Which pillar earns repeat viewing?"], evidenceGaps: ["No private analytics or buyer-conversion data"], confidenceLimitations: ["The YouTube sample is bounded and relevance-ranked"] },
  recommendation: { decision: "PROCEED_WITH_CONDITIONS", reasons: ["The bounded research supports cautious validation"], confidence: "medium", conditions: ["Preserve evidence standards and validate with actual channel data"], evidenceIds: [evidenceBundleFixture.evidence[0].id] },
};
