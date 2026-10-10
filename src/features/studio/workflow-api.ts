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

async function requestJson<T>(input: string, fallback: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(payload, fallback));
  return payload as T;
}

export function fetchWorkflowList(fallback: string) {
  return requestJson<{ workflowEngine: WorkflowList }>("/api/workflows", fallback, { cache: "no-store" });
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

export function submitApprovalDecision(workflowId: string, approvalId: string, decision: ApprovalDecision, note: string | undefined, fallback: string) {
  return requestJson<unknown>(`/api/workflows/${workflowId}/approvals/${approvalId}`, fallback, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, note }),
  });
}
