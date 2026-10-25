import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth", () => auth);
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }) }));

import CommandCenterPreviewPage from "./studio/preview/page";
import { notFound } from "next/navigation";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const page = (scenario?: string) => CommandCenterPreviewPage({ searchParams: Promise.resolve({ scenario }) });

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
});
