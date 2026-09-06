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
   `public/studios/*.jpg` are geometry- and tone-matched STAND-INS generated
   locally, not the Magnific renders: this environment's egress policy denies
   the asset CDN, so the real plates could not be fetched. They carry the real
   assets' aspect, exposure band, subject placement and — for the CRT wall —
   scanlines, so masking, registration, drift, typography protection, mobile
   behaviour and the activation technique are all genuinely exercised. What
   they cannot settle is photographic character. Swap the two files; no code
   changes. */

/** Screen quads as percentages of the CRT plate's own box.
 *
 *  Expressed in the plate's coordinate space and rendered as its children, so
 *  registration during movement is structural rather than maintained: the
 *  quads translate, scale and drift with the artwork because they are inside
 *  it. Nothing has to stay in sync.
 *
 *  These match the stand-in artwork. Re-derive them against the real plate —
 *  they are the one thing a swap does not carry over. */
const SCREENS: readonly { x: number; y: number; w: number; h: number; seq: number; signal?: boolean }[] = [
  { x: 57.0, y: 27.0, w: 12.5, h: 17.0, seq: 0.06 },
  { x: 70.0, y: 43.5, w: 13.5, h: 18.5, seq: 0.20 },
  { x: 45.0, y: 63.5, w: 10.5, h: 14.5, seq: 0.34 },
  { x: 79.0, y: 28.5, w: 11.0, h: 15.0, seq: 0.48 },
  { x: 62.0, y: 82.5, w: 11.0, h: 15.0, seq: 0.62, signal: true },
];

/**
 * Beat 3 — Department 01's research wall, photographed.
 *
 * Pattern A: the plate spans the frame and a left mask carves out the reading
 * column. Five of eighteen screens wake, in sequence, and exactly one carries
 * the acid tally — the room rejects most of what it looks at, and a wall where
 * a few screens resolve and the rest stay dark is that claim made physically.
 */
export function CrtWall({ at }: { at: number }) {
  return (
    <div className="cw-prop cw-plate cw-plate--crt" style={{ "--at": at } as CSSProperties}>
      {/* `next/image` rather than a bare tag: it is what emits AVIF/WebP and a
          responsive srcset, which is the whole of the performance plan for
          these plates. Decorative, so the alt is empty and it is lazy. */}
      <Image
        src="/studios/crt-wall-a.jpg"
        alt=""
        width={1920}
        height={823}
        sizes="112vw"
        loading="lazy"
        style={{ width: "100%", height: "auto" }}
      />
      {/* Activation. Illumination is clipped to the glass and stays inside it:
          a lit rectangle sitting proud of the bezel is the exact failure that
          makes this read as a webpage overlay rather than a switched-on set. */}
      <div className="cw-plate__screens">
        {SCREENS.map((screen, index) => (
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
 */
export function ThresholdStage() {
  return (
    <span className="cw-plate cw-plate--stage" aria-hidden="true">
      <Image
        src="/studios/soundstage-threshold.jpg"
        alt=""
        width={1152}
        height={1536}
        sizes="34vw"
        priority
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </span>
  );
}
