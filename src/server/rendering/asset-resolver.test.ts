import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectStorage } from "@/server/media/storage";
import { sha256 } from "@/server/media/storage";
import { deterministicSampleInput } from "@/video/schemas/render-input";
import { resolveRenderAssets } from "./asset-resolver";
import type { ClaimedRenderJob } from "./render-queue";

const ownerId = "0f802c92-fc5b-413f-bfbd-0a8b852cde44";
const imageBytes = new Uint8Array(Buffer.from("\x89PNG\r\n\x1a\nrender-visual"));
const narrationBytes = new Uint8Array(Buffer.from("RIFF0000WAVEfmt narration"));

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

const publicDirectory = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "channelwright-render-public-"));
  directories.push(directory);
  return directory;
};

const asset = (overrides: Partial<ClaimedRenderJob["assets"][number]> = {}): ClaimedRenderJob["assets"][number] => ({
  id: "visual-asset", ownerId, storageKey: `${ownerId}/assets/sha256/${sha256(imageBytes)}.png`, checksumSha256: sha256(imageBytes),
  mimeType: "image/png", byteSize: imageBytes.byteLength, status: "READY", rightsStatus: "VERIFIED", ...overrides,
});

const storageStub = (bytesByKey: Record<string, Uint8Array>) => {
  const readVerified = vi.fn(async (input: { key: string }) => {
    const bytes = bytesByKey[input.key];
    if (!bytes) throw new Error(`Missing object ${input.key}`);
    return bytes;
  });
  return { storage: { evidence: "LOCAL_FILESYSTEM", readVerified, putVerified: vi.fn(), remove: vi.fn(), createSignedReadUrl: vi.fn() } as unknown as ObjectStorage, readVerified };
};

const job = (assets: ClaimedRenderJob["assets"], input = deterministicSampleInput): ClaimedRenderJob =>
  ({ ownerId, assets, input } as ClaimedRenderJob);

describe("render asset resolution", () => {
  it("materializes verified assets locally and rewrites references to the render-local namespace", async () => {
    const directory = await publicDirectory();
    const visual = asset();
    const { storage, readVerified } = storageStub({ [visual.storageKey]: imageBytes });
    const input = {
      ...deterministicSampleInput,
      scenes: deterministicSampleInput.scenes.map((scene, index) => (index === 1
        ? { ...scene, assetReferences: [{ assetId: visual.id, kind: "IMAGE" as const, reference: visual.storageKey }] }
        : scene)),
    };

    const resolved = await resolveRenderAssets(job([visual], input), storage, directory);

    expect(resolved.scenes[1].assetReferences[0].reference).toBe("public://assets/visual-asset.png");
    expect(resolved.scenes[2].assetReferences[0].reference).toBe(deterministicSampleInput.scenes[2].assetReferences[0].reference);
    expect(readVerified).toHaveBeenCalledWith({ ownerId, key: visual.storageKey, expectedChecksumSha256: visual.checksumSha256, maxBytes: visual.byteSize });
    await expect(readFile(path.join(directory, "assets", "visual-asset.png"))).resolves.toEqual(Buffer.from(imageBytes));
  });

  it("resolves audio track references from the same verified asset set", async () => {
    const directory = await publicDirectory();
    const narration = asset({ id: "narration-asset", mimeType: "audio/wav", storageKey: `${ownerId}/assets/sha256/${sha256(narrationBytes)}.wav`, checksumSha256: sha256(narrationBytes), byteSize: narrationBytes.byteLength });
    const { storage } = storageStub({ [narration.storageKey]: narrationBytes });
    const input = {
      ...deterministicSampleInput,
      audioTracks: [{
        assetVersionId: narration.id, role: "NARRATION" as const, reference: narration.storageKey, checksumSha256: narration.checksumSha256,
        mimeType: "audio/wav" as const, sourceDurationSeconds: 10, startSeconds: 0, trimStartSeconds: 0, durationSeconds: 5, gainDb: -3, fadeInSeconds: 0.05, fadeOutSeconds: 0.05,
      }],
    };

    const resolved = await resolveRenderAssets(job([narration], input), storage, directory);

    expect(resolved.audioTracks[0].reference).toBe("public://assets/narration-asset.wav");
  });

  it("fails an unresolved audio track instead of rendering silence", async () => {
    const directory = await publicDirectory();
    const { storage } = storageStub({});
    const input = {
      ...deterministicSampleInput,
      audioTracks: [{
        assetVersionId: "missing-asset", role: "NARRATION" as const, reference: `${ownerId}/assets/sha256/${sha256(narrationBytes)}.wav`, checksumSha256: sha256(narrationBytes),
        mimeType: "audio/wav" as const, sourceDurationSeconds: 10, startSeconds: 0, trimStartSeconds: 0, durationSeconds: 5, gainDb: -3, fadeInSeconds: 0.05, fadeOutSeconds: 0.05,
      }],
    };

    await expect(resolveRenderAssets(job([], input), storage, directory)).rejects.toThrow(/missing-asset was not resolved/);
  });

  it("fails an unresolved visual reference instead of dropping it", async () => {
    const directory = await publicDirectory();
    const { storage } = storageStub({});
    const input = {
      ...deterministicSampleInput,
      scenes: deterministicSampleInput.scenes.map((scene, index) => (index === 1
        ? { ...scene, assetReferences: [{ assetId: "unknown-asset", kind: "IMAGE" as const, reference: `${ownerId}/assets/sha256/${sha256(imageBytes)}.png` }] }
        : scene)),
    };

    await expect(resolveRenderAssets(job([], input), storage, directory)).rejects.toThrow(/unknown-asset was not resolved/);
  });

  it.each([
    ["another owner's asset", asset({ ownerId: "263e9110-e6c6-47dd-a334-c957abfca79b" }), /ownership mismatch/],
    ["a quarantined asset", asset({ status: "QUARANTINED" }), /is not ready/],
    ["an unverified rights status", asset({ rightsStatus: "PENDING" }), /unverified rights status PENDING/],
    ["an unsupported MIME type", asset({ mimeType: "text/html" }), /unsupported MIME type/],
  ])("refuses to materialize %s", async (_label, candidate, expected) => {
    const directory = await publicDirectory();
    const { storage, readVerified } = storageStub({ [candidate.storageKey]: imageBytes });

    await expect(resolveRenderAssets(job([candidate]), storage, directory)).rejects.toThrow(expected);
    expect(readVerified).not.toHaveBeenCalled();
  });

  it("refuses an asset whose stored bytes disagree with its version record", async () => {
    const directory = await publicDirectory();
    const visual = asset({ byteSize: imageBytes.byteLength + 1 });
    const { storage } = storageStub({ [visual.storageKey]: imageBytes });

    await expect(resolveRenderAssets(job([visual]), storage, directory)).rejects.toThrow(/byte size does not match/);
  });

  it("refuses to overwrite an already materialized render asset file", async () => {
    const directory = await publicDirectory();
    const visual = asset();
    const { storage } = storageStub({ [visual.storageKey]: imageBytes });

    await resolveRenderAssets(job([visual]), storage, directory);
    await expect(resolveRenderAssets(job([visual]), storage, directory)).rejects.toThrow(/EEXIST/);
  });
});
