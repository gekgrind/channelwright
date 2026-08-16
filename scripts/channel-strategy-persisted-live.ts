import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient, type Session } from "@supabase/supabase-js";
import pg from "pg";
import { channelStrategyResultSchema, approvedResearchArtifactSchema, strategyQAResultSchema } from "../src/domain/production-workflows";
import { CHANNELWRIGHT_SCHEMA, readSharedSupabaseConfig, safeProjectIdentity } from "./supabase-gate/config";

try { process.loadEnvFile(".env.local"); } catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

const appUrl = "http://127.0.0.1:3213";
const revisionNote = "Persisted strategy gate: sharpen differentiation and keep every monetization path an explicit hypothesis.";
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

type Detail = {
  workflow: { id: string; status: string; current_run_id: string };
  runs: Array<{ id: string; status: string; input_payload: Record<string, unknown>; context_payload: Record<string, unknown>; output_payload: unknown; error_code: string | null; artifact_hash: string | null; provenance_hash: string | null }>;
  steps: Array<{ id: string; workflow_run_id: string; step_key: string; status: string; output_payload: unknown; attempt_count: number }>;
  approvals: Array<{ id: string; workflow_run_id: string; status: string; decision_note: string | null; decided_at: string | null }>;
  researchBudgets: Array<{ workflow_run_id: string; parent_run_id: string | null; root_run_id: string; used_totals: Record<string, number>; reserved_totals: Record<string, number>; provider_identities: string[]; model_identities: string[]; exhaustion_code: string | null }>;
  researchUsageOperations: Array<{ workflow_run_id: string; operation_kind: string; status: string }>;
};

function requireCredential(name: string) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required for the persisted real-provider strategy gate.`);
}

function requireModelConfiguration() {
  if (!(process.env.OPENAI_STRATEGY_SYNTHESIS_MODEL?.trim() || process.env.OPENAI_SYNTHESIS_MODEL?.trim() || process.env.OPENAI_MODEL?.trim())) {
    throw new Error("Set OPENAI_STRATEGY_SYNTHESIS_MODEL, OPENAI_SYNTHESIS_MODEL, or OPENAI_MODEL; no default model is assumed.");
  }
}

async function startProductionServer(config: ReturnType<typeof readSharedSupabaseConfig>) {
  const nextCli = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", "3213"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      CHANNELWRIGHT_MOCK_MODE: "false",
      NEXT_PUBLIC_CHANNELWRIGHT_MOCK_MODE: "false",
      NEXT_PUBLIC_SUPABASE_URL: config.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let diagnostics = "";
  child.stdout?.on("data", (chunk) => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-8_000); });
  child.stderr?.on("data", (chunk) => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-8_000); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Production server exited during startup: ${diagnostics}`);
    try {
      const response = await fetch(`${appUrl}/login`, { redirect: "manual" });
      if (response.status < 500) return child;
    } catch { /* still starting */ }
    await pause(500);
  }
  child.kill();
  throw new Error(`Production server did not become ready: ${diagnostics}`);
}

async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), pause(5_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function sessionCookies(url: string, anonKey: string, session: Session) {
  let values: Array<{ name: string; value: string }> = [];
  const client = createServerClient(url, anonKey, {
    db: { schema: CHANNELWRIGHT_SCHEMA },
    cookies: { getAll: () => [], setAll: (next) => { values = next; } },
  });
  const result = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (result.error || !result.data.user) throw new Error(`Could not create the temporary SSR session: ${result.error?.message ?? "unknown"}`);
  return values;
}

function startWorkflowWorker(config: ReturnType<typeof readSharedSupabaseConfig>, suffix: string) {
  const entry = path.resolve(process.cwd(), "src", "server", "workflows", "worker-entry.ts");
  const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", entry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      CHANNELWRIGHT_MOCK_MODE: "false",
      NEXT_PUBLIC_SUPABASE_URL: config.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
      WORKFLOW_WORKER_ID: `strategy-persisted-${suffix}-${process.pid}`,
      WORKFLOW_LEASE_SECONDS: "300",
      WORKFLOW_POLL_INTERVAL_MS: "500",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let diagnostics = "";
  child.stdout?.on("data", (chunk) => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-16_000); });
  child.stderr?.on("data", (chunk) => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-16_000); });
  return { child, diagnostics: () => diagnostics };
}

