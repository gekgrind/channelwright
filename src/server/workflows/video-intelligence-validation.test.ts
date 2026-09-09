import { describe, expect, it } from "vitest";
import {
  channelLearningRecordSchema,
  intelligencePatternClassSchema,
  strategyReviewSignalSchema,
  videoIntelligenceInputSchema,
  videoIntelligenceRequestInputSchema,
  type ChannelVideoIntelligenceResult,
} from "@/domain/production-workflows";
import {
  chronological,
  deriveIntelligenceReady,
  deriveVideoIntelligenceConstraints,
  deriveViewerValueTrend,
  IMPLICATION_PERMITTED_ADOPTION_STANCES,
} from "./video-intelligence-cycles";
import {
  DETERMINISTIC_VIDEO_INTELLIGENCE_RULES,
  deterministicVideoIntelligenceValidation,
  videoIntelligenceQA,
  videoIntelligenceQaStepEnvelopeBytes,
} from "./video-intelligence-validation";
import { WORKFLOW_STEP_OUTPUT_CEILING_BYTES, channelVideoIntelligenceConfig } from "./video-intelligence-config";
import {
  buildApprovedPortfolioArtifact,
  buildApprovedPortfolioSet,
  buildCommitment,
  buildDefaultPortfolioSet,
  buildIntelligenceContent,
  buildIntelligenceResult,
  buildLearning,
  fixtureUuid,
  FIXTURE_HORIZON_LABEL,
} from "./video-intelligence-fixtures.test-helper";

const set = buildDefaultPortfolioSet();
const constraints = deriveVideoIntelligenceConstraints(set, FIXTURE_HORIZON_LABEL);
const cycleIds = constraints.citableCycleIds;

const validate = (result: ChannelVideoIntelligenceResult, over = { set, constraints }) =>
  deterministicVideoIntelligenceValidation(result, over.set, over.constraints, channelVideoIntelligenceConfig().maxResultPayloadBytes);
const codes = (result: ChannelVideoIntelligenceResult, over = { set, constraints }) => validate(result, over).map((finding) => finding.code);

