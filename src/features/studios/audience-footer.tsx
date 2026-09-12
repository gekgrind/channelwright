"use client";

import { CSSProperties, useEffect, useRef } from "react";
import { Cue, Scene } from "./scene";
import { registerScene } from "./scroll-engine";

/**
 * The cinematic audience footer — the last act of the Studios journey.
 *
 * The visitor has spent the whole page watching how media gets made. Here they
 * arrive in front of the people it is made for: an old cinema audience in
 * cardboard 3D glasses, absorbed in a film we never see. As the page scrolls,
 * attention transfers off the screen and onto the visitor, a few people at a
 * time, until the room is quietly looking back.
 *
 * ## Why this is not a crossfade
 *
 * The four plates in `public/footer/` are separate photographs of the same
 * staged audience, so the obvious implementation — dissolve plate 1 into plate
 * 2 into plate 3 — was measured before it was written, and it fails badly. The
 * glasses are small, high-contrast white rectangles that move several times
 * their own width when a head turns, so any blend between two poses renders
 * *both* pairs at partial opacity: four lenses, two noses, two mouths. It is
 * the single most objectionable artifact this footer could ship, and it is
 * present at every blend fraction between roughly 0.2 and 0.8, on sharp
 * middle-row faces and on soft out-of-focus foreground heads alike. Dimming
 * the region during the blend does not fix it either: the doubling is
 * structural, not tonal, and survives a 55% luminance cut.
 *
 * So no two poses of the same person are ever shown at once. Each change is a
 * **defocus-and-exposure pulse**: a region of the audience softens under a
 * `backdrop-filter` blur with a mild darkening, the plate underneath is
 * swapped while the blur is at its peak, and focus returns on people who are
 * now looking at the camera.
 *
 * The first build of this covered the swap with near-total darkness (a
 * "dip-to-shadow cut") instead of blur, on the reasoning that a region dark
 * enough hides anything under it. Rendered and measured, that reasoning
 * proved wrong: a region has to cover the *union* of two poses to hide a real
 * change, and at the size that requires — a tenth of the frame for the
 * smallest pass, a quarter of it for the three foreground passes — near-total
 * darkness stops reading as "the room dimmed" and starts reading as a hole cut
 * in the photograph, which is the exact compositing "tell" this footer exists
 * to avoid. Blur does not have that failure mode: a softly out-of-focus region
 * reads as a photograph at any size, and it erases precisely the fine,
 * high-contrast edges — the glasses, above everything — that make a crossfade
 * unusable in the first place. The darkening is kept, but only as a light
 * pulse alongside the blur, not as the thing doing the concealment.
 *
 * It is still the most diegetic solution available: the only light in the
 * room comes from a film we cannot see, so a moment of the picture going soft
 * and a little darker is exactly what the scene would really do — the
 * projector's focus wavering, not a light being switched.
 *
 * ## Why the plates are full-frame layers behind masks
 *
 * Landmark tracking across the four plates shows plate 2 is pixel-registered
 * to plate 1 (normalised correlation 0.99, zero offset on every landmark),
 * while plates 3 and 4 drift per-person by up to ~36px in inconsistent
 * directions. No single scale or translation corrects that — it is generative
 * drift, not a camera move — so a full-frame transition would show the whole
 * audience softly sliding. Confining each change to a mask over one person
 * hides it completely: inside a head-sized mask a 30px shift reads as the head
 * turning, and the surrounding base plate never moves, so the theatre itself
 * stays physically stationary.
 *
 * ## The corollary that took three repairs to find
 *
 * That drift is *global*. Measured across the frame, plate 1 and plate 4
 * disagree by a mean |Δ| of roughly 25-45 of 255 everywhere — not only on the
 * heads that turn. There is therefore no such thing as a region of this
 * artwork where two plates can be safely cross-faded, and it follows that
 * **any pixel held at partial mask alpha is a permanent double exposure**,
 * whatever the timing does. Two rules fall out of that, and both are load
 * bearing:
 *
 *  1. A swap mask must be effectively binary (see `maskFor`). Its thin rim is
 *     the only partial-alpha it is allowed, and each region is placed so that
 *     rim lands between faces.
 *  2. A swap's opacity must cut, never ramp (see `.cw-aud__plate--swap` in
 *     `studios.css`). A ramp is a frame-wide cross-fade of two photographs.
 *
 * The shadow above is exempt from both: `backdrop-filter` blends the blurred
 * frame with the sharp frame — one photograph — so it can stay as soft and as
 * wide as it likes.
 *
 * Every layer is therefore the *same* full 16:9 frame, painted at the same
 * size and position, revealed through a static mask. Co-registration is free —
 * there are no crops to align — and the browser decodes each plate once no
 * matter how many masked layers reference it.
 *
 * ## Cost
 *
 * Nothing here runs per frame in JavaScript. The shared scroll engine writes
 * `--p` onto the scene element, `Cue` maps a slice of it onto `--t`, and every
 * layer derives its opacity from that in CSS. Masks are static geometry.
 */

