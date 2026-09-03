import { describe, expect, it, vi } from "vitest";
import { getWorkflowDefinition, WORKFLOW_FINALIZER_STEP, type ClaimedWorkflowStep } from "@/domain/production-workflows";
import { ChannelVideoPerformanceExecutor, VideoPerformanceExecutionError } from "./video-performance-executor";
import { channelVideoPerformanceConfig } from "./video-performance-config";
import {
  mergeVideoPerformanceQA,
  UNREVISABLE_VIDEO_PERFORMANCE_CODES,
} from "./video-performance-validation";
import type { ApprovedReleaseResolver } from "./approved-release-resolver";
import type { VideoPerformanceModel } from "./video-performance-model";
import type { ResearchUsageMeter } from "./research-usage";
import {
  approvedVideoReleaseArtifactFixture,
  approvedVideoReleaseReferenceFixture,
  channelVideoPerformanceResultFixture,
  operatorPerformanceSnapshotFixture,
  performanceScopeFixture,
} from "./video-performance-fixtures.test-helper";

const OWNER = "11111111-1111-4111-8111-111111111111";
const usage = { model: "test", inputTokens: 10, outputTokens: 10, totalTokens: 20 };
const attribution = (role: string, provider: string, operation: string) =>
  ({ provider, model: `${provider}-model`, role, operation, invokedAt: "2026-08-19T10:00:00.000Z" }) as never;

const SNAPSHOT = operatorPerformanceSnapshotFixture();

/** The record content a model returns: the full result fixture, minus the fields the executor re-stamps. */
const draftContent = (overrides: Record<string, unknown> = {}) => {
  const { measuredSnapshot, upstreamVideoRelease, performanceScope, crossModelReview, modelProvenance, ...content } =
    channelVideoPerformanceResultFixture();
  void measuredSnapshot; void upstreamVideoRelease; void performanceScope; void crossModelReview; void modelProvenance;
  return { ...content, ...overrides };
};

/** A deterministically-invalid record: the final title no longer matches the approved release. */
const brokenContent = () => draftContent({ source: { ...draftContent().source, finalTitle: "A title the release never carried" } });

function step(stepKey: string, priorOutputs: Record<string, unknown> = {}): ClaimedWorkflowStep {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    ownerId: OWNER,
    workflowId: "33333333-3333-4333-8333-333333333333",
    runId: "44444444-4444-4444-8444-444444444444",
    workflowType: "CHANNEL_VIDEO_PERFORMANCE",
    definitionVersion: 1,
    stepKey,
    capability: "test",
    attemptCount: 1,
    maxAttempts: 2,
    leaseToken: "55555555-5555-4555-8555-555555555555",
    leaseExpiresAt: "2026-08-19T11:00:00.000Z",
    input: {
      videoReleaseWorkflowId: approvedVideoReleaseReferenceFixture.releaseWorkflowId,
      videoReleaseRunId: approvedVideoReleaseReferenceFixture.releaseRunId,
      performanceSnapshot: SNAPSHOT,
      approvedVideoReleaseReference: approvedVideoReleaseReferenceFixture,
    },
    priorOutputs,
  } as ClaimedWorkflowStep;
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

const resolver = (overrides: Partial<ApprovedReleaseResolver> = {}): ApprovedReleaseResolver => ({
  resolve: vi.fn(async () => approvedVideoReleaseArtifactFixture),
  ...overrides,
});

