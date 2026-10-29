import { describe, expect, it } from "vitest";
import { LineageBuilder } from "./lineage-fixtures.test-helper";
import type { LineageRows } from "./lineage-rows";
import { pendingCounts, resolveLineage, type LineageAttribution } from "./resolve-lineage";

const resolved = (channelKey: string, videoKey: string | null = null): LineageAttribution => ({ status: "resolved", channelKey, videoKey });
const code = (attribution: LineageAttribution | undefined) => (attribution?.status === "unresolved" ? attribution.code : attribution?.status);
/** The nested object at a path inside a persisted payload, for tampering in tests. */
const nested = (value: unknown, ...keys: Array<string | number>) => keys.reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], value) as Record<string, unknown>;

/** Deterministic shuffle so order independence is checked on a non-trivial permutation. */
function shuffled<T>(items: T[], seed: number) {
  const out = [...items];
  let state = seed;
  for (let index = out.length - 1; index > 0; index -= 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const swap = state % (index + 1);
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}
const reorder = (rows: LineageRows, seed: number): LineageRows => ({ workflows: shuffled(rows.workflows, seed), runs: shuffled(rows.runs, seed + 1), approvals: shuffled(rows.approvals, seed + 2) });

/** Two experiments under one strategy run, so they can share a portfolio. */
function twoExperiments(builder: LineageBuilder, root = builder.research()) {
  const first = builder.chain("CHANNEL_VIDEO_EXPERIMENT", root);
  const secondBrief = builder.stage("CHANNEL_VIDEO_BRIEF", first.CHANNEL_CONTENT_INTELLIGENCE);
  let upstream = secondBrief;
  for (const type of ["CHANNEL_VIDEO_SCRIPT", "CHANNEL_VIDEO_PACKAGING", "CHANNEL_VIDEO_RELEASE", "CHANNEL_VIDEO_PERFORMANCE", "CHANNEL_VIDEO_DIAGNOSIS", "CHANNEL_VIDEO_DECISION", "CHANNEL_VIDEO_EXPERIMENT"]) upstream = builder.stage(type, upstream);
  return { first, second: upstream, secondBrief };
}

describe("resolveLineage: channels and videos", () => {
  it("attributes a full chain to its research root, and every stage from Brief on to its video", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_EXPERIMENT");
    const graph = resolveLineage(builder.rows());
    const channel = chain.CHANNEL_RESEARCH.workflowId;
    const video = chain.CHANNEL_VIDEO_BRIEF.workflowId;
    expect(graph.channels).toEqual([expect.objectContaining({ key: channel, label: "Budget mechanical keyboards", labelSource: "research-niche" })]);
    expect(graph.videos).toEqual([expect.objectContaining({ key: video, channelKey: channel })]);
    for (const type of ["CHANNEL_RESEARCH", "CHANNEL_STRATEGY", "CHANNEL_CONTENT_INTELLIGENCE"]) expect(graph.workflows[chain[type].workflowId]).toEqual(resolved(channel));
    for (const type of ["CHANNEL_VIDEO_BRIEF", "CHANNEL_VIDEO_SCRIPT", "CHANNEL_VIDEO_RELEASE", "CHANNEL_VIDEO_PERFORMANCE", "CHANNEL_VIDEO_DECISION", "CHANNEL_VIDEO_EXPERIMENT"]) {
      expect(graph.workflows[chain[type].workflowId]).toEqual(resolved(channel, video));
    }
    expectSelfConsistent(graph);
  });

  it("keeps two research roots with the same niche as two channels, each with only its own work", () => {
    const builder = new LineageBuilder();
    const a = builder.chain("CHANNEL_VIDEO_SCRIPT", builder.research({ niche: "Budget keyboards" }));
    const b = builder.chain("CHANNEL_VIDEO_SCRIPT", builder.research({ niche: "Budget keyboards" }));
    const graph = resolveLineage(builder.rows());
    expect(graph.channels.map((channel) => [channel.key, channel.label])).toEqual([
      [a.CHANNEL_RESEARCH.workflowId, "Budget keyboards"],
      [b.CHANNEL_RESEARCH.workflowId, "Budget keyboards"],
    ]);
    expect(graph.workflows[a.CHANNEL_VIDEO_SCRIPT.workflowId]).toEqual(resolved(a.CHANNEL_RESEARCH.workflowId, a.CHANNEL_VIDEO_BRIEF.workflowId));
    expect(graph.workflows[b.CHANNEL_VIDEO_SCRIPT.workflowId]).toEqual(resolved(b.CHANNEL_RESEARCH.workflowId, b.CHANNEL_VIDEO_BRIEF.workflowId));
  });

  it("treats every revision of a research workflow as the same channel", () => {
    const builder = new LineageBuilder();
    const first = builder.research();
    const revised = builder.revise(first);
    const strategy = builder.stage("CHANNEL_STRATEGY", revised);
    const graph = resolveLineage(builder.rows());
    expect(graph.channels).toHaveLength(1);
    expect(graph.workflows[strategy.workflowId]).toEqual(resolved(first.workflowId));
  });

  it("labels concept-only research with its concept, shortened, and says so", () => {
    const builder = new LineageBuilder();
    builder.research({ channelConcept: `  Honest reviews of cheap keyboards   for people who already bought the wrong one, ${"tested at length ".repeat(5)}` });
    const [channel] = resolveLineage(builder.rows()).channels;
    expect(channel.labelSource).toBe("research-concept");
    expect(channel.label.length).toBeLessThanOrEqual(80);
    expect(channel.label).toMatch(/^Honest reviews of cheap keyboards for people/);
    expect(channel.label.endsWith("…")).toBe(true);
  });
});

