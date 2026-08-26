---
Agent: Claude Code (Opus 4.8)
Task: Implement CHANNEL_VIDEO_SCRIPT as the next provider-backed workflow vertical
Pre-task HEAD: `0db4c814d4a19a0da5740d2667fe6f15d7a6088f` (branch `main`)
Verdict: `IMPLEMENTATION COMPLETE — READY FOR INDEPENDENT VERIFICATION`
Branch: `feat/channel-video-script`
---

# CHANNEL_VIDEO_SCRIPT Vertical Slice

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
