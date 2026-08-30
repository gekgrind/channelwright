import { describe, expect, it, vi } from "vitest";
import { getWorkflowDefinition, WORKFLOW_FINALIZER_STEP, type ClaimedWorkflowStep } from "@/domain/production-workflows";
import { ChannelVideoPackagingExecutor, VideoPackagingExecutionError } from "./video-packaging-executor";
import type { ApprovedScriptResolver } from "./approved-script-resolver";
import type { VideoPackagingModel } from "./video-packaging-model";
import type { ResearchUsageMeter } from "./research-usage";
import { viewerValueFixture } from "./content-fixtures.test-helper";
import {
  approvedVideoScriptArtifactFixture,
  packagingScopeFixture,
  videoPackagingResultFixture,
} from "./video-packaging-fixtures.test-helper";

const OWNER = "11111111-1111-4111-8111-111111111111";
const usage = { model: "test", inputTokens: 10, outputTokens: 10, totalTokens: 20 };
const attribution = (role: string, provider: string, operation: string) =>
  ({ provider, model: `${provider}-model`, role, operation, invokedAt: "2026-08-17T10:00:00.000Z" }) as never;

/** A deterministically-invalid packaging: first chapter timing is not derived. */
const badPackaging = () => {
  const base = videoPackagingResultFixture();
  return videoPackagingResultFixture({ chapters: base.chapters.map((chapter, index) => index === 0 ? { ...chapter, startSeconds: 7 } : chapter) });
};

function step(stepKey: string, priorOutputs: Record<string, unknown> = {}): ClaimedWorkflowStep {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    ownerId: OWNER,
    workflowId: "33333333-3333-4333-8333-333333333333",
    runId: "44444444-4444-4444-8444-444444444444",
    workflowType: "CHANNEL_VIDEO_PACKAGING",
    definitionVersion: 1,
    stepKey,
    capability: "test",
    attemptCount: 1,
    maxAttempts: 2,
    leaseToken: "55555555-5555-4555-8555-555555555555",
    leaseExpiresAt: "2026-08-17T11:00:00.000Z",
    input: {
      videoScriptWorkflowId: approvedVideoScriptArtifactFixture.reference.scriptWorkflowId,
      videoScriptRunId: approvedVideoScriptArtifactFixture.reference.scriptRunId,
      approvedVideoScriptReference: approvedVideoScriptArtifactFixture.reference,
    },
    priorOutputs,
  };
}

function meter(): ResearchUsageMeter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ensure: vi.fn(async () => { calls.push("ensure"); }),
    reserve: vi.fn(async (input: { key: string }) => { calls.push(`reserve:${input.key}`); return { operationId: "op", status: "RESERVED" as const, idempotentReplay: false }; }),
    finalize: vi.fn(async (_r: unknown, status: string) => { calls.push(`finalize:${status}`); }),
  } as unknown as ResearchUsageMeter & { calls: string[] };
}

const resolver = (overrides: Partial<ApprovedScriptResolver> = {}): ApprovedScriptResolver => ({
  resolve: vi.fn(async () => approvedVideoScriptArtifactFixture),
  ...overrides,
});

