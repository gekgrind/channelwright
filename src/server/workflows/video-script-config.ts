import { boundedIntegerEnv as boundedInteger } from "@/server/config";

/**
 * CHANNEL_VIDEO_SCRIPT performs no external evidence retrieval: it reasons over
 * the approved video brief and the discovery evidence that brief's upstream
 * content-intelligence run already paid for. Its provider-request and quota
 * ceilings are therefore zero, and only model calls consume budget. Ceilings
 * stay inside the database maxima enforced by `ensure_research_run_budget`, so no
 * global limit is widened.
 */
export function channelVideoScriptConfig() {
  return {
    // No searches, no YouTube requests, no quota units. Stated explicitly so a
    // future change that adds retrieval has to raise them deliberately.
    maxAggregateProviderRequests: 0,
    maxAggregateProviderQuotaUnits: 0,
    maxAggregateSearches: 0,
    modelTimeoutMs: boundedInteger("VIDEO_SCRIPT_MODEL_TIMEOUT_MS", 120_000, 5_000, 180_000),
    // Scripts carry spoken narration, so the output allowance is larger than the
    // brief's while staying inside the durable-output ceiling.
    modelMaxOutputTokens: boundedInteger("VIDEO_SCRIPT_MODEL_MAX_OUTPUT_TOKENS", 18_000, 2_000, 24_000),
    // Worst-case model-call graph (each QA/critic call increments qaCalls, each
    // generation increments synthesisCalls, each revision increments
    // revisionCalls):
    //   generation (draft)          synthesisCalls: 1  (step maxAttempts 2 -> up to 2)
    //   initial QA: critic + QA      qaCalls: 2         (step maxAttempts 2 -> up to 4)
    //   bounded revision (if any)    revisionCalls: 1   (step maxAttempts 2 -> up to 2)
    //   final QA: critic + QA        qaCalls: 2         (step maxAttempts 2 -> up to 4)
    // So a normal no-retry path needs 4 QA calls, and the full allowed-retry path
    // needs up to 8. The minimum below (4) guarantees the normal path completes;
    // the default (8) supports the full retry policy; both stay <= the database
    // ceiling of 12.
    maxAggregateSynthesisCalls: boundedInteger("VIDEO_SCRIPT_MAX_AGGREGATE_SYNTHESIS_CALLS", 4, 2, 6),
    maxAggregateQaCalls: boundedInteger("VIDEO_SCRIPT_MAX_AGGREGATE_QA_CALLS", 8, 4, 12),
    maxAggregateRevisionCalls: boundedInteger("VIDEO_SCRIPT_MAX_AGGREGATE_REVISION_CALLS", 2, 1, 4),
    maxAggregateInputTokens: boundedInteger("VIDEO_SCRIPT_MAX_AGGREGATE_INPUT_TOKENS", 700_000, 20_000, 1_000_000),
    // Headroom for up to ~12 model calls under reserve-before-call accounting,
    // which checks used-actuals + one call's ceiling against the limit.
    maxAggregateOutputTokens: boundedInteger("VIDEO_SCRIPT_MAX_AGGREGATE_OUTPUT_TOKENS", 96_000, 4_000, 100_000),
    maxAggregateTotalTokens: boundedInteger("VIDEO_SCRIPT_MAX_AGGREGATE_TOTAL_TOKENS", 796_000, 24_000, 1_100_000),
    /** Margin below the engine's 64 KiB durable-output limit; QA fails first with a typed code. */
    maxResultPayloadBytes: 60_000,
  };
}

export type ChannelVideoScriptBudget = ReturnType<typeof channelVideoScriptConfig>;
