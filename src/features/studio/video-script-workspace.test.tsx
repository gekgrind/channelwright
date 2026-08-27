// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VideoScriptWorkspace } from "./video-script-workspace";
import { videoScriptResultFixture } from "@/server/workflows/video-script-fixtures.test-helper";

const SCRIPT = videoScriptResultFixture();
const BRIEF_WORKFLOW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SCRIPT_WORKFLOW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const RUN_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

const workflowList = (withScript = true) => ({
  workflows: [
    { id: BRIEF_WORKFLOW_ID, workflow_type: "CHANNEL_VIDEO_BRIEF", status: "COMPLETED", created_at: "2026-08-15T10:00:00.000Z", current_run_id: RUN_ID },
    ...(withScript ? [{ id: SCRIPT_WORKFLOW_ID, workflow_type: "CHANNEL_VIDEO_SCRIPT", status: "WAITING_FOR_APPROVAL", created_at: "2026-08-16T10:00:00.000Z", current_run_id: RUN_ID }] : []),
  ],
});

const scriptDetail = (approvalStatus = "PENDING") => ({
  workflow: { id: SCRIPT_WORKFLOW_ID, status: "WAITING_FOR_APPROVAL", created_at: "2026-08-16T10:00:00.000Z", current_run_id: RUN_ID },
  runs: [{ id: RUN_ID, status: "COMPLETED", input_payload: {}, context_payload: {}, output_payload: SCRIPT, error_code: null, artifact_hash: null, provenance_hash: null }],
  steps: [
    { id: "s1", workflow_run_id: RUN_ID, step_key: "validate-approved-brief", status: "COMPLETED", output_payload: null, attempt_count: 1, max_attempts: 2, error_code: null },
    { id: "s2", workflow_run_id: RUN_ID, step_key: "final-video-script-qa", status: "COMPLETED", attempt_count: 1, max_attempts: 2, error_code: null,
      output_payload: { qa: { passed: true, score: 90, findings: [], recommendation: "accept", deterministicChecksPassed: 34, deterministicChecksFailed: 0, modelUsage: { model: "m", inputTokens: 1, outputTokens: 1, totalTokens: 2 } } } },
  ],
  approvals: [{ id: "ap1", workflow_run_id: RUN_ID, status: approvalStatus, decision_note: null, requested_at: "2026-08-16T10:00:00.000Z", decided_at: null }],
});

const briefDetail = () => ({
  workflow: { id: BRIEF_WORKFLOW_ID, status: "COMPLETED", created_at: "2026-08-15T10:00:00.000Z", current_run_id: RUN_ID },
  runs: [{ id: RUN_ID, status: "COMPLETED", input_payload: {}, context_payload: {}, output_payload: { schemaVersion: 1 }, error_code: null, artifact_hash: null, provenance_hash: null }],
  steps: [], approvals: [],
});

function mockFetch(handlers: { list?: unknown; brief?: unknown; script?: unknown; post?: { ok: boolean; body: unknown } }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const post = handlers.post ?? { ok: true, body: { operationResult: { workflowId: SCRIPT_WORKFLOW_ID } } };
      return { ok: post.ok, json: async () => post.body } as Response;
    }
    if (url === "/api/workflows") return { ok: true, json: async () => ({ workflowEngine: handlers.list ?? workflowList() }) } as Response;
    if (url.includes(BRIEF_WORKFLOW_ID)) return { ok: true, json: async () => handlers.brief ?? briefDetail() } as Response;
    return { ok: true, json: async () => handlers.script ?? scriptDetail() } as Response;
  });
}

