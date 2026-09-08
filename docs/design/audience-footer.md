# Channelwright Studios — the audience looks back

Status: Phase 1 creative and integration brief, 2026-09-08. Proposed direction; no audience assets, motion prototype, or runtime validation yet.

## Governing intent

The final shot reveals who the whole studio exists to serve. The audience first watches something above and to the visitor's left. As the visitor scrolls, attention transfers toward the camera. The final image holds long enough for the visitor to discover the change.

Do not put the explanation on screen. “You were watching Channelwright. Now the audience is watching you” is an internal direction, not footer copy.

This supports the Product Doctrine's Viewer Value principle and connects Strategy, Production, Measurement, and Learning to the people receiving the work. This is a narrative expression of that principle, not evidence of product capability or a claim about conversion lift.

## Verified starting point

Inspected checkout: `claude/channelwright-studios-pass-2-5afb9h`, HEAD `1ba86c3400cda4aef2f6918c4216b8e2aaaa9b32`. Its locally stored upstream ref diverges by 12 local-only / 4 upstream-only commits; the remote was not refreshed. Reconfirm the intended integration baseline before runtime work.

- `/` remains the older homepage in `src/app/page.tsx`.
- `/studios-preview` mounts `src/features/studios/experience.tsx` and is excluded from indexing.
- `Footer()` follows `CapabilityRegister()` inside `.cw-archive` in the animated rendering. Reduced motion renders the same footer outside the main element.
- Existing content: “Channelwright Studios,” “Build the company behind the channel,” the `/login` CTA, and a preview disclosure from `copy.ts`.
- `.cw-archive` already continues the physical hall behind the register and footer. Use that transition rather than adding a hard section boundary.
- `smooth-scroll.ts` owns one Lenis animation loop and drives `scroll-engine.ts`. The shared engine exposes `registerScene`, with scene-local progress and visibility. GSAP is not a dependency in this checkout.
- `beats.ts` controls the earlier journey's travel and derived timings. Keep the new footer outside that journey so its duration does not change existing room cues.
- Existing design tokens are near-black, warm paper, and restrained acid-green signals. Fonts are Space Grotesk, Manrope, and DM Mono. Red/cyan should belong to the physical glasses, not become a new UI palette.
- No audience plates were found in the inspected public assets. Existing staged design images and untracked logo assets belong to other work.

These are source observations, not a fresh rendered-site audit. A later verified Studios candidate exists in project history; this checkout must not be assumed to contain it.

## Art direction

Use a locked, screen-height camera looking into a small cinema. Three shallow, staggered seating rows; approximately 14–18 visible people, with five or six readable foreground faces. Keep faces separated by seat spacing and row offsets so head changes can be isolated without cutting through other people.

The audience occupies approximately the lower 60–68% of the desktop final viewport. Leave the upper field quiet enough for real footer text. Seat backs and shoulders may meet the bottom edge; never crop the foreground glasses. Keep several important faces within a center-safe mobile crop.

Cast distinct adults with varied ages, appearances, hair, and understated everyday wardrobe. Expressions are absorbed, curious, relaxed. Nobody performs surprise or leans toward the camera. Use restrained off-white paper-frame anaglyph glasses with physically consistent red/cyan lenses. Enough frame and nose geometry must remain visible to read head direction; the illusion cannot depend on seeing pupils through opaque lenses.

Light faces with a broad, soft projection source. Preserve readable skin and human warmth against deep charcoal seats. The entry pose is modestly turned toward image-left and slightly upward, not full profile. The final pose faces the lens with small individual differences. Avoid underlighting, mirrored smiles, uniform posture, spotlit eyes, saturated colored fog, lens flares, and theatrical horror lighting.

The archive hall's overhead light should visually fall into the cinema's darkness. Do not add a curtain wipe, interstitial title, or ornamental divider. Preserve the existing headline and CTA initially, with restrained scale in the upper field. Do not add a second slogan. Keep the preview disclosure legible during preview; its release handling is separate from this design.

## Canonical asset workflow

