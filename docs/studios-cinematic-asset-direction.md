# Channelwright Studios — Cinematic Asset Direction

**Revision 3.** Authoritative design-planning artifact for cinematic imagery on
`/studios-preview` (`src/features/studios/*`).

No assets are integrated by this document. No application code is changed.

---

## Status key

Every claim below carries one of these. Nothing is asserted without one.

| Key | Meaning |
|---|---|
| **CONFIRMED** | Verified against source, rendered output, or platform metadata in-session. |
| **TESTED** | Judged by the owner against the real page in the evaluation harness. |
| **UNTESTED** | Load-bearing and unverified. No evidence in either direction. |
| **PROPOSED** | Design intent. Not yet built or judged. |
| **REJECTED** | Considered and ruled out, with the reason recorded. |

---

## 0. What changed in revision 3, and why

Revisions 1 and 2 were written before any asset had been seen composited. Local
testing has now been done and it contradicts the central thesis of revision 1.
Nothing is silently overwritten; the superseded conclusions are named here.

### Superseded: "author pre-demoted, composite at ~0.22"

Revision 1's spine was that a photographic plate must be dimmed to roughly 22%
to survive the page's contrast budget. **REJECTED by testing.** At 0.22 the
vintage-CRT character — curved glass, knobs, mismatched eras — falls below
threshold and the plate collapses into an undifferentiated mass. The owner's
diagnosis is correct and mine was wrong: uniform opacity scales highlights and
mid-tones by the same factor, so the speculars that *describe* an object vanish
at the same rate as its bulk.

The corrected rule is in §3.2. Working range is **0.45–0.50**, and the copy is
protected by *local* masking rather than by global dimming.

### Superseded: "photography and hairline vector may not be able to share a frame"

Revision 1 treated this as the main risk and the reason for a cautious spike.
**REJECTED by testing.** It is not a risk, it is the best thing in the system:
blueprint linework reading *across* photographic equipment is what makes the
objects feel like a physical studio underneath its own architectural plans.
Promoted from risk to core principle (§2).

### Superseded: "the audience footer is rejected on doctrine"

Recorded in revision 2 already; restated here because this document is now the
single reference. The audience is **owner-directed and in scope**. See §8.

### Superseded: "matched state is the key technique the plan rests on"

Still the technique for some beats, but revision 1 made the whole strategy
depend on it. **Corrected.** Per owner instruction the strategy must not depend
on matched AI generations, and §3.4 gives a transformation mechanism for the
CRT beats that needs no second image at all.

### Corrected factual errors

- **Five renders, not four. 500 credits, not 400.** CONFIRMED against the
  account balance (19,500 of 20,000 remaining) and a project listing of exactly
  five creations.
- **The harness's iframe cannot work as shipped.** CONFIRMED: `next.config.ts`
  sets `frame-ancestors 'none'` and `X-Frame-Options: DENY` on `/(.*)`, in dev
  as well as production. Verified against the running dev server. The console
  snippet is the working path; the harness needs that or a temporary local
  header change. Recorded as a known defect in `tools/`.
- **Matched state is UNTESTED**, not passed and not failed. §11.

---

## 0a. Owner-directed concepts

Not subject to unilateral removal by a later pass. Where one appears to
conflict with `docs/PRODUCT_DOCTRINE.md`, state the tension and propose a
reconciliation — do not design the concept away.

- **The audience footer.** ESSENTIAL. The audience represents viewers, human
  attention, and the destination of the work. It does **not** represent a
  closed measurement loop. Reconciliation in §8.4.
- **The unlit Department 06 door.** Preserved unchanged. It and the audience
  are complementary, not exclusive.

---

## 1. What the page actually is — CONFIRMED

Read from source and rendered at 1440×900 and 390×844.

- **One continuous camera move.** Eight scenes (`beats.ts`), 36.4 viewport-
  heights of travel, ~26,500px on desktop, each overlapping its predecessor by
  one viewport. There are no sections.
- **Two coordinate spaces.** `--j` is the monotonic timeline; `--cam` is camera
  position and may run backwards, which is what Beat 8's return needs. Spatial
  rules read `--cam`; timeline rules read `--j`. **Any plate that is a place
  must ride `--cam`. Any plate that is a state must ride `--j`.**
- **One persistent world layer.** `.cw-world` is `position: fixed`, z-index 0,
  behind every scene, `overflow: hidden`. Props sit at journey coordinate
  `--at` and drift at a per-class rate standing in for distance.
- **Everything is hairline vector on near-black.** `--void: #050607`. Far plane
  0.5, mid 0.4, near 0.58 of their wake value; department fixtures capped at
  0.3; room instruments at 0.18.
- **One accent.** `--signal: #d8ff3e`, used as instrumentation only.
- **The copy layer paints its own wash.** `.cw-layer--copy::before` lays a hard
  gradient over the left 20–36% of the frame, ramped on the room's own
  progress. Typography protection already exists; assets must respect it rather
  than duplicate it.

