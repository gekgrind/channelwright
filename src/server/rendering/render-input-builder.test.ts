import { describe, expect, it } from "vitest";
import type { Script } from "@/domain/contracts";
import type { MediaAssetVersionRecord } from "@/domain/media-production";
import { MEDIA_BUCKET } from "@/server/media/storage";
import { buildRenderInput } from "./render-input-builder";

const videoId = "6f42a9af-70c6-4aa7-bcb2-cd674ab5b611";
const ownerId = "0f802c92-fc5b-413f-bfbd-0a8b852cde44";

const script: Script = {
  version: 3,
  title: "How loyalty programs really work",
  hook: "Loyalty programs are not discounts; they are demand-shaping systems.",
  sections: [
    { heading: "The visible offer", purpose: "Frame the surface mechanic", narration: "Customers see points, stamps, and tiers.", claimRefs: ["claim-1"], estimatedSeconds: 20 },
    { heading: "The hidden ledger", purpose: "Explain the accounting", narration: "Every unredeemed point is a liability on the balance sheet.", claimRefs: ["claim-2"], estimatedSeconds: 30 },
    { heading: "The behavioural loop", purpose: "Show the incentive", narration: "Tier thresholds change purchase timing more than price does.", claimRefs: ["claim-3"], estimatedSeconds: 25 },
  ],
  cta: "Subscribe for the next system breakdown.",
  outro: "That is the loyalty ledger.",
  estimatedSeconds: 80,
};

const asset = (overrides: Partial<MediaAssetVersionRecord>): MediaAssetVersionRecord => ({
  id: "asset-1", ownerId, assetId: "asset", version: 1, kind: "IMAGE", status: "READY", provider: "FIXTURE", provenance: {},
  rightsStatus: "VERIFIED", checksumSha256: "a".repeat(64), mimeType: "image/png", byteSize: 1_024, durationSeconds: null,
  width: 1920, height: 1080, storageBucket: MEDIA_BUCKET, storageKey: `${ownerId}/assets/sha256/${"a".repeat(64)}.png`,
  createdAt: "2026-08-14T12:00:00.000Z", ...overrides,
});

const totalDuration = 92;

const ids = {
  visualA: "3b0dd4d0-1d7d-4a8e-9f28-9c0b3a1f5e11",
  narration: "f1c2d3e4-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  music: "c7b6a5d4-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
};

const visualIds = [
  ids.visualA,
  "9a5f2a48-1b3c-4d5e-8f90-11a2b3c4d5e6",
  "6d1e7c3b-2a4f-4b8c-9d0e-1f2a3b4c5d60",
  "2c9b8a7d-6e5f-4a3b-8c1d-0e9f8a7b6c51",
  "4e3d2c1b-0a9f-4e8d-9c7b-6a5f4e3d2c12",
];

