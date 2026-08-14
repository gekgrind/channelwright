import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectMedia } from "@/server/rendering/media-inspection";
import { sha256 } from "./storage";

const suffix = (contentType: string) => ({
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
  "audio/wav": ".wav", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg",
}[contentType] ?? ".bin");

export async function inspectAssetBytes(bytes: Uint8Array, contentType: string) {
  const root = path.resolve(process.cwd(), ".data", "ingestion-work"); await mkdir(root, { recursive: true });
  const workspace = await mkdtemp(path.join(root, "asset-")); const file = path.join(workspace, `source${suffix(contentType)}`);
  try {
    await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    const inspection = await inspectMedia(file);
    if (inspection.checksumSha256 !== sha256(bytes)) throw new Error("Asset inspection checksum mismatch");
    return {
      durationSeconds: Number.isFinite(inspection.durationSeconds) && inspection.durationSeconds > 0 ? inspection.durationSeconds : null,
      width: inspection.width,
      height: inspection.height,
      videoCodec: inspection.videoCodec,
      audioCodec: inspection.audioCodec,
      audioSampleRate: inspection.audioSampleRate,
      audioChannels: inspection.audioChannels,
    };
  } finally {
    const relative = path.relative(root, workspace);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) await rm(workspace, { recursive: true, force: true });
  }
}
