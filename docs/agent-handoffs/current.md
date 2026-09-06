---
Agent: Claude Code
Task: Implement the CHANNEL_VIDEO_EXPERIMENT workflow vertical
Completed: 2026-09-06
Repository: `C:\DevProjects\channelwright` (worktree `C:\DevProjects\channelwright-experiment`)
Branch: `feat/channel-video-experiment` (off `main` @ 9888d74 — the merged CHANNEL_VIDEO_DECISION)
Status: `IMPLEMENTED — ALL LOCAL GATES + DISPOSABLE-POSTGRESQL PASSED, READY FOR INDEPENDENT VERIFICATION`
Merged: NO (do not merge to main)
---

# CHANNEL_VIDEO_EXPERIMENT Vertical

## What was built

CHANNEL_VIDEO_EXPERIMENT is the controlled-test-design link after
CHANNEL_VIDEO_DECISION, mirroring the merged VIDEO_DECISION slice exactly. It
consumes exactly ONE approved, **experiment-eligible** CHANNEL_VIDEO_DECISION
artifact (DB-authoritative resolver, immutable re-verified reference carrying
transitive provenance back through the whole RESEARCH → … → DIAGNOSIS → DECISION
chain) and produces a human-approved, immutable **experiment design record** —
what a controlled test should look like to test the decision's hypothesis while
protecting Viewer Value and preserving causal interpretability.

Upstream contract: `content.experimentEligible === true` (true only for
`INVESTIGATE` and `PRIORITIZE_CHANGE` — the sole Experiment-facing contract
Decision defined). The DB resolver enforces this as a hard gate
(`UPSTREAM_DECISION_NOT_EXPERIMENT_ELIGIBLE`); `approvedVideoDecisionReferenceSchema.experimentEligible`
is `z.literal(true)`.

Scope decision: **experiment design only** — no execution, no lifecycle/run-state,
no analytics ingestion, no portfolio. It carries only the design artifact and its
own approval lifecycle. `experimentReady` / `portfolioEligible` are the only
downstream (CHANNEL_VIDEO_PORTFOLIO-facing) contracts, deliberately minimal.

The experiment record covers:

- **experimentType** ∈ {CONTROLLED_COMPARISON, SEQUENTIAL_COMPARISON,
  HOLDOUT_COMPARISON, OBSERVATIONAL_PROBE}; server-derived disposition,
  measurementOnly, controlCondition.kind
- **hypothesis** (falsifiable, no causal-certainty language) + **decisionLinkage**
  (pinned to the exact approved decision id/type/statement)
- **targetVariable**, **unitOfAssignment**, **controlCondition** +
  **treatmentCondition** (what changes / what stays constant), **heldConstant**,
  **knownConfounders** (with mitigation + residual risk)
- **primaryMetric** (bounded metric/unit enum, direction), **guardrailMetrics**
  (≥1; a satisfaction/retention metric is required when the primary is
  acquisition-side), **viewerValueGuardrails** (≥1; explicit metric-gaming
  protection)
- **expectedDirection** (`magnitudeClaim` is the literal `"QUALITATIVE_ONLY"` —
  no numeric forecast), **observationWindow** + **exposureRequirement**
  (qualitative; `OPERATOR_MUST_CONFIRM`)
- **stoppingConditions** (≥2, ≥1 tied to a guardrail / Viewer Value harm),
  **failureConditions**, **invalidationConditions**, **rollbackPlan** (required
  for any manipulation; easily reversible when Viewer Value is not preserved)
- **evidenceRequiredToInterpret**, **interpretationPlan**
  (`guardrailPrecedence: true` — a guardrail breach overrides a favourable
  primary), **knownUnknowns**, **confidenceInDesign** (capped by the Decision's
  evidence strength + confidence ceilings)
- id-only citations into the Decision's cited findings / observations / unknowns
- **ranked alternative designs**, typed **decisionDisagreements** (recorded,
  never written back), server-stamped **viewerValueSafeguards**, and
  **experimentReady** / **portfolioEligible** (both server-derived)
- **explicit human approval** (`review-video-experiment`)

### Hard boundary enforced (design + durable-record system, NOT execution)

