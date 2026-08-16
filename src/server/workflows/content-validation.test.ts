import { describe, expect, it } from "vitest";
import type { ChannelContentIntelligenceResult } from "@/domain/production-workflows";
import {
  DUPLICATE_TOPIC_SIMILARITY,
  deterministicContentValidation,
  hasUnrevisableFailure,
  jaccardSimilarity,
  mergeContentQA,
  newlyIntroducedContentErrors,
  topicTokens,
} from "./content-validation";
import { approvedStrategyArtifactFixture, contentResultFixture, discoveryBundleFixture, viewerValueFixture } from "./content-fixtures.test-helper";

const usage = { model: "content-test", inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const MAX_BYTES = 60_000;

const codes = (result: unknown, upstream = approvedStrategyArtifactFixture, discovery = discoveryBundleFixture, bytes = MAX_BYTES) =>
  deterministicContentValidation(result, upstream, discovery, bytes).map((item) => item.code);

const withTopic = (index: number, patch: Record<string, unknown>): ChannelContentIntelligenceResult => ({
  ...contentResultFixture,
  topics: contentResultFixture.topics.map((topic, position) => position === index ? { ...topic, ...patch } : topic),
});

/** Injects a phrase into a free-text field to exercise the integrity regexes. */
const withText = (text: string): ChannelContentIntelligenceResult => ({ ...contentResultFixture, recommendedNextAction: text });

describe("deterministic CONTENT_INTELLIGENCE QA", () => {
  it("accepts the reference backlog with no errors", () => {
    expect(deterministicContentValidation(contentResultFixture, approvedStrategyArtifactFixture, discoveryBundleFixture, MAX_BYTES).filter((item) => item.severity === "error")).toEqual([]);
  });

  it("rejects an altered upstream strategy reference", () => {
    const altered = { ...contentResultFixture, upstreamStrategy: { ...contentResultFixture.upstreamStrategy, strategyArtifactHash: "9".repeat(64) } };
    expect(codes(altered)).toContain("UPSTREAM_STRATEGY_REFERENCE_CHANGED");
  });

  it("accepts a reordered upstream reference, because key order is not tampering", () => {
    const reordered = Object.fromEntries(Object.entries(contentResultFixture.upstreamStrategy).reverse());
    expect(codes({ ...contentResultFixture, upstreamStrategy: reordered })).not.toContain("UPSTREAM_STRATEGY_REFERENCE_CHANGED");
  });

  it("rejects evidence outside the current discovery bundle", () => {
    expect(codes(withTopic(0, { evidenceIds: ["yt:video:notdiscovered"] }))).toContain("EVIDENCE_REFERENCE_NOT_FOUND");
  });

  it("rejects discovery evidence whose identity no longer matches its canonical URL", () => {
    const [search, second, video, ...rest] = discoveryBundleFixture.evidence;
    const tampered = { ...discoveryBundleFixture, evidence: [search, second, { ...video, url: "https://www.youtube.com/watch?v=someone-else" }, ...rest] };
    expect(codes(contentResultFixture, approvedStrategyArtifactFixture, tampered)).toContain("EVIDENCE_IDENTITY_MISMATCH");
  });

  it("rejects a pillar expansion that is not an approved strategy pillar", () => {
    const invented = { ...contentResultFixture, pillarExpansions: contentResultFixture.pillarExpansions.map((pillar, index) => index === 0 ? { ...pillar, pillarName: "Invented pillar" } : pillar) };
    expect(codes(invented)).toContain("PILLAR_NOT_IN_APPROVED_STRATEGY");
  });

  it("rejects a topic attached to no expanded pillar", () => {
    expect(codes(withTopic(0, { pillarId: "pillar:unknown-thing" }))).toContain("TOPIC_PILLAR_NOT_IN_STRATEGY");
  });

  it("rejects a topic that cites no evidence discovered for its own pillar", () => {
    // Cites real discovery evidence, but all of it belongs to the other pillar.
    expect(codes(withTopic(0, { evidenceIds: ["yt:video:contentvid002"] }))).toContain("TOPIC_EVIDENCE_NOT_INDEPENDENTLY_DISCOVERED");
  });

  it("rejects non-evergreen topics with no freshness or decay treatment", () => {
    expect(codes(withTopic(0, { shelfLife: { classification: "TIMELY", rationale: "Tied to a current change.", decayNote: null } }))).toContain("TIMELY_TOPIC_MISSING_DECAY_TREATMENT");
    expect(codes(withTopic(0, { shelfLife: { classification: "TIMELY", rationale: "Tied to a current change.", decayNote: "Value decays within one quarter." } }))).not.toContain("TIMELY_TOPIC_MISSING_DECAY_TREATMENT");
  });

  it("overrules a topic that understates its own viewer-value gate", () => {
    const understated = withTopic(0, {
      viewerValue: viewerValueFixture({
        integrityFindings: [{ risk: "FABRICATED_TESTIMONIAL", label: null, severity: "blocking", explanation: "Relies on an invented customer story.", evidenceIds: [] }],
        gate: "PASS",
      }),
    });
    const found = codes(understated);
    expect(found).toContain("VIEWER_VALUE_GATE_UNDERSTATED");
    expect(found).toContain("VIEWER_VALUE_GATE_REJECTED");
    expect(found).toContain("CONTENT_INTEGRITY_BLOCKING_RISK");
  });

  it("treats a revisable viewer-value weakness on a non-recommended topic as a warning", () => {
    const weakDifferentiation = withTopic(1, {
      viewerValue: viewerValueFixture({
        contract: { ...viewerValueFixture().contract, differentiation: { verdict: "weak", rationale: "Nothing distinguishes it yet.", evidenceIds: [] } },
        gate: "REVISE",
      }),
    });
    const findings = deterministicContentValidation(weakDifferentiation, approvedStrategyArtifactFixture, discoveryBundleFixture, MAX_BYTES);
    expect(findings.find((item) => item.code === "VIEWER_VALUE_GATE_REVISION_REQUIRED")?.severity).toBe("warning");
    expect(findings.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("rejects a recommendation whose topic does not pass the viewer value gate", () => {
    const failing = withTopic(0, {
      viewerValue: viewerValueFixture({
        contract: { ...viewerValueFixture().contract, differentiation: { verdict: "absent", rationale: "Indistinguishable.", evidenceIds: [] } },
        gate: "REVISE",
      }),
    });
    expect(codes(failing)).toContain("RECOMMENDATION_FAILS_VIEWER_VALUE");
  });

  it("detects near-duplicate topics serving the same viewer intent", () => {
    const duplicated: ChannelContentIntelligenceResult = {
      ...contentResultFixture,
      topics: [contentResultFixture.topics[0], { ...contentResultFixture.topics[1], workingConcept: contentResultFixture.topics[0].workingConcept, workingAngle: contentResultFixture.topics[0].workingAngle, viewerQuestion: contentResultFixture.topics[0].viewerQuestion }],
    };
    expect(codes(duplicated)).toContain("DUPLICATE_TOPIC_CONCEPT");
  });

  it("detects a cosmetic numeric title variation as the same concept", () => {
    const left = topicTokens({ workingConcept: "5 ways to schedule staff without gaps", workingAngle: "walkthrough", viewerQuestion: "how do I schedule staff" });
    const right = topicTokens({ workingConcept: "7 ways to schedule staff without gaps", workingAngle: "walkthrough", viewerQuestion: "how do I schedule staff" });
    expect(jaccardSimilarity(left, right)).toBeGreaterThanOrEqual(DUPLICATE_TOPIC_SIMILARITY);
  });

  it("retains genuinely differentiated topics", () => {
    expect(codes(contentResultFixture)).not.toContain("DUPLICATE_TOPIC_CONCEPT");
    const left = topicTokens(contentResultFixture.topics[0]);
    const right = topicTokens(contentResultFixture.topics[1]);
    expect(jaccardSimilarity(left, right)).toBeLessThan(DUPLICATE_TOPIC_SIMILARITY);
  });

  it("rejects scoring whose weights do not sum to one", () => {
    const broken = { ...contentResultFixture, scores: contentResultFixture.scores.map((score, index) => index === 0 ? { ...score, components: score.components.map((component) => ({ ...component, weight: 0.5 })) } : score) };
    expect(codes(broken)).toContain("SCORING_WEIGHTS_INVALID");
  });

  it("rejects an aggregate score that does not match its decomposition", () => {
    const broken = { ...contentResultFixture, scores: contentResultFixture.scores.map((score, index) => index === 0 ? { ...score, weightedTotal: 9.9 } : score) };
    expect(codes(broken)).toContain("SCORING_ARITHMETIC_INVALID");
  });

  it("rejects a duplicated scoring dimension and an unscored or unknown topic", () => {
    const duplicatedDimension = { ...contentResultFixture, scores: contentResultFixture.scores.map((score, index) => index === 0 ? { ...score, components: [score.components[0], { ...score.components[1], dimension: score.components[0].dimension }, ...score.components.slice(2)] } : score) };
    expect(codes(duplicatedDimension)).toContain("SCORING_DIMENSION_DUPLICATED");
    expect(codes({ ...contentResultFixture, scores: [contentResultFixture.scores[0]] })).toContain("TOPIC_SCORE_MISSING");
    const unknown = { ...contentResultFixture, scores: [{ ...contentResultFixture.scores[0], topicId: "topic:not-real" }, contentResultFixture.scores[1]] };
    expect(codes(unknown)).toContain("SCORE_TOPIC_UNKNOWN");
  });

  it("rejects an inconsistent backlog", () => {
    expect(codes({ ...contentResultFixture, backlog: [{ topicId: "topic:not-real", rank: 1, tier: "PRIORITY", inclusionRationale: "x" }] })).toContain("BACKLOG_TOPIC_UNKNOWN");
    expect(codes({ ...contentResultFixture, backlog: contentResultFixture.backlog.map((entry) => ({ ...entry, topicId: contentResultFixture.backlog[0].topicId })) })).toContain("BACKLOG_TOPIC_DUPLICATED");
    expect(codes({ ...contentResultFixture, backlog: contentResultFixture.backlog.map((entry) => ({ ...entry, rank: 2 })) })).toContain("BACKLOG_RANKS_INVALID");
  });

  it("rejects a recommendation absent from the backlog", () => {
    const orphaned = { ...contentResultFixture, backlog: [contentResultFixture.backlog[1]].map((entry) => ({ ...entry, rank: 1 })) };
    expect(codes(orphaned)).toContain("RECOMMENDATION_TOPIC_NOT_IN_BACKLOG");
  });

  it("rejects confidence exceeding the weaker of the upstream research and strategy QA scores", () => {
    const weakUpstream = {
      ...approvedStrategyArtifactFixture,
      reference: { ...approvedStrategyArtifactFixture.reference, finalQaScore: 70 },
    };
    const result = { ...contentResultFixture, upstreamStrategy: weakUpstream.reference, nextVideoRecommendation: { ...contentResultFixture.nextVideoRecommendation, confidence: "high" as const } };
    expect(codes(result, weakUpstream)).toContain("CONFIDENCE_EXCEEDS_UPSTREAM_EVIDENCE");
  });

  it("warns when high confidence rests on a partial discovery bundle", () => {
    const partial = { ...discoveryBundleFixture, completionStatus: "partial" as const, limitations: ["Search coverage stopped early."] };
    const confident = { ...contentResultFixture, nextVideoRecommendation: { ...contentResultFixture.nextVideoRecommendation, confidence: "high" as const } };
    expect(codes(confident, approvedStrategyArtifactFixture, partial)).toContain("CONFIDENCE_EXCEEDS_PARTIAL_DISCOVERY");
  });

  it("rejects fabricated performance, revenue, and search-volume claims", () => {
    expect(codes(withText("This will reach 100,000 views within a month."))).toContain("FABRICATED_PERFORMANCE_PREDICTION");
    expect(codes(withText("The niche has a CPM of $24 so it pays well."))).toContain("FABRICATED_REVENUE_PREDICTION");
    expect(codes(withText("The phrase gets 40,000 monthly searches."))).toContain("FABRICATED_SEARCH_VOLUME");
  });

  it("rejects unsupported monetary guarantees", () => {
    expect(codes(withText("Show viewers how to make $10,000 per month in 30 days."))).toContain("UNSUPPORTED_MONETARY_GUARANTEE");
  });

  it("rejects downstream packaging and production artifacts", () => {
    expect(codes(withText("Also produce the thumbnail and a full script."))).toContain("DOWNSTREAM_SCOPE_VIOLATION");
  });

  it("rejects a payload above the durable-output margin before persistence attempts it", () => {
    expect(codes(contentResultFixture, approvedStrategyArtifactFixture, discoveryBundleFixture, 200)).toContain("RESULT_PAYLOAD_TOO_LARGE");
  });
});

describe("unrevisable content failures", () => {
  it("treats deceptive and unsupported premises as terminal, not cosmetically fixable", () => {
    for (const code of ["VIEWER_VALUE_GATE_REJECTED", "CONTENT_INTEGRITY_BLOCKING_RISK", "UNSUPPORTED_MONETARY_GUARANTEE", "FABRICATED_SEARCH_VOLUME", "UPSTREAM_STRATEGY_REFERENCE_CHANGED"]) {
      expect(hasUnrevisableFailure([{ severity: "error", code, message: "m", evidenceIds: [] }])).toBe(true);
    }
  });

  it("treats ordinary quality failures as revisable", () => {
    expect(hasUnrevisableFailure([{ severity: "error", code: "SCORING_ARITHMETIC_INVALID", message: "m", evidenceIds: [] }])).toBe(false);
    expect(hasUnrevisableFailure([{ severity: "warning", code: "VIEWER_VALUE_GATE_REJECTED", message: "m", evidenceIds: [] }])).toBe(false);
  });

  it("identifies only errors the revision newly introduced", () => {
    const before = [{ severity: "error" as const, code: "A", message: "m", evidenceIds: [] }];
    const after = [{ severity: "error" as const, code: "A", message: "m", evidenceIds: [] }, { severity: "error" as const, code: "B", message: "m", evidenceIds: [] }];
    expect(newlyIntroducedContentErrors(before, after).map((item) => item.code)).toEqual(["B"]);
  });
});

describe("merged CONTENT_INTELLIGENCE QA", () => {
  it("accepts when both layers agree", () => {
    expect(mergeContentQA([], { score: 91, findings: [], recommendation: "accept" }, usage, discoveryBundleFixture)).toMatchObject({ passed: true, score: 91, recommendation: "accept" });
  });

  it("forces revision on any deterministic error and overrides an optimistic model", () => {
    const deterministic = deterministicContentValidation(withTopic(0, { evidenceIds: ["yt:video:notdiscovered"] }), approvedStrategyArtifactFixture, discoveryBundleFixture, MAX_BYTES);
    const merged = mergeContentQA(deterministic, { score: 99, findings: [], recommendation: "accept" }, usage, discoveryBundleFixture);
    expect(merged.recommendation).toBe("revise");
    expect(merged.passed).toBe(false);
  });

  it("strips and flags QA findings citing evidence outside the discovery bundle", () => {
    const merged = mergeContentQA([], { score: 90, findings: [{ severity: "warning", code: "SOMETHING", message: "m", evidenceIds: ["yt:video:ghost"] }], recommendation: "accept" }, usage, discoveryBundleFixture);
    expect(merged.findings.map((item) => item.code)).toContain("QA_EVIDENCE_REFERENCE_NOT_FOUND");
    expect(merged.findings.find((item) => item.code === "SOMETHING")?.evidenceIds).toEqual([]);
  });

  it("never reports a negative score", () => {
    const many = Array.from({ length: 10 }, () => ({ severity: "error" as const, code: "BAD", message: "m", evidenceIds: [] }));
    expect(mergeContentQA(many, { score: 10, findings: [], recommendation: "revise" }, usage, discoveryBundleFixture).score).toBe(0);
  });
});
