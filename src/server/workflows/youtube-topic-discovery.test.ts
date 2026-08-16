import { describe, expect, it, vi } from "vitest";
import { channelContentIntelligenceConfig } from "./content-config";
import { discoverySearchEvidenceId, sanitizeDiscoveryQuery, YouTubeTopicDiscoveryProvider, type TopicDiscoveryCache } from "./youtube-topic-discovery";
import { discoveryBundleFixture } from "./content-fixtures.test-helper";

const budget = { ...channelContentIntelligenceConfig(), maxSearchQueries: 3, maxProviderRequests: 8, maxVideos: 6, maxChannels: 4 };
const now = () => new Date("2026-08-15T12:30:00.000Z");
const emptyCache = (): TopicDiscoveryCache => ({ get: vi.fn().mockResolvedValue(null), put: vi.fn() });

const searchBody = (ids: string[]) => ({ items: ids.map((id) => ({ id: { videoId: id }, snippet: { channelId: `chan-${id}`, channelTitle: "Example", title: `Video ${id}`, publishedAt: "2026-01-01T00:00:00.000Z" } })), pageInfo: { totalResults: 987654 } });
const videoBody = (ids: string[]) => ({ items: ids.map((id) => ({ id, snippet: { channelId: `chan-${id}`, channelTitle: "Example", title: `Video ${id}`, publishedAt: "2026-01-01T00:00:00.000Z" }, statistics: { viewCount: "1000", likeCount: "20", commentCount: "3" } })) });
const channelBody = (ids: string[]) => ({ items: ids.map((id) => ({ id, snippet: { title: `Channel ${id}`, publishedAt: "2024-01-01T00:00:00.000Z" }, statistics: { subscriberCount: "5000", videoCount: "80", viewCount: "900000" } })) });

