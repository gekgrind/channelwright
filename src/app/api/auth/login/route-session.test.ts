// Next must initialize AsyncLocalStorage before importing its route machinery.
import "next/dist/server/node-environment-baseline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppRouteRouteModule } from "next/dist/server/route-modules/app-route/module";
import type { RouteKind } from "next/dist/server/route-kind";
import { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { POST } from "./route";
import { createSupabaseServerClient } from "@/server/supabase";

const publicOrigin = "https://channelwright.entrepreneuria.io";
const providerOrigin = "https://login-regression.supabase.co";
const storageKey = "sb-login-regression-auth-token";
const user = { id: "e9eea7c9-b327-43e5-8364-8dd5231fe522", email: "operator@example.com", app_metadata: {}, user_metadata: {} };
const credentials = { email: user.email, password: "fixture-password", captchaToken: "fixture-completed-captcha" };

function session(padding = "") {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp, role: "authenticated" })}.fixture-signature`,
    refresh_token: "fixture-refresh-token",
    token_type: "bearer", expires_in: 3600, expires_at: exp,
    user: { ...user, user_metadata: { padding } },
  };
}

// Exercise the installed Next route runner: it creates request-scoped cookies()
// and merges its mutable cookies into the final Response after POST returns.
// Neither the Supabase SSR factory, cookie adapter, nor Next headers are mocked.
function routeModule(methods: { POST?: typeof POST; GET?: () => Promise<Response> }) {
  return new AppRouteRouteModule({
    definition: { kind: "APP_ROUTE" as RouteKind.APP_ROUTE, page: "/api/auth/login/route", pathname: "/api/auth/login", filename: "route", bundlePath: "app/api/auth/login/route" },
    userland: () => ({ ...methods, generateStaticParams: undefined }),
    distDir: ".next", relativeProjectDir: ".", resolvedPagePath: "src/app/api/auth/login/route.ts", nextConfigOutput: undefined,
  });
}

function handle(module: AppRouteRouteModule, request: NextRequest) {
  return module.handle(request, {
    params: undefined,
    sharedContext: { buildId: "login-session-test", deploymentId: "login-session-test" },
    previewProps: { previewModeId: "test", previewModeEncryptionKey: "test", previewModeSigningKey: "test" },
    renderOpts: {
      supportsDynamicResponse: true, isDraftMode: false, isBuildTimePrerendering: false, isDebugDynamicAccesses: false,
      cacheComponents: false, validationLevel: "warning", cacheLifeProfiles: { default: { stale: 300, revalidate: 900, expire: 4294967294 } }, staticPageGenerationTimeout: 60,
      experimental: { isRoutePPREnabled: false, authInterrupts: false, useCacheTimeout: 5000 },
      onInstrumentationRequestError: vi.fn(), onClose: () => {}, waitUntil: undefined, onAfterTaskError: undefined,
    },
  });
}

function loginRequest(requestOrigin = "https://localhost:3005", cookie = "") {
  return new NextRequest(`${requestOrigin}/api/auth/login?next=https://evil.example/`, {
    method: "POST", headers: { origin: publicOrigin, cookie, "x-forwarded-host": "evil.example" },
    body: new URLSearchParams({ ...credentials, returnTo: "//evil.example/" }),
  });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", providerOrigin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-anon-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each([publicOrigin, "https://localhost:3005", "http://localhost:3005"])("login session cookies with request origin %s", (requestOrigin) => {
  it.each([{ label: "single", padding: "" }, { label: "chunked", padding: "x".repeat(5000) }])("propagates a $label session and verifies the next request", async ({ padding }) => {
    const issued = session(padding);
    const providerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${providerOrigin}/auth/v1/token?grant_type=password`);
      expect(JSON.parse(String(init?.body))).toMatchObject({ email: user.email, password: credentials.password, gotrue_meta_security: { captcha_token: credentials.captchaToken } });
      return Response.json(issued);
    });
    vi.stubGlobal("fetch", providerFetch);
    const response = await handle(routeModule({ POST }), loginRequest(requestOrigin));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/studio");
    expect(new URL(response.headers.get("location")!, publicOrigin).origin).toBe(publicOrigin);
    const cookies = new ResponseCookies(response.headers).getAll();
    if (padding) expect(cookies.length).toBeGreaterThan(1);
    else expect(cookies).toHaveLength(1);
    expect(cookies.every(cookie => cookie.name.startsWith(storageKey))).toBe(true);
    const encoded = cookies.map(cookie => cookie.value).join("");
    expect(encoded).toMatch(/^base64-/);
    expect(JSON.parse(Buffer.from(encoded.slice(7), "base64url").toString())).toMatchObject({ access_token: issued.access_token, refresh_token: issued.refresh_token, user: { id: user.id } });
    expect(response.headers.getSetCookie()).toHaveLength(cookies.length);
    for (const header of response.headers.getSetCookie()) {
      expect(header).toContain("Path=/");
      expect(header).toContain("SameSite=lax");
      expect(header).not.toContain("Domain=");
    }
    expect(providerFetch).toHaveBeenCalledOnce();

    // The next request must be able to read the same session through the actual
    // application factory and verify its identity with the provider.
    providerFetch.mockImplementation(async (input, init) => {
      expect(String(input)).toBe(`${providerOrigin}/auth/v1/user`);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${issued.access_token}`);
      return Response.json(user);
    });
    const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
    const verified = await handle(routeModule({ GET: async () => {
      const client = await createSupabaseServerClient();
      const { data, error } = await client.auth.getUser();
      return Response.json({ userId: data.user?.id, error: error?.message });
    } }), new NextRequest(`${publicOrigin}/api/auth/login`, { headers: { cookie: cookieHeader } }));
    expect(await verified.json()).toEqual({ userId: user.id });
  });

  it("propagates stale chunk removal without overwriting ecosystem cookies", async () => {
    const providerFetch = vi.fn(async () => Response.json(session()));
    vi.stubGlobal("fetch", providerFetch);
    const response = await handle(routeModule({ POST }), loginRequest(requestOrigin, `${storageKey}.9=stale-chunk; entrepreneuria-auth-token=untouched-ecosystem-cookie`));
    expect(response.headers.get("location")).toBe("/studio");
    const cookies = new ResponseCookies(response.headers);
    const removal = response.headers.getSetCookie().find(header => header.startsWith(`${storageKey}.9=`));
    expect(removal).toMatch(new RegExp(`^${storageKey}\\.9=;`));
    expect(removal).toContain("Max-Age=0");
    expect(cookies.get(storageKey)?.value).toMatch(/^base64-/);
    expect(cookies.get("entrepreneuria-auth-token")).toBeUndefined();
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("does not issue session cookies when the provider rejects credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "invalid_credentials", msg: "Invalid login credentials" }, { status: 400 })));
    const response = await handle(routeModule({ POST }), loginRequest(requestOrigin));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=auth");
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
