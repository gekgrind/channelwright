"use client";

import Image from "next/image";
import { CSSProperties } from "react";

/**
 * SPIKE — physical plates inside the Channelwright Studios world.
 *
 * Two photographic interventions, deliberately only two: an environmental
 * reveal at the threshold (Beat 2) and an environmental object in Department
 * 01 (Beat 3). The question this spike exists to answer is whether photography
 * and the hall's hairline linework can occupy one frame without either the
 * headline or the architecture losing.
 *
 * Three rules the plates follow, and the reasons they are not negotiable:
 *
 *   They live in the world, not in a scene.  `.cw-world` is the persistent
 *   fixed layer at z-index 0; scenes sit above it at z-index 1. A plate
 *   mounted here is therefore *behind the copy by construction*, and the
 *   reading wash the copy layer paints for itself still lands on top of it.
 *
 *   They are places, so they ride `--cam`, never `--j`.  `--j` is the
 *   monotonic timeline; `--cam` is where the camera is standing and is free to
 *   run backwards. A plate keyed to `--j` would stay put while the building
 *   travelled during Beat 8's return, which reads as the photograph being
 *   pinned to the screen rather than standing in the room. Using the existing
 *   `.cw-prop` base gets this for free: `--d` is `--at` minus `--cam`.
 *
 *   The CRT plate drifts at the research fixture's rate.  Both are the same
 *   wall — one drawn, one photographed — so a rate mismatch would slide the
 *   blueprint grid across the glass and break the single effect this whole
 *   direction is built on.
 */

/* NOTE ON THE ARTWORK IN THIS SPIKE.
   `public/studios/*.jpg` are the final Magnific plates (copied from
   `public/design-assets/`, which stays untouched as the source of truth).
   Aspect ratios match the stand-ins they replaced — 21:9 for the CRT wall
   (3024×1296), 3:4 for the soundstage (1728×2304) — so the plate-level CSS
   (position, drift rate, mask, scale) needed no change. The screen quads
   below are re-derived against the real photograph; see the git history for
   the stand-in coordinates they replaced. */

/** Screen quads as percentages of the CRT plate's own box.
 *
 *  Expressed in the plate's coordinate space and rendered as its children, so
 *  registration during movement is structural rather than maintained: the
 *  quads translate, scale and drift with the artwork because they are inside
 *  it. Nothing has to stay in sync.
 *
 *  Measured directly off `crt-wall.jpg`'s visible glass apertures (percentage
 *  of the 3024×1296 frame), left to right / top to bottom then down to the
 *  tally screen: a small screen just past the left mask edge, the large
 *  foreground monitor top right, the wide static screen mid-right, a small
 *  screen lower-mid, and the tally screen at the bottom. */
const SCREENS: readonly { x: number; y: number; w: number; h: number; seq: number; signal?: boolean }[] = [
  { x: 44.9, y: 22.8, w: 3.1, h: 11.0, seq: 0.06 },
  { x: 84.7, y: 21.3, w: 9.7, h: 15.5, seq: 0.20 },
  { x: 69.8, y: 54.7, w: 8.4, h: 11.7, seq: 0.34 },
  { x: 57.6, y: 66.7, w: 4.8, h: 11.3, seq: 0.48 },
  { x: 58.0, y: 89.3, w: 4.4, h: 11.1, seq: 0.62, signal: true },
];

/**
 * Beat 3 — Department 01's research wall, photographed — and Beat 7's reuse
 * of it in Control.
 *
 * Pattern A: the plate spans the frame and a left mask carves out the reading
 * column. In Department 01 (`variant="research"`), five of eighteen screens
 * wake in sequence and exactly one carries the acid tally — the room rejects
 * most of what it looks at, and a wall where a few screens resolve and the
 * rest stay dark is that claim made physically.
 *
 * Department 05 (`variant="control"`) is deliberately the *same* wall rather
 * than a redress — doctrine's own argument for the reuse is that it must
 * still be recognisably one building — but it wakes on its own schedule
 * (`--l5`, later and narrower than `--l1`) and only the chosen screen comes
 * up. Research asks many questions and keeps a few answers lit; Control has
 * already decided, so only the one screen that carries the release plays.
 */
