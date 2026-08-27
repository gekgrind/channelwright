import { describe, expect, it, vi } from "vitest";
import { getWorkflowDefinition, WORKFLOW_FINALIZER_STEP, type ClaimedWorkflowStep } from "@/domain/production-workflows";
import { ChannelVideoScriptExecutor, VideoScriptExecutionError } from "./video-script-executor";
import type { ApprovedBriefResolver } from "./approved-brief-resolver";
import type { VideoScriptModel } from "./video-script-model";
import type { ResearchUsageMeter } from "./research-usage";
import { viewerValueFixture } from "./content-fixtures.test-helper";
import {
  approvedVideoBriefArtifactFixture,
  scriptScopeFixture,
  videoScriptResultFixture,
} from "./video-script-fixtures.test-helper";

const OWNER = "11111111-1111-4111-8111-111111111111";
const usage = { model: "test", inputTokens: 10, outputTokens: 10, totalTokens: 20 };
const attribution = (role: string, provider: string, operation: string) =>
  ({ provider, model: `${provider}-model`, role, operation, invokedAt: "2026-08-16T10:00:00.000Z" }) as never;

function step(stepKey: string, priorOutputs: Record<string, unknown> = {}): ClaimedWorkflowStep {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    ownerId: OWNER,
    workflowId: "33333333-3333-4333-8333-333333333333",
    runId: "44444444-4444-4444-8444-444444444444",
    workflowType: "CHANNEL_VIDEO_SCRIPT",
    definitionVersion: 1,
    stepKey,
    capability: "test",
    attemptCount: 1,
    maxAttempts: 2,
    leaseToken: "55555555-5555-4555-8555-555555555555",
    leaseExpiresAt: "2026-08-16T11:00:00.000Z",
    input: {
      videoBriefWorkflowId: approvedVideoBriefArtifactFixture.reference.briefWorkflowId,
      videoBriefRunId: approvedVideoBriefArtifactFixture.reference.briefRunId,
      approvedVideoBriefReference: approvedVideoBriefArtifactFixture.reference,
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

const resolver = (overrides: Partial<ApprovedBriefResolver> = {}): ApprovedBriefResolver => ({
  resolve: vi.fn(async () => approvedVideoBriefArtifactFixture),
  ...overrides,
});

/** Generator on one provider, critic and QA on another: the intended split. */
function model(overrides: Partial<VideoScriptModel> = {}): VideoScriptModel {
  const script = videoScriptResultFixture();
  return {
    draftScript: vi.fn(async () => ({ value: script, usage, attribution: attribution("GENERATOR", "openai", "video_script_synthesis") })),
    critique: vi.fn(async () => ({
      value: { overallAssessment: "Keeps the promise and holds evidence discipline.", keepsPromise: true, evidenceDisciplineHeld: true, findings: [] },
      usage, attribution: attribution("CRITIC", "anthropic", "video_script_critique"),
    })),
    reviseScript: vi.fn(async () => ({ value: script, usage, attribution: attribution("REVISION", "openai", "video_script_revision") })),
    qa: vi.fn(async () => ({ value: { score: 92, recommendation: "accept" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_script_qa") })),
    routing: () => [],
    ...overrides,
  } as VideoScriptModel;
}

describe("CHANNEL_VIDEO_SCRIPT workflow definition", () => {
  it("registers the exact seven-step graph in dependency order", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_SCRIPT", 1);
    expect(definition.steps.map((s) => s.key)).toEqual([
      "validate-approved-brief", "draft-video-script", "initial-video-script-qa",
      "bounded-video-script-revision", "final-video-script-qa", "finalize-video-script", "review-video-script",
    ]);
    expect(definition.steps.at(-1)?.kind).toBe("APPROVAL");
    expect(definition.steps.filter((s) => s.kind === "APPROVAL")).toHaveLength(1);
  });

  it("names finalize-video-script as the canonical finalizer", () => {
    expect(WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_SCRIPT).toBe("finalize-video-script");
  });

  it("makes every step depend on its predecessor so no stage can be skipped", () => {
    const steps = getWorkflowDefinition("CHANNEL_VIDEO_SCRIPT", 1).steps;
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index].dependsOn).toEqual([steps[index - 1].key]);
    }
    expect(steps[0].dependsOn).toEqual([]);
  });
});

describe("video script executor", () => {
  it("refuses a step from a different workflow type", async () => {
    const executor = new ChannelVideoScriptExecutor(resolver(), model(), meter());
    await expect(executor.execute({ ...step("validate-approved-brief"), workflowType: "CHANNEL_RESEARCH" }))
      .rejects.toThrow(/different workflow type/);
  });

  it("re-resolves the authoritative upstream brief at the first step", async () => {
    const resolve = vi.fn(async () => approvedVideoBriefArtifactFixture);
    const executor = new ChannelVideoScriptExecutor(resolver({ resolve }), model(), meter());
    const output = await executor.execute(step("validate-approved-brief"));
    expect(resolve).toHaveBeenCalledWith(
      approvedVideoBriefArtifactFixture.reference.briefWorkflowId,
      approvedVideoBriefArtifactFixture.reference.briefRunId,
      approvedVideoBriefArtifactFixture.reference,
    );
    expect(output).toMatchObject({ scope: { briefTopicId: scriptScopeFixture.briefTopicId } });
  });

  it("fails closed when the resolver reports drift", async () => {
    const executor = new ChannelVideoScriptExecutor(
      resolver({ resolve: vi.fn(async () => { throw new VideoScriptExecutionError("UPSTREAM_BRIEF_INTEGRITY_MISMATCH", false, "drift"); }) }),
      model(), meter(),
    );
    await expect(executor.execute(step("validate-approved-brief"))).rejects.toThrow(/drift/);
  });

  it("requires the upstream artifact before any model step runs", async () => {
    const executor = new ChannelVideoScriptExecutor(resolver(), model(), meter());
    await expect(executor.execute(step("draft-video-script"))).rejects.toThrow(/WORKFLOW_CONTEXT_MISSING|Required prior output/);
  });

  it("stamps identity and provenance from the resolver, not from model output", async () => {
    const forged = videoScriptResultFixture();
    const executor = new ChannelVideoScriptExecutor(resolver(), model({
      draftScript: vi.fn(async () => ({
        value: {
          ...forged,
          upstreamVideoBrief: { ...forged.upstreamVideoBrief, finalQaScore: 100 },
          scriptScope: { ...forged.scriptScope, pillarId: "pillar:forged" },
        },
        usage, attribution: attribution("GENERATOR", "openai", "video_script_synthesis"),
      })) as never,
    }), meter());
    const draft = await executor.execute(step("draft-video-script", { "validate-approved-brief": approvedVideoBriefArtifactFixture })) as unknown as { result: typeof forged };
    expect(draft.result.upstreamVideoBrief).toEqual(approvedVideoBriefArtifactFixture.reference);
    expect(draft.result.scriptScope).toEqual(approvedVideoBriefArtifactFixture.scope);
  });

  describe("initial QA", () => {
    const priors = () => ({
      "validate-approved-brief": approvedVideoBriefArtifactFixture,
      "draft-video-script": { result: videoScriptResultFixture(), modelUsage: usage },
    });

    it("runs the critic and QA on a different provider than the generator", async () => {
      const executor = new ChannelVideoScriptExecutor(resolver(), model(), meter());
      const output = await executor.execute(step("initial-video-script-qa", priors())) as unknown as { crossModelReview: { generator: { provider: string }; critic: { provider: string } } };
      expect(output.crossModelReview.generator.provider).toBe("openai");
      expect(output.crossModelReview.critic.provider).toBe("anthropic");
    });

    it("records deterministic override when rules fail but the critic is silent", async () => {
      const bad = videoScriptResultFixture({ timing: { ...videoScriptResultFixture().timing, totalDurationSeconds: 999 } });
      const executor = new ChannelVideoScriptExecutor(resolver(), model(), meter());
      const output = await executor.execute(step("initial-video-script-qa", {
        "validate-approved-brief": approvedVideoBriefArtifactFixture,
        "draft-video-script": { result: bad, modelUsage: usage },
      })) as unknown as { qa: { passed: boolean }; crossModelReview: { outcome: string } };
      expect(output.qa.passed).toBe(false);
      expect(output.crossModelReview.outcome).toBe("OVERRIDDEN_BY_DETERMINISTIC_RULE");
    });

    it("cannot be rescued by an optimistic semantic score", async () => {
      const bad = videoScriptResultFixture({ timing: { ...videoScriptResultFixture().timing, totalDurationSeconds: 999 } });
      const executor = new ChannelVideoScriptExecutor(resolver(), model({
        qa: vi.fn(async () => ({ value: { score: 100, recommendation: "accept" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_script_qa") })) as never,
      }), meter());
      const output = await executor.execute(step("initial-video-script-qa", {
        "validate-approved-brief": approvedVideoBriefArtifactFixture,
        "draft-video-script": { result: bad, modelUsage: usage },
      })) as unknown as { qa: { passed: boolean } };
      expect(output.qa.passed).toBe(false);
    });
  });

  describe("bounded revision", () => {
    const withQa = (qa: Record<string, unknown>, result = videoScriptResultFixture()) => ({
      "validate-approved-brief": approvedVideoBriefArtifactFixture,
      "draft-video-script": { result, modelUsage: usage },
      "initial-video-script-qa": {
        qa: { passed: false, score: 60, findings: [], recommendation: "revise", deterministicChecksPassed: 34, deterministicChecksFailed: 0, modelUsage: usage, ...qa },
        crossModelReview: { generator: attribution("GENERATOR", "openai", "video_script_synthesis"), critic: attribution("CRITIC", "anthropic", "video_script_critique"), outcome: "CRITIC_RAISED_ISSUE", findings: [], summary: "Concerns." },
      },
    });

    it("skips revision entirely when QA found nothing material", async () => {
      const revise = vi.fn();
      const executor = new ChannelVideoScriptExecutor(resolver(), model({ reviseScript: revise as never }), meter());
      const output = await executor.execute(step("bounded-video-script-revision", withQa({ passed: true, score: 92, recommendation: "accept" }))) as unknown as { attempted: boolean };
      expect(output.attempted).toBe(false);
      expect(revise).not.toHaveBeenCalled();
    });

    it("treats a failing verdict with zero errors as material and reserves before the paid call", async () => {
      const usageMeter = meter();
      const executor = new ChannelVideoScriptExecutor(resolver(), model(), usageMeter);
      const output = await executor.execute(step("bounded-video-script-revision", withQa({}))) as unknown as { attempted: boolean };
      expect(output.attempted).toBe(true);
      expect(usageMeter.calls).toContain("reserve:video-script:automated-revision");
      expect(usageMeter.calls).toContain("finalize:SUCCEEDED");
    });

    it("settles conservatively on a provider failure", async () => {
      const usageMeter = meter();
      const executor = new ChannelVideoScriptExecutor(resolver(), model({
        reviseScript: vi.fn(async () => { throw new Error("provider exploded"); }) as never,
      }), usageMeter);
      await expect(executor.execute(step("bounded-video-script-revision", withQa({})))).rejects.toThrow(/provider exploded/);
      expect(usageMeter.calls.indexOf("reserve:video-script:automated-revision")).toBeLessThan(usageMeter.calls.indexOf("finalize:FAILED"));
    });

    it.each([
      "UPSTREAM_BRIEF_REFERENCE_CHANGED",
      "VIEWER_VALUE_GATE_REJECTED",
      "UNSUPPORTED_MONETARY_GUARANTEE",
      "FABRICATED_SEARCH_VOLUME",
      "VIEWER_VALUE_PROVENANCE_ALTERED",
    ])("fails closed without spending on %s", async (code) => {
      const usageMeter = meter();
      const revise = vi.fn();
      const executor = new ChannelVideoScriptExecutor(resolver(), model({ reviseScript: revise as never }), usageMeter);
      const priors = withQa({ findings: [{ severity: "error", code, message: "Blocking.", evidenceIds: [] }] });
      await expect(executor.execute(step("bounded-video-script-revision", priors))).rejects.toThrow(/cannot be resolved by automated revision/);
      expect(revise).not.toHaveBeenCalled();
      expect(usageMeter.calls).not.toContain("reserve:video-script:automated-revision");
    });

    it("keeps the safer pre-revision draft when the revision introduces a new error", async () => {
      const clean = videoScriptResultFixture();
      const broken = videoScriptResultFixture({ timing: { ...clean.timing, totalDurationSeconds: 999 } });
      const executor = new ChannelVideoScriptExecutor(resolver(), model({
        reviseScript: vi.fn(async () => ({ value: broken, usage, attribution: attribution("REVISION", "openai", "video_script_revision") })) as never,
      }), meter());
      const output = await executor.execute(step("bounded-video-script-revision", withQa({}, clean))) as unknown as {
        attempted: boolean; reason: string; result: { crossModelReview: { outcome: string } };
      };
      expect(output.attempted).toBe(true);
      expect(output.reason).toMatch(/discarded because it introduced deterministic errors: TIMING_MISMATCH/);
      expect(output.result.crossModelReview.outcome).toBe("OVERRIDDEN_BY_DETERMINISTIC_RULE");
    });
  });

  describe("finalization", () => {
    const priors = (qa: Record<string, unknown>) => ({
      "validate-approved-brief": approvedVideoBriefArtifactFixture,
      "draft-video-script": { result: videoScriptResultFixture(), modelUsage: usage },
      "initial-video-script-qa": { qa: { passed: true, score: 92, findings: [], recommendation: "accept", deterministicChecksPassed: 34, deterministicChecksFailed: 0, modelUsage: usage }, crossModelReview: { generator: attribution("GENERATOR", "openai", "video_script_synthesis"), critic: null, outcome: "AGREED", findings: [], summary: "Fine." } },
      "bounded-video-script-revision": { attempted: false, reason: "Nothing material.", result: videoScriptResultFixture(), modelUsage: { model: "none", inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      "final-video-script-qa": { qa: { passed: true, score: 92, findings: [], recommendation: "accept", deterministicChecksPassed: 34, deterministicChecksFailed: 0, modelUsage: usage, ...qa }, crossModelReview: { generator: attribution("GENERATOR", "openai", "video_script_synthesis"), critic: null, outcome: "AGREED", findings: [], summary: "Fine." } },
    });

    it("advances a passing script to human review and validates against the output schema", async () => {
      const executor = new ChannelVideoScriptExecutor(resolver(), model(), meter());
      const output = await executor.execute(step("finalize-video-script", priors({}))) as unknown as { workflowType: string };
      expect(output.workflowType).toBe("CHANNEL_VIDEO_SCRIPT");
      expect(getWorkflowDefinition("CHANNEL_VIDEO_SCRIPT", 1).outputSchema.parse(output)).toBeTruthy();
    });

    it("refuses to advance a script final QA rejected", async () => {
      const executor = new ChannelVideoScriptExecutor(resolver(), model(), meter());
      await expect(executor.execute(step("finalize-video-script", priors({ passed: false, recommendation: "revise" }))))
        .rejects.toThrow(/Final QA did not accept/);
    });

    it("blocks finalization when the final-stage Viewer Value floor requires revision (defect #2)", async () => {
      const reviseFloor = viewerValueFixture({
        contract: { ...viewerValueFixture().contract, differentiation: { verdict: "weak", rationale: "Thin.", evidenceIds: [] } },
        gate: "REVISE", gateReasons: ["Differentiation is weak."],
      });
      const stuck = videoScriptResultFixture({ viewerValue: reviseFloor });
      const executor = new ChannelVideoScriptExecutor(resolver(), model(), meter());
      // Final QA over a REVISE-floor result must not pass...
      const finalQa = await executor.execute(step("final-video-script-qa", {
        "validate-approved-brief": approvedVideoBriefArtifactFixture,
        "draft-video-script": { result: stuck, modelUsage: usage },
        "initial-video-script-qa": { qa: { passed: false, score: 60, findings: [], recommendation: "revise", deterministicChecksPassed: 36, deterministicChecksFailed: 1, modelUsage: usage }, crossModelReview: { generator: attribution("GENERATOR", "openai", "video_script_synthesis"), critic: null, outcome: "AGREED", findings: [], summary: "x" } },
        "bounded-video-script-revision": { attempted: true, reason: "tried", result: stuck, modelUsage: usage },
      })) as unknown as { qa: { passed: boolean; recommendation: string } };
      expect(finalQa.qa.passed).toBe(false);
      // ...and finalization must refuse to advance it to human review.
      await expect(executor.execute(step("finalize-video-script", {
        "validate-approved-brief": approvedVideoBriefArtifactFixture,
        "draft-video-script": { result: stuck, modelUsage: usage },
        "initial-video-script-qa": { qa: { passed: false, score: 60, findings: [], recommendation: "revise", deterministicChecksPassed: 36, deterministicChecksFailed: 1, modelUsage: usage }, crossModelReview: { generator: attribution("GENERATOR", "openai", "video_script_synthesis"), critic: null, outcome: "AGREED", findings: [], summary: "x" } },
        "bounded-video-script-revision": { attempted: true, reason: "tried", result: stuck, modelUsage: usage },
        "final-video-script-qa": finalQa,
      }))).rejects.toThrow(/Final QA did not accept/);
    });

    it("promotes a clean-but-improvable result to human review rather than looping", async () => {
      const executor = new ChannelVideoScriptExecutor(resolver(), model({
        qa: vi.fn(async () => ({ value: { score: 88, recommendation: "revise" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_script_qa") })) as never,
      }), meter());
      const output = await executor.execute(step("final-video-script-qa", {
        "validate-approved-brief": approvedVideoBriefArtifactFixture,
        "draft-video-script": { result: videoScriptResultFixture(), modelUsage: usage },
        "initial-video-script-qa": priors({})["initial-video-script-qa"],
        "bounded-video-script-revision": priors({})["bounded-video-script-revision"],
      })) as unknown as { qa: { recommendation: string } };
      expect(output.qa.recommendation).toBe("human_review_required");
    });
  });

  it("ensures the durable budget before doing any work", async () => {
    const usageMeter = meter();
    const executor = new ChannelVideoScriptExecutor(resolver(), model(), usageMeter);
    await executor.execute(step("validate-approved-brief"));
    expect(usageMeter.calls[0]).toBe("ensure");
  });

  it("fails closed before any work when generator and critic resolve to the same provider (defect #5)", async () => {
    const keys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_MODEL", "VIDEO_SCRIPT_GENERATOR_PROVIDER", "VIDEO_SCRIPT_CRITIC_PROVIDER"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      process.env.OPENAI_API_KEY = "o"; process.env.ANTHROPIC_API_KEY = "a"; process.env.OPENAI_MODEL = "one";
      process.env.VIDEO_SCRIPT_GENERATOR_PROVIDER = "openai"; process.env.VIDEO_SCRIPT_CRITIC_PROVIDER = "openai";
      // No injected model → the executor builds the env router and must reject the collapse.
      const executor = new ChannelVideoScriptExecutor(resolver(), undefined, meter());
      await expect(executor.execute(step("validate-approved-brief"))).rejects.toThrow(/different providers|independent/i);
    } finally {
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  });
});

describe("viewer value inheritance", () => {
  it("carries the upstream brief contract hash through unchanged", () => {
    const script = videoScriptResultFixture();
    expect(script.scriptScope.inheritedViewerValueProvenance.contractHash)
      .toBe(approvedVideoBriefArtifactFixture.scope.inheritedViewerValueProvenance.contractHash);
    expect(script.scriptScope.inheritedViewerValueProvenance.originStage).toBe("VIDEO_BRIEF");
  });

  it("produces its own stage assessment separate from the inherited provenance", () => {
    const script = videoScriptResultFixture({ viewerValue: viewerValueFixture({ gate: "PASS" }) });
    expect(script.viewerValue.gate).toBe("PASS");
    expect(script.viewerValue.contract.schemaVersion).toBe(1);
  });
});