### Journey ranges — CONFIRMED, computed from `beats.ts`

| Scene | `--j` range | Key landmark |
|---|---|---|
| `open` | 0.000 – 0.130 | threshold at **0.114** |
| `intelligence` | 0.130 – 0.249 | Dept 01 at **0.181** |
| `strategy` | 0.249 – 0.350 | Dept 02 at **0.299** |
| `writers` | 0.350 – 0.463 | Dept 03 at **0.407** |
| `production` | 0.463 – 0.576 | Dept 04 at **0.517** |
| `control` | 0.576 – 0.689 | Dept 05 at **0.625** |
| `return` | 0.689 – 0.887 | retrieve 0.705–0.760, release 0.796–0.857 |
| `finale` | 0.887 – 1.000 | seam at **1.021**, deliberately past the end |

---

## 2. The core design principle — CONFIRMED by testing

> **Physical filmmaking objects appear as reality breaking through the
> Channelwright blueprint.**

Not sections with photographs in them. The rhythm is

```
SCHEMATIC  →  PHYSICAL REVEAL  →  SCHEMATIC
```

never

```
SECTION → IMAGE → SECTION → IMAGE
```

Three consequences that govern every decision downstream:

1. **The blueprint stays on top.** Linework reads across the photograph. The
   plate goes *into* `.cw-world`, below the depth planes — not over them and
   not into a scene. A plate that occludes the linework has failed, however
   good it looks.
2. **Objects are discovered, not presented.** Cropped by the viewport, entering
   from an edge, unresolved at the far end. Nothing is centred or complete.
3. **Absence is half the system.** §6.

---

## 3. The asset bible — revised

### 3.1 Exposure — CONFIRMED, unchanged

Author dark. One directional key, no fill, no opposite-side rim. Subjects are
described by their **edges**. Background dissolves; the frame never contains
the room's boundary. Fine grain, no gloss, no flare, no bloom.

Closing clauses to append verbatim to every generation:

```
Very dark exposure: roughly 85 percent of the image below 12 percent
luminance, highlights peaking around 60 percent, nothing clipping to white.
No text, no labels, no logos, no numerals, no signage, no people.
Not cyberpunk. No neon, no blue or purple light, no lens flare, no bloom,
no god rays.
```

(Drop `no people` for the audience assets only.)

### 3.2 Compositing — REVISED. This is the big correction.

**Uniform opacity is the wrong instrument.** Revision 1's 0.22 is REJECTED.

Two integration patterns emerged from testing, and they are genuinely
different. Choosing the wrong one is the main way this goes wrong.

#### Pattern A — WIDE PLATE, MASKED (environmental objects)

The plate spans the frame; a left-side mask carves out copy territory.

Harness values that worked for the CRT wall — TESTED:

```
opacity .45–.50 · saturation ~.80 · width ~110 · x ~10 · y 0
scale ~1.05 · fade ~45 · blend screen
```

#### Pattern B — NARROW PLATE, PLACED (environmental reveals)

The plate is small, sits to one side, and needs **no mask at all** — its own
edges do the work. Cheaper, safer, and it cannot creep into the copy band.

Harness values that worked for the soundstage — TESTED:

```
opacity .50 · saturation ~.80 · width 40 · x 15 · y 0
scale 1.15 · fade 0 · blend screen
```

**Prefer Pattern B wherever the narrative allows it.** `fade 0` means no mask
is being asked to protect the headline, which removes an entire class of
failure. Pattern A is for when the subject genuinely has to fill the frame.

Both are harness values, not production CSS. Production should reach the same
*look* through local exposure control — masking, clipping, per-region
treatment, responsive tuning — rather than one global number.

**The governing test, both patterns:** *can I still tell one object from
another, **and** is the headline still the brightest thing in the frame?* Both
must hold at once. If they cannot, the crop is wrong before the exposure is.

#### Subject vs texture

A **subject** plate (CRT wall, cinema camera) must be *crushed* — near half
strength, contrast raised, mid-tones pushed to black, lit edges intact. A
**texture** plate (haze, a dissolving hall) may simply be *dimmed*. Do not
apply the subject recipe to texture or the reverse.

### 3.3 Palette

Ground `#050607` / `#0a0c10` / `#12151b` / `#1b1f27`. Light: one paper tone
`#f2efe6`. Materials: graphite, gunmetal, desaturated silver, aged glass, muted
warm analogue plastic, dusty phosphor. Accent `#d8ff3e`, at the scale of a
tally lamp, at most one per asset, never a light source, never a colour cast.

One deliberate exception is under consideration for the finale only — see §8.5.

### 3.4 Transformation without matched generation — PROPOSED

Per owner instruction the strategy must not depend on matched AI generations.
For the CRT beats it does not have to.

