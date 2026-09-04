import { describe, expect, it } from "vitest";

import { GATE, LANDMARK, LIGHT, SCENES, SCROLLABLE_TRAVEL, TOTAL_TRAVEL, journeyAt, lightVariables, sceneTravel } from "./beats";

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
    expect(TOTAL_TRAVEL).toBe(24.4);
    // The final sticky stage consumes one viewport and never scrubs.
    expect(SCROLLABLE_TRAVEL).toBe(TOTAL_TRAVEL - 1);
  });

  it("exposes each scene's travel to the scenes themselves", () => {
    for (const scene of SCENES) {
      expect(sceneTravel(scene.id)).toBe(scene.travel);
    }
  });

  it("places a scene's start and end at the expected journey fractions", () => {
    // The cold open owns the first 4.6 of 23.4 scrollable viewport-heights:
    // Beat 1 and Beat 2 both live inside it.
    expect(journeyAt("open", 0)).toBe(0);
    expect(journeyAt("intelligence", 0)).toBe(Number((4.6 / 23.4).toFixed(4)));
    expect(journeyAt("control", 1)).toBe(Number((24.4 / 23.4).toFixed(4)));
  });

  it("places the landmarks the phase-4 edit shipped with", () => {
    expect(LANDMARK).toEqual({
      threshold: 0.173,
      dept01: 0.2739,
      partition: 0.3961,
      dept02: 0.4516,
      partition02to03: 0.5546,
      dept03: 0.6164,
      partition03to04: 0.7206,
      dept04: 0.7826,
      partition04to05: 0.8841,
      dept05: 0.946,
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
});
