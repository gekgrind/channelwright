const boundedInteger = (name: string, fallback: number, min: number, max: number) => {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
};

/**
 * CONTENT_INTELLIGENCE fans out across content pillars, so its provider ceilings
 * are larger than research and strategy. They are still chosen to sit inside the
 * database safety ceilings enforced by `ensure_research_run_budget`
 * (providerRequests <= 36, quotaUnits <= 1200, searches <= 12), so this workflow
 * needs no widening of those limits. `search.list` costs 100 quota units, which
 * is what caps the search count well below the pillar count times query count.
 */
export function channelContentIntelligenceConfig() {
  return {
    maxPillars: boundedInteger("CONTENT_INTELLIGENCE_MAX_PILLARS", 6, 1, 8),
    maxQueriesPerPillar: boundedInteger("CONTENT_INTELLIGENCE_MAX_QUERIES_PER_PILLAR", 2, 1, 3),
    maxSearchQueries: boundedInteger("CONTENT_INTELLIGENCE_MAX_SEARCH_QUERIES", 8, 1, 12),
    maxProviderRequests: boundedInteger("CONTENT_INTELLIGENCE_MAX_PROVIDER_REQUESTS", 24, 3, 36),
    maxVideos: boundedInteger("CONTENT_INTELLIGENCE_MAX_VIDEOS", 60, 1, 120),
    maxChannels: boundedInteger("CONTENT_INTELLIGENCE_MAX_CHANNELS", 24, 1, 60),
    maxEvidenceRecords: boundedInteger("CONTENT_INTELLIGENCE_MAX_EVIDENCE_RECORDS", 90, 10, 90),
    cacheTtlSeconds: boundedInteger("CONTENT_INTELLIGENCE_CACHE_TTL_SECONDS", 21_600, 300, 86_400),
    providerTimeoutMs: boundedInteger("CONTENT_INTELLIGENCE_PROVIDER_TIMEOUT_MS", 20_000, 1_000, 60_000),
    modelTimeoutMs: boundedInteger("CONTENT_INTELLIGENCE_MODEL_TIMEOUT_MS", 90_000, 5_000, 180_000),
    modelMaxOutputTokens: boundedInteger("CONTENT_INTELLIGENCE_MODEL_MAX_OUTPUT_TOKENS", 14_000, 2_000, 24_000),
    maxAggregateProviderRequests: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_PROVIDER_REQUESTS", 24, 3, 36),
    maxAggregateProviderQuotaUnits: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_PROVIDER_QUOTA_UNITS", 900, 100, 1_200),
    maxAggregateSearches: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_SEARCHES", 8, 1, 12),
    maxAggregateSynthesisCalls: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_SYNTHESIS_CALLS", 3, 3, 6),
    // Initial QA runs an independent critic plus semantic QA, and final QA runs
    // once more: three calls, plus headroom for a retried step.
    maxAggregateQaCalls: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_QA_CALLS", 6, 3, 12),
    maxAggregateRevisionCalls: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_REVISION_CALLS", 2, 1, 4),
    maxAggregateInputTokens: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_INPUT_TOKENS", 600_000, 20_000, 1_000_000),
    maxAggregateOutputTokens: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_OUTPUT_TOKENS", 60_000, 4_000, 100_000),
    maxAggregateTotalTokens: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_TOTAL_TOKENS", 660_000, 24_000, 1_100_000),
    /** Margin below the engine's 64 KiB durable-output limit; QA fails first with a typed code. */
    maxResultPayloadBytes: 60_000,
  };
}

export type ChannelContentIntelligenceBudget = ReturnType<typeof channelContentIntelligenceConfig>;

/**
 * Model selection is explicit. As with research and strategy there is no default
 * identifier, so an unconfigured deployment fails closed before any paid
 * reservation instead of calling a model that does not exist.
 */
export function assertChannelContentIntelligenceModelConfig() {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiApiKey) throw new ContentConfigurationError("AI_CREDENTIALS_MISSING", "OPENAI_API_KEY is required by the content-intelligence worker.");
  const youtubeApiKey = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!youtubeApiKey) throw new ContentConfigurationError("YOUTUBE_CREDENTIALS_MISSING", "YOUTUBE_DATA_API_KEY is required by the content-intelligence worker.");
  const synthesisModel = process.env.OPENAI_CONTENT_SYNTHESIS_MODEL?.trim()
    || process.env.OPENAI_SYNTHESIS_MODEL?.trim()
    || process.env.OPENAI_MODEL?.trim();
  if (!synthesisModel) throw new ContentConfigurationError("AI_MODEL_NOT_CONFIGURED", "Set OPENAI_CONTENT_SYNTHESIS_MODEL, OPENAI_SYNTHESIS_MODEL, or OPENAI_MODEL; the content-intelligence worker does not assume a default model.");
  const qaModel = process.env.OPENAI_CONTENT_QA_MODEL?.trim()
    || process.env.OPENAI_QA_MODEL?.trim()
    || synthesisModel;
  return { openAiApiKey, youtubeApiKey, synthesisModel, qaModel };
}

export class ContentConfigurationError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}
