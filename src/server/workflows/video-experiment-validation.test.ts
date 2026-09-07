import { describe, expect, it } from "vitest";
import { videoExperimentRequestInputSchema, channelVideoExperimentResultSchema, experimentTypeSchema, type ChannelVideoExperimentResult } from "@/domain/production-workflows";
import { deterministicVideoExperimentValidation, videoExperimentQA, DETERMINISTIC_VIDEO_EXPERIMENT_RULES } from "./video-experiment-validation";
import { deriveVideoExperimentConstraints } from "./video-experiment-constraints";
import { deterministicVideoDecisionValidation } from "./video-decision-validation";
import {
  approvedVideoDecisionArtifactFixture,
  approvedVideoDiagnosisArtifactForExperimentFixture,
  channelVideoExperimentResultFixture,
  videoExperimentContentFixture,
} from "./video-experiment-fixtures.test-helper";

const clone = <T>(value: T): T => structuredClone(value);
const artifact = approvedVideoDecisionArtifactFixture;
const constraints = deriveVideoExperimentConstraints(artifact);

const validate = (result: ChannelVideoExperimentResult) => deterministicVideoExperimentValidation(result, artifact);
const codes = (result: ChannelVideoExperimentResult) => validate(result).map((item) => item.code);

/** A deterministically-clean SEQUENTIAL_COMPARISON manipulation experiment, for adversarial mutation. */
function manipulationResult(overrides: Partial<ChannelVideoExperimentResult["content"]["experiment"]> = {}): ChannelVideoExperimentResult {
  const base = videoExperimentContentFixture();
  return channelVideoExperimentResultFixture({
    content: {
      ...base,
      experiment: {
        ...base.experiment,
        experimentType: "SEQUENTIAL_COMPARISON",
        disposition: "RUN_COMPARISON",
        measurementOnly: false,
        controlCondition: { kind: "HISTORICAL_BASELINE", description: "The recent run of videos with the current opening.", comparability: "Same pillar, similar length and topic difficulty, adjacent publish period." },
        unitOfAssignment: "VIDEO",
        treatmentCondition: { description: "The next run of videos opens with the reworked promise framing.", whatChanges: "The opening promise framing.", whatStaysConstant: ["Topic selection", "video length band", "thumbnail style"] },
        heldConstant: ["Topic difficulty", "video length band", "publish cadence"],
        knownConfounders: [{ confounder: "Seasonal audience shifts between the baseline and treatment periods.", mitigation: "Compare like calendar weeks and note any platform-wide anomalies.", residualRisk: "MEDIUM" }],
        primaryMetric: { metric: "AVERAGE_PERCENTAGE_VIEWED", unit: "PERCENT", direction: "INCREASE", rationale: "Early percentage viewed is the closest signal to whether the reworked opening holds attention." },
        guardrailMetrics: [{ metric: "SURVEY_SATISFACTION", unit: "SCORE", protects: "Whether viewers feel the reworked opening was honest.", degradationSignal: "Qualitative feedback turns negative about the opening feeling padded or misleading." }],
        viewerValueGuardrails: ["The reworked opening must not pad or stall to inflate retention, and must not over-promise a payoff the video does not deliver."],
        rollbackPlan: { trigger: "The satisfaction guardrail degrades or the retention gain is driven by padding.", action: "Return to the original opening framing on subsequent videos.", reversibility: "EASILY_REVERSIBLE" },
        stoppingConditions: [
          "The satisfaction guardrail degrades during the treatment period.",
          "Retention rises but qualitative feedback indicates the opening feels padded or misleading.",
        ],
        ...overrides,
      },
      alternatives: [{ id: "alt:probe", experimentType: "OBSERVATIONAL_PROBE", statement: "Measure the current curve before reworking anything.", targetVariable: "Existing retention shape.", notSelectedBecause: "SLOWER_LEARNING", notSelectedReason: "A before/after answers the opening question directly." }],
      portfolioEligible: true,
    },
  });
}

describe("CHANNEL_VIDEO_EXPERIMENT fixture sanity", () => {
  it("builds on a deterministically-clean approved INVESTIGATE Decision", () => {
    expect(deterministicVideoDecisionValidation(artifact.decisionResult, approvedVideoDiagnosisArtifactForExperimentFixture)).toEqual([]);
    expect(artifact.reference.experimentEligible).toBe(true);
    expect(artifact.reference.decisionType).toBe("INVESTIGATE");
  });

  it("accepts the experiment fixture as-is with zero deterministic findings", () => {
    expect(validate(channelVideoExperimentResultFixture())).toEqual([]);
  });
});

describe("CHANNEL_VIDEO_EXPERIMENT contract", () => {
  it("accepts exactly the two-field request and rejects anything else", () => {
    expect(videoExperimentRequestInputSchema.safeParse({ videoDecisionWorkflowId: crypto.randomUUID(), videoDecisionRunId: crypto.randomUUID() }).success).toBe(true);
    expect(videoExperimentRequestInputSchema.safeParse({ videoDecisionWorkflowId: crypto.randomUUID() }).success).toBe(false);
    expect(videoExperimentRequestInputSchema.safeParse({ videoDecisionWorkflowId: crypto.randomUUID(), videoDecisionRunId: crypto.randomUUID(), extra: 1 }).success).toBe(false);
  });

  it("declares exactly the four-member experiment taxonomy", () => {
    expect(experimentTypeSchema.options).toEqual(["CONTROLLED_COMPARISON", "SEQUENTIAL_COMPARISON", "HOLDOUT_COMPARISON", "OBSERVATIONAL_PROBE"]);
  });

  it("rejects unknown top-level fields on the final result (strict schema)", () => {
    const result = channelVideoExperimentResultFixture() as unknown as Record<string, unknown>;
    expect(channelVideoExperimentResultSchema.safeParse({ ...result, extraField: true }).success).toBe(false);
  });

  it("has no asset-, endpoint-, sample-size-, or significance-carrying field anywhere in the schema shape", () => {
    const forbiddenKeys = ["publishAt", "scheduledAt", "videoFileUrl", "uploadToken", "youtubeVideoId", "sampleSize", "trafficSplit", "pValue", "confidenceInterval", "significanceLevel"];
    const serialized = JSON.stringify(channelVideoExperimentResultFixture());
    for (const key of forbiddenKeys) expect(serialized).not.toContain(key);
  });

  it("computes deterministicChecksPassed/Failed purely from RULES.length and distinct failed codes, never a literal", () => {
    const findings = validate(channelVideoExperimentResultFixture());
    const qa = videoExperimentQA(findings);
    const distinctFailed = new Set(findings.map((item) => item.code)).size;
    expect(qa.deterministicChecksFailed).toBe(distinctFailed);
    expect(qa.deterministicChecksPassed).toBe(DETERMINISTIC_VIDEO_EXPERIMENT_RULES.length - distinctFailed);
    expect(qa.deterministicChecksPassed + qa.deterministicChecksFailed).toBe(DETERMINISTIC_VIDEO_EXPERIMENT_RULES.length);
  });
});

