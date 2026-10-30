export type WorkflowList = {
  workflows: Array<{ id: string; workflow_type: string; status: string; created_at: string; current_run_id: string; completed_at?: string | null }>;
  runs: Array<{ id: string; workflow_id: string; status: string; output_payload: unknown; error_code: string | null; created_at: string; completed_at: string | null }>;
  pendingApprovals: Array<{ id: string; workflow_id: string; workflow_run_id: string; gate_key: string; status: string; requested_at: string }>;
};

export type ApprovalDecision = "APPROVE" | "REJECT" | "REQUEST_REVISION";

/**
 * Statuses in which a trusted worker is still advancing the workflow. Every
 * definition ends in a human approval gate, so WAITING_FOR_APPROVAL only changes
 * when the operator decides; COMPLETED, FAILED, and CANCELED are terminal.
 */
export const POLLING_WORKFLOW_STATUSES = ["QUEUED", "RUNNING"];
export const WORKFLOW_POLL_INTERVAL_MS = 4_000;

/** The detail fields every production workspace relies on. */
export type WorkflowDetailBase = {
  workflow: { id: string; status: string; created_at: string; current_run_id?: string | null };
  runs: Array<{ id: string; status: string; output_payload: unknown; error_code: string | null; created_at?: string; completed_at?: string | null }>;
  approvals: Array<{ id: string; workflow_run_id?: string; status: string; decision_note?: string | null; decided_at?: string | null }>;
};

/** The run the workflow currently points at; detail runs are ordered newest first. */
export function currentRunOf<T extends WorkflowDetailBase>(detail: T | null | undefined): T["runs"][number] | undefined {
  if (!detail) return undefined;
  return detail.runs.find((run) => run.id === detail.workflow.current_run_id) ?? detail.runs[0];
}

/** 1-based position of a run within its workflow: revisions create successor runs. */
export function runVersionOf(detail: WorkflowDetailBase, runId: string | undefined) {
  const ordered = [...detail.runs].sort((left, right) => (left.created_at ?? "").localeCompare(right.created_at ?? ""));
  const index = ordered.findIndex((run) => run.id === runId);
  return index < 0 ? undefined : index + 1;
}

/** The pending human gate on the current run, if any. */
export function pendingApprovalOf(detail: WorkflowDetailBase | null | undefined) {
  const run = currentRunOf(detail);
  return detail?.approvals.find((item) => item.status === "PENDING" && (!item.workflow_run_id || item.workflow_run_id === run?.id));
}

/** The exact workflow, run, and approval gate a human decision is bound to. */
export type DecisionTarget = { workflowId: string; runId: string; approvalId: string; key: string };

export function decisionTargetOf(detail: WorkflowDetailBase | null | undefined): DecisionTarget | null {
  const run = currentRunOf(detail);
  const approval = pendingApprovalOf(detail);
  if (!detail || !run || !approval) return null;
  return { workflowId: detail.workflow.id, runId: run.id, approvalId: approval.id, key: `${detail.workflow.id}:${run.id}:${approval.id}` };
}

const WORKFLOWS_CHANGED_EVENT = "channelwright:workflows-changed";

/** Tells sibling workspaces that a start or decision changed durable workflow state. */
export function announceWorkflowsChanged(source: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<string>(WORKFLOWS_CHANGED_EVENT, { detail: source }));
}

export function onWorkflowsChanged(listener: (source: string | undefined) => void) {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(WORKFLOWS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(WORKFLOWS_CHANGED_EVENT, handler);
}

export function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

/**
 * A failed workflow request. `transport` separates what the client knows:
 * "network" (no response), "unreadable" (a response whose body could not be
 * read), or "http" (a readable non-2xx response with its status and code).
 */
export class WorkflowRequestError extends Error {
  constructor(message: string, readonly transport: "network" | "unreadable" | "http", readonly status: number | null, readonly code: string | null) {
    super(message);
    this.name = "WorkflowRequestError";
  }
}

function apiErrorCode(payload: unknown) {
  const error = payload && typeof payload === "object" ? (payload as { error?: unknown }).error : undefined;
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}

async function requestJson<T>(input: string, fallback: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new WorkflowRequestError(fallback, "network", null, null);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WorkflowRequestError(fallback, "unreadable", response.status ?? null, null);
  }
  if (!response.ok) throw new WorkflowRequestError(apiErrorMessage(payload, fallback), "http", response.status ?? null, apiErrorCode(payload));
  return payload as T;
}

