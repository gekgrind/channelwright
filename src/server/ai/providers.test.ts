import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AnthropicStructuredProvider, ANTHROPIC_VERSION } from "./anthropic-provider";
import { OpenAIStructuredProvider } from "./openai-provider";
import { ModelProviderError, toProviderJsonSchema, type ModelInvocationContext } from "./provider";

const schema = z.object({ verdict: z.enum(["good", "bad"]), note: z.string().min(1).max(50) }).strict();
const context: ModelInvocationContext = {
  operation: "content_cross_model_critique", role: "CRITIC",
  system: "You are a reviewer.", payload: { backlog: "x" },
  maxOutputTokens: 2_000, timeoutMs: 5_000,
};

function fetcherFor(response: { ok?: boolean; status?: number; body?: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
      text: async () => JSON.stringify(response.body ?? {}),
    } as Response;
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const openAiOk = (value: unknown, model = "gen-model") => ({
  body: { model, status: "completed", output_text: JSON.stringify(value), usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150, input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 5 } } },
});

const anthropicOk = (value: unknown, model = "critic-model") => ({
  body: { model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: context.operation, input: value }], usage: { input_tokens: 200, output_tokens: 40, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 } },
});

describe("shared provider contract", () => {
  it("produces one JSON Schema both adapters use, so contracts cannot drift per vendor", () => {
    const converted = toProviderJsonSchema(schema) as Record<string, unknown>;
    expect(converted.$schema).toBeUndefined();
    expect(converted.type).toBe("object");
    expect(Object.keys((converted.properties ?? {}) as object)).toEqual(["verdict", "note"]);
  });

  it("classifies infrastructure faults as retryable and configuration faults as neither", () => {
    expect(new ModelProviderError("TIMEOUT", "openai", "m", "x").retryable).toBe(true);
    expect(new ModelProviderError("RATE_LIMITED", "anthropic", "m", "x").retryable).toBe(true);
    expect(new ModelProviderError("PROVIDER_UNAVAILABLE", "openai", "m", "x").retryable).toBe(true);
    expect(new ModelProviderError("NETWORK_FAILED", "anthropic", "m", "x").retryable).toBe(true);
    for (const kind of ["AUTH_FAILED", "INVALID_MODEL"] as const) {
      const error = new ModelProviderError(kind, "openai", "m", "x");
      expect(error.retryable).toBe(false);
      expect(error.configurationFault).toBe(true);
    }
    for (const kind of ["SCHEMA_REJECTED", "MALFORMED_OUTPUT", "REFUSAL", "CONTEXT_LENGTH"] as const) {
      const error = new ModelProviderError(kind, "anthropic", "m", "x");
      expect(error.retryable).toBe(false);
      expect(error.configurationFault).toBe(false);
    }
    expect(new ModelProviderError("TIMEOUT", "openai", "m", "x").code).toBe("AI_TIMEOUT");
  });
});

describe("OpenAI structured provider", () => {
  it("returns a validated value with normalized and raw usage", async () => {
    const { fetcher, calls } = fetcherFor(openAiOk({ verdict: "good", note: "fine" }));
    const result = await new OpenAIStructuredProvider("key", "configured-model", fetcher).invoke(schema, context);
    expect(result.value).toEqual({ verdict: "good", note: "fine" });
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gen-model");
    expect(result.usage).toEqual({ model: "gen-model", inputTokens: 120, outputTokens: 30, totalTokens: 150 });
    expect(result.rawUsage).toMatchObject({ cached_tokens: 20, reasoning_tokens: 5 });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.text.format).toMatchObject({ type: "json_schema", name: context.operation, strict: true });
    expect(body.store).toBe(false);
  });

  it("maps provider status codes onto the shared taxonomy", async () => {
    const cases: Array<[number, unknown, string, boolean]> = [
      [401, {}, "AI_AUTH_FAILED", false],
      [429, {}, "AI_RATE_LIMITED", true],
      [503, {}, "AI_PROVIDER_UNAVAILABLE", true],
      [404, {}, "AI_INVALID_MODEL", false],
      [400, { error: { message: "maximum context length exceeded" } }, "AI_CONTEXT_LENGTH", false],
      [400, { error: { message: "bad request" } }, "AI_REQUEST_REJECTED", false],
    ];
    for (const [status, body, code, retryable] of cases) {
      const { fetcher } = fetcherFor({ ok: false, status, body });
      await expect(new OpenAIStructuredProvider("key", "m", fetcher).invoke(schema, context)).rejects.toMatchObject({ code, retryable });
    }
  });

  it("rejects refusals, incomplete responses, malformed JSON, and contract violations", async () => {
    const refusal = fetcherFor({ body: { model: "m", output: [{ content: [{ type: "refusal" }] }] } });
    await expect(new OpenAIStructuredProvider("key", "m", refusal.fetcher).invoke(schema, context)).rejects.toMatchObject({ code: "AI_REFUSAL" });
    const incomplete = fetcherFor({ body: { model: "m", status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } });
    await expect(new OpenAIStructuredProvider("key", "m", incomplete.fetcher).invoke(schema, context)).rejects.toMatchObject({ code: "AI_CONTEXT_LENGTH" });
    const badJson = fetcherFor({ body: { model: "m", output_text: "not json" } });
    await expect(new OpenAIStructuredProvider("key", "m", badJson.fetcher).invoke(schema, context)).rejects.toMatchObject({ code: "AI_MALFORMED_OUTPUT" });
    const offContract = fetcherFor(openAiOk({ verdict: "sideways", note: "" }));
    await expect(new OpenAIStructuredProvider("key", "m", offContract.fetcher).invoke(schema, context)).rejects.toMatchObject({ code: "AI_SCHEMA_REJECTED" });
  });

  it("never leaks the credential in an error message", async () => {
    const { fetcher } = fetcherFor({ ok: false, status: 401, body: {} });
    await expect(new OpenAIStructuredProvider("super-secret-key", "m", fetcher).invoke(schema, context))
      .rejects.toThrow(/^(?!.*super-secret-key).*$/s);
  });
});

