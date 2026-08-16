/**
 * In-memory multi-model verification for CHANNEL_CONTENT_INTELLIGENCE.
 *
 * Proves the provider-backed path end to end without Supabase: real YouTube
 * discovery, real generation on the configured GENERATOR provider, and real
 * independent critique and QA on the configured CRITIC/QA providers, followed by
 * Channelwright's own deterministic validation.
 *
 * It creates no database rows and no Storage objects. It exists to find genuine
 * schema, structured-output, and critique-quality problems that fixtures cannot.
 */
import { performance } from "node:perf_hooks";
import { channelContentIntelligenceResultSchema } from "../src/domain/production-workflows";
import { deterministicContentValidation } from "../src/server/workflows/content-validation";
import { normalizeTopicScore } from "../src/server/workflows/content-intelligence-executor";
import { channelContentIntelligenceConfig } from "../src/server/workflows/content-config";
import { RoutedContentModel } from "../src/server/workflows/content-model";
import { EnvironmentRoleRouter, resolveRoleModel, resolveRoleProvider } from "../src/server/ai/role-router";
import { YouTubeTopicDiscoveryProvider, type TopicDiscoveryCache } from "../src/server/workflows/youtube-topic-discovery";
import { approvedStrategyArtifactFixture } from "../src/server/workflows/content-fixtures.test-helper";
import type { ContentIntelligenceInput } from "../src/domain/production-workflows";

try { process.loadEnvFile(".env.local"); } catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

const ROLES = ["GENERATOR", "CRITIC", "QA", "REVISION"] as const;

