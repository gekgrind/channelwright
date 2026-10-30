/**
 * The review kinds the shared ReviewScreen can decide on, keyed by workflow
 * type. The copy states only what `decide_workflow_approval` and each stage's
 * merged contract actually do:
 *
 * - APPROVE completes the run and records the approval; nothing else runs.
 * - REJECT cancels the approval, run, and workflow; the approved upstream it
 *   was built from is untouched.
 * - REQUEST_REVISION blocks the run and queues a successor run that re-runs
 *   every step of the workflow with the note, i.e. another AI generation run
 *   that uses paid model calls once a worker executes it.
 *
 * Diagnosis, Decision, and Experiment have no screen yet; their kinds exist so
 * those screens mount this same component instead of forking it.
 */
export type ReviewKind = {
  /** Lowercase noun for the reviewed artifact, e.g. "script". */
  noun: string;
  /** Capitalized noun used in version labels, e.g. "Script" → "Script v2". */
  versionNoun: string;
  /** What approval records, and what it does not do. */
  approves: string;
  /** What stays true after a rejection. */
  rejectKeeps: string;
  /** The revision run also repeats YouTube retrieval, which uses provider quota. */
  revisionRetrieves?: boolean;
};

export const REVIEW_KINDS = {
  CHANNEL_RESEARCH: {
    noun: "research run", versionNoun: "Research run",
    approves: "Approval accepts this exact research run as the evidence base for strategy.",
    rejectKeeps: "Nothing upstream changes. To try again, start a new research run (paid).",
    revisionRetrieves: true,
  },
  CHANNEL_STRATEGY: {
    noun: "strategy", versionNoun: "Strategy run",
    approves: "Approval accepts this exact strategy. Exact-version lineage stays immutable.",
    rejectKeeps: "The approved research it was built from stays approved. To try again, start a new strategy from it (paid).",
  },
  CHANNEL_CONTENT_INTELLIGENCE: {
    noun: "backlog", versionNoun: "Backlog run",
    approves: "Approval accepts this exact backlog. Only approved backlogs can feed a video brief.",
    rejectKeeps: "The approved strategy it was built from stays approved. To try again, start a new backlog from it (paid).",
    revisionRetrieves: true,
  },
  CHANNEL_VIDEO_BRIEF: {
    noun: "brief", versionNoun: "Brief",
    approves: "Approval accepts the creative and production direction. It does not mean the video is ready to produce, export, or publish.",
    rejectKeeps: "The approved content plan topic stays approved. To try again, start a new brief from it (paid).",
  },
  CHANNEL_VIDEO_SCRIPT: {
    noun: "script", versionNoun: "Script",
    approves: "Approval accepts the script. It does not package, render, or publish anything.",
    rejectKeeps: "The approved brief it was built from stays approved. To try again, start a new script from it (paid).",
  },
  CHANNEL_VIDEO_PACKAGING: {
    noun: "packaging", versionNoun: "Packaging",
    approves: "Approval accepts the packaging direction. It does not choose a title, generate a thumbnail, or publish anything.",
    rejectKeeps: "The approved script it was built from stays approved. To try again, start new packaging from it (paid).",
  },
  CHANNEL_VIDEO_RELEASE: {
    noun: "release", versionNoun: "Release",
    approves: "Approval records the final release decision. It does not publish, schedule, upload, or generate anything.",
    rejectKeeps: "The approved packaging it was built from stays approved. To try again, start a new release from it (paid).",
  },
  CHANNEL_VIDEO_PERFORMANCE: {
    noun: "performance record", versionNoun: "Performance record",
    approves: "Approval records the immutable performance learning record. It changes nothing about the published video.",
    rejectKeeps: "The approved release it measures stays approved. To try again, start a new performance record for it (paid).",
  },
  CHANNEL_VIDEO_DIAGNOSIS: {
    noun: "diagnosis", versionNoun: "Diagnosis",
    approves: "Approval records this diagnosis. It decides nothing: what to do next is a separate decision.",
    rejectKeeps: "The approved performance record it explains stays approved. To try again, start a new diagnosis from it (paid).",
  },
  CHANNEL_VIDEO_DECISION: {
    noun: "decision", versionNoun: "Decision",
    approves: "Approval records this as your decision. It runs nothing and changes no video.",
    rejectKeeps: "The approved diagnosis stays approved. To try again, start a new decision from it (paid).",
  },
  CHANNEL_VIDEO_EXPERIMENT: {
    noun: "experiment plan", versionNoun: "Experiment plan",
    approves: "Approval records this plan as approved. Nothing is run, scheduled, or measured, and Channelwright cannot collect its results.",
    rejectKeeps: "The approved decision it tests stays approved. To try again, start a new experiment plan from it (paid).",
  },
} as const satisfies Record<string, ReviewKind>;

export type ReviewKindKey = keyof typeof REVIEW_KINDS;

/** "Script v2", or "this script" when the version cannot be derived. */
export function reviewVersionLabel(kind: ReviewKind, versionNumber: number | undefined) {
  return versionNumber ? `${kind.versionNoun} v${versionNumber}` : `this ${kind.noun}`;
}
