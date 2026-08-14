import {
  channelResearchInputSchema,
  channelResearchResultSchema,
  researchDraftSchema,
  researchEvidenceBundleSchema,
  researchQAResultSchema,
  researchRevisionSchema,
  type ChannelResearchResult,
  type ClaimedWorkflowStep,
  type ResearchEvidenceBundle,
} from "@/domain/production-workflows";
import { OpenAIResearchModel, type ResearchModel } from "./openai-research-model";
import { SupabaseResearchCache } from "./research-cache";
import { assertChannelResearchProviderConfig, channelResearchConfig } from "./research-config";
import { deterministicResearchValidation, mergeResearchQA } from "./research-validation";
import { YouTubeResearchProvider } from "./youtube-research-provider";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import type { WorkflowStepExecutor } from "./concept-validation-executor";

type EvidenceProvider = { retrieve(ownerId: string, input: ReturnType<typeof channelResearchInputSchema.parse>): Promise<ResearchEvidenceBundle> };

type DeterministicFinding = ReturnType<typeof deterministicResearchValidation>[number];

function errorFingerprint(finding: DeterministicFinding) {
  return `${finding.code}:${[...finding.evidenceIds].sort().join(",")}`;
}

function newlyIntroducedErrors(before: DeterministicFinding[], after: DeterministicFinding[]) {
  const existing = new Set(before.filter((finding) => finding.severity === "error").map(errorFingerprint));
  return after.filter((finding) => finding.severity === "error" && !existing.has(errorFingerprint(finding)));
}