describe("upstream integrity and projection tampering", () => {
  it("rejects a changed approved Decision reference", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.approvedVideoDecisionReference = { ...result.approvedVideoDecisionReference, decisionArtifactHash: "9".repeat(64) };
    expect(codes(result)).toContain("UPSTREAM_DECISION_REFERENCE_CHANGED");
  });

  it("rejects a changed experiment scope projection", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.experimentScope.facts.push({ key: "fact:injected", value: "x", sourceRef: "x" });
    expect(codes(result)).toContain("EXPERIMENT_SCOPE_CHANGED");
  });

  it("rejects a changed constraints projection", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.experimentConstraints = { ...result.experimentConstraints, evidenceStrength: "STRONG" };
    expect(codes(result)).toContain("EXPERIMENT_CONSTRAINTS_PROJECTION_CHANGED");
  });

  it("rejects altered Viewer Value provenance", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.viewerValueProvenance = { ...result.viewerValueProvenance, gate: "REVISE" };
    expect(codes(result)).toContain("VIEWER_VALUE_PROVENANCE_CHANGED");
  });

  it("rejects a drifted source identity", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.source = { ...result.source, subjectIdentity: "decision:forged" };
    expect(codes(result)).toContain("EXPERIMENT_SOURCE_CHANGED");
  });
});

describe("decision fidelity and eligibility", () => {
  it("rejects an experiment whose category diverges from the approved Decision", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.category = "RETENTION_STRUCTURE";
    expect(codes(result)).toContain("EXPERIMENT_CATEGORY_MISMATCH");
  });

  it("rejects a decisionLinkage that does not identify the exact Decision", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.decisionLinkage.decisionId = "decision:other";
    expect(codes(result)).toContain("EXPERIMENT_DECISION_LINKAGE_MISMATCH");
  });

  it("rejects prose that rewrites or overrides the approved Decision", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.hypothesis = "Actually the decision was wrong; we should preserve the current opening instead.";
    expect(codes(result)).toContain("DECISION_REWRITTEN");
  });

  it("rejects an experiment shape the approved decision type does not license", () => {
    const result = clone(channelVideoExperimentResultFixture());
    const restricted = { ...constraints, permittedExperimentTypes: ["CONTROLLED_COMPARISON" as const] };
    const found = deterministicVideoExperimentValidation(result, artifact, restricted).map((item) => item.code);
    expect(found).toContain("EXPERIMENT_TYPE_NOT_PERMITTED");
  });

  it("rejects a disagreed decision finding reused as experiment support", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.decisionDisagreements = [{ id: "disagreement:one", disputedElement: "SUPPORTING_FINDING", disputedFindingId: "diag:opening-promise-echo", objection: "The alignment inference is weaker than stated.", basis: "The supporting evidence is a single textual match." }];
    expect(codes(result)).toEqual(expect.arrayContaining(["DISAGREED_DECISION_ELEMENT_AS_BASIS"]));
  });

  it("rejects recorded disagreements paired with high design confidence", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.decisionDisagreements = [{ id: "disagreement:one", disputedElement: "REVERSIBILITY", disputedFindingId: null, objection: "The decision understates reversibility risk.", basis: "Opening changes are sticky once the audience adapts." }];
    result.content.experiment.confidenceInDesign = "high";
    expect(codes(result)).toContain("DISAGREEMENT_RAISES_CONFIDENCE");
  });
});

describe("lineage and citation fabrication", () => {
  it("rejects a supporting finding the approved Decision never cited", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.supportingDecisionFindingIds = ["diag:invented"];
    expect(codes(result)).toContain("EXPERIMENT_FINDING_NOT_FOUND");
  });

  it("rejects a constraining unknown outside the Decision's carried set", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.constrainingUnknownIds = [...result.content.experiment.constrainingUnknownIds, "unknown:invented"];
    expect(codes(result)).toContain("EXPERIMENT_UNKNOWN_NOT_FOUND");
  });

  it("rejects a duplicate id across the experiment and its alternatives", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.alternatives[0].id = result.content.experiment.id as `alt:${string}`;
    expect(codes(result)).toContain("DUPLICATE_EXPERIMENT_ID");
  });

  it("rejects a blocking critic finding with no cited evidence", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.crossModelReview.findings = [{ code: "CONFOUNDED", severity: "error", affectedField: "content.experiment", rationale: "Uncontrolled confounder.", evidenceRefs: [] }];
    result.crossModelReview.safeToFinalize = false;
    expect(codes(result)).toEqual(expect.arrayContaining(["CRITIC_EVIDENCE_NOT_FOUND", "CRITIC_REJECTED_EXPERIMENT"]));
  });
});

describe("epistemic discipline and fake precision", () => {
  it("rejects causal-certainty wording", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.hypothesis = "The current opening caused the early drop-off and definitively explains the weak retention.";
    expect(codes(result)).toContain("UNSUPPORTED_CAUSAL_CERTAINTY");
  });

  it("rejects any fabricated numeric quantity in the design prose", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.observationWindow.description = "Run for 28 days before reading the result.";
    expect(codes(result)).toContain("FABRICATED_QUANTITY_IN_DESIGN");
  });

  it("rejects fabricated statistical-significance claims", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.exposureRequirement.description = "Collect until the difference reaches statistical significance at the ninety-five percent level.";
    expect(codes(result)).toContain("FABRICATED_STATISTICAL_CLAIM");
  });

  it("rejects a fabricated sample size", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.exposureRequirement.caveat = "Do not read before a sample size of two thousand impressions.";
    expect(codes(result)).toContain("FABRICATED_SAMPLE_SIZE");
  });

  it("rejects a fabricated effect forecast", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.expectedDirection.justification = "We expect a lift of roughly twenty percent uplift in retention.";
    expect(codes(result)).toEqual(expect.arrayContaining(["FABRICATED_EFFECT_FORECAST"]));
  });
});

describe("causal interpretability and control", () => {
  it("rejects a control kind inconsistent with the experiment shape", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.controlCondition.kind = "SIMULTANEOUS_CONTROL";
    expect(codes(result)).toContain("CONTROL_KIND_MISMATCH");
  });

  it("rejects an observational probe that manipulates something", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.treatmentCondition.whatChanges = "Replace the opening with a colder hook.";
    result.content.experiment.unitOfAssignment = "VIDEO";
    expect(codes(result)).toContain("OBSERVATIONAL_PROBE_MANIPULATES");
  });

  it("rejects a comparison experiment with an indistinguishable treatment and control", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.experimentType = "SEQUENTIAL_COMPARISON";
    result.content.experiment.controlCondition.kind = "HISTORICAL_BASELINE";
    result.content.experiment.unitOfAssignment = "VIDEO";
    result.content.experiment.rollbackPlan = { trigger: "Guardrail breach.", action: "Restore the prior opening.", reversibility: "EASILY_REVERSIBLE" };
    result.content.experiment.heldConstant = ["topic", "length"];
    result.content.experiment.knownConfounders = [{ confounder: "Seasonality", mitigation: "Compare like weeks.", residualRisk: "LOW" }];
    result.content.experiment.treatmentCondition.description = "The recent baseline set of videos.";
    result.content.experiment.controlCondition.description = "The recent baseline set of videos.";
    result.content.experiment.treatmentCondition.whatChanges = "The recent baseline set of videos.";
    expect(codes(result)).toContain("CONTROL_TREATMENT_INDISTINGUISHABLE");
  });

  it("rejects a comparison experiment with no named confounder", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.experimentType = "SEQUENTIAL_COMPARISON";
    result.content.experiment.controlCondition.kind = "HISTORICAL_BASELINE";
    result.content.experiment.unitOfAssignment = "VIDEO";
    result.content.experiment.rollbackPlan = { trigger: "Guardrail breach.", action: "Restore the prior opening.", reversibility: "EASILY_REVERSIBLE" };
    result.content.experiment.heldConstant = ["topic", "length"];
    result.content.experiment.knownConfounders = [];
    expect(codes(result)).toContain("UNCONTROLLED_CONFOUNDER");
  });
});

