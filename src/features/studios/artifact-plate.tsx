"use client";

import { CSSProperties } from "react";

import { journeyAt, type SceneId } from "./beats";
import { ARTIFACT } from "./copy";

/**
 * The artifact: one idea, written down, carried through the whole building.
 *
 * This is the protagonist of Channelwright Studios and the only object that is
 * present in every beat. It supersedes the old `Signal()` — there is exactly
 * one persistent artifact in this experience and no second system may be added
 * beside it.
 *
 * Three properties make it read as *the same idea getting smarter* rather than
 * a graphic being reused:
 *
 *   Mounted once.   It lives in the persistent world layer, outside every
 *                   scene, so no scene boundary can unmount or remount it.
 *   Continuous.     Its position is a running sum of overlapping ramps between
 *                   ordered stops, so it is continuous by construction and can
 *                   never blink from one place to another.
 *   Additive.       Rooms add to it. Nothing is taken away, and the sentence
 *                   itself never changes typeface, colour or left edge — that
 *                   invariance is what the visitor tracks.
 *
 * Beats 3–9 (the rewrite, the tags, the structure, the frame, the chosen
 * title, the return) are not staged yet. The track and the state hooks below
 * are the architecture those phases attach to; this phase carries one
 * placeholder sentence the whole way and changes nothing else about it.
 */

/** A position the artifact passes through, in journey coordinates. */
type Stop = {
  scene: SceneId;
  /** Fraction of that scene's own travel. */
  at: number;
  /** Lateral offset in vw, before the narrow-viewport throw is applied. */
  x: number;
  /** Vertical offset in vh. */
  y: number;
};

/**
 * The artifact's route through the building.
 *
 * Stops are stated per room rather than as journey fractions, so lengthening a
 * scene moves the artifact with its room instead of requiring the hand rescale
 * that `beats.ts` exists to remove. The envelope reproduces the route the
 * pass-2 experience shipped with; the transformations along it arrive later.
 */
export const TRACK: Stop[] = [
  { scene: "open", at: 0.19, x: 0, y: 0 }, /*    at rest, before the building  */
  { scene: "open", at: 0.89, x: 6, y: -33 }, /*  lifts into the beam           */
  { scene: "intelligence", at: 0.33, x: -34, y: 29 }, /* settles on the line   */
  { scene: "strategy", at: 0.05, x: 12, y: 29 }, /*     crosses Department 01  */
  { scene: "strategy", at: 0.4, x: 24, y: 29 }, /*      leaves, worked on      */
  { scene: "strategy", at: 0.86, x: -24, y: 29 }, /*    carried down the hall  */
  { scene: "writers", at: 0.25, x: 2, y: 23 }, /*       docks in Department 02 */
  { scene: "production", at: 0.27, x: 22, y: 15 }, /*   structured in 03       */
  { scene: "control", at: 0.53, x: 46, y: 5 }, /*       validated in 04        */
];

/**
 * A window on the journey, as a CSS ramp that is 0 before it, 1 after it.
 * Every scroll-driven value in this experience is built from these.
 */
function ramp(from: number, to: number) {
  return `clamp(0, calc((var(--j) - ${from}) / ${(to - from).toFixed(4)}), 1)`;
}

/**
 * The running sum of one axis across the track.
 *
 * Overlapping ramps are what keep the motion continuous: each segment
 * contributes its own delta as it opens, and a segment that has completed
 * simply holds its full contribution, so the artifact can never jump.
 */
function axis(pick: (stop: Stop) => number) {
  const terms = TRACK.slice(1).map((stop, index) => {
    const previous = TRACK[index];
    const from = journeyAt(previous.scene, previous.at);
    const to = journeyAt(stop.scene, stop.at);
    const delta = pick(stop) - pick(previous);
    return `${ramp(from, to)} * ${delta}`;
  });
  return terms.join(" + ");
}

/** Retrieval is under way: the ring opens while the artifact is being worked on. */
const WORK_IN = journeyAt("intelligence", 0.51);
const WORK_OUT = journeyAt("strategy", 0.16);

/** Evidence attaches, and stays attached. */
const BOUND_IN = journeyAt("intelligence", 0.93);
const BOUND_OUT = journeyAt("strategy", 0.2);

const TRACK_STYLE = {
  "--ax": axis((stop) => stop.x),
  "--ay": axis((stop) => stop.y),
  "--work": `calc(${ramp(WORK_IN - 0.02, WORK_IN)} * ${ramp(WORK_OUT, WORK_OUT - 0.02)})`,
  "--bound": ramp(BOUND_IN, BOUND_OUT),
} as CSSProperties;

/**
 * Kept `aria-hidden`: this is a scroll-scrubbed graphic, and announcing its
 * state as the visitor scrolls would be hostile. The equivalent for assistive
 * technology is the reduced-motion narrative, which states the same beats
 * linearly and without any scroll dependency.
 */
export function ArtifactPlate() {
  return (
    <div className="cw-artifact" style={TRACK_STYLE} aria-hidden="true">
      <span className="cw-artifact__tether" />
      <span className="cw-artifact__ring" />
      <span className="cw-artifact__core" />
      <span className="cw-artifact__evidence">
        {Array.from({ length: 5 }, (_, index) => (
          <i key={index} style={{ "--i": index } as CSSProperties} />
        ))}
      </span>

      {/* The sentence. Its typeface, colour and left edge are invariant for the
          whole run — later phases rewrite the words, never the treatment. */}
      <span className="cw-artifact__plate">
        <span className="cw-artifact__line">{ARTIFACT.line}</span>
      </span>
    </div>
  );
}
