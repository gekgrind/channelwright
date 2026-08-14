import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaimedWorkflowStep } from "@/domain/production-workflows";
import { ProductionWorkflowWorker } from "./workflow-worker";

const step: ClaimedWorkflowStep = {
  id: crypto.randomUUID(), ownerId: crypto.randomUUID(), workflowId: crypto.randomUUID(), runId: crypto.randomUUID(),
  workflowType: "CHANNEL_CONCEPT_VALIDATION", definitionVersion: 1, stepKey: "assess-content-depth", capability: "strategist",
  attemptCount: 1, maxAttempts: 3, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  input: { proposedConcept: "Explain the hidden systems behind ordinary local businesses" }, priorOutputs: {},
};

describe("production workflow worker", () => {
  afterEach(() => vi.useRealTimers());
  it("completes a claimed deterministic step with the winning lease", async () => {
    const repository = { claim: vi.fn().mockResolvedValue(step), complete: vi.fn().mockResolvedValue({ status: "COMPLETED" }), fail: vi.fn(), heartbeat: vi.fn() };
    const executor = { execute: vi.fn().mockResolvedValue({ status: "NEEDS_EVIDENCE", conclusion: "Needs evidence", evidenceRequired: ["Topic inventory"], suppliedSignals: [] }) };
    const result = await new ProductionWorkflowWorker(repository, executor).runOnce("worker-a", 120);
    expect(result.status).toBe("COMPLETED");
    expect(repository.complete).toHaveBeenCalledWith(step.id, step.leaseToken, expect.any(Object));
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("marks structurally invalid output terminal rather than retrying forever", async () => {
    const synthesis = { ...step, stepKey: "synthesize-validation" };
    const repository = { claim: vi.fn().mockResolvedValue(synthesis), complete: vi.fn(), fail: vi.fn().mockResolvedValue({ status: "FAILED" }), heartbeat: vi.fn() };
    const executor = { execute: vi.fn().mockResolvedValue({ fabricated: true }) };
    const result = await new ProductionWorkflowWorker(repository, executor).runOnce("worker-a", 120);
    expect(result).toMatchObject({ status: "FAILED", retryable: false });
    expect(repository.fail).toHaveBeenCalledWith(synthesis.id, synthesis.leaseToken, "WORKFLOW_OUTPUT_INVALID", expect.any(String), false);
  });

  it("preserves a safe final-QA rejection message", async () => {
    const research = { ...step, workflowType: "CHANNEL_RESEARCH" as const, stepKey: "synthesize-validation" };
    const repository = { claim: vi.fn().mockResolvedValue(research), complete: vi.fn(), fail: vi.fn().mockResolvedValue({ status: "FAILED" }), heartbeat: vi.fn() };
    const executor = { execute: vi.fn().mockRejectedValue(Object.assign(new Error("Final QA found material errors; no recommendation was advanced to human review."), { code: "RESEARCH_QA_REJECTED", retryable: false })) };
    await new ProductionWorkflowWorker(repository, executor).runOnce("worker-a", 120);
    expect(repository.fail).toHaveBeenCalledWith(
      research.id,
      research.leaseToken,
      "RESEARCH_QA_REJECTED",
      "Final QA found material errors; no recommendation was advanced to human review.",
      false,
    );
  });

  it("returns idle without mutating anything when no step is eligible", async () => {
    const repository = { claim: vi.fn().mockResolvedValue(null), complete: vi.fn(), fail: vi.fn(), heartbeat: vi.fn() };
    const result = await new ProductionWorkflowWorker(repository, { execute: vi.fn() }).runOnce("worker-a", 120);
    expect(result).toEqual({ status: "IDLE" });
  });

  it("renews the lease while a paid step is still executing", async () => {
    vi.useFakeTimers();
    let finish!: (value: { status: string; conclusion: string; evidenceRequired: string[]; suppliedSignals: string[] }) => void;
    const executing = new Promise<{ status: string; conclusion: string; evidenceRequired: string[]; suppliedSignals: string[] }>((resolve) => { finish = resolve; });
    const repository = { claim: vi.fn().mockResolvedValue(step), complete: vi.fn().mockResolvedValue({ status: "COMPLETED" }), fail: vi.fn(), heartbeat: vi.fn().mockResolvedValue(true) };
    const running = new ProductionWorkflowWorker(repository, { execute: vi.fn().mockReturnValue(executing) }).runOnce("worker-a", 30);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(repository.heartbeat).toHaveBeenCalledWith(step.id, step.leaseToken, 30);
    finish({ status: "NEEDS_EVIDENCE", conclusion: "Needs evidence", evidenceRequired: ["Topic inventory"], suppliedSignals: [] });
    await expect(running).resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("does not complete or fail with a lease that renewal reported lost", async () => {
    vi.useFakeTimers();
    let finish!: (value: { status: string; conclusion: string; evidenceRequired: string[]; suppliedSignals: string[] }) => void;
    const executing = new Promise<{ status: string; conclusion: string; evidenceRequired: string[]; suppliedSignals: string[] }>((resolve) => { finish = resolve; });
    const repository = { claim: vi.fn().mockResolvedValue(step), complete: vi.fn(), fail: vi.fn(), heartbeat: vi.fn().mockResolvedValue(false) };
    const running = new ProductionWorkflowWorker(repository, { execute: vi.fn().mockReturnValue(executing) }).runOnce("worker-a", 30);
    await vi.advanceTimersByTimeAsync(10_000);
    finish({ status: "NEEDS_EVIDENCE", conclusion: "Needs evidence", evidenceRequired: ["Topic inventory"], suppliedSignals: [] });
    await expect(running).resolves.toMatchObject({ status: "LEASE_LOST" });
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
  });
});
