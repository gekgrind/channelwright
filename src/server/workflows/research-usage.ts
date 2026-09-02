import "server-only";

import type { ClaimedWorkflowStep } from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import type { ChannelResearchBudget } from "./research-config";

type WorkflowUsageBudget = Pick<ChannelResearchBudget,
  | "maxAggregateProviderRequests" | "maxAggregateProviderQuotaUnits" | "maxAggregateSearches"
  | "maxAggregateSynthesisCalls" | "maxAggregateQaCalls" | "maxAggregateRevisionCalls"
  | "maxAggregateInputTokens" | "maxAggregateOutputTokens" | "maxAggregateTotalTokens">;

export type ResearchUsageCounters = Partial<{
  providerRequests: number;
  providerQuotaUnits: number;
  searches: number;
  synthesisCalls: number;
  qaCalls: number;
  revisionCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  automatedRevisions: number;
  videosRetrieved: number;
  channelsRetrieved: number;
  cacheHits: number;
  cacheMisses: number;
  executionAttempts: number;
  failedOperations: number;
}>;

export type ResearchUsageOperationKind =
  | "CACHE_LOOKUP"
  | "YOUTUBE_SEARCH"
  | "YOUTUBE_VIDEOS"
  | "YOUTUBE_CHANNELS"
  | "MODEL_SYNTHESIS"
  | "MODEL_QA"
  | "MODEL_REVISION"
  | "EVIDENCE_RESULT"
  | "AUTOMATED_REVISION";

export type ResearchUsageReservation = { operationId: string; status: "RESERVED" | "SUCCEEDED" | "FAILED"; idempotentReplay: boolean };

