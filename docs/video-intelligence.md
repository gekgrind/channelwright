# CHANNEL_VIDEO_INTELLIGENCE

The channel-level meta-learning link above `CHANNEL_VIDEO_PORTFOLIO`, and the
twelfth paid workflow on the production spine.

## Why it exists

Portfolio produces a single allocation of record for a single cycle. Nothing in
the system asks what the channel has actually **learned** across several such
cycles, or whether the strategy those cycles ran under still holds — and both
Experiment and Portfolio are deterministically forbidden from asking it.

It answers one business question: *across this horizon of completed cycles, what
does this channel now know, what does it still not know, and does the anchored
strategy need reviewing?*

Against the Channelwright loop it strengthens **Measurement → Learning → Next
Decision**: it is where accumulated per-cycle allocation history becomes durable
channel knowledge without becoming a strategy rewrite.

## Contract

**Recovered, not invented.** Two shipped verticals already named this workflow
and enumerated what it owns:

- `src/server/workflows/video-experiment-validation.ts:1158` —
  `INTELLIGENCE_RESPONSIBILITY_LEAKED`: "channel-wide strategy / meta-learning
  work reserved for CHANNEL_VIDEO_INTELLIGENCE". Its `INTELLIGENCE_LEAKED`
  pattern matches channel strategy, strategic pivots, channel-wide
  learning/pattern/insight/takeaway, "meta-analysis of all|every", and "across
  the entire channel history".
- `src/server/workflows/video-portfolio-validation.ts:294` — the same rule code,
  additionally matching rewriting/revising channel strategy or positioning and
  redefining the audience, niche, or pillars.
- `docs/video-portfolio.md` — Portfolio does not own "channel strategy (a future
  Intelligence vertical)".

The repository's own name for the vertical is `CHANNEL_VIDEO_INTELLIGENCE`, from
those two error messages; that name is used here rather than a new one.

### Owns

1. Cross-cycle pattern synthesis over two to four approved allocation records
   sharing one strategy anchor.
2. The channel-level Viewer Value trajectory across those cycles.
3. The **strategy review signal**: whether the anchored `CHANNEL_STRATEGY`
   warrants review, and precisely which of its elements the accumulated evidence
   contradicts.
4. Naming what the channel still cannot answer.

### Does not own

Authoring strategy — positioning, audience, niche, pillars, promise, thesis,
objectives, KPI framework (`CHANNEL_STRATEGY`); a topic backlog or next-video
recommendation (`CHANNEL_CONTENT_INTELLIGENCE`); market, competitor or
search-demand conclusions (`CHANNEL_RESEARCH`); capacity allocation, commit /
defer / rank / sequence (`CHANNEL_VIDEO_PORTFOLIO`); experiment redesign
(`CHANNEL_VIDEO_EXPERIMENT`); re-deciding or re-diagnosing (`CHANNEL_VIDEO_DECISION`,
`CHANNEL_VIDEO_DIAGNOSIS`); rewriting analytics evidence
(`CHANNEL_VIDEO_PERFORMANCE`); production content (`BRIEF` / `SCRIPT` /
`PACKAGING` / `RELEASE`); and any execution whatsoever — publish, upload,
schedule, notification, ad spend, provider call, or starting another workflow.

### Distinction from CHANNEL_CONTENT_INTELLIGENCE

The two are not variants of each other and neither supersedes the other. No
migration plan in this repository asks for `CONTENT_INTELLIGENCE` to be renamed
or removed, and nothing here does so.

| | `CHANNEL_CONTENT_INTELLIGENCE` | `CHANNEL_VIDEO_INTELLIGENCE` |
| --- | --- | --- |
| Direction | Prospective | Retrospective |
| Position | Third workflow, pre-production | Twelfth workflow, above Portfolio |
| Input | One approved `CHANNEL_STRATEGY` | 2–4 approved `CHANNEL_VIDEO_PORTFOLIO` cycles sharing one strategy anchor |
| Evidence | Live YouTube discovery retrieval | Zero retrieval; only immutable prior artifacts |
| Output | Topic backlog + one next-video recommendation | Channel learning record + strategy review signal |
| Answers | "What should this channel make next?" | "What has this channel learned, and does the strategy still hold?" |

