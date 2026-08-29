<!--
NOTE: This file exists only because the vault-as-mcp Obsidian server failed on
every content operation this session (read_note / read_multiple_notes /
create_note / append_to_note all returned:
  "Cannot read properties of undefined (reading 'replace')").
Only search_notes (filenames) worked. The intended Obsidian updates could not be
written. Operator: paste the body below into a new note
  02 - Channelwright/Agent Handoffs/2026-08-29 - Claude Code - Video Script Round-6 Repair.md
and update the "Latest Handoff" pointer in 02 - Channelwright/Current State.md,
preserving the prior Codex verification as a backlink. Delete this file once done.
-->
---
agent: Claude Code
project: Channelwright
task: Round-6 repair — disposable-PostgreSQL apply-time failure in CHANNEL_STRATEGY migration
date: 2026-08-29
branch: feat/channel-video-script
head: 10a8d3ed2ca14172df7484ab3601e43ec73768f1
base: 0db4c814d4a19a0da5740d2667fe6f15d7a6088f
verdict: APPLY-TIME GATE DEFECT REPAIRED — DISPOSABLE-POSTGRESQL GATE MUST BE RE-RUN BY OPERATOR
---

# CHANNEL_VIDEO_SCRIPT Round-6 Repair (Claude Code)

## New evidence
Operator provisioned a disposable local PostgreSQL 17 cluster and ran
`npm run gate:videoscript:disposable-pg`. The gate RAN and returned
`VIDEO_SCRIPT_DISPOSABLE_PG_FAILED` while applying
`202608140001_channel_strategy.sql` with `function digest(text, unknown) does
not exist`. Checks: shim installed PASS; migration applies 140001 FAIL; gate
completed without fatal error FAIL; disposable db dropped PASS; roles removed
PASS. This supersedes the round-5 "no repair required" disposition.

## Root cause
The gate installs pgcrypto in the `extensions` schema and applies the chain with
the cluster default search_path (no `extensions`). The top-level backfill
`UPDATE` in 140001 called bare `digest()`; top-level statements resolve function
names at plan time via the session search_path (even on an empty table), so it
failed and aborted the chain. `202608150002` had fixed the same hazard for
function bodies via `ALTER FUNCTION` (works because plpgsql resolves at runtime),
but that cannot repair an apply-time statement inside 140001 — and no forward
migration can, since nothing runs between the earlier applied migrations and
140001 on a fresh apply. Every other DML `digest()` in the chain is already
schema-qualified or in a function whose end-of-chain search_path includes
`extensions`; 140001's backfill was the sole outlier.

## Repair (minimal, forward-safe)
- `supabase/migrations/202608140001_channel_strategy.sql`: the two backfill
  `digest()` calls are now `extensions.digest(...)` (name resolution only;
  identical SHA-256 output; no re-run where already applied), with an
  explanatory comment.
- `src/server/workflows/channel-strategy-migration.test.ts`: narrow regression
  asserting the backfill stays `extensions.digest` on the `r.`/`e.` aliases.

Editing an already-written migration is deliberate and unavoidable: the
forward-only discipline was built for runtime resolution (ALTER FUNCTION); an
apply-time failure inside 140001 has no forward-migration remedy. The gate was
NOT weakened — the shim search_path intentionally still excludes `extensions` so
it keeps catching this bug class.

## Local validation at 10a8d3e
typecheck PASS · lint PASS (0 errors; 2 pre-existing nested-worktree warnings) ·
build PASS · focused migration tests 6 files/88 tests PASS (incl. new
regression) · full suite 122 files/971 tests PASS with the documented
`video-brief-workspace.test.tsx` worker-startup flake, confirmed green in
isolation (2 files/23 tests) → effective 123/983 green.

## Operator re-run required
Disposable gate is UNAVAILABLE in the Claude environment (no
`CHANNELWRIGHT_DISPOSABLE_DATABASE_URL`, no docker/psql/local PG). Operator must
re-run `npm run gate:videoscript:disposable-pg` on the disposable PG17 cluster
and require `VIDEO_SCRIPT_DISPOSABLE_PG_PASSED` (exit 0). Expected: 140001 now
applies, chain completes, downstream runtime checks execute.

## Repo state
Branch `feat/channel-video-script`; HEAD `10a8d3e` (prior `35430fc`); base/main
`0db4c81`; 7 ahead / 0 behind. Nothing pushed, merged, deployed, or applied to
any shared service. Commit `10a8d3e` holds the two source files; repo handoff
`docs/agent-handoffs/current.md` updated.
