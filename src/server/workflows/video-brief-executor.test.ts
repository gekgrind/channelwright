import { describe, expect, it, vi } from "vitest";
import { getWorkflowDefinition, WORKFLOW_FINALIZER_STEP, type ClaimedWorkflowStep } from "@/domain/production-workflows";
import { ChannelVideoBriefExecutor, VideoBriefExecutionError } from "./video-brief-executor";
import type { ApprovedContentResolver } from "./approved-content-resolver";
import type { VideoBriefModel } from "./video-brief-model";
import type { ResearchUsageMeter } from "./research-usage";
import { viewerValueFixture } from "./content-fixtures.test-helper";
import {
  approvedContentArtifactFixture,
  selectionFixture,
  videoBriefResultFixture,
} from "./video-brief-fixtures.test-helper";

const OWNER = "11111111-1111-4111-8111-111111111111";
const usage = { model: "test", inputTokens: 10, outputTokens: 10, totalTokens: 20 };
const attribution = (role: string, provider: string, operation: string) =>
  ({ provider, model: `${provider}-model`, role, operation, invokedAt: "2026-08-15T10:00:00.000Z" }) as never;

function step(stepKey: string, priorOutputs: Record<string, unknown> = {}): ClaimedWorkflowStep {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    ownerId: OWNER,
    workflowId: "33333333-3333-4333-8333-333333333333",
    runId: "44444444-4444-4444-8444-444444444444",
    workflowType: "CHANNEL_VIDEO_BRIEF",
    definitionVersion: 1,
    stepKey,
    capability: "test",
    attemptCount: 1,
    maxAttempts: 2,
    leaseToken: "55555555-5555-4555-8555-555555555555",
    leaseExpiresAt: "2026-08-15T11:00:00.000Z",
    input: {
      contentIntelligenceWorkflowId: approvedContentArtifactFixture.reference.contentWorkflowId,
      contentIntelligenceRunId: approvedContentArtifactFixture.reference.contentRunId,
      approvedContentReference: approvedContentArtifactFixture.reference,
      selectedTopicId: selectionFixture.topicId,
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

/** Every step after design-viewer-promise carries it forward in priorOutputs. */
const promisePrior = () => {
  const brief = videoBriefResultFixture();
  return { design: { viewer: brief.viewer, viewerPromise: brief.viewerPromise }, attribution: attribution("GENERATOR", "openai", "video_brief_viewer_promise") };
};

const resolver = (overrides: Partial<ApprovedContentResolver> = {}): ApprovedContentResolver => ({
  resolve: vi.fn(async () => approvedContentArtifactFixture),
  ...overrides,
});

/** Generator on one provider, critic and QA on another: the intended split. */
function model(overrides: Partial<VideoBriefModel> = {}): VideoBriefModel {
  const brief = videoBriefResultFixture();
  return {
    designViewerPromise: vi.fn(async () => ({
      value: { viewer: brief.viewer, viewerPromise: brief.viewerPromise },
      usage, attribution: attribution("GENERATOR", "openai", "video_brief_viewer_promise"),
    })),
    buildBrief: vi.fn(async () => ({ value: brief, usage, attribution: attribution("GENERATOR", "openai", "video_brief_synthesis") })),
    critique: vi.fn(async () => ({
      value: { overallAssessment: "Coherent and worth producing.", worthProducing: true, promiseChallenged: false, findings: [] },
      usage, attribution: attribution("CRITIC", "anthropic", "video_brief_critique"),
    })),
    reviseBrief: vi.fn(async () => ({ value: brief, usage, attribution: attribution("REVISION", "openai", "video_brief_revision") })),
    qa: vi.fn(async () => ({
      value: { score: 92, recommendation: "accept" as const, findings: [] },
      usage, attribution: attribution("QA", "anthropic", "video_brief_qa"),
    })),
    routing: () => [],
    ...overrides,
  } as VideoBriefModel;
}

describe("CHANNEL_VIDEO_BRIEF workflow definition", () => {
  it("registers the exact eight-step graph in dependency order", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_BRIEF", 1);
    expect(definition.steps.map((s) => s.key)).toEqual([
      "validate-approved-content", "design-viewer-promise", "build-video-brief", "initial-video-brief-qa",
      "bounded-video-brief-revision", "final-video-brief-qa", "finalize-video-brief", "review-video-brief",
    ]);
    expect(definition.steps.at(-1)?.kind).toBe("APPROVAL");
    expect(definition.steps.filter((s) => s.kind === "APPROVAL")).toHaveLength(1);
  });

  it("names finalize-video-brief as the canonical finalizer", () => {
    expect(WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_BRIEF).toBe("finalize-video-brief");
  });

  it("makes every step depend on its predecessor so no stage can be skipped", () => {
    const steps = getWorkflowDefinition("CHANNEL_VIDEO_BRIEF", 1).steps;
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index].dependsOn).toEqual([steps[index - 1].key]);
    }
    expect(steps[0].dependsOn).toEqual([]);
  });
});

