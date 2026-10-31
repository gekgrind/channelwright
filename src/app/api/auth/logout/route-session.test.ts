// Next must initialize AsyncLocalStorage before importing its route machinery.
import "next/dist/server/node-environment-baseline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppRouteRouteModule } from "next/dist/server/route-modules/app-route/module";
import type { RouteKind } from "next/dist/server/route-kind";
import { POST } from "./route";

const publicOrigin = "https://channelwright.entrepreneuria.io";
const providerOrigin = "https://logout-regression.supabase.co";
const storageKey = "sb-logout-regression-auth-token";
const userId = "e9eea7c9-b327-43e5-8364-8dd5231fe522";

function sessionCookies(padding = "") {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, exp, role: "authenticated" })}.fixture-signature`,
    refresh_token: "fixture-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: exp,
    user: { id: userId, email: "operator@example.com", app_metadata: {}, user_metadata: { padding } },
  };
  const value = `base64-${encode(session)}`;
  if (!padding) return [`${storageKey}=${value}`];
  const half = Math.ceil(value.length / 2);
  return [`${storageKey}.0=${value.slice(0, half)}`, `${storageKey}.1=${value.slice(half)}`];
}

// The installed Next route runner merges cookies() mutations into the Response POST returns; the Supabase SSR
// factory, cookie adapter and Next headers are real.
function handle(request: NextRequest) {
  const routeModule = new AppRouteRouteModule({
    definition: { kind: "APP_ROUTE" as RouteKind.APP_ROUTE, page: "/api/auth/logout/route", pathname: "/api/auth/logout", filename: "route", bundlePath: "app/api/auth/logout/route" },
    userland: () => ({ POST, generateStaticParams: undefined }),
    distDir: ".next", relativeProjectDir: ".", resolvedPagePath: "src/app/api/auth/logout/route.ts", nextConfigOutput: undefined,
  });
  return routeModule.handle(request, {
    params: undefined,
    sharedContext: { buildId: "logout-session-test", deploymentId: "logout-session-test" },
    previewProps: { previewModeId: "test", previewModeEncryptionKey: "test", previewModeSigningKey: "test" },
    renderOpts: {
      supportsDynamicResponse: true, isDraftMode: false, isBuildTimePrerendering: false, isDebugDynamicAccesses: false,
      cacheComponents: false, validationLevel: "warning", cacheLifeProfiles: { default: { stale: 300, revalidate: 900, expire: 4294967294 } }, staticPageGenerationTimeout: 60,
      experimental: { isRoutePPREnabled: false, authInterrupts: false, useCacheTimeout: 5000 },
      onInstrumentationRequestError: vi.fn(), onClose: () => {}, waitUntil: undefined, onAfterTaskError: undefined,
    },
  });
}

const logoutRequest = (requestOrigin: string, cookies: string[]) => new NextRequest(`${requestOrigin}/api/auth/logout`, {
  method: "POST",
  headers: { origin: publicOrigin, host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http", cookie: [...cookies, "entrepreneuria-auth-token=untouched-ecosystem-cookie"].join("; ") },
});

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", providerOrigin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-anon-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Production served this route on https://localhost:3005 behind nginx and answered `Location: https://localhost:3005/login`.
describe.each([publicOrigin, "https://localhost:3005", "http://localhost:3005"])("logout with request origin %s", (requestOrigin) => {
  it.each([{ label: "single", padding: "" }, { label: "chunked", padding: "x".repeat(5000) }])("revokes a $label session, clears its cookies and stays on the public origin", async ({ padding }) => {
    const cookies = sessionCookies(padding);
    const providerFetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`${providerOrigin}/auth/v1/logout?scope=global`);
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", providerFetch);
    const response = await handle(logoutRequest(requestOrigin, cookies));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect(new URL(response.headers.get("location")!, publicOrigin).origin).toBe(publicOrigin);
    expect(providerFetch).toHaveBeenCalledOnce();
    const setCookies = response.headers.getSetCookie();
    for (const cookie of cookies) {
      const name = cookie.slice(0, cookie.indexOf("="));
      const removal = setCookies.find(header => header.startsWith(`${name}=`));
      expect(removal).toMatch(new RegExp(`^${name.replace(/\./g, "\\.")}=;`));
      expect(removal).toContain("Max-Age=0");
    }
    expect(setCookies.some(header => header.startsWith("entrepreneuria-auth-token="))).toBe(false);
  });
});

describe("logout provider failures", () => {
  const logs = () => vi.spyOn(console, "log").mockImplementation(() => undefined);

  it("clears local cookies and logs the status when the provider fails to revoke the session", async () => {
    const consoleLog = logs();
    const cookies = sessionCookies();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "unexpected_failure", msg: "upstream detail" }, { status: 500 })));
    const response = await handle(logoutRequest(publicOrigin, cookies));
    expect(response.headers.get("location")).toBe("/login");
    // auth-js removes the local session before returning a logout-request error: the browser is signed out even
    // though server-side revocation is unconfirmed, which is why the event is logged.
    expect(response.headers.getSetCookie().find(header => header.startsWith(`${storageKey}=`))).toContain("Max-Age=0");
    const [record] = consoleLog.mock.calls.at(-1) as [string];
    // auth-js surfaces a 5xx as AuthRetryableFetchError, which carries the status but no provider code.
    expect(JSON.parse(record)).toEqual({ at: expect.any(String), event: "logout_provider_rejected", classification: "auth", providerStatus: 500 });
    expect(record).not.toContain("upstream detail");
    expect(record).not.toContain("fixture-refresh-token");
  });

  it("keeps an expired session whose refresh is unavailable, logs it, and still leaves for the public login page", async () => {
    const consoleLog = logs();
    const expired = sessionCookies().map(cookie => {
      const [name, value] = [cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1)];
      const session = JSON.parse(Buffer.from(value.slice(7), "base64url").toString());
      return `${name}=base64-${Buffer.from(JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 })).toString("base64url")}`;
    });
    const providerFetch = vi.fn<typeof fetch>(async () => Response.json({ code: "unexpected_failure", msg: "upstream detail" }, { status: 503 }));
    vi.stubGlobal("fetch", providerFetch);
    // auth-js retries a retryable refresh with backoff for up to 30 seconds; advance through it.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let settled = false;
    const pending = handle(logoutRequest("https://localhost:3005", expired)).finally(() => { settled = true; });
    for (let step = 0; step < 100 && !settled; step++) await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    const response = await pending;
    expect(response.headers.get("location")).toBe("/login");
    expect(String(providerFetch.mock.calls[0]?.[0])).toContain("/auth/v1/token?grant_type=refresh_token");
    // A retryable refresh failure loads no session, so auth-js returns the error before any revocation and
    // leaves the cookies; the user can sign out again once the provider recovers.
    expect(response.headers.getSetCookie().some(header => header.startsWith(`${storageKey}=`) && header.includes("Max-Age=0"))).toBe(false);
    const record = consoleLog.mock.calls.map(([line]) => String(line)).find(line => line.includes("logout_provider_rejected"));
    expect(record).toBeDefined();
    expect(record).not.toContain("upstream detail");
    expect(record).not.toContain("fixture-refresh-token");
  });
});