describe("resolveLineage: unresolved lineage is reported, never guessed", () => {
  it("reports a missing or unreadable reference, and marks everything downstream as unresolved", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_BRIEF");
    delete builder.input(chain.CHANNEL_CONTENT_INTELLIGENCE).approvedStrategyReference;
    const unreadable = builder.chain("CHANNEL_STRATEGY");
    builder.input(unreadable.CHANNEL_STRATEGY).researchRunId = "not-a-uuid";
    const graph = resolveLineage(builder.rows());
    expect(code(graph.workflows[chain.CHANNEL_CONTENT_INTELLIGENCE.workflowId])).toBe("MISSING_REFERENCE");
    expect(code(graph.workflows[chain.CHANNEL_VIDEO_BRIEF.workflowId])).toBe("UPSTREAM_UNRESOLVED");
    expect(code(graph.workflows[unreadable.CHANNEL_STRATEGY.workflowId])).toBe("MISSING_REFERENCE");
    expect(graph.videos).toEqual([]);
    expect(graph.workflows[chain.CHANNEL_STRATEGY.workflowId]).toEqual(resolved(chain.CHANNEL_RESEARCH.workflowId));
  });

  it("rejects a reference whose nested chain names a different ancestor than the walk found", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_SCRIPT");
    const other = builder.research({ niche: "Other niche" });
    nested(builder.input(chain.CHANNEL_VIDEO_SCRIPT), "approvedVideoBriefReference", "upstreamContentIntelligence", "upstreamStrategy", "upstreamResearch").researchWorkflowId = other.workflowId;
    const graph = resolveLineage(builder.rows());
    expect(code(graph.workflows[chain.CHANNEL_VIDEO_SCRIPT.workflowId])).toBe("INCONSISTENT_REFERENCE");
    expect(graph.workflows[chain.CHANNEL_VIDEO_BRIEF.workflowId]).toEqual(resolved(chain.CHANNEL_RESEARCH.workflowId, chain.CHANNEL_VIDEO_BRIEF.workflowId));
  });

  it("rejects a request that names a run of the wrong type or workflow", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_CONTENT_INTELLIGENCE");
    builder.input(chain.CHANNEL_CONTENT_INTELLIGENCE).strategyWorkflowId = chain.CHANNEL_RESEARCH.workflowId;
    expect(code(resolveLineage(builder.rows()).workflows[chain.CHANNEL_CONTENT_INTELLIGENCE.workflowId])).toBe("INCONSISTENT_REFERENCE");
  });

  it("reports an upstream run that is not among the user's rows", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_BRIEF");
    const rows = builder.rows();
    rows.runs = rows.runs.filter((run) => run.id !== chain.CHANNEL_CONTENT_INTELLIGENCE.runId);
    const graph = resolveLineage(rows);
    expect(code(graph.workflows[chain.CHANNEL_VIDEO_BRIEF.workflowId])).toBe("UPSTREAM_NOT_FOUND");
    expect(code(graph.workflows[chain.CHANNEL_CONTENT_INTELLIGENCE.workflowId])).toBe("NO_RUNS");
  });

  it("never splits a workflow whose runs point at different channels", () => {
    const builder = new LineageBuilder();
    const a = builder.chain("CHANNEL_STRATEGY");
    const b = builder.research({ niche: "Other niche" });
    const content = builder.stage("CHANNEL_CONTENT_INTELLIGENCE", a.CHANNEL_STRATEGY);
    const otherStrategy = builder.stage("CHANNEL_STRATEGY", b);
    const repointed = structuredClone(builder.input(builder.stage("CHANNEL_CONTENT_INTELLIGENCE", otherStrategy)));
    const revision = builder.revise(content, repointed);
    const approval = builder.pending(revision);
    const graph = resolveLineage(builder.rows());
    // Neither side wins: the workflow and both of its runs carry the disagreement.
    expect(code(graph.workflows[content.workflowId])).toBe("RUNS_DISAGREE");
    expect(code(graph.runs[content.runId].attribution)).toBe("RUNS_DISAGREE");
    expect(code(graph.runs[revision.runId].attribution)).toBe("RUNS_DISAGREE");
    expect(code(graph.pendingApprovals.find((item) => item.approvalId === approval)?.attribution)).toBe("RUNS_DISAGREE");
  });

  it("puts concept validation and unknown types outside every channel", () => {
    const builder = new LineageBuilder();
    builder.research();
    const concept = builder.conceptValidation();
    const graph = resolveLineage({ ...builder.rows(), workflows: [...builder.workflows, { id: "00000000-0000-4000-8000-0000000000ff", workflowType: "CHANNEL_FUTURE", status: "QUEUED", currentRunId: null, createdAt: "2026-10-02T00:00:00.000Z" }], runs: [...builder.runs, { id: "00000000-0000-4000-8000-0000000000fe", workflowId: "00000000-0000-4000-8000-0000000000ff", status: "QUEUED", errorCode: null, createdAt: "2026-10-02T00:00:00.000Z", completedAt: null, previousRunId: null, input: {} }] });
    expect(graph.workflows[concept.workflowId]).toEqual({ status: "unresolved", code: "PRE_RESEARCH", reason: "it is a pre-research concept validation and belongs to no channel" });
    expect(code(graph.workflows["00000000-0000-4000-8000-0000000000ff"])).toBe("UNKNOWN_TYPE");
    expect(graph.channels).toHaveLength(1);
  });
});

