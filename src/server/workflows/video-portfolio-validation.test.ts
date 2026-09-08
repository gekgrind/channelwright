import { describe, expect, it } from "vitest";
import { channelVideoPortfolioResultSchema, type ApprovedVideoExperimentSet, type ChannelVideoPortfolioResult, type PortfolioAllocationItem } from "@/domain/production-workflows";
import {
  committedItems,
  deriveConfoundCollisionGroups,
  deriveVideoPortfolioConstraints,
  DISPOSITION_PERMITTED_SELECTION_BASES,
  derivePortfolioReady,
  derivePortfolioRequiresHumanJudgment,
} from "./video-portfolio-candidates";
import {
  buildApprovedExperimentSet,
  buildPortfolioContent,
  buildPortfolioResult,
  FIXTURE_CYCLE_LABEL,
} from "./video-portfolio-fixtures.test-helper";
import { channelVideoPortfolioConfig, WORKFLOW_STEP_OUTPUT_CEILING_BYTES } from "./video-portfolio-config";
import {
  DETERMINISTIC_VIDEO_PORTFOLIO_RULES,
  deterministicVideoPortfolioValidation,
  videoPortfolioQA,
  videoPortfolioQaStepEnvelopeBytes,
} from "./video-portfolio-validation";

/** `complete_workflow_step`'s hard `octet_length(p_output::text)` limit. Not a preference — a database constraint. */
const DATABASE_STEP_OUTPUT_CEILING = WORKFLOW_STEP_OUTPUT_CEILING_BYTES;

function validate(result: ChannelVideoPortfolioResult, set: ApprovedVideoExperimentSet, slots = 1) {
  return deterministicVideoPortfolioValidation(result, set, deriveVideoPortfolioConstraints(set, FIXTURE_CYCLE_LABEL, slots));
}

function codesFor(result: ChannelVideoPortfolioResult, set: ApprovedVideoExperimentSet, slots = 1) {
  return validate(result, set, slots).filter((finding) => finding.severity === "error").map((finding) => finding.code);
}

/** Builds a result whose allocation items are supplied verbatim, with server stamping applied as the executor would. */
function resultWithItems(set: ApprovedVideoExperimentSet, items: PortfolioAllocationItem[], slots = 1, extra: Parameters<typeof buildPortfolioContent>[2] = {}) {
  return buildPortfolioResult(set, slots, { ...extra, items });
}

const baseSet = () => buildApprovedExperimentSet([{}, {}]);

/** A valid capacity-deferred item for the candidate at `index`, for tests that hand-build the committed item. */
function deferredItem(set: ApprovedVideoExperimentSet, index: number): PortfolioAllocationItem {
  const candidate = set.artifacts[index].candidate;
  return {
    candidateId: candidate.candidateId,
    disposition: "DEFERRED",
    rank: null,
    selectionBasis: "CAPACITY_EXHAUSTED",
    rationale: "The declared cycle capacity is already committed, so this run waits rather than diluting either reading.",
    viewerValueDisposition: candidate.viewerValueState === "AT_RISK"
      ? "ESCALATED_FOR_HUMAN_JUDGMENT"
      : candidate.viewerValueState === "UNKNOWN"
        ? "UNKNOWN_REQUIRES_EVIDENCE"
        : "PRESERVED_NO_ACTION_NEEDED",
    justifiedByPredictedGrowthAlone: false,
    revisitCondition: "Revisit when a committed run reaches its interpretation point and frees the slot.",
    citedCandidateIds: [],
  };
}

