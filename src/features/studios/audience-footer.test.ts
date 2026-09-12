import { describe, expect, it } from "vitest";
import { BEATS, CLOSE, COVER, beatAt } from "./audience-footer";

/**
 * The audience footer's contract: three full-frame cuts, in order, with holds
 * between them, then a long hold before the closing copy resolves. These are
 * the numbers a later "just nudge it" edit could quietly break.
 */
describe("audience footer choreography", () => {
  it("keeps the three beats in the documented order and plates ascending", () => {
    expect(BEATS.map((beat) => beat.id)).toEqual(["notice", "row", "room"]);
    expect(BEATS.map((beat) => beat.plate)).toEqual([2, 3, 4]);
    for (let i = 1; i < BEATS.length; i++) expect(BEATS[i].at).toBeGreaterThan(BEATS[i - 1].at);
  });

  it("gives every beat a real hold on either side", () => {
    // A cut lands as a moment only if the visitor can stop on the frame before
    // it and the frame after it. Fifteen percent of scene progress is roughly
    // three quarters of a viewport of scroll at the current travel.
    expect(BEATS[0].at).toBeGreaterThanOrEqual(0.12);
    for (let i = 1; i < BEATS.length; i++) expect(BEATS[i].at - BEATS[i - 1].at).toBeGreaterThanOrEqual(0.15);
    expect(CLOSE.from - BEATS[BEATS.length - 1].at).toBeGreaterThanOrEqual(0.15);
    expect(CLOSE.to).toBeGreaterThan(CLOSE.from);
    expect(CLOSE.to).toBeLessThanOrEqual(0.95);
  });

  it("only flutters the registered cut, and covers the drifting ones in the dark", () => {
    // Plate 2 is pixel-registered to plate 1; plates 3 and 4 drift everywhere.
    expect(BEATS[0].cover).toBe("flutter");
    expect(BEATS.slice(1).every((beat) => beat.cover === "dark")).toBe(true);
  });

  it("counts beats from progress", () => {
    expect(beatAt(0)).toBe(0);
    expect(beatAt(BEATS[0].at)).toBe(1);
    expect(beatAt((BEATS[1].at + BEATS[2].at) / 2)).toBe(2);
    expect(beatAt(1)).toBe(BEATS.length);
  });
});

describe("audience footer cover", () => {
  it("swaps the plate while the cover is at its darkest", () => {
    for (const spec of Object.values(COVER)) {
      const peak = Math.max(...spec.frames.map((frame) => frame.opacity));
      const swapFraction = spec.swapAt / spec.duration;
      // Find the keyframe interval the swap lands in and the opacity there.
      const frames = spec.frames;
      let opacityAtSwap = 0;
      for (let i = 0; i < frames.length - 1; i++) {
        const a = frames[i];
        const b = frames[i + 1];
        if (swapFraction >= a.offset && swapFraction <= b.offset) {
          const t = (swapFraction - a.offset) / (b.offset - a.offset);
          opacityAtSwap = a.opacity + (b.opacity - a.opacity) * t;
          break;
        }
      }
      // Linear-in-keyframes lower bound; the eased segments only get darker
      // sooner. The swap must land within a hair of the peak.
      expect(opacityAtSwap).toBeGreaterThanOrEqual(peak * 0.9);
    }
  });

  it("never blends two plates: the dark cover is near-opaque and the plates cut", () => {
    expect(COVER.dark.frames.some((frame) => frame.opacity >= 0.95)).toBe(true);
    // Every cover starts and ends fully clear, so nothing is left over the room.
    for (const spec of Object.values(COVER)) {
      expect(spec.frames[0].opacity).toBe(0);
      expect(spec.frames[spec.frames.length - 1].opacity).toBe(0);
    }
  });

  it("stays brief: a cut is a moment, not a fade", () => {
    for (const spec of Object.values(COVER)) expect(spec.duration).toBeLessThanOrEqual(600);
  });
});
