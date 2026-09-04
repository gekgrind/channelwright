import { describe, expect, it } from "vitest";

import { journeyAt } from "./beats";
import { TRACK } from "./artifact-plate";

/**
 * The artifact's continuity precondition.
 *
 * Its position is a running sum of ramps between consecutive stops, and each
 * ramp divides by the span between them. Two stops that resolve to the same
 * journey fraction would divide by zero, which invalidates the whole `calc()`
 * and drops the transform — the artifact would snap to the origin rather than
 * travel. Stops that resolve *out of order* would run a ramp backwards and
 * teleport it. Both failure modes are silent in the browser, so they are
 * asserted here instead.
 */
describe("artifact track", () => {
  const positions = TRACK.map((stop) => journeyAt(stop.scene, stop.at));

  it("keeps every stop inside the journey", () => {
    for (const position of positions) {
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(1);
    }
  });

  it("orders stops strictly, so no ramp has a zero or negative span", () => {
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]);
    }
  });

  it("never moves the artifact by more than a room's width in one segment", () => {
    // A segment that travels a long way in a short span reads as a jump even
    // though it is mathematically continuous.
    for (let index = 1; index < TRACK.length; index += 1) {
      const span = positions[index] - positions[index - 1];
      const distance = Math.abs(TRACK[index].x - TRACK[index - 1].x);
      expect(distance / span).toBeLessThan(1200);
    }
  });
});