**Screen activation can be pure CSS.** The dormant plate already contains the
screens. Their positions are fixed and knowable. Activation is a small set of
absolutely-positioned quads — soft radial gradients in dusty phosphor grey,
clipped to each screen's footprint, `mix-blend-mode: screen` — faded in on
`--l1`. One of them carries the acid tally.

This is strictly better than a second AI image:

- zero geometry-drift risk, because the geometry never changes;
- zero additional credits and zero additional bytes;
- the acid is the exact brand token rather than whatever the model produced;
- each screen can be timed independently, so screens can wake in sequence
  rather than all at once — which is the beat we actually wanted.

It also retires the matched-state dependency for **Beats 3 and 7 entirely.**
What it cannot do is turn a head, so §8 still has to solve the audience.

### 3.5 Forbidden

Cyberpunk; purple or blue neon; futuristic AI lab; glowing circuitry;
holograms; SaaS gradients; floating glass dashboards; robots; stock crews
smiling at camera; pristine product photography; movie posters; lens flare;
blockbuster grading; retro kitsch; visible AI surrealism. Also: **film-school
moodboard decoration.** Every object answers §5's three questions or it is cut.

---

## 4. Cinematic vocabulary — the five roles

| Role | What it is | Where it lives | Pattern |
|---|---|---|---|
| **ENVIRONMENTAL OBJECT** | A physical artifact embedded in a department | inside `.cw-world`, below the planes | A |
| **ENVIRONMENTAL REVEAL** | A glimpse of a physical studio behind the schematic | at thresholds and transitions | B |
| **TRANSFORMATION STATE** | An object responding to journey progress | CSS over an existing plate (§3.4) | — |
| **HUMAN / AUDIENCE PAYOFF** | People, reserved for the finale | outside the department architecture | own |
| **NO ASSET** | Deliberate quiet | — | — |

Human presence appears **once**, at the end. Scattering people through the
operating floor would spend the finale's only card early.

---

## 5. The three questions

Before any asset is proposed or generated:

1. **Why does this physical object appear *here*?**
2. **What does it communicate about this department or moment?**
3. **What changes because the visitor encountered it?**

If the answer to any is "it looks cinematic," the asset is cut.

---

## 6. Rhythm map — REVISED

If everything is cinematic, nothing is. Presence and absence alternate, and the
two most important frames in the film are the two quietest.

| Beat | `--j` | Weight | Carried by |
|---|---|---|---|
| 1 — Idea | 0.00–0.06 | **SILENT** | one sentence, one pip, black |
| 2 — Threshold | 0.06–0.13 | **PHYSICAL REVEAL** | soundstage through the aperture |
| 3 — Intelligence | 0.13–0.25 | **PHYSICAL OBJECT** | CRT wall + CSS activation |
| 4 — Strategy | 0.25–0.35 | QUIET | linework, artifact, verdict |
| 5 — Writers | 0.35–0.46 | **QUIET** | linework and the artifact only |
| 6 — Production | 0.46–0.58 | **PHYSICAL OBJECT** | cinema camera at the gate hold |
| 7 — Control | 0.58–0.69 | LIGHT TOUCH | CRT bank returning, one tally |
| 8 — Return | 0.69–0.89 | QUIET (recognition) | the camera move is the beat |
| 9 — Next Decision | 0.89–1.00 | **SILENT** | the unlit door |
| — Register | after | **QUIET** | the record, inside the building |
| 10 — The way out | after | **QUIET** | the architecture dissolving |
| 11 — Auditorium | last | **HUMAN PAYOFF** | the only faces in the film |

Four imagery moments in a nine-beat film, never two heavy beats adjacent, and
the longest quiet stretch (Beats 7–10) immediately precedes the payoff.

**Changed from revision 2:** Beat 4 drops from MEDIUM to QUIET and its decision
wall moves to OPTIONAL. Beats 4, 5, 8 are now three of the four quiet beats,
which is what buys Beat 11 its impact.

---

## 7. Beat-by-beat cinematic asset map — REVISED

---

### BEAT 1 — The idea · `--j` 0.000–0.060

**Purpose** One idea, in the visitor's own words.
**Role** NO ASSET.
**Subject** None.
**Why** The emptiness is the beat. It is the darkest frame in the film and it
earns everything after it. This is the most tempting and most damaging place to
add something.
**Composition / Interaction / Blueprint / Typography** unchanged.
**Desktop / Mobile** unchanged.
**Reuse / New** neither.
**Priority: NO ASSET.**

---

### BEAT 2 — The threshold · `--j` 0.060–0.130, aperture at **0.114**

