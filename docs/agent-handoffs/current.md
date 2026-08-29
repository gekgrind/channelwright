---
Agent: Claude Code
Task: Round-6 repair — fix disposable-PostgreSQL apply-time failure in CHANNEL_STRATEGY migration (digest search_path)
Verified: 2026-08-29
Repository: `C:\DevProjects\channelwright`
Branch: `feat/channel-video-script`
HEAD: `10a8d3ed2ca14172df7484ab3601e43ec73768f1`
Base: `0db4c814d4a19a0da5740d2667fe6f15d7a6088f` (`main` and local `origin/main`)
Verdict: `APPLY-TIME GATE DEFECT REPAIRED — DISPOSABLE-POSTGRESQL GATE MUST BE RE-RUN BY OPERATOR TO CONFIRM PASS`
---

# CHANNEL_VIDEO_SCRIPT Round-6 Repair (Claude Code)

## New Evidence That Reopened The Task

After the round-5 handoff (which said no further source repair was required and
only the disposable-PostgreSQL gate remained), an operator provisioned an
explicitly disposable local PostgreSQL 17 cluster and ran
`npm run gate:videoscript:disposable-pg`. The gate **ran** (it did not report
UNAVAILABLE) and returned:

- `VIDEO_SCRIPT_DISPOSABLE_PG_FAILED`
- Failing statement: applying `202608140001_channel_strategy.sql`
- Error: `function digest(text, unknown) does not exist`
- Check results: `supabase shim installed` PASS; `migration applies:
  202608140001_channel_strategy.sql` **FAIL**; `gate completed without a fatal
  error` **FAIL**; `disposable database dropped` PASS; `gate-created cluster
  roles removed` PASS.

This is real runtime evidence from a clean PostgreSQL 17 and supersedes the
prior "no repair required" disposition.

## Root Cause

- The disposable gate installs a minimal Supabase-compatible shim that creates
  `pgcrypto` in the `extensions` schema (matching Supabase), then applies the
  entire migration chain from scratch. The migration session runs with the
  cluster default search_path, which does **not** include `extensions`.
- `202608140001_channel_strategy.sql` contains a **top-level backfill `UPDATE`**
  (adds `artifact_hash`/`provenance_hash` to existing `CHANNEL_RESEARCH` runs)
  that called **bare `digest()`**. A top-level statement resolves its function
  references at **plan time** using the session search_path — even against an
  empty table — so bare `digest()` fails on a cluster without `extensions` on
  the path. That aborts the whole chain at 140001.
- This is the same pgcrypto/search_path hazard that `202608150002_extension_
  search_path.sql` already fixed for **function bodies** via `ALTER FUNCTION ...
  set search_path = channelwright, extensions, pg_temp`. That escape hatch works
  only because plpgsql resolves identifiers at **runtime**. It cannot help a
  **top-level apply-time** statement inside 140001, and no later forward
  migration can either, because nothing runs between the earlier applied
  migrations and 140001 on a fresh apply.
- The rest of the chain was already correct: every other DML `digest()` call is
  either schema-qualified (`extensions.digest`, e.g.
  `202608110001:357`, and the gate's own seed code) or lives in a function whose
  search_path includes `extensions` by end-of-chain (video-brief resolver and
  `decide_workflow_approval` are recreated with `extensions` on the path in
  `202608160001`). 140001's top-level backfill was the single outlier.

## The Repair (minimal, forward-safe)

`supabase/migrations/202608140001_channel_strategy.sql` — the two `digest()`
calls in the top-level backfill `UPDATE` are now `extensions.digest(...)`, with a
comment explaining why a forward migration cannot fix an apply-time failure. This
changes only name resolution; the SHA-256 output is identical, and the statement
does not re-run in any environment where the migration already applied.

`src/server/workflows/channel-strategy-migration.test.ts` — adds a narrow
regression asserting the backfill uses `encode(extensions.digest(r.output_payload
...))` and `encode(extensions.digest(e.output_payload ...))` (the `r.`/`e.`
aliases are unique to the top-level backfill, so the assertion cannot be
satisfied by function-body calls).

### Note for the reviewer: this edits an already-written migration

The codebase's forward-only discipline (enforced in
`video-brief-migration.test.ts`) says repairs go in **new** migrations, not by
editing applied ones. That discipline was designed around **runtime** (function
body) digest resolution, where `ALTER FUNCTION` is available. It has no
mechanism for an **apply-time** failure inside 140001: a forward migration runs
after 140001 and cannot stop it from failing on a fresh apply. Editing 140001 is
therefore the only possible fix, and it is forward-safe: identical hash output,
no re-run where already applied, and it matches the schema-qualification
convention used everywhere else in the chain. The gate is not weakened — adding
`extensions` to the shim's migration search_path was deliberately **not** done,
because that would mask exactly the search_path bug class the gate exists to
catch.

