import { describe, expect, it } from "vitest";
import { CAST, PASSES } from "./audience-footer";

/**
 * Durable invariants for the audience footer's choreography, pinned after
 * the repair pass that replaced the dip-to-shadow-cut with a blur-and-
 * exposure pulse and widened the three foreground passes. These are the
 * facts a later edit is most likely to silently break: pass order, which
 * plate each pass routes to, and the widened windows the jank fix depends
 * on. None of this asserts anything about rendered pixels — see the
 * implementation report for the browser-based visual QA that covers that.
 */
describe("audience footer choreography", () => {
  it("keeps the eight passes in the documented order", () => {
    expect(PASSES.map((pass) => pass.id)).toEqual([
      "notice",
      "right",
      "centre",
      "deepen",
      "settle",
      "near-left",
      "near-right",
      "nearest",
    ]);
  });

  it("never lets a pass's own window run backwards or empty", () => {
    for (const pass of PASSES) {
      expect(pass.to).toBeGreaterThan(pass.from);
    }
  });

  it("holds the foreground passes at their widened width", () => {
    // Widened from an original 0.10 to 0.14 of scene progress: a single
    // dropped-frame stall measured under CPU throttling was wide enough to
    // skip a 0.10 window outright, landing the visitor on the pass's
    // "before" and "after" with nothing painted in between. Narrowing this
    // back down would reintroduce that failure mode silently.
    for (const pass of ["near-left", "near-right", "nearest"] as const) {
      const found = PASSES.find((p) => p.id === pass)!;
      expect(found.to - found.from).toBeCloseTo(0.14, 5);
    }
  });

  it("routes the centre man around plate 3, whose likeness for him drifted", () => {
    const centreManPasses = PASSES.filter((pass) => pass.regions.includes(CAST.centreMan));
    expect(centreManPasses.map((pass) => pass.plate)).toEqual([2, 4]);
  });

  it("never shows two poses of the same person in the same pass", () => {
    // Each pass's regions must be pairwise distinct people — the whole
    // mechanism depends on never asking the mask to reveal two different
    // photographs of one face in the same paint.
    for (const pass of PASSES) {
      const unique = new Set(pass.regions);
      expect(unique.size).toBe(pass.regions.length);
    }
  });

  it("covers every named cast member with at least one pass", () => {
    // An entry in CAST with no pass referencing it would be a mask nobody
    // ever reveals — dead geometry, and worth catching.
    const covered = new Set(PASSES.flatMap((pass) => pass.regions));
    for (const region of Object.values(CAST)) {
      expect(covered.has(region)).toBe(true);
    }
  });

  it("documents the known ceiling on the final hold: ten covered, not the full room", () => {
    // The final hold is not literally every visible person facing camera —
    // the blonde woman and the cable-knit-sweater man hold the same upward
    // pose in all four source plates (drift and relighting, not a turn),
    // and the left-edge and rear-left men are excluded for the same reason
    // at smaller scale. None of the four has a CAST entry, so this count is
    // the honest ceiling: pinned here so a future attempt to "fix" the
    // final hold by fabricating motion for them has to change this
    // assertion deliberately rather than drift past it unnoticed.
    expect(Object.keys(CAST).length).toBe(10);
  });
});
