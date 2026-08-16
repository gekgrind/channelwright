import { afterEach, describe, expect, it, vi } from "vitest";
import { assertChannelResearchProviderConfig, channelResearchConfig } from "./research-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("channel research budget", () => {
  it("defaults to bounded per-run and aggregate limits", () => {
    expect(channelResearchConfig()).toMatchObject({
      maxSearchQueries: 2, maxProviderRequests: 8, maxVideos: 24, maxChannels: 12,
      cacheTtlSeconds: 21_600, providerTimeoutMs: 20_000, modelTimeoutMs: 45_000, modelMaxOutputTokens: 6_000,
      maxAggregateProviderRequests: 12, maxAggregateProviderQuotaUnits: 500,
      maxSynthesisCalls: 1, maxQaCalls: 2, maxRevisionCalls: 1,
    });
  });

  it("accepts in-range overrides", () => {
    vi.stubEnv("CHANNEL_RESEARCH_MAX_SEARCH_QUERIES", "4");
    vi.stubEnv("CHANNEL_RESEARCH_CACHE_TTL_SECONDS", "300");
    expect(channelResearchConfig()).toMatchObject({ maxSearchQueries: 4, cacheTtlSeconds: 300 });
  });

  it.each([
    ["CHANNEL_RESEARCH_MAX_SEARCH_QUERIES", "0"],
    ["CHANNEL_RESEARCH_MAX_SEARCH_QUERIES", "5"],
    ["CHANNEL_RESEARCH_MAX_PROVIDER_REQUESTS", "2"],
    ["CHANNEL_RESEARCH_MAX_VIDEOS", "31"],
    ["CHANNEL_RESEARCH_CACHE_TTL_SECONDS", "299"],
    ["CHANNEL_RESEARCH_PROVIDER_TIMEOUT_MS", "60001"],
    ["CHANNEL_RESEARCH_MODEL_MAX_OUTPUT_TOKENS", "16.5"],
    ["CHANNEL_RESEARCH_MAX_AGGREGATE_TOTAL_TOKENS", "not-a-number"],
  ])("rejects out-of-range %s=%s", (name, value) => {
    vi.stubEnv(name, value);
    expect(() => channelResearchConfig()).toThrow(new RegExp(`${name} must be an integer between`));
  });
});

describe("channel research provider credentials", () => {
  it("requires the YouTube key before the AI key so retrieval cannot be skipped", () => {
    vi.stubEnv("YOUTUBE_DATA_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "ai-key");
    expect(() => assertChannelResearchProviderConfig()).toThrowError(expect.objectContaining({ code: "YOUTUBE_CREDENTIALS_MISSING", retryable: false }));

    vi.stubEnv("YOUTUBE_DATA_API_KEY", "youtube-key");
    vi.stubEnv("OPENAI_API_KEY", "   ");
    expect(() => assertChannelResearchProviderConfig()).toThrowError(expect.objectContaining({ code: "AI_CREDENTIALS_MISSING" }));
  });

  it("trims credentials and resolves the QA model from the synthesis model when unset", () => {
    vi.stubEnv("YOUTUBE_DATA_API_KEY", " youtube-key ");
    vi.stubEnv("OPENAI_API_KEY", " ai-key ");
    vi.stubEnv("OPENAI_SYNTHESIS_MODEL", "synthesis-model");
    vi.stubEnv("OPENAI_QA_MODEL", "");
    expect(assertChannelResearchProviderConfig()).toEqual({
      youtubeApiKey: "youtube-key", openAiApiKey: "ai-key", openAiModel: "synthesis-model", openAiQaModel: "synthesis-model",
    });

    vi.stubEnv("OPENAI_QA_MODEL", "qa-model");
    expect(assertChannelResearchProviderConfig()).toMatchObject({ openAiQaModel: "qa-model" });
  });
});