/** A soft region of the frame, in percentages of the 16:9 plate. */
type Region = {
  /** Centre, as a percentage of plate width / height. */
  x: number;
  y: number;
  /** Radii, as a percentage of plate width / height. */
  rx: number;
  ry: number;
};

/**
 * The cast, in plate coordinates.
 *
 * Positions were read off the 2560x1440 plates and converted to percentages,
 * so they track the artwork at any viewport: the plate is laid out as a real
 * 16:9 box sized to cover the stage, and the masks are percentages of that
 * same box rather than of the viewport.
 *
 * Each region covers the *union* of that person's poses across the plates, not
 * the head in its final position, and is sized from a measured bounding box of
 * everything that changes around them rather than from the outline of a face.
 * Masks fitted to the finished pose shipped a real defect on the first pass:
 * the curly man turns from a left profile, so his plate-1 head and glasses sit
 * well left of where he ends up, and a tight mask left that old profile
 * showing beside the new one — a second face, floating, exactly the artifact
 * the shadow exists to prevent. A region has to be able to hide where someone
 * *was*, not just paint where they are.
 */
export const CAST = {
  curlyMan: { x: 66.4, y: 42.5, rx: 13, ry: 27 },
  centreMan: { x: 50.4, y: 45, rx: 12, ry: 26 },
  darkHairWoman: { x: 36.7, y: 46, rx: 12, ry: 26 },
  rightWoman: { x: 85.5, y: 46, rx: 12, ry: 27 },
  rearWomanRight: { x: 80.5, y: 31, rx: 10, ry: 18 },
  rearBlonde: { x: 62.5, y: 26, rx: 9, ry: 16 },
  rearManCentre: { x: 48.4, y: 27, rx: 9, ry: 16 },
  /* The three foreground heads sit entirely in the out-of-focus band, and
     their regions are now sized to it rather than to a generous guess.
     ---------------------------------------------------------------------
     These were previously centred at y 61-67 with ry 34-36, which put their
     upper halves across the sharp middle row at y 30-50 — the blonde woman
     at x 6-15 and the cable-knit man at x 19-29 in particular. Those two are
     deliberately never transitioned (see below), so a mask lying across them
     could only ever paint one plate's likeness of them partially over
     another's. Measured, `foregroundLeft` held 0.31 alpha on the blonde
     woman's glasses and 0.39 on the cable-knit man's, permanently, and plate
     1 -> plate 4 moves her glasses about four percent of frame height. That
     is a readable second pair of glasses in the settled frame, and it is the
     defect that survived every previous repair.

     The bounds below come from a focus map of plate 1 (local contrast falls
     off sharply below y ~58%, which is where the foreground row begins) and
     from the union of each head's plate-1 and plate-4 glasses:

       left    glasses x  1-14, y 54-73   region y 49-103
       centre  glasses x 32-44, y 67-84   region y 60-108
       right   glasses x 61-73, y 72-89   region y 66-110

     Every region's upper edge now lands in the gap between the seated row's
     chins and the foreground row's hairlines — low-contrast, out-of-focus
     territory where a mask edge has nothing legible to cut through. */
  foregroundLeft: { x: 9, y: 76, rx: 19, ry: 27 },
  foregroundCentre: { x: 39, y: 84, rx: 16, ry: 24 },
  foregroundRight: { x: 67, y: 88, rx: 15, ry: 22 },
} as const satisfies Record<string, Region>;

