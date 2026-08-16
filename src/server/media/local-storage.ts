import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectStorage } from "./storage";
import { assertDownloadedBytes, assertOwnedObjectKey, MEDIA_BUCKET, prepareVerifiedUpload, sha256 } from "./storage";

export class LocalObjectStorage implements ObjectStorage {
  readonly evidence = "LOCAL_FILESYSTEM" as const;
  private readonly root: string;

  constructor(root = path.resolve(process.cwd(), ".data", "media-objects")) {
    this.root = root;
  }

  async putVerified(input: { ownerId: string; bytes: Uint8Array; contentType: string; expectedChecksumSha256?: string; maxBytes?: number; purpose?: "assets" | "masters" }) {
    const { checksumSha256, key } = prepareVerifiedUpload(input);
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
    return assertDownloadedBytes(bytes, input.expectedChecksumSha256, input.maxBytes);
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
