import { loadEnvFile } from "node:process";
import { channelResearchConfig } from "../src/server/workflows/research-config";
import type { ResearchCache } from "../src/server/workflows/research-cache";
import { YouTubeResearchProvider } from "../src/server/workflows/youtube-research-provider";
import { OpenAIResearchModel } from "../src/server/workflows/openai-research-model";
import { ChannelResearchExecutor } from "../src/server/workflows/channel-research-executor";
import type { ClaimedWorkflowStep } from "../src/domain/production-workflows";

try { loadEnvFile(".env.local"); } catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

const apiKey = process.env.YOUTUBE_DATA_API_KEY?.trim();
if (!apiKey) throw new Error("YOUTUBE_DATA_API_KEY is required for the opt-in provider test.");
const query = process.env.CHANNEL_RESEARCH_LIVE_QUERY?.trim() || "hidden business systems explained";
const base = channelResearchConfig();
const budget = { ...base, maxSearchQueries: 1, maxProviderRequests: 3, maxVideos: 3, maxChannels: 2, cacheTtlSeconds: 300 };
const cache: ResearchCache = { get: async () => null, put: async () => undefined };

const bundle = await new YouTubeResearchProvider(apiKey, cache, budget).retrieve(crypto.randomUUID(), { channelConcept: query });
console.log(JSON.stringify({
  liveProviderGate: "PASSED",
  provider: bundle.usage.provider,
  query,
  limits: { searchQueries: 1, providerRequests: 3, videos: 3, channels: 2 },
  usage: bundle.usage,
  evidence: bundle.evidence.map((item) => ({ id: item.id, sourceType: item.sourceType, title: item.title, url: item.url, retrievedAt: item.retrievedAt })),
  cleanup: "No application rows or Storage objects were created by this retrieval-only test.",
}, null, 2));

if (process.env.CHANNEL_RESEARCH_LIVE_CHAIN === "true") {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiApiKey) throw new Error("OPENAI_API_KEY is required for the opt-in live synthesis/QA chain.");
  const input = { channelConcept: query, constraints: { faceless: true, language: "English" } };
  const configuredModel = process.env.OPENAI_SYNTHESIS_MODEL?.trim() || process.env.OPENAI_MODEL?.trim();
  if (!configuredModel) throw new Error("Set OPENAI_SYNTHESIS_MODEL or OPENAI_MODEL for the opt-in live synthesis/QA chain; no default model is assumed.");
  const model = new OpenAIResearchModel(openAiApiKey, configuredModel, budget);
  const executor = new ChannelResearchExecutor({ retrieve: async () => bundle }, model);
  const baseStep: ClaimedWorkflowStep = {
    id: crypto.randomUUID(), ownerId: crypto.randomUUID(), workflowId: crypto.randomUUID(), runId: crypto.randomUUID(),
    workflowType: "CHANNEL_RESEARCH", definitionVersion: 1, stepKey: "retrieve-youtube-evidence", capability: "live-smoke",
    attemptCount: 1, maxAttempts: 1, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(), input, priorOutputs: {},
  };
  const outputs: Record<string, unknown> = {};
  let chainError: unknown;
  for (const stepKey of ["retrieve-youtube-evidence", "draft-research", "initial-qa", "bounded-revision", "final-qa", "synthesize-validation"]) {
    try { outputs[stepKey] = await executor.execute({ ...baseStep, stepKey, priorOutputs: { ...outputs } }); }
    catch (error) { chainError = error; break; }
  }
  const finalQa = outputs["final-qa"] as { score: number; recommendation: string; findings: unknown[]; modelUsage: { totalTokens: number } };
  const initialQa = outputs["initial-qa"] as { modelUsage: { totalTokens: number } };
  const revision = outputs["bounded-revision"] as { attempted: boolean; modelUsage: { totalTokens: number } };
  const draft = outputs["draft-research"] as { result: { recommendation: { verdict: string; confidence: string } }; modelUsage: { totalTokens: number } };
  console.log(JSON.stringify({
    liveSynthesisQaGate: chainError ? "REJECTED_BY_QA" : "PASSED",
    recommendation: draft.result.recommendation,
    finalQa: { score: finalQa.score, recommendation: finalQa.recommendation, findings: finalQa.findings },
    automatedRevisionUsed: revision.attempted,
    modelTokens: draft.modelUsage.totalTokens + initialQa.modelUsage.totalTokens + revision.modelUsage.totalTokens + finalQa.modelUsage.totalTokens,
    persistence: "NOT_TESTED_BY_THIS_IN_MEMORY_GATE",
  }, null, 2));
  if (chainError) process.exitCode = 1;
}
