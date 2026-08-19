import { describe, expect, it } from "vitest";
import {
  deterministicVideoBriefValidation,
  hasUnrevisableVideoBriefFailure,
  mergeVideoBriefQA,
  newlyIntroducedVideoBriefErrors,
} from "./video-brief-validation";
import {
  approvedContentArtifactFixture,
  CITABLE_QA_EVIDENCE_ID,
  videoBriefResultFixture,
} from "./video-brief-fixtures.test-helper";
import { viewerValueFixture } from "./content-fixtures.test-helper";

const MAX_BYTES = 60_000;
const validate = (result: unknown, upstream = approvedContentArtifactFixture) =>
  deterministicVideoBriefValidation(result, upstream, MAX_BYTES);
const codes = (result: unknown) => validate(result).filter((f) => f.severity === "error").map((f) => f.code);

describe("deterministic video brief validation", () => {
  it("accepts a clean brief with no deterministic errors", () => {
    const findings = validate(videoBriefResultFixture());
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  describe("upstream identity and provenance", () => {
    it("rejects a changed upstream content-intelligence reference", () => {
      const result = videoBriefResultFixture({
        upstreamContentIntelligence: { ...approvedContentArtifactFixture.reference, finalQaScore: 99 },
      });
      expect(codes(result)).toContain("UPSTREAM_CONTENT_REFERENCE_CHANGED");
    });

    it("tolerates key reordering in the upstream reference", () => {
      const reference = approvedContentArtifactFixture.reference;
      const reordered = Object.fromEntries(Object.entries(reference).reverse()) as typeof reference;
      const result = videoBriefResultFixture({ upstreamContentIntelligence: reordered });
      expect(codes(result)).not.toContain("UPSTREAM_CONTENT_REFERENCE_CHANGED");
    });

    it("rejects an altered selected-topic identity", () => {
      const result = videoBriefResultFixture({
        selectedTopic: { ...approvedContentArtifactFixture.selection, backlogRank: 4 },
      });
      expect(codes(result)).toContain("SELECTED_TOPIC_IDENTITY_CHANGED");
    });

    it("rejects altered Viewer Value provenance", () => {
      const selection = approvedContentArtifactFixture.selection;
      const result = videoBriefResultFixture({
        selectedTopic: {
          ...selection,
          inheritedViewerValueProvenance: { ...selection.inheritedViewerValueProvenance, contractHash: "d".repeat(64) },
        },
      });
      expect(codes(result)).toContain("VIEWER_VALUE_PROVENANCE_ALTERED");
    });

    it("rejects a source that cites a different topic or pillar", () => {
      const base = videoBriefResultFixture();
      expect(codes(videoBriefResultFixture({ source: { ...base.source, topicId: "topic:something-else" } }))).toContain("SOURCE_TOPIC_MISMATCH");
      expect(codes(videoBriefResultFixture({ source: { ...base.source, pillarId: "pillar:unrelated" } }))).toContain("SOURCE_PILLAR_MISMATCH");
    });
  });

  describe("evidence integrity", () => {
    it("rejects evidence IDs outside the approved upstream bundle", () => {
      const base = videoBriefResultFixture();
      const result = videoBriefResultFixture({
        source: { ...base.source, sourceEvidenceIds: ["yt:video:fabricated1"] },
      });
      expect(codes(result)).toContain("EVIDENCE_REFERENCE_NOT_FOUND");
    });

    it("rejects a SUPPORTED claim that cites no evidence", () => {
      const base = videoBriefResultFixture();
      const items = base.evidencePlan.items.map((item) =>
        item.claimId === "claim:principle-level-coverage" ? { ...item, evidenceIds: [] } : item);
      const result = videoBriefResultFixture({ evidencePlan: { ...base.evidencePlan, items } });
      expect(codes(result)).toContain("UNSUPPORTED_CLAIM_MISSING_RESEARCH_STATE");
    });

    it("rejects a RESEARCH_REQUIRED claim with no research note", () => {
      const base = videoBriefResultFixture();
      const items = base.evidencePlan.items.map((item) =>
        item.status === "RESEARCH_REQUIRED" ? { ...item, researchNote: null } : item);
      const result = videoBriefResultFixture({ evidencePlan: { ...base.evidencePlan, items } });
      expect(codes(result)).toContain("RESEARCH_REQUIRED_MISSING_NOTE");
    });

    it("rejects duplicate claim identities", () => {
      const base = videoBriefResultFixture();
      const items = [...base.evidencePlan.items, { ...base.evidencePlan.items[0] }];
      const result = videoBriefResultFixture({ evidencePlan: { ...base.evidencePlan, items } });
      expect(codes(result)).toContain("DUPLICATE_CLAIM_IDENTITY");
    });

    it("rejects a beat that plans to make a MUST_NOT_CLAIM claim", () => {
      const base = videoBriefResultFixture();
      const beats = base.contentArchitecture.beats.map((beat) =>
        beat.sectionId === "beat:model" ? { ...beat, claimIds: ["claim:no-gaps-guarantee"] } : beat);
      const result = videoBriefResultFixture({ contentArchitecture: { ...base.contentArchitecture, beats } });
      expect(codes(result)).toContain("BEAT_USES_FORBIDDEN_CLAIM");
    });

    it("rejects a beat referencing an unknown claim", () => {
      const base = videoBriefResultFixture();
      const beats = base.contentArchitecture.beats.map((beat) =>
        beat.sectionId === "beat:model" ? { ...beat, claimIds: ["claim:not-declared"] } : beat);
      const result = videoBriefResultFixture({ contentArchitecture: { ...base.contentArchitecture, beats } });
      expect(codes(result)).toContain("BEAT_CLAIM_UNKNOWN");
    });
  });

  describe("content architecture", () => {
    it("rejects duplicate section identities", () => {
      const base = videoBriefResultFixture();
      const beats = [...base.contentArchitecture.beats, { ...base.contentArchitecture.beats[0] }];
      const result = videoBriefResultFixture({ contentArchitecture: { ...base.contentArchitecture, beats } });
      expect(codes(result)).toContain("DUPLICATE_SECTION_IDENTITY");
    });

    it("rejects a payoff location that is not a defined beat", () => {
      const base = videoBriefResultFixture();
      const result = videoBriefResultFixture({
        contentArchitecture: { ...base.contentArchitecture, payoffLocation: "beat:nowhere" },
      });
      expect(codes(result)).toContain("MALFORMED_CONTENT_ARCHITECTURE");
    });

    it("rejects a hook payoff location that is not a defined beat", () => {
      const base = videoBriefResultFixture();
      const result = videoBriefResultFixture({
        hookStrategy: { ...base.hookStrategy, payoffLocation: "beat:nowhere" },
      });
      expect(codes(result)).toContain("HOOK_PAYOFF_LOCATION_UNKNOWN");
    });

    it("rejects retention planning that references an unknown section", () => {
      const base = videoBriefResultFixture();
      const result = videoBriefResultFixture({
        retentionArchitecture: {
          ...base.retentionArchitecture,
          dragRisks: [{ sectionId: "beat:ghost", risk: "Drags.", mitigation: "Tighten." }],
        },
      });
      expect(codes(result)).toContain("RETENTION_SECTION_UNKNOWN");
    });
  });

  describe("viewer promise", () => {
    it.each([
      "You will learn everything you need to know about staff scheduling today.",
      "The ultimate guide to rotas, covering all you need to know about scheduling.",
    ])("rejects a vague promise: %s", (statement) => {
      const base = videoBriefResultFixture();
      const result = videoBriefResultFixture({ viewerPromise: { ...base.viewerPromise, statement } });
      expect(codes(result)).toContain("VIEWER_PROMISE_VAGUE");
    });

    it("accepts a specific, checkable promise", () => {
      expect(codes(videoBriefResultFixture())).not.toContain("VIEWER_PROMISE_VAGUE");
    });
  });

  describe("viewer value doctrine", () => {
    it("rejects a brief whose deterministic floor is REJECT", () => {
      const base = viewerValueFixture();
      const result = videoBriefResultFixture({
        viewerValue: viewerValueFixture({
          gate: "REJECT",
          contract: { ...base.contract, trustworthiness: { verdict: "absent", rationale: "No credibility basis.", evidenceIds: [] } },
        }),
      });
      expect(codes(result)).toContain("VIEWER_VALUE_GATE_REJECTED");
    });

    it("rejects a model claiming PASS over a deterministic REJECT", () => {
      const base = viewerValueFixture();
      const result = videoBriefResultFixture({
        viewerValue: viewerValueFixture({
          gate: "PASS",
          contract: { ...base.contract, trustworthiness: { verdict: "weak", rationale: "Thin.", evidenceIds: [] } },
        }),
      });
      expect(codes(result)).toContain("VIEWER_VALUE_GATE_UNDERSTATED");
    });

    it("rejects a blocking content-integrity finding", () => {
      const result = videoBriefResultFixture({
        viewerValue: viewerValueFixture({
          gate: "REJECT",
          integrityFindings: [{ risk: "FABRICATED_STATISTIC", label: null, severity: "blocking", explanation: "Invented figure.", evidenceIds: [] }],
        }),
      });
      expect(codes(result)).toContain("CONTENT_INTEGRITY_BLOCKING_RISK");
    });

    it("rejects an absent original contribution", () => {
      const base = viewerValueFixture();
      const result = videoBriefResultFixture({
        viewerValue: viewerValueFixture({
          gate: "REVISE",
          contract: {
            ...base.contract,
            originalContribution: {
              ...base.contract.originalContribution,
              assessment: { verdict: "absent", rationale: "Restates existing videos.", evidenceIds: [] },
            },
          },
        }),
      });
      expect(codes(result)).toContain("ORIGINAL_CONTRIBUTION_MISSING");
    });
  });

  describe("hook honesty and monetization", () => {
    it("rejects a hook concept with material deception risk", () => {
      const base = videoBriefResultFixture();
      const result = videoBriefResultFixture({
        hookStrategy: {
          ...base.hookStrategy,
          concepts: [{ ...base.hookStrategy.concepts[0], deceptionRisk: "material" }],
        },
      });
      expect(codes(result)).toContain("DECEPTIVE_HOOK");
    });

    it("rejects monetization that competes with viewer value", () => {
      const base = videoBriefResultFixture();
      const result = videoBriefResultFixture({
        monetizationAlignment: { ...base.monetizationAlignment, viewerValueImpact: "competes" },
      });
      expect(codes(result)).toContain("MONETIZATION_OVERRIDES_VIEWER_VALUE");
    });

    it("accepts NONE monetization as a legitimate answer", () => {
      expect(codes(videoBriefResultFixture())).not.toContain("MONETIZATION_OVERRIDES_VIEWER_VALUE");
    });
  });

  describe("fabrication guards", () => {
    const withText = (text: string) => videoBriefResultFixture({ assumptions: [text] });

    it.each([
      ["FABRICATED_PERFORMANCE_PREDICTION", "This will reach 50000 views within the first month."],
      ["FABRICATED_REVENUE_PREDICTION", "Expect an RPM of $12 on this topic."],
      ["FABRICATED_SEARCH_VOLUME", "This keyword has 40000 monthly searches."],
      ["FABRICATED_RETENTION_PREDICTION", "Retention will be around 65% through the midpoint."],
      ["UNSUPPORTED_MONETARY_GUARANTEE", "Viewers are guaranteed to save $500 a month."],
    ])("rejects %s", (code, text) => {
      expect(codes(withText(text))).toContain(code);
    });

    it("does not flag a legitimate price mention in a topic subject", () => {
      expect(codes(withText("The scheduling tools mentioned cost under $5 per month."))).not.toContain("FABRICATED_REVENUE_PREDICTION");
    });
  });

  describe("downstream scope boundaries", () => {
    const withText = (text: string) => videoBriefResultFixture({ assumptions: [text] });

    it.each([
      ["TITLE_SCOPE_VIOLATION", "The final title is: Stop Overpaying For Hosting."],
      ["THUMBNAIL_SCOPE_VIOLATION", "Generate a thumbnail showing the crossover chart."],
      ["STORYBOARD_SCOPE_VIOLATION", "Produce a storyboard for the demonstration beat."],
      ["SCRIPT_SCOPE_VIOLATION", "Write the script for the opening beat."],
      ["PUBLISHING_SCOPE_VIOLATION", "This brief is ready to publish."],
    ])("rejects %s", (code, text) => {
      expect(codes(withText(text))).toContain(code);
    });

    it("does not flag a video legitimately about thumbnails as a subject", () => {
      const findings = codes(withText("The viewer already understands how thumbnail click-through works."));
      expect(findings).not.toContain("THUMBNAIL_SCOPE_VIOLATION");
    });
  });

  describe("confidence bounds", () => {
    it("rejects declaring evidence sufficient to script when upstream QA is weak", () => {
      const upstream = {
        ...approvedContentArtifactFixture,
        reference: { ...approvedContentArtifactFixture.reference, finalQaScore: 70 },
      };
      const base = videoBriefResultFixture();
      const result = videoBriefResultFixture({
        upstreamContentIntelligence: upstream.reference,
        evidencePlan: { ...base.evidencePlan, sufficiency: "SUFFICIENT_TO_SCRIPT" },
      });
      const found = deterministicVideoBriefValidation(result, upstream, MAX_BYTES).map((f) => f.code);
      expect(found).toContain("CONFIDENCE_EXCEEDS_UPSTREAM_EVIDENCE");
    });

    it("warns when the upstream discovery bundle is partial", () => {
      const upstream = {
        ...approvedContentArtifactFixture,
        discoveryBundle: { ...approvedContentArtifactFixture.discoveryBundle, completionStatus: "partial" as const },
      };
      const base = videoBriefResultFixture();
      const result = videoBriefResultFixture({ evidencePlan: { ...base.evidencePlan, sufficiency: "SUFFICIENT_TO_SCRIPT" } });
      const found = deterministicVideoBriefValidation(result, upstream, MAX_BYTES);
      expect(found.some((f) => f.code === "CONFIDENCE_EXCEEDS_PARTIAL_DISCOVERY" && f.severity === "warning")).toBe(true);
    });
  });

  it("rejects an oversized durable payload before persistence is attempted", () => {
    const findings = deterministicVideoBriefValidation(videoBriefResultFixture(), approvedContentArtifactFixture, 200);
    expect(findings.map((f) => f.code)).toContain("RESULT_PAYLOAD_TOO_LARGE");
  });
});

describe("unrevisable failures", () => {
  it.each([
    "UPSTREAM_CONTENT_REFERENCE_CHANGED",
    "SELECTED_TOPIC_IDENTITY_CHANGED",
    "VIEWER_VALUE_PROVENANCE_ALTERED",
    "VIEWER_VALUE_GATE_REJECTED",
    "CONTENT_INTEGRITY_BLOCKING_RISK",
    "UNSUPPORTED_MONETARY_GUARANTEE",
    "FABRICATED_SEARCH_VOLUME",
    "EVIDENCE_REFERENCE_NOT_FOUND",
  ])("fails closed on %s", (code) => {
    expect(hasUnrevisableVideoBriefFailure([{ severity: "error", code, message: "x", evidenceIds: [] }])).toBe(true);
  });

  it("treats weak viewer value as revisable", () => {
    expect(hasUnrevisableVideoBriefFailure([{ severity: "error", code: "VIEWER_PROMISE_VAGUE", message: "x", evidenceIds: [] }])).toBe(false);
  });

  it("ignores warnings of an otherwise unrevisable code", () => {
    expect(hasUnrevisableVideoBriefFailure([{ severity: "warning", code: "VIEWER_VALUE_GATE_REJECTED", message: "x", evidenceIds: [] }])).toBe(false);
  });
});

describe("newly introduced errors", () => {
  const finding = (code: string, message = "m", evidenceIds: string[] = []) => ({ severity: "error" as const, code, message, evidenceIds });

  it("detects an error the revision introduced", () => {
    expect(newlyIntroducedVideoBriefErrors([finding("A")], [finding("A"), finding("B")]).map((f) => f.code)).toEqual(["B"]);
  });

  it("does not treat a pre-existing error as newly introduced", () => {
    expect(newlyIntroducedVideoBriefErrors([finding("A")], [finding("A")])).toEqual([]);
  });

  it("distinguishes the same rule violated in a different place", () => {
    const before = [finding("DUPLICATE_SECTION_IDENTITY", "beat:one repeats")];
    const after = [finding("DUPLICATE_SECTION_IDENTITY", "beat:two repeats")];
    expect(newlyIntroducedVideoBriefErrors(before, after)).toHaveLength(1);
  });
});

describe("merged QA", () => {
  const usage = { model: "test", inputTokens: 10, outputTokens: 10, totalTokens: 20 };

  it("passes a clean brief with a high semantic score", () => {
    const merged = mergeVideoBriefQA([], { score: 92, recommendation: "accept", findings: [] }, usage, approvedContentArtifactFixture);
    expect(merged.passed).toBe(true);
    expect(merged.deterministicChecksFailed).toBe(0);
  });

  it("cannot pass while a deterministic error stands, regardless of semantic score", () => {
    const deterministic = [{ severity: "error" as const, code: "VIEWER_PROMISE_VAGUE", message: "Vague.", evidenceIds: [] }];
    const merged = mergeVideoBriefQA(deterministic, { score: 100, recommendation: "accept", findings: [] }, usage, approvedContentArtifactFixture);
    expect(merged.passed).toBe(false);
    expect(merged.deterministicChecksFailed).toBe(1);
  });

  it("turns a QA claim citing unknown evidence into its own error", () => {
    const merged = mergeVideoBriefQA(
      [],
      { score: 95, recommendation: "accept", findings: [{ severity: "warning", code: "SOME_CONCERN", message: "x", evidenceIds: ["yt:video:notreal"] }] },
      usage,
      approvedContentArtifactFixture,
    );
    expect(merged.passed).toBe(false);
  });

  it("accepts a QA finding citing known upstream evidence", () => {
    const merged = mergeVideoBriefQA(
      [],
      { score: 95, recommendation: "accept", findings: [{ severity: "info", code: "NOTE", message: "x", evidenceIds: [CITABLE_QA_EVIDENCE_ID] }] },
      usage,
      approvedContentArtifactFixture,
    );
    expect(merged.passed).toBe(true);
  });
});
