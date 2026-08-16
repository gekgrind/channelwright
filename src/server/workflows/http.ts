import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { isMockMode } from "@/server/config";
import { logFailure } from "@/server/observability";
import { ProductionWorkflowError } from "./production-workflow-repository";

export const workflowUuidSchema = z.string().uuid();

export function workflowErrorResponse(error: unknown) {
  if (error instanceof ProductionWorkflowError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  logFailure("production_workflow_operation_failed", error);
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "The workflow operation failed without advancing state." } }, { status: 500 });
}

export const unauthorizedWorkflowResponse = () => NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication is required." } }, { status: 401 });

export const productionRequiredResponse = () => NextResponse.json({ error: { code: "PRODUCTION_REQUIRED", message: "Durable production workflows require Supabase mode." } }, { status: 501 });

export const workflowValidationResponse = (message: string) => NextResponse.json({ error: { code: "VALIDATION_ERROR", message } }, { status: 422 });

/** Returns a rejection response when the caller is unauthenticated or durable workflows are unavailable. */
export async function rejectUnlessProductionWorkflowRequest() {
  if (!await getCurrentUser()) return unauthorizedWorkflowResponse();
  if (isMockMode()) return productionRequiredResponse();
  return null;
}

