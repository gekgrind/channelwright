# CHANNEL_VIDEO_BRIEF

The fourth provider-backed workflow, and the quality gate between "what should we make?" and "let's produce it". It consumes one exact approved `CHANNEL_CONTENT_INTELLIGENCE` artifact plus one eligible topic from that artifact's ranked backlog, and produces the creative and production direction for a single video.

It answers: *what should this specific video accomplish, for whom, why is it worth making, and how should production deliver that value?*

It creates no final title, thumbnail copy or asset, script, narration, storyboard, media, voiceover, short-form recut, upload, or publishing action. Deterministic QA rejects those as downstream scope violations. An approved brief means the creative and production direction is approved — never that the video is ready to produce, export, or publish.

## Workflow graph

```
validate-approved-content -> design-viewer-promise -> build-video-brief
  -> initial-video-brief-qa -> bounded-video-brief-revision -> final-video-brief-qa
  -> finalize-video-brief -> review-video-brief
```

Registered in `src/domain/production-workflows.ts` and independently pinned in `start_workflow`, so an authenticated caller cannot forge a different graph. `finalize-video-brief` is the canonical finalizer: its output becomes `workflow_runs.output_payload`. `validate-approved-content` is the provenance step hashed at the final human decision.

Topic resolution happens inside `validate-approved-content` rather than as a separate step, and the independent critic runs inside `initial-video-brief-qa`, matching how content intelligence structures the same concerns. Neither warranted its own step.

## Input contract

The public start contract accepts only:

```ts
{ contentIntelligenceWorkflowId, contentIntelligenceRunId, topicId? }
```

The browser never submits a topic object, a content result, a strategy or research artifact, a provenance hash, or any QA state. `start_workflow` calls `resolve_approved_content_artifact` and persists an immutable `approvedContentReference` plus the server-resolved `selectedTopicId` into the run input. The database rejects any key outside the three permitted ones.

When `topicId` is absent the artifact's own authoritative `nextVideoRecommendation` is used, recorded as `selectionSource: NEXT_VIDEO_RECOMMENDATION`. A supplied topic is recorded as `OPERATOR_SELECTED` unless it happens to be the recommendation.

## Approved content resolver

`channelwright.resolve_approved_content_artifact(workflow, run, topic)` verifies owner (cross-owner requests are `NOT_FOUND`, so the ID space stays non-enumerable), workflow, run, workflow type, `COMPLETED` terminal state, an `APPROVED` decision made by the owner, finalizer output equal to run output, passing final QA with a valid score and state, a present discovery bundle with at least one evidence record, a present upstream strategy provenance step, agreement between the content artifact's own `upstreamStrategy` and the resolved strategy reference, stored artifact and provenance hashes matching the authoritative JSONB, and valid parent/root lineage.

It then resolves the selected topic and verifies that it is in the approved ranked backlog, belongs to this exact artifact's topic set, passed its own Viewer Value gate (`PASS`), and cites at least one discovery evidence record.

It returns the reference, the content result, the discovery bundle, the selected topic, and a selection record. The reference transitively carries the approved strategy reference, which itself carries the approved research reference, so one reference anchors the whole chain.

`SupabaseApprovedContentResolver` re-resolves at the first worker step and compares canonically (`src/server/workflows/canonical-json.ts`), so reordered keys are not tampering while any identity, hash, QA, lineage, or selected-topic drift fails closed. Database messages are never returned to the caller.

## Provenance chain

```
CHANNEL_RESEARCH -> CHANNEL_STRATEGY -> CHANNEL_CONTENT_INTELLIGENCE -> CHANNEL_VIDEO_BRIEF
```

`upstreamContentIntelligence` carries `upstreamStrategy`, which carries `upstreamResearch`. Identity, provenance, and the inherited Viewer Value contract hash are stamped by the executor from resolver output and are never accepted from model output — a model that returns a different reference or topic has those fields overwritten, and deterministic QA additionally rejects any drift.

## Output contract

`channelVideoBriefResultSchema` v1 contains source identity, viewer, viewer promise, original contribution, evidence plan, creative direction, content architecture, hook strategy, retention architecture, CTA strategy, monetization alignment, an optional supporting resource, this stage's own Viewer Value assessment, risks, assumptions, open questions, a recommended next action, and the immutable upstream reference plus selection record.

