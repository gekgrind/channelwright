import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import type { ObjectStorage } from "./storage";
import { assertOwnedObjectKey, immutableObjectKey, MEDIA_BUCKET, sha256, validateUpload } from "./storage";

export class SupabaseObjectStorage implements ObjectStorage {
  readonly evidence = "SUPABASE_STORAGE" as const;

  async putVerified(input: { ownerId: string; bytes: Uint8Array; contentType: string; expectedChecksumSha256?: string; maxBytes?: number; purpose?: "assets" | "masters" }) {
    validateUpload(input.bytes, input.contentType, input.maxBytes);
    const checksumSha256 = sha256(input.bytes);
    if (input.expectedChecksumSha256 && input.expectedChecksumSha256 !== checksumSha256) throw new Error("Uploaded media checksum does not match the declared SHA-256");
    const finalKey = immutableObjectKey(input.ownerId, checksumSha256, input.contentType, input.purpose);
    const temporaryKey = `${input.ownerId}/temporary/${randomUUID()}`;
    const client = createSupabaseAdminClient();
    const bucket = client.storage.from(MEDIA_BUCKET);
    const upload = await bucket.upload(temporaryKey, input.bytes, { contentType: input.contentType, upsert: false, cacheControl: "0" });
    if (upload.error) throw new Error(`Private media upload failed: ${upload.error.message}`);
    try {
      const temporary = await bucket.download(temporaryKey);
      if (temporary.error) throw new Error(`Uploaded media verification download failed: ${temporary.error.message}`);
      const verifiedBytes = new Uint8Array(await temporary.data.arrayBuffer());
      if (verifiedBytes.byteLength !== input.bytes.byteLength || sha256(verifiedBytes) !== checksumSha256) throw new Error("Uploaded media failed checksum verification");
      const move = await bucket.move(temporaryKey, finalKey);
      let created = true;
      if (move.error) {
        created = false;
        const existing = await bucket.download(finalKey);
        if (existing.error) throw new Error(`Immutable media finalization failed: ${move.error.message}`);
        const existingBytes = new Uint8Array(await existing.data.arrayBuffer());
        if (sha256(existingBytes) !== checksumSha256) throw new Error("Existing immutable media object has a conflicting checksum");
      }
      return { bucket: MEDIA_BUCKET, key: finalKey, checksumSha256, byteSize: input.bytes.byteLength, contentType: input.contentType, created };
    } finally {
      await bucket.remove([temporaryKey]);
    }
  }

  async readVerified(input: { ownerId: string; key: string; expectedChecksumSha256: string; maxBytes?: number }) {
    const key = assertOwnedObjectKey(input.ownerId, input.key);
    const result = await createSupabaseAdminClient().storage.from(MEDIA_BUCKET).download(key);
    if (result.error) throw new Error(`Private media download failed: ${result.error.message}`);
    const bytes = new Uint8Array(await result.data.arrayBuffer());
    if (bytes.byteLength > (input.maxBytes ?? 500 * 1024 * 1024)) throw new Error("Stored media exceeds the allowed download size");
    if (sha256(bytes) !== input.expectedChecksumSha256) throw new Error("Stored media checksum mismatch");
    return bytes;
  }

  async remove(input: { ownerId: string; key: string }) {
    const result = await createSupabaseAdminClient().storage.from(MEDIA_BUCKET).remove([assertOwnedObjectKey(input.ownerId, input.key)]);
    if (result.error) throw new Error(`Private media cleanup failed: ${result.error.message}`);
  }

  async createSignedReadUrl(input: { ownerId: string; key: string; expiresInSeconds: number }) {
    if (!Number.isInteger(input.expiresInSeconds) || input.expiresInSeconds < 1 || input.expiresInSeconds > 900) throw new Error("Signed media URLs must expire within 1 to 900 seconds");
    const result = await createSupabaseAdminClient().storage.from(MEDIA_BUCKET).createSignedUrl(assertOwnedObjectKey(input.ownerId, input.key), input.expiresInSeconds, { download: false });
    if (result.error) throw new Error(`Signed media URL creation failed: ${result.error.message}`);
    return result.data.signedUrl;
  }
}
