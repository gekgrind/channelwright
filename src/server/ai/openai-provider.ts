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

const ENDPOINT = "https://api.openai.com/v1/responses";

function extractText(body: Record<string, unknown>, model: string) {
  if (typeof body.output_text === "string" && body.output_text.length > 0) return body.output_text;
  if (!Array.isArray(body.output)) return null;
  for (const item of body.output) {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!content || typeof content !== "object" || !("type" in content)) continue;
      if (content.type === "refusal") throw new ModelProviderError("REFUSAL", "openai", model, "The model refused the request.");
      if (content.type === "output_text" && "text" in content && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

function classify(status: number, bodyText: string, model: string) {
  if (status === 401 || status === 403) return new ModelProviderError("AUTH_FAILED", "openai", model, `OpenAI rejected the credential (HTTP ${status}).`);
  if (status === 429) return new ModelProviderError("RATE_LIMITED", "openai", model, "OpenAI rate limited the request.");
  if (status >= 500) return new ModelProviderError("PROVIDER_UNAVAILABLE", "openai", model, `OpenAI is unavailable (HTTP ${status}).`);
  if (status === 404 || /model[^.]*(not found|does not exist)/i.test(bodyText)) return new ModelProviderError("INVALID_MODEL", "openai", model, `OpenAI does not recognize the configured model "${model}".`);
  if (/context[_ ]length|maximum context|too many tokens/i.test(bodyText)) return new ModelProviderError("CONTEXT_LENGTH", "openai", model, "The request exceeded the model context length.");
  return new ModelProviderError("REQUEST_REJECTED", "openai", model, `OpenAI rejected the request (HTTP ${status}).`);
}

export class OpenAIStructuredProvider implements StructuredModelProvider {
  readonly id: AIProviderId = "openai";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async invoke<T>(schema: ZodType<T>, context: ModelInvocationContext): Promise<ModelInvocationResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), context.timeoutMs);
    try {
      const response = await this.fetcher(ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          store: false,
          max_output_tokens: context.maxOutputTokens,
          input: [
            { role: "system", content: [{ type: "input_text", text: context.system }] },
            { role: "user", content: [{ type: "input_text", text: JSON.stringify(context.payload) }] },
          ],
          text: { format: { type: "json_schema", name: context.operation, strict: true, schema: toProviderJsonSchema(schema) } },
        }),
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw classify(response.status, bodyText, this.model);
      }
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ModelProviderError("MALFORMED_OUTPUT", "openai", this.model, "The OpenAI response was not an object.");
      const record = body as Record<string, unknown>;
      if (record.status === "incomplete") {
        const reason = (record.incomplete_details as { reason?: string } | undefined)?.reason ?? "unknown";
        throw new ModelProviderError(reason === "max_output_tokens" ? "CONTEXT_LENGTH" : "MALFORMED_OUTPUT", "openai", this.model, `OpenAI returned an incomplete response (${reason}).`);
      }
      const text = extractText(record, this.model);
      if (!text) throw new ModelProviderError("MALFORMED_OUTPUT", "openai", this.model, "The OpenAI response contained no structured output.");
      const raw = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : {};
      const inputTokens = Number(raw.input_tokens ?? 0);
      const outputTokens = Number(raw.output_tokens ?? 0);
      const model = typeof record.model === "string" ? record.model : this.model;
      const usage: NormalizedModelUsage = { model, inputTokens, outputTokens, totalTokens: Number(raw.total_tokens ?? inputTokens + outputTokens) };
      const cachedTokens = Number((raw.input_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens ?? 0);
      const reasoningTokens = Number((raw.output_tokens_details as { reasoning_tokens?: number } | undefined)?.reasoning_tokens ?? 0);
      return {
        value: parseStructuredOutput(schema, text, "openai", model),
        usage,
        provider: "openai",
        model,
        rawUsage: { input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: cachedTokens, reasoning_tokens: reasoningTokens },
      };
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new ModelProviderError("TIMEOUT", "openai", this.model, "The OpenAI request timed out.");
      throw new ModelProviderError("NETWORK_FAILED", "openai", this.model, "The OpenAI request failed before a response was received.");
    } finally { clearTimeout(timer); }
  }
}
