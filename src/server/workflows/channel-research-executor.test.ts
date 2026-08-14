import { describe, expect, it, vi } from "vitest";
import type { ClaimedWorkflowStep } from "@/domain/production-workflows";
import { ChannelResearchExecutor } from "./channel-research-executor";
import { evidenceBundleFixture, qaFixture, resultFixture } from "./research-fixtures.test-helper";
import type { ResearchUsageMeter } from "./research-usage";

const base: ClaimedWorkflowStep = {
  id: crypto.randomUUID(), ownerId: crypto.randomUUID(), workflowId: crypto.randomUUID(), runId: crypto.randomUUID(),
  workflowType: "CHANNEL_RESEARCH", definitionVersion: 1, stepKey: "retrieve-youtube-evidence", capability: "youtube-research",
  attemptCount: 1, maxAttempts: 3, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  input: { channelConcept: "Faceless investigations of hidden business systems" }, priorOutputs: {},
};

describe("CHANNEL_RESEARCH executor integration", () => {
  it("runs retrieval through finalization with independent QA and no unnecessary revision", async () => {
    const provider = { retrieve: vi.fn().mockResolvedValue(evidenceBundleFixture) };
    const model = {
      synthesize: vi.fn().mockResolvedValue({ result: resultFixture, usage: { model: "test", inputTokens: 100, outputTokens: 50, totalTokens: 150 } }),
      qa: vi.fn().mockResolvedValue({ qa: { score: 90, findings: [], recommendation: "accept" }, usage: qaFixture.modelUsage }),
    };
    const executor = new ChannelResearchExecutor(provider, model);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["retrieve-youtube-evidence", "draft-research", "initial-qa", "bounded-revision", "final-qa", "synthesize-validation"]) {
      outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    }
    expect(outputs["synthesize-validation"]).toEqual(resultFixture);
    expect(outputs["bounded-revision"]).toMatchObject({ attempted: false });
    expect(model.synthesize).toHaveBeenCalledTimes(1);
    expect(model.qa).toHaveBeenCalledTimes(2);
  });

  it("performs at most one bounded revision when initial QA reports a material problem", async () => {
    const provider = { retrieve: vi.fn().mockResolvedValue(evidenceBundleFixture) };
    const model = {
      synthesize: vi.fn().mockResolvedValue({ result: resultFixture, usage: { model: "test", inputTokens: 100, outputTokens: 50, totalTokens: 150 } }),
      qa: vi.fn()
        .mockResolvedValueOnce({ qa: { score: 40, findings: [{ severity: "error", code: "UNSUPPORTED_CLAIM", message: "Revise it.", evidenceIds: [] }], recommendation: "revise" }, usage: qaFixture.modelUsage })
        .mockResolvedValueOnce({ qa: { score: 90, findings: [], recommendation: "accept" }, usage: qaFixture.modelUsage }),
    };
    const executor = new ChannelResearchExecutor(provider, model);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["retrieve-youtube-evidence", "draft-research", "initial-qa", "bounded-revision", "final-qa", "synthesize-validation"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    expect(outputs["bounded-revision"]).toMatchObject({ attempted: true });
    expect(model.synthesize).toHaveBeenCalledTimes(2);
    expect(model.qa).toHaveBeenCalledTimes(2);
  });

  it("charges the bounded automated revision to the same durable run meter", async () => {
    const provider = { retrieve: vi.fn().mockResolvedValue(evidenceBundleFixture) };
    const model = {
      synthesize: vi.fn().mockResolvedValue({ result: resultFixture, usage: { model: "test", inputTokens: 100, outputTokens: 50, totalTokens: 150 } }),
      qa: vi.fn()
        .mockResolvedValueOnce({ qa: { score: 60, findings: [{ severity: "error", code: "REVISE", message: "Revise.", evidenceIds: [] }], recommendation: "revise" }, usage: qaFixture.modelUsage })
        .mockResolvedValueOnce({ qa: { score: 90, findings: [], recommendation: "accept" }, usage: qaFixture.modelUsage }),
    };
    const reservation = { operationId: crypto.randomUUID(), status: "RESERVED" as const, idempotentReplay: false };
    const meter: ResearchUsageMeter = { ensure: vi.fn(), reserve: vi.fn().mockResolvedValue(reservation), finalize: vi.fn(), record: vi.fn() };
    const executor = new ChannelResearchExecutor(provider, model, meter);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["retrieve-youtube-evidence", "draft-research", "initial-qa", "bounded-revision", "final-qa"]) {
      outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    }
    expect(meter.reserve).toHaveBeenCalledWith({ key: "automated-revision", kind: "AUTOMATED_REVISION", reservation: { automatedRevisions: 1 } });
    expect(meter.finalize).toHaveBeenCalledWith(reservation, "SUCCEEDED", { automatedRevisions: 1 });
    expect(outputs["bounded-revision"]).toMatchObject({ attempted: true });
  });

  it.each([
    {
      name: "an evidence ID that was not retrieved",
      revise: () => ({
        ...resultFixture,
        recommendation: { ...resultFixture.recommendation, evidenceIds: ["yt:video:not-retrieved"] },
      }),
    },
    {
      name: "a strong topic-depth contradiction",
      revise: () => ({
        ...resultFixture,
        viability: {
          ...resultFixture.viability,
          hundredVideoPotential: { ...resultFixture.viability.hundredVideoPotential, verdict: "strong" as const },
        },
        contentPotential: { ...resultFixture.contentPotential, estimatedTopicDepth: null },
      }),
    },
  ])("retains a clean draft when the bounded revision introduces $name", async ({ revise }) => {
    const provider = { retrieve: vi.fn().mockResolvedValue(evidenceBundleFixture) };
    const model = {
      synthesize: vi.fn()
        .mockResolvedValueOnce({ result: resultFixture, usage: { model: "test", inputTokens: 100, outputTokens: 50, totalTokens: 150 } })
        .mockResolvedValueOnce({ result: revise(), usage: { model: "test", inputTokens: 120, outputTokens: 60, totalTokens: 180 } }),
      qa: vi.fn()
        .mockResolvedValueOnce({ qa: { score: 80, findings: [{ severity: "warning", code: "NEEDS_REFINEMENT", message: "Tighten the analysis.", evidenceIds: [] }], recommendation: "revise" }, usage: qaFixture.modelUsage })
        .mockResolvedValueOnce({ qa: { score: 90, findings: [], recommendation: "accept" }, usage: qaFixture.modelUsage }),
    };
    const executor = new ChannelResearchExecutor(provider, model);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["retrieve-youtube-evidence", "draft-research", "initial-qa", "bounded-revision", "final-qa", "synthesize-validation"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    expect(outputs["bounded-revision"]).toMatchObject({ attempted: true, result: resultFixture });
    expect(outputs["bounded-revision"]).toMatchObject({ reason: expect.stringContaining("discarded") });
    expect(outputs["synthesize-validation"]).toEqual(resultFixture);
  });

  it("fails closed before human review when final QA still has material errors", async () => {
    const provider = { retrieve: vi.fn().mockResolvedValue(evidenceBundleFixture) };
    const model = {
      synthesize: vi.fn().mockResolvedValue({ result: resultFixture, usage: { model: "test", inputTokens: 100, outputTokens: 50, totalTokens: 150 } }),
      qa: vi.fn().mockResolvedValue({ qa: { score: 20, findings: [{ severity: "error", code: "UNSUPPORTED_CLAIM", message: "Still unsupported.", evidenceIds: [] }], recommendation: "revise" }, usage: qaFixture.modelUsage }),
    };
    const executor = new ChannelResearchExecutor(provider, model);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["retrieve-youtube-evidence", "draft-research", "initial-qa", "bounded-revision", "final-qa"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    await expect(executor.execute({ ...base, stepKey: "synthesize-validation", priorOutputs: outputs })).rejects.toMatchObject({ code: "RESEARCH_QA_REJECTED", retryable: false });
  });

  it("fails closed when final QA has no errors but still does not accept the result", async () => {
    const provider = { retrieve: vi.fn().mockResolvedValue(evidenceBundleFixture) };
    const model = {
      synthesize: vi.fn().mockResolvedValue({ result: resultFixture, usage: { model: "test", inputTokens: 100, outputTokens: 50, totalTokens: 150 } }),
      qa: vi.fn()
        .mockResolvedValueOnce({ qa: { score: 80, findings: [], recommendation: "accept" }, usage: qaFixture.modelUsage })
        .mockResolvedValueOnce({ qa: { score: 65, findings: [{ severity: "warning", code: "EVIDENCE_COVERAGE_WEAK", message: "Coverage remains weak.", evidenceIds: [] }], recommendation: "human_review_required" }, usage: qaFixture.modelUsage }),
    };
    const executor = new ChannelResearchExecutor(provider, model);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["retrieve-youtube-evidence", "draft-research", "initial-qa", "bounded-revision", "final-qa"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    await expect(executor.execute({ ...base, stepKey: "synthesize-validation", priorOutputs: outputs })).rejects.toMatchObject({ code: "RESEARCH_QA_REJECTED" });
  });

  it("advances a passed final QA with warnings to explicit human review after the bounded revision is exhausted", async () => {
    const provider = { retrieve: vi.fn().mockResolvedValue(evidenceBundleFixture) };
    const model = {
      synthesize: vi.fn().mockResolvedValue({ result: resultFixture, usage: { model: "test", inputTokens: 100, outputTokens: 50, totalTokens: 150 } }),
      qa: vi.fn()
        .mockResolvedValueOnce({ qa: { score: 80, findings: [{ severity: "warning", code: "REFINE_DEMAND", message: "Refine demand wording.", evidenceIds: [] }], recommendation: "revise" }, usage: qaFixture.modelUsage })
        .mockResolvedValueOnce({ qa: { score: 85, findings: [{ severity: "warning", code: "LIMITED_SAMPLE", message: "Keep the sample limitation visible.", evidenceIds: [] }], recommendation: "revise" }, usage: qaFixture.modelUsage }),
    };
    const executor = new ChannelResearchExecutor(provider, model);
    const outputs: Record<string, unknown> = {};
    for (const stepKey of ["retrieve-youtube-evidence", "draft-research", "initial-qa", "bounded-revision", "final-qa", "synthesize-validation"]) outputs[stepKey] = await executor.execute({ ...base, stepKey, priorOutputs: { ...outputs } });
    expect(outputs["final-qa"]).toMatchObject({ passed: true, recommendation: "human_review_required" });
    expect(outputs["synthesize-validation"]).toEqual(resultFixture);
  });
});
