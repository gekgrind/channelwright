---
Agent: Claude Code
Task: Implement the CHANNEL_VIDEO_EXPERIMENT workflow vertical
Completed: 2026-09-07 (round-3 repairs applied after round-3 independent verification)
Repository: `C:\DevProjects\channelwright` (worktree `C:\DevProjects\channelwright-experiment`)
Branch: `feat/channel-video-experiment` (off `main` @ 9888d74 — the merged CHANNEL_VIDEO_DECISION)
Status: `IMPLEMENTED + REPAIRED (round 3) — ALL LOCAL GATES + DISPOSABLE-POSTGRESQL PASSED, READY FOR INDEPENDENT RE-VERIFICATION`
Merged: NO (do not merge to main)
---

## Round-3 independent verification: NOT READY TO MERGE → repaired

Independent verification of `4b39088721f0f6727e023f6ee042aeb44869b63b` returned
**NOT READY TO MERGE**. It confirmed the round-1 / round-2 repairs to upstream
resolution, transitive integrity, provider independence, accounting,
approval/immutability, the rule catalogue and every engineering gate remained
sound, and listed exactly these blockers (three P1, three P2):

- **P1 — harmful-treatment semantic detection failed open.** Fresh ordinary
  paraphrases ("stuff the middle with repetitive recap sections so the audience
  spends longer", "postpone the useful answer … so people stay", "frame a
  disagreement as a scandal", "pretend the offer expires tonight") and
  negation smuggling ("not only pad the video…", "do not avoid padding…", "avoid
  filler; pad the video…") all passed the finite phrase catalogue + 32-char
  negation look-back. **Replaced with a bounded clause-aware semantic-intent
  classifier** (`treatmentIntentIsHarmful`): the intent text is normalised
  (en/em dashes → spaces so a parenthetical "do not — … — pad" is not severed)
  and split into clauses on sentence punctuation / `;` / `:` / a few
  coordinating conjunctions (never on "so"/"to", which introduce the PURPOSE);
  each clause is tested for a harmful MECHANISM in two tiers — **Tier A** the
  action alone is a harm (outrage / rage bait, manufactured controversy or
  scandal, deliberate polarisation, fake urgency / scarcity / expiry / countdown,
  bait-and-switch), **Tier B** a prolonging / promise-withholding action that is
  harmful only with a watch-time / keep-watching PURPOSE in the same clause —
  then a **clause-scoped negation parity** check (an odd number of negation cues
  before the action flips the clause to safe; "not only" never counts; "do not
  avoid padding" is an even/​double negative and stays harmful).
- **P1 — status-quo intent smuggled through superficial outcome tokens.**
  `OUTCOME_FRAME.test(text)` exempted the whole field whenever any bare
  `if` / `unless` / `control` / `result` / `outcome` token appeared, so "If
  possible, keep the current opening because no testing is needed" and "Control
  condition aside, keep the current opening" passed. **Replaced with
  `OUTCOME_JUSTIFIED_PRESERVE`** (a strict pattern that requires the outcome
  semantics themselves — treatment underperforms, a null / negative /
  inconclusive result, a guardrail breach, an actual control condition that
  preserves the asset) applied **clause by clause** (`sentenceClauses`,
  splitting on `.!?;` only so "if X, preserve Y" stays one unit). `STATUS_QUO_
  INTENT` gained "no more/further testing needed", "no reason/point to test",
  "needs no experiment" families.
- **P1 — resolver root could belong to another same-owner Decision workflow.**
  `resolve_approved_video_decision_artifact`'s root predicate checked
  `id` + `owner_id` + `workflow_type` but not `workflow_id`, so a run of a
  *different* same-owner `CHANNEL_VIDEO_DECISION` workflow satisfied it. **Added
  `and workflow_id = v_run.workflow_id`.** New disposable-PG runtime assertion
  seeds a second same-owner Decision workflow, points the accounting budget's
  `root_run_id` at that foreign run, and asserts the resolver now raises
  `UPSTREAM_DECISION_LINEAGE_INVALID: resolved root is not a real run of this
  workflow` (it also asserts a valid same-workflow root still resolves). The
  source-text migration test pins the exact predicate.
- **P2 — invalidation incoherence was phrase-specific.** "There is no possible
  scenario for this trigger", "by definition this cannot trigger", "incapable of
  occurring", "zero chance of activation", "no world in which this criterion
  activates" passed. **Broadened `INCOHERENT_INVALIDATION`** with an
  occurrence-verb group that includes trigger/fire/activate (still excluding
  measure / deliver / collect / trust so "invalidate if the metric cannot be
  measured" stays valid), `incapable of …`, `(zero|no) chance/possibility of …`,
  `no <adj> scenario/world/circumstance … for/in which/exists`, `under no
  circumstances`, and a looser `by definition …`.
- **P2 — numeric classification false-positive / false-negative edges.**
  `%` glued to a digit ("2%") never matched `QUANTITY_AFTER` (`%\b` has no
  boundary before a space), so "Variant 2% is the retention threshold" was
  masked by the label exemption; and "3-module sequence" was flagged because
  `module` was not a structural noun. **Fixed:** `QUANTITY_AFTER` now accepts the
  measurement noun followed by a real word boundary **or** a non-alphanumeric
  char (so `%` / `percent` outrank the bare-label exemption); `module` added to
  `STRUCTURAL_NOUN_AFTER`; `panel` / `module` added to `LABEL_BEFORE` so
  "Panel 2." / bare label ids still pass.

Catalogue unchanged at **67 rules** (count still derived from `RULES.length`).
Source touched: `video-experiment-validation.ts`, the migration's root predicate,
the disposable-PG gate (one new runtime assertion), and the two test files. A
round-3 adversarial regression block (every exact round-3 input plus independent
fresh paraphrases and negative controls per rule) is added to
`video-experiment-validation.test.ts`. Nothing in the round-1 / round-2 "sound"
areas was disturbed; all gates re-run green (see Verification).

Rejected round-3 SHA: `4b39088721f0f6727e023f6ee042aeb44869b63b`
Round-3 repair SHA: recorded in `## Base / HEAD` below after commit.

## Round-1 independent verification: NOT READY → repaired

Independent verification of `c254f31` returned NOT READY TO MERGE with three P1
and three P2 findings. All release-blocking findings are repaired in `11dc555`:

- **P1 — Viewer Value validation was acquisition-metric-only.** `NO_SATISFACTION_
  GUARDRAIL_METRIC` / `METRIC_GAMING_UNGUARDED` only fired for `ACQUISITION_METRICS`,
  so retention-via-promise-mismatch, watch-time padding, outrage engagement and
  trust-damaging conversion all passed. Replaced with a metric-family model
  (ACQUISITION / RETENTION / ENGAGEMENT / LOYALTY): every primary metric now
  requires an independent viewer-benefit guardrail metric
  (`NO_INDEPENDENT_VIEWER_BENEFIT_GUARDRAIL`; a retention primary specifically
  requires a loyalty guardrail), and `METRIC_GAMING_UNGUARDED` requires a
  `viewerValueGuardrail` naming the family-specific gaming risk. Observational
  probes (no treatment) are exempt from the family-term check.
- **P1 — the approved Decision could be semantically rewritten.** The server now
  also pins `decisionLinkage.testsDecisionStatement` verbatim; the linkage rule
  checks it; and `EXPERIMENT_PURPOSE_CONTRADICTS_DECISION` rejects any design
  whose stated *purpose* is to confirm / preserve the status quo (an
  interpretation-plan *outcome* of "preserve" stays valid).
- **P1 — spelled-out / hyphenated fabricated quantities slipped through.** The
  digit-token scan is replaced with a quantity-aware detector: hyphenated digits
  ("48-hour"), spelled-out cardinals next to a measurement noun ("thirty
  percent", "forty viewers"), magnitude / baseline phrases, and sample-size
  phrasing are flagged; a bare digit used as a **label** ("variant 2", "Episode
  7", "phase 1") is explicitly allowed (fixes the P2 over-rejection too).
- **P2 — internal semantic contradictions unvalidated.** New rules
  `CONFOUNDER_HELD_CONSTANT_CONTRADICTION`, `GUARDRAIL_PRECEDENCE_CONTRADICTED_IN_PROSE`,
  `ROLLBACK_DOES_NOT_REVERT`, `INVALIDATION_CONDITION_INCOHERENT`.
- **P2 — resolver parent/root lineage incomplete.** `resolve_approved_video_decision_artifact`
  now reconciles the accounting budget's `parent_run_id` with `context_payload`'s
  `previousRunId` and verifies the resolved root is a real owner-scoped run of
  this workflow. Additive; no happy-path regression.

Catalogue: 58 → 66 rules (count still derived from `RULES.length`). A 15-case
adversarial regression matrix (every input the verification used) is added to
`video-experiment-validation.test.ts`. All gates re-run green (see Verification).

## Round-2 independent verification: NOT READY → repaired

Independent verification of `2b8654f` returned **NOT READY TO MERGE**. It
confirmed the round-1 repairs to upstream resolution, transitive integrity,
parent/root reconciliation, provider independence, accounting, and all
engineering gates were sound, but found four remaining semantic-validation gaps.
All four are repaired in the round-2 commit (source: `video-experiment-validation.ts`
only; catalogue **66 → 67 rules**, count still derived from `RULES.length`):

- **P1 — Viewer Value treatment safety failed open.** `METRIC_GAMING_UNGUARDED`
  only checked whether the *guardrail* named the family gaming risk, so a harmful
  *treatment* ("pad the video", "withhold the promised answer", "use outrage
  bait") passed when paired with a compliant guardrail. Added a Layer-1 rule
  **`VIEWER_VALUE_TREATMENT_HARMFUL`** that inspects the canonical treatment-intent
  fields (`treatmentCondition.description` / `.whatChanges`, `title`, `hypothesis`,
  `decisionLinkage.hypothesisUnderTest`, `targetVariable`,
  `expectedDirection.justification`) for the four doctrine harm classes —
  promise withholding/mismatch, artificial watch-time padding, outrage/
  manipulation, trust-damaging conversion — with a negation guard so safe
  interventions ("remove low-value filler", "tighten the opening so the promised
  value appears sooner", "improve pacing without delaying the payoff") and
  by-what-it-avoids guardrail phrasing do not trip it. Layer 2 (guardrail
  adequacy, `NO_INDEPENDENT_VIEWER_BENEFIT_GUARDRAIL` / `METRIC_GAMING_UNGUARDED`)
  is unchanged; a valid guardrail can no longer sanitize an invalid treatment.
- **P1 — Decision-purpose contradiction was phrase-specific.** "The current
  opening should remain unchanged because further investigation is unwarranted"
  bypassed `EXPERIMENT_PURPOSE_CONTRADICTS_DECISION`. Replaced `PURPOSE_STATUS_QUO`
  with `STATUS_QUO_INTENT` covering the families (remain/stay unchanged, keep/
  retain/preserve current X, do not change, no change needed, further
  investigation unnecessary/unwarranted, no need to test further, status quo
  should remain) plus an `OUTCOME_FRAME` guard so conditional / null-result /
  control-condition "preserve the current opening" language stays valid as an
  *outcome*.
- **P2 — invalidation incoherence.** "This condition can never occur" bypassed
  `INVALIDATION_CONDITION_INCOHERENT`. Broadened `INCOHERENT_INVALIDATION`
  (can/could/will/would/shall + not/never + happen/occur/arise/be met…;
  impossible to satisfy/trigger/…) with contraction normalisation, still scoped
  to the `invalidationConditions` field so a legitimate failure condition that
  merely involves an inability ("if the metric cannot be measured reliably") is
  not caught.
- **P2 — structural numeric false positive.** "Use a 3-part hook" tripped
  `FABRICATED_QUANTITY_IN_DESIGN`. Added `STRUCTURAL_NOUN_AFTER` (part/step/
  section/chapter/act/scene/beat/phase/… — deliberately excluding ambiguous
  allocation nouns segment/group/arm and every measurement noun): a digit
  immediately before a structural noun is a narrative count, not a measurement.
  Measurement-like quantities ("3 hours", "30-percent baseline", "3 days",
  "sample of 40 viewers") still flag via `QUANTITY_AFTER` / `SPELLED_QUANTITY`.

A round-2 adversarial regression matrix (the exact round-2 inputs plus
independent paraphrases and negative controls for each rule) is added to
`video-experiment-validation.test.ts`. All gates re-run green (see Verification).

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
  `DETERMINISTIC_VIDEO_EXPERIMENT_RULES` (66-rule data-driven catalogue;
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
  `video-experiment-validation.test.ts` (67, incl. a 15-case adversarial matrix),
  `approved-decision-resolver.test.ts` (8), `video-experiment-executor.test.ts` (13),
  `video-experiment-migration.test.ts` (12) — 100 focused.

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

## Verification (local + disposable-PG; no shared/production DB touched) — re-run after the round-3 repair

- `npm run typecheck` (`tsc --noEmit`) — PASS, exit 0
- `npm run lint` (`eslint .`) — PASS, exit 0
- Focused Experiment suites — **135/135 PASS** (101 validation incl. the round-1,
  round-2 and new round-3 adversarial matrices + 8 resolver + 13 executor + 13
  migration).
- `npm test` (`vitest run`) — PASS, exit 0, **108 files / 1416 tests**.
- `npx vitest run src/server/workflows` — PASS, exit 0, **60 files / 1070 tests**.
- `npm run build` — PASS, exit 0 ("Compiled successfully"). Build rewrote the
  generated `next-env.d.ts` (dev→prod type-import paths only); reverted, no
  source change.
- `gate:videoexperiment:disposable-pg` — **`VIDEO_EXPERIMENT_DISPOSABLE_PG_PASSED`,
  42 passed / 0 failed**, exit 0, against a local disposable PostgreSQL 17
  cluster (`channelwright-postgres`, 127.0.0.1:55432). Full **31-migration**
  chain applied from scratch; all prior 40 checks still pass; the **two new
  round-3 checks pass** — "valid same-workflow lineage root still resolves" and
  "same-owner root from a different Decision workflow is rejected"
  (`UPSTREAM_DECISION_LINEAGE_INVALID: resolved root is not a real run of this
  workflow`). Confirmed a real runtime assertion: with the `workflow_id` predicate
  temporarily removed the gate reported `FAILED` on exactly that check, then
  passed again once restored. The gate created and dropped its own throwaway
  database and gate-created roles; both cleaned up. The `channelwright-postgres`
  container was started for this pass and stopped again afterwards (returned to
  its prior `Exited` state); `docker start channelwright-postgres` before
  re-verification.

No push (feature branch only), deploy, or migration application to any
shared/production database. Not merged to main.

## Base / HEAD

- Base SHA: `9888d749ee0bcefdc2d0dfac2b9b60b9230e0806` (origin/main, "Merge CHANNEL_VIDEO_DECISION")
- Rejected round-2 SHA: `2b8654fa6737a417d286e361cb9d4abc1fb4ea37`
- Rejected round-3 SHA: `4b39088721f0f6727e023f6ee042aeb44869b63b`
- Round-3 repair SHA: `bb9e6c9a10cd9f9cfb28422e5c770ff06ab91402`
- Branch: `feat/channel-video-experiment` — `c254f31` (vertical) → `de6da57` (doc)
  → `11dc555` (round-1 repairs) → `2b8654f` (round-1 doc) → `11dc555`… → round-2
  repair (`2b8654f`… doc `de6da57`… — see git log) → `4b39088` (round-2 repair,
  rejected round-3) → round-3 repair commit
  (`fix(video-experiment): close semantic and lineage verification gaps`).
- 0 behind `origin/main`; the branch carries the round-1/2/3 repair history
  ending in the round-3 repair commit `46c01e5c63d6a299a1630ff21293433603d35522`
  plus follow-up handoff-doc corrections. Run
  `git rev-list --left-right --count origin/main...HEAD` for the exact count.

## Open findings

- Round-1 / round-2 P1/P2 findings: repaired earlier; round-3 verification
  reconfirmed upstream resolution, transitive integrity, provider independence,
  accounting, approval/immutability, rule catalogue/counting and all engineering
  gates sound.
- Round-3 P1/P2 findings (6): all repaired in the round-3 repair commit — see the
  round-3 section at the top. Harmful-treatment detection is now a clause-aware
  two-tier classifier with negation parity; status-quo exemption requires real
  outcome semantics and is clause-scoped; the resolver root is pinned to the
  exact `workflow_id` (source + runtime asserted); invalidation incoherence and
  numeric `%`/label precedence are broadened with negative controls.
- Non-blocking: the treatment-harm / status-quo / invalidation / quantity
  detectors remain **bounded deterministic semantic patterns** scoped to the
  canonical treatment / purpose / invalidation fields. They now cover every
  round-1/2/3 adversarial input plus independent fresh paraphrases per class and
  the doctrine's four named harm classes, but they are not general NLP — a
  determined novel paraphrase could still evade a specific pattern. The
  structured server-stamped fields (`testsDecisionStatement`, `disposition`,
  `measurementOnly`, `evidenceStrength`, `experimentReady`, `portfolioEligible`,
  control kind) remain the hard guarantees. Do not read "Viewer Value safe" /
  "Decision semantics pinned" / "quantity handling complete" more broadly than
  source + tests support.
- Follow-up: refresh Graphify (`graphify update .`); update the canonical
  Obsidian implementation / current-state notes (the `vault-as-mcp` server was
  unreachable this session, so only the git-tracked handoff was updated).

## Next action

Independent re-verification of the vertical on `feat/channel-video-experiment` at
the round-3 repair commit (re-run the round-1 + round-2 + round-3 adversarial
matrices against `video-experiment-validation.ts`, including fresh paraphrases;
re-run the disposable-PG gate). To re-run the disposable-PG gate:
`docker start channelwright-postgres`, then
`CHANNELWRIGHT_DISPOSABLE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm run gate:videoexperiment:disposable-pg`.
