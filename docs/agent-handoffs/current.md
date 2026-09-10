---
Agent: Claude Code
Task: Implement the CHANNEL_VIDEO_INTELLIGENCE workflow vertical
Completed: 2026-09-08
Repository: `C:\DevProjects\channelwright` (isolated worktree `C:\DevProjects\channelwright-intelligence`)
Branch: `feat/channel-intelligence` (off `origin/main` @ 6109075 — the merged CHANNEL_VIDEO_PORTFOLIO)
Status: `IMPLEMENTED — ALL LOCAL GATES + DISPOSABLE-POSTGRESQL PASSED; ONE PRE-EXISTING PORTFOLIO TEST FAILS ON WINDOWS (SEE OPEN FINDINGS); AWAITING INDEPENDENT VERIFICATION`
Merged: NO (do not merge to main)
---

# CHANNEL_VIDEO_INTELLIGENCE Vertical

## Predecessor gate

CHANNEL_VIDEO_PORTFOLIO is present in authoritative `origin/main`: `6109075`
("Merge CHANNEL_PORTFOLIO") is `origin/main`'s tip, `7f104eb` is its ancestor, and
the vertical's source, migrations (`202609070001`, `202609070002`) and tests are
all in the tree. The Portfolio handoff is archived at
`docs/agent-handoffs/archive/2026-09-08-claude-channel-video-portfolio.md`.

## What was built

CHANNEL_VIDEO_INTELLIGENCE is the channel-level meta-learning link above
CHANNEL_VIDEO_PORTFOLIO and the twelfth paid workflow on the production spine.

**The contract was recovered, not invented.** The task named the vertical
"CHANNEL_INTELLIGENCE"; the repository already names it
**`CHANNEL_VIDEO_INTELLIGENCE`** in two shipped error messages, and that name was
used. Sources: `video-experiment-validation.ts:1158` and
`video-portfolio-validation.ts:294` (both `INTELLIGENCE_RESPONSIBILITY_LEAKED`,
reserving "channel-wide strategy / meta-learning work" — channel strategy,
strategic pivots, channel-wide learning/pattern/insight/takeaway, meta-analysis
of all cycles, reasoning across the entire channel history, and redefining the
audience/niche/pillars); `docs/video-portfolio.md:47` (Portfolio does not own
"channel strategy (a future Intelligence vertical)").

It consumes **two to four** exact approved, intelligence-eligible Portfolio
allocation records that all descend from **one** approved CHANNEL_STRATEGY run,
and produces a single human-approved, immutable **channel learning record** plus
a **strategy review signal**. Full contract: `docs/video-intelligence.md`.

### The CONTENT_INTELLIGENCE naming collision

Inspected and documented rather than assumed. `CHANNEL_CONTENT_INTELLIGENCE` is
the third workflow: **prospective**, reads one approved Strategy, performs live
YouTube discovery retrieval, and produces a topic backlog plus a next-video
recommendation. `CHANNEL_VIDEO_INTELLIGENCE` is **retrospective**, reads only
immutable prior artifacts, performs zero retrieval, and produces channel learning
plus a strategy review signal. Neither supersedes the other; **no migration plan
in the repository asks for CONTENT_INTELLIGENCE to be renamed or removed, and
nothing in this slice touches it.** `CONTENT_BACKLOG_LEAKED` enforces the
boundary from the Intelligence side.

### Scope boundary enforced

No strategy authorship (`STRATEGY_AUTHORSHIP_LEAKED` — deliberately narrower than
banning the word "strategy": *naming* a contradicted element is this workflow's
output), no topic backlog (`CONTENT_BACKLOG_LEAKED`), no invented market
conclusion (`RESEARCH_CONCLUSION_INVENTED`), no capacity allocation
(`PORTFOLIO_ALLOCATION_LEAKED`), no experiment redesign
(`EXPERIMENT_REDESIGN_LEAKED`), no decision/diagnosis revisiting
(`DECISION_REWRITTEN_IN_INTELLIGENCE`), no execution or workflow launch
(`INTELLIGENCE_EXECUTION_LEAKED`), and every fabricated-quantity class. Revisions
create new run versions; approved records are immutable (DB triggers widened).

### The two structural safety properties

1. **The learning model never sees an allocation's prose body.** The resolver
   projects each approved allocation to closed-vocabulary scalars plus a
   `commitments` array that is itself pure classification. Rationales,
   objectives, allocation hypotheses, sequencing notes, guardrails, revisit
   conditions, alternatives — and even the 200-char experiment titles Portfolio's
   own candidate projection carried — are never projected. Runtime-proven by the
   disposable-PG gate.
