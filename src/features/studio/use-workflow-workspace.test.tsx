// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useWorkflowWorkspace } from "./use-workflow-workspace";
import { announceWorkflowsChanged, WORKFLOW_POLL_INTERVAL_MS, type DecisionOutcome, type WorkflowDetailBase } from "./workflow-api";

const WORKFLOW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

const list = (status: string) => ({ workflowEngine: { workflows: [{ id: WORKFLOW_ID, workflow_type: "CHANNEL_VIDEO_SCRIPT", status, created_at: "2026-09-01T10:00:00.000Z", current_run_id: RUN_ID }], runs: [], pendingApprovals: [] } });
const detail = (status: string): WorkflowDetailBase => ({
  workflow: { id: WORKFLOW_ID, status, created_at: "2026-09-01T10:00:00.000Z", current_run_id: RUN_ID },
  runs: [{ id: RUN_ID, status, output_payload: null, error_code: null }],
  approvals: [],
});
const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

/** Serves list/detail in the given workflow status sequence (last status repeats). */
function statusSequence(statuses: string[]) {
  let index = 0;
  const current = () => statuses[Math.min(index, statuses.length - 1)];
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/api/workflows") return json(list(current()));
    const body = detail(current());
    index += 1;
    return json(body);
  });
  return fetcher;
}

const detailCalls = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.filter(([url]) => String(url).includes(WORKFLOW_ID)).length;

