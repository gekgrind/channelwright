# Studios plates — FINAL Magnific artwork

`crt-wall.jpg` and `soundstage-threshold.jpg` in this directory are the final
Magnific plates, copied from `public/design-assets/` (the untouched source of
truth) for delivery. They replace the geometry- and tone-matched synthetic
stand-ins used during the structural spike.

| File | Dimensions | Aspect |
|---|---|---|
| `crt-wall.jpg` | 3024×1296 | 21:9 |
| `soundstage-threshold.jpg` | 1728×2304 | 3:4 |

Both match the stand-ins' aspect ratios exactly, so the plate-level CSS in
`src/features/studios/studios.css` (position, drift rate, mask, scale,
opacity) needed no change for the swap itself.

`next/image` emits AVIF/WebP and a responsive srcset from these JPEGs
automatically — no code change needed for that.

## Screen quads

The CRT screen quads in `src/features/studios/plates.tsx` (`SCREENS`) were
re-derived against the real photograph's visible glass apertures (measured as
percentages of the 3024×1296 frame). The stand-in coordinates they replaced
are in git history if needed for comparison.

## `soundstage-threshold-tight.jpg`

A crop of `soundstage-threshold.jpg`, not a second generation — the cinematic
plate audit found the source frame roughly 70% unbroken ceiling above the rig,
and the threshold's own proportions meant `object-fit: cover` barely touched
that emptiness, so the plate read as a mostly-black photograph hung in a door
frame rather than a place with a camera standing in it. The crop removes the
dead band above the light head (top 14% of `soundstage-threshold.jpg`,
1728×1982 remaining); the light, the camera and the deck are untouched.
`public/design-assets/soundstage-threshold.jpg` stays the untouched source —
this file is a delivery-only derivative, built the same way `crt-wall.jpg` and
`soundstage-threshold.jpg` themselves are copied here rather than edited in
place. `ThresholdStage` in `plates.tsx` references this file, not the
uncropped original.

## `production-department.jpg` / `production-department-mobile.jpg`

Department 04's plate for Beat 6 — the review/clearance console, seated
operator, monitor bank left-of-centre, dark negative space to the right.
Source is `public/design-assets/production-department.png`, 2560×1440,
5.4MB, and stays untouched there. `production-department.jpg` is a
delivery-quality JPEG derived from it (480KB) — not a second copy of the
PNG itself, the same pattern `soundstage-threshold-tight.jpg` already uses.
Keeping the exact PNG in both places was the original delivery, and is
where the "duplicated asset" finding came from; the other two plates get
away with an exact duplicate because they're already small JPEGs from
Magnific, and this one, at 5.4MB, did not.

`ProductionGate` in `plates.tsx` mirrors the desktop/tablet plate — the
console sits left-of-centre in the source, and every plate on this page
reserves its own *left* ~30% for the reading column, so the flip is what
lands the operator in the surviving half. Tuned against the real image: the
plate is shifted left and gets its own right-edge fade so the travelling
artifact card clears the monitor bank rather than sitting on top of it, and
its reach into Department 05 was tightened (`.095` against the CRT wall's
`.155`, and `.cw-plate--crt-control` matched to the same value) after the
untightened version left the console and Control's wall visibly overlapping
through the handoff — measurably worse in reverse (Beat 8's return) than
forward, because `--l5` is `--j`-gated and stays at 1 for the rest of the
page once the visitor has passed Control once, exposing the reach mismatch
on every later pass through the gap in either direction.

`production-department-mobile.jpg` is a separate, tighter crop (871×993),
not a scaled-down version of the wide plate — a self-framed Pattern B crop
of just the monitor bank and the operator's head and shoulders, the same
grammar the soundstage threshold already uses on a phone. Department 04 is
the one room in the journey with no physical object at all if it is also
omitted below 720px, so it gets its own phone element instead of following
the CRT wall's omission — see the implementation report for why that
precedent didn't transfer.

## Audience footer — `audience-turn.mp4` / `audience-turn.webm`

The footer's head-turn is a continuous video asset, not a plate sequence. The
component (`src/features/studios/audience-footer.tsx`) expects it here:

| File | Required | Notes |
|---|---|---|
| `audience-turn.webm` | optional | Offered first; drop the entry from `AUDIENCE_VIDEO` if it does not ship, rather than leaving a source that 404s on every load. |
| `audience-turn.mp4` | yes | H.264 — the universal fallback. |

Two constraints on the artwork, both because stills stand behind the video:

- **Its first frame should match `public/footer/1-*.webp`**, which is painted
  underneath until the video has decoded a frame. A mismatch shows as a jump at
  the moment the video is revealed.
- **Its final frame should match `public/footer/4-*.webp`**, which is swapped in
  underneath once the video ends. That swap happens *under* the held final
  frame, so a mismatch is only visible if the browser drops the frame — but it
  is also what a failed load falls back to, and what reduced motion shows.

16:9. The frame it fills is `object-fit: cover`, so a small aspect difference
crops rather than stretches. It is fetched with `preload="auto"` and has the
whole page's scroll to buffer, so keep it small enough that this is polite on a
phone connection.
