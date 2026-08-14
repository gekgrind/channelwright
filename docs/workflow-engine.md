# Production workflow engine

## Purpose and model

The engine is the durable coordination layer for Channelwright's future strategist, research, production, publishing, analytics, and monetization capabilities. It does not choose an LLM provider and does not turn fixture agents into production research.

```text
Workflow -> Run -> Step -> Attempt
                    |
                    +-> Approval
```

- A **workflow** is the owner's durable business objective.
- A **run** is one execution of a registered type/version with immutable input and typed output.
- A **step** is either a worker capability or an explicit human approval gate.
- An **attempt** is one lease-token-bound execution or retry of a worker step.
- An **approval** is a separately owned decision record. It is never simulated by arbitrary status mutation.

Workflow/run states are `QUEUED`, `RUNNING`, `WAITING_FOR_APPROVAL`, `BLOCKED`, `COMPLETED`, `FAILED`, and `CANCELED`. Step states are `BLOCKED`, `QUEUED`, `LEASED`, `RETRY_WAIT`, `WAITING_FOR_APPROVAL`, `COMPLETED`, `FAILED`, and `CANCELED`. Only database functions perform transitions.

## Definition registry

`src/domain/production-workflows.ts` is the programmatic registry. A definition supplies:

- stable type and positive version;
- strict Zod input and output schemas;
- objective;
- step keys, dependencies, kind, and capability;
- bounded max attempts and retry base delay;
- explicit approval gates.

Adding a future type such as `VIDEO_PRODUCTION`, `VIDEO_PUBLISH`, `PERFORMANCE_REVIEW`, or `CONTENT_REPURPOSE` requires a new versioned definition and executor capability. `CHANNEL_RESEARCH` v1 is now registered through this mechanism. Route handlers must not branch on provider or agent names.

## API contract

Every endpoint requires a real Supabase session outside fixture mode. Errors use `{ "error": { "code", "message" } }` with stable codes and no SQL or stack detail.

### Start

`POST /api/workflows` with an `Idempotency-Key` header:

```json
{
  "operation": "START_WORKFLOW",
  "workflowType": "CHANNEL_CONCEPT_VALIDATION",
  "definitionVersion": 1,
  "input": {
    "proposedConcept": "Explain the hidden systems behind ordinary local businesses",
    "audienceContext": "Independent operators",
    "nicheContext": "Business operations",
    "monetizationPaths": ["Sponsor partnerships"]
  }
}
```

The response is HTTP 202 with `workflowId`, `runId`, status, and `idempotentReplay`. Exact retries return the same run. Reusing the key with different input returns `IDEMPOTENCY_CONFLICT`.

### List and retrieve

- `GET /api/workflows` returns the existing studio/media snapshot plus `workflowEngine` lists.
- `GET /api/workflows/:workflowId` returns owned runs, steps, attempts, approvals, and ordered events.
- `GET /api/workflows/:workflowId/runs/:runId` returns the same detail limited to one owned run.

Missing and foreign identifiers both return `NOT_FOUND`; RLS does not reveal whether a guessed identifier exists for another owner.

### Cancel

`DELETE /api/workflows/:workflowId` cancels every outstanding step and active attempt atomically. Repeating cancellation is idempotent. Completed and failed workflows reject cancellation with `INVALID_TRANSITION`. A stale worker lease can no longer complete after cancellation.

### Decide approval

`POST /api/workflows/:workflowId/approvals/:approvalId`:

```json
{ "decision": "APPROVE", "note": "Proceed with research planning." }
```

Only the workflow owner can decide a pending approval. `APPROVE` completes the gate and queues newly eligible work or completes the run. `REJECT` cancels the run. Re-deciding a final approval returns `INVALID_TRANSITION`.

## Idempotency, leases, and retries

Starts use an owner/key advisory transaction lock plus the existing unique owner/idempotency constraint. Worker claims use `FOR UPDATE SKIP LOCKED`. A lease token authorizes heartbeat, completion, or failure; a worker identifier alone grants nothing. Expired attempts become `LEASE_EXPIRED`, then enter exponential `RETRY_WAIT` up to the definition's maximum. Terminal or structurally invalid output is not retried indefinitely.

Worker output is bounded to 64 KiB of structured JSON. Run context is a key/value map of validated step outputs. Secrets, OAuth tokens, provider credentials, full prompts, and transient model context do not belong in input, output, context, or events.

## `CHANNEL_CONCEPT_VALIDATION` v1

The proving workflow runs four deterministic worker steps and one approval gate:

1. `assess-content-depth`
2. `assess-audience-demand`
3. `assess-monetization`
4. `synthesize-validation`
5. `approve-validation`

It evaluates the three Channelwright tests without fabricating market evidence. The output always labels current demand as `PROVIDER_DATA_REQUIRED`, treats supplied monetization paths as hypotheses, and returns `RESEARCH_REQUIRED`. It does not call YouTube, scrape competitors, estimate views, predict revenue, or claim that a niche passed. The result proves orchestration and persistence; it is not production market research.

## `CHANNEL_RESEARCH` v1

The provider-backed successor is documented in [channel-research.md](channel-research.md). It reuses this engine for current YouTube retrieval, normalized provenance, strict structured synthesis, deterministic and independent QA, one bounded revision opportunity, and the existing owner-only approval gate. Other unfinished production workflow types remain unsupported rather than returning fake success.

## Security and audit

All objects live in `channelwright`. RLS filters every relation by `auth.uid()`. Authenticated users receive read-only table privileges and mutate through owner-deriving functions. Worker functions are revoked from anonymous/authenticated roles and granted only to `service_role`. Every `SECURITY DEFINER` function pins `search_path` to `channelwright, pg_temp`.

Structured events answer what changed, when, for whom, in which workflow/run/step/attempt, and whether a user or worker caused it. Details are deliberately bounded and exclude secrets and raw internal errors.

## Remaining production gates

- Apply and exercise the migration against the shared Supabase project.
- Run at least two independently deployed strategic workers and prove crash/expiry recovery.
- Complete a real browser CAPTCHA challenge against the production provider and domain.
- Keep `CHANNEL_CONCEPT_VALIDATION` described as provider-neutral; only `CHANNEL_RESEARCH` may make current public YouTube evidence claims, and only after its provider/QA chain actually completes.
- Add monitoring and alerting for queue age, expiry, retries, terminal failures, and approval age.
