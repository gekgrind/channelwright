// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelResearchWorkspace, type WorkflowList } from "./channel-research-workspace";
import type { MediaProductionSnapshot } from "@/domain/media-production";

const initial: WorkflowList = { workflows: [], runs: [], pendingApprovals: [] };
const media: MediaProductionSnapshot = { evidence: "SUPABASE_DATABASE", assets: [], renderInputs: [], renderJobs: [], masters: [] };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("channel research workspace", () => {
  it("starts a bounded provider workflow with an explicit idempotency key", async () => {
    const workflowId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ operationResult: { workflowId, runId } }), { status: 202, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ workflowEngine: { workflows: [{ id: workflowId, workflow_type: "CHANNEL_RESEARCH", status: "QUEUED", created_at: new Date().toISOString(), current_run_id: runId }], runs: [], pendingApprovals: [] } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ workflow: { id: workflowId, status: "QUEUED", created_at: new Date().toISOString() }, runs: [{ id: runId, status: "QUEUED", input_payload: {}, output_payload: null, error_code: null }], steps: [], attempts: [], approvals: [], events: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    render(<ChannelResearchWorkspace initial={initial} media={media} />);
    fireEvent.click(screen.getByRole("button", { name: /start bounded research/i }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/workflows");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ operation: "START_WORKFLOW", workflowType: "CHANNEL_RESEARCH", input: { constraints: { faceless: true, language: "English" } } });
    expect(await screen.findByText(/trusted workflow worker must claim/i)).toBeTruthy();
  });
});
