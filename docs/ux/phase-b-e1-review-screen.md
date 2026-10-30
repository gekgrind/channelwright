# Phase B · Engineering Sprint E1: shared ReviewScreen foundation

Status: implemented and reviewed (plan, reconciliation and review log below). Base: `origin/main` @ `a4ceb88`. Branch: `feat/phase-b-e1-review-screen`.

Business-loop position: every stage's **human approval gate** (Validation → … → Learning → Next Decision). The gate is
where AI-written work becomes a durable, human-owned decision, so it must never misreport what was recorded.

## 1. Audit: what actually exists

| Claim in the design handoffs | Repository truth (`a4ceb88`) |
|---|---|
| A shared `ReviewScreen` component | **Does not exist in application code.** It is the Claude Design prototype `Review.dc.html` (and forks `DecisionReview.dc.html`, `ExperimentReview.dc.html`) on the design canvas. Sprint 7 itself notes "the prototype is a fork of the shared ReviewScreen, not an import". |
| `.panel { display:flex }` overrides `.decide { display:none }` below 1280px, so Approve renders twice | **Prototype-only.** No `.panel`, `.decide`, or 1280px rule exists in `src/`. Production renders one decision control set per gate in the DOM and never toggles copies with CSS. The defect class must still be prevented structurally as the screens are built. |
| Performance, Diagnosis, Decision, Experiment review screens | Production review UI is `DecisionBar` (`src/features/studio/workflow-controls.tsx`), mounted inline by 8 stage workspaces on `/studio`: Research, Strategy, Content intelligence, Brief, Script, Packaging, Release, **Performance**. **No Diagnosis, Decision, or Experiment UI exists.** |
| Approve / Reject / Request revision confirmations | Approve: one click, no confirmation. Reject: inline `role="alertdialog"` panel (no focus trap, not modal). Request revision: one click once the note is non-empty; **no statement that it starts another paid AI run**. |
| Error handling | `requestJson` collapses every failure into `Error(message)`: HTTP status and code are lost; a fetch rejection shows the raw "Failed to fetch"; a non-JSON error body throws a `SyntaxError`. 409 `INVALID_TRANSITION` (decided elsewhere) is indistinguishable from a server fault. Errors render in a page-top banner, not next to the control. |
| Duplicate submission | Guarded by component state (`submitting`) only; the hook has no per-target in-flight guard. |
| Overview / list pages | Command Center (`/studio/preview`, fixture) and the run ledgers (`RunChips`) offer no decision controls; Command Center already has a test for this. |

Backend contract (unchanged by this sprint, verified in `202609080001_video_intelligence.sql:870-926`):
`decide_workflow_approval` → APPROVE completes the step/run; REJECT cancels approval, run and workflow;
REQUEST_REVISION (note 1–2000 chars, server-enforced) blocks the run and **queues a successor run that re-runs every
step of the workflow** for every type the RPC handles. For every kind this sprint mounts or registers (the 8 workspaces plus
Diagnosis, Decision and Experiment) that run makes model calls, i.e. another paid AI generation run; deterministic legacy concept
validation is not in scope. A non-pending approval raises
`INVALID_TRANSITION` → HTTP 409; a missing/foreign approval → 404 `NOT_FOUND`; unauthenticated → 401; mock mode → 501.

## 2. Scope (approved slice only)

1. **`review-kinds.ts`** — a typed registry keyed by workflow type with the artifact noun, version noun and the
   verified approve / reject / revise consequences. Covers the 8 mounted kinds plus **Diagnosis, Decision and
   Experiment** (copy taken from their merged contracts: Diagnosis defers decisions; Decision approval records the
   decision only; Experiment approval records a *plan* and runs nothing). No Decision or Experiment *screen* is built.
