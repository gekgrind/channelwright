import { boundedIntegerEnv as boundedInteger } from "@/server/config";

export type ChannelResearchBudget = ReturnType<typeof channelResearchConfig>;

export function channelResearchConfig() {
  return {
    maxSearchQueries: boundedInteger("CHANNEL_RESEARCH_MAX_SEARCH_QUERIES", 2, 1, 4),
    maxProviderRequests: boundedInteger("CHANNEL_RESEARCH_MAX_PROVIDER_REQUESTS", 8, 3, 12),
    maxVideos: boundedInteger("CHANNEL_RESEARCH_MAX_VIDEOS", 24, 1, 30),
    maxChannels: boundedInteger("CHANNEL_RESEARCH_MAX_CHANNELS", 12, 1, 20),
    cacheTtlSeconds: boundedInteger("CHANNEL_RESEARCH_CACHE_TTL_SECONDS", 21_600, 300, 86_400),
    providerTimeoutMs: boundedInteger("CHANNEL_RESEARCH_PROVIDER_TIMEOUT_MS", 20_000, 1_000, 60_000),
    modelTimeoutMs: boundedInteger("CHANNEL_RESEARCH_MODEL_TIMEOUT_MS", 45_000, 5_000, 120_000),
    modelMaxOutputTokens: boundedInteger("CHANNEL_RESEARCH_MODEL_MAX_OUTPUT_TOKENS", 6_000, 1_000, 16_000),
    maxAggregateProviderRequests: boundedInteger("CHANNEL_RESEARCH_MAX_AGGREGATE_PROVIDER_REQUESTS", 12, 3, 36),
    maxAggregateProviderQuotaUnits: boundedInteger("CHANNEL_RESEARCH_MAX_AGGREGATE_PROVIDER_QUOTA_UNITS", 500, 100, 1_200),
    maxAggregateSearches: boundedInteger("CHANNEL_RESEARCH_MAX_AGGREGATE_SEARCHES", 4, 1, 12),
    maxAggregateSynthesisCalls: boundedInteger("CHANNEL_RESEARCH_MAX_AGGREGATE_SYNTHESIS_CALLS", 2, 1, 6),
    maxAggregateQaCalls: boundedInteger("CHANNEL_RESEARCH_MAX_AGGREGATE_QA_CALLS", 4, 1, 12),
    maxAggregateRevisionCalls: boundedInteger("CHANNEL_RESEARCH_MAX_AGGREGATE_REVISION_CALLS", 2, 1, 4),
    maxAggregateInputTokens: boundedInteger("CHANNEL_RESEARCH_MAX_AGGREGATE_INPUT_TOKENS", 250_000, 1_000, 1_000_000),
    maxAggregateOutputTokens: boundedInteger("CHANNEL_RESEARCH_MAX_AGGREGATE_OUTPUT_TOKENS", 24_000, 1_000, 100_000),
    maxAggregateTotalTokens: boundedInteger("CHANNEL_RESEARCH_MAX_AGGREGATE_TOTAL_TOKENS", 274_000, 2_000, 1_100_000),
    maxSynthesisCalls: 1 as const,
    maxQaCalls: 2 as const,
    maxRevisionCalls: 1 as const,
  };
}

/**
 * Resolves the research synthesis model from explicit operator configuration.
 * There is deliberately no built-in default: a placeholder identifier would let
 * production call a model that does not exist, and the provider failure would
 * surface late, after a durable budget reservation had already been charged.
 */
export function assertChannelResearchProviderConfig() {
  const youtubeApiKey = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!youtubeApiKey) throw new ResearchConfigurationError("YOUTUBE_CREDENTIALS_MISSING", "YOUTUBE_DATA_API_KEY is required by the research worker.");
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiApiKey) throw new ResearchConfigurationError("AI_CREDENTIALS_MISSING", "OPENAI_API_KEY is required by the research worker.");
  const synthesisModel = process.env.OPENAI_SYNTHESIS_MODEL?.trim() || process.env.OPENAI_MODEL?.trim();
  if (!synthesisModel) throw new ResearchConfigurationError("AI_MODEL_NOT_CONFIGURED", "Set OPENAI_SYNTHESIS_MODEL or OPENAI_MODEL; the research worker does not assume a default model.");
  const qaModel = process.env.OPENAI_QA_MODEL?.trim() || synthesisModel;
  return { youtubeApiKey, openAiApiKey, openAiModel: synthesisModel, openAiQaModel: qaModel };
}

export class ResearchConfigurationError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}
