import { describe, expect, it } from "vitest";
import { deterministicViewerValueGate } from "@/domain/viewer-value";
import { rankNextDecision } from "@/features/command-center/next-decision";
import { viewerValueFixture } from "@/server/workflows/content-fixtures.test-helper";
import { mostRecentChannelKey, stageOutputRequest, toCommandCenterView, type LiveInputs } from "./command-center-view";
import { LineageBuilder, type RunRef } from "./lineage-fixtures.test-helper";
import type { ContentOutput, PerformanceOutput, StrategyOutput } from "./load-stage-outputs";
import { resolveLineage } from "./resolve-lineage";

interface Outputs { strategy?: Record<string, StrategyOutput>; content?: Record<string, ContentOutput>; performance?: Record<string, PerformanceOutput> }

const AS_OF = "2026-10-30T12:00:00.000Z";

function setStatus(builder: LineageBuilder, run: RunRef, status: string) {
  builder.workflows.find((workflow) => workflow.id === run.workflowId)!.status = status;
  builder.runs.find((row) => row.id === run.runId)!.status = status === "WAITING_FOR_APPROVAL" ? "WAITING_FOR_APPROVAL" : status;
}

function approve(builder: LineageBuilder, run: RunRef, decidedAt: string) {
  builder.approvals.push({ id: builder.uuid(), workflowId: run.workflowId, runId: run.runId, status: "APPROVED", requestedAt: decidedAt, decidedAt });
}

function inputs(builder: LineageBuilder, outputs: Outputs = {}, extra: Partial<LiveInputs> = {}): LiveInputs {
  const rows = builder.rows();
  return {
    rows,
    graph: resolveLineage(rows),
    approvalsError: null,
    outputs: { strategy: { status: "ok", data: outputs.strategy ?? {} }, content: outputs.content ?? {}, performance: { status: "ok", data: outputs.performance ?? {} } },
    ...extra,
  };
}

const plan = (contentRunId: string, topics: Array<{ topicId: string; rank: number; workingConcept: string; gate?: "PASS" | "REVISE" | "REJECT" }>) => ({
  [contentRunId]: {
    backlog: topics.map(({ topicId, rank }) => ({ topicId, rank })),
    topics: topics.map(({ topicId, workingConcept, gate }) => ({ topicId, workingConcept, viewerValue: viewerValueFixture(gate ? { gate } : {}) })),
  },
});

describe("toCommandCenterView: channel identity and videos", () => {
  it("names the channel by its research niche and reads identity from the latest approved strategy", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_CONTENT_INTELLIGENCE");
    const older = builder.stage("CHANNEL_STRATEGY", chain.CHANNEL_RESEARCH);
    approve(builder, chain.CHANNEL_STRATEGY, "2026-10-20T10:00:00+00:00");
    approve(builder, older, "2026-10-10T10:00:00+00:00");
    const key = chain.CHANNEL_RESEARCH.workflowId;
    const view = toCommandCenterView(inputs(builder, { strategy: { [chain.CHANNEL_STRATEGY.runId]: { thesis: "Cheap keyboards, tested honestly.", revenuePathCount: 3 } } }), key, AS_OF);
    expect(view.scenario).toBe("live");
    expect(view.channel).toEqual({ status: "ready", data: { label: "Budget mechanical keyboards", labelSource: "research-niche", thesis: "Cheap keyboards, tested honestly.", strategyVersion: 1, strategyApprovedAt: "2026-10-20T10:00:00+00:00", revenuePathCount: 3, lastReview: null } });
    expect(stageOutputRequest(builder.rows(), resolveLineage(builder.rows()), key).strategyRunIds).toEqual([chain.CHANNEL_STRATEGY.runId]);
  });

  it("builds a video's stage track from its workflows and titles it from its plan topic", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_SCRIPT");
    builder.input(chain.CHANNEL_VIDEO_BRIEF).selectedTopicId = "topic-1";
    setStatus(builder, chain.CHANNEL_VIDEO_SCRIPT, "WAITING_FOR_APPROVAL");
    const key = chain.CHANNEL_RESEARCH.workflowId;
    const view = toCommandCenterView(inputs(builder, { content: plan(chain.CHANNEL_CONTENT_INTELLIGENCE.runId, [{ topicId: "topic-1", rank: 1, workingConcept: "The $10 setup, tested honestly" }]) }), key, AS_OF);
    expect(view.videos.status === "ready" && view.videos.data).toEqual([expect.objectContaining({
      rootWorkflowId: chain.CHANNEL_VIDEO_BRIEF.workflowId,
      title: "The $10 setup, tested honestly",
      currentStage: "SCRIPT",
      stateLabel: "02 Script v1 · review",
      waitingOn: "you",
      attribution: { status: "resolved" },
      cells: expect.objectContaining({ BRIEF: "done", SCRIPT: "you", PACKAGING: "none" }),
    })]);
  });
});