/** Generator + reviser on one provider; the independent critic and QA on another. */
function model(overrides: Partial<VideoPerformanceModel> = {}): VideoPerformanceModel {
  return {
    draftRecord: vi.fn(async () => ({ value: draftContent(), usage, attribution: attribution("GENERATOR", "openai", "video_performance_synthesis") })),
    critique: vi.fn(async () => ({
      value: { overallAssessment: "Every conclusion follows from the operator's numbers.", conclusionsFollowFromData: true, noFabricatedBenchmarksOrPredictions: true, findings: [] },
      usage, attribution: attribution("CRITIC", "anthropic", "video_performance_critique"),
    })),
    reviseRecord: vi.fn(async () => ({ value: draftContent(), usage, attribution: attribution("REVISION", "openai", "video_performance_revision") })),
    qa: vi.fn(async () => ({ value: { score: 92, recommendation: "accept" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_performance_qa") })),
    routing: () => [],
    ...overrides,
  } as VideoPerformanceModel;
}

const cleanCrossModelReview = () => ({
  generator: attribution("GENERATOR", "openai", "video_performance_synthesis"),
  critic: attribution("CRITIC", "anthropic", "video_performance_critique"),
  outcome: "AGREED" as const,
  findings: [],
  summary: "No cross-model concern.",
});

// ---------------------------------------------------------------------------
// Workflow graph
// ---------------------------------------------------------------------------

describe("CHANNEL_VIDEO_PERFORMANCE workflow definition", () => {
  it("registers the exact seven-step graph in dependency order", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_PERFORMANCE", 1);
    expect(definition.steps.map((s) => s.key)).toEqual([
      "validate-approved-release", "draft-video-performance", "initial-video-performance-qa",
      "bounded-video-performance-revision", "final-video-performance-qa", "finalize-video-performance", "review-video-performance",
    ]);
    expect(definition.steps.at(-1)?.kind).toBe("APPROVAL");
    expect(definition.steps.filter((s) => s.kind === "APPROVAL")).toHaveLength(1);
  });

  it("names finalize-video-performance as the canonical finalizer", () => {
    expect(WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_PERFORMANCE).toBe("finalize-video-performance");
  });

  it("has exactly one bounded revision step so revision cannot recur inside the graph", () => {
    const steps = getWorkflowDefinition("CHANNEL_VIDEO_PERFORMANCE", 1).steps;
    expect(steps.filter((s) => s.capability === "video-performance-revision")).toHaveLength(1);
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index].dependsOn).toEqual([steps[index - 1].key]);
    }
  });
});

// ---------------------------------------------------------------------------
// Happy path — full lifecycle, chaining each step's real output forward
// ---------------------------------------------------------------------------

describe("video performance executor — happy path", () => {
  async function runLifecycle(m: VideoPerformanceModel) {
    const usageMeter = meter();
    const executor = new ChannelVideoPerformanceExecutor(resolver(), m, usageMeter);
    const priors: Record<string, unknown> = {};

    priors["validate-approved-release"] = await executor.execute(step("validate-approved-release"));
    priors["draft-video-performance"] = await executor.execute(step("draft-video-performance", priors));
    priors["initial-video-performance-qa"] = await executor.execute(step("initial-video-performance-qa", priors));
    priors["bounded-video-performance-revision"] = await executor.execute(step("bounded-video-performance-revision", priors));
    priors["final-video-performance-qa"] = await executor.execute(step("final-video-performance-qa", priors));
    const final = await executor.execute(step("finalize-video-performance", priors));
    return { final, priors, usageMeter };
  }

  it("draft → initial QA → no-op revision → final QA → finalize, deriving the record from the approved release", async () => {
    const m = model();
    const { final, priors } = await runLifecycle(m);
    const output = final as Record<string, unknown> & {
      workflowType: string;
      measuredSnapshot: unknown;
      upstreamVideoRelease: unknown;
      performanceScope: unknown;
      crossModelReview: { outcome: string; critic: { provider: string } | null };
      modelProvenance: Array<{ role: string; provider: string }>;
    };

    expect(output.workflowType).toBe("CHANNEL_VIDEO_PERFORMANCE");
    // Provenance and the operator snapshot are stamped by Channelwright verbatim.
    expect(output.measuredSnapshot).toEqual(SNAPSHOT);
    expect(output.upstreamVideoRelease).toEqual(approvedVideoReleaseReferenceFixture);
    expect(output.performanceScope).toEqual(performanceScopeFixture);
    expect(output.modelProvenance[0]).toMatchObject({ role: "GENERATOR", provider: "openai" });
    // Final record validates against the workflow's declared output schema.
    expect(getWorkflowDefinition("CHANNEL_VIDEO_PERFORMANCE", 1).outputSchema.parse(output)).toBeTruthy();
    // Independent critic reviewed it and agreed.
    expect(output.crossModelReview.outcome).toBe("AGREED");
    expect(output.crossModelReview.critic?.provider).toBe("anthropic");

    const initial = priors["initial-video-performance-qa"] as { qa: { passed: boolean }; crossModelReview: { generator: { provider: string }; critic: { provider: string } } };
    expect(initial.qa.passed).toBe(true);
    expect(initial.crossModelReview.generator.provider).toBe("openai");
    expect(initial.crossModelReview.critic.provider).toBe("anthropic");
  });

  it("does not call the reviser when the initial output already passes every blocking requirement", async () => {
    const m = model();
    const { priors } = await runLifecycle(m);
    expect(m.reviseRecord).not.toHaveBeenCalled();
    const revision = priors["bounded-video-performance-revision"] as { attempted: boolean; modelUsage: { model: string } };
    expect(revision.attempted).toBe(false);
    expect(revision.modelUsage.model).toBe("none");
  });

  it("reserves no automated-revision budget on the no-revision path", async () => {
    const { usageMeter } = await runLifecycle(model());
    expect(usageMeter.calls).not.toContain("reserve:video-performance:automated-revision");
  });

  it("re-resolves the authoritative upstream release at the first step with the request identity", async () => {
    const resolve = vi.fn(async () => approvedVideoReleaseArtifactFixture);
    const executor = new ChannelVideoPerformanceExecutor(resolver({ resolve }), model(), meter());
    await executor.execute(step("validate-approved-release"));
    expect(resolve).toHaveBeenCalledWith(
      approvedVideoReleaseReferenceFixture.releaseWorkflowId,
      approvedVideoReleaseReferenceFixture.releaseRunId,
      approvedVideoReleaseReferenceFixture,
    );
  });

  it("ensures the durable budget before doing any work", async () => {
    const usageMeter = meter();
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model(), usageMeter);
    await executor.execute(step("validate-approved-release"));
    expect(usageMeter.calls[0]).toBe("ensure");
  });
});