**Purpose** The turn. The building opens and the camera crosses into it.
**Role** ENVIRONMENTAL REVEAL — Pattern B.
**Subject** The soundstage: cinema camera on a dolly cropped right, lighting
stand entering upper left, cable and sandbags on the deck, everything falling
into black by mid-frame.
**Why** CONFIRMED gap: the camera currently crosses a lit doorway and finds
identical linework behind it. The best moment in the run has no payoff. This is
where "a physical studio exists behind the schematic" is *stated*.
**Composition** 3:4 portrait — `.cw-threshold` is `min(22vw, 25vh)` by `34vh`.
Top 20% unlit for the lintel. Clipped to the aperture so it cannot leak.
**Interaction** Opacity on `--reveal`, scale on `--close`, both existing. The
plate is a *place*, so it rides `--cam`.
**Blueprint** The aperture frame and its lintel type sit over the plate; the
truss passes above it. Photography strictly inside the doorway.
**Typography** `CHANNELWRIGHT STUDIOS` on the lintel — top 20% must stay unlit.
**Desktop** As described. **Mobile** Same plate, tighter crop: the mobile
aperture is `min(26vw, 14vh)`, so the composition must survive at ~100px wide —
one readable silhouette, not a scene.
**Reuse** YES — `soundstage-threshold-v1` or `v2`, already generated. TESTED at
Pattern B values.
**New asset** No.
**Priority: ESSENTIAL.**

---

### BEAT 3 — Department 01, Intelligence · `--j` 0.130–0.249, dept at **0.181**

**Purpose** Evidence before strategy. Three angles rejected.
**Role** ENVIRONMENTAL OBJECT (Pattern A) + TRANSFORMATION STATE (§3.4 CSS).
**Subject** The vintage CRT / broadcast monitor wall.
**Why** Two jobs at once. CONFIRMED weakness: `Fixture` draws the same bordered
cell grid five times with only a tint to tell the rooms apart, so Department 01
is not visually a research wall. And this is the room that *looks at many
things and rejects most of them* — a wall where a few screens resolve and most
stay dark is that claim made physically.
**Composition** 21:9. Bank right 55–60%, cropped right and bottom. Left 40%
unresolved black.
**Interaction** Plate opacity on `--fixtures-on`; screens wake in sequence on
`--l1` via CSS quads, not a second image. One carries the acid tally.
**Blueprint** The existing fixture cell grid stays, reduced, **in front of** the
plate — vector grid over photographic glass is the seam this whole direction is
about.
**Typography** Three-line display at ~180–280px from top-left. That quadrant
stays black; `fade ~45` protects it.
**Desktop** Pattern A. **Mobile** Fixtures are `display:none` under 720px — a
separate tight 4:5 crop of 5–6 televisions, or nothing.
**Reuse** YES — `crt-wall-state-a-v1`. TESTED and passed at full exposure.
**New asset** No — §3.4 removes the need for a State B.
**Priority: ESSENTIAL.**

---

### BEAT 4 — Department 02, Strategy · `--j` 0.249–0.350, dept at **0.299**

**Purpose** The idea acquires an audience and a dormant hypothesis.
**Role** NO ASSET for now (was PROPOSED environmental object in revision 1).
**Why the downgrade** Rhythm. Beats 2 and 3 both carry imagery; Beat 6 needs to
land. A decision wall here would make four consecutive image beats. Its only
real value was as setup for Beat 8's recognition, and Beat 8 is now carried by
the camera move — which is already the strongest thing in that beat.
**Reuse / New** neither.
**Priority: OPTIONAL** — revisit only if Beat 8 tests as under-supported.

---

### BEAT 5 — Department 03, Writers' · `--j` 0.350–0.463, dept at **0.407**

**Purpose** Something checked it before you did. One section sent back.
**Role** NO ASSET.
**Why** The claim is procedural and already carried by the artifact's own
section strip and the sequencer. A storyboard wall here is the cliché, not the
story, and it would break the quiet stretch the film needs.
**Priority: NO ASSET.**

---

### BEAT 6 — Department 04, Production · `--j` 0.463–0.576, dept at **0.517**

**Purpose** Finished is not the same as cleared. Held at the gate.
**Role** ENVIRONMENTAL OBJECT — Pattern B preferred.
**Subject** A cinema camera, large, cropped, mostly silhouette, entering from
the **left** edge; matte box and rods catching the key.
**Why** The room where the work becomes a *thing*, and the only beat where the
artifact stops moving — so the frame can carry mass without competing. CONFIRMED
from the render: this room's headline is **centred**, so the left edge is free
here and nowhere else.
**Composition** Subject left, ~35% width, cropped by the left edge. Centre
column 20–40% frame height must stay black for the two-line headline.
**Interaction** Rises as the gate closes, holds through the QA sweep, exits as
the artifact clears. The acid sweep band passes **in front of** the camera body
— physical object, digital check, one crossing.
**Blueprint** Conveyance line and gate leaves over the plate.
**Typography** Centred headline; centre column protected by placement, not mask.
**Desktop** Pattern B mirrored to the left. **Mobile** Tight 4:5 crop of matte
box and lens, bottom-left.
**Reuse** PARTIAL — the soundstage plate contains a cinema camera and could
stand in for a spike. Shipping the same plate in Beats 2 and 6 is REJECTED: at
two points in one film the visitor will notice.
**New asset** YES, eventually — SUPPORTING, not minimum-validation.
**Priority: SUPPORTING.**

