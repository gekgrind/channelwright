import { boundedIntegerEnv as boundedInteger } from "@/server/config";

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
    maxVideos: boundedInteger("CONTENT_INTELLIGENCE_MAX_VIDEOS", 50, 1, 120),
    maxChannels: boundedInteger("CONTENT_INTELLIGENCE_MAX_CHANNELS", 24, 1, 60),
    maxEvidenceRecords: boundedInteger("CONTENT_INTELLIGENCE_MAX_EVIDENCE_RECORDS", 90, 10, 90),
    cacheTtlSeconds: boundedInteger("CONTENT_INTELLIGENCE_CACHE_TTL_SECONDS", 21_600, 300, 86_400),
    providerTimeoutMs: boundedInteger("CONTENT_INTELLIGENCE_PROVIDER_TIMEOUT_MS", 20_000, 1_000, 60_000),
    modelTimeoutMs: boundedInteger("CONTENT_INTELLIGENCE_MODEL_TIMEOUT_MS", 90_000, 5_000, 180_000),
    modelMaxOutputTokens: boundedInteger("CONTENT_INTELLIGENCE_MODEL_MAX_OUTPUT_TOKENS", 14_000, 2_000, 24_000),
    maxAggregateProviderRequests: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_PROVIDER_REQUESTS", 24, 3, 36),
    maxAggregateProviderQuotaUnits: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_PROVIDER_QUOTA_UNITS", 900, 100, 1_200),
    maxAggregateSearches: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_SEARCHES", 8, 1, 12),
    // Three GENERATOR calls are made per run and each step allows two attempts, so
    // a default of exactly three left no room for a single provider timeout.
    maxAggregateSynthesisCalls: boundedInteger("CONTENT_INTELLIGENCE_MAX_AGGREGATE_SYNTHESIS_CALLS", 5, 3, 6),
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
 * Model and credential resolution lives in the role router
 * (`src/server/ai/role-router.ts`), which supports every provider. There is
 * deliberately no OpenAI-specific config helper here: one existed, was unused,
 * and would have failed Anthropic-only deployments closed if it were ever wired
 * in.
 */
export class ContentConfigurationError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}
