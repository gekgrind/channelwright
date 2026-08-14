import { NextResponse } from "next/server";
import { ProductionWorkflowError } from "./production-workflow-repository";

export function workflowErrorResponse(error: unknown) {
  if (error instanceof ProductionWorkflowError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error("Production workflow operation failed", { error: error instanceof Error ? error.message : "unknown" });
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "The workflow operation failed without advancing state." } }, { status: 500 });
}

export const unauthorizedWorkflowResponse = () => NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication is required." } }, { status: 401 });

