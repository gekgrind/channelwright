# Channelwright Studios — Cinematic Asset Direction

Status: **direction pass**. No production assets are integrated by this document.
Surface: `/studios-preview` (`src/features/studios/*`).

---

## 0. The correction this document has to make first

The brief assumes `/studios-preview` is a landing page made of sections that
can receive art-directed photography. It is not, and building against that
assumption would produce assets that cannot be installed.

What is actually there, verified by reading the source and rendering the page
at 1440×900 and 390×844:

- **One continuous camera move.** Eight scenes (`beats.ts:SCENES`, 36.4vh of
  travel, ~26,500px on desktop) each overlap the previous by one viewport.
  There are no section boundaries. A single journey variable `--j` drives the
  timeline and a separate `--cam` drives spatial position, so the Return (Beat
  8) can travel the camera backwards while the story advances.
- **One persistent world layer.** `StudiosWorld` is `position: fixed` behind
  every scene. Everything in it — three depth planes, floor, deck, ceiling,
  jambs, signage, partitions, fixtures, two thresholds, the artifact — is
  positioned by journey coordinate `--at` and moved by `--cam` at a per-class
  drift rate. Props are placed *in the building*, not in a section.
- **Everything is hairline vector at very low opacity on near-black.** Far
  plane 0.5 × wake, mid 0.4, near 0.58; department fixtures capped at 0.3;
  the room instruments demoted to **0.18**. The `--void` is `#050607`.
- **One accent, used as instrumentation.** `--signal: #d8ff3e` appears on the
  artifact pip, the QA sweep, one CTA and the verdict marks. Nowhere else.

The three most recent studios commits are all *demotions* — signage reach cut,
fixtures parked above the copy band and dropped to a third of their old
contrast, instruments moved out of bordered panels into a 0.18 full-bleed
wash. The page reached its current clarity by taking contrast **away**.

**The consequence for asset direction is not negotiable:** a photoreal image
placed at normal exposure would instantly become the brightest, most detailed
object in every frame it appears in, and would undo three passes of tuning in
one move. It is not enough to author a normal image and dim it in CSS — a
bright image at `opacity: .2` goes grey and muddy and reads as a washed-out
photo behind a website. The asset has to be **shot dark**: black holding
black, one directional key, a handful of lit edges and specular hits, so that
at 18–25% composite it still reads as black metal and lit glass.

That single constraint is the spine of the bible in §2, and it is the thing
the proof-of-concept set in §5 exists to test.

---

## 0a. Owner-directed concepts

Concepts listed here are owner-directed signature moments. They are not
subject to unilateral removal by a later pass. Where one appears to conflict
with `docs/PRODUCT_DOCTRINE.md`, the correct move is to state the tension and
propose a reconciliation — not to design the concept away.

- **The screening-room audience footer** (Beats 10 and 11). Owner-directed,
  **P0**. The audience represents *why Channelwright exists*, not the
  completion of its measurement lifecycle. Reconciliation argued in §3a; the
  one binding constraint on execution is stated in the Beat 11 entry.

---

## 1. Current experience assessment

### What is working (do not touch)

| | |
|---|---|
| **The continuous world** | The strongest idea on the page. Crossing from 01 to 02 swaps the copy while the building keeps sliding. It reads as one place, not eight sections. |
| **The artifact as protagonist** | One sentence, mounted once, added to and never reset. Rejected titles stay struck through. This is the transformation story and it already works. |
| **Beat 2, the threshold** | The lintel resolving out of the dark and scaling past the camera is genuinely cinematic and is the best moment in the run. |
| **Beat 9, the unlit door** | Department 06 drawn in the same hand as the entrance and deliberately left dark, labelled `DESIGNED, NOT BUILT`. An honest architectural statement instead of a fake dashboard. This is the page's most distinctive idea and it is a *restraint*. |
| **Negative-space discipline** | `.cw-layer--copy::before` builds a hard reading wash on the left 20–36% of the frame. Headlines are always legible. |
| **Reduced-motion parity** | `StaticNarrative` renders the same copy source. No second truth. |
| **Per-room composition** | Headline position varies by department (01 top-left, 04 centred, 08 top-left). The run does not feel templated. |

### What is weak, and what imagery can honestly fix

1. **Materiality.** Everything is 1–1.6px stroke. Nothing has surface, weight,
   grain, or wear. The page reads as an *architectural drawing of* a studio,
   never as a studio. This is exactly the gap physical assets close.
2. **The threshold pays off into more of the same.** The camera goes through a
   lit doorway and finds identical linework on the other side. The most
   cinematic move in the run has no payoff. **This is the single highest-value
   place to put a physical asset in the entire experience.**
3. **The rooms are differentiated only by tint.** `Fixture` draws 8/4/6/6/10
   identical bordered cells with different background tints. Department 01's
   "research wall" and Department 05's "control room" are the same object in
   different colours. Weak, and the CRT motif maps onto it exactly.
4. **Dead frames at the transitions.** Verified at `--j` ≈ 0.66: the outgoing
   room's copy has cleared and the incoming room's has not arrived, leaving
   ~60% of a 1440px frame carrying nothing but drifting hairlines. There are
   several of these. They are the natural home for an environmental plate.
5. **Mobile has a large empty mid-band.** At 390×844 the back wall, partitions
   and fixtures are all dropped. Between the headline and the artifact there
   is roughly 380px of nothing. Mobile needs *fewer, larger, closer* assets,
   not scaled-down desktop ones.

