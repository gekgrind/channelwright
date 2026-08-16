# CHANNEL_STRATEGY vertical slice

## Initial architecture audit

`CHANNEL_RESEARCH` v1 is registered in `src/domain/production-workflows.ts` as `retrieve-youtube-evidence -> draft-research -> initial-qa -> bounded-revision -> final-qa -> synthesize-validation -> review-research`. Its request, evidence, output, QA, draft, and revision contracts are versioned Zod schemas.

The production repository uses the existing `workflows`, `workflow_runs`, `workflow_steps`, `workflow_step_attempts`, `workflow_approvals`, and `workflow_events` tables. Canonical definitions are independently checked in `start_workflow`; workers use `FOR UPDATE SKIP LOCKED`, lease tokens, heartbeats, bounded attempts, stale-lease recovery, and service-role-only completion RPCs. Approval decisions are owner-scoped. Human revision creates a successor run with `previousRunId`; `research_run_budgets` records parent/root lineage.

Research synthesis and semantic QA use the OpenAI Responses API. Deterministic QA is merged with independent semantic QA. Model identities and tokens are persisted through `research_usage_operations` and aggregated in `research_run_budgets`; atomic reservations precede paid calls and ambiguous failures conservatively charge the reservation. Final research content and step outputs are immutable.

The authenticated research UI displays provenance, typed output, QA, usage, model identities, approval, and lineage. Forward-only migrations are tracked by name and SHA-256 in `channelwright_migrations.schema_migrations`; the runner refuses checksum drift and requires the confirmed `channelwright` schema. Fixture, local-filesystem, shared-project, provider, browser, and deployment evidence remain separate.

The smallest architecture-preserving Step 10 extension is another registry definition and executor routed through the same persistence, lease, approval, accounting, lineage, API, and worker mechanisms.

## Exact approved-research input

The public start contract accepts only `researchWorkflowId` and `researchRunId`; “latest research” is not an option. The database atomically resolves that pair under the authenticated owner and requires:

- `CHANNEL_RESEARCH` v1, completed, with a matching approved human decision;
- finalizer output equal to run output;
- passing final QA with a valid score/state;
- a completed evidence bundle;
- stored SHA-256 artifact and evidence-provenance hashes matching authoritative JSONB;
- valid same-workflow parent/root lineage.

The server persists an immutable `approvedResearchReference` with workflow/run IDs, definition and output-schema versions, approval ID/actor/time, final QA state/score, both hashes, and parent/root lineage. The first worker step resolves and compares it again before model use. Cross-owner, malformed, missing, mutable, unapproved, rejected, awaiting-review, or integrity-mismatched inputs fail closed.

## Typed output and evidence traceability

`CHANNEL_STRATEGY` v1 contains a strategic thesis, primary/optional secondary audience, positioning, channel promise, value proposition, two-to-eight strategic content pillars, monetization architecture, objectives, KPI framework, risks, assumptions/uncertainties, and a typed recommendation. Major conclusions carry evidence IDs from the exact approved research bundle.

KPI rows require `baselineState: UNAVAILABLE`, `observedValue: null`, and `targetIsHypothesis: true`. The contract has no revenue-estimate or downstream content-production fields. The model receives only the approved research result, exact evidence bundle, and evidence-ID allowlist; provider metadata is explicitly untrusted data.

## Workflow, QA, revision, and approval

`validate-approved-research -> draft-strategy -> initial-strategy-qa -> bounded-strategy-revision -> final-strategy-qa -> finalize-strategy -> review-strategy`

Deterministic QA checks upstream identity, unknown/inconsistent evidence, unsupported major conclusions, disconnected pillars, monetization hypotheses, overconfidence, fabricated observed KPIs, revenue estimates, demographic precision, missing uncertainty, and downstream-artifact leakage. Independent semantic QA covers research contradictions and judgments deterministic rules cannot establish.

At most one automated revision receives the exact findings. It cannot replace the upstream reference because the executor reconstructs that reference from authoritative state. A final error or failed score stops before human review; warnings may advance only as `human_review_required`.

Human approval binds to one exact run. A revision request creates a new separately budgeted run with the same immutable upstream reference and preserved parent/root lineage. The original output, step outputs, approval, hashes, and lineage-bearing input/context cannot change after a final human decision.

## Final artifact persistence

`finalize-strategy` is the canonical finalizer for `CHANNEL_STRATEGY`. `complete_workflow_step` promotes that step's output to `workflow_runs.output_payload`, which is what the studio and the `/api/workflows/{id}` contract read.