// ---------------------------------------------------------------------------
// Provenance / input immutability
// ---------------------------------------------------------------------------

describe("video performance executor — provenance immutability", () => {
  const priors = () => ({ "validate-approved-release": approvedVideoReleaseArtifactFixture });

  it("refuses a step from a different workflow type", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model(), meter());
    await expect(executor.execute({ ...step("validate-approved-release"), workflowType: "CHANNEL_RESEARCH" } as ClaimedWorkflowStep))
      .rejects.toThrow(/different workflow type/);
  });

  it("fails closed when the resolver reports upstream drift", async () => {
    const executor = new ChannelVideoPerformanceExecutor(
      resolver({ resolve: vi.fn(async () => { throw new VideoPerformanceExecutionError("UPSTREAM_RELEASE_INTEGRITY_MISMATCH", false, "reference drifted"); }) }),
      model(), meter(),
    );
    await expect(executor.execute(step("validate-approved-release"))).rejects.toThrow(/reference drifted/);
  });

  it("requires the upstream artifact before the draft step runs", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model(), meter());
    await expect(executor.execute(step("draft-video-performance"))).rejects.toThrow(/WORKFLOW_CONTEXT_MISSING|Required prior output/);
  });

  it("stamps snapshot, upstream reference, scope, cross-model review, and provenance from Channelwright — never model output", async () => {
    const forgedProvenance = [attribution("GENERATOR", "anthropic", "forged"), attribution("REVISION", "anthropic", "forged")];
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model({
      draftRecord: vi.fn(async () => ({
        value: {
          ...draftContent(),
          measuredSnapshot: operatorPerformanceSnapshotFixture({ sourceNote: "Forged snapshot the model tried to substitute." }),
          upstreamVideoRelease: { ...approvedVideoReleaseReferenceFixture, finalQaScore: 3 },
          performanceScope: { ...performanceScopeFixture, pillarId: "pillar:forged" },
          crossModelReview: cleanCrossModelReview(),
          modelProvenance: forgedProvenance,
        },
        usage, attribution: attribution("GENERATOR", "openai", "video_performance_synthesis"),
      })) as never,
    }), meter());

    const draft = await executor.execute(step("draft-video-performance", priors())) as unknown as { result: {
      measuredSnapshot: unknown; upstreamVideoRelease: unknown; performanceScope: unknown;
      crossModelReview: unknown; modelProvenance: unknown[];
    } };
    expect(draft.result.measuredSnapshot).toEqual(SNAPSHOT);
    expect(draft.result.upstreamVideoRelease).toEqual(approvedVideoReleaseReferenceFixture);
    expect(draft.result.performanceScope).toEqual(performanceScopeFixture);
    expect(draft.result.crossModelReview).toBeNull();
    expect(draft.result.modelProvenance).toEqual([attribution("GENERATOR", "openai", "video_performance_synthesis")]);
  });
});