describe("CHANNEL_VIDEO_INTELLIGENCE request contract", () => {
  it("accepts a minimal two-cycle horizon", () => {
    const parsed = videoIntelligenceRequestInputSchema.safeParse({
      horizonLabel: FIXTURE_HORIZON_LABEL,
      portfolioSelections: [
        { portfolioWorkflowId: fixtureUuid(1), portfolioRunId: fixtureUuid(2) },
        { portfolioWorkflowId: fixtureUuid(3), portfolioRunId: fixtureUuid(4) },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a single-cycle horizon, because one cycle is not channel-level learning", () => {
    const parsed = videoIntelligenceRequestInputSchema.safeParse({
      horizonLabel: FIXTURE_HORIZON_LABEL,
      portfolioSelections: [{ portfolioWorkflowId: fixtureUuid(1), portfolioRunId: fixtureUuid(2) }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects more than four cycles, the payload ceiling this contract is sized for", () => {
    const parsed = videoIntelligenceRequestInputSchema.safeParse({
      horizonLabel: FIXTURE_HORIZON_LABEL,
      portfolioSelections: Array.from({ length: 5 }, (_, index) => ({ portfolioWorkflowId: fixtureUuid(index), portfolioRunId: fixtureUuid(50 + index) })),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects the same portfolio run selected twice", () => {
    const selection = { portfolioWorkflowId: fixtureUuid(1), portfolioRunId: fixtureUuid(2) };
    expect(videoIntelligenceRequestInputSchema.safeParse({ horizonLabel: "h", portfolioSelections: [selection, selection] }).success).toBe(false);
  });

  it.each([
    ["approvedVideoPortfolioReferences", []],
    ["intelligenceHorizonKey", "forged"],
    ["anchoredStrategyRunId", fixtureUuid(9)],
    ["intelligenceScope", {}],
    ["viewerValueTrend", "IMPROVING"],
    ["humanRevisionNote", "note"],
  ])("rejects a caller trying to inject the server-owned field %s", (key, value) => {
    const parsed = videoIntelligenceRequestInputSchema.safeParse({
      horizonLabel: FIXTURE_HORIZON_LABEL,
      portfolioSelections: [
        { portfolioWorkflowId: fixtureUuid(1), portfolioRunId: fixtureUuid(2) },
        { portfolioWorkflowId: fixtureUuid(3), portfolioRunId: fixtureUuid(4) },
      ],
      [key]: value,
    });
    expect(parsed.success).toBe(false);
  });

  it("requires the persisted horizon key to be the exact server normalization", () => {
    const base = {
      horizonLabel: "  2026 Learning Horizon  ",
      portfolioSelections: [
        { portfolioWorkflowId: fixtureUuid(1), portfolioRunId: fixtureUuid(2) },
        { portfolioWorkflowId: fixtureUuid(3), portfolioRunId: fixtureUuid(4) },
      ],
      approvedVideoPortfolioReferences: set.artifacts.map((artifact) => artifact.reference),
    };
    expect(videoIntelligenceInputSchema.safeParse({ ...base, intelligenceHorizonKey: "2026 learning horizon" }).success).toBe(true);
    expect(videoIntelligenceInputSchema.safeParse({ ...base, intelligenceHorizonKey: "2026 Learning Horizon" }).success).toBe(false);
    expect(videoIntelligenceInputSchema.safeParse({ ...base, intelligenceHorizonKey: "something-else" }).success).toBe(false);
  });
});

describe("CHANNEL_VIDEO_INTELLIGENCE structural contract", () => {
  it("accepts the clean fixture record with no findings", () => {
    expect(codes(buildIntelligenceResult(set))).toEqual([]);
  });

  it("computes deterministic check counts from the rule catalogue, not a hand-maintained constant", () => {
    const qa = videoIntelligenceQA(validate(buildIntelligenceResult(set)));
    expect(qa.passed).toBe(true);
    expect(qa.deterministicChecksPassed).toBe(DETERMINISTIC_VIDEO_INTELLIGENCE_RULES.length);
    expect(qa.deterministicChecksFailed).toBe(0);
  });

  it("forbids a strategy review signal from carrying its own replacement strategy at the type level", () => {
    const signal = {
      signal: "REVISE_RECOMMENDED",
      anchoredStrategyRunId: constraints.anchoredStrategyRunId,
      contradictedElements: [{ element: "POSITIONING", contradictionSummary: "The positioning assumes an audience the evidence never found.", supportingLearningIds: ["learning:pattern-1"] }],
      rationale: "Two cycles contradicted the positioning assumption.",
      humanDecisionRequired: true,
      revisionAuthoredElsewhere: true,
    };
    expect(strategyReviewSignalSchema.safeParse(signal).success).toBe(true);
    expect(strategyReviewSignalSchema.safeParse({ ...signal, humanDecisionRequired: false }).success).toBe(false);
    expect(strategyReviewSignalSchema.safeParse({ ...signal, revisionAuthoredElsewhere: false }).success).toBe(false);
    expect(strategyReviewSignalSchema.safeParse({ ...signal, newPositioning: "We are now a beginner channel." }).success).toBe(false);
  });

  it("requires a revision recommendation to name a contradicted element, and forbids naming one otherwise", () => {
    const base = {
      anchoredStrategyRunId: constraints.anchoredStrategyRunId,
      rationale: "r",
      humanDecisionRequired: true,
      revisionAuthoredElsewhere: true,
    };
    expect(strategyReviewSignalSchema.safeParse({ ...base, signal: "REVISE_RECOMMENDED", contradictedElements: [] }).success).toBe(false);
    expect(strategyReviewSignalSchema.safeParse({ ...base, signal: "HOLD", contradictedElements: [{ element: "POSITIONING", contradictionSummary: "s", supportingLearningIds: ["learning:a"] }] }).success).toBe(false);
  });

  it("requires every contradicted element to cite a learning recorded here", () => {
    const content = buildIntelligenceContent(set, {
      strategyReviewSignal: {
        signal: "REVISE_RECOMMENDED",
        anchoredStrategyRunId: constraints.anchoredStrategyRunId,
        contradictedElements: [{ element: "POSITIONING", contradictionSummary: "Contradicted.", supportingLearningIds: ["learning:not-recorded"] }],
        rationale: "r",
        humanDecisionRequired: true,
        revisionAuthoredElsewhere: true,
      },
    });
    expect(channelLearningRecordSchema.safeParse(content.record).success).toBe(false);
  });

  it("rejects a learning that both supports and contradicts the same cycle", () => {
    expect(() => buildIntelligenceResult(set, { learnings: [buildLearning(1, [...cycleIds], { contradictingCycleIds: [cycleIds[0]] })] })).toThrow();
  });
});

describe("CHANNEL_VIDEO_INTELLIGENCE cross-cycle grounding", () => {
  it("rejects a learning resting on a single cycle", () => {
    const content = buildIntelligenceContent(set, { learnings: [buildLearning(1, [cycleIds[0], cycleIds[0]])] });
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("LEARNING_NOT_CROSS_CYCLE");
  });

  it("rejects a learning citing a cycle outside the resolved horizon", () => {
    const foreign = `cycle:${fixtureUuid(999)}`;
    const content = buildIntelligenceContent(set, { learnings: [buildLearning(1, [cycleIds[0], foreign])] });
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("LEARNING_CITES_UNKNOWN_CYCLE");
  });

  it("rejects a learning claiming more confidence than the horizon evidence ceiling", () => {
    const content = buildIntelligenceContent(set, { learnings: [buildLearning(1, [...cycleIds], { confidence: "high" })] });
    expect(constraints.evidenceCeiling).toBe("medium");
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("CONFIDENCE_EXCEEDS_EVIDENCE_CEILING");
  });

  it("allows high confidence only when every cycle carried a high ceiling", () => {
    const highSet = buildApprovedPortfolioSet([
      buildApprovedPortfolioArtifact(0, { globalConfidenceCeiling: "high" }),
      buildApprovedPortfolioArtifact(1, { globalConfidenceCeiling: "high" }),
    ]);
    const highConstraints = deriveVideoIntelligenceConstraints(highSet, FIXTURE_HORIZON_LABEL);
    const content = buildIntelligenceContent(highSet, { learnings: [buildLearning(1, highConstraints.citableCycleIds, { confidence: "high" })] });
    expect(codes(buildIntelligenceResult(highSet, { content }), { set: highSet, constraints: highConstraints })).toEqual([]);
  });

  it("rejects an observed-pattern claim in a horizon that committed nothing", () => {
    const emptySet = buildApprovedPortfolioSet([
      buildApprovedPortfolioArtifact(0, { commitments: [], committedCount: 0, capacityUtilization: "UNDER_CAPACITY" }),
      buildApprovedPortfolioArtifact(1, { commitments: [], committedCount: 0, capacityUtilization: "UNDER_CAPACITY" }),
    ]);
    const emptyConstraints = deriveVideoIntelligenceConstraints(emptySet, FIXTURE_HORIZON_LABEL);
    const content = buildIntelligenceContent(emptySet, {
      learnings: [buildLearning(1, emptyConstraints.citableCycleIds, { patternClass: "RECURRING_DIAGNOSIS_CATEGORY" })],
    });
    expect(codes(buildIntelligenceResult(emptySet, { content }), { set: emptySet, constraints: emptyConstraints })).toContain("PATTERN_CLASS_NOT_OBSERVED");
  });

  it("still allows an evidence-gap learning in a horizon that committed nothing", () => {
    const emptySet = buildApprovedPortfolioSet([
      buildApprovedPortfolioArtifact(0, { commitments: [], committedCount: 0, capacityUtilization: "UNDER_CAPACITY" }),
      buildApprovedPortfolioArtifact(1, { commitments: [], committedCount: 0, capacityUtilization: "UNDER_CAPACITY" }),
    ]);
    const emptyConstraints = deriveVideoIntelligenceConstraints(emptySet, FIXTURE_HORIZON_LABEL);
    expect(emptyConstraints.viewerValueTrend).toBe("INSUFFICIENT_SIGNAL");
    expect(codes(buildIntelligenceResult(emptySet), { set: emptySet, constraints: emptyConstraints })).toEqual([]);
  });

  it("rejects a duplicated lesson restated under a second id", () => {
    const content = buildIntelligenceContent(set, {
      learnings: [buildLearning(1, [...cycleIds]), buildLearning(2, [...cycleIds])],
    });
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("DUPLICATE_LEARNING_STATEMENT");
  });
});

describe("CHANNEL_VIDEO_INTELLIGENCE Viewer Value doctrine", () => {
  it("has no growth member in the pattern vocabulary, so a growth lesson is unrepresentable", () => {
    // The strongest available guarantee: not "the model was told not to", but
    // "the contract cannot express it". A growth pattern class fails Zod parsing
    // and is terminal in the worker rather than becoming a QA finding.
    expect(intelligencePatternClassSchema.options).not.toContain("AUDIENCE_GROWTH_DRIVER");
    expect(intelligencePatternClassSchema.options.some((option) => /GROWTH|UPSIDE|ROI|REACH|VIRAL/i.test(option))).toBe(false);
    const learning = buildLearning(1, [...cycleIds]);
    expect(() => buildIntelligenceResult(set, { learnings: [{ ...learning, patternClass: "AUDIENCE_GROWTH_DRIVER" as never }] })).toThrow();
  });

  it("never permits a viewer-degrading lesson to become channel practice", () => {
    expect(IMPLICATION_PERMITTED_ADOPTION_STANCES.DEGRADES_VIEWER_EXPERIENCE).not.toContain("ADOPT_AS_CHANNEL_PRACTICE");
    expect(IMPLICATION_PERMITTED_ADOPTION_STANCES.DEGRADES_VIEWER_EXPERIENCE).not.toContain("TREAT_AS_PROVISIONAL");
  });

  it.each([
    ["ADOPT_AS_CHANNEL_PRACTICE"],
    ["TREAT_AS_PROVISIONAL"],
  ])("rejects a viewer-degrading lesson recorded with adoption stance %s", (stance) => {
    const content = buildIntelligenceContent(set, {
      learnings: [buildLearning(1, [...cycleIds], { viewerValueImplication: "DEGRADES_VIEWER_EXPERIENCE", adoptionStance: stance as never })],
    });
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("HARMFUL_PRACTICE_ADOPTED");
  });

  it("accepts a viewer-degrading lesson only when it is rejected as harmful", () => {
    const content = buildIntelligenceContent(set, {
      learnings: [buildLearning(1, [...cycleIds], { viewerValueImplication: "DEGRADES_VIEWER_EXPERIENCE", adoptionStance: "REJECT_AS_HARMFUL" })],
    });
    expect(codes(buildIntelligenceResult(set, { content }))).toEqual([]);
  });

  it("never silently upgrades an unknown viewer-value implication to channel practice", () => {
    const content = buildIntelligenceContent(set, {
      learnings: [buildLearning(1, [...cycleIds], { viewerValueImplication: "UNKNOWN_REQUIRES_EVIDENCE", adoptionStance: "ADOPT_AS_CHANNEL_PRACTICE" })],
    });
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("HARMFUL_PRACTICE_ADOPTED");
  });

  it("rejects a recurring viewer-value-risk pattern recorded as neutral", () => {
    const content = buildIntelligenceContent(set, {
      learnings: [buildLearning(1, [...cycleIds], { patternClass: "VIEWER_VALUE_RISK_RECURS", viewerValueImplication: "NEUTRAL" })],
    });
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("VIEWER_VALUE_IMPLICATION_CONTRADICTS_PATTERN");
  });

  it("rejects a growth-only lesson held with high confidence or adopted as practice", () => {
    const highSet = buildApprovedPortfolioSet([
      buildApprovedPortfolioArtifact(0, { globalConfidenceCeiling: "high" }),
      buildApprovedPortfolioArtifact(1, { globalConfidenceCeiling: "high" }),
    ]);
    const highConstraints = deriveVideoIntelligenceConstraints(highSet, FIXTURE_HORIZON_LABEL);
    const highContent = buildIntelligenceContent(highSet, {
      learnings: [buildLearning(1, highConstraints.citableCycleIds, { justifiedByAudienceGrowthAlone: true, confidence: "high" })],
    });
    expect(codes(buildIntelligenceResult(highSet, { content: highContent }), { set: highSet, constraints: highConstraints })).toContain("GROWTH_ONLY_LEARNING_HIGH_CONFIDENCE");

    const adopted = buildIntelligenceContent(set, {
      learnings: [buildLearning(1, [...cycleIds], { justifiedByAudienceGrowthAlone: true, adoptionStance: "ADOPT_AS_CHANNEL_PRACTICE" })],
    });
    expect(codes(buildIntelligenceResult(set, { content: adopted }))).toContain("GROWTH_ONLY_LEARNING_ADOPTED");
  });

  it.each([
    ["the biggest expected upside came from the cycles that maximised reach"],
    ["what grows the channel is committing whatever drives click-through"],
    ["the fastest path to growth is to boost the channel with more acquisition work"],
  ])("catches an undeclared growth-only argument: %s", (statement) => {
    const content = buildIntelligenceContent(set, {
      learnings: [buildLearning(1, [...cycleIds], { statement, evidenceBasis: "This is what the pattern shows.", justifiedByAudienceGrowthAlone: false })],
    });
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("GROWTH_ONLY_ARGUMENT_UNDECLARED");
  });

  it("does not flag a growth mention that is genuinely anchored in evidence and viewer value", () => {
    const content = buildIntelligenceContent(set, {
      learnings: [buildLearning(1, [...cycleIds], {
        statement: "Cycles that chased the biggest expected upside left the retention evidence gap open.",
        evidenceBasis: "Both cycles committed acquisition-side comparisons and neither closed the constraining unknown about viewer satisfaction.",
        justifiedByAudienceGrowthAlone: false,
      })],
    });
    expect(codes(buildIntelligenceResult(set, { content }))).not.toContain("GROWTH_ONLY_ARGUMENT_UNDECLARED");
  });

  it("bars a growth-only lesson from supporting a strategy review recommendation", () => {
    const learning = buildLearning(1, [...cycleIds], { justifiedByAudienceGrowthAlone: true, adoptionStance: "REQUIRES_MORE_EVIDENCE" });
    const content = buildIntelligenceContent(set, {
      learnings: [learning],
      strategyReviewSignal: {
        signal: "REVISE_RECOMMENDED",
        anchoredStrategyRunId: constraints.anchoredStrategyRunId,
        contradictedElements: [{ element: "POSITIONING", contradictionSummary: "The positioning is contradicted.", supportingLearningIds: [learning.id] }],
        rationale: "The horizon contradicts the positioning.",
        humanDecisionRequired: true,
        revisionAuthoredElsewhere: true,
      },
    });
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("GROWTH_ONLY_STRATEGY_SIGNAL");
  });

  it("bars a low-confidence lesson from carrying a strategy review recommendation", () => {
    const learning = buildLearning(1, [...cycleIds], { confidence: "low" });
    const content = buildIntelligenceContent(set, {
      learnings: [learning],
      strategyReviewSignal: {
        signal: "REVISE_RECOMMENDED",
        anchoredStrategyRunId: constraints.anchoredStrategyRunId,
        contradictedElements: [{ element: "CHANNEL_PROMISE", contradictionSummary: "The promise is contradicted.", supportingLearningIds: [learning.id] }],
        rationale: "The horizon contradicts the promise.",
        humanDecisionRequired: true,
        revisionAuthoredElsewhere: true,
      },
    });
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("REVISION_SIGNAL_WITHOUT_CROSS_CYCLE_EVIDENCE");
  });
});

describe("CHANNEL_VIDEO_INTELLIGENCE Viewer Value trajectory", () => {
  const deteriorating = buildApprovedPortfolioSet([
    buildApprovedPortfolioArtifact(0, { allocatedAt: "2026-01-01T10:00:00.000Z", committedAtRiskCount: 0 }),
    buildApprovedPortfolioArtifact(1, { allocatedAt: "2026-06-01T10:00:00.000Z", committedAtRiskCount: 2, anyCandidateAtRisk: true }),
  ]);
  const deterioratingConstraints = deriveVideoIntelligenceConstraints(deteriorating, FIXTURE_HORIZON_LABEL);

  it("derives the trajectory from committed at-risk rates, never from model prose", () => {
    expect(deterioratingConstraints.viewerValueTrend).toBe("DETERIORATING");
    expect(deriveViewerValueTrend(deteriorating.artifacts.map((artifact) => artifact.cycle))).toBe("DETERIORATING");
    expect(constraints.viewerValueTrend).toBe("STABLE");
  });

  it("orders the chronology by the immutable allocation timestamp", () => {
    const reversed = buildApprovedPortfolioSet([
      buildApprovedPortfolioArtifact(0, { allocatedAt: "2026-09-01T10:00:00.000Z" }),
      buildApprovedPortfolioArtifact(1, { allocatedAt: "2026-02-01T10:00:00.000Z" }),
    ]);
    const ordered = chronological(reversed.artifacts.map((artifact) => artifact.cycle));
    expect(ordered[0].allocatedAt).toBe("2026-02-01T10:00:00.000Z");
    expect(deriveVideoIntelligenceConstraints(reversed, FIXTURE_HORIZON_LABEL).chronology[0]).toBe(ordered[0].cycleId);
  });

  it("forces escalation when the channel commits more at-risk work later in the horizon", () => {
    const content = buildIntelligenceContent(deteriorating, { record: { requiresHumanJudgment: false }, skipServerStamping: true });
    const result = buildIntelligenceResult(deteriorating, { content });
    const found = codes(result, { set: deteriorating, constraints: deterioratingConstraints });
    expect(found).toContain("DETERIORATING_TREND_NOT_ESCALATED");
  });

  it("requires a deteriorating trajectory to be named in the metric-gaming exposure", () => {
    const content = buildIntelligenceContent(deteriorating, {
      viewerValueSafeguards: { metricGamingRisk: "Nothing notable happened across this horizon." },
    });
    expect(codes(buildIntelligenceResult(deteriorating, { content }), { set: deteriorating, constraints: deterioratingConstraints }))
      .toContain("DETERIORATING_TREND_UNGUARDED");
  });

  it("accepts a deteriorating horizon that escalates and names the exposure", () => {
    expect(codes(buildIntelligenceResult(deteriorating), { set: deteriorating, constraints: deterioratingConstraints })).toEqual([]);
  });

  it("refuses to let the model restate the trajectory or the at-risk cycle set", () => {
    const drifted = buildIntelligenceResult(deteriorating, {
      record: { viewerValueTrend: "IMPROVING" },
      viewerValueSafeguards: { trend: "IMPROVING", cyclesWithCommittedAtRiskIds: [] },
      skipServerStamping: true,
    });
    const found = codes(drifted, { set: deteriorating, constraints: deterioratingConstraints });
    expect(found).toContain("VIEWER_VALUE_TREND_MISMATCH");
    expect(found).toContain("VIEWER_VALUE_SAFEGUARDS_MISMATCH");
  });
});

describe("CHANNEL_VIDEO_INTELLIGENCE scope boundary", () => {
  const leak = (text: string) => {
    const content = buildIntelligenceContent(set, {
      learnings: [buildLearning(1, [...cycleIds], { statement: text })],
    });
    return codes(buildIntelligenceResult(set, { content }));
  };

  it.each([
    ["STRATEGY_AUTHORSHIP_LEAKED", "Rewrite the channel strategy around the evidence this horizon produced."],
    ["STRATEGY_AUTHORSHIP_LEAKED", "Redefine the audience as intermediate practitioners rather than beginners."],
    ["STRATEGY_AUTHORSHIP_LEAKED", "The new positioning is the channel that shows the working, not the answer."],
    ["STRATEGY_AUTHORSHIP_LEAKED", "Add a new content pillar covering tooling walkthroughs."],
    ["STRATEGY_AUTHORSHIP_LEAKED", "Reposition the channel as a research-first outlet."],
    ["CONTENT_BACKLOG_LEAKED", "The next video should be a walkthrough of the measurement setup."],
    ["CONTENT_BACKLOG_LEAKED", "Make a video about how the opening promise is constructed."],
    ["CONTENT_BACKLOG_LEAKED", "Build a topic backlog from the categories this horizon touched."],
    ["RESEARCH_CONCLUSION_INVENTED", "The market is moving toward shorter explanatory formats."],
    ["RESEARCH_CONCLUSION_INVENTED", "Competitors are all publishing the same category of comparison."],
    ["RESEARCH_CONCLUSION_INVENTED", "Search demand is concentrated in the opening-promise category."],
    ["PORTFOLIO_ALLOCATION_LEAKED", "Next cycle should commit the two remaining comparisons first."],
    ["PORTFOLIO_ALLOCATION_LEAKED", "Allocate the capacity to the retention comparisons rather than the packaging ones."],
    ["PORTFOLIO_ALLOCATION_LEAKED", "Prioritise these experiments in the coming slate."],
    ["EXPERIMENT_REDESIGN_LEAKED", "Change the primary metric on the opening-promise comparison to a retention reading."],
    ["EXPERIMENT_REDESIGN_LEAKED", "Redesign the experiment so the control is a historical baseline instead."],
    ["DECISION_REWRITTEN_IN_INTELLIGENCE", "The approved decision is mistaken about the category of the problem."],
    ["DECISION_REWRITTEN_IN_INTELLIGENCE", "Re-diagnose the second cycle before drawing anything from it."],
    ["INTELLIGENCE_EXECUTION_LEAKED", "Publish a correction video acknowledging the earlier framing."],
    ["INTELLIGENCE_EXECUTION_LEAKED", "Start a new strategy run to capture this."],
    ["INTELLIGENCE_EXECUTION_LEAKED", "Notify subscribers that the format is changing."],
  ])("rejects %s for: %s", (expected, text) => {
    expect(leak(text)).toContain(expected);
  });

  it("permits NAMING a contradicted strategy element, which is exactly this workflow's output", () => {
    const learning = buildLearning(1, [...cycleIds]);
    const content = buildIntelligenceContent(set, {
      learnings: [learning],
      strategyReviewSignal: {
        signal: "REVISE_RECOMMENDED",
        anchoredStrategyRunId: constraints.anchoredStrategyRunId,
        contradictedElements: [{
          element: "PRIMARY_AUDIENCE",
          contradictionSummary: "Both cycles found the constraining unknown sits with viewers the strategy treats as secondary, which the primary audience assumption does not account for.",
          supportingLearningIds: [learning.id],
        }],
        rationale: "The anchored strategy's audience assumption is contradicted by the evidence this horizon accumulated; a human should decide whether to open a strategy revision.",
        humanDecisionRequired: true,
        revisionAuthoredElsewhere: true,
      },
    });
    expect(codes(buildIntelligenceResult(set, { content }))).toEqual([]);
  });
});

describe("CHANNEL_VIDEO_INTELLIGENCE epistemic discipline", () => {
  const withStatement = (statement: string) => codes(buildIntelligenceResult(set, {
    content: buildIntelligenceContent(set, { learnings: [buildLearning(1, [...cycleIds], { statement })] }),
  }));

  it.each([
    ["FABRICATED_QUANTITY_IN_RECORD", "Retention improved by 12 percent across the horizon."],
    ["FABRICATED_QUANTITY_IN_RECORD", "The pattern held for at least three months of the horizon."],
    ["FABRICATED_QUANTITY_IN_RECORD", "Roughly two thousand viewers were affected."],
    ["FABRICATED_STATISTICAL_CLAIM", "The difference across cycles was statistically significant."],
    ["FABRICATED_RETURN_FORECAST", "Acting on this should double the click-through rate."],
    ["CAUSAL_CERTAINTY_CLAIMED", "A clearer promise is proven to increase satisfaction."],
  ])("rejects %s for: %s", (expected, statement) => {
    expect(withStatement(statement)).toContain(expected);
  });

  it("permits a bare ordinal that labels a cycle rather than measuring anything", () => {
    expect(withStatement("Cycle 2 repeated the same category of comparison as cycle 1 without closing the unknown."))
      .not.toContain("FABRICATED_QUANTITY_IN_RECORD");
  });
});

describe("CHANNEL_VIDEO_INTELLIGENCE trust boundary and derived fields", () => {
  it("rejects an altered upstream reference set", () => {
    const result = buildIntelligenceResult(set);
    const tampered = { ...result, approvedVideoPortfolioReferences: [result.approvedVideoPortfolioReferences[0], { ...result.approvedVideoPortfolioReferences[1], finalQaScore: 1 }] };
    expect(codes(tampered as ChannelVideoIntelligenceResult)).toContain("UPSTREAM_REFERENCE_ALTERED");
  });

  it("rejects an altered intelligence scope", () => {
    const result = buildIntelligenceResult(set);
    const tampered = { ...result, intelligenceScope: { ...result.intelligenceScope, facts: [result.intelligenceScope.facts[0]] } };
    expect(codes(tampered as ChannelVideoIntelligenceResult)).toContain("INTELLIGENCE_SCOPE_ALTERED");
  });

  it("rejects altered constraints", () => {
    const result = buildIntelligenceResult(set);
    const tampered = { ...result, intelligenceConstraints: { ...result.intelligenceConstraints, evidenceCeiling: "high" as const } };
    expect(codes(tampered as ChannelVideoIntelligenceResult)).toContain("CONSTRAINTS_ALTERED");
  });

  it("rejects a strategy signal anchored to a different strategy run", () => {
    const content = buildIntelligenceContent(set, {
      strategyReviewSignal: {
        signal: "HOLD",
        anchoredStrategyRunId: fixtureUuid(777),
        contradictedElements: [],
        rationale: "r",
        humanDecisionRequired: true,
        revisionAuthoredElsewhere: true,
      },
    });
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("STRATEGY_SIGNAL_ANCHOR_MISMATCH");
  });

  it("rejects a horizon whose cycles do not share the anchored strategy", () => {
    const mixed = buildApprovedPortfolioSet([
      buildApprovedPortfolioArtifact(0),
      buildApprovedPortfolioArtifact(1),
    ]);
    const mixedConstraints = deriveVideoIntelligenceConstraints(mixed, FIXTURE_HORIZON_LABEL);
    const drifted = { ...mixedConstraints, cycles: [mixedConstraints.cycles[0], { ...mixedConstraints.cycles[1], strategyRunId: fixtureUuid(888) }] };
    const result = buildIntelligenceResult(mixed);
    const tampered = { ...result, intelligenceConstraints: drifted };
    expect(codes(tampered as ChannelVideoIntelligenceResult, { set: mixed, constraints: drifted })).toContain("STRATEGY_ANCHOR_NOT_SHARED");
  });

  it.each([
    ["LEARNING_COUNT_MISMATCH", { learningCount: 5 }],
    ["CYCLES_CONSIDERED_MISMATCH", { cyclesConsidered: 4 }],
    ["HORIZON_LABEL_MISMATCH", { horizonLabel: "Some other horizon" }],
    ["REQUIRES_HUMAN_JUDGMENT_MISMATCH", { requiresHumanJudgment: true }],
  ])("rejects tampered server-derived field: %s", (expected, record) => {
    const result = buildIntelligenceResult(set, { record, skipServerStamping: true });
    expect(codes(result)).toContain(expected);
  });

  it("rejects a tampered readiness flag", () => {
    const content = { ...buildIntelligenceContent(set), intelligenceReady: false };
    expect(codes(buildIntelligenceResult(set, { content }))).toContain("INTELLIGENCE_READY_MISMATCH");
  });

  it("derives readiness from structure rather than accepting a model claim", () => {
    const content = buildIntelligenceContent(set);
    expect(deriveIntelligenceReady(content.record, constraints)).toBe(true);
    expect(deriveIntelligenceReady({ ...content.record, viewerValueGuardrails: [] }, constraints)).toBe(false);
    expect(deriveIntelligenceReady({ ...content.record, openQuestions: [] }, constraints)).toBe(false);
  });

  it("rejects a source block that disagrees with the resolved cycles", () => {
    const result = buildIntelligenceResult(set);
    const tampered = { ...result, source: { ...result.source, cycleCount: 3, anchoredStrategyRunId: fixtureUuid(555) } };
    expect(codes(tampered as ChannelVideoIntelligenceResult)).toContain("SOURCE_IDENTITY_MISMATCH");
  });

  it("rejects a critic-blocked record and a same-provider model pair", () => {
    const result = buildIntelligenceResult(set);
    expect(codes({ ...result, crossModelReview: { ...result.crossModelReview, safeToFinalize: false } } as ChannelVideoIntelligenceResult)).toContain("CRITIC_REJECTED_INTELLIGENCE");
    expect(codes({ ...result, modelProvenance: [result.modelProvenance[0], { ...result.modelProvenance[1], provider: "openai" }] } as ChannelVideoIntelligenceResult)).toContain("MODEL_PROVIDER_INDEPENDENCE_REQUIRED");
  });

  it("requires at least one genuinely different alternative signal", () => {
    const content = buildIntelligenceContent(set, {
      alternatives: [{ id: "alt:same", statement: "Hold, as recorded.", signal: "HOLD", notSelectedBecause: "REDUNDANT", notSelectedReason: "It is the same conclusion." }],
    });
    const found = codes(buildIntelligenceResult(set, { content }));
    expect(found).toContain("MISSING_ALTERNATIVE");
    expect(found).toContain("ALTERNATIVE_CITES_UNKNOWN_SIGNAL");
  });
});

describe("CHANNEL_VIDEO_INTELLIGENCE payload discipline", () => {
  /** The widest legal horizon: four cycles, six commitments each, six learnings, four alternatives. */
  const maximal = buildApprovedPortfolioSet(Array.from({ length: 4 }, (_, index) => buildApprovedPortfolioArtifact(index, {
    concurrentExperimentSlots: 6,
    candidateCount: 6,
    committedCount: 6,
    commitments: Array.from({ length: 6 }, (_, slot) => buildCommitment(index * 10 + slot)),
  })));
  const maximalConstraints = deriveVideoIntelligenceConstraints(maximal, FIXTURE_HORIZON_LABEL);
  const maximalCycleIds = maximalConstraints.citableCycleIds;
  const pad = (text: string, length: number) => text.padEnd(length, " x").slice(0, length);
  const maximalResult = buildIntelligenceResult(maximal, {
    learnings: Array.from({ length: 6 }, (_, index) => buildLearning(index + 1, [...maximalCycleIds], {
      statement: pad(`Distinct channel-level lesson number ${index + 1} about the recurring evidence gap.`, 700),
      evidenceBasis: pad("Every cycle in the horizon carried the same decision-bound comparison category without closing it.", 1_000),
      whatWouldFalsifyThis: pad("A cycle closing the unknown without a further comparison would falsify this.", 600),
    })),
    alternatives: Array.from({ length: 4 }, (_, index) => ({
      id: `alt:option-${index}`,
      statement: pad(`Alternative reading number ${index} of the same horizon.`, 900),
      signal: "REVISE_RECOMMENDED" as const,
      notSelectedBecause: "PREMATURE" as const,
      notSelectedReason: pad("The horizon narrows uncertainty without contradicting a named strategy element.", 700),
    })),
  });

  it("keeps the maximal-fan-out result inside the pre-persistence payload ceiling", () => {
    const bytes = Buffer.byteLength(JSON.stringify(maximalResult), "utf8");
    expect(bytes).toBeLessThanOrEqual(channelVideoIntelligenceConfig().maxResultPayloadBytes);
  });

  it("keeps the maximal-fan-out final-QA step ENVELOPE inside the database ceiling", () => {
    // The regression Portfolio paid for: `result` fitting maxResultPayloadBytes is
    // not sufficient, because the persisted envelope re-serializes crossModelReview.
    const qa = videoIntelligenceQA(deterministicVideoIntelligenceValidation(maximalResult, maximal, maximalConstraints));
    const bytes = videoIntelligenceQaStepEnvelopeBytes({ qa, crossModelReview: maximalResult.crossModelReview, result: maximalResult });
    expect(bytes).toBeLessThanOrEqual(WORKFLOW_STEP_OUTPUT_CEILING_BYTES);
  });

  it("rejects a result above the configured ceiling deterministically", () => {
    expect(deterministicVideoIntelligenceValidation(maximalResult, maximal, maximalConstraints, 100).map((finding) => finding.code))
      .toContain("RESULT_PAYLOAD_TOO_LARGE");
  });
});
