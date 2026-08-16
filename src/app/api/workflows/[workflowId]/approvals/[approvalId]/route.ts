import { NextResponse } from "next/server";
import { z } from "zod";
import { workflowApprovalDecisionSchema } from "@/domain/production-workflows";
import {
  rejectUnlessProductionWorkflowRequest,
  workflowErrorResponse,
  workflowUuidSchema,
  workflowValidationResponse,
} from "@/server/workflows/http";
import { ProductionWorkflowRepository } from "@/server/workflows/production-workflow-repository";

const repository = new ProductionWorkflowRepository();
const paramsSchema = z.object({ workflowId: workflowUuidSchema, approvalId: workflowUuidSchema });

export async function POST(request: Request, { params }: { params: Promise<{ workflowId: string; approvalId: string }> }) {
  const rejected = await rejectUnlessProductionWorkflowRequest();
  if (rejected) return rejected;
  const parsedParams = paramsSchema.safeParse(await params);
  const parsedBody = workflowApprovalDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsedParams.success || !parsedBody.success) return workflowValidationResponse("Invalid workflow approval request.");
  try { return NextResponse.json({ operationResult: await repository.decide(parsedParams.data.workflowId, parsedParams.data.approvalId, parsedBody.data) }); }
  catch (error) { return workflowErrorResponse(error); }
}
