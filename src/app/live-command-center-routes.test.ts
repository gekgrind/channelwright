import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LineageBuilder } from "@/server/lineage/lineage-fixtures.test-helper";
import type { LineageRows } from "@/server/lineage/lineage-rows";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
const rows = vi.hoisted(() => ({ loadLineageRows: vi.fn() }));
const outputs = vi.hoisted(() => ({ loadStageOutputs: vi.fn() }));
vi.mock("@/server/auth", () => auth);
vi.mock("@/server/lineage/load-lineage-rows", () => rows);
vi.mock("@/server/lineage/load-stage-outputs", () => outputs);
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }),
}));

import LiveCommandCenterIndex from "./c/page";
import LiveChannelPage from "./c/[channelKey]/page";
import { LiveCommandCenter, LiveUnavailable } from "./c/live-command-center";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const channel = (key: string) => LiveChannelPage({ params: Promise.resolve({ channelKey: key }) });
const ok = (data: LineageRows) => ({ workflows: { status: "ok", rows: data.workflows }, runs: { status: "ok", rows: data.runs }, approvals: { status: "ok", rows: data.approvals } });

function liveEnv() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "false");
  vi.stubEnv("CHANNELWRIGHT_LIVE_COMMAND_CENTER", "on");
  auth.requireUser.mockResolvedValue({ id: OWNER, email: "owner@example.com", mode: "supabase" });
}

const EMPTY_OUTPUTS = { strategy: { status: "ok", data: {} }, content: { status: "ok", data: {} }, performance: { status: "ok", data: {} } };
beforeEach(() => outputs.loadStageOutputs.mockResolvedValue(EMPTY_OUTPUTS));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("live Command Center access (R004 gate order)", () => {
  it("does not exist while the flag is off, and never asks who the user is", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "false");
    await expect(LiveCommandCenterIndex()).rejects.toThrow("NOT_FOUND");
    await expect(channel(OWNER)).rejects.toThrow("NOT_FOUND");
    expect(auth.requireUser).not.toHaveBeenCalled();
    expect(rows.loadLineageRows).not.toHaveBeenCalled();
  });

  it("does not exist in fixture mode, even with the flag on", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    vi.stubEnv("CHANNELWRIGHT_LIVE_COMMAND_CENTER", "on");
    await expect(LiveCommandCenterIndex()).rejects.toThrow("NOT_FOUND");
    expect(auth.requireUser).not.toHaveBeenCalled();
  });

  it("requires sign-in, then a Supabase session, then allowlist membership, before reading any row", async () => {
    liveEnv();
    auth.requireUser.mockRejectedValueOnce(new Error("LOGIN_REQUIRED"));
    await expect(LiveCommandCenterIndex()).rejects.toThrow("LOGIN_REQUIRED");
    auth.requireUser.mockResolvedValueOnce({ id: OWNER, email: "owner@example.com", mode: "mock" });
    await expect(LiveCommandCenterIndex()).rejects.toThrow("NOT_FOUND");
    vi.stubEnv("CHANNELWRIGHT_LIVE_COMMAND_CENTER_USERS", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    await expect(channel(OWNER)).rejects.toThrow("NOT_FOUND");
    vi.stubEnv("CHANNELWRIGHT_LIVE_COMMAND_CENTER_USERS", "");
    await expect(channel(OWNER)).rejects.toThrow("NOT_FOUND");
    expect(rows.loadLineageRows).not.toHaveBeenCalled();
  });
});

describe("live Command Center route segment", () => {
  it("has no loading boundary, so a refused request is a real 404 and not a streamed 200", () => {
    // A loading.tsx makes Next stream before the gate runs; notFound() then renders with status 200.
    for (const file of ["src/app/c/loading.tsx", "src/app/c/[channelKey]/loading.tsx"]) expect(existsSync(file), file).toBe(false);
  });
});

describe("live Command Center routes", () => {
  it("opens the most recently active channel from /c", async () => {
    liveEnv();
    const builder = new LineageBuilder();
    const a = builder.research({ niche: "First" });
    builder.research({ niche: "Second" });
    builder.stage("CHANNEL_STRATEGY", a);
    rows.loadLineageRows.mockResolvedValue(ok(builder.rows()));
    await expect(LiveCommandCenterIndex()).rejects.toThrow(`REDIRECT:/c/${a.workflowId}`);
    expect(rows.loadLineageRows).toHaveBeenCalledWith(OWNER);
  });

  it("renders the no-channel landing when there is no research root", async () => {
    liveEnv();
    const builder = new LineageBuilder();
    builder.pending(builder.conceptValidation());
    rows.loadLineageRows.mockResolvedValue(ok(builder.rows()));
    const element = await LiveCommandCenterIndex();
    expect(element.type).toBe(LiveCommandCenter);
    expect(element.props).toMatchObject({ userId: OWNER, channelKey: null });
  });

  it("renders a channel the user owns, and 404s a malformed key or one that is not this user's", async () => {
    liveEnv();
    const builder = new LineageBuilder();
    const own = builder.research();
    rows.loadLineageRows.mockResolvedValue(ok(builder.rows()));
    const element = await channel(own.workflowId.toUpperCase());
    expect(element.type).toBe(LiveCommandCenter);
    expect(element.props.channelKey).toBe(own.workflowId);
    await expect(channel("not-a-uuid")).rejects.toThrow("NOT_FOUND");
    await expect(channel("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).rejects.toThrow("NOT_FOUND");
  });

  it("shows a page-level error, with a request id, when workflows or runs cannot be read", async () => {
    liveEnv();
    rows.loadLineageRows.mockResolvedValue({ workflows: { status: "ok", rows: [] }, runs: { status: "error", requestId: "req-9" }, approvals: { status: "ok", rows: [] } });
    const element = await LiveCommandCenterIndex();
    expect(element.type).toBe(LiveUnavailable);
    expect(element.props.state).toEqual({ status: "error", requestId: "req-9" });
    rows.loadLineageRows.mockResolvedValue({ workflows: { status: "too_large" }, runs: { status: "ok", rows: [] }, approvals: { status: "ok", rows: [] } });
    expect((await channel(OWNER)).props.state).toEqual({ status: "too_large" });
  });

  it("shows the page-level error when content plans fail, since they title every video and gate (PR21-004)", async () => {
    const builder = new LineageBuilder();
    const own = builder.research();
    const data = builder.rows();
    outputs.loadStageOutputs.mockResolvedValue({ ...EMPTY_OUTPUTS, content: { status: "error", requestId: "req-c" } });
    const live = { status: "ok" as const, rows: data, graph: (await import("@/server/lineage/resolve-lineage")).resolveLineage(data), approvalsError: null };
    const element = await LiveCommandCenter({ userId: OWNER, live, channelKey: own.workflowId });
    expect(element.type).toBe(LiveUnavailable);
    expect(element.props.state).toEqual({ status: "error", requestId: "req-c" });
  });
});
