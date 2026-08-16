import { z, type ZodType } from "zod";
import type { ResearchUsageCounters, ResearchUsageMeter, ResearchUsageOperationKind } from "./research-usage";

export type ModelUsage = { model: string; inputTokens: number; outputTokens: number; totalTokens: number };

export type StructuredModelOperationKind = Extract<ResearchUsageOperationKind, "MODEL_SYNTHESIS" | "MODEL_QA" | "MODEL_REVISION">;

export type StructuredModelErrorFactory = (code: string, retryable: boolean, message: string) => Error & { code: string };

export const semanticQaOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  findings: z.array(z.object({
    severity: z.enum(["error", "warning", "info"]),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
    message: z.string().min(1).max(2_000),
    evidenceIds: z.array(z.string()).max(100),
  }).strict()).max(40),
  recommendation: z.enum(["accept", "revise", "human_review_required"]),
}).strict();

export type SemanticQAOutput = z.infer<typeof semanticQaOutputSchema>;

export type StructuredModelBudget = { modelTimeoutMs: number; modelMaxOutputTokens: number };

export function responsesJsonSchema(schema: ZodType) {
  const converted = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete converted.$schema;
  return converted;
}

export function measureModelUsage(body: Record<string, unknown>, configuredModel: string): ModelUsage {
  const raw = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const inputTokens = Number(raw.input_tokens ?? 0);
  const outputTokens = Number(raw.output_tokens ?? 0);
  return { model: typeof body.model === "string" ? body.model : configuredModel, inputTokens, outputTokens, totalTokens: Number(raw.total_tokens ?? inputTokens + outputTokens) };
}

function extractOutputText(body: Record<string, unknown>, refusal: () => Error) {
  if (typeof body.output_text === "string") return body.output_text;
  if (!Array.isArray(body.output)) return null;
  for (const item of body.output) {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content && typeof content === "object" && "type" in content && content.type === "output_text" && "text" in content && typeof content.text === "string") return content.text;
      if (content && typeof content === "object" && "type" in content && content.type === "refusal") throw refusal();
    }
  }
  return null;
}

const callCounterFor = (kind: StructuredModelOperationKind): ResearchUsageCounters =>
  kind === "MODEL_QA" ? { qaCalls: 1 } : kind === "MODEL_REVISION" ? { revisionCalls: 1 } : { synthesisCalls: 1 };

/**
 * Performs one strict structured OpenAI Responses call with a reserved usage ceiling,
 * classified transport failures, and a conservatively finalized usage record.
 */
export async function callStructuredModel<T>(options: {
  apiKey: string;
  model: string;
  name: string;
  schema: ZodType<T>;
  system: string;
  payload: unknown;
  operationKind: StructuredModelOperationKind;
  budget: StructuredModelBudget;
  fetcher: typeof fetch;
  usageMeter?: ResearchUsageMeter;
  reservationKey: string;
  subject: string;
  refusalMessage: string;
  error: StructuredModelErrorFactory;
}): Promise<{ value: T; usage: ModelUsage }> {
  const { budget, error, name, schema, subject, usageMeter } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget.modelTimeoutMs);
  const serializedPayload = JSON.stringify(options.payload);
  const inputTokenCeiling = Buffer.byteLength(options.system, "utf8") + Buffer.byteLength(serializedPayload, "utf8");
  const callCounter = callCounterFor(options.operationKind);
  const reservedUsage: ResearchUsageCounters = {
    ...callCounter,
    inputTokens: inputTokenCeiling,
    outputTokens: budget.modelMaxOutputTokens,
    totalTokens: inputTokenCeiling + budget.modelMaxOutputTokens,
  };
  const reservation = await usageMeter?.reserve({ key: options.reservationKey, kind: options.operationKind, provider: "OPENAI_RESPONSES_API", model: options.model, reservation: reservedUsage });
  try {
    const response = await options.fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        store: false,
        max_output_tokens: budget.modelMaxOutputTokens,
        input: [
          { role: "system", content: [{ type: "input_text", text: options.system }] },
          { role: "user", content: [{ type: "input_text", text: serializedPayload }] },
        ],
        text: { format: { type: "json_schema", name, strict: true, schema: responsesJsonSchema(schema) } },
      }),
    });
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "AI_AUTH_FAILED"
        : response.status === 429 ? "AI_RATE_LIMITED" : response.status >= 500 ? "AI_PROVIDER_UNAVAILABLE" : "AI_REQUEST_REJECTED";
      throw error(code, response.status === 429 || response.status >= 500, `OpenAI Responses API failed with HTTP ${response.status}.`);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw error("AI_RESPONSE_MALFORMED", false, `The ${subject} response was not an object.`);
    const text = extractOutputText(body as Record<string, unknown>, () => error("AI_REFUSAL", false, options.refusalMessage));
    if (!text) throw error("AI_OUTPUT_MISSING", false, `The ${subject} response contained no structured output.`);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw error("AI_OUTPUT_INVALID_JSON", false, `The ${subject} output was not valid JSON.`); }
    const usage = measureModelUsage(body as Record<string, unknown>, options.model);
    await (reservation && usageMeter?.finalize(reservation, "SUCCEEDED", { ...callCounter, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens }, { operation: name }));
    return { value: schema.parse(parsed), usage };
  } catch (cause) {
    const modelError = cause instanceof Error && "code" in cause && typeof cause.code === "string" && "retryable" in cause ? cause : null;
    await (reservation && usageMeter?.finalize(reservation, "FAILED", { ...reservedUsage, failedOperations: 1 }, {
      operation: name,
      failureCode: modelError?.code ?? "MODEL_OPERATION_FAILED",
      usagePolicy: "CONSERVATIVE_RESERVED_CEILING",
    }));
    if (modelError || cause instanceof z.ZodError) throw cause;
    if (cause instanceof Error && cause.name === "AbortError") throw error("AI_TIMEOUT", true, `The ${subject} request timed out.`);
    throw error("AI_NETWORK_FAILED", true, `The ${subject} request failed before a response was received.`);
  } finally { clearTimeout(timer); }
}