describe("stopping, failure, invalidation, rollback", () => {
  it("rejects stopping conditions with no guardrail or Viewer Value trigger", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.stoppingConditions = ["The operator loses interest.", "A month passes."];
    expect(codes(result)).toContain("STOPPING_CONDITIONS_INCOHERENT");
  });

  it("rejects a manipulation experiment with no rollback plan", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.experimentType = "SEQUENTIAL_COMPARISON";
    result.content.experiment.controlCondition.kind = "HISTORICAL_BASELINE";
    result.content.experiment.unitOfAssignment = "VIDEO";
    result.content.experiment.heldConstant = ["topic"];
    result.content.experiment.knownConfounders = [{ confounder: "Seasonality", mitigation: "Compare like weeks.", residualRisk: "LOW" }];
    result.content.experiment.rollbackPlan = null;
    expect(codes(result)).toContain("ROLLBACK_PLAN_MISSING");
  });
});

describe("Viewer Value hard constraint", () => {
  it("rejects an inherited Viewer Value state that diverges from the Decision", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.viewerValueSafeguards.inheritedState = "AT_RISK";
    expect(codes(result)).toEqual(expect.arrayContaining(["VIEWER_VALUE_STATE_CHANGED"]));
  });

  it("rejects an acquisition primary metric with no independent viewer-benefit guardrail metric", () => {
    const result = manipulationResult();
    result.content.experiment.primaryMetric = { metric: "IMPRESSION_CLICK_THROUGH_RATE", unit: "PERCENT", direction: "INCREASE", rationale: "CTR is the acquisition lever under test." };
    result.content.experiment.guardrailMetrics = [{ metric: "IMPRESSIONS", unit: "COUNT", protects: "Reach.", degradationSignal: "Impressions collapse." }];
    result.content.experiment.viewerValueGuardrails = ["Keep the reach healthy across the window."];
    expect(codes(result)).toEqual(expect.arrayContaining(["NO_INDEPENDENT_VIEWER_BENEFIT_GUARDRAIL", "METRIC_GAMING_UNGUARDED"]));
  });

  it("rejects a forward-only sequential comparison when Viewer Value is AT_RISK", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.experimentType = "SEQUENTIAL_COMPARISON";
    const atRisk = { ...constraints, viewerValueState: "AT_RISK" as const, viewerValueEscalationRequired: true };
    expect(deterministicVideoExperimentValidation(result, artifact, atRisk).map((i) => i.code)).toContain("AT_RISK_REQUIRES_CONSERVATIVE_DESIGN");
  });

  it("caps design confidence when Viewer Value state is unknown", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.confidenceInDesign = "high";
    const unknown = { ...constraints, viewerValueState: "UNKNOWN" as const };
    expect(deterministicVideoExperimentValidation(result, artifact, unknown).map((i) => i.code)).toContain("VIEWER_VALUE_CONFIDENCE_CAP");
  });
});

describe("confidence entitlement", () => {
  it("rejects design confidence above the evidence-entitled ceiling", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.confidenceInDesign = "high";
    expect(codes(result)).toEqual(expect.arrayContaining(["DESIGN_CONFIDENCE_EXCEEDS_CEILING"]));
  });
});

describe("scope boundary", () => {
  it("rejects publishing / provider execution instructions", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.interpretationPlan.ifPrimaryUnfavorable = "Publish a corrected cut and send a notification to subscribers.";
    expect(codes(result)).toContain("EXPERIMENT_EXECUTION_LEAKED");
  });

  it("rejects cross-video / portfolio prioritization", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.knownUnknowns = ["How to prioritise experiments across the channel and build the experiment roadmap."];
    expect(codes(result)).toContain("PORTFOLIO_RESPONSIBILITY_LEAKED");
  });

  it("rejects channel-strategy / meta-learning work", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.knownUnknowns = ["Whether the channel strategy should pivot based on this result."];
    expect(codes(result)).toContain("INTELLIGENCE_RESPONSIBILITY_LEAKED");
  });
});

describe("derived-field tampering", () => {
  it("rejects a tampered disposition", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.disposition = "RUN_COMPARISON";
    expect(codes(result)).toContain("DISPOSITION_MISMATCH");
  });

  it("rejects a tampered measurementOnly flag", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.measurementOnly = false;
    expect(codes(result)).toContain("MEASUREMENT_ONLY_MISMATCH");
  });

  it("rejects a tampered evidenceStrength", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.evidenceStrength = "STRONG";
    expect(codes(result)).toContain("EVIDENCE_STRENGTH_MISMATCH");
  });

  it("rejects a tampered experimentReady flag", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experimentReady = false;
    expect(codes(result)).toContain("EXPERIMENT_READY_MISMATCH");
  });

  it("rejects a tampered portfolioEligible flag", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.portfolioEligible = true;
    expect(codes(result)).toContain("PORTFOLIO_ELIGIBILITY_MISMATCH");
  });
});

describe("alternatives and model authority", () => {
  it("rejects when no alternative proposes a genuinely different shape or target", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.alternatives = [{ ...result.content.alternatives[0], experimentType: "OBSERVATIONAL_PROBE", targetVariable: result.content.experiment.targetVariable }];
    expect(codes(result)).toContain("MISSING_ALTERNATIVE");
  });

  it("rejects an alternative with no rejection basis", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.alternatives[0].notSelectedReason = "   ";
    expect(codes(result)).toEqual(expect.arrayContaining(["ALTERNATIVE_NOT_REJECTED"]));
  });

  it("rejects a critic that did not clear the design", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.crossModelReview.safeToFinalize = false;
    expect(codes(result)).toContain("CRITIC_REJECTED_EXPERIMENT");
  });

  it("rejects a provider-collision in model provenance", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.modelProvenance[1] = { ...result.modelProvenance[1], provider: "openai" };
    expect(codes(result)).toContain("MODEL_PROVIDER_INDEPENDENCE_REQUIRED");
  });

  it("truncating the reported findings list cannot flip fail into pass", () => {
    const manyErrors = Array.from({ length: 60 }, (_, index) => ({ severity: "error" as const, code: `CODE_${index}`, message: "x", evidenceIds: [] }));
    const qa = videoExperimentQA(manyErrors);
    expect(qa.findings.length).toBe(50);
    expect(qa.passed).toBe(false);
    expect(qa.recommendation).toBe("revise");
  });
});

