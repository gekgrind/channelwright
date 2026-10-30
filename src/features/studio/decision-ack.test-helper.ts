/**
 * The body the approvals route returns for a recorded decision: the
 * `decide_workflow_approval` result, which echoes the approval id and decision.
 * The client treats any other 2xx body as unconfirmed, so test mocks of a
 * successful decision must answer with this shape.
 */
export function decisionAck(url: string, init?: RequestInit) {
  const path = String(url);
  const workflowId = path.split("/api/workflows/")[1]?.split("/")[0] ?? "";
  const approvalId = path.split("/approvals/")[1] ?? "";
  const { decision } = JSON.parse(String(init?.body ?? "{}")) as { decision?: string };
  return { operationResult: { workflowId, runId: "run-acknowledged", approvalId, decision, runStatus: "COMPLETED" } };
}

export const isDecisionRequest = (url: string) => String(url).includes("/approvals/");
