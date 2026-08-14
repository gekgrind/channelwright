import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { isMockMode } from "@/server/config";
import { unauthorizedWorkflowResponse, workflowErrorResponse } from "@/server/workflows/http";
import { ProductionWorkflowRepository } from "@/server/workflows/production-workflow-repository";

const repository = new ProductionWorkflowRepository();
const paramsSchema = z.object({ workflowId: z.string().uuid(), runId: z.string().uuid() });

export async function GET(_request: Request, { params }: { params: Promise<{ workflowId: string; runId: string }> }) {
  if (!await getCurrentUser()) return unauthorizedWorkflowResponse();
  if (isMockMode()) return NextResponse.json({ error: { code: "PRODUCTION_REQUIRED", message: "Durable production workflows require Supabase mode." } }, { status: 501 });
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid workflow or run identifier." } }, { status: 422 });
  try { return NextResponse.json(await repository.get(parsed.data.workflowId, parsed.data.runId)); }
  catch (error) { return workflowErrorResponse(error); }
}

