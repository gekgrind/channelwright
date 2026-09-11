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

## `production-department.png` (pending)

Department 04's new plate — the review/clearance console for Beat 6 — is
referenced by `ProductionGate` in `plates.tsx` but was not available in this
worktree when that integration was built. Drop the approved plate at this
path (`public/studios/production-department.png`) to complete the wiring; no
code change should be required, but the object-position and mirroring in
`ProductionGate` were tuned blind and need a visual pass once the real image
is in place. See the implementation report for detail.
