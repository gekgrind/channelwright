# Provider-backed channel research

`CHANNEL_RESEARCH` v1 is Channelwright's first current-evidence strategic workflow. It is production-oriented but still requires a separately running trusted workflow worker and configured provider credentials.

## Existing architecture extended

The slice uses the registered `Workflow -> Run -> Step -> Attempt` engine in `src/domain/production-workflows.ts` and `src/server/workflows`; it does not create a parallel agent runner. Authenticated starts and review decisions enter through owner-deriving Supabase RPCs, while claims, lease renewal, completion, failure, cache writes, and cache retention stay service-role-only. Step outputs, attempts, events, QA, revisions, and the exact final result remain in the existing workflow ledger. The studio reads that ledger through the authenticated workflow API and never receives provider credentials or service-role access.

## Flow

```text
authenticated request
  -> YouTube Data API retrieval or owner-scoped fresh cache
  -> normalized video/channel evidence with stable IDs
  -> structured research synthesis
  -> deterministic reference and consistency checks
  -> independent semantic QA
  -> at most one automated revision
  -> final independent QA
  -> typed final result
  -> owner-only approve, reject, or request-revision decision
```

Final QA fails closed on deterministic errors or a score below 70. If the one automated revision has already been used and final QA passes with warnings but still recommends refinement, the run is labeled `human_review_required` and the warnings remain visible at the approval gate; it is not silently treated as a clean pass.

The result does not become an accepted Channelwright decision until the exact approval gate is approved. A human revision request preserves the original result and note, marks that run `BLOCKED`, and creates one linked successor run with the review note in its validated input and the original run ID in durable context. Each successor still uses the same finite provider, QA, revision, and approval graph; no artifact is overwritten.

## Providers and evidence

The retrieval adapter uses the official YouTube Data API v3:

- `search.list` with `part=snippet`, `type=video`, relevance ordering, and at most the configured number of deterministic queries;
- `videos.list` with `part=snippet,statistics` for current public title, channel, publication date, views, likes, and comments when available;
- `channels.list` with `part=snippet,statistics` for current public channel title, publication date, subscribers when public, aggregate views, and video count.