**What imagery must not do:** out-contrast the headline; fill the reading
wash; add a second accent colour; put detail in the copy band; or make the
page look decorated. If an asset makes the page prettier and less legible, it
is rejected.

---

## 2. Channelwright Cinematic Asset Bible

Binding for every Magnific generation for this surface.

### 2.1 Exposure (the rule that overrides all others)

Assets are authored **pre-demoted**. Target a histogram where roughly 80–85%
of pixels sit below 12% luminance, the lit edges peak around 55–70%, and
nothing clips to white. One directional key, no fill, no rim light on the
opposite side. Background boundaries dissolve into unresolved black — the
viewer must never be able to locate the back wall of the room.

Test: at `opacity: .22` over `#050607`, the asset must still read as *black
metal with lit edges*, not as a grey rectangle.

### 2.2 Environment

Near-black cinematic soundstage. Deep atmospheric haze, used for depth
separation rather than for beams. The room is always larger than the frame,
and the frame never contains its boundary.

### 2.3 Lighting

Objects emerge from black. Controlled directional studio key, usually from
one side and slightly behind, so the subject is described by its **edges**
rather than by its faces. Practical illumination — monitor glass, a tally
lamp, a status LED — is the only light permitted inside the subject. No
volumetric god-rays, no lens flare, no bloom beyond a restrained specular
falloff.

### 2.4 Palette

- **Ground:** `#050607` void, `#0a0c10` deep, `#12151b` deck, `#1b1f27` riser.
- **Light:** a single paper tone `#f2efe6` at four intensities. Never warm
  white, never blue-white.
- **Materials:** graphite, gunmetal, desaturated silver, aged glass, muted
  warm analogue plastic, dusty phosphor.
- **Accent:** `#d8ff3e` acid-lime, **at most one instance per asset**, at the
  scale of a tally light or a single lit switch. It is instrumentation. It is
  never an edge-glow, never a light source for the scene, never a colour cast.
  An asset with acid light spilling across a surface is rejected on sight.

### 2.5 Materiality

Working equipment, not museum pieces or product shots. Scuffed anodising,
worn paint at the handles, dust in the vents, cable strain relief, camera
tape, gaffer residue, fingerprints on glass, mismatched vintages in the same
rack. Every object should look like it has been moved by someone this month.

### 2.6 Photography

Photorealistic. 35–50mm lens language; 24–28mm only for the full
environmental plates. Natural optical depth of field — subject sharp, depth
falling off honestly. Fine film grain. High dynamic range **without**
commercial product-photography gloss. No tilt-shift, no anamorphic streaks,
no heavy vignette (the page paints its own).

### 2.7 Composition — authored for a website, not for a portfolio

- **Reading side stays empty.** The page washes the left 20–36% of the frame
  for copy. Every 21:9 and 16:9 asset must keep its left 40% in near-total
  black with no readable detail.
- **Subject enters from an edge and is cropped by the frame.** Nothing is
  centred, nothing is complete. The studio continues past the viewport.
- **Horizon and equipment datum around 62–72% frame height,** to sit against
  the existing floor datum and the conveyance line at 91%.
- **Asymmetric.** If the composition would work mirrored, it is not composed.
- **No text of any kind in the asset.** No labels, no logos, no signage, no
  UI, no numerals. The page owns all typography. Screen content is abstract
  luminance only.

### 2.8 Forbidden

Cyberpunk; purple or blue neon; futuristic AI lab; glowing circuitry;
holograms; SaaS gradients; floating glass dashboards; robots or humanoid AI;
stock crews smiling at camera; pristine product photography; movie posters;
lens flare; blockbuster action grading; retro-kitsch nostalgia collage; visible
AI surrealism (impossible cable runs, melted connectors, nonsense lettering).

---

## 3. Asset Integration Map

Journey positions are `--j` fractions from `beats.ts`. "Frame" positions are
verified from rendered captures at 1440×900.

---

### Beat 1 — Cold open (`open`, --j 0 → 0.06)

- **Narrative:** one idea, in the visitor's own words.
- **Current visual:** near-total black; the artifact plate and one acid pip
  are the only lit things. Verified: at `--j` 0 the frame is essentially empty.
- **Proposed motif:** **NONE.**
- **Why:** the emptiness *is* the beat. This is the quietest frame in the run
  and it earns everything that follows. Adding equipment here is the single
  most tempting and most damaging change available.
- **Priority: SKIP.**

---

### Beat 2 — The threshold (`open`, --j 0.06 → 0.126)

- **Narrative:** the turn. The building opens and the camera goes through it.
- **Current visual:** lit rectangular aperture with the facility name on the
  lintel, scaling past the camera; jambs part; ceiling lifts. Behind the
  doorway: identical hairline linework.
- **Proposed motif:** **Soundstage interior plate, seen through the aperture.**
  A deep, hazed stage: a cinema camera on a dolly cropped by the right edge, a
  lighting stand entering top-left, cable runs on the deck, everything falling
  into black by mid-frame. Masked to the inside of `.cw-threshold` and scaled
  with the same `--close` ramp the aperture already uses.
- **Why:** the highest-value moment in the run currently has no payoff. This
  is the one place where "the physical world exists behind the digital
  interface" can be *stated* rather than implied. The whole thesis lives here.
- **Composition:** centre-frame vertical corridor of darkness (the aperture is
  narrow); subject mass right of centre; left third black.
- **Negative space:** the lintel type sits at the top of the aperture — the top
  18% of the plate must be unlit. `OPERATING FLOOR · AUTHORISED` sits below it.
