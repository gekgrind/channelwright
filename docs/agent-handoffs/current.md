---
Agent: Claude
Task: Implement the CHANNEL_VIDEO_PACKAGING workflow vertical
Completed: 2026-08-30
Repository: `C:\DevProjects\channelwright`
Branch: `feat/channel-video-packaging` (off `main`)
Status: `IMPLEMENTED — ALL LOCAL GATES PASSED`
---

# CHANNEL_VIDEO_PACKAGING Vertical

## What was built

CHANNEL_VIDEO_PACKAGING is the next provenance link after CHANNEL_VIDEO_SCRIPT,
mirroring the merged VIDEO_SCRIPT slice exactly. It consumes exactly ONE approved
CHANNEL_VIDEO_SCRIPT artifact (DB-authoritative resolver, immutable re-verified
reference carrying transitive provenance back to research) and produces
PROVIDER-NEUTRAL packaging direction: title candidates (candidates only),
thumbnail concepts (copy + visual intent, no generated image), a description,
chapters DERIVED FROM the approved script's section timing, tags, and an
end-screen/CTA plan, plus its own viewer-value assessment.

### Files added

- `src/domain/production-workflows.ts` — workflow type, approved-script
  reference/scope/artifact schemas, packaging content/result/QA/draft/qastep/
  revision schemas, start-request union, definition + registry + finalizer map.
- `src/server/workflows/approved-script-resolver.ts` — DB-authoritative resolver
  with drift detection.
- `src/server/workflows/video-packaging-config.ts` — zero-retrieval budget.
- `src/server/workflows/video-packaging-model.ts` — provider-neutral model
  interface + routed implementation (namespace VIDEO_PACKAGING).
- `src/server/workflows/video-packaging-validation.ts` — deterministic QA:
  chapter-timing-derivation, MISLEADING_PACKAGING guard, title-selection /
  thumbnail-generation / publishing / OAuth / render-worker scope rejections,
  fabrication rules, viewer-value floor.
- `src/server/workflows/video-packaging-executor.ts` — 6 worker steps.
- `src/features/studio/video-packaging-workspace.tsx` (+ mounted in studio-app).
- `supabase/migrations/202608170001_video_packaging.sql` (+ resolver, start,
  complete, decide, ensure, unique index) and `202608170002_..._immutability.sql`.
- `scripts/channel-video-packaging-disposable-pg.ts` + `gate:videopackaging:disposable-pg`.
- Fixtures + tests: executor, validation, migration, doctrine, workspace.

### Wiring updated

`role-router.ts`, `research-usage.ts`, `production-workflow-repository.ts`,
`workflow-worker.ts`, `src/app/api/workflows/route.ts` (idempotency list).
One stale assertion in `video-script-migration.test.ts` (which hard-coded its own
immutability migration as globally last) was updated to an adjacency check.

## Verification (local only, no shared/production DB touched)

- `npm run typecheck` — PASS, exit 0
- `npm run lint` — PASS, exit 0 (2 pre-existing warnings in a nested worktree)
- `npm test` — PASS, exit 0, 128 files / 1071 tests
- `npm run build` — PASS, exit 0
- `gate:videopackaging:disposable-pg` — `VIDEO_PACKAGING_DISPOSABLE_PG_PASSED`,
  22 passed / 0 failed, exit 0, against a local disposable PostgreSQL 17 cluster
  (`channelwright-pg17`, localhost:55432). Database and gate-created roles cleaned up.

No push, deploy, or migration application to any shared/production database.
