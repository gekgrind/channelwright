import { NextResponse } from "next/server";
import { logFailure } from "@/server/observability";
import { ProductionWorkflowError } from "./production-workflow-repository";

export function workflowErrorResponse(error: unknown) {
  if (error instanceof ProductionWorkflowError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  logFailure("production_workflow_operation_failed", error);
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "The workflow operation failed without advancing state." } }, { status: 500 });
}

export const unauthorizedWorkflowResponse = () => NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication is required." } }, { status: 401 });

