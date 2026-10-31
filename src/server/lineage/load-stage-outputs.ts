import "server-only";

import { randomUUID } from "node:crypto";
import { logFailure } from "@/server/observability";
import { createSupabaseServerClient } from "@/server/supabase";

/**
 * Reads the few stage outputs one Command Center view shows, by run id, with
 * the signed-in user's RLS-bound client and an owner filter. Only named JSON
 * paths are selected; whole artifacts are never read. Read-only.
 *
 * Each category loads on its own, so one failed read never discards another.
 * Every requested run is an approved or completed artifact whose schema
 * requires the selected fields, so a missing row or field fails the category
 * with a request id rather than becoming an empty projection.
 */

export interface StrategyOutput { thesis: string; revenuePathCount: number }
export interface ContentTopicOutput { topicId: string; workingConcept: string; viewerValue: unknown }
export interface ContentOutput { backlog: Array<{ topicId: string; rank: number }>; topics: ContentTopicOutput[] }
export interface PerformanceOutput { views: number | null; averageViewedPct: number | null }

export type OutputLoad<T> = { status: "ok"; data: Record<string, T> } | { status: "error"; requestId: string };

export interface StageOutputsLoad {
  strategy: OutputLoad<StrategyOutput>;
  content: OutputLoad<ContentOutput>;
  performance: OutputLoad<PerformanceOutput>;
}

export interface StageOutputRequest { strategyRunIds: string[]; contentRunIds: string[]; performanceRunIds: string[] }

export const STAGE_OUTPUT_CHUNK = 100;

const COLUMNS = {
  strategy: "id,thesis:output_payload->strategicThesis->channelConcept->>statement,monetization:output_payload->monetizationArchitecture",
  content: "id,backlog:output_payload->backlog,topics:output_payload->topics",
  performance: "id,metrics:output_payload->measuredSnapshot->metrics",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;
const object = (value: unknown) => (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null);
const nullableNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
/** Every entry must map, or the whole list is unreadable. */
function every<T>(value: unknown, map: (item: Row) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const entry of value) {
    const item = object(entry);
    const mapped = item ? map(item) : null;
    if (mapped === null) return null;
    out.push(mapped);
  }
  return out;
}

const toStrategy = (row: Row): StrategyOutput | null =>
  typeof row.thesis === "string" && Array.isArray(row.monetization) ? { thesis: row.thesis, revenuePathCount: row.monetization.length } : null;

function toContent(row: Row): ContentOutput | null {
  const backlog = every(row.backlog, (item) => (typeof item.topicId === "string" && typeof item.rank === "number" ? { topicId: item.topicId, rank: item.rank } : null));
  const topics = every(row.topics, (item) => (typeof item.topicId === "string" && typeof item.workingConcept === "string"
    ? { topicId: item.topicId, workingConcept: item.workingConcept, viewerValue: item.viewerValue }
    : null));
  return backlog && topics ? { backlog, topics } : null;
}

/** Metric values are nullable by schema (the operator enters what they have); the metrics object is not. */
function toPerformance(row: Row): PerformanceOutput | null {
  const metrics = object(row.metrics);
  return metrics ? { views: nullableNumber(metrics.views), averageViewedPct: nullableNumber(metrics.averagePercentageViewedPct) } : null;
}

async function byIds<T>(userId: string, category: keyof StageOutputsLoad, ids: string[], columns: string, map: (row: Row) => T | null): Promise<OutputLoad<T>> {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))].sort();
  const data: Record<string, T> = {};
  try {
    if (unique.some((id) => !UUID.test(id))) throw new Error("A requested run id is not a UUID.");
    if (unique.length === 0) return { status: "ok", data };
    const client = await createSupabaseServerClient();
    for (let start = 0; start < unique.length; start += STAGE_OUTPUT_CHUNK) {
      const { data: rows, error } = await client.from("workflow_runs").select(columns).eq("owner_id", userId).in("id", unique.slice(start, start + STAGE_OUTPUT_CHUNK));
      if (error) throw error;
      for (const row of (rows ?? []) as unknown as Row[]) {
        const mapped = typeof row.id === "string" ? map(row) : null;
        if (mapped !== null) data[(row.id as string).toLowerCase()] = mapped;
      }
    }
    const missing = unique.filter((id) => !(id in data)).length;
    if (missing > 0) throw new Error(`${missing} requested ${category} output(s) were missing or unreadable.`);
    return { status: "ok", data };
  } catch (error) {
    const requestId = randomUUID();
    logFailure("stage_outputs_unavailable", error, { requestId, category });
    return { status: "error", requestId };
  }
}

export async function loadStageOutputs(userId: string, request: StageOutputRequest): Promise<StageOutputsLoad> {
  const [strategy, content, performance] = await Promise.all([
    byIds(userId, "strategy", request.strategyRunIds, COLUMNS.strategy, toStrategy),
    byIds(userId, "content", request.contentRunIds, COLUMNS.content, toContent),
    byIds(userId, "performance", request.performanceRunIds, COLUMNS.performance, toPerformance),
  ]);
  return { strategy, content, performance };
}
