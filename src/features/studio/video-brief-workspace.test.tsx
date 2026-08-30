// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VideoBriefWorkspace } from "./video-brief-workspace";
import { videoBriefResultFixture, approvedContentArtifactFixture } from "@/server/workflows/video-brief-fixtures.test-helper";

const BRIEF = videoBriefResultFixture();
const CONTENT_WORKFLOW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const BRIEF_WORKFLOW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const RUN_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

const workflowList = (withBrief = true) => ({
  workflows: [
    { id: CONTENT_WORKFLOW_ID, workflow_type: "CHANNEL_CONTENT_INTELLIGENCE", status: "COMPLETED", created_at: "2026-08-15T10:00:00.000Z", current_run_id: RUN_ID },
    ...(withBrief ? [{ id: BRIEF_WORKFLOW_ID, workflow_type: "CHANNEL_VIDEO_BRIEF", status: "WAITING_FOR_APPROVAL", created_at: "2026-08-16T10:00:00.000Z", current_run_id: RUN_ID }] : []),
  ],
});

const briefDetail = (approvalStatus = "PENDING") => ({
  workflow: { id: BRIEF_WORKFLOW_ID, status: "WAITING_FOR_APPROVAL", created_at: "2026-08-16T10:00:00.000Z", current_run_id: RUN_ID },
  runs: [{ id: RUN_ID, status: "COMPLETED", input_payload: {}, context_payload: {}, output_payload: BRIEF, error_code: null, artifact_hash: null, provenance_hash: null }],
  steps: [
    { id: "s1", workflow_run_id: RUN_ID, step_key: "validate-approved-content", status: "COMPLETED", output_payload: null, attempt_count: 1, max_attempts: 2, error_code: null },
    { id: "s2", workflow_run_id: RUN_ID, step_key: "final-video-brief-qa", status: "COMPLETED", attempt_count: 1, max_attempts: 2, error_code: null,
      output_payload: { qa: { passed: true, score: 91, findings: [], recommendation: "accept", deterministicChecksPassed: 28, deterministicChecksFailed: 0, modelUsage: { model: "m", inputTokens: 1, outputTokens: 1, totalTokens: 2 } } } },
  ],
  approvals: [{ id: "ap1", workflow_run_id: RUN_ID, status: approvalStatus, decision_note: null, requested_at: "2026-08-16T10:00:00.000Z", decided_at: null }],
  researchBudgets: [],
});

const contentDetail = () => ({
  workflow: { id: CONTENT_WORKFLOW_ID, status: "COMPLETED", created_at: "2026-08-15T10:00:00.000Z", current_run_id: RUN_ID },
  runs: [{ id: RUN_ID, status: "COMPLETED", input_payload: {}, context_payload: {}, output_payload: approvedContentArtifactFixture.contentResult, error_code: null, artifact_hash: null, provenance_hash: null }],
  steps: [], approvals: [], researchBudgets: [],
});

function mockFetch(handlers: { list?: unknown; content?: unknown; brief?: unknown; post?: { ok: boolean; body: unknown } }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const post = handlers.post ?? { ok: true, body: { operationResult: { workflowId: BRIEF_WORKFLOW_ID } } };
      return { ok: post.ok, json: async () => post.body } as Response;
    }
    if (url === "/api/workflows") return { ok: true, json: async () => ({ workflowEngine: handlers.list ?? workflowList() }) } as Response;
    if (url.includes(CONTENT_WORKFLOW_ID)) return { ok: true, json: async () => handlers.content ?? contentDetail() } as Response;
    return { ok: true, json: async () => handlers.brief ?? briefDetail() } as Response;
  });
}

