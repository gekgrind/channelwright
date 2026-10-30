import "server-only";

import { randomUUID } from "node:crypto";
import { logFailure } from "@/server/observability";
import { createSupabaseServerClient } from "@/server/supabase";

/**
 * Reads the few stage outputs one Command Center view shows, by run id, with
 * the signed-in user's RLS-bound client and an owner filter. Only named JSON
 * paths are selected; whole artifacts are never read. Read-only.
 */

export interface StrategyOutput { thesis: string | null; revenuePathCount: number | null }
export interface ContentTopicOutput { topicId: string; workingConcept: string | null; viewerValue: unknown }
export interface ContentOutput { backlog: Array<{ topicId: string; rank: number }>; topics: ContentTopicOutput[] }
export interface PerformanceOutput { views: number | null; averageViewedPct: number | null }

export interface StageOutputs {
  strategy: Record<string, StrategyOutput>;
  content: Record<string, ContentOutput>;
  performance: Record<string, PerformanceOutput>;
}

export interface StageOutputRequest { strategyRunIds: string[]; contentRunIds: string[]; performanceRunIds: string[] }

export type StageOutputsLoad = { status: "ok"; outputs: StageOutputs } | { status: "error"; requestId: string };

export const STAGE_OUTPUT_CHUNK = 100;

const COLUMNS = {
  strategy: "id,thesis:output_payload->strategicThesis->channelConcept->>statement,monetization:output_payload->monetizationArchitecture",
  content: "id,backlog:output_payload->backlog,topics:output_payload->topics",
  performance: "id,metrics:output_payload->measuredSnapshot->metrics",
} as const;

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : null);
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const object = (value: unknown) => (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null);

const toStrategy = (row: Row): StrategyOutput => ({ thesis: text(row.thesis), revenuePathCount: Array.isArray(row.monetization) ? row.monetization.length : null });

function toContent(row: Row): ContentOutput {
  const backlog = (Array.isArray(row.backlog) ? row.backlog : []).flatMap((entry) => {
    const item = object(entry);
    return item && typeof item.topicId === "string" && typeof item.rank === "number" ? [{ topicId: item.topicId, rank: item.rank }] : [];
  });
  const topics = (Array.isArray(row.topics) ? row.topics : []).flatMap((entry) => {
    const item = object(entry);
    return item && typeof item.topicId === "string" ? [{ topicId: item.topicId, workingConcept: text(item.workingConcept), viewerValue: item.viewerValue }] : [];
  });
  return { backlog, topics };
}

function toPerformance(row: Row): PerformanceOutput {
  const metrics = object(row.metrics);
  return { views: count(metrics?.views), averageViewedPct: count(metrics?.averagePercentageViewedPct) };
}

async function byIds<T>(userId: string, ids: string[], columns: string, map: (row: Row) => T): Promise<Record<string, T>> {
  const out: Record<string, T> = {};
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return out;
  const client = await createSupabaseServerClient();
  for (let start = 0; start < unique.length; start += STAGE_OUTPUT_CHUNK) {
    const { data, error } = await client.from("workflow_runs").select(columns).eq("owner_id", userId).in("id", unique.slice(start, start + STAGE_OUTPUT_CHUNK));
    if (error) throw error;
    for (const row of (data ?? []) as unknown as Row[]) if (typeof row.id === "string") out[row.id] = map(row);
  }
  return out;
}

export async function loadStageOutputs(userId: string, request: StageOutputRequest): Promise<StageOutputsLoad> {
  try {
    const [strategy, content, performance] = await Promise.all([
      byIds(userId, request.strategyRunIds, COLUMNS.strategy, toStrategy),
      byIds(userId, request.contentRunIds, COLUMNS.content, toContent),
      byIds(userId, request.performanceRunIds, COLUMNS.performance, toPerformance),
    ]);
    return { status: "ok", outputs: { strategy, content, performance } };
  } catch (error) {
    const requestId = randomUUID();
    logFailure("stage_outputs_unavailable", error, { requestId });
    return { status: "error", requestId };
  }
}