Deterministic QA enforces the boundary in both directions: `CONTENT_BACKLOG_LEAKED`
rejects an Intelligence record that proposes topics, and Content Intelligence's
own downstream-scope rules already reject the reverse.

### Inputs

| Field | Source | Notes |
| --- | --- | --- |
| `horizonLabel` | operator | Names the learning horizon; normalised to `intelligenceHorizonKey` for concurrency |
| `portfolioSelections` | operator | 2–4 exact `{portfolioWorkflowId, portfolioRunId}` pairs |

Two is the floor because a pattern seen in one cycle is not channel-level
learning; four is the ceiling the payload budget is sized for. Each selection is
resolved **pre-spend** by `resolve_approved_video_portfolio_artifact`, which is
the sole authority for upstream identity and eligibility. One ineligible cycle
fails the whole start.

### Output

A single human-approved, immutable **channel learning record**
(`channelVideoIntelligenceResultSchema`): the learnings, the strategy review
signal, the open questions, server-stamped Viewer Value safeguards, a rejected
alternative reading, and `intelligenceReady`.

## The two structural safety properties

### 1. The learning model never sees an allocation's prose body

The database resolver projects each approved allocation down to
`intelligenceCycleSchema`: closed-vocabulary scalars (counts, slots, capacity
utilisation, confidence ceiling, escalation, at-risk counts) plus a
`commitments` array that is itself pure closed-vocabulary classification
(experiment type, diagnosis category, treatment mechanism, primary metric and
direction, selection basis, Viewer Value disposition and state, promise
integrity risk, decision type, pillar). Rationales, objectives, allocation
hypotheses, sequencing notes, guardrail prose, revisit conditions, alternatives —
and even the 200-character experiment titles Portfolio's own candidate
projection carried — are never projected.

An Intelligence run is therefore *structurally* incapable of restating,
weakening, or relitigating an approved allocation.

### 2. The single strategy anchor

Every candidate inside every selected allocation must resolve to one
`CHANNEL_STRATEGY` run, and every selected allocation must agree on it. Cycles
run under different strategies are not one channel's history, and a "channel-wide"
learning synthesized across them would be comparing two different strategic bets.

The anchor is enforced in three places: inside one allocation by the resolver
(`UPSTREAM_PORTFOLIO_STRATEGY_ANCHOR_MISMATCH`), across selections by
`start_workflow`, and again at the first worker step by the TypeScript resolver —
because a strategy successor could land between start and claim.

It is also what the strategy review signal points at: without a single anchor
there is nothing coherent for "this strategy is contradicted" to mean.

## Domain model

- **`intelligenceCycle`** — the bounded server projection of one approved,
  intelligence-eligible allocation. `cycleId` is derived server-side as
  `cycle:<portfolioRunId>`; the model never chooses it.
- **`videoIntelligenceConstraints`** — server-derived: the cycle set, the
  chronology (by immutable `allocatedAt`), the at-risk cycle list, the observed
  categories / treatment mechanisms / pillars, the total committed count, the
  Viewer Value trajectory, escalation, and the evidence ceiling (the *lowest*
  per-cycle confidence ceiling).
- **`channelLearning`** — one lesson: a closed-vocabulary `patternClass`, the
  statement and evidence basis, **at least two** supporting cycle ids, any
  contradicting cycles, confidence, a `viewerValueImplication`, an
  `adoptionStance`, the honest `justifiedByAudienceGrowthAlone` declaration, and
  what would falsify it.
- **`strategyReviewSignal`** — the channel-level conclusion. `humanDecisionRequired`
  and `revisionAuthoredElsewhere` are literal `true`, so the contract itself
  cannot express "and here is the new strategy" or "and I have started the
  revision".

### Viewer Value trajectory

Split the chronology in half and compare at-risk commitment *rates*. A channel
committing proportionally more at-risk work later in the horizon is
`DETERIORATING`. A horizon that committed nothing carries no signal and says
`INSUFFICIENT_SIGNAL` rather than claiming stability. This is a structural
property of the cycle projections, not a model judgement.

