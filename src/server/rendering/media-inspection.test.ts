import { describe, expect, it } from "vitest";
import { evaluateTechnicalMediaQa, type TechnicalMediaInspection } from "./media-inspection";

const silentInspection: TechnicalMediaInspection = {
  checksumSha256: "a".repeat(64), container: "mov,mp4,m4a", videoCodec: "h264", audioCodec: null,
  videoStreamCount: 1, audioStreamCount: 0, width: 1920, height: 1080, frameRate: 30, pixelFormat: "yuv420p",
  durationSeconds: 6, fileSize: 1_024, audioSampleRate: null, audioChannels: null,
  integratedLoudnessLufs: null, truePeakDbfs: null, maxVolumeDbfs: null, silenceRatio: null,
};

const audioInspection: TechnicalMediaInspection = {
  ...silentInspection, audioCodec: "aac", audioStreamCount: 1, audioSampleRate: 48_000, audioChannels: 2,
  integratedLoudnessLufs: -16.2, truePeakDbfs: -1.4, maxVolumeDbfs: -1.4, silenceRatio: 0.1,
};

const silentExpectation = { width: 1920, height: 1080, fps: 30, durationSeconds: 6, audioRequired: false };
const audioExpectation = { ...silentExpectation, audioRequired: true };
const codes = (result: ReturnType<typeof evaluateTechnicalMediaQa>) => result.findings.map((finding) => finding.code);

describe("technical media QA", () => {
  it("passes a silent master that matches its render input exactly", () => {
    expect(evaluateTechnicalMediaQa(silentInspection, silentExpectation)).toEqual({ verdict: "PASS", findings: [] });
  });

  it("passes an audio master inside the default loudness window", () => {
    expect(evaluateTechnicalMediaQa(audioInspection, audioExpectation)).toEqual({ verdict: "PASS", findings: [] });
  });

  it("tolerates sub-frame duration drift but blocks larger drift", () => {
    expect(evaluateTechnicalMediaQa({ ...silentInspection, durationSeconds: 6.03 }, silentExpectation).verdict).toBe("PASS");
    expect(codes(evaluateTechnicalMediaQa({ ...silentInspection, durationSeconds: 6.5 }, silentExpectation))).toContain("DURATION");
  });

  it.each([
    ["a missing video stream", { videoStreamCount: 0 }, "VIDEO_STREAM_COUNT"],
    ["duplicated video streams", { videoStreamCount: 2 }, "VIDEO_STREAM_COUNT"],
    ["wrong dimensions", { width: 1280, height: 720 }, "DIMENSIONS"],
    ["a drifting frame rate", { frameRate: 29.5 }, "FRAME_RATE"],
    ["an unknown frame rate", { frameRate: null }, "FRAME_RATE"],
  ])("blocks %s", (_label, overrides, code) => {
    const result = evaluateTechnicalMediaQa({ ...silentInspection, ...overrides }, silentExpectation);
    expect(result.verdict).toBe("FAIL");
    expect(codes(result)).toContain(code);
    expect(result.findings.every((finding) => finding.severity === "BLOCKER")).toBe(true);
  });

  it("blocks audio that the render input did not request and audio that it required", () => {
    expect(codes(evaluateTechnicalMediaQa(audioInspection, silentExpectation))).toContain("UNEXPECTED_AUDIO");
    expect(codes(evaluateTechnicalMediaQa(silentInspection, audioExpectation))).toEqual(["AUDIO_MISSING"]);
  });

  it("blocks true peak above the ceiling and honours an explicit ceiling", () => {
    expect(codes(evaluateTechnicalMediaQa({ ...audioInspection, truePeakDbfs: -0.2 }, audioExpectation))).toContain("TRUE_PEAK");
    expect(codes(evaluateTechnicalMediaQa({ ...audioInspection, truePeakDbfs: -0.2 }, { ...audioExpectation, maxTruePeakDbfs: -0.1 }))).not.toContain("TRUE_PEAK");
  });

  it("blocks loudness outside the target window, including unmeasured loudness", () => {
    expect(codes(evaluateTechnicalMediaQa({ ...audioInspection, integratedLoudnessLufs: -22 }, audioExpectation))).toContain("LOUDNESS");
    expect(codes(evaluateTechnicalMediaQa({ ...audioInspection, integratedLoudnessLufs: null }, audioExpectation))).toContain("LOUDNESS");
    expect(codes(evaluateTechnicalMediaQa({ ...audioInspection, integratedLoudnessLufs: -22 }, { ...audioExpectation, loudnessTargetLufs: -23, loudnessToleranceLu: 1 }))).not.toContain("LOUDNESS");
  });

  it("blocks a program that is mostly silence", () => {
    expect(codes(evaluateTechnicalMediaQa({ ...audioInspection, silenceRatio: 0.75 }, audioExpectation))).toContain("EXCESSIVE_SILENCE");
    expect(codes(evaluateTechnicalMediaQa({ ...audioInspection, silenceRatio: 0.5 }, audioExpectation))).not.toContain("EXCESSIVE_SILENCE");
  });

  it("reports every independent failure of a single inspection", () => {
    const result = evaluateTechnicalMediaQa({ ...audioInspection, width: 1280, frameRate: 24, durationSeconds: 12, integratedLoudnessLufs: -30 }, audioExpectation);
    expect(codes(result)).toEqual(["DIMENSIONS", "FRAME_RATE", "DURATION", "LOUDNESS"]);
  });
});