describe("render input construction", () => {
  it("frames the approved script as title, content, and CTA scenes with contiguous captions", () => {
    const input = buildRenderInput({ videoId, script, assets: [] });

    expect(input.approvedScriptVersion).toBe(3);
    expect(input.scenes.map((scene) => scene.role)).toEqual(["TITLE", "CONTENT", "CONTENT", "CONTENT", "CTA"]);
    expect(input.scenes.map((scene) => scene.id)).toEqual(["scene-1", "scene-2", "scene-3", "scene-4", "scene-5"]);
    expect(input.scenes[0]).toMatchObject({ headline: script.title, body: script.hook, durationSeconds: 12 });
    expect(input.scenes[4]).toMatchObject({ headline: "Next step", body: script.cta, durationSeconds: 5 });
    expect(input.captions.map((caption) => [caption.startSeconds, caption.endSeconds])).toEqual([[0, 12], [12, 32], [32, 62], [62, 87], [87, 92]]);
    expect(input.audioTracks).toEqual([]);
    expect(input.scenes.every((scene) => scene.assetReferences.length === 0)).toBe(true);
  });

  it("clamps the title duration into the two-to-twelve second window", () => {
    const brief = { ...script, sections: [{ ...script.sections[0], estimatedSeconds: 1 }, ...script.sections.slice(1)] };
    expect(buildRenderInput({ videoId, script: brief, assets: [] }).scenes[0].durationSeconds).toBe(2);
  });

  it("falls back to the outro when the script has no call to action", () => {
    const input = buildRenderInput({ videoId, script: { ...script, cta: "" }, assets: [] });
    expect(input.scenes[4].body).toBe(script.outro);
  });

  it("assigns one visual asset version per scene and ignores non-visual kinds", () => {
    const visuals = visualIds.map((id, index) => asset({
      id, kind: index === 1 ? "VIDEO" : "IMAGE", mimeType: index === 1 ? "video/mp4" : "image/png",
      storageKey: `${ownerId}/assets/sha256/${String(index).repeat(64)}.${index === 1 ? "mp4" : "png"}`,
    }));
    const narration = asset({ id: ids.narration, kind: "NARRATION", mimeType: "audio/wav", durationSeconds: 600, storageKey: `${ownerId}/assets/sha256/${"c".repeat(64)}.wav` });

    const input = buildRenderInput({ videoId, script, assets: [...visuals, narration] });

    expect(input.scenes.map((scene) => scene.assetReferences[0].assetId)).toEqual(visualIds);
    expect(input.scenes[1].assetReferences[0]).toMatchObject({ kind: "VIDEO", reference: visuals[1].storageKey });
  });

  it("rejects a render whose visual asset versions would repeat across scenes", () => {
    const single = asset({ id: ids.visualA });
    expect(() => buildRenderInput({ videoId, script, assets: [single] })).toThrow(/Asset IDs must be unique within a render/);
  });

  it("mixes narration above music using the exact asset version references", () => {
    const narration = asset({ id: ids.narration, kind: "NARRATION", mimeType: "audio/wav", durationSeconds: totalDuration, storageKey: `${ownerId}/assets/sha256/${"c".repeat(64)}.wav` });
    const music = asset({ id: ids.music, kind: "MUSIC", mimeType: "audio/mpeg", durationSeconds: totalDuration + 30, storageKey: `${ownerId}/assets/sha256/${"d".repeat(64)}.mp3` });

    const input = buildRenderInput({ videoId, script, assets: [music, narration] });

    expect(input.audioTracks.map((track) => track.role)).toEqual(["NARRATION", "MUSIC"]);
    expect(input.audioTracks[0]).toMatchObject({ assetVersionId: ids.narration, reference: narration.storageKey, gainDb: -3, fadeInSeconds: 0.05, fadeOutSeconds: 0.05, durationSeconds: totalDuration, startSeconds: 0, trimStartSeconds: 0 });
    expect(input.audioTracks[1]).toMatchObject({ assetVersionId: ids.music, gainDb: -18, fadeInSeconds: 0.5, fadeOutSeconds: 1, durationSeconds: totalDuration });
  });

  it.each([
    ["narration", "NARRATION" as const],
    ["music", "MUSIC" as const],
  ])("refuses %s that is shorter than the program instead of looping implicitly", (label, kind) => {
    const short = asset({ id: `${label}-short`, kind, mimeType: "audio/wav", durationSeconds: totalDuration - 1, storageKey: `${ownerId}/assets/sha256/${"e".repeat(64)}.wav` });
    expect(() => buildRenderInput({ videoId, script, assets: [short] })).toThrow(new RegExp(`${label} asset ${label}-short is shorter than the render`));
  });

  it("refuses an audio asset version without a measured duration", () => {
    const unmeasured = asset({ id: ids.narration, kind: "NARRATION", mimeType: "audio/wav", durationSeconds: null, storageKey: `${ownerId}/assets/sha256/${"c".repeat(64)}.wav` });
    expect(() => buildRenderInput({ videoId, script, assets: [unmeasured] })).toThrow(/shorter than the render/);
  });

  it("refuses more than one narration or music version per render input", () => {
    const narrationA = asset({ id: ids.narration, kind: "NARRATION", mimeType: "audio/wav", durationSeconds: 600, storageKey: `${ownerId}/assets/sha256/${"c".repeat(64)}.wav` });
    const narrationB = asset({ ...narrationA, id: ids.music });
    expect(() => buildRenderInput({ videoId, script, assets: [narrationA, narrationB] })).toThrow(/at most one narration and one music asset version/);
  });
});
