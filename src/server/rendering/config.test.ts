import { describe, expect, it } from "vitest";
import { readWorkerQaConfig } from "./config";

describe("render worker QA configuration", () => {
  it("provides conservative audio defaults and validates overrides", () => {
    expect(readWorkerQaConfig({})).toEqual({ loudnessTargetLufs: -16, loudnessToleranceLu: 2, maxTruePeakDbfs: -1 });
    expect(readWorkerQaConfig({ AUDIO_LOUDNESS_TARGET_LUFS: "-14", AUDIO_LOUDNESS_TOLERANCE_LU: "1.5", AUDIO_TRUE_PEAK_MAX_DBFS: "-2" })).toEqual({ loudnessTargetLufs: -14, loudnessToleranceLu: 1.5, maxTruePeakDbfs: -2 });
    expect(() => readWorkerQaConfig({ AUDIO_TRUE_PEAK_MAX_DBFS: "3" })).toThrow();
  });
});