export interface ResearchUsageMeter {
  ensure(): Promise<void>;
  reserve(input: {
    key: string;
    kind: ResearchUsageOperationKind;
    provider?: string;
    model?: string;
    reservation?: ResearchUsageCounters;
  }): Promise<ResearchUsageReservation>;
  finalize(
    reservation: ResearchUsageReservation,
    status: "SUCCEEDED" | "FAILED",
    actual: ResearchUsageCounters,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  record(input: {
    key: string;
    kind: ResearchUsageOperationKind;
    provider?: string;
    model?: string;
    actual: ResearchUsageCounters;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export class ResearchBudgetError extends Error {
  readonly code: "RESEARCH_RESOURCE_BUDGET_EXHAUSTED" | "STRATEGY_RESOURCE_BUDGET_EXHAUSTED" | "CONTENT_RESOURCE_BUDGET_EXHAUSTED" | "VIDEO_BRIEF_RESOURCE_BUDGET_EXHAUSTED" | "VIDEO_SCRIPT_RESOURCE_BUDGET_EXHAUSTED" | "VIDEO_PACKAGING_RESOURCE_BUDGET_EXHAUSTED" | "VIDEO_RELEASE_RESOURCE_BUDGET_EXHAUSTED" | "VIDEO_PERFORMANCE_RESOURCE_BUDGET_EXHAUSTED";
  readonly retryable = false;
  constructor(readonly exhaustionCode: string, workflowType: ClaimedWorkflowStep["workflowType"] = "CHANNEL_RESEARCH") {
    super(`The durable ${workflowType} run budget is exhausted (${exhaustionCode}).`);
    this.code = workflowType === "CHANNEL_STRATEGY" ? "STRATEGY_RESOURCE_BUDGET_EXHAUSTED"
      : workflowType === "CHANNEL_CONTENT_INTELLIGENCE" ? "CONTENT_RESOURCE_BUDGET_EXHAUSTED"
        : workflowType === "CHANNEL_VIDEO_BRIEF" ? "VIDEO_BRIEF_RESOURCE_BUDGET_EXHAUSTED"
          : workflowType === "CHANNEL_VIDEO_SCRIPT" ? "VIDEO_SCRIPT_RESOURCE_BUDGET_EXHAUSTED"
            : workflowType === "CHANNEL_VIDEO_PACKAGING" ? "VIDEO_PACKAGING_RESOURCE_BUDGET_EXHAUSTED"
              : workflowType === "CHANNEL_VIDEO_RELEASE" ? "VIDEO_RELEASE_RESOURCE_BUDGET_EXHAUSTED"
                : workflowType === "CHANNEL_VIDEO_PERFORMANCE" ? "VIDEO_PERFORMANCE_RESOURCE_BUDGET_EXHAUSTED"
                : "RESEARCH_RESOURCE_BUDGET_EXHAUSTED";
  }
}

export class ResearchOperationReplayError extends Error {
  readonly code = "RESEARCH_OPERATION_REPLAYED";
  readonly retryable = true;
  constructor() { super("A duplicate research operation was suppressed; retry through a new durable attempt."); }
}

export function aggregateResearchLimits(budget: WorkflowUsageBudget): ResearchUsageCounters {
  return {
    providerRequests: budget.maxAggregateProviderRequests,
    providerQuotaUnits: budget.maxAggregateProviderQuotaUnits,
    searches: budget.maxAggregateSearches,
    synthesisCalls: budget.maxAggregateSynthesisCalls,
    qaCalls: budget.maxAggregateQaCalls,
    revisionCalls: budget.maxAggregateRevisionCalls,
    inputTokens: budget.maxAggregateInputTokens,
    outputTokens: budget.maxAggregateOutputTokens,
    totalTokens: budget.maxAggregateTotalTokens,
    automatedRevisions: 1,
  };
}

type RpcResult = { operationId?: string; status?: string; idempotentReplay?: boolean; exhaustionCode?: string | null };

export class SupabaseResearchUsageMeter implements ResearchUsageMeter {
  private ensured = false;

  constructor(private readonly step: ClaimedWorkflowStep, private readonly budget: WorkflowUsageBudget) {}

  private key(suffix: string) {
    return `${this.step.stepKey}:attempt:${this.step.attemptCount}:${suffix}`;
  }

  async ensure() {
    if (this.ensured) return;
    const { error } = await createSupabaseAdminClient().rpc("ensure_research_run_budget", {
      p_run_id: this.step.runId,
      p_step_id: this.step.id,
      p_lease_token: this.step.leaseToken,
      p_operation_key: this.key("execution"),
      p_limits: aggregateResearchLimits(this.budget),
    });
    if (error) throw new Error(`RESEARCH_BUDGET_INITIALIZATION_FAILED:${error.message}`);
    this.ensured = true;
  }

  async reserve(input: {
    key: string;
    kind: ResearchUsageOperationKind;
    provider?: string;
    model?: string;
    reservation?: ResearchUsageCounters;
  }): Promise<ResearchUsageReservation> {
    await this.ensure();
    const { data, error } = await createSupabaseAdminClient().rpc("reserve_research_usage", {
      p_run_id: this.step.runId,
      p_step_id: this.step.id,
      p_lease_token: this.step.leaseToken,
      p_operation_key: this.key(input.key),
      p_operation_kind: input.kind,
      p_provider_identity: input.provider ?? null,
      p_model_identity: input.model ?? null,
      p_reservation: input.reservation ?? {},
    });
    if (error) throw new Error(`RESEARCH_USAGE_RESERVATION_FAILED:${error.message}`);
    const result = data as RpcResult;
    if (result.status === "REJECTED") throw new ResearchBudgetError(result.exhaustionCode ?? "RESOURCE_BUDGET_EXHAUSTED", this.step.workflowType);
    if (!result.operationId || !["RESERVED", "SUCCEEDED", "FAILED"].includes(result.status ?? "")) throw new Error("RESEARCH_USAGE_RESERVATION_INVALID");
    if (result.idempotentReplay === true) throw new ResearchOperationReplayError();
    return { operationId: result.operationId, status: result.status as ResearchUsageReservation["status"], idempotentReplay: false };
  }

  async finalize(reservation: ResearchUsageReservation, status: "SUCCEEDED" | "FAILED", actual: ResearchUsageCounters, metadata: Record<string, unknown> = {}) {
    if (reservation.status !== "RESERVED") return;
    const { error } = await createSupabaseAdminClient().rpc("finalize_research_usage", {
      p_operation_id: reservation.operationId,
      p_status: status,
      p_actual_usage: actual,
      p_metadata: metadata,
    });
    if (error) throw new Error(`RESEARCH_USAGE_FINALIZATION_FAILED:${error.message}`);
  }

  async record(input: {
    key: string;
    kind: ResearchUsageOperationKind;
    provider?: string;
    model?: string;
    actual: ResearchUsageCounters;
    metadata?: Record<string, unknown>;
  }) {
    const reservation = await this.reserve({ ...input, reservation: {} });
    await this.finalize(reservation, "SUCCEEDED", input.actual, input.metadata);
  }
}