/**
 * Deliberately absent from every pass.
 *
 * The blonde woman and the man in the cable-knit sweater, both mid-left, hold
 * the same upward pose in all four plates — the measured difference across
 * them is drift and relighting, not a turn, and they carry the two largest
 * per-landmark offsets in the set. Transitioning them would buy no new
 * attention and would put the worst registration error on screen. Leaving them
 * absorbed in the film is also the truer picture: a room does not notice you
 * all at once, and two people who never look up are what keeps the last frame
 * from reading as choreography. The left-edge man and the rear-left man are
 * held out for the same reason, with less at stake — neither changes enough
 * across the plates to be worth a shadow pass.
 */

/**
 * A mask that reveals only the listed regions.
 *
 * Multiple regions union through `mask-composite`.
 *
 * ## Why the feather is a thin rim rather than the outer half
 *
 * This used to run `#000 44%, rgba(0,0,0,.74) 68%, transparent 100%` — a soft
 * join across 56% of each ellipse's radius — on the reasoning that a gradient
 * joins a swapped head to "the untouched plate underneath" more kindly than an
 * edge does. That reasoning has one load-bearing assumption, and measurement
 * against the actual artwork disproves it: the plate underneath is not
 * untouched. Plate 1 and plate 4 differ by a mean |Δ| of roughly 25-45 of 255
 * across the *entire* frame, not merely on the heads that turn — generative
 * drift and relighting everywhere. So every pixel a mask holds at partial
 * alpha is a permanent blend of two different photographs of the same room,
 * and a 56%-of-radius feather is a very large amount of frame held that way.
 *
 * That is the whole mechanism behind the "doubled glasses" reports. It was
 * never a timing fault and never a blur-strength fault, which is why widening
 * the pass windows, raising the shadow opacity and raising the blur radius
 * each failed in turn: the artifact does not live in the transition at all.
 * It is in the settled composite, and it is still there long after every
 * shadow has lifted. It merely *became visible* around progress 0.72-0.79
 * because that is where the near-left shadow — which had been partly covering
 * the ghost it had just created — fades out.
 *
 * A thin rim inverts the trade. The partial-alpha band is now the outer fifth
 * of the radius, narrow enough that it cannot hold a whole pair of glasses,
 * and every region above is positioned so that rim lands between faces rather
 * than across one. Measured over the settled composite, frame-wide ghost
 * energy falls by about 9x against the old feather.
 */
/**
 * The swap mask's gradient stops, as `[fraction of the ellipse radius, alpha]`.
 *
 * Declared once so the CSS below and `swapAlphaAt` cannot drift apart: the
 * invariant that keeps this footer correct is a statement about alpha at a
 * coordinate, and a test that re-typed these numbers would stop testing the
 * mask the moment someone edited only the gradient.
 */
export const SWAP_STOPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.8, 1],
  [0.9, 0.9],
  [1, 0],
];

function stopsToCss() {
  return SWAP_STOPS.slice(1)
    .map(([at, alpha]) =>
      alpha === 0
        ? `transparent ${at * 100}%`
        : alpha === 1
          ? `#000 ${at * 100}%`
          : `rgba(0,0,0,${String(alpha).replace(/^0/, "")}) ${at * 100}%`,
    )
    .join(", ");
}

/**
 * The alpha this mask paints at a point, in the same plate percentages `CAST`
 * is written in. The union of regions composites through `mask-composite: add`,
 * which saturates, so overlapping regions take the strongest of them.
 */