The contract has no field for predicted views, subscribers, revenue, search volume, retention percentage, or watch time. Those are not merely discouraged; they are unrepresentable, and deterministic QA additionally rejects them in free text.

Collections are capped so a realistic artifact fits the engine's 64 KiB durable-output limit, and QA rejects a payload above a 60,000-byte margin with `RESULT_PAYLOAD_TOO_LARGE` before persistence is attempted.

### Viewer promise

The promise must be specific enough to QA. It states what the viewer will understand, achieve, decide, avoid, or be able to do; why that matters; the beginning-to-end transformation; the concrete value; what the video **deliberately does not promise**; and how a reviewer could verify the finished video kept it. `VIEWER_PROMISE_VAGUE` rejects the phrasings that reliably signal a non-promise ("everything you need to know", "the ultimate guide"); semantic QA judges the rest.

### Evidence plan

Every material claim carries a typed status: `SUPPORTED`, `STRATEGIC_ASSUMPTION`, `PRODUCTION_ASSUMPTION`, `RESEARCH_REQUIRED`, or `MUST_NOT_CLAIM`. A claim the upstream evidence does not support is `RESEARCH_REQUIRED` with a note saying what must be established before scripting — never invented into support. A beat that plans to make a `MUST_NOT_CLAIM` claim is a deterministic error.

**This workflow performs no external evidence retrieval.** It reasons over the discovery bundle the approved content-intelligence run already paid for. Adding retrieval here would have meaningfully expanded the slice, so the honest structured research-needed plan is produced instead. Its provider-request, quota, and search ceilings are therefore exactly zero, enforced in the database.

## Viewer Value inheritance

The existing doctrine (`src/domain/viewer-value.ts`, `docs/viewer-value-doctrine.md`) is reused unchanged — there is no second, weaker notion of viewer value.

The brief carries an immutable `inheritedViewerValueProvenance` lifted from the upstream topic's own assessment (`originStage: CONTENT_INTELLIGENCE`, with a canonical SHA-256 of that topic's viewer-value contract, computed in the database by `canonical_jsonb_text` so it is key-order independent and agrees with the application's `canonicalJson`). It then produces its **own** stage assessment, judged by the same `deterministicViewerValueGate`, whose floor overrules an optimistic model via `resolveViewerValueGate`.

The doctrine's stage enum member `VIDEO_STRATEGY` was renamed to `VIDEO_BRIEF`. It had never been emitted or persisted — only `CONTENT_INTELLIGENCE` is produced today — so the rename is safe.

## Multi-model collaboration

Routing uses the existing provider-neutral layer under a new `VIDEO_BRIEF` namespace. Nothing in the contracts or the `VideoBriefModel` interface names a vendor.

| Step | Role | Typical provider |
|---|---|---|
| design-viewer-promise | GENERATOR | OpenAI |
| build-video-brief | GENERATOR | OpenAI |
| initial-video-brief-qa (critique) | CRITIC | Anthropic |
| initial-video-brief-qa (semantic QA) | QA | Anthropic |
| bounded-video-brief-revision | REVISION | OpenAI |
| final-video-brief-qa | QA | Anthropic |

Fully reconfigurable via `VIDEO_BRIEF_<ROLE>_PROVIDER` / `VIDEO_BRIEF_<ROLE>_MODEL`, falling back to the namespace and global defaults, and failing closed with `AI_MODEL_NOT_CONFIGURED`.

The critic is told explicitly that it is not the arbiter. It challenges vague promises, promises the architecture does not deliver, asserted-not-demonstrated contribution, generic sections, claims outrunning evidence, hooks whose payoff the video does not keep, bloated openings, monetization that competes with viewer value, unjustified production complexity, and strategy drift. Critic evidence citations are filtered against the approved bundle before persistence. No chain-of-thought is requested or stored; findings are concise, user-safe rationales.

There is deliberately no dual generation: two providers writing complete briefs and a third choosing between them doubles cost, halves accountability, and produces no independent signal.

## Deterministic QA

