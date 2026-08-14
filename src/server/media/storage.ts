import { createHash } from "node:crypto";
import path from "node:path";

export const MEDIA_BUCKET = "channelwright-private-media";
export const DEFAULT_MAX_ASSET_BYTES = 500 * 1024 * 1024;
export const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp",
  "video/mp4", "video/quicktime", "video/webm",
  "audio/wav", "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg",
]);

export interface StoredObject {
  bucket: string;
  key: string;
  checksumSha256: string;
  byteSize: number;
  contentType: string;
  created: boolean;
}

export interface ObjectStorage {
  readonly evidence: "LOCAL_FILESYSTEM" | "SUPABASE_STORAGE";
  putVerified(input: { ownerId: string; bytes: Uint8Array; contentType: string; expectedChecksumSha256?: string; maxBytes?: number; purpose?: "assets" | "masters" }): Promise<StoredObject>;
  readVerified(input: { ownerId: string; key: string; expectedChecksumSha256: string; maxBytes?: number }): Promise<Uint8Array>;
  remove(input: { ownerId: string; key: string }): Promise<void>;
  createSignedReadUrl(input: { ownerId: string; key: string; expiresInSeconds: number }): Promise<string>;
}

export function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateUpload(bytes: Uint8Array, contentType: string, maxBytes = DEFAULT_MAX_ASSET_BYTES) {
  if (!ALLOWED_MEDIA_TYPES.has(contentType)) throw new Error(`Unsupported media content type: ${contentType}`);
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error(`Media size must be between 1 and ${maxBytes} bytes`);
  const detected = sniffContentType(bytes);
  if (detected && detected !== contentType && !(detected === "video/mp4" && ["audio/mp4", "video/quicktime"].includes(contentType))) {
    throw new Error(`Declared content type ${contentType} does not match detected ${detected}`);
  }
}

export function sniffContentType(bytes: Uint8Array): string | null {
  const prefix = Buffer.from(bytes.subarray(0, 16));
  if (prefix.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (prefix.subarray(0, 4).toString("ascii") === "RIFF" && prefix.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  if (prefix.subarray(4, 8).toString("ascii") === "ftyp") return "video/mp4";
  if (prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  if (prefix.length >= 2 && prefix[0] === 0xff && (prefix[1] & 0xf6) === 0xf0) return "audio/aac";
  if (prefix.subarray(0, 3).toString("ascii") === "ID3" || prefix.subarray(0, 2).equals(Buffer.from([0xff, 0xfb]))) return "audio/mpeg";
  if (prefix.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (prefix.subarray(0, 4).toString("ascii") === "RIFF" && prefix.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

const extensionFor = (contentType: string) => ({
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "audio/wav": "wav", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/ogg": "ogg",
}[contentType] ?? "bin");

export function immutableObjectKey(ownerId: string, checksumSha256: string, contentType: string, purpose: "assets" | "masters" = "assets") {
  if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new Error("A UUID owner is required for media storage");
  if (!/^[a-f0-9]{64}$/.test(checksumSha256)) throw new Error("A lowercase SHA-256 checksum is required");
  return `${ownerId}/${purpose}/sha256/${checksumSha256}.${extensionFor(contentType)}`;
}

export function assertOwnedObjectKey(ownerId: string, key: string) {
  if (!key || key.includes("\\") || key.includes("\0") || path.posix.isAbsolute(key)) throw new Error("Invalid media object key");
  const normalized = path.posix.normalize(key);
  if (normalized !== key || normalized.startsWith("../") || !normalized.startsWith(`${ownerId}/`)) throw new Error("Media object key is outside the owner namespace");
  return normalized;
}