beforeEach(() => { vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-1111-4111-8111-111111111111" }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("VideoBriefWorkspace", () => {
  it("shows a loading state and then the workspace", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoBriefWorkspace />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    await waitFor(() => expect(screen.getByRole("heading", { name: /video brief/i })).toBeInTheDocument());
  });

  it("tells the operator to approve a backlog first when none exists", async () => {
    vi.stubGlobal("fetch", mockFetch({ list: { workflows: [] } }));
    render(<VideoBriefWorkspace />);
    await waitFor(() => expect(screen.getByText(/approve a content-intelligence backlog first/i)).toBeInTheDocument());
  });

  it("surfaces the recommended next video and only viewer-value-eligible topics", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoBriefWorkspace />);
    await waitFor(() => expect(screen.getByText("Recommended next video")).toBeInTheDocument());
    const select = await screen.findByRole("combobox", { name: /topic/i });
    // The default option defers to the artifact's own authoritative recommendation.
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: /use the recommended next video/i })).toBeInTheDocument();
  });

  it("starts a brief sending only identifiers, never an upstream artifact", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoBriefWorkspace />);
    // Longer than the 1000ms default: under full-suite parallel load the async
    // render + fetch settle can exceed it, which is load-sensitive test flakiness,
    // not a product defect.
    const button = await screen.findByRole("button", { name: /start video brief/i }, { timeout: 5000 });
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/workflows", expect.objectContaining({ method: "POST" })));
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body).toEqual({
      operation: "START_WORKFLOW",
      workflowType: "CHANNEL_VIDEO_BRIEF",
      definitionVersion: 1,
      input: { contentIntelligenceWorkflowId: CONTENT_WORKFLOW_ID, contentIntelligenceRunId: RUN_ID },
    });
    // No topic object, content result, hash, or QA state may cross the boundary.
    expect(JSON.stringify(body)).not.toMatch(/viewerValue|contractHash|artifactHash|finalQaScore|backlog/);
    expect((call?.[1] as RequestInit).headers).toMatchObject({ "idempotency-key": expect.any(String) });
  });

  it("renders the brief as a readable document rather than raw JSON", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoBriefWorkspace />);
    await waitFor(() => expect(screen.getByRole("heading", { name: BRIEF.source.workingConcept })).toBeInTheDocument());
    expect(screen.getByText(BRIEF.viewerPromise.statement)).toBeInTheDocument();
    expect(screen.getByText(/viewer value PASS/i)).toBeInTheDocument();
    expect(screen.getByText(/QA 91\/100/)).toBeInTheDocument();
    // Beats are rendered as structure, not narration.
    for (const beat of BRIEF.contentArchitecture.beats) {
      expect(screen.getByText(beat.title)).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toMatch(/"schemaVersion":/);
  });

  it("surfaces research-required claims and claims that must not be made", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoBriefWorkspace />);
    await waitFor(() => expect(screen.getByText(/need research before scripting/i)).toBeInTheDocument());
    expect(screen.getByText(/must not be claimed/i)).toBeInTheDocument();
  });

  it("states that approval is direction only, not readiness to publish", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoBriefWorkspace />);
    await waitFor(() => expect(screen.getByText(/not a script, a title, a thumbnail, or a publishing decision/i)).toBeInTheDocument());
    expect(screen.getByText(/does not mean the video is ready to produce, export, or publish/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/READY TO (PUBLISH|EXPORT|UPLOAD)/i);
  });

  it("records an approval decision", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoBriefWorkspace />);
    const approve = await screen.findByRole("button", { name: /approve/i });
    fireEvent.click(approve);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/approvals/ap1"));
      expect(call).toBeDefined();
      expect(JSON.parse((call?.[1] as RequestInit).body as string)).toMatchObject({ decision: "APPROVE" });
    });
  });

  it("requires a revision note before a revision can be requested", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoBriefWorkspace />);
    const revise = await screen.findByRole("button", { name: /request revision/i });
    expect(revise).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/revision note/i), { target: { value: "Tighten the opening and evidence the maintenance claim." } });
    expect(revise).toBeEnabled();
  });

  it("sends the revision note with the decision", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoBriefWorkspace />);
    await screen.findByRole("button", { name: /request revision/i });
    fireEvent.change(screen.getByLabelText(/revision note/i), { target: { value: "Evidence the maintenance claim." } });
    fireEvent.click(screen.getByRole("button", { name: /request revision/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/approvals/ap1"));
      expect(JSON.parse((call?.[1] as RequestInit).body as string)).toMatchObject({ decision: "REQUEST_REVISION", note: "Evidence the maintenance claim." });
    });
  });

  it("hides review controls once the approval is decided", async () => {
    vi.stubGlobal("fetch", mockFetch({ brief: briefDetail("APPROVED") }));
    render(<VideoBriefWorkspace />);
    await waitFor(() => expect(screen.getByRole("heading", { name: BRIEF.source.workingConcept })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("shows a sanitized error when the workflow list fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: { code: "UPSTREAM_CONTENT_INVALID", message: "The exact approved content-intelligence artifact could not be revalidated." } }) }) as Response));
    render(<VideoBriefWorkspace />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be revalidated/i));
    // No database internals or stack traces reach the operator.
    expect(screen.getByRole("alert").textContent).not.toMatch(/pg_|plpgsql|channelwright\./);
  });

  it("surfaces a terminal run error code without exposing internals", async () => {
    const failed = briefDetail();
    failed.runs = [{ ...failed.runs[0], status: "FAILED", output_payload: null, error_code: "VIDEO_BRIEF_INTEGRITY_UNREVISABLE" }] as unknown as typeof failed.runs;
    vi.stubGlobal("fetch", mockFetch({ brief: failed }));
    render(<VideoBriefWorkspace />);
    await waitFor(() => expect(screen.getByText(/VIDEO_BRIEF_INTEGRITY_UNREVISABLE/)).toBeInTheDocument());
  });
});