## Viewer Value protections

The channel-level failure mode is *a channel that observes "this degrades the
viewer experience but the numbers went up" and encodes it as durable channel
practice*. Seven deterministic protections make that structurally unavailable:

1. **Growth is not a member of the pattern vocabulary.**
   `intelligencePatternClassSchema` has no growth/upside/ROI/reach option. A
   channel lesson must be about evidence, uncertainty, viewer response,
   capability, or measurement quality. A growth pattern class fails Zod parsing
   and is terminal in the worker rather than becoming a QA finding.
2. **A viewer-degrading lesson can never be adopted, or even held provisionally.**
   `IMPLICATION_PERMITTED_ADOPTION_STANCES` admits only `REJECT_AS_HARMFUL` and
   `REQUIRES_MORE_EVIDENCE` for `DEGRADES_VIEWER_EXPERIENCE`
   (`HARMFUL_PRACTICE_ADOPTED`). An `UNKNOWN_REQUIRES_EVIDENCE` implication is
   never silently upgraded to channel practice either.
3. **Growth-only lessons are structurally weak.** A learning declaring
   `justifiedByAudienceGrowthAlone` cannot be held with high confidence
   (`GROWTH_ONLY_LEARNING_HIGH_CONFIDENCE`), cannot become channel practice
   (`GROWTH_ONLY_LEARNING_ADOPTED`), and cannot support a strategy review
   recommendation (`GROWTH_ONLY_STRATEGY_SIGNAL`). A rationale arguing purely
   from growth while denying it is caught by `GROWTH_ONLY_ARGUMENT_UNDECLARED`.
4. **A recurring Viewer Value risk cannot be recorded as neutral**
   (`VIEWER_VALUE_IMPLICATION_CONTRADICTS_PATTERN`).
5. **A deteriorating trajectory forces escalation.** The executor stamps
   `requiresHumanJudgment` from the constraints rather than accepting it from the
   model (`DETERIORATING_TREND_NOT_ESCALATED`), and the exposure must be named in
   `metricGamingRisk` rather than left implicit (`DETERIORATING_TREND_UNGUARDED`).
6. **No lesson may outrun its evidence.** Confidence is capped at the horizon's
   weakest cycle (`CONFIDENCE_EXCEEDS_EVIDENCE_CEILING`), and a strategy review
   recommendation cannot rest on a low-confidence lesson
   (`REVISION_SIGNAL_WITHOUT_CROSS_CYCLE_EVIDENCE`).
7. **A lesson must be cross-cycle.** `supportingCycleIds` has a schema minimum of
   two, re-checked for *distinctness* by `LEARNING_NOT_CROSS_CYCLE`.

Doctrine is also preserved in the positive direction: **a horizon that concludes
`HOLD` or `INSUFFICIENT_EVIDENCE` is a valid, `intelligenceReady` outcome.** There
is no pressure to produce a strategic pivot.

## Provenance

```
INTELLIGENCE
  -> learning (supportingCycleIds >= 2)
    -> cycle projection (portfolioRunId, strategyRunId)
      -> VIDEO_PORTFOLIO run (artifact + provenance hash)
        -> [11-artifact candidate chains, pinned by portfolioProvenanceHash]
          -> CHANNEL_STRATEGY anchor  (re-hashed + supersession-checked)
          -> CHANNEL_RESEARCH anchor  (re-hashed + supersession-checked)
```

Each cycle carries a three-artifact identity chain: the two channel anchors plus
the allocation itself. The anchors are re-hashed **and** re-checked for
supersession by the resolver rather than trusted — a strategy that has since been
superseded must not silently anchor a strategy review signal. Portfolio's own
eleven-artifact per-candidate chains are not re-walked here; they are pinned by
`portfolioProvenanceHash`, which this resolver re-derives, and their presence and
arity are still asserted.

The upstream reference carries **flat** strategy and research anchors rather than
a nested chain: four cycles × six candidates × an eleven-deep reference would
exceed the database's 64 KiB step-output ceiling many times over.

## Lifecycle, idempotency and concurrency

Seven steps, no automated revision:

```
validate-approved-portfolios -> derive-intelligence-constraints -> draft-video-intelligence
  -> critique-video-intelligence -> final-video-intelligence-qa -> finalize-video-intelligence
  -> review-video-intelligence (human approval)
```

- **Idempotency** — the shared `start_workflow` advisory lock plus idempotency
  key; a replay returns the original run.
- **Concurrency** — `workflow_runs_active_video_intelligence_uniq` allows one
  active record per owner per normalised horizon key. Two concurrent records for
  one horizon would each become a competing durable statement of what the channel
  learned, and each could raise a different signal against the same strategy.
  Different horizons proceed in parallel.
- **Supersession** — approved records are immutable; a human-requested revision
  creates a successor run carrying `previousRunId`.
- **Retry** — a retried step re-resolves every cycle and re-checks the persisted
  references by canonical equality, so an upstream superseded mid-run fails the
  run rather than silently synthesizing stale history.

## Human judgment boundary

- `review-video-intelligence` is a mandatory approval gate, as on every sibling.
- `requiresHumanJudgment` is server-stamped true whenever the trajectory
  deteriorates, any cycle committed at-risk work or flagged human judgment, or any
  recorded learning carries a viewer-degrading implication.
- **`REVISE_RECOMMENDED` never starts anything.** It is a recommendation an
  operator acts on by starting a new `CHANNEL_STRATEGY` run themselves.
  `humanDecisionRequired` and `revisionAuthoredElsewhere` are literal `true` in
  the contract so this cannot drift.

## Downstream contract

Deliberately minimal, mirroring how Experiment reserved exactly two
downstream-facing contracts for Portfolio:

- **`intelligenceReady`** — the record met the structural bar.
- **`strategyReviewSignal.signal`** — `REVISE_RECOMMENDED` / `HOLD` /
  `INSUFFICIENT_EVIDENCE`, with `contradictedElements` naming the affected
  `strategyElementSchema` members.

The intended consumers are a human operator and, on their decision, a new
`CHANNEL_STRATEGY` run. Nothing is automated, and no workflow currently reads
these fields — the exact consumption shape is deliberately left to whatever
vertical claims it.

## Accounting

Zero external retrieval, 2 synthesis / 2 QA / 0 revision / 0 automated revisions —
the same tight ceilings Diagnosis, Decision, Experiment and Portfolio use. No
database ceiling is widened by this slice.

## Errors

`UPSTREAM_PORTFOLIO_*` (not final / superseded / not approved / QA invalid /
provenance invalid / integrity mismatch / lineage invalid / not intelligence
eligible / strategy anchor mismatch) map to `UPSTREAM_PORTFOLIO_INVALID` (409).
`VIDEO_INTELLIGENCE_LIMIT_REACHED` is 429. `VIDEO_INTELLIGENCE_QA_REJECTED`,
`VIDEO_INTELLIGENCE_STEP_OUTPUT_TOO_LARGE` and
`VIDEO_INTELLIGENCE_RESOURCE_BUDGET_EXHAUSTED` are terminal, non-retryable worker
failures. Cross-owner access is `NOT_FOUND`, never `FORBIDDEN`.

## Known limitations

- The prose detectors (fabricated quantity, forecast, causal certainty, the seven
  scope-leakage classes, growth-only argument) are **bounded deterministic
  patterns**, not general NLP. A determined novel paraphrase could evade a
  specific pattern. The hard guarantees are the structured, server-stamped
  fields: the closed pattern vocabulary with no growth member, the
  implication/stance legality map, `justifiedByAudienceGrowthAlone`, the
  two-cycle minimum, the evidence ceiling, the derived trajectory and escalation,
  the `literal(true)` signal fields, and the single strategy anchor.
- The Viewer Value trajectory is a **rate comparison over at-risk commitments**,
  not a measurement of viewer experience. It detects the channel committing more
  known-risky work over time; it cannot detect harm that no upstream Experiment
  ever flagged as at risk.
- Intelligence records what a horizon *learned*. It does not track whether the
  strategy review it signalled was ever acted on; strategy-revision linkage and
  horizon retrospectives are not implemented and are not in this contract.
