import { approvedVideoExperimentReferenceSchema, approvedVideoPortfolioReferenceSchema, intelligencePortfolioSelectionSchema, portfolioExperimentSelectionSchema } from "@/domain/production-workflows";
import { parseInstant } from "@/features/command-center/next-decision";
import { LINEAR_STAGES, REFERENCE_SCHEMA, REFERENCE_SHAPE, type LinearStage, type LineageApprovalRow, type LineageRows, type LineageRunRow, type LineageWorkflowRow } from "./lineage-rows";

/**
 * D1/D3 lineage read-model: derives channels (research roots) and videos (brief
 * roots) from the references each workflow persisted at start. Pure and
 * deterministic: the same rows give the same graph in any order.
 *
 * Membership comes only from those references. Nothing is inferred from names,
 * timing or similarity, and a channel root is never split or merged: work that
 * does not trace to exactly one root is unresolved, with its reason.
 */

export type UnresolvedCode =
  | "MISSING_REFERENCE" | "INCONSISTENT_REFERENCE" | "UPSTREAM_NOT_FOUND" | "UPSTREAM_UNRESOLVED"
  | "RUNS_DISAGREE" | "SPANS_CHANNELS" | "PRE_RESEARCH" | "UNKNOWN_TYPE" | "NO_RUNS" | "RUN_NOT_FOUND";

export type LineageAttribution =
  | { status: "resolved"; channelKey: string; videoKey: string | null }
  | { status: "unresolved"; code: UnresolvedCode; reason: string };

export interface LineageChannel {
  /** The research workflow id. */
  key: string;
  label: string;
  labelSource: "research-niche" | "research-concept";
  status: string;
  createdAt: string;
}

export interface LineageVideo {
  /** The brief workflow id. */
  key: string;
  channelKey: string;
  createdAt: string;
}

export interface RunLineage {
  attribution: LineageAttribution;
  /** 1-based position of the run inside its workflow, by (createdAt, id). */
  version: number;
  /** Version of the run this one revises in the same workflow, else null. */
  supersedesVersion: number | null;
}

export interface PendingApprovalLineage {
  approvalId: string;
  workflowId: string;
  runId: string;
  attribution: LineageAttribution;
}

export interface LineageGraph {
  channels: LineageChannel[];
  videos: LineageVideo[];
  workflows: Record<string, LineageAttribution>;
  runs: Record<string, RunLineage>;
  /** Every PENDING approval exactly once, attributed through its workflow. */
  pendingApprovals: PendingApprovalLineage[];
}

const REASON: Record<Exclude<UnresolvedCode, "SPANS_CHANNELS">, string> = {
  MISSING_REFERENCE: "its lineage reference is missing or unreadable",
  INCONSISTENT_REFERENCE: "its lineage reference is inconsistent",
  UPSTREAM_NOT_FOUND: "its upstream run could not be found",
  UPSTREAM_UNRESOLVED: "its upstream work is itself unattributed",
  RUNS_DISAGREE: "its runs point at different channels",
  PRE_RESEARCH: "it is a pre-research concept validation and belongs to no channel",
  UNKNOWN_TYPE: "its workflow type is not part of channel lineage",
  NO_RUNS: "it has no runs",
  RUN_NOT_FOUND: "its run could not be found",
};

const unresolved = (code: Exclude<UnresolvedCode, "SPANS_CHANNELS">): LineageAttribution => ({ status: "unresolved", code, reason: REASON[code] });
const spans = (count: number): LineageAttribution => ({ status: "unresolved", code: "SPANS_CHANNELS", reason: `it spans ${count} channels` });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);
const record = (value: unknown) => (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);
const ascending = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** (createdAt, id) order; an invalid timestamp sorts after every valid one. */
const byCreation = <T extends { createdAt: string; id: string }>(left: T, right: T) => {
  const a = parseInstant(left.createdAt) ?? Number.POSITIVE_INFINITY;
  const b = parseInstant(right.createdAt) ?? Number.POSITIVE_INFINITY;
  return a !== b ? (a < b ? -1 : 1) : ascending(left.id, right.id);
};

const LABEL_LIMIT = 80;
const STAGE_BY_TYPE = new Map(LINEAR_STAGES.map((stage) => [stage.type, stage]));