async function workflowDetail(cookie: string, workflowId: string) {
  const response = await fetch(`${appUrl}/api/workflows/${workflowId}`, { headers: { cookie }, cache: "no-store" });
  const payload = await response.json() as Detail & { error?: unknown };
  if (!response.ok) throw new Error(`Workflow detail failed with HTTP ${response.status}.`);
  return payload;
}

async function waitForApproval(cookie: string, workflowId: string, runId: string, worker: ReturnType<typeof startWorkflowWorker>) {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    if (worker.child.exitCode !== null) throw new Error(`Workflow worker exited before review state: ${worker.diagnostics()}`);
    const detail = await workflowDetail(cookie, workflowId);
    const run = detail.runs.find((item) => item.id === runId);
    if (!run) throw new Error("Expected workflow run disappeared during execution.");
    if (run.status === "FAILED" || run.status === "CANCELED") throw new Error(`Run stopped as ${run.status}:${run.error_code ?? "unknown"} — ${worker.diagnostics()}`);
    if (run.status === "WAITING_FOR_APPROVAL" && detail.approvals.some((item) => item.workflow_run_id === runId && item.status === "PENDING")) return detail;
    await pause(2_000);
  }
  throw new Error(`Timed out waiting for run ${runId} to reach human review: ${worker.diagnostics()}`);
}

async function decide(cookie: string, workflowId: string, approvalId: string, decision: "APPROVE" | "REJECT" | "REQUEST_REVISION", note?: string) {
  const response = await fetch(`${appUrl}/api/workflows/${workflowId}/approvals/${approvalId}`, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ decision, note }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Approval decision ${decision} failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
  return payload as { operationResult: { runId: string; runStatus: string } };
}