- **Interaction:** plate opacity rides `--reveal`; scale rides `--close`; it
  is clipped by the existing frame so it cannot leak into the hall.
- **Scroll:** resolves out of black at `--reveal`, rushes past at the crossing,
  gone by the approach corridor. Never seen again.
- **Asset type:** Environmental. **Desktop:** as described. **Mobile:** same
  plate, tighter crop (the mobile threshold is `min(26vw, 14vh)` — the plate
  must survive being 100px wide, so the composition needs one readable silhouette,
  not a scene).
- **Performance: LOW** — one masked `<img>` with opacity + scale already driven
  by existing custom properties. No new mechanism.
- **Priority: P0.**

---

### Beat 3 — Department 01, Intelligence Room (`intelligence`, --j 0.126 → 0.27)

- **Narrative:** evidence before strategy. Three angles rejected.
- **Current visual:** `OpportunityPlot` canvas at 0.18 opacity full-bleed;
  `Fixture[research]` — 16 tinted cells — parked at 19% frame height.
- **Proposed motif:** **CRT / broadcast monitor wall, matched-state pair.**
  Replaces the research fixture's cell grid as the back-wall equipment for
  this room. State A: an irregular bank of ~18 mismatched CRTs and broadcast
  monitors, dormant, dark glass, one or two carrying dead static. State B:
  same bank, same camera, a minority of screens carrying abstract luminance —
  waveform, scatter, frame grid — the rest still dark.
- **Why:** this is the room that *looks at many things and rejects most of
  them*. A wall where a few screens resolve and most stay dark is that claim,
  made physically. It also fixes the "every room is the same cell grid"
  problem at the room where it matters most.
- **Composition:** 21:9. Bank occupies the right 55–60% and is cropped by the
  right edge and the bottom. Left 40% falls away into unresolved black.
- **Negative space:** the room's headline is a 3-line display at ~180–280px
  from the top-left. That entire quadrant must be black.
- **Interaction:** the two states cross-fade on `--l1`, the department's own
  light ramp, which already exists. The blueprint fixture cells stay, at
  reduced opacity, sitting *in front of* the plate — vector grid over
  photographic glass is the physical/digital seam the brief is asking for.
- **Scroll:** enters on `--fixtures-on`, crossfades A→B across the room,
  exits with `--l2` rising.
- **Asset type:** Matched-state pair. **Desktop:** as described.
  **Mobile:** fixtures are `display: none` under 720px — ship a separate
  tight 4:5 crop of 5–6 monitors as the room's only physical element.
- **Performance: LOW–MEDIUM** — two WebP/AVIF plates, one opacity crossfade.
  No JS. Mobile loads one crop only.
- **Priority: P0.**

---

### Beat 4 — Department 02, Strategy Room (`strategy`, --j 0.27 → 0.395)

- **Narrative:** the idea acquires an audience and a hypothesis.
- **Current visual:** `VersionGate` canvas; `Fixture[decision]`, 8 brass-tinted
  cells.
- **Proposed motif:** **Physical decision wall — pinned cards, contact sheet,
  grease-pencil marks on glass.** Shallow, close, cropped hard by the right
  edge. Not storyboards yet: these are *positions*, not shots.
- **Why:** the artifact acquires its audience line and its dormant question in
  this room, and the Return comes back here. A room the visitor must be able
  to *recognise* four beats later needs a physical identity, not a tint.
  This is what makes Beat 8 land.
- **Composition:** 16:9, subject right 50%, very shallow depth of field.
- **Negative space:** left 45% black; headline sits top-left.
- **Interaction:** blueprint partition mullions read *across* the pinned cards.
- **Scroll:** enters on `--l1` falling, holds, exits.
- **Asset type:** Environmental (single state). **Mobile:** SKIP — mobile
  recognises the Return by the wall sign, which already comes back with `--rev`.
- **Performance: LOW.**
- **Priority: P1** — but its value is entirely as **setup for Beat 8**, and it
  should not be produced unless Beat 8 gets its matched state (below).

---

### Beat 5 — Department 03, Writers' Room (`writers`, --j 0.395 → 0.52)

- **Narrative:** something checked it before you did. One section sent back.
- **Current visual:** `ScriptSequencer` canvas; `Fixture[writers]`, 12 cells.
- **Proposed motif:** **NONE.**
- **Why:** rhythm. Beats 3 and 4 both carry equipment; Beat 6 needs to land
  hard. This room's argument is *procedural* — a QA pass catching a section —
  and it is already carried by the artifact's own section strip and the
  sequencer. A storyboard wall here would be the cliché, not the story.
- **Priority: SKIP** (revisit only if the run feels visually thin after P0).

---

### Beat 6 — Department 04, Production Floor (`production`, --j 0.52 → 0.65)

- **Narrative:** finished is not the same as cleared. Held at the gate.
- **Current visual:** `RenderLine` canvas; the artifact is physically **held**
  while a QA band sweeps down it — the best interaction in the run.
- **Proposed motif:** **Cinema camera, large, cropped, in silhouette,
  entering from the left edge, matte box and rods only partly lit.**
- **Why:** this is the room where the work becomes a *thing*. It is also the
  only beat where the artifact stops moving, so the frame can carry mass
  without competing. A camera body is the single most legible "this is a
  studio" object available, and here it earns its place.