1. Create one candidate master in the final, camera-facing pose. The payoff must work as a still before motion is worth building. Treat it as a candidate until facial anatomy, glasses, composition, and mobile crop pass review.
2. Assign stable person IDs by seat and record identifying wardrobe, hair, glasses, and shoulder positions. Retain the original master and generation/edit provenance.
3. Derive the entry and midpoint states by editing that master. Keep camera, resolution, crop, people, seats, wardrobe, exposure, background, and nonmoving body pixels fixed. Never generate each state independently. Derive both states from the master to reduce accumulated drift.
4. Start with two foreground people plus a stationary neighbor. Test the intended head turn at native presentation size. Inspect held intermediate blends as well as moving playback. This is the cheapest test of whether three states are enough.
5. If full-image edits drift, composite only local head/neck regions over the fixed master. A mask must include the old silhouette and newly revealed background, not just the new face. Reject duplicate ears, hair halos, frame changes, sliding shoulders, and missing seat/background reconstruction.
6. Expand only after this test passes. Three poses are a starting hypothesis, not a promise of convincing continuous rotation. If blends look like dissolves, add targeted in-between poses or shorten local transitions. Do not hide a failed turn under darkness, blur, or parallax.
7. Export a shared static base and only the necessary changed regions, or use aligned complete plates if the simpler option passes visual and memory gates. Produce mobile crops from this same audience. Do not generate a second cast for mobile.

Master generation prompt:

> Cinematic editorial production photograph for the closing scene of Channelwright Studios. Locked landscape camera at screen height, facing a believable small cinema audience in three shallow staggered rows. Approximately sixteen distinct adult individuals, five or six clearly readable foreground faces, naturally varied ages and appearances, understated contemporary everyday clothing. Everyone wears modest old-school off-white paper anaglyph glasses with consistent red and cyan lenses. Most faces intentionally oriented toward the camera, relaxed attentive expressions with subtle individual variation. Intriguing, warm human attention, never threatening. Audience and charcoal seat backs occupy the lower two-thirds; upper third is quiet near-black architectural darkness for later website text, with no text generated. Broad soft neutral-warm projection light, visible natural skin texture, restrained lens colors, deep but readable shadows, premium film still rather than stock photography. Clear spacing around head silhouettes, modest depth, center-safe foreground faces for portrait cropping. No duplicated people, no malformed hands or ears, no exaggerated smiles, no neon, particles, cartoon glasses, logos, letters, extreme depth blur, or fisheye distortion.

Entry edit instruction, applied to the chosen master:

> Edit this exact audience image. Preserve all people and every seat, garment, pair of glasses, camera parameter, crop, lighting condition, and background feature. Change only head orientation, gaze, and the smallest anatomically necessary neck adjustment. Most viewers now look modestly toward image-left and slightly upward, absorbed in an off-camera projection. Vary angles naturally; a few are already closer to forward-facing. No shoulder translation, recasting, new accessories, relighting, or global resynthesis. Preserve each person's identity and the glasses' physical lens placement. Return the same dimensions and aligned composition.

Midpoint edit instruction uses the same constraints, with selected people partly turned and others still at entry orientation. Seat assignments determine who changes; no random recasting or layout changes.

## Proposed choreography

Numbers below are prototype tuning values, not validated timings. Define `p` over the footer's own scrollable hold, beginning when its stage reaches the top of the viewport. Its first partial appearance remains in the entry pose.

| Local progress | Intended perception |
| --- | --- |
| First appearance through 0.16 | Audience is occupied elsewhere. Allow the visitor to understand the composition. |
| 0.16–0.44 | A few midground people begin to transfer attention. Foreground mostly holds. |
| 0.35–0.70 | Foreground turns at overlapping, individual intervals. Background turns less conspicuously. |
| 0.62–0.88 | Remaining readable faces arrive at camera-facing poses. |
| 0.88–1.00 | Hold the completed image. No extra reveal competes with the returned gaze. |

Use deterministic per-person windows, not random values generated on mount. Pose choice and compositing follow local progress, so scrolling backward reverses the transfer consistently. Keep exact endpoint plate weights: final state must contain no entry-state ghosting.

