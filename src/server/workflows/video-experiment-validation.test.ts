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

type SemanticIntent = ChannelVideoExperimentResult["content"]["experiment"]["semanticIntent"];
type InvalidationCondition = ChannelVideoExperimentResult["content"]["experiment"]["invalidationConditions"][number];

/** A legitimate evidence-conditioned comparison declaration (the manipulationResult default). */
const legitIntent = (over: Partial<SemanticIntent> = {}): SemanticIntent => ({
  treatmentMechanism: "PROMISE_FRAMING",
  prolongsContentForRetention: false,
  addedLengthCarriesProportionalValue: "NOT_APPLICABLE",
  withholdsPromisedValueForRetention: false,
  manufacturesAntagonismForEngagement: false,
  usesScarcityOrUrgencyClaim: false,
  scarcityBasis: null,
  evidenceCanChangeShippingDecision: true,
  adoptionCondition: "CHALLENGER_DECISIVELY_WINS_PRIMARY_WITHOUT_GUARDRAIL_BREACH",
  preservationCondition: "CHALLENGER_FAILS_TO_WIN",
  causalClaimStrength: "HYPOTHESIZED_CAUSAL",
  ...over,
});

/** Wrap a prose statement in a neutral (non-incoherent) typed check -- used to exercise the prose backup. */
const proseInval = (statement: string): InvalidationCondition => ({ statement, check: { kind: "QUALITATIVE_JUDGMENT" } });

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
        semanticIntent: {
          treatmentMechanism: "PROMISE_FRAMING",
          prolongsContentForRetention: false,
          addedLengthCarriesProportionalValue: "NOT_APPLICABLE",
          withholdsPromisedValueForRetention: false,
          manufacturesAntagonismForEngagement: false,
          usesScarcityOrUrgencyClaim: false,
          scarcityBasis: null,
          evidenceCanChangeShippingDecision: true,
          adoptionCondition: "CHALLENGER_DECISIVELY_WINS_PRIMARY_WITHOUT_GUARDRAIL_BREACH",
          preservationCondition: "CHALLENGER_FAILS_TO_WIN",
          causalClaimStrength: "HYPOTHESIZED_CAUSAL",
        },
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


// ===========================================================================
// ROUND 6 -- structured semantic authority.
//
// The safety-critical experiment semantics live in `experiment.semanticIntent`
// and the typed `check` on each `invalidationConditions` entry. These tests
// prove STRUCTURAL INVARIANCE: changing prose wording while holding the
// structured declaration constant cannot change whether a core invariant is
// enforced. The Round 1-5 prose classifier is retained as a fail-closed
// consistency signal and is regression-tested in its own block.
// ===========================================================================

const asTreatment = (
  description: string,
  intentOver: Partial<SemanticIntent> = {},
  whatChanges = description,
) => manipulationResult({
  treatmentCondition: { description, whatChanges, whatStaysConstant: ["Topic selection"] },
  semanticIntent: legitIntent(intentOver),
});
const asPurpose = (hypothesisUnderTest: string, intentOver: Partial<SemanticIntent> = {}) => {
  const result = manipulationResult({ semanticIntent: legitIntent(intentOver) });
  result.content.experiment.decisionLinkage.hypothesisUnderTest = hypothesisUnderTest;
  return result;
};
const asInvalidation = (condition: InvalidationCondition) => manipulationResult({ invalidationConditions: [condition] });
const has = (result: ChannelVideoExperimentResult, code: string) => expect(codes(result)).toContain(code);
const lacks = (result: ChannelVideoExperimentResult, code: string) => expect(codes(result)).not.toContain(code);

describe("round-6 :: sanity", () => {
  it("the structured manipulation base is deterministically clean", () => {
    expect(validate(manipulationResult())).toEqual([]);
  });
  it("the structured probe base is deterministically clean", () => {
    expect(validate(channelVideoExperimentResultFixture())).toEqual([]);
  });
});

