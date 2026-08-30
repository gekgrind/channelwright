import { afterEach, describe, expect, it } from "vitest";
import { channelVideoScriptConfig } from "./video-script-config";

/**
 * The VIDEO_SCRIPT model-call graph (see video-script-config.ts):
 *   normal no-retry path = 4 QA-kind calls (initial critic+QA, final critic+QA)
 *   full allowed-retry path = up to 8 QA-kind calls
 * A schema-permitted configuration must be able to complete the path it authorizes.
 */
const QA_ENV = "VIDEO_SCRIPT_MAX_AGGREGATE_QA_CALLS";
const NORMAL_PATH_QA_CALLS = 4;
const FULL_RETRY_QA_CALLS = 8;

afterEach(() => { delete process.env[QA_ENV]; });

describe("VIDEO_SCRIPT QA budget matches the real call graph (defect #4)", () => {
  it("defaults to enough QA calls for the full retry policy", () => {
    expect(channelVideoScriptConfig().maxAggregateQaCalls).toBe(FULL_RETRY_QA_CALLS);
  });

  it("the minimum legal configuration still completes the normal path", () => {
    process.env[QA_ENV] = String(NORMAL_PATH_QA_CALLS);
    expect(channelVideoScriptConfig().maxAggregateQaCalls).toBe(NORMAL_PATH_QA_CALLS);
  });

  it("rejects a configuration below the normal-path minimum", () => {
    process.env[QA_ENV] = String(NORMAL_PATH_QA_CALLS - 1); // 3 — the old, impossible default
    expect(() => channelVideoScriptConfig()).toThrow(/between 4 and 12/);
  });

  it("rejects a configuration above the database ceiling", () => {
    process.env[QA_ENV] = "13";
    expect(() => channelVideoScriptConfig()).toThrow(/between 4 and 12/);
  });

  it("keeps synthesis, revision, and QA ceilings within the database maxima", () => {
    const budget = channelVideoScriptConfig();
    expect(budget.maxAggregateSynthesisCalls).toBeGreaterThanOrEqual(2); // 1 draft, up to 2 with retry
    expect(budget.maxAggregateRevisionCalls).toBeGreaterThanOrEqual(1);
    expect(budget.maxAggregateQaCalls).toBeLessThanOrEqual(12);
    // Zero external retrieval remains fixed.
    expect(budget.maxAggregateProviderRequests).toBe(0);
    expect(budget.maxAggregateSearches).toBe(0);
  });
});

describe("VIDEO_SCRIPT budget enforces a cross-field invariant on resolved values (P1)", () => {
  const BUDGET_ENVS = [
    "VIDEO_SCRIPT_SCRIPT_OUTPUT_TOKENS",
    "VIDEO_SCRIPT_REVIEW_OUTPUT_TOKENS",
    "VIDEO_SCRIPT_MAX_AGGREGATE_OUTPUT_TOKENS",
    "VIDEO_SCRIPT_MAX_AGGREGATE_INPUT_TOKENS",
    "VIDEO_SCRIPT_MAX_AGGREGATE_TOTAL_TOKENS",
    "VIDEO_SCRIPT_MODEL_MAX_OUTPUT_TOKENS",
  ];
  afterEach(() => { for (const key of BUDGET_ENVS) delete process.env[key]; });

  it("accepts the defaults (graph 92000 <= 96000 <= 100000)", () => {
    const budget = channelVideoScriptConfig();
    expect(4 * budget.modelScriptOutputTokens + 8 * budget.modelReviewOutputTokens).toBe(92_000);
  });

  it("accepts a safe non-default configuration (lowered role ceilings)", () => {
    process.env.VIDEO_SCRIPT_SCRIPT_OUTPUT_TOKENS = "12000";
    process.env.VIDEO_SCRIPT_REVIEW_OUTPUT_TOKENS = "3000";
    const budget = channelVideoScriptConfig();
    // 4*12000 + 8*3000 = 72000 <= 96000.
    expect(4 * budget.modelScriptOutputTokens + 8 * budget.modelReviewOutputTokens).toBe(72_000);
  });

  it("rejects individually-legal role ceilings whose graph exceeds the aggregate (script 20000, review 8000)", () => {
    process.env.VIDEO_SCRIPT_SCRIPT_OUTPUT_TOKENS = "20000";
    process.env.VIDEO_SCRIPT_REVIEW_OUTPUT_TOKENS = "8000";
    // 4*20000 + 8*8000 = 144000 > 96000.
    expect(() => channelVideoScriptConfig()).toThrow(/full retry graph reserves 144000/);
  });

  it("rejects an aggregate ceiling below the retry graph (aggregate 4000)", () => {
    process.env.VIDEO_SCRIPT_MAX_AGGREGATE_OUTPUT_TOKENS = "4000";
    // Defaults graph 92000 > 4000.
    expect(() => channelVideoScriptConfig()).toThrow(/full retry graph reserves 92000/);
  });

  it("rejects a total ceiling that cannot contain input + output", () => {
    // 100000 output fits the graph and the DB ceiling, but 700000 + 100000 = 800000 > 796000 default total.
    process.env.VIDEO_SCRIPT_MAX_AGGREGATE_OUTPUT_TOKENS = "100000";
    expect(() => channelVideoScriptConfig()).toThrow(/maxAggregateTotalTokens .* is below/);
  });

  it("rejects the removed flat output-token env var instead of ignoring it (P2)", () => {
    process.env.VIDEO_SCRIPT_MODEL_MAX_OUTPUT_TOKENS = "18000";
    expect(() => channelVideoScriptConfig()).toThrow(/VIDEO_SCRIPT_MODEL_MAX_OUTPUT_TOKENS is no longer supported/);
  });
});