describe("resolveLineage: references must parse with the real domain schemas", () => {
  it("rejects a reference whose ids match but whose required metadata is missing or wrong", () => {
    const builder = new LineageBuilder();
    const idsOnly = builder.chain("CHANNEL_STRATEGY");
    const reference = builder.input(idsOnly.CHANNEL_STRATEGY).approvedResearchReference as Record<string, unknown>;
    builder.input(idsOnly.CHANNEL_STRATEGY).approvedResearchReference = { researchWorkflowId: reference.researchWorkflowId, researchRunId: reference.researchRunId };
    const badVersion = builder.chain("CHANNEL_CONTENT_INTELLIGENCE");
    nested(builder.input(badVersion.CHANNEL_CONTENT_INTELLIGENCE), "approvedStrategyReference").outputSchemaVersion = 2;
    const badNested = builder.chain("CHANNEL_VIDEO_BRIEF");
    delete nested(builder.input(badNested.CHANNEL_VIDEO_BRIEF), "approvedContentReference", "upstreamStrategy", "upstreamResearch").researchArtifactHash;
    const graph = resolveLineage(builder.rows());
    for (const run of [idsOnly.CHANNEL_STRATEGY, badVersion.CHANNEL_CONTENT_INTELLIGENCE, badNested.CHANNEL_VIDEO_BRIEF]) expect(code(graph.workflows[run.workflowId])).toBe("MISSING_REFERENCE");
  });

  it("rejects compact Portfolio and Intelligence references that fail their readiness contracts", () => {
    const builder = new LineageBuilder();
    const { first, second } = twoExperiments(builder);
    const notEligible = builder.portfolio([first.CHANNEL_VIDEO_EXPERIMENT]);
    nested(builder.input(notEligible), "approvedVideoExperimentReferences", 0).portfolioEligible = false;
    const p1 = builder.portfolio([first.CHANNEL_VIDEO_EXPERIMENT]);
    const p2 = builder.portfolio([second]);
    const notReady = builder.intelligence([p1, p2], [{ ...builder.portfolioReference(p1), portfolioReady: false }, builder.portfolioReference(p2)]);
    const badSelection = builder.intelligence([p1, p2]);
    nested(builder.input(badSelection), "portfolioSelections", 0).portfolioRunId = "not-a-uuid";
    const graph = resolveLineage(builder.rows());
    for (const run of [notEligible, notReady, badSelection]) expect(code(graph.workflows[run.workflowId])).toBe("MISSING_REFERENCE");
    expect(graph.workflows[p1.workflowId]).toEqual(resolved(first.CHANNEL_RESEARCH.workflowId));
  });
});

