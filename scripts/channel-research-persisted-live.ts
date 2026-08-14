import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient, type Session } from "@supabase/supabase-js";
import pg from "pg";
import { CHANNELWRIGHT_SCHEMA, readSharedSupabaseConfig, safeProjectIdentity } from "./supabase-gate/config";

try { process.loadEnvFile(".env.local"); } catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

const appUrl = "http://127.0.0.1:3211";
const browserAuthUrl = "http://127.0.0.1:3212/gate-auth";
const revisionNote = "Persisted Step 9B gate: tighten unsupported assumptions and retain exact evidence provenance.";
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

type Detail = {
  workflow: { id: string; status: string; current_run_id: string };
  runs: Array<{ id: string; status: string; input_payload: Record<string, unknown>; context_payload: Record<string, unknown>; output_payload: unknown; error_code: string | null }>;
  steps: Array<{ id: string; workflow_run_id: string; step_key: string; status: string; output_payload: unknown; attempt_count: number }>;
  approvals: Array<{ id: string; workflow_run_id: string; status: string; decision_note: string | null; decided_at: string | null }>;
  researchBudgets: Array<{ workflow_run_id: string; parent_run_id: string | null; root_run_id: string; used_totals: Record<string, number>; reserved_totals: Record<string, number>; provider_identities: string[]; model_identities: string[]; exhaustion_code: string | null }>;
  researchUsageOperations: Array<{ workflow_run_id: string; status: string; kind: string; provider: string | null; model: string | null }>;
};

function requireCredential(name: string) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required for the persisted real-provider gate.`);
}

async function startProductionServer(config: ReturnType<typeof readSharedSupabaseConfig>) {
  const nextCli = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", "3211"], {
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

async function createBrowserAuthBridge(cookies: Array<{ name: string; value: string }>) {
  let used = false;
  const server = createServer((request, response) => {
    if (request.url !== "/gate-auth" || used) {
      response.writeHead(404).end();
      return;
    }
    used = true;
    response.setHeader("Set-Cookie", cookies.map(({ name, value }) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`));
    response.writeHead(303, { Location: `${appUrl}/studio` }).end();
  });
  await new Promise<void>((resolve, reject) => server.listen(3212, "127.0.0.1", resolve).once("error", reject));
  return server;
}

async function stopServer(server: Server | undefined) {
  if (!server?.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
      WORKFLOW_WORKER_ID: `step9b-persisted-${suffix}-${process.pid}`,
      WORKFLOW_LEASE_SECONDS: "300",
      WORKFLOW_POLL_INTERVAL_MS: "500",
      CHANNEL_RESEARCH_MAX_AGGREGATE_INPUT_TOKENS: "500000",
      CHANNEL_RESEARCH_MAX_AGGREGATE_OUTPUT_TOKENS: "48000",
      CHANNEL_RESEARCH_MAX_AGGREGATE_TOTAL_TOKENS: "548000",
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

async function waitForApproval(cookie: string, workflowId: string, expectedRunId: string, worker: ReturnType<typeof startWorkflowWorker>) {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    if (worker.child.exitCode !== null) throw new Error(`Workflow worker exited before review state: ${worker.diagnostics()}`);
    const detail = await workflowDetail(cookie, workflowId);
    const run = detail.runs.find((item) => item.id === expectedRunId);
    if (!run) throw new Error("Expected workflow run disappeared during execution.");
    if (run.status === "FAILED" || run.status === "CANCELED") throw new Error(`Real-provider run stopped as ${run.status}:${run.error_code ?? "unknown"}.`);
    const pending = detail.approvals.find((item) => item.workflow_run_id === expectedRunId && item.status === "PENDING");
    if (run.status === "WAITING_FOR_APPROVAL" && pending) return detail;
    await pause(2_000);
  }
  throw new Error(`Timed out waiting for real-provider workflow ${expectedRunId} to reach human review: ${worker.diagnostics()}`);
}

async function waitForDecision(cookie: string, workflowId: string, runId: string, expected: "REVISION_REQUESTED" | "APPROVED") {
  for (let attempt = 0; attempt < 1_800; attempt += 1) {
    const detail = await workflowDetail(cookie, workflowId);
    if (detail.approvals.some((item) => item.workflow_run_id === runId && item.status === expected)) return detail;
    await pause(2_000);
  }
  throw new Error(`Timed out waiting for browser decision ${expected}.`);
}

async function waitForSuccessor(cookie: string, workflowId: string, parentRunId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const detail = await workflowDetail(cookie, workflowId);
    const successor = detail.runs.find((item) => item.context_payload?.previousRunId === parentRunId);
    if (successor) return { detail, successor };
    await pause(1_000);
  }
  throw new Error("Timed out waiting for the linked successor run to become readable.");
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
  if (remaining.rows[0].count !== "0") throw new Error("Temporary persisted-workflow gate records remain after cleanup.");
}

