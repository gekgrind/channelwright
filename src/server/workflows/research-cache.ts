import { researchEvidenceBundleSchema, type ResearchEvidenceBundle } from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";

export interface ResearchCache {
  get(ownerId: string, cacheKey: string, now: Date): Promise<ResearchEvidenceBundle | null>;
  put(ownerId: string, cacheKey: string, normalizedQuery: string, requestParameters: Record<string, unknown>, bundle: ResearchEvidenceBundle): Promise<void>;
}

export class SupabaseResearchCache implements ResearchCache {
  async get(ownerId: string, cacheKey: string, now: Date) {
    const { data, error } = await createSupabaseAdminClient().from("research_evidence_cache")
      .select("evidence_payload,usage_payload,retrieved_at,expires_at")
      .eq("owner_id", ownerId).eq("cache_key", cacheKey).gt("expires_at", now.toISOString()).maybeSingle();
    if (error) throw new Error("RESEARCH_CACHE_READ_FAILED");
    if (!data) return null;
    return researchEvidenceBundleSchema.parse({
      normalizedQueries: data.usage_payload.normalizedQueries,
      evidence: data.evidence_payload.map((item: Record<string, unknown>) => ({ ...item, origin: "CACHE" })),
      completionStatus: data.usage_payload.completionStatus,
      limitations: data.usage_payload.limitations,
      usage: { ...data.usage_payload.usage, cacheStatus: "HIT", providerRequests: 0, quotaUnits: 0 },
    });
  }

  async put(ownerId: string, cacheKey: string, normalizedQuery: string, requestParameters: Record<string, unknown>, bundle: ResearchEvidenceBundle) {
    const client = createSupabaseAdminClient();
    const purge = await client.rpc("purge_expired_research_cache", { p_limit: 100 });
    if (purge.error) console.warn("research_cache_purge_failed", { code: purge.error.code });
    const { error } = await client.from("research_evidence_cache").upsert({
      owner_id: ownerId,
      cache_key: cacheKey,
      provider: "YOUTUBE_DATA_API_V3",
      normalized_query: normalizedQuery,
      request_parameters: requestParameters,
      evidence_payload: bundle.evidence,
      usage_payload: { normalizedQueries: bundle.normalizedQueries, completionStatus: bundle.completionStatus, limitations: bundle.limitations, usage: bundle.usage },
      retrieved_at: bundle.usage.retrievedAt,
      expires_at: bundle.usage.expiresAt,
    }, { onConflict: "owner_id,cache_key" });
    if (error) throw new Error("RESEARCH_CACHE_WRITE_FAILED");
  }
}
