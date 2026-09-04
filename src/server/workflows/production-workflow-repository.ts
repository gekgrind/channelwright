import "server-only";

import { createHash } from "node:crypto";
import { getWorkflowDefinition, serializeWorkflowSteps, type WorkflowApprovalDecision, type WorkflowStartRequest } from "@/domain/production-workflows";
import { createSupabaseServerClient } from "@/server/supabase";

export type ProductionWorkflowErrorCode = "UNAUTHORIZED" | "VALIDATION_ERROR" | "PAYLOAD_TOO_LARGE" | "WORKFLOW_TYPE_INVALID" | "IDEMPOTENCY_CONFLICT" | "RESEARCH_LIMIT_REACHED" | "STRATEGY_LIMIT_REACHED" | "CONTENT_LIMIT_REACHED" | "VIDEO_BRIEF_LIMIT_REACHED" | "VIDEO_SCRIPT_LIMIT_REACHED" | "VIDEO_PACKAGING_LIMIT_REACHED" | "VIDEO_RELEASE_LIMIT_REACHED" | "VIDEO_PERFORMANCE_LIMIT_REACHED" | "VIDEO_DIAGNOSIS_LIMIT_REACHED" | "UPSTREAM_RESEARCH_INVALID" | "UPSTREAM_STRATEGY_INVALID" | "UPSTREAM_CONTENT_INVALID" | "UPSTREAM_BRIEF_INVALID" | "UPSTREAM_SCRIPT_INVALID" | "UPSTREAM_PACKAGING_INVALID" | "UPSTREAM_RELEASE_INVALID" | "UPSTREAM_PERFORMANCE_INVALID" | "TOPIC_INVALID" | "NOT_FOUND" | "INVALID_TRANSITION" | "LEASE_NOT_ACTIVE" | "DATABASE_ERROR";

export class ProductionWorkflowError extends Error {
  constructor(public readonly code: ProductionWorkflowErrorCode, public readonly status: number, message: string) { super(message); }
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Maps a raised PostgreSQL error onto a stable typed code and HTTP status. Exported for regression tests. */
export function databaseError(error: { message: string }) {
  const entries: Array<[string, ProductionWorkflowErrorCode, number, string]> = [
    ["IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT", 409, "The idempotency key was already used for different workflow input."],
    ["RESEARCH_LIMIT_REACHED", "RESEARCH_LIMIT_REACHED", 429, "Finish or cancel the active research run before starting another paid run."],
    ["STRATEGY_LIMIT_REACHED", "STRATEGY_LIMIT_REACHED", 429, "Finish, cancel, or decide the active strategy run for this approved research before starting another paid run."],
    ["CONTENT_LIMIT_REACHED", "CONTENT_LIMIT_REACHED", 429, "Finish, cancel, or decide the active content-intelligence run for this approved strategy before starting another paid run."],
    ["VIDEO_BRIEF_LIMIT_REACHED", "VIDEO_BRIEF_LIMIT_REACHED", 429, "Finish, cancel, or decide the active video brief for this approved topic before starting another paid run."],
    ["VIDEO_SCRIPT_LIMIT_REACHED", "VIDEO_SCRIPT_LIMIT_REACHED", 429, "Finish, cancel, or decide the active video script for this approved brief before starting another paid run."],
    ["VIDEO_PACKAGING_LIMIT_REACHED", "VIDEO_PACKAGING_LIMIT_REACHED", 429, "Finish, cancel, or decide the active video packaging for this approved script before starting another paid run."],
    ["VIDEO_RELEASE_LIMIT_REACHED", "VIDEO_RELEASE_LIMIT_REACHED", 429, "Finish, cancel, or decide the active video release for this approved packaging before starting another paid run."],
    ["VIDEO_DIAGNOSIS_LIMIT_REACHED", "VIDEO_DIAGNOSIS_LIMIT_REACHED", 429, "Finish, cancel, or decide the active diagnosis for this approved Performance artifact before starting another run."],
    ["UPSTREAM_RESEARCH_", "UPSTREAM_RESEARCH_INVALID", 409, "The exact research run is not completed, approved, immutable, and integrity-valid for strategy."],
    ["UPSTREAM_STRATEGY_", "UPSTREAM_STRATEGY_INVALID", 409, "The exact strategy run is not completed, approved, immutable, and integrity-valid for content intelligence."],
    ["UPSTREAM_CONTENT_", "UPSTREAM_CONTENT_INVALID", 409, "The exact content-intelligence run is not completed, approved, immutable, and integrity-valid for a video brief."],
    ["UPSTREAM_BRIEF_", "UPSTREAM_BRIEF_INVALID", 409, "The exact video-brief run is not completed, approved, immutable, and integrity-valid for a video script."],
    ["UPSTREAM_SCRIPT_", "UPSTREAM_SCRIPT_INVALID", 409, "The exact video-script run is not completed, approved, immutable, and integrity-valid for video packaging."],
    ["UPSTREAM_PACKAGING_", "UPSTREAM_PACKAGING_INVALID", 409, "The exact video-packaging run is not completed, approved, immutable, and integrity-valid for a video release."],
    ["UPSTREAM_PERFORMANCE_", "UPSTREAM_PERFORMANCE_INVALID", 409, "The exact Performance run is not completed, approved, immutable, latest, and integrity-valid for Diagnosis."],
    ["TOPIC_", "TOPIC_INVALID", 422, "The selected topic is not eligible in the exact approved content-intelligence artifact."],
    ["WORKFLOW_TYPE_INVALID", "WORKFLOW_TYPE_INVALID", 422, "The workflow type or version is not supported."],
    ["PAYLOAD_TOO_LARGE", "PAYLOAD_TOO_LARGE", 413, "The workflow payload exceeds the allowed size."],
    ["NOT_FOUND", "NOT_FOUND", 404, "The requested workflow resource was not found."],
    ["INVALID_TRANSITION", "INVALID_TRANSITION", 409, "The requested workflow transition is not legal from its current state."],
    ["LEASE_NOT_ACTIVE", "LEASE_NOT_ACTIVE", 409, "The workflow lease is no longer active."],
    ["VALIDATION_ERROR", "VALIDATION_ERROR", 422, "The workflow request failed server-side validation."],
    ["NOT_ALLOWED", "INVALID_TRANSITION", 409, "The requested workflow operation is not allowed."],
  ];
  const match = entries.find(([marker]) => error.message.includes(marker));
  return match ? new ProductionWorkflowError(match[1], match[2], match[3]) : new ProductionWorkflowError("DATABASE_ERROR", 500, "The workflow operation could not be completed.");
}

export class ProductionWorkflowRepository {
  async start(ownerId: string, idempotencyKey: string, request: WorkflowStartRequest) {
    const definition = getWorkflowDefinition(request.workflowType, request.definitionVersion);
    const input = definition.inputSchema.parse(request.input);
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("start_workflow", {
      p_idempotency_key: idempotencyKey,
      p_input_hash: hash({ ownerId, type: definition.type, version: definition.version, input }),
      p_workflow_type: definition.type,
      p_definition_version: definition.version,
      p_objective: definition.objective,
      p_input: input,
      p_steps: serializeWorkflowSteps(definition),
    });
    if (error) throw databaseError(error);
    return data;
  }

