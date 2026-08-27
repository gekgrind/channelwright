import { describe, expect, it } from "vitest";
import {
  DETERMINISTIC_VIDEO_SCRIPT_RULE_COUNT,
  deterministicVideoScriptValidation,
  hasUnrevisableVideoScriptFailure,
  mergeVideoScriptQA,
  newlyIntroducedVideoScriptErrors,
} from "./video-script-validation";
import {
  approvedVideoBriefArtifactFixture,
  CITABLE_QA_EVIDENCE_ID,
  videoScriptResultFixture,
} from "./video-script-fixtures.test-helper";
import { viewerValueFixture } from "./content-fixtures.test-helper";

const MAX_BYTES = 60_000;
const validate = (result: unknown, upstream = approvedVideoBriefArtifactFixture) =>
  deterministicVideoScriptValidation(result, upstream, MAX_BYTES);
const codes = (result: unknown) => validate(result).filter((f) => f.severity === "error").map((f) => f.code);
const warnings = (result: unknown) => validate(result).filter((f) => f.severity === "warning").map((f) => f.code);

describe("deterministic video script validation", () => {
  it("accepts a clean script with no deterministic errors", () => {
    const findings = validate(videoScriptResultFixture());
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  describe("upstream identity and provenance", () => {
    it("rejects a changed upstream video-brief reference", () => {
      const result = videoScriptResultFixture({
        upstreamVideoBrief: { ...approvedVideoBriefArtifactFixture.reference, finalQaScore: 99 },
      });
      expect(codes(result)).toContain("UPSTREAM_BRIEF_REFERENCE_CHANGED");
    });

    it("tolerates key reordering in the upstream reference", () => {
      const reference = approvedVideoBriefArtifactFixture.reference;
      const reordered = Object.fromEntries(Object.entries(reference).reverse()) as typeof reference;
      expect(codes(videoScriptResultFixture({ upstreamVideoBrief: reordered }))).not.toContain("UPSTREAM_BRIEF_REFERENCE_CHANGED");
    });

    it("rejects an altered script scope or viewer-value provenance", () => {
      const scope = approvedVideoBriefArtifactFixture.scope;
      expect(codes(videoScriptResultFixture({ scriptScope: { ...scope, pillarId: "pillar:unrelated" } }))).toContain("SCRIPT_SCOPE_IDENTITY_CHANGED");
      expect(codes(videoScriptResultFixture({
        scriptScope: { ...scope, inheritedViewerValueProvenance: { ...scope.inheritedViewerValueProvenance, contractHash: "d".repeat(64) } },
      }))).toContain("VIEWER_VALUE_PROVENANCE_ALTERED");
    });

    it("rejects a source that cites a different topic or pillar", () => {
      const base = videoScriptResultFixture();
      expect(codes(videoScriptResultFixture({ source: { ...base.source, briefTopicId: "topic:something-else" } }))).toContain("SOURCE_TOPIC_MISMATCH");
      expect(codes(videoScriptResultFixture({ source: { ...base.source, pillarId: "pillar:unrelated" } }))).toContain("SOURCE_PILLAR_MISMATCH");
    });

    it("rejects a scripted promise that diverges from the brief promise", () => {
      const base = videoScriptResultFixture();
      const result = videoScriptResultFixture({ source: { ...base.source, scriptedPromise: "A quietly different promise that still reads as a sentence." } });
      expect(codes(result)).toContain("SCRIPTED_PROMISE_DIVERGES");
    });
  });

  describe("evidence and claim discipline", () => {
    it("rejects evidence IDs outside the inherited discovery bundle", () => {
      const base = videoScriptResultFixture();
      const sections = base.sections.map((section, index) => index === 1 ? { ...section, evidenceIds: ["yt:video:fabricated1"] } : section);
      expect(codes(videoScriptResultFixture({ sections }))).toContain("EVIDENCE_REFERENCE_NOT_FOUND");
    });

    it("rejects narrating a MUST_NOT_CLAIM claim", () => {
      const base = videoScriptResultFixture();
      const sections = base.sections.map((section) => section.sectionId === "scriptsec:payoff" ? { ...section, claimIds: ["claim:no-gaps-guarantee"] } : section);
      // The claim is still recorded as OMITTED in claimUsage, so this is purely the section narration violation.
      expect(codes(videoScriptResultFixture({ sections }))).toContain("SCRIPT_USES_FORBIDDEN_CLAIM");
    });

    it("rejects a MUST_NOT_CLAIM claim that is not omitted in claim usage", () => {
      const base = videoScriptResultFixture();
      const claimUsage = base.claimUsage.map((usage) => usage.claimId === "claim:no-gaps-guarantee"
        ? { ...usage, treatment: "ASSERTED_AS_FACT" as const, scriptSectionIds: ["scriptsec:model"] }
        : usage);
      expect(codes(videoScriptResultFixture({ claimUsage }))).toContain("FORBIDDEN_CLAIM_NOT_OMITTED");
    });

    it("rejects asserting a RESEARCH_REQUIRED claim as established fact", () => {
      const base = videoScriptResultFixture();
      const claimUsage = base.claimUsage.map((usage) => usage.claimId === "claim:hours-lost-weekly"
        ? { ...usage, treatment: "ASSERTED_AS_FACT" as const }
        : usage);
      expect(codes(videoScriptResultFixture({ claimUsage }))).toContain("UNPROVEN_CLAIM_ASSERTED_AS_FACT");
    });

    it("rejects an inherited status that disagrees with the approved brief", () => {
      const base = videoScriptResultFixture();
      const claimUsage = base.claimUsage.map((usage) => usage.claimId === "claim:hours-lost-weekly"
        ? { ...usage, inheritedStatus: "SUPPORTED" as const }
        : usage);
      expect(codes(videoScriptResultFixture({ claimUsage }))).toContain("INHERITED_CLAIM_STATUS_ALTERED");
    });

    it("rejects a narrated claim with no claim-usage record", () => {
      const base = videoScriptResultFixture();
      const claimUsage = base.claimUsage.filter((usage) => usage.claimId !== "claim:hours-lost-weekly");
      expect(codes(videoScriptResultFixture({ claimUsage }))).toContain("SECTION_CLAIM_NOT_TRACKED");
    });
  });

  describe("content architecture mapping", () => {
    it("rejects a section mapped to an unknown brief beat", () => {
      const base = videoScriptResultFixture();
      const sections = base.sections.map((section, index) => index === 2 ? { ...section, briefBeatId: "beat:not-in-brief" } : section);
      expect(codes(videoScriptResultFixture({ sections }))).toContain("SECTION_BEAT_UNKNOWN");
    });

    it("rejects dropping a brief beat entirely", () => {
      const base = videoScriptResultFixture();
      // Remove the demonstration section; recompute the timeline so only coverage fails.
      const kept = base.sections.filter((section) => section.sectionId !== "scriptsec:worked-example");
      let cursor = 0;
      const sections = kept.map((section) => { const next = { ...section, startSeconds: cursor }; cursor += section.durationSeconds; return next; });
      const result = videoScriptResultFixture({
        sections,
        timing: { ...base.timing, totalDurationSeconds: cursor },
        source: { ...base.source, coveredBriefBeatIds: ["beat:opening", "beat:model", "beat:payoff"] },
      });
      expect(codes(result)).toContain("BEAT_NOT_COVERED");
    });
  });

  describe("opening hook", () => {
    it("rejects a materially deceptive hook", () => {
      const base = videoScriptResultFixture();
      expect(codes(videoScriptResultFixture({ openingHook: { ...base.openingHook, deceptionRisk: "material" } }))).toContain("DECEPTIVE_HOOK");
    });

    it("rejects a hook mapped to a non-opening beat", () => {
      const base = videoScriptResultFixture();
      expect(codes(videoScriptResultFixture({ openingHook: { ...base.openingHook, briefBeatId: "beat:model" } }))).toContain("HOOK_BEAT_NOT_OPENING");
    });
  });

  describe("timing", () => {
    it("rejects a total duration that does not match the section durations", () => {
      const base = videoScriptResultFixture();
      expect(codes(videoScriptResultFixture({ timing: { ...base.timing, totalDurationSeconds: 999 } }))).toContain("TIMING_MISMATCH");
    });

    it("warns on a non-contiguous timeline", () => {
      const base = videoScriptResultFixture();
      const sections = base.sections.map((section) => section.sectionId === "scriptsec:model" ? { ...section, startSeconds: 30 } : section);
      // Keep the total consistent by leaving durations unchanged; only ordering breaks.
      expect(warnings(videoScriptResultFixture({ sections }))).toContain("NONCONTIGUOUS_TIMELINE");
    });
  });

  describe("viewer value gate", () => {
    it("rejects when the deterministic floor is REJECT", () => {
      const rejecting = viewerValueFixture({
        contract: { ...viewerValueFixture().contract, trustworthiness: { verdict: "weak", rationale: "Trust not established.", evidenceIds: [] } },
        gate: "REJECT",
        gateReasons: ["Trust is not established."],
      });
      expect(codes(videoScriptResultFixture({ viewerValue: rejecting }))).toContain("VIEWER_VALUE_GATE_REJECTED");
    });

    it("rejects a gate the model understated", () => {
      const understated = viewerValueFixture({
        contract: { ...viewerValueFixture().contract, differentiation: { verdict: "weak", rationale: "Thin differentiation.", evidenceIds: [] } },
        gate: "PASS",
        gateReasons: ["Optimistic self-assessment."],
      });
      expect(codes(videoScriptResultFixture({ viewerValue: understated }))).toContain("VIEWER_VALUE_GATE_UNDERSTATED");
    });
  });

  describe("scope discipline", () => {
    it("allows spoken narration but rejects downstream production artifacts", () => {
      const base = videoScriptResultFixture();
      const withTitle = videoScriptResultFixture({ recommendedNextAction: "Use the final title: 'The Only Scheduling Method You Need'." });
      expect(codes(withTitle)).toContain("TITLE_SCOPE_VIOLATION");
      const withThumbnail = videoScriptResultFixture({ recommendedNextAction: "Generate a thumbnail with the grid and a red arrow." });
      expect(codes(withThumbnail)).toContain("THUMBNAIL_SCOPE_VIOLATION");
      const withAsset = videoScriptResultFixture({ recommendedNextAction: "Generate the voiceover audio from this narration." });
      expect(codes(withAsset)).toContain("ASSET_GENERATION_SCOPE_VIOLATION");
      const withPublish = videoScriptResultFixture({ recommendedNextAction: "Upload the video to the channel on Friday." });
      expect(codes(withPublish)).toContain("PUBLISHING_SCOPE_VIOLATION");
      // The clean fixture, which is full of spoken narration, is not a scope violation.
      expect(codes(base)).not.toContain("SCRIPT_SCOPE_VIOLATION" as never);
    });

    it("rejects fabricated performance, revenue, search-volume, and retention claims", () => {
      expect(codes(videoScriptResultFixture({ recommendedNextAction: "This will get 100k views in a week." }))).toContain("FABRICATED_PERFORMANCE_PREDICTION");
      expect(codes(videoScriptResultFixture({ recommendedNextAction: "Creators earn $5000 per month from this." }))).toContain("FABRICATED_REVENUE_PREDICTION");
      expect(codes(videoScriptResultFixture({ recommendedNextAction: "This topic gets 40000 monthly searches." }))).toContain("FABRICATED_SEARCH_VOLUME");
      expect(codes(videoScriptResultFixture({ recommendedNextAction: "Expect 65% audience retention." }))).toContain("FABRICATED_RETENTION_PREDICTION");
    });
  });

  it("rejects an oversized payload before persistence", () => {
    const base = videoScriptResultFixture();
    const bloated = videoScriptResultFixture({ assumptions: [base.assumptions[0], "x".repeat(390)] });
    expect(deterministicVideoScriptValidation(bloated, approvedVideoBriefArtifactFixture, 400).map((f) => f.code)).toContain("RESULT_PAYLOAD_TOO_LARGE");
  });
});

describe("video script QA merge and revision gating", () => {
  const usage = { model: "qa", inputTokens: 10, outputTokens: 10, totalTokens: 20 };

  it("passes when there are no errors and the score clears the threshold", () => {
    const merged = mergeVideoScriptQA([], { score: 90, recommendation: "accept", findings: [] }, usage, approvedVideoBriefArtifactFixture);
    expect(merged.passed).toBe(true);
    expect(merged.deterministicChecksPassed).toBe(DETERMINISTIC_VIDEO_SCRIPT_RULE_COUNT);
  });

  it("fails and forces revision when a deterministic error is present", () => {
    const deterministic = deterministicVideoScriptValidation(
      videoScriptResultFixture({ timing: { ...videoScriptResultFixture().timing, totalDurationSeconds: 999 } }),
      approvedVideoBriefArtifactFixture, MAX_BYTES,
    );
    const merged = mergeVideoScriptQA(deterministic, { score: 90, recommendation: "accept", findings: [] }, usage, approvedVideoBriefArtifactFixture);
    expect(merged.passed).toBe(false);
    expect(merged.recommendation).toBe("revise");
  });

  it("drops QA evidence IDs outside the inherited bundle", () => {
    const merged = mergeVideoScriptQA([], {
      score: 88, recommendation: "accept",
      findings: [{ severity: "warning", code: "SOFT_NOTE", message: "note", evidenceIds: ["yt:video:unknownxxxxx"] }],
    }, usage, approvedVideoBriefArtifactFixture);
    expect(merged.findings.some((f) => f.code === "QA_EVIDENCE_REFERENCE_NOT_FOUND")).toBe(true);
  });

  it("classifies integrity failures as unrevisable", () => {
    const deterministic = deterministicVideoScriptValidation(
      videoScriptResultFixture({ upstreamVideoBrief: { ...approvedVideoBriefArtifactFixture.reference, finalQaScore: 12 } }),
      approvedVideoBriefArtifactFixture, MAX_BYTES,
    );
    expect(hasUnrevisableVideoScriptFailure(deterministic)).toBe(true);
  });

  it("does not classify a plain timing error as unrevisable", () => {
    const deterministic = deterministicVideoScriptValidation(
      videoScriptResultFixture({ timing: { ...videoScriptResultFixture().timing, totalDurationSeconds: 999 } }),
      approvedVideoBriefArtifactFixture, MAX_BYTES,
    );
    expect(hasUnrevisableVideoScriptFailure(deterministic)).toBe(false);
  });

  it("detects newly introduced errors between a draft and a revision", () => {
    const before = deterministicVideoScriptValidation(videoScriptResultFixture(), approvedVideoBriefArtifactFixture, MAX_BYTES);
    const after = deterministicVideoScriptValidation(
      videoScriptResultFixture({ timing: { ...videoScriptResultFixture().timing, totalDurationSeconds: 999 } }),
      approvedVideoBriefArtifactFixture, MAX_BYTES,
    );
    expect(newlyIntroducedVideoScriptErrors(before, after).map((f) => f.code)).toContain("TIMING_MISMATCH");
  });

  it("accepts a QA finding that cites an inherited evidence ID", () => {
    const merged = mergeVideoScriptQA([], {
      score: 82, recommendation: "accept",
      findings: [{ severity: "info", code: "GOOD_EVIDENCE", message: "cited", evidenceIds: [CITABLE_QA_EVIDENCE_ID] }],
    }, usage, approvedVideoBriefArtifactFixture);
    expect(merged.findings.some((f) => f.code === "QA_EVIDENCE_REFERENCE_NOT_FOUND")).toBe(false);
  });
});

// Regressions for the Codex-reported repairs.
describe("Viewer Value REVISE cannot pass QA (defect #2)", () => {
  const usage = { model: "qa", inputTokens: 10, outputTokens: 10, totalTokens: 20 };
  const reviseFloor = viewerValueFixture({
    // differentiation weak → deterministic floor resolves to REVISE, not REJECT.
    contract: { ...viewerValueFixture().contract, differentiation: { verdict: "weak", rationale: "Thin.", evidenceIds: [] } },
    gate: "REVISE",
    gateReasons: ["Differentiation is weak."],
  });

  it("emits VIEWER_VALUE_GATE_REVISION_REQUIRED as an error", () => {
    expect(codes(videoScriptResultFixture({ viewerValue: reviseFloor }))).toContain("VIEWER_VALUE_GATE_REVISION_REQUIRED");
  });

  it("cannot report passed=true even with an optimistic semantic accept", () => {
    const deterministic = validate(videoScriptResultFixture({ viewerValue: reviseFloor }));
    const merged = mergeVideoScriptQA(deterministic, { score: 100, recommendation: "accept", findings: [] }, usage, approvedVideoBriefArtifactFixture);
    expect(merged.passed).toBe(false);
    expect(merged.recommendation).toBe("revise");
  });

  it("keeps a REVISE floor revisable (bounded revision gets a chance)", () => {
    const deterministic = validate(videoScriptResultFixture({ viewerValue: reviseFloor }));
    expect(hasUnrevisableVideoScriptFailure(deterministic)).toBe(false);
  });
});

describe("claim integrity cannot be detached from narration (defect #3)", () => {
  const brief = approvedVideoBriefArtifactFixture.briefResult;
  const cleanUsage = videoScriptResultFixture().claimUsage;

  it("rejects omitting a brief claim from claim usage entirely", () => {
    const claimUsage = cleanUsage.filter((u) => u.claimId !== "claim:no-gaps-guarantee");
    // The forbidden claim is silently dropped from metadata; completeness catches it.
    expect(codes(videoScriptResultFixture({ claimUsage }))).toContain("CLAIM_USAGE_INCOMPLETE");
  });

  it("rejects forbidden guarantee narration even when claimIds are empty", () => {
    const base = videoScriptResultFixture();
    const sections = base.sections.map((s) => s.sectionId === "scriptsec:payoff"
      ? { ...s, narration: "And that is the whole method. This system guarantees there will be no scheduling gaps, ever.", claimIds: [] }
      : s);
    const found = codes(videoScriptResultFixture({ sections }));
    expect(found).toContain("UNSUPPORTED_OUTCOME_GUARANTEE");
  });

  it("treats a narrated outcome guarantee as unrevisable", () => {
    const base = videoScriptResultFixture();
    const sections = base.sections.map((s) => s.sectionId === "scriptsec:payoff"
      ? { ...s, narration: "This system guarantees there will be no scheduling gaps.", claimIds: [] }
      : s);
    expect(hasUnrevisableVideoScriptFailure(validate(videoScriptResultFixture({ sections })))).toBe(true);
  });

  it("still preserves SUPPORTED / RESEARCH_REQUIRED / MUST_NOT_CLAIM semantics", () => {
    // Sanity: the brief carries all three statuses and the clean fixture is legal.
    const statuses = new Set(brief.evidencePlan.items.map((i) => i.status));
    expect(statuses.has("SUPPORTED") && statuses.has("RESEARCH_REQUIRED") && statuses.has("MUST_NOT_CLAIM")).toBe(true);
    expect(codes(videoScriptResultFixture())).toEqual([]);
  });
});

describe("content-architecture mapping consistency (defect #8)", () => {
  it("rejects declared coverage that does not equal actual section coverage", () => {
    const base = videoScriptResultFixture();
    const result = videoScriptResultFixture({ source: { ...base.source, coveredBriefBeatIds: ["beat:opening", "beat:model", "beat:worked-example"] } });
    expect(codes(result)).toContain("SOURCE_COVERAGE_MISMATCH");
  });
});