type RunId = { workflowId: string; runId: string };
/** The exact run each stage type resolved to on the walk from a run back to its research root. */
type Ancestry = Map<string, RunId>;
/** `dependsOn`: every upstream run this run's attribution relied on, transitively. */
type Walked = { attribution: LineageAttribution; ancestry: Ancestry; dependsOn: Set<string> };
const NONE = (): Pick<Walked, "ancestry" | "dependsOn"> => ({ ancestry: new Map(), dependsOn: new Set() });

/** Parsed with the real domain schema; anything that does not parse is unreadable, never trusted. */
type Schema = { safeParse(value: unknown): { success: boolean; data?: unknown } };
const parsed = (schema: Schema, value: unknown): Record<string, unknown> | null => {
  const result = schema.safeParse(value);
  return result.success ? record(result.data) : null;
};
const parsedList = (schema: Schema, value: unknown): Record<string, unknown>[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items = value.map((item) => parsed(schema, item));
  return items.every((item): item is Record<string, unknown> => item !== null) ? items : null;
};

export function resolveLineage(rows: LineageRows): LineageGraph {
  const workflows = new Map<string, LineageWorkflowRow>([...rows.workflows].sort((a, b) => ascending(a.id, b.id)).map((row) => [row.id, row]));
  const runs = new Map<string, LineageRunRow>([...rows.runs].sort((a, b) => ascending(a.id, b.id)).map((row) => [row.id, row]));
  const runsByWorkflow = new Map<string, LineageRunRow[]>();
  for (const run of runs.values()) runsByWorkflow.set(run.workflowId, [...(runsByWorkflow.get(run.workflowId) ?? []), run]);
  for (const list of runsByWorkflow.values()) list.sort(byCreation);

  const memo = new Map<string, Walked>();
  const visiting = new Set<string>();
  const fail = (code: Exclude<UnresolvedCode, "SPANS_CHANNELS">): Walked => ({ attribution: unresolved(code), ...NONE() });

  /** The run, if it is loaded, belongs to the named workflow, and has the expected type. */
  const upstreamRun = (expected: RunId, type: string): LineageRunRow | "missing" | "mismatch" => {
    const run = runs.get(expected.runId);
    if (!run) return "missing";
    if (run.workflowId !== expected.workflowId || workflows.get(run.workflowId)?.workflowType !== type) return "mismatch";
    return run;
  };

  const walk = (runId: string): Walked => {
    const cached = memo.get(runId);
    if (cached) return cached;
    if (visiting.has(runId)) return fail("INCONSISTENT_REFERENCE");
    visiting.add(runId);
    const result = walkUncached(runs.get(runId)!);
    visiting.delete(runId);
    memo.set(runId, result);
    return result;
  };

  const walkUncached = (run: LineageRunRow): Walked => {
    const own: RunId = { workflowId: run.workflowId, runId: run.id };
    const type = workflows.get(run.workflowId)?.workflowType;
    if (!type) return fail("UPSTREAM_NOT_FOUND");
    if (type === "CHANNEL_RESEARCH") return { attribution: { status: "resolved", channelKey: run.workflowId, videoKey: null }, ancestry: new Map([[type, own]]), dependsOn: new Set() };
    if (type === "CHANNEL_CONCEPT_VALIDATION") return fail("PRE_RESEARCH");
    const stage = STAGE_BY_TYPE.get(type);
    if (stage) return walkLinear(run, stage, own);
    if (type === "CHANNEL_VIDEO_PORTFOLIO") return walkPortfolio(run, own);
    if (type === "CHANNEL_VIDEO_INTELLIGENCE") return walkIntelligence(run);
    return fail("UNKNOWN_TYPE");
  };

  const walkLinear = (run: LineageRunRow, stage: LinearStage, own: RunId): Walked => {
    const requested = { workflowId: uuidOf(run.input[stage.requestWorkflowKey]), runId: uuidOf(run.input[stage.requestRunKey]) };
    const reference = parsed(REFERENCE_SCHEMA[stage.upstreamType as keyof typeof REFERENCE_SCHEMA], run.input[stage.referenceKey]);
    if (!requested.workflowId || !requested.runId || !reference) return fail("MISSING_REFERENCE");
    const upstream = upstreamRun(requested as RunId, stage.upstreamType);
    if (upstream === "missing") return fail("UPSTREAM_NOT_FOUND");
    if (upstream === "mismatch") return fail("INCONSISTENT_REFERENCE");
    const parent = walk(upstream.id);
    if (parent.attribution.status !== "resolved") return fail("UPSTREAM_UNRESOLVED");
    // The persisted reference must name exactly the walked ancestors, level by level.
    if (!referenceMatches(reference, stage.upstreamType, parent.ancestry)) return fail("INCONSISTENT_REFERENCE");
    const videoKey = stage.type === "CHANNEL_VIDEO_BRIEF" ? run.workflowId : parent.attribution.videoKey;
    return {
      attribution: { status: "resolved", channelKey: parent.attribution.channelKey, videoKey },
      ancestry: new Map(parent.ancestry).set(stage.type, own),
      dependsOn: new Set([...parent.dependsOn, upstream.id]),
    };
  };

  /** Selections and their compact references must name the same set of exact runs. */
  const selectionsMatch = (selections: RunId[], references: Record<string, unknown>[], prefix: string) => {
    const key = (item: Record<string, unknown>) => `${uuidOf(item[`${prefix}WorkflowId`])}/${uuidOf(item[`${prefix}RunId`])}`;
    const left = selections.map((item) => `${item.workflowId}/${item.runId}`).sort();
    const right = references.map(key).sort();
    return left.length === right.length && new Set(left).size === left.length && left.every((value, index) => value === right[index]);
  };

  const selectionIds = (items: Record<string, unknown>[], prefix: string): RunId[] =>
    items.map((item) => ({ workflowId: uuidOf(item[`${prefix}WorkflowId`])!, runId: uuidOf(item[`${prefix}RunId`])! }));

  /** Walks every selection, then requires all of them to resolve to one channel. */
  const walkSelections = (selections: RunId[], type: string): { walked: Walked[] } | { failed: Walked } => {
    const walked: Walked[] = [];
    for (const selection of selections) {
      const upstream = upstreamRun(selection, type);
      if (upstream === "missing") return { failed: fail("UPSTREAM_NOT_FOUND") };
      if (upstream === "mismatch") return { failed: fail("INCONSISTENT_REFERENCE") };
      walked.push(walk(upstream.id));
    }
    if (walked.some((item) => item.attribution.status !== "resolved")) return { failed: fail("UPSTREAM_UNRESOLVED") };
    const channels = new Set(walked.map((item) => (item.attribution as { channelKey: string }).channelKey));
    if (channels.size > 1) return { failed: { attribution: spans(channels.size), ...NONE() } };
    return { walked };
  };

  const dependenciesOf = (selections: RunId[], walked: Walked[]) => new Set([...selections.map((item) => item.runId), ...walked.flatMap((item) => [...item.dependsOn])]);

  /** The one exact run of a type shared by every walked selection, else null. */
  const sharedAncestor = (walked: Walked[], type: string): RunId | null => {
    const found = new Map(walked.map((item) => item.ancestry.get(type)).filter((item): item is RunId => !!item).map((item) => [item.runId, item]));
    return found.size === 1 && walked.every((item) => item.ancestry.has(type)) ? [...found.values()][0] : null;
  };

  const walkPortfolio = (run: LineageRunRow, own: RunId): Walked => {
    const chosen = parsedList(portfolioExperimentSelectionSchema, run.input.experimentSelections);
    const references = parsedList(approvedVideoExperimentReferenceSchema, run.input.approvedVideoExperimentReferences);
    if (!chosen || !references) return fail("MISSING_REFERENCE");
    const selections = selectionIds(chosen, "experiment");
    if (!selectionsMatch(selections, references, "experiment")) return fail("INCONSISTENT_REFERENCE");
    const result = walkSelections(selections, "CHANNEL_VIDEO_EXPERIMENT");
    if ("failed" in result) return result.failed;
    // Each flat decision summary must name the decision its experiment actually walked to.
    for (const reference of references) {
      const summary = record(reference.upstreamVideoDecision);
      const walkedDecision = result.walked[selections.findIndex((item) => item.runId === uuidOf(reference.experimentRunId))]?.ancestry.get("CHANNEL_VIDEO_DECISION");
      if (!summary || !walkedDecision || uuidOf(summary.decisionWorkflowId) !== walkedDecision.workflowId || uuidOf(summary.decisionRunId) !== walkedDecision.runId) return fail("INCONSISTENT_REFERENCE");
    }
    const channelKey = (result.walked[0].attribution as { channelKey: string }).channelKey;
    const ancestry: Ancestry = new Map([["CHANNEL_VIDEO_PORTFOLIO", own]]);
    // Portfolio is channel-level; it keeps only the anchors every experiment shares.
    for (const type of ["CHANNEL_RESEARCH", "CHANNEL_STRATEGY"]) {
      const shared = sharedAncestor(result.walked, type);
      if (shared) ancestry.set(type, shared);
    }
    return { attribution: { status: "resolved", channelKey, videoKey: null }, ancestry, dependsOn: dependenciesOf(selections, result.walked) };
  };

  const walkIntelligence = (run: LineageRunRow): Walked => {
    const chosen = parsedList(intelligencePortfolioSelectionSchema, run.input.portfolioSelections);
    const references = parsedList(approvedVideoPortfolioReferenceSchema, run.input.approvedVideoPortfolioReferences);
    if (!chosen || !references) return fail("MISSING_REFERENCE");
    const selections = selectionIds(chosen, "portfolio");
    if (!selectionsMatch(selections, references, "portfolio")) return fail("INCONSISTENT_REFERENCE");
    const result = walkSelections(selections, "CHANNEL_VIDEO_PORTFOLIO");
    if ("failed" in result) return result.failed;
    // Exact anchors: each portfolio's research and strategy anchors must be the exact runs it
    // walked to, and every selection must share one strategy run.
    const strategyRuns = new Set<string>();
    for (const reference of references) {
      const ancestry = result.walked[selections.findIndex((item) => item.runId === uuidOf(reference.portfolioRunId))]?.ancestry;
      const research = ancestry?.get("CHANNEL_RESEARCH");
      const strategy = ancestry?.get("CHANNEL_STRATEGY");
      const researchAnchor = uuidOf(record(reference.researchAnchor)?.researchRunId);
      const strategyAnchor = uuidOf(record(reference.strategyAnchor)?.strategyRunId);
      if (!research || !strategy || researchAnchor !== research.runId || strategyAnchor !== strategy.runId) return fail("INCONSISTENT_REFERENCE");
      strategyRuns.add(strategy.runId);
    }
    if (strategyRuns.size !== 1) return fail("INCONSISTENT_REFERENCE");
    const channelKey = (result.walked[0].attribution as { channelKey: string }).channelKey;
    return { attribution: { status: "resolved", channelKey, videoKey: null }, ancestry: new Map(), dependsOn: dependenciesOf(selections, result.walked) };
  };

  /** Each nested level of a persisted reference must name the exact walked run of its stage. */
  const referenceMatches = (reference: Record<string, unknown>, type: string, ancestry: Ancestry): boolean => {
    let level: Record<string, unknown> | null = reference;
    let levelType: string | null = type;
    while (level && levelType) {
      const shape: { prefix: string; upstreamKey: string | null } | undefined = REFERENCE_SHAPE[levelType];
      const expected = ancestry.get(levelType);
      if (!shape || !expected) return false;
      if (uuidOf(level[`${shape.prefix}WorkflowId`]) !== expected.workflowId || uuidOf(level[`${shape.prefix}RunId`]) !== expected.runId) return false;
      if (!shape.upstreamKey) return true;
      level = record(level[shape.upstreamKey]);
      levelType = STAGE_BY_TYPE.get(levelType)?.upstreamType ?? null;
      if (!level) return false;
    }
    return false;
  };

  const sortedRuns = [...runs.values()];
  const effective = new Map(sortedRuns.map((run) => [run.id, walk(run.id).attribution]));

  /** Every run of a workflow must agree; a split is never resolved by picking a side. */
  const attributeWorkflows = () => {
    const out: Record<string, LineageAttribution> = {};
    for (const workflow of workflows.values()) {
      const list = runsByWorkflow.get(workflow.id) ?? [];
      if (workflow.workflowType === "CHANNEL_CONCEPT_VALIDATION") { out[workflow.id] = unresolved("PRE_RESEARCH"); continue; }
      if (list.length === 0) { out[workflow.id] = unresolved("NO_RUNS"); continue; }
      const attributions = list.map((run) => effective.get(run.id)!);
      const firstUnresolved = attributions.find((item) => item.status === "unresolved");
      if (firstUnresolved) { out[workflow.id] = firstUnresolved; continue; }
      const identities = new Set(attributions.map((item) => item.status === "resolved" ? `${item.channelKey}/${item.videoKey}` : ""));
      out[workflow.id] = identities.size === 1 ? attributions[0] : unresolved("RUNS_DISAGREE");
    }
    return out;
  };

  // A workflow found unresolved as a whole (e.g. its runs disagree) unresolves its own runs, with its
  // reason, and every run that relied on any of them, until nothing changes. The unresolved set only
  // grows, so this ends.
  let workflowLineage = attributeWorkflows();
  for (let changed = true; changed;) {
    changed = false;
    for (const run of sortedRuns) {
      if (effective.get(run.id)!.status !== "resolved") continue;
      const own = workflowLineage[run.workflowId];
      const tainted = [...memo.get(run.id)!.dependsOn].some((dependency) => workflowLineage[runs.get(dependency)!.workflowId]?.status !== "resolved");
      if (own?.status === "unresolved") effective.set(run.id, own);
      else if (tainted) effective.set(run.id, unresolved("UPSTREAM_UNRESOLVED"));
      else continue;
      changed = true;
    }
    if (changed) workflowLineage = attributeWorkflows();
  }

  // Runs: attribution, version and the version they supersede.
  const runLineage: Record<string, RunLineage> = {};
  for (const [workflowId, list] of [...runsByWorkflow.entries()].sort(([a], [b]) => ascending(a, b))) {
    const versions = new Map(list.map((run, index) => [run.id, index + 1]));
    for (const run of list) {
      const previous = run.previousRunId ? uuidOf(run.previousRunId) : null;
      const supersedesVersion = previous && runs.get(previous)?.workflowId === workflowId ? versions.get(previous) ?? null : null;
      runLineage[run.id] = { attribution: effective.get(run.id)!, version: versions.get(run.id)!, supersedesVersion };
    }
  }

  const channels: LineageChannel[] = [...workflows.values()]
    .filter((workflow) => workflow.workflowType === "CHANNEL_RESEARCH" && workflowLineage[workflow.id]?.status === "resolved")
    .map((workflow) => ({ key: workflow.id, ...channelLabel(runsByWorkflow.get(workflow.id) ?? []), status: workflow.status, createdAt: workflow.createdAt }))
    .sort((a, b) => byCreation({ createdAt: a.createdAt, id: a.key }, { createdAt: b.createdAt, id: b.key }));

  const videos: LineageVideo[] = [...workflows.values()]
    .filter((workflow) => workflow.workflowType === "CHANNEL_VIDEO_BRIEF")
    .flatMap((workflow) => {
      const attribution = workflowLineage[workflow.id];
      return attribution?.status === "resolved" ? [{ key: workflow.id, channelKey: attribution.channelKey, createdAt: workflow.createdAt }] : [];
    })
    .sort((a, b) => byCreation({ createdAt: a.createdAt, id: a.key }, { createdAt: b.createdAt, id: b.key }));

  const pendingApprovals = [...rows.approvals]
    .filter((approval) => approval.status === "PENDING")
    .sort((a, b) => ascending(a.id, b.id))
    .map((approval: LineageApprovalRow): PendingApprovalLineage => {
      const run = runs.get(approval.runId);
      const attribution = !run || run.workflowId !== approval.workflowId
        ? unresolved("RUN_NOT_FOUND")
        : workflowLineage[approval.workflowId] ?? unresolved("UPSTREAM_NOT_FOUND");
      return { approvalId: approval.id, workflowId: approval.workflowId, runId: approval.runId, attribution };
    });

  return { channels, videos, workflows: workflowLineage, runs: runLineage, pendingApprovals };
}