describe("resolveLineage: workflow-level conflicts reach everything downstream", () => {
  it("unresolves every descendant of a brief whose revisions disagree, and keeps the graph self-consistent", () => {
    const builder = new LineageBuilder();
    const a = builder.chain("CHANNEL_VIDEO_BRIEF");
    const b = builder.chain("CHANNEL_CONTENT_INTELLIGENCE", builder.research({ niche: "Other niche" }));
    // A revision of A's brief whose input points at channel B's content plan.
    const repointed = structuredClone(builder.input(builder.stage("CHANNEL_VIDEO_BRIEF", b.CHANNEL_CONTENT_INTELLIGENCE)));
    builder.revise(a.CHANNEL_VIDEO_BRIEF, repointed);
    const script = builder.stage("CHANNEL_VIDEO_SCRIPT", a.CHANNEL_VIDEO_BRIEF);
    const packaging = builder.stage("CHANNEL_VIDEO_PACKAGING", script);
    const scriptApproval = builder.pending(script);
    const packagingApproval = builder.pending(packaging);
    const graph = resolveLineage(builder.rows());

    expect(code(graph.workflows[a.CHANNEL_VIDEO_BRIEF.workflowId])).toBe("RUNS_DISAGREE");
    expect(code(graph.workflows[script.workflowId])).toBe("UPSTREAM_UNRESOLVED");
    expect(code(graph.workflows[packaging.workflowId])).toBe("UPSTREAM_UNRESOLVED");
    expect(code(graph.runs[packaging.runId].attribution)).toBe("UPSTREAM_UNRESOLVED");
    for (const approval of [scriptApproval, packagingApproval]) expect(code(graph.pendingApprovals.find((item) => item.approvalId === approval)?.attribution)).toBe("UPSTREAM_UNRESOLVED");
    expect(graph.videos.map((video) => video.key)).not.toContain(a.CHANNEL_VIDEO_BRIEF.workflowId);
    expectSelfConsistent(graph);
  });
});

/** Every resolved attribution names a channel and (if any) a video that the graph itself lists. */
function expectSelfConsistent(graph: ReturnType<typeof resolveLineage>) {
  const channels = new Set(graph.channels.map((channel) => channel.key));
  const videos = new Map(graph.videos.map((video) => [video.key, video.channelKey]));
  const all = [...Object.values(graph.workflows), ...Object.values(graph.runs).map((run) => run.attribution), ...graph.pendingApprovals.map((item) => item.attribution)];
  for (const attribution of all) {
    if (attribution.status !== "resolved") continue;
    expect(channels.has(attribution.channelKey)).toBe(true);
    if (attribution.videoKey) expect(videos.get(attribution.videoKey)).toBe(attribution.channelKey);
  }
}

