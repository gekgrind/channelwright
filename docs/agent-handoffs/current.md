---
Agent: Claude Code (Opus 4.8)
Task: Investigate and, if present, repair the documented pgcrypto search-path defect in `channelwright.execute_media_production_action`
Pre-task HEAD: `ef486a8ce17ef53a6f36e562bad4e19b0b85569b` (branch `main`)
Verdict: `NOT REPRODUCIBLE — DOCUMENTED ROOT CAUSE IS WRONG; NO MIGRATION WARRANTED`
---

# Media-Production pgcrypto Search-Path Investigation

## Verdict

**NOT REPRODUCIBLE.** The documented defect does not exist. `channelwright.execute_media_production_action`
calls pgcrypto **schema-qualified** as `extensions.digest(...)`, which resolves independently of the
function's `search_path`. No forward migration was created (a Phase-1 STOP condition: the documented root
cause is wrong). Two low-risk corrections were made instead: the false doc claim was fixed and the existing
guard test was hardened.

## Repository Truth

- Worktree: `C:\DevProjects\channelwright`
- Branch created: `fix/media-production-pgcrypto-search-path` (from `main`)
- Pre-task HEAD: `ef486a8ce17ef53a6f36e562bad4e19b0b85569b`
- Status before edits: clean
- Ancestry confirmed: `ac7c409` (video-brief contracts) and `b5adf25` (resolver pgcrypto repair) are both
  ancestors of HEAD (`git merge-base --is-ancestor` exit 0). The prior CHANNEL_VIDEO_BRIEF work is merged.
- No unexpected user modifications were present.

## Defect Verification

- **Function signature:** `channelwright.execute_media_production_action(text, text, jsonb)`
  (`p_idempotency_key text, p_input_fingerprint text, p_action jsonb`).
- **Defined in:** `supabase/migrations/202608110001_media_production_pipeline.sql:322` — the only definition;
  no later migration recreates or `ALTER`s it.
- **Current search_path:** `channelwright, pg_temp` (narrow; `extensions` deliberately excluded).
- **pgcrypto usage:** exactly one call, `extensions.digest((p_action->'renderInput')::text, 'sha256')` at
  line 357 — **schema-qualified**. `grep` proves it is the only `digest(` in the file and it is
  `extensions.digest(`.
- **Root-cause evidence:** A schema-qualified reference bypasses `search_path` entirely, so the narrow
  setting cannot break it. `git log -L 357,357` shows the call was born schema-qualified in the migration's
  first commit (`602b14b`) and has never changed — it never had the resolver-style defect. The resolvers
  repaired in `202608150002` used **unqualified** `digest()`; this function never did.
- **Why the doc was wrong:** the media pipeline (authored in `602b14b`) qualifies pgcrypto calls, whereas
  the later strategy/content/video-brief resolvers used unqualified calls. The prior handoff assumed "the
  same" pattern without inspecting line 357.

## Implementation

- **Migration added:** NONE. Creating `ALTER FUNCTION ... SET search_path = channelwright, extensions,
  pg_temp` would widen a hardened search_path for zero benefit (the call is already qualified) and is
  explicitly discouraged by the task. Correctly not done.

## Regression Coverage

- `src/server/media/media-migration.test.ts` already asserted `extensions.digest` is present and that the
  narrow `search_path = channelwright, pg_temp` is preserved. **Hardened** it so a future *unqualified*
  `digest(` cannot silently reintroduce the resolver defect: it now asserts every `digest(` occurrence is an
  `extensions.digest(` (count parity). This pins the exact invariant that keeps the function immune.
- The existing guard in `202608150002_extension_search_path.sql` additionally raises
  `PGCRYPTO_SCHEMA_UNEXPECTED` if pgcrypto ever leaves the `extensions` schema — the only condition that
  could break the qualified call — so that risk is also already covered.

## Files Changed

- `docs/video-brief.md` — replaced the false "remaining defect" paragraph (line 138) with the corrected
  finding (function is not defective; schema-qualified; no ALTER needed).
- `src/server/media/media-migration.test.ts` — hardened the pgcrypto-qualification assertion (test only).
- `docs/agent-handoffs/current.md` — this handoff.
- `docs/agent-handoffs/archive/2026-08-24-claude-video-brief-coverage-closure.md` — prior handoff, archived.

No production runtime code and no migration files were modified.

## Verification Results

- Targeted: `npx vitest run src/server/media/media-migration.test.ts` -> PASS (2 files, 12 tests).
- Typecheck: `npm run typecheck` -> PASS (clean).
- Lint: `npm run lint` -> 0 errors (2 pre-existing warnings in an unrelated `.claude/worktrees/...` path,
  not in changed files).
- Full suite: `npm test` -> PASS (116 files, 834 tests).
- Disposable Postgres / live gate: NOT run. Static + repository evidence is conclusive (schema-qualified
  call), and the task defaults to local/static/disposable verification only. No shared Supabase mutation.

## Database / External Actions

None. No shared Supabase mutation, no migration applied, no paid-provider calls, nothing pushed or deployed.

## Commit

Committed on `fix/media-production-pgcrypto-search-path`. Resolve the exact SHA with
`git rev-parse fix/media-production-pgcrypto-search-path`. Not merged, not pushed.

## Exact Instructions for Independent Codex Verification

1. Repository truth:
   - `git merge-base --is-ancestor ac7c409 HEAD` and `... b5adf25 HEAD` -> both exit 0.
2. Prove the function is not defective:
   - `grep -nE "digest\(" supabase/migrations/202608110001_media_production_pipeline.sql` -> the only match
     is line 357 and it is `extensions.digest(` (schema-qualified).
   - `git log -L 357,357:supabase/migrations/202608110001_media_production_pipeline.sql` -> the call was
     introduced schema-qualified in `602b14b` and never altered.
   - Confirm the function's header (`202608110001_...:326`) is
     `security definer set search_path = channelwright, pg_temp` and that no later migration `ALTER`s or
     recreates `execute_media_production_action` (`grep -rn execute_media_production_action supabase/migrations`).
   - Reason: a schema-qualified identifier bypasses `search_path`, so the narrow setting cannot break it.
3. Confirm no migration was added: `git diff --name-only main..HEAD -- supabase/migrations` -> empty.
4. Confirm the regression guard: in `src/server/media/media-migration.test.ts`, the pgcrypto test asserts
   `digest(` count equals `extensions.digest(` count.
5. Re-run gates: `npx vitest run src/server/media/media-migration.test.ts`, `npm run typecheck`,
   `npm run lint`, `npm test`. Report exact pass/fail counts.

## Remaining Media-Pipeline Findings

None newly discovered in scope. The media-production function chain (`claim_render_job`,
`heartbeat_render_job`, etc.) uses `gen_random_uuid()` (a `pg_catalog` builtin, not pgcrypto) and
schema-qualified `extensions.digest`, so none carry the resolver-style search-path risk. Live provider and
browser execution for the VIDEO_BRIEF slice remain blocked on model routing config (documented in
`docs/video-brief.md`), unchanged by this task.
