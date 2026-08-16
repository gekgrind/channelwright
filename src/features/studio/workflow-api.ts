export type WorkflowList = {
  workflows: Array<{ id: string; workflow_type: string; status: string; created_at: string; current_run_id: string }>;
  runs: Array<{ id: string; workflow_id: string; status: string; output_payload: unknown; error_code: string | null; created_at: string; completed_at: string | null }>;
  pendingApprovals: Array<{ id: string; workflow_id: string; workflow_run_id: string; gate_key: string; status: string; requested_at: string }>;
};

export type ApprovalDecision = "APPROVE" | "REJECT" | "REQUEST_REVISION";

export const POLLING_WORKFLOW_STATUSES = ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"];

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