// --- A. STRUCTURAL INVARIANCE ---------------------------------------------
describe("round-6 :: A. structural invariance (prose varies, struct fixed, verdict fixed)", () => {
  const RADICALLY_DIFFERENT_PROSE = [
    "We refine the opening.",
    "Cephalization of the introductory throughput is modulated per the attached rubric.",
    "the hook. that is what moves.",
    "Adjust. Observe. Compare. Nothing more, per protocol seven.",
    "opening tweak -- see doc",
    "The treatment reworks how the first stretch establishes the viewer contract, holding everything downstream fixed.",
  ];

  it("A1 harmful prolonging: struct says prolongs-without-proportional-value -> ALWAYS rejected", () => {
    for (const description of RADICALLY_DIFFERENT_PROSE) {
      has(asTreatment(description, { prolongsContentForRetention: true, addedLengthCarriesProportionalValue: "NO" }), "VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });
  it("A2 harmful withholding: struct says withholds -> ALWAYS rejected", () => {
    for (const description of RADICALLY_DIFFERENT_PROSE) {
      has(asTreatment(description, { withholdsPromisedValueForRetention: true }), "VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });
  it("A3 manufactured antagonism: struct says manufactures antagonism -> ALWAYS rejected", () => {
    for (const description of RADICALLY_DIFFERENT_PROSE) {
      has(asTreatment(description, { manufacturesAntagonismForEngagement: true }), "VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });
  it("A4 deceptive scarcity: struct says scarcity claim without real supported basis -> ALWAYS rejected", () => {
    for (const description of RADICALLY_DIFFERENT_PROSE) {
      has(asTreatment(description, { usesScarcityOrUrgencyClaim: true, scarcityBasis: "NOT_FINITE_OR_UNSUPPORTED" }), "VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });
  it("A5 legitimate treatment: struct clean -> ALWAYS valid", () => {
    for (const description of RADICALLY_DIFFERENT_PROSE) {
      expect(validate(asTreatment(description))).toEqual([]);
    }
  });
  it("A6 truthful scarcity: struct says scarcity claim on a real supported basis -> ALWAYS valid", () => {
    for (const description of RADICALLY_DIFFERENT_PROSE) {
      lacks(asTreatment(description, { usesScarcityOrUrgencyClaim: true, scarcityBasis: "REAL_FINITE_AND_SUPPORTED" }), "VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });
  it("A7 prolonging WITH proportional added value -> not the treatment-harmful finding", () => {
    for (const description of RADICALLY_DIFFERENT_PROSE) {
      lacks(asTreatment(description, { prolongsContentForRetention: true, addedLengthCarriesProportionalValue: "YES" }), "VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });

  const RADICALLY_DIFFERENT_PURPOSE_PROSE = [
    "We test the hook.",
    "Interrogate the antecedent framing hypothesis against the historical envelope.",
    "does the new opening hold people? measure it.",
    "Compare challenger vs incumbent on early retention; act on the read.",
    "The hypothesis under examination concerns whether the reframed promise sustains the early curve.",
  ];
  it("A8 outcome-independent linkage: struct says evidence cannot move the decision -> ALWAYS rejected", () => {
    for (const prose of RADICALLY_DIFFERENT_PURPOSE_PROSE) {
      has(asPurpose(prose, { evidenceCanChangeShippingDecision: false }), "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });
  it("A9 preserve-regardless linkage -> ALWAYS rejected", () => {
    for (const prose of RADICALLY_DIFFERENT_PURPOSE_PROSE) {
      has(asPurpose(prose, { preservationCondition: "ALWAYS_REGARDLESS_OF_RESULT" }), "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });
  it("A10 evidence-conditioned linkage -> ALWAYS valid regardless of prose", () => {
    for (const prose of [
      ...RADICALLY_DIFFERENT_PURPOSE_PROSE,
      "Keep the current opening unless the challenger decisively wins; otherwise the incumbent stays this quarter.",
      "The incumbent framing remains in place if the reworked hook does not clear the retention bar.",
      "Should the read be inconclusive, hold the current version pending another run.",
    ]) {
      lacks(asPurpose(prose, {
        adoptionCondition: "CHALLENGER_DECISIVELY_WINS_PRIMARY_WITHOUT_GUARDRAIL_BREACH",
        preservationCondition: "INCONCLUSIVE_OR_NULL_RESULT",
      }), "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });
  it("A11 evidence-conditioned linkage stays valid even with blatantly immutable-sounding prose (Finding 3)", () => {
    for (const prose of [
      "Whatever the numbers say, we keep the current opening.",
      "The incumbent ships regardless of the result; this is a formality.",
      "The decision was made in advance; the run only documents the challenger.",
    ]) {
      lacks(asPurpose(prose, { adoptionCondition: "CHALLENGER_WINS_PRIMARY", preservationCondition: "CHALLENGER_FAILS_TO_WIN" }), "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });
  it("A12 causal claim strength DEFINITIVE_CAUSAL -> ALWAYS rejected", () => {
    for (const prose of ["The hook change works.", "Deterministic causal proof.", "the opening causes retention. full stop."]) {
      const r = manipulationResult({ semanticIntent: legitIntent({ causalClaimStrength: "DEFINITIVE_CAUSAL" }) });
      r.content.experiment.hypothesis = prose;
      has(r, "UNSUPPORTED_CAUSAL_CERTAINTY");
    }
  });
  it("A13 HYPOTHESIZED_CAUSAL with hypothetical prose -> ALWAYS valid", () => {
    for (const prose of [
      "If the reworked opening proves stronger on retention, adopt it.",
      "Where the variant tests better than control, ship it.",
      "A decisive win on the primary would support the reframed promise.",
    ]) {
      const r = manipulationResult({ semanticIntent: legitIntent({ causalClaimStrength: "HYPOTHESIZED_CAUSAL" }) });
      r.content.experiment.expectedDirection.justification = prose;
      lacks(r, "UNSUPPORTED_CAUSAL_CERTAINTY");
    }
  });
  it("A14 invalidation domain impossibility is verdict-invariant to the prose statement", () => {
    for (const statement of [
      "Invalidate if average view duration exceeds the video's total length.",
      "Invalidate if mean elapsed viewing per person is greater than the clip runtime.",
      "trigger: AVD > length",
      "This safeguard fires when the retention integral surpasses unity of duration.",
    ]) {
      has(asInvalidation({ statement, check: { kind: "METRIC_DOMAIN_BOUND", metric: "AVERAGE_VIEW_DURATION", relation: "EXCEEDS", bound: "VIDEO_LENGTH" } }), "INVALIDATION_CONDITION_INCOHERENT");
    }
  });
  it("A15 a coherent typed invalidation check is verdict-invariant to a scary-sounding statement", () => {
    for (const statement of [
      "Invalidate if the retention export cannot be produced.",
      "This can never be recovered and is impossible to reconstruct if analytics vanish.",
      "no data, no read",
    ]) {
      lacks(asInvalidation({ statement, check: { kind: "DATA_UNAVAILABLE" } }), "INVALIDATION_CONDITION_INCOHERENT");
    }
  });
});

// --- B. TAMPER: caller/model cannot spoof authoritative semantics ---------
describe("round-6 :: B. tamper resistance", () => {
  it("B1 executor re-stamps the measurement-only-coupled semantic enums for an observational probe", async () => {
    const { ChannelVideoExperimentExecutor } = await import("./video-experiment-executor");
    const spoofed = channelVideoExperimentResultFixture().content;
    spoofed.experiment.semanticIntent = {
      ...spoofed.experiment.semanticIntent,
      treatmentMechanism: "OTHER_DISCLOSED",
      withholdsPromisedValueForRetention: true,
      adoptionCondition: "CHALLENGER_WINS_PRIMARY",
      preservationCondition: "ALWAYS_REGARDLESS_OF_RESULT",
    };
    const executor = new ChannelVideoExperimentExecutor(
      { resolve: async () => structuredClone(artifact) } as never,
      {
        analyze: async () => ({ value: spoofed, usage: { model: "m", inputTokens: 1, outputTokens: 1, totalTokens: 2 }, attribution: { provider: "openai", model: "gpt", role: "GENERATOR", operation: "op", invokedAt: new Date().toISOString() } }),
        critique: async () => ({ value: { safeToFinalize: true, summary: "ok", findings: [] }, usage: { model: "m", inputTokens: 1, outputTokens: 1, totalTokens: 2 }, attribution: { provider: "anthropic", model: "claude", role: "CRITIC", operation: "op", invokedAt: new Date().toISOString() } }),
        routing: () => [],
      } as never,
      { reserve: async () => ({}), finalize: async () => undefined } as never,
    );
    const draft = await executor.execute({
      workflowType: "CHANNEL_VIDEO_EXPERIMENT", stepKey: "draft-video-experiment",
      workflowId: "w", runId: "r", ownerId: "o", attemptCount: 1,
      input: { videoDecisionWorkflowId: crypto.randomUUID(), videoDecisionRunId: crypto.randomUUID(), approvedVideoDecisionReference: artifact.reference },
      priorOutputs: {
        "validate-approved-decision": structuredClone(artifact),
        "derive-experiment-constraints": deriveVideoExperimentConstraints(artifact),
      },
    } as never) as { content: ChannelVideoExperimentResult["content"] };
    const si = draft.content.experiment.semanticIntent;
    expect(si.treatmentMechanism).toBe("MEASUREMENT_ONLY");
    expect(si.withholdsPromisedValueForRetention).toBe(false);
    expect(si.adoptionCondition).toBe("NONE_MEASUREMENT_ONLY");
    expect(si.preservationCondition).toBe("NONE_MEASUREMENT_ONLY");
  });

  it("B2 a probe that keeps a non-measurement-only adoption enum fails EXPERIMENT_READY_MISMATCH", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.semanticIntent.adoptionCondition = "CHALLENGER_WINS_PRIMARY";
    has(result, "EXPERIMENT_READY_MISMATCH");
  });

  it("B3 a comparison that flips experimentReady to mask an outcome-independent linkage is still caught by the purpose rule", () => {
    const result = manipulationResult({ semanticIntent: legitIntent({ evidenceCanChangeShippingDecision: false }) });
    result.content.experimentReady = false;
    has(result, "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    lacks(result, "EXPERIMENT_READY_MISMATCH");
  });

  it("B4 declaring causalClaimStrength below the prose does not launder a definitive causal claim", () => {
    const r = manipulationResult({ semanticIntent: legitIntent({ causalClaimStrength: "ASSOCIATIONAL" }) });
    r.content.experiment.hypothesis = "The current opening caused the early drop-off and definitively explains the weak retention.";
    has(r, "UNSUPPORTED_CAUSAL_CERTAINTY");
  });

  it("B5 an incoherent typed invalidation check cannot be hidden behind an innocuous statement", () => {
    has(asInvalidation({ statement: "Invalidate if completion looks unusually high for the cohort.", check: { kind: "METRIC_DOMAIN_BOUND", metric: "AVERAGE_PERCENTAGE_VIEWED", relation: "EXCEEDS", bound: "ONE_HUNDRED_PERCENT" } }), "INVALIDATION_CONDITION_INCOHERENT");
    has(asInvalidation({ statement: "Invalidate if the criterion both fires and does not.", check: { kind: "LOGICALLY_SELF_CONTRADICTORY" } }), "INVALIDATION_CONDITION_INCOHERENT");
  });
});

// --- C. PROSE / STRUCT DISAGREEMENT -> FAIL CLOSED ----------------------
describe("round-6 :: C. prose vs struct disagreement (fail closed)", () => {
  it("C1 clean struct + prose describes padding for retention -> blocked", () => {
    has(asTreatment("Pad the mid-section with recap so average view duration climbs.", {}), "VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("C2 clean struct + prose describes withholding the payoff -> blocked", () => {
    has(asTreatment("Hold the promised answer back until the final minute so viewers stay.", {}), "VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("C3 clean struct + prose manufactures a feud -> blocked", () => {
    has(asTreatment("Gin up a feud with a rival channel so the comments fill with anger.", {}), "VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("C4 a degenerate comparison linkage (preservation declared measurement-only) is structurally outcome-independent", () => {
    has(asPurpose("Whatever the result, the current opening is kept.", { adoptionCondition: "CHALLENGER_WINS_PRIMARY", preservationCondition: "NONE_MEASUREMENT_ONLY" }), "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
  });
  it("C5 statement reads impossible-by-construction while the typed check is neutral -> blocked", () => {
    has(asInvalidation(proseInval("There is no condition that could ever invalidate this experiment; it is always interpretable.")), "INVALIDATION_CONDITION_INCOHERENT");
  });
  it("C6 a fully evidence-conditioned struct is NOT overridden by odd prose (no false disagreement)", () => {
    lacks(asPurpose("Assuming nothing forces us otherwise, leave the opening as-is.", {
      adoptionCondition: "CHALLENGER_DECISIVELY_WINS_PRIMARY_WITHOUT_GUARDRAIL_BREACH",
      preservationCondition: "CHALLENGER_FAILS_TO_WIN",
    }), "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
  });
});

// --- D. ROUND 1-5 PROSE-CLASSIFIER REGRESSION (defense-in-depth) --------
describe("round-6 :: D. retained prose-classifier regression (clean struct + harmful prose)", () => {
  const proseHarmful = (description: string) => has(asTreatment(description, {}), "VIEWER_VALUE_TREATMENT_HARMFUL");
  const proseSafe = (description: string) => expect(validate(asTreatment(description, {}))).toEqual([]);

  it("D1 padding / prolonging paraphrases", () => {
    [
      "Pad the video with extra recap so minutes viewed rises.",
      "Stretch the runtime with filler to increase minutes viewed.",
      "Bloat the intro with redundant summaries so viewers keep watching longer.",
      "Repeat the same summary after every section to make the episode run longer and lift watch time.",
      "Let the host ramble through side points so the audience remains watching longer.",
      "The runtime is progressively padded to hold viewers.",
    ].forEach(proseHarmful);
  });
  it("D2 withholding paraphrases", () => {
    [
      "Withhold the promised answer to keep viewers watching.",
      "Hold back the payoff until the end to boost retention.",
      "Save the answer for the end so people keep watching.",
      "Sit on the reveal until the last minute so nobody leaves early.",
      "The opening names the concrete fix. That fix is then held back until the sign-off. The goal is to stop early exits.",
    ].forEach(proseHarmful);
  });
  it("D3 manufactured conflict / outrage paraphrases", () => {
    [
      "The hook manufactures controversy and whips up anger.",
      "Cook up a feud with another creator to farm angry comments.",
      "Frame a harmless disagreement as a scandal so angry viewers argue below.",
      "Appoint one commenter as the villain so the rest pile on.",
    ].forEach(proseHarmful);
  });
  it("D4 deceptive scarcity paraphrases (cross-sentence claim + admitted availability)", () => {
    [
      "Pretend the offer expires tonight to pressure subscriptions.",
      "Tell viewers access vanishes tomorrow even though it will remain available.",
      "Say only three copies remain even though the inventory is effectively unlimited.",
      "Put a countdown on the end card. Enrolment actually reopens every month with plenty of room.",
    ].forEach(proseHarmful);
  });
  it("D5 double-negative framing still trips the prose backup", () => {
    [
      "Do not fail to withhold the payoff so viewers stay.",
      "Never skip padding the middle; that is how minutes viewed rise.",
      "It would be wrong not to defer the payoff if retention improves.",
    ].forEach(proseHarmful);
  });
  it("D6 safe interventions that only mention the harm vocabulary stay clean", () => {
    [
      "Tighten the opening so the promised value appears sooner.",
      "Remove low-value filler while measuring retention.",
      "Improve pacing without delaying the promised payoff.",
      "Front-load the promised answer and cut the recap entirely.",
      "Describe availability honestly without inventing a deadline.",
      "Summarise both sides of the wording debate fairly.",
    ].forEach(proseSafe);
  });
  it("D7 decision-linkage is fully structural: immutable-sounding prose over an evidence-conditioned struct never blocks", () => {
    for (const text of [
      "The current opening should remain unchanged because further investigation is unwarranted.",
      "Keep the current opening instead of testing the approved change.",
      "No more testing is needed for the current hook.",
      "Even if we call this a test, the existing opening should stay.",
    ]) {
      lacks(asPurpose(text, { adoptionCondition: "CHALLENGER_WINS_PRIMARY", preservationCondition: "GUARDRAIL_BREACH" }), "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });
  it("D8 an outcome-independent struct blocks regardless of reassuring prose", () => {
    for (const text of [
      "If the treatment underperforms, preserve the current opening.",
      "A null result would support retaining the current opening.",
      "We will act decisively on whatever the comparison shows.",
    ]) {
      has(asPurpose(text, { evidenceCanChangeShippingDecision: false }), "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    }
  });
  it("D9 impossible-by-construction invalidation prose still trips the backup with a neutral typed check", () => {
    for (const text of [
      "This condition can never occur.",
      "The criterion is impossible to satisfy.",
      "There is no possible scenario for this trigger.",
      "This safeguard is guaranteed never to fire.",
      "No chain of events can set off this alarm.",
    ]) {
      has(asInvalidation(proseInval(text)), "INVALIDATION_CONDITION_INCOHERENT");
    }
  });
  it("D10 legitimate-inability invalidation prose stays clean with a coherent typed check", () => {
    for (const text of [
      "Invalidate if the metric cannot be measured.",
      "Invalidate if tracking cannot be trusted.",
      "Invalidate if the treatment cannot be delivered consistently.",
    ]) {
      lacks(asInvalidation({ statement: text, check: { kind: "DELIVERY_FAILURE" } }), "INVALIDATION_CONDITION_INCOHERENT");
    }
  });
  it("D11 causal-certainty prose still trips the backup below DEFINITIVE_CAUSAL", () => {
    const r = manipulationResult({ semanticIntent: legitIntent({ causalClaimStrength: "ASSOCIATIONAL" }) });
    r.content.experiment.hypothesis = "The current opening caused the early drop-off and definitively explains the weak retention.";
    has(r, "UNSUPPORTED_CAUSAL_CERTAINTY");
  });
});

// --- E. SAFE CONTROLS -------------------------------------------------
describe("round-6 :: E. legitimate designs remain valid", () => {
  it("E1 a well-formed controlled comparison validates clean", () => {
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
          semanticIntent: legitIntent({ treatmentMechanism: "THUMBNAIL_OR_TITLE" }),
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
  it("E2 an evidence-conditioned sequential comparison with legit editorial prose validates clean", () => {
    for (const description of [
      "Tighten the opening so the promised value lands sooner.",
      "Reorder the opening so the strongest example leads.",
      "Rewrite the hook to describe the video accurately.",
    ]) {
      expect(validate(asTreatment(description, { treatmentMechanism: "EDITORIAL_QUALITY" }))).toEqual([]);
    }
  });
  it("E3 a measurement-only probe with a legit invalidation check validates clean", () => {
    const r = channelVideoExperimentResultFixture();
    r.content.experiment.invalidationConditions = [{ statement: "The platform stops reporting audience retention for this video.", check: { kind: "DATA_UNAVAILABLE" } }];
    expect(validate(r)).toEqual([]);
  });
  it("E4 strong-but-possible invalidation thresholds are not incoherent", () => {
    for (const condition of [
      { statement: "Invalidate if average view duration is under a tenth of the video length.", check: { kind: "METRIC_DOMAIN_BOUND", metric: "AVERAGE_VIEW_DURATION", relation: "BELOW", bound: "BASELINE_BAND" } },
      { statement: "Invalidate if returning-viewer rate drops to the baseline floor.", check: { kind: "METRIC_DOMAIN_BOUND", metric: "RETURNING_VIEWERS_RATE", relation: "EQUALS", bound: "BASELINE_BAND" } },
      { statement: "Invalidate if fewer than a quarter of planned videos receive the treatment.", check: { kind: "QUALITATIVE_JUDGMENT" } },
    ] as InvalidationCondition[]) {
      lacks(asInvalidation(condition), "INVALIDATION_CONDITION_INCOHERENT");
    }
  });
});

// --- F. FINDING-BY-FINDING structured resolution ---------------------
describe("round-6 :: F. finding-by-finding (structured authority)", () => {
  it("F1 prolonging purpose gate no longer depends on retention-metric vocabulary", () => {
    has(asTreatment("Deliberately slow the middle so elapsed viewing per impression rises.", { prolongsContentForRetention: true, addedLengthCarriesProportionalValue: "NO" }), "VIEWER_VALUE_TREATMENT_HARMFUL");
    has(asTreatment("Add unhurried connective material so each viewer's session simply runs longer.", { prolongsContentForRetention: true, addedLengthCarriesProportionalValue: "NO" }), "VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("F2 decision immutability is structurally knowable", () => {
    has(asPurpose("The comparison is purely informational.", { evidenceCanChangeShippingDecision: false }), "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
    has(manipulationResult({ semanticIntent: legitIntent({ adoptionCondition: "NONE_MEASUREMENT_ONLY" }) }), "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
  });
  it("F3 outcome-conditioned preservation via noun-phrase / unfamiliar syntax is valid when the struct says so", () => {
    lacks(asPurpose("Adoption of the challenger only upon a decisive primary win; otherwise incumbent retention.", {
      adoptionCondition: "CHALLENGER_DECISIVELY_WINS_PRIMARY_WITHOUT_GUARDRAIL_BREACH",
      preservationCondition: "CHALLENGER_FAILS_TO_WIN",
    }), "EXPERIMENT_PURPOSE_CONTRADICTS_DECISION");
  });
  it("F4 deceptive scarcity resolved by scarcityBasis, not a scarcity thesaurus", () => {
    for (const description of [
      "The offer is reissued weekly.",
      "The item is made to order.",
      "The cart reopens every Monday.",
      "We can produce arbitrary quantities on demand.",
    ]) {
      has(asTreatment(description, { usesScarcityOrUrgencyClaim: true, scarcityBasis: "NOT_FINITE_OR_UNSUPPORTED" }), "VIEWER_VALUE_TREATMENT_HARMFUL");
      lacks(asTreatment(description, { usesScarcityOrUrgencyClaim: false }), "VIEWER_VALUE_TREATMENT_HARMFUL");
    }
  });
  it("F5 negation is no longer the safety boundary -- the struct is", () => {
    // Double-negative harmful framing: the struct settles it, whatever the negation arithmetic.
    has(asTreatment("We will never skip the opportunity to hold the payoff back for retention.", { withholdsPromisedValueForRetention: true }), "VIEWER_VALUE_TREATMENT_HARMFUL");
    // Struct clean + genuinely clean prose -> clean (the prose backup only fires on a real prose/struct disagreement).
    lacks(asTreatment("We deliver the payoff up front and never hold it back.", { withholdsPromisedValueForRetention: false }), "VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("F6 coreference across an intervening rationale sentence no longer matters -- the struct is", () => {
    const prose = "The opening promises a concrete fix. Viewers deserve that certainty early, which is a real tension. We keep it for the finale instead so the session holds.";
    has(asTreatment(prose, { withholdsPromisedValueForRetention: true }), "VIEWER_VALUE_TREATMENT_HARMFUL");
    lacks(asTreatment("The opening promises a concrete fix. We deliver it immediately.", { withholdsPromisedValueForRetention: false }), "VIEWER_VALUE_TREATMENT_HARMFUL");
  });
  it("F7 causal-certainty uses the authoritative claim-strength enum", () => {
    const r = manipulationResult({ semanticIntent: legitIntent({ causalClaimStrength: "DEFINITIVE_CAUSAL" }) });
    r.content.experiment.hypothesis = "The test definitively demonstrates a causal relationship between the hook change and watch time.";
    has(r, "UNSUPPORTED_CAUSAL_CERTAINTY");
  });
  it("F8 invalidation coherence validated over typed metric/relation/bound", () => {
    has(asInvalidation({ statement: "unique viewers over total views", check: { kind: "METRIC_DOMAIN_BOUND", metric: "UNIQUE_VIEWERS", relation: "EXCEEDS", bound: "TOTAL_VIEWS" } }), "INVALIDATION_CONDITION_INCOHERENT");
    has(asInvalidation({ statement: "click-through above one hundred percent", check: { kind: "METRIC_DOMAIN_BOUND", metric: "IMPRESSION_CLICK_THROUGH_RATE", relation: "EXCEEDS", bound: "ONE_HUNDRED_PERCENT" } }), "INVALIDATION_CONDITION_INCOHERENT");
  });
});
