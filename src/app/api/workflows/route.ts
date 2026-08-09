import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { workflowActionSchema } from "@/domain/actions";
import { getCurrentUser } from "@/server/auth";
import { isMockMode } from "@/server/config";
import { ChannelwrightOrchestrator, WorkflowError } from "@/server/orchestrator";
import { JsonWorkspaceRepository } from "@/server/repository";

const orchestrator = new ChannelwrightOrchestrator(new JsonWorkspaceRepository());
let operationQueue = Promise.resolve();
const exclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
};

const unavailable = () => NextResponse.json({ error: "The Supabase production repository is not enabled in this vertical slice. Use fixture mode for the tested workflow." }, { status: 501 });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isMockMode()) return unavailable();
  return NextResponse.json(await orchestrator.snapshot(user.id));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isMockMode()) return unavailable();
  const body: unknown = await request.json().catch(() => null);
  const parsed = workflowActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid workflow action", issues: parsed.error.flatten() }, { status: 422 });
  const key = request.headers.get("idempotency-key") ?? randomUUID();
  try {
    return NextResponse.json(await exclusive(() => orchestrator.execute(user.id, key, parsed.data)));
  } catch (error) {
    if (error instanceof WorkflowError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Workflow operation failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Workflow operation failed without advancing state" }, { status: 500 });
  }
}