- **Composition:** 21:9. Subject on the **left**, cropped by the left edge,
  occupying ~35% width — this is the one room whose headline is **centred**
  (verified at `--j` 0.5), so the reading wash is not on the left here and the
  left edge is available. Right 60% falls to black behind the held artifact.
- **Negative space:** centre column, from 20% to 40% frame height, must be
  black for the two-line centred headline.
- **Interaction:** the acid QA sweep band passes *in front of* the camera body.
  Physical object, digital check, one crossing.
- **Scroll:** rises as the gate closes, holds through the sweep, exits as the
  artifact clears.
- **Asset type:** Isolated object on black (compositable). **Mobile:** yes —
  a tighter 4:5 crop of the matte box and lens only, bottom-left.
- **Performance: LOW.**
- **Priority: P1.**

---

### Beat 7 — Department 05, Control Room (`control`, --j 0.65 → 0.78)

- **Narrative:** publishing is a decision. Someone makes it. 1 of 5 chosen.
- **Current visual:** `ReleaseCompositor`; `Fixture[control]`, 10 cells.
- **Proposed motif:** **Deferred.** If the CRT plate proves out, the correct
  move here is a *second state* of the same monitor bank — a preview/programme
  arrangement with exactly one screen carrying the acid tally — reusing the
  Beat 3 visual DNA rather than introducing new equipment.
- **Why:** the argument is "one of these, chosen by a person". A tally light on
  exactly one monitor says that in one frame. But it must be the *same wall*,
  seen later, or the building stops being one building.
- **Asset type:** Matched-state (third state of the Beat 3 bank).
- **Performance: LOW.**
- **Priority: P2** — depends entirely on PoC-1/PoC-2 succeeding.

---

### Beat 8 — The Return (`return`, --j 0.78 → 0.9)

- **Narrative:** a pipeline forgets; this one comes back. The camera travels
  backwards to Department 02.
- **Current visual:** the world traverses ~half the building in reverse; no
  instrument, deliberately. Copy arrives *after* the traverse.
- **Proposed motif:** **The Beat 4 decision wall, returned — same composition,
  colder key, one card now carrying the acid mark.**
- **Why:** the beat's entire claim is *this is the same room, later*. A matched
  pair does that in a way no copy can. Without a physical Beat 4, this is
  impossible; with it, this is the strongest narrative use of a matched state
  in the whole run.
- **Negative space:** headline top-left, verdict directly beneath it.
- **Interaction:** the ambient wash already partly restores `--l1` during
  `--rev`. The plate crossfades on the same variable.
- **Asset type:** Matched-state (second state of the Beat 4 wall).
- **Performance: LOW.**
- **Priority: P1**, paired with Beat 4. Ship both or neither.

---

### Beat 9 — The Next Decision (`finale`, --j 0.9 → 1.0)

- **Narrative:** the room that is not built. `06 — ANALYTICS COMMAND`,
  `DESIGNED, NOT BUILT`.
- **Current visual:** unlit doorway drawn in the same hand as the entrance;
  the artifact set down at its foot; one CTA.
- **Proposed motif:** **NONE inside the aperture.** The door stays unlit and
  stays empty.
- **Why:** the emptiness is the argument. Putting anything behind this door
  would show a room the product does not have.
- **Exception worth testing later:** a *barely perceptible* dust-and-haze plate
  inside the aperture — enough to say "empty room" rather than "flat panel",
  with no object in it at all. P2, and only if it survives being almost invisible.
- **Priority: SKIP** for the aperture (P2 for the haze-only variant). The door
  itself is **preserved unchanged** and is load-bearing for Beat 11 — see below.

---

### Beat 10 — The way out (NEW · after the capability register)

- **Narrative:** the visitor leaves the building. Not through Department 06 —
  *away from it*.
- **Current visual:** none. The page currently ends inside the architecture:
  `ArchiveHall` deliberately reuses the same ceiling, planes, jambs, haze and
  floor as the departments, because the register is "one more room in the
  building". That premise is kept.
- **Proposed motif:** **Architectural dissolve, drawn not photographed.** Across
  a short scroll span the hall shell comes apart in a fixed order: the overhead
  truss first, then the jambs, then the floor grid, then the wash. The
  conveyance line — the artifact's route — is **last**, and it *ends* rather
  than fades, because the route through the system genuinely terminates when
  the work is published.
- **Why this beat exists at all:** it is the entire doctrinal load-bearing
  member of the new ending (see §3a). Without an explicit exit, an audience
  appearing after Department 06 could be misread as being *through* it.
  With one, the audience is unambiguously outside the department architecture.
- **Composition:** no new subject. Everything already on screen, leaving.
- **Direction of travel:** whatever hall elements remain drift **opposite** to
  the direction they drifted all film. The visitor has turned around. This is
  the cheapest possible statement that the axis has changed, and it is the one
  the eye reads fastest.
- **Interaction:** its own progress via `registerScene`, exactly as the journey
  wrapper does. `--cam` is journey-scoped and does not reach here. No new
  mechanism.
- **Scroll:** ~1.5–2 viewport-heights. Short. This is a transition, not a beat
  to dwell in.
- **Asset type:** NONE — this is CSS on existing elements.
- **Desktop / Mobile:** identical logic; mobile has fewer elements to dissolve
  because the far plane, partitions and fixtures are already dropped.
- **Performance: LOW.**
- **Priority: P0** — required by Beat 11, and worthless without it.

---

### Beat 11 — The auditorium (NEW · the page's last frame)

- **Narrative:** the work exists for people. They are still there, beyond the
  system, and the creator is accountable to them.
  *"They're waiting. What are you going to make for them?"*