/** Generator on one provider, critic and QA on another: the intended split. */
function model(overrides: Partial<VideoPackagingModel> = {}): VideoPackagingModel {
  const packaging = videoPackagingResultFixture();
  return {
    draftPackaging: vi.fn(async () => ({ value: packaging, usage, attribution: attribution("GENERATOR", "openai", "video_packaging_synthesis") })),
    critique: vi.fn(async () => ({
      value: { overallAssessment: "Keeps the promise and holds evidence discipline.", keepsPromise: true, evidenceDisciplineHeld: true, findings: [] },
      usage, attribution: attribution("CRITIC", "anthropic", "video_packaging_critique"),
    })),
    revisePackaging: vi.fn(async () => ({ value: packaging, usage, attribution: attribution("REVISION", "openai", "video_packaging_revision") })),
    qa: vi.fn(async () => ({ value: { score: 92, recommendation: "accept" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_packaging_qa") })),
    routing: () => [],
    ...overrides,
  } as VideoPackagingModel;
}

describe("CHANNEL_VIDEO_PACKAGING workflow definition", () => {
  it("registers the exact seven-step graph in dependency order", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_PACKAGING", 1);
    expect(definition.steps.map((s) => s.key)).toEqual([
      "validate-approved-script", "draft-video-packaging", "initial-video-packaging-qa",
      "bounded-video-packaging-revision", "final-video-packaging-qa", "finalize-video-packaging", "review-video-packaging",
    ]);
    expect(definition.steps.at(-1)?.kind).toBe("APPROVAL");
    expect(definition.steps.filter((s) => s.kind === "APPROVAL")).toHaveLength(1);
  });

  it("names finalize-video-packaging as the canonical finalizer", () => {
    expect(WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_PACKAGING).toBe("finalize-video-packaging");
  });

  it("makes every step depend on its predecessor so no stage can be skipped", () => {
    const steps = getWorkflowDefinition("CHANNEL_VIDEO_PACKAGING", 1).steps;
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index].dependsOn).toEqual([steps[index - 1].key]);
    }
    expect(steps[0].dependsOn).toEqual([]);
  });
});

