# CHANNEL_VIDEO_PORTFOLIO

The capacity-allocation link after `CHANNEL_VIDEO_EXPERIMENT`, and the eleventh
paid workflow on the production spine.

## Why it exists

Experiment produces a single approved design for a single video. Nothing in the
system decided **which** of those designs a channel should actually run next, in
what order, or how many at once — and Experiment is deterministically forbidden
from deciding it (`PORTFOLIO_RESPONSIBILITY_LEAKED` rejects cross-video
prioritisation, capacity allocation, roadmaps and slates). Portfolio is the
workflow that owns exactly that gap.

It answers one business question: *given finite operator capacity this cycle,
which approved experiments do we commit to, which do we defer, which do we drop,
and why?*

Against the Channelwright loop it strengthens **Learning → Next Decision**: it is
where accumulated per-video learning becomes a channel-level programme of work
without becoming a publishing schedule.

## Contract

**Recovered, not invented.** Experiment reserved exactly two downstream-facing
contracts for this vertical and named it:

- `docs/agent-handoffs/current.md` — "`experimentReady` / `portfolioEligible` are
  the only downstream (CHANNEL_VIDEO_PORTFOLIO-facing) contracts, deliberately
  minimal."
- `src/server/workflows/video-experiment-constraints.ts` —
  `EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE`: "Comparison experiments feed
  CHANNEL_VIDEO_PORTFOLIO … the exact CHANNEL_VIDEO_PORTFOLIO consumption shape
  is deliberately left to that vertical."
- `src/server/workflows/video-experiment-validation.ts` — the `PORTFOLIO_LEAKED`
  pattern enumerates the responsibilities Experiment refuses and Portfolio takes.

### Owns

Cross-experiment capacity allocation for one operator-declared cycle: commit /
defer / exclude, ordering, sequencing, confound avoidance across the slate, and
the cycle-level Viewer Value exposure.

### Does not own

Designing or altering an experiment (Experiment), re-deciding (Decision),
re-diagnosing (Diagnosis), channel strategy (a future Intelligence vertical), any
execution whatsoever (publish, upload, schedule, notification, ad spend, provider
call), analytics ingestion, or experiment outcome tracking.

### Inputs

| Field | Source | Notes |
| --- | --- | --- |
| `cycleLabel` | operator | Names the capacity period; normalised to `portfolioCycleKey` for concurrency |
| `concurrentExperimentSlots` | operator | 1–6; a hard structural cap on commitments |
| `experimentSelections` | operator | 1–6 exact `{experimentWorkflowId, experimentRunId}` pairs |

Each selection is resolved **pre-spend** by
`resolve_approved_video_experiment_artifact`, which is the sole authority for
upstream identity and eligibility. One ineligible candidate fails the whole start.

### Output

A single human-approved, immutable **allocation of record**
(`channelVideoPortfolioResultSchema`): the allocation itself, a rejected
alternative allocation, server-stamped Viewer Value safeguards, and
`portfolioReady`.

## The structural safety property

**The allocation model never sees an experiment's prose body.**

The database resolver projects each approved experiment down to
`portfolioCandidateSchema`: closed-vocabulary scalars (type, disposition, control
kind, category, unit of assignment, treatment mechanism, primary metric and
direction, evidence strength, confidence, readiness, Viewer Value state, promise
integrity risk, escalation, decision linkage) plus the 200-character title and
the run-by-run lineage. Hypotheses, treatment and control descriptions, stopping
conditions, guardrails, interpretation plans and rollback plans are never
projected.

A Portfolio run is therefore *structurally* incapable of restating, weakening, or
rewriting an approved design — not merely forbidden from doing so by prose rules.
`EXPERIMENT_REDESIGN_LEAKED` remains as a second layer for prose that attempts it
anyway.

## Domain model

- **`portfolioCandidate`** — the bounded server projection of one approved,
  portfolio-eligible experiment. `candidateId` is derived server-side as
  `cand:<experimentRunId>`; the model never chooses it.
- **`videoPortfolioConstraints`** — server-derived: the candidate set, the at-risk
  / human-judgment / not-ready id lists, the confound-collision groups, the global
  confidence ceiling (the *lowest* candidate confidence), and whether the cycle
  requires escalation.
- **`portfolioAllocationItem`** — one per candidate: disposition, dense rank for
  committed items, a closed-vocabulary `selectionBasis`, a
  `viewerValueDisposition`, the honest `justifiedByPredictedGrowthAlone`
  declaration, a revisit condition, and citations to other candidates.
- **`portfolioAllocation`** — the record: objective, cycle hypothesis, items,
  server-stamped counts and capacity utilisation, sequencing, risks, Viewer Value
  guardrails, review trigger, and server-stamped `requiresHumanJudgment`.

### Confound collision

Two committed experiments on the same assignment surface contaminate each other's
reading, so surface conflict is a **structural** property of the slate, not a
model judgement. Channel-wide surfaces (`CHANNEL_SEGMENT`, `TRAFFIC_SURFACE`,
`PUBLISH_WINDOW`) collide with each other regardless of video; per-video surfaces
(`VIDEO`, `THUMBNAIL_SLOT`) collide only within the same subject; measurement-only
probes manipulate nothing and never collide.

## Viewer Value protections