function runEvidence(detail: Detail, runId: string) {
  const step = (key: string) => detail.steps.find((item) => item.workflow_run_id === runId && item.step_key === key);
  const retrieval = step("retrieve-youtube-evidence")?.output_payload as { evidence?: Array<{ sourceType?: string; channelId?: string | null }>; usage?: Record<string, unknown> } | undefined;
  const draft = step("draft-research")?.output_payload as { modelUsage?: Record<string, unknown> } | undefined;
  const initialQa = step("initial-qa")?.output_payload as { recommendation?: string; score?: number; modelUsage?: Record<string, unknown> } | undefined;
  const revision = step("bounded-revision")?.output_payload as { attempted?: boolean; modelUsage?: Record<string, unknown> } | undefined;
  const finalQa = step("final-qa")?.output_payload as { recommendation?: string; score?: number; passed?: boolean; modelUsage?: Record<string, unknown> } | undefined;
  const budget = detail.researchBudgets.find((item) => item.workflow_run_id === runId);
  const evidence = retrieval?.evidence ?? [];
  return {
    runId,
    parentRunId: budget?.parent_run_id ?? null,
    rootRunId: budget?.root_run_id,
    searches: Number(budget?.used_totals.searches ?? 0),
    providerRequests: Number(budget?.used_totals.providerRequests ?? 0),
    providerQuotaUnits: Number(budget?.used_totals.providerQuotaUnits ?? 0),
    videos: evidence.filter((item) => item.sourceType === "video").length,
    channels: evidence.filter((item) => item.sourceType === "channel").length,
    cacheHits: Number(budget?.used_totals.cacheHits ?? 0),
    cacheMisses: Number(budget?.used_totals.cacheMisses ?? 0),
    synthesisCalls: Number(budget?.used_totals.synthesisCalls ?? 0),
    qaCalls: Number(budget?.used_totals.qaCalls ?? 0),
    revisionCalls: Number(budget?.used_totals.revisionCalls ?? 0),
    inputTokens: Number(budget?.used_totals.inputTokens ?? 0),
    outputTokens: Number(budget?.used_totals.outputTokens ?? 0),
    totalTokens: Number(budget?.used_totals.totalTokens ?? 0),
    executionAttempts: Number(budget?.used_totals.executionAttempts ?? 0),
    automatedRevision: revision?.attempted === true,
    synthesisModel: draft?.modelUsage?.model ?? null,
    qaModels: [initialQa?.modelUsage?.model, finalQa?.modelUsage?.model].filter(Boolean),
    finalQa: { recommendation: finalQa?.recommendation, score: finalQa?.score, passed: finalQa?.passed },
    providerIdentities: budget?.provider_identities ?? [],
    modelIdentities: budget?.model_identities ?? [],
    operationCount: detail.researchUsageOperations.filter((item) => item.workflow_run_id === runId).length,
  };
}

let app: ChildProcess | undefined;
let worker: ReturnType<typeof startWorkflowWorker> | undefined;
let authBridge: Server | undefined;
let database: pg.Client | undefined;
let admin: ReturnType<typeof createGateAdmin> | undefined;
let temporaryOwnerId: string | undefined;
let cleaned = false;

