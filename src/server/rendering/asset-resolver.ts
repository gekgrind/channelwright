import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectStorage } from "@/server/media/storage";
import type { ClaimedRenderJob } from "./render-queue";

const extension = (mimeType: string) => ({
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
  "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
  "audio/wav": ".wav", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg",
}[mimeType] ?? "");

export async function resolveRenderAssets(job: ClaimedRenderJob, storage: ObjectStorage, publicDirectory: string) {
  const assetDirectory = path.join(publicDirectory, "assets");
  await mkdir(assetDirectory, { recursive: true });
  const references = new Map<string, string>();
  for (const asset of job.assets) {
    if (asset.ownerId !== job.ownerId) throw new Error("Render asset ownership mismatch");
    if (asset.status !== "READY") throw new Error(`Render asset ${asset.id} is not ready`);
    if (asset.rightsStatus !== "VERIFIED") throw new Error(`Render asset ${asset.id} is blocked by unverified rights status ${asset.rightsStatus}`);
    const suffix = extension(asset.mimeType);
    if (!suffix) throw new Error(`Render asset ${asset.id} uses an unsupported MIME type`);
    const bytes = await storage.readVerified({ ownerId: job.ownerId, key: asset.storageKey, expectedChecksumSha256: asset.checksumSha256, maxBytes: asset.byteSize });
    if (bytes.byteLength !== asset.byteSize) throw new Error(`Render asset ${asset.id} byte size does not match its version record`);
    const filename = `${asset.id}${suffix}`;
    await writeFile(path.join(assetDirectory, filename), bytes, { flag: "wx", mode: 0o600 });
    references.set(asset.id, `public://assets/${filename}`);
  }

  return {
    ...job.input,
    audioTracks: job.input.audioTracks.map((track) => {
      const reference = references.get(track.assetVersionId);
      if (!reference) throw new Error(`Audio asset version ${track.assetVersionId} was not resolved for the render`);
      return { ...track, reference };
    }),
    scenes: job.input.scenes.map((scene) => ({
      ...scene,
      assetReferences: scene.assetReferences.map((reference) => {
        if (reference.reference.startsWith("synthetic://")) return reference;
        const resolved = references.get(reference.assetId);
        if (!resolved) throw new Error(`Visual asset version ${reference.assetId} was not resolved for the render`);
        return { ...reference, reference: resolved };
      }),
    })),
  };
}
