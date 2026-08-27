import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { assertDistinctRoleProviders, EnvironmentRoleRouter, ModelRoutingError, StaticRoleRouter, resolveRoleModel, resolveRoleProvider } from "./role-router";
import type { ModelInvocationContext, ModelInvocationResult, StructuredModelProvider } from "./provider";

const KEYS = [
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_MODEL", "ANTHROPIC_MODEL",
  "CHANNELWRIGHT_DEFAULT_PROVIDER", "CONTENT_DEFAULT_PROVIDER",
  "CONTENT_GENERATOR_PROVIDER", "CONTENT_CRITIC_PROVIDER", "CONTENT_QA_PROVIDER", "CONTENT_REVISION_PROVIDER",
  "CONTENT_GENERATOR_MODEL", "CONTENT_CRITIC_MODEL", "CONTENT_QA_MODEL", "CONTENT_REVISION_MODEL",
  "OPENAI_CONTENT_MODEL", "ANTHROPIC_CONTENT_MODEL",
] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const clear = () => { for (const key of KEYS) delete process.env[key]; };

afterEach(() => {
  clear();
  for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
});

const credentials = () => { process.env.OPENAI_API_KEY = "o"; process.env.ANTHROPIC_API_KEY = "a"; };

describe("role provider resolution", () => {
  it("defaults to OpenAI when nothing is configured", () => {
    clear();
    expect(resolveRoleProvider("CONTENT", "GENERATOR")).toBe("openai");
  });

  it("resolves most specific first: role, then namespace, then global", () => {
    clear();
    process.env.CHANNELWRIGHT_DEFAULT_PROVIDER = "openai";
    expect(resolveRoleProvider("CONTENT", "CRITIC")).toBe("openai");
    process.env.CONTENT_DEFAULT_PROVIDER = "anthropic";
    expect(resolveRoleProvider("CONTENT", "CRITIC")).toBe("anthropic");
    process.env.CONTENT_CRITIC_PROVIDER = "openai";
    expect(resolveRoleProvider("CONTENT", "CRITIC")).toBe("openai");
  });

  it("routes roles independently, which is what makes the split configurable", () => {
    clear();
    process.env.CONTENT_GENERATOR_PROVIDER = "openai";
    process.env.CONTENT_CRITIC_PROVIDER = "anthropic";
    process.env.CONTENT_QA_PROVIDER = "anthropic";
    process.env.CONTENT_REVISION_PROVIDER = "openai";
    expect(resolveRoleProvider("CONTENT", "GENERATOR")).toBe("openai");
    expect(resolveRoleProvider("CONTENT", "CRITIC")).toBe("anthropic");
    expect(resolveRoleProvider("CONTENT", "QA")).toBe("anthropic");
    expect(resolveRoleProvider("CONTENT", "REVISION")).toBe("openai");
  });

  it("rejects an unsupported provider loudly instead of silently falling back", () => {
    clear();
    process.env.CONTENT_CRITIC_PROVIDER = "some-other-vendor";
    expect(() => resolveRoleProvider("CONTENT", "CRITIC")).toThrowError(ModelRoutingError);
    try { resolveRoleProvider("CONTENT", "CRITIC"); } catch (error) {
      expect((error as ModelRoutingError).code).toBe("AI_PROVIDER_INVALID");
    }
  });

  it("keeps namespaces independent so research and strategy are unaffected by content routing", () => {
    clear();
    process.env.CONTENT_DEFAULT_PROVIDER = "anthropic";
    expect(resolveRoleProvider("CONTENT", "GENERATOR")).toBe("anthropic");
    expect(resolveRoleProvider("RESEARCH", "GENERATOR")).toBe("openai");
    expect(resolveRoleProvider("STRATEGY", "GENERATOR")).toBe("openai");
  });
});

describe("role model resolution", () => {
  it("never assumes a default model identifier", () => {
    clear();
    expect(() => resolveRoleModel("CONTENT", "CRITIC", "anthropic")).toThrowError(ModelRoutingError);
    try { resolveRoleModel("CONTENT", "CRITIC", "anthropic"); } catch (error) {
      expect((error as ModelRoutingError).code).toBe("AI_MODEL_NOT_CONFIGURED");
      expect((error as Error).message).toContain("ANTHROPIC_MODEL");
    }
  });

  it("resolves role model, then provider-namespace model, then provider model", () => {
    clear();
    process.env.ANTHROPIC_MODEL = "vendor-default";
    expect(resolveRoleModel("CONTENT", "CRITIC", "anthropic")).toBe("vendor-default");
    process.env.ANTHROPIC_CONTENT_MODEL = "vendor-content";
    expect(resolveRoleModel("CONTENT", "CRITIC", "anthropic")).toBe("vendor-content");
    process.env.CONTENT_CRITIC_MODEL = "role-specific";
    expect(resolveRoleModel("CONTENT", "CRITIC", "anthropic")).toBe("role-specific");
  });

  it("keeps each provider's model configuration separate", () => {
    clear();
    process.env.OPENAI_MODEL = "openai-one";
    process.env.ANTHROPIC_MODEL = "anthropic-one";
    expect(resolveRoleModel("CONTENT", "GENERATOR", "openai")).toBe("openai-one");
    expect(resolveRoleModel("CONTENT", "CRITIC", "anthropic")).toBe("anthropic-one");
  });
});

