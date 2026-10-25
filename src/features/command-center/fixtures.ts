import type { CommandCenterView, StageCellState, VideoInFlight, VideoStageKey } from "./model";

/**
 * Fixture scenarios for the Phase B preview. They are demonstration data only:
 * never merged with production workflow data, and only served when fixture
 * mode is on (owner decision Q4).
 */

const AS_OF = "2026-10-24T15:00:00.000Z";
const RESOLVED = { status: "resolved" } as const;

const track = (states: string): Record<VideoStageKey, StageCellState> => {
  const code: Record<string, StageCellState> = { d: "done", y: "you", s: "system", r: "recover", n: "none" };
  const keys: VideoStageKey[] = ["BRIEF", "SCRIPT", "PACKAGING", "RELEASE", "PERFORMANCE", "DIAGNOSIS", "DECISION", "EXPERIMENT"];
  return Object.fromEntries(keys.map((key, index) => [key, code[states[index]]])) as Record<VideoStageKey, StageCellState>;
};

const CHANNEL = {
  status: "ready",
  data: {
    label: "Budget mechanical keyboards",
    labelSource: "research-niche",
    thesis: "Cheap keyboards, tested honestly, for people who already bought the wrong one.",
    strategyVersion: 3,
    strategyApprovedAt: "2026-10-12T16:20:00.000Z",
    revenuePathCount: 3,
    lastReview: { outcome: "HOLD", at: "2026-10-12T16:20:00.000Z" },
  },
} as const satisfies CommandCenterView["channel"];

const VIDEOS: VideoInFlight[] = [
  { rootWorkflowId: "wf-brief-10-setup", title: "The $10 Setup, Tested Honestly", cells: track("ddddynnn"), currentStage: "PERFORMANCE", stateLabel: "05 Performance · not entered", waitingOn: "you", waitingLabel: "You · no due rule yet", updatedAt: "2026-10-09T14:00:00.000Z", attribution: RESOLVED },
  { rootWorkflowId: "wf-brief-cheap-feel", title: "Why cheap keyboards feel better than expensive ones", cells: track("dynnnnnn"), currentStage: "SCRIPT", stateLabel: "02 Script v2 · review", waitingOn: "you", waitingLabel: "You", updatedAt: "2026-10-22T11:05:00.000Z", attribution: RESOLVED },
  { rootWorkflowId: "wf-brief-lube", title: "Lubing $8 switches: worth it?", cells: track("ddynnnnn"), currentStage: "PACKAGING", stateLabel: "03 Packaging v1 · review", waitingOn: "you", waitingLabel: "You", updatedAt: "2026-10-23T09:40:00.000Z", attribution: RESOLVED },
  { rootWorkflowId: "wf-brief-gasket", title: "Gasket mods under $20", cells: track("dddddynn"), currentStage: "DIAGNOSIS", stateLabel: "06 Diagnosis v1 · no review screen yet", waitingOn: "you", waitingLabel: "You · not actionable here", updatedAt: "2026-10-21T17:30:00.000Z", attribution: RESOLVED },
  { rootWorkflowId: "wf-brief-returned", title: "The keyboard I returned", cells: track("snnnnnnn"), currentStage: "BRIEF", stateLabel: "01 Brief v2 · generating", waitingOn: "system", waitingLabel: "System · running", updatedAt: "2026-10-24T14:56:00.000Z", attribution: RESOLVED },
  { rootWorkflowId: "wf-brief-legacy-keychron", title: "Keychron vs. no-name: same board?", cells: track("dynnnnnn"), currentStage: "SCRIPT", stateLabel: "02 Script v1 · review", waitingOn: "you", waitingLabel: "You", updatedAt: "2026-10-20T10:00:00.000Z", attribution: { status: "ambiguous", reason: "its Content plan reference does not resolve to an approved run" } },
];

