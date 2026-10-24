import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), signInWithPassword: vi.fn() }));
vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: vi.fn(async () => ({ auth })) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("LOGIN_REQUIRED"); }) }));
vi.mock("@/features/studio/studio-app", () => ({ default: vi.fn() }));

import StudioPage from "./studio/page";
import { POST } from "./api/auth/login/route";
import { isMockMode } from "@/server/config";
import { redirect } from "next/navigation";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
  auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  auth.signInWithPassword.mockResolvedValue({ error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("production Studio access", () => {
  it("requires a provider-verified user even when fixture mode is requested", async () => {
    expect(isMockMode()).toBe(false);
    await expect(StudioPage()).rejects.toThrow("LOGIN_REQUIRED");
    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("passes the verified identity into the production application", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "owner", email: "operator@example.com" } }, error: null });
    const page = await StudioPage();
    expect(page.props.user).toEqual({ email: "operator@example.com", mode: "supabase" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(["https://evil.example/", "//evil.example/", "/\\evil.example/"])("ignores untrusted return URLs: %s", async (target) => {
    const body = new FormData();
    body.set("email", "operator@example.com");
    body.set("password", "test-password");
    body.set("captchaToken", "test-captcha");
    body.set("returnTo", target);
    const response = await POST(new Request(`https://channelwright.entrepreneuria.io/api/auth/login?next=${encodeURIComponent(target)}`, { method: "POST", body }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/studio");
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "operator@example.com", password: "test-password", options: { captchaToken: "test-captcha" } });
  });

  it("rejects login without CAPTCHA before calling the provider", async () => {
    const body = new FormData();
    body.set("email", "operator@example.com");
    body.set("password", "test-password");
    const response = await POST(new Request("https://channelwright.entrepreneuria.io/api/auth/login", { method: "POST", body }));
    expect(response.headers.get("location")).toBe("/login?error=captcha_required");
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});