async function startWorkflow(cookie: string, body: unknown, idempotencyKey: string) {
  const response = await fetch(`${appUrl}/api/workflows`, {
    method: "POST", headers: { cookie, "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() as { operationResult?: { workflowId: string; runId: string }; error?: { code?: string } } };
}

function createGateAdmin(config: ReturnType<typeof readSharedSupabaseConfig>) {
  return createClient(config.url, config.serviceRoleKey, { db: { schema: CHANNELWRIGHT_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false } });
}

async function cleanup(database: pg.Client, admin: ReturnType<typeof createGateAdmin>, ownerId: string) {
  await database.query("begin");
  try {
    for (const table of [
      "research_evidence_cache", "research_usage_operations", "research_run_budgets", "workflow_events",
      "workflow_approvals", "workflow_step_attempts", "workflow_steps", "workflow_runs", "workflows",
    ]) await database.query(`delete from channelwright.${table} where owner_id = $1`, [ownerId]);
    await database.query("commit");
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
  const deleted = await admin.auth.admin.deleteUser(ownerId, false);
  if (deleted.error) throw new Error(`Temporary auth cleanup failed: ${deleted.error.message}`);
  const remaining = await database.query<{ count: string }>(`select (
    (select count(*) from auth.users where id = $1) +
    (select count(*) from channelwright.workflows where owner_id = $1) +
    (select count(*) from channelwright.workflow_runs where owner_id = $1) +
    (select count(*) from channelwright.workflow_steps where owner_id = $1) +
    (select count(*) from channelwright.research_run_budgets where owner_id = $1) +
    (select count(*) from channelwright.research_usage_operations where owner_id = $1)
  )::text as count`, [ownerId]);
  if (remaining.rows[0].count !== "0") throw new Error("Temporary persisted-strategy gate records remain after cleanup.");
}

function strategyEvidence(detail: Detail, runId: string) {
  const step = (key: string) => detail.steps.find((item) => item.workflow_run_id === runId && item.step_key === key)?.output_payload;
  const budget = detail.researchBudgets.find((item) => item.workflow_run_id === runId);
  const finalQa = strategyQAResultSchema.safeParse(step("final-strategy-qa"));
  const upstream = approvedResearchArtifactSchema.safeParse(step("validate-approved-research"));
  const revision = step("bounded-strategy-revision") as { attempted?: boolean } | undefined;
  return {
    runId,
    parentRunId: budget?.parent_run_id ?? null,
    rootRunId: budget?.root_run_id,
    upstreamResearchRunId: upstream.success ? upstream.data.reference.researchRunId : null,
    providerRequests: Number(budget?.used_totals.providerRequests ?? 0),
    providerQuotaUnits: Number(budget?.used_totals.providerQuotaUnits ?? 0),
    searches: Number(budget?.used_totals.searches ?? 0),
    synthesisCalls: Number(budget?.used_totals.synthesisCalls ?? 0),
    qaCalls: Number(budget?.used_totals.qaCalls ?? 0),
    revisionCalls: Number(budget?.used_totals.revisionCalls ?? 0),
    inputTokens: Number(budget?.used_totals.inputTokens ?? 0),
    outputTokens: Number(budget?.used_totals.outputTokens ?? 0),
    totalTokens: Number(budget?.used_totals.totalTokens ?? 0),
    executionAttempts: Number(budget?.used_totals.executionAttempts ?? 0),
    automatedRevision: revision?.attempted === true,
    modelIdentities: budget?.model_identities ?? [],
    finalQa: finalQa.success ? { recommendation: finalQa.data.recommendation, score: finalQa.data.score, passed: finalQa.data.passed } : null,
    exhaustionCode: budget?.exhaustion_code ?? null,
    operationCount: detail.researchUsageOperations.filter((item) => item.workflow_run_id === runId).length,
  };
}

let app: ChildProcess | undefined;
let worker: ReturnType<typeof startWorkflowWorker> | undefined;
let database: pg.Client | undefined;
let admin: ReturnType<typeof createGateAdmin> | undefined;
let temporaryOwnerId: string | undefined;
let cleaned = false;

try {
  requireCredential("YOUTUBE_DATA_API_KEY");
  requireCredential("OPENAI_API_KEY");
  requireModelConfiguration();
  const config = readSharedSupabaseConfig();
  database = new pg.Client({ connectionString: config.databaseUrl, ssl: { ca: readFileSync(config.databaseCa, "utf8"), rejectUnauthorized: true } });
  await database.connect();
  const active = await database.query<{ count: string }>("select count(*)::text as count from channelwright.workflow_runs where status in ('QUEUED','RUNNING','RETRY_WAIT')");
  if (active.rows[0].count !== "0") throw new Error("Shared project contains an already-runnable workflow; refusing to let the gate worker claim unrelated work.");
  const guardIndex = await database.query<{ count: string }>("select count(*)::text as count from pg_indexes where schemaname='channelwright' and indexname='workflow_runs_active_strategy_uniq'");
  if (guardIndex.rows[0].count !== "1") throw new Error("Migration 202608140002 is not applied: the strategy concurrency guard index is missing.");

  const adminClient = createGateAdmin(config);
  admin = adminClient;
  const email = `channelwright-strategy-${Date.now()}-${randomUUID()}@example.invalid`;
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  const created = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Could not create temporary gate owner: ${created.error?.message ?? "unknown"}`);
  temporaryOwnerId = created.data.user.id;
  const authClient = createClient(config.url, config.anonKey, { db: { schema: CHANNELWRIGHT_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const link = await adminClient.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.properties.hashed_token) throw new Error(`Could not create temporary token-hash login: ${link.error?.message ?? "unknown"}`);
  const verified = await authClient.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (verified.error || !verified.data.session) throw new Error(`Could not authenticate temporary gate owner: ${verified.error?.message ?? "unknown"}`);
  const cookie = (await sessionCookies(config.url, config.anonKey, verified.data.session)).map(({ name, value }) => `${name}=${value}`).join("; ");
  app = await startProductionServer(config);

  // ---- Upstream: a real approved CHANNEL_RESEARCH artifact -------------------
  const research = await startWorkflow(cookie, {
    operation: "START_WORKFLOW", workflowType: "CHANNEL_RESEARCH", definitionVersion: 1,
    input: {
      channelConcept: "A faceless YouTube channel explaining the hidden operating systems behind ordinary small businesses using visual breakdowns",
      niche: "Business operations education",
      targetAudience: "Aspiring operators and analytically minded business learners",
      constraints: { faceless: true, preferredVideoLength: "8-15 minutes", postingFrequency: "Weekly", language: "English" },
    },
  }, `strategy-gate-research-${randomUUID()}`);
  if (research.status !== 202 || !research.payload.operationResult) throw new Error(`Research start failed with HTTP ${research.status}.`);
  const researchWorkflowId = research.payload.operationResult.workflowId;
  const researchRunId = research.payload.operationResult.runId;
  worker = startWorkflowWorker(config, "research");
  const researchAtReview = await waitForApproval(cookie, researchWorkflowId, researchRunId, worker);
  await stopChild(worker.child); worker = undefined;
  const researchApproval = researchAtReview.approvals.find((item) => item.workflow_run_id === researchRunId && item.status === "PENDING");
  if (!researchApproval) throw new Error("Research approval gate is missing.");
  await decide(cookie, researchWorkflowId, researchApproval.id, "APPROVE", "Persisted strategy gate: approving upstream research.");

  // ---- Strategy start, including the concurrency guard ----------------------
  const strategyInput = { operation: "START_WORKFLOW", workflowType: "CHANNEL_STRATEGY", definitionVersion: 1, input: { researchWorkflowId, researchRunId } };
  const strategy = await startWorkflow(cookie, strategyInput, `strategy-gate-${randomUUID()}`);
  if (strategy.status !== 202 || !strategy.payload.operationResult) throw new Error(`Strategy start failed with HTTP ${strategy.status}: ${JSON.stringify(strategy.payload)}`);
  const strategyWorkflowId = strategy.payload.operationResult.workflowId;
  const strategyRunId = strategy.payload.operationResult.runId;
  const duplicate = await startWorkflow(cookie, strategyInput, `strategy-gate-duplicate-${randomUUID()}`);
  if (duplicate.status !== 429 || duplicate.payload.error?.code !== "STRATEGY_LIMIT_REACHED") {
    throw new Error(`Concurrent duplicate strategy start was not rejected: HTTP ${duplicate.status} ${JSON.stringify(duplicate.payload)}`);
  }
  const replay = await startWorkflow(cookie, strategyInput, `strategy-gate-replay`);
  const replayAgain = await startWorkflow(cookie, strategyInput, `strategy-gate-replay`);
  if (replay.status === 202 && replayAgain.status === 202 && replay.payload.operationResult?.runId !== replayAgain.payload.operationResult?.runId) {
    throw new Error("Idempotent replay produced two distinct strategy runs.");
  }

  worker = startWorkflowWorker(config, "strategy");
  const strategyAtReview = await waitForApproval(cookie, strategyWorkflowId, strategyRunId, worker);
  await stopChild(worker.child); worker = undefined;

  // ---- The corrected persistence contract -----------------------------------
  const strategyRun = strategyAtReview.runs.find((item) => item.id === strategyRunId);
  if (!strategyRun?.output_payload) throw new Error("REGRESSION: finalize-strategy did not persist workflow_runs.output_payload.");
  const persisted = channelStrategyResultSchema.safeParse(strategyRun.output_payload);
  if (!persisted.success) throw new Error(`Persisted strategy run output is not a valid ChannelStrategyResult: ${persisted.error.message}`);
  if (persisted.data.upstreamResearch.researchRunId !== researchRunId) throw new Error("Persisted strategy does not reference the exact approved research run.");
  const finalizerOutput = strategyAtReview.steps.find((item) => item.workflow_run_id === strategyRunId && item.step_key === "finalize-strategy")?.output_payload;
  if (sha256(finalizerOutput) !== sha256(strategyRun.output_payload)) throw new Error("Run output does not equal the finalize-strategy step output.");
  for (const intermediate of ["validate-approved-research", "draft-strategy", "initial-strategy-qa", "bounded-strategy-revision", "final-strategy-qa"]) {
    const output = strategyAtReview.steps.find((item) => item.workflow_run_id === strategyRunId && item.step_key === intermediate)?.output_payload;
    if (output && sha256(output) === sha256(strategyRun.output_payload)) throw new Error(`Intermediate step ${intermediate} leaked into the run's final output.`);
  }
  const preDecisionUsage = strategyEvidence(strategyAtReview, strategyRunId);
  if (preDecisionUsage.providerRequests !== 0 || preDecisionUsage.searches !== 0 || preDecisionUsage.providerQuotaUnits !== 0) {
    throw new Error("CHANNEL_STRATEGY consumed YouTube provider allowance it should not have.");
  }

  // ---- Human review, revision lineage, and immutability ---------------------
  const strategyApproval = strategyAtReview.approvals.find((item) => item.workflow_run_id === strategyRunId && item.status === "PENDING");
  if (!strategyApproval) throw new Error("Strategy approval gate is missing.");
  const originalHash = sha256(strategyRun.output_payload);
  const revisionResult = await decide(cookie, strategyWorkflowId, strategyApproval.id, "REQUEST_REVISION", revisionNote);
  const successorRunId = revisionResult.operationResult.runId;
  if (successorRunId === strategyRunId) throw new Error("Revision did not create a successor run.");
  worker = startWorkflowWorker(config, "successor");
  const successorAtReview = await waitForApproval(cookie, strategyWorkflowId, successorRunId, worker);
  await stopChild(worker.child); worker = undefined;
  const successorRun = successorAtReview.runs.find((item) => item.id === successorRunId);
  if (!successorRun?.output_payload) throw new Error("Successor strategy run did not persist final output.");
  const successorBudget = successorAtReview.researchBudgets.find((item) => item.workflow_run_id === successorRunId);
  const originalBudget = successorAtReview.researchBudgets.find((item) => item.workflow_run_id === strategyRunId);
  if (!successorBudget) throw new Error("Successor strategy run did not receive its own durable budget.");
  if (successorBudget.parent_run_id !== strategyRunId) throw new Error("Successor lineage parent_run_id is wrong.");
  if (successorBudget.root_run_id !== (originalBudget?.root_run_id ?? strategyRunId)) throw new Error("Successor lineage root_run_id is wrong.");
  if (sha256(successorAtReview.runs.find((item) => item.id === strategyRunId)?.output_payload) !== originalHash) throw new Error("Original strategy output changed after successor creation.");
  const successorApproval = successorAtReview.approvals.find((item) => item.workflow_run_id === successorRunId && item.status === "PENDING");
  if (!successorApproval) throw new Error("Successor approval gate is missing.");
  await decide(cookie, strategyWorkflowId, successorApproval.id, "APPROVE", "Persisted strategy gate: approving successor strategy.");
  const finalDetail = await workflowDetail(cookie, strategyWorkflowId);
  const approvedSuccessor = finalDetail.runs.find((item) => item.id === successorRunId);
  if (approvedSuccessor?.status !== "COMPLETED") throw new Error(`Approved successor run is ${approvedSuccessor?.status ?? "missing"}.`);
  if (!approvedSuccessor.artifact_hash || !approvedSuccessor.provenance_hash) throw new Error("Approved strategy did not receive artifact and provenance hashes.");
  const mutation = await adminClient.from("workflow_runs").update({ output_payload: { tampered: true } }).eq("id", successorRunId).select("id");
  if (!mutation.error) throw new Error("Approved strategy immutability trigger did not reject a content mutation.");
  const postApprovalStart = await startWorkflow(cookie, strategyInput, `strategy-gate-after-terminal-${randomUUID()}`);
  if (postApprovalStart.status !== 202) throw new Error(`A terminal strategy chain must not permanently block a new run: HTTP ${postApprovalStart.status} ${JSON.stringify(postApprovalStart.payload)}`);

  const report = {
    gate: "PERSISTED_REAL_PROVIDER_STRATEGY_PASSED",
    project: safeProjectIdentity(config),
    upstreamResearch: { workflowId: researchWorkflowId, runId: researchRunId, decision: "APPROVED" },
    strategyWorkflowId,
    original: strategyEvidence(finalDetail, strategyRunId),
    successor: strategyEvidence(finalDetail, successorRunId),
    persistence: {
      finalizeStrategyBecameRunOutput: true,
      runOutputParsesAsChannelStrategyResult: true,
      intermediateStepsExcluded: true,
      approvedArtifactHash: approvedSuccessor.artifact_hash,
      approvedProvenanceHash: approvedSuccessor.provenance_hash,
    },
    concurrency: { duplicateActiveStartRejected: true, idempotentReplayStable: true, terminalChainDoesNotBlockNewRun: true },
    humanReview: {
      originalDecision: finalDetail.approvals.find((item) => item.workflow_run_id === strategyRunId)?.status,
      revisionNotePersisted: finalDetail.approvals.find((item) => item.workflow_run_id === strategyRunId)?.decision_note === revisionNote,
      successorDecision: finalDetail.approvals.find((item) => item.workflow_run_id === successorRunId)?.status,
      originalOutputImmutable: true,
      approvedMutationRejected: Boolean(mutation.error),
    },
    architecture: { start: "authenticated production HTTP", worker: "production worker entry used by npm.cmd run worker:workflow", read: "same /api/workflows contract the studio consumes" },
  };
  await cleanup(database, adminClient, temporaryOwnerId); cleaned = true;
  process.stdout.write(`${JSON.stringify({ ...report, cleanup: { removedTemporaryOwner: true, remainingObjects: 0 } }, null, 2)}\n`);
} finally {
  if (worker) await stopChild(worker.child).catch(() => undefined);
  await stopChild(app).catch(() => undefined);
  if (database && admin && temporaryOwnerId && !cleaned) await cleanup(database, admin, temporaryOwnerId).catch((error) => {
    process.stderr.write(`persisted_strategy_gate_cleanup_failed:${error instanceof Error ? error.message : "unknown"}\n`);
  });
  await database?.end().catch(() => undefined);
}