describe("toCommandCenterView: unresolved work is account-level, named and counted once (CW-B2-002, R002, R005)", () => {
  function twoChannelsWithUnresolved() {
    const builder = new LineageBuilder();
    const a = builder.chain("CHANNEL_VIDEO_SCRIPT");
    const b = builder.chain("CHANNEL_STRATEGY", builder.research({ niche: "Budget mechanical keyboards" }));
    const broken = builder.chain("CHANNEL_VIDEO_BRIEF");
    delete builder.input(broken.CHANNEL_CONTENT_INTELLIGENCE).approvedStrategyReference;
    const concept = builder.conceptValidation();
    builder.pending(a.CHANNEL_VIDEO_SCRIPT);
    builder.pending(b.CHANNEL_STRATEGY);
    builder.pending(concept);
    builder.pending(broken.CHANNEL_CONTENT_INTELLIGENCE);
    return { builder, a, b, broken, concept };
  }

  it("shows each channel its own gates plus every unresolved gate, and counts each approval once", () => {
    const { builder, a, b } = twoChannelsWithUnresolved();
    const data = inputs(builder);
    const views = [a.CHANNEL_RESEARCH.workflowId, b.CHANNEL_RESEARCH.workflowId, null].map((key) => toCommandCenterView(data, key, AS_OF));
    const gates = (view: (typeof views)[number]) => (view.gates.status === "ready" ? view.gates.data : []);
    for (const view of views) expect(view.globalPendingCount).toBe(4);
    const resolvedPerChannel = views.slice(0, 2).map((view) => gates(view).filter((gate) => gate.attribution.status === "resolved").length);
    const unresolved = gates(views[2]).filter((gate) => gate.attribution.status === "ambiguous");
    expect(resolvedPerChannel).toEqual([1, 1]);
    expect(unresolved).toHaveLength(2);
    expect(resolvedPerChannel.reduce((sum, value) => sum + value, 0) + unresolved.length).toBe(4);
    // The same unresolved gates ride along in every channel view, never as that channel's own.
    for (const view of views) expect(gates(view).filter((gate) => gate.attribution.status === "ambiguous").map((gate) => gate.approvalId).sort()).toEqual(unresolved.map((gate) => gate.approvalId).sort());
  });

  it("gives Concept Validation a readable stage, no screen, and a stated exclusion from the ranking", () => {
    const { builder, a, concept } = twoChannelsWithUnresolved();
    for (const key of [a.CHANNEL_RESEARCH.workflowId, null]) {
      const view = toCommandCenterView(inputs(builder), key, AS_OF);
      const gate = view.gates.status === "ready" ? view.gates.data.find((item) => item.workflowId === concept.workflowId) : undefined;
      expect(gate).toMatchObject({ stage: "CONCEPT_VALIDATION", surface: "unavailable", attribution: { status: "ambiguous", reason: "it is a pre-research concept validation and belongs to no channel" } });
      const excluded = rankNextDecision(view).excluded.find((item) => item.id === `gate:${gate!.approvalId}`);
      expect(excluded?.title).toMatch(/^Review Concept validation v1 · /);
      expect(excluded?.reason).toBe("Not attributed to this channel: it is a pre-research concept validation and belongs to no channel");
    }
  });

  it("lists an unresolved video even when it has no pending gate", () => {
    const { builder, broken } = twoChannelsWithUnresolved();
    const view = toCommandCenterView(inputs(builder), null, AS_OF);
    expect(view.videos.status === "ready" && view.videos.data.find((video) => video.rootWorkflowId === broken.CHANNEL_VIDEO_BRIEF.workflowId)?.attribution)
      .toEqual({ status: "ambiguous", reason: "its upstream work is itself unattributed" });
    expect(view.channel.status).toBe("empty");
    expect(view.tasks).toEqual([expect.objectContaining({ kind: "START_RESEARCH" })]);
  });

  it("reports failed approvals as a section error, an incomplete ranking and an unknown count", () => {
    const { builder, a } = twoChannelsWithUnresolved();
    const view = toCommandCenterView(inputs(builder, {}, { approvalsError: { requestId: "req-1" } }), a.CHANNEL_RESEARCH.workflowId, AS_OF);
    expect(view.gates).toEqual({ status: "error", message: "Pending approvals did not load. Nothing was changed.", requestId: "req-1" });
    expect(view.globalPendingCount).toBeNull();
    expect(rankNextDecision(view).complete).toBe(false);
  });
});

