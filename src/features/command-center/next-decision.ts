import { STAGE_LABEL, VIDEO_STAGES, type CommandCenterView, type OperatorTask, type PendingGate, type StageKey } from "./model";

/**
 * Deterministic Next Decision ranking.
 *
 * Principle (owner decision Q2): close learning loops before opening new ones,
 * but only when the learning work is eligible and actionable. Pending approval
 * gates block the pipeline and always outrank routine operator tasks; an
 * overdue measurement can move ahead of production gates only after it has
 * been overdue for ESCALATE_AFTER_DAYS. Nothing here starts or decides work.
 */

/** Days past its due date after which a measurement task outranks production gates. Owner-tunable. */
export const ESCALATE_AFTER_DAYS = 7;

export type Tier = 0 | 1 | 2 | 3 | 4;

export const TIER_LABEL: Record<Tier, string> = {
  0: "P0 · Recover",
  1: "P1 · Decide",
  2: "P2 · Close the loop",
  3: "P3 · Produce",
  4: "P4 · Foundation",
};

export interface Candidate {
  id: string;
  tier: Tier;
  rule: string;
  title: string;
  detail: string;
  cta: string;
  href: string;
}

export interface ExcludedItem {
  id: string;
  title: string;
  reason: string;
}

export interface NextDecision {
  primary: Candidate | null;
  deferred: Candidate[];
  excluded: ExcludedItem[];
  /** False when pending approvals did not load, so a gate could be missing from the ranking. */
  complete: boolean;
}

const DAY_MS = 86_400_000;
const LEARNING_STAGES = new Set<StageKey>(["PERFORMANCE", "DIAGNOSIS", "DECISION", "EXPERIMENT", "PORTFOLIO", "INTELLIGENCE"]);
const CHANNEL_STAGES = new Set<StageKey>(["RESEARCH", "STRATEGY", "CONTENT_PLAN"]);

/**
 * Where each stage can be acted on today. Phase B destinations do not exist
 * yet, so actionable stages point at the existing Studio workspace; stages
 * without a workspace have no entry and are never recommended.
 */
export const CURRENT_STUDIO_ANCHOR: Partial<Record<StageKey, string>> = {
  RESEARCH: "/studio#stage-research",
  STRATEGY: "/studio#stage-strategy",
  CONTENT_PLAN: "/studio#stage-content",
  BRIEF: "/studio#stage-brief",
  SCRIPT: "/studio#stage-script",
  PACKAGING: "/studio#stage-packaging",
  RELEASE: "/studio#stage-release",
  PERFORMANCE: "/studio#stage-performance",
};

const videoStageIndex = (stage: StageKey) => VIDEO_STAGES.findIndex((item) => item.key === stage);
const time = (iso: string) => Date.parse(iso);

/** Sort key within a tier: lower sorts first. */
type Ranked = Candidate & { order: number[] };

function gateCandidate(gate: PendingGate): Ranked {
  const learning = LEARNING_STAGES.has(gate.stage);
  const channel = CHANNEL_STAGES.has(gate.stage);
  const stage = STAGE_LABEL[gate.stage];
  return {
    id: `gate:${gate.approvalId}`,
    tier: 1,
    rule: learning ? "Learning gate waiting on you" : channel ? "Channel gate blocks every video" : "Production gate waiting on you",
    title: `Review ${stage} v${gate.version} · ${gate.subject}`,
    detail: gate.supersedesVersion ? `${gate.note} Supersedes v${gate.supersedesVersion}.` : gate.note,
    cta: `Review ${stage} v${gate.version}`,
    href: CURRENT_STUDIO_ANCHOR[gate.stage] ?? "",
    // Learning gates, then channel gates, then video gates downstream-first; oldest breaks ties.
    order: [learning ? 0 : channel ? 2 : 3, learning || channel ? 0 : -videoStageIndex(gate.stage), time(gate.requestedAt)],
  };
}