// ---------------------------------------------------------------------------
// Initial QA merge safety & model-role independence
// ---------------------------------------------------------------------------

describe("video performance executor — initial QA", () => {
  const priors = (draftOverride?: Record<string, unknown>) => ({
    "validate-approved-release": approvedVideoReleaseArtifactFixture,
    "draft-video-performance": { result: channelVideoPerformanceResultFixture(draftOverride), modelUsage: usage },
  });

  it("runs the critic and QA on a different provider than the generator", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model(), meter());
    const out = await executor.execute(step("initial-video-performance-qa", priors())) as unknown as { crossModelReview: { generator: { provider: string }; critic: { provider: string } } };
    expect(out.crossModelReview.generator.provider).toBe("openai");
    expect(out.crossModelReview.critic.provider).toBe("anthropic");
  });

  it("records a deterministic override when rules fail but the critic is silent", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model(), meter());
    const out = await executor.execute(step("initial-video-performance-qa", priors({ source: { ...channelVideoPerformanceResultFixture().source, finalTitle: "Diverged title" } }))) as unknown as { qa: { passed: boolean }; crossModelReview: { outcome: string } };
    expect(out.qa.passed).toBe(false);
    expect(out.crossModelReview.outcome).toBe("OVERRIDDEN_BY_DETERMINISTIC_RULE");
  });

  it("cannot be rescued by an optimistic semantic score when deterministic rules fail", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model({
      qa: vi.fn(async () => ({ value: { score: 100, recommendation: "accept" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_performance_qa") })) as never,
    }), meter());
    const out = await executor.execute(step("initial-video-performance-qa", priors({ source: { ...channelVideoPerformanceResultFixture().source, releasePromise: "A promise the approved release never made at all." } }))) as unknown as { qa: { passed: boolean } };
    expect(out.qa.passed).toBe(false);
  });

  it("keeps a blocking critic verdict boolean through a full slate of non-blocking semantic findings (50-cap safety)", async () => {
    const manyInfo = Array.from({ length: 40 }, (_v, i) => ({ severity: "info" as const, code: `SEMANTIC_NOTE_${i}`, message: `Non-blocking note ${i}.`, evidenceIds: [] as string[] }));
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model({
      qa: vi.fn(async () => ({ value: { score: 100, recommendation: "accept" as const, findings: manyInfo }, usage, attribution: attribution("QA", "anthropic", "video_performance_qa") })) as never,
      critique: vi.fn(async () => ({
        value: { overallAssessment: "Recorded a rejection without an itemised finding.", conclusionsFollowFromData: false, noFabricatedBenchmarksOrPredictions: true, findings: [] },
        usage, attribution: attribution("CRITIC", "anthropic", "video_performance_critique"),
      })) as never,
    }), meter());
    const out = await executor.execute(step("initial-video-performance-qa", priors())) as unknown as { qa: { passed: boolean; findings: Array<{ code: string }> } };
    expect(out.qa.passed).toBe(false);
    expect(out.qa.findings.some((f) => f.code === "CRITIC_CONCLUSIONS_UNSUPPORTED")).toBe(true);
  });

  it("does not over-block: a clean draft with both critic verdict booleans true still passes", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model(), meter());
    const out = await executor.execute(step("initial-video-performance-qa", priors())) as unknown as { qa: { passed: boolean } };
    expect(out.qa.passed).toBe(true);
  });

  it("propagates a generator failure as a deterministic workflow failure", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model({
      draftRecord: vi.fn(async () => { throw new Error("generator exploded"); }) as never,
    }), meter());
    await expect(executor.execute(step("draft-video-performance", { "validate-approved-release": approvedVideoReleaseArtifactFixture })))
      .rejects.toThrow(/generator exploded/);
  });

  it("rejects a malformed model record rather than finalizing a partial artifact", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model({
      draftRecord: vi.fn(async () => ({ value: { ...draftContent(), kpiHypothesisOutcomes: [] }, usage, attribution: attribution("GENERATOR", "openai", "video_performance_synthesis") })) as never,
    }), meter());
    await expect(executor.execute(step("draft-video-performance", { "validate-approved-release": approvedVideoReleaseArtifactFixture })))
      .rejects.toThrow();
  });

  it.each([
    ["critique", { critique: vi.fn(async () => { throw new Error("critic exploded"); }) as never }],
    ["qa", { qa: vi.fn(async () => { throw new Error("qa exploded"); }) as never }],
  ])("propagates a %s failure at initial QA", async (_label, override) => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model(override), meter());
    await expect(executor.execute(step("initial-video-performance-qa", priors()))).rejects.toThrow(/exploded/);
  });
});

