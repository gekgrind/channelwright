import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import type { ObjectStorage } from "./storage";
import { assertDownloadedBytes, assertOwnedObjectKey, MEDIA_BUCKET, prepareVerifiedUpload, sha256 } from "./storage";

export class SupabaseObjectStorage implements ObjectStorage {
  readonly evidence = "SUPABASE_STORAGE" as const;

  async putVerified(input: { ownerId: string; bytes: Uint8Array; contentType: string; expectedChecksumSha256?: string; maxBytes?: number; purpose?: "assets" | "masters" }) {
    const { checksumSha256, key: finalKey } = prepareVerifiedUpload(input);
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
    return assertDownloadedBytes(new Uint8Array(await result.data.arrayBuffer()), input.expectedChecksumSha256, input.maxBytes);
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
