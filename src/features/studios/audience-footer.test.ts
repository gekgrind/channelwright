import { describe, expect, it } from "vitest";
import { AUDIENCE_VIDEO, CLOSE, PLAY_AT, RESET_AT } from "./audience-footer";

/**
 * The audience footer's contract, now that the turn is one continuous video
 * rather than four plates cut between: start it once, never restart it on a
 * jitter, and leave a real hold between the end of the motion and the moment
 * the closing copy arrives over it. These are the numbers a later "just nudge
 * it" edit could quietly break.
 */
describe("audience footer playback thresholds", () => {
  it("starts the turn as the audience arrives, not before and not deep into it", () => {
    expect(PLAY_AT).toBeGreaterThan(0);
    // Far enough in that the scene is genuinely the visitor's subject, early
    // enough that the turn is not still running when the copy is due.
    expect(PLAY_AT).toBeLessThan(CLOSE.from / 2);
  });

  it("keeps a rewind threshold strictly below the play threshold", () => {
    // The gap is the hysteresis. Were these equal, a visitor resting their
    // scroll on the threshold would restart the video on every small jitter.
    expect(RESET_AT).toBeLessThan(PLAY_AT);
  });

  it("leaves the turn a long hold before the closing copy resolves over it", () => {
    expect(CLOSE.from - PLAY_AT).toBeGreaterThanOrEqual(0.5);
    expect(CLOSE.to).toBeGreaterThan(CLOSE.from);
    expect(CLOSE.to).toBeLessThanOrEqual(0.95);
  });
});

describe("audience turn sources", () => {
  it("always offers the universal MP4", () => {
    const mp4 = AUDIENCE_VIDEO.filter((source) => source.type === "video/mp4");
    expect(mp4).toHaveLength(1);
    expect(mp4[0].src).toBe("/studios/audience-turn.mp4");
  });

  it("offers WebM ahead of MP4, so the browsers that take it never fetch both", () => {
    const types = AUDIENCE_VIDEO.map((source) => source.type);
    if (types.includes("video/webm")) {
      expect(types.indexOf("video/webm")).toBeLessThan(types.indexOf("video/mp4"));
    }
  });

  it("declares a type for every source, so no browser downloads to find out", () => {
    for (const source of AUDIENCE_VIDEO) {
      expect(source.type).toMatch(/^video\//);
      expect(source.src.startsWith("/")).toBe(true);
    }
  });
});
