import { NextResponse } from "next/server";
import { z } from "zod";
import {
  rejectUnlessProductionWorkflowRequest,
  workflowErrorResponse,
  workflowUuidSchema,
  workflowValidationResponse,
} from "@/server/workflows/http";
import { ProductionWorkflowRepository } from "@/server/workflows/production-workflow-repository";

const repository = new ProductionWorkflowRepository();
const paramsSchema = z.object({ workflowId: workflowUuidSchema, runId: workflowUuidSchema });

export async function GET(_request: Request, { params }: { params: Promise<{ workflowId: string; runId: string }> }) {
  const rejected = await rejectUnlessProductionWorkflowRequest();
  if (rejected) return rejected;
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return workflowValidationResponse("Invalid workflow or run identifier.");
  try { return NextResponse.json(await repository.get(parsed.data.workflowId, parsed.data.runId)); }
  catch (error) { return workflowErrorResponse(error); }
}
