import { beforeEach, describe, expect, it, vi } from "vitest";
import { evidenceBundleFixture } from "./research-fixtures.test-helper";
import { SupabaseResearchCache } from "./research-cache";

const { createSupabaseAdminClient } = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/server/supabase-admin", () => ({ createSupabaseAdminClient }));

const ownerId = "0f802c92-fc5b-413f-bfbd-0a8b852cde44";
const cacheKey = "a".repeat(64);
const now = new Date("2026-08-13T13:00:00.000Z");

const cachedRow = {
  evidence_payload: [{ ...evidenceBundleFixture.evidence[0], origin: "LIVE" }],
  usage_payload: {
    normalizedQueries: evidenceBundleFixture.normalizedQueries,
    completionStatus: evidenceBundleFixture.completionStatus,
    limitations: evidenceBundleFixture.limitations,
    usage: evidenceBundleFixture.usage,
  },
  retrieved_at: evidenceBundleFixture.usage.retrievedAt,
  expires_at: evidenceBundleFixture.usage.expiresAt,
};

const selectClient = (result: { data: typeof cachedRow | null; error: { code: string } | null }) => {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return builder; }),
    gt: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return builder; }),
    maybeSingle: vi.fn(async () => result),
  };
  const from = vi.fn(() => builder);
  createSupabaseAdminClient.mockReturnValue({ from });
  return { from, builder, filters };
};

const writeClient = (upsertError: { code: string } | null = null, purgeError: { code: string } | null = null) => {
  const upsert = vi.fn(async () => ({ error: upsertError }));
  const from = vi.fn(() => ({ upsert }));
  const rpc = vi.fn(async () => ({ error: purgeError }));
  createSupabaseAdminClient.mockReturnValue({ from, rpc });
  return { from, upsert, rpc };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Supabase research evidence cache", () => {
  it("returns unexpired owner-scoped evidence marked as a cache hit with zero provider cost", async () => {
    const { from, filters } = selectClient({ data: cachedRow, error: null });

    const bundle = await new SupabaseResearchCache().get(ownerId, cacheKey, now);

    expect(from).toHaveBeenCalledWith("research_evidence_cache");
    expect(filters).toEqual([["owner_id", ownerId], ["cache_key", cacheKey], ["expires_at", now.toISOString()]]);
    expect(bundle?.usage).toMatchObject({ cacheStatus: "HIT", providerRequests: 0, quotaUnits: 0 });
    expect(bundle?.evidence.map((item) => item.origin)).toEqual(["CACHE"]);
    expect(bundle?.normalizedQueries).toEqual(evidenceBundleFixture.normalizedQueries);
  });

  it("treats a miss as absent evidence rather than an error", async () => {
    selectClient({ data: null, error: null });
    await expect(new SupabaseResearchCache().get(ownerId, cacheKey, now)).resolves.toBeNull();
  });

  it("fails closed with a stable code when the cache read fails", async () => {
    selectClient({ data: null, error: { code: "42501" } });
    await expect(new SupabaseResearchCache().get(ownerId, cacheKey, now)).rejects.toThrow("RESEARCH_CACHE_READ_FAILED");
  });

  it("rejects cached rows that no longer satisfy the evidence contract", async () => {
    const withoutProvider = { ...cachedRow.evidence_payload[0] };
    delete (withoutProvider as { provider?: unknown }).provider;
    selectClient({ data: { ...cachedRow, evidence_payload: [withoutProvider] } as never, error: null });
    await expect(new SupabaseResearchCache().get(ownerId, cacheKey, now)).rejects.toThrow();
  });

  it("purges expired rows and upserts on the owner and cache key", async () => {
    const { from, upsert, rpc } = writeClient();

    await new SupabaseResearchCache().put(ownerId, cacheKey, "hidden business systems", { maxResults: 10 }, evidenceBundleFixture);

    expect(rpc).toHaveBeenCalledWith("purge_expired_research_cache", { p_limit: 100 });
    expect(from).toHaveBeenCalledWith("research_evidence_cache");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: ownerId, cache_key: cacheKey, provider: "YOUTUBE_DATA_API_V3", normalized_query: "hidden business systems",
      request_parameters: { maxResults: 10 }, evidence_payload: evidenceBundleFixture.evidence,
      retrieved_at: evidenceBundleFixture.usage.retrievedAt, expires_at: evidenceBundleFixture.usage.expiresAt,
    }), { onConflict: "owner_id,cache_key" });
  });

  it("still writes when the opportunistic purge fails", async () => {
    const { upsert } = writeClient(null, { code: "40001" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(new SupabaseResearchCache().put(ownerId, cacheKey, "hidden business systems", {}, evidenceBundleFixture)).resolves.toBeUndefined();

    expect(upsert).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("research_cache_purge_failed", { code: "40001" });
    warn.mockRestore();
  });

  it("fails closed with a stable code when the cache write fails", async () => {
    writeClient({ code: "23505" });
    await expect(new SupabaseResearchCache().put(ownerId, cacheKey, "hidden business systems", {}, evidenceBundleFixture)).rejects.toThrow("RESEARCH_CACHE_WRITE_FAILED");
  });
});
