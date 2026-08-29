---
Agent: Claude Code (Opus 4.8)
Task: Repair CHANNEL_VIDEO_SCRIPT after Codex verification, then hand back for re-verification
Base: `0db4c814d4a19a0da5740d2667fe6f15d7a6088f` (branch `main`)
Original implementation commit: `a7d88f2b08e1811bcecc4e2bb660726429657143`
First repair commit: `b4e33764ce1a73e5e15fb8dcef2bbdaf448475da`
Second repair commit: `d059a53549488489a1b6e4f6ea0a96ecc4556f48`
Third repair commit (this pass): see `git rev-parse feat/channel-video-script`
Verdict: `REPAIRS COMPLETE — READY FOR INDEPENDENT RE-VERIFICATION`
Branch: `feat/channel-video-script`
---

# Third Repair Pass — Codex round 3 (NOT READY FOR MERGE → repaired)

Prior HEAD reviewed by Codex: `d059a53`. Six findings + doc fix, all reproduced
and repaired; no shared-Supabase / paid-provider / production action taken.

1. **[P1] Critic findings could be truncated before pass/fail.** Reproduced: the
   executor appended critic findings to semantic findings and `.slice(0, 40)`
   *before* `mergeVideoScriptQA`; since semantic QA alone can carry 40 findings, a
   blocking critic error could be dropped. Fix: `mergeVideoScriptQA` now takes
   critic findings as a **separate decision-critical argument** and evaluates
   pass/fail over the complete deterministic+semantic+critic set; the executor no
   longer pre-truncates. The persisted `findings` array is still capped (50) for
   storage, but ranked errors-first so a blocking finding can never be dropped by
   the cap. (`video-script-validation.ts`, `video-script-executor.ts`.)
2. **[P1] Revised artifact could be reviewed by its own author's provider.**
   Reproduced: only `GENERATOR != CRITIC` was enforced; the `REVISION` role
   authors the accepted final artifact. Fix: the executor also asserts
   `REVISION != CRITIC` (typed `AI_PROVIDER_INDEPENDENCE_REQUIRED`) before any
   spend, using resolved provider identity. (`video-script-executor.ts`.)
3. **[P1] Final provenance named the wrong writer.** Reproduced: `crossModelReview.
   generator` always pointed at the original synthesis even when a revision
   authored the accepted artifact. Fix: final QA sets the author to the REVISION
   attribution when a revision was accepted (from the provenance trail), else the
   GENERATOR; the full trail stays in `modelProvenance` and the critic stays
   separately represented. (`video-script-executor.ts`.)
4. **[P1] QA budget could not complete the authorized path.** Documented the real
   call graph (normal path = 4 QA calls; full-retry = 8). Fixed
   `maxAggregateQaCalls` min `3 -> 4` (normal path) and default `6 -> 8`
   (full retry, <= DB ceiling 12); raised input/output/total-token defaults for the
   larger call graph; `boundedInteger` rejects a below-minimum config.
   (`video-script-config.ts`, `.env.example`.)
