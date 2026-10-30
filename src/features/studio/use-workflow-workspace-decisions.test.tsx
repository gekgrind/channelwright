// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useWorkflowWorkspace } from "./use-workflow-workspace";
import type { DecisionOutcome, WorkflowDetailBase } from "./workflow-api";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const WORKFLOW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const APPROVAL_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

const list = (status: string) => ({ workflowEngine: { workflows: [{ id: WORKFLOW_ID, workflow_type: "CHANNEL_VIDEO_SCRIPT", status, created_at: "2026-09-01T10:00:00.000Z", current_run_id: RUN_ID }], runs: [], pendingApprovals: [] } });
const pendingDetail: WorkflowDetailBase = {
  workflow: { id: WORKFLOW_ID, status: "WAITING_FOR_APPROVAL", created_at: "2026-09-01T10:00:00.000Z", current_run_id: RUN_ID },
  runs: [{ id: RUN_ID, status: "WAITING_FOR_APPROVAL", output_payload: null, error_code: null }],
  approvals: [{ id: APPROVAL_ID, workflow_run_id: RUN_ID, status: "PENDING" }],
};
const approvedDetail: WorkflowDetailBase = {
  ...pendingDetail,
  workflow: { ...pendingDetail.workflow, status: "COMPLETED" },
  runs: [{ ...pendingDetail.runs[0], status: "COMPLETED" }],
  approvals: [{ id: APPROVAL_ID, workflow_run_id: RUN_ID, status: "APPROVED" }],
};
const response = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const acknowledged = (decision: string) => response(200, { operationResult: { workflowId: WORKFLOW_ID, runId: RUN_ID, approvalId: APPROVAL_ID, decision, runStatus: "COMPLETED" } });
const posts = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

/** Serves a pending gate. `onPost` answers the decision; `detailNow` answers each detail read. */
function serve(onPost: () => Promise<Response> | Response, detailNow: () => Response = () => response(200, pendingDetail)) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return onPost();
    if (url === "/api/workflows") return response(200, list("WAITING_FOR_APPROVAL"));
    return detailNow();
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

async function mountPending() {
  const hook = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
  await waitFor(() => expect(hook.result.current.decisionTarget?.approvalId).toBe(APPROVAL_ID));
  return hook;
}

