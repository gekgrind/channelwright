import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
let workflowRows: Array<{ id: string; created_at: string; current_run_id: string | null }> = [];

/** A chainable stand-in for the RLS-scoped Supabase client that records every filter. */
function table(name: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "order", "limit", "in"]) {
    builder[method] = (...args: unknown[]) => { calls.push({ table: name, method, args }); return builder; };
  }
  builder.then = (resolve: (value: unknown) => unknown) => {
    const limit = calls.findLast((call) => call.table === name && call.method === "limit")?.args[0] as number | undefined;
    const data = name === "workflows" ? workflowRows.slice(0, limit ?? workflowRows.length) : [{ id: "run-1" }];
    return Promise.resolve({ data, error: null }).then(resolve);
  };
  return builder;
}

vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: async () => ({ from: table }) }));

const { approvedWorkflowPageQuerySchema, ProductionWorkflowRepository } = await import("./production-workflow-repository");

const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: uuid(count - index), created_at: `2026-09-01T10:00:${String(59 - index).padStart(2, "0")}.123456+00:00`, current_run_id: `run-${index}` }));

beforeEach(() => { calls.length = 0; workflowRows = []; });

describe("approved workflow page query", () => {
  it("accepts a known type with or without a complete cursor", () => {
    expect(approvedWorkflowPageQuerySchema.safeParse({ approvedType: "CHANNEL_VIDEO_SCRIPT" }).success).toBe(true);
    expect(approvedWorkflowPageQuerySchema.safeParse({ approvedType: "CHANNEL_VIDEO_SCRIPT", beforeCreatedAt: "2026-09-01T10:00:00.123456+00:00", beforeId: uuid(1) }).success).toBe(true);
  });

  it("rejects unknown types, half cursors, unknown parameters, and cursor values that could alter the filter", () => {
    for (const query of [
      { approvedType: "NOT_A_WORKFLOW" },
      { approvedType: "CHANNEL_VIDEO_SCRIPT", beforeId: uuid(1) },
      { approvedType: "CHANNEL_VIDEO_SCRIPT", beforeCreatedAt: "2026-09-01T10:00:00Z" },
      { approvedType: "CHANNEL_VIDEO_SCRIPT", status: "FAILED" },
      { approvedType: "CHANNEL_VIDEO_SCRIPT", beforeCreatedAt: "2026-09-01T10:00:00Z\",status.neq.COMPLETED", beforeId: uuid(1) },
      { approvedType: "CHANNEL_VIDEO_SCRIPT", beforeCreatedAt: "2026-09-01T10:00:00Z", beforeId: "1),status.neq.(COMPLETED" },
    ]) expect(approvedWorkflowPageQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
  });
});

describe("ProductionWorkflowRepository.listApproved", () => {
  it("pages only completed workflows of one type, newest first, and reports the next keyset cursor", async () => {
    workflowRows = rows(4);
    const page = await new ProductionWorkflowRepository().listApproved("CHANNEL_VIDEO_SCRIPT", undefined, 3);

    const workflowCalls = calls.filter((call) => call.table === "workflows");
    expect(workflowCalls).toContainEqual({ table: "workflows", method: "eq", args: ["workflow_type", "CHANNEL_VIDEO_SCRIPT"] });
    expect(workflowCalls).toContainEqual({ table: "workflows", method: "eq", args: ["status", "COMPLETED"] });
    expect(workflowCalls).toContainEqual({ table: "workflows", method: "order", args: ["created_at", { ascending: false }] });
    expect(workflowCalls).toContainEqual({ table: "workflows", method: "order", args: ["id", { ascending: false }] });
    expect(workflowCalls).toContainEqual({ table: "workflows", method: "limit", args: [4] });
    expect(workflowCalls.some((call) => call.method === "or")).toBe(false);

    expect(page.workflows.map((item) => item.id)).toEqual([uuid(4), uuid(3), uuid(2)]);
    expect(page.nextCursor).toEqual({ createdAt: workflowRows[2].created_at, id: uuid(2) });
    expect(calls).toContainEqual({ table: "workflow_runs", method: "in", args: ["id", ["run-0", "run-1", "run-2"]] });
  });

  it("continues strictly after the cursor, breaking created_at ties by id, and ends with no cursor", async () => {
    workflowRows = rows(2);
    const cursor = { createdAt: "2026-09-01T10:00:00.123456+00:00", id: uuid(7) };
    const page = await new ProductionWorkflowRepository().listApproved("CHANNEL_VIDEO_SCRIPT", cursor, 3);

    expect(calls).toContainEqual({ table: "workflows", method: "or", args: [`created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`] });
    expect(page.workflows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });
});
