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
