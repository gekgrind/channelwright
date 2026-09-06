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

  it("rejects an acquisition primary metric with no satisfaction guardrail metric", () => {
    const result = clone(channelVideoExperimentResultFixture());
    result.content.experiment.primaryMetric = { metric: "IMPRESSION_CLICK_THROUGH_RATE", unit: "PERCENT", direction: "INCREASE", rationale: "CTR is the acquisition lever under test." };
    result.content.experiment.guardrailMetrics = [{ metric: "IMPRESSIONS", unit: "COUNT", protects: "Reach.", degradationSignal: "Impressions collapse." }];
    result.content.experiment.viewerValueGuardrails = ["Keep the reach healthy across the window."];
    expect(codes(result)).toEqual(expect.arrayContaining(["NO_SATISFACTION_GUARDRAIL_METRIC", "METRIC_GAMING_UNGUARDED"]));
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
