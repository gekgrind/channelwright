import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: vi.fn(async () => ({ auth })) }));
const observability = vi.hoisted(() => ({ logEvent: vi.fn(), logFailure: vi.fn() }));
vi.mock("@/server/observability", () => observability);

import { POST } from "./route";
import { MOCK_SESSION_COOKIE, verifyMockSession } from "@/server/mock-session";

const publicOrigin = "https://channelwright.entrepreneuria.io";

function loginRequest(origin: string, fields: Record<string, string> = {}) {
  return new Request(`${origin}/api/auth/login?next=https://evil.example/`, {
    method: "POST",
    headers: {
      origin: publicOrigin,
      host: "evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "http",
    },
    body: new URLSearchParams(fields),
  });
}

const credentials = { email: "operator@example.com", password: "test-password", captchaToken: "completed-test-captcha" };

function expectSameOriginRedirect(response: Response, path: string) {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(path);
  expect(new URL(response.headers.get("location")!, `${publicOrigin}/api/auth/login`).origin).toBe(publicOrigin);
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  // Production must still require provider auth even if fixture mode was requested.
  vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
  auth.signInWithPassword.mockResolvedValue({ error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe.each([publicOrigin, "https://localhost:3005", "http://localhost:3005"])("login redirects with request origin %s", (origin) => {
  it("keeps missing-CAPTCHA errors on the browser origin without calling the provider", async () => {
    const response = await POST(loginRequest(origin));
    expectSameOriginRedirect(response, "/login?error=captcha_required");
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("keeps invalid-input errors on the browser origin", async () => {
    const response = await POST(loginRequest(origin, { ...credentials, email: "invalid" }));
    expectSameOriginRedirect(response, "/login?error=invalid");
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("keeps successful logins on the browser origin and ignores untrusted redirect inputs", async () => {
    const response = await POST(loginRequest(origin, { ...credentials, returnTo: "//evil.example/" }));
    expectSameOriginRedirect(response, "/studio");
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: credentials.email, password: credentials.password, options: { captchaToken: credentials.captchaToken },
    });
    // Session persistence is covered with the real SSR client and Next route
    // finalization in route-session.test.ts, rather than this auth-only mock.
  });

  it.each([
    ["captcha verification failed", "captcha_failed"],
    ["Invalid login credentials", "auth"],
    ["Network unavailable", "unavailable"],
  ])("keeps provider rejection %s on the browser origin", async (message, code) => {
    auth.signInWithPassword.mockResolvedValue({ error: { message } });
    expectSameOriginRedirect(await POST(loginRequest(origin, credentials)), `/login?error=${code}`);
  });

  it("keeps provider exceptions on the browser origin", async () => {
    auth.signInWithPassword.mockRejectedValue(new Error("provider unavailable"));
    expectSameOriginRedirect(await POST(loginRequest(origin, credentials)), "/login?error=unavailable");
  });
});

describe("login diagnostics", () => {
  const secrets = [credentials.email, credentials.password, credentials.captchaToken];
  const logged = () => JSON.stringify([...observability.logEvent.mock.calls, ...observability.logFailure.mock.calls]);

  it("logs a provider rejection by code, status and classification only", async () => {
    // GoTrue's actual rejection of a wrong password; the message is free text and must not reach the log.
    auth.signInWithPassword.mockResolvedValue({ error: { name: "AuthApiError", code: "invalid_credentials", status: 400, message: `Invalid login credentials for ${credentials.email}` } });
    expectSameOriginRedirect(await POST(loginRequest(publicOrigin, credentials)), "/login?error=auth");
    expect(observability.logEvent).toHaveBeenCalledExactlyOnceWith("password_login_rejected", { classification: "auth", providerCode: "invalid_credentials", providerStatus: 400 });
    for (const secret of secrets) expect(logged()).not.toContain(secret);
    expect(logged()).not.toContain("Invalid login credentials");
  });

  it("logs a rejected CAPTCHA without the token", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { code: "captcha_failed", status: 400, message: "captcha protection: request disallowed" } });
    expectSameOriginRedirect(await POST(loginRequest(publicOrigin, credentials)), "/login?error=captcha_failed");
    expect(observability.logEvent).toHaveBeenCalledExactlyOnceWith("password_login_rejected", { classification: "captcha_failed", providerCode: "captcha_failed", providerStatus: 400 });
    for (const secret of secrets) expect(logged()).not.toContain(secret);
  });

  it("logs a provider exception by class name only", async () => {
    auth.signInWithPassword.mockRejectedValue(Object.assign(new TypeError(`fetch failed: ${credentials.password}`), { status: 0 }));
    expectSameOriginRedirect(await POST(loginRequest(publicOrigin, credentials)), "/login?error=unavailable");
    expect(observability.logFailure).toHaveBeenCalledExactlyOnceWith("password_login_provider_unavailable", { message: "TypeError" }, { providerStatus: undefined });
    for (const secret of secrets) expect(logged()).not.toContain(secret);
  });

  it("logs nothing for a successful sign-in or a request rejected before the provider", async () => {
    await POST(loginRequest(publicOrigin, credentials));
    await POST(loginRequest(publicOrigin));
    expect(observability.logEvent).not.toHaveBeenCalled();
    expect(observability.logFailure).not.toHaveBeenCalled();
  });
});

it("retains the signed fixture cookie on the relative development redirect", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const response = await POST(loginRequest("http://localhost:3005", { email: credentials.email, password: credentials.password }));
  expectSameOriginRedirect(response, "/studio");
  expect(verifyMockSession(response.cookies.get(MOCK_SESSION_COOKIE)?.value)?.email).toBe(credentials.email);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  expect(auth.signInWithPassword).not.toHaveBeenCalled();
});