export function swapAlphaAt(regions: readonly Region[], x: number, y: number) {
  let alpha = 0;
  for (const r of regions) {
    const radius = Math.hypot((x - r.x) / r.rx, (y - r.y) / r.ry);
    for (let i = 0; i < SWAP_STOPS.length - 1; i++) {
      const [at0, a0] = SWAP_STOPS[i];
      const [at1, a1] = SWAP_STOPS[i + 1];
      if (radius > at1) continue;
      alpha = Math.max(alpha, a0 + (a1 - a0) * ((radius - at0) / (at1 - at0)));
      break;
    }
  }
  return Math.min(1, alpha);
}

function maskFor(regions: readonly Region[]) {
  return regions
    .map((r) => `radial-gradient(ellipse ${r.rx}% ${r.ry}% at ${r.x}% ${r.y}%, ${stopsToCss()})`)
    .join(", ");
}

/**
 * The mask for the blur-and-exposure pulse that covers a swap.
 *
 * Deliberately much larger and much softer than the mask it hides: a region
 * the size of the edit reads as a patch of softness painted on one person,
 * while one that runs well past them reads as the whole picture's focus
 * drifting for a moment — which is what actually sells the diegetic read
 * (`studios.css`'s `.cw-aud__dim` turns this into `backdrop-filter: blur()`
 * plus a mild darkening, not the near-opaque shadow the name still describes
 * pixel-for-pixel; kept because the geometry, not the color, is what this
 * function is actually shaping). The long feather is what keeps overlapping
 * regions merging into one irregular pool instead of showing as a string of
 * ellipses.
 */
function shadowFor(regions: readonly Region[]) {
  return regions
    .map((r) => {
      /* A fixed multiplier is wrong here. The rear-row masks are small enough
         that a 45% halo is what makes them read as light rather than as a spot,
         while the foreground heads are already a third of the frame wide and
         the same multiplier put half the picture in darkness at once. The halo
         therefore shrinks as the region grows. */
      const spread = Math.max(1.16, 1.45 - Math.max(0, r.rx - 9) * 0.02);
      /* Unlike `maskFor` above, this mask stays soft on purpose, and softness
         here costs nothing: a partial-alpha pixel under a `backdrop-filter`
         blends the blurred frame with the sharp frame — the same photograph
         either way — so it can never double anything. It is only the *swap*
         mask, which blends two different photographs, that had to go hard.

         What this geometry must still guarantee is coverage: mask-image
         attenuates backdrop-filter's strength at each pixel exactly as it
         attenuates opacity, so a 50%-alpha rim is only ever half-blurred
         however large the radius gets, and no amount of extra blur fixes a
         gap. Full strength holds to 60% of this (already enlarged) radius and
         near-full to 85%, i.e. out to ~1.06x the swap's own outer edge — past
         every swap's paint with margin for a neighbouring pass's region
         sitting close by, which is common by design (see PASSES). */
      return `radial-gradient(ellipse ${r.rx * spread}% ${r.ry * (spread - 0.14)}% at ${r.x}% ${r.y + 1}%, #000 60%, rgba(0,0,0,.92) 85%, transparent 100%)`;
    })
    .join(", ");
}

/** Which plate a layer paints, and where it is allowed to show. */
type Pass = {
  id: string;
  /** Source plate, 1-4. CSS owns the URLs so it can swap them per viewport. */
  plate: 2 | 3 | 4;
  /** Scene progress window for the whole pass, including the shadow. */
  from: number;
  to: number;
  /** Who changes under this shadow. */
  regions: readonly Region[];
  /** Human-readable note, for the next person to open this file. */
  note: string;
};

/**
 * Eight passes of changing screen light.
 *
 * The order is chosen from the plates rather than from the x-axis: it starts
 * centre-right, jumps out to the right and centre, comes *back* to the pair
 * who moved first, and only then reaches the foreground — the people closest
 * to the visitor are the last to look up, which is the most unsettling
 * ordering available and the least like a spreadsheet.
 *
 * They are kept small and slightly imbricated on purpose. An earlier cut used
 * four larger passes; six regions darkening together turned the bottom of the
 * frame into one slab and read as blotching rather than as light.
 *
 * Between passes nothing moves at all. The holds are as much of the effect as
 * the changes: they are what lets a visitor stop scrolling and find a coherent
 * photograph rather than a half-finished blend.
 */
