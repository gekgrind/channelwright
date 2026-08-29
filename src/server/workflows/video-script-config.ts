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
    // Output ceilings are reserved BEFORE each call and a failed call is settled at
    // its full reservation (conservative), so the worst-case retry path must fit
    // inside maxAggregateOutputTokens. A single flat ceiling could not: 12 calls x
    // 18,000 = 216,000 tokens, far above the 100,000 database maximum. The two
    // roles that emit a whole script (GENERATOR draft, REVISION) get the large
    // allowance; the review roles (CRITIC, QA) emit only structured findings and
    // get a much smaller one. See video-script-model.ts (reservation is role-keyed)
    // and video-script-budget.test.ts (walks the worst-case sequence).
    //
    //   GENERATOR: draft step maxAttempts 2 -> up to 2 script-output calls
    //   REVISION : revision step maxAttempts 2 -> up to 2 script-output calls
    //   CRITIC+QA: initial + final QA, each critic + semantic, maxAttempts 2
    //              -> up to 8 review-output calls
    //   worst case output = 4*15,000 + 8*4,000 = 92,000 <= 96,000 <= 100,000 (DB)
    modelScriptOutputTokens: boundedInteger("VIDEO_SCRIPT_SCRIPT_OUTPUT_TOKENS", 15_000, 2_000, 20_000),
    modelReviewOutputTokens: boundedInteger("VIDEO_SCRIPT_REVIEW_OUTPUT_TOKENS", 4_000, 1_000, 8_000),
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
    // The role-keyed reservations above make the full 12-call retry path (4 script
    // + 8 review) sum to 92,000 output tokens, inside this ceiling and the 100,000
    // database maximum even when every call is charged its full reservation.
    maxAggregateOutputTokens: boundedInteger("VIDEO_SCRIPT_MAX_AGGREGATE_OUTPUT_TOKENS", 96_000, 4_000, 100_000),
    maxAggregateTotalTokens: boundedInteger("VIDEO_SCRIPT_MAX_AGGREGATE_TOTAL_TOKENS", 796_000, 24_000, 1_100_000),
    /** Margin below the engine's 64 KiB durable-output limit; QA fails first with a typed code. */
    maxResultPayloadBytes: 60_000,
  };
}

export type ChannelVideoScriptBudget = ReturnType<typeof channelVideoScriptConfig>;