---

### BEAT 7 — Department 05, Control · `--j` 0.576–0.689, dept at **0.625**

**Purpose** Publishing is a decision. Someone makes it. 1 of 5 chosen.
**Role** TRANSFORMATION STATE — no new asset.
**Subject** The Beat 3 CRT bank, seen later, with exactly **one** screen
carrying the acid tally.
**Why** The argument is "one of these, chosen by a person." A tally on exactly
one monitor says it in one frame. It must be the *same wall* or the building
stops being one building.
**Interaction** Same plate, different CSS activation set. Reaches Pattern A at
lower opacity than Beat 3 — the room has already been established.
**Reuse** YES — same plate as Beat 3, no second download.
**New asset** No.
**Priority: SUPPORTING.**

---

### BEAT 8 — The Return · `--j` 0.689–0.887; retrieve 0.705–0.760, release 0.796–0.857

**Purpose** A pipeline forgets; this one comes back. The camera travels
backwards to Department 02 while the story advances.
**Role** NO ASSET.
**Why** CONFIRMED from source: the beat *is* the camera move, and the code
comments record that the room deliberately has no instrument because nothing is
being done to the artifact here. Adding imagery would compete with the one
mechanic the beat exists to demonstrate. It is also the last long quiet before
the ending.
**Note** If Beat 3's plate is visible during the reverse traverse it must ride
`--cam`, not `--j`, or the return will rewind the story as well as the camera.
**Priority: NO ASSET.**

---

### BEAT 9 — The Next Decision · `--j` 0.887–1.000; seam at **1.021**

**Purpose** The room that is not built. `06 — ANALYTICS COMMAND`,
`DESIGNED, NOT BUILT`.
**Role** NO ASSET inside the aperture. Preserved exactly as it is.
**Why** The emptiness is the argument, and it is what lets Beat 11 read as
*outside* the system rather than *through* the door.
**Exception** A barely perceptible dust-and-haze plate inside the aperture —
"empty room" rather than "flat panel", no object in it. OPTIONAL, and only if it
survives being almost invisible.
**Priority: NO ASSET** (OPTIONAL for the haze variant).

---

### BEAT 10 — The way out · after the capability register

**Purpose** The visitor leaves the building. Not through Department 06 — away
from it.
**Role** NO ASSET. CSS on existing elements.
**Subject** None. Everything already on screen, leaving.
**Why** The doctrinal load-bearing member. Without an explicit exit, an
audience appearing after Department 06 could be misread as being through it.
**Composition** The hall shell comes apart in a fixed order: truss, jambs,
floor grid, wash. The conveyance line is **last** and *ends* rather than fades —
the artifact's route terminates when the work is published.
**Interaction** What remains drifts **opposite** to the direction it held all
film. The visitor has turned around. Its own progress via `registerScene`;
`--cam` is journey-scoped and does not reach here.
**Desktop / Mobile** Same logic; mobile has fewer elements to dissolve.
**Priority: ESSENTIAL** — required by Beat 11, worthless without it. If cut for
length, Beat 11 must be cut with it.

---

### BEAT 11 — The auditorium · the page's last frame

**Purpose** The site has shown the machinery that makes media. The end reveals
the humans on the other side of it. *"They're waiting. What are you going to
make for them?"*
**Role** HUMAN / AUDIENCE PAYOFF.
**Subject** A dark auditorium. Three approaches in §8 — not yet chosen.
**Why** CONFIRMED gap: doctrine Principle 4 ("Viewer value is mandatory") is
binding and is the only principle the page never depicts. Department 02's own
line is *"Don't chase views. Build an audience"* — the building names an
audience and never shows one.
**Composition** Audience low in frame, running off both edges. Upper 35%
unresolved black for the line and the action.
**Interaction** The turn / reveal, resolving at the **true document bottom**.
Final CTA on `Scene`'s existing `revealAt` so it is not a tab stop early.
**Blueprint** Minimal or none — the architecture has dissolved by now. This is
the one frame where the schematic does *not* overlay the photograph, and that
absence is how the visitor knows they are outside.
**Typography** Upper-left over black. No face in that quadrant in any state.
**Desktop** 21:9. **Mobile** Separate tighter crop, 8–12 people, nearer.
**Reuse** No. **New asset** YES — the only ESSENTIAL new generation.
**Priority: ESSENTIAL.**

---

### Capability register / archive

**Role** NO ASSET. This is the record; it should look like a record.
**Priority: NO ASSET.**

---

## 8. The audience footer — three Channelwright-native approaches

