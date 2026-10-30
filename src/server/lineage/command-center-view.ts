import { deterministicViewerValueGate, resolveViewerValueGate, viewerValueAssessmentSchema } from "@/domain/viewer-value";
import {
  STAGE_LABEL, VIDEO_STAGES,
  type Attribution, type ChannelIdentity, type CommandCenterView, type OperatorTask, type PendingGate, type PerformanceRow,
  type SectionState, type StageCellState, type StageKey, type VideoInFlight, type VideoStageKey,
} from "@/features/command-center/model";
import { CURRENT_STUDIO_ANCHOR, parseInstant } from "@/features/command-center/next-decision";
import type { LineageRows, LineageRunRow, LineageWorkflowRow } from "./lineage-rows";
import type { StageOutputRequest, StageOutputsLoad } from "./load-stage-outputs";
import type { LineageAttribution, LineageGraph } from "./resolve-lineage";

/**
 * Maps the lineage graph of one channel onto the unchanged Command Center
 * contract. Pure: the same inputs and `asOf` give the same view.
 *
 * Every channel view also carries the account-level unresolved work (pending
 * gates and videos that trace to no single channel) as `ambiguous`, so the
 * page names and counts it without ever ranking it or claiming it.
 */

export interface LiveInputs {
  rows: LineageRows;
  graph: LineageGraph;
  /** Set when pending approvals failed to load; the graph was then built without them. */
  approvalsError: { requestId: string } | null;
  outputs: StageOutputsLoad;
}