It never scrapes YouTube and never fetches arbitrary URLs returned by a model. See the official [YouTube Data API overview](https://developers.google.com/youtube/v3/getting-started), [search.list reference](https://developers.google.com/youtube/v3/docs/search/list), and [channels.list reference](https://developers.google.com/youtube/v3/docs/channels/list).

Evidence IDs are `yt:video:<id>` and `yt:channel:<id>`. URLs are reconstructed only from validated provider IDs. Each record retains its query, retrieval time, provider resource reference, public metrics, and `LIVE` or `CACHE` origin. Model prompts mark the whole evidence envelope as untrusted data and explicitly forbid following text embedded in provider metadata.

The model adapter uses OpenAI's Responses API with strict JSON Schema output, then validates the response again with Zod. See the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs). Synthesis, initial QA, optional revision, and final QA are separate invocations.

## Environment and budgets

Required provider-issued server secrets are `YOUTUBE_DATA_API_KEY` and `OPENAI_API_KEY`. `OPENAI_MODEL`, `OPENAI_SYNTHESIS_MODEL`, `OPENAI_QA_MODEL`, and every `CHANNEL_RESEARCH_*` value in `.env.example` are operator-selected settings, not credentials. `OPENAI_QA_MODEL` can select a different QA model without changing the workflow or adding a second provider; when it is absent, QA deliberately falls back to the synthesis model and the correlated-failure limitation remains visible.

Defaults are two search queries, eight provider requests per evidence attempt, 24 videos, 12 channels, a six-hour cache TTL, a 20-second provider timeout, a 45-second model timeout, and 6,000 maximum output tokens per model invocation. Configuration ceilings are four searches, 12 provider requests, 30 videos, and 20 channels so a persisted evidence step remains below the workflow's 64 KiB output boundary. Hard code-level limits are one initial synthesis, two independent QA stages, and at most one automated revision. Paid starts require an explicit idempotency key, and the database permits only one active research run per owner.

Every logical run also has a durable aggregate budget in `research_run_budgets`. The default run ceilings are 12 provider requests, 500 YouTube quota units, four searches, two synthesis calls, four QA calls, two revision-model calls, 250,000 input tokens, 24,000 output tokens, 274,000 total tokens, and one automated revision. Per-call and per-attempt safeguards remain in force beneath these aggregate ceilings.

Before an external call, the worker inserts a stable operation reservation through `reserve_research_usage` while holding a row lock on the run budget. The key includes the run step and durable attempt number. Duplicate delivery of the same operation is suppressed; a new attempt may reserve only the capacity still remaining. Successful responses reconcile authoritative provider/token usage through `finalize_research_usage`. Failed or ambiguous external calls use a conservative policy: request/call counts and the reserved token ceiling remain consumed because the provider may have received or billed the request. No dollar amount is inferred.

Cache lookups, retrieved video/channel counts, execution attempts, provider/model identities, automated revisions, and failed operations are retained with the budget. Owners can read their rows through RLS but cannot insert, update, delete, reserve, or finalize accounting. Those mutations are service-role worker RPCs only.

If the request budget or a downstream YouTube detail call fails after a usable search result was obtained, retrieval returns a typed `partial` bundle with exact limitation codes and `budgetExhausted` rather than pretending the sample is complete. A failure before any usable evidence remains a typed terminal/retryable provider error. The worker renews its lease during provider/model execution and refuses to complete or fail through a lease it has lost.

The run persists provider requests, search-query count, YouTube quota units, cache status/key, videos/channels examined, synthesis and QA model identity, and input/output/total tokens. It deliberately does not invent a dollar cost. `search.list` is accounted at 100 quota units; `videos.list` and `channels.list` are accounted at one unit per request. Search count remains separately visible.

## Cache, persistence, and security

`channelwright.research_evidence_cache` is keyed by owner, provider, normalized queries (including relevant audience/geography/language context), and result limits. It has a finite expiry, bounded JSON sizes, RLS, authenticated read-only access, and service-role worker writes. A hit retains the original retrieval timestamp, marks evidence `CACHE`, and records zero new provider requests. A service-role-only bounded purge removes expired rows during cache writes.

The existing workflow tables persist input, runs, steps, attempts, typed outputs, QA results, revision status, approvals, and events. No object is moved to `public`; no Storage resource is needed. Provider secrets never enter browser bundles, workflow payloads, results, events, or logs.

## Worker and opt-in live provider test

After applying migrations and setting the server-only environment, start the isolated worker:

```powershell
npm.cmd run worker:workflow
```

Run the deliberately tiny retrieval-only test locally:

```powershell
$env:YOUTUBE_DATA_API_KEY = "<set locally; do not paste into chat>"
$env:CHANNEL_RESEARCH_LIVE_QUERY = "hidden business systems explained"
npm.cmd run research:provider:live
```

It allows one search, three provider requests, three videos, and two channels. It prints the query, evidence, and usage and creates no application rows or Storage objects.

To additionally exercise live structured synthesis, independent QA, and the bounded revision path in memory, set `CHANNEL_RESEARCH_LIVE_CHAIN=true` for that invocation. This consumes model tokens and still does not prove Supabase persistence or browser review.

## Known boundaries

- Public statistics demonstrate current activity, not causality, future growth, sponsor pricing, conversion, or profit.
- Search relevance is not search-volume data and must not be described as such.
- Hidden subscriber counts remain unknown.
- Human-requested revision starts a new separately budgeted successor run. Its `parent_run_id` and shared `root_run_id` make lineage totals queryable without allowing infrastructure retries to reset either run's budget. The UI does not yet offer a cheaper evidence-reuse-only revision mode.
- Deterministic tests do not prove live providers, a deployed worker, live Supabase RLS, or a real browser review flow.
- Synthesis and QA are separate calls and prompts. They can use distinct `OPENAI_SYNTHESIS_MODEL` and `OPENAI_QA_MODEL` values, but both currently use the OpenAI provider, so provider-level and same-model configurations retain correlated-failure risk.
- The shared-project worker uses Supabase's project-wide service-role credential. The dedicated `channelwright` schema and RLS protect normal clients, but they do not constrain a compromised service-role key; a separate Supabase project or narrower future worker credential is the stronger production isolation boundary.
- The migration and full provider -> model -> QA -> persistence -> browser-review chain must be run in the intended environment before calling this slice deployed or production-ready.
