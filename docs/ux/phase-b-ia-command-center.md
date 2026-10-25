# Phase B UX: Information Architecture and Channel Command Center

Status: **direction approved by the owner (2026-10-25)**, with the refinements recorded in section 0.
This document changes no production code, migrations, auth, or schema. The first implementation slice
(section 8) is a separate branch and PR.

Prototypes (private until shared):
- **Approved visual direction, "Studio screens":** https://claude.ai/artifact/9c8FQHeRstn8ZNzNcY7B7a
  (Command Center, Video workspace at Script v2, Approvals with all five states, phone triage, first run,
  section states).
- Superseded exploration (IA map, low-fi wireframe, light-theme hi-fi): https://claude.ai/artifact/YQxxXLUYp3Ku5LmZu91nVD.
  Its IA map and wireframe still hold; its light visual direction is replaced by section 4.

Doctrine loop strengthened: **Next Decision**, with Measurement and Learning made visible enough to compete
with Production for the operator's attention.

---

## 0. Owner decisions (2026-10-25)

| # | Decision | Refinement now binding |
|---|---|---|
| Q1 | Three-layer IA approved. Approvals is the single primary global destination. Activity and Account & Usage are utilities. | None. |
| Q2 | "Close learning loops before opening new ones" approved as a guiding principle. | Learning work is prioritized only when it is **eligible and actionable**. Measurement windows, urgency, blockers and pending approvals all count. Performance entry is **never** an unconditional priority over a script approval. Section 3 has the rules. |
| Q3 | Derived Channel/Video read-model approved for launch. | Lineage is authoritative. Ambiguity is shown explicitly ("unattributed"), and no relationship is inferred that approved references do not prove. |
| Q4 | Legacy fixture experiences are preserved as isolated demonstrations. | Fixture data never mixes with production. Nothing is retired without verified parity. |
| Q5 | Monetization stays inside Strategy. | It gets its own navigation only when dedicated monetization workflows exist. |
| Visual | The Studios homepage identity is approved for the app. | Workspace screens use its surfaces and type, not its cinematic perspective or atmosphere. The two readability adjustments are approved (section 4). |

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
utilities on equal footing with Approvals. Approved instead (Q1): one primary global destination (Approvals),
two utilities, and a switcher in place of a "Channels" page until there are multiple channels.

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
"All workflows" until each workspace has a new home with parity tests. Fixture-mode legacy screens stay as isolated
demonstrations (Q4). They are not merged with production data and are not retired without verified parity.

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

Principle (Q2): close learning loops before opening new ones, **when the learning work is eligible and
actionable**. The card is advice. It never starts or decides anything, and every other action stays reachable.
Implemented in `src/features/command-center/next-decision.ts` (section 8).

**Eligibility comes first.** An item is never ranked when:
- lineage does not attribute it to this channel (Q3). It is listed as unattributed;
- the product has no screen to act on it (today: Diagnosis, Decision, Experiment, Portfolio, Intelligence, Concept validation);
- it is a measurement task with no due rule (D5), or its observation window is still open.

Each exclusion appears with its reason under "Why this, not something else?".

| Tier | What | Order inside the tier |
|---|---|---|
| P0 Recover | A failed or blocked run that needs a human | Oldest first |
| P1 Decide | Pending approval gates. They block the pipeline. | Learning gates → measurement escalated past `ESCALATE_AFTER_DAYS` (default 7) → channel gates (Research, Strategy, Content plan) → video gates, most downstream first → oldest |
| P2 Close the loop | Eligible learning work that is due (record performance, start diagnosis or experiment) | Most overdue first |
| P3 Produce | Brief a topic from the approved content plan | Oldest first |
| P4 Foundation | No approved strategy | — |

What this means in practice:
- A pending Script approval outranks entering performance until that measurement is 7 days overdue. It is
  never outranked unconditionally.
- A pending learning gate (for example Performance) outranks production gates, because it is a decision
  that blocks learning.
- If pending approvals fail to load, the card says its ranking may be incomplete.

### States

- **Loading:** section-shaped skeletons; identity band first. No full-page spinner.
- **First run (no research):** identity band becomes a three-step setup path (Research → Strategy → Plan),
  NBA is P5, other sections show what will appear there and why. Copy: "Earn the right to make a video first."