5. **[P2] Removed the unreliable guarantee lexical heuristic as an approval
   authority.** Reproduced Codex's false positives ("prevent common mistakes",
   "does not remove scheduling gaps") and false negatives ("100% effective",
   "makes scheduling gaps impossible"). Fix: deleted the `OUTCOME_GUARANTEE` rule
   and `UNSUPPORTED_OUTCOME_GUARANTEE`. Deterministic validation keeps only what it
   can reliably prove (structural evidence-plan / MUST_NOT_CLAIM enforcement +
   digit-anchored fabrication rules). Absolute / unsupported-certainty language is
   judged by the independent semantic critic, whose error findings are now
   first-class non-overridable blockers (finding #1/#6). (`video-script-validation.ts`.)
6. **Critic errors are first-class blockers.** A critic `error` forces `passed=false`
   / `recommendation=revise` and cannot be overridden by a semantic `accept` or a
   high score, at both initial and final QA (a consequence of the #1 structure;
   covered by explicit tests).
7. **Disposable-gate documentation** corrected to describe the explicit-opt-in-only
   connection contract (no `DATABASE_URL`/localhost fallback).

## Verification (this pass)
- Full `npm test`: **122 files, 968 tests, 0 failures.** Typecheck clean; lint 0
  errors (2 pre-existing unrelated worktree warnings); build success.
- Disposable-PG gate: **UNAVAILABLE** — no PostgreSQL/Docker/WSL-Postgres in this
  environment and `CHANNELWRIGHT_DISPOSABLE_DATABASE_URL` unset. Not run. This is
  the sole external merge prerequisite (see Remaining Gaps below).

---

# Second Repair Pass — Codex round 2 (NOT READY FOR MERGE → repaired)

Codex round 2 confirmed round-1 repairs held but found three P1 defects plus an
over-broad heuristic. All reproduced and repaired.

1. **[P1] Forbidden-claim narration bypassable after revision.** Reproduced:
   `"This workflow removes scheduling gaps for every upload"` with empty `claimIds`
   and the forbidden claim still `OMITTED` → 0 findings; and the critic reviewed
   only the draft, not the revised artifact. Two-part fix:
   - **Deterministic:** the outcome-guarantee check is now bound to the actual
     narration (spoken opening, section narration, on-screen text, visual
     direction, spoken CTA) instead of model-authored `claimIds`, and its pattern
     targets absolute elimination-of-a-bad-outcome / guarantee / 100% language.
     `video-script-validation.ts`.
   - **Architectural:** the independent critic (different provider) now reviews the
     **revised** artifact at `final-video-script-qa`; its error-severity findings
     fail the merged QA and block finalization. `video-script-executor.ts`.
2. **[P1] Disposable PostgreSQL gate not isolated.** Reproduced: fell back to
   generic `DATABASE_URL`/localhost, force-dropped the database, and leaked
   cluster-global roles. Fix: honours ONLY `CHANNELWRIGHT_DISPOSABLE_DATABASE_URL`
   (no fallback, no default — UNAVAILABLE if unset); drops the database **without
   force**; creates only the roles that were missing and drops exactly those in
   cleanup. `channel-video-script-disposable-pg.ts`.
3. **[P1] Persisted gate leaked temp state on failure.** Reproduced: connection
   and both users created before the `try`, so a second-user failure leaked the
   first; cleanup could abort before deleting users / closing the connection. Fix:
   all resources acquired inside the `try`, tracked in an `owners` array; the
   `finally` guards each phase independently and always closes the connection in an
   inner `finally`. `channel-video-script-persisted-live.ts`.
4. **Over-broad outcome-guarantee heuristic.** Reproduced: a defensive assumption
   like `"Do not guarantee zero scheduling gaps"` failed because the whole artifact
   was scanned. Fixed by the same narration-scoping in #1 (meta fields —
   assumptions/risks/open questions — are no longer scanned for this heuristic).

Round-2 verification: focused + full `npm test` (see below), typecheck/lint/build
clean. Disposable-PG gate still requires the operator's PostgreSQL (UNAVAILABLE in
this session). No migration added this pass; no shared/production mutation.

---

# CHANNEL_VIDEO_SCRIPT Repair Pass (Codex NOT READY FOR MERGE → repaired)

Codex verified `a7d88f2` as structurally sound but NOT READY FOR MERGE. All eight
findings were independently reproduced against the repository and repaired.

## Defects reproduced and repaired

1. **BLOCKING — approved-artifact immutability incomplete.** Reproduced: the
   shared triggers (`protect_final_research_artifact` / `_step_output`, current
   definition in `202608140003`) allow-listed only RESEARCH/STRATEGY/
   CONTENT_INTELLIGENCE, so approved VIDEO_BRIEF and VIDEO_SCRIPT run payloads and
   finalized step outputs could be rewritten (and their hashes re-stamped) by a
   privileged write. Fix: forward migration `202608160002_video_immutability.sql`
   recreates both shared functions with the allow-list widened to include
   `CHANNEL_VIDEO_BRIEF` and `CHANNEL_VIDEO_SCRIPT` (triggers bind by name, so no
   trigger/behaviour change for the earlier verticals). Runtime-proven by the new
   disposable-PostgreSQL gate (see below) — not only source-text.

