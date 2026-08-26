import { createHash } from "node:crypto";
import {
  approvedVideoBriefArtifactSchema,
  channelVideoScriptResultSchema,
  type ApprovedVideoBriefArtifact,
  type ApprovedVideoBriefReference,
  type ChannelVideoScriptResult,
  type SelectedVideoBriefScope,
} from "@/domain/production-workflows";
import { canonicalJson } from "./canonical-json";
import { discoveryBundleFixture, viewerValueFixture } from "./content-fixtures.test-helper";
import { approvedContentReferenceFixture, selectedTopicFixture, videoBriefResultFixture } from "./video-brief-fixtures.test-helper";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** The approved brief this script vertical consumes. */
export const briefResultFixture = videoBriefResultFixture();

const BRIEF_RUN_ID = "7a2c0d9e-1b3a-4c2f-9a1e-2c4d5e6f7b01";

export const approvedVideoBriefReferenceFixture: ApprovedVideoBriefReference = {
  briefWorkflowId: "7a2c0d9e-1b3a-4c2f-9a1e-2c4d5e6f7b00",
  briefRunId: BRIEF_RUN_ID,
  workflowDefinitionVersion: 1,
  outputSchemaVersion: 1,
  approvalId: "7a2c0d9e-1b3a-4c2f-9a1e-2c4d5e6f7b02",
  approvedBy: "7a2c0d9e-1b3a-4c2f-9a1e-2c4d5e6f7b03",
  approvedAt: "2026-08-16T10:00:00.000Z",
  finalQaState: "accept",
  finalQaScore: 86,
  briefArtifactHash: "1".repeat(64),
  briefProvenanceHash: "2".repeat(64),
  parentRunId: null,
  rootRunId: BRIEF_RUN_ID,
  upstreamContentIntelligence: approvedContentReferenceFixture,
};

export const scriptScopeFixture: SelectedVideoBriefScope = {
  briefTopicId: selectedTopicFixture.topicId,
  pillarId: selectedTopicFixture.pillarId,
  inheritedViewerValueProvenance: {
    originStage: "VIDEO_BRIEF",
    originWorkflowType: "CHANNEL_VIDEO_BRIEF",
    originRunId: BRIEF_RUN_ID,
    subjectId: selectedTopicFixture.topicId,
    contractHash: sha256(canonicalJson(briefResultFixture.viewerValue.contract)),
    gate: "PASS",
    assessedAt: "2026-08-16T10:00:00.000Z",
  },
};

export const approvedVideoBriefArtifactFixture: ApprovedVideoBriefArtifact =
  approvedVideoBriefArtifactSchema.parse({
    reference: approvedVideoBriefReferenceFixture,
    briefResult: briefResultFixture,
    discoveryBundle: discoveryBundleFixture,
    scope: scriptScopeFixture,
  });

const OWN_PILLAR_EVIDENCE = discoveryBundleFixture.evidence
  .filter((item) => item.pillarId === selectedTopicFixture.pillarId)
  .map((item) => item.id);

/**
 * A complete, deterministically clean video script for the approved scheduling
 * brief. Tests mutate one field at a time so a failure names exactly one rule.
 * Section start times and durations form a contiguous timeline that sums to the
 * reported total, every brief beat is covered, and every inherited claim is
 * handled at its correct evidence status.
 */
