import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectStorage } from "./storage";
import { assertOwnedObjectKey, immutableObjectKey, MEDIA_BUCKET, sha256, validateUpload } from "./storage";

export class LocalObjectStorage implements ObjectStorage {
  readonly evidence = "LOCAL_FILESYSTEM" as const;
  private readonly root: string;

  constructor(root = path.resolve(process.cwd(), ".data", "media-objects")) {
    this.root = root;
  }

  async putVerified(input: { ownerId: string; bytes: Uint8Array; contentType: string; expectedChecksumSha256?: string; maxBytes?: number; purpose?: "assets" | "masters" }) {
    validateUpload(input.bytes, input.contentType, input.maxBytes);
    const checksumSha256 = sha256(input.bytes);
    if (input.expectedChecksumSha256 && input.expectedChecksumSha256 !== checksumSha256) throw new Error("Uploaded media checksum does not match the declared SHA-256");
    const key = immutableObjectKey(input.ownerId, checksumSha256, input.contentType, input.purpose);
    const destination = this.resolveOwned(input.ownerId, key);
    await mkdir(path.dirname(destination), { recursive: true });
    let created = false;
    try {
      await access(destination, constants.F_OK);
      const existing = await readFile(destination);
      if (sha256(existing) !== checksumSha256) throw new Error("Existing immutable media object failed its integrity check");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temporary, input.bytes, { flag: "wx", mode: 0o600 });
        const written = await readFile(temporary);
        if (sha256(written) !== checksumSha256) throw new Error("Temporary media object failed its integrity check");
        await rename(temporary, destination);
        created = true;
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    }
    return { bucket: MEDIA_BUCKET, key, checksumSha256, byteSize: input.bytes.byteLength, contentType: input.contentType, created };
  }

  async readVerified(input: { ownerId: string; key: string; expectedChecksumSha256: string; maxBytes?: number }) {
    const bytes = await readFile(this.resolveOwned(input.ownerId, input.key));
    if (bytes.byteLength > (input.maxBytes ?? 500 * 1024 * 1024)) throw new Error("Stored media exceeds the allowed download size");
    if (sha256(bytes) !== input.expectedChecksumSha256) throw new Error("Stored media checksum mismatch");
    return bytes;
  }

  async remove(input: { ownerId: string; key: string }) {
    await rm(this.resolveOwned(input.ownerId, input.key), { force: true });
  }

  async createSignedReadUrl(): Promise<string> {
    throw new Error("Local filesystem evidence does not issue public or signed URLs");
  }

  private resolveOwned(ownerId: string, key: string) {
    const safeKey = assertOwnedObjectKey(ownerId, key);
    const resolved = path.resolve(this.root, ...safeKey.split("/"));
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Resolved media path escaped the local storage root");
    return resolved;
  }
}