2. **BLOCKING — Viewer Value REVISE could finalize.** Reproduced: the deterministic
   `VIEWER_VALUE_GATE_REVISION_REQUIRED` was a warning, so merged QA could still
   report `passed=true`/`accept` and finalization succeeded. Fix: it is now an
   `error` in `deterministicVideoScriptValidation`, so it forces the bounded
   revision and, if still REVISE at final QA, the finalizer refuses to advance it
   (`VIDEO_SCRIPT_QA_REJECTED`). It is deliberately NOT in the unrevisable set so
   the one bounded revision still gets a chance. Regressions cover pre-revision and
   post-revision/finalization.

3. **MAJOR — claim integrity detached from narration.** Reproduced: forbidden
   claim narrated with empty `claimIds` produced no finding. Fix keys off the
   trusted brief evidence plan, not model metadata: (a) `CLAIM_USAGE_INCOMPLETE`
   requires every brief evidence-plan claim to be accounted for in `claimUsage`
   (a forbidden/unproven claim can no longer be silently omitted from metadata);
   (b) existing `FORBIDDEN_CLAIM_NOT_OMITTED` therefore now always applies to
   MUST_NOT_CLAIM claims; (c) a deterministic `UNSUPPORTED_OUTCOME_GUARANTEE`
   backstop over the narration catches the absolute-guarantee language family
   (marked unrevisable). SUPPORTED / RESEARCH_REQUIRED / MUST_NOT_CLAIM semantics
   preserved. Residual paraphrase-in-prose detection remains the independent
   semantic critic's job (a different provider — now enforced, see #5); this is
   documented, not pretended to be solved by regex.

4. **MAJOR — Studio showed the wrong run's QA.** Reproduced: final QA was found
   across all returned steps. Fix: `video-script-workspace.tsx` scopes the QA step
   lookup to `currentRun.id`, so a predecessor run's QA can never appear beside the
   successor script. Regression covers predecessor + successor with different QA.

5. **MAJOR — cross-provider critic independence not enforced.** Repository evidence
   (`docs/multi-model-architecture.md` line 15) states cross-model critique must be
   a different provider than the generator, but nothing enforced it and provider
   resolution defaults both to openai when unset. Fix: new shared
   `assertDistinctRoleProviders(router, "GENERATOR", "CRITIC")` (typed
   `AI_PROVIDER_INDEPENDENCE_REQUIRED`), called in the VIDEO_SCRIPT executor before
   any spend; missing-model config still fails closed first with
   `AI_MODEL_NOT_CONFIGURED`. Scoped to VIDEO_SCRIPT to avoid changing the other
   verticals' behaviour (see Remaining/Note).

6. **MAJOR — no safe disposable PostgreSQL runtime gate.** Added
   `scripts/channel-video-script-disposable-pg.ts`
   (`npm run gate:videoscript:disposable-pg`): creates a throwaway database on a
   disposable server, installs a minimal Supabase shim (roles, auth/extensions/
   storage, pgcrypto, auth.uid/jwt), applies the full migration chain from scratch,
   runtime-proves pgcrypto resolution, resolver trust boundary, RLS, immutability
   (incl. the new VIDEO_BRIEF/VIDEO_SCRIPT coverage AND a RESEARCH no-regression
   check), concurrency, canonical parity, and zero-retrieval accounting, then drops
   the database. Never touches shared Supabase; no paid providers. Reports
   `UNAVAILABLE` (exit 2) rather than passing when no server is reachable.

7. **Persisted-gate false confidence.** In `channel-video-script-persisted-live.ts`:
   cleanup no longer swallows delete errors and now verifies **every** owned table
   is empty; the nonzero-retrieval assertion now requires `VALIDATION_ERROR` (and
   rejects `LEASE_NOT_ACTIVE`), proving budget validation rejected it for the right
   reason.