describe("toCommandCenterView: START_BRIEF (R001)", () => {
  it("passes over briefed topics and topics whose claimed Viewer Value gate is not PASS", () => {
    expect(deterministicViewerValueGate(viewerValueFixture()).gate).toBe("PASS");
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_BRIEF");
    builder.input(chain.CHANNEL_VIDEO_BRIEF).selectedTopicId = "t1";
    approve(builder, chain.CHANNEL_CONTENT_INTELLIGENCE, "2026-10-21T10:00:00+00:00");
    const key = chain.CHANNEL_RESEARCH.workflowId;
    const content = plan(chain.CHANNEL_CONTENT_INTELLIGENCE.runId, [
      { topicId: "t1", rank: 1, workingConcept: "Already briefed" },
      { topicId: "t2", rank: 2, workingConcept: "Deterministic PASS, claimed REVISE", gate: "REVISE" },
      { topicId: "t3", rank: 3, workingConcept: "The $25 board that beat my $180 one" },
    ]);
    const view = toCommandCenterView(inputs(builder, { content }), key, AS_OF);
    expect(view.tasks.filter((task) => task.kind === "START_BRIEF")).toEqual([expect.objectContaining({ subject: "Start a brief · Plan topic #3: The $25 board that beat my $180 one", surface: "available" })]);
  });

  it("offers no brief when no unbriefed topic passes, and re-offers a topic whose brief was rejected", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_BRIEF");
    builder.input(chain.CHANNEL_VIDEO_BRIEF).selectedTopicId = "t1";
    const key = chain.CHANNEL_RESEARCH.workflowId;
    const none = plan(chain.CHANNEL_CONTENT_INTELLIGENCE.runId, [{ topicId: "t1", rank: 1, workingConcept: "Briefed" }, { topicId: "t2", rank: 2, workingConcept: "Rejected gate", gate: "REJECT" }]);
    expect(toCommandCenterView(inputs(builder, { content: none }), key, AS_OF).tasks.some((task) => task.kind === "START_BRIEF")).toBe(false);
    setStatus(builder, chain.CHANNEL_VIDEO_BRIEF, "CANCELED");
    expect(toCommandCenterView(inputs(builder, { content: none }), key, AS_OF).tasks.find((task) => task.kind === "START_BRIEF")?.subject).toBe("Start a brief · Plan topic #1: Briefed");
  });
});

