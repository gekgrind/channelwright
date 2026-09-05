import { describe, expect, it } from "vitest";

import { CAMERA, cameraAt, journeyAt } from "./beats";
import { ACTION_AT, HANDOFF_DONE } from "./acts";
import { CAPABILITIES } from "./capabilities";
import { ARTIFACT, FINALE } from "./copy";
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

  it("starts at the origin, because only deltas reach the screen", () => {
    // `axis()` sums the differences between consecutive stops, so the first
    // stop's own coordinates are never rendered. Moving it off (0, 0) would
    // silently translate the entire route — including the approved Beats 3–7
    // compositions — while looking like a local edit to the cold open.
    expect(TRACK[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("carries the artifact through the threshold rather than past it", () => {
    // Beat 2 is crossed by the protagonist, not only by the camera: the
    // artifact has to be above its resting height and still travelling at the
    // moment the aperture reaches the viewer.
    const crossing = journeyAt("open", 0.88);
    const before = TRACK.findLastIndex((_, index) => positions[index] <= crossing);
    expect(before).toBeGreaterThan(0);
    expect(TRACK[before].y).toBeLessThan(0);
    expect(positions[before + 1]).toBeGreaterThan(crossing);
  });

  it("keeps the artifact in the Return rather than leaving it behind", () => {
    // Beat 8 resolves the hypothesis, and the hypothesis is attached to this
    // plate — so the camera cannot go back for it without the artifact.
    const inReturn = TRACK.filter((stop) => stop.scene === "return");
    expect(inReturn.length).toBeGreaterThanOrEqual(3);
    for (const stop of inReturn) expect(Math.abs(stop.x)).toBeLessThan(46);
  });

  it("carries the artifact into the finale and sets it down there", () => {
    // Beat 9 is a handoff, not an exit: the protagonist ends the run standing
    // at the seam, so the last stop on the track belongs to the last scene and
    // it is close enough to centre to be inside the door it is waiting at.
    const inFinale = TRACK.filter((stop) => stop.scene === "finale");
    expect(inFinale.length).toBeGreaterThanOrEqual(2);
    const last = TRACK[TRACK.length - 1];
    expect(last.scene).toBe("finale");
    expect(Math.abs(last.x)).toBeLessThan(14);
  });

  it("moves the artifact far less than the camera across the Return", () => {
    // The read is relative motion: the object holds its side of the frame
    // while the building travels half its length the other way. If the
    // artifact ever swept as far as the camera the beat would collapse into
    // "the page scrolled backwards".
    const inReturn = TRACK.filter((stop) => stop.scene === "return");
    const first = inReturn[0];
    const last = inReturn[inReturn.length - 1];
    const artifactRun = Math.abs(last.x - first.x) / 100;
    const cameraRun = Math.abs(cameraAt(CAMERA.retrieve[1]) - cameraAt(CAMERA.retrieve[0]));
    expect(artifactRun).toBeLessThan(cameraRun);
  });

  it("states the measurement boundary instead of an outcome", () => {
    // The one thing Beat 9 must never do. Performance measurement is DESIGNED,
    // so the plate ends on a binding and an absence, and the room says which is
    // which. If this ever starts failing because measurement shipped, the copy
    // is what has to change — not this assertion.
    const measurement = CAPABILITIES.find((capability) => capability.id === "measurement")!;
    expect(measurement.status).toBe("DESIGNED");
    expect(ARTIFACT.unmeasured).toBe("No result yet");
    expect([FINALE.heading, FINALE.verdict, ...FINALE.body].join(" ")).toContain("ingests no analytics");
  });

  it("offers the action only after the plate has become a decision", () => {
    // The call to action is the last thing in the run, and it is a real link
    // rather than a scrubbed graphic — so it must not become reachable before
    // the handoff it is the consequence of has finished.
    expect(ACTION_AT).toBeGreaterThan(HANDOFF_DONE);
    expect(ACTION_AT).toBeLessThan(1);
  });
});
