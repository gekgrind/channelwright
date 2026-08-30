---
Agent: Claude (Opus 4.8)
Task: Round-8 repair — disposable-PostgreSQL gate `$2` parameter-type failure
Verified: 2026-08-29
Repository: `C:\DevProjects\channelwright`
Branch: `feat/channel-video-script`
HEAD: `5f2426ed8ec3e46922548d80e04832edf9803f17`
Repaired source commit: `5f2426ed8ec3e46922548d80e04832edf9803f17`
Prior HEAD: `db9b6f652d52f53fc40b08f3884d373fd42fbced`
Base: `0db4c814d4a19a0da5740d2667fe6f15d7a6088f` (`main`, merge base)
Verdict: `DISPOSABLE-POSTGRESQL 17 PROOF PASSED — READY FOR CODEX RE-VERIFICATION`
---

# CHANNEL_VIDEO_SCRIPT Round-8 Repair (Claude)

## Decision

The disposable-PostgreSQL 17 gate now returns `VIDEO_SCRIPT_DISPOSABLE_PG_PASSED`
with 22/22 checks and exit 0, run against a real throwaway database on the
operator's PostgreSQL 17 Docker cluster (`localhost:55432`). The round-7 operator
evidence (`VIDEO_SCRIPT_DISPOSABLE_PG_FAILED`, sole failure
`could not determine data type of parameter $2`) was independently reproduced and
repaired with a two-line change to the gate's own seeding helper. The gate was
not weakened; the fix makes the run reach checks it was previously aborting
before.

## Reproduced Defect

Command: `npm.cmd run gate:videoscript:disposable-pg` against
`postgres://***@localhost:55432/postgres`.

Reproduction result before the fix: `VIDEO_SCRIPT_DISPOSABLE_PG_FAILED`,
7 passed / 1 failed. The four operator-reported PASSes were reproduced exactly
(shim installed; full 18-migration chain applied from scratch; pgcrypto
`extensions.digest` runtime resolution; all four approved-artifact resolvers
compiled; `canonical_jsonb_text` parity). The sole failure was recorded as
`gate completed without a fatal error = false`,
detail `could not determine data type of parameter $2` — i.e. an uncaught
(non-`expectFailure`) error thrown immediately after the canonical-parity check.

### Exact SQL and root cause

The first `seedApprovedRun` call after the canonical-parity check runs the
provenance-hash backfill in
`scripts/channel-video-script-disposable-pg.ts` (the `if (provStep)` block).
That `UPDATE` is a ternary with two branches sharing one three-element params
array:

- Corrupt branch — SQL uses `$1`, `$2` (`artifact_hash`), `$3`; params
  `[runId, "f".repeat(64), provStep]`. All three bound and referenced. Correct.
- Non-corrupt branch (the default, hit first) — SQL computed `artifact_hash`
  inline via `encode(extensions.digest(output_payload::text,'sha256'),'hex')`
  and referenced only `$1` and `$3`, yet still bound `[runId, null, provStep]`.
  Because `$2` (`null`) appeared **nowhere** in the SQL text, PostgreSQL could
  not infer its data type and raised `could not determine data type of
  parameter $2`, aborting the run before any resolver/RLS/immutability/
  concurrency/accounting check executed.

The stray `null` placeholder was carried over from the corrupt branch, where
`$2` is the forced-bad `artifact_hash`.

## Repair

`scripts/channel-video-script-disposable-pg.ts` (2 insertions, 2 deletions,
commit `5f2426e`):

- Non-corrupt branch now references `step_key=$2` (was `$3`) and binds
  `[runId, provStep]` (was `[runId, null, provStep]`).
- Corrupt branch is unchanged.

This is the narrowest fix for the reproduced error. It does not touch any
migration, any runtime resolver, the migration session `search_path`, the
`extensions`-schema pgcrypto install, or any gate assertion. It restores the
gate's ability to run its full check set rather than relaxing it.

## Post-Repair Verification

All from `C:\DevProjects\channelwright` at HEAD `5f2426e`, Node `v24.15.0`.

- `npm.cmd run gate:videoscript:disposable-pg` against disposable PostgreSQL 17
  at `localhost:55432`:
  **`VIDEO_SCRIPT_DISPOSABLE_PG_PASSED` — 22 passed / 0 failed, exit 0.**
  Includes: full 18-migration chain from scratch; pgcrypto `extensions.digest`;
  four resolvers compiled; canonical parity; resolver returns owner scope;
  inherited Viewer Value contract-hash match; VIDEO_BRIEF origin + PASS gate;
  cross-owner `NOT_FOUND`; unapproved `UPSTREAM_BRIEF_NOT_APPROVED`; altered-hash
  `UPSTREAM_BRIEF_INTEGRITY_MISMATCH`; RLS on all six workflow tables;
  VIDEO_BRIEF/VIDEO_SCRIPT run + finalized-step immutability; CHANNEL_RESEARCH
  immutability (no regression); concurrency unique-index block;
  nonzero-retrieval `VALIDATION_ERROR`; zero-retrieval passes ceilings then
  `LEASE_NOT_ACTIVE`; disposable database dropped; gate-created roles removed.
- Focused migration tests (`npx.cmd vitest run` for channel-strategy,
  video-brief, video-script, content-intelligence, finalize-strategy-output):
  **PASS — 6 files / 88 tests** (sixth file is the imported fixture helper).
- `npm.cmd run typecheck`: **PASS**.
- `npm.cmd run lint`: **PASS — 0 errors / 2 warnings**, both confined to the
  pre-existing nested checkout `.claude/worktrees/amazing-mestorf-08eaf8`;
  neither is in the repaired source.

## Repository Truth

- Branch `feat/channel-video-script`, HEAD `5f2426e`.
- Repair commit `5f2426e`; prior HEAD `db9b6f6`.
- `main` / merge base `0db4c81`; 9 ahead / 0 behind; no upstream configured.
- Working-tree docs changes for this handoff are the only remaining untracked/
  modified files: `docs/agent-handoffs/current.md` and the repo-tracked mirror
  `docs/agent-handoffs/obsidian-round7-pending.md` (still awaiting vault paste);
  `docs/agent-handoffs/obsidian-round6-pending.md` remains staged for deletion
  from the round-7 state update. No source, migration, or runtime code changed
  beyond the single gate-script commit.

## Exact Next Action (Codex re-verification)

1. Confirm the diff of `5f2426e` is exactly the two-line non-corrupt-branch
   binding change to `scripts/channel-video-script-disposable-pg.ts` and touches
   no migration, resolver, or gate assertion.
2. Expose the operator's throwaway PostgreSQL 17 as
   `CHANNELWRIGHT_DISPOSABLE_DATABASE_URL` and run
   `npm.cmd run gate:videoscript:disposable-pg`.
3. Require `VIDEO_SCRIPT_DISPOSABLE_PG_PASSED`, all checks passed, exit 0.
4. Re-run `npm.cmd run typecheck`, `npm.cmd run lint`, and the focused migration
   tests; optionally `npm.cmd test` and `npm.cmd run build` for the full local
   picture.
5. If all pass, mark the branch ready to merge, keeping provider/shared-project/
   browser/deployment/production proof explicitly out of scope.

## Boundaries Preserved

- No push, merge, deploy, shared/persisted gate, browser action, paid-provider
  call, or shared/production database mutation was performed.
- The disposable gate created and dropped its own throwaway database and cleaned
  up its gate-created cluster roles; it never touched the application or any
  shared/production database.
- The gate was repaired, not weakened: no assertion removed, no search-path
  relaxation, no `extensions`-schema change.
