import { describe, expect, it } from "vitest";

import { LANDMARK, SCENES, SCROLLABLE_TRAVEL, TOTAL_TRAVEL, journeyAt, sceneTravel } from "./beats";

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
    expect(TOTAL_TRAVEL).toBe(23.2);
    // The final sticky stage consumes one viewport and never scrubs.
    expect(SCROLLABLE_TRAVEL).toBe(TOTAL_TRAVEL - 1);
  });

  it("exposes each scene's travel to the scenes themselves", () => {
    for (const scene of SCENES) {
      expect(sceneTravel(scene.id)).toBe(scene.travel);
    }
  });

  it("places a scene's start and end at the expected journey fractions", () => {
    // The cold open owns the first 3.4 of 22.2 scrollable viewport-heights.
    expect(journeyAt("open", 0)).toBe(0);
    expect(journeyAt("intelligence", 0)).toBe(Number((3.4 / 22.2).toFixed(4)));
    expect(journeyAt("control", 1)).toBe(Number((23.2 / 22.2).toFixed(4)));
  });

  it("reproduces the landmark positions the experience shipped with", () => {
    expect(LANDMARK).toEqual({
      threshold: 0.1571,
      dept01: 0.2346,
      partition: 0.3635,
      dept02: 0.422,
      partition02to03: 0.5305,
      dept03: 0.5957,
      partition03to04: 0.7055,
      dept04: 0.7708,
      partition04to05: 0.8778,
      dept05: 0.9431,
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
});