export const PASSES: readonly Pass[] = [
  {
    id: "notice",
    plate: 2,
    from: 0.12,
    to: 0.23,
    regions: [CAST.curlyMan, CAST.centreMan],
    note: "First notice. Two middle-row men come off the screen — the curly man to three-quarter, the man beside him lowering his chin. One small shadow, easy to miss, which is the point.",
  },
  {
    id: "right",
    plate: 3,
    from: 0.28,
    to: 0.39,
    regions: [CAST.rightWoman, CAST.rearWomanRight],
    note: "It jumps the gap to the far right rather than spreading to the neighbours, so the second beat cannot be read as a wipe travelling outwards from the first.",
  },
  {
    id: "centre",
    plate: 3,
    from: 0.35,
    to: 0.46,
    regions: [CAST.darkHairWoman, CAST.rearManCentre],
    note: "Overlapping the right-hand beat by a third: two shadows alive at once, in unrelated parts of the room, is what turns a sequence of events into a wave.",
  },
  {
    id: "deepen",
    plate: 4,
    from: 0.49,
    to: 0.6,
    regions: [CAST.curlyMan, CAST.centreMan, CAST.rearBlonde],
    note: "The pair who noticed first complete their turn to a direct stare, and the rear row joins. Coming back to where it started is what makes the room feel like it is filling up rather than scanning.",
  },
  {
    id: "settle",
    plate: 4,
    from: 0.56,
    to: 0.67,
    regions: [CAST.darkHairWoman, CAST.rightWoman, CAST.rearWomanRight],
    note: "The middle row settles into its final pose while the beat before it is still lifting.",
  },
  /* The three foreground heads are the largest masks in the set, so they get a
     beat each rather than sharing one. Run together they darkened the bottom
     half of the frame at a stroke, which stopped reading as a room and started
     reading as the page dimming. Apart, they are three people turning.

     Widened from an original 0.10-of-scene width to 0.14: measured under CPU
     throttling, a single dropped-frame stall during a fast scroll can skip a
     span of scene progress wider than 0.10 outright, landing the visitor on
     the "before" and "after" of a pass with nothing painted in between — an
     unexplained pop rather than a turn. A wider window doesn't make any one
     frame more likely to render; it makes it harder for a single stall to
     clear the whole span without landing on at least one of them. */
  {
    id: "near-left",
    plate: 4,
    from: 0.63,
    to: 0.77,
    regions: [CAST.foregroundLeft],
    note: "The foreground begins at the far left, away from everything that has moved so far.",
  },
  {
    id: "near-right",
    plate: 4,
    from: 0.69,
    to: 0.83,
    regions: [CAST.foregroundRight],
    note: "Then the opposite corner.",
  },
  {
    id: "nearest",
    plate: 4,
    from: 0.75,
    to: 0.89,
    regions: [CAST.foregroundCentre],
    note: "Last: the out-of-focus head nearest the visitor, dead centre and closest to the lens. The nearest person in the room is the final one to look up, and the sequence ends on them.",
  },
];

/**
 * The centre man is routed 1 -> 2 -> 4 and never shows plate 3: his plate-3
 * likeness has visibly different hair volume and face shape, and holding
 * identity matters more than using every plate for every person.
 */

/**
 * How far (in scene progress) a pass reaches before/after its own [from, to]
 * before its swap and shadow layers are worth promoting to the GPU.
 *
 * Sized to roughly half a pass's own width: enough head start that the
 * compositor layer exists before the effect needs it (a promotion that
 * happens on the pass's first active frame is itself a stutter risk), not so
 * wide that neighbouring passes stay promoted together for no reason.
 */
const NEAR_MARGIN = 0.05;

