import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { workflowRequestSchema } from "@/domain/actions";
import { isMediaProductionAction } from "@/domain/media-production";
import { workflowStartRequestSchema } from "@/domain/production-workflows";
import { getCurrentUser } from "@/server/auth";
import { isMockMode } from "@/server/config";
import { ChannelwrightOrchestrator, WorkflowError } from "@/server/orchestrator";
import { logFailure } from "@/server/observability";
import { JsonWorkspaceRepository } from "@/server/repository";
import { createSerialQueue } from "@/server/serial-queue";
import { FixtureMediaOrchestrator } from "@/server/media/fixture-media-orchestrator";
import { ProductionMediaRepository } from "@/server/media/production-media-repository";
import { productionRequiredResponse, unauthorizedWorkflowResponse, workflowErrorResponse } from "@/server/workflows/http";
import { ProductionWorkflowRepository } from "@/server/workflows/production-workflow-repository";

const fixtureRepository = new JsonWorkspaceRepository();
const orchestrator = new ChannelwrightOrchestrator(fixtureRepository);
const fixtureMedia = new FixtureMediaOrchestrator(fixtureRepository);
const productionMedia = new ProductionMediaRepository();
const productionWorkflows = new ProductionWorkflowRepository();
const exclusive = createSerialQueue();

const unavailable = (action?: string) => NextResponse.json({
  error: `Production capability ${action ?? "workflow-planning"} is not enabled. Transactional media-production actions are supported; live planning agents and publishing are not.`,
  capability: action ?? "workflow-planning",
}, { status: 501 });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorizedWorkflowResponse();
  if (!isMockMode()) {
    try {
      const [media, workflowEngine] = await Promise.all([productionMedia.snapshot(), productionWorkflows.list()]);
      return NextResponse.json({ ...media, workflowEngine, capabilities: { ...media.capabilities, workflowPlanning: true } });
    } catch (error) { return workflowErrorResponse(error); }
  }
  return NextResponse.json(await orchestrator.snapshot(user.id));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorizedWorkflowResponse();
  const body: unknown = await request.json().catch(() => null);
  const requestedKey = request.headers.get("idempotency-key")?.trim();
  const workflowStart = workflowStartRequestSchema.safeParse(body);
  if (workflowStart.success) {
    if (isMockMode()) return productionRequiredResponse();
    if (["CHANNEL_RESEARCH", "CHANNEL_STRATEGY", "CHANNEL_CONTENT_INTELLIGENCE", "CHANNEL_VIDEO_BRIEF", "CHANNEL_VIDEO_SCRIPT", "CHANNEL_VIDEO_PACKAGING"].includes(workflowStart.data.workflowType) && !requestedKey) {
      return NextResponse.json({ error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Paid workflow starts require an Idempotency-Key header." } }, { status: 400 });
    }
    try {
      const operationResult = await productionWorkflows.start(user.id, requestedKey ?? randomUUID(), workflowStart.data);
      return NextResponse.json({ operationResult }, { status: 202 });
    } catch (error) { return workflowErrorResponse(error); }
  }
  const parsed = workflowRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid workflow request.", issues: parsed.error.flatten() } }, { status: 422 });
  try {
    if (!isMockMode()) {
      if (!isMediaProductionAction(parsed.data)) return unavailable(parsed.data.type);
      const result = await productionMedia.execute(user.id, requestedKey ?? randomUUID(), parsed.data);
      return NextResponse.json({ ...(await productionMedia.snapshot()), operationResult: result });
    }
    return NextResponse.json(await exclusive(async () => {
      if (isMediaProductionAction(parsed.data)) {
        await fixtureMedia.execute(user.id, requestedKey ?? randomUUID(), parsed.data);
        return orchestrator.snapshot(user.id);
      }
      return orchestrator.execute(user.id, requestedKey ?? randomUUID(), parsed.data);
    }));
  } catch (error) {
    if (error instanceof WorkflowError) return NextResponse.json({ error: error.message }, { status: error.status });
    logFailure("workflow_operation_failed", error, { actionType: parsed.data.type });
    return NextResponse.json({ error: "Workflow operation failed without advancing state" }, { status: 500 });
  }
}