const STAGE_OF: Record<string, StageKey> = {
  CHANNEL_RESEARCH: "RESEARCH", CHANNEL_STRATEGY: "STRATEGY", CHANNEL_CONTENT_INTELLIGENCE: "CONTENT_PLAN",
  CHANNEL_VIDEO_BRIEF: "BRIEF", CHANNEL_VIDEO_SCRIPT: "SCRIPT", CHANNEL_VIDEO_PACKAGING: "PACKAGING", CHANNEL_VIDEO_RELEASE: "RELEASE",
  CHANNEL_VIDEO_PERFORMANCE: "PERFORMANCE", CHANNEL_VIDEO_DIAGNOSIS: "DIAGNOSIS", CHANNEL_VIDEO_DECISION: "DECISION",
  CHANNEL_VIDEO_EXPERIMENT: "EXPERIMENT", CHANNEL_VIDEO_PORTFOLIO: "PORTFOLIO", CHANNEL_VIDEO_INTELLIGENCE: "INTELLIGENCE",
  CHANNEL_CONCEPT_VALIDATION: "CONCEPT_VALIDATION",
};
const TYPE_OF_VIDEO_STAGE = Object.fromEntries(Object.entries(STAGE_OF).map(([type, stage]) => [stage, type])) as Record<VideoStageKey, string>;
/** Workflow statuses that mean measurement is already under way or done for a release. */
const MEASUREMENT_TAKEN = new Set(["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "BLOCKED", "PAUSED", "COMPLETED", "FAILED"]);
const CELL_WORDS: Record<StageCellState, string> = { done: "approved", you: "review", system: "running", recover: "needs recovery", none: "not started" };

const ascending = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const instant = (iso: string | null) => parseInstant(iso) ?? Number.NEGATIVE_INFINITY;
/** Latest first by a timestamp, then by id, so ties and invalid times stay deterministic. */
const latestFirst = <T>(at: (item: T) => string | null, id: (item: T) => string) => (left: T, right: T) =>
  instant(at(right)) - instant(at(left)) || ascending(id(left), id(right));

const anchorOf = (stage: StageKey) => CURRENT_STUDIO_ANCHOR[stage] ?? null;
const surfaceOf = (stage: StageKey) => (anchorOf(stage) ? "available" : "unavailable") as PendingGate["surface"];
const toAttribution = (attribution: LineageAttribution | undefined): Attribution =>
  attribution?.status === "resolved" ? { status: "resolved" } : { status: "ambiguous", reason: attribution?.reason ?? "its lineage could not be read" };

function cellOf(workflow: LineageWorkflowRow | undefined): StageCellState {
  switch (workflow?.status) {
    case "COMPLETED": return "done";
    case "WAITING_FOR_APPROVAL": return "you";
    case "QUEUED": case "RUNNING": case "PAUSED": return "system";
    case "FAILED": case "BLOCKED": return "recover";
    default: return "none";
  }
}

/** Indexes shared by the output selector and the mapper, so both choose the same runs. */
class Index {
  readonly workflows: Map<string, LineageWorkflowRow>;
  readonly runs: Map<string, LineageRunRow>;
  readonly runsByWorkflow = new Map<string, LineageRunRow[]>();
  readonly approvedAt = new Map<string, string>();

  constructor(readonly rows: LineageRows, readonly graph: LineageGraph) {
    this.workflows = new Map(rows.workflows.map((row) => [row.id, row]));
    this.runs = new Map(rows.runs.map((row) => [row.id, row]));
    for (const run of rows.runs) this.runsByWorkflow.set(run.workflowId, [...(this.runsByWorkflow.get(run.workflowId) ?? []), run]);
    for (const approval of rows.approvals) if (approval.status === "APPROVED" && approval.decidedAt) this.approvedAt.set(approval.runId, approval.decidedAt);
  }

  /** The workflow's current run, else its newest run. */
  currentRun(workflow: LineageWorkflowRow): LineageRunRow | null {
    const current = workflow.currentRunId ? this.runs.get(workflow.currentRunId) : undefined;
    if (current && current.workflowId === workflow.id) return current;
    return [...(this.runsByWorkflow.get(workflow.id) ?? [])].sort(latestFirst((run) => run.createdAt, (run) => run.id))[0] ?? null;
  }

  inChannel(channelKey: string, type?: string) {
    return [...this.workflows.values()].filter((workflow) => {
      const attribution = this.graph.workflows[workflow.id];
      return attribution?.status === "resolved" && attribution.channelKey === channelKey && (!type || workflow.workflowType === type);
    });
  }

  /** The newest approved, completed run of a stage in the channel, by approval time. */
  latestApproved(channelKey: string, type: string): LineageRunRow | null {
    const candidates = this.inChannel(channelKey, type)
      .filter((workflow) => workflow.status === "COMPLETED")
      .map((workflow) => this.currentRun(workflow))
      .filter((run): run is LineageRunRow => run !== null && run.status === "COMPLETED");
    return candidates.sort(latestFirst((run) => this.approvedAt.get(run.id) ?? run.completedAt, (run) => run.id))[0] ?? null;
  }

  /** The content run and topic a brief was started from. */
  briefSource(brief: LineageWorkflowRow) {
    const input = this.currentRun(brief)?.input ?? {};
    const reference = input.approvedContentReference as Record<string, unknown> | undefined;
    const contentRunId = typeof reference?.contentRunId === "string" ? reference.contentRunId.toLowerCase() : null;
    const topicId = typeof input.selectedTopicId === "string" ? input.selectedTopicId : null;
    return { contentRunId, topicId };
  }

  unresolvedBriefs() {
    return [...this.workflows.values()].filter((workflow) => workflow.workflowType === "CHANNEL_VIDEO_BRIEF" && this.graph.workflows[workflow.id]?.status !== "resolved");
  }
}

/** The channel with the most recent run activity, for `/c` with no key; ties break by key. */
export function mostRecentChannelKey(rows: LineageRows, graph: LineageGraph): string | null {
  const latest = new Map<string, number>(graph.channels.map((channel) => [channel.key, instant(channel.createdAt)]));
  for (const run of rows.runs) {
    const attribution = graph.workflows[run.workflowId];
    if (attribution?.status !== "resolved" || !latest.has(attribution.channelKey)) continue;
    latest.set(attribution.channelKey, Math.max(latest.get(attribution.channelKey)!, instant(run.completedAt), instant(run.createdAt)));
  }
  return [...latest.entries()].sort(([leftKey, left], [rightKey, right]) => right - left || ascending(leftKey, rightKey))[0]?.[0] ?? null;
}

/** Which stage outputs the view for this channel (or the landing) will show. */
export function stageOutputRequest(rows: LineageRows, graph: LineageGraph, channelKey: string | null): StageOutputRequest {
  const index = new Index(rows, graph);
  const briefs = [
    ...(channelKey ? index.inChannel(channelKey, "CHANNEL_VIDEO_BRIEF") : []),
    ...index.unresolvedBriefs(),
  ];
  const contentRunIds = briefs.map((brief) => index.briefSource(brief).contentRunId).filter((id): id is string => id !== null);
  if (!channelKey) return { strategyRunIds: [], contentRunIds, performanceRunIds: [] };
  const strategy = index.latestApproved(channelKey, "CHANNEL_STRATEGY");
  const content = index.latestApproved(channelKey, "CHANNEL_CONTENT_INTELLIGENCE");
  const performanceRunIds = index.inChannel(channelKey, "CHANNEL_VIDEO_PERFORMANCE")
    .filter((workflow) => workflow.status === "COMPLETED")
    .map((workflow) => index.currentRun(workflow)?.id)
    .filter((id): id is string => !!id);
  return {
    strategyRunIds: strategy ? [strategy.id] : [],
    contentRunIds: [...new Set([...contentRunIds, ...(content ? [content.id] : [])])],
    performanceRunIds,
  };
}

export function toCommandCenterView(inputs: LiveInputs, channelKey: string | null, asOf: string): CommandCenterView {
  const { rows, graph, approvalsError, outputs } = inputs;
  const index = new Index(rows, graph);
  const output = outputs.status === "ok" ? outputs.outputs : null;
  const channel = channelKey ? graph.channels.find((item) => item.key === channelKey) ?? null : null;

  const videoTitle = (briefWorkflowId: string | null) => {
    const brief = briefWorkflowId ? index.workflows.get(briefWorkflowId) : undefined;
    if (!brief) return "Untitled video";
    const { contentRunId, topicId } = index.briefSource(brief);
    const topic = contentRunId && topicId ? output?.content[contentRunId]?.topics.find((item) => item.topicId === topicId) : undefined;
    return topic?.workingConcept ?? "Untitled video";
  };

  const subjectOf = (workflowId: string) => {
    const attribution = graph.workflows[workflowId];
    if (attribution?.status !== "resolved") return `Workflow ${workflowId.slice(0, 8)}`;
    if (attribution.videoKey) return videoTitle(attribution.videoKey);
    return graph.channels.find((item) => item.key === attribution.channelKey)?.label ?? "This channel";
  };

  // Gates: this channel's, plus every account-level unresolved one.
  const gates: SectionState<PendingGate[]> = approvalsError
    ? { status: "error", message: "Pending approvals did not load. Nothing was changed.", requestId: approvalsError.requestId }
    : {
      status: "ready",
      data: graph.pendingApprovals
        .filter((approval) => approval.attribution.status !== "resolved" || approval.attribution.channelKey === channelKey)
        .flatMap((approval): PendingGate[] => {
          const workflow = index.workflows.get(approval.workflowId);
          const run = graph.runs[approval.runId];
          const stage = workflow ? STAGE_OF[workflow.workflowType] : undefined;
          // The database admits only known workflow types, so an approval without a stage
          // means its workflow row is missing; it stays in the global count and is not shown.
          if (!stage) return [];
          const requested = rows.approvals.find((item) => item.id === approval.approvalId)?.requestedAt ?? "";
          const resolved = approval.attribution.status === "resolved";
          return [{
            approvalId: approval.approvalId,
            workflowId: approval.workflowId,
            runId: approval.runId,
            stage,
            version: run?.version ?? 1,
            supersedesVersion: run?.supersedesVersion ?? null,
            subject: subjectOf(approval.workflowId),
            note: resolved ? "Waiting for your review." : "Decide it in the current Studio.",
            requestedAt: requested,
            surface: surfaceOf(stage),
            attribution: toAttribution(approval.attribution),
          }];
        }),
    };

  // Videos: this channel's, plus unresolved ones, each named.
  const buildVideo = (briefWorkflowId: string, attribution: Attribution): VideoInFlight => {
    const members = [...index.workflows.values()].filter((workflow) => {
      const lineage = graph.workflows[workflow.id];
      return workflow.id === briefWorkflowId || (lineage?.status === "resolved" && lineage.videoKey === briefWorkflowId);
    });
    const latestOf = (stage: VideoStageKey) => members
      .filter((workflow) => workflow.workflowType === TYPE_OF_VIDEO_STAGE[stage])
      .sort(latestFirst((workflow) => workflow.createdAt, (workflow) => workflow.id))[0];
    const cells = Object.fromEntries(VIDEO_STAGES.map((stage) => [stage.key, cellOf(latestOf(stage.key))])) as Record<VideoStageKey, StageCellState>;
    const currentIndex = Math.max(0, ...VIDEO_STAGES.map((stage, position) => (cells[stage.key] === "none" ? 0 : position)));
    const current = VIDEO_STAGES[currentIndex];
    const currentWorkflow = latestOf(current.key);
    const currentRun = currentWorkflow ? index.currentRun(currentWorkflow) : null;
    const version = currentRun ? graph.runs[currentRun.id]?.version ?? 1 : 1;
    const state = cells[current.key];
    const actionable = !!anchorOf(current.key);
    const waitingOn: VideoInFlight["waitingOn"] = state === "you" || state === "recover" ? "you" : state === "system" ? "system" : "nobody";
    const waitingLabel = waitingOn === "system" ? "System · running"
      : waitingOn === "nobody" ? "Nobody"
        : !actionable ? "You · not actionable here"
          : state === "recover" ? "You · needs recovery" : "You";
    const updatedAt = members
      .flatMap((workflow) => index.runsByWorkflow.get(workflow.id) ?? [])
      .map((run) => run.completedAt ?? run.createdAt)
      .sort((left, right) => instant(right) - instant(left))[0] ?? "";
    return {
      rootWorkflowId: briefWorkflowId,
      title: videoTitle(briefWorkflowId),
      cells,
      currentStage: current.key,
      stateLabel: `${String(currentIndex + 1).padStart(2, "0")} ${current.label} v${version} · ${CELL_WORDS[state]}`,
      waitingOn,
      waitingLabel,
      updatedAt,
      attribution,
    };
  };
  const channelVideos = channelKey ? graph.videos.filter((video) => video.channelKey === channelKey).map((video) => buildVideo(video.key, { status: "resolved" })) : [];
  const unresolvedVideos = index.unresolvedBriefs()
    .sort((left, right) => ascending(left.id, right.id))
    .map((brief) => buildVideo(brief.id, toAttribution(graph.workflows[brief.id])));
  const allVideos = [...channelVideos.sort(latestFirst((video) => video.updatedAt, (video) => video.rootWorkflowId)), ...unresolvedVideos];
  const videos: SectionState<VideoInFlight[]> = allVideos.length > 0
    ? { status: "ready", data: allVideos }
    : { status: "empty", message: "Nothing in production. Videos start from topics in an approved content plan." };

  const tasks: OperatorTask[] = channelKey ? channelTasks(channelKey) : [{
    id: "start-research", kind: "START_RESEARCH", stage: "RESEARCH", subject: "Research a channel opportunity",
    detail: "Describe a niche. Channelwright gathers live YouTube evidence and says whether it deserves a strategy. Nothing is produced or published.",
    href: anchorOf("RESEARCH") ?? "/studio", dueAt: null, createdAt: asOf, surface: "available", attribution: { status: "resolved" },
  }];

  function channelTasks(key: string): OperatorTask[] {
    const out: OperatorTask[] = [];
    // Recovery: every failed or blocked workflow in the channel.
    for (const workflow of index.inChannel(key)) {
      if (workflow.status !== "FAILED" && workflow.status !== "BLOCKED") continue;
      const stage = STAGE_OF[workflow.workflowType];
      const run = index.currentRun(workflow);
      if (!stage || !run) continue;
      out.push({
        id: `fail-${workflow.id}`, kind: "RESOLVE_FAILURE", stage,
        subject: `Resolve failed ${STAGE_LABEL[stage]} v${graph.runs[run.id]?.version ?? 1} · ${subjectOf(workflow.id)}`,
        detail: run.errorCode ? `It stopped with ${run.errorCode}. The prior approved inputs are untouched.` : "It stopped and needs you. The prior approved inputs are untouched.",
        href: anchorOf(stage) ?? "/studio", dueAt: null, createdAt: run.completedAt ?? run.createdAt, surface: surfaceOf(stage), attribution: { status: "resolved" },
      });
    }

    // Production: the highest-ranked unbriefed topic of the latest approved plan that passes Viewer Value (R001).
    const content = index.latestApproved(key, "CHANNEL_CONTENT_INTELLIGENCE");
    const plan = content ? output?.content[content.id] : undefined;
    if (content && plan) {
      const briefed = new Set([...index.workflows.values()]
        .filter((workflow) => workflow.workflowType === "CHANNEL_VIDEO_BRIEF" && workflow.status !== "CANCELED")
        .map((workflow) => index.briefSource(workflow))
        .filter((source) => source.contentRunId === content.id.toLowerCase())
        .map((source) => source.topicId));
      const next = [...plan.backlog].sort((left, right) => left.rank - right.rank || ascending(left.topicId, right.topicId)).find((entry) => {
        if (briefed.has(entry.topicId)) return false;
        const assessment = viewerValueAssessmentSchema.safeParse(plan.topics.find((topic) => topic.topicId === entry.topicId)?.viewerValue);
        if (!assessment.success) return false;
        return resolveViewerValueGate(deterministicViewerValueGate(assessment.data).gate, assessment.data.gate) === "PASS";
      });
      if (next) {
        const topic = plan.topics.find((item) => item.topicId === next.topicId);
        out.push({
          id: `brief-${content.id}-${next.topicId}`, kind: "START_BRIEF", stage: "BRIEF",
          subject: `Start a brief · Plan topic #${next.rank}: ${topic?.workingConcept ?? next.topicId}`,
          detail: "Highest-ranked unbriefed topic in the approved content plan that passes the Viewer Value gate.",
          href: anchorOf("BRIEF") ?? "/studio", dueAt: null, createdAt: content.completedAt ?? content.createdAt, surface: "available", attribution: { status: "resolved" },
        });
      }
    }

    // Measurement: each approved release without a measurement in flight or done. A rejected
    // (cancelled) attempt does not count, so a replacement is offered. Never ranked without a
    // recorded publication date.
    for (const release of index.inChannel(key, "CHANNEL_VIDEO_RELEASE")) {
      const releaseRun = index.currentRun(release);
      if (release.status !== "COMPLETED" || !releaseRun || releaseRun.status !== "COMPLETED") continue;
      const taken = [...index.workflows.values()].some((workflow) => workflow.workflowType === "CHANNEL_VIDEO_PERFORMANCE"
        && MEASUREMENT_TAKEN.has(workflow.status)
        && (index.runsByWorkflow.get(workflow.id) ?? []).some((run) => typeof run.input.videoReleaseRunId === "string" && run.input.videoReleaseRunId.toLowerCase() === releaseRun.id.toLowerCase()));
      if (taken) continue;
      out.push({
        id: `perf-${release.id}`, kind: "RECORD_PERFORMANCE", stage: "PERFORMANCE",
        subject: `Record performance · ${subjectOf(release.id)}`,
        detail: "The release is approved. Enter its numbers once it has been live long enough to judge.",
        href: anchorOf("PERFORMANCE") ?? "/studio", dueAt: null, dueUnavailable: "NO_PUBLICATION_DATE",
        createdAt: releaseRun.completedAt ?? releaseRun.createdAt, surface: "available", attribution: { status: "resolved" },
      });
    }
    return out;
  }

  const identity: SectionState<ChannelIdentity> = channel
    ? (() => {
      const strategy = index.latestApproved(channel.key, "CHANNEL_STRATEGY");
      const strategyOutput = strategy ? output?.strategy[strategy.id] : undefined;
      return {
        status: "ready",
        data: {
          label: channel.label,
          labelSource: channel.labelSource,
          thesis: strategyOutput?.thesis ?? null,
          strategyVersion: strategy ? graph.runs[strategy.id]?.version ?? 1 : null,
          strategyApprovedAt: strategy ? index.approvedAt.get(strategy.id) ?? strategy.completedAt : null,
          revenuePathCount: strategyOutput?.revenuePathCount ?? null,
          lastReview: null,
        },
      };
    })()
    : { status: "empty", message: "No approved research or strategy yet. Production opens once a strategy and a content plan are approved.", action: { label: "Start research", href: anchorOf("RESEARCH") ?? "/studio" } };

  const performance: SectionState<PerformanceRow[]> = outputs.status === "error"
    ? { status: "error", message: "Performance did not load. Nothing was changed.", requestId: outputs.requestId }
    : (() => {
      const measured = channelKey
        ? index.inChannel(channelKey, "CHANNEL_VIDEO_PERFORMANCE")
          .filter((workflow) => workflow.status === "COMPLETED")
          .map((workflow) => ({ workflow, run: index.currentRun(workflow) }))
          .filter((item): item is { workflow: LineageWorkflowRow; run: LineageRunRow } => item.run !== null)
          .sort(latestFirst((item) => item.run.completedAt ?? item.run.createdAt, (item) => item.run.id))
        : [];
      if (measured.length === 0) return { status: "empty", message: "Nothing measured yet. You enter performance per video after release." };
      return {
        status: "ready",
        data: measured.map(({ workflow, run }) => {
          const metrics = output?.performance[run.id];
          return { videoTitle: subjectOf(workflow.id), views: metrics?.views ?? null, averageViewedPct: metrics?.averageViewedPct ?? null, versusPlan: "NOT_ASSESSED" };
        }),
      };
    })();

  return {
    scenario: "live",
    asOf,
    channel: identity,
    gates,
    videos,
    tasks,
    learning: { status: "unavailable", message: "Channel learning needs the Diagnosis, Decision and Experiment screens.", dependency: "D8" },
    performance,
    globalPendingCount: approvalsError ? null : graph.pendingApprovals.length,
  };
}
