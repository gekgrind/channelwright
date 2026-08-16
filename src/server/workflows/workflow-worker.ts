import { ZodError } from "zod";
import { claimedWorkflowStepSchema, getWorkflowDefinition, WORKFLOW_FINALIZER_STEP, type ClaimedWorkflowStep } from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { ChannelConceptValidationExecutor, type WorkflowStepExecutor } from "./concept-validation-executor";
import { ChannelResearchExecutor } from "./channel-research-executor";
import { ChannelStrategyExecutor } from "./channel-strategy-executor";
import { ChannelContentIntelligenceExecutor } from "./content-intelligence-executor";

class RoutingWorkflowStepExecutor implements WorkflowStepExecutor {
  private readonly concept = new ChannelConceptValidationExecutor();
  private readonly research = new ChannelResearchExecutor();
  private readonly strategy = new ChannelStrategyExecutor();
  private readonly content = new ChannelContentIntelligenceExecutor();
  execute(step: ClaimedWorkflowStep) {
    return step.workflowType === "CHANNEL_RESEARCH" ? this.research.execute(step)
      : step.workflowType === "CHANNEL_STRATEGY" ? this.strategy.execute(step)
        : step.workflowType === "CHANNEL_CONTENT_INTELLIGENCE" ? this.content.execute(step)
          : this.concept.execute(step);
  }
}

export class WorkflowWorkerRepository {
  async claim(workerId: string, leaseSeconds: number): Promise<ClaimedWorkflowStep | null> {
    const { data, error } = await createSupabaseAdminClient().rpc("claim_workflow_step", { p_worker_id: workerId, p_lease_seconds: leaseSeconds });
    if (error) throw new Error(`WORKFLOW_CLAIM_FAILED:${error.message}`);
    return data ? claimedWorkflowStepSchema.parse(data) : null;
  }

  async heartbeat(stepId: string, leaseToken: string, leaseSeconds: number) {
    const { data, error } = await createSupabaseAdminClient().rpc("heartbeat_workflow_step", { p_step_id: stepId, p_lease_token: leaseToken, p_lease_seconds: leaseSeconds });
    if (error) throw new Error(`WORKFLOW_HEARTBEAT_FAILED:${error.message}`);
    return data === true;
  }

  async complete(stepId: string, leaseToken: string, output: unknown) {
    const { data, error } = await createSupabaseAdminClient().rpc("complete_workflow_step", { p_step_id: stepId, p_lease_token: leaseToken, p_output: output });
    if (error) throw new Error(`WORKFLOW_COMPLETE_FAILED:${error.message}`);
    return data;
  }

  async fail(stepId: string, leaseToken: string, code: string, message: string, retryable: boolean) {
    const { data, error } = await createSupabaseAdminClient().rpc("fail_workflow_step", {
      p_step_id: stepId, p_lease_token: leaseToken, p_error_code: code, p_error_message: message, p_retryable: retryable,
    });
    if (error) throw new Error(`WORKFLOW_FAIL_FAILED:${error.message}`);
    return data;
  }
}

export class ProductionWorkflowWorker {
  constructor(
    private readonly repository = new WorkflowWorkerRepository(),
    private readonly executor: WorkflowStepExecutor = new RoutingWorkflowStepExecutor(),
  ) {}

  async runOnce(workerId: string, leaseSeconds: number) {
    const step = await this.repository.claim(workerId, leaseSeconds);
    if (!step) return { status: "IDLE" as const };
    let leaseActive = true;
    let heartbeatInFlight = false;
    const heartbeatIntervalMs = Math.max(1_000, Math.floor(leaseSeconds * 1_000 / 3));
    const heartbeatTimer = setInterval(async () => {
      if (heartbeatInFlight || !leaseActive) return;
      heartbeatInFlight = true;
      try {
        leaseActive = await this.repository.heartbeat(step.id, step.leaseToken, leaseSeconds);
      } catch {
        leaseActive = false;
      } finally {
        heartbeatInFlight = false;
      }
    }, heartbeatIntervalMs);
    try {
      const output = await this.executor.execute(step);
      if (!leaseActive) return { status: "LEASE_LOST" as const, stepId: step.id };
      if (step.stepKey === WORKFLOW_FINALIZER_STEP[step.workflowType]) getWorkflowDefinition(step.workflowType, step.definitionVersion).outputSchema.parse(output);
      const result = await this.repository.complete(step.id, step.leaseToken, output);
      return { status: "COMPLETED" as const, stepId: step.id, result };
    } catch (error) {
      if (!leaseActive) return { status: "LEASE_LOST" as const, stepId: step.id };
      const classified = error && typeof error === "object" ? error as { code?: unknown; retryable?: unknown } : {};
      const terminal = error instanceof ZodError
        || classified.retryable === false
        || (error instanceof Error && (error.message.startsWith("WORKFLOW_STEP_NOT_SUPPORTED") || error.message.startsWith("WORKFLOW_CONTEXT_MISSING")));
      const code = typeof classified.code === "string" ? classified.code : terminal ? "WORKFLOW_OUTPUT_INVALID" : "WORKFLOW_STEP_FAILED";
      const message = error instanceof ZodError
        ? "The workflow step produced invalid structured output."
        : code === "RESEARCH_QA_REJECTED" || code === "STRATEGY_QA_REJECTED" || code === "CONTENT_QA_REJECTED"
          ? "Final QA found material errors; no recommendation was advanced to human review."
          : code === "CONTENT_INTEGRITY_UNREVISABLE"
            ? "A blocking viewer-value or content-integrity failure cannot be resolved by automated revision."
          : code === "RESEARCH_RESOURCE_BUDGET_EXHAUSTED" || code === "STRATEGY_RESOURCE_BUDGET_EXHAUSTED" || code === "CONTENT_RESOURCE_BUDGET_EXHAUSTED"
            ? "The durable workflow-run resource budget was exhausted; no further external calls were made."
          : terminal
            ? "The workflow step failed a terminal validation gate."
            : "The workflow step failed before producing durable output.";
      const result = await this.repository.fail(step.id, step.leaseToken, code, message, !terminal);
      return { status: "FAILED" as const, stepId: step.id, retryable: !terminal, result };
    } finally {
      clearInterval(heartbeatTimer);
    }
  }
}
