// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    // Longer than the 1000ms default: under full-suite parallel load the async
    // render + fetch settle can exceed it, which is load-sensitive test flakiness,
    // not a product defect.
    // The exact approved upstream is shown before anything can be started.
    await screen.findByRole("region", { name: /selected approved brief/i }, { timeout: 5000 });
    const button = screen.getByRole("button", { name: /start video script/i });
    expect(button).toBeEnabled();
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
    expect(screen.queryByRole("button", { name: /approve exact version/i })).not.toBeInTheDocument();
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

  it("sends Reject only after the operator confirms the terminal consequence", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoScriptWorkspace />);
    const decisionCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/approvals/ap1"));
    fireEvent.click(await screen.findByRole("button", { name: /^reject/i }));
    expect(screen.getByRole("alertdialog", { name: /reject and close this script/i })).toBeInTheDocument();
    expect(decisionCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /keep reviewing/i }));
    expect(decisionCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /^reject/i }));
    fireEvent.click(screen.getByRole("button", { name: /reject and close/i }));
    await waitFor(() => expect(decisionCalls()).toHaveLength(1));
    expect(JSON.parse((decisionCalls()[0][1] as RequestInit).body as string)).toEqual({ decision: "REJECT" });
  });

  it("never carries a Reject confirmation or revision note from one script run to another", async () => {
    const SCRIPT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
    const RUN_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
    const detailB = scriptDetail();
    detailB.workflow = { ...detailB.workflow, id: SCRIPT_B, current_run_id: RUN_B };
    detailB.runs = detailB.runs.map((run) => ({ ...run, id: RUN_B }));
    detailB.steps = detailB.steps.map((step) => ({ ...step, workflow_run_id: RUN_B }));
    detailB.approvals = [{ ...detailB.approvals[0], id: "apB", workflow_run_id: RUN_B }];
    const list = {
      workflows: [
        ...workflowList().workflows,
        { id: SCRIPT_B, workflow_type: "CHANNEL_VIDEO_SCRIPT", status: "WAITING_FOR_APPROVAL", created_at: "2026-08-17T10:00:00.000Z", current_run_id: RUN_B },
      ],
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true, json: async () => ({ operationResult: {} }) } as Response;
      if (url === "/api/workflows") return { ok: true, json: async () => ({ workflowEngine: list }) } as Response;
      if (url.includes(BRIEF_WORKFLOW_ID)) return { ok: true, json: async () => briefDetail() } as Response;
      if (url.includes(SCRIPT_B)) return { ok: true, json: async () => detailB } as Response;
      return { ok: true, json: async () => scriptDetail() } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoScriptWorkspace />);

    await screen.findByRole("button", { name: /approve exact version/i });
    fireEvent.change(screen.getByLabelText(/revision note/i), { target: { value: "Notes written about run A." } });
    fireEvent.click(screen.getByRole("button", { name: /^reject/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Reason written about run A." } });

    const runs = within(screen.getByRole("navigation", { name: /video script runs/i })).getAllByRole("button");
    fireEvent.click(runs[1]);
    // While B loads, nothing from A can be acted on.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve exact version/i })).not.toBeInTheDocument();

    await waitFor(() => expect(runs[1]).toHaveAttribute("aria-pressed", "true"));
    await screen.findByRole("button", { name: /approve exact version/i });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/revision note/i)).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: /^reject/i }));
    expect(screen.getByLabelText(/reason/i)).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /reject and close/i }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(1));
    const [url, init] = fetchMock.mock.calls.find(([, call]) => (call as RequestInit | undefined)?.method === "POST")!;
    expect(url).toBe(`/api/workflows/${SCRIPT_B}/approvals/apB`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ decision: "REJECT" });
  });

  it("keeps a failed refresh visible and recoverable instead of swallowing it", async () => {
    let healthy = true;
    const healthyFetch = mockFetch({});
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => healthy
      ? healthyFetch(url, init)
      : ({ ok: false, json: async () => ({ error: { code: "DATABASE_ERROR", message: "The workflow store is unavailable." } }) }) as Response));
    render(<VideoScriptWorkspace />);
    await screen.findByRole("heading", { name: SCRIPT.source.workingConcept });
    await screen.findByRole("region", { name: /selected approved brief/i });
    healthy = false;
    fireEvent.click(screen.getAllByRole("button", { name: /^refresh$/i })[0]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/workflow store is unavailable/i);
    expect(alert).toHaveTextContent(/may be out of date/i);
    healthy = true;
    fireEvent.click(screen.getByRole("button", { name: /retry now/i }));
    await waitFor(() => expect(screen.queryByText(/workflow store is unavailable/i)).not.toBeInTheDocument());
  });

  it("retries a failed upstream resolution on the next refresh instead of staying stuck", async () => {
    let briefHealthy = false;
    const healthyFetch = mockFetch({});
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => url.includes(BRIEF_WORKFLOW_ID) && !briefHealthy
      ? ({ ok: false, json: async () => ({ error: { code: "DATABASE_ERROR", message: "The approved brief could not be read." } }) }) as Response
      : healthyFetch(url, init)));
    render(<VideoScriptWorkspace />);
    await screen.findByText(/approved brief could not be read/i);
    expect(screen.getByRole("button", { name: /start video script/i })).toBeDisabled();

    briefHealthy = true;
    fireEvent.click(screen.getAllByRole("button", { name: /^refresh$/i })[0]);
    await screen.findByRole("region", { name: /selected approved brief/i });
    expect(screen.queryByText(/approved brief could not be read/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start video script/i })).toBeEnabled();
  });

  it("shows which approved brief will be used and lets the operator choose another", async () => {
    const OLDER_BRIEF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    const OLDER_RUN_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
    const briefOutput = (concept: string) => ({ schemaVersion: 1, source: { workingConcept: concept } });
    const list = {
      workflows: [
        { id: BRIEF_WORKFLOW_ID, workflow_type: "CHANNEL_VIDEO_BRIEF", status: "COMPLETED", created_at: "2026-08-15T10:00:00.000Z", current_run_id: RUN_ID },
        { id: OLDER_BRIEF_ID, workflow_type: "CHANNEL_VIDEO_BRIEF", status: "COMPLETED", created_at: "2026-08-10T10:00:00.000Z", current_run_id: OLDER_RUN_ID },
        { id: "ffffffff-ffff-4fff-8fff-fffffffffff1", workflow_type: "CHANNEL_VIDEO_BRIEF", status: "WAITING_FOR_APPROVAL", created_at: "2026-08-17T10:00:00.000Z", current_run_id: "ffffffff-ffff-4fff-8fff-fffffffffff2" },
      ],
      runs: [
        { id: RUN_ID, workflow_id: BRIEF_WORKFLOW_ID, status: "COMPLETED", output_payload: briefOutput("Why loyalty programs fail"), error_code: null, created_at: "2026-08-15T10:00:00.000Z", completed_at: "2026-08-15T12:00:00.000Z" },
        { id: OLDER_RUN_ID, workflow_id: OLDER_BRIEF_ID, status: "COMPLETED", output_payload: briefOutput("How warranties make money"), error_code: null, created_at: "2026-08-10T10:00:00.000Z", completed_at: "2026-08-10T12:00:00.000Z" },
      ],
      pendingApprovals: [],
    };
    const detailFor = (id: string, runId: string, concept: string) => ({
      workflow: { id, status: "COMPLETED", created_at: "2026-08-10T10:00:00.000Z", current_run_id: runId },
      runs: [{ id: runId, status: "COMPLETED", input_payload: {}, context_payload: {}, output_payload: briefOutput(concept), error_code: null, artifact_hash: null, provenance_hash: null, created_at: "2026-08-10T10:00:00.000Z", completed_at: "2026-08-10T12:00:00.000Z" }],
      steps: [], approvals: [],
    });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true, json: async () => ({ operationResult: { workflowId: SCRIPT_WORKFLOW_ID } }) } as Response;
      if (url === "/api/workflows") return { ok: true, json: async () => ({ workflowEngine: list }) } as Response;
      if (url.includes(OLDER_BRIEF_ID)) return { ok: true, json: async () => detailFor(OLDER_BRIEF_ID, OLDER_RUN_ID, "How warranties make money") } as Response;
      if (url.includes(BRIEF_WORKFLOW_ID)) return { ok: true, json: async () => detailFor(BRIEF_WORKFLOW_ID, RUN_ID, "Why loyalty programs fail") } as Response;
      return { ok: true, json: async () => scriptDetail() } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoScriptWorkspace />);

    const card = await screen.findByRole("region", { name: /selected approved brief/i });
    expect(card).toHaveTextContent("Why loyalty programs fail");
    expect(card).toHaveTextContent(/Brief v1 · approved/);
    // Identifiers stay behind a provenance disclosure; no raw UUID entry exists.
    expect(screen.queryByRole("textbox", { name: /workflow id|run id/i })).not.toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: /use a different approved brief/i });
    // Only approved briefs are offered; the one still awaiting approval is not.
    expect(Array.from((picker as HTMLSelectElement).options).map((option) => option.value)).toEqual([BRIEF_WORKFLOW_ID, OLDER_BRIEF_ID]);

    fireEvent.change(picker, { target: { value: OLDER_BRIEF_ID } });
    await waitFor(() => expect(screen.getByRole("region", { name: /selected approved brief/i })).toHaveTextContent("How warranties make money"));
    fireEvent.click(screen.getByRole("button", { name: /start video script/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/workflows", expect.objectContaining({ method: "POST" })));
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse((call?.[1] as RequestInit).body as string).input).toEqual({ videoBriefWorkflowId: OLDER_BRIEF_ID, videoBriefRunId: OLDER_RUN_ID });
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
