import {
  approvedContentOpportunityArtifactSchema,
  channelVideoBriefResultSchema,
  type ApprovedContentIntelligenceReference,
  type ApprovedContentOpportunityArtifact,
  type ChannelVideoBriefResult,
  type SelectedVideoOpportunity,
} from "@/domain/production-workflows";
import type { ViewerValueAssessment } from "@/domain/viewer-value";
import {
  approvedStrategyReferenceFixture,
  contentResultFixture,
  contentTopicFixture,
  discoveryBundleFixture,
  viewerValueFixture,
} from "./content-fixtures.test-helper";

/**
 * The upstream fixtures expose the topic as a factory; resolve it once.
 *
 * The selected topic is a weekly staff-scheduling walkthrough for a small
 * service business, and every field below is written to match it. A fixture
 * whose prose describes a different subject than its own topic ID makes a
 * failing assertion much harder to read.
 */
export const selectedTopicFixture = contentTopicFixture();

const EVIDENCE = discoveryBundleFixture.evidence.map((item) => item.id);
/** Evidence retrieved for the selected topic's own pillar. */
const OWN_PILLAR_EVIDENCE = discoveryBundleFixture.evidence
  .filter((item) => item.pillarId === selectedTopicFixture.pillarId)
  .map((item) => item.id);

export const approvedContentReferenceFixture: ApprovedContentIntelligenceReference = {
  contentWorkflowId: "6f1b0f8c-6b3a-4a2f-9a1e-2c4d5e6f7a81",
  contentRunId: "6f1b0f8c-6b3a-4a2f-9a1e-2c4d5e6f7a82",
  workflowDefinitionVersion: 1,
  outputSchemaVersion: 1,
  approvalId: "6f1b0f8c-6b3a-4a2f-9a1e-2c4d5e6f7a83",
  approvedBy: "6f1b0f8c-6b3a-4a2f-9a1e-2c4d5e6f7a84",
  approvedAt: "2026-08-15T10:00:00.000Z",
  finalQaState: "accept",
  finalQaScore: 88,
  contentArtifactHash: "a".repeat(64),
  contentProvenanceHash: "b".repeat(64),
  parentRunId: null,
  rootRunId: "6f1b0f8c-6b3a-4a2f-9a1e-2c4d5e6f7a82",
  upstreamStrategy: approvedStrategyReferenceFixture,
};

export const selectionFixture: SelectedVideoOpportunity = {
  topicId: selectedTopicFixture.topicId,
  pillarId: selectedTopicFixture.pillarId,
  backlogRank: 1,
  tier: "PRIORITY",
  selectionSource: "NEXT_VIDEO_RECOMMENDATION",
  inheritedViewerValueProvenance: {
    originStage: "CONTENT_INTELLIGENCE",
    originWorkflowType: "CHANNEL_CONTENT_INTELLIGENCE",
    originRunId: approvedContentReferenceFixture.contentRunId,
    subjectId: selectedTopicFixture.topicId,
    contractHash: "c".repeat(64),
    gate: "PASS",
    assessedAt: "2026-08-15T10:00:00.000Z",
  },
};

export const approvedContentArtifactFixture: ApprovedContentOpportunityArtifact =
  approvedContentOpportunityArtifactSchema.parse({
    reference: approvedContentReferenceFixture,
    contentResult: { ...contentResultFixture, upstreamStrategy: approvedStrategyReferenceFixture },
    discoveryBundle: discoveryBundleFixture,
    selectedTopic: selectedTopicFixture,
    selection: selectionFixture,
  });

/** A brief-stage Viewer Value assessment that passes the deterministic floor. */
export function briefViewerValueFixture(overrides: Partial<ViewerValueAssessment> = {}): ViewerValueAssessment {
  return viewerValueFixture(overrides);
}

/**
 * A complete, deterministically clean video brief for the selected scheduling
 * topic. Tests mutate one field at a time so a failure names exactly one rule.
 */
