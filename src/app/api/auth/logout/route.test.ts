import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: vi.fn(async () => ({ auth })) }));
const observability = vi.hoisted(() => ({ logEvent: vi.fn(), logFailure: vi.fn() }));
vi.mock("@/server/observability", () => observability);

import { POST } from "./route";
import { MOCK_SESSION_COOKIE } from "@/server/mock-session";

const publicOrigin = "https://channelwright.entrepreneuria.io";

function expectPublicLoginRedirect(response: Response) {
  expect(response.status).toBe(303);
  // Production returned `https://localhost:3005/login` here: Next's bound host leaked through request.url.
  expect(response.headers.get("location")).toBe("/login");
  expect(new URL(response.headers.get("location")!, `${publicOrigin}/api/auth/logout`).origin).toBe(publicOrigin);
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
  auth.signOut.mockResolvedValue({ error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

// The handler reads no request, so Host, Origin and forwarded headers cannot steer the destination; the internal
// and public request origins are exercised through Next's route runner in route-session.test.ts.
it("signs out with the provider and redirects to the public login page", async () => {
  expectPublicLoginRedirect(await POST());
  expect(auth.signOut).toHaveBeenCalledOnce();
  expect(observability.logEvent).not.toHaveBeenCalled();
});

it("logs a provider sign-out rejection by code and status only, and still leaves the page", async () => {
  auth.signOut.mockResolvedValue({ error: { name: "AuthApiError", code: "unexpected_failure", status: 500, message: "upstream detail with token=abc" } });
  expectPublicLoginRedirect(await POST());
  expect(observability.logEvent).toHaveBeenCalledExactlyOnceWith("logout_provider_rejected", { classification: "auth", providerCode: "unexpected_failure", providerStatus: 500 });
  expect(JSON.stringify(observability.logEvent.mock.calls)).not.toContain("token=abc");
});

it("clears the fixture session on a relative redirect in development without calling the provider", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const response = await POST();
  expect(response.headers.get("location")).toBe("/login");
  expect(new URL(response.headers.get("location")!, "http://localhost:3005/api/auth/logout").origin).toBe("http://localhost:3005");
  expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^${MOCK_SESSION_COOKIE}=;`));
  expect(auth.signOut).not.toHaveBeenCalled();
});