- **Empty sections:** say what fills them and what triggers it, never a blank box.
- **Partial failure:** each section fetches and fails independently with inline retry, "Nothing was changed",
  and a request ID. A Learning failure never blanks the Next Decision.
- **Stale:** while a run is QUEUED/RUNNING, its row shows "System" and the existing 4 s poll applies.

---

## 4. Visual direction (approved: Studios identity for workspaces)

The public Studios homepage sets the identity. Workspace screens take its materials, not its staging.

**Surfaces and type** (tokens from `src/features/studios/studios.css`, re-scoped as `--cw-*` in
`src/features/command-center/command-center.css`):
- Ground `void #050607`; sidebar `deep #0a0c10`; panels `deck #12151b`; hover `riser #1b1f27`.
- Text `lume #f2efe6`; secondary `#a9a7a0`; labels `#8d8b85`.
- Hairline borders only: `edge` (10% lume) and `edge-2` (18% lume). No shadows or cards stacked on cards.
- Space Grotesk for headings and artifact titles, Manrope for body, DM Mono for labels, IDs, versions and figures.

**Meaning of color**
- **Acid `#d8ff3e` means a decision is yours.** It is used for one primary CTA per screen, the Next Decision
  frame, the "your move" stage cell, the "You" waiting-on label, and the Approvals badge. An unknown count is
  neutral, never acid.
- **Orange `#ff6846` marks revision and recovery**: revision requested, failed or blocked runs, unattributed
  work, failed sections. Following the approved prototype, it also marks "Not supported" and "Below plan"
  outcomes.
- Mint `#91e6c1` marks pass outcomes (Supported, Above plan).
- Status is never color alone. Every state has a text label, and stage tracks carry an `aria-label` sentence.

**Script plates.** The artifact plate is how an exact artifact version is shown: one document object, additive,
with superseded material struck through rather than removed. Use plates in the Video workspace and the
Approvals detail view, where the version under decision must be unmistakable. Do not use them on summary
screens such as the Command Center.

**Approved readability adjustments**
1. Labels use solid `#8d8b85` instead of `lume-3` (40% lume), which fails contrast for text. Measured
   ≈5.4:1 on `deck`.
2. Mono labels go from 10.5px/.2em to 11px/.14em.

**Kept on the homepage only:** perspective, soundstage, grain, glow fields, scroll choreography. The workspace
hides the global grain overlay. Motion is limited to a skeleton pulse that respects `prefers-reduced-motion`.

---

## 5. Responsive and accessibility (this pass)

- Desktop-first, 1280–1440 primary. Sidebar + content in a wrapping flex row; at < 1024 the sidebar becomes a
  top bar with channel switcher + menu; at phone width a 4-item bottom bar (Home, Videos, Approvals, More).
  The first slice only stacks the sidebar above content below 760px. The top bar and bottom bar are follow-up work.
- Phone is a triage surface: read the NBA, open approvals, check state. Approval decisions on phone require
  opening the full artifact view; no swipe-to-approve.
- Wide tables scroll inside their own box; the page never scrolls horizontally.
- Landmarks: `nav` (Studio), `main`, one `h1` per page, each section `aria-labelledby` its `h2`.
  `aria-current="page"` on the active nav item. The NBA disclosure is a native `<details>`.
- Targets ≥ 44 px; focus ring is a 2px acid outline, as in Studios; text ≥ 4.5:1.

---

## 6. Backend dependencies (unverified or unbuilt)

| ID | Capability | Needed for | Notes |
|---|---|---|---|
| D1 | **Channel grouping read-model**: group workflows by lineage root (one Research workflow and descendants) | Switcher, channel routes, sections A–D | Approved for launch (Q3). No new table. Membership comes only from resolved `approved<Upstream>Reference` chains. An item whose chain does not resolve is `ambiguous` and is shown as unattributed, never placed by name, timing or similarity. A second Research run on the same niche is a second channel until the owner decides otherwise. |
| D2 | Channel display label | Switcher, identity band | Only `niche` / `channelConcept` exist (F9). Needs either a label field or an agreed derivation. |
| D3 | **Video grouping read-model**: group Brief workflow and its descendants | Videos, section D, stage tracks, routes | Requires `input_payload` references, which the list endpoint does not return (F6). Same attribution rule as D1. |
| D4 | NBA rule evaluation | Section B | Pure function over D1/D3 state; can be client-side first, server-side later. |
| D5 | "Measurement due" trigger | P1 rule, section D | VERIFIED: Release binds KPIs to hypotheses (`202608180003_video_release_kpi_scope.sql`), but the observation window is supplied by the operator at Performance entry. No release-side due date exists, so "due" needs a product rule (e.g. N days after release approval). The mock's "14-day window" assumes one. |
| D6 | Usage API | Account & Usage | Budgets readable in DB (F11); no route. |
| D7 | YouTube Analytics ingestion | Automatic performance | Not built. Design assumes manual entry and says so in the UI. |
| D8 | UIs for Diagnosis, Decision, Experiment, Portfolio, Intelligence | Learning, section E | Backends exist (F3). |