Deterministic QA rejects, as scope violations: publishing / upload / go-live /
schedule / notification / ad-spend / OAuth-connect language
(`EXPERIMENT_EXECUTION_LEAKED` — narrowed vs Decision's so an asset change *as a
treatment* is allowed), cross-video / roadmap prioritization
(`PORTFOLIO_RESPONSIBILITY_LEAKED`), channel-strategy / meta-learning work
(`INTELLIGENCE_RESPONSIBILITY_LEAKED`), rewriting/overriding the Decision
(`DECISION_REWRITTEN`, `EXPERIMENT_CATEGORY_MISMATCH`,
`EXPERIMENT_DECISION_LINKAGE_MISMATCH`), and every fabricated-quantity class
(`FABRICATED_QUANTITY_IN_DESIGN` = any non-year digit in design prose,
`FABRICATED_STATISTICAL_CLAIM`, `FABRICATED_SAMPLE_SIZE`,
`FABRICATED_EFFECT_FORECAST`). Revisions create new run versions; approved
experiment records are immutable (DB triggers widened).

### Files added

- `src/server/workflows/approved-decision-resolver.ts` — thin TS wrapper;
  invariant enforcement lives in the new `resolve_approved_video_decision_artifact` RPC.
- `src/server/workflows/video-experiment-constraints.ts` —
  `deriveVideoExperimentConstraints` + exported deterministic maps
  (`EXPERIMENT_TYPE_DISPOSITION`, `EXPERIMENT_TYPE_CONTROL_KIND`,
  `EXPERIMENT_TYPE_MEASUREMENT_ONLY`, `EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE`,
  `permittedExperimentTypesFor`, `deriveExperimentReady`, acquisition/satisfaction
  metric sets).
- `src/server/workflows/video-experiment-validation.ts` —
  `DETERMINISTIC_VIDEO_EXPERIMENT_RULES` (58-rule data-driven catalogue;
  `deterministicChecksPassed/Failed` always computed from `RULES.length` and
  distinct failed codes, structurally avoiding the Performance P3 count defect).
- `src/server/workflows/video-experiment-config.ts` — 2 synthesis / 2 QA / 0
  revision / 0 automated-revision ceilings, construction-time budget assertion,
  48 KiB payload ceiling.
- `src/server/workflows/video-experiment-model.ts` — `RoutedVideoExperimentModel`,
  `VIDEO_EXPERIMENT` routing namespace, distinct-provider GENERATOR/CRITIC.
- `src/server/workflows/video-experiment-executor.ts` — 7-step no-revision graph,
  `stampServerDerivedFields` forcibly re-stamps disposition / measurementOnly /
  evidenceStrength / category / control-kind / decision-linkage / Viewer Value
  state / escalation / readiness / portfolio eligibility.
- `supabase/migrations/202609060001_video_experiment.sql` (chain 29→30: widen
  both workflow-type checks; `workflow_runs_active_video_experiment_uniq`;
  `resolve_approved_video_decision_artifact` — 17 invariants incl. the
  eligibility gate and a **ten-artifact** transitive re-hash **plus supersession
  check** on every link; `start_workflow` / `complete_workflow_step` /
  `decide_workflow_approval` / `ensure_research_run_budget` recreated with the
  EXPERIMENT branch) and `202609060002_video_experiment_immutability.sql`
  (chain 30→31: widen both immutability trigger allow-lists).
- `scripts/channel-video-experiment-disposable-pg.ts` +
  `gate:videoexperiment:disposable-pg`.
- Fixtures + tests: `video-experiment-fixtures.test-helper.ts` (builds an
  experiment-eligible INVESTIGATE Decision on OPENING_PROMISE),
  `video-experiment-validation.test.ts` (52), `approved-decision-resolver.test.ts`
  (8), `video-experiment-executor.test.ts` (13), `video-experiment-migration.test.ts` (11) — 84 focused.

### Domain additions (`src/domain/production-workflows.ts`)