describe("EnvironmentRoleRouter", () => {
  it("builds the configured adapter per role and reports the assignment", () => {
    clear();
    credentials();
    process.env.CONTENT_GENERATOR_PROVIDER = "openai";
    process.env.CONTENT_CRITIC_PROVIDER = "anthropic";
    process.env.OPENAI_MODEL = "gen";
    process.env.ANTHROPIC_MODEL = "crit";
    const router = new EnvironmentRoleRouter("CONTENT");
    expect(router.forRole("GENERATOR").id).toBe("openai");
    expect(router.forRole("CRITIC").id).toBe("anthropic");
    expect(router.describe(["GENERATOR", "CRITIC"])).toEqual([
      { role: "GENERATOR", provider: "openai", model: "gen" },
      { role: "CRITIC", provider: "anthropic", model: "crit" },
    ]);
  });

  it("fails loudly when the credential for a routed provider is absent", () => {
    clear();
    process.env.OPENAI_API_KEY = "o";
    process.env.CONTENT_CRITIC_PROVIDER = "anthropic";
    process.env.ANTHROPIC_MODEL = "crit";
    const router = new EnvironmentRoleRouter("CONTENT");
    try { router.forRole("CRITIC"); expect.unreachable("expected AI_CREDENTIALS_MISSING"); } catch (error) {
      expect((error as ModelRoutingError).code).toBe("AI_CREDENTIALS_MISSING");
    }
  });

  it("reuses one adapter instance per role", () => {
    clear();
    credentials();
    process.env.OPENAI_MODEL = "gen";
    const router = new EnvironmentRoleRouter("CONTENT");
    expect(router.forRole("GENERATOR")).toBe(router.forRole("GENERATOR"));
  });
});

describe("StaticRoleRouter", () => {
  const stub = (id: "openai" | "anthropic", model: string): StructuredModelProvider => ({
    id, model,
    invoke: <T>() => Promise.resolve({ value: undefined as T, usage: { model, inputTokens: 0, outputTokens: 0, totalTokens: 0 }, provider: id, model, rawUsage: {} } as ModelInvocationResult<T>),
  });

  it("serves explicit assignments and a fallback", () => {
    const router = new StaticRoleRouter({ CRITIC: stub("anthropic", "c") }, stub("openai", "g"));
    expect(router.forRole("CRITIC").id).toBe("anthropic");
    expect(router.forRole("GENERATOR").id).toBe("openai");
  });

  it("refuses an unrouted role rather than guessing", () => {
    const router = new StaticRoleRouter({ CRITIC: stub("anthropic", "c") });
    expect(() => router.forRole("GENERATOR")).toThrowError(ModelRoutingError);
  });

  it("satisfies the same provider contract as the real adapters", async () => {
    const router = new StaticRoleRouter({}, stub("openai", "g"));
    const provider = router.forRole("QA");
    const result = await provider.invoke(z.unknown(), { operation: "x", role: "QA", system: "s", payload: {}, maxOutputTokens: 10, timeoutMs: 10 } satisfies ModelInvocationContext);
    expect(result.provider).toBe("openai");
  });
});

describe("cross-provider independence enforcement", () => {
  const stub = (id: "openai" | "anthropic", model: string): StructuredModelProvider => ({
    id, model,
    invoke: <T>() => Promise.resolve({ value: undefined as T, usage: { model, inputTokens: 0, outputTokens: 0, totalTokens: 0 }, provider: id, model, rawUsage: {} } as ModelInvocationResult<T>),
  });

  it("accepts a valid generator/critic split across providers", () => {
    const router = new StaticRoleRouter({ GENERATOR: stub("openai", "g"), CRITIC: stub("anthropic", "c") });
    expect(() => assertDistinctRoleProviders(router, "GENERATOR", "CRITIC")).not.toThrow();
  });

  it("fails closed when both roles resolve to the same provider", () => {
    const router = new StaticRoleRouter({ GENERATOR: stub("openai", "g"), CRITIC: stub("openai", "c") });
    try { assertDistinctRoleProviders(router, "GENERATOR", "CRITIC"); expect.unreachable("expected AI_PROVIDER_INDEPENDENCE_REQUIRED"); }
    catch (error) { expect((error as ModelRoutingError).code).toBe("AI_PROVIDER_INDEPENDENCE_REQUIRED"); }
  });

  it("reproduces the default-both-to-openai collapse and rejects it", () => {
    clear();
    credentials();
    process.env.OPENAI_MODEL = "one-model";
    // No VIDEO_SCRIPT provider vars → both roles default to openai.
    const router = new EnvironmentRoleRouter("VIDEO_SCRIPT");
    try { assertDistinctRoleProviders(router, "GENERATOR", "CRITIC"); expect.unreachable("expected independence rejection"); }
    catch (error) { expect((error as ModelRoutingError).code).toBe("AI_PROVIDER_INDEPENDENCE_REQUIRED"); }
  });

  it("still fails closed for missing model configuration before checking independence", () => {
    clear();
    credentials();
    const router = new EnvironmentRoleRouter("VIDEO_SCRIPT");
    try { assertDistinctRoleProviders(router, "GENERATOR", "CRITIC"); expect.unreachable("expected AI_MODEL_NOT_CONFIGURED"); }
    catch (error) { expect((error as ModelRoutingError).code).toBe("AI_MODEL_NOT_CONFIGURED"); }
  });
});

describe("routing is server controlled", () => {
  it("resolves only from environment configuration, never from a caller-supplied value", () => {
    clear();
    credentials();
    process.env.OPENAI_MODEL = "gen";
    const router = new EnvironmentRoleRouter("CONTENT");
    // The router exposes no seam for a request payload to influence provider choice.
    expect(Object.keys(router)).not.toContain("request");
    expect(vi.isMockFunction(router.forRole)).toBe(false);
    expect(router.forRole("GENERATOR").id).toBe("openai");
  });
});
