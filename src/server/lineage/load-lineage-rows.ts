import "server-only";

import { randomUUID } from "node:crypto";
import { logFailure } from "@/server/observability";
import { createSupabaseServerClient } from "@/server/supabase";
import { INPUT_JSON_KEYS, INPUT_TEXT_KEYS, type LineageApprovalRow, type LineageRunRow, type LineageWorkflowRow } from "./lineage-rows";

/**
 * Reads the signed-in user's workflow rows for the lineage read-model. Read-only:
 * it uses the RLS-bound session client (never the service role), filters every
 * query by owner as well, and pages each table to completion. A table above its
 * ceiling is reported as too large instead of grouping a truncated set, because
 * a missing upstream row would turn resolvable work into "upstream not found".
 */

export const LINEAGE_PAGE_SIZE = 200;
export const LINEAGE_CEILING = { workflows: 2_000, runs: 5_000, approvals: 5_000 } as const;

export type TableLoad<T> =
  | { status: "ok"; rows: T[] }
  | { status: "too_large" }
  | { status: "error"; requestId: string };

export interface LineageLoad {
  workflows: TableLoad<LineageWorkflowRow>;
  runs: TableLoad<LineageRunRow>;
  approvals: TableLoad<LineageApprovalRow>;
}

type Row = Record<string, unknown>;
type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface TableSpec<T> {
  table: "workflows" | "workflow_runs" | "workflow_approvals";
  columns: string;
  /** Keyset column paired with id; approvals have no created_at. */
  cursorColumn: "created_at" | "requested_at";
  ceiling: number;
  map: (row: Row) => T;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const nullableText = (value: unknown) => (typeof value === "string" ? value : null);

// Cursor values come from our own rows; they are still checked before they reach a filter string.
const SAFE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:\d{2})?)$/;
const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WORKFLOWS: TableSpec<LineageWorkflowRow> = {
  table: "workflows",
  columns: "id,workflow_type,status,created_at",
  cursorColumn: "created_at",
  ceiling: LINEAGE_CEILING.workflows,
  map: (row) => ({ id: text(row.id), workflowType: text(row.workflow_type), status: text(row.status), createdAt: text(row.created_at) }),
};

const RUNS: TableSpec<LineageRunRow> = {
  table: "workflow_runs",
  columns: [
    "id", "workflow_id", "status", "created_at", "previousRunId:context_payload->>previousRunId",
    ...INPUT_TEXT_KEYS.map((key) => `${key}:input_payload->>${key}`),
    ...INPUT_JSON_KEYS.map((key) => `${key}:input_payload->${key}`),
  ].join(","),
  cursorColumn: "created_at",
  ceiling: LINEAGE_CEILING.runs,
  map: (row) => ({
    id: text(row.id),
    workflowId: text(row.workflow_id),
    status: text(row.status),
    createdAt: text(row.created_at),
    previousRunId: nullableText(row.previousRunId),
    input: Object.fromEntries([...INPUT_TEXT_KEYS, ...INPUT_JSON_KEYS].filter((key) => row[key] !== null && row[key] !== undefined).map((key) => [key, row[key]])),
  }),
};

const APPROVALS: TableSpec<LineageApprovalRow> = {
  table: "workflow_approvals",
  columns: "id,workflow_id,workflow_run_id,status,requested_at,decided_at",
  cursorColumn: "requested_at",
  ceiling: LINEAGE_CEILING.approvals,
  map: (row) => ({ id: text(row.id), workflowId: text(row.workflow_id), runId: text(row.workflow_run_id), status: text(row.status), requestedAt: text(row.requested_at), decidedAt: nullableText(row.decided_at) }),
};

async function loadTable<T>(client: Client, userId: string, spec: TableSpec<T>): Promise<TableLoad<T>> {
  const rows: Row[] = [];
  let cursor: { at: string; id: string } | null = null;
  try {
    for (;;) {
      let query = client.from(spec.table).select(spec.columns).eq("owner_id", userId);
      if (cursor) query = query.or(`${spec.cursorColumn}.gt."${cursor.at}",and(${spec.cursorColumn}.eq."${cursor.at}",id.gt.${cursor.id})`);
      const page = await query.order(spec.cursorColumn, { ascending: true }).order("id", { ascending: true }).limit(LINEAGE_PAGE_SIZE);
      if (page.error) throw page.error;
      const data = (page.data ?? []) as unknown as Row[];
      rows.push(...data);
      if (rows.length > spec.ceiling) return { status: "too_large" };
      if (data.length < LINEAGE_PAGE_SIZE) return { status: "ok", rows: rows.map(spec.map) };
      const last = data[data.length - 1];
      const at = text(last[spec.cursorColumn]);
      const id = text(last.id);
      if (!SAFE_TIMESTAMP.test(at) || !SAFE_ID.test(id)) throw new Error(`Unexpected ${spec.table} cursor value.`);
      cursor = { at, id };
    }
  } catch (error) {
    const requestId = randomUUID();
    logFailure("lineage_rows_unavailable", error, { table: spec.table, requestId });
    return { status: "error", requestId };
  }
}

export async function loadLineageRows(userId: string): Promise<LineageLoad> {
  const client = await createSupabaseServerClient();
  const [workflows, runs, approvals] = await Promise.all([
    loadTable(client, userId, WORKFLOWS),
    loadTable(client, userId, RUNS),
    loadTable(client, userId, APPROVALS),
  ]);
  return { workflows, runs, approvals };
}
