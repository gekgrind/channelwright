import { createHash } from "node:crypto";
import {
  channelResearchInputSchema,
  researchEvidenceBundleSchema,
  type ChannelResearchInput,
  type ResearchEvidence,
  type ResearchEvidenceBundle,
} from "@/domain/production-workflows";
import type { ResearchCache } from "./research-cache";
import type { ChannelResearchBudget } from "./research-config";
import type { ResearchUsageMeter } from "./research-usage";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const compact = (value: string) => value.trim().replace(/\s+/g, " ");
const boundedQuery = (value: string) => compact(value).slice(0, 500).trim();
export const normalizeResearchQuery = (value: string) => compact(value).toLocaleLowerCase("en-US");

export function buildResearchQueries(input: ChannelResearchInput, maximum: number) {
  const parsed = channelResearchInputSchema.parse(input);
  const suppliedSubject = boundedQuery(parsed.channelConcept ?? parsed.niche!);
  const subject = boundedQuery(suppliedSubject.replace(/\bfaceless\b/gi, "").replace(/\b(?:youtube\s+)?channel\b/gi, "")) || suppliedSubject;
  const niche = parsed.niche && normalizeResearchQuery(parsed.niche) !== normalizeResearchQuery(subject) ? compact(parsed.niche) : "";
  const context = [niche, parsed.targetAudience, parsed.constraints?.geography, parsed.constraints?.language].filter(Boolean).join(" ");
  return [...new Set([subject, boundedQuery(`${subject} ${context} channel`)])].slice(0, maximum);
}

