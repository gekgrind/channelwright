import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { isMockMode } from "@/server/config";
import { unauthorizedWorkflowResponse, workflowErrorResponse } from "@/server/workflows/http";
import { ProductionWorkflowRepository } from "@/server/workflows/production-workflow-repository";

const repository = new ProductionWorkflowRepository();
const idSchema = z.string().uuid();

async function parseWorkflowId(params: Promise<{ workflowId: string }>) {
  return idSchema.safeParse((await params).workflowId);
}

export async function GET(_request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  if (!await getCurrentUser()) return unauthorizedWorkflowResponse();
  if (isMockMode()) return NextResponse.json({ error: { code: "PRODUCTION_REQUIRED", message: "Durable production workflows require Supabase mode." } }, { status: 501 });
  const parsed = await parseWorkflowId(params);
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid workflow identifier." } }, { status: 422 });
  try { return NextResponse.json(await repository.get(parsed.data)); }
  catch (error) { return workflowErrorResponse(error); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  if (!await getCurrentUser()) return unauthorizedWorkflowResponse();
  if (isMockMode()) return NextResponse.json({ error: { code: "PRODUCTION_REQUIRED", message: "Durable production workflows require Supabase mode." } }, { status: 501 });
  const parsed = await parseWorkflowId(params);
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid workflow identifier." } }, { status: 422 });
  try { return NextResponse.json({ operationResult: await repository.cancel(parsed.data) }); }
  catch (error) { return workflowErrorResponse(error); }
}

