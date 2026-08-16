import { afterEach, describe, expect, it, vi } from "vitest";
import { assertChannelStrategyModelConfig, channelStrategyConfig } from "./strategy-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("channel strategy budget", () => {
  it("defaults to bounded model limits and forbids provider retrieval", () => {
    expect(channelStrategyConfig()).toEqual({
      modelTimeoutMs: 60_000, modelMaxOutputTokens: 9_000,
      maxAggregateProviderRequests: 0, maxAggregateProviderQuotaUnits: 0, maxAggregateSearches: 0,
      maxAggregateSynthesisCalls: 1, maxAggregateQaCalls: 2, maxAggregateRevisionCalls: 1,
      maxAggregateInputTokens: 320_000, maxAggregateOutputTokens: 36_000, maxAggregateTotalTokens: 356_000,
      maxSynthesisCalls: 1, maxQaCalls: 2, maxRevisionCalls: 1,
    });
  });

  it("accepts in-range overrides", () => {
    vi.stubEnv("CHANNEL_STRATEGY_MODEL_TIMEOUT_MS", "90000");
    vi.stubEnv("CHANNEL_STRATEGY_MAX_AGGREGATE_QA_CALLS", "4");
    expect(channelStrategyConfig()).toMatchObject({ modelTimeoutMs: 90_000, maxAggregateQaCalls: 4 });
  });

  it.each([
    ["CHANNEL_STRATEGY_MODEL_TIMEOUT_MS", "4999"],
    ["CHANNEL_STRATEGY_MODEL_TIMEOUT_MS", "120001"],
    ["CHANNEL_STRATEGY_MODEL_MAX_OUTPUT_TOKENS", "1999"],
    ["CHANNEL_STRATEGY_MAX_AGGREGATE_QA_CALLS", "1"],
    ["CHANNEL_STRATEGY_MAX_AGGREGATE_SYNTHESIS_CALLS", "3"],
    ["CHANNEL_STRATEGY_MAX_AGGREGATE_TOTAL_TOKENS", "not-a-number"],
    ["CHANNEL_STRATEGY_MAX_AGGREGATE_INPUT_TOKENS", "20000.5"],
  ])("rejects out-of-range %s=%s", (name, value) => {
    vi.stubEnv(name, value);
    expect(() => channelStrategyConfig()).toThrow(new RegExp(`${name} must be an integer between`));
  });
});

describe("channel strategy model credentials", () => {
  it("requires an AI credential without exposing it in the failure", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => assertChannelStrategyModelConfig()).toThrowError(expect.objectContaining({ code: "AI_CREDENTIALS_MISSING", retryable: false }));
  });

  it("prefers strategy-specific models and falls back through shared model settings", () => {
    vi.stubEnv("OPENAI_API_KEY", " strategy-key ");
    vi.stubEnv("OPENAI_STRATEGY_SYNTHESIS_MODEL", "strategy-synthesis");
    vi.stubEnv("OPENAI_STRATEGY_QA_MODEL", "strategy-qa");
    expect(assertChannelStrategyModelConfig()).toEqual({ openAiApiKey: "strategy-key", synthesisModel: "strategy-synthesis", qaModel: "strategy-qa" });

    vi.stubEnv("OPENAI_STRATEGY_SYNTHESIS_MODEL", "");
    vi.stubEnv("OPENAI_STRATEGY_QA_MODEL", "");
    vi.stubEnv("OPENAI_SYNTHESIS_MODEL", "shared-synthesis");
    vi.stubEnv("OPENAI_QA_MODEL", "shared-qa");
    expect(assertChannelStrategyModelConfig()).toMatchObject({ synthesisModel: "shared-synthesis", qaModel: "shared-qa" });

    vi.stubEnv("OPENAI_SYNTHESIS_MODEL", "");
    vi.stubEnv("OPENAI_QA_MODEL", "");
    vi.stubEnv("OPENAI_MODEL", "generic-model");
    expect(assertChannelStrategyModelConfig()).toMatchObject({ synthesisModel: "generic-model", qaModel: "generic-model" });
  });
});