2. **The single strategy anchor.** Every candidate in every selected allocation
   must resolve to one CHANNEL_STRATEGY run, and every selection must agree. It
   is what makes "channel-wide" meaningful and what the review signal points at.
   Enforced in the resolver, in `start_workflow` across selections, and again at
   the first worker step (a strategy successor can land between start and claim).

### Viewer Value protections (deterministic, not prose)

1. `intelligencePatternClassSchema` has **no** growth/upside/ROI/reach member — a
   growth lesson fails Zod parsing and is terminal, not a QA finding.
2. `IMPLICATION_PERMITTED_ADOPTION_STANCES` — a `DEGRADES_VIEWER_EXPERIENCE`
   lesson can only be `REJECT_AS_HARMFUL` or `REQUIRES_MORE_EVIDENCE`; it can
   never become channel practice or even be held provisionally
   (`HARMFUL_PRACTICE_ADOPTED`). `UNKNOWN` is never silently upgraded.
3. `GROWTH_ONLY_LEARNING_HIGH_CONFIDENCE` / `GROWTH_ONLY_LEARNING_ADOPTED` /
   `GROWTH_ONLY_STRATEGY_SIGNAL`; `GROWTH_ONLY_ARGUMENT_UNDECLARED` catches a
   pure-growth rationale that denies being one.
4. `VIEWER_VALUE_IMPLICATION_CONTRADICTS_PATTERN` for a recurring Viewer Value
   risk recorded as neutral.
5. `DETERIORATING_TREND_NOT_ESCALATED` / `DETERIORATING_TREND_UNGUARDED`; the
   executor stamps `requiresHumanJudgment` and the trajectory from the
   constraints rather than accepting them from the model.
6. `CONFIDENCE_EXCEEDS_EVIDENCE_CEILING` and
   `REVISION_SIGNAL_WITHOUT_CROSS_CYCLE_EVIDENCE` — no lesson outruns its evidence.
7. `LEARNING_NOT_CROSS_CYCLE` — schema minimum of two supporting cycles,
   re-checked for distinctness.
8. Positively: **a horizon that concludes `HOLD` or `INSUFFICIENT_EVIDENCE` is a
   valid, `intelligenceReady` outcome.** There is no pressure to produce a pivot.

`strategyReviewSignalSchema.humanDecisionRequired` and `revisionAuthoredElsewhere`
are `z.literal(true)`, so the contract itself cannot express "and here is the new
strategy" or "and I have started the revision".

### Files added

- `src/server/workflows/approved-portfolio-resolver.ts` — thin TS wrapper
  invoking the RPC once per cycle; invariant enforcement lives in the new
  `resolve_approved_video_portfolio_artifact` RPC. Also re-checks the cross-cycle
  strategy anchor and assembles the compact intelligence scope.
- `src/server/workflows/video-intelligence-cycles.ts` —
  `deriveVideoIntelligenceConstraints`, `deriveViewerValueTrend`, `chronological`,
  `cyclesWithCommittedAtRisk`, `deriveIntelligenceReady`,
  `deriveIntelligenceRequiresHumanJudgment`, `learningExceedsEvidenceCeiling`,
  `IMPLICATION_PERMITTED_ADOPTION_STANCES`,
  `VIEWER_VALUE_BEARING_PATTERN_CLASSES`.
- `src/server/workflows/video-intelligence-validation.ts` —
  `DETERMINISTIC_VIDEO_INTELLIGENCE_RULES` (49-rule data-driven catalogue;
  `deterministicChecksPassed/Failed` always computed from `RULES.length` and
  distinct failed codes). `expectedConstraints` is deliberately **required**, for
  the same reason Portfolio made it required: the horizon label is operator input
  not recoverable from upstream artifacts, so any default would read it back out
  of the result being checked.
- `src/server/workflows/video-intelligence-config.ts` — 2 synthesis / 2 QA / 0
  revision / 0 automated-revision ceilings, construction-time budget assertion,
  **56 KiB** payload ceiling (below Portfolio's 60 KiB because the horizon is
  capped at four cycles and the reference carries flat anchors instead of nested
  chains); still below `complete_workflow_step`'s hard 65_536.
- `src/server/workflows/video-intelligence-model.ts` —
  `RoutedVideoIntelligenceModel`, `VIDEO_INTELLIGENCE` routing namespace,
  distinct-provider GENERATOR/CRITIC.
- `src/server/workflows/video-intelligence-executor.ts` — 7-step no-revision
  graph; `stampServerDerivedFields` re-stamps horizon label / counts / trajectory
  / escalation / at-risk cycle set / readiness.
