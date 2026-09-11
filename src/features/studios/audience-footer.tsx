"use client";

import { CSSProperties } from "react";
import { Cue, Scene } from "./scene";

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
const CAST = {
  curlyMan: { x: 66.4, y: 42.5, rx: 13, ry: 27 },
  centreMan: { x: 50.4, y: 45, rx: 12, ry: 26 },
  darkHairWoman: { x: 36.7, y: 46, rx: 12, ry: 26 },
  rightWoman: { x: 85.5, y: 46, rx: 12, ry: 27 },
  rearWomanRight: { x: 80.5, y: 31, rx: 10, ry: 18 },
  rearBlonde: { x: 62.5, y: 26, rx: 9, ry: 16 },
  rearManCentre: { x: 48.4, y: 27, rx: 9, ry: 16 },
  foregroundLeft: { x: 17.7, y: 61, rx: 19, ry: 34 },
  foregroundCentre: { x: 40.6, y: 63, rx: 22, ry: 36 },
  foregroundRight: { x: 65.8, y: 67, rx: 21, ry: 36 },
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
 * The core of each ellipse is solid and the outer third feathers away, so a
 * swapped head is joined to the untouched plate underneath by a gradient
 * rather than by an edge. Multiple regions union through `mask-composite`.
 */
function maskFor(regions: readonly Region[]) {
  return regions
    .map(
      (r) =>
        `radial-gradient(ellipse ${r.rx}% ${r.ry}% at ${r.x}% ${r.y}%, #000 44%, rgba(0,0,0,.74) 68%, transparent 100%)`,
    )
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
      return `radial-gradient(ellipse ${r.rx * spread}% ${r.ry * (spread - 0.14)}% at ${r.x}% ${r.y + 1}%, #000 24%, rgba(0,0,0,.94) 46%, rgba(0,0,0,.5) 70%, transparent 100%)`;
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
const PASSES: readonly Pass[] = [
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
     reading as the page dimming. Apart, they are three people turning. */
  {
    id: "near-left",
    plate: 4,
    from: 0.64,
    to: 0.74,
    regions: [CAST.foregroundLeft],
    note: "The foreground begins at the far left, away from everything that has moved so far.",
  },
  {
    id: "near-right",
    plate: 4,
    from: 0.7,
    to: 0.8,
    regions: [CAST.foregroundRight],
    note: "Then the opposite corner.",
  },
  {
    id: "nearest",
    plate: 4,
    from: 0.76,
    to: 0.86,
    regions: [CAST.foregroundCentre],
    note: "Last: the out-of-focus head nearest the visitor, dead centre and closest to the lens. The nearest person in the room is the final one to look up, and the sequence ends on them.",
  },
];

/**
 * The centre man is routed 1 -> 2 -> 4 and never shows plate 3: his plate-3
 * likeness has visibly different hair volume and face shape, and holding
 * identity matters more than using every plate for every person.
 */

export function AudienceFooter() {
  return (
    <Scene
      id="audience"
      travel={6}
      label="The audience"
      className="cw-scene--audience"
    >
      <div className="cw-aud" aria-hidden="true">
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