---

## 7. Decisions that still need the owner

1. **Measurement-due rule (D5).** No rule says when performance entry is due. The release binds KPIs but has
   no window. Until one exists, measurement is never ranked. Proposal: due at release approval + the
   strategy KPI framework's observation window, or else a fixed 14 days.
2. **Escalation threshold.** Overdue measurement outranks production gates after `ESCALATE_AFTER_DAYS = 7`.
   Confirm or change it.
3. **Channel label (D2).** Today it can only be the research niche or concept text. Keep that for launch, or
   plan a user-editable name? A persisted name needs a migration, which is out of scope here.
4. **Duplicate research roots (D1).** Two Research workflows on the same niche become two channels. Accept that
   for launch, or require an explicit operator merge later?
5. **Preview exposure.** `/studio/preview` exists only in fixture mode (local and dev). Should reviewers see it
   on deployed previews? That needs an explicit flag, and fixture data would then appear on a deployed host.

## 8. First implementation slice: navigation shell + Command Center (fixtures)

Branch `claude/phase-b-command-center-slice`, separate PR. Do not merge or deploy without owner sign-off.

**What it is.** `/studio/preview` renders the Phase B shell and the Command Center from typed fixtures, in the
approved Studios workspace identity. It has three scenarios: `?scenario=operating | first-run | degraded`.

**Isolation (Q4).** The route calls `notFound()` unless `isMockMode()` is true. That is always false when
`NODE_ENV=production`. It still requires a signed-in user and reads no workflow, approval or usage data.
`/studio` and every existing workspace are untouched.

**Files**
| File | Role |
|---|---|
| `src/features/command-center/model.ts` | View-model contract: `SectionState` (loading, ready, empty, unavailable, error), `Attribution`, `SurfaceAvailability`, gates, videos, tasks, learning, performance. |
| `src/features/command-center/next-decision.ts` | Pure, deterministic ranking (section 3). `CURRENT_STUDIO_ANCHOR` maps actionable stages to today's `/studio` workspaces. |
| `src/features/command-center/fixtures.ts` | Three scenarios, including an unattributed video and gate, a gate with no screen, a measurement task with no due rule, and a failed run. |
| `src/features/command-center/app-shell.tsx` | Sidebar: channel block, channel nav, Approvals, utilities. Unbuilt destinations are labelled "Later" and are never dead links. |
| `src/features/command-center/command-center.tsx` | Identity band, Next Decision, Needs your decision, unattributed notice, Videos in flight, Learning, Performance. |
| `src/features/command-center/command-center.css` | Workspace tokens and styles scoped under `.cw-app`. |
| `src/app/studio/preview/page.tsx` | Fixture-only route. |

**Explicit unavailable states in the slice:** gates with no review screen say "No review screen yet";
measurement with no due rule is "Not ranked" with its reason; Learning can render "Not available yet · D3 · D8";
unattributed work is counted and explained; failed sections show a request ID and Retry; an unknown Approvals
count is a neutral "—".

**Tests:** 10 ranking tests, 10 render and accessibility tests, a CSS coverage check, and 3 access tests
(the route is absent in production, requires a user, and falls back safely on unknown scenario keys).

**Not in this slice, by instruction:** migrations, auth or entitlement changes, the lineage read-model and APIs
(D1/D3), Approvals, Video workspace, Strategy/Plan/Learning destinations, the phone top bar and bottom bar.

**Next step to go live:** build the D1/D3 read-model server-side over existing `workflow_runs.input_payload`
references, so it returns this same `CommandCenterView` shape. Then add a live route beside `/studio/preview`.
The UI should need no change.