- `supabase/migrations/202609080001_video_intelligence.sql` (chain 33→34: widen
  both workflow-type checks; `workflow_runs_active_video_intelligence_uniq` keyed
  on the normalised horizon; `resolve_approved_video_portfolio_artifact` — 19
  invariants incl. the `portfolioReady` eligibility gate, the single
  Strategy/Research anchor, the eleven-artifact arity assertion on every
  candidate, a re-hash **plus supersession check** on both anchors, the
  root-lineage `workflow_id` pin, and the bounded cycle projection;
  `start_workflow` / `complete_workflow_step` / `decide_workflow_approval` /
  `ensure_research_run_budget` recreated with the INTELLIGENCE branch) and
  `202609080002_video_intelligence_immutability.sql` (chain 34→35).
- `scripts/channel-video-intelligence-disposable-pg.ts` +
  `gate:videointelligence:disposable-pg`.
- Fixtures + tests: `video-intelligence-fixtures.test-helper.ts`,
  `video-intelligence-validation.test.ts` (90),
  `video-intelligence-executor.test.ts` (19),
  `approved-portfolio-resolver.test.ts` (8),
  `video-intelligence-migration.test.ts` (18) — **135 focused**.
- `docs/video-intelligence.md`.

### Domain additions (`src/domain/production-workflows.ts`)

Added `CHANNEL_VIDEO_INTELLIGENCE` to `workflowTypeSchema`;
`intelligenceLineageWorkflowTypeSchema` (3 types),
`intelligenceArtifactIdentitySchema`, `intelligenceCycleIdSchema`,
`channelLearningIdSchema`, `approvedVideoPortfolioReferenceSchema` (with **flat**
strategy/research anchors), `intelligenceCommitmentSchema`,
`intelligenceCycleSchema`, `videoIntelligenceScopeSchema`,
`intelligencePortfolioSelectionSchema`, `videoIntelligenceRequestInputSchema`,
`approvedVideoPortfolioArtifactSchema`, `approvedVideoPortfolioSetSchema`,
`videoIntelligenceConstraintsSchema`, `intelligencePatternClassSchema`,
`intelligenceViewerValueImplicationSchema`, `intelligenceAdoptionStanceSchema`,
`intelligenceViewerValueTrendSchema`, `channelLearningSchema`,
`strategyElementSchema`, `strategyReviewSignalSchema`,
`channelOpenQuestionSchema`, `channelLearningRecordSchema`,
`intelligenceAlternativeSchema`, `intelligenceViewerValueSafeguardsSchema`,
`videoIntelligenceContentSchema`, the input/draft/critique/QA/final result
schemas; the start-request union branch; the definition + registry +
finalizer-map entry; and type exports.

**No existing schema was modified.** `portfolioCandidateIdSchema`,
`portfolioSelectionBasisSchema`, `portfolioViewerValueDispositionSchema`,
`portfolioRiskSchema`, `experimentTreatmentMechanismSchema`,
`diagnosisCategorySchema`, `decisionTypeSchema` and `experimentMetricSchema` are
reused as-is.

### Wiring updated

`role-router.ts` (`VIDEO_INTELLIGENCE` namespace), `research-usage.ts`
(`VIDEO_INTELLIGENCE_RESOURCE_BUDGET_EXHAUSTED`),
`production-workflow-repository.ts` (`VIDEO_INTELLIGENCE_LIMIT_REACHED`,
`UPSTREAM_PORTFOLIO_INVALID`), `workflow-worker.ts` (executor + error-message
codes), `src/app/api/workflows/route.ts` (idempotency list).

## Payload discipline

Portfolio's release-blocking lesson was applied up front rather than discovered
late. The horizon is capped at **four** cycles (not six), the reference carries
**flat** strategy/research anchors instead of re-nesting Portfolio's eleven-deep
per-candidate chains, and the cycle projection carries no prose at all.

Measured at maximum legal fan-out (4 cycles × 6 commitments, 6 learnings at full
prose caps, 4 alternatives): the final result and the **persisted final-QA step
envelope** (`{ qa, crossModelReview, result }`) both sit under their ceilings,
asserted by permanent regression tests. The runtime gate independently measures
one resolved cycle and asserts ×4 fits inside 65,536.

## Verification (local + disposable-PG; no shared/production DB touched)

- `npm run typecheck` (`tsc --noEmit`) — PASS, exit 0
- `npm run lint` (`eslint .`) — PASS, exit 0, zero warnings
- Focused Intelligence suites — **135/135 PASS** (validation 90 + executor 19 +
  migration 18 + resolver 8)
- `npm test` (`vitest run`) — **1 failed | 1673 passed (1674)**, 116 files. The
  single failure is `video-portfolio-migration.test.ts:116`, a **pre-existing**
  Windows CRLF defect inherited from the merged Portfolio slice; it reproduces
  identically on a pristine, clean `origin/main` worktree. See Open findings.