export function CrtWall({ at, variant = "research" }: { at: number; variant?: "research" | "control" }) {
  const screens = variant === "control" ? SCREENS.filter((screen) => screen.signal) : SCREENS;
  return (
    <div
      className={`cw-prop cw-plate cw-plate--crt cw-plate--crt-${variant}`}
      style={{ "--at": at } as CSSProperties}
    >
      {/* `next/image` rather than a bare tag: it is what emits AVIF/WebP and a
          responsive srcset, which is the whole of the performance plan for
          these plates. Decorative, so the alt is empty and it is lazy. */}
      <Image
        src="/studios/crt-wall.jpg"
        alt=""
        width={3024}
        height={1296}
        sizes="112vw"
        loading="lazy"
        style={{ width: "100%", height: "auto" }}
      />
      {/* Activation. Illumination is clipped to the glass and stays inside it:
          a lit rectangle sitting proud of the bezel is the exact failure that
          makes this read as a webpage overlay rather than a switched-on set. */}
      <div className="cw-plate__screens">
        {screens.map((screen, index) => (
          <span
            key={index}
            className="cw-screen"
            data-signal={screen.signal ? "" : undefined}
            style={{
              left: `${screen.x - screen.w / 2}%`,
              top: `${screen.y - screen.h / 2}%`,
              width: `${screen.w}%`,
              height: `${screen.h}%`,
              "--seq": screen.seq,
            } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Beat 2 — the soundstage, seen through the threshold.
 *
 * Pattern B: a narrow plate that needs no mask, because it is clipped by the
 * aperture it is standing behind. Rendered as a child of the doorway so it
 * inherits the approach scale and is carried through the crossing — the
 * payoff the threshold has never had is a *place*, not a picture hung in it.
 *
 * `soundstage-threshold-tight.jpg` is a crop of the same Magnific plate, not a
 * second generation: the source frame is roughly 70% unbroken ceiling above
 * the rig, and at this doorway's proportions `object-fit: cover` barely
 * touched that emptiness (box and source were nearly the same aspect), so the
 * plate read as a mostly-black photograph hung in a frame rather than a place
 * with a camera standing in it. The crop removes the dead band above the
 * light head — nothing else changes; the light, the camera and the deck are
 * untouched. See `public/studios/README.md`.
 *
 * The two struts are the same seam the CRT wall is built on, brought to this
 * doorway: hairline geometry crossing *in front of* the photograph, so the
 * aperture reads as the blueprint standing open on a real room rather than a
 * picture the blueprint happens to frame.
 */
export function ThresholdStage() {
  return (
    <span className="cw-plate cw-plate--stage" aria-hidden="true">
      <Image
        src="/studios/soundstage-threshold-tight.jpg"
        alt=""
        width={1728}
        height={1982}
        sizes="34vw"
        priority
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <span className="cw-plate--stage__struts" />
    </span>
  );
}

/**
 * Beat 6 — Department 04, the gate hold. FINISHED ≠ CLEARED.
 *
 * The only department where the artifact stops moving and, until this plate,
 * the only physical gap in the main journey: pure vector gate and conveyance
 * geometry, no object for "finished is not the same as cleared" to hold
 * against. Pattern A, the CRT wall's own grammar — plate spans the frame,
 * the left mask carves out the reading column, the room's own `Fixture` and
 * `ConveyanceLine` render after this in `world.tsx` so the drawn gate crosses
 * in front of the photograph exactly as the fixture grid crosses the CRT
 * glass.
 *
 * `production-department.png`, inspected: 2560×1440 (16:9, not the 4:5 this
 * was first built against blind). A seated operator faces a bank of CRT
 * monitors left-of-centre (roughly the left two-thirds of the frame); the
 * right third and the deep background are dark negative space. Still
 * mirrored — the console sits left-of-centre in the source, and every plate
 * on this page reserves its *left* ~40% for the reading column, so a flip is
 * what lands the operator in the surviving half rather than in the masked
 * one. Nothing in the frame is legible text, so the flip costs nothing.
 */
export function ProductionGate({ at }: { at: number }) {
  return (
    <div className="cw-prop cw-plate cw-plate--gate" style={{ "--at": at } as CSSProperties}>
      <span className="cw-plate__flip">
        <Image
          src="/studios/production-department.png"
          alt=""
          width={2560}
          height={1440}
          sizes="76vw"
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 38%" }}
        />
      </span>
    </div>
  );
}
