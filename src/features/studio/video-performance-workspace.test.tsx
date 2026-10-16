// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VideoPerformanceWorkspace } from "./video-performance-workspace";

const RELEASE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const RELEASE_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RUN_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const RUN_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const titleOf = (id: string) => id === RELEASE_A ? "The loyalty trap nobody explains" : "Warranties, explained";
const runOf = (id: string) => id === RELEASE_A ? RUN_A : RUN_B;

const list = {
  workflows: [RELEASE_A, RELEASE_B].map((id, index) => ({ id, workflow_type: "CHANNEL_VIDEO_RELEASE", status: "COMPLETED", created_at: `2026-09-1${2 - index}T10:00:00.000Z`, current_run_id: runOf(id) })),
  runs: [],
  pendingApprovals: [],
};
const releaseDetail = (id: string) => ({
  workflow: { id, status: "COMPLETED", created_at: "2026-09-10T10:00:00.000Z", current_run_id: runOf(id) },
  runs: [{ id: runOf(id), status: "COMPLETED", output_payload: { source: { workingConcept: "Loyalty" }, reconciledMetadata: { finalTitle: titleOf(id) } }, error_code: null, created_at: "2026-09-10T10:00:00.000Z", completed_at: "2026-09-10T12:00:00.000Z" }],
  steps: [], approvals: [],
});

function serve() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return { ok: true, json: async () => ({ operationResult: { workflowId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1" } }) } as Response;
    if (url === "/api/workflows") return { ok: true, json: async () => ({ workflowEngine: list }) } as Response;
    if (url.includes(RELEASE_A)) return { ok: true, json: async () => releaseDetail(RELEASE_A) } as Response;
    if (url.includes(RELEASE_B)) return { ok: true, json: async () => releaseDetail(RELEASE_B) } as Response;
    return { ok: true, json: async () => ({ workflow: { id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", status: "QUEUED", created_at: "2026-09-20T10:00:00.000Z", current_run_id: "x" }, runs: [], steps: [], approvals: [] }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const posts = (fetchMock: ReturnType<typeof serve>) => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

async function enterSnapshotForReleaseA() {
  await screen.findByRole("region", { name: /selected approved release/i });
  await waitFor(() => expect(screen.getByRole("region", { name: /selected approved release/i })).toHaveTextContent(titleOf(RELEASE_A)));
  fireEvent.change(screen.getByLabelText(/video duration/i), { target: { value: "600" } });
  fireEvent.change(screen.getByLabelText(/observation window start/i), { target: { value: "2026-09-12T10:00" } });
  fireEvent.change(screen.getByLabelText(/observation window end/i), { target: { value: "2026-09-26T10:00" } });
  fireEvent.change(screen.getByLabelText(/how you obtained these numbers/i), { target: { value: "Studio export for release A on day 14." } });
  fireEvent.change(screen.getByLabelText(/^views/i), { target: { value: "48210" } });
}

const switchRelease = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: /use a different approved release/i }), { target: { value: id } });

beforeEach(() => { vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-1111-4111-8111-111111111111" }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("VideoPerformanceWorkspace snapshot identity", () => {
  it("submits a snapshot only for the exact release it was entered for", async () => {
    const fetchMock = serve();
    render(<VideoPerformanceWorkspace />);
    await enterSnapshotForReleaseA();
    fireEvent.click(screen.getByRole("button", { name: /start video performance measurement/i }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const input = JSON.parse((posts(fetchMock)[0][1] as RequestInit).body as string).input;
    expect(input).toMatchObject({ videoReleaseWorkflowId: RELEASE_A, videoReleaseRunId: RUN_A });
    expect(input.performanceSnapshot.metrics.views).toBe(48210);
  });

  it("never lets metrics entered for Release A be submitted as evidence for Release B", async () => {
    const fetchMock = serve();
    render(<VideoPerformanceWorkspace />);
    await enterSnapshotForReleaseA();

    switchRelease(RELEASE_B);
    await waitFor(() => expect(screen.getByRole("region", { name: /selected approved release/i })).toHaveTextContent(titleOf(RELEASE_B)));
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent(`This snapshot was entered for “${titleOf(RELEASE_A)}”`);
    expect(screen.getByRole("button", { name: /start video performance measurement/i })).toBeDisabled();
    // The numbers are kept (not silently discarded) but locked until the operator decides.
    expect(screen.getByLabelText(/^views/i)).toHaveValue(48210);
    expect(screen.getByLabelText(/^views/i)).toBeDisabled();

    // Even a forced submission sends nothing.
    fireEvent.submit(screen.getByRole("button", { name: /start video performance measurement/i }).closest("form")!);
    expect(posts(fetchMock)).toHaveLength(0);
    expect(await screen.findByText(/nothing was started: this snapshot was entered for a different release/i)).toBeInTheDocument();

    // Only an explicit re-binding lets the numbers count for B.
    fireEvent.click(screen.getByRole("button", { name: `Use these numbers for “${titleOf(RELEASE_B)}”` }));
    expect(screen.queryByText(/this snapshot was entered for “/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing was started/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start video performance measurement/i }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(JSON.parse((posts(fetchMock)[0][1] as RequestInit).body as string).input).toMatchObject({ videoReleaseWorkflowId: RELEASE_B, videoReleaseRunId: RUN_B });
  });

  it("lets the operator switch back to the release the snapshot belongs to, or clear it", async () => {
    const fetchMock = serve();
    render(<VideoPerformanceWorkspace />);
    await enterSnapshotForReleaseA();

    switchRelease(RELEASE_B);
    fireEvent.click(await screen.findByRole("button", { name: `Switch back to “${titleOf(RELEASE_A)}”` }));
    await waitFor(() => expect(screen.getByRole("region", { name: /selected approved release/i })).toHaveTextContent(titleOf(RELEASE_A)));
    expect(screen.getByLabelText(/^views/i)).toBeEnabled();
    expect(screen.getByLabelText(/^views/i)).toHaveValue(48210);

    switchRelease(RELEASE_B);
    fireEvent.click(await screen.findByRole("button", { name: /clear the snapshot/i }));
    await waitFor(() => expect(screen.getByLabelText(/^views/i)).toBeEnabled());
    expect(screen.getByLabelText(/^views/i)).toHaveValue(null);
    expect(screen.getByLabelText(/how you obtained these numbers/i)).toHaveValue("");
    expect(screen.getByRole("button", { name: /start video performance measurement/i })).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("does not accept snapshot input until the release it describes has been resolved", async () => {
    let releaseA: (response: Response) => void = () => undefined;
    const fetchMock = serve();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/workflows") return { ok: true, json: async () => ({ workflowEngine: list }) } as Response;
      return new Promise<Response>((resolve) => { releaseA = resolve; });
    });
    render(<VideoPerformanceWorkspace />);
    await screen.findByText(/loading the approved release/i);
    expect(screen.getByLabelText(/^views/i)).toBeDisabled();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes(RELEASE_A))).toBe(true));
    releaseA({ ok: true, json: async () => releaseDetail(RELEASE_A) } as Response);
    await waitFor(() => expect(screen.getByLabelText(/^views/i)).toBeEnabled());
  });
});