This required the forward migration `202608140002_finalize_strategy_output.sql`. The original engine promoted only the CHANNEL_RESEARCH finalizer (`synthesize-validation`), so finalized strategies were persisted as step output but never as run output. Promotion is now keyed on the run's `workflow_type`, so `validate-approved-research`, `draft-strategy`, `initial-strategy-qa`, `bounded-strategy-revision`, and `final-strategy-qa` can never become the run's final artifact.

## One active strategy run per approved research artifact

Starting a strategy run is a paid operation, so `start_workflow` refuses a second active run for the same owner and the same approved upstream research run and returns `STRATEGY_LIMIT_REACHED` (HTTP 429). The partial unique index `workflow_runs_active_strategy_uniq` enforces the same rule transactionally, so two simultaneous requests cannot both create independently budgeted runs; the index violation is translated to the same typed error.

The guard is scoped to the server-resolved `approvedResearchReference`, never to raw client input. It does not restrict:

- completed, canceled, or failed historical strategy runs;
- human-revision successors, because the predecessor is moved to `BLOCKED` before the successor is inserted and `BLOCKED` is outside the guarded status set;
- a fresh strategy run once the previous chain is terminal.

## Durable accounting and configuration

Strategy reuses the Step 9B accounting tables/RPCs. The legacy `research_*` names remain compatibility names; there is no parallel accounting system. Strategy has zero provider/search allowance and default ceilings of one synthesis call, two QA calls, one revision call, one automated revision, 320,000 aggregate input units, 36,000 output tokens, and 356,000 total tokens. Serialized UTF-8 bytes are used as a conservative pre-call input reservation.

Model selection is required; there is no built-in default identifier. An unset model raises `AI_MODEL_NOT_CONFIGURED` before any budget is reserved, so production can never spend a reservation calling a placeholder model.

- `OPENAI_STRATEGY_SYNTHESIS_MODEL` falls back to `OPENAI_SYNTHESIS_MODEL`, then `OPENAI_MODEL`, then fails closed.
- `OPENAI_STRATEGY_QA_MODEL` falls back to `OPENAI_QA_MODEL`, then the resolved strategy synthesis model.
- `CHANNEL_STRATEGY_MODEL_TIMEOUT_MS=60000`
- `CHANNEL_STRATEGY_MODEL_MAX_OUTPUT_TOKENS=9000`
- `CHANNEL_STRATEGY_MAX_AGGREGATE_SYNTHESIS_CALLS=1`
- `CHANNEL_STRATEGY_MAX_AGGREGATE_QA_CALLS=2`
- `CHANNEL_STRATEGY_MAX_AGGREGATE_REVISION_CALLS=1`
- `CHANNEL_STRATEGY_MAX_AGGREGATE_INPUT_TOKENS=320000`
- `CHANNEL_STRATEGY_MAX_AGGREGATE_OUTPUT_TOKENS=36000`
- `CHANNEL_STRATEGY_MAX_AGGREGATE_TOTAL_TOKENS=356000`

`OPENAI_API_KEY` and the service-role key remain server-only. Dollar cost is not fabricated because pricing is not pinned to the run.

## Security and limitations

RLS scopes workflow reads by `auth.uid()`. Authenticated clients cannot invoke worker/accounting RPCs, mutate workflow rows, forge approval, or resolve another owner’s research. The shared project stays isolated to `channelwright`; the ledger stays in `channelwright_migrations`.

Strategy uses a bounded public YouTube research sample, not a complete census of YouTube or the broader market. It ingests no YouTube Analytics or private creator metrics. Monetization paths and proposed targets remain hypotheses. Step 10 creates no video ideas, titles, hooks, thumbnails, scripts, calendars, media, or publishing actions.

Provenance comparison uses a canonical, key-order-independent serializer (`src/server/workflows/canonical-json.ts`) rather than `JSON.stringify`, so reordered keys are not mistaken for tampering while every identity, hash, and lineage change is still rejected.

## Production verification procedure

Deterministic, credential-free checks:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Shared-project and real-provider gates, in order. Each requires `.env.local`, including `CHANNELWRIGHT_SHARED_DATABASE_CA_PATH` pointing at the Supabase project CA downloaded from Database Settings, and an explicit OpenAI model.

```bash
npm run gate:supabase:inspect
```

```bash
npm run gate:supabase:migrate
```

```bash
npm run gate:supabase:live
```

```bash
npm run gate:strategy:persisted
```

`gate:strategy:persisted` drives the real chain end to end: a real approved CHANNEL_RESEARCH artifact, an authenticated HTTP strategy start, the duplicate-start rejection, the production worker, `finalize-strategy` becoming durable run output that parses as `ChannelStrategyResult`, zero YouTube allowance, a human revision successor with its own budget and correct parent/root lineage, approval hashes, rejected post-approval mutation, and removal of every temporary identity and row. It refuses to run if migration `202608140002` is not applied.