beforeEach(() => { vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-1111-4111-8111-111111111111" }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("VideoScriptWorkspace", () => {
  it("shows a loading state and then the workspace", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoScriptWorkspace />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    await waitFor(() => expect(screen.getByRole("heading", { name: /video script/i })).toBeInTheDocument());
  });

  it("tells the operator to approve a brief first when none exists", async () => {
    vi.stubGlobal("fetch", mockFetch({ list: { workflows: [] } }));
    render(<VideoScriptWorkspace />);
    await waitFor(() => expect(screen.getByText(/approve a video brief first/i)).toBeInTheDocument());
  });

  it("starts a script sending only identifiers, never an upstream artifact", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoScriptWorkspace />);
    const button = await screen.findByRole("button", { name: /start video script/i });
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/workflows", expect.objectContaining({ method: "POST" })));
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body).toEqual({
      operation: "START_WORKFLOW",
      workflowType: "CHANNEL_VIDEO_SCRIPT",
      definitionVersion: 1,
      input: { videoBriefWorkflowId: BRIEF_WORKFLOW_ID, videoBriefRunId: RUN_ID },
    });
    // No brief object, script, hash, or QA state may cross the boundary.
    expect(JSON.stringify(body)).not.toMatch(/viewerValue|contractHash|artifactHash|finalQaScore|narration/);
    expect((call?.[1] as RequestInit).headers).toMatchObject({ "idempotency-key": expect.any(String) });
  });

  it("renders the script as a readable document rather than raw JSON", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoScriptWorkspace />);
    await waitFor(() => expect(screen.getByRole("heading", { name: SCRIPT.source.workingConcept })).toBeInTheDocument());
    expect(screen.getByText(SCRIPT.openingHook.spokenOpening)).toBeInTheDocument();
    expect(screen.getByText(/viewer value PASS/i)).toBeInTheDocument();
    expect(screen.getByText(/QA 90\/100/)).toBeInTheDocument();
    for (const section of SCRIPT.sections) {
      expect(screen.getByText(section.title)).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toMatch(/"schemaVersion":/);
  });

  it("states that approval is not readiness to package, render, or publish", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoScriptWorkspace />);
    await waitFor(() => expect(screen.getByText(/not a title, a thumbnail, generated media, or a publishing decision/i)).toBeInTheDocument());
    expect(screen.getByText(/does not mean the video is ready to package, render, or publish/i)).toBeInTheDocument();
  });

  it("records an approval decision", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoScriptWorkspace />);
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
    render(<VideoScriptWorkspace />);
    const revise = await screen.findByRole("button", { name: /request revision/i });
    expect(revise).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/revision note/i), { target: { value: "Tighten the demonstration and cut the drag in the middle." } });
    expect(revise).toBeEnabled();
  });

  it("hides review controls once the approval is decided", async () => {
    vi.stubGlobal("fetch", mockFetch({ script: scriptDetail("APPROVED") }));
    render(<VideoScriptWorkspace />);
    await waitFor(() => expect(screen.getByRole("heading", { name: SCRIPT.source.workingConcept })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("shows the successor run's QA after a revision, never the predecessor's (defect #4)", async () => {
    const PRED_RUN = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
    const SUCC_RUN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
    const qaStep = (runId: string, score: number, id: string) => ({
      id, workflow_run_id: runId, step_key: "final-video-script-qa", status: "COMPLETED", attempt_count: 1, max_attempts: 2, error_code: null,
      output_payload: { qa: { passed: true, score, findings: [], recommendation: "accept", deterministicChecksPassed: 36, deterministicChecksFailed: 0, modelUsage: { model: "m", inputTokens: 1, outputTokens: 1, totalTokens: 2 } } },
    });
    const revisionDetail = {
      workflow: { id: SCRIPT_WORKFLOW_ID, status: "WAITING_FOR_APPROVAL", created_at: "2026-08-16T10:00:00.000Z", current_run_id: SUCC_RUN },
      runs: [
        { id: SUCC_RUN, status: "COMPLETED", input_payload: {}, context_payload: {}, output_payload: SCRIPT, error_code: null, artifact_hash: null, provenance_hash: null },
        { id: PRED_RUN, status: "BLOCKED", input_payload: {}, context_payload: {}, output_payload: SCRIPT, error_code: null, artifact_hash: null, provenance_hash: null },
      ],
      steps: [qaStep(PRED_RUN, 51, "pred-qa"), qaStep(SUCC_RUN, 93, "succ-qa")],
      approvals: [{ id: "ap1", workflow_run_id: SUCC_RUN, status: "PENDING", decision_note: null, requested_at: "2026-08-16T10:00:00.000Z", decided_at: null }],
    };
    vi.stubGlobal("fetch", mockFetch({ script: revisionDetail }));
    render(<VideoScriptWorkspace />);
    await waitFor(() => expect(screen.getByText(/QA 93\/100/)).toBeInTheDocument());
    expect(screen.queryByText(/QA 51\/100/)).not.toBeInTheDocument();
  });

  it("surfaces a terminal run error code without exposing internals", async () => {
    const failed = scriptDetail();
    failed.runs = [{ ...failed.runs[0], status: "FAILED", output_payload: null, error_code: "VIDEO_SCRIPT_INTEGRITY_UNREVISABLE" }] as unknown as typeof failed.runs;
    vi.stubGlobal("fetch", mockFetch({ script: failed }));
    render(<VideoScriptWorkspace />);
    await waitFor(() => expect(screen.getByText(/VIDEO_SCRIPT_INTEGRITY_UNREVISABLE/)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/pg_|plpgsql|channelwright\./);
  });
});