- **Current visual:** the existing `Footer` — one line, one CTA, one note.
  This beat **absorbs** that footer rather than being added after it, so the
  page does not end with two consecutive calls to action.
- **Proposed motif:** **A dark auditorium, seen from the screen.** Rows of
  seated people in a near-black room. The visitor is standing where the screen
  is — so the audience is facing the visitor's position, and **the only light
  in the frame comes from behind the camera**, falling on faces and seat backs.
- **Why the light inverts, and why it matters:** for the entire film the light
  has come from *ahead* — the hall, the doorway, the fixtures, the seam. Here
  it comes from *behind*. That single inversion says "you are outside the
  system and being looked at" without a word of copy, and it costs nothing but
  a lighting instruction in the prompt.
- **Why it does not contradict the register (the reconciliation):** the screen
  the audience is waiting in front of is **dark**. Nothing has played. Nobody
  in the frame has watched anything, nobody is reacting, and there is not a
  number anywhere in the composition. Department 06 is an unlit door; the
  auditorium is an unlit screen. The two images make the *same* statement in
  two registers — machine and human — and reinforce rather than fight each
  other. The audience is the **reason**; the darkness is the **honesty**.
- **The hard constraint, carried forward from the earlier objection:** the
  audience may never be shown *reacting to work*. No applause, no laughter, no
  lit screen, no reaction shots, no delight, no metrics, no overlay. **Waiting,
  not responding.** An asset that shows a reaction is rejected regardless of
  how good it looks — that, and only that, is what would claim a closed
  measurement loop.
- **Composition:** 21:9 desktop. Audience occupying the lower 60% and running
  off both edges — the room is larger than the frame. Upper 35% is unresolved
  black for the line and the action. Nearest row cropped by the bottom edge, so
  the visitor is *among* them rather than looking at a picture of them.
- **Negative space:** the final line and CTA sit upper-left over black. No face
  may fall inside that quadrant in any state.
- **Interaction — the turn:** **three matched plates, staggered.** State A:
  everyone oriented toward the screen or elsewhere in the room. State A′: two
  or three of the nearest heads have turned. State B: roughly six to eight of
  forty are facing the visitor. Staggered crossfades read as a wave moving
  through the crowd; a single A→B dissolve would ghost bodies through bodies.
- **Restraint is the whole craft here.** Only a minority ever turn. Faces stay
  largely in shadow, unsmiling, not staring, no eye contact held by more than
  one or two figures. The difference between "they're waiting" and a horror
  beat is entirely a question of how many and how hard.
- **Scroll:** the turn completes at the **true document bottom**, not merely at
  the end of the section's own box — the owner's stated interaction is tied to
  reaching the absolute bottom of the page, so progress is measured against
  document end. The final CTA arrives on `Scene`'s existing `revealAt` /
  `data-revealed` mechanism so it is not a tab stop before the turn resolves —
  the same reasoning `NextDecision` already documents.
- **Asset type:** Matched-state, three plates. **Desktop:** as described.
  **Mobile:** a separate tighter crop — 8 to 12 people, nearer, so heads are
  readable at 390px — and **two** states rather than three.
- **Performance: LOW–MEDIUM.** Three plates plus two crossfades, no JS per
  frame. Mobile loads two. These are the heaviest images in the plan
  (faces and skin do not compress like black metal): budget ~150–220KB each in
  AVIF rather than the 40–90KB the equipment plates should cost, and lazy-load
  them — they are below several viewports of content.
- **Priority: P0 — signature moment.**

---

## 3a. Why the ending does not contradict the lifecycle doctrine

Recorded because this was got wrong once and should not be re-litigated from
scratch.

The earlier draft of this document rejected the audience footer on the grounds
that an audience at the end of the run implies the measurement loop has closed.
That objection was too strong, and reading `docs/PRODUCT_DOCTRINE.md` closely
inverts it:

- **Principle 4, "Viewer value is mandatory"**, is a binding product
  constraint: Channelwright must optimise for meaningful viewer value, not
  AI-generated volume. It is currently **the only doctrine principle the page
  never depicts.** The building *names* an audience — Department 02's line is
  "Don't chase views. Build an audience." — and then never shows one. The
  auditorium closes that gap; it does not open a new one.
- **What the register actually forbids** is claiming a measured result.
  `measurement` is DESIGNED and its boundary states Channelwright ingests no
  analytics today. That forbids numbers, dashboards, reactions and outcomes.
  It does not forbid people.
- **The department architecture is the system; the audience is not in it.**
  Departments 01–06 are Channelwright's own capabilities, and each is claimed
  against the register. An auditorium is not a department, carries no status,
  and makes no capability claim. Beat 10 exists precisely to make that
  structural fact visible in the architecture rather than asserted in a caption.
- **The two dark objects rhyme.** An unlit door and an unlit screen say the
  same thing from opposite sides: the result has not landed yet. Placing them
  in sequence strengthens the register's claim rather than undermining it.

So the ordering is: the film ends → the record is stated inside the building →
the building comes apart → the people are still there. Nothing in that sequence
asserts that Department 06 was built, and Beat 10 is the member that guarantees
it. If Beat 10 were ever cut for length, Beat 11 would have to be cut with it.

**One structural rhyme worth protecting:** the run ends by walking *out* of the
studio to meet the audience, and the only action offered there is
`Enter the studio`. The visitor is put in the creator's position without a word
of explanation. Do not let a later copy pass paraphrase that CTA away.