`deterministicVideoBriefValidation` is authoritative and runs before the critic and semantic QA. It covers: changed upstream reference; altered selected-topic identity; altered Viewer Value provenance; source topic/pillar mismatch; evidence outside the approved bundle; evidence identity mismatch; a `SUPPORTED` claim with no evidence; a `RESEARCH_REQUIRED` claim with no note; duplicate claim identity; a beat referencing an unknown or forbidden claim; duplicate section identity; malformed content architecture; unknown hook payoff or retention section; vague promise; missing explicit non-promises; understated or rejected Viewer Value gate; blocking content-integrity risk; absent original contribution; deceptive hook; monetization overriding viewer value; inconsistent monetization; confidence exceeding upstream evidence; fabricated performance, revenue, search-volume, or retention claims; unsupported monetary guarantees; title, thumbnail, storyboard, script, and publishing scope violations; and oversized payloads.

Scope regexes are scoped to Channelwright *producing* the artifact, so a video legitimately about thumbnails or scripting as a subject is not a violation.

## Semantic QA and bounded revision

Independent semantic QA judges what rules cannot: whether a real viewer receives meaningful value, whether the promise is specific and truthful, whether the architecture delivers it, whether the contribution is substantive rather than manufactured novelty, coherence and pacing, missing proof points, weak assumptions, intrusive monetization, channel fit, justified production complexity, hook honesty, and finally whether the video deserves the resources to produce it. Findings are structured and filtered against known evidence; a QA claim citing unknown evidence becomes its own error.

At most one automated revision runs, and only for material findings — a failing verdict counts as material even with zero errors, since warning pressure alone can push the score below the pass threshold. The reviser receives the draft, the exact findings, the immutable upstream reference, and the permitted evidence; it may not fetch new evidence. If the revision introduces a deterministic error the draft did not have, it is discarded and the safer pre-revision draft remains authoritative. Final QA promotes a clean-but-improvable result to `human_review_required` rather than looping.

Failures whose premise is deceptive or whose provenance is corrupted are not cosmetically fixable and fail closed at `VIDEO_BRIEF_INTEGRITY_UNREVISABLE` before any revision is attempted: `UPSTREAM_CONTENT_REFERENCE_CHANGED`, `SELECTED_TOPIC_IDENTITY_CHANGED`, `VIEWER_VALUE_PROVENANCE_ALTERED`, `VIEWER_VALUE_GATE_REJECTED`, `CONTENT_INTEGRITY_BLOCKING_RISK`, `UNSUPPORTED_MONETARY_GUARANTEE`, `FABRICATED_SEARCH_VOLUME`, `EVIDENCE_REFERENCE_NOT_FOUND`.

## Human review, concurrency, and accounting

Approve, reject, and request-revision reuse `decide_workflow_approval`. A revision creates a separately budgeted successor run with preserved parent and root lineage, the persisted revision note, the same immutable upstream reference, and the same selected topic. Nothing is overwritten.

`VIDEO_BRIEF_LIMIT_REACHED` (HTTP 429) rejects a second active run for the same owner, approved content run, **and selected topic** — two different topics from the same backlog may legitimately be briefed concurrently. Enforced both by an explicit check and by the partial unique index `workflow_runs_active_video_brief_uniq`, so simultaneous requests cannot both succeed. `BLOCKED` is excluded so revision successors stay legal.

Accounting reuses the existing tables and RPCs with no widened ceilings. Defaults are 0 searches, 0 provider requests, 0 quota units, 4 synthesis calls, 6 QA calls, 2 revision calls, 500,000 input tokens, 60,000 output tokens, 560,000 total tokens, and one automated revision. `CHANNEL_VIDEO_BRIEF` joins `CHANNEL_STRATEGY` as a no-external-retrieval workflow required to declare exactly zero provider usage. Every model invocation reserves before the call and settles conservatively on failure, so a provider that may have billed us cannot appear free, and switching provider never creates a fresh allowance. Retries share one run budget; exhaustion is durable and terminal.

## Studio

`/studio` now runs Research → Strategy → Content Intelligence → Video Brief. The operator sees the recommended next video, can choose another backlog topic that passed the Viewer Value gate, starts a brief (sending identifiers only), watches stage state, and reads the result as a creative document — promise, viewer, contribution, evidence plan with research-required and must-not-claim items surfaced, content architecture beats, hook strategy, creative direction, CTA and monetization, risks and assumptions, and the independent critique. Then approve, reject, or request a revision with a note.

