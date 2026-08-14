import {
  channelConceptValidationInputSchema,
  channelConceptValidationOutputSchema,
  type ChannelConceptValidationOutput,
  type ClaimedWorkflowStep,
} from "@/domain/production-workflows";

export interface WorkflowStepExecutor {
  execute(step: ClaimedWorkflowStep): Promise<unknown>;
}

type Criterion = ChannelConceptValidationOutput["contentDepth"];

function requirePrior<T>(step: ClaimedWorkflowStep, key: string): T {
  const value = step.priorOutputs[key];
  if (!value) throw new Error(`WORKFLOW_CONTEXT_MISSING:${key}`);
  return value as T;
}

export class ChannelConceptValidationExecutor implements WorkflowStepExecutor {
  async execute(step: ClaimedWorkflowStep) {
    const input = channelConceptValidationInputSchema.parse(step.input);
    if (step.stepKey === "assess-content-depth") {
      return {
        status: "NEEDS_EVIDENCE",
        conclusion: "The concept alone cannot establish that at least 100 distinct, faceless video opportunities exist.",
        evidenceRequired: ["A deduplicated topic inventory with at least 100 viable video premises", "A production-format check showing the topics can be made without an on-camera host"],
        suppliedSignals: [input.nicheContext ? `Niche context supplied: ${input.nicheContext}` : "No niche-depth evidence was supplied"],
      } satisfies Criterion;
    }
    if (step.stepKey === "assess-audience-demand") {
      return {
        status: "PROVIDER_DATA_REQUIRED",
        conclusion: "Current YouTube demand is intentionally unverified because no live market-data provider is connected to this workflow.",
        evidenceRequired: ["Current comparable-channel and video view data", "Recent publishing frequency and growth signals", "Search or recommendation demand evidence with retrieval timestamps"],
        suppliedSignals: [input.audienceContext ? `Audience hypothesis supplied: ${input.audienceContext}` : "No audience hypothesis was supplied"],
      } satisfies Criterion;
    }
    if (step.stepKey === "assess-monetization") {
      const paths = input.monetizationPaths ?? [];
      return {
        status: paths.length ? "PLAUSIBLE_HYPOTHESIS" : "NEEDS_HYPOTHESIS",
        conclusion: paths.length
          ? "The supplied monetization paths are hypotheses only; eligibility, demand, pricing, conversion, and margin remain unverified."
          : "No identifiable monetization path was supplied, so commercial viability cannot yet be assessed.",
        evidenceRequired: ["Named buyer and offer for each revenue path", "Eligibility and unit-economics assumptions", "Evidence of willingness to pay or sponsor demand"],
        suppliedSignals: paths.map((path) => `Operator-supplied path: ${path}`),
      } satisfies Criterion;
    }
    if (step.stepKey === "synthesize-validation") {
      const output = {
        schemaVersion: 1,
        workflowType: "CHANNEL_CONCEPT_VALIDATION",
        concept: input.proposedConcept,
        contentDepth: requirePrior<Criterion>(step, "assess-content-depth"),
        audienceDemand: requirePrior<Criterion>(step, "assess-audience-demand"),
        monetization: requirePrior<Criterion>(step, "assess-monetization"),
        recommendation: "RESEARCH_REQUIRED",
        providerBoundary: "NO_LIVE_YOUTUBE_OR_MARKET_PROVIDER_DATA",
        summary: "The concept is recorded as a candidate, not validated. Complete the named content-depth, current-demand, and monetization evidence work before making a go/no-go decision.",
      } as const;
      return channelConceptValidationOutputSchema.parse(output);
    }
    throw new Error(`WORKFLOW_STEP_NOT_SUPPORTED:${step.stepKey}`);
  }
}

