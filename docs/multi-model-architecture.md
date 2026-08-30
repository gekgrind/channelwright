# Multi-model architecture

Channelwright owns the workflow, evidence, contracts, provenance, budgets, QA, and the final decision. Models are interchangeable specialists operating inside those rules. Neither OpenAI nor Anthropic is the authoritative source of truth; Channelwright is the arbiter.

```
Channelwright Orchestrator (durable Workflow -> Run -> Step -> Attempt)
    |
Role Router  (server-controlled, per workflow namespace and role)
    |-- OpenAI adapter      (Responses API, strict json_schema)
    |-- Anthropic adapter   (Messages API, forced native tool call)
    `-- future providers
    |
Typed artifact (same Zod contract regardless of provider)
    |
Independent cross-model critique   (a different provider than the generator)
    |
Deterministic Channelwright validation   <- authoritative
    |
Bounded revision (at most one)
    |
Human approval
```

## Provider-neutral boundary

`src/server/ai/provider.ts` defines the whole vendor surface:

- `StructuredModelProvider` — `invoke(schema, context)` returns a value validated against a Zod contract, normalized usage, provider id, model identity, and raw provider counters.
- `ModelRole` — `GENERATOR`, `STRATEGIST`, `CRITIC`, `VIEWER_VALUE_REVIEWER`, `QA`, `REVISION`.
- `ModelProviderError` with a shared failure taxonomy: `TIMEOUT`, `RATE_LIMITED`, `AUTH_FAILED`, `INVALID_MODEL`, `CONTEXT_LENGTH`, `PROVIDER_UNAVAILABLE`, `REQUEST_REJECTED`, `MALFORMED_OUTPUT`, `SCHEMA_REJECTED`, `REFUSAL`, `NETWORK_FAILED`.
- `toProviderJsonSchema` and `parseStructuredOutput` are shared, so a contract cannot drift between vendors and every provider's output passes through identical validation.

Only infrastructure faults (`TIMEOUT`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `NETWORK_FAILED`) are retryable. `AUTH_FAILED` and `INVALID_MODEL` are marked `configurationFault`: an operator must fix them, and they are never a reason to route spend elsewhere.

## Adapters

**OpenAI** (`openai-provider.ts`) uses the Responses API with `text.format = { type: "json_schema", strict: true }`. It maps HTTP status and body onto the shared taxonomy, treats `status: "incomplete"` with `max_output_tokens` as `CONTEXT_LENGTH`, and extracts `cached_tokens` and `reasoning_tokens` as raw counters.

**Anthropic** (`anthropic-provider.ts`) uses the Messages API with a single tool definition and a forced `tool_choice`, which is the native way to constrain Claude to a schema. It is deliberately *not* proxied through an OpenAI-compatible endpoint, which would lose native usage fidelity, stop reasons, and the provider's own error taxonomy. `stop_reason: "max_tokens"` becomes `CONTEXT_LENGTH`; a missing tool call is `MALFORMED_OUTPUT`. Anthropic reports no total, and cache tokens are billed input, so `inputTokens = input + cache_creation + cache_read` with the raw counters preserved separately. The two providers' token accounting is normalized, not pretended identical.

## Role routing

`role-router.ts` resolves provider and model from environment configuration only. There is no seam for client input to influence routing.

Provider: `<NS>_<ROLE>_PROVIDER` → `<NS>_DEFAULT_PROVIDER` → `CHANNELWRIGHT_DEFAULT_PROVIDER` → `openai`.
Model: `<NS>_<ROLE>_MODEL` → `<PROVIDER>_<NS>_MODEL` → `<PROVIDER>_MODEL` → **fail closed** with `AI_MODEL_NOT_CONFIGURED`.

Namespaces (`CONTENT`, `RESEARCH`, `STRATEGY`, `VIDEO_BRIEF`, `VIDEO_SCRIPT`) are independent, so content routing cannot change research, strategy, video-brief, or video-script behaviour.

`VIDEO_SCRIPT` routes four roles — `GENERATOR` (draft), `CRITIC` (independent critique), `QA` (semantic QA), and `REVISION` (bounded revision). Because both the draft author and the reviser can produce the accepted artifact, the executor fails closed before any spend unless `CRITIC` resolves to a different provider than **both** `GENERATOR` and `REVISION`, so an artifact is never reviewed by its own author's provider.

## Verified starting split for CONTENT_INTELLIGENCE

| Step | Role | Provider |
|---|---|---|
| expand-content-pillars | GENERATOR | OpenAI |
| assess-topic-opportunities | GENERATOR | OpenAI |
| synthesize-backlog | GENERATOR | OpenAI |
| initial-content-qa (critique) | CRITIC | Anthropic |
| initial-content-qa (semantic QA) | QA | Anthropic |
| bounded-content-revision | REVISION | OpenAI |
| final-content-qa | QA | Anthropic |

This is a starting configuration, not dogma. It is fully reconfigurable, and should change when measurement says so.

## Starting split for CHANNEL_VIDEO_BRIEF

| Step | Role | Provider |
|---|---|---|
| design-viewer-promise | GENERATOR | OpenAI |
| build-video-brief | GENERATOR | OpenAI |
| initial-video-brief-qa (critique) | CRITIC | Anthropic |
| initial-video-brief-qa (semantic QA) | QA | Anthropic |
| bounded-video-brief-revision | REVISION | OpenAI |
| final-video-brief-qa | QA | Anthropic |

The same shape as content intelligence, and equally reconfigurable. See `docs/video-brief.md`.

## Why not dual generation

Channelwright does not send the same prompt to two providers and average the results. That doubles cost, halves accountability, and produces no independent signal. The default pattern is generator → independent critic → deterministic validation → bounded revision → final QA → human review. Dual independent generation is reserved for a future workflow where the value is demonstrated.

## Cross-model critique

The critic runs inside `initial-content-qa`, receives the approved strategy, the discovery evidence, the generated artifact, the viewer value standard, and the scoring rubric, and is explicitly told it is not the arbiter. It is asked to challenge unsupported assumptions, conclusions outrunning evidence, generic ideas, asserted-not-demonstrated differentiation, circular viewer-value reasoning, strategy drift, overclaiming, overlapping viewer intent, and recommendations that follow the highest score rather than the strongest case.

Critic evidence citations are filtered against the discovery bundle before persistence. Findings are recorded as concise, user-safe rationales; no unrestricted chain-of-thought is requested or stored.

Dispositions: `AGREED`, `CRITIC_RAISED_ISSUE`, `REVISED`, `OVERRIDDEN_BY_DETERMINISTIC_RULE`, `HUMAN_REVIEW_REQUIRED`.

## Channelwright arbitration

These remain deterministic and authoritative regardless of what any model says:

- schema validation of every artifact;
- evidence existence, identity, and own-pillar attribution;
- the viewer value gate, resolved as the stricter of the deterministic floor and the model's claim — a critic can never turn a deterministic `REJECT` into `PASS`;
- **scoring arithmetic**: the generator supplies dimensions, scores, and relative weights; Channelwright normalizes the weights to sum to 1 and computes the weighted total. Live runs showed generators systematically drifting here (weights summing to 0.96, totals off by ~0.2), so the arithmetic was moved out of the model entirely;
- integrity rules and unrevisable-failure classification;
- bounded revision, discarded if it introduces a new deterministic error;
- human approval.

## Provenance and accounting

Each significant call records provider, model, role, operation, and timestamp as a `modelAttribution`. The final artifact carries a compact `modelProvenance` trail (max 8) plus a `crossModelReview` with the generator, the critic, the outcome, bounded findings, and a summary. Full critic prose is not copied into the final artifact.

Accounting reuses the existing durable tables. Every invocation reserves before the call under `provider`/`model` identity and finalizes with measured usage; failures consume the reserved ceiling conservatively. `research_run_budgets.provider_identities` and `model_identities` therefore accumulate both vendors, and the run ceiling is shared: **switching provider never creates a fresh allowance**, and a retry on another provider does not bypass the budget.

## Failure behaviour

There is deliberately **no automatic cross-provider fallback** in this slice. A misconfigured provider fails loudly. Silent failover would hide configuration and quality problems, complicate idempotency across operation keys, and make spend attribution dishonest. Retryable infrastructure faults are retried by the existing workflow engine on the same configured provider. If fallback is added later it must be explicit, bounded, recorded as a fallback event, preserve operation identity and budget, and never fire for deterministic rejection, integrity failure, viewer-value rejection, poor reasoning, absent credentials, or an invalid model name.

## Research and strategy

`CHANNEL_RESEARCH` and `CHANNEL_STRATEGY` still use their original OpenAI-specific adapters and are unchanged. The routing namespaces already exist for them. Migration path: replace `OpenAIResearchModel` / `OpenAIStrategyModel` internals with `StructuredModelProvider` calls behind their existing interfaces, exactly as `RoutedContentModel` replaced `OpenAIContentModel`. That is deliberately deferred: both workflows are proven, and converting them for symmetry alone would risk regression without evidence of benefit.
