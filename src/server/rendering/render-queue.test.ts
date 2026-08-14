import { describe, expect, it } from "vitest";
import { deterministicSampleInput } from "@/video/schemas/render-input";
import { MemoryRenderQueue } from "./render-queue";

describe("render queue semantics", () => {
  it("atomically leases a job to only one concurrent worker", async () => {
    const queue = new MemoryRenderQueue(); queue.enqueue(deterministicSampleInput);
    const claims = await Promise.all([queue.claim("worker-a", 30), queue.claim("worker-b", 30)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("reclaims expired leases and bounds retries", async () => {
    const queue = new MemoryRenderQueue(); const queued = queue.enqueue(deterministicSampleInput, undefined, 2);
    const first = await queue.claim("worker-a", -1); expect(first?.attemptCount).toBe(1);
    const second = await queue.claim("worker-b", 30); expect(second?.attemptCount).toBe(2);
    await queue.fail(second!.id, second!.leaseToken, { code: "ENCODER_FAILED", message: "failed", retryable: true });
    expect(queue.get(queued.id)?.status).toBe("FAILED");
  });

  it("extends active leases and finalizes observably once", async () => {
    const queue = new MemoryRenderQueue(); queue.enqueue(deterministicSampleInput);
    const claim = await queue.claim("worker-a", 30);
    await expect(queue.heartbeat(claim!.id, claim!.leaseToken, 60)).resolves.toBe(true);
    const completion = await queue.complete(claim!.id, claim!.leaseToken, {} as never);
    await expect(queue.complete(claim!.id, claim!.leaseToken, {} as never)).resolves.toEqual(completion);
  });
});
