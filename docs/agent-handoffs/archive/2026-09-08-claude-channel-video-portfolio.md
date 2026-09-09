---
Agent: Claude Code
Task: Implement the CHANNEL_VIDEO_PORTFOLIO workflow vertical
Completed: 2026-09-08
Repository: `C:\DevProjects\channelwright` (isolated worktree `C:\DevProjects\channelwright-portfolio`)
Branch: `feat/channel-portfolio` (off `origin/main` @ 54f9ba1 — the merged CHANNEL_VIDEO_EXPERIMENT)
Status: `IMPLEMENTED — ALL LOCAL GATES + DISPOSABLE-POSTGRESQL PASSED; AWAITING INDEPENDENT VERIFICATION`
Merged: NO (do not merge to main)
---

# CHANNEL_VIDEO_PORTFOLIO Vertical

## Predecessor gate

CHANNEL_VIDEO_EXPERIMENT is present in authoritative `origin/main`: `54f9ba1`
("Merge CHANNEL_VIDEO_EXPERIMENT") is `origin/main`'s tip, `7dbbb39`
(video-experiment round 6) is its ancestor, and the vertical's source, migrations
(`202609060001`, `202609060002`) and tests are all in the tree. The Experiment
handoff is archived at
`docs/agent-handoffs/archive/2026-09-07-claude-channel-video-experiment.md`.

## What was built

CHANNEL_VIDEO_PORTFOLIO is the capacity-allocation link after
CHANNEL_VIDEO_EXPERIMENT and the eleventh paid workflow on the production spine.

**The contract was recovered, not invented.** Experiment named this vertical and
reserved exactly two downstream-facing contracts for it — `experimentReady` and
`portfolioEligible` — and its `PORTFOLIO_LEAKED` rule enumerates the
responsibilities it refuses and this workflow takes: allocating capacity across
experiments, prioritising which run next, and sequencing a slate. Sources:
`docs/agent-handoffs/archive/2026-09-07-claude-channel-video-experiment.md`
(scope decision), `video-experiment-constraints.ts`
(`EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE`), `video-experiment-validation.ts:354`
(`PORTFOLIO_LEAKED`), `production-workflows.ts` (the Experiment section comment).

It consumes **one to six** exact approved, portfolio-eligible Experiment
artifacts plus an operator-declared cycle capacity, and produces a single
human-approved, immutable **allocation of record**. Full contract:
`docs/video-portfolio.md`.

### Scope boundary enforced

No execution (`PORTFOLIO_EXECUTION_LEAKED`), no experiment redesign
(`EXPERIMENT_REDESIGN_LEAKED`), no decision or diagnosis revisiting
(`DECISION_REWRITTEN_IN_PORTFOLIO`), no channel strategy
(`INTELLIGENCE_RESPONSIBILITY_LEAKED`), no fabricated quantity, return forecast
or causal-certainty claim. Revisions create new run versions; approved allocation
records are immutable (DB triggers widened).

### The structural safety property

The database resolver returns a **bounded server-extracted projection** of each
experiment — closed-vocabulary scalars plus the 200-char title and run-by-run
lineage — never the experiment artifact. The allocation model therefore cannot
restate, weaken, or rewrite an approved design; it is not merely forbidden from
doing so by prose rules. Runtime-proven by the disposable-PG gate.

### Viewer Value protections (deterministic, not prose)

1. `portfolioSelectionBasisSchema` has **no** growth/upside/ROI member.
2. `GROWTH_ONLY_JUSTIFICATION_COMMITTED` rejects any commitment declaring
   `justifiedByPredictedGrowthAlone`; `GROWTH_ONLY_ARGUMENT_UNDECLARED` catches a
   pure-growth rationale that denies being one.
3. `VIEWER_VALUE_DISPOSITION_CONTRADICTS_PROJECTION` constrains the recorded
   disposition in **both** directions against the server-projected state.
4. `AT_RISK_CANDIDATE_COMMITTED_WITHOUT_ESCALATION` /
   `HUMAN_JUDGMENT_CANDIDATE_COMMITTED_WITHOUT_ESCALATION`; the executor stamps
   `requiresHumanJudgment` and `committedAtRiskCandidateIds` from the constraints.
5. `PORTFOLIO_METRIC_GAMING_UNGUARDED` for an all-acquisition committed slate.
6. Positively: **a cycle that commits nothing is a valid, `portfolioReady`
   outcome.** There is no throughput target.

### Files added

- `src/server/workflows/approved-experiment-resolver.ts` — thin TS wrapper
  invoking the RPC once per candidate; invariant enforcement lives in the new
  `resolve_approved_video_experiment_artifact` RPC. Also assembles the compact
  portfolio scope from authoritative per-candidate results.
