import {
  approvedResearchArtifactSchema,
  channelStrategyInputSchema,
  channelStrategyResultSchema,
  strategyDraftSchema,
  strategyQAResultSchema,
  strategyRevisionSchema,
  type ApprovedResearchArtifact,
  type ChannelStrategyResult,
  type ClaimedWorkflowStep,
} from "@/domain/production-workflows";
import { SupabaseApprovedResearchResolver, type ApprovedResearchResolver } from "./approved-research-resolver";
import { findingFingerprint, logWorkflowStage, newlyIntroducedErrors, requirePriorOutput } from "./executor-support";
import { OpenAIStrategyModel, type StrategyModel } from "./openai-strategy-model";
import { SupabaseResearchUsageMeter, type ResearchUsageMeter } from "./research-usage";
import { assertChannelStrategyModelConfig, channelStrategyConfig } from "./strategy-config";
import { deterministicStrategyValidation, mergeStrategyQA } from "./strategy-validation";
import type { WorkflowStepExecutor } from "./concept-validation-executor";

const requirePrior = <T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T) =>
  requirePriorOutput(step, key, parse, (missing) => new StrategyExecutionError("WORKFLOW_CONTEXT_MISSING", false, `Required prior output ${missing} is missing.`));

export class StrategyExecutionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); }
}

export class ChannelStrategyExecutor implements WorkflowStepExecutor {
  constructor(
    private readonly injectedResolver?: ApprovedResearchResolver,
    private readonly injectedModel?: StrategyModel,
    private readonly injectedUsageMeter?: ResearchUsageMeter,
  ) {}

  private dependencies(step: ClaimedWorkflowStep) {
    const budget = channelStrategyConfig();
    const usageMeter = this.injectedUsageMeter ?? new SupabaseResearchUsageMeter(step, budget);
    if (this.injectedModel) return { resolver: this.injectedResolver ?? new SupabaseApprovedResearchResolver(), model: this.injectedModel, usageMeter };
    const config = assertChannelStrategyModelConfig();
    return {
      resolver: this.injectedResolver ?? new SupabaseApprovedResearchResolver(),
      model: new OpenAIStrategyModel(config.openAiApiKey, config.synthesisModel, config.qaModel, budget, fetch, usageMeter),
      usageMeter,
    };
  }

  private log(step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
    logWorkflowStage("channel_strategy_stage", step, detail);
  }

  async execute(step: ClaimedWorkflowStep) {
    if (step.workflowType !== "CHANNEL_STRATEGY") throw new StrategyExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, "Strategy executor received a different workflow type.");
    const input = channelStrategyInputSchema.parse(step.input);
    const { resolver, model, usageMeter } = this.dependencies(step);
    await usageMeter.ensure();
    if (step.stepKey === "validate-approved-research") {
      const output = approvedResearchArtifactSchema.parse(await resolver.resolve(input.researchWorkflowId, input.researchRunId, input.approvedResearchReference));
      this.log(step, { upstreamResearchRunId: output.reference.researchRunId, researchArtifactHash: output.reference.researchArtifactHash, finalQaScore: output.reference.finalQaScore });
      return output;
    }
    const upstream = requirePrior(step, "validate-approved-research", (value) => approvedResearchArtifactSchema.parse(value));
    if (step.stepKey === "draft-strategy") {
      const draft = await model.synthesize(input, upstream);
      const output = strategyDraftSchema.parse({ result: { ...draft.content, upstreamResearch: upstream.reference }, modelUsage: draft.usage });
      this.log(step, { aiInvocationCount: 1, model: output.modelUsage.model, totalTokens: output.modelUsage.totalTokens });
      return output;
    }
    const draft = requirePrior(step, "draft-strategy", (value) => strategyDraftSchema.parse(value));
    if (step.stepKey === "initial-strategy-qa") {
      const deterministic = deterministicStrategyValidation(draft.result, upstream);
      const semantic = await model.qa(input, upstream, draft.result, deterministic);
      const output = mergeStrategyQA(deterministic, semantic.qa, semantic.usage, upstream);
      this.log(step, { aiInvocationCount: 1, qaOutcome: output.recommendation, qaScore: output.score, findingCount: output.findings.length });
      return output;
    }
    const initialQa = requirePrior(step, "initial-strategy-qa", (value) => strategyQAResultSchema.parse(value));
    if (step.stepKey === "bounded-strategy-revision") {
      const material = initialQa.findings.some((finding) => finding.severity === "error") || initialQa.recommendation === "revise";
      if (!material) return strategyRevisionSchema.parse({ attempted: false, reason: "Initial strategy QA found no material error requiring automated revision.", result: draft.result, modelUsage: { model: "none", inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
      const reservation = await usageMeter.reserve({ key: "strategy:automated-revision", kind: "AUTOMATED_REVISION", reservation: { automatedRevisions: 1 } });
      let revised: Awaited<ReturnType<StrategyModel["synthesize"]>>;
      try {
        revised = await model.synthesize(input, upstream, { result: draft.result, qa: initialQa });
        await usageMeter.finalize(reservation, "SUCCEEDED", { automatedRevisions: 1 });
      } catch (error) {
        await usageMeter.finalize(reservation, "FAILED", { automatedRevisions: 1, failedOperations: 1 });
        throw error;
      }
      const candidate = channelStrategyResultSchema.parse({ ...revised.content, upstreamResearch: upstream.reference });
      const introduced = newlyIntroducedErrors(
        deterministicStrategyValidation(draft.result, upstream),
        deterministicStrategyValidation(candidate, upstream),
      ).map(findingFingerprint);
      const output = strategyRevisionSchema.parse({
        attempted: true,
        reason: introduced.length ? `The bounded strategy revision was discarded because it introduced deterministic errors: ${introduced.join(", ")}.` : "One bounded automated strategy revision was performed in response to material QA findings.",
        result: introduced.length ? draft.result : candidate,
        modelUsage: revised.usage,
      });
      this.log(step, { revisionCount: 1, revisionAccepted: introduced.length === 0, introducedErrors: introduced, totalTokens: output.modelUsage.totalTokens });
      return output;
    }
    const revision = requirePrior(step, "bounded-strategy-revision", (value) => strategyRevisionSchema.parse(value));
    if (step.stepKey === "final-strategy-qa") {
      const deterministic = deterministicStrategyValidation(revision.result, upstream);
      const semantic = await model.qa(input, upstream, revision.result, deterministic);
      const merged = mergeStrategyQA(deterministic, semantic.qa, semantic.usage, upstream);
      return merged.passed && merged.recommendation === "revise" ? strategyQAResultSchema.parse({ ...merged, recommendation: "human_review_required" }) : merged;
    }
    if (step.stepKey === "finalize-strategy") {
      const finalQa = requirePrior(step, "final-strategy-qa", (value) => strategyQAResultSchema.parse(value));
      if (!finalQa.passed || finalQa.recommendation === "revise") throw new StrategyExecutionError("STRATEGY_QA_REJECTED", false, "Final QA did not accept the strategy; no artifact was advanced to human review.");
      const output = channelStrategyResultSchema.parse(revision.result) satisfies ChannelStrategyResult;
      this.log(step, { humanReviewState: "WAITING_FOR_APPROVAL", finalQaScore: finalQa.score, upstreamResearchRunId: output.upstreamResearch.researchRunId });
      return output;
    }
    throw new StrategyExecutionError("WORKFLOW_STEP_NOT_SUPPORTED", false, `Unsupported strategy step ${step.stepKey}.`);
  }
}