PROPOSED. Not generated. Not chosen.

Shared constraints for all three:

- The audience is **waiting, never reacting.** No applause, no laughter, no lit
  screen, no reaction, no metrics. That, and only that, is what would falsely
  claim a closed measurement loop.
- Faces mostly in shadow, unsmiling, non-specific, no held eye contact from
  more than one or two figures. Restraint is the difference between "they're
  waiting" and a horror beat.
- No text, no numbers, no interface anywhere in frame.

### 8.1 Approach A — "The Screening"

Camera among the rows, slightly low, looking across seat backs toward a dark
screen. Light comes from ahead, so the audience is seen as rim-lit silhouettes.
As the visitor descends, heads turn; as they turn, the lenses catch the screen
light and become the only colour in the film.

- **Turn mechanism:** matched plates, A → A′ → B, staggered so the turn moves
  through the crowd as a wave rather than a mass dissolve.
- **Closest to** the owner's described interaction. The glasses reveal is a
  genuine payoff.
- **Risk: HIGH.** Depends entirely on matched-state generation, which is
  UNTESTED, on the hardest possible subject.

### 8.2 Approach B — "Rows in depth"

The crowd is decomposed into three or four **separate row-band plates** with
transparent backgrounds, each its own layer, parallaxed against each other on
scroll. Only one band crossfades between states at a time.

- **Turn mechanism:** per-band matched pairs — much smaller, and a band that
  fails can be regenerated alone without redoing the crowd.
- **Also buys** real parallax depth for almost nothing.
- **Risk: MEDIUM.** De-risks matched state by decomposing it, but alpha cutouts
  of hair are where background removal is weakest, and it is 6–8 plates rather
  than 2–3, which fights the performance budget on the heaviest images in the
  plan.

### 8.3 Approach C — "They were always there" — RECOMMENDED

**One plate. No matched state at all.** The audience is already oriented toward
the visitor, but in near-total darkness — effectively invisible on arrival.
Scrolling does not turn heads; it **raises the light.** A cool glow ramps up
from behind the camera and the audience resolves out of black, the lenses
catching last.

- **Turn mechanism:** none needed. The reveal is an opacity and a light ramp on
  a single image.
- **Why it is the strongest Channelwright reading:** emergence from darkness is
  the page's entire existing grammar — the hall wakes by depth, the threshold
  resolves out of black, Department 06 stays unlit. This is that grammar
  applied to people, and it says something the turn does not: *they were always
  there; you just could not see them yet.*
- **Risk: LOW.** One asset, no untested dependency, cheapest, most performant,
  and it degrades gracefully on mobile and reduced motion.
- **Cost:** it delivers "the audience is revealed" rather than "the audience
  turns." That is a genuine narrative difference and it is the owner's call.
- **Hybrid worth considering:** C for the mass of the crowd, plus a single
  matched pair for the **front row only** — four or five near heads that
  actually turn. Most of the emotional payoff of A, with matched-state exposure
  reduced to one small plate pair that can be abandoned without losing the beat.

### 8.4 Why none of these claims a closed measurement loop

- The screen the audience waits in front of is **dark**. Nothing has played;
  nobody in frame has watched anything.
- Department 06 is an unlit door; the auditorium is an unlit screen. Two dark
  objects making the same statement from opposite sides — machine register and
  human register. They reinforce the capability register rather than fight it.
- The audience is not a department. No index, no status, no capability claim.
  Beat 10 makes that structural fact visible rather than asserted.
- **Structural rhyme to protect:** the film ends by walking *out* of the studio
  to meet the audience, and the only action offered there is `Enter the studio`.
  The visitor is placed in the creator's position without a word of explanation.
  Do not let a later copy pass paraphrase that CTA away.

### 8.5 The 3D glasses — a deliberate palette exception, needing sign-off

Red/cyan glasses introduce two colours into a strictly desaturated film. Two
ways to hold that:

1. **Accept it as the single exception.** The lenses are the only colour in the
   film besides acid, and they appear only in the final frame. Defensible and
   powerful, but it is a real break in a system that has been disciplined for
   nine beats.
2. **Tune the lenses to tokens the site already owns** — `--warn: #ff6846` and
   `--pass: #91e6c1`. Warm and cool, red-ish and cyan-ish, unmistakably the
   glasses, and *already in the palette*. **Recommended.** It gets the
   cinematic reference without inventing a colour system on the last frame.

Either way the lenses are small, dark, and catch light rather than emit it.

---

## 9. Minimum next Magnific generation set

The discipline here is that most of the plan needs **no new credits**:

- Beat 2 reuses `soundstage-threshold-v1/v2` — TESTED.
- Beat 3 reuses `crt-wall-state-a-v1` — TESTED.
- Beats 3 and 7's transformation is CSS (§3.4) — no asset.
- Beats 1, 4, 5, 8, 9, 10 and the register take no asset at all.
- Beat 6 needs a new plate eventually, but it is SUPPORTING.