describe("useWorkflowWorkspace decision outcomes", () => {
  it("sends one mutation when the same target is decided twice concurrently", async () => {
    let finish: (value: Response) => void = () => undefined;
    let approved = false;
    const fetcher = serve(() => new Promise<Response>((resolve) => { finish = resolve; }), () => response(200, approved ? approvedDetail : pendingDetail));
    const { result } = await mountPending();
    const target = result.current.decisionTarget!;
    let first: Promise<DecisionOutcome> = Promise.resolve({ ok: true });
    let second: DecisionOutcome = { ok: true };
    act(() => { first = result.current.decide(target, "APPROVE", undefined, "Approved."); });
    await act(async () => { second = await result.current.decide(target, "APPROVE", undefined, "Approved."); });
    expect(second).toMatchObject({ ok: false, reason: "in-flight" });
    approved = true;
    await act(async () => { finish(acknowledged("APPROVE")); await first; });
    expect(posts(fetcher)).toHaveLength(1);
    expect(result.current.notice).toBe("Approved.");
    expect(result.current.decisionTarget).toBeNull();
  });

  it("keeps the request URL and body contract unchanged", async () => {
    const fetcher = serve(() => acknowledged("REQUEST_REVISION"));
    const { result } = await mountPending();
    await act(async () => { await result.current.decide(result.current.decisionTarget!, "REQUEST_REVISION", "  Tighten the cold open.  ", "Revision requested."); });
    const [url, init] = posts(fetcher)[0] as [string, RequestInit];
    expect(url).toBe(`/api/workflows/${WORKFLOW_ID}/approvals/${APPROVAL_ID}`);
    expect(JSON.parse(String(init.body))).toEqual({ decision: "REQUEST_REVISION", note: "Tighten the cold open." });
  });

  it("reports a stale (409) approval truthfully and leaves the view unchanged until an explicit reload", async () => {
    const fetcher = serve(() => response(409, { error: { code: "INVALID_TRANSITION", message: "The requested workflow transition is not legal from its current state." } }));
    const { result } = await mountPending();
    let outcome: DecisionOutcome = { ok: true };
    await act(async () => { outcome = await result.current.decide(result.current.decisionTarget!, "APPROVE", undefined, "Approved."); });
    expect(outcome).toMatchObject({ ok: false, reason: "stale" });
    expect(outcome).toMatchObject({ message: expect.stringMatching(/nothing was recorded by this request/i) });
    expect(result.current.notice).toBeNull();
    // Nothing was silently changed: the pending view stays, but it cannot be decided on again.
    expect(result.current.detail?.approvals[0].status).toBe("PENDING");
    expect(result.current.decisionLocked).toBe(true);
    let again: DecisionOutcome = { ok: true };
    await act(async () => { again = await result.current.decide(result.current.decisionTarget!, "APPROVE", undefined, "Approved."); });
    expect(again.ok).toBe(false);
    expect(posts(fetcher)).toHaveLength(1);

    fetcher.mockImplementation(async (url: string) => url === "/api/workflows" ? response(200, list("COMPLETED")) : response(200, approvedDetail));
    await act(async () => { result.current.reload(); });
    await waitFor(() => expect(result.current.detail?.workflow.status).toBe("COMPLETED"));
    expect(result.current.decisionTarget).toBeNull();
    expect(result.current.decisionLocked).toBe(false);
  });

  it.each<[string, () => Response]>([
    ["a network failure", () => { throw new TypeError("Failed to fetch"); }],
    ["a 5xx", () => response(500, { error: { code: "DATABASE_ERROR", message: "The workflow operation could not be completed." } })],
    ["an unreadable body", () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }) as unknown as Response],
    ["a success body for another approval", () => response(200, { operationResult: { approvalId: "someone-else", decision: "APPROVE" } })],
    ["an empty acknowledgement", () => response(200, { operationResult: {} })],
    ["an array acknowledgement", () => response(200, { operationResult: [] })],
    ["null acknowledgement fields", () => response(200, { operationResult: { approvalId: null, decision: null } })],
    ["an acknowledgement of a different decision", () => response(200, { operationResult: { approvalId: APPROVAL_ID, decision: "APPROVE" } })],
    ["a 501 that is not the pre-mutation PRODUCTION_REQUIRED refusal", () => response(501, { error: { code: "INTERNAL_ERROR", message: "Not implemented." } })],
  ])("never reports success after %s, and locks the target until reconciled", async (_name, onPost) => {
    const fetcher = serve(onPost);
    const { result } = await mountPending();
    let outcome: DecisionOutcome = { ok: true };
    await act(async () => { outcome = await result.current.decide(result.current.decisionTarget!, "REQUEST_REVISION", "Tighten the cold open.", "Revision requested."); });
    expect(outcome).toMatchObject({ ok: false, reason: "unconfirmed" });
    expect(outcome).toMatchObject({ message: expect.stringMatching(/couldn't confirm whether this decision was recorded/i) });
    expect(result.current.notice).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.decisionLocked).toBe(true);
    expect(posts(fetcher)).toHaveLength(1);
    // A reload that still shows the gate pending clears the lock: the server says it is decidable.
    await act(async () => { result.current.reload(); });
    await waitFor(() => expect(result.current.decisionLocked).toBe(false));
  });

  it("reports the route's pre-mutation 501 PRODUCTION_REQUIRED refusal as unavailable, without locking", async () => {
    serve(() => response(501, { error: { code: "PRODUCTION_REQUIRED", message: "Durable production workflows require Supabase mode." } }));
    const { result } = await mountPending();
    let outcome: DecisionOutcome = { ok: true };
    await act(async () => { outcome = await result.current.decide(result.current.decisionTarget!, "APPROVE", undefined, "Approved."); });
    expect(outcome).toMatchObject({ ok: false, reason: "unavailable", message: expect.stringMatching(/^Nothing was recorded/) });
    expect(result.current.decisionLocked).toBe(false);
  });

  it("does not lock after a 401: nothing was recorded, and signing in again is the fix", async () => {
    serve(() => response(401, { error: { code: "UNAUTHORIZED", message: "Authentication is required." } }));
    const { result } = await mountPending();
    let outcome: DecisionOutcome = { ok: true };
    await act(async () => { outcome = await result.current.decide(result.current.decisionTarget!, "REJECT", undefined, "Rejected."); });
    expect(outcome).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(result.current.decisionLocked).toBe(false);
    expect(result.current.notice).toBeNull();
  });

  it("keeps a recorded decision locked when the follow-up refresh fails, so the stale pending view cannot be decided again", async () => {
    let detailHealthy = true;
    const fetcher = serve(
      () => { detailHealthy = false; return acknowledged("APPROVE"); },
      () => detailHealthy ? response(200, pendingDetail) : response(500, { error: { code: "DATABASE_ERROR", message: "The workflow store is unavailable." } }),
    );
    const { result } = await mountPending();
    await act(async () => { await result.current.decide(result.current.decisionTarget!, "APPROVE", undefined, "Approved."); });
    expect(result.current.notice).toBe("Approved.");
    expect(result.current.noticeFocusKey).toBe(1);
    expect(result.current.decisionTarget?.approvalId).toBe(APPROVAL_ID);
    expect(result.current.decisionLocked).toBe(true);
    let again: DecisionOutcome = { ok: true };
    await act(async () => { again = await result.current.decide(result.current.decisionTarget!, "APPROVE", undefined, "Approved."); });
    expect(again.ok).toBe(false);
    expect(posts(fetcher)).toHaveLength(1);
  });
});