- `src/server/workflows/video-portfolio-candidates.ts` —
  `deriveVideoPortfolioConstraints`, `derivePortfolioReady`,
  `derivePortfolioRequiresHumanJudgment`, `deriveCapacityUtilization`,
  `deriveConfoundCollisionGroups` / `assignmentSurfaceKey`,
  `DISPOSITION_PERMITTED_SELECTION_BASES`,
  `STATE_PERMITTED_VIEWER_VALUE_DISPOSITIONS`, `PORTFOLIO_METRIC_FAMILY`.
- `src/server/workflows/video-portfolio-validation.ts` —
  `DETERMINISTIC_VIDEO_PORTFOLIO_RULES` (44-rule data-driven catalogue;
  `deterministicChecksPassed/Failed` always computed from `RULES.length` and
  distinct failed codes). `expectedConstraints` is deliberately a **required**
  parameter: a portfolio's constraints depend on operator input not recoverable
  from the upstream artifacts, so any default would read it back out of the
  result being checked and quietly make the tamper rules self-referential.
- `src/server/workflows/video-portfolio-config.ts` — 2 synthesis / 2 QA / 0
  revision / 0 automated-revision ceilings, construction-time budget assertion,
  **60 KiB** payload ceiling (higher than the siblings' 48 KiB because six
  candidate projections plus six eleven-artifact chains are the structural floor;
  still below `complete_workflow_step`'s hard 65_536).
- `src/server/workflows/video-portfolio-model.ts` — `RoutedVideoPortfolioModel`,
  `VIDEO_PORTFOLIO` routing namespace, distinct-provider GENERATOR/CRITIC.
- `src/server/workflows/video-portfolio-executor.ts` — 7-step no-revision graph;
  `stampServerDerivedFields` re-stamps cycle label / counts / capacity
  utilisation / escalation / committed-at-risk set / readiness.
- `supabase/migrations/202609070001_video_portfolio.sql` (chain 31→32: widen both
  workflow-type checks; `workflow_runs_active_video_portfolio_uniq` keyed on the
  normalised cycle; `resolve_approved_video_experiment_artifact` — 17 invariants
  incl. the portfolio-eligibility gate, an **eleven-artifact** transitive re-hash
  **plus supersession check** on every link, the root-lineage `workflow_id` pin,
  and the bounded candidate projection; `start_workflow` /
  `complete_workflow_step` / `decide_workflow_approval` /
  `ensure_research_run_budget` recreated with the PORTFOLIO branch) and
  `202609070002_video_portfolio_immutability.sql` (chain 32→33).
- `scripts/channel-video-portfolio-disposable-pg.ts` +
  `gate:videoportfolio:disposable-pg`.
- Fixtures + tests: `video-portfolio-fixtures.test-helper.ts`,
  `video-portfolio-validation.test.ts` (70), `approved-experiment-resolver.test.ts`
  (9), `video-portfolio-executor.test.ts` (14),
  `video-portfolio-migration.test.ts` (16) — **109 focused**.

### Domain additions (`src/domain/production-workflows.ts`)

Added `CHANNEL_VIDEO_PORTFOLIO` to `workflowTypeSchema`;
`portfolioLineageWorkflowTypeSchema` (11 types), `portfolioArtifactIdentitySchema`,
`portfolioCandidateIdSchema`, `approvedVideoExperimentReferenceSchema` (with a
**flat** `upstreamVideoDecision` summary), `portfolioCandidateSchema`,
`videoPortfolioScopeSchema`, `portfolioExperimentSelectionSchema`,
`videoPortfolioRequestInputSchema`, `approvedVideoExperimentArtifactSchema`,
`approvedVideoExperimentSetSchema`, `videoPortfolioConstraintsSchema`,
`portfolioDispositionSchema`, `portfolioSelectionBasisSchema`,
`portfolioViewerValueDispositionSchema`, `portfolioAllocationItemSchema`,
`portfolioRiskSchema`, `portfolioAllocationSchema`, `portfolioAlternativeSchema`,
`portfolioViewerValueSafeguardsSchema`, `videoPortfolioContentSchema`, the
input/draft/critique/QA/final result schemas; the start-request union branch; the
definition + registry + finalizer-map entry; and type exports.

One pure refactor to existing Experiment code: the `treatmentMechanism` enum was
extracted to `experimentTreatmentMechanismSchema` so Portfolio's candidate
projection carries the same closed vocabulary instead of redeclaring it. No
behaviour change; `experimentSemanticIntentSchema` is otherwise untouched.

### Wiring updated

`role-router.ts` (`VIDEO_PORTFOLIO` namespace), `research-usage.ts`
(`VIDEO_PORTFOLIO_RESOURCE_BUDGET_EXHAUSTED`), `production-workflow-repository.ts`
(`VIDEO_PORTFOLIO_LIMIT_REACHED`, `UPSTREAM_EXPERIMENT_INVALID`),
`workflow-worker.ts` (executor + error-message codes),
`src/app/api/workflows/route.ts` (idempotency list).

## Self-review finding, repaired before release

**Payload sizing at maximum fan-out was a release blocker.** With six candidates
the `validate-approved-experiments` step output measured **79,487 bytes** and the
final result **73,207 bytes** — both over `complete_workflow_step`'s hard 65,536
ceiling, so a six-candidate run would have failed opaquely in the database at
step one. Cause: `approvedVideoExperimentReferenceSchema` originally nested the
full ten-deep sibling Decision reference, six times over.

Repaired by projecting a **flat** upstream Decision summary (identity + both
hashes + type + eligibility) instead. Nothing is lost: run-by-run lineage is on
the candidate projection and every chain hash is in the eleven-artifact scope
entry. Post-repair: validate step **43,523**, final result **37,243**, and the
runtime gate measures one resolved candidate at **4,486 bytes** (×6 = 26,916).
Permanent regression tests now assert both ceilings with headroom.

## Verification (local + disposable-PG; no shared/production DB touched)

- `npm run typecheck` (`tsc --noEmit`) — PASS, exit 0
- `npm run lint` (`eslint .`) — PASS, exit 0, zero warnings
- Focused Portfolio suites — **109/109 PASS** (validation 70 + executor 14 +
  resolver 9 + migration 16)
- `npm test` (`vitest run`) — PASS, exit 0, **112 files / 1526 tests**
  (baseline before this slice: 108 files / 1435 tests)
- `npm run build` — PASS, exit 0. Build rewrote the generated `next-env.d.ts`
  (dev→prod type-import paths only); reverted, no source change.
- `gate:videoportfolio:disposable-pg` — **`VIDEO_PORTFOLIO_DISPOSABLE_PG_PASSED`,
  55 passed / 0 failed**, exit 0, against a local disposable PostgreSQL 17
  cluster (`channelwright-postgres`, 127.0.0.1:55432). Full **33-migration**
  chain applied from scratch. The gate created and dropped its own throwaway
  database and gate-created roles; both cleaned up. The `channelwright-postgres`
  container was started for this pass and returned to its prior `Exited` state.

No push, deploy, or migration application to any shared/production database. Not
merged to main.

## Base / HEAD

- Base SHA: `54f9ba1f4702fef1ff7224ac8c6b8e21fb56b03e` (origin/main, "Merge CHANNEL_VIDEO_EXPERIMENT")
- Branch: `feat/channel-portfolio`
- Vertical commit: `cf23615ef0b55eb30b0590ef441e5968f7eecc9c`
- 0 behind `origin/main`. Run `git rev-list --left-right --count origin/main...HEAD`
  for the exact ahead count.

## Open findings

- Non-blocking: the prose detectors (fabricated quantity, return forecast, causal
  certainty, the four scope-leakage classes, growth-only argument) are **bounded
  deterministic patterns** scoped to the model-authored allocation surfaces. They
  are not general NLP; a determined novel paraphrase could evade a specific
  pattern. The hard guarantees are the structured, server-stamped fields: the
  closed selection vocabulary with no growth member,
  `justifiedByPredictedGrowthAlone`, the disposition/basis legality map, the
  Viewer Value state map, the capacity cap, the collision groups, and the derived
  counts, escalation, capacity utilisation and readiness. Do not read
  "Viewer Value safe" more broadly than source + tests support.
- Non-blocking: `viewerValueEscalationRequired` is true whenever **any** resolved
  candidate is at risk, committed or not, so the executor always stamps
  `requiresHumanJudgment` true in that case. The escalation rules are therefore
  tamper anchors in practice rather than the first line of defence;
  `committedAtRiskCandidateIds` is the field that distinguishes "an at-risk
  candidate exists" from "we committed one".
- Unrelated pre-existing defect (not touched): `docs/viewer-value-doctrine.md`
  still states "Nothing downstream of the script (packaging, production,
  publishing) is implemented yet", which has been stale since the Packaging and
  Release verticals landed. Out of scope for this slice.
- Follow-up: refresh Graphify (`graphify update .`); update the canonical Obsidian
  implementation / current-state notes — the `vault-as-mcp` server was not
  exercised this session, so only the git-tracked handoff was updated.

## Next action

Independent verification of the vertical on `feat/channel-portfolio` (re-run the
adversarial Viewer Value matrices against `video-portfolio-validation.ts`,
generate fresh paraphrases per semantic family, probe the candidate-projection
boundary and the payload ceilings at six candidates, re-run the disposable-PG
gate), then a merge decision. To re-run the disposable-PG gate:
`docker start channelwright-postgres`, then
`CHANNELWRIGHT_DISPOSABLE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm run gate:videoportfolio:disposable-pg`.
