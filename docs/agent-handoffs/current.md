---
Agent: Claude
Task: Implement the CHANNEL_VIDEO_RELEASE workflow vertical
Completed: 2026-08-31
Repository: `C:\DevProjects\channelwright`
Branch: `feat/channel-video-release` (off `main` @ 592da91)
Status: `IMPLEMENTED — ALL LOCAL GATES PASSED, READY FOR INDEPENDENT CODEX VERIFICATION`
Merged: NO (do not merge to main)
---

# CHANNEL_VIDEO_RELEASE Vertical

## What was built

CHANNEL_VIDEO_RELEASE is the Distribution / release-decision link after
CHANNEL_VIDEO_PACKAGING, mirroring the merged VIDEO_PACKAGING slice exactly. It
consumes exactly ONE approved CHANNEL_VIDEO_PACKAGING artifact (DB-authoritative
resolver, immutable re-verified reference carrying transitive provenance back
through the whole RESEARCH → STRATEGY → CONTENT → BRIEF → SCRIPT → PACKAGING
chain) and produces a human-approved, immutable **release record** — the final
release decision made before any external publishing occurs.

The release record covers, per the approved boundary:

- **selected title** from the packaging candidates, with rationale (an EXACT
  member of the packaging's candidate set — a release can never invent a title)
- **selected thumbnail concept** (an EXACT member of the packaging's concept set)
- **recommended publish window** (bounded ISO window + rationale; intent only)
- **playlist/series placement** (intent)
- **distribution-surface plan** (per-surface intent)
- **final reconciled metadata** (final title = selected candidate verbatim;
  chapters + tags derived from the approved packaging)
- **KPI/hypothesis binding** to the exact upstream strategy identity, intent only
  (`targetIsHypothesis`/`measurementDeferred` fixed literals; no measured value)
- **viewer-value/integrity assessment** (this stage's own gate) and an explicit
  re-run of the misleading/deceptive-packaging guard at selection time
- **explicit human approval** (the final APPROVAL step)

### Hard boundary enforced (decision + durable-record system, NOT publishing)

Deterministic QA rejects, as scope violations: provider OAuth, live
publish/upload execution, external-provider scheduling, media rendering,
TTS/image/video generation, thumbnail image generation, cross-platform recut
generation, and performance ingestion/measurement. Revisions create new run
versions; approved release records are immutable (DB triggers widened).

### Files added

- `src/server/workflows/approved-packaging-resolver.ts` — DB-authoritative
  resolver with canonical drift detection.
- `src/server/workflows/video-release-config.ts` — zero-retrieval budget.
- `src/server/workflows/video-release-model.ts` — provider-neutral model
  interface + routed implementation (namespace VIDEO_RELEASE).
- `src/server/workflows/video-release-validation.ts` — deterministic QA:
  exact-candidate title/thumbnail selection, verbatim-title reconciliation,
  chapter/tag derivation, KPI→strategy identity binding, misleading-guard re-run,
  fabrication rules, and OAuth / publish-execution / external-scheduling /
  render / media-gen / thumbnail-gen / recut / performance-ingestion rejections,
  viewer-value floor.
- `src/server/workflows/video-release-executor.ts` — 6 worker steps.
- `src/features/studio/video-release-workspace.tsx` (+ mounted in studio-app).
- `supabase/migrations/202608180001_video_release.sql` (resolver
  `resolve_approved_video_packaging_artifact`, start/complete/decide/ensure
  recreated with the release branch, unique index) and
  `202608180002_video_release_immutability.sql`.
- `scripts/channel-video-release-disposable-pg.ts` + `gate:videorelease:disposable-pg`.
- Fixtures + tests: executor, validation, migration, doctrine, workspace.

### Domain additions (`src/domain/production-workflows.ts`)

Added `CHANNEL_VIDEO_RELEASE` to `workflowTypeSchema`; the approved-packaging
reference/scope/artifact schemas; release title/thumbnail decision, publish
window, playlist placement, distribution surface, reconciled metadata, KPI
hypothesis binding, content/result/QA/draft/qastep/revision schemas; the
start-request union branch; the definition + registry + finalizer map entry; and
type exports.

### Wiring updated

`role-router.ts` (VIDEO_RELEASE namespace), `research-usage.ts`
(VIDEO_RELEASE_RESOURCE_BUDGET_EXHAUSTED), `production-workflow-repository.ts`
(VIDEO_RELEASE_LIMIT_REACHED, UPSTREAM_PACKAGING_INVALID),
`workflow-worker.ts` (executor + error-message codes),
`src/app/api/workflows/route.ts` (idempotency list). One stale assertion in
`video-packaging-migration.test.ts` (which hard-coded the packaging immutability
migration as globally last) was changed to an adjacency check.

## Verification (local only, no shared/production DB touched)

- `npm run typecheck` — PASS, exit 0
- `npm run lint` — PASS, exit 0 (2 pre-existing warnings in a nested
  `.claude/worktrees/...` worktree, not in this vertical's code)
- `npm test` — PASS, exit 0, 133 files / 1165 tests
- `npm run build` — PASS, exit 0
- `gate:videorelease:disposable-pg` — `VIDEO_RELEASE_DISPOSABLE_PG_PASSED`,
  23 passed / 0 failed, exit 0, against a local disposable PostgreSQL 17 cluster
  (`channelwright-pg17`, localhost:55432). The gate creates and drops its own
  throwaway database and gate-created roles; both cleaned up. The persistent
  `channelwright-pg17` container was returned to its prior Exited state.

No push, deploy, or migration application to any shared/production database. Not
merged to main.

## Provenance / KPI-binding notes for the verifier

- The release binds to KPI/hypothesis **identity and intent only**. Each binding
  carries `strategyRunId`, deterministically checked to equal the transitive
  upstream strategy identity
  (`upstreamVideoPackaging.upstreamVideoScript.upstreamVideoBrief.upstreamContentIntelligence.upstreamStrategy.strategyRunId`).
  No CHANNEL_VIDEO_PERFORMANCE measurement mechanics were implemented.
- Selection integrity: the resolver exposes the authoritative
  `titleCandidateIds`/`thumbnailConceptIds` sets from DB state; deterministic QA
  requires the selected IDs to be members and the selected title text to match
  the approved candidate verbatim, and `reconciledMetadata.finalTitle` to equal
  the selected title.

## Next action

Independent Codex verification of the vertical on `feat/channel-video-release`,
then a merge decision. To re-run the disposable-PG gate: start Docker Desktop and
`docker start channelwright-pg17`, then
`CHANNELWRIGHT_DISPOSABLE_DATABASE_URL=postgres://postgres:channelwrighttest@127.0.0.1:55432/postgres npm run gate:videorelease:disposable-pg`.