function requirePrior<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T): T {
  const value = step.priorOutputs[key];
  if (!value) throw new ResearchExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${key} is missing.`);
  return parse(value);
}

export class ResearchExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

export class ChannelResearchExecutor implements WorkflowStepExecutor {
  constructor(private readonly provider?: EvidenceProvider, private readonly model?: ResearchModel, private readonly injectedUsageMeter?: ResearchUsageMeter) {}

  private dependencies(step: ClaimedWorkflowStep): { provider: EvidenceProvider; model: ResearchModel; usageMeter?: ResearchUsageMeter } {
    if (this.provider && this.model) return { provider: this.provider, model: this.model, usageMeter: this.injectedUsageMeter };
    const credentials = assertChannelResearchProviderConfig();
    const budget = channelResearchConfig();
    const usageMeter = new SupabaseResearchUsageMeter(step, budget);
    return {
      provider: this.provider ?? new YouTubeResearchProvider(credentials.youtubeApiKey, new SupabaseResearchCache(), budget, fetch, () => new Date(), usageMeter),
      model: this.model ?? new OpenAIResearchModel(credentials.openAiApiKey, credentials.openAiModel, budget, fetch, usageMeter, credentials.openAiQaModel),
      usageMeter,
    };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    console.info("channel_research_stage", { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_RESEARCH") throw new ResearchExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Research executor received a different workflow type.");
    const input = channelResearchInputSchema.parse(step.input);
    const { provider, model, usageMeter } = this.dependencies(step);
    await usageMeter?.ensure();
    if (step.stepKey === "retrieve-youtube-evidence") {
      const output = await provider.retrieve(step.ownerId, input);
      this.log(step, { provider: output.usage.provider, cacheStatus: output.usage.cacheStatus, providerRequestCount: output.usage.providerRequests, evidenceCount: output.evidence.length });
      return output;
    }
    const bundle = requirePrior(step, "retrieve-youtube-evidence", (value) => researchEvidenceBundleSchema.parse(value));
    if (step.stepKey === "draft-research") {
      const draft = await model.synthesize(input, bundle.evidence, undefined, bundle);
      const output = researchDraftSchema.parse({ result: draft.result, modelUsage: draft.usage });
      this.log(step, { aiInvocationCount: 1, model: output.modelUsage.model, totalTokens: output.modelUsage.totalTokens });
      return output;
    }
    const draft = requirePrior(step, "draft-research", (value) => researchDraftSchema.parse(value));
    if (step.stepKey === "initial-qa") {
      const deterministic = deterministicResearchValidation(draft.result, bundle.evidence, new Date(), bundle);
      const semantic = await model.qa(input, bundle.evidence, draft.result, deterministic, bundle);
      const output = mergeResearchQA(deterministic, semantic.qa, semantic.usage, bundle.evidence);
      this.log(step, { aiInvocationCount: 1, qaOutcome: output.recommendation, qaScore: output.score, findingCount: output.findings.length });
      return output;
    }
    const initialQa = requirePrior(step, "initial-qa", (value) => researchQAResultSchema.parse(value));
    if (step.stepKey === "bounded-revision") {
      const material = initialQa.findings.some((finding) => finding.severity === "error") || initialQa.recommendation === "revise";
      if (!material) {
        const output = researchRevisionSchema.parse({ attempted: false, reason: "Initial QA found no material error requiring automated revision.", result: draft.result, modelUsage: { model: "none", inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
        this.log(step, { revisionCount: 0, aiInvocationCount: 0 });
        return output;
      }
      const revisionReservation = await usageMeter?.reserve({ key: "automated-revision", kind: "AUTOMATED_REVISION", reservation: { automatedRevisions: 1 } });
      let revised: Awaited<ReturnType<ResearchModel["synthesize"]>>;
      try {
        revised = await model.synthesize(input, bundle.evidence, { result: draft.result, qa: initialQa }, bundle);
        if (revisionReservation) await usageMeter?.finalize(revisionReservation, "SUCCEEDED", { automatedRevisions: 1 });
      } catch (error) {
        if (revisionReservation) await usageMeter?.finalize(revisionReservation, "FAILED", { automatedRevisions: 1, failedOperations: 1 });
        throw error;
      }
      const draftValidation = deterministicResearchValidation(draft.result, bundle.evidence, new Date(), bundle);
      const revisedValidation = deterministicResearchValidation(revised.result, bundle.evidence, new Date(), bundle);
      const introducedErrors = newlyIntroducedErrors(draftValidation, revisedValidation);
      const revisionAccepted = introducedErrors.length === 0;
      const output = researchRevisionSchema.parse({
        attempted: true,
        reason: revisionAccepted
          ? "One bounded automated revision was performed in response to material QA findings."
          : `The bounded automated revision was discarded because it introduced deterministic errors: ${introducedErrors.map((finding) => finding.code).join(", ")}.`,
        result: revisionAccepted ? revised.result : draft.result,
        modelUsage: revised.usage,
      });
      this.log(step, {
        revisionCount: 1,
        revisionAccepted,
        introducedErrorCodes: introducedErrors.map((finding) => finding.code),
        aiInvocationCount: 1,
        totalTokens: output.modelUsage.totalTokens,
      });
      return output;
    }
    const revision = requirePrior(step, "bounded-revision", (value) => researchRevisionSchema.parse(value));
    if (step.stepKey === "final-qa") {
      const deterministic = deterministicResearchValidation(revision.result, bundle.evidence, new Date(), bundle);
      const semantic = await model.qa(input, bundle.evidence, revision.result, deterministic, bundle);
      const merged = mergeResearchQA(deterministic, semantic.qa, semantic.usage, bundle.evidence);
      const output = merged.passed && merged.recommendation === "revise"
        ? researchQAResultSchema.parse({ ...merged, recommendation: "human_review_required" })
        : merged;
      this.log(step, { aiInvocationCount: 1, qaOutcome: output.recommendation, qaScore: output.score, findingCount: output.findings.length });
      return output;
    }
    if (step.stepKey === "synthesize-validation") {
      const finalQa = requirePrior(step, "final-qa", (value) => researchQAResultSchema.parse(value));
      if (!finalQa.passed || finalQa.recommendation === "revise") {
        throw new ResearchExecutionError("RESEARCH_QA_REJECTED", false, "Final QA did not accept the research; no recommendation was advanced to human review.");
      }
      const output = channelResearchResultSchema.parse(revision.result) satisfies ChannelResearchResult;
      this.log(step, { humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: finalQa.score });
      return output;
    }
    throw new ResearchExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported research step ${step.stepKey}.`);
  }
}
