import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CONTENT_BACKLOG_MAX, CONTENT_BACKLOG_MIN, channelContentIntelligenceResultSchema } from "@/domain/production-workflows";
import { AnthropicStructuredProvider } from "@/server/ai/anthropic-provider";
import type { ModelInvocationContext } from "@/server/ai/provider";
import { channelContentIntelligenceConfig } from "./content-config";
import { backlogSynthesisSchema, topicAssessmentSchema } from "./content-model";
import { deterministicContentValidation, findingFingerprint, mergeContentQA, newlyIntroducedContentErrors } from "./content-validation";
import { approvedStrategyArtifactFixture, contentResultFixture, discoveryBundleFixture } from "./content-fixtures.test-helper";
import { YouTubeTopicDiscoveryProvider, type TopicDiscoveryCache } from "./youtube-topic-discovery";

const usage = { model: "m", inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const MAX_BYTES = 60_000;

/**
 * Regressions for the review of 883940e. Each test pins a bound or behaviour
 * whose disagreement previously caused terminal failure after paid spend.
 */
describe("bounds agree across every layer (findings 1 and 2)", () => {
  it("caps the model-facing contracts at the same maximum as the result contract", () => {
    const topics = Array.from({ length: CONTENT_BACKLOG_MAX + 1 }, () => contentResultFixture.topics[0]);
    expect(topicAssessmentSchema.safeParse({ topics }).success).toBe(false);
    expect(topicAssessmentSchema.safeParse({ topics: topics.slice(0, CONTENT_BACKLOG_MAX) }).success).toBe(true);

    const overCap = {
      scores: Array.from({ length: CONTENT_BACKLOG_MAX + 1 }, () => ({ ...contentResultFixture.scores[0], weightedTotal: undefined })),
      backlog: contentResultFixture.backlog,
      nextVideoRecommendation: contentResultFixture.nextVideoRecommendation,
      risks: contentResultFixture.risks,
      assumptions: contentResultFixture.assumptions,
      openQuestions: contentResultFixture.openQuestions,
      recommendedNextAction: contentResultFixture.recommendedNextAction,
    };
    expect(backlogSynthesisSchema.safeParse(overCap).success).toBe(false);
    // A generator can no longer emit a legal payload the result contract rejects.
    expect(backlogSynthesisSchema.shape.backlog.element.shape.rank.safeParse(CONTENT_BACKLOG_MAX + 1).success).toBe(false);
  });

  it("keeps the SQL target-backlog bound identical to the domain bound", () => {
    const sql = readFileSync("supabase/migrations/202608140003_content_intelligence.sql", "utf8");
    expect(sql).toContain(`not between ${CONTENT_BACKLOG_MIN} and ${CONTENT_BACKLOG_MAX}`);
  });
});

describe("retry headroom (finding 3)", () => {
  it("allows at least one retry of each generator step within the run budget", () => {
    const budget = channelContentIntelligenceConfig();
    // Three GENERATOR calls per run; a single retry must not exhaust the budget.
    expect(budget.maxAggregateSynthesisCalls).toBeGreaterThan(3);
    expect(budget.maxAggregateQaCalls).toBeGreaterThan(3);
    expect(budget.maxAggregateRevisionCalls).toBeGreaterThan(1);
  });
});

describe("warnings-only results are revisable (finding 4)", () => {
  it("marks a failing warning-only verdict material so the bounded revision runs", () => {
    const warnings = Array.from({ length: 6 }, (unused, index) => ({ severity: "warning" as const, code: "VIEWER_VALUE_GATE_REVISION_REQUIRED", message: `topic ${index}`, evidenceIds: [] }));
    const merged = mergeContentQA(warnings, { score: 95, findings: [], recommendation: "accept" }, usage, discoveryBundleFixture);
    expect(merged.findings.some((finding) => finding.severity === "error")).toBe(false);
    expect(merged.passed).toBe(false);
    // The executor's materiality test is `!passed || errors || recommendation`.
    const material = !merged.passed || merged.findings.some((finding) => finding.severity === "error") || merged.recommendation === "revise";
    expect(material).toBe(true);
  });
});

describe("evidence caps and fairness (findings 6 and 7)", () => {
  it("fits maximum search, video, and channel yield inside the record cap", () => {
    const budget = channelContentIntelligenceConfig();
    expect(budget.maxSearchQueries + budget.maxVideos + budget.maxChannels).toBeLessThanOrEqual(budget.maxEvidenceRecords);
  });

  it("gives every pillar video evidence instead of letting the first query take it all", async () => {
    const budget = { ...channelContentIntelligenceConfig(), maxSearchQueries: 2, maxProviderRequests: 8, maxVideos: 4, maxChannels: 2 };
    const ids = (prefix: string, count: number) => Array.from({ length: count }, (unused, index) => `${prefix}${index}`);
    const search = (list: string[]) => ({ items: list.map((id) => ({ id: { videoId: id }, snippet: { channelId: `c-${id}`, channelTitle: "x", title: `t-${id}`, publishedAt: "2026-01-01T00:00:00.000Z" } })) });
    const responses: unknown[] = [
      search(ids("a", 10)),
      search(ids("b", 10)),
      { items: [...ids("a", 10), ...ids("b", 10)].map((id) => ({ id, snippet: { channelId: `c-${id}`, channelTitle: "x", title: `t-${id}`, publishedAt: "2026-01-01T00:00:00.000Z" }, statistics: {} })) },
      { items: [] },
    ];
    let call = 0;
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => responses[Math.min(call++, responses.length - 1)] }) as Response) as unknown as typeof fetch;
    const cache: TopicDiscoveryCache = { get: async () => null, put: async () => undefined };
    const bundle = await new YouTubeTopicDiscoveryProvider("k", cache, budget, fetcher, () => new Date("2026-08-15T12:00:00.000Z"))
      .discover(crypto.randomUUID(), [{ pillarId: "pillar:one", queries: ["alpha query"] }, { pillarId: "pillar:two", queries: ["beta query"] }]);
    const videosByPillar = bundle.evidence.filter((item) => item.sourceType === "video")
      .reduce<Record<string, number>>((totals, item) => ({ ...totals, [item.pillarId]: (totals[item.pillarId] ?? 0) + 1 }), {});
    expect(videosByPillar["pillar:one"]).toBeGreaterThan(0);
    expect(videosByPillar["pillar:two"]).toBeGreaterThan(0);
  });
});

