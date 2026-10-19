# Phase B UX: Information Architecture and Channel Command Center

Status: **proposal for review**. Design exploration only; no production code, migrations, auth, or schema changes.
Scope of this pass: information architecture and the Channel Command Center. Video workspace, Approvals,
Learning, and the full design system follow after review.

Visual companion (IA map, low-fi wireframe, hi-fi direction with Operating / First run / Section error
states, phone layout): https://claude.ai/artifact/YQxxXLUYp3Ku5LmZu91nVD (private until shared).

Doctrine loop strengthened: **Next Decision**, with Measurement and Learning made visible enough to compete
with Production for the operator's attention.

---

## 1. What the codebase actually supports (grounding)

| # | Fact | Status | Source |
|---|------|--------|--------|
| F1 | 14 workflow types exist on the production spine (Concept Validation through Video Intelligence). | VERIFIED | `src/domain/production-workflows.ts:4` |
| F2 | Production-mode Studio is one long page of 8 stacked workspaces: Research, Strategy, Content plan, Brief, Script, Packaging, Release, Performance. | VERIFIED | `src/features/studio/studio-app.tsx` (`PRODUCTION_STAGES`) |
| F3 | Concept Validation, Diagnosis, Decision, Experiment, Portfolio and Intelligence have backends and approval gates but **no UI workspace**. | VERIFIED | `src/features/studio/` file list |
| F4 | `workflows.channel_id` exists but `start_workflow` never writes it. Production work has **no Channel or Video entity**. | VERIFIED | `202608130001_production_workflow_engine.sql:6`, `202609080001_video_intelligence.sql:723` |
| F5 | Work is linked by approved-artifact lineage: each run's `input_payload` carries an `approved<Upstream>Reference` resolved server-side. | VERIFIED | `docs/data-model.md`, resolver RPCs |
| F6 | The workflow list endpoint returns `workflows`, `runs` (no `input_payload`), and a cross-workflow `pendingApprovals` list. | VERIFIED | `src/features/studio/workflow-api.ts` (`WorkflowList`) |
| F7 | Approval statuses are `PENDING / APPROVED / REJECTED / REVISION_REQUESTED`. "Superseded" is not stored; it is a run that is no longer its workflow's `current_run_id`. | VERIFIED | `production-workflows.ts:10`, `workflow-api.ts` (`currentRunOf`, `runVersionOf`) |
| F8 | Performance metrics are **operator-entered**. There is no YouTube Analytics integration. | VERIFIED | `video-performance-workspace.tsx` (`METRIC_FIELDS`); no analytics scopes in `src/` |
| F9 | Research input has `niche` / `channelConcept` but **no channel name or YouTube handle**. | VERIFIED | `channelResearchInputSchema` |
| F10 | Approved strategy carries `monetizationArchitecture` (paths, labels, rationale). A read-only monetization view can be sourced from it. | VERIFIED | `production-workflows.ts:259` |
| F11 | Research usage budgets are owner-readable in the DB; no API route exposes them to the UI. | VERIFIED (DB) / NOT BUILT (API) | `202608130004_research_usage_accounting.sql`, `src/app/api` |
| F12 | Fixture mode renders a separate legacy model (channels, video projects, builds, monetization plans). | VERIFIED | `studio-app.tsx` |

The Engineering proposals (four global destinations, channel workspaces, lineage, unified learning,
deterministic Next Best Action, read-only monetization) are treated as proposals, not facts.

---

## 2. Information architecture

### Three layers

1. **Account**: work that crosses channels.
2. **Channel business**: everything else, ordered by the business loop.
3. **Video**: an asset and experiment inside its channel. Never a top-level object.

### Global (account) layer