describe("resolveLineage: Portfolio and Intelligence compact references", () => {
  it("resolves a portfolio and an intelligence run whose selections all trace to one channel", () => {
    const builder = new LineageBuilder();
    const { first, second } = twoExperiments(builder);
    const p1 = builder.portfolio([first.CHANNEL_VIDEO_EXPERIMENT, second]);
    const p2 = builder.portfolio([second]);
    const intelligence = builder.intelligence([p1, p2]);
    const graph = resolveLineage(builder.rows());
    const channel = first.CHANNEL_RESEARCH.workflowId;
    expect(graph.workflows[p1.workflowId]).toEqual(resolved(channel));
    expect(graph.workflows[intelligence.workflowId]).toEqual(resolved(channel));
  });

  it("does not split or duplicate a portfolio that spans two channels", () => {
    const builder = new LineageBuilder();
    const a = builder.chain("CHANNEL_VIDEO_EXPERIMENT");
    const b = builder.chain("CHANNEL_VIDEO_EXPERIMENT", builder.research({ niche: "Budget mechanical keyboards" }));
    const portfolio = builder.portfolio([a.CHANNEL_VIDEO_EXPERIMENT, b.CHANNEL_VIDEO_EXPERIMENT]);
    const graph = resolveLineage(builder.rows());
    expect(graph.workflows[portfolio.workflowId]).toEqual({ status: "unresolved", code: "SPANS_CHANNELS", reason: "it spans 2 channels" });
  });

  it("rejects a portfolio whose references do not match its selections, or whose flat decision summary is wrong", () => {
    const builder = new LineageBuilder();
    const { first, second } = twoExperiments(builder);
    const mismatched = builder.portfolio([first.CHANNEL_VIDEO_EXPERIMENT, second]);
    (builder.input(mismatched).approvedVideoExperimentReferences as unknown[]).pop();
    const wrongSummary = builder.portfolio([second]);
    nested(builder.input(wrongSummary), "approvedVideoExperimentReferences", 0, "upstreamVideoDecision").decisionRunId = first.CHANNEL_VIDEO_DECISION.runId;
    const graph = resolveLineage(builder.rows());
    expect(code(graph.workflows[mismatched.workflowId])).toBe("INCONSISTENT_REFERENCE");
    expect(code(graph.workflows[wrongSummary.workflowId])).toBe("INCONSISTENT_REFERENCE");
  });

  it("checks Intelligence anchors against the exact research and strategy runs, and requires one strategy", () => {
    const builder = new LineageBuilder();
    const root = builder.research();
    const revisedRoot = builder.revise(root);
    const { first, second } = twoExperiments(builder, root);
    const p1 = builder.portfolio([first.CHANNEL_VIDEO_EXPERIMENT]);
    const p2 = builder.portfolio([second]);
    // A second strategy in the same channel, with its own experiment and portfolio.
    const otherStrategy = builder.stage("CHANNEL_STRATEGY", root);
    let upstream = otherStrategy;
    for (const type of ["CHANNEL_CONTENT_INTELLIGENCE", "CHANNEL_VIDEO_BRIEF", "CHANNEL_VIDEO_SCRIPT", "CHANNEL_VIDEO_PACKAGING", "CHANNEL_VIDEO_RELEASE", "CHANNEL_VIDEO_PERFORMANCE", "CHANNEL_VIDEO_DIAGNOSIS", "CHANNEL_VIDEO_DECISION", "CHANNEL_VIDEO_EXPERIMENT"]) upstream = builder.stage(type, upstream);
    const p3 = builder.portfolio([upstream]);

    const wrongRevision = builder.intelligence([p1, p2], [builder.portfolioReference(p1, { researchRunId: revisedRoot.runId }), builder.portfolioReference(p2)]);
    const wrongStrategy = builder.intelligence([p1, p2], [builder.portfolioReference(p1, { strategyRunId: otherStrategy.runId }), builder.portfolioReference(p2)]);
    const twoStrategies = builder.intelligence([p1, p3]);
    const swapped = builder.intelligence([p1, p2], [builder.portfolioReference(p1), builder.portfolioReference(p3)]);
    const valid = builder.intelligence([p1, p2]);
    const graph = resolveLineage(builder.rows());
    for (const run of [wrongRevision, wrongStrategy, twoStrategies, swapped]) expect(code(graph.workflows[run.workflowId])).toBe("INCONSISTENT_REFERENCE");
    expect(graph.workflows[valid.workflowId]).toEqual(resolved(root.workflowId));
    expect(graph.workflows[p3.workflowId]).toEqual(resolved(root.workflowId));
  });
});

