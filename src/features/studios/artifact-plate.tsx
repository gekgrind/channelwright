"use client";

import { CSSProperties } from "react";

import { journeyAt, type SceneId } from "./beats";
import { ARTIFACT } from "./copy";

/**
 * The artifact: one idea, written down, carried through the whole building.
 *
 * This is the protagonist of Channelwright Studios and the only object present
 * in every beat. It supersedes the old `Signal()` — there is exactly one
 * persistent artifact in this experience and no second system may be added
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
 *   Additive.       Rooms add to it and never take away. Rejected material
 *                   stays, struck through. The sentence's treatment — typeface,
 *                   colour, left edge — never changes, and that invariance is
 *                   what the visitor actually tracks.
 *
 * Beats 3–7 are staged here. Beat 8's return, which resolves the hypothesis
 * attached in Beat 4, is not: the hypothesis deliberately arrives and then goes
 * quiet, because the reveal depends on it having been on screen, unexplained,
 * for four beats.
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
 * that `beats.ts` exists to remove.
 *
 * The first stop is the origin by construction: `axis()` sums *deltas*, so its
 * own coordinates never reach the screen and every later stop's numbers are
 * absolute. Moving it off (0, 0) would silently translate the whole route.
 *
 * Two stops carry the same position on purpose: across Beat 6 the artifact is
 * held at the gate, so scroll advances the check while the object itself does
 * not move. That stillness is the beat, not a bug.
 *
 * The four return-scene stops are Beat 8. The artifact travels *with* the
 * camera rather than being left behind: the question is physically attached to
 * this plate, so resolving it anywhere else would mean resolving it off screen.
 * Its lateral run is deliberately almost flat while the camera's is not: the
 * artifact holds its side of the frame and drifts a few vw, while the world
 * behind it travels half the building in the opposite direction. That relative
 * motion is the whole read — the object stays, the building moves — and it is
 * what makes the beat land as the facility retrieving something rather than as
 * the page scrolling backwards.
 *
 * The four open-scene stops are Beats 1 and 2. The artifact is the first thing
 * in the frame and it never leaves it: it drifts while the cold open's one
 * line lands, is drawn onto the centre line as the building opens, rises to
 * the height of the aperture and is carried through it — so the threshold is
 * crossed *by the protagonist*, not merely by the camera. Its descent onto the
 * conveyance line inside Department 01 is the same continuous sum, which is
 * why Beat 2 hands over to Beat 3 without a seam.
 */
export const TRACK: Stop[] = [
  { scene: "open", at: 0.03, x: 0, y: 0 }, /*          Beat 1 — at rest, before the building */
  { scene: "open", at: 0.45, x: -2, y: -3 }, /*        barely drifts while the line lands */
  { scene: "open", at: 0.74, x: -7, y: -12 }, /*       Beat 2 — drawn toward the opening   */
  { scene: "open", at: 0.95, x: -11, y: -18 }, /*      carried through the threshold       */
  { scene: "intelligence", at: 0.3, x: -34, y: 29 }, /* arrives where it is read    */
  { scene: "intelligence", at: 0.78, x: -28, y: 29 }, /* barely drifts as it is rewritten */
  { scene: "strategy", at: 0.08, x: 12, y: 29 }, /*     leaves the first room       */
  { scene: "strategy", at: 0.44, x: 24, y: 29 }, /*     claimed by a channel        */
  { scene: "strategy", at: 0.86, x: -24, y: 29 }, /*    carried down the hall       */
  { scene: "writers", at: 0.24, x: 2, y: 23 }, /*       docks to be written         */
  { scene: "writers", at: 0.74, x: 8, y: 23 }, /*       slow, while it is checked   */
  { scene: "production", at: 0.2, x: 22, y: 15 }, /*    reaches the gate            */
  { scene: "production", at: 0.76, x: 22, y: 15 }, /*   HELD — the gate is shut     */
  { scene: "control", at: 0.53, x: 46, y: 5 }, /*       goes out under one name     */
  { scene: "return", at: 0.06, x: 42, y: 3 }, /*        Beat 8 — barely drifts, then is taken back */
  { scene: "return", at: 0.34, x: 24, y: 20 }, /*       barely moves while the hall sweeps the other way */
  { scene: "return", at: 0.54, x: 22, y: 26 }, /*       set back down on the route it left by */
  { scene: "return", at: 0.84, x: 10, y: 18 }, /*       released, facing forward again */
];

/**
 * A window on the journey, as a CSS ramp that is 0 before it, 1 after it.
 * Every scroll-driven value in this experience is built from these.
 */
function ramp(from: number, to: number) {
  return `clamp(0, calc((var(--j) - ${from}) / ${(to - from).toFixed(4)}), 1)`;
}

/** A ramp stated in room-relative terms, which is how every beat is authored. */
function beat(scene: SceneId, from: number, to: number) {
  return ramp(journeyAt(scene, from), journeyAt(scene, to));
}

/**
 * The running sum of one axis across the track.
 *
 * Overlapping ramps are what keep the motion continuous: each segment
 * contributes its own delta as it opens, and a completed segment simply holds
 * its full contribution, so the artifact can never jump.
 */
function axis(pick: (stop: Stop) => number) {
  return TRACK.slice(1)
    .map((stop, index) => {
      const previous = TRACK[index];
      return `${ramp(journeyAt(previous.scene, previous.at), journeyAt(stop.scene, stop.at))} * ${
        pick(stop) - pick(previous)
      }`;
    })
    .join(" + ");
}