export function fetchWorkflowList(fallback: string) {
  return requestJson<{ workflowEngine: WorkflowList }>("/api/workflows", fallback, { cache: "no-store" });
}

/** One page of approved workflows of one type, newest first; nextCursor is null on the last page. */
export type ApprovedWorkflowPage = {
  workflows: WorkflowList["workflows"];
  runs: WorkflowList["runs"];
  nextCursor: { createdAt: string; id: string } | null;
};

export async function fetchApprovedWorkflowPage(workflowType: string, before: ApprovedWorkflowPage["nextCursor"], fallback: string) {
  const params = new URLSearchParams({ approvedType: workflowType });
  if (before) { params.set("beforeCreatedAt", before.createdAt); params.set("beforeId", before.id); }
  const page = await requestJson<ApprovedWorkflowPage>(`/api/workflows?${params}`, fallback, { cache: "no-store" });
  if (!page || !Array.isArray(page.workflows) || !Array.isArray(page.runs)) throw new Error(fallback);
  return page;
}

export function fetchWorkflowDetail<T>(workflowId: string, fallback: string) {
  return requestJson<T>(`/api/workflows/${workflowId}`, fallback, { cache: "no-store" });
}

export function startWorkflow(workflowType: string, input: unknown, fallback: string) {
  return requestJson<{ operationResult: { workflowId: string } }>("/api/workflows", fallback, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ operation: "START_WORKFLOW", workflowType, definitionVersion: 1, input }),
  });
}

/**
 * Sends one decision. Success requires a 2xx body that explicitly echoes this
 * approval id and decision (as `decide_workflow_approval` returns them); any
 * other body, including one with missing or null fields, is unconfirmed.
 */
export async function submitApprovalDecision(workflowId: string, approvalId: string, decision: ApprovalDecision, note: string | undefined, fallback: string) {
  const payload = await requestJson<unknown>(`/api/workflows/${workflowId}/approvals/${approvalId}`, fallback, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, note }),
  });
  const result = payload && typeof payload === "object" ? (payload as { operationResult?: unknown }).operationResult : undefined;
  const acknowledged = Boolean(result) && typeof result === "object" && !Array.isArray(result)
    && (result as { approvalId?: unknown }).approvalId === approvalId
    && (result as { decision?: unknown }).decision === decision;
  if (!acknowledged) throw new WorkflowRequestError(fallback, "unreadable", 200, null);
  return result;
}

/** Why a decision was not confirmed as recorded. */
export type DecisionFailureReason =
  | "target-changed" // the selected gate changed before sending; nothing was sent
  | "in-flight" // a decision on this exact gate is already being sent
  | "stale" // the server refused: the gate is no longer decidable here
  | "unconfirmed" // the client cannot know whether the decision was recorded
  | "unauthorized"
  | "unavailable"
  | "validation"
  | "rejected";

export type DecisionOutcome = { ok: true } | { ok: false; reason: DecisionFailureReason; message: string };

/**
 * Classifies a failed decision request into copy that is true in every case
 * the status can stand for. A raised RPC exception rolls the decision back, so
 * a readable 4xx means this request recorded nothing. A 5xx, a lost response,
 * or an unreadable body does not prove that, so it is reported as unconfirmed.
 */
export function decisionFailureOf(cause: unknown): { reason: DecisionFailureReason; message: string } {
  const unconfirmed = { reason: "unconfirmed" as const, message: "Channelwright couldn't confirm whether this decision was recorded. It may or may not have been saved. Reload to see the current state before deciding again." };
  if (!(cause instanceof WorkflowRequestError) || cause.transport !== "http" || cause.status === null) return unconfirmed;
  // The route answers 501 PRODUCTION_REQUIRED before any mutation; every other 5xx is ambiguous.
  if (cause.status === 501 && cause.code === "PRODUCTION_REQUIRED") return { reason: "unavailable", message: "Nothing was recorded: durable workflows are not available in this mode." };
  if (cause.status >= 500) return unconfirmed;
  if (cause.status === 401 || cause.status === 403 || cause.code === "UNAUTHORIZED") return { reason: "unauthorized", message: "Nothing was recorded: you need to sign in again before deciding." };
  if (cause.status === 409 || cause.status === 404) return { reason: "stale", message: "Nothing was recorded by this request. This approval can no longer be decided from this screen: it was most likely already decided, for example in another tab, or replaced by a newer version. Reload to see its current state." };
  if (cause.status === 422) return { reason: "validation", message: `Nothing was recorded: ${cause.message}` };
  return { reason: "rejected", message: `Nothing was recorded: ${cause.message}` };
}