describe("toCommandCenterView: measurement stays unranked without a publication date", () => {
  it("offers measurement per approved release, never ranked, until one is in flight or done; a rejected attempt re-offers it", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_RELEASE");
    const key = chain.CHANNEL_RESEARCH.workflowId;
    const measurementTasks = () => toCommandCenterView(inputs(builder), key, AS_OF).tasks.filter((task) => task.kind === "RECORD_PERFORMANCE");

    const [task] = measurementTasks();
    expect(task).toMatchObject({ dueAt: null, dueUnavailable: "NO_PUBLICATION_DATE" });
    const view = toCommandCenterView(inputs(builder), key, AS_OF);
    expect(rankNextDecision(view).excluded.find((item) => item.id === `task:${task.id}`)?.reason).toBe("No publication date is recorded, so measurement is not ranked.");

    const performance = builder.stage("CHANNEL_VIDEO_PERFORMANCE", chain.CHANNEL_VIDEO_RELEASE);
    for (const status of ["QUEUED", "WAITING_FOR_APPROVAL", "BLOCKED", "COMPLETED", "FAILED"]) {
      setStatus(builder, performance, status);
      expect(measurementTasks(), status).toEqual([]);
    }
    setStatus(builder, performance, "CANCELED");
    expect(measurementTasks()).toHaveLength(1);
  });

  it("lists measured videos as operator-entered and not assessed against plan", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_RELEASE");
    const performance = builder.stage("CHANNEL_VIDEO_PERFORMANCE", chain.CHANNEL_VIDEO_RELEASE);
    builder.input(chain.CHANNEL_VIDEO_BRIEF).selectedTopicId = "t1";
    const key = chain.CHANNEL_RESEARCH.workflowId;
    const view = toCommandCenterView(inputs(builder, {
      performance: { [performance.runId]: { views: 18_420, averageViewedPct: 48 } },
      content: plan(chain.CHANNEL_CONTENT_INTELLIGENCE.runId, [{ topicId: "t1", rank: 1, workingConcept: "Gasket mods under $20" }]),
    }), key, AS_OF);
    expect(view.performance).toEqual({ status: "ready", data: [{ videoTitle: "Gasket mods under $20", views: 18_420, averageViewedPct: 48, versusPlan: "NOT_ASSESSED" }] });
    const failed = toCommandCenterView(inputs(builder, {}, { outputs: { strategy: { status: "ok", data: {} }, content: {}, performance: { status: "error", requestId: "req-2" } } }), key, AS_OF);
    expect(failed.performance).toMatchObject({ status: "error", requestId: "req-2" });
  });

  it("raises recovery for failed work in the channel and keeps learning unavailable", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_SCRIPT");
    setStatus(builder, chain.CHANNEL_VIDEO_SCRIPT, "FAILED");
    builder.runs.find((run) => run.id === chain.CHANNEL_VIDEO_SCRIPT.runId)!.errorCode = "QA_FAILED";
    const view = toCommandCenterView(inputs(builder), chain.CHANNEL_RESEARCH.workflowId, AS_OF);
    expect(view.tasks).toContainEqual(expect.objectContaining({ kind: "RESOLVE_FAILURE", stage: "SCRIPT", detail: "It stopped with QA_FAILED. The prior approved inputs are untouched." }));
    expect(rankNextDecision(view).primary?.tier).toBe(0);
    expect(view.learning).toMatchObject({ status: "unavailable", dependency: "D8" });
  });
});

