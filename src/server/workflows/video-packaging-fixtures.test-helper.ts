import { createHash } from "node:crypto";
import {
  approvedVideoScriptArtifactSchema,
  channelVideoPackagingResultSchema,
  type ApprovedVideoScriptArtifact,
  type ApprovedVideoScriptReference,
  type ChannelVideoPackagingResult,
  type SelectedVideoScriptScope,
} from "@/domain/production-workflows";
import { canonicalJson } from "./canonical-json";
import { discoveryBundleFixture, viewerValueFixture } from "./content-fixtures.test-helper";
import { selectedTopicFixture } from "./video-brief-fixtures.test-helper";
import { videoScriptResultFixture } from "./video-script-fixtures.test-helper";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** The approved script this packaging vertical consumes. */
export const scriptResultFixture = videoScriptResultFixture();

const SCRIPT_RUN_ID = "8b3d1e0f-2c4b-4d3f-8b2e-3d5e6f7a8c01";

export const approvedVideoScriptReferenceFixture: ApprovedVideoScriptReference = {
  scriptWorkflowId: "8b3d1e0f-2c4b-4d3f-8b2e-3d5e6f7a8c00",
  scriptRunId: SCRIPT_RUN_ID,
  workflowDefinitionVersion: 1,
  outputSchemaVersion: 1,
  approvalId: "8b3d1e0f-2c4b-4d3f-8b2e-3d5e6f7a8c02",
  approvedBy: "8b3d1e0f-2c4b-4d3f-8b2e-3d5e6f7a8c03",
  approvedAt: "2026-08-17T10:00:00.000Z",
  finalQaState: "accept",
  finalQaScore: 88,
  scriptArtifactHash: "3".repeat(64),
  scriptProvenanceHash: "4".repeat(64),
  parentRunId: null,
  rootRunId: SCRIPT_RUN_ID,
  upstreamVideoBrief: scriptResultFixture.upstreamVideoBrief,
};

export const packagingScopeFixture: SelectedVideoScriptScope = {
  scriptTopicId: scriptResultFixture.scriptScope.briefTopicId,
  pillarId: scriptResultFixture.scriptScope.pillarId,
  scriptDurationSeconds: scriptResultFixture.timing.totalDurationSeconds,
  scriptTiming: scriptResultFixture.sections
    .map((section) => ({ sectionId: section.sectionId, title: section.title, startSeconds: section.startSeconds, durationSeconds: section.durationSeconds }))
    .sort((left, right) => left.startSeconds - right.startSeconds),
  inheritedViewerValueProvenance: {
    originStage: "SCRIPT",
    originWorkflowType: "CHANNEL_VIDEO_SCRIPT",
    originRunId: SCRIPT_RUN_ID,
    subjectId: scriptResultFixture.scriptScope.briefTopicId,
    contractHash: sha256(canonicalJson(scriptResultFixture.viewerValue.contract)),
    gate: "PASS",
    assessedAt: "2026-08-17T10:00:00.000Z",
  },
};

export const approvedVideoScriptArtifactFixture: ApprovedVideoScriptArtifact =
  approvedVideoScriptArtifactSchema.parse({
    reference: approvedVideoScriptReferenceFixture,
    scriptResult: scriptResultFixture,
    discoveryBundle: discoveryBundleFixture,
    scope: packagingScopeFixture,
  });

const OWN_PILLAR_EVIDENCE = discoveryBundleFixture.evidence
  .filter((item) => item.pillarId === selectedTopicFixture.pillarId)
  .map((item) => item.id);

/**
 * A complete, deterministically clean packaging artifact for the approved
 * scheduling script. Tests mutate one field at a time so a failure names exactly
 * one rule. Every chapter's start time equals a real script section's start time,
 * the packaged promise matches the script's promise verbatim, and no title is
 * selected and no thumbnail image is generated.
 */
