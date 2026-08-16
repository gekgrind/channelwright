import type { ZodType } from "zod";
import {
  ModelProviderError,
  parseStructuredOutput,
  toProviderJsonSchema,
  type AIProviderId,
  type ModelInvocationContext,
  type ModelInvocationResult,
  type NormalizedModelUsage,
  type StructuredModelProvider,
} from "./provider";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Anthropic has no `json_schema` response format. The native way to constrain
 * output to a contract is a single-tool definition plus a forced `tool_choice`,
 * which makes the model emit a `tool_use` block whose `input` matches the
 * schema. That is used here deliberately rather than proxying Claude through an
 * OpenAI-compatible endpoint, which would lose native usage fidelity, native
 * stop reasons, and the provider's own error taxonomy.
 */
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

type AnthropicErrorBody = { error?: { type?: string; message?: string } };

function classify(status: number, body: AnthropicErrorBody, model: string) {
  const type = body.error?.type ?? "";
  const message = body.error?.message ?? "";
  if (type === "authentication_error" || type === "permission_error" || status === 401 || status === 403) {
    return new ModelProviderError("AUTH_FAILED", "anthropic", model, `Anthropic rejected the credential (HTTP ${status}).`);
  }
  if (type === "rate_limit_error" || status === 429) return new ModelProviderError("RATE_LIMITED", "anthropic", model, "Anthropic rate limited the request.");
  if (type === "overloaded_error" || status >= 500) return new ModelProviderError("PROVIDER_UNAVAILABLE", "anthropic", model, `Anthropic is unavailable (HTTP ${status}).`);
  if (type === "not_found_error" || /model/i.test(message) && /not (found|exist)/i.test(message)) {
    return new ModelProviderError("INVALID_MODEL", "anthropic", model, `Anthropic does not recognize the configured model "${model}".`);
  }
  if (/prompt is too long|max_tokens|context window/i.test(message)) return new ModelProviderError("CONTEXT_LENGTH", "anthropic", model, "The request exceeded the model context window.");
  return new ModelProviderError("REQUEST_REJECTED", "anthropic", model, `Anthropic rejected the request (HTTP ${status}).`);
}

export class AnthropicStructuredProvider implements StructuredModelProvider {
  readonly id: AIProviderId = "anthropic";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async invoke<T>(schema: ZodType<T>, context: ModelInvocationContext): Promise<ModelInvocationResult<T>> {
    if (!TOOL_NAME_PATTERN.test(context.operation)) {
      throw new ModelProviderError("REQUEST_REJECTED", "anthropic", this.model, `Operation name "${context.operation}" is not a valid Anthropic tool name.`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), context.timeoutMs);
    try {
      const response = await this.fetcher(ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: context.maxOutputTokens,
          system: context.system,
          messages: [{ role: "user", content: JSON.stringify(context.payload) }],
          tools: [{
            name: context.operation,
            description: `Return the ${context.operation} result. Every field is required and must satisfy the supplied schema.`,
            input_schema: toProviderJsonSchema(schema),
          }],
          tool_choice: { type: "tool", name: context.operation },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as AnthropicErrorBody;
        throw classify(response.status, body, this.model);
      }
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ModelProviderError("MALFORMED_OUTPUT", "anthropic", this.model, "The Anthropic response was not an object.");
      const record = body as Record<string, unknown>;
      const model = typeof record.model === "string" ? record.model : this.model;
      if (record.stop_reason === "max_tokens") {
        throw new ModelProviderError("CONTEXT_LENGTH", "anthropic", model, "Anthropic stopped at max_tokens before completing the structured result.");
      }
      if (record.stop_reason === "refusal") throw new ModelProviderError("REFUSAL", "anthropic", model, "The model refused the request.");
      if (!Array.isArray(record.content)) throw new ModelProviderError("MALFORMED_OUTPUT", "anthropic", model, "The Anthropic response contained no content blocks.");
      const toolUse = record.content.find((block) => block && typeof block === "object" && (block as { type?: string }).type === "tool_use") as { input?: unknown } | undefined;
      if (!toolUse || toolUse.input === undefined) throw new ModelProviderError("MALFORMED_OUTPUT", "anthropic", model, "Anthropic did not return the forced structured tool call.");
      // The tool input is already parsed JSON, so it is re-serialized once to run
      // through exactly the same contract-validation path as every other provider.
      const value = parseStructuredOutput(schema, JSON.stringify(toolUse.input), "anthropic", model);
      const raw = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : {};
      const inputTokens = Number(raw.input_tokens ?? 0);
      const outputTokens = Number(raw.output_tokens ?? 0);
      const cacheCreation = Number(raw.cache_creation_input_tokens ?? 0);
      const cacheRead = Number(raw.cache_read_input_tokens ?? 0);
      // Anthropic reports no total; cache tokens are billed input and are folded in
      // rather than pretending the two providers count identically.
      const usage: NormalizedModelUsage = {
        model,
        inputTokens: inputTokens + cacheCreation + cacheRead,
        outputTokens,
        totalTokens: inputTokens + cacheCreation + cacheRead + outputTokens,
      };
      return {
        value,
        usage,
        provider: "anthropic",
        model,
        rawUsage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: cacheRead },
      };
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new ModelProviderError("TIMEOUT", "anthropic", this.model, "The Anthropic request timed out.");
      throw new ModelProviderError("NETWORK_FAILED", "anthropic", this.model, "The Anthropic request failed before a response was received.");
    } finally { clearTimeout(timer); }
  }
}
