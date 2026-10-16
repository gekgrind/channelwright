// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { parseObjectPayload, UpstreamCard, useApprovedUpstream } from "./upstream-selection";
import type { WorkflowList } from "./workflow-api";

const TYPE = "CHANNEL_VIDEO_SCRIPT";
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const workflow = (n: number) => ({ id: id(n), workflow_type: TYPE, status: "COMPLETED", created_at: `2026-09-${String(n).padStart(2, "0")}T10:00:00.000Z`, current_run_id: `run-${n}`, completed_at: `2026-09-${String(n).padStart(2, "0")}T11:00:00.000Z` });
const run = (n: number) => ({ id: `run-${n}`, workflow_id: id(n), status: "COMPLETED", output_payload: { title: `Script ${n}` }, error_code: null, created_at: "2026-09-01T10:00:00.000Z", completed_at: "2026-09-01T11:00:00.000Z" });
const detail = (n: number) => ({ workflow: { id: id(n), status: "COMPLETED", created_at: workflow(n).created_at, current_run_id: `run-${n}` }, runs: [run(n)], approvals: [] });
const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const describeScript = (output: Record<string, unknown>) => ({ title: String(output.title) });

/**
 * The shared list only carries the newest approved script (its cap is spent on
 * other workflow types); the per-type pages reach the older ones.
 */
function serve(pages: Record<string, { workflows: number[]; next: number | null }>) {
  const fetcher = vi.fn(async (url: string) => {
    const parsed = new URL(url, "http://studio.test");
    if (parsed.pathname === "/api/workflows") {
      expect(parsed.searchParams.get("approvedType")).toBe(TYPE);
      const page = pages[parsed.searchParams.get("beforeId") ?? "first"];
      return json({
        workflows: page.workflows.map(workflow),
        runs: page.workflows.map(run),
        nextCursor: page.next === null ? null : { createdAt: workflow(page.next).created_at, id: id(page.next) },
      });
    }
    const n = Number(parsed.pathname.split("-").at(-1));
    return json(detail(n));
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const capped = (newest: number): WorkflowList => ({ workflows: [workflow(newest)], runs: [run(newest)], pendingApprovals: [] });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("useApprovedUpstream beyond the shared list cap", () => {
  it("offers older approved artifacts outside the shared list and resolves the exact one chosen", async () => {
    // Page 1 holds scripts 9 and 8; page 2 (before script 8) holds script 3.
    const fetcher = serve({ first: { workflows: [9, 8], next: 8 }, [id(8)]: { workflows: [3], next: null } });
    render(<Card engine={capped(9)} />);

    const picker = await screen.findByRole("combobox", { name: /use a different approved script/i });
    await waitFor(() => expect(picker.querySelectorAll("option")).toHaveLength(2));
    expect(screen.getByRole("heading", { name: "Script 9" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /load older approved scripts/i }));
    await waitFor(() => expect(picker.querySelectorAll("option")).toHaveLength(3));
    expect(screen.queryByRole("button", { name: /load older approved scripts/i })).toBeNull();
    const olderPage = fetcher.mock.calls.map(([url]) => new URL(String(url), "http://studio.test")).find((url) => url.searchParams.has("beforeId"))!;
    expect(olderPage.searchParams.get("beforeId")).toBe(id(8));
    expect(olderPage.searchParams.get("beforeCreatedAt")).toBe(workflow(8).created_at);

    fireEvent.change(picker, { target: { value: id(3) } });
    expect(await screen.findByRole("heading", { name: "Script 3" })).toBeInTheDocument();
    expect(screen.getByText(id(3))).toBeInTheDocument();
    expect(screen.getByText("run-3")).toBeInTheDocument();
  });

  it("keeps an older chosen artifact selected when a newer approval arrives", async () => {
    serve({ first: { workflows: [9, 8], next: null } });
    const { result, rerender } = renderHook(({ engine }) => useApprovedUpstream({ engine, workflowType: TYPE, label: "script", parse: parseObjectPayload, describe: describeScript }), { initialProps: { engine: capped(9) } });
    await waitFor(() => expect(result.current.eligible.map((item) => item.id)).toEqual([id(9), id(8)]));
    act(() => { result.current.choose(id(8)); });
    await waitFor(() => expect(result.current.upstream?.workflowId).toBe(id(8)));

    // Script 10 is approved; the first page now starts there and no longer includes 8.
    serve({ first: { workflows: [10, 9], next: 9 } });
    rerender({ engine: capped(10) });
    await waitFor(() => expect(result.current.eligible.map((item) => item.id)).toEqual([id(10), id(9), id(8)]));
    expect(result.current.selectedId).toBe(id(8));
    expect(result.current.upstream?.workflowId).toBe(id(8));
  });

  it("still offers the shared list's approved artifacts when the paged history cannot load", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/workflows?")
      ? json({ error: { code: "DATABASE_ERROR", message: "The workflow store is unavailable." } }, false)
      : json(detail(9))));
    render(<Card engine={capped(9)} />);
    expect(await screen.findByRole("heading", { name: "Script 9" })).toBeInTheDocument();
    expect(await screen.findByText(/workflow store is unavailable\. only recently approved scripts are listed/i)).toBeInTheDocument();
  });
});

function Card({ engine }: { engine: WorkflowList }) {
  const selection = useApprovedUpstream({ engine, workflowType: TYPE, label: "script", parse: parseObjectPayload, describe: describeScript });
  return <UpstreamCard heading="Create packaging from" kindLabel="Script" selection={selection} />;
}
