/**
 * View-model for the Phase B navigation shell and Channel Command Center.
 *
 * This is a presentation contract, not a persisted entity. Production work has
 * no Channel or Video record (`workflows.channel_id` is never written), so a
 * future read-model must derive both from approved-artifact lineage. Until that
 * read-model exists, only fixtures fill this shape, and every field that would
 * need it says so through an explicit section state rather than a guess.
 */

/** The loop position a stage occupies inside one video's lineage. */
export const VIDEO_STAGES = [
  { key: "BRIEF", label: "Brief", side: "make" },
  { key: "SCRIPT", label: "Script", side: "make" },
  { key: "PACKAGING", label: "Packaging", side: "make" },
  { key: "RELEASE", label: "Release", side: "make" },
  { key: "PERFORMANCE", label: "Performance", side: "learn" },
  { key: "DIAGNOSIS", label: "Diagnosis", side: "learn" },
  { key: "DECISION", label: "Decision", side: "learn" },
  { key: "EXPERIMENT", label: "Experiment", side: "learn" },
] as const;

export type VideoStageKey = (typeof VIDEO_STAGES)[number]["key"];
export type ChannelStageKey = "RESEARCH" | "STRATEGY" | "CONTENT_PLAN" | "PORTFOLIO" | "INTELLIGENCE";
/** Pre-research concept validation: it belongs to no channel and has no screen here. */
export type AccountStageKey = "CONCEPT_VALIDATION";
export type StageKey = VideoStageKey | ChannelStageKey | AccountStageKey;

/** done = an approved version exists; you = a gate waits on the operator; system = queued or running; recover = failed or blocked. */
export type StageCellState = "done" | "you" | "system" | "recover" | "none";

/**
 * Whether the product has a screen where the operator can act on this stage.
 * Diagnosis, Decision, Experiment, Portfolio, Intelligence and Concept
 * Validation have backends and gates but no workspace yet.
 */
export type SurfaceAvailability = "available" | "unavailable";

/**
 * How confidently a work item is attributed to this channel and video.
 * `ambiguous` means lineage did not resolve to exactly one parent; the item is
 * shown as unattributed and is never ranked inside a channel.
 */
export type Attribution =
  | { status: "resolved" }
  | { status: "ambiguous"; reason: string };

/** Every Command Center section renders exactly one of these states. */
export type SectionState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "empty"; message: string; action?: { label: string; href: string } }
  | { status: "unavailable"; message: string; dependency: string }
  | { status: "error"; message: string; requestId: string };

export interface ChannelIdentity {
  /** No production field holds a channel name; the label comes from research input. */
  label: string;
  labelSource: "research-niche" | "research-concept";
  thesis: string | null;
  strategyVersion: number | null;
  strategyApprovedAt: string | null;
  revenuePathCount: number | null;
  lastReview: { outcome: "HOLD" | "REVISE" | "INSUFFICIENT_EVIDENCE"; at: string } | null;
}

export interface PendingGate {
  approvalId: string;
  workflowId: string;
  runId: string;
  stage: StageKey;
  version: number;
  supersedesVersion: number | null;
  subject: string;
  note: string;
  requestedAt: string;
  surface: SurfaceAvailability;
  attribution: Attribution;
}

export interface VideoInFlight {
  /** The Brief workflow that roots this video's lineage. */
  rootWorkflowId: string;
  title: string;
  cells: Record<VideoStageKey, StageCellState>;
  currentStage: VideoStageKey;
  stateLabel: string;
  waitingOn: "you" | "system" | "nobody";
  waitingLabel: string;
  updatedAt: string;
  attribution: Attribution;
}

/**
 * Work the operator can start that is not an approval gate. `dueAt` is null
 * when no rule defines when the task becomes due (measurement timing, D5);
 * `dueUnavailable` says why, when the reason is known.
 */
export interface OperatorTask {
  id: string;
  kind: "RECORD_PERFORMANCE" | "START_DIAGNOSIS" | "START_EXPERIMENT" | "START_BRIEF" | "START_RESEARCH" | "RESOLVE_FAILURE";
  stage: StageKey;
  subject: string;
  detail: string;
  href: string;
  dueAt: string | null;
  dueUnavailable?: "NO_PUBLICATION_DATE" | "NO_DUE_RULE";
  createdAt: string;
  surface: SurfaceAvailability;
  attribution: Attribution;
}

export interface LearningItem {
  id: string;
  kind: "HYPOTHESIS" | "EXPERIMENT" | "LESSON" | "STRATEGY_REVIEW";
  outcome: "SUPPORTED" | "NOT_SUPPORTED" | "INCONCLUSIVE" | "RUNNING" | "ADOPTED" | "HELD" | "HOLD";
  statement: string;
  source: string;
}

export interface PerformanceRow {
  videoTitle: string;
  views: number | null;
  averageViewedPct: number | null;
  /** NOT_ASSESSED: measured, but no comparison against plan was recorded. */
  versusPlan: "ABOVE" | "ON_PLAN" | "BELOW" | "NOT_ENTERED" | "NOT_ASSESSED";
}

/** A pending approval that cannot be shown as a gate, or an unresolved workflow outside any video. */
export interface UnattributedWork {
  id: string;
  kind: "Gate" | "Workflow";
  title: string;
  reason: string;
}

export interface CommandCenterView {
  scenario: string;
  channel: SectionState<ChannelIdentity>;
  gates: SectionState<PendingGate[]>;
  videos: SectionState<VideoInFlight[]>;
  tasks: OperatorTask[];
  learning: SectionState<LearningItem[]>;
  performance: SectionState<PerformanceRow[]>;
  /** Pending gates across all channels, for the global Approvals badge. */
  globalPendingCount: number | null;
  /** Unattributed work that is neither a video nor a gate shown above, named with its reason. */
  unattributedWork?: UnattributedWork[];
  /** The moment "now" is evaluated against, so ranking is deterministic. */
  asOf: string;
}

export const STAGE_LABEL: Record<StageKey, string> = {
  BRIEF: "Brief", SCRIPT: "Script", PACKAGING: "Packaging", RELEASE: "Release",
  PERFORMANCE: "Performance", DIAGNOSIS: "Diagnosis", DECISION: "Decision", EXPERIMENT: "Experiment",
  RESEARCH: "Research", STRATEGY: "Strategy", CONTENT_PLAN: "Content plan", PORTFOLIO: "Portfolio", INTELLIGENCE: "Channel intelligence",
  CONCEPT_VALIDATION: "Concept validation",
};