// Auto-advancing fake intervals keep RTL waitFor working while polling ticks stay under test control.
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "clearInterval"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useWorkflowWorkspace", () => {
  it("polls while a worker is advancing the run and stops once it waits for a human", async () => {
    const fetcher = statusSequence(["RUNNING", "WAITING_FOR_APPROVAL"]);
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.detail?.workflow.status).toBe("RUNNING"));
    expect(result.current.polling).toBe(true);

    await act(async () => { vi.advanceTimersByTime(WORKFLOW_POLL_INTERVAL_MS); });
    await waitFor(() => expect(result.current.detail?.workflow.status).toBe("WAITING_FOR_APPROVAL"));
    expect(result.current.polling).toBe(false);

    const settled = detailCalls(fetcher);
    await act(async () => { vi.advanceTimersByTime(WORKFLOW_POLL_INTERVAL_MS * 5); });
    expect(detailCalls(fetcher)).toBe(settled);
  });

  it("never polls terminal workflows", async () => {
    const fetcher = statusSequence(["COMPLETED"]);
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.detail?.workflow.status).toBe("COMPLETED"));
    const settled = fetcher.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(WORKFLOW_POLL_INTERVAL_MS * 5); });
    expect(fetcher.mock.calls.length).toBe(settled);
  });

  it("stops polling when the workspace unmounts", async () => {
    const fetcher = statusSequence(["RUNNING"]);
    vi.stubGlobal("fetch", fetcher);
    const { result, unmount } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.polling).toBe(true));
    unmount();
    const settled = fetcher.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(WORKFLOW_POLL_INTERVAL_MS * 5); });
    expect(fetcher.mock.calls.length).toBe(settled);
  });

  it("keeps a failed refresh visible until a later refresh succeeds", async () => {
    let healthy = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!healthy) return json({ error: { code: "DATABASE_ERROR", message: "The workflow store is unavailable." } }, false);
      return url === "/api/workflows" ? json(list("COMPLETED")) : json(detail("COMPLETED"));
    }));
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.refreshError).toBe("The workflow store is unavailable."));
    expect(result.current.loading).toBe(false);

    healthy = true;
    await act(async () => { await result.current.refresh(); });
    expect(result.current.refreshError).toBeNull();
    expect(result.current.detail?.workflow.status).toBe("COMPLETED");
  });

  it("only fetches detail on mount when the parent already supplied the list", async () => {
    const fetcher = statusSequence(["COMPLETED"]);
    vi.stubGlobal("fetch", fetcher);
    const initial = list("COMPLETED").workflowEngine;
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ initial, workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`/api/workflows/${WORKFLOW_ID}`]);
  });

  it("never lets a slower, older list response overwrite a newer one", async () => {
    let releaseStale: (response: Response) => void = () => undefined;
    const fetcher = vi.fn()
      // 1st: sibling-triggered list refresh, answered late with the older, empty list
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseStale = resolve; }))
      // 2nd/3rd: explicit refresh, answered immediately with the newer list and its detail
      .mockImplementationOnce(async () => json(list("COMPLETED")))
      .mockImplementationOnce(async () => json(detail("COMPLETED")));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ initial: { workflows: [], runs: [], pendingApprovals: [] }, workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { announceWorkflowsChanged("another-workspace"); });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.engine?.workflows).toHaveLength(1);

    await act(async () => { releaseStale(json({ workflowEngine: { workflows: [], runs: [], pendingApprovals: [] } })); });
    expect(result.current.engine?.workflows).toHaveLength(1);
  });

  it("re-reads the list when a sibling workspace records a decision", async () => {
    const fetcher = statusSequence(["COMPLETED"]);
    vi.stubGlobal("fetch", fetcher);
    const sibling = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    const observer = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ initial: { workflows: [], runs: [], pendingApprovals: [] }, workflowType: "CHANNEL_VIDEO_PACKAGING", label: "video packaging" }));
    await waitFor(() => expect(sibling.result.current.detail).not.toBeNull());
    expect(observer.result.current.engine?.workflows).toHaveLength(0);

    fetcher.mockImplementation(async (url: string) => {
      if (String(url).includes("/approvals/")) return json({ operationResult: {} });
      return url === "/api/workflows" ? json(list("COMPLETED")) : json({ ...detail("WAITING_FOR_APPROVAL"), approvals: [{ id: "ap1", workflow_run_id: RUN_ID, status: "PENDING" }] });
    });
    await act(async () => { await sibling.result.current.refresh(); });
    const target = sibling.result.current.decisionTarget!;
    await act(async () => { await sibling.result.current.decide(target, "APPROVE", undefined, "Approved."); });
    await waitFor(() => expect(observer.result.current.engine?.workflows).toHaveLength(1));
  });

  it("only lets the newest refresh set or clear the visible error (older success cannot erase a newer failure)", async () => {
    let releaseOlder: (response: Response) => void = () => undefined;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseOlder = resolve; }))
      .mockImplementationOnce(async () => json({ error: { code: "DATABASE_ERROR", message: "Newer refresh failed." } }, false));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ initial: { workflows: [], runs: [], pendingApprovals: [] }, workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let older: Promise<void> = Promise.resolve();
    act(() => { older = result.current.refresh(); });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.refreshError).toBe("Newer refresh failed.");

    fetcher.mockImplementation(async () => json(detail("COMPLETED")));
    await act(async () => { releaseOlder(json({ workflowEngine: { workflows: [], runs: [], pendingApprovals: [] } })); await older; });
    expect(result.current.refreshError).toBe("Newer refresh failed.");
  });

  it("only lets the newest refresh set or clear the visible error (older failure cannot overwrite a newer recovery)", async () => {
    let failOlder: (response: Response) => void = () => undefined;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { failOlder = resolve; }))
      .mockImplementationOnce(async () => json({ workflowEngine: { workflows: [], runs: [], pendingApprovals: [] } }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ initial: { workflows: [], runs: [], pendingApprovals: [] }, workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let older: Promise<void> = Promise.resolve();
    act(() => { older = result.current.refresh(); });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.refreshError).toBeNull();

    await act(async () => { failOlder(json({ error: { code: "DATABASE_ERROR", message: "Older refresh failed." } }, false)); await older; });
    expect(result.current.refreshError).toBeNull();
  });
});