describe("adversarial matrix — independent-verification regressions", () => {
  it("sanity: the manipulation base result is deterministically clean", () => {
    expect(validate(manipulationResult())).toEqual([]);
  });

  // --- Viewer Value harms are metric-family independent, not acquisition-only ---
  it("flags retention gamed through promise mismatch", () => {
    const result = manipulationResult();
    result.content.experiment.primaryMetric = { metric: "AVERAGE_PERCENTAGE_VIEWED", unit: "PERCENT", direction: "INCREASE", rationale: "Retention is the target." };
    result.content.experiment.viewerValueGuardrails = ["Keep retention healthy across the treatment period."];
    expect(codes(result)).toContain("METRIC_GAMING_UNGUARDED");
  });
  it("flags watch time gamed through padding", () => {
    const result = manipulationResult();
    result.content.experiment.primaryMetric = { metric: "WATCH_TIME_HOURS", unit: "HOURS", direction: "INCREASE", rationale: "Watch time is the target." };
    result.content.experiment.guardrailMetrics = [{ metric: "VIEWS", unit: "COUNT", protects: "Reach.", degradationSignal: "Views fall." }];
    result.content.experiment.viewerValueGuardrails = ["Watch time should climb over the window."];
    expect(codes(result)).toEqual(expect.arrayContaining(["NO_INDEPENDENT_VIEWER_BENEFIT_GUARDRAIL", "METRIC_GAMING_UNGUARDED"]));
  });
  it("flags engagement gamed through outrage bait", () => {
    const result = manipulationResult();
    result.content.experiment.primaryMetric = { metric: "COMMENTS_RATE", unit: "RATIO", direction: "INCREASE", rationale: "Comment rate is the target." };
    result.content.experiment.viewerValueGuardrails = ["Comment volume should rise without spam."];
    expect(codes(result)).toContain("METRIC_GAMING_UNGUARDED");
  });
  it("flags conversion gamed at the expense of trust", () => {
    const result = manipulationResult();
    result.content.experiment.primaryMetric = { metric: "SUBSCRIBERS_GAINED", unit: "COUNT", direction: "INCREASE", rationale: "Subscriber conversion is the target." };
    result.content.experiment.viewerValueGuardrails = ["Subscriber conversion should improve."];
    expect(codes(result)).toContain("METRIC_GAMING_UNGUARDED");
  });

  // --- The approved Decision cannot be semantically rewritten ---
  it("flags an experiment whose stated purpose is to preserve the existing opening", () => {
    const result = manipulationResult();
    result.content.experiment.decisionLinkage.hypothesisUnderTest = "Preserve the existing opening and confirm the current approach is fine.";
    expect(codes(result)).toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
  });
  it("flags a tampered verbatim decision statement in the linkage", () => {
    const result = manipulationResult();
    result.content.experiment.decisionLinkage.testsDecisionStatement = "Keep the current opening exactly as it is.";
    expect(codes(result)).toContain("EXPERIMENT_DECISION_LINKAGE_MISMATCH");
  });

  // --- Fabricated quantities, spelled out or hyphenated ---
  it("flags a hyphenated fabricated duration", () => {
    const result = manipulationResult();
    result.content.experiment.observationWindow.description = "A 48-hour review window after each treatment upload.";
    expect(codes(result)).toContain("FABRICATED_QUANTITY_IN_DESIGN");
  });
  it("flags a spelled-out fabricated baseline", () => {
    const result = manipulationResult();
    result.content.experiment.primaryMetric.rationale = "Baseline retention is thirty percent and we want it higher.";
    expect(codes(result)).toContain("FABRICATED_QUANTITY_IN_DESIGN");
  });
  it("flags a spelled-out fabricated sample size", () => {
    const result = manipulationResult();
    result.content.experiment.exposureRequirement.description = "Read the result once a sample of forty viewers has been reached.";
    expect(codes(result)).toEqual(expect.arrayContaining(["FABRICATED_SAMPLE_SIZE"]));
  });

  // --- Ordinary label digits must NOT fail closed ---
  it("accepts bare label digits such as 'thumbnail variant 2' and 'Episode 7'", () => {
    const result = manipulationResult();
    result.content.experiment.knownUnknowns = ["Whether thumbnail variant 2 behaves differently on Episode 7 than on the pillar's other videos."];
    result.content.experiment.heldConstant = ["Topic difficulty", "thumbnail variant 2 styling", "publish cadence"];
    expect(codes(result)).not.toContain("FABRICATED_QUANTITY_IN_DESIGN");
    expect(validate(result)).toEqual([]);
  });

  // --- Internal semantic contradictions ---
  it("flags a confounder that is also held constant", () => {
    const result = manipulationResult();
    result.content.experiment.heldConstant = ["Seasonal audience shifts", "video length band"];
    result.content.experiment.knownConfounders = [{ confounder: "Seasonal audience shifts", mitigation: "Compare like weeks.", residualRisk: "MEDIUM" }];
    expect(codes(result)).toContain("CONFOUNDER_HELD_CONSTANT_CONTRADICTION");
  });
  it("flags a design that continues after a guardrail degrades", () => {
    const result = manipulationResult();
    result.content.experiment.stoppingConditions = [
      "The observation window ends.",
      "If the satisfaction guardrail degrades, continue the treatment regardless and keep collecting data.",
    ];
    expect(codes(result)).toContain("GUARDRAIL_PRECEDENCE_CONTRADICTED_IN_PROSE");
  });
  it("flags a rollback plan that continues the treatment instead of reverting it", () => {
    const result = manipulationResult();
    result.content.experiment.rollbackPlan = { trigger: "Guardrail breach.", action: "Keep the reworked opening in place and continue the treatment while we investigate.", reversibility: "EASILY_REVERSIBLE" };
    expect(codes(result)).toContain("ROLLBACK_DOES_NOT_REVERT");
  });
  it("flags an invalidation condition that can never trigger", () => {
    const result = manipulationResult();
    result.content.experiment.invalidationConditions = ["There is no condition that could invalidate this experiment; it is always interpretable."];
    expect(codes(result)).toContain("INVALIDATION_CONDITION_INCOHERENT");
  });
});