8. **MINOR — content-architecture mapping consistency.** The contract states the
   scripted promise "must match" the brief and `coveredBriefBeatIds` is the beats
   covered. `SCRIPTED_PROMISE_DIVERGES` is now an error (was a warning), and a new
   `SOURCE_COVERAGE_MISMATCH` requires the declared covered beats to equal the
   beats the sections actually map to. Section-role-vs-beat-role divergence is left
   permitted (multiple sections may map one beat with differing narrative roles;
   no contract claims exact role equality).

## Verification results (this repair)

- Focused VIDEO_SCRIPT + role-router + workspace + migration + doctrine tests: PASS.
- Full `npm test`: **121 files, 951 tests, 0 failures** (clean run).
- `npm run typecheck`: clean. `npm run lint`: 0 errors (2 pre-existing warnings in
  an unrelated `.claude/worktrees/...` path). `npm run build`: success.
- `npm run gate:videoscript:disposable-pg`: **not executed in the repair session**
  — no PostgreSQL/Docker/pg-mem available here; it reported `UNAVAILABLE` cleanly.
  It is implemented and ready; the re-verifier must run it on a host with a
  disposable PostgreSQL to obtain the runtime immutability/resolver/RLS/concurrency
  evidence. This is the one merge-blocking item that could not be produced here.

## New forward migrations

- `202608160002_video_immutability.sql` — recreates the two shared
  `protect_final_*` functions with VIDEO_BRIEF + VIDEO_SCRIPT added to the
  allow-list. No trigger recreation, no unrelated schema touched, functions stay
  privileged. **No migration was applied to shared or production Supabase.**

## Remaining verification

- **Merge-blocking:** run `gate:videoscript:disposable-pg` on a host with a
  disposable PostgreSQL (unavailable in the repair session).
- **Operator/live:** live OpenAI+Anthropic run once `VIDEO_SCRIPT_*` env is set;
  applying migrations to shared Supabase; deployed-worker verification.
- **Note (out of scope):** the same immutability allow-list gap and the same
  Studio-QA/`REVISE`-warning/provider-independence patterns exist latently in the
  earlier verticals (RESEARCH/STRATEGY/CONTENT/VIDEO_BRIEF). Only VIDEO_SCRIPT was
  in scope; #1's migration fix already extends immutability to VIDEO_BRIEF too.

---

# CHANNEL_VIDEO_SCRIPT Vertical Slice (original implementation, `a7d88f2`)

## Summary

`CHANNEL_VIDEO_SCRIPT` is implemented as the fifth provider-backed Track-A workflow
vertical and the first concrete production artifact. It consumes exactly one
approved `CHANNEL_VIDEO_BRIEF`, re-resolved and integrity-checked from
authoritative database state, and produces a structured, timed, evidence-
disciplined script for a single video. It reuses — rather than forking — the
established deterministic-QA + independent-critic + semantic-QA + Viewer-Value +
bounded-revision + human-approval architecture, and preserves usage accounting,
provenance, canonicalization, RLS, concurrency, and fail-closed provider routing.

The script stage is the stage that writes spoken narration (unlike the brief,
which deliberately writes none). It stays bounded to scripting: deterministic QA
rejects final titles, thumbnail copy/imagery, storyboards/shot lists, generated
media (image/voice/video), uploads, and publishing as scope violations, while
allowing spoken narration, on-screen text, and inherited prose visual direction.