function taskCandidate(task: OperatorTask, asOf: number): Ranked {
  const base = { id: `task:${task.id}`, title: task.subject, detail: task.detail, href: task.href, cta: ctaFor(task) };
  if (task.kind === "RESOLVE_FAILURE") return { ...base, tier: 0, rule: "A run failed and needs you", order: [time(task.createdAt)] };
  if (task.kind === "START_BRIEF") return { ...base, tier: 3, rule: "Approved plan has an unbriefed topic", order: [time(task.createdAt)] };
  if (task.kind === "START_RESEARCH") return { ...base, tier: 4, rule: "No approved strategy yet", order: [time(task.createdAt)] };
  const overdueDays = task.dueAt ? Math.floor((asOf - time(task.dueAt)) / DAY_MS) : 0;
  if (overdueDays >= ESCALATE_AFTER_DAYS) {
    // Escalated measurement sits between learning gates (0) and channel gates (2).
    return { ...base, tier: 1, rule: `Overdue ${overdueDays} days: escalated`, order: [1, 0, time(task.dueAt!)] };
  }
  return { ...base, tier: 2, rule: "Learning work is due", order: [task.dueAt ? time(task.dueAt) : time(task.createdAt)] };
}

function ctaFor(task: OperatorTask) {
  switch (task.kind) {
    case "RECORD_PERFORMANCE": return "Record performance";
    case "START_DIAGNOSIS": return "Start diagnosis";
    case "START_EXPERIMENT": return "Start experiment";
    case "START_BRIEF": return "Start a brief";
    case "START_RESEARCH": return "Start research";
    case "RESOLVE_FAILURE": return "Resolve failure";
  }
}

/** Why an item cannot be recommended right now, or null when it can. */
function exclusion(item: { surface: string; attribution: { status: string; reason?: string } }, extra?: string | null) {
  if (item.attribution.status === "ambiguous") return `Not attributed to this channel: ${item.attribution.reason}`;
  if (item.surface === "unavailable") return "No screen for this step yet, so it cannot be acted on here.";
  return extra ?? null;
}

function measurementExclusion(task: OperatorTask, asOf: number) {
  if (task.kind !== "RECORD_PERFORMANCE") return null;
  if (!task.dueAt) return "No rule defines when measurement is due, so it is not ranked.";
  if (time(task.dueAt) > asOf) return "Measurement window is still open.";
  return null;
}

const compare = (left: Ranked, right: Ranked) => {
  if (left.tier !== right.tier) return left.tier - right.tier;
  for (let index = 0; index < Math.max(left.order.length, right.order.length); index += 1) {
    const delta = (left.order[index] ?? 0) - (right.order[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return left.id.localeCompare(right.id);
};

export function rankNextDecision(view: Pick<CommandCenterView, "gates" | "tasks" | "asOf">): NextDecision {
  const asOf = time(view.asOf);
  const ranked: Ranked[] = [];
  const excluded: ExcludedItem[] = [];
  const gates = view.gates.status === "ready" ? view.gates.data : [];
  for (const gate of gates) {
    const reason = exclusion(gate);
    const candidate = gateCandidate(gate);
    if (reason || !candidate.href) excluded.push({ id: candidate.id, title: candidate.title, reason: reason ?? "No screen for this step yet." });
    else ranked.push(candidate);
  }
  for (const task of view.tasks) {
    const reason = exclusion(task, measurementExclusion(task, asOf));
    if (reason) excluded.push({ id: `task:${task.id}`, title: task.subject, reason });
    else ranked.push(taskCandidate(task, asOf));
  }
  const sorted = ranked.sort(compare).map(strip);
  return { primary: sorted[0] ?? null, deferred: sorted.slice(1), excluded, complete: view.gates.status === "ready" };
}

const strip = ({ id, tier, rule, title, detail, cta, href }: Ranked): Candidate => ({ id, tier, rule, title, detail, cta, href });
