import { z, type ZodType } from "zod";

/**
 * Provider-neutral structured-model boundary.
 *
 * Channelwright owns the workflow, evidence, contracts, provenance, budgets, QA,
 * and the final decision. Models are interchangeable specialists operating
 * inside those rules, so domain and workflow code asks for a capability and a
 * role — never for a vendor.
 *
 * This layer is deliberately narrow: it covers exactly the one thing every
 * Channelwright workflow actually needs, which is "return a value that
 * validates against this Zod contract, and tell me what it cost".
 */

export const aiProviderIdSchema = z.enum(["openai", "anthropic"]);
export type AIProviderId = z.infer<typeof aiProviderIdSchema>;

/**
 * Why a model is being invoked. Roles are routed independently so provider
 * assignment can change on measured evidence without touching workflow code.
 */
export const modelRoleSchema = z.enum([
  "GENERATOR",
  "STRATEGIST",
  "CRITIC",
  "VIEWER_VALUE_REVIEWER",
  "QA",
  "REVISION",
]);
export type ModelRole = z.infer<typeof modelRoleSchema>;

/** Normalized usage. Providers report differently; raw values are preserved separately. */
export const modelUsageSchema = z.object({
  model: z.string().min(1).max(200),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
}).strict();
export type NormalizedModelUsage = z.infer<typeof modelUsageSchema>;

export interface ModelInvocationContext {
  /** Stable schema/operation name; also used as the structured-output name. */
  operation: string;
  role: ModelRole;
  system: string;
  payload: unknown;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface ModelInvocationResult<T> {
  value: T;
  usage: NormalizedModelUsage;
  provider: AIProviderId;
  /** Model identity as reported by the provider, falling back to the configured id. */
  model: string;
  /** Provider-specific usage fields worth keeping without pretending they are comparable. */
  rawUsage: Record<string, number>;
}

export interface StructuredModelProvider {
  readonly id: AIProviderId;
  /** Configured model identity for this instance, before any provider echo. */
  readonly model: string;
  invoke<T>(schema: ZodType<T>, context: ModelInvocationContext): Promise<ModelInvocationResult<T>>;
}

/**
 * Failure taxonomy shared by every adapter so executors and the worker classify
 * provider problems identically regardless of vendor.
 */
export type ModelFailureKind =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "INVALID_MODEL"
  | "CONTEXT_LENGTH"
  | "PROVIDER_UNAVAILABLE"
  | "REQUEST_REJECTED"
  | "MALFORMED_OUTPUT"
  | "SCHEMA_REJECTED"
  | "REFUSAL"
  | "NETWORK_FAILED";

/** Only genuine infrastructure faults are retryable; quality and configuration faults are not. */
const RETRYABLE: ReadonlySet<ModelFailureKind> = new Set<ModelFailureKind>(["TIMEOUT", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "NETWORK_FAILED"]);

/** Faults an operator must fix; never a reason to silently route spend elsewhere. */
const CONFIGURATION: ReadonlySet<ModelFailureKind> = new Set<ModelFailureKind>(["AUTH_FAILED", "INVALID_MODEL"]);

export class ModelProviderError extends Error {
  readonly retryable: boolean;
  readonly configurationFault: boolean;
  constructor(
    readonly kind: ModelFailureKind,
    readonly provider: AIProviderId,
    readonly model: string,
    message: string,
  ) {
    super(message);
    this.retryable = RETRYABLE.has(kind);
    this.configurationFault = CONFIGURATION.has(kind);
  }
  /** Stable code surfaced to the workflow engine. */
  get code() { return `AI_${this.kind}`; }
}

export const isModelProviderError = (error: unknown): error is ModelProviderError => error instanceof ModelProviderError;

/**
 * Zod → JSON Schema for provider structured output. Both adapters share this so
 * a contract change cannot drift between vendors.
 */
export function toProviderJsonSchema(schema: ZodType) {
  const converted = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete converted.$schema;
  return converted;
}

/** Parses provider text output, mapping JSON and contract failures onto the shared taxonomy. */
export function parseStructuredOutput<T>(schema: ZodType<T>, text: string, provider: AIProviderId, model: string): T {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new ModelProviderError("MALFORMED_OUTPUT", provider, model, "The model output was not valid JSON."); }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const paths = result.error.issues.slice(0, 5).map((issue) => issue.path.join(".") || "(root)").join(", ");
    throw new ModelProviderError("SCHEMA_REJECTED", provider, model, `The model output did not satisfy its contract at: ${paths}.`);
  }
  return result.data;
}
