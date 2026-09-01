// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VideoReleaseWorkspace } from "./video-release-workspace";
import { videoReleaseResultFixture } from "@/server/workflows/video-release-fixtures.test-helper";

const RELEASE = videoReleaseResultFixture();
const PACKAGING_WORKFLOW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const RELEASE_WORKFLOW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const RUN_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

const workflowList = (withRelease = true) => ({
  workflows: [
    { id: PACKAGING_WORKFLOW_ID, workflow_type: "CHANNEL_VIDEO_PACKAGING", status: "COMPLETED", created_at: "2026-08-17T10:00:00.000Z", current_run_id: RUN_ID },
    ...(withRelease ? [{ id: RELEASE_WORKFLOW_ID, workflow_type: "CHANNEL_VIDEO_RELEASE", status: "WAITING_FOR_APPROVAL", created_at: "2026-08-18T10:00:00.000Z", current_run_id: RUN_ID }] : []),
  ],
});

const releaseDetail = (approvalStatus = "PENDING") => ({
  workflow: { id: RELEASE_WORKFLOW_ID, status: "WAITING_FOR_APPROVAL", created_at: "2026-08-18T10:00:00.000Z", current_run_id: RUN_ID },
  runs: [{ id: RUN_ID, status: "COMPLETED", input_payload: {}, context_payload: {}, output_payload: RELEASE, error_code: null, artifact_hash: null, provenance_hash: null }],
  steps: [
    { id: "s1", workflow_run_id: RUN_ID, step_key: "validate-approved-packaging", status: "COMPLETED", output_payload: null, attempt_count: 1, max_attempts: 2, error_code: null },
    { id: "s2", workflow_run_id: RUN_ID, step_key: "final-video-release-qa", status: "COMPLETED", attempt_count: 1, max_attempts: 2, error_code: null,
      output_payload: { qa: { passed: true, score: 91, findings: [], recommendation: "accept", deterministicChecksPassed: 40, deterministicChecksFailed: 0, modelUsage: { model: "m", inputTokens: 1, outputTokens: 1, totalTokens: 2 } } } },
  ],
  approvals: [{ id: "ap1", workflow_run_id: RUN_ID, status: approvalStatus, decision_note: null, requested_at: "2026-08-18T10:00:00.000Z", decided_at: null }],
});

const packagingDetail = () => ({
  workflow: { id: PACKAGING_WORKFLOW_ID, status: "COMPLETED", created_at: "2026-08-17T10:00:00.000Z", current_run_id: RUN_ID },
  runs: [{ id: RUN_ID, status: "COMPLETED", input_payload: {}, context_payload: {}, output_payload: { schemaVersion: 1 }, error_code: null, artifact_hash: null, provenance_hash: null }],
  steps: [], approvals: [],
});

function mockFetch(handlers: { list?: unknown; packaging?: unknown; release?: unknown; post?: { ok: boolean; body: unknown } }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const post = handlers.post ?? { ok: true, body: { operationResult: { workflowId: RELEASE_WORKFLOW_ID } } };
      return { ok: post.ok, json: async () => post.body } as Response;
    }
    if (url === "/api/workflows") return { ok: true, json: async () => ({ workflowEngine: handlers.list ?? workflowList() }) } as Response;
    if (url.includes(PACKAGING_WORKFLOW_ID)) return { ok: true, json: async () => handlers.packaging ?? packagingDetail() } as Response;
    return { ok: true, json: async () => handlers.release ?? releaseDetail() } as Response;
  });
}

beforeEach(() => { vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-1111-4111-8111-111111111111" }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("VideoReleaseWorkspace", () => {
  it("shows a loading state and then the workspace", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoReleaseWorkspace />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    await waitFor(() => expect(screen.getByRole("heading", { name: /video release/i })).toBeInTheDocument());
  });

  it("tells the operator to approve packaging first when none exists", async () => {
    vi.stubGlobal("fetch", mockFetch({ list: { workflows: [] } }));
    render(<VideoReleaseWorkspace />);
    await waitFor(() => expect(screen.getByText(/approve a video packaging first/i)).toBeInTheDocument());
  });

  it("starts a release sending only identifiers, never an upstream artifact", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoReleaseWorkspace />);
    const button = await screen.findByRole("button", { name: /start video release/i }, { timeout: 5000 });
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/workflows", expect.objectContaining({ method: "POST" })));
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body).toEqual({
      operation: "START_WORKFLOW",
      workflowType: "CHANNEL_VIDEO_RELEASE",
      definitionVersion: 1,
      input: { videoPackagingWorkflowId: PACKAGING_WORKFLOW_ID, videoPackagingRunId: RUN_ID },
    });
    // No packaging object, release, hash, or QA state may cross the boundary.
    expect(JSON.stringify(body)).not.toMatch(/viewerValue|contractHash|artifactHash|finalQaScore|titleDecision|kpiHypothesis/);
    expect((call?.[1] as RequestInit).headers).toMatchObject({ "idempotency-key": expect.any(String) });
  });

  it("renders the release as a readable document rather than raw JSON", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoReleaseWorkspace />);
    await waitFor(() => expect(screen.getByRole("heading", { name: RELEASE.source.workingConcept })).toBeInTheDocument());
    expect(screen.getAllByText(new RegExp(RELEASE.titleDecision.selectedTitleText.slice(0, 20))).length).toBeGreaterThan(0);
    expect(screen.getByText(/viewer value PASS/i)).toBeInTheDocument();
    expect(screen.getByText(/deception guard PASS/i)).toBeInTheDocument();
    expect(screen.getByText(/QA 91\/100/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/"schemaVersion":/);
  });

  it("states that approval does not publish, schedule, or generate", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<VideoReleaseWorkspace />);
    await waitFor(() => expect(screen.getByText(/does not publish, schedule, upload, render, or generate anything/i)).toBeInTheDocument());
    expect(screen.getByText(/does not publish, schedule, upload, or generate anything/i)).toBeInTheDocument();
  });

  it("records an approval decision", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoReleaseWorkspace />);
    const approve = await screen.findByRole("button", { name: /approve/i });
    fireEvent.click(approve);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/approvals/ap1"));
      expect(call).toBeDefined();
      expect(JSON.parse((call?.[1] as RequestInit).body as string)).toMatchObject({ decision: "APPROVE" });
    });
  });

  it("hides review controls once the approval is decided", async () => {
    vi.stubGlobal("fetch", mockFetch({ release: releaseDetail("APPROVED") }));
    render(<VideoReleaseWorkspace />);
    await waitFor(() => expect(screen.getByRole("heading", { name: RELEASE.source.workingConcept })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("surfaces a terminal run error code without exposing internals", async () => {
    const failed = releaseDetail();
    failed.runs = [{ ...failed.runs[0], status: "FAILED", output_payload: null, error_code: "VIDEO_RELEASE_INTEGRITY_UNREVISABLE" }] as unknown as typeof failed.runs;
    vi.stubGlobal("fetch", mockFetch({ release: failed }));
    render(<VideoReleaseWorkspace />);
    await waitFor(() => expect(screen.getByText(/VIDEO_RELEASE_INTEGRITY_UNREVISABLE/)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/pg_|plpgsql|channelwright\./);
  });
});
