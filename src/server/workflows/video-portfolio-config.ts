import { boundedIntegerEnv as boundedInteger } from "@/server/config";

const DATABASE_OUTPUT_CEILING = 100_000;

/**
 * The hard `octet_length(p_output::text) > 65536` guard inside
 * `complete_workflow_step`. Every workflow-step output that reaches the database
 * is bounded by this; it is a schema constraint, not a tuning preference, and it
 * bounds the WHOLE persisted step envelope, not just any nested `result`. The
 * Portfolio final-QA step persists `{ qa, crossModelReview, result }`, so the
 * executor measures that exact object against this ceiling before it ever calls
 * `complete_workflow_step` -- a schema-valid `result` that fits
 * `maxResultPayloadBytes` can still push the envelope past this once
 * `crossModelReview` is serialized both on its own and inside `result`.
 */
export const WORKFLOW_STEP_OUTPUT_CEILING_BYTES = 65_536;

export function channelVideoPortfolioConfig() {
  const modelAnalysisOutputTokens = boundedInteger("VIDEO_PORTFOLIO_ANALYSIS_OUTPUT_TOKENS", 11_000, 2_000, 20_000);
  const modelReviewOutputTokens = boundedInteger("VIDEO_PORTFOLIO_REVIEW_OUTPUT_TOKENS", 5_000, 1_000, 10_000);
  const maxAggregateInputTokens = boundedInteger("VIDEO_PORTFOLIO_MAX_AGGREGATE_INPUT_TOKENS", 400_000, 20_000, 1_000_000);
  const maxAggregateOutputTokens = boundedInteger("VIDEO_PORTFOLIO_MAX_AGGREGATE_OUTPUT_TOKENS", 50_000, 6_000, DATABASE_OUTPUT_CEILING);
  const maxAggregateTotalTokens = boundedInteger("VIDEO_PORTFOLIO_MAX_AGGREGATE_TOTAL_TOKENS", 450_000, 26_000, 1_100_000);
  const worstCaseOutput = 2 * modelAnalysisOutputTokens + 2 * modelReviewOutputTokens;
  if (worstCaseOutput > maxAggregateOutputTokens) throw new Error(`VIDEO_PORTFOLIO budget invalid: four-call retry graph reserves ${worstCaseOutput} output tokens but the aggregate ceiling is ${maxAggregateOutputTokens}.`);
  if (maxAggregateTotalTokens < maxAggregateInputTokens + maxAggregateOutputTokens) throw new Error("VIDEO_PORTFOLIO budget invalid: total token ceiling is below input plus output ceilings.");
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
    modelTimeoutMs: boundedInteger("VIDEO_PORTFOLIO_MODEL_TIMEOUT_MS", 120_000, 5_000, 180_000),
    // Deliberately higher than the sibling verticals' 48 KiB. A portfolio carries
    // up to six candidate projections plus six eleven-artifact lineage chains, so
    // its structural floor is several times a single-artifact workflow's. This
    // bounds the `result` alone; the final-QA step envelope
    // (`{ qa, crossModelReview, result }`) is bounded separately against
    // `WORKFLOW_STEP_OUTPUT_CEILING_BYTES` in the executor, because that envelope
    // re-serializes `crossModelReview` outside `result` and can exceed the
    // database limit even when `result` fits here.
    maxResultPayloadBytes: 60_000,
  };
}

export type ChannelVideoPortfolioBudget = ReturnType<typeof channelVideoPortfolioConfig>;
