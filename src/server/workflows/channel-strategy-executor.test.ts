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
const content = (() => { const { upstreamResearch: _upstream, ...rest } = strategyResultFixture; return rest; })();

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

  it("fails closed when final QA retains a material error", async () => {
    const { resolver, model, meter } = dependencies();
    model.qa = vi.fn().mockResolvedValue({ qa: { score: 20, findings: [{ severity: "error", code: "UNSUPPORTED", message: "Unsupported.", evidenceIds: [] }], recommendation: "revise" }, usage });
    const executor = new ChannelStrategyExecutor(resolver, model, meter);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["validate-approved-research", "draft-strategy", "initial-strategy-qa", "bounded-strategy-revision", "final-strategy-qa"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    await expect(executor.execute({ ...base, stepKey: "finalize-strategy", priorOutputs: outputs })).rejects.toMatchObject({ code: "STRATEGY_QA_REJECTED", retryable: false });
  });
});
