import { describe, expect, it, vi } from "vitest";
import type { ClaimedWorkflowStep } from "@/domain/production-workflows";
import { ChannelStrategyExecutor } from "./channel-strategy-executor";
import { approvedResearchArtifactFixture, approvedResearchReferenceFixture, strategyResultFixture } from "./strategy-fixtures.test-helper";
import type { ResearchUsageMeter } from "./research-usage";

const base: ClaimedWorkflowStep = {
  id: crypto.randomUUID(), ownerId: approvedResearchReferenceFixture.approvedBy, workflowId: crypto.randomUUID(), runId: crypto.randomUUID(),
  workflowType: "CHANNEL_STRATEGY", definitionVersion: 1, stepKey: "validate-approved-research", capability: "approved-research-validation",
  attemptCount: 1, maxAttempts: 2, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  input: { researchWorkflowId: approvedResearchReferenceFixture.researchWorkflowId, researchRunId: approvedResearchReferenceFixture.researchRunId, approvedResearchReference: approvedResearchReferenceFixture }, priorOutputs: {},
};

const usage = { model: "strategy-test", inputTokens: 100, outputTokens: 50, totalTokens: 150 };
const content = (() => {
  const draft: Record<string, unknown> = { ...strategyResultFixture };
  delete draft.upstreamResearch;
  return draft;
})();

function dependencies(revise = false) {
  const resolver = { resolve: vi.fn().mockResolvedValue(approvedResearchArtifactFixture) };
  const model = {
    synthesize: vi.fn().mockResolvedValue({ content, usage }),
    qa: revise
      ? vi.fn().mockResolvedValueOnce({ qa: { score: 60, findings: [{ severity: "error", code: "REVISE", message: "Revise it.", evidenceIds: [] }], recommendation: "revise" }, usage }).mockResolvedValueOnce({ qa: { score: 90, findings: [], recommendation: "accept" }, usage })
      : vi.fn().mockResolvedValue({ qa: { score: 90, findings: [], recommendation: "accept" }, usage }),
  };
  const reservation = { operationId: crypto.randomUUID(), status: "RESERVED" as const, idempotentReplay: false };
  const meter: ResearchUsageMeter = { ensure: vi.fn(), reserve: vi.fn().mockResolvedValue(reservation), finalize: vi.fn(), record: vi.fn() };
  return { resolver, model, meter, reservation };
}

