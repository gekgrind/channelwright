# CHANNEL_CONTENT_INTELLIGENCE

The third provider-backed workflow. It consumes one exact approved `CHANNEL_STRATEGY` artifact and produces an evidence-backed, viewer-value-gated content backlog with a single recommended next video. It answers "what should this channel make next, and why".

It creates no titles, thumbnails, scripts, storyboards, calendars, media, or publishing actions. Deterministic QA rejects those as downstream scope violations.

## Workflow graph

```
validate-approved-strategy -> expand-content-pillars -> discover-youtube-topics
  -> assess-topic-opportunities -> synthesize-backlog
  -> initial-content-qa -> bounded-content-revision -> final-content-qa
  -> finalize-content-intelligence -> review-content-intelligence
```

Registered in `src/domain/production-workflows.ts` and independently pinned in `start_workflow`, so an authenticated caller cannot forge a different graph. `finalize-content-intelligence` is the canonical finalizer: its output becomes `workflow_runs.output_payload`. `discover-youtube-topics` is the provenance step hashed at the final human decision.

## Input contract

The public start contract accepts only:

```ts
{ strategyWorkflowId, strategyRunId, targetBacklogSize?: 5..12, pillarFilter?: string[1..8] }
```

The browser never submits strategy content. `start_workflow` calls `resolve_approved_strategy_artifact` and persists an immutable `approvedStrategyReference` into the run input. The database rejects any key outside the four permitted ones.

## Approved strategy resolver

`channelwright.resolve_approved_strategy_artifact` verifies owner (cross-owner requests are `NOT_FOUND`), workflow, run, workflow type, `COMPLETED` terminal state, an `APPROVED` decision made by the owner, finalizer output equal to run output, passing final QA with a valid score and state, a present upstream research provenance step with a non-empty evidence bundle, stored artifact and provenance hashes matching the authoritative JSONB, agreement between the strategy artifact's own `upstreamResearch` and the resolved research reference, and valid parent/root lineage.

It returns the reference, the strategy result, and the research evidence bundle. The reference transitively carries the full approved research reference, so content intelligence inherits both provenance chains.

`SupabaseApprovedStrategyResolver` re-resolves at the first worker step and compares canonically (`src/server/workflows/canonical-json.ts`), so reordered keys are not tampering while any identity, hash, QA, or lineage drift — including inside the transitive research reference — fails closed. Database messages are never returned to the caller.

## Output contract

`channelContentIntelligenceResultSchema` v1 contains pillar expansions, up to twelve topic opportunities, a score decomposition per topic, a ranked backlog, one next-video recommendation, risks, assumptions, open questions, a recommended next action, and the immutable upstream strategy reference.

Each topic carries a working concept and angle, viewer question and intent, proposed viewer value, differentiated contribution, its own discovery evidence IDs, a competition signal, saturation assessment, differentiation opportunity, shelf life (`EVERGREEN | SEMI_EVERGREEN | TIMELY | EVENT_DRIVEN`) with a decay note where applicable, production complexity, strategic fit, optional monetization relevance, assumptions, uncertainties, and a full `viewerValueAssessment`.

The contract has no field for predicted views, subscribers, revenue, or exact search volume. Those are not merely discouraged; they are unrepresentable, and deterministic QA additionally rejects them in free text.

Collections are capped so a realistic artifact fits the engine's 64 KiB durable-output limit, and QA rejects a payload above a 60,000-byte margin with `RESULT_PAYLOAD_TOO_LARGE` before persistence is attempted.

## Scoring

Every topic carries a decomposition; there is no aggregate number without it. Each component names its dimension, score (0–10), weight, rationale, and basis (`EVIDENCE | STRATEGY | ASSUMPTION | HEURISTIC`) plus evidence references. Available dimensions are strategy alignment, audience need, viewer value, evidence strength, differentiation, opportunity, competition, shelf life, monetization fit, production feasibility, and channel sustainability.

Weights are model-chosen per topic rather than fixed, because the right weighting differs by channel; deterministic QA enforces that they sum to 1 (±0.02) and that the weighted total equals the sum of score × weight (±0.05). Between five and eleven dimensions must be scored, with no repeats.

## YouTube topic discovery

`YouTubeTopicDiscoveryProvider` reuses the research error taxonomy and query normalisation, and applies the same bounded-request, reservation-before-spend, timeout, and cache discipline.

Model-generated queries are untrusted: `sanitizeDiscoveryQuery` normalises to NFKC, strips Unicode control characters and everything outside a conservative allowlist, collapses whitespace, bounds to 120 characters, and rejects anything shorter than two characters. The plan is then de-duplicated and truncated to the configured pillar, per-pillar, and total-search ceilings before any request is issued.

Evidence IDs are `yt:video:<id>`, `yt:channel:<id>`, and `yt:search:<sha256-prefix>`. Search observations record that a query was actually issued and how many results were retained — retrieval provenance, never demand. `pageInfo.totalResults` is deliberately discarded because it is routinely misread as search volume. Every record carries its query, pillar attribution, retrieval time, and `LIVE` or `CACHE` origin.

Partial results are safe and labelled: a failed detail batch adds an explicit limitation and marks the bundle `partial`. A bundle containing only search observations and no video or channel record fails with `CONTENT_DISCOVERY_NO_EVIDENCE`, because query provenance alone proves nothing about what content exists.

Caching uses `channelwright.research_evidence_cache` under a distinct key scope, so discovery entries never collide with research entries. A hit is returned as `CACHE` origin with zero claimed provider spend and the original retrieval time preserved. A shape-incompatible cached row is treated as a miss rather than an error.