---

## 4. Visual rhythm map

The page must breathe. Verified against the current run, the sequence below
alternates weight and leaves the two most important frames — the opening and
the ending — as the quietest in the film.

| Beat | Weight | Carried by |
|---|---|---|
| 1 — Idea | **SILENT** | one sentence, one pip, black |
| 2 — Threshold | **HERO** | soundstage plate through the aperture |
| 3 — Intelligence | **HEAVY** | CRT wall, matched state A→B |
| 4 — Strategy | MEDIUM | decision wall, shallow, close |
| 5 — Writers | **QUIET** | linework and the artifact only |
| 6 — Production | **HERO** | cinema camera silhouette + the gate hold |
| 7 — Control | MEDIUM | CRT bank returning, one tally lit |
| 8 — Return | MEDIUM (recognition, not spectacle) | decision wall, second state |
| 9 — Next Decision | **SILENT** | the unlit door |
| — Capability register | **QUIET** | the record, inside the building |
| 10 — The way out | **QUIET** | the architecture dissolving; no new subject |
| 11 — The auditorium | **HERO** | audience plates, staggered turn, final action |

Three hero moments now, spaced roughly 40%, 30% and 25% apart, and the run
still opens and closes on restraint: Beat 1 is one sentence in the dark, Beat 9
is an unlit door, and the register and the exit are two consecutive quiet beats
that let the last frame land. Beat 11 is the only place in the film where a
human face appears, which is most of why it carries.

The risk to watch is the tail: Beats 9, 10 and 11 add roughly 4.5
viewport-heights (~4,000px desktop, about 13% more page). If the exit is
allowed to sprawl, the film ends twice. Keep Beat 10 short.

---

## 5. Proof-of-concept selection

Three generations, two compositions. Chosen to *test the system*, not to be
easy.

**PoC-1 + PoC-2 — CRT/broadcast monitor wall, matched state pair (Beat 3).**
Tests four things at once, all of which the entire production phase depends on:
(a) does pre-demoted photography survive compositing at ~0.22 over `#050607`
behind hairline vector, or does it turn to grey mud; (b) does the CRT motif
read as intelligent and premium rather than as retro-kitsch; (c) can Magnific
hold a *matched composition* across two prompts well enough for a crossfade —
if it cannot, the cheapest and most valuable technique in the plan is dead and
we need to know now; (d) does one acid tally survive as instrumentation rather
than becoming decoration.

**PoC-3 — Soundstage interior through the threshold (Beat 2).**
Tests the thesis itself at the highest-value moment: is there a payoff behind
the door that makes the crossing land, and does a photographic interior read
as *behind* the vector building rather than pasted on top of it. This is the
asset that decides whether the direction is worth a production phase.

Deliberately **not** generated in this pass: the storyboard wall (P1, and its
value is conditional on Beat 4/8 being taken as a pair), the director's chair
and clapperboard family (cliché risk, low narrative value), the production
floor wide (would compete with PoC-3 for the same job), and anything for the
finale (the argument there is emptiness).

---

## 6. Magnific prompts and settings (reproducible visual DNA)

All four generations: **Seedream 5 Pro** (`seedream-5-pro`), **2k**, no brand
kit, no style LoRA. Chosen over Recraft V4.1 because the matched-state test in
§5 requires image-reference support, and over Nano Banana Pro because this is
photographic exploration rather than brand-fidelity finishing.

Every prompt ends with the same three clauses, which are the enforceable part
of the bible and should be appended verbatim to every future generation:

```
Very dark exposure: roughly 85 percent of the image below 12 percent
luminance, highlights peaking around 60 percent, nothing clipping to white.
No text, no labels, no logos, no numerals, no signage, no people.
Not cyberpunk. No neon, no blue or purple light, no lens flare, no bloom,
no god rays.
```

### PoC-1 — CRT wall, state A (dormant) · 21:9 · 3024×1296 · 2 variants · seed 318661 (v1)

```
Photorealistic cinematic still, extremely low key, near-black. A dark
broadcast studio wall of about eighteen mismatched vintage CRT televisions and
professional broadcast monitors — different sizes, different eras — stacked in
an irregular rack of scuffed black steel shelving. Every screen is DORMANT:
dark grey switched-off glass with faint reflections only; two screens carry
dead grey analogue static at very low brightness. The monitor bank occupies
the right 55% of the frame and is cropped by both the right edge and the
bottom edge. The left 40% of the frame is unresolved black with no readable
detail — the room dissolves into darkness and the back wall is never visible.
A single hard directional key light rakes across the monitor bezels from the
upper right and slightly behind, describing the equipment by its edges only.
No fill light, no rim light on the left side. Materials: worn anodised
aluminium, aged beige and graphite plastic, dusty glass, coiled BNC cables
with strain relief, camera tape residue, fingerprints on the screens. Heavy
atmospheric haze for depth separation. Strictly desaturated palette: graphite,
gunmetal, silver, aged glass, muted warm analogue plastic. 35mm lens, natural
shallow depth of field falling off into darkness, fine film grain, high
dynamic range without any commercial gloss. [+ the three closing clauses]
```

### PoC-2 — CRT wall, state B (partially active) · 21:9 · image reference = PoC-1 v1

The matched-state test. The reference is passed as `type: image` so the model
holds the composition rather than reinterpreting the subject.