describe("CHANNEL_STRATEGY executor", () => {
  it("revalidates one exact approved research artifact and advances a typed strategy to human review", async () => {
    const { resolver, model, meter } = dependencies();
    const executor = new ChannelStrategyExecutor(resolver, model, meter);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["validate-approved-research", "draft-strategy", "initial-strategy-qa", "bounded-strategy-revision", "final-strategy-qa", "finalize-strategy"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    expect(resolver.resolve).toHaveBeenCalledWith(approvedResearchReferenceFixture.researchWorkflowId, approvedResearchReferenceFixture.researchRunId, approvedResearchReferenceFixture);
    expect(outputs["finalize-strategy"]).toEqual(strategyResultFixture);
    expect(outputs["bounded-strategy-revision"]).toMatchObject({ attempted: false });
    expect(model.synthesize).toHaveBeenCalledTimes(1);
    expect(model.qa).toHaveBeenCalledTimes(2);
  });

  it("permits at most one automated revision and charges it to the same run budget", async () => {
    const { resolver, model, meter, reservation } = dependencies(true);
    const executor = new ChannelStrategyExecutor(resolver, model, meter);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["validate-approved-research", "draft-strategy", "initial-strategy-qa", "bounded-strategy-revision", "final-strategy-qa", "finalize-strategy"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    expect(outputs["bounded-strategy-revision"]).toMatchObject({ attempted: true });
    expect(model.synthesize).toHaveBeenCalledTimes(2);
    expect(meter.reserve).toHaveBeenCalledWith({ key: "strategy:automated-revision", kind: "AUTOMATED_REVISION", reservation: { automatedRevisions: 1 } });
    expect(meter.finalize).toHaveBeenCalledWith(reservation, "SUCCEEDED", { automatedRevisions: 1 });
  });

  it("discards a bounded revision that introduces a new deterministic error and keeps the safer draft", async () => {
    const { resolver, model, meter } = dependencies(true);
    const degraded = { ...content, recommendation: { ...strategyResultFixture.recommendation, evidenceIds: [] } };
    model.synthesize = vi.fn().mockResolvedValueOnce({ content, usage }).mockResolvedValueOnce({ content: degraded, usage });
    const executor = new ChannelStrategyExecutor(resolver, model, meter);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["validate-approved-research", "draft-strategy", "initial-strategy-qa", "bounded-strategy-revision", "final-strategy-qa", "finalize-strategy"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    const revision = outputs["bounded-strategy-revision"] as { attempted: boolean; reason: string; result: unknown };
    expect(revision.attempted).toBe(true);
    expect(revision.reason).toContain("discarded because it introduced deterministic errors");
    expect(revision.reason).toContain("RECOMMENDATION_SUPPORT_MISSING");
    expect(revision.result).toEqual(strategyResultFixture);
    expect(outputs["finalize-strategy"]).toEqual(strategyResultFixture);
    expect(model.synthesize).toHaveBeenCalledTimes(2);
  });

  it("never performs a second automated revision even when the first is discarded", async () => {
    const { resolver, model, meter } = dependencies();
    model.qa = vi.fn().mockResolvedValue({ qa: { score: 60, findings: [{ severity: "error", code: "REVISE", message: "Revise it.", evidenceIds: [] }], recommendation: "revise" }, usage });
    const executor = new ChannelStrategyExecutor(resolver, model, meter);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["validate-approved-research", "draft-strategy", "initial-strategy-qa", "bounded-strategy-revision", "final-strategy-qa"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    expect(model.synthesize).toHaveBeenCalledTimes(2);
    expect(meter.reserve).toHaveBeenCalledTimes(1);
    await expect(executor.execute({ ...base, stepKey: "finalize-strategy", priorOutputs: outputs })).rejects.toMatchObject({ code: "STRATEGY_QA_REJECTED" });
  });

  it("charges a failed revision conservatively and rethrows without advancing", async () => {
    const { resolver, model, meter, reservation } = dependencies(true);
    model.synthesize = vi.fn().mockResolvedValueOnce({ content, usage }).mockRejectedValueOnce(new Error("provider exploded"));
    const executor = new ChannelStrategyExecutor(resolver, model, meter);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["validate-approved-research", "draft-strategy", "initial-strategy-qa"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    await expect(executor.execute({ ...base, stepKey: "bounded-strategy-revision", priorOutputs: outputs })).rejects.toThrow("provider exploded");
    expect(meter.finalize).toHaveBeenCalledWith(reservation, "FAILED", { automatedRevisions: 1, failedOperations: 1 });
  });

  it("refuses a step belonging to a different workflow type", async () => {
    const { resolver, model, meter } = dependencies();
    const executor = new ChannelStrategyExecutor(resolver, model, meter);
    await expect(executor.execute({ ...base, workflowType: "CHANNEL_RESEARCH" })).rejects.toMatchObject({ code: "WORKFLOW_STEP_NOT_SUPPORTED", retryable: false });
  });

  it("fails closed when final QA retains a material error", async () => {
    const { resolver, model, meter } = dependencies();
    model.qa = vi.fn().mockResolvedValue({ qa: { score: 20, findings: [{ severity: "error", code: "UNSUPPORTED", message: "Unsupported.", evidenceIds: [] }], recommendation: "revise" }, usage });
    const executor = new ChannelStrategyExecutor(resolver, model, meter);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["validate-approved-research", "draft-strategy", "initial-strategy-qa", "bounded-strategy-revision", "final-strategy-qa"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    await expect(executor.execute({ ...base, stepKey: "finalize-strategy", priorOutputs: outputs })).rejects.toMatchObject({ code: "STRATEGY_QA_REJECTED", retryable: false });
  });
});