## Originality protection

Deterministic near-duplicate detection uses normalised content tokens with stopwords and bare numbers removed, compared by Jaccard similarity. At or above 0.7 two topics are treated as serving the same viewer intent and rejected with `DUPLICATE_TOPIC_CONCEPT`. Dropping numbers is what makes "5 ways…" and "7 ways…" collide. No embedding infrastructure is introduced for this slice.

Every topic must additionally cite at least one discovery evidence record retrieved for its own pillar; citing only inherited research evidence fails with `TOPIC_EVIDENCE_NOT_INDEPENDENTLY_DISCOVERED`.

Semantic QA judges the deeper question of whether a topic is genuinely useful or merely generic filler.

## Deterministic QA

`deterministicContentValidation` covers: altered upstream strategy reference; evidence outside the discovery bundle; evidence identity or URL mismatch; pillar not in the approved strategy; topic not attached to an expanded pillar; topic lacking own-pillar evidence; non-evergreen topic with no decay treatment; understated viewer-value gate; rejected viewer-value gate; blocking content-integrity risk; near-duplicate topics; missing or unknown topic scores; duplicated scoring dimension; invalid weights; invalid weighted arithmetic; unknown or duplicated backlog entries; non-contiguous ranks; recommendation absent from the backlog; recommendation failing the viewer-value gate; confidence exceeding the weaker of the upstream research and strategy QA scores; confidence on a partial discovery bundle (warning); fabricated performance, revenue, or search-volume claims; unsupported monetary guarantees; downstream scope violations; and oversized payloads.

Recommendation reason counts, presence of assumptions and uncertainties, and KPI-style fabrication are enforced by the typed contract itself, which is stronger: they fail Zod parsing and are terminal in the worker rather than becoming QA findings.

## Semantic QA and bounded revision

Independent semantic QA uses a separately configurable model and judges what rules cannot: genuine usefulness, substantive viewer value, real differentiation, whether recommendation reasoning follows from cited evidence, strategy fit, click-bait intent, and whether the backlog forms a coherent channel. Its findings are filtered against known evidence exactly as research and strategy QA are, and a QA claim citing unknown evidence becomes its own error.

At most one automated revision runs, and only for material findings. It receives the exact findings and may not fetch new evidence. If the revision introduces a deterministic error the draft did not have, it is discarded and the safer pre-revision draft remains authoritative. Final QA promotes a clean-but-improvable result to `human_review_required` rather than looping.

Failures whose premise is deceptive rather than merely weak are not cosmetically fixable. `VIEWER_VALUE_GATE_REJECTED`, `CONTENT_INTEGRITY_BLOCKING_RISK`, `UNSUPPORTED_MONETARY_GUARANTEE`, `FABRICATED_SEARCH_VOLUME`, and `UPSTREAM_STRATEGY_REFERENCE_CHANGED` fail closed at `CONTENT_INTEGRITY_UNREVISABLE` before any revision is attempted.

## Human review, concurrency, and accounting

Approve, reject, and request-revision reuse `decide_workflow_approval` unchanged. A revision creates a separately budgeted successor run with preserved parent and root lineage, the persisted revision note, and the same immutable upstream strategy reference. Nothing is overwritten.

`CONTENT_LIMIT_REACHED` (HTTP 429) rejects a second active run for the same owner and approved strategy run, enforced both by an explicit check and by the partial unique index `workflow_runs_active_content_uniq` so simultaneous requests cannot both succeed. `BLOCKED` is excluded from the guarded statuses so revision successors stay legal, and terminal runs never block regeneration.

Accounting reuses the Step 9B tables and RPCs with no widened ceilings. Defaults are 8 searches, 24 provider requests, 900 quota units, 3 synthesis calls, 4 QA calls, 2 revision calls, 600,000 input tokens, 60,000 output tokens, 660,000 total tokens, and one automated revision — all inside the existing database maxima of 12 / 36 / 1200. Retries share one run budget; exhaustion is durable, typed as `CONTENT_RESOURCE_BUDGET_EXHAUSTED`, and terminal. Topics discovered and retained are recorded as observational counters.

## Model configuration and provider neutrality

`ContentModel` is a provider-neutral interface; domain contracts never mention OpenAI. `OpenAIContentModel` is one adapter, and a future Anthropic or bring-your-own-provider adapter can satisfy the same interface without touching the workflow, its schemas, or its QA. Model output is validated by the same Zod contracts regardless of provider, and model identity is persisted through the same usage accounting.

Model selection is required and fails closed with `AI_MODEL_NOT_CONFIGURED`:

- content synthesis ← `OPENAI_CONTENT_SYNTHESIS_MODEL`, else `OPENAI_SYNTHESIS_MODEL`, else `OPENAI_MODEL`
- content QA ← `OPENAI_CONTENT_QA_MODEL`, else `OPENAI_QA_MODEL`, else the resolved content synthesis model

A future Connected Providers layer would integrate at the `ContentModel` boundary. User-supplied API keys and arbitrary external model connections are not implemented.

## Verification status

Deterministic tests, migration contract tests, lint, strict TypeScript, and the production build all pass. Provider and model execution are exercised through injected fakes only.

**Not verified in this slice:** live OpenAI or YouTube execution for this workflow, remote migration application, live Supabase RLS behaviour, and browser review against persisted production state. `202608140003_content_intelligence.sql` has not been applied to any remote database.
