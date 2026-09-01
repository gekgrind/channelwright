import { boundedIntegerEnv as boundedInteger } from "@/server/config";

/**
 * CHANNEL_VIDEO_RELEASE performs no external evidence retrieval: it reasons over
 * the approved video packaging and the discovery evidence that packaging's
 * upstream content-intelligence run already paid for. Its provider-request and
 * quota ceilings are therefore zero, and only model calls consume budget.
 * Ceilings stay inside the database maxima enforced by
 * `ensure_research_run_budget`, so no global limit is widened.
 */
/**
 * The 100,000-output-token safety ceiling enforced by `ensure_research_run_budget`
 * (migration 202608130004). The resolved aggregate output budget can never exceed
 * it, and neither can the worst-case retry graph.
 */
const DATABASE_OUTPUT_CEILING = 100_000;

/** Structural worst-case call counts, fixed by the workflow graph (each step maxAttempts 2). */
const WORST_CASE_RELEASE_CALLS = 4; // 2 GENERATOR (draft) + 2 REVISION
const WORST_CASE_REVIEW_CALLS = 8; // initial + final QA, each critic + semantic

export function channelVideoReleaseConfig() {
  // The flat per-call output ceiling was removed in favour of the role-split
  // ceilings below. Fail fast rather than silently ignore a value an existing
  // deployment may still set, which would quietly change its per-call spend.
  if ((process.env.VIDEO_RELEASE_MODEL_MAX_OUTPUT_TOKENS ?? "").trim() !== "") {
    throw new Error("VIDEO_RELEASE_MODEL_MAX_OUTPUT_TOKENS is no longer supported; set VIDEO_RELEASE_RELEASE_OUTPUT_TOKENS (GENERATOR/REVISION) and VIDEO_RELEASE_REVIEW_OUTPUT_TOKENS (CRITIC/QA) instead.");
  }

  // Output ceilings are reserved BEFORE each call and a failed call is settled at
  // its full reservation (conservative), so the worst-case retry path must fit
  // inside maxAggregateOutputTokens. The two roles that emit a whole release
  // record (GENERATOR draft, REVISION) get the large allowance; the review roles
  // (CRITIC, QA) emit only structured findings and get a much smaller one.
  const modelReleaseOutputTokens = boundedInteger("VIDEO_RELEASE_RELEASE_OUTPUT_TOKENS", 12_000, 2_000, 20_000);
  const modelReviewOutputTokens = boundedInteger("VIDEO_RELEASE_REVIEW_OUTPUT_TOKENS", 4_000, 1_000, 8_000);
  const maxAggregateInputTokens = boundedInteger("VIDEO_RELEASE_MAX_AGGREGATE_INPUT_TOKENS", 700_000, 20_000, 1_000_000);
  const maxAggregateOutputTokens = boundedInteger("VIDEO_RELEASE_MAX_AGGREGATE_OUTPUT_TOKENS", 96_000, 4_000, 100_000);
  const maxAggregateTotalTokens = boundedInteger("VIDEO_RELEASE_MAX_AGGREGATE_TOTAL_TOKENS", 796_000, 24_000, 1_100_000);

  // Cross-field invariant on the RESOLVED values: individual bounds are not enough
  // because legal overrides can still combine into an impossible budget. The full
  // 12-call retry graph reserves WORST_CASE_RELEASE_CALLS release ceilings plus
  // WORST_CASE_REVIEW_CALLS review ceilings, every reservation must fit the
  // aggregate output budget, and that budget must stay within the database ceiling.
  const worstCaseOutput = WORST_CASE_RELEASE_CALLS * modelReleaseOutputTokens + WORST_CASE_REVIEW_CALLS * modelReviewOutputTokens;
  if (maxAggregateOutputTokens > DATABASE_OUTPUT_CEILING) {
    throw new Error(`VIDEO_RELEASE budget invalid: maxAggregateOutputTokens ${maxAggregateOutputTokens} exceeds the ${DATABASE_OUTPUT_CEILING} database output ceiling.`);
  }
  if (worstCaseOutput > maxAggregateOutputTokens) {
    throw new Error(`VIDEO_RELEASE budget invalid: the full retry graph reserves ${worstCaseOutput} output tokens (${WORST_CASE_RELEASE_CALLS}*${modelReleaseOutputTokens} + ${WORST_CASE_REVIEW_CALLS}*${modelReviewOutputTokens}) but maxAggregateOutputTokens is ${maxAggregateOutputTokens}. Lower the role ceilings or raise VIDEO_RELEASE_MAX_AGGREGATE_OUTPUT_TOKENS (<= ${DATABASE_OUTPUT_CEILING}).`);
  }
  // Each call reserves totalTokens = inputCeiling + outputCeiling, so the aggregate
  // total ceiling must contain the aggregate input and output ceilings or it would
  // reject a valid run before either component ceiling is reached.
  if (maxAggregateTotalTokens < maxAggregateInputTokens + maxAggregateOutputTokens) {
    throw new Error(`VIDEO_RELEASE budget invalid: maxAggregateTotalTokens ${maxAggregateTotalTokens} is below maxAggregateInputTokens + maxAggregateOutputTokens (${maxAggregateInputTokens + maxAggregateOutputTokens}).`);
  }

  return {
    // No searches, no YouTube requests, no quota units. Stated explicitly so a
    // future change that adds retrieval has to raise them deliberately.
    maxAggregateProviderRequests: 0,
    maxAggregateProviderQuotaUnits: 0,
    maxAggregateSearches: 0,
    modelTimeoutMs: boundedInteger("VIDEO_RELEASE_MODEL_TIMEOUT_MS", 120_000, 5_000, 180_000),
    modelScriptOutputTokens: modelReleaseOutputTokens,
    modelReviewOutputTokens,
    // Worst-case model-call graph mirrors CHANNEL_VIDEO_PACKAGING: 4 QA calls on
    // the no-retry path, up to 8 on the full allowed-retry path; both stay <= the
    // database ceiling of 12.
    maxAggregateSynthesisCalls: boundedInteger("VIDEO_RELEASE_MAX_AGGREGATE_SYNTHESIS_CALLS", 4, 2, 6),
    maxAggregateQaCalls: boundedInteger("VIDEO_RELEASE_MAX_AGGREGATE_QA_CALLS", 8, 4, 12),
    maxAggregateRevisionCalls: boundedInteger("VIDEO_RELEASE_MAX_AGGREGATE_REVISION_CALLS", 2, 1, 4),
    maxAggregateInputTokens,
    maxAggregateOutputTokens,
    maxAggregateTotalTokens,
    /** Margin below the engine's 64 KiB durable-output limit; QA fails first with a typed code. */
    maxResultPayloadBytes: 60_000,
  };
}

export type ChannelVideoReleaseBudget = ReturnType<typeof channelVideoReleaseConfig>;
