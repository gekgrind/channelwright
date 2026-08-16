import { createHash } from "node:crypto";
import {
  topicDiscoveryBundleSchema,
  type TopicDiscoveryBundle,
  type TopicDiscoveryEvidence,
} from "@/domain/production-workflows";
import type { ChannelContentIntelligenceBudget } from "./content-config";
import type { ResearchUsageMeter } from "./research-usage";
import { ResearchProviderError, normalizeResearchQuery } from "./youtube-research-provider";

/**
 * Discovery bundles have their own shape (search observations, per-pillar
 * attribution), so they cannot round-trip through the research cache contract
 * even though both persist in `channelwright.research_evidence_cache`.
 */
export interface TopicDiscoveryCache {
  get(ownerId: string, cacheKey: string, now: Date): Promise<TopicDiscoveryBundle | null>;
  put(ownerId: string, cacheKey: string, normalizedQuery: string, requestParameters: Record<string, unknown>, bundle: TopicDiscoveryBundle, expiresAt: string): Promise<void>;
}

const API_BASE = "https://www.googleapis.com/youtube/v3";
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;

/**
 * Discovery queries originate from a model, so they are untrusted input to the
 * provider. Everything outside a conservative allowlist is dropped before the
 * query is placed in a URL query parameter, and the result is length bounded.
 */