describe("CHANNEL_VIDEO_PORTFOLIO deterministic validation", () => {
  describe("rule catalogue", () => {
    it("derives its counts from the catalogue itself and keeps every rule blocking with a unique code", () => {
      const codes = DETERMINISTIC_VIDEO_PORTFOLIO_RULES.map((rule) => rule.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect(DETERMINISTIC_VIDEO_PORTFOLIO_RULES.every((rule) => rule.severity === "error")).toBe(true);
      const qa = videoPortfolioQA([]);
      expect(qa.deterministicChecksPassed).toBe(DETERMINISTIC_VIDEO_PORTFOLIO_RULES.length);
      expect(qa.deterministicChecksFailed).toBe(0);
    });

    it("counts distinct failed codes, not findings, so one broken rule cannot inflate the failure count", () => {
      const qa = videoPortfolioQA([
        { severity: "error", code: "CANDIDATE_NOT_ALLOCATED", message: "a", evidenceIds: [] },
        { severity: "error", code: "CANDIDATE_NOT_ALLOCATED", message: "b", evidenceIds: [] },
      ]);
      expect(qa.deterministicChecksFailed).toBe(1);
      expect(qa.deterministicChecksPassed).toBe(DETERMINISTIC_VIDEO_PORTFOLIO_RULES.length - 1);
      expect(qa.passed).toBe(false);
      expect(qa.recommendation).toBe("revise");
    });

    it("every rule runs even when an earlier one fails, so a first failure never masks a later one", () => {
      const set = baseSet();
      const result = buildPortfolioResult(set, 1);
      const broken = structuredClone(result);
      broken.content.allocation.items = [broken.content.allocation.items[0]];
      broken.content.allocation.objective = "Expect a lift of 30 percent within four weeks.";
      const codes = new Set(codesFor(broken, set));
      expect(codes.has("CANDIDATE_NOT_ALLOCATED")).toBe(true);
      expect(codes.has("FABRICATED_QUANTITY_IN_ALLOCATION")).toBe(true);
    });
  });

  describe("happy path", () => {
    it("accepts a well-formed allocation inside capacity", () => {
      const set = baseSet();
      const result = buildPortfolioResult(set, 1);
      expect(codesFor(result, set)).toEqual([]);
      expect(result.content.portfolioReady).toBe(true);
      expect(result.content.allocation.capacityUtilization).toBe("AT_CAPACITY");
    });

    it("accepts an under-capacity allocation that deliberately leaves a slot open", () => {
      const set = baseSet();
      const result = buildPortfolioResult(set, 2, {
        items: [
          { ...buildPortfolioContent(set, 1).allocation.items[0] },
          {
            candidateId: set.artifacts[1].candidate.candidateId,
            disposition: "EXCLUDED",
            rank: null,
            selectionBasis: "REDUNDANT_WITH_COMMITTED",
            rationale: "This run would re-measure the same uncertainty the committed run already closes.",
            viewerValueDisposition: "PRESERVED_NO_ACTION_NEEDED",
            justifiedByPredictedGrowthAlone: false,
            revisitCondition: null,
            citedCandidateIds: [set.artifacts[0].candidate.candidateId],
          },
        ],
      });
      expect(codesFor(result, set, 2)).toEqual([]);
      expect(result.content.allocation.capacityUtilization).toBe("UNDER_CAPACITY");
    });
  });

  describe("upstream integrity", () => {
    it("rejects a rewritten approved-Experiment reference set", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.approvedVideoExperimentReferences[0].finalQaScore = 42;
      expect(codesFor(result, set)).toContain("UPSTREAM_EXPERIMENT_REFERENCES_CHANGED");
    });

    it("rejects a rewritten portfolio scope", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.portfolioScope.facts[0].value = "OBSERVATIONAL_PROBE";
      expect(codesFor(result, set)).toContain("PORTFOLIO_SCOPE_CHANGED");
    });

    it("rejects rewritten server-derived constraints, including a widened slot count", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.portfolioConstraints.concurrentExperimentSlots = 6;
      expect(codesFor(result, set)).toContain("PORTFOLIO_CONSTRAINTS_CHANGED");
    });

    it("rejects a source summary that disagrees with the resolved candidate set", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.source.candidateCount = 1;
      result.source.experimentRunIds = [result.source.experimentRunIds[0]];
      expect(codesFor(result, set)).toContain("SOURCE_SUMMARY_MISMATCH");
    });

    it("rejects a candidate whose reference is not portfolio-eligible", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      (result.approvedVideoExperimentReferences[0] as { portfolioEligible: unknown }).portfolioEligible = false;
      expect(codesFor(result, set)).toContain("CANDIDATE_NOT_PORTFOLIO_ELIGIBLE");
    });
  });

  describe("allocation coverage and capacity", () => {
    it("rejects a silently dropped candidate", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.items = [result.content.allocation.items[0]];
      result.content.allocation.deferredCount = 0;
      expect(codesFor(result, set)).toContain("CANDIDATE_NOT_ALLOCATED");
    });

    it("rejects an allocation naming a candidate that was never resolved", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.items[1].candidateId = "cand:00000000-0000-4000-a000-000000000000";
      const codes = codesFor(result, set);
      expect(codes).toContain("UNKNOWN_CANDIDATE_ALLOCATED");
      expect(codes).toContain("CANDIDATE_NOT_ALLOCATED");
    });

    it("rejects committing more experiments than the operator declared slots", () => {
      const set = baseSet();
      const result = resultWithItems(set, [
        { ...buildPortfolioContent(set, 2).allocation.items[0] },
        { ...buildPortfolioContent(set, 2).allocation.items[1] },
      ], 1);
      expect(codesFor(result, set, 1)).toContain("CAPACITY_EXCEEDED");
    });

    it("rejects non-dense committed ranks", () => {
      const set = baseSet();
      const items = buildPortfolioContent(set, 2).allocation.items;
      items[1].rank = 3;
      const result = resultWithItems(set, items, 2);
      expect(codesFor(result, set, 2)).toContain("COMMIT_RANK_INVALID");
    });

    it("rejects hand-edited disposition counts", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.committedCount = 2;
      expect(codesFor(result, set)).toContain("ALLOCATION_COUNTS_MISMATCH");
    });

    it("rejects a mis-stated capacity utilisation", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.capacityUtilization = "UNDER_CAPACITY";
      expect(codesFor(result, set)).toContain("CAPACITY_UTILIZATION_MISMATCH");
    });

    it("rejects a renamed cycle", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.cycleLabel = "a different cycle";
      expect(codesFor(result, set)).toContain("CYCLE_LABEL_MISMATCH");
    });

    it("rejects a deferred item with no revisit condition", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.items[1].revisitCondition = "   ";
      expect(codesFor(result, set)).toContain("DEFERRED_WITHOUT_REVISIT_CONDITION");
    });

    it("rejects a citation to an unresolved candidate and a self-citation", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.items[1].citedCandidateIds = ["cand:00000000-0000-4000-a000-000000000000"];
      expect(codesFor(result, set)).toContain("CITED_CANDIDATE_UNSUPPORTED");
      const selfCiting = structuredClone(buildPortfolioResult(set, 1));
      selfCiting.content.allocation.items[1].citedCandidateIds = [selfCiting.content.allocation.items[1].candidateId];
      expect(codesFor(selfCiting, set)).toContain("CITED_CANDIDATE_UNSUPPORTED");
    });

    it("rejects a redundancy or sequencing claim that names no other candidate", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.items[1].selectionBasis = "REDUNDANT_WITH_COMMITTED";
      result.content.allocation.items[1].citedCandidateIds = [];
      expect(codesFor(result, set)).toContain("CITATION_REQUIRED_BASIS_UNSUPPORTED");
    });
  });

  describe("selection-basis legality", () => {
    it("never lets a capacity, viewer-value-risk, or not-ready basis explain a commitment", () => {
      const set = baseSet();
      for (const basis of ["CAPACITY_EXHAUSTED", "VIEWER_VALUE_RISK", "NOT_READY", "CONFOUND_COLLISION"] as const) {
        const result = structuredClone(buildPortfolioResult(set, 1));
        result.content.allocation.items[0].selectionBasis = basis;
        expect(codesFor(result, set)).toContain("SELECTION_BASIS_ILLEGAL_FOR_DISPOSITION");
      }
    });

    it("keeps every legal basis legal, so the rule is not a blanket rejection", () => {
      const set = baseSet();
      for (const basis of DISPOSITION_PERMITTED_SELECTION_BASES.COMMITTED) {
        const result = structuredClone(buildPortfolioResult(set, 1));
        result.content.allocation.items[0].selectionBasis = basis;
        expect(codesFor(result, set)).not.toContain("SELECTION_BASIS_ILLEGAL_FOR_DISPOSITION");
      }
    });
  });

  describe("confounding", () => {
    it("groups candidates that share a per-video assignment surface", () => {
      const set = buildApprovedExperimentSet([{ topicId: "topic:same-video" }, { topicId: "topic:same-video" }]);
      const groups = deriveConfoundCollisionGroups(set.artifacts.map((artifact) => artifact.candidate));
      expect(groups).toHaveLength(1);
      expect(groups[0].candidateIds).toHaveLength(2);
    });

    it("groups candidates that share a channel-wide assignment surface even across videos", () => {
      const set = buildApprovedExperimentSet([
        { unitOfAssignment: "PUBLISH_WINDOW", topicId: "topic:one" },
        { unitOfAssignment: "PUBLISH_WINDOW", topicId: "topic:two" },
      ]);
      expect(deriveConfoundCollisionGroups(set.artifacts.map((artifact) => artifact.candidate))).toHaveLength(1);
    });

    it("never groups measurement-only probes, which manipulate nothing", () => {
      const set = buildApprovedExperimentSet([
        { measurementOnly: true, unitOfAssignment: "NONE_OBSERVATIONAL", experimentType: "OBSERVATIONAL_PROBE", disposition: "OBSERVE_ONLY", controlKind: "NONE_OBSERVATIONAL", topicId: "topic:same-video" },
        { measurementOnly: true, unitOfAssignment: "NONE_OBSERVATIONAL", experimentType: "OBSERVATIONAL_PROBE", disposition: "OBSERVE_ONLY", controlKind: "NONE_OBSERVATIONAL", topicId: "topic:same-video" },
      ]);
      expect(deriveConfoundCollisionGroups(set.artifacts.map((artifact) => artifact.candidate))).toEqual([]);
    });

    it("rejects committing two experiments that would contaminate each other's reading", () => {
      const set = buildApprovedExperimentSet([{ topicId: "topic:same-video" }, { topicId: "topic:same-video" }]);
      const result = buildPortfolioResult(set, 2);
      const codes = codesFor(result, set, 2);
      expect(codes).toContain("CONFOUND_COLLISION_COMMITTED");
      expect(result.content.portfolioReady).toBe(false);
    });

    it("accepts committing one of a colliding pair and deferring the other", () => {
      const set = buildApprovedExperimentSet([{ topicId: "topic:same-video" }, { topicId: "topic:same-video" }]);
      const result = resultWithItems(set, [
        { ...buildPortfolioContent(set, 1).allocation.items[0] },
        {
          candidateId: set.artifacts[1].candidate.candidateId,
          disposition: "DEFERRED",
          rank: null,
          selectionBasis: "CONFOUND_COLLISION",
          rationale: "Running both on the same video surface at once would make neither reading interpretable.",
          viewerValueDisposition: "PRESERVED_NO_ACTION_NEEDED",
          justifiedByPredictedGrowthAlone: false,
          revisitCondition: "Revisit once the committed run on this video reaches its interpretation point.",
          citedCandidateIds: [set.artifacts[0].candidate.candidateId],
        },
      ], 2);
      expect(codesFor(result, set, 2)).toEqual([]);
    });
  });

  describe("readiness", () => {
    it("rejects committing a candidate Experiment itself marked not ready", () => {
      const set = buildApprovedExperimentSet([{ experimentReady: false }, {}]);
      const result = buildPortfolioResult(set, 1);
      expect(codesFor(result, set)).toContain("NOT_READY_CANDIDATE_COMMITTED");
      expect(result.content.portfolioReady).toBe(false);
    });

    it("still allows a not-ready candidate to be excluded", () => {
      const set = buildApprovedExperimentSet([{}, { experimentReady: false }]);
      const result = resultWithItems(set, [
        { ...buildPortfolioContent(set, 1).allocation.items[0] },
        {
          candidateId: set.artifacts[1].candidate.candidateId,
          disposition: "EXCLUDED",
          rank: null,
          selectionBasis: "NOT_READY",
          rationale: "This design did not clear the structural readiness bar its own workflow enforces.",
          viewerValueDisposition: "PRESERVED_NO_ACTION_NEEDED",
          justifiedByPredictedGrowthAlone: false,
          revisitCondition: "Revisit after a revised design clears its own readiness bar.",
          citedCandidateIds: [],
        },
      ], 1);
      expect(codesFor(result, set)).toEqual([]);
    });
  });

  describe("Viewer Value: an at-risk candidate cannot be laundered into a commitment", () => {
    const atRiskSet = (): ApprovedVideoExperimentSet => buildApprovedExperimentSet([
      { viewerValueState: "AT_RISK", promiseIntegrityRisk: "LIKELY", escalationRequired: true, requiresHumanJudgment: true },
      {},
    ]);

    it("rejects committing an at-risk candidate however careful the surrounding guardrail prose is", () => {
      const set = atRiskSet();
      const result = resultWithItems(set, [
        {
          candidateId: set.artifacts[0].candidate.candidateId,
          disposition: "COMMITTED",
          rank: 1,
          selectionBasis: "DECISION_BOUND_EVIDENCE_GAP",
          rationale: "This run closes the evidence gap blocking the pending decision.",
          viewerValueDisposition: "PRESERVED_NO_ACTION_NEEDED",
          justifiedByPredictedGrowthAlone: false,
          revisitCondition: null,
          citedCandidateIds: [],
        },
        deferredItem(set, 1),
      ], 1, {
        allocation: {
          viewerValueGuardrails: ["Every committed run is watched closely for any sign of viewer harm, and stopped immediately if one appears."],
        },
      });
      expect(codesFor(result, set)).toContain("VIEWER_VALUE_DISPOSITION_CONTRADICTS_PROJECTION");
    });

    it("rejects an at-risk commitment that acknowledges the risk in prose but never escalates", () => {
      const set = atRiskSet();
      const content = buildPortfolioContent(set, 1, {
        items: [
          {
            candidateId: set.artifacts[0].candidate.candidateId,
            disposition: "COMMITTED",
            rank: 1,
            selectionBasis: "DECISION_BOUND_EVIDENCE_GAP",
            rationale: "We know viewer value is at risk here, and we accept that risk for the evidence it buys.",
            viewerValueDisposition: "ESCALATED_FOR_HUMAN_JUDGMENT",
            justifiedByPredictedGrowthAlone: false,
            revisitCondition: null,
            citedCandidateIds: [],
          },
          deferredItem(set, 1),
        ],
      });
      // Force the escalation flag back off, exactly as a model claiming "we
      // already said it in prose" would.
      content.allocation.requiresHumanJudgment = false;
      const result = buildPortfolioResult(set, 1, { content });
      const codes = codesFor(result, set);
      expect(codes).toContain("AT_RISK_CANDIDATE_COMMITTED_WITHOUT_ESCALATION");
      expect(codes).toContain("REQUIRES_HUMAN_JUDGMENT_MISMATCH");
    });

    it("accepts an at-risk commitment only when the slate genuinely escalates", () => {
      const set = atRiskSet();
      const result = resultWithItems(set, [
        {
          candidateId: set.artifacts[0].candidate.candidateId,
          disposition: "COMMITTED",
          rank: 1,
          selectionBasis: "VIEWER_VALUE_PROTECTION",
          rationale: "The promise-integrity uncertainty is exactly what this run is meant to resolve, under human oversight.",
          viewerValueDisposition: "ESCALATED_FOR_HUMAN_JUDGMENT",
          justifiedByPredictedGrowthAlone: false,
          revisitCondition: null,
          citedCandidateIds: [],
        },
        deferredItem(set, 1),
      ], 1);
      expect(codesFor(result, set)).toEqual([]);
      expect(result.content.allocation.requiresHumanJudgment).toBe(true);
      expect(result.content.viewerValueSafeguards.committedAtRiskCandidateIds).toHaveLength(1);
    });

    it("never lets an UNKNOWN viewer-value state be silently upgraded to preserved", () => {
      const set = buildApprovedExperimentSet([{ viewerValueState: "UNKNOWN" }, {}]);
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.items[0].viewerValueDisposition = "PRESERVED_NO_ACTION_NEEDED";
      expect(codesFor(result, set)).toContain("VIEWER_VALUE_DISPOSITION_CONTRADICTS_PROJECTION");
    });

    it("rejects an item recorded as excluded for viewer-value risk that is nonetheless committed or deferred", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.items[1].viewerValueDisposition = "EXCLUDED_FOR_VIEWER_VALUE_RISK";
      expect(codesFor(result, set)).toContain("VIEWER_VALUE_EXCLUSION_CONTRADICTED");
    });

    it("rejects committing a candidate whose own Experiment demanded human judgment, without escalating", () => {
      const set = buildApprovedExperimentSet([{ requiresHumanJudgment: true }, {}]);
      const content = buildPortfolioContent(set, 1);
      content.allocation.requiresHumanJudgment = false;
      const result = buildPortfolioResult(set, 1, { content });
      expect(codesFor(result, set)).toContain("HUMAN_JUDGMENT_CANDIDATE_COMMITTED_WITHOUT_ESCALATION");
    });
  });

  describe("Viewer Value: growth is never a sufficient basis", () => {
    it("rejects a commitment that honestly declares it rests on predicted growth alone", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.items[0].justifiedByPredictedGrowthAlone = true;
      const codes = codesFor(result, set);
      expect(codes).toContain("GROWTH_ONLY_JUSTIFICATION_COMMITTED");
      expect(codes).toContain("PORTFOLIO_READY_MISMATCH");
    });

    it("rejects a growth-only argument that denies being one", () => {
      const set = baseSet();
      for (const rationale of [
        "This has the biggest expected upside for the channel.",
        "Committing this drives subscribers faster than anything else on the slate.",
        "It is the fastest path to growth we have.",
        "Highest projected return of the candidates.",
      ]) {
        const result = structuredClone(buildPortfolioResult(set, 1));
        result.content.allocation.items[0].rationale = rationale;
        expect(codesFor(result, set)).toContain("GROWTH_ONLY_ARGUMENT_UNDECLARED");
      }
    });

    it("does not fire when growth language sits alongside a genuine evidence argument", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.items[0].rationale = "Although the growth upside looks appealing, the reason to commit it is that its evidence can change a pending decision.";
      expect(codesFor(result, set)).not.toContain("GROWTH_ONLY_ARGUMENT_UNDECLARED");
    });

    it("rejects an all-acquisition committed slate with no acknowledged metric-gaming exposure", () => {
      const set = buildApprovedExperimentSet([{ primaryMetric: "IMPRESSION_CLICK_THROUGH_RATE" }, { primaryMetric: "VIEWS" }]);
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.viewerValueSafeguards.metricGamingRisk = "Nothing of concern; the slate is well balanced and low risk.";
      result.content.viewerValueSafeguards.guardedMetricGaming = "The team reviews outcomes carefully at the end of the cycle.";
      expect(codesFor(result, set)).toContain("PORTFOLIO_METRIC_GAMING_UNGUARDED");
    });

    it("accepts an all-acquisition slate that names the exposure honestly", () => {
      const set = buildApprovedExperimentSet([{ primaryMetric: "IMPRESSION_CLICK_THROUGH_RATE" }, { primaryMetric: "VIEWS" }]);
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.viewerValueSafeguards.metricGamingRisk = "Every committed run reads an acquisition metric, so click growth could mask falling satisfaction.";
      result.content.viewerValueSafeguards.guardedMetricGaming = "Retention and satisfaction signals are watched as cycle-level guardrails even though no committed run reads them as primary.";
      expect(codesFor(result, set)).not.toContain("PORTFOLIO_METRIC_GAMING_UNGUARDED");
    });

    it("does not fire the acquisition rule when a retention-side run is committed", () => {
      const set = baseSet();
      expect(codesFor(buildPortfolioResult(set, 1), set)).not.toContain("PORTFOLIO_METRIC_GAMING_UNGUARDED");
    });
  });

  describe("epistemic discipline", () => {
    it("rejects fabricated quantities across every model-authored prose surface", () => {
      const set = baseSet();
      const cases: Array<[string, (result: ChannelVideoPortfolioResult) => void]> = [
        ["objective", (result) => { result.content.allocation.objective = "Reach 40 percent average percentage viewed this cycle."; }],
        ["hypothesis", (result) => { result.content.allocation.allocationHypothesis = "Two weeks of exposure will be enough to read the result."; }],
        ["rationale", (result) => { result.content.allocation.items[0].rationale = "We need at least 500 viewers before this is interpretable."; }],
        ["sequencing", (result) => { result.content.allocation.sequencingNotes = "Stagger the starts by 3 days."; }],
        ["guardrail", (result) => { result.content.allocation.viewerValueGuardrails = ["Stop if satisfaction falls by five points."]; }],
        ["risk", (result) => { result.content.allocation.portfolioRisks[0].risk = "A sample of forty viewers is too small."; }],
        ["alternative", (result) => { result.content.alternatives[0].notSelectedReason = "It would need thirty percent more capacity."; }],
        ["safeguards", (result) => { result.content.viewerValueSafeguards.metricGamingRisk = "Click-through could rise 12% while satisfaction falls."; }],
      ];
      for (const [label, mutate] of cases) {
        const result = structuredClone(buildPortfolioResult(set, 1));
        mutate(result);
        expect(codesFor(result, set), label).toContain("FABRICATED_QUANTITY_IN_ALLOCATION");
      }
    });

    it("allows ordinal labels and structural counts, which are not measurements", () => {
      const set = baseSet();
      for (const text of [
        "Rank 1 starts first and rank 2 follows once a slot frees.",
        "This is the phase 2 slate for the programme.",
        "The cycle carries 2 experiments in total.",
        "Reviewed at the 2026 planning checkpoint.",
      ]) {
        const result = structuredClone(buildPortfolioResult(set, 1));
        result.content.allocation.sequencingNotes = text;
        expect(codesFor(result, set), text).not.toContain("FABRICATED_QUANTITY_IN_ALLOCATION");
      }
    });

    it("rejects forecast and ROI language even without a digit", () => {
      const set = baseSet();
      for (const text of [
        "This candidate has the highest expected ROI of the slate.",
        "We expect a meaningful lift from committing this.",
        "Projected growth justifies the ordering.",
        "Committing this will double retention.",
      ]) {
        const result = structuredClone(buildPortfolioResult(set, 1));
        result.content.allocation.allocationHypothesis = text;
        expect(codesFor(result, set), text).toContain("FABRICATED_RETURN_FORECAST");
      }
    });

    it("rejects causal-certainty claims about an untested design", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.objective = "The reworked opening is guaranteed to increase retention this cycle.";
      expect(codesFor(result, set)).toContain("CAUSAL_CERTAINTY_CLAIMED");
    });
  });

  describe("scope boundary", () => {
    const leaks: Array<[string, string]> = [
      ["PORTFOLIO_EXECUTION_LEAKED", "Publish the winning variant as soon as the read is in."],
      ["PORTFOLIO_EXECUTION_LEAKED", "Connect the YouTube account so the change can go live."],
      ["EXPERIMENT_REDESIGN_LEAKED", "Change the primary metric on the committed run to click-through."],
      ["EXPERIMENT_REDESIGN_LEAKED", "Drop the guardrail so the comparison reads faster."],
      ["DECISION_REWRITTEN_IN_PORTFOLIO", "The approved decision is premature and should be revisited."],
      ["DECISION_REWRITTEN_IN_PORTFOLIO", "Re-diagnose the video before allocating anything."],
      ["INTELLIGENCE_RESPONSIBILITY_LEAKED", "Rewrite the channel strategy around this cycle's findings."],
      ["INTELLIGENCE_RESPONSIBILITY_LEAKED", "Redefine the audience so these runs make more sense."],
    ];

    it.each(leaks)("rejects %s", (code, text) => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.sequencingNotes = text;
      expect(codesFor(result, set)).toContain(code);
    });

    it("does not reject ordinary allocation prose that merely mentions an experiment", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.sequencingNotes = "The committed experiment runs first; the deferred experiment waits for its slot without changing anything about its own design.";
      expect(codesFor(result, set)).toEqual([]);
    });
  });

  describe("derived-field tampering", () => {
    it("rejects a hand-set portfolioReady", () => {
      const set = buildApprovedExperimentSet([{ experimentReady: false }, {}]);
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.portfolioReady = true;
      expect(codesFor(result, set)).toContain("PORTFOLIO_READY_MISMATCH");
    });

    it("rejects rewritten viewer-value safeguards", () => {
      const set = buildApprovedExperimentSet([{ viewerValueState: "AT_RISK", escalationRequired: true }, {}]);
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.viewerValueSafeguards.anyCandidateAtRisk = false;
      result.content.viewerValueSafeguards.escalationRequired = false;
      result.content.viewerValueSafeguards.committedAtRiskCandidateIds = [];
      expect(codesFor(result, set)).toContain("VIEWER_VALUE_SAFEGUARDS_MISMATCH");
    });
  });

  describe("alternatives and model authority", () => {
    it("rejects an alternative that merely restates the committed set", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.alternatives[0].committedCandidateIds = committedItems(result.content.allocation).map((item) => item.candidateId);
      expect(codesFor(result, set)).toContain("MISSING_ALTERNATIVE");
    });

    it("rejects an alternative naming a candidate that was never resolved", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.alternatives[0].committedCandidateIds = ["cand:00000000-0000-4000-a000-000000000000"];
      expect(codesFor(result, set)).toContain("ALTERNATIVE_CITES_UNKNOWN_CANDIDATE");
    });

    it("rejects finalizing over a blocking critic finding", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.crossModelReview.safeToFinalize = false;
      expect(codesFor(result, set)).toContain("CRITIC_REJECTED_PORTFOLIO");
    });

    it("rejects an allocator and critic served by the same provider", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.modelProvenance[1].provider = result.modelProvenance[0].provider;
      expect(codesFor(result, set)).toContain("MODEL_PROVIDER_INDEPENDENCE_REQUIRED");
    });

    it("rejects a result over the pre-persistence payload ceiling", () => {
      const set = baseSet();
      const result = buildPortfolioResult(set, 1);
      const findings = deterministicVideoPortfolioValidation(result, set, deriveVideoPortfolioConstraints(set, FIXTURE_CYCLE_LABEL, 1), 10);
      expect(findings.map((finding) => finding.code)).toContain("RESULT_PAYLOAD_TOO_LARGE");
    });
  });

  describe("payload sizing at maximum fan-out", () => {
    const sixCandidates = () => buildApprovedExperimentSet(Array.from({ length: 6 }, (_, index) => ({ topicId: `topic:video-${index}` })));

    it("keeps the validate step's resolved candidate set inside the database step-output ceiling", () => {
      const bytes = Buffer.byteLength(JSON.stringify(sixCandidates()), "utf8");
      expect(bytes).toBeLessThan(DATABASE_STEP_OUTPUT_CEILING);
      // Real headroom, not a hairline pass: a title may be up to 200 characters
      // where the fixture uses ~30, and the ceiling is a hard database limit.
      expect(bytes).toBeLessThan(DATABASE_STEP_OUTPUT_CEILING * 0.8);
    });

    it("keeps a six-candidate allocation inside the pre-persistence ceiling with room for real prose", () => {
      const set = sixCandidates();
      const result = buildPortfolioResult(set, 6);
      const structural = Buffer.byteLength(JSON.stringify(result), "utf8");
      const ceiling = channelVideoPortfolioConfig().maxResultPayloadBytes;
      expect(ceiling).toBeLessThan(DATABASE_STEP_OUTPUT_CEILING);
      expect(structural).toBeLessThan(ceiling);
      expect(ceiling - structural).toBeGreaterThan(15_000);
      expect(codesFor(result, set, 6)).not.toContain("RESULT_PAYLOAD_TOO_LARGE");
    });

    it("carries the flat upstream summary rather than a nested reference chain per candidate", () => {
      const reference = sixCandidates().artifacts[0].reference;
      expect(Object.keys(reference.upstreamVideoDecision).sort()).toEqual([
        "decisionArtifactHash", "decisionProvenanceHash", "decisionRunId", "decisionType", "decisionWorkflowId", "experimentEligible",
      ]);
      expect(reference.upstreamVideoDecision).not.toHaveProperty("upstreamVideoDiagnosis");
    });

    // F2: the persisted QA step output is `{ qa, crossModelReview, result }`, not
    // `result` alone. `crossModelReview` is serialized twice -- standalone and
    // inside `result` -- so the envelope can breach the database step-output
    // ceiling even when `result` passes `maxResultPayloadBytes`.
    it("measures the QA step envelope, which is always larger than the result it wraps", () => {
      const set = sixCandidates();
      const result = buildPortfolioResult(set, 1);
      const envelope = { qa: videoPortfolioQA(deterministicVideoPortfolioValidation(result, set, deriveVideoPortfolioConstraints(set, FIXTURE_CYCLE_LABEL, 1))), crossModelReview: result.crossModelReview, result };
      const envelopeBytes = videoPortfolioQaStepEnvelopeBytes(envelope);
      const resultBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
      expect(envelopeBytes).toBeGreaterThan(resultBytes + Buffer.byteLength(JSON.stringify(result.crossModelReview), "utf8"));
      expect(envelopeBytes).toBeLessThanOrEqual(DATABASE_STEP_OUTPUT_CEILING);
    });

    it("a legal near-limit result plus a legal multi-finding critic review overflows the step-output ceiling", () => {
      const cfg = channelVideoPortfolioConfig();
      const set = sixCandidates();
      const base = buildPortfolioResult(set, 1);
      const findings = Array.from({ length: 13 }, (_, index) => ({
        code: `REVIEW_NOTE_${String(index).padStart(3, "0")}`,
        severity: "warning" as const,
        affectedField: "content.allocation.items",
        rationale: `Non-blocking reviewer note ${index}. `.padEnd(900, "x").slice(0, 900),
        evidenceRefs: [] as string[],
      }));
      const oversized = channelVideoPortfolioResultSchema.parse({
        ...base,
        crossModelReview: { ...base.crossModelReview, outcome: "CRITIC_RAISED_ISSUE" as const, findings, summary: "s".repeat(2_500) },
      });
      const constraints = deriveVideoPortfolioConstraints(set, FIXTURE_CYCLE_LABEL, 1);
      // The result on its own is still accepted by the deterministic validator...
      expect(deterministicVideoPortfolioValidation(oversized, set, constraints, cfg.maxResultPayloadBytes).filter((f) => f.severity === "error")).toEqual([]);
      expect(Buffer.byteLength(JSON.stringify(oversized), "utf8")).toBeLessThanOrEqual(cfg.maxResultPayloadBytes);
      // ...but the full persisted envelope is over the database ceiling.
      const envelopeBytes = videoPortfolioQaStepEnvelopeBytes({ qa: videoPortfolioQA([]), crossModelReview: oversized.crossModelReview, result: oversized });
      expect(envelopeBytes).toBeGreaterThan(DATABASE_STEP_OUTPUT_CEILING);
    });
  });

  describe("doctrinal outcomes", () => {
    it("accepts a cycle that deliberately commits nothing", () => {
      const set = baseSet();
      const result = resultWithItems(set, set.artifacts.map((artifact) => ({
        candidateId: artifact.candidate.candidateId,
        disposition: "DEFERRED" as const,
        rank: null,
        selectionBasis: "SEQUENCING_DEPENDENCY" as const,
        rationale: "Both runs depend on evidence a currently-running measurement has not produced yet.",
        viewerValueDisposition: "PRESERVED_NO_ACTION_NEEDED" as const,
        justifiedByPredictedGrowthAlone: false,
        revisitCondition: "Revisit once the outstanding measurement lands.",
        citedCandidateIds: [set.artifacts[0].candidate.candidateId === artifact.candidate.candidateId ? set.artifacts[1].candidate.candidateId : set.artifacts[0].candidate.candidateId],
      })), 1);
      expect(codesFor(result, set)).toEqual([]);
      expect(result.content.allocation.committedCount).toBe(0);
      expect(result.content.portfolioReady).toBe(true);
    });

    it("rejects a preserved candidate recorded as uncertain, so states are never drifted in either direction", () => {
      const set = baseSet();
      const result = structuredClone(buildPortfolioResult(set, 1));
      result.content.allocation.items[0].viewerValueDisposition = "UNKNOWN_REQUIRES_EVIDENCE";
      expect(codesFor(result, set)).toContain("VIEWER_VALUE_DISPOSITION_CONTRADICTS_PROJECTION");
    });

    it("rejects duplicated committed ranks", () => {
      const set = baseSet();
      const items = buildPortfolioContent(set, 2).allocation.items;
      items[1].rank = 1;
      expect(codesFor(resultWithItems(set, items, 2), set, 2)).toContain("COMMIT_RANK_INVALID");
    });
  });

  describe("derivation helpers", () => {
    it("takes the lowest candidate confidence as the cycle ceiling", () => {
      const set = buildApprovedExperimentSet([{ confidenceInDesign: "high" }, { confidenceInDesign: "low" }]);
      expect(deriveVideoPortfolioConstraints(set, FIXTURE_CYCLE_LABEL, 1).globalConfidenceCeiling).toBe("low");
    });

    it("escalates the cycle whenever any candidate is at risk, committed or not", () => {
      const set = buildApprovedExperimentSet([{}, { viewerValueState: "AT_RISK" }]);
      expect(deriveVideoPortfolioConstraints(set, FIXTURE_CYCLE_LABEL, 1).viewerValueEscalationRequired).toBe(true);
      const result = buildPortfolioResult(set, 1);
      expect(derivePortfolioRequiresHumanJudgment(result.content.allocation, result.portfolioConstraints)).toBe(true);
      expect(codesFor(result, set)).toEqual([]);
    });

    it("reports readiness false whenever any structural clause fails", () => {
      const set = baseSet();
      const constraints = deriveVideoPortfolioConstraints(set, FIXTURE_CYCLE_LABEL, 1);
      const allocation = structuredClone(buildPortfolioResult(set, 1).content.allocation);
      expect(derivePortfolioReady(allocation, constraints)).toBe(true);
      allocation.viewerValueGuardrails = [];
      expect(derivePortfolioReady(allocation, constraints)).toBe(false);
    });
  });
});
