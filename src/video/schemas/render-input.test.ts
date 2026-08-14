import { describe, expect, it } from "vitest";
import {
  calculateDurationInFrames,
  deterministicSampleInput,
  renderInputSchema,
} from "./render-input";

describe("render input", () => {
  it("derives the deterministic sample duration from scene timing", () => {
    const input = renderInputSchema.parse(deterministicSampleInput);
    expect(calculateDurationInFrames(input)).toBe(144);
  });

  it("rejects embedded media binaries", () => {
    const result = renderInputSchema.safeParse({
      ...deterministicSampleInput,
      narrationReference: "data:audio/wav;base64,AAAA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects caption timing beyond the calculated scene duration", () => {
    const result = renderInputSchema.safeParse({
      ...deterministicSampleInput,
      captions: [{ startSeconds: 4.7, endSeconds: 5, text: "Too late" }],
    });
    expect(result.success).toBe(false);
  });

  it("validates synchronized audio timing and rejects overlap", () => {
    const track = {
      assetVersionId: "c67fd2ae-1936-4a30-bab2-89e3054e0104",
      role: "NARRATION" as const,
      reference: "public://tone.wav",
      checksumSha256: "a".repeat(64),
      mimeType: "audio/wav" as const,
      sourceDurationSeconds: 4.8,
      startSeconds: 0,
      trimStartSeconds: 0,
      durationSeconds: 2.4,
      gainDb: -6,
      fadeInSeconds: 0.1,
      fadeOutSeconds: 0.1,
    };
    expect(renderInputSchema.safeParse({ ...deterministicSampleInput, audioTracks: [track] }).success).toBe(true);
    expect(renderInputSchema.safeParse({ ...deterministicSampleInput, audioTracks: [track, { ...track, assetVersionId: "e7fa6511-e4f7-4264-8559-dbc586b9478b", startSeconds: 2 }] }).success).toBe(false);
    expect(renderInputSchema.safeParse({ ...deterministicSampleInput, audioTracks: [{ ...track, durationSeconds: 5 }] }).success).toBe(false);
  });
});