| Destination | Placement | Rationale |
|---|---|---|
| Channel switcher | Top of sidebar | "All channels" overview becomes a page only at 2+ channels. With one channel, sign-in lands in its Command Center. |
| **Approvals** | Primary nav, badge count | The one cross-channel job that needs daily attention. Data exists today (F6). |
| Activity | Sidebar footer utility | Audit ledger. High value, low frequency. Filterable by channel and video. |
| Account & Usage | Sidebar footer utility | Budgets, spend, plan. Depends on D6. |

**Where this departs from the Engineering proposal.** Four peer global destinations put two low-frequency
utilities on equal footing with Approvals. I recommend one primary global destination (Approvals), two
utilities, and a switcher instead of a "Channels" page until multi-channel exists.

### Channel layer (sidebar, in loop order)

| Destination | Loop steps | Contains |
|---|---|---|
| **Command Center** | Next decision | Channel home (section 3). |
| **Strategy** | Opportunity, Validation, Strategy, Monetization | Evidence (Research, UI today), Concept validation (backend only), Strategy + version history (UI today), Monetization read-only from `monetizationArchitecture`, Strategy review signals (backend only). |
| **Content plan** | Next decision → Production | Backlog topics (Content Intelligence, UI today). The only door into production, so every video carries a stated reason to exist. |
| **Videos** | Production, Distribution, Measurement | All videos by stage and state. Opens the Video workspace. |
| **Learning** | Learning, Next decision | Experiments in flight, Portfolio allocation, Channel intelligence records (all backend only). |

Monetization sits under Strategy rather than as its own item because it is read-only at launch and the
doctrine treats it as part of strategy. Promote it when monetization has its own workflows.

### Video layer (workspace stage rail)

`MAKE: 01 Brief · 02 Script · 03 Packaging · 04 Release` | `LEARN: 05 Performance · 06 Diagnosis · 07 Decision · 08 Experiment`

Breadcrumb always reads `Channel › Video › Stage › vN`. Detailed in the next pass.

### Workflow → destination map (nothing is dropped)

| Workflow | Destination | UI today |
|---|---|---|
| CHANNEL_CONCEPT_VALIDATION | Strategy › Validation | No (production) |
| CHANNEL_RESEARCH | Strategy › Evidence | Yes |
| CHANNEL_STRATEGY | Strategy | Yes |
| CHANNEL_CONTENT_INTELLIGENCE | Content plan | Yes |
| CHANNEL_VIDEO_BRIEF / SCRIPT / PACKAGING / RELEASE | Video › 01–04 | Yes |
| CHANNEL_VIDEO_PERFORMANCE | Video › 05 | Yes |
| CHANNEL_VIDEO_DIAGNOSIS / DECISION / EXPERIMENT | Video › 06–08, rolled up in Learning | No |
| CHANNEL_VIDEO_PORTFOLIO | Learning › Portfolio | No |
| CHANNEL_VIDEO_INTELLIGENCE | Learning › Channel intelligence; signal surfaces on Command Center and Strategy | No |

**Migration guarantee.** The eight existing workspace components take `initial: WorkflowList` and are
self-contained, so they can be re-hosted inside new destinations unchanged. `/studio` stays reachable as
"All workflows" until each workspace has a new home with parity tests. Fixture-mode legacy screens are out of
scope for this IA and need an explicit keep/retire decision (open question Q4).

### Proposed routes (for discussion, not implementation)

```
/studio                         → redirect to last channel's Command Center (or setup)
/c/:channelKey                  → Command Center
/c/:channelKey/strategy[/…]
/c/:channelKey/plan
/c/:channelKey/videos
/c/:channelKey/videos/:videoKey/:stage[?run=:runId]
/c/:channelKey/learning[/…]
/approvals
/activity
/account
/studio/all                     → today's stacked workspaces, until retired
```

`channelKey` and `videoKey` are derived keys (D1, D3), not new entities.

---

## 3. Channel Command Center

Not a dashboard. It answers four questions in priority order, and the layout order **is** the priority
order on every viewport:

1. **What should I do now?** Next Decision + Needs your decision.
2. **Where is everything?** Videos in flight.
3. **What is it teaching us?** What we are learning + Recent performance.
4. **Who is this channel?** Identity band (top, compact, reference only).

### Sections

| Section | Content | Data source | Status |
|---|---|---|---|
| A. Identity band | Channel label, thesis, pillars, Strategy vN + approval date, audience, revenue-path count, last strategy review outcome | Approved strategy output; research niche for the label | DEPENDS D1, D2 |
| B. Next Decision | Exactly one action, its rule, plain-language reason, evidence links, primary CTA, "Why this, not something else?" disclosure listing what else is waiting | NBA rules over derived state | DEPENDS D4 |
| C. Needs your decision | Pending gates in this channel: artifact type + version (+ "supersedes vN"), video, age, revision note. Links into the artifact, never approves inline. | `pendingApprovals` (F6) + lineage | Data exists; grouping DEPENDS D1 |
| D. Videos in flight | One row per video: title, MAKE · LEARN stage track (8 cells), state, waiting on (You / System / window date), age. Rows, not kanban: 8 columns of kanban do not fit and hide the learn half. | Derived video lineage | DEPENDS D3 |
| E. What we are learning | Hypothesis verdicts, running experiments with observation window, channel lessons with adoption stance, open strategy review signal (or last outcome, including HOLD) | Performance / Experiment / Intelligence outputs | Backend outputs exist; UI not built |
| F. Recent performance | Small table: video, views, avg % viewed, verdict vs plan. Labelled "Entered by you · YouTube not connected". No charts until 3+ snapshots per video exist. | Performance outputs (F8) | Data exists |

### Next Decision rules (deterministic, explainable)

Principle: **close loops before opening new ones.** A video further along the loop outranks one earlier in it.
This encodes the doctrine's "learning over volume" without blocking the user: the NBA is advice, and every
other action stays reachable.

| Priority | Condition | Example action |
|---|---|---|
| P0 Recover | A run in this channel is FAILED or BLOCKED and needs a human | "Resolve failed Script run" |
| P1 Close the loop | Learning-side gate pending (Performance, Diagnosis, Decision, Experiment, Portfolio, Intelligence); measurement window elapsed with no snapshot; strategy review signal awaiting decision | "Record performance for …" |
| P2 Unblock production | Production gate pending (Release > Packaging > Script > Brief, most downstream first) | "Review Script v2 for …" |
| P3 Start learning | Performance recorded but no Diagnosis; Decision recommends an experiment not yet started | "Diagnose …" |
| P4 Produce | Approved plan has an un-briefed topic, and nothing in P0–P3 | "Start a brief for topic #4" |
| P5 Foundation | No approved strategy or plan | "Research a channel opportunity" |

Ties break by age (oldest first). The card always shows the rule that fired and how many items were deferred.
It never starts a workflow on its own.

### States

- **Loading:** section-shaped skeletons; identity band first. No full-page spinner.
- **First run (no research):** identity band becomes a three-step setup path (Research → Strategy → Plan),
  NBA is P5, other sections show what will appear there and why. Copy: "Earn the right to make a video first."
- **Empty sections:** say what fills them and what triggers it, never a blank box.
- **Partial failure:** each section fetches and fails independently with inline retry, "Nothing was changed",
  and a request ID. A Learning failure never blanks the Next Decision.
- **Stale:** while a run is QUEUED/RUNNING, its row shows "System" and the existing 4 s poll applies.

---

## 4. High-fidelity direction (this pass)

Keep the shipped tokens (`globals.css`) and fonts; change how intensely they are used in the operator app.

- **Keep:** paper `#f2efe6`, ink `#121310`, acid `#d8ff3e`, mint `#91e6c1`, orange `#ff6846`; Space Grotesk
  (headings), Manrope (body), DM Mono (IDs, versions, eyebrows, metric figures); 4 px radius.
