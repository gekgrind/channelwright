import "server-only";

import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { isLiveCommandCenterOn, isLiveCommandCenterUser } from "@/server/config";
import { loadLineageRows } from "./load-lineage-rows";
import { resolveLineage, type LineageGraph } from "./resolve-lineage";
import type { LineageRows } from "./lineage-rows";

/**
 * Access and loading for the live Command Center (`/c`). Gate order (R004):
 * 1. the exact flag, off in fixture mode, before authentication;
 * 2. sign-in, Supabase mode, then allowlist membership, before any row is read.
 * Every refusal is a 404, so the route's existence is not disclosed.
 */
export async function requireLiveUser() {
  if (!isLiveCommandCenterOn()) notFound();
  const user = await requireUser();
  if (user.mode !== "supabase" || !isLiveCommandCenterUser(user.id)) notFound();
  return user;
}

export type LiveLoad =
  | { status: "ok"; rows: LineageRows; graph: LineageGraph; approvalsError: { requestId: string } | null }
  | { status: "error"; requestId: string }
  | { status: "too_large" };

/** Workflows and runs are required to group anything; approvals failing only empties the gates. */
export async function loadLive(userId: string): Promise<LiveLoad> {
  const load = await loadLineageRows(userId);
  for (const table of [load.workflows, load.runs]) {
    if (table.status === "error") return { status: "error", requestId: table.requestId };
    if (table.status === "too_large") return { status: "too_large" };
  }
  if (load.workflows.status !== "ok" || load.runs.status !== "ok") return { status: "too_large" };
  const approvals = load.approvals.status === "ok" ? load.approvals.rows : [];
  const approvalsError = load.approvals.status === "error" ? { requestId: load.approvals.requestId }
    : load.approvals.status === "too_large" ? { requestId: "approvals-too-large" } : null;
  const rows: LineageRows = { workflows: load.workflows.rows, runs: load.runs.rows, approvals };
  return { status: "ok", rows, graph: resolveLineage(rows), approvalsError };
}
