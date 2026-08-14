import { NextResponse } from "next/server";
import { z } from "zod";
import { workflowApprovalDecisionSchema } from "@/domain/production-workflows";
import { getCurrentUser } from "@/server/auth";
import { isMockMode } from "@/server/config";
import { unauthorizedWorkflowResponse, workflowErrorResponse } from "@/server/workflows/http";
import { ProductionWorkflowRepository } from "@/server/workflows/production-workflow-repository";

const repository = new ProductionWorkflowRepository();
const paramsSchema = z.object({ workflowId: z.string().uuid(), approvalId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ workflowId: string; approvalId: string }> }) {
  if (!await getCurrentUser()) return unauthorizedWorkflowResponse();
  if (isMockMode()) return NextResponse.json({ error: { code: "PRODUCTION_REQUIRED", message: "Durable production workflows require Supabase mode." } }, { status: 501 });
  const parsedParams = paramsSchema.safeParse(await params);
  const parsedBody = workflowApprovalDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsedParams.success || !parsedBody.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid workflow approval request." } }, { status: 422 });
  try { return NextResponse.json({ operationResult: await repository.decide(parsedParams.data.workflowId, parsedParams.data.approvalId, parsedBody.data) }); }
  catch (error) { return workflowErrorResponse(error); }
}