/**
 * Per-beat state, all additive, all derived from the beat table.
 *
 * Each value is a 0..1 ramp the stylesheet reads. Nothing here ever runs
 * backwards, so scrubbing the page back and forth shows the same artifact
 * gaining and losing the same things in the same order.
 */
const STATE = {
  /* Beat 3 — the first room reads it and hands back something else. */
  "--strike": beat("intelligence", 0.4, 0.54),
  "--rewrite": beat("intelligence", 0.5, 0.66),
  /* Beat 4 — it is claimed by a channel, and given a question to answer. */
  "--claimed": beat("strategy", 0.3, 0.46),
  "--asked": beat("strategy", 0.46, 0.6),
  /* Beat 5 — it takes a shape, and one part of that shape does not survive. */
  "--shaped": beat("writers", 0.24, 0.44),
  "--sent-back": beat("writers", 0.5, 0.62),
  "--reworked": beat("writers", 0.68, 0.8),
  /* Beat 6 — held at the gate while it is checked, then let through. The
     sweep is what advances during the hold, so scrolling still does something
     even though the artifact does not move. */
  "--held": beat("production", 0.22, 0.34),
  "--sweep": beat("production", 0.34, 0.64),
  "--cleared": beat("production", 0.64, 0.78),
  /* Beat 7 — several names existed; one of them goes out. */
  "--named": beat("control", 0.3, 0.46),
  "--chosen": beat("control", 0.5, 0.64),
  /* Beat 8 — the question comes back.
     `--recall` is the recognition cue: the dormant tag stirs a beat before the
     camera turns, so the return is motivated by the artifact rather than
     announced by the movement. `--resolved` then lands during the hold in
     Department 02, once the world has arrived. Neither of them answers the
     question — see `ARTIFACT.bound` — because performance measurement is not a
     capability this product has. */
  "--recall": beat("return", 0.02, 0.1),
  "--resolved": beat("return", 0.38, 0.52),

  /* Legacy room state kept from the pass-2 artifact: the ring while it is
     being worked on, and the evidence that attaches and stays attached. */
  "--work": `calc(${beat("intelligence", 0.28, 0.36)} * ${beat("strategy", 0.2, 0.1)})`,
  "--bound": beat("intelligence", 0.62, 0.78),

  "--ax": axis((stop) => stop.x),
  "--ay": axis((stop) => stop.y),
} as CSSProperties;

/**
 * Kept `aria-hidden`: this is a scroll-scrubbed graphic, and announcing its
 * state as the visitor scrolls would be hostile. The equivalent for assistive
 * technology is the reduced-motion narrative, which states the same beats
 * linearly and without any scroll dependency.
 */
export function ArtifactPlate() {
  return (
    <div className="cw-artifact" style={STATE} aria-hidden="true">
      <span className="cw-artifact__tether" />
      <span className="cw-artifact__ring" />
      <span className="cw-artifact__core" />
      <span className="cw-artifact__evidence">
        {Array.from({ length: 5 }, (_, index) => (
          <i key={index} style={{ "--i": index } as CSSProperties} />
        ))}
      </span>

      {/* Beat 6's gate. Nested inside the artifact rather than standing in the
          world, because it is only ever visible during the hold — when the
          artifact is stationary — and this way the gate and the thing it is
          holding can never disagree about where or when it shut. */}
      <span className="cw-artifact__gate">
        <i data-side="left" />
        <i data-side="right" />
        <b />
      </span>

      <span className="cw-artifact__plate">
        {/* Beat 3. Both lines carry the same treatment, which is the whole
            device: the visitor sees one sentence replaced by another, not two
            different objects. The first is struck, never removed. */}
        <span className="cw-artifact__line cw-artifact__line--first">{ARTIFACT.line}</span>
        <span className="cw-artifact__line cw-artifact__line--second">{ARTIFACT.rewritten}</span>

        {/* Beat 4. Attached to the plate, not floated beside it. The question
            arrives lit and then settles to a trace — it is waiting for Beat 8. */}
        <span className="cw-artifact__tags">
          <span className="cw-artifact__tag" data-kind="audience">{ARTIFACT.audience}</span>
          <span className="cw-artifact__tag" data-kind="asked">{ARTIFACT.hypothesis}</span>
        </span>

        {/* Beat 5. The shape it takes, and the one part of it that comes back
            for another pass. */}
        <span className="cw-artifact__shape">
          {ARTIFACT.sections.map((section, index) => (
            <i
              key={section}
              data-flagged={index === ARTIFACT.flagged ? "true" : undefined}
              style={{ "--i": index } as CSSProperties}
            >
              {section}
            </i>
          ))}
        </span>

        {/* Beat 7. The names it could have gone out under. */}
        <span className="cw-artifact__names">
          {ARTIFACT.candidates.map((candidate, index) => (
            <i
              key={candidate.label}
              data-rejected={candidate.rejected ? "true" : undefined}
              style={{ "--i": index } as CSSProperties}
            >
              {candidate.label}
            </i>
          ))}
        </span>

        {/* Beat 8. What the return finds. Two halves on purpose: the binding
            is real and lit, the result is absent and stays dim. Nothing else
            is added to the plate — the beat is that the question is still
            here, not that a dashboard arrived. */}
        <span className="cw-artifact__binding">
          <i data-state="bound">{ARTIFACT.bound}</i>
          <i data-state="open">{ARTIFACT.unmeasured}</i>
        </span>
      </span>
    </div>
  );
}