Added `CHANNEL_VIDEO_EXPERIMENT` to `workflowTypeSchema`; the
`experimentLineageWorkflowTypeSchema` (10 types), `experimentArtifactIdentitySchema`,
`videoExperimentScopeSchema` (exactly 10 artifacts); `approvedVideoDecisionReferenceSchema`
(with `decisionType` + `experimentEligible: z.literal(true)` +
`upstreamVideoDiagnosis`), `videoExperimentRequestInputSchema` (two fields),
`approvedVideoDecisionArtifactSchema`; `experimentTypeSchema` (4-member, no
numeric fields), `videoExperimentConstraintsSchema`, `experimentSchema` +
sub-schemas, `experimentAlternativeSchema`, `experimentDecisionDisagreementSchema`,
`experimentViewerValueSafeguardsSchema`, `videoExperimentContentSchema`, the
cross-model/draft/critique/QA/final result schemas; the start-request union
branch; the definition + registry + finalizer-map entry; and type exports.

### Wiring updated

`role-router.ts` (`VIDEO_EXPERIMENT` namespace), `research-usage.ts`
(`VIDEO_EXPERIMENT_RESOURCE_BUDGET_EXHAUSTED`), `production-workflow-repository.ts`
(`VIDEO_EXPERIMENT_LIMIT_REACHED`, `UPSTREAM_DECISION_INVALID`),
`workflow-worker.ts` (executor + error-message codes),
`src/app/api/workflows/route.ts` (idempotency list).

## Verification (local + disposable-PG; no shared/production DB touched)

- `npx tsc --noEmit` — PASS, exit 0
- `npx eslint .` — PASS, exit 0
- Focused Experiment suites — 84/84 PASS (52 validation + 8 resolver + 13
  executor + 11 migration).
- `npx vitest run` — PASS, exit 0, **106 files / 1342 tests** in the green run.
  Two Studio workspace test files (`video-brief-workspace.test.tsx`,
  `video-script-workspace.test.tsx`) intermittently hit a vitest worker-startup
  timeout ("Timeout waiting for worker to respond"); re-run in isolation they
  pass 23/23. This is a pre-existing infra flake unrelated to this vertical.
- `npm run build` — PASS, exit 0.
- `gate:videoexperiment:disposable-pg` — **`VIDEO_EXPERIMENT_DISPOSABLE_PG_PASSED`,
  40 passed / 0 failed**, exit 0, against a local disposable PostgreSQL 17
  cluster (`channelwright-postgres`, 127.0.0.1:55432). Full **31-migration**
  chain applied from scratch; all ten approved-artifact resolvers compiled;
  canonical_jsonb_text parity; experiment-eligibility gate; ten-artifact
  transitive re-hash + supersession (incl. superseded transitive Diagnosis
  rejected); cross-owner NOT_FOUND; RLS; approved Experiment payload + finalizer
  output immutable; approved Decision output still immutable (no regression);
  active/concurrent uniqueness; sequential-after-completion allowed;
  zero-retrieval / zero-revision accounting (rejects a 5th model attempt and any
  revision budget). The gate created and dropped its own throwaway database and
  gate-created roles; both cleaned up. The `channelwright-postgres` container was
  returned to its prior Exited state.

No push, deploy, or migration application to any shared/production database. Not
merged to main.

## Base / HEAD

- Base SHA: `9888d749ee0bcefdc2d0dfac2b9b60b9230e0806` (origin/main, "Merge CHANNEL_VIDEO_DECISION")
- Branch: `feat/channel-video-experiment`

## Open findings

- P1/P2: none found in adversarial self-review.
- P3 (non-blocking): `FABRICATED_QUANTITY_IN_DESIGN` is deliberately strict — any
  non-year digit in design prose fails. All quantitative intent lives in
  structured fields (`magnitudeClaim` literal, qualitative exposure), so this is
  the intended "qualitative-only design" posture; revisit only if real usage
  shows benign false positives.
- Follow-up: refresh Graphify (`graphify update .`) — the checked-in graph
  predates even the DECISION merge.

## Next action

Independent verification of the vertical on `feat/channel-video-experiment`
(adversarially re-check `resolve_approved_video_decision_artifact` SQL, the
58-rule catalogue, and the Viewer-Value / metric-gaming guardrails), then a merge
decision. To re-run the disposable-PG gate: `docker start channelwright-postgres`,
then
`CHANNELWRIGHT_DISPOSABLE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm run gate:videoexperiment:disposable-pg`.
