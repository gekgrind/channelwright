import { afterEach, describe, expect, it } from "vitest";
import { aggregateResearchLimits, ResearchBudgetError } from "./research-usage";
import { assertChannelStrategyModelConfig, channelStrategyConfig, StrategyConfigurationError } from "./strategy-config";
import { assertChannelResearchProviderConfig, channelResearchConfig, ResearchConfigurationError } from "./research-config";

const modelKeys = ["OPENAI_API_KEY", "YOUTUBE_DATA_API_KEY", "OPENAI_MODEL", "OPENAI_SYNTHESIS_MODEL", "OPENAI_QA_MODEL", "OPENAI_STRATEGY_SYNTHESIS_MODEL", "OPENAI_STRATEGY_QA_MODEL"] as const;
const saved = Object.fromEntries(modelKeys.map((key) => [key, process.env[key]]));
const clear = () => { for (const key of modelKeys) delete process.env[key]; };

afterEach(() => {
  clear();
  for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
});

describe("CHANNEL_STRATEGY durable budget shape", () => {
  it("grants zero YouTube provider, quota, and search allowance", () => {
    const limits = aggregateResearchLimits(channelStrategyConfig());
    expect(limits.providerRequests).toBe(0);
    expect(limits.providerQuotaUnits).toBe(0);
    expect(limits.searches).toBe(0);
  });

  it("bounds model spend and permits exactly one automated revision", () => {
    const limits = aggregateResearchLimits(channelStrategyConfig());
    expect(limits).toMatchObject({ synthesisCalls: 1, qaCalls: 2, revisionCalls: 1, automatedRevisions: 1 });
    expect(limits.totalTokens).toBe(356_000);
    expect(Object.keys(limits)).toHaveLength(10);
  });

  it("keeps research provider allowance non-zero so the strategy zeroing is deliberate", () => {
    const limits = aggregateResearchLimits(channelResearchConfig());
    expect(limits.providerRequests).toBeGreaterThan(0);
    expect(limits.searches).toBeGreaterThan(0);
  });

  it("types exhaustion per workflow and keeps it terminal", () => {
    const strategy = new ResearchBudgetError("RESEARCH_RESOURCE_BUDGET_EXHAUSTED:inputTokens", "CHANNEL_STRATEGY");
    const research = new ResearchBudgetError("RESEARCH_RESOURCE_BUDGET_EXHAUSTED:searches", "CHANNEL_RESEARCH");
    const videoBrief = new ResearchBudgetError("RESEARCH_RESOURCE_BUDGET_EXHAUSTED:totalTokens", "CHANNEL_VIDEO_BRIEF");
    expect(strategy.code).toBe("STRATEGY_RESOURCE_BUDGET_EXHAUSTED");
    expect(research.code).toBe("RESEARCH_RESOURCE_BUDGET_EXHAUSTED");
    expect(videoBrief.code).toBe("VIDEO_BRIEF_RESOURCE_BUDGET_EXHAUSTED");
    expect(strategy.retryable).toBe(false);
    expect(research.retryable).toBe(false);
    expect(videoBrief.retryable).toBe(false);
  });
});

describe("provider-backed model configuration fails closed", () => {
  it("refuses strategy execution when no model is configured", () => {
    clear();
    process.env.OPENAI_API_KEY = "test-key";
    expect(() => assertChannelStrategyModelConfig()).toThrowError(StrategyConfigurationError);
    try { assertChannelStrategyModelConfig(); } catch (error) {
      expect((error as StrategyConfigurationError).code).toBe("AI_MODEL_NOT_CONFIGURED");
      expect((error as StrategyConfigurationError).retryable).toBe(false);
    }
  });

  it("refuses research execution when no model is configured", () => {
    clear();
    process.env.OPENAI_API_KEY = "test-key";
    process.env.YOUTUBE_DATA_API_KEY = "test-key";
    try { assertChannelResearchProviderConfig(); expect.unreachable("expected AI_MODEL_NOT_CONFIGURED"); } catch (error) {
      expect((error as ResearchConfigurationError).code).toBe("AI_MODEL_NOT_CONFIGURED");
    }
  });

  it("never substitutes a placeholder model identifier", () => {
    clear();
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "operator-selected-model";
    expect(assertChannelStrategyModelConfig()).toMatchObject({ synthesisModel: "operator-selected-model", qaModel: "operator-selected-model" });
  });

  it("narrows strategy models from specific to shared configuration", () => {
    clear();
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "shared";
    process.env.OPENAI_SYNTHESIS_MODEL = "research-synthesis";
    process.env.OPENAI_QA_MODEL = "research-qa";
    expect(assertChannelStrategyModelConfig()).toMatchObject({ synthesisModel: "research-synthesis", qaModel: "research-qa" });
    process.env.OPENAI_STRATEGY_SYNTHESIS_MODEL = "strategy-synthesis";
    process.env.OPENAI_STRATEGY_QA_MODEL = "strategy-qa";
    expect(assertChannelStrategyModelConfig()).toMatchObject({ synthesisModel: "strategy-synthesis", qaModel: "strategy-qa" });
  });

  it("falls back QA to the resolved synthesis model rather than inventing one", () => {
    clear();
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_STRATEGY_SYNTHESIS_MODEL = "strategy-only";
    expect(assertChannelStrategyModelConfig()).toMatchObject({ synthesisModel: "strategy-only", qaModel: "strategy-only" });
  });

  it("still requires the provider credential before the model", () => {
    clear();
    try { assertChannelStrategyModelConfig(); expect.unreachable("expected AI_CREDENTIALS_MISSING"); } catch (error) {
      expect((error as StrategyConfigurationError).code).toBe("AI_CREDENTIALS_MISSING");
    }
  });
});