The portfolio-level failure mode is *committing the experiment with the biggest
predicted metric win despite known viewer harm*. Five deterministic protections
make that structurally unavailable:

1. **Growth is not a member of the vocabulary.** `portfolioSelectionBasisSchema`
   has no growth/upside/ROI option. A commitment must cite an evidence gap,
   uncertainty reduction, Viewer Value protection, interpretability, or a
   downstream block.
2. **Growth-only commitments are rejected outright.** Any item declaring
   `justifiedByPredictedGrowthAlone` cannot be committed
   (`GROWTH_ONLY_JUSTIFICATION_COMMITTED`), and a rationale that argues purely
   from predicted growth while denying it is caught by
   `GROWTH_ONLY_ARGUMENT_UNDECLARED`.
3. **Viewer Value state cannot be drifted.** A candidate's server-projected state
   constrains which `viewerValueDisposition` is legal in *both* directions: an
   `AT_RISK` candidate can never be recorded as preserved, and a `PRESERVED` one
   can never be recorded as uncertain
   (`VIEWER_VALUE_DISPOSITION_CONTRADICTS_PROJECTION`).
4. **At-risk commitments must escalate.** Committing an at-risk or
   human-judgment-flagged candidate requires `requiresHumanJudgment`, which the
   executor stamps from the constraints rather than accepting from the model;
   `committedAtRiskCandidateIds` records exactly which ones, queryably.
5. **The cycle cannot be all-acquisition in silence.** If every committed
   manipulation reads an acquisition- or engagement-side primary metric with
   nothing defending retention, satisfaction, or returning viewers, the safeguards
   must name that exposure (`PORTFOLIO_METRIC_GAMING_UNGUARDED`).

Doctrine is also preserved in the positive direction: **a cycle that commits
nothing is a valid, `portfolioReady` outcome.** There is no throughput target.

## Provenance

```
PORTFOLIO
  -> allocation item (candidateId)
    -> candidate projection (experimentRunId, viewerValueContractHash)
      -> VIDEO_EXPERIMENT run
        -> VIDEO_DECISION -> VIDEO_DIAGNOSIS -> VIDEO_PERFORMANCE -> VIDEO_RELEASE
          -> ... -> CHANNEL_RESEARCH
```

Each candidate carries an eleven-artifact identity chain (the ten the Experiment
scope already proved, plus the Experiment itself), re-hashed **and** re-checked
for supersession by the resolver rather than trusted. `viewerValueContractHash`
is the originating Viewer Value contract, so promise drift anywhere upstream
remains detectable rather than assumed away.

The upstream reference is a **flat** Decision summary rather than the nested
sibling chain: six copies of a ten-deep reference exceed the database's 64 KiB
step-output ceiling on their own, and nothing is lost — identity and hashes are on
the summary, run-by-run lineage on the candidate, and every chain hash in the
artifact list.

## Lifecycle, idempotency and concurrency

Seven steps, no automated revision:

```
validate-approved-experiments -> derive-portfolio-constraints -> draft-video-portfolio
  -> critique-video-portfolio -> final-video-portfolio-qa -> finalize-video-portfolio
  -> review-video-portfolio (human approval)
```

- **Idempotency** — the shared `start_workflow` advisory lock plus idempotency
  key; a replay returns the original run.
- **Concurrency** — `workflow_runs_active_video_portfolio_uniq` allows one active
  allocation per owner per normalised cycle key. Two concurrent allocations of one
  cycle would each claim the same finite capacity, which is the double-spend this
  workflow exists to prevent. Different cycles proceed in parallel.
- **Supersession** — approved allocations are immutable; a human-requested
  revision creates a successor run carrying `previousRunId`.
- **Retry** — a retried step re-resolves every candidate and re-checks the
  persisted references by canonical equality, so an upstream that was superseded
  mid-run fails the run rather than silently allocating stale state.

## Accounting

Zero external retrieval, 2 synthesis / 2 QA / 0 revision / 0 automated revisions —
the same tight ceilings Diagnosis, Decision and Experiment use. No database
ceiling is widened by this slice.

## Errors

`UPSTREAM_EXPERIMENT_*` (not final / superseded / not approved / QA invalid /
provenance invalid / integrity mismatch / lineage invalid / not portfolio
eligible) map to `UPSTREAM_EXPERIMENT_INVALID` (409).
`VIDEO_PORTFOLIO_LIMIT_REACHED` is 429. `VIDEO_PORTFOLIO_QA_REJECTED` and
`VIDEO_PORTFOLIO_RESOURCE_BUDGET_EXHAUSTED` are terminal, non-retryable worker
failures. Cross-owner access is `NOT_FOUND`, never `FORBIDDEN`.

## Known limitations

- The prose detectors (fabricated quantity, forecast, causal certainty, scope
  leakage, growth-only argument) are **bounded deterministic patterns**, not
  general NLP. A determined novel paraphrase could evade a specific pattern. The
  hard guarantees are the structured, server-stamped fields: the closed selection
  vocabulary with no growth member, `justifiedByPredictedGrowthAlone`, the
  disposition/basis legality map, the Viewer Value state map, the capacity cap,
  the collision groups, and the derived counts, escalation and readiness.
- Portfolio records what a cycle *committed to*. It does not track what
  subsequently happened; experiment execution, outcome capture and cycle
  retrospectives are not implemented and are not in this contract.
