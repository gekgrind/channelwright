# Studios plates — SPIKE ARTWORK, NOT FINAL

`crt-wall-a.jpg` and `soundstage-threshold.jpg` in this directory are
**geometry- and tone-matched stand-ins generated locally**, not the Magnific
renders. The session that built the integration could not fetch the real
assets: the environment's egress policy denies the asset CDN (403 at the
proxy), verified via curl, a Playwright request context and the `png16`
delivery profile.

They carry the real assets' aspect ratio, exposure band, subject placement and
— for the CRT wall — scanlines, so masking, drift registration, `--cam`
behaviour, typography protection, mobile behaviour, moiré and the CSS
activation technique are all genuinely exercised by them. What they cannot
settle is photographic character.

## Swapping in the real plates

Replace both files, keeping the filenames and aspect ratios:

| File | Aspect | Source render |
|---|---|---|
| `crt-wall-a.jpg` | 21:9 | CRT wall, dormant, variant 1 (seed 318661, 3024×1296) |
| `soundstage-threshold.jpg` | 3:4 | soundstage through the threshold |

Production should ship AVIF/WebP; `next/image` already emits both from these
JPEGs, so no code change is needed for that.

**One thing a swap does not carry over:** the screen quads in
`src/features/studios/plates.tsx` (`SCREENS`) are percentages measured against
the stand-in artwork. They must be re-derived against the real plate or the
activation will light the wrong parts of the wall.
