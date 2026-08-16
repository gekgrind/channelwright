import "server-only";

import { topicDiscoveryBundleSchema, type TopicDiscoveryBundle } from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { logFailure } from "@/server/observability";
import type { TopicDiscoveryCache } from "./youtube-topic-discovery";

/**
 * Owner-scoped discovery cache stored in `channelwright.research_evidence_cache`.
 * Reads are RLS-restricted to the owner and writes remain service-role only.
 * Discovery keys are constructed from a distinct scope, so they never collide
 * with CHANNEL_RESEARCH entries in the same table.
 */
export class SupabaseTopicDiscoveryCache implements TopicDiscoveryCache {
  async get(ownerId: string, cacheKey: string, now: Date) {
    const { data, error } = await createSupabaseAdminClient().from("research_evidence_cache")
      .select("evidence_payload,usage_payload,retrieved_at,expires_at")
      .eq("owner_id", ownerId).eq("cache_key", cacheKey).gt("expires_at", now.toISOString()).maybeSingle();
    if (error) throw new Error("CONTENT_DISCOVERY_CACHE_READ_FAILED");
    if (!data) return null;
    const parsed = topicDiscoveryBundleSchema.safeParse({
      normalizedQueries: data.usage_payload?.normalizedQueries,
      evidence: data.evidence_payload,
      completionStatus: data.usage_payload?.completionStatus,
      limitations: data.usage_payload?.limitations,
      usage: data.usage_payload?.usage,
    });
    // A stale or shape-incompatible entry is treated as a miss rather than an
    // error, so a contract change can never poison discovery for an owner.
    return parsed.success ? parsed.data : null;
  }

  async put(ownerId: string, cacheKey: string, normalizedQuery: string, requestParameters: Record<string, unknown>, bundle: TopicDiscoveryBundle, expiresAt: string) {
    const client = createSupabaseAdminClient();
    const purge = await client.rpc("purge_expired_research_cache", { p_limit: 100 });
    if (purge.error) logFailure("content_discovery_cache_purge_failed", purge.error, { code: purge.error.code });
    const { error } = await client.from("research_evidence_cache").upsert({
      owner_id: ownerId,
      cache_key: cacheKey,
      provider: "YOUTUBE_DATA_API_V3",
      normalized_query: normalizedQuery,
      request_parameters: requestParameters,
      evidence_payload: bundle.evidence,
      usage_payload: { normalizedQueries: bundle.normalizedQueries, completionStatus: bundle.completionStatus, limitations: bundle.limitations, usage: bundle.usage },
      retrieved_at: bundle.usage.retrievedAt,
      expires_at: expiresAt,
    }, { onConflict: "owner_id,cache_key" });
    if (error) throw new Error("CONTENT_DISCOVERY_CACHE_WRITE_FAILED");
  }
}
