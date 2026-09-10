import "server-only";

import { AnthropicStructuredProvider } from "./anthropic-provider";
import { OpenAIStructuredProvider } from "./openai-provider";
import { aiProviderIdSchema, type AIProviderId, type ModelRole, type StructuredModelProvider } from "./provider";

/**
 * Server-controlled routing from workflow role to provider and model.
 *
 * Routing is never influenced by client input: a caller asks for a role, and the
 * router resolves the provider from environment configuration only. There is no
 * default model identifier for either vendor, so an unconfigured deployment
 * fails closed before any paid reservation rather than calling something that
 * does not exist.
 */
export class ModelRoutingError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

/** Env prefix per workflow family, so roles are configurable independently per workflow. */
export type RoutingNamespace = "CONTENT" | "RESEARCH" | "STRATEGY" | "VIDEO_BRIEF" | "VIDEO_SCRIPT" | "VIDEO_PACKAGING" | "VIDEO_RELEASE" | "VIDEO_PERFORMANCE" | "VIDEO_DIAGNOSIS" | "VIDEO_DECISION" | "VIDEO_EXPERIMENT" | "VIDEO_PORTFOLIO" | "VIDEO_INTELLIGENCE";

const ROLE_ENV: Record<ModelRole, string> = {
  GENERATOR: "GENERATOR",
  STRATEGIST: "STRATEGIST",
  CRITIC: "CRITIC",
  VIEWER_VALUE_REVIEWER: "VIEWER_VALUE_REVIEWER",
  QA: "QA",
  REVISION: "REVISION",
};

const readEnv = (name: string) => process.env[name]?.trim() || undefined;

/**
 * Resolution order for a role, most specific first:
 *   <NS>_<ROLE>_PROVIDER            e.g. CONTENT_CRITIC_PROVIDER
 *   <NS>_DEFAULT_PROVIDER           e.g. CONTENT_DEFAULT_PROVIDER
 *   CHANNELWRIGHT_DEFAULT_PROVIDER
 *   "openai"
 */
export function resolveRoleProvider(namespace: RoutingNamespace, role: ModelRole): AIProviderId {
  const raw = readEnv(`${namespace}_${ROLE_ENV[role]}_PROVIDER`)
    ?? readEnv(`${namespace}_DEFAULT_PROVIDER`)
    ?? readEnv("CHANNELWRIGHT_DEFAULT_PROVIDER")
    ?? "openai";
  const parsed = aiProviderIdSchema.safeParse(raw.toLowerCase());
  if (!parsed.success) {
    throw new ModelRoutingError("AI_PROVIDER_INVALID", `"${raw}" is not a supported provider for ${namespace} ${role}. Supported: ${aiProviderIdSchema.options.join(", ")}.`);
  }
  return parsed.data;
}

/**
 * Model resolution for a provider, most specific first:
 *   <NS>_<ROLE>_MODEL               e.g. CONTENT_CRITIC_MODEL
 *   <PROVIDER>_<NS>_MODEL           e.g. ANTHROPIC_CONTENT_MODEL
 *   <PROVIDER>_MODEL                e.g. ANTHROPIC_MODEL
 * There is intentionally no final fallback constant.
 */
export function resolveRoleModel(namespace: RoutingNamespace, role: ModelRole, provider: AIProviderId): string {
  const upper = provider.toUpperCase();
  const model = readEnv(`${namespace}_${ROLE_ENV[role]}_MODEL`)
    ?? readEnv(`${upper}_${namespace}_MODEL`)
    ?? readEnv(`${upper}_MODEL`);
  if (!model) {
    throw new ModelRoutingError(
      "AI_MODEL_NOT_CONFIGURED",
      `No model is configured for ${namespace} ${role} on ${provider}. Set ${namespace}_${ROLE_ENV[role]}_MODEL, ${upper}_${namespace}_MODEL, or ${upper}_MODEL. Channelwright never assumes a default model.`,
    );
  }
  return model;
}

function credential(provider: AIProviderId) {
  const key = provider === "openai" ? readEnv("OPENAI_API_KEY") : readEnv("ANTHROPIC_API_KEY");
  if (!key) throw new ModelRoutingError("AI_CREDENTIALS_MISSING", `${provider.toUpperCase()}_API_KEY is required to route a role to ${provider}.`);
  return key;
}

export interface RoleRouter {
  /** Resolves the provider adapter that should serve this role. */
  forRole(role: ModelRole): StructuredModelProvider;
  /** Provider/model assignment per role, for provenance and operator inspection. */
  describe(roles: readonly ModelRole[]): Array<{ role: ModelRole; provider: AIProviderId; model: string }>;
}

export class EnvironmentRoleRouter implements RoleRouter {
  private readonly cache = new Map<ModelRole, StructuredModelProvider>();
  constructor(
    private readonly namespace: RoutingNamespace,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  forRole(role: ModelRole): StructuredModelProvider {
    const cached = this.cache.get(role);
    if (cached) return cached;
    const provider = resolveRoleProvider(this.namespace, role);
    const model = resolveRoleModel(this.namespace, role, provider);
    const adapter: StructuredModelProvider = provider === "anthropic"
      ? new AnthropicStructuredProvider(credential("anthropic"), model, this.fetcher)
      : new OpenAIStructuredProvider(credential("openai"), model, this.fetcher);
    this.cache.set(role, adapter);
    return adapter;
  }

  describe(roles: readonly ModelRole[]) {
    return roles.map((role) => {
      const provider = resolveRoleProvider(this.namespace, role);
      return { role, provider, model: resolveRoleModel(this.namespace, role, provider) };
    });
  }
}

/**
 * Fails closed when two roles that must be served by independent providers
 * resolve to the same one. The multi-model architecture requires the critic to
 * be a different provider than the generator (docs/multi-model-architecture.md);
 * without this, an unconfigured deployment silently defaults both to openai,
 * collapsing the independent-critique signal. `describe` throws AI_MODEL_NOT_
 * CONFIGURED first if a role has no model, preserving the existing fail-closed
 * behaviour for missing configuration.
 */
export function assertDistinctRoleProviders(router: RoleRouter, roleA: ModelRole, roleB: ModelRole) {
  const [a, b] = router.describe([roleA, roleB]);
  if (a.provider === b.provider) {
    throw new ModelRoutingError(
      "AI_PROVIDER_INDEPENDENCE_REQUIRED",
      `${roleA} and ${roleB} must resolve to different providers for independent cross-model review, but both resolved to ${a.provider}. Configure distinct providers (e.g. one openai, one anthropic).`,
    );
  }
}

/** Fixed router for tests and for the live verification scripts. */
export class StaticRoleRouter implements RoleRouter {
  constructor(private readonly assignments: Partial<Record<ModelRole, StructuredModelProvider>>, private readonly fallback?: StructuredModelProvider) {}
  forRole(role: ModelRole): StructuredModelProvider {
    const provider = this.assignments[role] ?? this.fallback;
    if (!provider) throw new ModelRoutingError("AI_ROLE_UNROUTED", `No provider is assigned to role ${role}.`);
    return provider;
  }
  describe(roles: readonly ModelRole[]) {
    return roles.map((role) => {
      const provider = this.forRole(role);
      return { role, provider: provider.id, model: provider.model };
    });
  }
}