function fetcherFor(responses: Array<{ ok?: boolean; status?: number; body?: unknown }>) {
  const calls: string[] = [];
  let index = 0;
  const fetcher = vi.fn(async (url: URL | RequestInfo) => {
    calls.push(String(url));
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return { ok: response.ok ?? true, status: response.status ?? 200, json: async () => response.body ?? { items: [] } } as Response;
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

describe("discovery query sanitization", () => {
  it("strips characters outside a conservative allowlist and bounds length", () => {
    expect(sanitizeDiscoveryQuery("  how do I   schedule staff?  ")).toBe("how do I schedule staff?");
    expect(sanitizeDiscoveryQuery("bakery <script>alert(1)</script> scheduling")).toBe("bakery script alert 1 /script scheduling");
    expect(sanitizeDiscoveryQuery("a".repeat(400))?.length).toBe(120);
  });

  it("rejects empty or unusable queries rather than sending them", () => {
    expect(sanitizeDiscoveryQuery("   ")).toBeNull();
    expect(sanitizeDiscoveryQuery("!!!")).toBeNull();
    expect(sanitizeDiscoveryQuery("x")).toBeNull();
  });

  it("derives a deterministic, normalization-stable search evidence id", () => {
    expect(discoverySearchEvidenceId("Scheduling Staff")).toBe(discoverySearchEvidenceId("  scheduling   staff "));
    expect(discoverySearchEvidenceId("a")).toMatch(/^yt:search:[a-f0-9]{32}$/);
    expect(discoverySearchEvidenceId("a")).not.toBe(discoverySearchEvidenceId("b"));
  });
});

describe("YouTube topic discovery", () => {
  it("fans out per pillar, attributes evidence, and records search provenance", async () => {
    const { fetcher, calls } = fetcherFor([
      { body: searchBody(["v1", "v2"]) },
      { body: searchBody(["v3"]) },
      { body: videoBody(["v1", "v2", "v3"]) },
      { body: channelBody(["chan-v1", "chan-v2", "chan-v3"]) },
    ]);
    const provider = new YouTubeTopicDiscoveryProvider("key", emptyCache(), budget, fetcher, now);
    const bundle = await provider.discover(crypto.randomUUID(), [
      { pillarId: "pillar:one", queries: ["scheduling staff"] },
      { pillarId: "pillar:two", queries: ["bonus schemes"] },
    ]);
    expect(bundle.usage.searchQueries).toBe(2);
    expect(bundle.usage.quotaUnits).toBe(202);
    expect(bundle.evidence.filter((item) => item.sourceType === "search")).toHaveLength(2);
    expect(bundle.evidence.find((item) => item.id === "yt:video:v3")?.pillarId).toBe("pillar:two");
    expect(bundle.evidence.find((item) => item.id === "yt:video:v1")?.pillarId).toBe("pillar:one");
    expect(bundle.completionStatus).toBe("complete");
    expect(calls[0]).toContain("safeSearch=moderate");
  });

  it("never converts provider result estimates into demand or search volume", async () => {
    const { fetcher } = fetcherFor([{ body: searchBody(["v1"]) }, { body: videoBody(["v1"]) }, { body: channelBody(["chan-v1"]) }]);
    const provider = new YouTubeTopicDiscoveryProvider("key", emptyCache(), budget, fetcher, now);
    const bundle = await provider.discover(crypto.randomUUID(), [{ pillarId: "pillar:one", queries: ["scheduling staff"] }]);
    const serialized = JSON.stringify(bundle);
    // pageInfo.totalResults (987654) must never reach the bundle in any form.
    expect(serialized).not.toContain("987654");
    expect(serialized).not.toContain("totalResults");
    const search = bundle.evidence.find((item) => item.sourceType === "search");
    expect(Object.keys(search?.metrics ?? {})).toEqual(["retainedResults", "returnedItems"]);
  });

  it("sanitizes and de-duplicates the model-supplied plan before any provider call", async () => {
    const { fetcher, calls } = fetcherFor([{ body: searchBody(["v1"]) }, { body: videoBody(["v1"]) }, { body: channelBody(["chan-v1"]) }]);
    const provider = new YouTubeTopicDiscoveryProvider("key", emptyCache(), budget, fetcher, now);
    await provider.discover(crypto.randomUUID(), [
      { pillarId: "pillar:one", queries: ["  Scheduling   Staff ", "scheduling staff", "!!!"] },
    ]);
    expect(calls.filter((url) => url.includes("/search")).length).toBe(1);
    expect(calls[0]).toContain("q=Scheduling+Staff");
  });

  it("bounds searches by the configured ceiling regardless of plan size", async () => {
    const { fetcher, calls } = fetcherFor([
      { body: searchBody(["v1"]) }, { body: searchBody(["v2"]) }, { body: searchBody(["v3"]) },
      { body: videoBody(["v1", "v2", "v3"]) }, { body: channelBody(["chan-v1"]) },
    ]);
    const provider = new YouTubeTopicDiscoveryProvider("key", emptyCache(), budget, fetcher, now);
    await provider.discover(crypto.randomUUID(), Array.from({ length: 8 }, (unused, index) => ({ pillarId: `pillar:p${index}`, queries: [`distinct query number ${index}`] })));
    expect(calls.filter((url) => url.includes("/search")).length).toBe(budget.maxSearchQueries);
  });

  it("refuses a bundle of pure search observations when every detail call fails", async () => {
    const { fetcher } = fetcherFor([
      { body: searchBody(["v1"]) },
      { ok: false, status: 500 },
      { ok: false, status: 500 },
    ]);
    const provider = new YouTubeTopicDiscoveryProvider("key", emptyCache(), budget, fetcher, now);
    await expect(provider.discover(crypto.randomUUID(), [{ pillarId: "pillar:one", queries: ["scheduling staff"] }]))
      .rejects.toMatchObject({ code: "CONTENT_DISCOVERY_NO_EVIDENCE" });
  });

  it("returns a labelled partial bundle when only some detail calls fail", async () => {
    const { fetcher } = fetcherFor([
      { body: searchBody(["v1"]) },
      { body: videoBody(["v1"]) },
      { ok: false, status: 500 },
    ]);
    const provider = new YouTubeTopicDiscoveryProvider("key", emptyCache(), budget, fetcher, now);
    const bundle = await provider.discover(crypto.randomUUID(), [{ pillarId: "pillar:one", queries: ["scheduling staff"] }]);
    expect(bundle.completionStatus).toBe("partial");
    expect(bundle.limitations.join(" ")).toContain("Channel statistics were unavailable");
    expect(bundle.evidence.some((item) => item.sourceType === "video")).toBe(true);
    expect(bundle.usage.channelsExamined).toBe(0);
  });

  it("fails closed with a typed provider error when the first search fails", async () => {
    const { fetcher } = fetcherFor([{ ok: false, status: 403 }]);
    const provider = new YouTubeTopicDiscoveryProvider("key", emptyCache(), budget, fetcher, now);
    await expect(provider.discover(crypto.randomUUID(), [{ pillarId: "pillar:one", queries: ["scheduling staff"] }]))
      .rejects.toMatchObject({ code: "YOUTUBE_AUTH_OR_QUOTA_FAILED", retryable: false });
  });

  it("rejects a malformed provider response rather than trusting it", async () => {
    const { fetcher } = fetcherFor([{ body: { notItems: true } }]);
    const provider = new YouTubeTopicDiscoveryProvider("key", emptyCache(), budget, fetcher, now);
    await expect(provider.discover(crypto.randomUUID(), [{ pillarId: "pillar:one", queries: ["scheduling staff"] }]))
      .rejects.toMatchObject({ code: "YOUTUBE_RESPONSE_MALFORMED" });
  });

  it("refuses a plan whose every query fails sanitization", async () => {
    const { fetcher, calls } = fetcherFor([{ body: searchBody(["v1"]) }]);
    const provider = new YouTubeTopicDiscoveryProvider("key", emptyCache(), budget, fetcher, now);
    await expect(provider.discover(crypto.randomUUID(), [{ pillarId: "pillar:one", queries: ["!!!", "  "] }]))
      .rejects.toMatchObject({ code: "CONTENT_DISCOVERY_NO_VALID_QUERY" });
    expect(calls).toHaveLength(0);
  });

  it("serves a cache hit as CACHE origin with no claimed provider spend", async () => {
    const cache: TopicDiscoveryCache = { get: vi.fn().mockResolvedValue(discoveryBundleFixture), put: vi.fn() };
    const { fetcher, calls } = fetcherFor([{ body: searchBody(["v1"]) }]);
    const provider = new YouTubeTopicDiscoveryProvider("key", cache, budget, fetcher, now);
    const bundle = await provider.discover(crypto.randomUUID(), [{ pillarId: "pillar:operating-systems", queries: ["scheduling staff"] }]);
    expect(calls).toHaveLength(0);
    expect(bundle.evidence.every((item) => item.origin === "CACHE")).toBe(true);
    expect(bundle.usage).toMatchObject({ cacheHits: 1, cacheMisses: 0, providerRequests: 0, quotaUnits: 0, searchQueries: 0 });
    // The original retrieval time survives so freshness reasoning stays honest.
    expect(bundle.usage.retrievedAt).toBe(discoveryBundleFixture.usage.retrievedAt);
  });

  it("writes the discovery bundle to cache with an explicit expiry", async () => {
    const cache = emptyCache();
    const { fetcher } = fetcherFor([{ body: searchBody(["v1"]) }, { body: videoBody(["v1"]) }, { body: channelBody(["chan-v1"]) }]);
    const provider = new YouTubeTopicDiscoveryProvider("key", cache, budget, fetcher, now);
    await provider.discover(crypto.randomUUID(), [{ pillarId: "pillar:one", queries: ["scheduling staff"] }]);
    expect(cache.put).toHaveBeenCalledTimes(1);
    const [, , , parameters, , expiresAt] = (cache.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(parameters).toMatchObject({ scope: "CONTENT_INTELLIGENCE_TOPIC_DISCOVERY" });
    expect(new Date(expiresAt as string).getTime()).toBeGreaterThan(now().getTime());
  });

  it("reserves durable usage before each provider call and finalizes it", async () => {
    const reservation = { operationId: crypto.randomUUID(), status: "RESERVED" as const, idempotentReplay: false };
    const meter = { ensure: vi.fn(), reserve: vi.fn().mockResolvedValue(reservation), finalize: vi.fn(), record: vi.fn() };
    const { fetcher } = fetcherFor([{ body: searchBody(["v1"]) }, { body: videoBody(["v1"]) }, { body: channelBody(["chan-v1"]) }]);
    const provider = new YouTubeTopicDiscoveryProvider("key", emptyCache(), budget, fetcher, now, meter);
    await provider.discover(crypto.randomUUID(), [{ pillarId: "pillar:one", queries: ["scheduling staff"] }]);
    const searchReservation = meter.reserve.mock.calls.find(([input]) => input.kind === "YOUTUBE_SEARCH");
    expect(searchReservation?.[0].reservation).toEqual({ providerRequests: 1, providerQuotaUnits: 100, searches: 1 });
    expect(meter.finalize).toHaveBeenCalled();
  });
});