That leaves exactly one gap that new credits must close.

### The minimum set: 2 renders (one call, `count` 2), 200 credits

**Subject** A dark auditorium seen from the screen. Rows of seated people,
cropped by both edges and the bottom so the room is larger than the frame.
Distinctive cinematic viewing language — glasses whose lenses catch light —
tuned warm/cool rather than saturated red/cyan. Faces mostly shadowed,
unsmiling, waiting. Nobody reacting. The screen is not visible and is not lit.

**Intended beat** 11, the page's last frame.
**Asset role** HUMAN / AUDIENCE PAYOFF.
**Aspect ratio** 21:9 desktop. (Mobile crop deferred until the language passes.)
**Composition** Audience occupying the lower 60%, nearest row cropped by the
bottom edge so the visitor is *among* them. Upper 35% unresolved black.
**Lighting** The inversion: the only light comes from behind the camera and
falls on faces, shoulders and seat backs. No light source visible in frame.
**Negative space** Upper-left quadrant absolutely clear — the final line and CTA
live there. No face may enter it in any state.
**Channelwright requirements** §3.1 exposure clauses minus `no people`;
desaturated except the lens tints; no text, no numbers, no screen content;
no reaction of any kind.
**Matched-state consistency required?** **No — deliberately.** Two variants of
one prompt, to choose the better composition. Under Approach C the footer needs
only one plate, so this set does not depend on the untested technique.
**Why it deserves credits** It is the only ESSENTIAL asset with no existing
substitute, and it validates the last unvalidated role in the vocabulary. Two
of the five roles are TESTED; two need no asset; this is the fifth.

### Deliberately deferred

- **A matched CRT State B** — §3.4 removes the need, and §11 is unresolved.
- **A dedicated Beat 6 camera** — SUPPORTING; the spike can stand in.
- **Mobile crops** — until the desktop language passes.
- **Storyboards, director's chair, clapperboard, film reels, studio lights,
  teleprompter** — REJECTED for now. None survives §5's three questions:
  they decorate, they do not advance. Revisit only if a specific beat is found
  to be under-carried.

---

## 10. Test results log

| Item | Status | Evidence |
|---|---|---|
| CRT base composition | **TESTED — PASS** | Owner review at full exposure: varied sizes, curved glass, knobs, mixed eras, irregular stacking, asymmetric wall, left negative space |
| CRT at `opacity .22` | **TESTED — FAIL** | CRT character buried; reads as an equipment rack |
| CRT at Pattern A values | **TESTED — PASS** | Televisions recognisable, headline still dominant |
| Soundstage at Pattern B values | **TESTED — PASS** | Camera unmistakable, equipment subordinate, blueprint continued across it, clean left copy territory |
| Blueprint over photography | **TESTED — PASS** | Promoted to core principle §2 |
| Matched-state technique | **UNTESTED** | §11 |
| CSS screen activation (§3.4) | **PROPOSED** | Zero-credit spike would settle it |
| Audience language | **PROPOSED** | §9 |
| Harness iframe | **CONFIRMED BROKEN** | `frame-ancestors 'none'` + `X-Frame-Options: DENY` verified against the dev server |

---

## 11. Matched state — UNTESTED, and the duplicate-file investigation

**Status: UNTESTED.** Not passed, not failed. Nothing downstream may assume
either result.

### What happened

Three downloaded CRT files were found **pixel-identical**, at **2048×877** —
dormant variant 1, dormant variant 2, and the supposed active state.

### What the platform metadata says — CONFIRMED

| | asset ID | batch family | seed | reported size | created |
|---|---|---|---|---|---|
| A-v1 | 5366566439 | `a2ae2fb5…` | 318661 | 3024×1296 | 10:21:24Z |
| A-v2 | 5366566268 | `a2ae2fb5…` | 617339 | 3024×1296 | 10:21:24Z |
| B | 5366581567 | `a2ae30c9…` | 931176 | 3024×1296 | 10:24:25Z |

A project listing returns exactly five creations, each with its correct prompt
stored — the active-state prompt is recorded against B, so the request was not
silently dropped.

### Cause — as far as it can be established

1. **Distinct URLs were issued.** Three asset paths, three signed hashes. The
   duplication was not caused by supplying the same link three times.
2. **The sizes do not match.** Every render is 3024×1296; every downloaded file
   is 2048×877 — the same aspect, downscaled to 2048 wide. The files in hand did
   **not** come from the full-resolution asset URLs, and whatever path resized
   them is the prime suspect.
3. **A-v1 ≡ A-v2 is the anomaly that matters.** Different seeds, no reference
   image, separate assets. There is no plausible generation-side story for two
   different seeds producing identical pixels. A reference pass-through could
   explain B ≡ A-v1; nothing explains A-v1 ≡ A-v2 except a retrieval, cache or
   save collapse.
