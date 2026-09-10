---
agent: Claude Code
project: Channelwright
task: Cinematic audience footer for /studios-preview
date: 2026-09-10
branch: `feat/cinematic-audience-footer`
base: `origin/main` @ a2d49e3
status: `IMPLEMENTED — ALL LOCAL GATES PASSED + BROWSER VISUAL QA COMPLETED; AWAITING INDEPENDENT VERIFICATION`
merged: NO (do not merge to main)
---

# Cinematic audience footer

## Why this note is in the repository

The canonical Channelwright vault at `C:\Obsidian\Entrepreneuria HQ\02 - Channelwright`
is a Windows path and this implementation ran in a Linux container with no vault
mounted — searched and confirmed absent, not assumed. This note is therefore the
repo-local handoff. **It still needs to be mirrored into the vault**, alongside
the older `obsidian-round7-pending.md`, which is a separate and still-unresolved
mirror from a prior session.

`docs/agent-handoffs/current.md` describes CHANNEL_VIDEO_INTELLIGENCE and is
unrelated to this work. It was deliberately left alone.

## Assets

Four plates, committed to this branch before implementation began, 2560x1440:

| Path | Role |
| --- | --- |
| `public/footer/1-master-reference.jpg` | Base plate. The whole audience watching the unseen film. Painted at all times. |
| `public/footer/2.jpg` | First notice. Pixel-registered to plate 1. |
| `public/footer/3.png` | Mid-transfer. 5.9 MB lossless source. |
| `public/footer/4.jpg` | Settled. The direct stare, and the reduced-motion state. |

Sources are never modified. `scripts/build-footer-assets.py` derives the WebP
variants that are actually served (`{1..4}-1920.webp`, `{1..4}-1100.webp`).
Quality 88 was chosen by measuring high-pass energy against the sources: grain
retention is 95-108%, so the deliberate analog texture survives.

## Measurements that drove the design

Everything below was measured from the plates before any code was written.

- **A crossfade is unusable.** The glasses are small high-contrast rectangles
  that move several times their own width when a head turns. Any blend of two
  poses renders both — four lenses, two noses. Present at every fraction from
  ~0.2 to ~0.8, on sharp middle-row faces *and* on soft foreground heads, and it
  survives a 55% luminance cut because the doubling is structural, not tonal.
- **Plate 2 is pixel-registered to plate 1** (NCC 0.99, zero offset on every
  landmark). Plates 3 and 4 drift per-person by up to ~36px in inconsistent
  directions; no global scale or translation improves the fit, so it is
  generative drift, not a camera move. A full-frame transition would slide the
  whole audience.
- Per-person change magnitudes established who actually turns, and when.

## Architecture

- `src/features/studios/audience-footer.tsx` — `AudienceFooter` (scrolled) and
  `AudienceFooterStatic` (reduced motion).
- **Scroll driver: the existing one, unchanged.** `Scene` (travel 6) + `Cue`
  over `registerScene` / the Lenis-driven single rAF pass. No GSAP, no second
  loop, no per-frame React, no canvas, no WebGL. Every layer derives opacity
  from `--t` / `--tw` in CSS; masks are static geometry.
- **Layering.** Base plate always painted. Each pass is a full-frame plate layer
  revealed through a static feathered mask, plus a shadow layer with a larger,
  softer copy of the same mask. Because every layer is the same 16:9 frame at
  the same size, co-registration is free and each plate decodes once regardless
  of how many layers reference it.
- **Transition model: dip-to-shadow cut.** A broad soft shadow reaches ~99%
  depth over a region; the plate underneath swaps on a ramp 0.6% of the pass
  wide, sitting entirely inside the darkest part; the light lifts on people now
  facing the camera. Two poses are never both readable. This is also the only
  diegetic option — the room's only light source is the film.
- **Masks cover the union of each person's poses**, not the final head. Sized
  from measured change bounding boxes. Masks fitted to the finished pose left
  the curly man's plate-1 profile showing beside his new frontal head — caught
  in browser QA, fixed by enlarging.
- **Alignment.** `.cw-aud__frame` is a real 16:9 box sized to cover the stage,
  so plate space and mask space are the same space at every viewport. With
  `background-size: cover` the crop — and every face's position — would shift
  with viewport aspect and the masks would drift off the heads.

## Choreography

Eight passes over 5 viewports of travel. Opening hold to p=0.12, final hold from
p=0.86.

