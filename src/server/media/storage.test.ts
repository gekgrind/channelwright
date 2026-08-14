import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalObjectStorage } from "./local-storage";
import { sha256 } from "./storage";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("local object storage", () => {
  it("stores immutable owner-scoped content idempotently and verifies checksums", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "channelwright-storage-")); roots.push(root);
    const storage = new LocalObjectStorage(root);
    const ownerId = "0f802c92-fc5b-413f-bfbd-0a8b852cde44";
    const bytes = new Uint8Array(Buffer.from("RIFF0000WAVEfmt test-signal"));
    const expectedChecksumSha256 = sha256(bytes);
    const first = await storage.putVerified({ ownerId, bytes, contentType: "audio/wav", expectedChecksumSha256 });
    const second = await storage.putVerified({ ownerId, bytes, contentType: "audio/wav", expectedChecksumSha256 });
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ ...first, created: false });
    await expect(storage.readVerified({ ownerId, key: first.key, expectedChecksumSha256 })).resolves.toEqual(Buffer.from(bytes));
    await expect(storage.readVerified({ ownerId: "263e9110-e6c6-47dd-a334-c957abfca79b", key: first.key, expectedChecksumSha256 })).rejects.toThrow(/owner namespace/);
  });

  it("rejects checksum mismatch, unsupported types, and traversal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "channelwright-storage-")); roots.push(root);
    const storage = new LocalObjectStorage(root);
    const ownerId = "0f802c92-fc5b-413f-bfbd-0a8b852cde44";
    const bytes = new Uint8Array(Buffer.from("RIFF0000WAVEfmt test-signal"));
    await expect(storage.putVerified({ ownerId, bytes, contentType: "audio/wav", expectedChecksumSha256: "a".repeat(64) })).rejects.toThrow(/checksum/);
    await expect(storage.putVerified({ ownerId, bytes, contentType: "text/html" })).rejects.toThrow(/Unsupported/);
    await expect(storage.readVerified({ ownerId, key: `${ownerId}/../secret`, expectedChecksumSha256: sha256(bytes) })).rejects.toThrow(/Invalid|outside|namespace/);
  });
});
