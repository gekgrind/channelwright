import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth", () => auth);
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }) }));

import CommandCenterPreviewPage from "./studio/preview/page";
import { notFound } from "next/navigation";
import { CommandCenter } from "@/features/command-center/command-center";
import { FixtureRecord } from "@/features/command-center/fixture-record";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const page = (scenario?: string, item?: string | string[]) => CommandCenterPreviewPage({ searchParams: Promise.resolve({ scenario, item }) });
const fixtureMode = () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
  auth.requireUser.mockResolvedValue({ id: "fixture", email: "operator@example.com", mode: "mock" });
};

describe("Command Center fixture preview access", () => {
  it("does not exist in production, even when fixture mode is requested", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    await expect(page()).rejects.toThrow("NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
    expect(auth.requireUser).not.toHaveBeenCalled();
  });

  it("requires a signed-in user in fixture mode", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    auth.requireUser.mockRejectedValue(new Error("LOGIN_REQUIRED"));
    await expect(page()).rejects.toThrow("LOGIN_REQUIRED");
  });

  it("renders fixture data in fixture mode and falls back to the operating scenario for unknown keys", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    auth.requireUser.mockResolvedValue({ id: "fixture", email: "operator@example.com", mode: "mock" });
    const element = await page("constructor");
    expect(element.props.channelLabel).toBe("Budget mechanical keyboards");
    expect(element.props.children.props.view.scenario).toBe("operating");
  });

  it("keeps the production and sign-in guards ahead of fixture records", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    await expect(page("operating", "gate:ap-pack-lube")).rejects.toThrow("NOT_FOUND");
    expect(auth.requireUser).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "test");
    auth.requireUser.mockRejectedValue(new Error("LOGIN_REQUIRED"));
    await expect(page("operating", "gate:ap-pack-lube")).rejects.toThrow("LOGIN_REQUIRED");
  });

  it("points Command Center actions at fixture records, and opens the record for ?item=", async () => {
    fixtureMode();
    const board = await page("operating");
    expect(board.props.children.type).toBe(CommandCenter);
    expect(board.props.children.props.targets.item("gate:ap-pack-lube", "/studio#stage-packaging")).toBe("/studio/preview?scenario=operating&item=gate%3Aap-pack-lube");
    const record = await page("degraded", "task:fail-brief-returned");
    expect(record.props.children.type).toBe(FixtureRecord);
    expect(record.props.children.props).toMatchObject({ itemId: "task:fail-brief-returned", scenarioLabel: "Degraded" });
    expect(record.props.children.props.view.scenario).toBe("degraded");
  });

  it("ignores a repeated item parameter rather than guessing which one was meant", async () => {
    fixtureMode();
    const element = await page("operating", ["gate:ap-pack-lube", "gate:ap-script-cheap"]);
    expect(element.props.children.type).toBe(CommandCenter);
  });
});