  async list() {
    const client = await createSupabaseServerClient();
    const [workflows, runs, approvals] = await Promise.all([
      client.from("workflows").select("*").order("created_at", { ascending: false }).limit(100),
      client.from("workflow_runs").select("id,workflow_id,status,output_payload,error_code,created_at,completed_at").order("created_at", { ascending: false }).limit(100),
      client.from("workflow_approvals").select("id,workflow_id,workflow_run_id,gate_key,status,requested_at,decided_at").eq("status", "PENDING").order("requested_at", { ascending: false }),
    ]);
    const error = workflows.error ?? runs.error ?? approvals.error;
    if (error) throw databaseError(error);
    return { workflows: workflows.data ?? [], runs: runs.data ?? [], pendingApprovals: approvals.data ?? [] };
  }

  async get(workflowId: string, runId?: string) {
    const client = await createSupabaseServerClient();
    const workflow = await client.from("workflows").select("*").eq("id", workflowId).maybeSingle();
    if (workflow.error) throw databaseError(workflow.error);
    if (!workflow.data) throw new ProductionWorkflowError("NOT_FOUND", 404, "The requested workflow was not found.");
    const runQuery = client.from("workflow_runs").select("*").eq("workflow_id", workflowId).order("created_at", { ascending: false });
    const runs = runId ? await runQuery.eq("id", runId) : await runQuery;
    if (runs.error) throw databaseError(runs.error);
    if (runId && runs.data.length === 0) throw new ProductionWorkflowError("NOT_FOUND", 404, "The requested workflow run was not found.");
    const selectedRunIds = runs.data.map((run) => run.id);
    if (selectedRunIds.length === 0) return { workflow: workflow.data, runs: [], steps: [], attempts: [], approvals: [], events: [], researchBudgets: [], researchUsageOperations: [] };
    const [steps, attempts, approvals, events, researchBudgets, researchUsageOperations] = await Promise.all([
      client.from("workflow_steps").select("*").in("workflow_run_id", selectedRunIds).order("position"),
      client.from("workflow_step_attempts").select("*").in("workflow_run_id", selectedRunIds).order("started_at"),
      client.from("workflow_approvals").select("*").in("workflow_run_id", selectedRunIds).order("requested_at"),
      client.from("workflow_events").select("*").in("workflow_run_id", selectedRunIds).order("created_at").order("id"),
      client.from("research_run_budgets").select("*").in("workflow_run_id", selectedRunIds).order("created_at"),
      client.from("research_usage_operations").select("*").in("workflow_run_id", selectedRunIds).order("created_at"),
    ]);
    const error = steps.error ?? attempts.error ?? approvals.error ?? events.error ?? researchBudgets.error ?? researchUsageOperations.error;
    if (error) throw databaseError(error);
    return {
      workflow: workflow.data,
      runs: runs.data,
      steps: steps.data ?? [],
      attempts: attempts.data ?? [],
      approvals: approvals.data ?? [],
      events: events.data ?? [],
      researchBudgets: researchBudgets.data ?? [],
      researchUsageOperations: researchUsageOperations.data ?? [],
    };
  }

  async cancel(workflowId: string) {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("cancel_workflow", { p_workflow_id: workflowId });
    if (error) throw databaseError(error);
    return data;
  }

  async decide(workflowId: string, approvalId: string, decision: WorkflowApprovalDecision) {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("decide_workflow_approval", { p_workflow_id: workflowId, p_approval_id: approvalId, p_decision: decision.decision, p_note: decision.note ?? null });
    if (error) throw databaseError(error);
    return data;
  }
}