2. **`review-screen.tsx`** — `ReviewScreen`, the one shared decision region, replacing `DecisionBar` internals:
   - exactly one Approve, one Request revision and one Reject entry point in the DOM, at every width (no CSS-toggled
     duplicates — the structural fix for the prototype defect class);
   - Approve label always names the version ("Approve Performance record v2"), per spec §8.3;
   - three modal confirmation dialogs (Approve, Request revision, Reject) sharing one `ConfirmDialog` primitive;
   - Request revision collects the required note in its dialog and states plainly that confirming **starts another
     paid AI generation run** that re-runs the whole stage pipeline; **no cost estimate** ("Channelwright does not
     estimate the cost");
   - a synchronous ref guard so double clicks/Enter repeats cannot send a second mutation.
3. **`review-dialog.tsx`** — `ConfirmDialog`: `role="dialog"`/`alertdialog`, `aria-modal`, labelled/described,
   Tab/Shift+Tab focus trap, Escape closes (except while submitting), initial focus on the safe action for destructive
   dialogs (Reject) and on the note for revision, focus restored to the invoking button on close.
4. **Typed decision errors** in `workflow-api.ts`: `WorkflowRequestError { status, code, kind }` with
   `kind ∈ network | stale | unauthorized | unavailable | validation | server`; tolerate non-JSON bodies.
   `submitApprovalDecision` request body and URL unchanged.
5. **`useWorkflowWorkspace.decide`** returns a `DecisionOutcome` (`{ ok: true } | { ok: false, reason, message }`)
   instead of a boolean, adds a per-target in-flight guard, and reports decision failures to the dialog (adjacent,
   `role="alert"`) instead of the page banner. Truthful copy per failure:
   - **stale** (409 / 404, or the selected run changed locally): "no longer waiting for you … nothing was recorded from
     this screen"; confirm disabled; explicit "Reload current state" — never a silent state change;
   - **network**: "the connection failed before Channelwright confirmed the decision; it may or may not have been
     recorded. Reload before deciding again" — never success, never a claim that nothing was saved;
   - **unauthorized**: session expired, sign in again, nothing recorded;
   - **unavailable** (501) / **validation** (422); 5xx is treated as unconfirmed (see §5).
6. **Live announcements and focus after success**: a polite status inside the dialog while submitting; on success the
   workspace notice (`role="status"`) receives focus (`tabIndex=-1`) so focus is never dropped to `<body>` when the
   decision region unmounts.
7. **Migrate all 8 call sites** from `DecisionBar` to `ReviewScreen` (`kind` + `versionNumber`), keeping each
   workspace's existing explanation text. `DecisionBar` is removed (no parallel system).
8. **Responsive CSS** in `globals.css` for 1440 / 1024 / 390 / 375: one decision region, buttons ≥48px tall, stacked
   full-width below 700px, dialogs as full-width sheets below 600px, no horizontal overflow, `overflow-wrap` on labels.
9. **Fixture harness** `/studio/preview/review` (mock mode only, `notFound()` otherwise, `requireUser`, same pattern as
   `/studio/preview`): mounts `ReviewScreen` for Performance, Diagnosis, Decision and Experiment with a simulated
   outcome (`success | stale | network | unauthorized`) and no workflow data, for browser verification at the four
   widths. It sends nothing to `/api`.

## 3. Out of scope (explicit)

B21 outcome capture; Decision/Experiment artifact renderers or live screens; read-models (B17/B20); B8 server typed
codes; B19 upstream re-validation on approve; any schema, migration, RLS, RPC, route or auth change; publishing,
scheduling, analytics; PR #18. Sticky mobile decision bar and the prototype's "More…" sheet are deferred (the Sprint 3/7
audits disagree on stickiness; a single non-sticky region is the conservative choice).

## 4. Tests

- **Single Approve per width**: render `ReviewScreen` for each kind → exactly one Approve button; a CSS evaluator over
  `globals.css` applies the media queries active at 1440 / 1024 / 390 / 375 and asserts no matching rule hides the
  decision region or its buttons (`display:none` / `visibility:hidden`), and that the decision region classes are never
  duplicated by any workspace (one `ReviewScreen` per workspace source).
- **Confirmations**: Approve, Revise, Reject each send nothing until confirmed; cancel/Escape send nothing; revise
  blocks an empty note (`aria-invalid`) and its dialog states the paid run and "does not estimate the cost".
- **Duplicate clicks**: rapid double confirm → one POST (component) and concurrent `decide` on one target → one POST
  (hook).
- **Stale**: 409 `INVALID_TRANSITION` → stale message, confirm disabled, no success notice, state unchanged until
  "Reload current state".
- **Network / auth / 5xx / non-JSON**: never a success notice; dialog stays open with the truthful message.
- **Focus**: initial focus per dialog, Tab/Shift+Tab trap, Escape closes, focus returns to the invoker, success focuses
  the status notice.
- **Routes and actions preserved**: request URL/body unchanged per decision; existing workspace suites updated for
  the confirm step; Command Center / run ledgers render no decision controls; only `useWorkflowWorkspace` calls
  `submitApprovalDecision`.

Verification: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, plus a browser check of the fixture
harness at the four widths. Scripted jsdom checks do **not** prove production accessibility; no screen-reader or device
testing is claimed.

## 5. Codex plan review (round 1: APPROVE WITH CHANGES) and reconciliation

