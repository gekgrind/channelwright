import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSupabaseConfig, isMockMode, workflowWorkerConfig } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fixture-mode boundary", () => {
  it("allows explicit fixture mode outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    expect(isMockMode()).toBe(true);
  });

  it("cannot enable fixture authentication in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    expect(isMockMode()).toBe(false);
  });

  it("defaults to fixture mode in development and yields to an explicit opt-out", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", undefined);
    expect(isMockMode()).toBe(true);
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "false");
    expect(isMockMode()).toBe(false);
  });

  it("does not silently enable fixture mode outside development", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", undefined);
    expect(isMockMode()).toBe(false);
  });
});

describe("Supabase configuration boundary", () => {
  it("returns both public credentials when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    expect(assertSupabaseConfig()).toEqual({ url: "https://project.supabase.co", anonKey: "anon-key" });
  });

  it.each([
    [undefined, "anon-key"],
    ["https://project.supabase.co", undefined],
  ])("fails closed when the URL is %j and the anon key is %j", (url, anonKey) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey);
    expect(() => assertSupabaseConfig()).toThrow(/Supabase is not configured/);
  });
});

describe("workflow worker configuration", () => {
  it("defaults the lease and poll interval and requires an explicit worker identity", () => {
    vi.stubEnv("WORKFLOW_WORKER_ID", undefined);
    vi.stubEnv("WORKFLOW_LEASE_SECONDS", undefined);
    vi.stubEnv("WORKFLOW_POLL_INTERVAL_MS", undefined);
    expect(workflowWorkerConfig()).toEqual({ workerId: "", leaseSeconds: 120, pollIntervalMs: 2_000 });
  });

  it("trims the worker identity and accepts in-range bounds", () => {
    vi.stubEnv("WORKFLOW_WORKER_ID", "  worker-1  ");
    vi.stubEnv("WORKFLOW_LEASE_SECONDS", "900");
    vi.stubEnv("WORKFLOW_POLL_INTERVAL_MS", "100");
    expect(workflowWorkerConfig()).toEqual({ workerId: "worker-1", leaseSeconds: 900, pollIntervalMs: 100 });
  });

  it.each([
    ["WORKFLOW_LEASE_SECONDS", "29"],
    ["WORKFLOW_LEASE_SECONDS", "901"],
    ["WORKFLOW_POLL_INTERVAL_MS", "99"],
    ["WORKFLOW_POLL_INTERVAL_MS", "60001"],
    ["WORKFLOW_LEASE_SECONDS", "120.5"],
  ])("rejects out-of-range %s=%s", (name, value) => {
    vi.stubEnv(name, value);
    expect(() => workflowWorkerConfig()).toThrow(/Expected an integer between/);
  });
});