describe("adversarial matrix — round-2 independent-verification regressions", () => {
  it("sanity: the manipulation base result is deterministically clean", () => {
    expect(validate(manipulationResult())).toEqual([]);
  });

  // --- P1: Viewer Value treatment-mechanism safety is independent of the guardrail ---
  const compliantGuard = [
    "The reworked opening must not pad, stall, or add filler to inflate retention, must not withhold or delay the promised payoff, and must not use outrage bait or deceptive framing.",
  ];
  it("rejects a watch-time-padding treatment even with a compliant viewer-value guardrail", () => {
    const result = manipulationResult({
      treatmentCondition: { description: "Pad the video to increase watch time.", whatChanges: "Pad the video with extra recap so minutes viewed rises.", whatStaysConstant: ["Topic selection"] },
      viewerValueGuardrails: compliantGuard,
    });
    expect(codes(result)).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("rejects a promise-withholding retention treatment even with a compliant loyalty guardrail", () => {
    const result = manipulationResult({
      treatmentCondition: { description: "Withhold the promised answer to keep viewers watching.", whatChanges: "The opening withholds the promised answer until the final third.", whatStaysConstant: ["Topic selection"] },
      viewerValueGuardrails: compliantGuard,
    });
    expect(codes(result)).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("rejects an outrage-bait engagement treatment even with a compliant engagement guardrail", () => {
    const result = manipulationResult({
      primaryMetric: { metric: "COMMENTS_RATE", unit: "RATIO", direction: "INCREASE", rationale: "Comment rate is the target." },
      treatmentCondition: { description: "Use outrage bait in the hook to increase comments.", whatChanges: "The hook uses outrage bait to provoke anger.", whatStaysConstant: ["Topic selection"] },
      viewerValueGuardrails: ["The hook must not use outrage bait, rage-bait, or manufacture controversy to inflate comment volume."],
    });
    expect(codes(result)).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("rejects a trust-damaging conversion treatment even with a compliant guardrail", () => {
    const result = manipulationResult({
      primaryMetric: { metric: "SUBSCRIBERS_GAINED", unit: "COUNT", direction: "INCREASE", rationale: "Subscriber conversion is the target." },
      treatmentCondition: { description: "Add fake urgency and a deceptive framing to the end-card to boost subscribes.", whatChanges: "The end-card now uses fake urgency.", whatStaysConstant: ["Topic selection"] },
      viewerValueGuardrails: ["The conversion prompt must not use fake urgency, deceptive framing, or any trust-damaging tactic."],
    });
    expect(codes(result)).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("rejects independent paraphrases of the harm classes not copied from other tests", () => {
    const stretch = manipulationResult({ treatmentCondition: { description: "Stretch the runtime with filler to increase minutes viewed.", whatChanges: "Runtime is stretched with filler.", whatStaysConstant: ["Topic selection"] } });
    expect(codes(stretch)).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    const delay = manipulationResult({ treatmentCondition: { description: "Delay the answer viewers came for to improve retention.", whatChanges: "The answer is delayed to the final third.", whatStaysConstant: ["Topic selection"] } });
    expect(codes(delay)).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    const manufacture = manipulationResult({ hypothesis: "If we manufacture controversy unrelated to the topic, comment rate rises.", treatmentCondition: { description: "The hook manufactures controversy and whips up anger.", whatChanges: "The hook whips up anger.", whatStaysConstant: ["Topic selection"] } });
    expect(codes(manufacture)).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("does not flag safe interventions that merely mention retention / filler / pacing / the payoff", () => {
    const controls = [
      { description: "Tighten the opening so the promised value appears sooner.", whatChanges: "The opening is tightened so the promised value appears sooner.", whatStaysConstant: ["Topic selection"] },
      { description: "Remove low-value filler while measuring retention.", whatChanges: "Low-value filler is removed from the first minute.", whatStaysConstant: ["Topic selection"] },
      { description: "Clarify the title while monitoring viewer satisfaction.", whatChanges: "The title is clarified for accuracy.", whatStaysConstant: ["Topic selection"] },
      { description: "Improve pacing without delaying the promised payoff.", whatChanges: "Pacing is improved and the promised payoff is not delayed.", whatStaysConstant: ["Topic selection"] },
    ];
    for (const treatmentCondition of controls) {
      expect(validate(manipulationResult({ treatmentCondition }))).toEqual([]);
    }
  });

  // --- P1: Decision-purpose contradiction is semantic, not phrase-specific ---
  it("rejects 'should remain unchanged because further investigation is unwarranted' as a purpose", () => {
    const result = manipulationResult();
    result.content.experiment.decisionLinkage.hypothesisUnderTest = "The current opening should remain unchanged because further investigation is unwarranted.";
    expect(codes(result)).toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
  });
  it("rejects purpose paraphrases: keep current instead of testing, leave existing unchanged, no further testing", () => {
    const a = manipulationResult(); a.content.experiment.hypothesis = "Keep the current opening instead of testing the approved change.";
    expect(codes(a)).toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    const b = manipulationResult(); b.content.experiment.title = "Leave the existing opening unchanged.";
    expect(codes(b)).toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    const c = manipulationResult(); c.content.experiment.hypothesis = "Keep the existing opening because no further testing is necessary.";
    expect(codes(c)).toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
  });
  it("does not flag null-result / conditional / control-condition preserve language as a purpose", () => {
    const a = manipulationResult(); a.content.experiment.expectedDirection.justification = "If the treatment underperforms, preserve the current opening.";
    expect(codes(a)).not.toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    const b = manipulationResult(); b.content.experiment.expectedDirection.justification = "A null result would support retaining the current opening.";
    expect(codes(b)).not.toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    const c = manipulationResult(); c.content.experiment.treatmentCondition.description = "The control condition preserves the current opening; the treatment reworks the promise framing.";
    expect(codes(c)).not.toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    expect(validate(a)).toEqual([]);
  });

  // --- P2: invalidation incoherence ---
  it("rejects 'this condition can never occur' and equivalents as an invalidation criterion", () => {
    for (const text of ["This condition can never occur.", "This invalidation condition cannot happen.", "The criterion is impossible to satisfy."]) {
      const result = manipulationResult({ invalidationConditions: [text] });
      expect(codes(result)).toContain("INVALIDATION_CONDITION_INCOHERENT");
    }
  });
  it("does not flag a legitimate failure condition that merely involves an inability", () => {
    for (const text of [
      "Invalidate if the observed metric cannot be measured reliably.",
      "Invalidate if tracking fails.",
      "Invalidate if the treatment cannot be delivered consistently.",
    ]) {
      const result = manipulationResult({ invalidationConditions: [text] });
      expect(codes(result)).not.toContain("INVALIDATION_CONDITION_INCOHERENT");
    }
  });

  // --- P2: structural numeric label vs measurement ---
  it("accepts structural counts such as '3-part hook' / '5-section outline'", () => {
    const a = manipulationResult({ treatmentCondition: { description: "Use a 3-part hook in the opening.", whatChanges: "The opening uses a 3-part hook.", whatStaysConstant: ["Topic selection"] } });
    expect(codes(a)).not.toContain("FABRICATED_QUANTITY_IN_DESIGN");
    expect(validate(a)).toEqual([]);
    const b = manipulationResult({ knownUnknowns: ["Whether a 2-part opening reads better than a 3-step structure or a 5-section outline."] });
    expect(codes(b)).not.toContain("FABRICATED_QUANTITY_IN_DESIGN");
  });
  it("still rejects measurement-like quantities next to a measurement noun", () => {
    const a = manipulationResult({ observationWindow: { description: "Run for 3 hours before reading the result.", rationale: "Retention data stabilises after the initial surge.", minimumBeforeReading: "Wait until the curve is stable." } });
    expect(codes(a)).toContain("FABRICATED_QUANTITY_IN_DESIGN");
    const b = manipulationResult({ primaryMetric: { metric: "AVERAGE_PERCENTAGE_VIEWED", unit: "PERCENT", direction: "INCREASE", rationale: "Hold the treatment to a 30-percent retention baseline as the bar." } });
    expect(codes(b)).toContain("FABRICATED_QUANTITY_IN_DESIGN");
    const c = manipulationResult({ observationWindow: { description: "Review after 3 days.", rationale: "Retention data stabilises after the initial surge.", minimumBeforeReading: "Wait until the curve is stable." } });
    expect(codes(c)).toContain("FABRICATED_QUANTITY_IN_DESIGN");
  });

  // --- quality review: further independent paraphrases per semantic rule ---
  it("rejects further Viewer-Value harm paraphrases (extend runtime, hold back payoff, save answer for the end)", () => {
    const a = manipulationResult({ treatmentCondition: { description: "Extend the video with recap material to lift minutes viewed.", whatChanges: "Runtime extended with recap.", whatStaysConstant: ["Topic selection"] } });
    expect(codes(a)).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    const b = manipulationResult({ treatmentCondition: { description: "Hold back the payoff until the end to boost retention.", whatChanges: "The payoff is held back.", whatStaysConstant: ["Topic selection"] } });
    expect(codes(b)).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    const c = manipulationResult({ treatmentCondition: { description: "Save the answer for the end so people keep watching.", whatChanges: "The answer is saved for the end.", whatStaysConstant: ["Topic selection"] } });
    expect(codes(c)).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("rejects further purpose paraphrases (no need to test further)", () => {
    const a = manipulationResult(); a.content.experiment.hypothesis = "There is no need to test the opening further; keep the current opening.";
    expect(codes(a)).toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
  });
  it("rejects contracted impossible invalidation criteria (can't ever happen, won't ever occur)", () => {
    for (const text of ["This criterion can't ever happen.", "This condition won't ever occur.", "It couldn't possibly be met."]) {
      const result = manipulationResult({ invalidationConditions: [text] });
      expect(codes(result)).toContain("INVALIDATION_CONDITION_INCOHERENT");
    }
  });
  it("does not flag an analytical 'cannot' failure condition after contraction handling", () => {
    const result = manipulationResult({ invalidationConditions: ["Invalidate if the retention export can't be produced by the platform for this video."] });
    expect(codes(result)).not.toContain("INVALIDATION_CONDITION_INCOHERENT");
  });
});

describe("adversarial matrix — round-3 independent-verification regressions", () => {
  it("sanity: the manipulation base result is deterministically clean", () => {
    expect(validate(manipulationResult())).toEqual([]);
  });

  // --- P1: Viewer Value treatment safety survives ordinary paraphrasing ---
  const asTreatment = (text: string) =>
    manipulationResult({ treatmentCondition: { description: text, whatChanges: text, whatStaysConstant: ["Topic selection"] } });

  it("rejects all eight round-3 ordinary harmful paraphrases", () => {
    for (const text of [
      "Stuff the middle with repetitive recap sections so the audience spends longer on the video.",
      "Make every explanation deliberately verbose to maximize minutes watched.",
      "Postpone the useful answer until the closing moments so people stay.",
      "Hide the key takeaway near the finish to compel continued viewing.",
      "Frame a harmless disagreement as a scandal so angry viewers argue below.",
      "Deliberately polarize the audience to provoke more comments.",
      "Pretend the offer expires tonight to pressure subscriptions.",
      "Invent a limited supply and imply viewers will miss out unless they subscribe.",
    ]) {
      expect(codes(asTreatment(text))).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  it("rejects double-negation and cross-clause harm smuggling", () => {
    for (const text of [
      "Not only pad the video to increase watch time, keep them from leaving.",
      "Do not avoid padding the video to inflate watch time.",
      "Avoid filler; pad the video to increase watch time.",
    ]) {
      expect(codes(asTreatment(text))).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  it("does not flag punctuation-interrupted or clause-scoped safe negation", () => {
    for (const text of [
      "Do not—under any circumstances—pad the video to increase watch time.",
      "Do not pad the video to increase watch time.",
      "Avoid padding the video; keep the promised payoff up front.",
    ]) {
      expect(codes(asTreatment(text))).not.toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
      expect(validate(asTreatment(text))).toEqual([]);
    }
  });

  it("rejects fresh harmful paraphrases not copied from any other test", () => {
    for (const text of [
      "Bloat the intro with redundant summaries so viewers keep watching longer.",
      "Sit on the reveal until the last minute so nobody leaves early.",
      "Cook up a feud with another creator to farm angry comments.",
      "Fake a countdown timer so people rush to subscribe before it hits zero.",
      "Drag out the runtime with tangents so average view duration climbs.",
      "Pack the first minute with throwaway recap material to lift retention.",
      "Stage a fake controversy in the thumbnail to farm outrage.",
      "Show a bogus limited-time deadline on the end-card to force subscribes.",
    ]) {
      expect(codes(asTreatment(text))).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  it("does not flag fresh safe rewrites that only mention the harm vocabulary", () => {
    for (const text of [
      "Front-load the promised answer and cut the recap entirely.",
      "Trim tangents so the runtime drops and the payoff arrives sooner.",
      "Rewrite the hook to describe the video accurately, without any urgency.",
    ]) {
      expect(validate(asTreatment(text))).toEqual([]);
    }
  });

  // --- P1: status-quo intent cannot be sanitized by superficial outcome tokens ---
  it("rejects all five round-3 outcome-token status-quo bypasses", () => {
    for (const text of [
      "No more testing is needed for the current hook.",
      "If possible, keep the current opening because no testing is needed.",
      "Unless required, preserve the current opening permanently.",
      "If the team agrees, no further investigation is warranted.",
      "Control condition aside, keep the current opening.",
    ]) {
      const result = manipulationResult();
      result.content.experiment.decisionLinkage.hypothesisUnderTest = text;
      expect(codes(result)).toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });

  it("rejects fresh status-quo smuggling behind a bare result/outcome token", () => {
    for (const text of [
      "Because the outcome is obvious, keep the current opening.",
      "Given the result speaks for itself, retain the current opening.",
      "Assuming leadership signs off, the current hook needs no experiment.",
      "Since the data already answers this, do not test the current opening.",
    ]) {
      const result = manipulationResult();
      result.content.experiment.hypothesis = text;
      expect(codes(result)).toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });

  it("still accepts genuine outcome / control-condition preserve language", () => {
    for (const text of [
      "If the treatment underperforms, preserve the current opening.",
      "A null result would support retaining the current opening.",
      "If the guardrail degrades, revert to the current opening.",
    ]) {
      const result = manipulationResult();
      result.content.experiment.expectedDirection.justification = text;
      expect(codes(result)).not.toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
    const control = manipulationResult();
    control.content.experiment.treatmentCondition.description = "The control condition preserves the current opening; the treatment reworks the promise framing.";
    expect(codes(control)).not.toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
  });

  // --- P2: invalidation incoherence beyond phrase-specific forms ---
  it("rejects all five round-3 invalidation-incoherence bypasses", () => {
    for (const text of [
      "There is no possible scenario for this trigger.",
      "By definition this cannot trigger.",
      "This condition is incapable of occurring.",
      "This safeguard has zero chance of activation.",
      "There exists no world in which this criterion activates.",
    ]) {
      expect(codes(manipulationResult({ invalidationConditions: [text] }))).toContain("INVALIDATION_CONDITION_INCOHERENT");
    }
  });

  it("rejects fresh impossible-by-construction invalidation paraphrases", () => {
    for (const text of [
      "No circumstances exist under which this alarm would sound.",
      "It is flatly impossible for this rule to be triggered.",
      "This trigger has no realistic possibility of ever firing.",
      "Under no conceivable circumstances could this criterion be met.",
    ]) {
      expect(codes(manipulationResult({ invalidationConditions: [text] }))).toContain("INVALIDATION_CONDITION_INCOHERENT");
    }
  });

  it("does not flag the four round-3 legitimate-inability invalidation controls", () => {
    for (const text of [
      "Invalidate if the metric cannot be measured.",
      "Invalidate if tracking cannot be trusted.",
      "Invalidate if the treatment cannot be delivered consistently.",
      "Invalidate if data cannot be collected.",
    ]) {
      expect(codes(manipulationResult({ invalidationConditions: [text] }))).not.toContain("INVALIDATION_CONDITION_INCOHERENT");
    }
  });

  // --- P2: numeric classification edges ---
  it("accepts a structural module count and does not flag it", () => {
    const a = manipulationResult({ treatmentCondition: { description: "Use a 3-module sequence.", whatChanges: "The opening uses a 3-module sequence.", whatStaysConstant: ["Topic selection"] } });
    expect(codes(a)).not.toContain("FABRICATED_QUANTITY_IN_DESIGN");
    expect(validate(a)).toEqual([]);
    const b = manipulationResult({ knownUnknowns: ["Whether a 2-module structure reads better than a 3-module sequence."] });
    expect(codes(b)).not.toContain("FABRICATED_QUANTITY_IN_DESIGN");
  });

  it("rejects a percentage that a label noun previously masked", () => {
    for (const text of [
      "Variant 2% is the retention threshold.",
      "Version 3% is the minimum threshold.",
      "Phase 1% defines acceptable retention.",
      "Variant 2 percent is the target.",
      "Version three percent is the baseline.",
    ]) {
      expect(codes(manipulationResult({ primaryMetric: { metric: "AVERAGE_PERCENTAGE_VIEWED", unit: "PERCENT", direction: "INCREASE", rationale: text } }))).toContain("FABRICATED_QUANTITY_IN_DESIGN");
    }
  });

  it("still accepts bare label identifiers including 'Panel 2' and 'Round 3'", () => {
    for (const label of ["Variant 2", "Version 3", "Phase 1", "Chapter 4", "Panel 2", "Round 3"]) {
      const result = manipulationResult({ knownUnknowns: [`Whether ${label} reads better than the pillar's other videos.`] });
      expect(codes(result)).not.toContain("FABRICATED_QUANTITY_IN_DESIGN");
    }
  });

  it("retains round-1/round-2 numeric behaviour", () => {
    expect(codes(manipulationResult({ knownUnknowns: ["Whether thumbnail variant 2 behaves differently on Episode 7."] }))).not.toContain("FABRICATED_QUANTITY_IN_DESIGN");
    expect(codes(manipulationResult({ treatmentCondition: { description: "Use a 3-part hook in the opening.", whatChanges: "The opening uses a 3-part hook.", whatStaysConstant: ["Topic selection"] } }))).not.toContain("FABRICATED_QUANTITY_IN_DESIGN");
    expect(codes(manipulationResult({ observationWindow: { description: "A 48-hour review window after each treatment upload.", rationale: "Retention data stabilises after the initial surge.", minimumBeforeReading: "Wait until the curve is stable." } }))).toContain("FABRICATED_QUANTITY_IN_DESIGN");
    expect(codes(manipulationResult({ primaryMetric: { metric: "AVERAGE_PERCENTAGE_VIEWED", unit: "PERCENT", direction: "INCREASE", rationale: "Baseline retention is thirty percent and we want it higher." } }))).toContain("FABRICATED_QUANTITY_IN_DESIGN");
    expect(codes(manipulationResult({ exposureRequirement: { description: "Read the result once a sample of forty viewers has been reached.", sufficiencyBasis: "OPERATOR_MUST_CONFIRM", caveat: "If the video is still gaining views quickly, the curve is not yet trustworthy." } }))).toEqual(expect.arrayContaining(["FABRICATED_SAMPLE_SIZE"]));
  });
});

describe("legitimate variety passes", () => {
  it("accepts a well-formed controlled comparison", () => {
    const base = videoExperimentContentFixture();
    const result = channelVideoExperimentResultFixture({
      content: {
        ...base,
        experiment: {
          ...base.experiment,
          experimentType: "CONTROLLED_COMPARISON",
          disposition: "RUN_COMPARISON",
          measurementOnly: false,
          unitOfAssignment: "THUMBNAIL_SLOT",
          controlCondition: { kind: "SIMULTANEOUS_CONTROL", description: "The current thumbnail served via native compare tooling.", comparability: "Both variants run on the same video, same window, same audience pool." },
          treatmentCondition: { description: "An alternate thumbnail that leads with the promised outcome.", whatChanges: "The thumbnail composition and lead element.", whatStaysConstant: ["The video", "the title", "the description"] },
          heldConstant: ["The video content", "the title", "the publish window"],
          knownConfounders: [{ confounder: "Native tooling reallocates impressions unevenly.", mitigation: "Read only once impression share stabilises across arms.", residualRisk: "MEDIUM" }],
          primaryMetric: { metric: "IMPRESSION_CLICK_THROUGH_RATE", unit: "PERCENT", direction: "INCREASE", rationale: "CTR is the direct signal for a thumbnail lead change." },
          guardrailMetrics: [{ metric: "AVERAGE_PERCENTAGE_VIEWED", unit: "PERCENT", protects: "Retention and promise integrity after the click.", degradationSignal: "Percentage viewed falls for the treatment arm." }],
          viewerValueGuardrails: ["The treatment thumbnail must not overstate the payload; if percentage viewed drops it indicates a misleading click and the arm is stopped."],
          rollbackPlan: { trigger: "The guardrail metric degrades for the treatment arm.", action: "Restore the original thumbnail via the same tooling.", reversibility: "EASILY_REVERSIBLE" },
          stoppingConditions: [
            "The guardrail retention metric degrades for the treatment arm.",
            "The native tooling ends the comparison before a stable read.",
          ],
        },
        alternatives: [{ id: "alt:probe", experimentType: "OBSERVATIONAL_PROBE", statement: "Only measure the current curve first.", targetVariable: "Existing retention shape.", notSelectedBecause: "SLOWER_LEARNING", notSelectedReason: "A direct comparison answers the thumbnail question faster." }],
        portfolioEligible: true,
      },
    });
    expect(validate(result)).toEqual([]);
  });
});

describe("adversarial matrix — round-4 independent-verification regressions", () => {
  it("sanity: the manipulation base result is deterministically clean", () => {
    expect(validate(manipulationResult())).toEqual([]);
  });

  const asTreatment = (text: string) =>
    manipulationResult({ treatmentCondition: { description: text, whatChanges: text, whatStaysConstant: ["Topic selection"] } });
  const asPurpose = (text: string) => {
    const result = manipulationResult();
    result.content.experiment.decisionLinkage.hypothesisUnderTest = text;
    return result;
  };
  const asJustification = (text: string) => {
    const result = manipulationResult();
    result.content.experiment.expectedDirection.justification = text;
    return result;
  };

  // --- P1-A: harmful treatment still fails open (fresh paraphrases) ---
  it("rejects every round-4 fresh harmful-treatment paraphrase", () => {
    for (const text of [
      "Repeat the same summary after every section to make the episode run longer and lift watch time.",
      "Let the host ramble through side points so the audience remains watching longer.",
      "Insert an unnecessary recap between sections so people spend more time on the video.",
      "Draw the explanation out with redundant restatements to increase viewing minutes.",
      "Hold the practical answer back until the final section so viewers keep watching.",
      "Save the useful guidance for the last minute to stop viewers leaving early.",
      "Keep the main lesson in reserve until the close so the audience stays.",
      "Create a needless feud between experts to make viewers fight in the comments.",
      "Overstate a minor dispute as explosive drama to spark hostile comments.",
      "Tell viewers access vanishes tomorrow even though it will remain available.",
      "Claim stock is almost gone although supply is unlimited, pushing viewers to subscribe.",
      "Bury the actual answer in the closing segment so users remain on the video.",
    ]) {
      expect(codes(asTreatment(text))).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  it("rejects a harmful clause even after a safe prohibition in the same sentence", () => {
    for (const text of [
      "Without misleading viewers, manufacture controversy to drive angry comments.",
      "Never use rage bait, pad the video to raise watch time.",
      "Avoid deceptive urgency, stretch the video to boost retention.",
    ]) {
      expect(codes(asTreatment(text))).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  it("preserves the round-4 safe treatment controls", () => {
    for (const text of [
      "Remove repeated summaries so the lesson reaches the answer faster.",
      "Keep the practical answer up front and cut rambling side points.",
      "Describe availability honestly without inventing a deadline.",
      "Present disagreement fairly instead of manufacturing conflict.",
    ]) {
      expect(codes(asTreatment(text))).not.toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
      expect(validate(asTreatment(text))).toEqual([]);
    }
  });

  // --- P1-B: negation / clause handling ---
  it("keeps working negation controls (PASS) and rejects the round-4 double-negation bypasses", () => {
    for (const text of ["Never pad the video merely to inflate watch time.", "Don't use filler to keep viewers longer."]) {
      expect(codes(asTreatment(text))).not.toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
    for (const text of [
      "Don't avoid filler; instead, stretch the video to raise minutes watched.",
      "Avoid unnecessary recap, but make the explanations longer so people stay.",
      "We should not refrain from delaying the answer if it improves retention.",
      "Do not fail to withhold the payoff so viewers stay.",
    ]) {
      expect(codes(asTreatment(text))).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  // --- P1-C: decision-purpose smuggling ---
  it("rejects every round-4 fresh contradictory purpose statement", () => {
    for (const text of [
      "Even if we call this a test, the existing opening should stay.",
      "The control can be measured, but there is no reason to change the current opening.",
      "If leadership permits, skip the experiment and keep what we have.",
      "Whether or not results arrive, the opening is staying put.",
      "If the treatment underperforms, or even if it outperforms, preserve the current opening because no more testing is needed.",
      "If the treatment underperforms, preserve the current opening, but whatever the result, keep the current opening permanently.",
    ]) {
      expect(codes(asPurpose(text))).toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });

  it("keeps rejecting the semantically-similar phrases and preserves legitimate conditional control preservation", () => {
    for (const text of [
      "Whatever the result, retain the current hook.",
      "Assuming nothing forces us otherwise, leave the opening as-is.",
      "The experiment may run, yet we intend to leave the hook alone.",
      "A null result may preserve the opening; regardless, keep the current opening permanently.",
    ]) {
      expect(codes(asPurpose(text))).toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
    for (const text of [
      "If the challenger loses on the primary metric, retain the existing hook.",
      "The simultaneous control arm keeps the current opening while the treatment changes it.",
      "An inconclusive outcome would justify preserving the current version pending another test.",
    ]) {
      expect(codes(asJustification(text))).not.toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });

  // --- P2: impossible invalidation paraphrases ---
  it("rejects every round-4 fresh impossible-invalidation paraphrase", () => {
    for (const text of [
      "This tripwire is guaranteed to remain dormant.",
      "Activation lies beyond the realm of possibility.",
      "No chain of events can set off this alarm.",
      "The rule is certain to stay inactive forever.",
    ]) {
      expect(codes(manipulationResult({ invalidationConditions: [text] }))).toContain("INVALIDATION_CONDITION_INCOHERENT");
    }
  });

  it("keeps rejecting the prior impossible forms and preserves legitimate failure conditions", () => {
    for (const text of [
      "There is no circumstance where this trigger would fire.",
      "This criterion has no possibility of ever being met.",
      "It would be impossible for this safeguard to activate.",
      "Nothing could ever cause this invalidation rule to trigger.",
    ]) {
      expect(codes(manipulationResult({ invalidationConditions: [text] }))).toContain("INVALIDATION_CONDITION_INCOHERENT");
    }
    for (const text of [
      "Analytics unavailable long enough to prevent reliable comparison.",
      "Baseline cannot be matched to a comparable treatment period.",
      "Delivery tooling fails to apply the treatment consistently.",
    ]) {
      expect(codes(manipulationResult({ invalidationConditions: [text] }))).not.toContain("INVALIDATION_CONDITION_INCOHERENT");
    }
  });

  // --- second-order paraphrase matrix (author-generated, not the supplied strings) ---
  it("second-order: padding via repetition / rambling / redundancy / draw-out", () => {
    for (const text of [
      "Loop back to earlier points again and again so the video runs long and retention climbs.",
      "Have the presenter go off on a tangent about unrelated trivia to pad viewing minutes.",
      "Restate the thesis at the top of every chapter so the video is longer and retention rises.",
      "Circle back to the intro claims mid-video so it runs longer and average view duration rises.",
      "Add a second walkthrough of the same steps to push the runtime up and hold attention.",
    ]) {
      expect(codes(asTreatment(text))).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  it("second-order: delayed payoff / withheld answer", () => {
    for (const text of [
      "Push the takeaway into the final third so nobody clicks away early.",
      "Reserve the actionable step for the very end so viewers watch the whole thing.",
      "Keep the verdict in your back pocket until the last section so people finish the video.",
      "Cling to the final recommendation until the sign-off so people finish the whole video.",
    ]) {
      expect(codes(asTreatment(text))).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  it("second-order: manufactured conflict / outrage", () => {
    for (const text of [
      "Cook up a rivalry with a competing channel to get commenters arguing.",
      "Blow a minor wording quibble out of proportion into a scandal to farm angry replies.",
      "Pit two commenters against each other to keep the comment war going.",
      "Brand a minor caption fix as an outrageous betrayal of viewers to bait angry replies.",
    ]) {
      expect(codes(asTreatment(text))).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  it("second-order: deceptive scarcity / urgency", () => {
    for (const text of [
      "Fake a countdown timer so people rush to subscribe before it hits zero.",
      "Say only three copies remain even though the inventory is effectively unlimited.",
      "Post that enrolment shuts tonight while it will in fact stay open all year.",
      "Suggest fewer than five kits are left when we can ship as many as ordered.",
    ]) {
      expect(codes(asTreatment(text))).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  it("second-order: double negation (not refrain / do not fail to / wrong not to / never skip)", () => {
    for (const text of [
      "It would be wrong not to defer the payoff if retention improves.",
      "Never skip padding the middle; that is how minutes viewed rise.",
      "Do not neglect to stretch the segment so watch time climbs.",
      "It would be careless not to hold the answer back for retention.",
    ]) {
      expect(codes(asTreatment(text))).toContain("VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  it("second-order: safe controls that only mention the harm vocabulary still pass", () => {
    for (const text of [
      "Front-load the promised answer and cut the recap entirely.",
      "Trim tangents so the runtime drops and the payoff arrives sooner.",
      "Get to the recommendation fast and keep the video lean.",
      "State plainly that registration stays open year-round.",
      "Summarise both sides of the wording debate fairly.",
    ]) {
      expect(validate(asTreatment(text))).toEqual([]);
    }
  });

  it("second-order: decision-immutability variants", () => {
    for (const text of [
      "Even if the treatment wins, the current opening stays.",
      "No matter how the numbers land, we will keep the existing thumbnail.",
      "Run it as a box-ticking exercise; the current opening is set in stone.",
      "The experiment cannot overturn the decision to keep the current version.",
      "We have no intention of altering the present thumbnail after this run.",
    ]) {
      expect(codes(asPurpose(text))).toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });

  it("second-order: legitimate outcome-conditioned preservation still passes", () => {
    for (const text of [
      "If the reworked hook underperforms the baseline, keep the current opening this quarter.",
      "Should satisfaction decline, revert to the existing hook.",
      "A null or adverse read would support keeping the current version pending more data.",
      "When retention drops under the guardrail, roll back to the existing hook.",
    ]) {
      expect(codes(asJustification(text))).not.toContain("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });

  it("second-order: impossible-invalidation variants", () => {
    for (const text of [
      "Activation is beyond the realm of possibility.",
      "This safeguard is guaranteed never to fire.",
      "Nothing that could happen would ever activate this rule.",
      "There is no realistic path by which this safeguard ever activates.",
      "It is inconceivable that anything could trigger this rule.",
    ]) {
      expect(codes(manipulationResult({ invalidationConditions: [text] }))).toContain("INVALIDATION_CONDITION_INCOHERENT");
    }
  });

  it("second-order: legitimate inability invalidation conditions still pass", () => {
    for (const text of [
      "Invalidate if the platform stops reporting audience retention for this video.",
      "Invalidate if the treatment window coincides with a major algorithm change.",
      "Invalidate if fewer than half the planned videos receive the treatment.",
      "Invalidate if an unrelated news spike distorts the treatment period.",
    ]) {
      expect(codes(manipulationResult({ invalidationConditions: [text] }))).not.toContain("INVALIDATION_CONDITION_INCOHERENT");
    }
  });
});
