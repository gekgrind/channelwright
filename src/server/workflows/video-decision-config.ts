import { boundedIntegerEnv as boundedInteger } from "@/server/config";

const DATABASE_OUTPUT_CEILING = 100_000;

export function channelVideoDecisionConfig() {
  const modelAnalysisOutputTokens = boundedInteger("VIDEO_DECISION_ANALYSIS_OUTPUT_TOKENS", 12_000, 2_000, 20_000);
  const modelReviewOutputTokens = boundedInteger("VIDEO_DECISION_REVIEW_OUTPUT_TOKENS", 5_000, 1_000, 10_000);
  const maxAggregateInputTokens = boundedInteger("VIDEO_DECISION_MAX_AGGREGATE_INPUT_TOKENS", 400_000, 20_000, 1_000_000);
  const maxAggregateOutputTokens = boundedInteger("VIDEO_DECISION_MAX_AGGREGATE_OUTPUT_TOKENS", 50_000, 6_000, DATABASE_OUTPUT_CEILING);
  const maxAggregateTotalTokens = boundedInteger("VIDEO_DECISION_MAX_AGGREGATE_TOTAL_TOKENS", 450_000, 26_000, 1_100_000);
  const worstCaseOutput = 2 * modelAnalysisOutputTokens + 2 * modelReviewOutputTokens;
  if (worstCaseOutput > maxAggregateOutputTokens) throw new Error(`VIDEO_DECISION budget invalid: four-call retry graph reserves ${worstCaseOutput} output tokens but the aggregate ceiling is ${maxAggregateOutputTokens}.`);
  if (maxAggregateTotalTokens < maxAggregateInputTokens + maxAggregateOutputTokens) throw new Error("VIDEO_DECISION budget invalid: total token ceiling is below input plus output ceilings.");
  return {
    maxAggregateProviderRequests: 0,
    maxAggregateProviderQuotaUnits: 0,
    maxAggregateSearches: 0,
    maxAggregateSynthesisCalls: 2,
    maxAggregateQaCalls: 2,
    maxAggregateRevisionCalls: 0,
    maxAutomatedRevisions: 0,
    maxAggregateInputTokens,
    maxAggregateOutputTokens,
    maxAggregateTotalTokens,
    modelAnalysisOutputTokens,
    modelReviewOutputTokens,
    modelTimeoutMs: boundedInteger("VIDEO_DECISION_MODEL_TIMEOUT_MS", 120_000, 5_000, 180_000),
    maxResultPayloadBytes: 40_000,
  };
}

export type ChannelVideoDecisionBudget = ReturnType<typeof channelVideoDecisionConfig>;
