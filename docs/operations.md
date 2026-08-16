# Production worker operations

## Components and trust boundaries

The Next.js server authenticates owners, validates actions, ingests bounded uploads, and calls transactional RPCs. It never renders in a request. The render worker is a separate process with the service-role key and private-bucket access. The browser receives neither the service-role key nor permanent object URLs.

Start a configured worker separately:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL='https://PROJECT.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY='public-anon-value'
$env:SUPABASE_SERVICE_ROLE_KEY='set-in-worker-secret-store'
$env:RENDER_WORKER_ID='worker-01'
npm.cmd run worker:render
```

Do not paste real keys into chat, commit them, or give the service-role value a `NEXT_PUBLIC_` prefix.

Start the strategic workflow worker as a separate supervised process:

```powershell
$env:WORKFLOW_WORKER_ID='strategic-worker-01'
$env:WORKFLOW_LEASE_SECONDS='120'
$env:WORKFLOW_POLL_INTERVAL_MS='2000'
npm.cmd run worker:workflow
```

The worker claims only registered `WORKER` steps. `APPROVAL` steps never enter the service-role queue; they remain `WAITING_FOR_APPROVAL` until the authenticated owner decides them. Monitor workflow queue depth, oldest eligible step, expired leases, attempts by error code, terminal failures, approval age, and canceled stale-worker completions. Do not log workflow input, full user content, tokens, or model prompts.

The provider-backed workflows additionally require an explicitly configured OpenAI model. There is no default identifier: `CHANNEL_RESEARCH` and `CHANNEL_STRATEGY` steps fail closed with `AI_MODEL_NOT_CONFIGURED` before reserving any budget when none of `OPENAI_STRATEGY_SYNTHESIS_MODEL`, `OPENAI_SYNTHESIS_MODEL`, or `OPENAI_MODEL` is set. Treat that error as a deployment configuration fault, not a transient provider failure; it is not retryable.

Three paid-run limits are enforced in PostgreSQL rather than the browser. `RESEARCH_LIMIT_REACHED` rejects a second active `CHANNEL_RESEARCH` run per owner. `STRATEGY_LIMIT_REACHED` rejects a second active `CHANNEL_STRATEGY` run per owner and approved upstream research run, backed by `workflow_runs_active_strategy_uniq`. `CONTENT_LIMIT_REACHED` rejects a second active `CHANNEL_CONTENT_INTELLIGENCE` run per owner and approved strategy run, backed by `workflow_runs_active_content_uniq`. All three surface as HTTP 429. Human-revision successors and regeneration after a terminal run remain permitted.

`CHANNEL_CONTENT_INTELLIGENCE` is the most provider-intensive workflow because it fans out across approved content pillars. Its defaults (8 searches, 24 provider requests, 900 quota units) sit inside the unchanged database ceilings of 12 / 36 / 1200; `search.list` costs 100 quota units, which is what caps the search count. Monitor searches and quota units per run, not just token spend. Budget exhaustion is typed `CONTENT_RESOURCE_BUDGET_EXHAUSTED` and is terminal.

Two content-intelligence failures are deliberately terminal rather than retried or revised. `CONTENT_INTEGRITY_UNREVISABLE` means a topic's premise is deceptive or unsupported and automated revision is refused; `CONTENT_QA_REJECTED` means final QA held a material error. Both indicate a generation-quality problem to inspect, not a transient fault.

## Required variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (trusted server/worker only)
- `RENDER_WORKER_ID`
- `RENDER_LEASE_SECONDS`
- `RENDER_POLL_INTERVAL_MS`
- `RENDER_WORK_ROOT`
- `AUDIO_LOUDNESS_TARGET_LUFS`
- `AUDIO_LOUDNESS_TOLERANCE_LU`
- `AUDIO_TRUE_PEAK_MAX_DBFS`
- `WORKFLOW_WORKER_ID`
- `WORKFLOW_LEASE_SECONDS`
- `WORKFLOW_POLL_INTERVAL_MS`

## Deployment gates

Before calling the pipeline operational:

1. Apply all migrations through the shared-project gate to the isolated `channelwright` schema; never apply them to `public`.
2. Prove authenticated cross-owner denial for every media table, action RPC, object read, and signed-URL request.
3. Upload generated/licensed test media and verify the database record appears only after checksum and inspection.
4. Run two independent workers against the same queue; exercise concurrent claim, heartbeat, crash/lease expiry, retry, cancellation, final failure, and duplicate completion.
5. Verify failed temporary uploads and job workspaces are cleaned without escaping their configured roots.
6. Verify structured logs contain job/attempt identifiers but no credentials or signed URLs.
7. Render and inspect silent and audio masters from stored assets. Confirm unknown human QA blocks export.
8. Add monitoring for queue depth, oldest queued age, expired leases, failure rate, attempt count, storage errors, and QA blockers.

Final content-addressed objects are retained when a database response is ambiguous because the transaction may already have committed. Reconcile unreferenced objects by checksum after a safety window; never delete immediately on a network error.

## Recovery

An expired lease is reclaimed transactionally. A retryable failure enters `RETRY_WAIT` with bounded backoff until `max_attempts`; then it becomes `FAILED`. Cancellation of queued work is immediate. Cancellation of leased work is observed by heartbeat; a worker that lost its lease must not upload/finalize an observable result. `render_job_id` is unique on master versions, so repeated completion returns the first master.

Never repair queue state with ad-hoc row edits in production. Diagnose the exact job and attempt, preserve logs and inspection evidence, and use the typed retry/cancel actions or a reviewed forward-only migration.

## External decisions still required

No image, footage, narration, music, thumbnail, or publishing vendor is selected. Before implementing a provider adapter, decide vendor, pricing limits, licensing/retention terms, allowed models/catalogs, moderation policy, credential location, rate limits, and failure/reconciliation behavior. OAuth applications, approved scopes, target accounts, upload adapters, and post-publish verification remain a later authorized phase.