describe("useWorkflowWorkspace decision identity", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-00000000000a";
  const B = "aaaaaaaa-aaaa-4aaa-8aaa-00000000000b";
  const runOf = (id: string) => `run-${id.slice(-1)}`;
  const pending = (id: string) => ({
    workflow: { id, status: "WAITING_FOR_APPROVAL", created_at: "2026-09-01T10:00:00.000Z", current_run_id: runOf(id) },
    runs: [{ id: runOf(id), status: "WAITING_FOR_APPROVAL", output_payload: null, error_code: null }],
    approvals: [{ id: `approval-${id.slice(-1)}`, workflow_run_id: runOf(id), status: "PENDING" }],
  });
  const twoPending = { workflows: [A, B].map((id) => ({ id, workflow_type: "CHANNEL_VIDEO_SCRIPT", status: "WAITING_FOR_APPROVAL", created_at: "2026-09-01T10:00:00.000Z", current_run_id: runOf(id) })), runs: [], pendingApprovals: [] };

  function serve(onDecision?: () => Promise<Response>) {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return onDecision ? onDecision() : json({ operationResult: {} });
      if (url === "/api/workflows") return json({ workflowEngine: twoPending });
      return json(pending(url.includes(B) ? B : A));
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }
  const decisionPosts = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

  it("clears the previous workflow's detail immediately when another workflow is selected", async () => {
    let releaseB: (response: Response) => void = () => undefined;
    const fetcher = serve();
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ initial: twoPending, workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.decisionTarget?.workflowId).toBe(A));

    fetcher.mockImplementation(async (url: string) => url === "/api/workflows"
      ? json({ workflowEngine: twoPending })
      : new Promise<Response>((resolve) => { releaseB = resolve; }));
    act(() => { result.current.select(B); });
    // Nothing from A remains actionable while B loads.
    expect(result.current.detail).toBeNull();
    expect(result.current.decisionTarget).toBeNull();
    expect(result.current.switching).toBe(true);
    expect(result.current.activeId).toBe(B);

    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url) === `/api/workflows/${B}`)).toBe(true));
    await act(async () => { releaseB(json(pending(B))); });
    await waitFor(() => expect(result.current.decisionTarget?.workflowId).toBe(B));
    expect(result.current.switching).toBe(false);
  });

  it("refuses to send a decision whose target is no longer the selected gate", async () => {
    const fetcher = serve();
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ initial: twoPending, workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.decisionTarget?.workflowId).toBe(A));
    const targetA = result.current.decisionTarget!;

    act(() => { result.current.select(B); });
    await waitFor(() => expect(result.current.decisionTarget?.workflowId).toBe(B));

    let sent: DecisionOutcome = { ok: true };
    await act(async () => { sent = await result.current.decide(targetA, "REJECT", "Meant for A", "Rejected."); });
    expect(sent).toMatchObject({ ok: false, reason: "target-changed" });
    expect(decisionPosts(fetcher)).toHaveLength(0);
    expect(result.current.error).toMatch(/nothing was recorded/i);
  });

  it("sends an in-flight decision to its own target and does not pull the view back after the operator moves on", async () => {
    let finishDecision: (response: Response) => void = () => undefined;
    const fetcher = serve(() => new Promise<Response>((resolve) => { finishDecision = resolve; }));
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ initial: twoPending, workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.decisionTarget?.workflowId).toBe(A));
    const targetA = result.current.decisionTarget!;

    let decision: Promise<DecisionOutcome> = Promise.resolve({ ok: true });
    act(() => { decision = result.current.decide(targetA, "APPROVE", undefined, "Approved."); });
    act(() => { result.current.select(B); });
    await waitFor(() => expect(result.current.decisionTarget?.workflowId).toBe(B));

    await act(async () => { finishDecision(json({ operationResult: {} })); await decision; });
    const posts = decisionPosts(fetcher);
    expect(posts).toHaveLength(1);
    expect(String(posts[0][0])).toBe(`/api/workflows/${A}/approvals/approval-a`);
    // The view stays on B, which remains actionable, and the notice names what happened.
    expect(result.current.detail?.workflow.id).toBe(B);
    expect(result.current.decisionTarget?.workflowId).toBe(B);
    expect(result.current.notice).toMatch(/previously selected workflow/i);
  });
});