export function videoPackagingResultFixture(overrides: Partial<ChannelVideoPackagingResult> = {}): ChannelVideoPackagingResult {
  const base: ChannelVideoPackagingResult = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_PACKAGING",
    source: {
      scriptTopicId: scriptResultFixture.scriptScope.briefTopicId,
      pillarId: scriptResultFixture.scriptScope.pillarId,
      pillarName: "Operating systems for small service businesses",
      workingConcept: scriptResultFixture.source.workingConcept,
      packagedPromise: scriptResultFixture.source.scriptedPromise,
    },
    titleCandidates: [
      {
        candidateId: "title:order-of-operations",
        text: "The 5-Step Order That Stops Schedule Gaps Before You Publish",
        angle: "Names the concrete method and the moment it pays off.",
        rationale: "Leads with the sequence the video actually delivers rather than a vague benefit.",
        promiseAlignment: "Promises exactly the five-step order the script builds, no more.",
        curiosityMechanism: "Implies a specific ordering most people get wrong.",
        deceptionRisk: "none",
        evidenceIds: OWN_PILLAR_EVIDENCE.slice(0, 1),
      },
      {
        candidateId: "title:full-grid-breaks",
        text: "Why Your Full-Looking Staff Schedule Still Breaks by Wednesday",
        angle: "Opens on the recognizable failure the script's hook uses.",
        rationale: "Mirrors the script's opening tension without overstating the outcome.",
        promiseAlignment: "The video explains and fixes exactly this failure.",
        curiosityMechanism: "A familiar, specific pain the viewer has felt.",
        deceptionRisk: "none",
        evidenceIds: [],
      },
      {
        candidateId: "title:one-real-week",
        text: "Building One Real Staff Week, Gap-Free, Start to Finish",
        angle: "Foregrounds the end-to-end demonstration.",
        rationale: "Signals the worked example, which is the script's strongest section.",
        promiseAlignment: "The demonstration is delivered in full in the script.",
        curiosityMechanism: "Promises a complete worked example, not just principles.",
        deceptionRisk: "none",
        evidenceIds: [],
      },
    ],
    thumbnailConcepts: [
      {
        conceptId: "thumb:hidden-gap",
        copyText: "The gap was already there",
        visualIntent: "A completed weekly grid with one block of hours glowing red to mark the uncovered slot; presenter pointing at it.",
        rationale: "Shows the exact tension the opening hook creates, in one glance.",
        promiseAlignment: "The red gap is the problem the video resolves on screen.",
        deceptionRisk: "none",
        evidenceIds: OWN_PILLAR_EVIDENCE.slice(0, 1),
      },
      {
        conceptId: "thumb:five-steps",
        copyText: "1 2 3 4 5",
        visualIntent: "The five numbered steps laid beside a clean weekly grid, the fifth (the sweep) circled.",
        rationale: "Communicates the method's structure and that the sweep is the key step.",
        promiseAlignment: "The five steps are exactly what the script teaches.",
        deceptionRisk: "none",
        evidenceIds: [],
      },
    ],
    description: {
      summary: "Build next week's staff schedule in a fixed five-step order that surfaces coverage gaps before you publish it, not after.",
      body: "Most scheduling advice stops at why coverage matters. This video does the part nobody shows: it builds one real week, in a fixed order of operations, so the gaps appear while the schedule is still a draft. You will see the five steps applied to a genuine roster, including how the sequence absorbs one mid-week dropout without a rebuild. Chapters follow the script's own structure so you can jump straight to the worked example.",
      keywords: ["staff scheduling", "employee rota", "shift planning", "small business operations"],
      resourceMentions: ["A one-page checklist of the five steps is linked in the description."],
    },
    chapters: [
      { chapterId: "chapter:opening", sourceScriptSectionId: "scriptsec:opening", startSeconds: 0, title: "The grid that still breaks" },
      { chapterId: "chapter:model", sourceScriptSectionId: "scriptsec:model", startSeconds: 25, title: "The five steps, in order" },
      { chapterId: "chapter:example", sourceScriptSectionId: "scriptsec:worked-example", startSeconds: 205, title: "One real week, start to finish" },
      { chapterId: "chapter:payoff", sourceScriptSectionId: "scriptsec:payoff", startSeconds: 445, title: "Running it on your week" },
    ],
    tags: ["staff scheduling", "employee scheduling", "shift planning", "small business", "rota", "operations", "team management"],
    endScreenPlan: {
      ctaObjective: "FREE_RESOURCE",
      rationale: "The one-page checklist lets the viewer run the sequence next week without rewatching.",
      elements: [
        { kind: "FREE_RESOURCE_LINK", label: "Five-step checklist", placement: "End screen, after the payoff beat.", viewerBenefit: "Runs the same sequence next week from one page.", trustRisk: "Would be intrusive if surfaced before the method is delivered." },
        { kind: "SUBSCRIBE_ELEMENT", label: null, placement: "End screen, secondary.", viewerBenefit: "More operating-systems walkthroughs for small service businesses.", trustRisk: null },
      ],
    },
    viewerValue: viewerValueFixture(),
    packagingIntegrity: {
      rejectedForDeception: ["A 'never lose a shift again' title was rejected because the method surfaces gaps rather than guaranteeing none."],
      summary: "Every title and thumbnail keeps the script's promise; the one over-claiming title was withheld.",
    },
    risks: [
      { risk: "A title foregrounding the demonstration may under-sell to viewers who want the principle first.", severity: "low", mitigation: "Candidate set spans both angles for the human to choose." },
    ],
    assumptions: ["The thumbnail will be produced downstream from these concepts, not from a generated image here."],
    openQuestions: ["Does this audience respond better to method-first or failure-first titles?"],
    recommendedNextAction: "Have the operator choose one title and thumbnail concept, then proceed to thumbnail production.",
    upstreamVideoScript: approvedVideoScriptReferenceFixture,
    packagingScope: packagingScopeFixture,
    crossModelReview: null,
    modelProvenance: [
      { provider: "openai", model: "test-generator", role: "GENERATOR", operation: "video_packaging_synthesis", invokedAt: "2026-08-17T10:01:00.000Z" },
    ],
  };
  return channelVideoPackagingResultSchema.parse({ ...base, ...overrides });
}

/** QA findings reuse the research finding schema, which permits only video/channel IDs. */
export const CITABLE_QA_EVIDENCE_ID = discoveryBundleFixture.evidence.find((item) => item.sourceType === "video")!.id;
