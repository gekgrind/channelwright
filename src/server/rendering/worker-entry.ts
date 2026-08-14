import { randomUUID } from "node:crypto";
import { SupabaseObjectStorage } from "@/server/media/supabase-storage";
import { ProductionRenderQueue } from "./production-render-queue";
import { processRenderJob } from "./worker";

const workerId = process.env.RENDER_WORKER_ID ?? `channelwright-${randomUUID()}`;
const leaseSeconds = Number(process.env.RENDER_LEASE_SECONDS ?? 120);
if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) throw new Error("RENDER_LEASE_SECONDS must be an integer from 30 to 900");
const pollMilliseconds = Number(process.env.RENDER_POLL_INTERVAL_MS ?? 2000);
if (!Number.isInteger(pollMilliseconds) || pollMilliseconds < 250 || pollMilliseconds > 60_000) throw new Error("RENDER_POLL_INTERVAL_MS must be an integer from 250 to 60000");

const queue = new ProductionRenderQueue(); const storage = new SupabaseObjectStorage(); let stopping = false;
process.on("SIGINT", () => { stopping = true; }); process.on("SIGTERM", () => { stopping = true; });

while (!stopping) {
  const job = await queue.claim(workerId, leaseSeconds);
  if (job) await processRenderJob(job, queue, storage, { workerId, leaseSeconds }).catch(() => undefined);
  else await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
}