describe("useWorkflowWorkspace start and decision follow-up failures", () => {
  const NEW_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
  const NEW_RUN = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
  const started = { workflows: [{ id: NEW_ID, workflow_type: "CHANNEL_VIDEO_SCRIPT", status: "QUEUED", created_at: "2026-09-02T10:00:00.000Z", current_run_id: NEW_RUN }], runs: [], pendingApprovals: [] };
  const startedDetail = { workflow: { id: NEW_ID, status: "QUEUED", created_at: "2026-09-02T10:00:00.000Z", current_run_id: NEW_RUN }, runs: [{ id: NEW_RUN, status: "QUEUED", output_payload: null, error_code: null }], approvals: [] };
  const posts = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

  it("reports a successful start whose detail load then fails as a refresh failure, never a failed start", async () => {
    let detailHealthy = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ operationResult: { workflowId: NEW_ID } });
      if (url === "/api/workflows") return json({ workflowEngine: started });
      return detailHealthy ? json(startedDetail) : json({ error: { code: "DATABASE_ERROR", message: "The workflow store is unavailable." } }, false);
    });
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ initial: { workflows: [], runs: [], pendingApprovals: [] }, workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => { ok = await result.current.start({ any: "input" }, "Script queued."); });
    expect(ok).toBe(true);
    expect(posts(fetcher)).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.notice).toBe("Script queued.");
    expect(result.current.refreshError).toMatch(/workflow store is unavailable/i);
    // The new run is the selection, so Retry loads it rather than anything older.
    expect(result.current.activeId).toBe(NEW_ID);
    expect(result.current.busy).toBe(false);

    detailHealthy = true;
    await act(async () => { await result.current.refresh(); });
    expect(result.current.detail?.workflow.id).toBe(NEW_ID);
    expect(result.current.refreshError).toBeNull();
    expect(posts(fetcher)).toHaveLength(1);
  });

  it("still reports a rejected start request as a failed start", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? json({ error: { code: "VIDEO_SCRIPT_LIMIT_REACHED", message: "Finish the active video script first." } }, false)
      : json({ workflowEngine: { workflows: [], runs: [], pendingApprovals: [] } }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ initial: { workflows: [], runs: [], pendingApprovals: [] }, workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => { ok = await result.current.start({ any: "input" }, "Script queued."); });
    expect(ok).toBe(false);
    expect(result.current.error).toMatch(/finish the active video script/i);
    expect(result.current.notice).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("reports a recorded decision whose detail reload then fails as recorded, with a visible refresh failure", async () => {
    const pendingDetail = { workflow: { id: WORKFLOW_ID, status: "WAITING_FOR_APPROVAL", created_at: "2026-09-01T10:00:00.000Z", current_run_id: RUN_ID }, runs: [{ id: RUN_ID, status: "WAITING_FOR_APPROVAL", output_payload: null, error_code: null }], approvals: [{ id: "approval-1", workflow_run_id: RUN_ID, status: "PENDING" }] };
    let detailHealthy = true;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") { detailHealthy = false; return json({ operationResult: {} }); }
      if (url === "/api/workflows") return json(list("WAITING_FOR_APPROVAL"));
      return detailHealthy ? json(pendingDetail) : json({ error: { code: "DATABASE_ERROR", message: "The workflow store is unavailable." } }, false);
    });
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useWorkflowWorkspace<WorkflowDetailBase>({ workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" }));
    await waitFor(() => expect(result.current.decisionTarget?.workflowId).toBe(WORKFLOW_ID));

    let outcome: DecisionOutcome = { ok: false, reason: "unconfirmed", message: "" };
    await act(async () => { outcome = await result.current.decide(result.current.decisionTarget!, "APPROVE", undefined, "Approved."); });
    expect(outcome.ok).toBe(true);
    expect(posts(fetcher)).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.notice).toBe("Approved.");
    expect(result.current.refreshError).toMatch(/workflow store is unavailable/i);
  });
});