## Local Validation At `10a8d3e`

- `npm run typecheck`: PASS.
- `npm run lint`: PASS — 0 errors; the only 2 warnings are the documented
  nested-worktree files under `.claude/worktrees/amazing-mestorf-08eaf8`, not
  Video Script sources.
- `npm run build`: PASS (full route map produced).
- Focused migration tests (`channel-strategy`, `content-intelligence`,
  `finalize-strategy-output`, `video-brief`, `video-script`): PASS — 6 files /
  88 tests, including the new regression.
- `npm test` (full): 122 files / 971 tests PASS. One file
  (`src/features/studio/video-brief-workspace.test.tsx`) hit the previously
  documented vitest thread-pool **worker-startup** flake ("Failed to start
  threads worker" / "Timeout waiting for worker to respond") — not an assertion
  failure. Confirmed by an isolated rerun of the two Studio workspace files
  (2 files / 23 tests PASS). Effective state: 123 files / 983 tests green.

## Disposable-PostgreSQL Gate — Operator Re-Run Required

- In THIS environment the gate remains **UNAVAILABLE** (exit 2,
  `CHANNELWRIGHT_DISPOSABLE_DATABASE_URL is not set`; no docker/psql/local PG).
  The repair could not be proven here.
- The operator who reproduced the failure must re-run
  `npm run gate:videoscript:disposable-pg` against the same explicitly disposable
  PostgreSQL 17 cluster and require `VIDEO_SCRIPT_DISPOSABLE_PG_PASSED`
  (all checks passed, exit 0). `UNAVAILABLE`/skipped is not sufficient.
- Expected outcome after this repair: `migration applies:
  202608140001_channel_strategy.sql` now PASSES, the full chain applies, and the
  downstream runtime checks (resolvers, RLS, immutability, concurrency,
  accounting) run. If any downstream check fails, preserve the exact database
  evidence and repair only the reproduced defect.

## Repository State

- Branch: `feat/channel-video-script`
- HEAD: `10a8d3ed2ca14172df7484ab3601e43ec73768f1`
- Prior HEAD: `35430fc0cefff957315778035e80d81ce010970f`
- `main`, local `origin/main`, and merge base:
  `0db4c814d4a19a0da5740d2667fe6f15d7a6088f`
- Relationship to `main`: 7 ahead, 0 behind.
- Upstream: none configured. No push, merge, deploy, shared-migration
  application, shared/persisted gate, browser action, or paid-provider run was
  performed. Only the two source files above were changed and committed
  (`10a8d3e`); this handoff is the only uncommitted working-tree change.

## Exact Next Action

1. Operator: re-run `npm run gate:videoscript:disposable-pg` on the disposable
   PostgreSQL 17 cluster. Require a real `VIDEO_SCRIPT_DISPOSABLE_PG_PASSED`.
2. If it passes: update this handoff and the Obsidian state with the gate
   result and reassess merge readiness — without implicitly claiming
   live-provider, shared-project, deployment, browser, or production proof, none
   of which were performed.
3. If it fails: capture the exact failing check and error, and repair only the
   reproduced defect (narrowest regression, no editing of unrelated applied
   migrations, rerun focused tests + typecheck + full tests + lint + build + the
   disposable gate).

## Do Not Redo

- Do not revert the 140001 schema-qualification or the new regression without a
  new reproduction; bare `digest()` there is the confirmed apply-time defect.
- Do not "fix" this by adding `extensions` to the disposable gate's migration
  search_path or otherwise relaxing the shim — that masks the bug class the gate
  exists to catch (gate must not be weakened/bypassed).
- Do not change the verified budget invariant, legacy migration/env contract,
  retry-order regression, critic-verdict behavior, claim/section validation,
  immutability, provider independence, accepted-author provenance, Studio run
  scoping, or gate cleanup/isolation without new evidence.
- Do not change the final `AGREED`/revision-history disposition or restore the
  removed lexical `OUTCOME_GUARANTEE` heuristic.
- Do not treat the two nested-worktree lint warnings or the transient vitest
  worker-startup flake as Video Script failures.
- Do not push, merge, deploy, apply shared migrations, use paid providers, or
  run shared/persisted gates without explicit authority.