// ---------------------------------------------------------------------------
// Bounded revision & unrevisable short-circuit
// ---------------------------------------------------------------------------

describe("video performance executor — bounded revision", () => {
  const withQa = (qa: Record<string, unknown>, result = channelVideoPerformanceResultFixture()) => ({
    "validate-approved-release": approvedVideoReleaseArtifactFixture,
    "draft-video-performance": { result, modelUsage: usage },
    "initial-video-performance-qa": {
      qa: { passed: false, score: 55, findings: [], recommendation: "revise", deterministicChecksPassed: 44, deterministicChecksFailed: 0, modelUsage: usage, ...qa },
      crossModelReview: cleanCrossModelReview(),
    },
  });

  it("performs exactly one automated revision, reserving before the paid call and settling SUCCEEDED", async () => {
    const usageMeter = meter();
    const m = model();
    const executor = new ChannelVideoPerformanceExecutor(resolver(), m, usageMeter);
    const out = await executor.execute(step("bounded-video-performance-revision", withQa({ findings: [{ severity: "error", code: "SNAPSHOT_COVERAGE_OVERSTATED", message: "Overstated coverage.", evidenceIds: [] }] }))) as unknown as { attempted: boolean };
    expect(out.attempted).toBe(true);
    expect(m.reviseRecord).toHaveBeenCalledTimes(1);
    expect(usageMeter.calls.indexOf("reserve:video-performance:automated-revision"))
      .toBeLessThan(usageMeter.calls.indexOf("finalize:SUCCEEDED"));
  });

  it("settles the reservation conservatively when the reviser throws, and does not finalize", async () => {
    const usageMeter = meter();
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model({
      reviseRecord: vi.fn(async () => { throw new Error("reviser exploded"); }) as never,
    }), usageMeter);
    await expect(executor.execute(step("bounded-video-performance-revision", withQa({ recommendation: "revise" })))).rejects.toThrow(/reviser exploded/);
    expect(usageMeter.calls.indexOf("reserve:video-performance:automated-revision"))
      .toBeLessThan(usageMeter.calls.indexOf("finalize:FAILED"));
  });

  it("keeps the safer pre-revision draft when the revision introduces a new deterministic error", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model({
      reviseRecord: vi.fn(async () => ({ value: brokenContent(), usage, attribution: attribution("REVISION", "openai", "video_performance_revision") })) as never,
    }), meter());
    const out = await executor.execute(step("bounded-video-performance-revision", withQa({ recommendation: "revise" }))) as unknown as {
      attempted: boolean; reason: string; result: { crossModelReview: { outcome: string } };
    };
    expect(out.attempted).toBe(true);
    expect(out.reason).toMatch(/discarded because it introduced deterministic errors/);
    expect(out.result.crossModelReview.outcome).toBe("OVERRIDDEN_BY_DETERMINISTIC_RULE");
  });

  it.each([...UNREVISABLE_VIDEO_PERFORMANCE_CODES])("short-circuits before any spend on unrevisable code %s", async (code) => {
    const usageMeter = meter();
    const m = model();
    const executor = new ChannelVideoPerformanceExecutor(resolver(), m, usageMeter);
    const priors = withQa({ findings: [{ severity: "error", code, message: "Blocking integrity failure.", evidenceIds: [] }] });
    await expect(executor.execute(step("bounded-video-performance-revision", priors)))
      .rejects.toThrow(/cannot be resolved by automated revision/);
    expect(m.reviseRecord).not.toHaveBeenCalled();
    expect(usageMeter.calls).not.toContain("reserve:video-performance:automated-revision");
  });

  it("still revises for an ordinary (revisable) deterministic error code", async () => {
    const m = model();
    const executor = new ChannelVideoPerformanceExecutor(resolver(), m, meter());
    await executor.execute(step("bounded-video-performance-revision", withQa({ findings: [{ severity: "error", code: "SNAPSHOT_COVERAGE_OVERSTATED", message: "Overstated coverage.", evidenceIds: [] }] })));
    expect(m.reviseRecord).toHaveBeenCalledTimes(1);
  });

  it("fails an immutable-snapshot contradiction before any revision reservation (real deterministic path)", async () => {
    // Server-stamped snapshot with average view duration longer than the video —
    // a contradiction no revision of the model-authored record can repair.
    const badSnapshot = operatorPerformanceSnapshotFixture({
      videoDurationSeconds: 120,
      metrics: { ...operatorPerformanceSnapshotFixture().metrics, averageViewDurationSeconds: 240 },
    });
    const badDraft = () => channelVideoPerformanceResultFixture({ measuredSnapshot: badSnapshot });
    const withSnapshot = (s: ClaimedWorkflowStep) =>
      ({ ...s, input: { ...(s.input as Record<string, unknown>), performanceSnapshot: badSnapshot } }) as ClaimedWorkflowStep;

    const usageMeter = meter();
    const m = model();
    const executor = new ChannelVideoPerformanceExecutor(resolver(), m, usageMeter);

    const initial = await executor.execute(withSnapshot(step("initial-video-performance-qa", {
      "validate-approved-release": approvedVideoReleaseArtifactFixture,
      "draft-video-performance": { result: badDraft(), modelUsage: usage },
    }))) as unknown as { qa: { findings: Array<{ code: string }> } };
    expect(initial.qa.findings.map((f) => f.code)).toContain("SNAPSHOT_AVD_EXCEEDS_DURATION");

    await expect(executor.execute(withSnapshot(step("bounded-video-performance-revision", {
      "validate-approved-release": approvedVideoReleaseArtifactFixture,
      "draft-video-performance": { result: badDraft(), modelUsage: usage },
      "initial-video-performance-qa": initial,
    })))).rejects.toThrow(/cannot be resolved by automated revision/);
    expect(m.reviseRecord).not.toHaveBeenCalled();
    expect(usageMeter.calls).not.toContain("reserve:video-performance:automated-revision");
  });
});