Begin with a still camera and no parallax. Add only a few pixels of depth movement if the pose test already succeeds and comparison shows it helps. A head rotated as a flat rectangle is not a substitute for a changed head pose.

## Integration proposal

Keep Lenis and the existing shared scene driver. Add an audience footer component at the existing footer location, with an independently registered scroll span. Do not add the footer to `SCENES` or the main world timeline. GSAP/ScrollTrigger and WebGL are deferred because this first experiment needs neither a new scroll owner nor real-time geometry.

Start desktop testing with an approximately `200svh` wrapper and a sticky `100svh` scene. Use the existing driver's actual viewport measurements when calculating progress; verify mobile browser chrome changes because CSS small viewport height and `innerHeight` can differ. The end must map to the actual reachable document bottom, including padding and responsive content. If extra content follows the stage, recompute the range rather than accepting an unreachable final pose.

Keep one semantic footer and one set of links. Decorative plates are noninteractive and hidden from assistive technology; they cannot cover links or intercept pointer input. Place content in a stable upper region, with a local opaque backing if needed for contrast. On short or zoomed viewports, release the fixed composition into normal flow rather than clipping text to preserve the two-thirds art ratio. Test footer landmark exposure in both existing render branches.

Use CSS properties or direct compositing updates through the existing scene callback, not React state updates per scroll frame. Reuse its visibility signal and lifecycle cleanup. No second animation loop, scroll lock, looping audience movement, or dependency installation is needed for the initial proof.

## Mobile, accessibility, and loading

- Mobile starts with a center crop and shorter scroll hold. Use fewer moving foreground regions if necessary; retain the same final returned attention. Prefer a strong static endpoint if a compact animation cannot pass the visual or performance gate.
- Reduced motion: show the final master directly, with natural document flow, no pinning, parallax, or pose transition. The footer remains fully usable without JavaScript.
- Reserve image dimensions and layout before loading. Do not preload audience variants with the hero. Begin fetching near the footer, then decode before enabling transitions.
- Keep the final still as the baseline. If variants fail or are not ready when reached, retain a coherent static composition. Do not introduce a sudden mid-scene readiness jump; defer animation activation until a later re-entry if necessary.
- Proposed initial image-transfer budgets: at most 2 MB combined desktop footer assets and 700 KB mobile. These are targets to measure after exports, not achieved results. Account for decoded texture memory separately; compressed file size does not measure GPU cost.
- Load only the selected responsive set. Avoid unnecessary full-size layers, permanent `will-change` on every face, and offscreen compositing work.

## Acceptance gates and next phase

The next executable phase is the canonical master plus a two-person pose-continuity experiment. It must produce actual reviewed images before a homepage animation is declared feasible.

Visual gate: identical people and stationary surroundings across poses; readable head direction through the glasses; no doubled frames, drifting shoulders, face substitution, or exposed mask seams at held 25/50/75% blends. Review faces at native size and intended desktop/mobile size. A static side-by-side of the endpoints alone does not prove motion quality.

Narrative gate: conduct an unprompted first-view test. Ask what changed only after the visitor reaches the bottom. Record whether attention transfer was noticed and whether it felt curious or unsettling; do not lead with “did you see them turn?” Do not claim emotional success from source inspection.

Runtime gate: continuously traverse entry, slow scroll, rapid scroll, reverse, restored bottom position, Home/End, resize, and orientation changes. Verify an exact, stable final state at the real bottom. Inspect desktop, portrait mobile, short landscape, browser zoom, and breakpoint edges. Inspect keyboard focus, footer link activation, contrast, reduced-motion changes, no-JavaScript behavior, and failed asset loads.

Performance gate: measure transfer bytes, decoded memory, frame work, layout shifts, and loading behavior on the target devices. Confirm one scroll driver, no altered earlier journey timing, and no footer contribution to initial hero loading contention. Compare before/after results; no performance claims without measurements.

Once runtime implementation exists, run material behavior tests plus the repository's test, typecheck, lint, and build checks. This documentation-only phase requires no application test run and makes no implementation-complete claim.
