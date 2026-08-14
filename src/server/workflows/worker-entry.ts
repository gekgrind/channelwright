import { hostname } from "node:os";
import { workflowWorkerConfig } from "@/server/config";
import { ProductionWorkflowWorker } from "./workflow-worker";

const config = workflowWorkerConfig();
const worker = new ProductionWorkflowWorker();
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

while (!stopping) {
  try {
    const result = await worker.runOnce(config.workerId || `workflow-${hostname()}-${process.pid}`, config.leaseSeconds);
    if (result.status === "IDLE" || result.status === "LEASE_LOST") await pause(config.pollIntervalMs);
  } catch (error) {
    console.error("workflow_worker_iteration_failed", { error: error instanceof Error ? error.message : "unknown" });
    await pause(config.pollIntervalMs);
  }
}
