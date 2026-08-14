import type { MediaAssetVersionRecord } from "@/domain/media-production";

export interface GeneratedAssetRequest {
  ownerId: string;
  kind: "IMAGE" | "VIDEO" | "NARRATION" | "MUSIC";
  promptOrBrief: string;
  idempotencyKey: string;
}

export interface GeneratedAssetCandidate {
  provider: string;
  providerAssetId: string;
  contentType: string;
  bytes: Uint8Array;
  provenance: Record<string, unknown>;
  rightsStatus: MediaAssetVersionRecord["rightsStatus"];
  licenseReference: string | null;
}

export interface MediaAssetProvider {
  readonly providerName: string;
  validateConfiguration(): void;
  generate(request: GeneratedAssetRequest): Promise<GeneratedAssetCandidate>;
}

export interface LicensedStockProvider {
  readonly providerName: string;
  validateConfiguration(): void;
  acquire(input: { ownerId: string; providerAssetId: string; idempotencyKey: string }): Promise<GeneratedAssetCandidate>;
}

// No unrestricted URL-fetch adapter is exposed. Providers must return bounded bytes and provenance.
