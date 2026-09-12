import { describe, expect, it } from "vitest";
import { CAST, PASSES, SWAP_STOPS, swapAlphaAt } from "./audience-footer";

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

/**
 * The invariant the whole footer turns on, and the one three repairs missed.
 *
 * Plate 1 and plate 4 are different photographs of the same room *everywhere*
 * — measured mean |Δ| of roughly 25-45 of 255 across the entire frame, not
 * only on the heads that turn. So a mask holding partial alpha over anyone is
 * a permanent blend of two poses of that person, and where the person carries
 * real drift between plates that is a readable second pair of glasses, present
 * in the settled composite long after every shadow has lifted.
 *
 * These assertions are written against coordinates read off the plates rather
 * than against the geometry, so they keep their meaning if `CAST` is retuned:
 * they say "nothing may paint partially *here*", not "this ellipse may not
 * move".
 */
describe("audience footer mask safety", () => {
  /** Glasses positions in plate percentages, union of the plate-1 and plate-4
   *  poses, read off `public/footer/1-1920.webp` and `4-1920.webp`. */
  const HELD_OUT = {
    "blonde woman": { x: 10, y: 37 },
    "cable-knit man": { x: 24, y: 34 },
    "left-edge man": { x: 3, y: 40 },
  } as const;

  it("never paints a held-out face, at any alpha, in any pass", () => {
    // The blonde woman measured 0.31 and the cable-knit man 0.39 before the
    // foreground regions were pulled down onto the out-of-focus band — a
    // permanent third of the other plate's likeness of a face nobody ever
    // asked to transition.
    for (const [who, at] of Object.entries(HELD_OUT)) {
      for (const pass of PASSES) {
        const alpha = swapAlphaAt(pass.regions, at.x, at.y);
        expect(`${who} under ${pass.id}: ${alpha.toFixed(3)}`).toBe(`${who} under ${pass.id}: 0.000`);
      }
    }
  });

  it("keeps the three foreground regions out of the sharp middle row", () => {
    // Local-contrast mapping of plate 1 puts the seated rows above y≈52% and
    // the out-of-focus foreground below it. A foreground mask that reaches
    // above that line is over faces it has no business changing, which is
    // exactly how the defect above got there.
    for (const region of [CAST.foregroundLeft, CAST.foregroundCentre, CAST.foregroundRight]) {
      expect(region.y - region.ry).toBeGreaterThanOrEqual(48);
    }
  });

  it("holds the partial-alpha band to a thin rim of each region", () => {
    // A long feather is a wide permanent cross-fade: this used to fall off
    // from 44% of the radius, so more than half of every region was a blend
    // of two photographs. The rim has to stay narrow enough that it cannot
    // contain a whole pair of glasses.
    const [solidTo] = [...SWAP_STOPS].filter(([, alpha]) => alpha === 1).pop()!;
    expect(solidTo).toBeGreaterThanOrEqual(0.75);
    expect(SWAP_STOPS.at(-1)).toEqual([1, 0]);
  });

  it("paints every transitioned subject's own centre at full strength", () => {
    // The counterpart guard: tightening the mask must not stop a pass
    // actually replacing the person it exists for.
    for (const pass of PASSES) {
      for (const region of pass.regions) {
        expect(swapAlphaAt(pass.regions, region.x, region.y)).toBe(1);
      }
    }
  });
});