| p (peak) | Pass | Plate | Who |
| --- | --- | --- | --- |
| 0.175 | notice | 2 | curly man, centre man |
| 0.335 | right | 3 | right woman, rear woman right |
| 0.405 | centre | 3 | dark-hair woman, rear man centre |
| 0.545 | deepen | 4 | curly man, centre man, rear blonde |
| 0.615 | settle | 4 | dark-hair woman, right woman, rear woman right |
| 0.690 | near-left | 4 | foreground left |
| 0.750 | near-right | 4 | foreground right |
| 0.810 | nearest | 4 | foreground centre |

Order is taken from the plates, not the x-axis: centre-right first, then a jump
to the far right, then centre, then *back* to the pair who started it, and only
then the foreground — the people nearest the visitor look up last. Passes 2/3
and 4/5 imbricate by about a third so two shadows live at once in unrelated
parts of the room.

## Identity continuity — deliberate exclusions

- **Blonde woman and cable-knit sweater man (mid-left): never transition.** They
  hold the same upward pose in all four plates; their measured difference is
  drift and relighting, and they carry the two largest landmark offsets in the
  set. They are also the reason the last frame does not read as choreography —
  two people never notice.
- **Left-edge man and rear-left man: excluded**, too little change to be worth a
  shadow pass.
- **Centre man skips plate 3 entirely** (routed 1 → 2 → 4). His plate-3 likeness
  has visibly different hair volume and face shape. Identity beat coverage.

## Responsive

- **Desktop** full-bleed; past 16:9 the frame is width-driven, so wide monitors
  simply see more room.
- **Phones (<=720px)** get a different composition, not a shrink: a 70svh
  widescreen band aimed left-of-centre (`left: 56%`) at the people who carry
  beats — both men, the woman between them, two of the rear row, and the head
  that turns last. A 16:9 plate covering a portrait viewport would be ~4 screens
  wide and show a quarter of one row. Serves the 1100px variants.

## Reduced motion

`AudienceFooterStatic` renders instead of the scene — the animated scene is
absent from the DOM entirely (verified: 0 scenes, 1 static). Plate 4 held still,
full-width band, then the existing footer. Not the animation stopped part-way and
not the artwork withheld.

## Footer integration

The audience sits inside `.cw-archive` between `CapabilityRegister` and the
existing `Footer`, which is untouched. The scene unpins and the footer scrolls up
over the settled stare. The archive hall was bleeding through the audience's mask
fades (ghost floor line, gutter-width tonal band); the audience stage now carries
its own opaque ground.

## Performance

Measured in-browser, after scrolling to the footer:

- 1440x900: **829 KB**, 4 files (201/199/206/223 KB).
- 390x844: **240 KB**, 4 files (59/59/59/64 KB).
- Raw sources would have been 7,190 KB — an 88% reduction with grain intact, and
  `3.png`'s 5.9 MB never reaches the wire.

CSS is additive only: 184 insertions, 0 deletions in `studios.css`.

## Gates

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, 0 errors |
| `npx vitest run src/features/studios` | PASS, 2 files / 30 tests |
| `npm test` | PASS, 116 files / 1674 tests |
| `npm run build` | PASS, 9 static pages, `/studios-preview` prerendered |

## Visual QA

1440x900 (18-state sweep plus all 8 pass peaks), 1920x1080, 390x844, 430x932,
reduced motion, and the footer handoff. Defects found and repaired in-browser:

1. Ghost glasses readable inside the shadow — shadow deepened to 0.99, swap ramp
   narrowed to 0.6% of the pass.
2. Curly man's plate-1 profile visible beside his new head — masks enlarged to
   cover pose unions.
3. Six foreground regions darkening together read as the page dimming — split
   into three separate beats; shadow halo now shrinks as region size grows.
4. Mobile frame did not cover the stage and cropped out the hero — rebuilt as a
   deliberate 70svh band.
5. Archive hall bleeding through the mask fades — opaque stage ground.

Crossover verified by fine sampling (p=0.172/0.174/0.175/0.176/0.178) and, at the
tightest shadow-to-mask ratio, at 3.2x brightness lift: a single pair of glasses
at every sampled position.

## Open risks

- Verified only in headless Chromium at DPR 1. `mask-composite` and multi-layer
  masks want a check in Safari and Firefox, and on a real retina phone.
- Plates render at 1920 wide; on a >1920 DPR-2 display the artwork upscales. It
  is a deliberately soft aged photograph so this is judged acceptable, but it is
  a judgement, not a measurement.
- Scroll smoothness was not profiled under CPU throttling. The work per frame is
  opacity on composited layers with no JS, so the risk is low, but unmeasured.
- Mask geometry is hand-placed from measured boxes. If the plates are ever
  re-generated, `CAST` must be re-derived.

## Next action

Independent visual review at `/studios-preview`, then Safari/Firefox and a real
device pass. Mirror this note into the Obsidian vault. Do not merge to `main`
until reviewed.