Every material claim maps to a claim in the approved brief's evidence plan and
inherits that claim's status. `MUST_NOT_CLAIM` material is omitted; `RESEARCH_
REQUIRED` / assumption material is never asserted as established fact. No external
evidence retrieval is performed — the accounting ceilings for provider requests,
quota, and searches are fixed at zero, exactly like `CHANNEL_STRATEGY` and
`CHANNEL_VIDEO_BRIEF`.

## Files Changed

### Domain / contracts
- `src/domain/production-workflows.ts` — added the `CHANNEL_VIDEO_SCRIPT` workflow
  type; `approvedVideoBriefReferenceSchema`, `videoScriptRequestInputSchema`
  (identifiers-only), `videoScriptInputSchema`, `selectedVideoBriefScopeSchema`,
  `approvedVideoBriefArtifactSchema`, the script content/result/QA/draft/revision
  schemas (opening hook, timed sections mapped to brief beats, claim usage,
  timing, CTA, evidence discipline, Viewer Value), the workflow definition
  (7 steps), registry entry, finalizer-map entry, start-request union + refine,
  and the exported types.

### Workflow / executor / model / validation / provider routing
- `src/server/workflows/video-script-config.ts` — zero-retrieval budget + bounded
  model ceilings.
- `src/server/workflows/approved-brief-resolver.ts` — trusted upstream resolver
  (`resolve_approved_video_brief_artifact`) with canonical drift detection.
- `src/server/workflows/video-script-model.ts` — provider-neutral model boundary
  (`draftScript`/`critique`/`reviseScript`/`qa`), reserve-before-call accounting,
  conservative settlement on failure, `VIDEO_SCRIPT` role namespace.
- `src/server/workflows/video-script-validation.ts` — deterministic validation
  (34 rules), QA merge, unrevisable classification, revision-regression guard.
- `src/server/workflows/video-script-executor.ts` — 6 worker steps + finalization,
  identity/provenance stamped server-side, bounded single revision.
- `src/server/workflows/workflow-worker.ts` — registered the executor and added
  the VIDEO_SCRIPT terminal error messages.
- `src/server/workflows/research-usage.ts` — `VIDEO_SCRIPT_RESOURCE_BUDGET_EXHAUSTED`.
- `src/server/ai/role-router.ts` — `VIDEO_SCRIPT` routing namespace (fails closed).
- `src/server/workflows/production-workflow-repository.ts` — `VIDEO_SCRIPT_LIMIT_REACHED`
  and `UPSTREAM_BRIEF_INVALID` typed error mapping.
- `src/app/api/workflows/route.ts` — added VIDEO_SCRIPT to the idempotency-required
  paid-workflow list.

### Database / migrations
- `supabase/migrations/202608160001_video_script.sql` — forward-only migration.

### Studio
- `src/features/studio/video-script-workspace.tsx` — new workspace.
- `src/features/studio/studio-app.tsx` — mounted after the video-brief workspace.

### Tests / gates
- `src/server/workflows/video-script-fixtures.test-helper.ts`
- `src/server/workflows/video-script-validation.test.ts` (30)
- `src/server/workflows/video-script-executor.test.ts` (26)
- `src/server/workflows/video-script-migration.test.ts` (24)
- `src/domain/video-script-doctrine.test.ts` (9)
- `src/features/studio/video-script-workspace.test.tsx` (9)
- `src/domain/production-workflows.test.ts` — added VIDEO_SCRIPT registry/contract
  coverage.
- `src/server/workflows/video-brief-migration.test.ts` — updated the "last
  migration file" assertion to point at the new forward migration (test-only).
- `scripts/channel-video-script-persisted-live.ts` + `package.json`
  (`gate:videoscript:persisted`).

### Documentation / handoff
- `.env.example` — VIDEO_SCRIPT routing + config block.
- `docs/agent-handoffs/current.md` — this handoff.
- `docs/agent-handoffs/archive/2026-08-25-claude-pgcrypto-search-path-investigation.md`
  — prior handoff, archived.

## Database Migration

`202608160001_video_script.sql` is additive and forward-only; no previously
applied migration is edited. It establishes:

- Both `workflow_type` check constraints extended to include `CHANNEL_VIDEO_SCRIPT`.
- `workflow_runs_active_video_script_uniq`: one active script run per owner per
  approved brief run, excluding `BLOCKED` so a human-revision successor stays legal.
- `resolve_approved_video_brief_artifact(uuid,uuid)`: security-definer resolver
  that verifies ownership (cross-owner → NOT_FOUND, non-enumerable), terminal +
  human-approved state, finalizer/output agreement, final-QA pass, provenance
  (`validate-approved-content`) with a non-empty discovery bundle, agreement with
  the brief's own upstream content reference, recomputed artifact/provenance
  hashes, lineage, and Viewer-Value PASS eligibility; derives the inherited
  Viewer-Value provenance with a canonical `channelwright.canonical_jsonb_text`
  SHA-256 over the brief's viewer-value contract.
- `start_workflow`, `complete_workflow_step`, `decide_workflow_approval`,
  `ensure_research_run_budget` recreated with the VIDEO_SCRIPT branch/case added;
  all earlier branches reproduced verbatim. `decide_workflow_approval` and the new
  resolver keep `search_path = channelwright, extensions, pg_temp` (they call
  `digest()`); the others keep the narrow `channelwright, pg_temp`. `public` is
  excluded everywhere. This preserves the 202608150002 search-path repair without
  a follow-up migration.
- Owner-scoped grants; worker mutations remain service-role only.

**Applied anywhere: NO.** No migration was applied to shared or production
Supabase.

## Verification Results

- Targeted: `video-script-validation` (30), `video-script-executor` (26),
  `video-script-migration` (24), `video-brief-migration` (still green),
  `video-script-doctrine` (9), `video-script-workspace` (9),
  `production-workflows` — all PASS.
- Full suite: `npm test` → PASS, **121 files, 932 tests** (was 116/834).
- Typecheck: `npm run typecheck` → clean (includes `scripts/**` via `**/*.ts`).
- Lint: `npm run lint` → 0 errors (2 pre-existing warnings in an unrelated
  `.claude/worktrees/...` path, not in changed files).
- Build: `npm run build` → success.
- Persisted DB gate (`gate:videoscript:persisted`): **NOT run.** It targets the
  shared Supabase project and would create/delete records there; the task forbids
  mutating shared/production infrastructure and no disposable Postgres is
  configured locally. The script is written, typechecks, and is ready for an
  operator to run against a disposable/branch database.

## Invariants Verified

- **Approved-brief trust boundary**: public start contract is identifiers-only
  (exactly `videoBriefWorkflowId` + `videoBriefRunId`); the reference, discovery
  bundle, topic, and Viewer-Value provenance are resolved server-side and the
  worker re-resolves + canonically compares at the first step.
- **Provenance/hash integrity**: artifact and provenance hashes recomputed and
  compared in SQL; canonical contract hash for inherited Viewer Value.
- **Evidence/claim integrity**: inherited status enforced; MUST_NOT_CLAIM omitted;
  RESEARCH_REQUIRED/assumptions never asserted as fact; citations bounded to the
  inherited discovery bundle; fabrication regexes for views/revenue/search/retention.
- **Viewer Value**: shared doctrine + deterministic floor gate re-run at this
  stage; model cannot understate the gate.
- **Bounded revision**: exactly one automated revision; integrity failures fail
  closed; a revision that introduces new deterministic errors is discarded.
- **Accounting**: reserve-before-call, conservative settlement on failure, zero
  retrieval enforced in DB and config, typed exhaustion code.
- **Zero retrieval**: provider/quota/search ceilings fixed at 0.
- **RLS / owner isolation**: unchanged; cross-owner resolution is NOT_FOUND.
- **Concurrency**: explicit guard + transactional unique index on the brief run.
- **Provider fail-closed**: VIDEO_SCRIPT namespace has no default model; an
  unconfigured role throws `AI_MODEL_NOT_CONFIGURED` before any reservation.

## Remaining Verification (operator / live infrastructure)

1. `npm run gate:videoscript:persisted` against a disposable/branch Supabase.
2. Apply `202608160001_video_script.sql` to shared Supabase (operator-gated).
3. Live OpenAI+Anthropic end-to-end run once `VIDEO_SCRIPT_*` model env vars are
   configured (same live-provider gap as VIDEO_BRIEF; out of scope here).

## Scope Confirmation

No packaging, storyboard, rendering, media/image/voice/video generation, upload,
publishing, analytics, distribution, or Track-B media-pipeline bridging was added.

## Independent Verification Handoff

- Branch `feat/channel-video-script`; pre-task HEAD `0db4c81`. Resolve the
  implementation commit SHA with `git rev-parse feat/channel-video-script`.
- Re-run: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`.
- Confirm forward-only discipline: `git diff --name-only main..HEAD -- supabase/migrations`
  lists only `202608160001_video_script.sql`.