export function videoBriefResultFixture(overrides: Partial<ChannelVideoBriefResult> = {}): ChannelVideoBriefResult {
  const base: ChannelVideoBriefResult = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_BRIEF",
    source: {
      topicId: selectedTopicFixture.topicId,
      pillarId: selectedTopicFixture.pillarId,
      pillarName: "Operating systems for small service businesses",
      workingConcept: selectedTopicFixture.workingConcept,
      workingAngle: selectedTopicFixture.workingAngle,
      strategicContext: "Serves the approved operating-systems pillar: the recurring, unglamorous work that keeps a small service business running week to week.",
      sourceEvidenceIds: OWN_PILLAR_EVIDENCE.slice(0, 2),
    },
    viewer: {
      primaryViewer: "An owner or manager of a small service business who builds the staff rota themselves, usually in a spreadsheet, and loses hours to it every week.",
      viewerState: "Has scheduled staff many times and knows the constraints, but has no repeatable order of operations, so each week starts from scratch.",
      viewerQuestion: "How do I build a weekly staff schedule that does not leave gaps?",
      viewerIntent: "SOLVE",
      needKind: "PROBLEM",
      needStatement: "Needs a repeatable sequence for building the weekly rota that surfaces coverage gaps before the week starts rather than during it.",
      alreadyKnows: ["Their own staff availability and skills", "That last-minute swaps are what break the schedule"],
      stillNeeds: ["An order of operations that catches gaps early", "A way to absorb one dropout without rebuilding the week"],
      assumptions: ["The viewer schedules staff themselves rather than delegating it"],
      uncertainties: ["Team size varies widely across this audience, and the method must survive both ends"],
      demographicPrecisionLimit: "The evidence supports inferences about role and recurring task only; no age, region, revenue, or headcount is claimed.",
    },
    viewerPromise: {
      statement: "Build next week's staff schedule in a fixed five-step order that surfaces coverage gaps before you publish it, not after.",
      outcomeKind: "BE_ABLE_TO",
      whyItMatters: "Gaps found after publishing become last-minute calls and unplanned overtime; the same gaps found during scheduling cost nothing to fix.",
      transformation: {
        before: "Filling shifts name by name until the grid looks full, then discovering the uncovered hours mid-week.",
        after: "Working through a fixed sequence that makes uncovered hours visible while the schedule is still a draft.",
      },
      concreteValue: "A five-step sequence, demonstrated end to end on one real week, that the viewer can run this week.",
      valueTypes: [{ kind: "PROBLEM_SOLVING", label: null }, { kind: "EDUCATION", label: null }],
      explicitNonPromises: [
        "This does not recommend or compare specific scheduling software.",
        "This does not cover payroll, labour-law compliance, or union scheduling rules.",
      ],
      verifiability: "A reviewer can check that the finished video names all five steps in order and runs a complete week through them without skipping one.",
    },
    originalContribution: {
      kinds: [{ kind: "PRACTICAL_WALKTHROUGH", label: null }, { kind: "BETTER_ORGANIZATION", label: null }],
      statement: "Shows the actual decision sequence and where it breaks, rather than restating scheduling principles.",
      comparedToExisting: "The videos found during discovery explain why scheduling matters and stop at principles; none walk one real week end to end.",
      whyMoreUseful: "The viewer's failure is not motivation but ordering, so a demonstrated sequence solves the problem the principles leave untouched.",
      evidenceIds: OWN_PILLAR_EVIDENCE.slice(0, 2),
    },
    evidencePlan: {
      items: [
        {
          claimId: "claim:principle-level-coverage",
          claim: "The comparable videos retrieved during discovery stay at the principle level rather than demonstrating a full week.",
          status: "SUPPORTED",
          materiality: "supporting",
          evidenceIds: OWN_PILLAR_EVIDENCE.slice(0, 1),
          rationale: "Directly observable in the retrieved comparable content.",
          researchNote: null,
        },
        {
          claimId: "claim:hours-lost-weekly",
          claim: "How many hours a typical small-business owner loses to weekly scheduling.",
          status: "RESEARCH_REQUIRED",
          materiality: "core",
          evidenceIds: [],
          rationale: "No retrieved source measures time spent scheduling; stating a figure would be fabrication.",
          researchNote: "Establish a defensible range from an operator survey or first-party time tracking before the script asserts any number.",
        },
        {
          claimId: "claim:no-gaps-guarantee",
          claim: "This method guarantees a schedule with no coverage gaps.",
          status: "MUST_NOT_CLAIM",
          materiality: "core",
          evidenceIds: [],
          rationale: "Unsupportable, and the method's own value is surfacing gaps early rather than eliminating them.",
          researchNote: null,
        },
      ],
      gaps: ["No first-party measurement of time spent scheduling per week"],
      sufficiency: "SUFFICIENT_WITH_NOTED_GAPS",
      sufficiencyRationale: "The sequence can be demonstrated now; the one quantified claim must be researched before the script uses it.",
    },
    creativeDirection: {
      format: "DEMONSTRATION",
      formatLabel: null,
      formatRationale: "The viewer's gap is procedural, so watching the sequence performed teaches more than explaining it would.",
      tone: "Practical and unhurried; treats the viewer as someone who has done this before.",
      pacing: "measured",
      pacingRationale: "Five steps applied to a real week need room to land; compressing them would reproduce the principle-level treatment this video exists to beat.",
      narrativeApproach: "Build one real week from empty grid to published schedule, narrating each decision as it is made.",
      presentationStyle: "Screen-shared scheduling grid with the presenter talking through each decision.",
      informationDensity: "medium",
      visualStrategy: "A single persistent weekly grid that fills in step by step, with uncovered hours highlighted as they appear.",
      demonstrationOpportunities: ["Filling the grid live", "Removing one person mid-way to show how the sequence absorbs a dropout"],
      proofMoments: ["The moment an uncovered block appears while the schedule is still a draft"],
      emotionalArc: "From familiar low-grade dread, through visible control, to a schedule the viewer trusts.",
      credibilityStrategy: "Use a realistic roster with genuine constraints and show the awkward decisions rather than an idealised week.",
      useOfExamples: "One week carried all the way through, rather than several partial examples.",
      storytellingOpportunities: ["The dropout scenario doubles as a short narrative beat"],
      productionComplexity: "medium",
      productionComplexityRationale: "Screen capture plus a realistic prepared roster; no location shooting or custom animation required.",
    },
    contentArchitecture: {
      structureRationale: "Establishes the failure mode first so each step is visibly solving it, then demonstrates the whole sequence on one week so the payoff is the method itself.",
      beats: [
        {
          sectionId: "beat:opening",
          title: "Why the grid looks full and the week still breaks",
          role: "OPENING",
          purpose: "Name the specific failure the viewer recognises from their own week.",
          viewerQuestion: "Is this actually my problem?",
          valueDelivered: "Immediate recognition that the gap is ordering, not effort.",
          evidenceRequired: OWN_PILLAR_EVIDENCE.slice(0, 1),
          claimIds: ["claim:principle-level-coverage"],
          informationToCommunicate: ["The full-looking grid that still leaves hours uncovered", "That the fix is a sequence, not more effort"],
          transitionIntent: "Move from the familiar failure to the sequence that prevents it.",
          retentionRisk: "Dwelling on a problem the viewer already knows well.",
          visualTreatment: "A filled grid with the uncovered hours revealed.",
          relativeWeight: "minor",
        },
        {
          sectionId: "beat:model",
          title: "The five steps, in order",
          role: "CORE",
          purpose: "Introduce each step and why it must come where it does.",
          viewerQuestion: "What order should I actually work in?",
          valueDelivered: "The reusable sequence.",
          evidenceRequired: OWN_PILLAR_EVIDENCE.slice(0, 2),
          claimIds: ["claim:principle-level-coverage", "claim:hours-lost-weekly"],
          informationToCommunicate: ["Fixed commitments first", "Hardest-to-cover slots next", "Skills constraints", "Preferences", "Gap sweep before publishing"],
          transitionIntent: "Move from the sequence to running it on a real week.",
          retentionRisk: "Five steps listed in a row can flatten into the principle-level treatment this video is beating.",
          visualTreatment: "Grid with the current step highlighted as it is applied.",
          relativeWeight: "major",
        },
        {
          sectionId: "beat:worked-example",
          title: "One real week, start to finish",
          role: "DEMONSTRATION",
          purpose: "Run the whole sequence on a realistic roster, including one dropout.",
          viewerQuestion: "What does this look like on a week like mine?",
          valueDelivered: "Proof that the sequence survives a real week and an unplanned change.",
          evidenceRequired: [],
          claimIds: [],
          informationToCommunicate: ["The starting roster and its constraints", "Where the first gap appears", "How one dropout is absorbed without a rebuild"],
          transitionIntent: "Move from the demonstration to the viewer's own next week.",
          retentionRisk: "Grid detail can outpace what the viewer can read on a phone.",
          visualTreatment: "Live grid with each gap highlighted as it surfaces.",
          relativeWeight: "major",
        },
        {
          sectionId: "beat:payoff",
          title: "Running it on your week",
          role: "PAYOFF",
          purpose: "Hand the viewer the sequence in a form they can use immediately.",
          viewerQuestion: "What do I do on Monday?",
          valueDelivered: "A method the viewer can run this week without rewatching.",
          evidenceRequired: [],
          claimIds: [],
          informationToCommunicate: ["The five steps restated compactly", "The one step people skip and what it costs"],
          transitionIntent: "Close on the method rather than on a pitch.",
          retentionRisk: "Ending on caveats instead of the usable sequence.",
          visualTreatment: "The five steps on one screen beside the completed week.",
          relativeWeight: "moderate",
        },
      ],
      payoffLocation: "beat:payoff",
    },
    hookStrategy: {
      audienceTension: "The viewer has built a schedule that looked complete and still spent the week fixing it.",
      curiosityMechanism: "Show a finished-looking grid and reveal the uncovered hours already hiding in it.",
      problemOrOpportunity: "Coverage gaps discovered after publishing instead of during scheduling.",
      expectedPayoff: "The sequence that surfaces those gaps while the schedule is still a draft.",
      payoffLocation: "beat:worked-example",
      credibilityNeed: "Establish quickly that this is a real roster with real constraints, not a toy example.",
      communicateImmediately: ["This is a scheduling method, demonstrated", "The gap is in the order you work, not the effort"],
      risks: ["Implying the method eliminates gaps rather than surfacing them earlier"],
      concepts: [
        {
          conceptId: "hook:hidden-gap",
          approach: "Open on a completed-looking weekly grid, then highlight the hours nobody is covering.",
          rationale: "Creates a specific, visual tension the viewer has personally experienced, without overstating the outcome.",
          payoffAlignment: "The same grid is rebuilt correctly during the worked example, so the opening tension is directly resolved on screen.",
          deceptionRisk: "none",
        },
      ],
    },
    retentionArchitecture: {
      earlyAbandonmentRisks: ["Viewers who already accept the premise may leave during the problem framing"],
      dragRisks: [
        { sectionId: "beat:model", risk: "Five steps in sequence can flatten into a list.", mitigation: "Apply each step to the running week as it is introduced rather than explaining all five first." },
      ],
      informationOrderDecisions: ["The failure mode is shown before the sequence, so each step visibly earns its position"],
      proofTiming: "The first uncovered block surfaces early in the worked example rather than at the end.",
      demonstrationTiming: "The grid appears as soon as the first step is introduced.",
      openQuestionSequencing: ["Which step do people skip, and what does skipping it cost?"],
      patternChanges: ["Switch from talking head to screen share at the first step"],
      cognitiveLoadRisks: ["Five steps plus a live grid is close to the limit for one sitting"],
      payoffTiming: "The viewer can run the sequence before the final beat ends.",
    },
    ctaStrategy: {
      objective: "FREE_RESOURCE",
      rationale: "The sequence is more useful as a one-page checklist beside the grid than as something the viewer retypes from memory.",
      placement: "After the payoff, once the method has already been delivered in full.",
      viewerBenefit: "Runs the same sequence next week without rewatching the video.",
      trustRisk: "Would become intrusive if the checklist were gated before the method was delivered.",
    },
    monetizationAlignment: {
      relevance: "NONE",
      label: null,
      rationale: "The upstream topic notes scheduling-software sponsorship may fit later, but recommending a tool now would imply a comparison this video has not done.",
      sponsorCategory: null,
      affiliateRelevance: null,
      leadMagnetOpportunity: null,
      paidProductAlignment: null,
      viewerValueImpact: "none",
      viewerValueImpactRationale: "Nothing is being sold, so nothing competes with the method the viewer came for.",
    },
    supportingResource: {
      resourceKind: "CHECKLIST",
      label: null,
      concept: "A one-page checklist of the five steps with the gap sweep as the final item.",
      viewerBenefit: "Turns a watched demonstration into a weekly routine.",
      whyItImprovesTheVideo: "The video teaches a sequence; the checklist is where the sequence actually gets used.",
      placement: "Offered after the payoff beat.",
      pricingRecommendation: "FREE",
      pricingRationale: "Gating the sequence would undercut the promise the video already delivered.",
    },
    viewerValue: viewerValueFixture(),
    risks: [
      { risk: "The weekly time-lost figure is not yet evidenced.", severity: "medium", mitigation: "Marked RESEARCH_REQUIRED; the script must not assert a number until it is established." },
      { risk: "A roster that is too simple would undercut the credibility of the demonstration.", severity: "low", mitigation: "Prepare a roster with genuine conflicting constraints." },
    ],
    assumptions: ["The viewer builds the rota themselves rather than delegating it"],
    openQuestions: ["Does this audience skew toward shift teams of under five or over fifteen?"],
    recommendedNextAction: "Establish the weekly time-lost range, prepare the demonstration roster, then proceed to packaging and script.",
    upstreamContentIntelligence: approvedContentReferenceFixture,
    selectedTopic: selectionFixture,
    crossModelReview: null,
    modelProvenance: [
      { provider: "openai", model: "test-generator", role: "GENERATOR", operation: "video_brief_viewer_promise", invokedAt: "2026-08-15T10:01:00.000Z" },
      { provider: "openai", model: "test-generator", role: "GENERATOR", operation: "video_brief_synthesis", invokedAt: "2026-08-15T10:02:00.000Z" },
    ],
  };
  return channelVideoBriefResultSchema.parse({ ...base, ...overrides });
}

export const EVIDENCE_IDS = EVIDENCE;
/** QA findings reuse the research finding schema, which permits only video/channel IDs. */
export const CITABLE_QA_EVIDENCE_ID = discoveryBundleFixture.evidence.find((item) => item.sourceType === "video")!.id;