describe("Anthropic structured provider", () => {
  it("constrains output with a forced native tool call rather than an OpenAI-shaped request", async () => {
    const { fetcher, calls } = fetcherFor(anthropicOk({ verdict: "bad", note: "weak differentiation" }));
    const result = await new AnthropicStructuredProvider("key", "configured-critic", fetcher).invoke(schema, context);
    expect(result.value).toEqual({ verdict: "bad", note: "weak differentiation" });
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("critic-model");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBeDefined();
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.tool_choice).toEqual({ type: "tool", name: context.operation });
    expect(body.tools[0].name).toBe(context.operation);
    expect(body.tools[0].input_schema.type).toBe("object");
    expect(body.max_tokens).toBe(context.maxOutputTokens);
    expect(body.system).toBe(context.system);
  });

  it("folds cache tokens into input and reports raw provider counters separately", async () => {
    const { fetcher } = fetcherFor(anthropicOk({ verdict: "good", note: "ok" }));
    const result = await new AnthropicStructuredProvider("key", "m", fetcher).invoke(schema, context);
    // 200 input + 10 cache-creation + 5 cache-read are all billed input.
    expect(result.usage.inputTokens).toBe(215);
    expect(result.usage.outputTokens).toBe(40);
    expect(result.usage.totalTokens).toBe(255);
    expect(result.rawUsage).toEqual({ input_tokens: 200, output_tokens: 40, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 });
  });

  it("maps Anthropic error types onto the same shared taxonomy", async () => {
    const cases: Array<[number, string, string, boolean]> = [
      [401, "authentication_error", "AI_AUTH_FAILED", false],
      [429, "rate_limit_error", "AI_RATE_LIMITED", true],
      [529, "overloaded_error", "AI_PROVIDER_UNAVAILABLE", true],
      [404, "not_found_error", "AI_INVALID_MODEL", false],
    ];
    for (const [status, type, code, retryable] of cases) {
      const { fetcher } = fetcherFor({ ok: false, status, body: { error: { type, message: "m" } } });
      await expect(new AnthropicStructuredProvider("key", "m", fetcher).invoke(schema, context)).rejects.toMatchObject({ code, retryable });
    }
    const longPrompt = fetcherFor({ ok: false, status: 400, body: { error: { type: "invalid_request_error", message: "prompt is too long" } } });
    await expect(new AnthropicStructuredProvider("key", "m", longPrompt.fetcher).invoke(schema, context)).rejects.toMatchObject({ code: "AI_CONTEXT_LENGTH" });
  });

  it("treats a truncated or missing tool call as a failure rather than partial data", async () => {
    const truncated = fetcherFor({ body: { model: "m", stop_reason: "max_tokens", content: [] } });
    await expect(new AnthropicStructuredProvider("key", "m", truncated.fetcher).invoke(schema, context)).rejects.toMatchObject({ code: "AI_CONTEXT_LENGTH" });
    const noTool = fetcherFor({ body: { model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "here you go" }] } });
    await expect(new AnthropicStructuredProvider("key", "m", noTool.fetcher).invoke(schema, context)).rejects.toMatchObject({ code: "AI_MALFORMED_OUTPUT" });
  });

  it("validates the tool input against the same contract as every other provider", async () => {
    const { fetcher } = fetcherFor(anthropicOk({ verdict: "maybe", note: "x" }));
    await expect(new AnthropicStructuredProvider("key", "m", fetcher).invoke(schema, context)).rejects.toMatchObject({ code: "AI_SCHEMA_REJECTED" });
  });

  it("refuses an operation name that is not a valid tool name, before spending anything", async () => {
    const { fetcher, calls } = fetcherFor(anthropicOk({ verdict: "good", note: "ok" }));
    await expect(new AnthropicStructuredProvider("key", "m", fetcher).invoke(schema, { ...context, operation: "not a valid name!" }))
      .rejects.toMatchObject({ code: "AI_REQUEST_REJECTED" });
    expect(calls).toHaveLength(0);
  });

  it("never leaks the credential in an error message", async () => {
    const { fetcher } = fetcherFor({ ok: false, status: 401, body: { error: { type: "authentication_error", message: "bad key" } } });
    await expect(new AnthropicStructuredProvider("super-secret-key", "m", fetcher).invoke(schema, context))
      .rejects.toThrow(/^(?!.*super-secret-key).*$/s);
  });
});
