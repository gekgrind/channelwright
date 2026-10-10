// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useWorkflowWorkspace } from "./use-workflow-workspace";
import { announceWorkflowsChanged, WORKFLOW_POLL_INTERVAL_MS, type WorkflowDetailBase } from "./workflow-api";

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
    await act(async () => { await sibling.result.current.decide("APPROVE", undefined, "Approved."); });
    await waitFor(() => expect(observer.result.current.engine?.workflows).toHaveLength(1));
  });
});