export function researchCacheKey(queries: string[], budget: Pick<ChannelResearchBudget, "maxVideos" | "maxChannels">) {
  const payload = { provider: "YOUTUBE_DATA_API_V3", queries: queries.map(normalizeResearchQuery), maxVideos: budget.maxVideos, maxChannels: budget.maxChannels };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

type SearchItem = { id?: { videoId?: string }; snippet?: { channelId?: string; channelTitle?: string; title?: string; publishedAt?: string } };
type VideoItem = { id?: string; snippet?: { channelId?: string; channelTitle?: string; title?: string; publishedAt?: string }; statistics?: Record<string, string> };
type ChannelItem = { id?: string; snippet?: { title?: string; publishedAt?: string }; statistics?: Record<string, string | boolean> };

const count = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export class ResearchProviderError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

export class YouTubeResearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly cache: ResearchCache,
    private readonly budget: ChannelResearchBudget,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly usageMeter?: ResearchUsageMeter,
  ) {}

  private async request(resource: "search" | "videos" | "channels", parameters: Record<string, string>, state: { requests: number; quota: number; searchRequests: number }) {
    if (state.requests >= this.budget.maxProviderRequests) throw new ResearchProviderError("RESEARCH_BUDGET_EXHAUSTED", false, "YouTube provider request budget exhausted.");
    const quotaUnits = resource === "search" ? 100 : 1;
    const operationKey = `${resource}:${createHash("sha256").update(JSON.stringify(parameters)).digest("hex").slice(0, 32)}`;
    const reservation = await this.usageMeter?.reserve({
      key: operationKey,
      kind: resource === "search" ? "YOUTUBE_SEARCH" : resource === "videos" ? "YOUTUBE_VIDEOS" : "YOUTUBE_CHANNELS",
      provider: "YOUTUBE_DATA_API_V3",
      reservation: { providerRequests: 1, providerQuotaUnits: quotaUnits, searches: resource === "search" ? 1 : 0 },
    });
    state.requests += 1;
    state.quota += quotaUnits;
    if (resource === "search") state.searchRequests += 1;
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
      return body.items as unknown[];
    } catch (error) {
      await (reservation && this.usageMeter?.finalize(reservation, "FAILED", { providerRequests: 1, providerQuotaUnits: quotaUnits, searches: resource === "search" ? 1 : 0, failedOperations: 1 }, { resource, failureCode: error instanceof ResearchProviderError ? error.code : "YOUTUBE_REQUEST_FAILED" }));
      if (error instanceof ResearchProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new ResearchProviderError("YOUTUBE_TIMEOUT", true, "YouTube Data API request timed out.");
      throw new ResearchProviderError("YOUTUBE_NETWORK_FAILED", true, "YouTube Data API request failed before a response was received.");
    } finally { clearTimeout(timer); }
  }

  async retrieve(ownerId: string, rawInput: ChannelResearchInput): Promise<ResearchEvidenceBundle> {
    const input = channelResearchInputSchema.parse(rawInput);
    const queries = buildResearchQueries(input, this.budget.maxSearchQueries);
    const cacheKey = researchCacheKey(queries, this.budget);
    const now = this.now();
    const cached = await this.cache.get(ownerId, cacheKey, now);
    if (cached) {
      await this.usageMeter?.record({ key: `cache:${cacheKey}`, kind: "CACHE_LOOKUP", provider: "YOUTUBE_DATA_API_V3", actual: { cacheHits: 1 }, metadata: { cacheKey, status: "HIT" } });
      return cached;
    }
    await this.usageMeter?.record({ key: `cache:${cacheKey}`, kind: "CACHE_LOOKUP", provider: "YOUTUBE_DATA_API_V3", actual: { cacheMisses: 1 }, metadata: { cacheKey, status: "MISS" } });

    const state = { requests: 0, quota: 0, searchRequests: 0 };
    const limitations: string[] = [];
    let budgetExhausted = false;
    const videoQuery = new Map<string, string>();
    const searchItems: SearchItem[] = [];
    for (const query of queries) {
      let items: SearchItem[];
      try {
        items = await this.request("search", { part: "snippet", type: "video", maxResults: String(Math.min(25, this.budget.maxVideos)), q: query, order: "relevance", safeSearch: "moderate" }, state) as SearchItem[];
      } catch (error) {
        if (!(error instanceof ResearchProviderError) || searchItems.length === 0) throw error;
        budgetExhausted ||= error.code === "RESEARCH_BUDGET_EXHAUSTED";
        limitations.push(`Search coverage stopped early: ${error.code}.`);
        break;
      }
      for (const item of items) {
        const videoId = item.id?.videoId;
        if (videoId && !videoQuery.has(videoId) && videoQuery.size < this.budget.maxVideos) { videoQuery.set(videoId, query); searchItems.push(item); }
      }
    }
    if (videoQuery.size === 0) throw new ResearchProviderError("YOUTUBE_NO_EVIDENCE", false, "YouTube returned no usable video evidence for the bounded queries.");

    let videos: VideoItem[];
    try {
      videos = await this.request("videos", { part: "snippet,statistics", id: [...videoQuery.keys()].join(","), maxResults: String(this.budget.maxVideos) }, state) as VideoItem[];
    } catch (error) {
      if (!(error instanceof ResearchProviderError)) throw error;
      budgetExhausted ||= error.code === "RESEARCH_BUDGET_EXHAUSTED";
      limitations.push(`Detailed video statistics were unavailable: ${error.code}.`);
      videos = searchItems.flatMap((item) => item.id?.videoId ? [{ id: item.id.videoId, snippet: item.snippet, statistics: {} }] : []);
    }
    const channelQuery = new Map<string, string>();
    for (const video of videos) if (video.snippet?.channelId && channelQuery.size < this.budget.maxChannels) channelQuery.set(video.snippet.channelId, videoQuery.get(video.id ?? "") ?? queries[0]);
    let channels: ChannelItem[] = [];
    if (channelQuery.size) {
      try {
        channels = await this.request("channels", { part: "snippet,statistics", id: [...channelQuery.keys()].join(","), maxResults: String(this.budget.maxChannels) }, state) as ChannelItem[];
      } catch (error) {
        if (!(error instanceof ResearchProviderError)) throw error;
        budgetExhausted ||= error.code === "RESEARCH_BUDGET_EXHAUSTED";
        limitations.push(`Channel statistics were unavailable: ${error.code}.`);
      }
    }

    const retrievedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.budget.cacheTtlSeconds * 1_000).toISOString();
    const evidence: ResearchEvidence[] = [];
    for (const video of videos) {
      if (!video.id || !video.snippet?.title) continue;
      evidence.push({
        id: `yt:video:${video.id}`, provider: "YOUTUBE_DATA_API_V3", sourceType: "video", sourceId: video.id,
        url: `https://www.youtube.com/watch?v=${video.id}`, title: video.snippet.title, channelTitle: video.snippet.channelTitle ?? null,
        publishedAt: video.snippet.publishedAt ?? null, retrievedAt,
        metrics: { viewCount: count(video.statistics?.viewCount), likeCount: count(video.statistics?.likeCount), commentCount: count(video.statistics?.commentCount) },
        query: videoQuery.get(video.id) ?? queries[0], rawReference: `youtube.videos.list:${video.id}`, origin: "LIVE",
      });
    }
    for (const channel of channels) {
      if (!channel.id || !channel.snippet?.title) continue;
      evidence.push({
        id: `yt:channel:${channel.id}`, provider: "YOUTUBE_DATA_API_V3", sourceType: "channel", sourceId: channel.id,
        url: `https://www.youtube.com/channel/${channel.id}`, title: channel.snippet.title, channelTitle: channel.snippet.title,
        publishedAt: channel.snippet.publishedAt ?? null, retrievedAt,
        metrics: { subscriberCount: channel.statistics?.hiddenSubscriberCount ? null : count(channel.statistics?.subscriberCount), videoCount: count(channel.statistics?.videoCount), viewCount: count(channel.statistics?.viewCount) },
        query: channelQuery.get(channel.id) ?? queries[0], rawReference: `youtube.channels.list:${channel.id}`, origin: "LIVE",
      });
    }
    if (evidence.length === 0) throw new ResearchProviderError("YOUTUBE_NO_EVIDENCE", false, "YouTube returned no normalizable evidence.");
    const bundle = researchEvidenceBundleSchema.parse({
      normalizedQueries: queries.map(normalizeResearchQuery), evidence,
      completionStatus: limitations.length ? "partial" : "complete",
      limitations,
      usage: { provider: "YOUTUBE_DATA_API_V3", cacheStatus: "MISS", cacheKey, searchQueries: state.searchRequests, providerRequests: state.requests, quotaUnits: state.quota, videosExamined: videos.length, channelsExamined: channels.length, retrievedAt, expiresAt, budgetExhausted },
    });
    await this.usageMeter?.record({
      key: `evidence:${cacheKey}`,
      kind: "EVIDENCE_RESULT",
      provider: "YOUTUBE_DATA_API_V3",
      actual: { videosRetrieved: videos.length, channelsRetrieved: channels.length },
      metadata: { cacheKey, completionStatus: bundle.completionStatus, evidenceCount: evidence.length },
    });
    await this.cache.put(ownerId, cacheKey, queries.map(normalizeResearchQuery).join(" | "), { maxVideos: this.budget.maxVideos, maxChannels: this.budget.maxChannels }, bundle);
    return bundle;
  }
}
