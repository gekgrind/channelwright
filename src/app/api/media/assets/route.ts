import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assetKindSchema, rightsStatusSchema } from "@/domain/media-production";
import { getCurrentUser } from "@/server/auth";
import { isMockMode } from "@/server/config";
import { LocalObjectStorage } from "@/server/media/local-storage";
import { SupabaseObjectStorage } from "@/server/media/supabase-storage";
import { createSupabaseServerClient } from "@/server/supabase";
import { inspectAssetBytes } from "@/server/media/asset-inspection";
import { JsonWorkspaceRepository } from "@/server/repository";
import { createSerialQueue } from "@/server/serial-queue";

const fixtureRepository = new JsonWorkspaceRepository();
const exclusiveFixtureUpload = createSerialQueue();

const metadataSchema = z.object({
  kind: assetKindSchema,
  provider: z.string().trim().min(1).max(120),
  rightsStatus: rightsStatusSchema,
  provenance: z.record(z.string(), z.unknown()).default({}),
  licenseReference: z.string().trim().max(1000).nullable().default(null),
}).superRefine((value, context) => {
  if (value.rightsStatus === "VERIFIED" && !value.licenseReference) context.addIssue({ code: "custom", path: ["licenseReference"], message: "Verified rights require a license or ownership reference" });
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 500 * 1024 * 1024 + 64 * 1024) return NextResponse.json({ error: "Asset exceeds the 500 MiB ingestion limit" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  let rawMetadata: unknown = null;
  try { rawMetadata = JSON.parse(String(form?.get("metadata") ?? "null")); } catch { /* Reported as invalid metadata below. */ }
  const metadataResult = metadataSchema.safeParse(rawMetadata);
  if (!(file instanceof File) || !metadataResult.success) return NextResponse.json({ error: "A media file and valid metadata are required", issues: metadataResult.error?.flatten() }, { status: 422 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const storage = isMockMode() ? new LocalObjectStorage() : new SupabaseObjectStorage();
  let stored: Awaited<ReturnType<typeof storage.putVerified>> | undefined;
  try {
    const inspection = await inspectAssetBytes(bytes, file.type);
    stored = await storage.putVerified({ ownerId: user.id, bytes, contentType: file.type });
    const idempotencyKey = request.headers.get("idempotency-key") ?? randomUUID();
    if (isMockMode()) {
      const asset = await exclusiveFixtureUpload(async () => {
        const workspace = await fixtureRepository.load();
        const inputFingerprint = createHash("sha256").update(JSON.stringify({ userId: user.id, metadata: metadataResult.data, stored: { ...stored, created: undefined }, inspection })).digest("hex");
        const scopedKey = `${user.id}:${idempotencyKey}`; const prior = workspace.idempotency[scopedKey];
        if (prior && prior.fingerprint !== inputFingerprint) throw new Error("Idempotency key was already used for a different asset upload");
        const existing = workspace.mediaProduction.assets.find((item) => item.ownerId === user.id && item.checksumSha256 === stored!.checksumSha256 && item.mimeType === stored!.contentType);
        if (prior && existing) return existing;
        const record = existing ?? {
          id: randomUUID(), ownerId: user.id, assetId: randomUUID(), version: 1, kind: metadataResult.data.kind, status: "READY" as const,
          provider: metadataResult.data.provider, provenance: metadataResult.data.provenance, rightsStatus: metadataResult.data.rightsStatus,
          checksumSha256: stored!.checksumSha256, mimeType: stored!.contentType, byteSize: stored!.byteSize,
          durationSeconds: inspection.durationSeconds, width: inspection.width, height: inspection.height,
          storageBucket: stored!.bucket, storageKey: stored!.key, createdAt: new Date().toISOString(),
        };
        if (!existing) workspace.mediaProduction.assets.push(record);
        workspace.mediaProduction.evidence = "LOCAL_FILESYSTEM";
        workspace.idempotency[scopedKey] = { fingerprint: inputFingerprint, completedAt: new Date().toISOString() };
        await fixtureRepository.save(workspace);
        return record;
      });
      return NextResponse.json({ asset, evidence: "LOCAL_FILESYSTEM", persistence: "LOCAL_ONLY" }, { status: 201 });
    }
    const client = await createSupabaseServerClient();
    const inputFingerprint = createHash("sha256").update(JSON.stringify({
      userId: user.id,
      metadata: metadataResult.data,
      stored: { ...stored, created: undefined },
    })).digest("hex");
    const result = await client.rpc("register_media_asset_version", {
      p_idempotency_key: idempotencyKey,
      p_input_fingerprint: inputFingerprint,
      p_asset: { ...metadataResult.data, ...inspection, storageBucket: stored.bucket, storageKey: stored.key, checksumSha256: stored.checksumSha256, mimeType: stored.contentType, byteSize: stored.byteSize },
    });
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json(result.data, { status: 201 });
  } catch (error) {
    // Registration may have committed even if its response was lost. Temporary objects are already cleaned by the adapter;
    // retain finalized content-addressed bytes for safe reconciliation instead of risking a broken database reference.
    return NextResponse.json({ error: error instanceof Error ? error.message : "Media ingestion failed" }, { status: 400 });
  }
}