export const operatingScenario: CommandCenterView = {
  scenario: "operating",
  asOf: AS_OF,
  channel: CHANNEL,
  gates: {
    status: "ready",
    data: [
      { approvalId: "ap-diag-gasket", workflowId: "wf-diag-gasket", runId: "run-diag-gasket-1", stage: "DIAGNOSIS", version: 1, supersedesVersion: null, subject: "Gasket mods under $20", note: "Why it beat plan.", requestedAt: "2026-10-21T17:30:00.000Z", surface: "unavailable", attribution: RESOLVED },
      { approvalId: "ap-script-cheap", workflowId: "wf-script-cheap", runId: "run-script-cheap-2", stage: "SCRIPT", version: 2, supersedesVersion: 1, subject: "Why cheap keyboards feel better than expensive ones", note: "Evidence revised after your revision request.", requestedAt: "2026-10-22T11:05:00.000Z", surface: "available", attribution: RESOLVED },
      { approvalId: "ap-pack-lube", workflowId: "wf-pack-lube", runId: "run-pack-lube-1", stage: "PACKAGING", version: 1, supersedesVersion: null, subject: "Lubing $8 switches: worth it?", note: "Title, thumbnail brief and description.", requestedAt: "2026-10-23T09:40:00.000Z", surface: "available", attribution: RESOLVED },
      { approvalId: "ap-script-keychron", workflowId: "wf-script-keychron", runId: "run-script-keychron-1", stage: "SCRIPT", version: 1, supersedesVersion: null, subject: "Keychron vs. no-name: same board?", note: "Draft script.", requestedAt: "2026-10-20T10:00:00.000Z", surface: "available", attribution: { status: "ambiguous", reason: "its Content plan reference does not resolve to an approved run" } },
    ],
  },
  videos: { status: "ready", data: VIDEOS },
  tasks: [
    { id: "perf-10-setup", kind: "RECORD_PERFORMANCE", stage: "PERFORMANCE", subject: "Record performance · The $10 Setup, Tested Honestly", detail: "Released Oct 9. Its release bound H1 and H2; neither has a result.", href: "/studio#stage-performance", dueAt: null, createdAt: "2026-10-09T14:00:00.000Z", surface: "available", attribution: RESOLVED },
    { id: "brief-topic-6", kind: "START_BRIEF", stage: "BRIEF", subject: "Start a brief · Plan topic #6: the $25 board that beat my $180 one", detail: "Highest-ranked unbriefed topic in the approved content plan.", href: "/studio#stage-brief", dueAt: null, createdAt: "2026-10-12T16:30:00.000Z", surface: "available", attribution: RESOLVED },
  ],
  learning: {
    status: "ready",
    data: [
      { id: "h1", kind: "HYPOTHESIS", outcome: "SUPPORTED", statement: "Honest verdicts hold attention better than spec sheets.", source: "H1 · Gasket mods · 48% viewed vs 40% planned" },
      { id: "h2", kind: "HYPOTHESIS", outcome: "NOT_SUPPORTED", statement: "A price tag on the thumbnail lifts click-through.", source: "H2 · Desk mats · 3.1% CTR vs 4.5% planned" },
      { id: "x1", kind: "EXPERIMENT", outcome: "RUNNING", statement: "Verdict-first title vs price-first title.", source: "Experiment · window ends Nov 2" },
      { id: "l1", kind: "LESSON", outcome: "HELD", statement: "Lead with the verdict in the first 15 seconds.", source: "Channel lesson · held provisionally · 2 cycles" },
      { id: "r1", kind: "STRATEGY_REVIEW", outcome: "HOLD", statement: "Keep the thesis. Revisit pillar 3 after two more releases.", source: "Strategy review · Oct 12" },
    ],
  },
  performance: {
    status: "ready",
    data: [
      { videoTitle: "Gasket mods under $20", views: 18_420, averageViewedPct: 48, versusPlan: "ABOVE" },
      { videoTitle: "Desk mats don't matter", views: 9_880, averageViewedPct: 39, versusPlan: "ON_PLAN" },
      { videoTitle: "The board that broke in a week", views: 6_210, averageViewedPct: 31, versusPlan: "BELOW" },
      { videoTitle: "The $10 Setup, Tested Honestly", views: null, averageViewedPct: null, versusPlan: "NOT_ENTERED" },
    ],
  },
  globalPendingCount: 4,
};

export const firstRunScenario: CommandCenterView = {
  scenario: "first-run",
  asOf: AS_OF,
  channel: { status: "empty", message: "No approved research or strategy yet. Production opens once a strategy and a content plan are approved.", action: { label: "Start research", href: "/studio#stage-research" } },
  gates: { status: "ready", data: [] },
  videos: { status: "empty", message: "Nothing in production. Videos start from topics in an approved content plan." },
  tasks: [
    { id: "research-first", kind: "START_RESEARCH", stage: "RESEARCH", subject: "Research a channel opportunity", detail: "Describe a niche. Channelwright gathers live YouTube evidence and says whether it deserves a strategy. Nothing is produced or published.", href: "/studio#stage-research", dueAt: null, createdAt: AS_OF, surface: "available", attribution: RESOLVED },
  ],
  learning: { status: "empty", message: "Lessons appear after a released video is measured and diagnosed." },
  performance: { status: "empty", message: "Nothing released yet. You enter performance per video after release." },
  globalPendingCount: 0,
};

export const degradedScenario: CommandCenterView = {
  scenario: "degraded",
  asOf: AS_OF,
  channel: CHANNEL,
  gates: { status: "error", message: "Pending approvals did not load. Nothing was changed.", requestId: "cw_req_8f2a41c0" },
  videos: {
    status: "ready",
    data: [
      { ...VIDEOS[4], cells: track("rnnnnnnn"), stateLabel: "01 Brief v2 · failed QA twice", waitingOn: "you", waitingLabel: "You · needs recovery", updatedAt: "2026-10-24T14:20:00.000Z" },
      VIDEOS[0],
    ],
  },
  tasks: [
    { id: "fail-brief-returned", kind: "RESOLVE_FAILURE", stage: "BRIEF", subject: "Resolve failed Brief v2 · The keyboard I returned", detail: "The draft failed final QA twice and stopped. The prior approved inputs are untouched.", href: "/studio#stage-brief", dueAt: null, createdAt: "2026-10-24T14:20:00.000Z", surface: "available", attribution: RESOLVED },
  ],
  learning: { status: "unavailable", message: "Channel learning needs the lineage read-model and the Diagnosis, Decision and Experiment screens.", dependency: "D3 · D8" },
  performance: { status: "loading" },
  globalPendingCount: null,
};

export const SCENARIOS = { operating: operatingScenario, "first-run": firstRunScenario, degraded: degradedScenario } as const;
export type ScenarioKey = keyof typeof SCENARIOS;
export const isScenarioKey = (key: string | undefined): key is ScenarioKey => key !== undefined && Object.hasOwn(SCENARIOS, key);
export const scenarioFor = (key: string | undefined): CommandCenterView => isScenarioKey(key) ? SCENARIOS[key] : operatingScenario;