```
Match the reference image exactly: identical camera position, identical lens,
identical framing, identical monitor bank layout, identical shelving,
identical lighting direction. The ONLY change is that six of the screens have
now switched on, carrying dim abstract luminance — a single-trace waveform, a
sparse scatter of points, a plain frame grid, soft grey analogue static — all
extremely dim, unreadable, no text and no interface. The remaining monitors
stay dark and switched off. One single small acid-lime chartreuse tally lamp
is lit on exactly one monitor bezel, the size of a fingernail, reading as an
indicator light only — it casts no coloured light on any surface. Everything
else is unchanged. Extremely low key, near-black. [exposure clause, but
"roughly 80 percent below 12 percent luminance, screen glow peaking around 55
percent"] Strictly desaturated palette apart from that one tally: graphite,
gunmetal, silver, aged glass, muted warm analogue plastic, dusty phosphor
grey. Fine film grain, high dynamic range without commercial gloss.
[+ the remaining two closing clauses]
```

### PoC-3 — Soundstage through the threshold · 3:4 portrait · 2 variants

Portrait because `.cw-threshold` is `width: min(22vw, 25vh)` by `height: 34vh`
— roughly 3:4 — and scales ×4.3 through the crossing.

```
Photorealistic cinematic still, extremely low key, near-black. Vertical
portrait view deep into a working film soundstage. A professional cinema
camera on a low dolly stands at mid-depth, right of centre, cropped by the
right edge of the frame — only its matte box, lens barrel and support rods
catch the light. A tall lighting stand and a barn-doored studio lamp enter
from the upper left edge, unlit and in silhouette. Thick coiled power cables
and sandbags on a scuffed dark deck in the foreground. The stage recedes into
total unresolved blackness; the back wall is never visible and the room
clearly continues past the frame. The top 20 percent of the frame is
completely unlit black empty air. Single hard directional key light from the
far right, low and raking, describing objects by their edges only; no fill.
Materials: matte black anodised metal, worn paint at the handles, dust in the
vents, gaffer tape residue, brushed aluminium, rubber cable jackets. Heavy
atmospheric haze giving deep tonal separation between foreground, midground
and darkness. Strictly desaturated palette: graphite, gunmetal, desaturated
silver, near-black charcoal. 35mm lens, natural depth of field, fine film
grain, high dynamic range without commercial gloss. [+ the three closing
clauses, with "no visible light beams" appended]
```

**Settings not maximised on purpose:** 2k rather than 4k (these are composited
at 18–25% behind linework; 4k buys nothing and costs page weight), `count` 2
for the two exploratory compositions and 1 for the matched state (the matched
state is a pass/fail test, not a selection), and no upscaling pass.

---

## 7. Generated proof-of-concept assets

Five renders, 500 credits of 20,000 (verified against the account balance).
All in the Magnific Personal project.

| Working name | Intended location | Ratio | Native |
|---|---|---|---|
| `crt-wall-state-a-v1` | Dept 01 back wall, dormant state | 21:9 | 3024×1296 |
| `crt-wall-state-a-v2` | alternate composition of the same | 21:9 | 3024×1296 |
| `crt-wall-state-b` | Dept 01 back wall, active state (matched to v1) | 21:9 | 3024×1296 |
| `soundstage-threshold-v1` | Beat 2, inside `.cw-threshold` | 3:4 | portrait |
| `soundstage-threshold-v2` | alternate composition of the same | 3:4 | portrait |

Proposed repo paths when and if a production phase is approved (note: the
repository currently has **no `public/` directory** — one would be created):

```
public/studios/crt-wall-a.avif        public/studios/crt-wall-a@mobile.avif
public/studios/crt-wall-b.avif        public/studios/crt-wall-b@mobile.avif
public/studios/threshold-stage.avif   public/studios/threshold-stage@mobile.avif
```

---

## 8. Page-integration evaluation — BLOCKED, and why

**This section could not be completed in this session, and nothing in it is
being reported as done.**

The generations succeeded. The images cannot be retrieved into this
environment: Magnific serves results from `pikaso.cdnpk.net`, which this
session's egress policy denies (`connect_rejected`, HTTP 403 at the proxy).
Verified through three separate paths — `curl`, a Playwright request context,
and the `png16` delivery profile, which returns a URL on the same blocked
host. The MCP channel returns metadata and URLs only, never pixels. So the
assets could not be downloaded, could not be viewed, could not be composited
over the page, and **have not been evaluated by anyone yet**.

What was done instead, so the evaluation is a short task rather than a
restart: `tools/studios-asset-preview.html` — a standalone harness that loads
the live `/studios-preview` in an iframe and floats a candidate plate over it
as a fixed layer, which is exactly how a plate in `.cw-world` would behave.
It exposes opacity, blend mode, saturation, contrast, brightness, scale,
position, width and edge falloff, draws the page's own reading-wash band as a
guide, and emits the CSS for whatever composite you settle on. It imports
nothing from `src/` and no application code references it.

**The evaluation to run, in order:**

1. Open each plate at `opacity: .22`, `mix-blend-mode: screen`, `saturate(.7)`
   over Department 01 (`--j` ≈ 0.16–0.24). **Pass condition:** it still reads
   as black metal and lit glass. **Fail condition:** it goes grey and flat —
   which means the exposure clause is not strong enough and the next round
   needs an explicit "black point crushed, no lifted shadows" instruction.
2. Check the headline at that composite. If any part of the plate is readable
   inside the left 36% of the frame, the composition is wrong regardless of
   how good the image is.
3. Toggle state A against state B at the same placement. **Pass condition:**
   the bank does not shift — screens change, geometry does not. **Fail
   condition:** any camera or layout drift, which kills the matched-state
   technique and forces a rethink of Beats 3, 7 and 8.