describe("Anthropic output-limit misconfiguration (finding 8)", () => {
  it("reports a max_tokens ceiling violation as a configuration fault, not an oversized prompt", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false, status: 400,
      json: async () => ({ error: { type: "invalid_request_error", message: "max_tokens: 14000 > 8192, which is the maximum allowed" } }),
      text: async () => "",
    }) as Response) as unknown as typeof fetch;
    const context: ModelInvocationContext = { operation: "probe", role: "CRITIC", system: "s", payload: {}, maxOutputTokens: 14_000, timeoutMs: 1_000 };
    await expect(new AnthropicStructuredProvider("k", "claude-x", fetcher).invoke(z.unknown(), context))
      .rejects.toMatchObject({ code: "AI_OUTPUT_LIMIT_INVALID", configurationFault: true, retryable: false });
  });
});

describe("integrity regexes do not punish legitimate creator-economy topics (finding 10)", () => {
  const withText = (text: string) => ({ ...contentResultFixture, recommendedNextAction: text });
  const codes = (text: string) => deterministicContentValidation(withText(text), approvedStrategyArtifactFixture, discoveryBundleFixture, MAX_BYTES).map((finding) => finding.code);

  it("allows a topic that is legitimately about thumbnails or scripts", () => {
    expect(codes("Cover how to design a thumbnail that is not clickbait.")).not.toContain("DOWNSTREAM_SCOPE_VIOLATION");
    expect(codes("Explain why most channel scripts lose the viewer in the first minute.")).not.toContain("DOWNSTREAM_SCOPE_VIOLATION");
  });

  it("still rejects Channelwright producing a downstream artifact", () => {
    expect(codes("Generate the thumbnail and a content calendar for each entry.")).toContain("DOWNSTREAM_SCOPE_VIOLATION");
    expect(codes("Deliver a full script for the recommended video.")).toContain("DOWNSTREAM_SCOPE_VIOLATION");
  });

  it("allows an ordinary price mentioned as subject matter", () => {
    expect(codes("Compare editing tools under $5 per month for small channels.")).not.toContain("FABRICATED_REVENUE_PREDICTION");
  });

  it("still rejects asserted channel earnings and CPM figures", () => {
    expect(codes("The channel should earn $4,000 per month once monetized.")).toContain("FABRICATED_REVENUE_PREDICTION");
    expect(codes("This niche has a CPM of $24.")).toContain("FABRICATED_REVENUE_PREDICTION");
  });
});

describe("QA reporting and revision fingerprinting (findings 11 and 13)", () => {
  it("counts distinct failing rules rather than finding volume", () => {
    const repeated = Array.from({ length: 5 }, (unused, index) => ({ severity: "error" as const, code: "TOPIC_SCORE_MISSING", message: `topic ${index}`, evidenceIds: [] }));
    const merged = mergeContentQA(repeated, { score: 50, findings: [], recommendation: "revise" }, usage, discoveryBundleFixture);
    expect(merged.deterministicChecksFailed).toBe(1);
    expect(merged.deterministicChecksPassed).toBe(21);
  });

  it("treats the same rule on a different subject as newly introduced", () => {
    const before = [{ severity: "error" as const, code: "TOPIC_SCORE_MISSING", message: "Topic topic:a has no score decomposition.", evidenceIds: [] }];
    const after = [...before, { severity: "error" as const, code: "TOPIC_SCORE_MISSING", message: "Topic topic:b has no score decomposition.", evidenceIds: [] }];
    expect(newlyIntroducedContentErrors(before, after)).toHaveLength(1);
    expect(findingFingerprint(before[0])).not.toBe(findingFingerprint(after[1]));
  });
});

describe("provenance honesty (finding 14)", () => {
  it("permits a null critic rather than naming QA as one", () => {
    const parsed = channelContentIntelligenceResultSchema.safeParse({
      ...contentResultFixture,
      crossModelReview: {
        generator: contentResultFixture.modelProvenance[0],
        critic: null,
        outcome: "AGREED",
        findings: [],
        summary: "No independent critique was recorded for this artifact.",
      },
    });
    expect(parsed.success).toBe(true);
  });
});