describe("resolveLineage: revisions, approvals and determinism", () => {
  it("takes supersedes from the run's own previous run, not from upstream metadata", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_SCRIPT");
    const v2 = builder.revise(chain.CHANNEL_VIDEO_SCRIPT);
    const v3 = builder.revise(v2);
    const graph = resolveLineage(builder.rows());
    expect(graph.runs[chain.CHANNEL_VIDEO_SCRIPT.runId]).toMatchObject({ version: 1, supersedesVersion: null });
    expect(graph.runs[v2.runId]).toMatchObject({ version: 2, supersedesVersion: 1 });
    expect(graph.runs[v3.runId]).toMatchObject({ version: 3, supersedesVersion: 2 });
    expect(graph.runs[chain.CHANNEL_VIDEO_BRIEF.runId]).toMatchObject({ version: 1, supersedesVersion: null });
  });

  it("counts every pending approval exactly once: per channel or account-level unresolved", () => {
    const builder = new LineageBuilder();
    const a = builder.chain("CHANNEL_VIDEO_SCRIPT");
    const b = builder.chain("CHANNEL_STRATEGY", builder.research({ niche: "Second channel" }));
    const broken = builder.chain("CHANNEL_CONTENT_INTELLIGENCE");
    delete builder.input(broken.CHANNEL_CONTENT_INTELLIGENCE).approvedStrategyReference;
    builder.pending(a.CHANNEL_VIDEO_SCRIPT);
    builder.pending(a.CHANNEL_STRATEGY);
    builder.pending(b.CHANNEL_STRATEGY);
    builder.pending(broken.CHANNEL_CONTENT_INTELLIGENCE);
    builder.pending(builder.conceptValidation());
    builder.approvals.push({ id: builder.uuid(), workflowId: a.CHANNEL_VIDEO_SCRIPT.workflowId, runId: builder.uuid(), status: "PENDING", requestedAt: "2026-10-03T00:00:00.000Z", decidedAt: null });
    builder.approvals.push({ id: builder.uuid(), workflowId: a.CHANNEL_STRATEGY.workflowId, runId: a.CHANNEL_STRATEGY.runId, status: "APPROVED", requestedAt: "2026-10-03T00:00:00.000Z", decidedAt: "2026-10-04T00:00:00.000Z" });
    const graph = resolveLineage(builder.rows());
    const counts = pendingCounts(graph);
    expect(counts.total).toBe(6);
    expect(Object.fromEntries(counts.byChannel)).toEqual({ [a.CHANNEL_RESEARCH.workflowId]: 2, [b.CHANNEL_RESEARCH.workflowId]: 1 });
    expect(counts.unresolved).toBe(3);
    expect([...counts.byChannel.values()].reduce((sum, value) => sum + value, 0) + counts.unresolved).toBe(counts.total);
    expect(graph.pendingApprovals.map((item) => code(item.attribution)).sort()).toEqual(["MISSING_REFERENCE", "PRE_RESEARCH", "RUN_NOT_FOUND", "resolved", "resolved", "resolved"]);
  });

  it("produces an identical graph whatever order the rows arrive in", () => {
    const builder = new LineageBuilder();
    const { first, second } = twoExperiments(builder);
    const p1 = builder.portfolio([first.CHANNEL_VIDEO_EXPERIMENT, second]);
    builder.intelligence([p1, builder.portfolio([second])]);
    builder.revise(first.CHANNEL_VIDEO_SCRIPT);
    builder.chain("CHANNEL_VIDEO_BRIEF", builder.research({ niche: "Budget mechanical keyboards" }));
    builder.pending(first.CHANNEL_VIDEO_PACKAGING);
    builder.pending(builder.conceptValidation());
    const rows = builder.rows();
    const expected = resolveLineage(rows);
    expectSelfConsistent(expected);
    for (const seed of [1, 7, 42, 2026]) expect(resolveLineage(reorder(rows, seed))).toEqual(expected);
    expect(resolveLineage({ workflows: [...rows.workflows].reverse(), runs: [...rows.runs].reverse(), approvals: [...rows.approvals].reverse() })).toEqual(expected);
  });
});
