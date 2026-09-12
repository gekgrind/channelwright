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
 * Beat 2 — the soundstage, arriving as a room rather than as a picture.
 *
 * There used to be a second, *far* state of this plate: the same photograph
 * mounted inside the doorway, clipped by the aperture and carried by its
 * approach. It is gone, and the reason is the failure it could not be tuned
 * out of. A photograph inside a lit rectangle is a photograph inside a lit
 * rectangle at every scale and every opacity — a portrait card hung at the end
 * of the hall — and dissolving it late only moved the moment at which the
 * visitor read it as one. The doorway is now what the hall's own comment in
 * `studios.css` always argued it was: a warm opening in a dark wall, with the
 * building's name on the lintel and nothing hung inside it.
 *
 * What replaces it is not "the same image, later". `SoundstageRoom` is mounted
 * in the world layer at the doorway's landmark, room-scale, riding `--cam` at
 * the doorway's own drift rate so the two are one place — and it now resolves
 * in two overlapping stages rather than one, the same grammar the doorway's
 * own approach uses (`--near` then `--close`):
 *
 *   `--hint` opens well before the crossing and is held to a low ceiling. The
 *   plate is screen-blended, so at a fifth of full strength only the brightest
 *   things in the photograph reach the hall at all — the lamp haze, the rig's
 *   lit edges, the cable and the deck. The visitor reads physical depth
 *   beginning to appear in the building, not an image fading up, and because
 *   the plate is far wider and taller than the doorway it can never be
 *   contained by it: the drawn aperture stands *in front of* the emerging room
 *   and occludes it, which is the relationship the beat wants.
 *
 *   `--emerge` opens as the crossing commits, at the same moment the doorway's
 *   own jambs and lintel light give way, and carries the room to full.
 *
 * `--spent` is the reach on the far side, and it is the shorter half of the
 * handoff into Department 01 — see the rule in `studios.css` for why it is
 * tighter than it looks like it should be.
 */
export function SoundstageRoom({ at }: { at: number }) {
  return (
    <div className="cw-prop cw-plate cw-plate--room" style={{ "--at": at } as CSSProperties}>
      <Image
        src="/studios/soundstage-threshold-tight.jpg"
        alt=""
        width={1728}
        height={1982}
        sizes="(max-width: 720px) 160vw, 90vw"
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}

/**
 * Beat 6 — Department 04, the gate hold. FINISHED ≠ CLEARED.
 *
 * The only department where the artifact stops moving and, until this plate,
 * the only physical gap in the main journey: pure vector gate and conveyance
 * geometry, no object for "finished is not the same as cleared" to hold
 * against. Pattern A on desktop and tablet — the CRT wall's own grammar: the
 * plate spans most of the frame, the left mask carves out the reading
 * column, the room's own `Fixture` and `ConveyanceLine` render after this in
 * `world.tsx` so the drawn gate crosses in front of the photograph exactly
 * as the fixture grid crosses the CRT glass.
 *
 * `production-department.jpg` — a delivery-quality JPEG derived from
 * `public/design-assets/production-department.png` (the untouched source),
 * not a second copy of the 5.4MB PNG itself; same pattern as
 * `soundstage-threshold-tight.jpg`. Inspected at 2560×1440 (16:9, not the
 * 4:5 this was first built against blind). A seated operator faces a bank of CRT
 * monitors left-of-centre (roughly the left two-thirds of the frame); the
 * right third and the deep background are dark negative space. Still
 * mirrored on desktop/tablet — the console sits left-of-centre in the
 * source, and every plate on this page reserves its *left* ~30% for the
 * reading column, so a flip is what lands the operator in the surviving
 * half rather than in the masked one. Nothing in the frame is legible text,
 * so the flip costs nothing.
 *
 * Phones get a second, unmirrored element instead of the same plate
 * stretched: `Fixture` (the drawn console equipment) is dropped below 720px
 * everywhere on this page, so Pattern A's whole argument — photography read
 * *through* linework — cannot happen on a phone, the same reason the CRT
 * wall itself is phone-omitted. But omission was the wrong call here
 * specifically: Department 04 is otherwise the one room in the journey with
 * no physical object at all, on any viewport, and a phone visitor should not
 * lose it entirely. `production-department-mobile.jpg` is a tight, standalone
 * crop of the monitor bank and the operator's head and shoulders — self-
 * framed the way the soundstage threshold is (Pattern B: no mask needed
 * because the plate's own edges do the work), so it does not depend on a
 * blueprint grid it will never have. CSS toggles which element paints; both
 * are mounted so a breakpoint change never has to swap in a whole element
 * that was not there before. Both stay `loading="lazy"`, matching every
 * other decorative plate on this page — the one this hides at the current
 * breakpoint has no layout box, so it does not prefetch until CSS reveals
 * it, meaning a visitor who resizes across the breakpoint can see one
 * on-demand fetch for the newly-shown crop. Accepted: a mid-visit resize
 * across this specific breakpoint is rare, and eager-loading either crop
 * up front would cost every visitor who never resizes at all.
 */
export function ProductionGate({ at }: { at: number }) {
  return (
    <div className="cw-prop cw-plate cw-plate--gate" style={{ "--at": at } as CSSProperties}>
      <span className="cw-plate__flip cw-plate--gate__wide">
        <Image
          src="/studios/production-department.jpg"
          alt=""
          width={2560}
          height={1440}
          sizes="76vw"
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 38%" }}
        />
      </span>
      <span className="cw-plate--gate__phone">
        <Image
          src="/studios/production-department-mobile.jpg"
          alt=""
          width={871}
          height={993}
          sizes="70vw"
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </span>
    </div>
  );
}