describe("video brief executor", () => {
  it("refuses a step from a different workflow type", async () => {
    const executor = new ChannelVideoBriefExecutor(resolver(), model(), meter());
    await expect(executor.execute({ ...step("validate-approved-content"), workflowType: "CHANNEL_RESEARCH" }))
      .rejects.toThrow(/different workflow type/);
  });

  it("re-resolves the authoritative upstream artifact at the first step", async () => {
    const resolve = vi.fn(async () => approvedContentArtifactFixture);
    const executor = new ChannelVideoBriefExecutor(resolver({ resolve }), model(), meter());
    const output = await executor.execute(step("validate-approved-content"));
    expect(resolve).toHaveBeenCalledWith(
      approvedContentArtifactFixture.reference.contentWorkflowId,
      approvedContentArtifactFixture.reference.contentRunId,
      selectionFixture.topicId,
      approvedContentArtifactFixture.reference,
    );
    expect(output).toMatchObject({ selection: { topicId: selectionFixture.topicId } });
  });

  it("fails closed when the resolver reports drift", async () => {
    const executor = new ChannelVideoBriefExecutor(
      resolver({ resolve: vi.fn(async () => { throw new VideoBriefExecutionError("UPSTREAM_CONTENT_INTEGRITY_MISMATCH", false, "drift"); }) }),
      model(), meter(),
    );
    await expect(executor.execute(step("validate-approved-content"))).rejects.toThrow(/drift/);
  });

  it("requires the upstream artifact before any model step runs", async () => {
    const executor = new ChannelVideoBriefExecutor(resolver(), model(), meter());
    await expect(executor.execute(step("design-viewer-promise"))).rejects.toThrow(/WORKFLOW_CONTEXT_MISSING|Required prior output/);
  });

  it("stamps identity and provenance from the resolver, not from model output", async () => {
    // A model that tries to substitute its own upstream reference and topic.
    const forged = videoBriefResultFixture();
    const executor = new ChannelVideoBriefExecutor(resolver(), model({
      buildBrief: vi.fn(async () => ({
        value: {
          ...forged,
          upstreamContentIntelligence: { ...forged.upstreamContentIntelligence, finalQaScore: 100 },
          selectedTopic: { ...forged.selectedTopic, backlogRank: 8 },
        },
        usage, attribution: attribution("GENERATOR", "openai", "video_brief_synthesis"),
      })) as never,
    }), meter());
    const priors = {
      "validate-approved-content": approvedContentArtifactFixture,
      "design-viewer-promise": { design: { viewer: forged.viewer, viewerPromise: forged.viewerPromise }, attribution: attribution("GENERATOR", "openai", "video_brief_viewer_promise") },
    };
    const draft = await executor.execute(step("build-video-brief", priors)) as unknown as { result: typeof forged };
    expect(draft.result.upstreamContentIntelligence).toEqual(approvedContentArtifactFixture.reference);
    expect(draft.result.selectedTopic).toEqual(approvedContentArtifactFixture.selection);
  });

  describe("initial QA", () => {
    const priors = () => ({
      "validate-approved-content": approvedContentArtifactFixture,
      "design-viewer-promise": promisePrior(),
      "build-video-brief": { result: videoBriefResultFixture(), modelUsage: usage },
    });

    it("runs the critic and QA on a different provider than the generator", async () => {
      const executor = new ChannelVideoBriefExecutor(resolver(), model(), meter());
      const output = await executor.execute(step("initial-video-brief-qa", priors())) as unknown as { crossModelReview: { generator: { provider: string }; critic: { provider: string } } };
      expect(output.crossModelReview.generator.provider).toBe("openai");
      expect(output.crossModelReview.critic.provider).toBe("anthropic");
    });

    it("drops critic evidence citations outside the approved bundle", async () => {
      const executor = new ChannelVideoBriefExecutor(resolver(), model({
        critique: vi.fn(async () => ({
          value: {
            overallAssessment: "Concerns.", worthProducing: true, promiseChallenged: true,
            findings: [{ code: "WEAK_PROOF", severity: "warning" as const, affectedField: "contentArchitecture", rationale: "Thin.", evidenceIds: ["yt:video:notreal"] }],
          },
          usage, attribution: attribution("CRITIC", "anthropic", "video_brief_critique"),
        })) as never,
      }), meter());
      const output = await executor.execute(step("initial-video-brief-qa", priors())) as unknown as { crossModelReview: { findings: Array<{ evidenceIds: string[] }> } };
      expect(output.crossModelReview.findings[0].evidenceIds).toEqual([]);
    });

    it("records deterministic override when rules fail but the critic is silent", async () => {
      const bad = videoBriefResultFixture({
        viewerPromise: { ...videoBriefResultFixture().viewerPromise, statement: "You will learn everything you need to know about scheduling." },
      });
      const executor = new ChannelVideoBriefExecutor(resolver(), model(), meter());
      const output = await executor.execute(step("initial-video-brief-qa", {
        "validate-approved-content": approvedContentArtifactFixture,
        "design-viewer-promise": promisePrior(),
        "build-video-brief": { result: bad, modelUsage: usage },
      })) as unknown as { qa: { passed: boolean }; crossModelReview: { outcome: string } };
      expect(output.qa.passed).toBe(false);
      expect(output.crossModelReview.outcome).toBe("OVERRIDDEN_BY_DETERMINISTIC_RULE");
    });

    it("cannot be rescued by an optimistic semantic score", async () => {
      const bad = videoBriefResultFixture({
        monetizationAlignment: { ...videoBriefResultFixture().monetizationAlignment, viewerValueImpact: "competes" },
      });
      const executor = new ChannelVideoBriefExecutor(resolver(), model({
        qa: vi.fn(async () => ({ value: { score: 100, recommendation: "accept" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_brief_qa") })) as never,
      }), meter());
      const output = await executor.execute(step("initial-video-brief-qa", {
        "validate-approved-content": approvedContentArtifactFixture,
        "design-viewer-promise": promisePrior(),
        "build-video-brief": { result: bad, modelUsage: usage },
      })) as unknown as { qa: { passed: boolean } };
      expect(output.qa.passed).toBe(false);
    });
  });

  describe("bounded revision", () => {
    const withQa = (qa: Record<string, unknown>, result = videoBriefResultFixture()) => ({
      "validate-approved-content": approvedContentArtifactFixture,
      "design-viewer-promise": promisePrior(),
      "build-video-brief": { result, modelUsage: usage },
      "initial-video-brief-qa": {
        qa: { passed: false, score: 60, findings: [], recommendation: "revise", deterministicChecksPassed: 28, deterministicChecksFailed: 0, modelUsage: usage, ...qa },
        crossModelReview: { generator: attribution("GENERATOR", "openai", "video_brief_synthesis"), critic: attribution("CRITIC", "anthropic", "video_brief_critique"), outcome: "CRITIC_RAISED_ISSUE", findings: [], summary: "Concerns." },
      },
    });

    it("skips revision entirely when QA found nothing material", async () => {
      const revise = vi.fn();
      const executor = new ChannelVideoBriefExecutor(resolver(), model({ reviseBrief: revise as never }), meter());
      const output = await executor.execute(step("bounded-video-brief-revision", withQa({ passed: true, score: 92, recommendation: "accept" }))) as unknown as { attempted: boolean };
      expect(output.attempted).toBe(false);
      expect(revise).not.toHaveBeenCalled();
    });

    it("treats a failing verdict with zero errors as material", async () => {
      const usageMeter = meter();
      const executor = new ChannelVideoBriefExecutor(resolver(), model(), usageMeter);
      const output = await executor.execute(step("bounded-video-brief-revision", withQa({}))) as unknown as { attempted: boolean };
      expect(output.attempted).toBe(true);
      expect(usageMeter.calls).toContain("reserve:video-brief:automated-revision");
      expect(usageMeter.calls).toContain("finalize:SUCCEEDED");
    });

    it("reserves before the paid call and settles conservatively on failure", async () => {
      const usageMeter = meter();
      const executor = new ChannelVideoBriefExecutor(resolver(), model({
        reviseBrief: vi.fn(async () => { throw new Error("provider exploded"); }) as never,
      }), usageMeter);
      await expect(executor.execute(step("bounded-video-brief-revision", withQa({})))).rejects.toThrow(/provider exploded/);
      expect(usageMeter.calls.indexOf("reserve:video-brief:automated-revision")).toBeLessThan(usageMeter.calls.indexOf("finalize:FAILED"));
    });

    it.each([
      "UPSTREAM_CONTENT_REFERENCE_CHANGED",
      "VIEWER_VALUE_GATE_REJECTED",
      "UNSUPPORTED_MONETARY_GUARANTEE",
      "FABRICATED_SEARCH_VOLUME",
      "VIEWER_VALUE_PROVENANCE_ALTERED",
    ])("fails closed without spending on %s", async (code) => {
      const usageMeter = meter();
      const revise = vi.fn();
      const executor = new ChannelVideoBriefExecutor(resolver(), model({ reviseBrief: revise as never }), usageMeter);
      const priors = withQa({ findings: [{ severity: "error", code, message: "Blocking.", evidenceIds: [] }] });
      await expect(executor.execute(step("bounded-video-brief-revision", priors))).rejects.toThrow(/cannot be resolved by automated revision/);
      expect(revise).not.toHaveBeenCalled();
      expect(usageMeter.calls).not.toContain("reserve:video-brief:automated-revision");
    });

    it("keeps the safer pre-revision draft when the revision introduces a new error", async () => {
      const clean = videoBriefResultFixture();
      // The reviser returns a brief that forges a beat claim it must not make.
      const broken = videoBriefResultFixture({
        contentArchitecture: {
          ...clean.contentArchitecture,
          beats: clean.contentArchitecture.beats.map((beat) =>
            beat.sectionId === "beat:model" ? { ...beat, claimIds: ["claim:no-gaps-guarantee"] } : beat),
        },
      });
      const executor = new ChannelVideoBriefExecutor(resolver(), model({
        reviseBrief: vi.fn(async () => ({ value: broken, usage, attribution: attribution("REVISION", "openai", "video_brief_revision") })) as never,
      }), meter());
      const output = await executor.execute(step("bounded-video-brief-revision", withQa({}, clean))) as unknown as {
        attempted: boolean; reason: string; result: { crossModelReview: { outcome: string } };
      };
      expect(output.attempted).toBe(true);
      expect(output.reason).toMatch(/discarded because it introduced deterministic errors: BEAT_USES_FORBIDDEN_CLAIM/);
      expect(output.result.crossModelReview.outcome).toBe("OVERRIDDEN_BY_DETERMINISTIC_RULE");
    });
  });

  describe("finalization", () => {
    const priors = (qa: Record<string, unknown>) => ({
      "validate-approved-content": approvedContentArtifactFixture,
      "design-viewer-promise": promisePrior(),
      "build-video-brief": { result: videoBriefResultFixture(), modelUsage: usage },
      "initial-video-brief-qa": { qa: { passed: true, score: 92, findings: [], recommendation: "accept", deterministicChecksPassed: 28, deterministicChecksFailed: 0, modelUsage: usage }, crossModelReview: { generator: attribution("GENERATOR", "openai", "video_brief_synthesis"), critic: null, outcome: "AGREED", findings: [], summary: "Fine." } },
      "bounded-video-brief-revision": { attempted: false, reason: "Nothing material.", result: videoBriefResultFixture(), modelUsage: { model: "none", inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      "final-video-brief-qa": { qa: { passed: true, score: 92, findings: [], recommendation: "accept", deterministicChecksPassed: 28, deterministicChecksFailed: 0, modelUsage: usage, ...qa }, crossModelReview: { generator: attribution("GENERATOR", "openai", "video_brief_synthesis"), critic: null, outcome: "AGREED", findings: [], summary: "Fine." } },
    });

    it("advances a passing brief to human review", async () => {
      const executor = new ChannelVideoBriefExecutor(resolver(), model(), meter());
      const output = await executor.execute(step("finalize-video-brief", priors({}))) as unknown as { workflowType: string };
      expect(output.workflowType).toBe("CHANNEL_VIDEO_BRIEF");
      expect(getWorkflowDefinition("CHANNEL_VIDEO_BRIEF", 1).outputSchema.parse(output)).toBeTruthy();
    });

    it("refuses to advance a brief final QA rejected", async () => {
      const executor = new ChannelVideoBriefExecutor(resolver(), model(), meter());
      await expect(executor.execute(step("finalize-video-brief", priors({ passed: false, recommendation: "revise" }))))
        .rejects.toThrow(/Final QA did not accept/);
    });

    it("promotes a clean-but-improvable result to human review rather than looping", async () => {
      const executor = new ChannelVideoBriefExecutor(resolver(), model({
        qa: vi.fn(async () => ({ value: { score: 88, recommendation: "revise" as const, findings: [] }, usage, attribution: attribution("QA", "anthropic", "video_brief_qa") })) as never,
      }), meter());
      const output = await executor.execute(step("final-video-brief-qa", {
        "validate-approved-content": approvedContentArtifactFixture,
        "design-viewer-promise": promisePrior(),
        "build-video-brief": { result: videoBriefResultFixture(), modelUsage: usage },
        "initial-video-brief-qa": priors({})["initial-video-brief-qa"],
        "bounded-video-brief-revision": priors({})["bounded-video-brief-revision"],
      })) as unknown as { qa: { recommendation: string } };
      expect(output.qa.recommendation).toBe("human_review_required");
    });
  });

  it("rejects an unknown step key", async () => {
    const executor = new ChannelVideoBriefExecutor(resolver(), model(), meter());
    await expect(executor.execute(step("invent-a-title", {
      "validate-approved-content": approvedContentArtifactFixture,
      "design-viewer-promise": promisePrior(),
      "build-video-brief": { result: videoBriefResultFixture(), modelUsage: usage },
      "initial-video-brief-qa": { qa: { passed: true, score: 92, findings: [], recommendation: "accept", deterministicChecksPassed: 28, deterministicChecksFailed: 0, modelUsage: usage }, crossModelReview: { generator: attribution("GENERATOR", "openai", "video_brief_synthesis"), critic: null, outcome: "AGREED", findings: [], summary: "Fine." } },
      "bounded-video-brief-revision": { attempted: false, reason: "Nothing material.", result: videoBriefResultFixture(), modelUsage: { model: "none", inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    })))
      .rejects.toThrow(/Unsupported video-brief step/);
  });

  it("ensures the durable budget before doing any work", async () => {
    const usageMeter = meter();
    const executor = new ChannelVideoBriefExecutor(resolver(), model(), usageMeter);
    await executor.execute(step("validate-approved-content"));
    expect(usageMeter.calls[0]).toBe("ensure");
  });
});

describe("viewer value inheritance", () => {
  it("carries the upstream contract hash through unchanged", () => {
    const brief = videoBriefResultFixture();
    expect(brief.selectedTopic.inheritedViewerValueProvenance.contractHash)
      .toBe(approvedContentArtifactFixture.selection.inheritedViewerValueProvenance.contractHash);
    expect(brief.selectedTopic.inheritedViewerValueProvenance.originStage).toBe("CONTENT_INTELLIGENCE");
  });

  it("produces its own stage assessment separate from the inherited provenance", () => {
    const brief = videoBriefResultFixture({ viewerValue: viewerValueFixture({ gate: "PASS" }) });
    expect(brief.viewerValue.gate).toBe("PASS");
    expect(brief.viewerValue.contract.schemaVersion).toBe(1);
  });
});
