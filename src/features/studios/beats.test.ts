import { describe, expect, it } from "vitest";

import {
  CAMERA,
  SEAM,
  GATE,
  HOME,
  JOURNEY_SCRUB,
  LANDMARK,
  LIGHT,
  SCENES,
  SCROLLABLE_TRAVEL,
  TOTAL_TRAVEL,
  cameraAt,
  cameraVariables,
  journeyAt,
  lightVariables,
  reverseAt,
  sceneProgress,
  sceneTravel,
} from "./beats";

/**
 * The edit's derivation, pinned.
 *
 * `beats.ts` exists to remove the hand-rescaled journey fractions that had to
 * be recomputed by hand every time a department was added. The value of that
 * is only real if the derivation is correct, so the positions the pass-2
 * experience shipped with are asserted here directly: introducing the module
 * must not move a single prop in the building.
 *
 * When a later phase deliberately changes the edit, these expectations are
 * meant to be updated in the same commit — a failure here is the intended
 * signal that the building's geometry moved.
 */
describe("studios beat table", () => {
  it("derives scrollable travel from the scene lengths", () => {
    expect(TOTAL_TRAVEL).toBe(35.4);
    // The final sticky stage consumes one viewport and never scrubs.
    expect(SCROLLABLE_TRAVEL).toBe(TOTAL_TRAVEL - 1);
  });

  it("exposes each scene's travel to the scenes themselves", () => {
    for (const scene of SCENES) {
      expect(sceneTravel(scene.id)).toBe(scene.travel);
    }
  });

  it("places a scene's start and end at the expected journey fractions", () => {
    // The cold open owns the first 4.6 of 34.4 scrollable viewport-heights:
    // Beat 1 and Beat 2 both live inside it.
    expect(journeyAt("open", 0)).toBe(0);
    expect(journeyAt("intelligence", 0)).toBe(Number((4.6 / 34.4).toFixed(4)));
    expect(journeyAt("finale", 1)).toBe(Number((35.4 / 34.4).toFixed(4)));
  });

  it("places the landmarks the phase-6 edit shipped with", () => {
    expect(LANDMARK).toEqual({
      threshold: 0.1177,
      dept01: 0.1863,
      partition: 0.2695,
      dept02: 0.3072,
      partition02to03: 0.3772,
      dept03: 0.4193,
      partition03to04: 0.4902,
      dept04: 0.5323,
      partition04to05: 0.6014,
      dept05: 0.6435,
    });
  });

  it("keeps every landmark inside the journey and in scroll order", () => {
    const positions = Object.values(LANDMARK);
    for (const position of positions) {
      expect(position).toBeGreaterThan(0);
      expect(position).toBeLessThanOrEqual(1);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("keeps the threshold inside the cold open, ahead of Department 01", () => {
    // Beat 2 is the climax of the open scene rather than a prop passed on the
    // way out of it, and the corridor beyond it runs into Department 01.
    expect(LANDMARK.threshold).toBeGreaterThan(journeyAt("open", 0.8));
    expect(LANDMARK.threshold).toBeLessThan(journeyAt("intelligence", 0));
    expect(LANDMARK.dept01).toBeGreaterThan(LANDMARK.threshold);
  });

  it("stages the facility's light by depth and finishes it before Beat 3", () => {
    const [nearFrom] = LIGHT.wake;
    const [midFrom] = LIGHT.wakeMid;
    const [farFrom, farTo] = LIGHT.wakeFar;
    // Foreground, then the operating floor, then the back wall.
    expect(nearFrom).toBeLessThan(midFrom);
    expect(midFrom).toBeLessThan(farFrom);
    // Every wake ramp, and the crossing dolly, is spent before the room the
    // approved Beat 3 composition lives in.
    const beat3 = journeyAt("intelligence", 0.4);
    expect(farTo).toBeLessThan(LANDMARK.threshold);
    expect(GATE.dolly[2]).toBeLessThan(beat3);
    // Department 01's wash is the pass-2 timing, restated room-relative.
    expect(LIGHT.dept01[0]).toBeGreaterThan(LANDMARK.threshold);
  });

  it("emits every light window as a start and a reciprocal span", () => {
    const vars = lightVariables();
    // Division in `calc()` by anything but a literal number is the kind of
    // thing that silently invalidates a declaration and takes the building's
    // light with it, so the stylesheet is only ever handed multipliers.
    for (const [name, value] of Object.entries(vars)) {
      expect(Number.isFinite(Number(value)), `${name} = ${value}`).toBe(true);
    }
    expect(vars["--wake-a"]).toBe(String(LIGHT.wake[0]));
    expect(Number(vars["--wake-k"])).toBeCloseTo(1 / (LIGHT.wake[1] - LIGHT.wake[0]), 3);
  });

  it("maps a journey position onto a scene's own progress through the overlap", () => {
    // Every scene after the cold open is pulled up by one viewport, so the
    // wrapper is shorter than the sum of the scene lengths and `journeyAt` is
    // an internal coordinate rather than scroll progress. Authoring a cue
    // against a journey position has to go through `sceneProgress`; this is
    // the invariant that makes that safe.
    expect(JOURNEY_SCRUB).toBe(TOTAL_TRAVEL - (SCENES.length - 1) - 1);
    expect(sceneProgress("open", 0)).toBe(0);
    expect(sceneProgress("finale", 1)).toBe(1);
    // The naive `at / usable-range` guess is wrong by a third of a scene, which
    // is exactly why it is worth a test rather than a comment.
    expect(sceneProgress("finale", journeyAt("finale", 0))).toBeGreaterThan(0.15);
  });
});

describe("the Return's camera", () => {
  it("goes back to the room that asked the question", () => {
    // Department 02, not 01: `--asked` is a Beat 4 ramp in `strategy`
    // coordinates, and the release decision is bound to the strategy KPI.
    expect(HOME).toBe(LANDMARK.dept02);
  });

  it("keeps the camera on the timeline everywhere outside the Return", () => {
    // Derived rather than listed: adding a scene rescales every fraction, and
    // a hand-written list silently starts sampling inside the Return.
    const before = [0, ...Object.values(LANDMARK), CAMERA.retrieve[0]].filter(
      (j) => j <= CAMERA.retrieve[0],
    );
    expect(before.length).toBeGreaterThan(6);
    for (const j of before) expect(cameraAt(j)).toBeCloseTo(j, 6);
    // ...and hands it back once the release completes.
    for (const j of [CAMERA.release[1], 0.999, 1]) {
      expect(cameraAt(j)).toBeCloseTo(j, 6);
    }
  });

  it("bounds --rev on [0, 1] and returns it to exactly zero", () => {
    let peak = 0;
    for (let i = 0; i <= 2000; i += 1) {
      const rev = reverseAt(i / 2000);
      expect(rev).toBeGreaterThanOrEqual(0);
      expect(rev).toBeLessThanOrEqual(1);
      peak = Math.max(peak, rev);
    }
    expect(peak).toBeCloseTo(1, 6);
    expect(reverseAt(CAMERA.retrieve[0])).toBe(0);
    expect(reverseAt(CAMERA.release[1])).toBe(0);
    expect(reverseAt(1)).toBe(0);
  });

  it("parks the camera on the landmark between the two legs", () => {
    const hold = (CAMERA.retrieve[1] + CAMERA.release[0]) / 2;
    expect(reverseAt(hold)).toBeCloseTo(1, 6);
    expect(cameraAt(hold)).toBeCloseTo(HOME, 6);
  });

  it("is a pure function of journey position, so scrub direction cannot matter", () => {
    const forward = [];
    const backward = [];
    for (let i = 0; i <= 400; i += 1) forward.push(cameraAt(0.78 + i / 2000));
    for (let i = 400; i >= 0; i -= 1) backward.unshift(cameraAt(0.78 + i / 2000));
    expect(forward).toEqual(backward);
  });

  it("runs the Return inside its own scene and never touches the timeline", () => {
    const [retrieveFrom, retrieveTo] = CAMERA.retrieve;
    const [releaseFrom, releaseTo] = CAMERA.release;
    expect(retrieveFrom).toBeGreaterThan(journeyAt("return", 0));
    expect(retrieveTo).toBeLessThan(releaseFrom);
    expect(releaseTo).toBeLessThanOrEqual(1);
    // The camera reverses; the story does not. `--j` is scroll and the Return
    // is expressed purely as a blend away from it.
    expect(cameraAt(retrieveTo)).toBeLessThan(cameraAt(retrieveFrom));
    expect(cameraAt(releaseTo)).toBeGreaterThan(cameraAt(releaseFrom));
  });

  it("emits the camera windows as a start and a reciprocal span", () => {
    const vars = cameraVariables();
    for (const [name, value] of Object.entries(vars)) {
      expect(Number.isFinite(Number(value)), `${name} = ${value}`).toBe(true);
    }
    expect(vars["--home"]).toBe(String(HOME));
    expect(Number(vars["--rev-k"])).toBeCloseTo(1 / (CAMERA.retrieve[1] - CAMERA.retrieve[0]), 3);
    expect(Number(vars["--rel-k"])).toBeCloseTo(1 / (CAMERA.release[1] - CAMERA.release[0]), 3);
  });

  it("places the measurement seam where the camera can never reach it", () => {
    // `measurement` is DESIGNED. The door is put past the last frame the
    // visitor can scroll to, so the camera closes on it and the building runs
    // out — the loop is shown open rather than described as open.
    expect(SEAM).toBeGreaterThan(1);
    expect(cameraAt(1)).toBeLessThan(SEAM);
    let closest = 0;
    for (let i = 0; i <= 2000; i += 1) closest = Math.max(closest, cameraAt(i / 2000));
    expect(closest).toBeLessThan(SEAM);
  });

  it("leaves the finale on a neutral camera, with the Return fully relaxed", () => {
    // Beat 9 performs no camera intervention of its own: the Return is the
    // one reversal in the run and it must be spent before the ending starts.
    const finaleStart = journeyAt("finale", 0);
    expect(CAMERA.release[1]).toBeLessThan(finaleStart);
    for (let i = 0; i <= 400; i += 1) {
      const j = finaleStart + (1 - finaleStart) * (i / 400);
      expect(reverseAt(j)).toBe(0);
      expect(cameraAt(j)).toBeCloseTo(j, 6);
    }
  });

  it("resolves the seam after the Return has released and before the end", () => {
    const [from, to] = LIGHT.seam;
    expect(from).toBeGreaterThan(CAMERA.release[1]);
    expect(to).toBeLessThan(1);
    expect(from).toBeLessThan(to);
  });
});
