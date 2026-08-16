import { boundedIntegerEnv as boundedInteger } from "@/server/config";

export function channelStrategyConfig() {
  return {
    modelTimeoutMs: boundedInteger("CHANNEL_STRATEGY_MODEL_TIMEOUT_MS", 60_000, 5_000, 120_000),
    modelMaxOutputTokens: boundedInteger("CHANNEL_STRATEGY_MODEL_MAX_OUTPUT_TOKENS", 9_000, 2_000, 16_000),
    maxAggregateProviderRequests: 0,
    maxAggregateProviderQuotaUnits: 0,
    maxAggregateSearches: 0,
    maxAggregateSynthesisCalls: boundedInteger("CHANNEL_STRATEGY_MAX_AGGREGATE_SYNTHESIS_CALLS", 1, 1, 2),
    maxAggregateQaCalls: boundedInteger("CHANNEL_STRATEGY_MAX_AGGREGATE_QA_CALLS", 2, 2, 4),
    maxAggregateRevisionCalls: boundedInteger("CHANNEL_STRATEGY_MAX_AGGREGATE_REVISION_CALLS", 1, 1, 2),
    maxAggregateInputTokens: boundedInteger("CHANNEL_STRATEGY_MAX_AGGREGATE_INPUT_TOKENS", 320_000, 20_000, 1_000_000),
    maxAggregateOutputTokens: boundedInteger("CHANNEL_STRATEGY_MAX_AGGREGATE_OUTPUT_TOKENS", 36_000, 4_000, 100_000),
    maxAggregateTotalTokens: boundedInteger("CHANNEL_STRATEGY_MAX_AGGREGATE_TOTAL_TOKENS", 356_000, 24_000, 1_100_000),
    maxSynthesisCalls: 1 as const,
    maxQaCalls: 2 as const,
    maxRevisionCalls: 1 as const,
  };
}

export type ChannelStrategyBudget = ReturnType<typeof channelStrategyConfig>;

/**
 * Resolves the strategy synthesis and QA models from explicit operator
 * configuration, narrowing from strategy-specific to shared settings. There is
 * deliberately no built-in default model identifier: production must never
 * attempt a call against a placeholder model after reserving paid budget.
 */
export function assertChannelStrategyModelConfig() {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiApiKey) throw new StrategyConfigurationError("AI_CREDENTIALS_MISSING", "OPENAI_API_KEY is required by the strategy worker.");
  const synthesisModel = process.env.OPENAI_STRATEGY_SYNTHESIS_MODEL?.trim()
    || process.env.OPENAI_SYNTHESIS_MODEL?.trim()
    || process.env.OPENAI_MODEL?.trim();
  if (!synthesisModel) throw new StrategyConfigurationError("AI_MODEL_NOT_CONFIGURED", "Set OPENAI_STRATEGY_SYNTHESIS_MODEL, OPENAI_SYNTHESIS_MODEL, or OPENAI_MODEL; the strategy worker does not assume a default model.");
  const qaModel = process.env.OPENAI_STRATEGY_QA_MODEL?.trim()
    || process.env.OPENAI_QA_MODEL?.trim()
    || synthesisModel;
  return { openAiApiKey, synthesisModel, qaModel };
}

export class StrategyConfigurationError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}
