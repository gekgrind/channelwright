import { afterEach, describe, expect, it, vi } from "vitest";
import { readSharedSupabaseConfig } from "./config";

const names = [
  "CHANNELWRIGHT_SHARED_SUPABASE_URL",
  "CHANNELWRIGHT_SHARED_SUPABASE_ANON_KEY",
  "CHANNELWRIGHT_SHARED_SUPABASE_SERVICE_ROLE_KEY",
  "CHANNELWRIGHT_SHARED_DATABASE_URL",
  "CHANNELWRIGHT_SHARED_PROJECT_REF",
  "CHANNELWRIGHT_SHARED_CONFIRM_PROJECT_REF",
  "CHANNELWRIGHT_SHARED_CONFIRM_SCHEMA",
  "CHANNELWRIGHT_SHARED_DATABASE_CA_PATH",
] as const;

afterEach(() => vi.unstubAllEnvs());

function stubValid() {
  const ref = "abcdefghijklmnopqrst";
  vi.stubEnv("CHANNELWRIGHT_SHARED_SUPABASE_URL", `https://${ref}.supabase.co`);
  vi.stubEnv("CHANNELWRIGHT_SHARED_SUPABASE_ANON_KEY", "anon-test-value");
  vi.stubEnv("CHANNELWRIGHT_SHARED_SUPABASE_SERVICE_ROLE_KEY", "service-test-value");
  vi.stubEnv("CHANNELWRIGHT_SHARED_DATABASE_URL", `postgresql://postgres.${ref}:password@pooler.supabase.com:5432/postgres`);
  vi.stubEnv("CHANNELWRIGHT_SHARED_PROJECT_REF", ref);
  vi.stubEnv("CHANNELWRIGHT_SHARED_CONFIRM_PROJECT_REF", ref);
  vi.stubEnv("CHANNELWRIGHT_SHARED_CONFIRM_SCHEMA", "channelwright");
  vi.stubEnv("CHANNELWRIGHT_SHARED_DATABASE_CA_PATH", "C:/trusted/supabase-ca.crt");
}

describe("shared-project Supabase gate configuration", () => {
  it("fails closed when required values are absent", () => {
    for (const name of names) vi.stubEnv(name, "");
    expect(() => readSharedSupabaseConfig()).toThrow(/Missing required shared-project gate variable/);
  });

  it("requires independent project confirmation and bound API/database identities", () => {
    stubValid();
    vi.stubEnv("CHANNELWRIGHT_SHARED_CONFIRM_PROJECT_REF", "zyxwvutsrqponmlkjihg");
    expect(() => readSharedSupabaseConfig()).toThrow(/confirmation/);
    stubValid();
    vi.stubEnv("CHANNELWRIGHT_SHARED_DATABASE_URL", "postgresql://postgres:password@unrelated.example.com:5432/postgres");
    expect(() => readSharedSupabaseConfig()).toThrow(/not visibly bound/);
    stubValid();
    vi.stubEnv("CHANNELWRIGHT_SHARED_CONFIRM_SCHEMA", "public");
    expect(() => readSharedSupabaseConfig()).toThrow(/schema confirmation/);
  });

  it("accepts a consistently identified shared target and isolated schema", () => {
    stubValid();
    expect(readSharedSupabaseConfig()).toMatchObject({ projectRef: "abcdefghijklmnopqrst", schema: "channelwright" });
  });
});