function requireCredential(name: string) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required for the multi-model live gate.`);
}

/** Discovery cache is intentionally inert here so the run always exercises the live provider. */
const noCache: TopicDiscoveryCache = { get: async () => null, put: async () => undefined };

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

async function timed<T>(label: string, run: () => Promise<T>) {
  const started = performance.now();
  try {
    const value = await run();
    return { label, value, ms: Math.round(performance.now() - started), failed: false as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
    return { label, ms: Math.round(performance.now() - started), failed: true as const, code, message };
  }
}

async function main() {
  requireCredential("YOUTUBE_DATA_API_KEY");
  const routing = ROLES.map((role) => {
    const provider = resolveRoleProvider("CONTENT", role);
    return { role, provider, model: resolveRoleModel("CONTENT", role, provider) };
  });
  const providers = new Set(routing.map((entry) => entry.provider));
  for (const provider of providers) requireCredential(provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY");
  const multiModel = providers.size > 1;

  const budget = channelContentIntelligenceConfig();
  const router = new EnvironmentRoleRouter("CONTENT");
  const model = new RoutedContentModel(router, budget);
  const upstream = approvedStrategyArtifactFixture;
  const input: ContentIntelligenceInput = {
    strategyWorkflowId: upstream.reference.strategyWorkflowId,
    strategyRunId: upstream.reference.strategyRunId,
    targetBacklogSize: 5,
    approvedStrategyReference: upstream.reference,
  };

  const report: Record<string, unknown> = {
    gate: "MULTI_MODEL_CONTENT_LIVE",
    multiModel,
    routing,
    note: multiModel ? undefined : "Only one provider is routed; this run does NOT prove cross-provider execution.",
  };

  // ---- 1. Generation: pillar expansion -------------------------------------
  const expansion = await timed("expandPillars", () => model.expandPillars(input, upstream));
  if (expansion.failed) { console.log(JSON.stringify({ ...report, failedAt: expansion }, null, 2)); process.exitCode = 1; return; }
  const plan = expansion.value.value;

  // ---- 2. Real bounded YouTube discovery -----------------------------------
  const discoveryProvider = new YouTubeTopicDiscoveryProvider(process.env.YOUTUBE_DATA_API_KEY!.trim(), noCache, budget);
  const discovery = await timed("discoverYouTubeTopics", () => discoveryProvider.discover(
    crypto.randomUUID(),
    plan.expansions.map((item) => ({ pillarId: item.pillarId, queries: item.discoveryQueries })),
  ));
  if (discovery.failed) { console.log(JSON.stringify({ ...report, plan: plan.expansions.map((p) => ({ pillarId: p.pillarId, queries: p.discoveryQueries })), failedAt: discovery }, null, 2)); process.exitCode = 1; return; }
  const bundle = discovery.value;

  // ---- 3. Generation: topics and backlog -----------------------------------
  const topics = await timed("assessTopics", () => model.assessTopics(input, upstream, bundle, plan));
  if (topics.failed) { console.log(JSON.stringify({ ...report, discovery: bundle.usage, failedAt: topics }, null, 2)); process.exitCode = 1; return; }
  const backlog = await timed("synthesizeBacklog", () => model.synthesizeBacklog(input, upstream, bundle, plan, topics.value.value));
  if (backlog.failed) { console.log(JSON.stringify({ ...report, discovery: bundle.usage, failedAt: backlog }, null, 2)); process.exitCode = 1; return; }

  const draft = channelContentIntelligenceResultSchema.parse({
    schemaVersion: 1,
    workflowType: "CHANNEL_CONTENT_INTELLIGENCE",
    pillarExpansions: plan.expansions,
    topics: topics.value.value.topics,
    ...backlog.value.value,
    // Channelwright, not the generator, owns the scoring arithmetic.
    scores: backlog.value.value.scores.map(normalizeTopicScore),
    upstreamStrategy: upstream.reference,
    crossModelReview: null,
    modelProvenance: [expansion.value.attribution, topics.value.attribution, backlog.value.attribution],
  });

  // ---- 4. Channelwright deterministic validation (authoritative) -----------
  const preCritique = deterministicContentValidation(draft, upstream, bundle, budget.maxResultPayloadBytes);

  // ---- 5. Independent cross-model critique and QA --------------------------
  const critique = await timed("critique", () => model.critique(input, upstream, bundle, draft));
  const qa = await timed("qa", () => model.qa(input, upstream, bundle, draft, preCritique));

  const gateCounts = draft.topics.reduce<Record<string, number>>((totals, topic) => {
    totals[topic.viewerValue.gate] = (totals[topic.viewerValue.gate] ?? 0) + 1;
    return totals;
  }, {});

  console.log(JSON.stringify({
    ...report,
    youtube: {
      searches: bundle.usage.searchQueries,
      providerRequests: bundle.usage.providerRequests,
      quotaUnits: bundle.usage.quotaUnits,
      videosExamined: bundle.usage.videosExamined,
      channelsExamined: bundle.usage.channelsExamined,
      evidenceRecords: bundle.evidence.length,
      searchObservations: bundle.evidence.filter((item) => item.sourceType === "search").length,
      completionStatus: bundle.completionStatus,
      limitations: bundle.limitations,
      origins: [...new Set(bundle.evidence.map((item) => item.origin))],
      normalizedQueries: bundle.normalizedQueries,
    },
    generation: {
      provider: expansion.value.attribution.provider,
      model: expansion.value.attribution.model,
      pillarCount: plan.expansions.length,
      topicCount: draft.topics.length,
      backlogSize: draft.backlog.length,
      latencyMs: { expandPillars: expansion.ms, assessTopics: topics.ms, synthesizeBacklog: backlog.ms },
      usage: {
        expandPillars: expansion.value.usage,
        assessTopics: topics.value.usage,
        synthesizeBacklog: backlog.value.usage,
      },
    },
    viewerValue: {
      gates: gateCounts,
      recommendedTopicGate: draft.topics.find((topic) => topic.topicId === draft.nextVideoRecommendation.topicId)?.viewerValue.gate ?? null,
      sample: draft.topics.slice(0, 2).map((topic) => ({
        topicId: topic.topicId,
        intendedViewer: topic.viewerValue.contract.intendedViewer,
        need: topic.viewerValue.contract.viewerNeed.statement,
        promise: topic.viewerValue.contract.valuePromise.statement,
        viewerOutcome: topic.viewerValue.contract.valuePromise.viewerOutcome,
        contribution: topic.viewerValue.contract.originalContribution.statement,
        differentiation: topic.viewerValue.contract.differentiation.verdict,
        evidenceSupport: topic.viewerValue.contract.evidenceSupport.verdict,
        gate: topic.viewerValue.gate,
      })),
    },
    deterministicValidation: {
      errors: preCritique.filter((finding) => finding.severity === "error").map((finding) => finding.code),
      warnings: preCritique.filter((finding) => finding.severity === "warning").map((finding) => finding.code),
    },
    critique: critique.failed ? critique : {
      provider: critique.value.attribution.provider,
      model: critique.value.attribution.model,
      latencyMs: critique.ms,
      usage: critique.value.usage,
      recommendationChallenged: critique.value.value.recommendationChallenged,
      strongestConcern: critique.value.value.strongestConcern,
      overallAssessment: critique.value.value.overallAssessment,
      findings: critique.value.value.findings,
    },
    semanticQa: qa.failed ? qa : {
      provider: qa.value.attribution.provider,
      model: qa.value.attribution.model,
      latencyMs: qa.ms,
      usage: qa.value.usage,
      score: qa.value.value.score,
      recommendation: qa.value.value.recommendation,
      findings: qa.value.value.findings,
    },
    payloadBytes: {
      discoveryBundle: bytes(bundle),
      draftResult: bytes(draft),
      critique: critique.failed ? null : bytes(critique.value.value),
      limit: budget.maxResultPayloadBytes,
    },
    cleanup: "No database rows or Storage objects were created by this in-memory verification.",
  }, null, 2));
  if (critique.failed || qa.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ gate: "MULTI_MODEL_CONTENT_LIVE_FAILED", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