/** The research niche labels the channel; concept-only research falls back to its concept text. */
function channelLabel(runs: LineageRunRow[]): Pick<LineageChannel, "label" | "labelSource"> {
  const input = runs[0]?.input ?? {};
  const niche = typeof input.niche === "string" ? input.niche.trim() : "";
  if (niche) return { label: niche, labelSource: "research-niche" };
  const concept = typeof input.channelConcept === "string" ? input.channelConcept.trim().replace(/\s+/g, " ") : "";
  if (concept) return { label: concept.length > LABEL_LIMIT ? `${concept.slice(0, LABEL_LIMIT - 1).trimEnd()}…` : concept, labelSource: "research-concept" };
  return { label: "Untitled channel", labelSource: "research-concept" };
}

/** Pending approvals per channel plus the account-level unresolved ones; each approval is counted once. */
export function pendingCounts(graph: LineageGraph) {
  const byChannel = new Map<string, number>();
  let unresolvedCount = 0;
  for (const approval of graph.pendingApprovals) {
    if (approval.attribution.status === "resolved") byChannel.set(approval.attribution.channelKey, (byChannel.get(approval.attribution.channelKey) ?? 0) + 1);
    else unresolvedCount += 1;
  }
  return { total: graph.pendingApprovals.length, byChannel, unresolved: unresolvedCount };
}
