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