- **Add:** surface `#fbf9f3` for panels; muted text `#5f615a` (≈5:1 on paper); orange text `#a8361a` because
  `#ff6846` fails as text on paper. Orange stays a fill with ink text.
- **Acid means "your move".** One acid moment per screen (the NBA offset shadow and CTA), plus the
  "your move" stage cell and approval badge. Never decorative.
- **Drop for the app:** landing-page grain, giant display type, offset-shadow hover on every button. Those
  suit marketing, not an 8-hour work surface. The offset shadow is reserved for the NBA card.
- Status is never color alone: every state has a text label; stage tracks have an `aria-label` sentence.
- No charts on the Command Center in this phase.

---

## 5. Responsive and accessibility (this pass)

- Desktop-first, 1280–1440 primary. Sidebar + content in a wrapping flex row; at < 1024 the sidebar becomes a
  top bar with channel switcher + menu; at phone width a 4-item bottom bar (Home, Videos, Approvals, More).
- Phone is a triage surface: read the NBA, open approvals, check state. Approval decisions on phone require
  opening the full artifact view; no swipe-to-approve.
- Wide tables scroll inside their own box; the page never scrolls horizontally.
- Landmarks: `nav` (Studio), `main`, one `h1` per page, each section `aria-labelledby` its `h2`.
  `aria-current="page"` on the active nav item; `aria-expanded` on the NBA disclosure.
- Targets ≥ 44 px; focus ring stays the existing 3 px orange outline; text ≥ 4.5:1.

---

## 6. Backend dependencies (unverified or unbuilt)

| ID | Capability | Needed for | Notes |
|---|---|---|---|
| D1 | **Channel grouping read-model**: group workflows by lineage root (one Research workflow and descendants) | Switcher, channel routes, sections A–D | No new table required. A second Research run on the same niche would appear as a second channel; a persisted Channel entity is the real fix and is an Engineering decision, not assumed here. |
| D2 | Channel display label | Switcher, identity band | Only `niche` / `channelConcept` exist (F9). Needs either a label field or an agreed derivation. |
| D3 | **Video grouping read-model**: group Brief workflow and its descendants | Videos, section D, stage tracks, routes | Requires `input_payload` references, which the list endpoint does not return (F6). |
| D4 | NBA rule evaluation | Section B | Pure function over D1/D3 state; can be client-side first, server-side later. |
| D5 | "Measurement due" trigger | P1 rule, section D | VERIFIED: Release binds KPIs to hypotheses (`202608180003_video_release_kpi_scope.sql`), but the observation window is supplied by the operator at Performance entry. No release-side due date exists, so "due" needs a product rule (e.g. N days after release approval). The mock's "14-day window" assumes one. |
| D6 | Usage API | Account & Usage | Budgets readable in DB (F11); no route. |
| D7 | YouTube Analytics ingestion | Automatic performance | Not built. Design assumes manual entry and says so in the UI. |
| D8 | UIs for Diagnosis, Decision, Experiment, Portfolio, Intelligence | Learning, section E | Backends exist (F3). |

---

## 7. Open questions for review

- **Q1.** Accept one primary global destination (Approvals) with Activity and Account as utilities, instead of four peers?
- **Q2.** Accept "close loops before opening new ones" as the NBA ordering principle? It deliberately ranks
  entering performance above approving a new script.
- **Q3.** Derived channel/video read-model (D1, D3) for launch, or wait for persisted entities?
- **Q4.** Fixture-mode legacy screens (concept selection, reference channel, builds, monetization review):
  keep as a demo path, re-home, or retire?
- **Q5.** Should Monetization stay under Strategy at launch (recommended) or be a sixth channel item?

## Next pass (after review)

Video workspace, Approvals (pending / approved / rejected / revision requested / superseded), Learning flow
(Performance → Diagnosis → Decision → Experiment → channel intelligence), screen inventory, component
inventory, and the engineering handoff.