// ---------------------------------------------------------------------------
// Final QA & finalize — the one revision is spent, nothing loops or silently finalizes
// ---------------------------------------------------------------------------

describe("video performance executor — final QA and finalize", () => {
  const base = () => ({
    "validate-approved-release": approvedVideoReleaseArtifactFixture,
    "draft-video-performance": { result: channelVideoPerformanceResultFixture(), modelUsage: usage },
    "initial-video-performance-qa": { qa: { passed: true, score: 90, findings: [], recommendation: "accept", deterministicChecksPassed: 44, deterministicChecksFailed: 0, modelUsage: usage }, crossModelReview: cleanCrossModelReview() },
  });
  const revisionPrior = (result = channelVideoPerformanceResultFixture(), attempted = true) => ({
    "bounded-video-performance-revision": { attempted, reason: attempted ? "One bounded revision was performed." : "Nothing material.", result, modelUsage: usage },
  });

  it("subjects the REVISED record — not the draft — to final deterministic QA", async () => {
    const revised = channelVideoPerformanceResultFixture({ source: { ...channelVideoPerformanceResultFixture().source, finalTitle: "A title introduced during revision" } });
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model(), meter());
    const out = await executor.execute(step("final-video-performance-qa", { ...base(), ...revisionPrior(revised) })) as unknown as { qa: { passed: boolean; findings: Array<{ code: string }> } };
    expect(out.qa.passed).toBe(false);
    expect(out.qa.findings.some((f) => f.code === "SOURCE_TITLE_MISMATCH")).toBe(true);
  });

  it("runs the independent critic on the revised record and lets a fresh critic finding block finalization", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model({
      critique: vi.fn(async () => ({
        value: {
          overallAssessment: "The revision overstated a hypothesis outcome.",
          conclusionsFollowFromData: false, noFabricatedBenchmarksOrPredictions: true, findings: [],
        },
        usage, attribution: attribution("CRITIC", "anthropic", "video_performance_critique"),
      })) as never,
    }), meter());
    const out = await executor.execute(step("final-video-performance-qa", { ...base(), ...revisionPrior() })) as unknown as { qa: { passed: boolean }; crossModelReview: { critic: { provider: string }; findings: unknown[] } };
    expect(out.qa.passed).toBe(false);
    expect(out.crossModelReview.critic.provider).toBe("anthropic");
    expect(out.crossModelReview.findings.length).toBeGreaterThan(0);
  });

  it("promotes a clean-but-still-improvable result to human review rather than looping for another revision", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model({
      qa: vi.fn(async () => ({ value: { score: 88, recommendation: "revise" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_performance_qa") })) as never,
    }), meter());
    const out = await executor.execute(step("final-video-performance-qa", { ...base(), ...revisionPrior() })) as unknown as { qa: { recommendation: string } };
    expect(out.qa.recommendation).toBe("human_review_required");
  });

  const finalizePriors = (finalQa: Record<string, unknown>) => ({
    ...base(),
    ...revisionPrior(),
    "final-video-performance-qa": { qa: { passed: true, score: 90, findings: [], recommendation: "accept", deterministicChecksPassed: 44, deterministicChecksFailed: 0, modelUsage: usage, ...finalQa }, crossModelReview: cleanCrossModelReview() },
  });

  it("advances a passing record to human review and validates it against the output schema", async () => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model(), meter());
    const out = await executor.execute(step("finalize-video-performance", finalizePriors({}))) as unknown as { workflowType: string };
    expect(out.workflowType).toBe("CHANNEL_VIDEO_PERFORMANCE");
    expect(getWorkflowDefinition("CHANNEL_VIDEO_PERFORMANCE", 1).outputSchema.parse(out)).toBeTruthy();
  });

  it.each([
    ["a failed final QA", { passed: false, recommendation: "accept" }],
    ["a final QA still asking for revision", { passed: true, recommendation: "revise" }],
  ])("refuses to silently finalize on %s", async (_label, finalQa) => {
    const executor = new ChannelVideoPerformanceExecutor(resolver(), model(), meter());
    await expect(executor.execute(step("finalize-video-performance", finalizePriors(finalQa))))
      .rejects.toThrow(/Final QA did not accept/);
  });
});