4. Check the acid tally in state B. It must read as an indicator. If it casts
   colour on surrounding surfaces, reject and regenerate.
5. Put the portrait plate behind the threshold at `--j` ≈ 0.10–0.12 and scroll
   the crossing. **Pass condition:** the crossing gains a payoff.
   **Fail condition:** it reads as a photograph hung in a doorway.
6. Repeat 1 and 5 at 390×844.

Judgements to be sceptical of when reviewing: an image that looks impressive
on its own is not evidence — the only question is whether it survives being
demoted to 22% behind hairline vector without turning to mud, and whether the
headline is still the brightest thing in the frame afterwards.

---

## 9. Performance notes

The plan deliberately requires **no WebGL, no image sequences, and no new
runtime mechanism**. Every proposed moment is one or two static images
composited with custom properties the page already computes.

| Moment | Technique | Cost |
|---|---|---|
| Beat 2 threshold | one plate, clipped to `.cw-threshold`, opacity on `--reveal`, scale on `--close` | LOW |
| Beat 3 CRT wall | two plates, opacity crossfade on `--l1` | LOW |
| Beat 4 / 8 decision wall | two plates, crossfade on `--rev` | LOW |
| Beat 6 cinema camera | one plate, opacity on the scene's own `--p` | LOW |
| Beat 7 CRT tally | third state of the Beat 3 bank, crossfade | LOW |

Budget, if the full P0+P1 set ships: **six desktop plates and four mobile
crops.** AVIF at quality ~55 (these are near-black, they compress
extraordinarily well — expect 40–90KB each at 1920px wide, materially less
than a typical hero JPEG). Serve through `<picture>` with AVIF/WebP and a
`(max-width: 720px)` source; desktop plates must never be downloaded on
mobile. Estimated added weight on desktop: **under 500KB total**, lazily
loaded except the threshold plate, which is needed within the first two
viewports and should be preloaded.

Runtime cost of the crossfades is one additional composited layer per active
plate. The page already composites the ambient wash, three depth planes, the
floor, the deck, the jambs, the haze and the vignette; adding one or two
static images with `will-change: opacity` is well inside the existing budget.
It should still be measured: check paint time on a mid-tier Android before and
after, and if a plate costs more than ~1ms, cut its resolution rather than
its opacity.

**Mobile posture:** the page already drops the far plane, partitions and
fixtures under 720px. Mobile should carry **at most two plates** — the
threshold and one CRT crop — and reproduce the *story*, not the geometry.

---

## 10. Next-phase recommendation

### **B — REFINE.**

Unchanged by the audience-footer reinstatement, and in fact reinforced by it:
Beat 11 depends on matched-state plates holding across **three** compositions
containing **human figures**, which is materially harder than holding a static
monitor bank. The CRT pair in §5 is now the cheap proxy test for the most
expensive moment in the plan. If matched state fails there, it will certainly
fail on a crowd, and Beat 11 needs a different production route — a short
real-footage loop or a commissioned photograph — before any credits go into it.

Not A, and the reason is not caution about the direction. The direction is
sound and §3 is specific enough to execute against. It is that **the single
question the proof-of-concept set was built to answer has not been answered**:
nobody has yet seen these plates composited over the page, because the image
host is blocked from this environment. Recommending full production off
unviewed assets would be exactly the kind of confident, unevidenced call that
wastes a production phase.

The refine step is small and bounded:

1. Download the four renders from the Magnific Personal project.
2. Run the six checks in §8 with `tools/studios-asset-preview.html`.
3. If checks 1–4 pass: build **one throwaway integration spike** — Department
   01 only, both CRT states, behind the existing fixture grid — and look at it
   in the real scroll. That is the honest test of whether photography and
   hairline vector can share a frame. Nothing else gets built until that spike
   is judged.
4. If checks 1–4 fail on exposure, one more generation round with a crushed
   black point before any spike.
5. Only once check 3 (matched state) has passed: generate the auditorium set.
   It is the most expensive and least reversible asset family in the plan, and
   it should never be the thing that discovers the technique does not work.

**Confidence, stated plainly:** high that the *placement* map is right, since
it was derived from the rendered page rather than assumed. Genuinely uncertain
whether photorealistic material can coexist with this particular linework at
this contrast budget — that is a real risk, not a formality, and it is what
step 3 exists to settle. If the spike shows the plates fighting the interface,
the correct answer is **C**, and the page is already good without them.

### Explicitly recorded as rejected

- **~~The screening-room audience footer.~~ REINSTATED as a P0 signature
  moment.** The first draft of this document rejected it on the reasoning that
  an audience at the end implies a closed measurement loop. That was wrong. The
  objection only holds for an audience shown *reacting to work*, and doctrine
  Principle 4 makes viewer value binding — it is the one principle the page
  never depicted. Staged as Beats 10 and 11, with the reconciliation argued in
  §3a. The surviving constraint is narrow and absolute: no reaction, no lit
  screen, no numbers.
- **Filling the Department 06 doorway.** The aperture stays empty. The
  emptiness is the argument, and it is what lets Beat 11 read as *outside* the
  system rather than *through* the door.
- **A storyboard wall in the Writers' Room.** Cliché with no narrative gain;
  the room's claim is procedural and is already carried.
- **Director's chair, clapperboard, film reels, boom mics.** Filmmaking props
  that decorate rather than advance. They fail the §3 test.
