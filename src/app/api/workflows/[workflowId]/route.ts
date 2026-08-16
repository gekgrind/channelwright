import { NextResponse } from "next/server";
import {
  rejectUnlessProductionWorkflowRequest,
  workflowErrorResponse,
  workflowUuidSchema,
  workflowValidationResponse,
} from "@/server/workflows/http";
import { ProductionWorkflowRepository } from "@/server/workflows/production-workflow-repository";

const repository = new ProductionWorkflowRepository();

async function parseWorkflowId(params: Promise<{ workflowId: string }>) {
  return workflowUuidSchema.safeParse((await params).workflowId);
}

export async function GET(_request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  const rejected = await rejectUnlessProductionWorkflowRequest();
  if (rejected) return rejected;
  const parsed = await parseWorkflowId(params);
  if (!parsed.success) return workflowValidationResponse("Invalid workflow identifier.");
  try { return NextResponse.json(await repository.get(parsed.data)); }
  catch (error) { return workflowErrorResponse(error); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  const rejected = await rejectUnlessProductionWorkflowRequest();
  if (rejected) return rejected;
  const parsed = await parseWorkflowId(params);
  if (!parsed.success) return workflowValidationResponse("Invalid workflow identifier.");
  try { return NextResponse.json({ operationResult: await repository.cancel(parsed.data) }); }
  catch (error) { return workflowErrorResponse(error); }
}