// ---------------------------------------------------------------------------
// mergeVideoPerformanceQA — the 50-finding cap can never flip a fail to a pass
// ---------------------------------------------------------------------------

describe("mergeVideoPerformanceQA — blocking findings survive the 50-finding cap", () => {
  const info = (n: number) => ({ severity: "info" as const, code: `INFO_${n}`, message: `Non-blocking ${n}.`, evidenceIds: [] as string[] });
  const blockingCritic = { severity: "error" as const, code: "CRITIC_CONCLUSIONS_UNSUPPORTED", message: "A conclusion does not follow from the operator's numbers.", evidenceIds: [] as string[] };
  const accept = { score: 100, recommendation: "accept" as const, findings: [] as Array<ReturnType<typeof info>> };

  it("keeps a blocking critic error and fails the verdict when total findings exceed the cap", () => {
    const semantic = { ...accept, findings: Array.from({ length: 40 }, (_v, i) => info(i)) };
    const criticFindings = [...Array.from({ length: 11 }, (_v, i) => info(100 + i)), blockingCritic];
    const merged = mergeVideoPerformanceQA([], semantic, usage, approvedVideoReleaseArtifactFixture, criticFindings);
    expect(merged.findings.length).toBe(50);
    expect(merged.passed).toBe(false);
    expect(merged.recommendation).toBe("revise");
    expect(merged.findings.some((f) => f.code === "CRITIC_CONCLUSIONS_UNSUPPORTED")).toBe(true);
  });

  it("ranks errors ahead of the truncation boundary even when they arrive last", () => {
    const semantic = { ...accept, findings: Array.from({ length: 60 }, (_v, i) => info(i)) };
    const merged = mergeVideoPerformanceQA([], semantic, usage, approvedVideoReleaseArtifactFixture, [blockingCritic]);
    expect(merged.findings.length).toBe(50);
    expect(merged.findings[0].code).toBe("CRITIC_CONCLUSIONS_UNSUPPORTED");
    expect(merged.passed).toBe(false);
  });

  it("does not manufacture a failure: the same oversized slate with no error passes", () => {
    const semantic = { ...accept, findings: Array.from({ length: 60 }, (_v, i) => info(i)) };
    const merged = mergeVideoPerformanceQA([], semantic, usage, approvedVideoReleaseArtifactFixture, Array.from({ length: 12 }, (_v, i) => info(200 + i)));
    expect(merged.findings.length).toBe(50);
    expect(merged.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Model-role independence & accounting ceilings
// ---------------------------------------------------------------------------

describe("video performance executor — model-role independence", () => {
  const guardKeys = [
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_MODEL", "ANTHROPIC_MODEL",
    "VIDEO_PERFORMANCE_GENERATOR_PROVIDER", "VIDEO_PERFORMANCE_CRITIC_PROVIDER", "VIDEO_PERFORMANCE_REVISION_PROVIDER",
  ];
  const withEnv = async (overrides: Record<string, string>, fn: () => Promise<void>) => {
    const saved = Object.fromEntries(guardKeys.map((k) => [k, process.env[k]]));
    try {
      process.env.OPENAI_API_KEY = "o"; process.env.ANTHROPIC_API_KEY = "a";
      process.env.OPENAI_MODEL = "o1"; process.env.ANTHROPIC_MODEL = "a1";
      Object.assign(process.env, overrides);
      await fn();
    } finally {
      for (const k of guardKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  };

  it("fails closed before any work when the GENERATOR and CRITIC resolve to the same provider", async () => {
    await withEnv({ VIDEO_PERFORMANCE_GENERATOR_PROVIDER: "openai", VIDEO_PERFORMANCE_CRITIC_PROVIDER: "openai" }, async () => {
      const executor = new ChannelVideoPerformanceExecutor(resolver(), undefined, meter());
      await expect(executor.execute(step("validate-approved-release"))).rejects.toThrow(/different providers|independent/i);
    });
  });

  it("fails closed before any work when the REVISION author and the CRITIC resolve to the same provider", async () => {
    await withEnv({
      VIDEO_PERFORMANCE_GENERATOR_PROVIDER: "openai",
      VIDEO_PERFORMANCE_CRITIC_PROVIDER: "anthropic",
      VIDEO_PERFORMANCE_REVISION_PROVIDER: "anthropic",
    }, async () => {
      const executor = new ChannelVideoPerformanceExecutor(resolver(), undefined, meter());
      await expect(executor.execute(step("validate-approved-release"))).rejects.toThrow(/different providers|independent/i);
    });
  });
});

describe("video performance accounting ceilings", () => {
  const saved: Record<string, string | undefined> = {};
  const envKeys = [
    "VIDEO_PERFORMANCE_RECORD_OUTPUT_TOKENS", "VIDEO_PERFORMANCE_REVIEW_OUTPUT_TOKENS",
    "VIDEO_PERFORMANCE_MAX_AGGREGATE_OUTPUT_TOKENS", "VIDEO_PERFORMANCE_MODEL_MAX_OUTPUT_TOKENS",
  ];
  const clearEnv = () => { for (const k of envKeys) { saved[k] = process.env[k]; delete process.env[k]; } };
  const restoreEnv = () => { for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };

  it("keeps the worst-case retry graph inside the resolved aggregate output ceiling", () => {
    clearEnv();
    try {
      const budget = channelVideoPerformanceConfig();
      // 2 GENERATOR + 2 REVISION record ceilings, plus 8 review ceilings (initial + final QA, each critic + semantic, each retried once).
      const worstCase = 4 * budget.modelScriptOutputTokens + 8 * budget.modelReviewOutputTokens;
      expect(worstCase).toBeLessThanOrEqual(budget.maxAggregateOutputTokens);
      expect(budget.maxAggregateOutputTokens).toBeLessThanOrEqual(100_000);
      // The QA-call ceiling matches the structural worst case the graph can emit.
      expect(budget.maxAggregateQaCalls).toBeGreaterThanOrEqual(8);
      expect(budget.maxAggregateRevisionCalls).toBeGreaterThanOrEqual(2);
    } finally {
      restoreEnv();
    }
  });

  it("rejects an override combination whose retry graph would overrun the aggregate output budget", () => {
    clearEnv();
    try {
      process.env.VIDEO_PERFORMANCE_RECORD_OUTPUT_TOKENS = "20000";
      process.env.VIDEO_PERFORMANCE_REVIEW_OUTPUT_TOKENS = "8000";
      expect(() => channelVideoPerformanceConfig()).toThrow(/retry graph reserves/);
    } finally {
      restoreEnv();
    }
  });

  it("rejects the unsupported flat per-call output ceiling env var", () => {
    clearEnv();
    try {
      process.env.VIDEO_PERFORMANCE_MODEL_MAX_OUTPUT_TOKENS = "5000";
      expect(() => channelVideoPerformanceConfig()).toThrow(/not supported/);
    } finally {
      restoreEnv();
    }
  });
});