- `npm run build` — PASS, exit 0. Build rewrote the generated `next-env.d.ts`
  (dev→prod type-import paths only); reverted, no source change.
- `gate:videointelligence:disposable-pg` — **`VIDEO_INTELLIGENCE_DISPOSABLE_PG_PASSED`,
  62 passed / 0 failed**, exit 0, against a local disposable PostgreSQL 17
  cluster (`channelwright-postgres`, 127.0.0.1:55432). Full **35-migration**
  chain applied from scratch. The gate created and dropped its own throwaway
  database and gate-created roles; both cleaned up.

No push to shared/production Supabase, no deploy, no migration applied to any
shared database. Not merged to main.

## Base / HEAD

- Base SHA: `61090750f2513570b310139a75000bda35bdb6af` (origin/main, "Merge CHANNEL_PORTFOLIO")
- Branch: `feat/channel-intelligence`
- 0 behind `origin/main`. Run `git rev-list --left-right --count origin/main...HEAD`
  for the exact ahead count.

## Open findings

- **P2, pre-existing, NOT fixed here (deliberately).**
  `src/server/workflows/video-portfolio-migration.test.ts:116` asserts a
  two-line source substring joined with `\n` against
  `202609070001_video_portfolio.sql`, read without line-ending normalization. On
  a Windows checkout that file is CRLF, so the assertion can never match and
  `npm test` fails. **Verified pre-existing:** the same single test fails on a
  pristine, clean `origin/main` worktree with no Intelligence code present. It is
  a latent cross-platform defect in the merged Portfolio slice, not a regression
  from this vertical, and the brief explicitly directs that a repository-wide
  line-ending policy be treated as a separate finding rather than bundled here.
  Two viable fixes: normalize in the test (one line), or add `.gitattributes`
  with `*.sql text eol=lf`. The Intelligence migration test does normalize
  (`readSql`), so this pattern is not spread further.
- Non-blocking: the prose detectors (fabricated quantity, forecast, causal
  certainty, the seven scope-leakage classes, growth-only argument) are **bounded
  deterministic patterns** scoped to the model-authored record surfaces. They are
  not general NLP; a determined novel paraphrase could evade a specific pattern.
  The hard guarantees are the structured, server-stamped fields: the closed
  pattern vocabulary with no growth member, the implication/stance legality map,
  `justifiedByAudienceGrowthAlone`, the two-cycle minimum, the evidence ceiling,
  the derived trajectory and escalation, the `literal(true)` signal fields, and
  the single strategy anchor. Do not read "Viewer Value safe" more broadly than
  source + tests support.
- Non-blocking: `deriveViewerValueTrend` is a **rate comparison over at-risk
  commitments**, not a measurement of viewer experience. It detects a channel
  committing proportionally more known-risky work over time; it cannot detect
  harm no upstream Experiment ever flagged as at risk. A two-cycle horizon splits
  1/1, so a single at-risk commitment appearing in the later cycle is enough to
  read DETERIORATING — deliberately conservative (fails toward escalation).
- Non-blocking: `escalationRequired` is true whenever **any** resolved cycle
  committed at-risk work or required human judgment, so the executor stamps
  `requiresHumanJudgment` true in that case regardless of what the record says.
  The escalation rules are therefore tamper anchors in practice;
  `cyclesWithCommittedAtRiskIds` is the field that distinguishes which cycles.
- Non-blocking: the downstream contract (`intelligenceReady`,
  `strategyReviewSignal.signal`, `contradictedElements`) has **no consumer yet**.
  It is deliberately minimal and its consumption shape is left to whatever
  vertical claims it, exactly as Experiment left `portfolioEligible` to Portfolio.
- Unrelated pre-existing defect (not touched): `docs/viewer-value-doctrine.md`
  still states "Nothing downstream of the script (packaging, production,
  publishing) is implemented yet", stale since Packaging and Release landed.
  Carried forward from the Portfolio handoff; still out of scope.
- Follow-up: refresh Graphify (`graphify update .`); update the canonical Obsidian
  implementation / current-state notes — the `vault-as-mcp` server was not
  exercised this session, so only the git-tracked handoff was updated.

## Next action

Independent verification of the vertical on `feat/channel-intelligence`: re-run
the adversarial Viewer Value matrices against `video-intelligence-validation.ts`,
generate fresh paraphrases per semantic family (especially the
strategy-authorship boundary, which is deliberately narrow enough to permit
*naming* a contradicted element), probe the cycle-projection boundary and the
payload ceilings at four cycles, exercise the strategy-anchor gate with
adversarial lineages, and re-run the disposable-PG gate. Then a merge decision.
To re-run the gate: `docker start channelwright-postgres`, then
`CHANNELWRIGHT_DISPOSABLE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm run gate:videointelligence:disposable-pg`.