describe("video packaging executor", () => {
  it("refuses a step from a different workflow type", async () => {
    const executor = new ChannelVideoPackagingExecutor(resolver(), model(), meter());
    await expect(executor.execute({ ...step("validate-approved-script"), workflowType: "CHANNEL_RESEARCH" }))
      .rejects.toThrow(/different workflow type/);
  });

  it("re-resolves the authoritative upstream script at the first step", async () => {
    const resolve = vi.fn(async () => approvedVideoScriptArtifactFixture);
    const executor = new ChannelVideoPackagingExecutor(resolver({ resolve }), model(), meter());
    const output = await executor.execute(step("validate-approved-script"));
    expect(resolve).toHaveBeenCalledWith(
      approvedVideoScriptArtifactFixture.reference.scriptWorkflowId,
      approvedVideoScriptArtifactFixture.reference.scriptRunId,
      approvedVideoScriptArtifactFixture.reference,
    );
    expect(output).toMatchObject({ scope: { scriptTopicId: packagingScopeFixture.scriptTopicId } });
  });

  it("fails closed when the resolver reports drift", async () => {
    const executor = new ChannelVideoPackagingExecutor(
      resolver({ resolve: vi.fn(async () => { throw new VideoPackagingExecutionError("UPSTREAM_SCRIPT_INTEGRITY_MISMATCH", false, "drift"); }) }),
      model(), meter(),
    );
    await expect(executor.execute(step("validate-approved-script"))).rejects.toThrow(/drift/);
  });

  it("requires the upstream artifact before any model step runs", async () => {
    const executor = new ChannelVideoPackagingExecutor(resolver(), model(), meter());
    await expect(executor.execute(step("draft-video-packaging"))).rejects.toThrow(/WORKFLOW_CONTEXT_MISSING|Required prior output/);
  });

  it("stamps identity and provenance from the resolver, not from model output", async () => {
    const forged = videoPackagingResultFixture();
    const executor = new ChannelVideoPackagingExecutor(resolver(), model({
      draftPackaging: vi.fn(async () => ({
        value: {
          ...forged,
          upstreamVideoScript: { ...forged.upstreamVideoScript, finalQaScore: 100 },
          packagingScope: { ...forged.packagingScope, pillarId: "pillar:forged" },
        },
        usage, attribution: attribution("GENERATOR", "openai", "video_packaging_synthesis"),
      })) as never,
    }), meter());
    const draft = await executor.execute(step("draft-video-packaging", { "validate-approved-script": approvedVideoScriptArtifactFixture })) as unknown as { result: typeof forged };
    expect(draft.result.upstreamVideoScript).toEqual(approvedVideoScriptArtifactFixture.reference);
    expect(draft.result.packagingScope).toEqual(approvedVideoScriptArtifactFixture.scope);
  });

  describe("initial QA", () => {
    const priors = () => ({
      "validate-approved-script": approvedVideoScriptArtifactFixture,
      "draft-video-packaging": { result: videoPackagingResultFixture(), modelUsage: usage },
    });

    it("runs the critic and QA on a different provider than the generator", async () => {
      const executor = new ChannelVideoPackagingExecutor(resolver(), model(), meter());
      const output = await executor.execute(step("initial-video-packaging-qa", priors())) as unknown as { crossModelReview: { generator: { provider: string }; critic: { provider: string } } };
      expect(output.crossModelReview.generator.provider).toBe("openai");
      expect(output.crossModelReview.critic.provider).toBe("anthropic");
    });

    it("records deterministic override when rules fail but the critic is silent", async () => {
      const executor = new ChannelVideoPackagingExecutor(resolver(), model(), meter());
      const output = await executor.execute(step("initial-video-packaging-qa", {
        "validate-approved-script": approvedVideoScriptArtifactFixture,
        "draft-video-packaging": { result: badPackaging(), modelUsage: usage },
      })) as unknown as { qa: { passed: boolean }; crossModelReview: { outcome: string } };
      expect(output.qa.passed).toBe(false);
      expect(output.crossModelReview.outcome).toBe("OVERRIDDEN_BY_DETERMINISTIC_RULE");
    });

    it("cannot be rescued by an optimistic semantic score", async () => {
      const executor = new ChannelVideoPackagingExecutor(resolver(), model({
        qa: vi.fn(async () => ({ value: { score: 100, recommendation: "accept" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_packaging_qa") })) as never,
      }), meter());
      const output = await executor.execute(step("initial-video-packaging-qa", {
        "validate-approved-script": approvedVideoScriptArtifactFixture,
        "draft-video-packaging": { result: badPackaging(), modelUsage: usage },
      })) as unknown as { qa: { passed: boolean } };
      expect(output.qa.passed).toBe(false);
    });
  });

  describe("bounded revision", () => {
    const withQa = (qa: Record<string, unknown>, result = videoPackagingResultFixture()) => ({
      "validate-approved-script": approvedVideoScriptArtifactFixture,
      "draft-video-packaging": { result, modelUsage: usage },
      "initial-video-packaging-qa": {
        qa: { passed: false, score: 60, findings: [], recommendation: "revise", deterministicChecksPassed: 32, deterministicChecksFailed: 0, modelUsage: usage, ...qa },
        crossModelReview: { generator: attribution("GENERATOR", "openai", "video_packaging_synthesis"), critic: attribution("CRITIC", "anthropic", "video_packaging_critique"), outcome: "CRITIC_RAISED_ISSUE", findings: [], summary: "Concerns." },
      },
    });

    it("skips revision entirely when QA found nothing material", async () => {
      const revise = vi.fn();
      const executor = new ChannelVideoPackagingExecutor(resolver(), model({ revisePackaging: revise as never }), meter());
      const output = await executor.execute(step("bounded-video-packaging-revision", withQa({ passed: true, score: 92, recommendation: "accept" }))) as unknown as { attempted: boolean };
      expect(output.attempted).toBe(false);
      expect(revise).not.toHaveBeenCalled();
    });

    it("treats a failing verdict with zero errors as material and reserves before the paid call", async () => {
      const usageMeter = meter();
      const executor = new ChannelVideoPackagingExecutor(resolver(), model(), usageMeter);
      const output = await executor.execute(step("bounded-video-packaging-revision", withQa({}))) as unknown as { attempted: boolean };
      expect(output.attempted).toBe(true);
      expect(usageMeter.calls).toContain("reserve:video-packaging:automated-revision");
      expect(usageMeter.calls).toContain("finalize:SUCCEEDED");
    });

    it("settles conservatively on a provider failure", async () => {
      const usageMeter = meter();
      const executor = new ChannelVideoPackagingExecutor(resolver(), model({
        revisePackaging: vi.fn(async () => { throw new Error("provider exploded"); }) as never,
      }), usageMeter);
      await expect(executor.execute(step("bounded-video-packaging-revision", withQa({})))).rejects.toThrow(/provider exploded/);
      expect(usageMeter.calls.indexOf("reserve:video-packaging:automated-revision")).toBeLessThan(usageMeter.calls.indexOf("finalize:FAILED"));
    });

    it.each([
      "UPSTREAM_SCRIPT_REFERENCE_CHANGED",
      "VIEWER_VALUE_GATE_REJECTED",
      "MISLEADING_PACKAGING_RISK",
      "FABRICATED_SEARCH_VOLUME",
      "VIEWER_VALUE_PROVENANCE_ALTERED",
    ])("fails closed without spending on %s", async (code) => {
      const usageMeter = meter();
      const revise = vi.fn();
      const executor = new ChannelVideoPackagingExecutor(resolver(), model({ revisePackaging: revise as never }), usageMeter);
      const priors = withQa({ findings: [{ severity: "error", code, message: "Blocking.", evidenceIds: [] }] });
      await expect(executor.execute(step("bounded-video-packaging-revision", priors))).rejects.toThrow(/cannot be resolved by automated revision/);
      expect(revise).not.toHaveBeenCalled();
      expect(usageMeter.calls).not.toContain("reserve:video-packaging:automated-revision");
    });

    it("keeps the safer pre-revision draft when the revision introduces a new error", async () => {
      const clean = videoPackagingResultFixture();
      const broken = badPackaging();
      const executor = new ChannelVideoPackagingExecutor(resolver(), model({
        revisePackaging: vi.fn(async () => ({ value: broken, usage, attribution: attribution("REVISION", "openai", "video_packaging_revision") })) as never,
      }), meter());
      const output = await executor.execute(step("bounded-video-packaging-revision", withQa({}, clean))) as unknown as {
        attempted: boolean; reason: string; result: { crossModelReview: { outcome: string } };
      };
      expect(output.attempted).toBe(true);
      expect(output.reason).toMatch(/discarded because it introduced deterministic errors: CHAPTER_TIMING_NOT_DERIVED/);
      expect(output.result.crossModelReview.outcome).toBe("OVERRIDDEN_BY_DETERMINISTIC_RULE");
    });
  });

  describe("finalization", () => {
    const priors = (qa: Record<string, unknown>) => ({
      "validate-approved-script": approvedVideoScriptArtifactFixture,
      "draft-video-packaging": { result: videoPackagingResultFixture(), modelUsage: usage },
      "initial-video-packaging-qa": { qa: { passed: true, score: 92, findings: [], recommendation: "accept", deterministicChecksPassed: 32, deterministicChecksFailed: 0, modelUsage: usage }, crossModelReview: { generator: attribution("GENERATOR", "openai", "video_packaging_synthesis"), critic: null, outcome: "AGREED", findings: [], summary: "Fine." } },
      "bounded-video-packaging-revision": { attempted: false, reason: "Nothing material.", result: videoPackagingResultFixture(), modelUsage: { model: "none", inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      "final-video-packaging-qa": { qa: { passed: true, score: 92, findings: [], recommendation: "accept", deterministicChecksPassed: 32, deterministicChecksFailed: 0, modelUsage: usage, ...qa }, crossModelReview: { generator: attribution("GENERATOR", "openai", "video_packaging_synthesis"), critic: null, outcome: "AGREED", findings: [], summary: "Fine." } },
    });

    it("advances a passing packaging to human review and validates against the output schema", async () => {
      const executor = new ChannelVideoPackagingExecutor(resolver(), model(), meter());
      const output = await executor.execute(step("finalize-video-packaging", priors({}))) as unknown as { workflowType: string };
      expect(output.workflowType).toBe("CHANNEL_VIDEO_PACKAGING");
      expect(getWorkflowDefinition("CHANNEL_VIDEO_PACKAGING", 1).outputSchema.parse(output)).toBeTruthy();
    });

    it("refuses to advance a packaging final QA rejected", async () => {
      const executor = new ChannelVideoPackagingExecutor(resolver(), model(), meter());
      await expect(executor.execute(step("finalize-video-packaging", priors({ passed: false, recommendation: "revise" }))))
        .rejects.toThrow(/Final QA did not accept/);
    });

    it("runs the independent critic on the REVISED artifact and lets it block finalization", async () => {
      const criticModel = model({
        critique: vi.fn(async () => ({
          value: {
            overallAssessment: "The revision slipped in a misleading title.",
            keepsPromise: true, evidenceDisciplineHeld: false,
            findings: [{ code: "MISLEADING_TITLE_INTRODUCED", severity: "error" as const, affectedField: "titleCandidates[0].text", rationale: "Title now overstates the outcome.", evidenceIds: [] }],
          },
          usage, attribution: attribution("CRITIC", "anthropic", "video_packaging_critique"),
        })) as never,
      });
      const executor = new ChannelVideoPackagingExecutor(resolver(), criticModel, meter());
      const finalQa = await executor.execute(step("final-video-packaging-qa", {
        "validate-approved-script": approvedVideoScriptArtifactFixture,
        "draft-video-packaging": { result: videoPackagingResultFixture(), modelUsage: usage },
        "initial-video-packaging-qa": { qa: { passed: true, score: 90, findings: [], recommendation: "accept", deterministicChecksPassed: 32, deterministicChecksFailed: 0, modelUsage: usage }, crossModelReview: { generator: attribution("GENERATOR", "openai", "video_packaging_synthesis"), critic: attribution("CRITIC", "anthropic", "video_packaging_critique"), outcome: "AGREED", findings: [], summary: "ok" } },
        "bounded-video-packaging-revision": { attempted: true, reason: "revised", result: videoPackagingResultFixture(), modelUsage: usage },
      })) as unknown as { qa: { passed: boolean }; crossModelReview: { critic: { provider: string }; findings: unknown[] } };
      expect(finalQa.qa.passed).toBe(false);
      expect(finalQa.crossModelReview.critic.provider).toBe("anthropic");
      expect(finalQa.crossModelReview.findings.length).toBeGreaterThan(0);
    });

    it("promotes a clean-but-improvable result to human review rather than looping", async () => {
      const executor = new ChannelVideoPackagingExecutor(resolver(), model({
        qa: vi.fn(async () => ({ value: { score: 88, recommendation: "revise" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_packaging_qa") })) as never,
      }), meter());
      const output = await executor.execute(step("final-video-packaging-qa", {
        "validate-approved-script": approvedVideoScriptArtifactFixture,
        "draft-video-packaging": { result: videoPackagingResultFixture(), modelUsage: usage },
        "initial-video-packaging-qa": priors({})["initial-video-packaging-qa"],
        "bounded-video-packaging-revision": priors({})["bounded-video-packaging-revision"],
      })) as unknown as { qa: { recommendation: string } };
      expect(output.qa.recommendation).toBe("human_review_required");
    });
  });

  it("ensures the durable budget before doing any work", async () => {
    const usageMeter = meter();
    const executor = new ChannelVideoPackagingExecutor(resolver(), model(), usageMeter);
    await executor.execute(step("validate-approved-script"));
    expect(usageMeter.calls[0]).toBe("ensure");
  });

  it("fails closed before any work when generator and critic resolve to the same provider", async () => {
    const keys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_MODEL", "VIDEO_PACKAGING_GENERATOR_PROVIDER", "VIDEO_PACKAGING_CRITIC_PROVIDER"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      process.env.OPENAI_API_KEY = "o"; process.env.ANTHROPIC_API_KEY = "a"; process.env.OPENAI_MODEL = "one";
      process.env.VIDEO_PACKAGING_GENERATOR_PROVIDER = "openai"; process.env.VIDEO_PACKAGING_CRITIC_PROVIDER = "openai";
      const executor = new ChannelVideoPackagingExecutor(resolver(), undefined, meter());
      await expect(executor.execute(step("validate-approved-script"))).rejects.toThrow(/different providers|independent/i);
    } finally {
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  });

  it("fails closed when the REVISION author and the critic resolve to the same provider", async () => {
    const keys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_MODEL", "ANTHROPIC_MODEL",
      "VIDEO_PACKAGING_GENERATOR_PROVIDER", "VIDEO_PACKAGING_CRITIC_PROVIDER", "VIDEO_PACKAGING_REVISION_PROVIDER"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      process.env.OPENAI_API_KEY = "o"; process.env.ANTHROPIC_API_KEY = "a";
      process.env.OPENAI_MODEL = "o1"; process.env.ANTHROPIC_MODEL = "a1";
      process.env.VIDEO_PACKAGING_GENERATOR_PROVIDER = "openai";
      process.env.VIDEO_PACKAGING_CRITIC_PROVIDER = "anthropic";
      process.env.VIDEO_PACKAGING_REVISION_PROVIDER = "anthropic";
      const executor = new ChannelVideoPackagingExecutor(resolver(), undefined, meter());
      await expect(executor.execute(step("validate-approved-script"))).rejects.toThrow(/different providers|independent/i);
    } finally {
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  });
});

describe("critic verdict booleans are non-overridable blockers even with zero findings", () => {
  const optimisticQa = () => ({ value: { score: 100, recommendation: "accept" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_packaging_qa") });
  const verdictCritic = (keepsPromise: boolean, evidenceDisciplineHeld: boolean) => ({
    value: { overallAssessment: "Verdict recorded without an itemized finding.", keepsPromise, evidenceDisciplineHeld, findings: [] },
    usage, attribution: attribution("CRITIC", "anthropic", "video_packaging_critique"),
  });
  const initial = (critique: unknown) => new ChannelVideoPackagingExecutor(resolver(), model({
    qa: vi.fn(async () => optimisticQa()) as never,
    critique: vi.fn(async () => critique) as never,
  }), meter()).execute(step("initial-video-packaging-qa", {
    "validate-approved-script": approvedVideoScriptArtifactFixture,
    "draft-video-packaging": { result: videoPackagingResultFixture(), modelUsage: usage },
  }));

  it("keepsPromise=false with no findings fails initial QA and surfaces a promise-broken error", async () => {
    const out = await initial(verdictCritic(false, true)) as unknown as { qa: { passed: boolean; findings: Array<{ code: string }> } };
    expect(out.qa.passed).toBe(false);
    expect(out.qa.findings.some((f) => f.code === "CRITIC_PROMISE_BROKEN")).toBe(true);
  });

  it("evidenceDisciplineHeld=false with no findings fails initial QA and surfaces an evidence-discipline error", async () => {
    const out = await initial(verdictCritic(true, false)) as unknown as { qa: { passed: boolean; findings: Array<{ code: string }> } };
    expect(out.qa.passed).toBe(false);
    expect(out.qa.findings.some((f) => f.code === "CRITIC_EVIDENCE_DISCIPLINE_FAILED")).toBe(true);
  });

  it("both verdicts true with no findings still passes (does not over-block)", async () => {
    const out = await initial(verdictCritic(true, true)) as unknown as { qa: { passed: boolean } };
    expect(out.qa.passed).toBe(true);
  });
});

describe("viewer value inheritance", () => {
  it("carries the upstream script contract hash through unchanged", () => {
    const packaging = videoPackagingResultFixture();
    expect(packaging.packagingScope.inheritedViewerValueProvenance.contractHash)
      .toBe(approvedVideoScriptArtifactFixture.scope.inheritedViewerValueProvenance.contractHash);
    expect(packaging.packagingScope.inheritedViewerValueProvenance.originStage).toBe("SCRIPT");
  });

  it("produces its own stage assessment separate from the inherited provenance", () => {
    const packaging = videoPackagingResultFixture({ viewerValue: viewerValueFixture({ gate: "PASS" }) });
    expect(packaging.viewerValue.gate).toBe("PASS");
    expect(packaging.viewerValue.contract.schemaVersion).toBe(1);
  });
});