try {
  requireCredential("YOUTUBE_DATA_API_KEY");
  requireCredential("OPENAI_API_KEY");
  const config = readSharedSupabaseConfig();
  const ca = readFileSync(config.databaseCa, "utf8");
  database = new pg.Client({ connectionString: config.databaseUrl, ssl: { ca, rejectUnauthorized: true } });
  await database.connect();
  const active = await database.query<{ count: string }>("select count(*)::text as count from channelwright.workflow_runs where status in ('QUEUED','RUNNING','RETRY_WAIT')");
  if (active.rows[0].count !== "0") throw new Error("Shared project contains an already-runnable workflow; refusing to let the gate worker claim unrelated work.");
  const adminClient = createGateAdmin(config);
  admin = adminClient;
  const email = `channelwright-step9b-${Date.now()}-${randomUUID()}@example.invalid`;
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  const created = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Could not create temporary gate owner: ${created.error?.message ?? "unknown"}`);
  temporaryOwnerId = created.data.user.id;
  const authClient = createClient(config.url, config.anonKey, { db: { schema: CHANNELWRIGHT_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const link = await adminClient.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.properties.hashed_token) throw new Error(`Could not create temporary token-hash login: ${link.error?.message ?? "unknown"}`);
  const verified = await authClient.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (verified.error || !verified.data.session) throw new Error(`Could not authenticate temporary gate owner: ${verified.error?.message ?? "unknown"}`);
  const cookies = await sessionCookies(config.url, config.anonKey, verified.data.session);
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  app = await startProductionServer(config);
  authBridge = await createBrowserAuthBridge(cookies);
  const start = await fetch(`${appUrl}/api/workflows`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "idempotency-key": `step9b-${randomUUID()}` },
    body: JSON.stringify({
      operation: "START_WORKFLOW",
      workflowType: "CHANNEL_RESEARCH",
      definitionVersion: 1,
      input: {
        channelConcept: "A faceless YouTube channel teaching evidence-led small-business bookkeeping, cash-flow management, pricing, and operating systems with visual tutorials",
        niche: "Small-business bookkeeping and operations education",
        targetAudience: "Small-business owners, aspiring operators, and analytically minded business learners",
        goals: ["Build a durable audience", "Support a free research resource", "Validate paid research products"],
        constraints: { faceless: true, preferredVideoLength: "8-15 minutes", postingFrequency: "Weekly", geography: "United States", language: "English" },
      },
    }),
  });
  const startPayload = await start.json() as { operationResult?: { workflowId?: string; runId?: string }; error?: unknown };
  if (start.status !== 202 || !startPayload.operationResult?.workflowId || !startPayload.operationResult.runId) throw new Error(`Production HTTP start failed with status ${start.status}.`);
  const workflowId = startPayload.operationResult.workflowId;
  const originalRunId = startPayload.operationResult.runId;
  worker = startWorkflowWorker(config, "original");
  const originalAtReview = await waitForApproval(cookie, workflowId, originalRunId, worker);
  await stopChild(worker.child); worker = undefined;
  const originalRun = originalAtReview.runs.find((item) => item.id === originalRunId);
  const originalHash = sha256(originalRun?.output_payload);
  process.stdout.write(`${JSON.stringify({
    checkpoint: "AWAITING_AUTHENTICATED_BROWSER_REVISION",
    browserAuthUrl,
    workflowId,
    runId: originalRunId,
    expectedRevisionNote: revisionNote,
    visibleSections: ["summary", "concept", "recommendation", "viability", "evidence", "provenance", "confidence", "assumptions", "uncertainties", "monetization", "QA", "resource usage"],
  })}\n`);
  await waitForDecision(cookie, workflowId, originalRunId, "REVISION_REQUESTED");
  const { successor } = await waitForSuccessor(cookie, workflowId, originalRunId);
  worker = startWorkflowWorker(config, "successor");
  await waitForApproval(cookie, workflowId, successor.id, worker);
  await stopChild(worker.child); worker = undefined;
  process.stdout.write(`${JSON.stringify({
    checkpoint: "AWAITING_AUTHENTICATED_BROWSER_APPROVAL",
    browserUrl: `${appUrl}/studio`,
    workflowId,
    runId: successor.id,
    parentRunId: originalRunId,
  })}\n`);
  const finalDetail = await waitForDecision(cookie, workflowId, successor.id, "APPROVED");
  const originalAfter = finalDetail.runs.find((item) => item.id === originalRunId);
  const successorAfter = finalDetail.runs.find((item) => item.id === successor.id);
  if (sha256(originalAfter?.output_payload) !== originalHash) throw new Error("Original research output changed after successor creation.");
  if (successorAfter?.status !== "COMPLETED") throw new Error(`Approved successor run is ${successorAfter?.status ?? "missing"}.`);
  const mutation = await adminClient.from("workflow_runs").update({ output_payload: { tampered: true } }).eq("id", successor.id).select("id");
  if (!mutation.error) throw new Error("Approved artifact immutability trigger did not reject a content mutation.");
  const originalApproval = finalDetail.approvals.find((item) => item.workflow_run_id === originalRunId);
  const successorApproval = finalDetail.approvals.find((item) => item.workflow_run_id === successor.id);
  if (originalApproval?.decision_note !== revisionNote) throw new Error("Persisted human revision note did not match the browser-entered note.");
  const report = {
    gate: "PERSISTED_REAL_PROVIDER_WORKFLOW_PASSED",
    project: safeProjectIdentity(config),
    workflowId,
    original: runEvidence(finalDetail, originalRunId),
    successor: runEvidence(finalDetail, successor.id),
    humanReview: {
      originalDecision: originalApproval?.status,
      revisionNotePersisted: originalApproval?.decision_note === revisionNote,
      successorDecision: successorApproval?.status,
      originalOutputImmutable: sha256(originalAfter?.output_payload) === originalHash,
      approvedMutationRejected: Boolean(mutation.error),
    },
    architecture: { start: "authenticated production HTTP", worker: "production worker entry used by npm.cmd run worker:workflow", review: "authenticated browser UI", finalDecision: "persisted approval RPC" },
  };
  await cleanup(database, adminClient, temporaryOwnerId); cleaned = true;
  process.stdout.write(`${JSON.stringify({ ...report, cleanup: { removedTemporaryOwner: true, remainingObjects: 0 } }, null, 2)}\n`);
} finally {
  if (worker) await stopChild(worker.child).catch(() => undefined);
  await stopServer(authBridge).catch(() => undefined);
  await stopChild(app).catch(() => undefined);
  if (database && admin && temporaryOwnerId && !cleaned) await cleanup(database, admin, temporaryOwnerId).catch((error) => {
    process.stderr.write(`persisted_gate_cleanup_failed:${error instanceof Error ? error.message : "unknown"}\n`);
  });
  await database?.end().catch(() => undefined);
}
