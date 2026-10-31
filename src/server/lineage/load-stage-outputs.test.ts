import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ method: string; args: unknown[] }> = [];
let rows: Array<Record<string, unknown>> = [];
let failing = false;

/** Each query keeps its own id filter, since the three reads run concurrently. */
function table() {
  const builder: Record<string, unknown> = {};
  let ids: string[] = [];
  for (const method of ["select", "eq", "in"]) builder[method] = (...args: unknown[]) => {
    calls.push({ method, args });
    if (method === "in") ids = args[1] as string[];
    return builder;
  };
  builder.then = (resolve: (value: unknown) => unknown) => {
    if (failing) return Promise.resolve({ data: null, error: { message: "relation does not exist" } }).then(resolve);
    return Promise.resolve({ data: rows.filter((row) => ids.includes(row.id as string)), error: null }).then(resolve);
  };
  return builder;
}

vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: async () => ({ from: (name: string) => { calls.push({ method: "from", args: [name] }); return table(); } }) }));
const logFailure = vi.fn();
vi.mock("@/server/observability", () => ({ logFailure }));

const { loadStageOutputs, STAGE_OUTPUT_CHUNK } = await import("./load-stage-outputs");

const USER = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => { calls.length = 0; rows = []; failing = false; logFailure.mockClear(); });

describe("loadStageOutputs", () => {
  it("reads only named output paths for the requested runs, filtered by owner", async () => {
    rows = [
      { id: id(1), thesis: "Cheap keyboards, tested honestly.", monetization: [{ path: "SPONSORSHIPS" }, { path: "AFFILIATE_REVENUE" }] },
      { id: id(2), backlog: [{ topicId: "t1", rank: 1 }], topics: [{ topicId: "t1", workingConcept: "Gasket mods", viewerValue: { gate: "PASS" } }] },
      { id: id(3), metrics: { views: 1200, averagePercentageViewedPct: 41.5, impressions: 9 } },
    ];
    const load = await loadStageOutputs(USER, { strategyRunIds: [id(1)], contentRunIds: [id(2)], performanceRunIds: [id(3)] });
    expect(load).toEqual({
      strategy: { status: "ok", data: { [id(1)]: { thesis: "Cheap keyboards, tested honestly.", revenuePathCount: 2 } } },
      content: { status: "ok", data: { [id(2)]: { backlog: [{ topicId: "t1", rank: 1 }], topics: [{ topicId: "t1", workingConcept: "Gasket mods", viewerValue: { gate: "PASS" } }] } } },
      performance: { status: "ok", data: { [id(3)]: { views: 1200, averageViewedPct: 41.5 } } },
    });
    const selects = calls.filter((call) => call.method === "select").map((call) => call.args[0] as string);
    for (const select of selects) {
      expect(select).toMatch(/^id,/);
      expect(select).not.toMatch(/output_payload(,|$)|\*|input_payload/);
    }
    expect(calls.filter((call) => call.method === "eq")).toEqual(Array.from({ length: 3 }, () => ({ method: "eq", args: ["owner_id", USER] })));
    expect(calls.filter((call) => call.method === "from").map((call) => call.args[0])).toEqual(["workflow_runs", "workflow_runs", "workflow_runs"]);
  });

  it("queries nothing for an empty request and chunks long id lists", async () => {
    const empty = { status: "ok", data: {} };
    expect(await loadStageOutputs(USER, { strategyRunIds: [], contentRunIds: [], performanceRunIds: [] })).toEqual({ strategy: empty, content: empty, performance: empty });
    expect(calls).toEqual([]);
    rows = Array.from({ length: STAGE_OUTPUT_CHUNK + 1 }, (_, n) => ({ id: id(n + 1), backlog: [], topics: [] }));
    const chunked = await loadStageOutputs(USER, { strategyRunIds: [], contentRunIds: rows.map((row) => row.id as string), performanceRunIds: [] });
    expect(chunked.content.status).toBe("ok");
    expect(calls.filter((call) => call.method === "in").map((call) => (call.args[1] as string[]).length)).toEqual([STAGE_OUTPUT_CHUNK, 1]);
    expect(calls.filter((call) => call.method === "in").map((call) => (call.args[1] as string[]).length)).toEqual([STAGE_OUTPUT_CHUNK, 1]);
  });

  it("returns a request id, never the database message, when a read fails", async () => {
    failing = true;
    const load = await loadStageOutputs(USER, { strategyRunIds: [id(1)], contentRunIds: [], performanceRunIds: [] });
    expect(load.strategy).toEqual({ status: "error", requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(load.content).toEqual({ status: "ok", data: {} });
    expect(JSON.stringify(load)).not.toContain("relation");
    expect(logFailure).toHaveBeenCalledWith("stage_outputs_unavailable", expect.anything(), expect.objectContaining({ requestId: expect.any(String), category: "strategy" }));
  });

  it("fails only the category whose requested artifact is missing or unreadable (PR21-004, PR21-006)", async () => {
    const strategy = { id: id(1), thesis: "Cheap keyboards, tested honestly.", monetization: [] };
    const content = { id: id(2), backlog: [{ topicId: "t1", rank: 1 }], topics: [{ topicId: "t1", workingConcept: "Gasket mods", viewerValue: {} }] };
    const performance = { id: id(3), metrics: { views: null, averagePercentageViewedPct: null } };
    const request = { strategyRunIds: [id(1)], contentRunIds: [id(2)], performanceRunIds: [id(3)] };
    const cases: Array<[string, Array<Record<string, unknown>>, "strategy" | "content" | "performance"]> = [
      ["a requested row is missing", [strategy, content], "performance"],
      ["the performance metrics object is absent", [strategy, content, { id: id(3), metrics: null }], "performance"],
      ["a backlog entry is malformed", [strategy, { ...content, backlog: [{ rank: 2 }] }, performance], "content"],
      ["the topics list is absent", [strategy, { ...content, topics: null }, performance], "content"],
      ["a topic has no working concept", [strategy, { ...content, topics: [{ topicId: "t1" }] }, performance], "content"],
      ["the thesis is absent", [{ ...strategy, thesis: null }, content, performance], "strategy"],
    ];
    for (const [label, present, failed] of cases) {
      rows = present;
      const load = await loadStageOutputs(USER, request);
      for (const category of ["strategy", "content", "performance"] as const) {
        expect(load[category].status, `${label}: ${category}`).toBe(category === failed ? "error" : "ok");
      }
    }
    // Nullable metric values are valid: the operator enters what they have.
    rows = [strategy, content, performance];
    expect((await loadStageOutputs(USER, request)).performance).toEqual({ status: "ok", data: { [id(3)]: { views: null, averageViewedPct: null } } });
  });

  it("never sends a non-UUID run id to the database (PR21-003)", async () => {
    const load = await loadStageOutputs(USER, { strategyRunIds: [], contentRunIds: ["not-a-uuid"], performanceRunIds: [] });
    expect(load.content.status).toBe("error");
    expect(calls).toEqual([]);
  });
});
