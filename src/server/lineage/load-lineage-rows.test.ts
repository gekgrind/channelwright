import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
let pages: Record<string, Array<Record<string, unknown>[]>> = {};
let failing: string | null = null;

/** A chainable stand-in for the RLS-bound client; each awaited query returns the next page for its table. */
function table(name: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => { calls.push({ table: name, method, args }); return builder; };
  }
  builder.then = (resolve: (value: unknown) => unknown) => {
    if (failing === name) return Promise.resolve({ data: null, error: { message: "permission denied for table" } }).then(resolve);
    const next = pages[name]?.shift() ?? [];
    return Promise.resolve({ data: next, error: null }).then(resolve);
  };
  return builder;
}

vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: async () => ({ from: table }) }));
const logFailure = vi.fn();
vi.mock("@/server/observability", () => ({ logFailure }));

const { loadLineageRows, LINEAGE_CEILING, LINEAGE_PAGE_SIZE } = await import("./load-lineage-rows");

const USER = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * 1000).toISOString().replace("Z", "+00:00");
const workflow = (n: number) => ({ id: id(n), workflow_type: "CHANNEL_RESEARCH", status: "COMPLETED", created_at: at(n) });
const fullPage = (from: number, make: (n: number) => Record<string, unknown>) => Array.from({ length: LINEAGE_PAGE_SIZE }, (_, index) => make(from + index));

beforeEach(() => { calls.length = 0; pages = {}; failing = null; logFailure.mockClear(); });

describe("loadLineageRows", () => {
  it("filters every query by the signed-in owner and pages each table on its own keyset", async () => {
    pages = {
      workflows: [fullPage(1, workflow), [workflow(LINEAGE_PAGE_SIZE + 1)]],
      workflow_runs: [[]],
      workflow_approvals: [[{ id: id(9), workflow_id: id(1), workflow_run_id: id(2), status: "PENDING", requested_at: at(9), decided_at: null }]],
    };
    const load = await loadLineageRows(USER);
    expect(load.workflows).toMatchObject({ status: "ok" });
    expect(load.workflows.status === "ok" && load.workflows.rows).toHaveLength(LINEAGE_PAGE_SIZE + 1);
    expect(load.approvals).toEqual({ status: "ok", rows: [{ id: id(9), workflowId: id(1), runId: id(2), status: "PENDING", requestedAt: at(9), decidedAt: null }] });

    for (const name of ["workflows", "workflow_runs", "workflow_approvals"]) {
      const selects = calls.filter((call) => call.table === name && call.method === "select").length;
      expect(calls.filter((call) => call.table === name && call.method === "eq")).toEqual(Array.from({ length: selects }, () => ({ table: name, method: "eq", args: ["owner_id", USER] })));
    }
    const last = workflow(LINEAGE_PAGE_SIZE);
    expect(calls).toContainEqual({ table: "workflows", method: "or", args: [`created_at.gt."${last.created_at}",and(created_at.eq."${last.created_at}",id.gt.${last.id})`] });
    expect(calls).toContainEqual({ table: "workflow_approvals", method: "order", args: ["requested_at", { ascending: true }] });
    expect(calls.some((call) => call.table === "workflow_approvals" && call.method === "order" && call.args[0] === "created_at")).toBe(false);
  });

  it("projects only lineage keys of the run payloads, including the run's own previous run", async () => {
    pages = {
      workflows: [[]],
      workflow_runs: [[{ id: id(2), workflow_id: id(1), status: "COMPLETED", created_at: at(2), previousRunId: id(3), researchWorkflowId: id(4), researchRunId: id(5), approvedResearchReference: { researchRunId: id(5) }, niche: null }]],
      workflow_approvals: [[]],
    };
    const load = await loadLineageRows(USER);
    const select = calls.find((call) => call.table === "workflow_runs" && call.method === "select")!.args[0] as string;
    expect(select).toContain("previousRunId:context_payload->>previousRunId");
    expect(select).toContain("approvedVideoPortfolioReferences:input_payload->approvedVideoPortfolioReferences");
    expect(select).not.toMatch(/output_payload|input_payload(,|$)|\*/);
    expect(load.runs).toEqual({ status: "ok", rows: [{ id: id(2), workflowId: id(1), status: "COMPLETED", createdAt: at(2), previousRunId: id(3), input: { researchWorkflowId: id(4), researchRunId: id(5), approvedResearchReference: { researchRunId: id(5) } } }] });
  });

  it("reports a table above its ceiling as too large instead of returning a truncated set", async () => {
    const count = Math.ceil((LINEAGE_CEILING.workflows + 1) / LINEAGE_PAGE_SIZE);
    pages = { workflows: Array.from({ length: count }, (_, page) => fullPage(page * LINEAGE_PAGE_SIZE + 1, workflow)), workflow_runs: [[]], workflow_approvals: [[]] };
    expect((await loadLineageRows(USER)).workflows).toEqual({ status: "too_large" });
  });

  it("isolates a failed table with a request id and never surfaces the database message", async () => {
    failing = "workflow_approvals";
    pages = { workflows: [[]], workflow_runs: [[]] };
    const load = await loadLineageRows(USER);
    expect(load.workflows).toEqual({ status: "ok", rows: [] });
    expect(load.approvals).toEqual({ status: "error", requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(JSON.stringify(load)).not.toContain("permission denied");
    expect(logFailure).toHaveBeenCalledWith("lineage_rows_unavailable", expect.anything(), expect.objectContaining({ table: "workflow_approvals" }));
  });

  it("fails closed on a cursor value it does not recognise", async () => {
    pages = { workflows: [fullPage(1, (n) => ({ ...workflow(n), created_at: n === LINEAGE_PAGE_SIZE ? '2026-10-01"),id.gt.(0' : at(n) }))], workflow_runs: [[]], workflow_approvals: [[]] };
    expect((await loadLineageRows(USER)).workflows).toMatchObject({ status: "error" });
    expect(calls.some((call) => call.method === "or")).toBe(false);
  });
});

describe("lineage module boundaries", () => {
  const directory = "src/server/lineage";
  const sources = readdirSync(directory).filter((file) => file.endsWith(".ts") && !file.includes(".test"));

  it.each(sources)("%s never uses the service role or writes", (file) => {
    const source = readFileSync(path.join(directory, file), "utf8");
    expect(source).not.toMatch(/supabase-admin|createSupabaseAdminClient|SERVICE_ROLE/);
    expect(source).not.toMatch(/\.(insert|update|upsert|rpc)\(/);
    // Only the loader touches Supabase at all, and it never deletes.
    if (file !== "load-lineage-rows.ts") expect(source).not.toMatch(/@\/server\/supabase/);
    else expect(source).not.toMatch(/\.delete\(/);
  });

  it("keeps the loader server-only", () => {
    expect(readFileSync(path.join(directory, "load-lineage-rows.ts"), "utf8")).toMatch(/^import "server-only";/);
  });
});