| # | Finding | Resolution |
|---|---|---|
| P1 | A 5xx cannot prove nothing advanced: RPC transport faults map to `DATABASE_ERROR`/500 even if the RPC committed. | Accepted. 5xx, network rejection, unreadable bodies and malformed success bodies are one **unconfirmed** outcome: "Channelwright couldn't confirm whether this decision was recorded. Reload before deciding again." No "nothing advanced" claim. |
| P2 | 409 is ambiguous: `INVALID_TRANSITION` also covers missing provenance, and `NOT_ALLOWED` (auth lost inside the RPC) maps to 409. | Accepted. 409/404 copy says only what is true in every case: the gate "can no longer be decided from this screen", most likely decided elsewhere or replaced, and this request recorded nothing (a raised RPC exception rolls back). 401 says sign-in is required, not "session expired". |
| P2 | In-flight guards leave retry gaps after a success with a failed refresh, or after an unconfirmed outcome. | Accepted. The hook **locks** a target key after a recorded or unconfirmed decision; a locked target renders disabled actions plus "Reload current state". The lock clears only when a detail load that *started after* the lock succeeds. |
| P2 | Preserve target identity and refresh sequencing. | Accepted. `ReviewScreen` stays keyed by `target.key`; send-time target verification and the list/detail/feedback tickets are unchanged; existing tests stay and deferred-response tests are added. |
| P2 | Success focus must be owned outside the disappearing screen; `aria-modal` + Tab trap is not enough. | Accepted. The workspace notice (`WorkspaceFeedback`) is focusable and takes focus on each decision outcome token. Dialogs render in a portal and mark the rest of `<body>` `inert` while open; the submitting confirm stays focusable (`aria-disabled`, guarded). |
| P2 | Fixture route isolation unverified. | Accepted. Route tests: production, mock disabled, unauthenticated mock, authenticated mock. The harness does not use `useWorkflowWorkspace`; a test asserts zero `fetch` calls across every dialog and outcome. |
| P2 | One-Approve needs browser assertions. | Accepted. jsdom counts all DOM copies (hidden or not) separately for entry and confirm buttons; the harness is checked in a real browser at 1440/1024/390/375 for visibility, ≥48px height, overflow and keyboard use. Still no production-accessibility claim. |
| P3 | 14 workflow types; fixture page vs "no route change". | Accepted. Revision re-queues the whole pipeline for every *mounted* type; copy says it "starts another AI generation run that uses paid model calls" (the run is queued, then spends when executed). Excluded: backend route-contract changes; the fixture page is allowed. |

## 6. Risks

- Approve gains a confirmation step (owner decision "confirmation dialogs stay", Sprint 2); one extra click per gate.
- jsdom cannot lay out CSS; the width tests prove structure (one control, no hiding rule), the browser harness checks
  layout, and neither is assistive-technology proof.
- Network-failure copy is deliberately uncertain because a lost response may follow a recorded decision.

## 7. Codex implementation review

| Round | Verdict | Findings | Resolution |
|---|---|---|---|
| 1 | REJECT | P1: an empty / array / null-field acknowledgement body was reported as success. | Success now requires an object echoing the exact approval id and decision; everything else is unconfirmed. Mocks use the RPC's real result shape (`decision-ack.test-helper.ts`). |
| 1 | | P2: revision copy promised the note becomes the model's instruction for stages that never pass it. | Per-kind `revisionNoteReachesModel`; stages that ignore the note say so. |
| 1 | | P2: Close / Reload after a blocked outcome dropped focus to `<body>` (the invoker is disabled while locked). | Close focuses the locked-state reload control; Reload focuses the review heading. |
| 1 | | P2: the 501 "unavailable" branch was unreachable behind the generic 5xx rule. | `501 PRODUCTION_REQUIRED` (refused before mutation) is classified first; other 5xx stay unconfirmed. |
| 2 | REJECT | P1, focus and 501 confirmed resolved. New P2: Research was flagged as ignoring the note, but `openai-research-model.ts` sends the whole request input, which carries `humanRevisionNote`. | Research flag corrected; the test now pins the traced table (only Content intelligence and Diagnosis ignore the note) instead of deriving expectations from the flags. |
| 3 | REJECT | Research flag confirmed resolved and the pinned table matches all 11 kinds. New P2: after Reload, a reconciled state can remove the review screen, dropping focus to `<body>`. P3: stale doc status and "all 13 workflow types" wording. | `reload` now announces "Reloaded. This view now shows the workflow's current state." in the workspace notice and focuses it on success (a failed reload stays a visible refresh error and keeps the lock). Doc status and scope wording corrected. |
| 4 | REJECT | Round-3 findings confirmed resolved. New P2: a superseded reload whose own response succeeded still announced a reconciled state while a newer reload had failed. | `load` reports whether it committed a still-newest detail and `refresh` succeeds only if no newer refresh started; overlapping-reload regression test added (mutation-checked: it fails with the old `return true`). |
| 5 | REJECT | Round-4 finding confirmed resolved. New P2: success also required no newer *feedback* ticket, which a sibling workspace's list-only refresh takes, so a committed reload could skip its focus handoff. | `refresh` succeeds exactly when `load` committed the newest detail (`requestSeq`); list-only refreshes never supersede it. Sibling-interleaving regression test added (mutation-checked against the round-4 code). |

Browser check (Chromium via Playwright, fixture harness, mock mode): at 1440 / 1024 / 390 / 375 for Performance, Diagnosis,
Decision and Experiment — exactly one visible Approve, all three entry controls visible and ≥48px, no horizontal overflow,
modal dialog fits the viewport with ≥48px actions, initial focus on Cancel for Reject, Tab trapped, background inert,
Escape restores focus to the invoker and clears `inert`, stale outcome blocks the confirm, success focuses the status notice.
It also caught a real defect fixed before review: the server page imported fixture constants from a `"use client"` module,
so query parameters were silently ignored under RSC (now a plain module, with a structure test).