No raw JSON is dumped, and no chain-of-thought is exposed. The UI states that approval is direction only and never claims readiness to publish, export, or upload.

## Downstream boundaries

The script stage is now implemented as `CHANNEL_VIDEO_SCRIPT`, which consumes one exact approved brief. The remaining stages stay separate and unimplemented, and the brief is shaped to give them structured input rather than to pre-empt them: title and packaging, thumbnail concepting, storyboard, asset generation, voice, video generation, editing, rendering, short-form recuts, upload, publishing, analytics, and the learning loop.

## Verification status

Deterministic tests, migration contract tests, lint, strict TypeScript, and the production build all pass.

**LIVE VERIFIED** against the shared Supabase project `rifzbzaabkaeagyulxip`, schema `channelwright`, on 2026-08-20. Migrations `202608140001`-`202608150002` are applied; the ledger reports 16 applied, 16 local, no pending and no divergence. `npm run gate:videobrief:persisted` proves, against persisted data: canonical-string and hash parity between `canonical_jsonb_text` and the application's `canonicalJson` (including reordered keys, nesting, arrays, numeric scale, and the real Viewer Value contract); the inherited contract hash matching the application byte for byte; resolver behaviour for the default recommendation, an explicit eligible topic, cross-owner access, unknown runs, ineligible topics, corrupted hashes, unapproved and non-terminal artifacts; artifact immutability after approval; execute privileges for anon, authenticated, and service role; RLS on every workflow table; the owner + content-run + topic concurrency boundary, including that two different topics may run concurrently; and the zero-retrieval accounting invariant. The gate removes every record and temporary auth user it creates.

Live verification found and fixed one defect that static testing could not catch: pgcrypto lives in the `extensions` schema, but the approved-artifact resolvers and `decide_workflow_approval` were created with `set search_path = channelwright, pg_temp`, so every runtime `digest()` call failed. plpgsql resolves identifiers at call time, so the migrations applied cleanly and the text-based tests passed. This broke the entire Research -> Strategy -> Content Intelligence -> Video Brief chain. `202608150002_extension_search_path.sql` repairs it with `ALTER FUNCTION`, which cannot drift from the original bodies and keeps `public` off the search_path.

**Not verified in this slice:** live OpenAI or Anthropic execution, and browser review against persisted production state. Both are blocked on model routing: no model is configured for any namespace, so the router fails closed with `AI_MODEL_NOT_CONFIGURED` by design. To enable them an operator must set a provider and model for the `VIDEO_BRIEF` namespace - at minimum `OPENAI_MODEL` and `ANTHROPIC_MODEL`, or the per-role `VIDEO_BRIEF_GENERATOR_MODEL`, `VIDEO_BRIEF_CRITIC_MODEL`, `VIDEO_BRIEF_QA_MODEL`, and `VIDEO_BRIEF_REVISION_MODEL`. See `.env.example`.

A follow-up investigation on 2026-08-25 checked whether `channelwright.execute_media_production_action` shares this defect (it was previously suspected to). It does not: unlike the resolvers, that function calls `extensions.digest(...)` schema-qualified (`202608110001_media_production_pipeline.sql:357`), so it resolves regardless of its `search_path = channelwright, pg_temp` and needs no `ALTER FUNCTION` repair. Adding `extensions` to its search_path would be an unnecessary widening of a hardened setting. The invariant is pinned by `media-migration.test.ts`, which asserts the call stays schema-qualified (every `digest(` is an `extensions.digest(`). Two things support the qualified call: the repository/migration contract expects pgcrypto to live in `extensions`, and `202608150002_extension_search_path.sql` validates that expectation at apply time (it raises `PGCRYPTO_SCHEMA_UNEXPECTED` if pgcrypto is not in `extensions` when that migration runs). This is an apply-time check, not continuous monitoring, and it is not the only thing that could ever affect resolution; but for the media-production function specifically, the explicit `extensions.digest(...)` reference is what removes any search-path dependency.