4. **INFERRED, not verified:** the fault is most likely in the download path,
   not in generation. This session cannot fetch the bytes — the CDN is denied by
   the environment's egress policy — so nobody has confirmed whether the three
   server-side assets actually differ.

### Three free checks that settle it

- **Control.** Compare the two soundstage files to each other. Both identical →
  the fault is systemic in the download path. Different → the path works and
  something specific hit the CRT three. *Highest information, 30 seconds.*
- **Clean re-fetch.** Download the three full-resolution URLs one at a time in a
  fresh private window, renaming each before the next, then hash. Correct files
  are **3024×1296**; anything 2048 wide is the wrong asset.
- **Independent path.** Fetch the three 1024-wide preview variants and hash
  those — different signatures, different resize pipeline.

**Regardless of outcome: do not regenerate the base CRT composition.** It has
been reviewed at full exposure and it is right.

---

## 12. Performance doctrine — unchanged

No WebGL, no video backgrounds, no image sequences, no new runtime mechanism.
Every moment is one or two static plates riding custom properties the page
already computes.

| Beat | Technique | Cost |
|---|---|---|
| 2 | one plate clipped to `.cw-threshold`, existing `--reveal` / `--close` | LOW |
| 3 | one plate + CSS activation quads on `--l1` | LOW |
| 6 | one plate, opacity on the scene's `--p` | LOW |
| 7 | same plate as Beat 3, different activation set | LOW |
| 10 | CSS only | LOW |
| 11 | one plate (Approach C) + a light ramp | LOW–MEDIUM |

**Budget:** four desktop plates and two or three mobile crops. AVIF ~55 —
near-black images compress extraordinarily well; expect 40–90KB for the
equipment plates. **The audience plate is the exception:** faces and skin do not
compress like black metal — budget 150–220KB and lazy-load it, since it sits
several viewports below the fold. Estimated desktop total well under 500KB.

**Mobile is composed, not scaled.** At most two plates: the threshold and one
CRT crop, plus the audience crop at the end. The far plane, partitions and
fixtures are already dropped under 720px; mobile reproduces the *story*, not the
geometry.

Measure before shipping: paint time on a mid-tier Android before and after. If a
plate costs more than ~1ms, cut its resolution, not its opacity.

---

## 13. Recommended next phase

### **B — build temporary integration spikes with the existing CRT + soundstage
assets, before any new generation.**

Evidence, not assumption:

- Both plates are **TESTED and passed** in the harness. The next real unknown is
  not whether the images are good, it is whether they survive **in the real
  scroll** — at transitions, under the blueprint, while the camera moves, at
  `--cam` versus `--j`, and on a phone. The harness is static; the page is not.
- The **§3.4 CSS activation spike costs zero credits** and would retire the
  matched-state dependency for Beats 3 and 7 outright. That is the single
  highest-value experiment available and it needs no images at all.
- Spiking first makes the audience generation better: the spike will produce
  real production values for opacity, masking and placement, and those should
  inform the audience prompt rather than being discovered after it.
- The §11 checks are free and should run in parallel.

Then **A — the two-render audience set** (§9), once the spikes pass and the
download question is resolved.

**Not C:** the plan is not the blocker; the visual language is validated.
**Not D:** two of five roles are TESTED and passed, and the imagery demonstrably
adds something the schematic alone cannot — physical materiality, and a face at
the end of a film about machinery.

---

## 14. Open risks and unanswered questions

1. **Matched state is unresolved (§11).** Mitigated for Beats 3 and 7 by §3.4,
   and avoidable in Beat 11 under Approach C — but the question is still open,
   and Approach A depends on it entirely.
2. **`--cam` versus `--j` for plates.** UNTESTED. A plate that is a *place* must
   ride `--cam` or the Return will rewind it wrongly. This is a real trap that
   the spike must exercise deliberately, not discover in production.
3. **The blueprint-over-photography effect at low contrast.** TESTED on a static
   frame; UNTESTED while the linework is *moving* at three different parallax
   rates over it. Moiré between the hairline grid and CRT scanlines is a
   plausible artefact nobody has looked for.
4. **Mobile.** Entirely UNTESTED with imagery. The mid-band is empty at 390px
   and needs its own compositions.
5. **The 3D glasses palette exception (§8.5)** needs an owner decision before
   the audience prompt is written.
6. **Approach A vs C for the finale (§8)** is a narrative decision — "the
   audience turns" versus "the audience is revealed" — and it changes the asset
   count, the risk profile and the emotional register. Owner's call.
7. **The harness iframe defect** is unfixed in the repo; the console snippet is
   the working path.
8. **Beat 6's plate** would be the fourth distinct image in the film. Worth
   asking whether the film needs four, or whether three is the right number and
   Beat 6 should be carried by the gate hold alone.