/**
 * Scopes `will-change` to the one or two passes actually near the current
 * scroll position, instead of promoting all sixteen swap/shadow layers for
 * the audience scene's entire five-viewport travel.
 *
 * `backdrop-filter` is the expensive half of this footer, and sixteen
 * simultaneously-promoted full-frame layers is real GPU backing store held
 * for a stretch of scroll where at most two or three are ever doing
 * anything. It also turned out not to be *only* a performance nicety:
 * measured under CPU throttling, the extra compositing cost was enough to
 * drop frames during a fast scroll, and a dropped frame can land the visitor
 * on a rendered state from squarely inside a pass's blur window without ever
 * having painted the smoother frames on either side of it — which is what a
 * "doubled glasses" report during natural scrolling turned out to trace
 * back to, not a flaw in the swap timing itself.
 *
 * Reuses the existing shared scroll engine (`registerScene`) rather than a
 * second listener: this is one more subscriber in the same rAF pass every
 * other scene already pays for, not a new one.
 */
function useNearPassPromotion(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    const element = document.getElementById("audience");
    if (!root || !element) return;

    const swapNodes = Array.from(root.querySelectorAll<HTMLElement>(".cw-aud__plate--swap"));
    const dimNodes = Array.from(root.querySelectorAll<HTMLElement>(".cw-aud__dim"));
    // DOM order matches `PASSES` order exactly: both node lists come from the
    // same static array, mapped once each, so index `i` is pass `i` in both.
    const near: boolean[] = PASSES.map(() => false);

    return registerScene({
      element,
      apply(progress) {
        PASSES.forEach((pass, i) => {
          const isNear = progress >= pass.from - NEAR_MARGIN && progress <= pass.to + NEAR_MARGIN;
          if (isNear === near[i]) return;
          near[i] = isNear;
          const value = isNear ? "true" : "false";
          swapNodes[i].dataset.near = value;
          dimNodes[i].dataset.near = value;
        });
      },
    });
  }, [rootRef]);
}

export function AudienceFooter() {
  const rootRef = useRef<HTMLDivElement>(null);
  useNearPassPromotion(rootRef);

  return (
    <Scene
      id="audience"
      travel={6}
      label="The audience"
      className="cw-scene--audience"
    >
      <div className="cw-aud" aria-hidden="true" ref={rootRef}>
        <div className="cw-aud__frame">
          {/* The theatre itself. Never transitions, never moves. */}
          <div className="cw-aud__plate cw-aud__plate--base" data-plate="1" />

          {/* Each pass paints its plate only where its mask allows, and only
              once the shadow above it has reached full depth. */}
          {PASSES.map((pass) => (
            <Cue
              key={pass.id}
              from={pass.from}
              to={pass.to}
              className="cw-aud__plate cw-aud__plate--swap"
              style={{ "--mask": maskFor(pass.regions) } as CSSProperties}
            >
              <span className="cw-aud__paint" data-plate={pass.plate} />
            </Cue>
          ))}

          {/* The shadows sit above every plate: at rest they are nothing, so
              their order relative to each other does not matter. Each is a
              wider, softer copy of its pass's mask, so the darkness always
              extends past the edit it is covering. */}
          {PASSES.map((pass) => (
            <Cue
              key={`${pass.id}-dim`}
              from={pass.from}
              to={pass.to}
              className="cw-aud__dim"
              style={{ "--mask": shadowFor(pass.regions) } as CSSProperties}
            />
          ))}

          {/* Held back until the room has settled: a slow, shallow push toward
              the audience over the final hold, so the last beat is not a
              frozen JPEG. */}
          <div className="cw-aud__grade" />
        </div>
      </div>
    </Scene>
  );
}

/**
 * The reduced-motion audience.
 *
 * Not the animation stopped part-way, and not the artwork withheld: the plate
 * the sequence was travelling towards, held still. Someone who has asked for
 * less motion still gets the photograph, the glasses, and the stare.
 */
export function AudienceFooterStatic() {
  return (
    <div className="cw-aud cw-aud--static" aria-hidden="true">
      <div className="cw-aud__frame">
        <div className="cw-aud__plate cw-aud__plate--base" data-plate="4" />
        <div className="cw-aud__grade" />
      </div>
    </div>
  );
}