export function videoScriptResultFixture(overrides: Partial<ChannelVideoScriptResult> = {}): ChannelVideoScriptResult {
  const base: ChannelVideoScriptResult = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_SCRIPT",
    source: {
      briefTopicId: selectedTopicFixture.topicId,
      pillarId: selectedTopicFixture.pillarId,
      pillarName: "Operating systems for small service businesses",
      workingConcept: selectedTopicFixture.workingConcept,
      scriptedPromise: briefResultFixture.viewerPromise.statement,
      coveredBriefBeatIds: ["beat:opening", "beat:model", "beat:worked-example", "beat:payoff"],
    },
    openingHook: {
      sectionId: "scriptsec:opening",
      briefBeatId: "beat:opening",
      spokenOpening: "You built this week's schedule, every shift looks filled, and by Wednesday you are on the phone covering a gap you never saw. That gap was there on Sunday — you just had no way to spot it while the grid still looked full.",
      onScreenText: "The gap was there before you published.",
      durationSeconds: 14,
      curiosityMechanism: "Show a finished-looking grid, then reveal the uncovered hours already hiding in it.",
      promiseEchoed: true,
      deceptionRisk: "none",
      claimIds: ["claim:principle-level-coverage"],
    },
    sections: [
      {
        sectionId: "scriptsec:opening",
        briefBeatId: "beat:opening",
        title: "The full-looking grid that still breaks",
        role: "OPENING",
        narration: "You built this week's schedule, every shift looks filled, and by Wednesday you are covering a gap you never saw. Most scheduling advice stops at why coverage matters. We are going to do the part nobody shows: build one real week in a fixed order that surfaces the gaps while the schedule is still a draft.",
        onScreenText: "Order of operations, not more effort.",
        visualDirection: "Open on a completed weekly grid, then highlight the uncovered hours.",
        startSeconds: 0,
        durationSeconds: 25,
        deliversValue: "Immediate recognition that the problem is ordering, not effort.",
        retentionTechnique: "Concrete recognition of the viewer's own recurring failure.",
        claimIds: ["claim:principle-level-coverage"],
        evidenceIds: OWN_PILLAR_EVIDENCE.slice(0, 1),
      },
      {
        sectionId: "scriptsec:model",
        briefBeatId: "beat:model",
        title: "The five steps, in order",
        role: "CORE",
        narration: "Here is the sequence. First, place fixed commitments — the shifts that cannot move. Second, fill the hardest-to-cover slots while you still have the most people available. Third, apply skills constraints. Fourth, layer in preferences. Fifth, run a gap sweep before you publish. The order matters because the expensive gaps hide in the slots you fill last, and by then your options are gone. How much time this saves each week depends on your team, so we are not going to put a number on it — but the sweep is what turns a full-looking grid into one you can trust.",
        onScreenText: "1 Fixed · 2 Hardest · 3 Skills · 4 Preferences · 5 Sweep",
        visualDirection: "Highlight each step on the grid as it is introduced.",
        startSeconds: 25,
        durationSeconds: 180,
        deliversValue: "The reusable five-step sequence.",
        retentionTechnique: "Apply each step to the running week rather than listing all five first.",
        claimIds: ["claim:principle-level-coverage", "claim:hours-lost-weekly"],
        evidenceIds: OWN_PILLAR_EVIDENCE.slice(0, 2),
      },
      {
        sectionId: "scriptsec:worked-example",
        briefBeatId: "beat:worked-example",
        title: "One real week, start to finish",
        role: "DEMONSTRATION",
        narration: "Let's run it. Here is a real roster with genuine constraints. Watch what happens at step two: the moment we place the hardest slots, an uncovered block appears on Thursday evening — while the schedule is still a draft, which is exactly when it is cheap to fix. Now let's remove one person mid-week and watch the sequence absorb the change without rebuilding the whole grid.",
        onScreenText: null,
        visualDirection: "Live grid; highlight each gap as it surfaces; then show a dropout being absorbed.",
        startSeconds: 205,
        durationSeconds: 240,
        deliversValue: "Proof the sequence survives a real week and an unplanned change.",
        retentionTechnique: "A visible gap surfaces early rather than at the end.",
        claimIds: [],
        evidenceIds: [],
      },
      {
        sectionId: "scriptsec:payoff",
        briefBeatId: "beat:payoff",
        title: "Running it on your week",
        role: "PAYOFF",
        narration: "So on Monday: fixed commitments first, hardest slots next, then skills, then preferences, then the gap sweep before you publish. The step people skip is the sweep, and skipping it is exactly how the invisible gap gets through. Run the five in order this week and the gaps show up while you can still fix them for free.",
        onScreenText: "Sweep before you publish.",
        visualDirection: "The five steps beside the completed week.",
        startSeconds: 445,
        durationSeconds: 60,
        deliversValue: "A method the viewer can run this week without rewatching.",
        retentionTechnique: "Close on the usable sequence rather than caveats.",
        claimIds: [],
        evidenceIds: [],
      },
    ],
    claimUsage: [
      {
        claimId: "claim:principle-level-coverage",
        inheritedStatus: "SUPPORTED",
        treatment: "ASSERTED_AS_FACT",
        scriptSectionIds: ["scriptsec:opening", "scriptsec:model"],
        rationale: "Directly observable in the retrieved comparable content, so it may be stated plainly.",
      },
      {
        claimId: "claim:hours-lost-weekly",
        inheritedStatus: "RESEARCH_REQUIRED",
        treatment: "HEDGED",
        scriptSectionIds: ["scriptsec:model"],
        rationale: "No retrieved source measures time spent scheduling, so the script explicitly declines to put a number on it.",
      },
      {
        claimId: "claim:no-gaps-guarantee",
        inheritedStatus: "MUST_NOT_CLAIM",
        treatment: "OMITTED",
        scriptSectionIds: [],
        rationale: "Unsupportable and against the method's own value; never spoken.",
      },
    ],
    timing: {
      totalDurationSeconds: 505,
      estimatedWordCount: 1300,
      wordsPerMinute: 150,
      pacingNote: "Measured throughout, with the demonstration given the most room to land.",
    },
    callToAction: {
      objective: "FREE_RESOURCE",
      spokenCta: "The five steps are on a one-page checklist in the description — grab it and run the sweep next week.",
      placementSectionId: "scriptsec:payoff",
      viewerBenefit: "Runs the same sequence next week without rewatching.",
      trustRisk: "Would be intrusive if the checklist were gated before the method was delivered.",
    },
    viewerValue: viewerValueFixture(),
    evidenceDiscipline: {
      researchRequiredClaimsDeferred: ["claim:hours-lost-weekly"],
      mustNotClaimOmitted: ["claim:no-gaps-guarantee"],
      summary: "The one unquantified claim is hedged rather than numbered, and the no-gaps guarantee is omitted entirely.",
    },
    risks: [
      { risk: "A roster that is too simple would undercut the demonstration.", severity: "low", mitigation: "Use a roster with genuine conflicting constraints." },
    ],
    assumptions: ["The viewer builds the rota themselves rather than delegating it."],
    openQuestions: ["Does this audience skew toward shift teams under five or over fifteen?"],
    recommendedNextAction: "Proceed to packaging once the script is approved.",
    upstreamVideoBrief: approvedVideoBriefReferenceFixture,
    scriptScope: scriptScopeFixture,
    crossModelReview: null,
    modelProvenance: [
      { provider: "openai", model: "test-generator", role: "GENERATOR", operation: "video_script_synthesis", invokedAt: "2026-08-16T10:01:00.000Z" },
    ],
  };
  return channelVideoScriptResultSchema.parse({ ...base, ...overrides });
}

/** QA findings reuse the research finding schema, which permits only video/channel IDs. */
export const CITABLE_QA_EVIDENCE_ID = discoveryBundleFixture.evidence.find((item) => item.sourceType === "video")!.id;