export function sanitizeDiscoveryQuery(raw: string) {
  const cleaned = raw
    .normalize("NFKC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[^\p{L}\p{N} '"\-_.,?&+#/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

export const discoverySearchEvidenceId = (query: string) => `yt:search:${createHash("sha256").update(normalizeResearchQuery(query)).digest("hex").slice(0, 32)}`;

export function discoveryCacheKey(ownerPlan: Array<{ pillarId: string; queries: string[] }>, budget: Pick<ChannelContentIntelligenceBudget, "maxVideos" | "maxChannels">) {
  const payload = {
    provider: "YOUTUBE_DATA_API_V3",
    scope: "CONTENT_INTELLIGENCE_TOPIC_DISCOVERY",
    plan: ownerPlan.map((item) => ({ pillarId: item.pillarId, queries: item.queries.map(normalizeResearchQuery).sort() })).sort((left, right) => left.pillarId.localeCompare(right.pillarId)),
    maxVideos: budget.maxVideos,
    maxChannels: budget.maxChannels,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export interface DiscoveryPlanEntry { pillarId: string; queries: string[] }

type SearchItem = { id?: { videoId?: string }; snippet?: { channelId?: string; channelTitle?: string; title?: string; publishedAt?: string } };
type VideoItem = { id?: string; snippet?: { channelId?: string; channelTitle?: string; title?: string; publishedAt?: string }; statistics?: Record<string, string> };
type ChannelItem = { id?: string; snippet?: { title?: string; publishedAt?: string }; statistics?: Record<string, string | boolean> };

export interface TopicDiscoveryProvider {
  discover(ownerId: string, plan: DiscoveryPlanEntry[]): Promise<TopicDiscoveryBundle>;
}

export class YouTubeTopicDiscoveryProvider implements TopicDiscoveryProvider {
  constructor(
    private readonly apiKey: string,
    private readonly cache: TopicDiscoveryCache,
    private readonly budget: ChannelContentIntelligenceBudget,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly usageMeter?: ResearchUsageMeter,
  ) {}

  private async request(resource: "search" | "videos" | "channels", parameters: Record<string, string>, state: { requests: number; quota: number; searches: number }) {
    if (state.requests >= this.budget.maxProviderRequests) throw new ResearchProviderError("CONTENT_DISCOVERY_BUDGET_EXHAUSTED", false, "YouTube discovery request budget exhausted.");
    const quotaUnits = resource === "search" ? 100 : 1;
    const operationKey = `discovery:${resource}:${createHash("sha256").update(JSON.stringify(parameters)).digest("hex").slice(0, 32)}`;
    const reservation = await this.usageMeter?.reserve({
      key: operationKey,
      kind: resource === "search" ? "YOUTUBE_SEARCH" : resource === "videos" ? "YOUTUBE_VIDEOS" : "YOUTUBE_CHANNELS",
      provider: "YOUTUBE_DATA_API_V3",
      reservation: { providerRequests: 1, providerQuotaUnits: quotaUnits, searches: resource === "search" ? 1 : 0 },
    });
    state.requests += 1;
    state.quota += quotaUnits;
    if (resource === "search") state.searches += 1;
    const url = new URL(`${API_BASE}/${resource}`);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    url.searchParams.set("key", this.apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.budget.providerTimeoutMs);
    try {
      const response = await this.fetcher(url, { signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 ? "YOUTUBE_AUTH_OR_QUOTA_FAILED"
          : response.status === 429 ? "YOUTUBE_RATE_LIMITED" : response.status >= 500 ? "YOUTUBE_PROVIDER_UNAVAILABLE" : "YOUTUBE_PROVIDER_REJECTED";
        throw new ResearchProviderError(code, response.status === 429 || response.status >= 500, `YouTube Data API request failed with HTTP ${response.status}.`);
      }
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.items)) throw new ResearchProviderError("YOUTUBE_RESPONSE_MALFORMED", false, "YouTube Data API returned an invalid response shape.");
      await (reservation && this.usageMeter?.finalize(reservation, "SUCCEEDED", { providerRequests: 1, providerQuotaUnits: quotaUnits, searches: resource === "search" ? 1 : 0 }, { resource, responseItems: body.items.length }));
      // `pageInfo.totalResults` is deliberately discarded: it is an estimate of
      // matching resources, not search volume or audience demand.
      return body.items as unknown[];
    } catch (error) {
      await (reservation && this.usageMeter?.finalize(reservation, "FAILED", { providerRequests: 1, providerQuotaUnits: quotaUnits, searches: resource === "search" ? 1 : 0, failedOperations: 1 }, { resource, failureCode: error instanceof ResearchProviderError ? error.code : "YOUTUBE_REQUEST_FAILED" }));
      if (error instanceof ResearchProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new ResearchProviderError("YOUTUBE_TIMEOUT", true, "YouTube Data API request timed out.");
      throw new ResearchProviderError("YOUTUBE_NETWORK_FAILED", true, "YouTube Data API request failed before a response was received.");
    } finally { clearTimeout(timer); }
  }

  /** Sanitizes and bounds the model-supplied plan before any provider call. */
  private normalizePlan(plan: DiscoveryPlanEntry[]) {
    const seen = new Set<string>();
    const normalized: Array<{ pillarId: string; query: string }> = [];
    for (const entry of plan.slice(0, this.budget.maxPillars)) {
      let accepted = 0;
      for (const raw of entry.queries) {
        if (accepted >= this.budget.maxQueriesPerPillar || normalized.length >= this.budget.maxSearchQueries) break;
        const query = sanitizeDiscoveryQuery(raw);
        if (!query) continue;
        const fingerprint = normalizeResearchQuery(query);
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        normalized.push({ pillarId: entry.pillarId, query });
        accepted += 1;
      }
    }
    return normalized;
  }

  async discover(ownerId: string, plan: DiscoveryPlanEntry[]): Promise<TopicDiscoveryBundle> {
    const normalized = this.normalizePlan(plan);
    if (normalized.length === 0) throw new ResearchProviderError("CONTENT_DISCOVERY_NO_VALID_QUERY", false, "No discovery query survived sanitization.");
    const grouped = new Map<string, string[]>();
    for (const item of normalized) grouped.set(item.pillarId, [...(grouped.get(item.pillarId) ?? []), item.query]);
    const cacheKey = discoveryCacheKey([...grouped].map(([pillarId, queries]) => ({ pillarId, queries })), this.budget);
    const now = this.now();

    const cached = await this.cache.get(ownerId, cacheKey, now);
    if (cached) {
      await this.usageMeter?.record({ key: `discovery:cache:${cacheKey}`, kind: "CACHE_LOOKUP", provider: "YOUTUBE_DATA_API_V3", actual: { cacheHits: 1 }, metadata: { cacheKey, status: "HIT" } });
      // A cache hit must never present itself as fresh live retrieval: origin
      // becomes CACHE and no new provider spend is claimed. The original
      // retrievedAt is preserved so downstream freshness reasoning stays honest.
      return topicDiscoveryBundleSchema.parse({
        ...cached,
        evidence: cached.evidence.map((item) => ({ ...item, origin: "CACHE" as const })),
        usage: { ...cached.usage, cacheHits: 1, cacheMisses: 0, providerRequests: 0, quotaUnits: 0, searchQueries: 0 },
      });
    }
    await this.usageMeter?.record({ key: `discovery:cache:${cacheKey}`, kind: "CACHE_LOOKUP", provider: "YOUTUBE_DATA_API_V3", actual: { cacheMisses: 1 }, metadata: { cacheKey, status: "MISS" } });

    const state = { requests: 0, quota: 0, searches: 0 };
    const limitations: string[] = [];
    let budgetExhausted = false;
    const retrievedAt = now.toISOString();
    const evidence: TopicDiscoveryEvidence[] = [];
    const videoPillar = new Map<string, { pillarId: string; query: string }>();

    for (const { pillarId, query } of normalized) {
      let items: SearchItem[];
      try {
        items = await this.request("search", {
          part: "snippet", type: "video", order: "relevance", safeSearch: "moderate",
          maxResults: String(Math.min(25, this.budget.maxVideos)), q: query,
        }, state) as SearchItem[];
      } catch (error) {
        if (!(error instanceof ResearchProviderError) || evidence.length === 0) throw error;
        budgetExhausted ||= error.code === "CONTENT_DISCOVERY_BUDGET_EXHAUSTED";
        limitations.push(`Discovery stopped early for ${pillarId}: ${error.code}.`);
        break;
      }
      let retained = 0;
      for (const item of items) {
        const videoId = item.id?.videoId;
        if (!videoId || videoPillar.has(videoId) || videoPillar.size >= this.budget.maxVideos) continue;
        videoPillar.set(videoId, { pillarId, query });
        retained += 1;
      }
      // A search observation records that this query was actually issued and how
      // many results were retained. It is retrieval provenance, never demand.
      evidence.push({
        id: discoverySearchEvidenceId(query), provider: "YOUTUBE_DATA_API_V3", sourceType: "search", sourceId: discoverySearchEvidenceId(query).slice("yt:search:".length),
        url: null, title: null, channelTitle: null, publishedAt: null, retrievedAt,
        metrics: { retainedResults: retained, returnedItems: items.length },
        query, pillarId, rawReference: "youtube.search.list", origin: "LIVE",
      });
    }
    if (videoPillar.size === 0) throw new ResearchProviderError("CONTENT_DISCOVERY_NO_EVIDENCE", false, "YouTube returned no usable video evidence for the bounded discovery plan.");

    const videoIds = [...videoPillar.keys()];
    const videos: VideoItem[] = [];
    for (let index = 0; index < videoIds.length; index += 50) {
      const batch = videoIds.slice(index, index + 50);
      try {
        videos.push(...await this.request("videos", { part: "snippet,statistics", id: batch.join(","), maxResults: String(batch.length) }, state) as VideoItem[]);
      } catch (error) {
        if (!(error instanceof ResearchProviderError)) throw error;
        budgetExhausted ||= error.code === "CONTENT_DISCOVERY_BUDGET_EXHAUSTED";
        limitations.push(`Detailed video statistics were unavailable for one batch: ${error.code}.`);
        break;
      }
    }
    for (const video of videos) {
      if (!video.id || !video.snippet?.title) continue;
      const origin = videoPillar.get(video.id);
      if (!origin) continue;
      evidence.push({
        id: `yt:video:${video.id}`, provider: "YOUTUBE_DATA_API_V3", sourceType: "video", sourceId: video.id,
        url: `https://www.youtube.com/watch?v=${video.id}`, title: video.snippet.title.slice(0, 300),
        channelTitle: video.snippet.channelTitle?.slice(0, 300) ?? null, publishedAt: video.snippet.publishedAt ?? null, retrievedAt,
        metrics: { viewCount: count(video.statistics?.viewCount), likeCount: count(video.statistics?.likeCount), commentCount: count(video.statistics?.commentCount) },
        query: origin.query, pillarId: origin.pillarId, rawReference: `youtube.videos.list:${video.id}`, origin: "LIVE",
      });
    }

    const channelPillar = new Map<string, { pillarId: string; query: string }>();
    for (const video of videos) {
      const channelId = video.snippet?.channelId;
      const origin = video.id ? videoPillar.get(video.id) : undefined;
      if (!channelId || !origin || channelPillar.has(channelId) || channelPillar.size >= this.budget.maxChannels) continue;
      channelPillar.set(channelId, origin);
    }
    const channels: ChannelItem[] = [];
    const channelIds = [...channelPillar.keys()];
    for (let index = 0; index < channelIds.length; index += 50) {
      const batch = channelIds.slice(index, index + 50);
      try {
        channels.push(...await this.request("channels", { part: "snippet,statistics", id: batch.join(","), maxResults: String(batch.length) }, state) as ChannelItem[]);
      } catch (error) {
        if (!(error instanceof ResearchProviderError)) throw error;
        budgetExhausted ||= error.code === "CONTENT_DISCOVERY_BUDGET_EXHAUSTED";
        limitations.push(`Channel statistics were unavailable for one batch: ${error.code}.`);
        break;
      }
    }
    for (const channel of channels) {
      if (!channel.id || !channel.snippet?.title) continue;
      const origin = channelPillar.get(channel.id);
      if (!origin) continue;
      evidence.push({
        id: `yt:channel:${channel.id}`, provider: "YOUTUBE_DATA_API_V3", sourceType: "channel", sourceId: channel.id,
        url: `https://www.youtube.com/channel/${channel.id}`, title: channel.snippet.title.slice(0, 300), channelTitle: channel.snippet.title.slice(0, 300),
        publishedAt: channel.snippet.publishedAt ?? null, retrievedAt,
        metrics: {
          subscriberCount: channel.statistics?.hiddenSubscriberCount ? null : count(channel.statistics?.subscriberCount),
          videoCount: count(channel.statistics?.videoCount), viewCount: count(channel.statistics?.viewCount),
        },
        query: origin.query, pillarId: origin.pillarId, rawReference: `youtube.channels.list:${channel.id}`, origin: "LIVE",
      });
    }

    // Search observations alone are retrieval provenance, not evidence about what
    // content exists. A bundle without a single video or channel record cannot
    // support topic assessment, so it fails rather than degrading quietly.
    if (!evidence.some((item) => item.sourceType !== "search")) {
      throw new ResearchProviderError("CONTENT_DISCOVERY_NO_EVIDENCE", false, "Discovery retained no video or channel evidence, only search observations.");
    }
    const bounded = evidence.slice(0, this.budget.maxEvidenceRecords);
    if (bounded.length < evidence.length) limitations.push(`Discovery evidence was truncated to ${this.budget.maxEvidenceRecords} records to stay inside the durable output bound.`);
    const bundle = topicDiscoveryBundleSchema.parse({
      normalizedQueries: normalized.map((item) => normalizeResearchQuery(item.query)),
      evidence: bounded,
      completionStatus: limitations.length ? "partial" : "complete",
      limitations,
      usage: {
        provider: "YOUTUBE_DATA_API_V3", cacheHits: 0, cacheMisses: 1, searchQueries: state.searches,
        providerRequests: state.requests, quotaUnits: state.quota,
        videosExamined: videos.length, channelsExamined: channels.length, retrievedAt, budgetExhausted,
      },
    });
    await this.usageMeter?.record({
      key: `discovery:evidence:${cacheKey}`, kind: "EVIDENCE_RESULT", provider: "YOUTUBE_DATA_API_V3",
      actual: { videosRetrieved: videos.length, channelsRetrieved: channels.length },
      metadata: { cacheKey, completionStatus: bundle.completionStatus, evidenceCount: bounded.length },
    });
    await this.cache.put(
      ownerId, cacheKey, bundle.normalizedQueries.join(" | "),
      { scope: "CONTENT_INTELLIGENCE_TOPIC_DISCOVERY", maxVideos: this.budget.maxVideos, maxChannels: this.budget.maxChannels },
      bundle, new Date(now.getTime() + this.budget.cacheTtlSeconds * 1_000).toISOString(),
    );
    return bundle;
  }
}