describe("toCommandCenterView: inspection regressions (PR21-001..005)", () => {
  const gatesOf = (view: ReturnType<typeof toCommandCenterView>) => (view.gates.status === "ready" ? view.gates.data : []);

  it("names a pending approval whose workflow did not load, and still counts every approval once (PR21-001)", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_SCRIPT");
    builder.pending(chain.CHANNEL_VIDEO_SCRIPT);
    const orphan = builder.stage("CHANNEL_VIDEO_PACKAGING", chain.CHANNEL_VIDEO_SCRIPT);
    const orphanApproval = builder.pending(orphan);
    // The approval was read after a workflow that the workflows page did not include yet.
    builder.workflows.splice(builder.workflows.findIndex((workflow) => workflow.id === orphan.workflowId), 1);
    for (const key of [chain.CHANNEL_RESEARCH.workflowId, null]) {
      const view = toCommandCenterView(inputs(builder), key, AS_OF);
      expect(gatesOf(view).some((gate) => gate.approvalId === orphanApproval)).toBe(false);
      expect(view.unattributedWork).toContainEqual({ id: `gate:${orphanApproval}`, kind: "Gate", title: `Pending approval · workflow ${orphan.workflowId.slice(0, 8)}`, reason: "its workflow did not load with this page; reload to see it" });
      const shown = gatesOf(view).length + (view.unattributedWork ?? []).filter((item) => item.kind === "Gate").length;
      expect(shown).toBe(key ? view.globalPendingCount : view.globalPendingCount! - 1);
    }
  });

  it("names unresolved work below a resolved brief that has no pending gate, in every view (PR21-002)", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_SCRIPT");
    delete builder.input(chain.CHANNEL_VIDEO_SCRIPT).approvedVideoBriefReference;
    setStatus(builder, chain.CHANNEL_VIDEO_SCRIPT, "FAILED");
    const other = builder.research({ niche: "Other" });
    for (const key of [chain.CHANNEL_RESEARCH.workflowId, other.workflowId, null]) {
      const view = toCommandCenterView(inputs(builder), key, AS_OF);
      expect(view.unattributedWork).toEqual([{
        id: `workflow:${chain.CHANNEL_VIDEO_SCRIPT.workflowId}`, kind: "Workflow",
        title: `Script · workflow ${chain.CHANNEL_VIDEO_SCRIPT.workflowId.slice(0, 8)} · failed`,
        reason: "its lineage reference is missing or unreadable",
      }]);
      // Never presented as this channel's own work.
      expect(view.tasks.some((task) => task.kind === "RESOLVE_FAILURE")).toBe(false);
    }
  });

  it("queries only loaded content-plan runs, never a malformed or foreign reference (PR21-003)", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_BRIEF");
    const malformed = builder.chain("CHANNEL_VIDEO_BRIEF");
    const foreign = builder.chain("CHANNEL_VIDEO_BRIEF");
    (builder.input(malformed.CHANNEL_VIDEO_BRIEF).approvedContentReference as Record<string, unknown>).contentRunId = "not-a-uuid";
    (builder.input(foreign.CHANNEL_VIDEO_BRIEF).approvedContentReference as Record<string, unknown>).contentRunId = builder.uuid();
    const request = stageOutputRequest(builder.rows(), resolveLineage(builder.rows()), chain.CHANNEL_RESEARCH.workflowId);
    expect(request.contentRunIds.sort()).toEqual([chain.CHANNEL_CONTENT_INTELLIGENCE.runId].sort());
  });

  it("keeps each output category's result when another fails (PR21-004)", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_RELEASE");
    const performance = builder.stage("CHANNEL_VIDEO_PERFORMANCE", chain.CHANNEL_VIDEO_RELEASE);
    const key = chain.CHANNEL_RESEARCH.workflowId;
    const strategy = { [chain.CHANNEL_STRATEGY.runId]: { thesis: "Cheap keyboards, tested honestly.", revenuePathCount: 2 } };
    const performanceFailed = toCommandCenterView(inputs(builder, {}, { outputs: { strategy: { status: "ok", data: strategy }, content: {}, performance: { status: "error", requestId: "req-p" } } }), key, AS_OF);
    expect(performanceFailed.channel).toMatchObject({ status: "ready", data: { thesis: "Cheap keyboards, tested honestly." } });
    expect(performanceFailed.performance).toMatchObject({ status: "error", requestId: "req-p" });
    const strategyFailed = toCommandCenterView(inputs(builder, {}, { outputs: { strategy: { status: "error", requestId: "req-s" }, content: {}, performance: { status: "ok", data: { [performance.runId]: { views: 10, averageViewedPct: null } } } } }), key, AS_OF);
    expect(strategyFailed.channel).toEqual({ status: "error", message: "The channel strategy did not load. Nothing was changed.", requestId: "req-s" });
    expect(strategyFailed.performance).toMatchObject({ status: "ready", data: [expect.objectContaining({ views: 10 })] });
  });

  it("keeps an approved stage approved when a later replacement attempt is rejected (PR21-005)", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_SCRIPT");
    const replacement = builder.stage("CHANNEL_VIDEO_SCRIPT", chain.CHANNEL_VIDEO_BRIEF);
    const key = chain.CHANNEL_RESEARCH.workflowId;
    const scriptCell = () => {
      const view = toCommandCenterView(inputs(builder), key, AS_OF);
      return view.videos.status === "ready" ? view.videos.data[0].cells.SCRIPT : null;
    };
    setStatus(builder, replacement, "RUNNING");
    expect(scriptCell()).toBe("system");
    setStatus(builder, replacement, "CANCELED");
    expect(scriptCell()).toBe("done");
    setStatus(builder, chain.CHANNEL_VIDEO_SCRIPT, "CANCELED");
    expect(scriptCell()).toBe("none");
  });
});

describe("mostRecentChannelKey", () => {
  it("opens the channel with the latest run activity, and nothing when there are no channels", () => {
    const builder = new LineageBuilder();
    const a = builder.research({ niche: "First" });
    const b = builder.research({ niche: "Second" });
    builder.stage("CHANNEL_STRATEGY", a);
    expect(mostRecentChannelKey(builder.rows(), resolveLineage(builder.rows()))).toBe(a.workflowId);
    builder.stage("CHANNEL_STRATEGY", b);
    expect(mostRecentChannelKey(builder.rows(), resolveLineage(builder.rows()))).toBe(b.workflowId);
    const empty = new LineageBuilder();
    empty.conceptValidation();
    expect(mostRecentChannelKey(empty.rows(), resolveLineage(empty.rows()))).toBeNull();
  });
});
