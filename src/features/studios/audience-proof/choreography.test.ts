import { describe, expect, it } from "vitest";
import { overlayOpacities, poseWeights, TURN_WINDOWS } from "./choreography";

describe("audience attention choreography", () => {
  it("holds diverted entry and exact canonical final, including overscroll", () => {
    for (const window of Object.values(TURN_WINDOWS)) {
      expect(poseWeights(-1, window)).toEqual({ a: 1, b: 0, c: 0 });
      expect(poseWeights(window[0], window)).toEqual({ a: 1, b: 0, c: 0 });
      for (const progress of [0.85, 0.9, 1, 2]) {
        expect(poseWeights(progress, window)).toEqual({ a: 0, b: 0, c: 1 });
        expect(overlayOpacities(poseWeights(progress, window))).toEqual({ a: 0, b: 0 });
      }
    }
  });

  it("turns left first and completes left while right still turns", () => {
    expect(poseWeights(0.2, TURN_WINDOWS.left).b).toBeGreaterThan(0);
    expect(poseWeights(0.2, TURN_WINDOWS.right)).toEqual({ a: 1, b: 0, c: 0 });
    expect(poseWeights(0.7, TURN_WINDOWS.left).c).toBe(1);
    expect(poseWeights(0.7, TURN_WINDOWS.right).c).toBeLessThan(1);
  });

  it("maintains unit coverage without canonical bleed during the first dissolve", () => {
    for (let step = 0; step <= 100; step++) {
      const weights = poseWeights(step / 100, TURN_WINDOWS.left);
      const opacity = overlayOpacities(weights);
      expect(weights.a + weights.b + weights.c).toBeCloseTo(1);
      expect(opacity.a).toBeCloseTo(weights.a);
      expect((1 - opacity.a) * opacity.b).toBeCloseTo(weights.b);
      expect((1 - opacity.a) * (1 - opacity.b)).toBeCloseTo(weights.c);
    }
  });

  it("reverses deterministically without accumulated state", () => {
    const forward = [0, 0.25, 0.5, 0.75, 1].map((p) => poseWeights(p, TURN_WINDOWS.right));
    const reverse = [1, 0.75, 0.5, 0.25, 0].map((p) => poseWeights(p, TURN_WINDOWS.right));
    expect(reverse.reverse()).toEqual(forward);
  });
});
