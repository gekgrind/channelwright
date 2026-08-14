import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import pg from "pg";
import { inspectMedia } from "../../src/server/rendering/media-inspection";
import { claimedWorkflowStepSchema } from "../../src/domain/production-workflows";
import { ChannelConceptValidationExecutor } from "../../src/server/workflows/concept-validation-executor";
import { CHANNELWRIGHT_SCHEMA, readSharedSupabaseConfig, safeProjectIdentity } from "./config";

try { process.loadEnvFile(".env.local"); } catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];
const createdObjects = new Set<string>();
const createdUsers: string[] = [];
const bucketName = "channelwright-private-media";
const appUrl = "http://127.0.0.1:3210";

const record = (name: string, passed: boolean, detail: string) => {
  checks.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function cookieHeader(response: Response) {
  const values = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

async function startProductionServer(config: ReturnType<typeof readSharedSupabaseConfig>) {
  await stat(path.resolve(process.cwd(), ".next", "BUILD_ID")).catch(() => {
    throw new Error("A production build is required before the live gate. Run npm.cmd run build with the shared-project Supabase environment values.");
  });
  const nextCli = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", "3210"], {
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
  child.stdout?.on("data", (chunk) => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-4000); });
  child.stderr?.on("data", (chunk) => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-4000); });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Production server exited before the gate started: ${diagnostics}`);
    try {
      const response = await fetch(`${appUrl}/login`, { redirect: "manual" });
      if (response.status < 500) return child;
    } catch { /* server is still starting */ }
    await pause(500);
  }
  child.kill();
  throw new Error(`Production server did not become ready: ${diagnostics}`);
}

async function stopServer(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), pause(5000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function cleanupGateArtifacts(admin: { auth: SupabaseClient["auth"]; storage: SupabaseClient["storage"] }, database: pg.Client) {
  const userIds = [...createdUsers];
  const objectKeys = [...createdObjects];
  if (objectKeys.length) {
    const removed = await admin.storage.from(bucketName).remove(objectKeys);
    if (removed.error) throw new Error(`Temporary Storage cleanup failed: ${removed.error.message}`);
    const remainingStorage = await database.query<{ count: string }>("select count(*)::text as count from storage.objects where bucket_id = $1 and name = any($2::text[])", [bucketName, objectKeys]);
    if (remainingStorage.rows[0].count !== "0") throw new Error("Temporary Storage metadata remains after cleanup");
  }
  if (userIds.length) {
    await database.query("begin");
    try {
      await database.query("delete from channelwright.research_evidence_cache where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.research_usage_operations where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.research_run_budgets where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.workflow_events where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.workflow_approvals where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.workflow_step_attempts where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.workflow_steps where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.production_master_approvals where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.media_qa_reports where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.technical_media_inspections where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.production_master_versions where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.render_job_attempts where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.render_jobs where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.render_input_assets where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.render_input_versions where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.media_asset_versions where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.media_assets where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.production_idempotency where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.agent_runs where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.cost_events where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.audit_events where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.workflow_runs where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.workflows where owner_id = any($1::uuid[])", [userIds]);
      await database.query("delete from channelwright.channels where owner_id = any($1::uuid[])", [userIds]);
      await database.query("commit");
    } catch (error) {
      await database.query("rollback");
      throw error;
    }
    for (const userId of userIds) {
      const deleted = await admin.auth.admin.deleteUser(userId, false);
      if (deleted.error) throw new Error(`Temporary auth-user cleanup failed: ${deleted.error.message}`);
    }
    const remaining = await database.query<{ count: string }>("select count(*)::text as count from auth.users where id = any($1::uuid[])", [userIds]);
    if (remaining.rows[0].count !== "0") throw new Error("Temporary auth identities remain after cleanup");
    const remainingWorkflows = await database.query<{ count: string }>(`select (
      (select count(*) from channelwright.research_evidence_cache where owner_id = any($1::uuid[])) +
      (select count(*) from channelwright.research_run_budgets where owner_id = any($1::uuid[])) +
      (select count(*) from channelwright.research_usage_operations where owner_id = any($1::uuid[])) +
      (select count(*) from channelwright.workflows where owner_id = any($1::uuid[])) +
      (select count(*) from channelwright.workflow_runs where owner_id = any($1::uuid[])) +
      (select count(*) from channelwright.workflow_steps where owner_id = any($1::uuid[])) +
      (select count(*) from channelwright.workflow_step_attempts where owner_id = any($1::uuid[])) +
      (select count(*) from channelwright.workflow_approvals where owner_id = any($1::uuid[])) +
      (select count(*) from channelwright.workflow_events where owner_id = any($1::uuid[]))
    )::text as count`, [userIds]);
    if (remainingWorkflows.rows[0].count !== "0") throw new Error("Temporary workflow records remain after cleanup");
    const uuidColumns = await database.query<{ table_schema: string; table_name: string; column_name: string }>(`select table_schema, table_name, column_name
      from information_schema.columns
      where data_type = 'uuid'
        and table_schema not in ('pg_catalog', 'information_schema', 'channelwright', 'channelwright_migrations', 'auth')
      order by table_schema, table_name, ordinal_position`);
    for (const column of uuidColumns.rows) {
      const relation = `${pg.escapeIdentifier(column.table_schema)}.${pg.escapeIdentifier(column.table_name)}`;
      const identifier = pg.escapeIdentifier(column.column_name);
      const result = await database.query<{ count: string }>(`select count(*)::text as count from ${relation} where ${identifier} = any($1::uuid[])`, [userIds]);
      if (result.rows[0].count !== "0") throw new Error(`Temporary user identifier remains in shared relation ${column.table_schema}.${column.table_name}.${column.column_name}`);
    }
  }
  createdObjects.clear();
  createdUsers.length = 0;
  return { removedObjects: objectKeys.length, removedUsers: userIds.length };
}

async function createGateUser(admin: { auth: SupabaseClient["auth"] }, label: string) {
  const email = `channelwright-gate-${label}-${Date.now()}-${randomUUID()}@example.invalid`;
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error || !result.data.user) throw new Error(`Could not create temporary shared-project ${label} user: ${result.error?.message ?? "unknown"}`);
  createdUsers.push(result.data.user.id);
  return { user: result.data.user, email, password };
}

async function authenticatedClient(url: string, anonKey: string, admin: { auth: SupabaseClient["auth"] }, email: string) {
  const client = createClient(url, anonKey, { db: { schema: CHANNELWRIGHT_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.properties.hashed_token) throw new Error(`Could not generate temporary shared-project auth link: ${link.error?.message ?? "unknown"}`);
  const result = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (result.error || !result.data.user || !result.data.session) throw new Error(`Temporary shared-project token-hash authentication failed: ${result.error?.message ?? "unknown"}`);
  return { client, session: result.data.session };
}

async function sessionCookieHeader(url: string, anonKey: string, session: Session) {
  let values: Array<{ name: string; value: string }> = [];
  const client = createServerClient(url, anonKey, {
    db: { schema: CHANNELWRIGHT_SCHEMA },
    cookies: { getAll: () => [], setAll: (next) => { values = next; } },
  });
  const result = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (result.error || !result.data.user) throw new Error(`Could not create temporary Supabase SSR session cookies: ${result.error?.message ?? "unknown"}`);
  return values.map(({ name, value }) => `${name}=${value}`).join("; ");
}

async function verifyCaptchaProtectedPasswordLogin(email: string, password: string) {
  const form = new FormData(); form.set("email", email); form.set("password", password);
  const response = await fetch(`${appUrl}/api/auth/login`, { method: "POST", body: form, redirect: "manual" });
  const cookie = cookieHeader(response);
  const location = response.headers.get("location") ?? "";
  record("CAPTCHA rejects tokenless HTTP password login", response.status === 303 && cookie.length === 0 && location.includes("/login?error=captcha_required"), `status=${response.status}, sessionCookie=${cookie.length > 0}, captchaRequiredRedirect=${location.includes("/login?error=captcha_required")}`);
}

const scriptPayload = (version: number) => ({
  version,
  title: `Disposable Supabase gate script v${version}`,
  hook: "This harmless test verifies exact version persistence.",
  sections: [1, 2, 3].map((index) => ({ heading: `Section ${index}`, purpose: "Gate coverage", narration: `Evidence section ${index}.`, claimRefs: [], estimatedSeconds: 2 })),
  cta: "End the isolated shared-project test.",
  outro: "No production systems were touched.",
  estimatedSeconds: 11,
});

async function inspectVideoBytes(bytes: Uint8Array) {
  const root = await mkdtemp(path.join(process.cwd(), ".data", "supabase-gate-video-"));
  const file = path.join(root, "sample.mp4");
  try {
    await writeFile(file, bytes, { mode: 0o600 });
    return await inspectMedia(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function completionPayload(ownerId: string, bytes: Uint8Array, inspection: Awaited<ReturnType<typeof inspectMedia>>) {
  const checksum = sha256(bytes);
  return {
    storageBucket: bucketName,
    storageKey: `${ownerId}/masters/sha256/${checksum}.mp4`,
    checksumSha256: checksum,
    byteSize: bytes.byteLength,
    durationSeconds: inspection.durationSeconds,
    inspection: {
      checksumSha256: checksum,
      container: inspection.container,
      videoCodec: inspection.videoCodec,
      audioCodec: inspection.audioCodec,
      videoStreamCount: inspection.videoStreamCount,
      audioStreamCount: inspection.audioStreamCount,
      width: inspection.width,
      height: inspection.height,
      frameRate: inspection.frameRate,
      pixelFormat: inspection.pixelFormat,
      durationSeconds: inspection.durationSeconds,
      fileSize: bytes.byteLength,
      audioSampleRate: inspection.audioSampleRate,
      audioChannels: inspection.audioChannels,
      integratedLoudnessLufs: inspection.integratedLoudnessLufs,
      truePeakDbfs: inspection.truePeakDbfs,
      maxVolumeDbfs: inspection.maxVolumeDbfs,
      silenceRatio: inspection.silenceRatio,
    },
    qaReports: ["TECHNICAL", "RIGHTS", "CONTENT", "VISUAL", "AUDIO", "PLATFORM"].map((category) => ({ category, verdict: "PASS", automated: true, findings: [] })),
  };
}

async function main() {
  const config = readSharedSupabaseConfig();
  const samplePath = path.resolve(process.env.CHANNELWRIGHT_GATE_SAMPLE_VIDEO_PATH?.trim() || "renders/deterministic/channelwright-sample.mp4");
  const sampleVideo = new Uint8Array(await readFile(samplePath).catch(() => {
    throw new Error(`Missing real sample MP4 at ${samplePath}. Generate it with npm.cmd run video:render:sample or set CHANNELWRIGHT_GATE_SAMPLE_VIDEO_PATH.`);
  }));
  const sampleInspection = await inspectVideoBytes(sampleVideo);
  record("real master-video fixture", sampleInspection.videoStreamCount > 0 && sampleInspection.durationSeconds > 0, `bytes=${sampleVideo.byteLength}, codec=${sampleInspection.videoCodec ?? "unknown"}`);

  const admin = createClient(config.url, config.serviceRoleKey, { db: { schema: config.schema }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const anonymous = createClient(config.url, config.anonKey, { db: { schema: config.schema }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const database = new pg.Client({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: true, ca: readFileSync(config.databaseCa, "utf8") }, application_name: "channelwright-live-gate" });
  let server: ChildProcess | undefined;
  let ownerA: { user: User; email: string; password: string } | undefined;
  let ownerB: { user: User; email: string; password: string } | undefined;
  try {
    await database.connect();
    const ledger = await database.query<{ version: string }>("select version from channelwright_migrations.schema_migrations order by version");
    record("migration ledger available", ledger.rows.length > 0, `versions=${ledger.rows.map((row) => row.version).join(",")}`);

    const schemaExposure = await admin.from("channels").select("id", { count: "exact", head: true });
    record("Channelwright schema is exposed to the Supabase Data API", !schemaExposure.error, `status=${schemaExposure.status}, error=${schemaExposure.error?.code ?? "none"}`);

    const initialCounts = await database.query<{ users: string; stale_gate_users: string }>("select (select count(*) from auth.users)::text as users, (select count(*) from auth.users where email like 'channelwright-gate-%@example.invalid')::text as stale_gate_users");
    record("shared project has no stale gate identities", initialCounts.rows[0].stale_gate_users === "0", `existingSharedUsers=${initialCounts.rows[0].users}, staleGateUsers=${initialCounts.rows[0].stale_gate_users}`);

    ownerA = await createGateUser(admin, "owner-a"); ownerB = await createGateUser(admin, "owner-b");
    const authA = await authenticatedClient(config.url, config.anonKey, admin, ownerA.email);
    const authB = await authenticatedClient(config.url, config.anonKey, admin, ownerB.email);
    const clientA = authA.client; const clientB = authB.client;
    record("two real authenticated owners", true, "ownerA=token-hash-authenticated, ownerB=token-hash-authenticated");

    const channelAResult = await clientA.from("channels").insert({ owner_id: ownerA.user.id, name: "Owner A gate", concept_mode: "USER_DEFINED", preferences: {} }).select("id,name").single();
    const channelBResult = await clientB.from("channels").insert({ owner_id: ownerB.user.id, name: "Owner B gate", concept_mode: "USER_DEFINED", preferences: {} }).select("id,name").single();
    if (channelAResult.error || channelBResult.error) throw new Error(`Owner create failed: ${channelAResult.error?.message ?? channelBResult.error?.message}`);
    const channelA = channelAResult.data; const channelB = channelBResult.data;
    const updateA = await clientA.from("channels").update({ name: "Owner A gate updated" }).eq("id", channelA.id).select("id");
    const updateB = await clientB.from("channels").update({ name: "Owner B gate updated" }).eq("id", channelB.id).select("id");
    record("owners create read and update own records", !updateA.error && updateA.data?.length === 1 && !updateB.error && updateB.data?.length === 1, `ownerA=${updateA.data?.length ?? 0}, ownerB=${updateB.data?.length ?? 0}`);

    const crossRead = await clientB.from("channels").select("id").eq("id", channelA.id);
    const crossUpdate = await clientB.from("channels").update({ name: "forbidden" }).eq("id", channelA.id).select("id");
    record("Owner B cannot read or update Owner A", !crossRead.error && crossRead.data.length === 0 && !crossUpdate.error && crossUpdate.data.length === 0, `readRows=${crossRead.data?.length ?? -1}, updateRows=${crossUpdate.data?.length ?? -1}`);

    let compositeBoundaryRejected = false;
    try {
      await database.query("insert into channelwright.video_projects(channel_id, owner_id, topic) values ($1, $2, 'cross-owner test')", [channelA.id, ownerB.user.id]);
    } catch (error) { compositeBoundaryRejected = (error as { code?: string }).code === "23503"; }
    record("cross-owner relationship rejected by foreign key", compositeBoundaryRejected, compositeBoundaryRejected ? "SQLSTATE=23503" : "unexpected acceptance or error");

    const anonymousRead = await anonymous.from("channels").select("id");
    record("anonymous public-table access denied", Boolean(anonymousRead.error), `error=${anonymousRead.error?.code ?? "none"}`);

    const videoResult = await clientA.from("video_projects").insert({ owner_id: ownerA.user.id, channel_id: channelA.id, topic: "Disposable Supabase gate" }).select("id").single();
    if (videoResult.error) throw new Error(`Video creation failed: ${videoResult.error.message}`);
    const videoId = videoResult.data.id;
    const scriptOne = await clientA.from("script_versions").insert({ video_project_id: videoId, version_number: 1, script_payload: scriptPayload(1) }).select("id").single();
    const scriptTwo = await clientA.from("script_versions").insert({ video_project_id: videoId, version_number: 2, script_payload: scriptPayload(2) }).select("id").single();
    if (scriptOne.error || scriptTwo.error) throw new Error(`Script creation failed: ${scriptOne.error?.message ?? scriptTwo.error?.message}`);
    const approvalOne = await clientA.from("script_approvals").insert({ video_project_id: videoId, script_version_id: scriptOne.data.id, decision: "APPROVE", created_by: ownerA.user.id });
    if (approvalOne.error) throw new Error(`Script approval failed: ${approvalOne.error.message}`);

    const crossApproval = await clientB.from("script_approvals").insert({ video_project_id: videoId, script_version_id: scriptOne.data.id, decision: "APPROVE", created_by: ownerB.user.id });
    record("Owner B cannot approve Owner A version", Boolean(crossApproval.error), `error=${crossApproval.error?.code ?? "none"}`);

    const authWorkerCall = await clientA.rpc("claim_render_job", { p_worker_id: "forbidden-auth", p_lease_seconds: 30 });
    const anonWorkerCall = await anonymous.rpc("claim_render_job", { p_worker_id: "forbidden-anon", p_lease_seconds: 30 });
    record("worker RPCs are service-role-only", Boolean(authWorkerCall.error) && Boolean(anonWorkerCall.error), `authenticatedDenied=${Boolean(authWorkerCall.error)}, anonymousDenied=${Boolean(anonWorkerCall.error)}`);

    const cacheKey = "a".repeat(64);
    const cacheInsert = await admin.from("research_evidence_cache").insert({
      owner_id: ownerA.user.id, cache_key: cacheKey, provider: "YOUTUBE_DATA_API_V3", normalized_query: "gate research query",
      request_parameters: { maxVideos: 1, maxChannels: 1 }, evidence_payload: [{ id: "yt:video:gate123" }], usage_payload: { providerRequests: 1 },
      retrieved_at: new Date().toISOString(), expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
    if (cacheInsert.error) throw new Error(`Research cache fixture failed: ${cacheInsert.error.message}`);
    const ownerCache = await clientA.from("research_evidence_cache").select("cache_key").eq("cache_key", cacheKey);
    const crossOwnerCache = await clientB.from("research_evidence_cache").select("cache_key").eq("cache_key", cacheKey);
    const directCacheWrite = await clientA.from("research_evidence_cache").insert({ owner_id: ownerA.user.id, cache_key: "b".repeat(64), provider: "YOUTUBE_DATA_API_V3", normalized_query: "forbidden", evidence_payload: [{ id: "yt:video:forbidden" }], usage_payload: {}, retrieved_at: new Date().toISOString(), expires_at: new Date(Date.now() + 300_000).toISOString() });
    record("research cache is owner-readable and service-role-write-only", ownerCache.data?.length === 1 && crossOwnerCache.data?.length === 0 && Boolean(directCacheWrite.error), `ownerRows=${ownerCache.data?.length ?? -1}, crossOwnerRows=${crossOwnerCache.data?.length ?? -1}, ownerWriteDenied=${Boolean(directCacheWrite.error)}`);

    const forgedResearch = await clientA.rpc("start_workflow", {
      p_idempotency_key: `forged-${randomUUID()}`,
      p_input_hash: "c".repeat(64),
      p_workflow_type: "CHANNEL_RESEARCH",
      p_definition_version: 1,
      p_objective: "Bypass provider evidence",
      p_input: { channelConcept: "Faceless visual investigations of hidden business systems" },
      p_steps: [{ key: "review-research", position: 0, kind: "APPROVAL", capability: "human", dependsOn: [], maxAttempts: 1, retryBaseSeconds: 0 }],
    });
    record("direct authenticated callers cannot forge a research graph", Boolean(forgedResearch.error), `denied=${Boolean(forgedResearch.error)}`);

    server = await startProductionServer(config);
    await verifyCaptchaProtectedPasswordLogin(ownerA.email, ownerA.password);
    const cookieA = await sessionCookieHeader(config.url, config.anonKey, authA.session);
    const cookieB = await sessionCookieHeader(config.url, config.anonKey, authB.session);
    record("real Supabase SSR sessions reach production HTTP routes", cookieA.length > 0 && cookieB.length > 0, `ownerA=${cookieA.length > 0}, ownerB=${cookieB.length > 0}`);

    const unsupported = await fetch(`${appUrl}/api/workflows`, { method: "POST", headers: { cookie: cookieA, "content-type": "application/json" }, body: JSON.stringify({ type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "A valid but intentionally disabled production planning concept", preferences: { name: "Gate channel", niche: "Testing" } }) });
    record("unregistered fixture planning boundary remains HTTP 501", unsupported.status === 501, `status=${unsupported.status}`);

    const workflowInput = {
      operation: "START_WORKFLOW", workflowType: "CHANNEL_CONCEPT_VALIDATION", definitionVersion: 1,
      input: { proposedConcept: "Explain the hidden systems behind ordinary local businesses", audienceContext: "Independent operators", nicheContext: "Business operations", monetizationPaths: ["Sponsor partnerships"] },
    };
    const workflowKey = `concept-${randomUUID()}`;
    const postEngineWorkflow = (cookie: string, key: string, body: unknown) => fetch(`${appUrl}/api/workflows`, {
      method: "POST", headers: { cookie, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body),
    });
    const researchWithoutIdempotency = await fetch(`${appUrl}/api/workflows`, {
      method: "POST", headers: { cookie: cookieA, "content-type": "application/json" },
      body: JSON.stringify({ operation: "START_WORKFLOW", workflowType: "CHANNEL_RESEARCH", definitionVersion: 1, input: { channelConcept: "Faceless visual investigations of hidden business systems" } }),
    });
    record("paid research requires an explicit idempotency key", researchWithoutIdempotency.status === 400, `status=${researchWithoutIdempotency.status}`);
    const researchStart = await postEngineWorkflow(cookieA, `research-${randomUUID()}`, {
      operation: "START_WORKFLOW", workflowType: "CHANNEL_RESEARCH", definitionVersion: 1,
      input: { channelConcept: "Faceless visual investigations of hidden business systems", constraints: { faceless: true, language: "English" } },
    });
    const researchStartPayload = await researchStart.json() as { operationResult?: { workflowId?: string; runId?: string } };
    const researchWorkflowId = researchStartPayload.operationResult?.workflowId;
    const researchDetail = researchWorkflowId ? await fetch(`${appUrl}/api/workflows/${researchWorkflowId}`, { headers: { cookie: cookieA } }) : undefined;
    const researchDetailPayload = researchDetail ? await researchDetail.json() as { steps?: Array<{ step_key?: string }> } : {};
    record("CHANNEL_RESEARCH starts through the production API with its finite graph", researchStart.status === 202 && researchDetail?.status === 200 && researchDetailPayload.steps?.length === 7, `start=${researchStart.status}, detail=${researchDetail?.status ?? "missing"}, steps=${researchDetailPayload.steps?.length ?? -1}`);
    const duplicatePaidResearch = await postEngineWorkflow(cookieA, `research-${randomUUID()}`, {
      operation: "START_WORKFLOW", workflowType: "CHANNEL_RESEARCH", definitionVersion: 1,
      input: { channelConcept: "Faceless visual investigations of a second business niche" },
    });
    record("one owner cannot queue concurrent paid research runs", duplicatePaidResearch.status === 429, `status=${duplicatePaidResearch.status}`);
    const researchRunId = researchStartPayload.operationResult?.runId;
    const researchClaimResult = await admin.rpc("claim_workflow_step", { p_worker_id: "gate-research-budget-a", p_lease_seconds: 60 });
    if (researchClaimResult.error || !researchClaimResult.data) {
      const diagnostic = researchRunId ? await database.query<{ step_key: string; status: string; attempt_count: number; available: boolean; depends_on: string[] }>(
        "select step_key,status,attempt_count,available_at <= now() as available,depends_on from channelwright.workflow_steps where workflow_run_id=$1 order by position",
        [researchRunId],
      ) : { rows: [] };
      throw new Error(`Research accounting claim failed: ${researchClaimResult.error?.message ?? "no claim"}; steps=${JSON.stringify(diagnostic.rows)}`);
    }
    const researchClaim = claimedWorkflowStepSchema.parse(researchClaimResult.data);
    const researchLimits = {
      providerRequests: 12, providerQuotaUnits: 500, searches: 4, synthesisCalls: 2, qaCalls: 4,
      revisionCalls: 2, inputTokens: 250000, outputTokens: 24000, totalTokens: 274000, automatedRevisions: 1,
    };
    const ensuredBudget = await admin.rpc("ensure_research_run_budget", {
      p_run_id: researchClaim.runId, p_step_id: researchClaim.id, p_lease_token: researchClaim.leaseToken,
      p_operation_key: `${researchClaim.stepKey}:attempt:${researchClaim.attemptCount}:execution`, p_limits: researchLimits,
    });
    if (ensuredBudget.error) throw new Error(`Research budget initialization failed: ${ensuredBudget.error.message}`);
    const forbiddenUsageRpc = await clientA.rpc("reserve_research_usage", {
      p_run_id: researchClaim.runId, p_step_id: researchClaim.id, p_lease_token: researchClaim.leaseToken,
      p_operation_key: "forbidden-client", p_operation_kind: "YOUTUBE_SEARCH", p_provider_identity: "FORBIDDEN", p_model_identity: null,
      p_reservation: { providerRequests: 1, providerQuotaUnits: 100, searches: 1 },
    });
    const forbiddenBudgetWrite = await clientA.from("research_run_budgets").update({ used_totals: { providerRequests: 0 } }).eq("workflow_run_id", researchClaim.runId);
    record("research usage accounting is service-role maintained", Boolean(forbiddenUsageRpc.error) && Boolean(forbiddenBudgetWrite.error), `rpcDenied=${Boolean(forbiddenUsageRpc.error)}, tableWriteDenied=${Boolean(forbiddenBudgetWrite.error)}`);

    const reserveInput = (key: string) => admin.rpc("reserve_research_usage", {
      p_run_id: researchClaim.runId, p_step_id: researchClaim.id, p_lease_token: researchClaim.leaseToken,
      p_operation_key: key, p_operation_kind: "YOUTUBE_SEARCH", p_provider_identity: "YOUTUBE_DATA_API_V3", p_model_identity: null,
      p_reservation: { providerRequests: 8, providerQuotaUnits: 202, searches: 2 },
    });
    const concurrentReservations = await Promise.all([reserveInput("gate-concurrent-a"), reserveInput("gate-concurrent-b")]);
    const reservedUsage = concurrentReservations.filter((item) => !item.error && (item.data as { status?: string })?.status === "RESERVED");
    const rejectedUsage = concurrentReservations.filter((item) => !item.error && (item.data as { status?: string })?.status === "REJECTED");
    record("research budget reservation is atomic under contention", reservedUsage.length === 1 && rejectedUsage.length === 1, `reserved=${reservedUsage.length}, rejected=${rejectedUsage.length}`);
    const winningOperationId = (reservedUsage[0].data as { operationId: string }).operationId;
    const finalizedUsage = await admin.rpc("finalize_research_usage", { p_operation_id: winningOperationId, p_status: "SUCCEEDED", p_actual_usage: { providerRequests: 3, providerQuotaUnits: 201, searches: 2 }, p_metadata: { gate: true } });
    const replayedFinalization = await admin.rpc("finalize_research_usage", { p_operation_id: winningOperationId, p_status: "SUCCEEDED", p_actual_usage: { providerRequests: 3, providerQuotaUnits: 201, searches: 2 }, p_metadata: { gate: true } });
    const cacheReservation = await admin.rpc("reserve_research_usage", {
      p_run_id: researchClaim.runId, p_step_id: researchClaim.id, p_lease_token: researchClaim.leaseToken,
      p_operation_key: "gate-cache-hit", p_operation_kind: "CACHE_LOOKUP", p_provider_identity: "YOUTUBE_DATA_API_V3", p_model_identity: null, p_reservation: {},
    });
    const cacheOperationId = (cacheReservation.data as { operationId?: string } | null)?.operationId;
    if (cacheReservation.error || !cacheOperationId) throw new Error(`Research cache accounting reservation failed: ${cacheReservation.error?.message ?? "missing operation"}`);
    await admin.rpc("finalize_research_usage", { p_operation_id: cacheOperationId, p_status: "SUCCEEDED", p_actual_usage: { cacheHits: 1 }, p_metadata: { gate: true } });
    const budgetAfterFinalize = await clientA.from("research_run_budgets").select("used_totals,reserved_totals").eq("workflow_run_id", researchClaim.runId).single();
    const crossOwnerBudget = await clientB.from("research_run_budgets").select("workflow_run_id").eq("workflow_run_id", researchClaim.runId);
    record("usage finalization is idempotent and owner-isolated", !finalizedUsage.error && (replayedFinalization.data as { idempotentReplay?: boolean })?.idempotentReplay === true && budgetAfterFinalize.data?.used_totals?.providerRequests === 3 && budgetAfterFinalize.data?.used_totals?.cacheHits === 1 && crossOwnerBudget.data?.length === 0, `providerRequests=${budgetAfterFinalize.data?.used_totals?.providerRequests ?? "missing"}, cacheHits=${budgetAfterFinalize.data?.used_totals?.cacheHits ?? "missing"}, crossOwner=${crossOwnerBudget.data?.length ?? -1}`);

    const researchRetryFailure = await admin.rpc("fail_workflow_step", { p_step_id: researchClaim.id, p_lease_token: researchClaim.leaseToken, p_error_code: "GATE_RETRY", p_error_message: "Verify durable budget across retry", p_retryable: true });
    if (researchRetryFailure.error) throw new Error(`Research retry setup failed: ${researchRetryFailure.error.message}`);
    await database.query("update channelwright.workflow_steps set available_at = now() where id = $1", [researchClaim.id]);
    const researchRetryClaimResult = await admin.rpc("claim_workflow_step", { p_worker_id: "gate-research-budget-b", p_lease_seconds: 60 });
    if (researchRetryClaimResult.error || !researchRetryClaimResult.data) throw new Error(`Research retry claim failed: ${researchRetryClaimResult.error?.message ?? "no claim"}`);
    const researchRetryClaim = claimedWorkflowStepSchema.parse(researchRetryClaimResult.data);
    await admin.rpc("ensure_research_run_budget", {
      p_run_id: researchRetryClaim.runId, p_step_id: researchRetryClaim.id, p_lease_token: researchRetryClaim.leaseToken,
      p_operation_key: `${researchRetryClaim.stepKey}:attempt:${researchRetryClaim.attemptCount}:execution`, p_limits: researchLimits,
    });
    const retryOverBudget = await admin.rpc("reserve_research_usage", {
      p_run_id: researchRetryClaim.runId, p_step_id: researchRetryClaim.id, p_lease_token: researchRetryClaim.leaseToken,
      p_operation_key: "gate-retry-does-not-reset", p_operation_kind: "YOUTUBE_SEARCH", p_provider_identity: "YOUTUBE_DATA_API_V3", p_model_identity: null,
      p_reservation: { providerRequests: 10, providerQuotaUnits: 100, searches: 1 },
    });
    const retryBudgetState = await clientA.from("research_run_budgets").select("used_totals").eq("workflow_run_id", researchClaim.runId).single();
    record("attempt retry does not reset the logical research budget", researchRetryClaim.attemptCount === 2 && (retryOverBudget.data as { status?: string })?.status === "REJECTED" && retryBudgetState.data?.used_totals?.executionAttempts === 2, `attempt=${researchRetryClaim.attemptCount}, reservation=${(retryOverBudget.data as { status?: string } | null)?.status ?? "missing"}, aggregateAttempts=${retryBudgetState.data?.used_totals?.executionAttempts ?? "missing"}`);
    record("research budget is attached to the authenticated run", researchRunId === researchClaim.runId, `apiRun=${researchRunId}, claimedRun=${researchClaim.runId}`);
    if (researchWorkflowId) await fetch(`${appUrl}/api/workflows/${researchWorkflowId}`, { method: "DELETE", headers: { cookie: cookieA } });
    const workflowStart = await postEngineWorkflow(cookieA, workflowKey, workflowInput);
    const workflowStartPayload = await workflowStart.json() as { operationResult?: { workflowId?: string; runId?: string; idempotentReplay?: boolean } };
    const workflowId = workflowStartPayload.operationResult?.workflowId;
    const workflowRunId = workflowStartPayload.operationResult?.runId;
    record("production concept workflow starts through authenticated HTTP", workflowStart.status === 202 && Boolean(workflowId) && Boolean(workflowRunId), `status=${workflowStart.status}, workflow=${Boolean(workflowId)}, run=${Boolean(workflowRunId)}`);
    const workflowReplay = await postEngineWorkflow(cookieA, workflowKey, workflowInput);
    const workflowReplayPayload = await workflowReplay.json() as { operationResult?: { workflowId?: string; idempotentReplay?: boolean } };
    const workflowConflict = await postEngineWorkflow(cookieA, workflowKey, { ...workflowInput, input: { ...workflowInput.input, proposedConcept: "Explain the hidden economics behind ordinary local businesses" } });
    record("workflow start is race-safe and idempotent", workflowReplay.status === 202 && workflowReplayPayload.operationResult?.workflowId === workflowId && workflowReplayPayload.operationResult?.idempotentReplay === true && workflowConflict.status === 409, `replay=${workflowReplay.status}, same=${workflowReplayPayload.operationResult?.workflowId === workflowId}, conflict=${workflowConflict.status}`);

    const unauthenticatedWorkflow = await fetch(`${appUrl}/api/workflows/${workflowId}`);
    const crossOwnerWorkflow = await fetch(`${appUrl}/api/workflows/${workflowId}`, { headers: { cookie: cookieB } });
    const malformedWorkflow = await fetch(`${appUrl}/api/workflows/not-a-uuid`, { headers: { cookie: cookieA } });
    record("workflow HTTP ownership hides guessed and malformed identifiers", unauthenticatedWorkflow.status === 401 && crossOwnerWorkflow.status === 404 && malformedWorkflow.status === 422, `unauthenticated=${unauthenticatedWorkflow.status}, crossOwner=${crossOwnerWorkflow.status}, malformed=${malformedWorkflow.status}`);

    const authWorkflowClaim = await clientA.rpc("claim_workflow_step", { p_worker_id: "forbidden-auth-workflow", p_lease_seconds: 30 });
    const anonWorkflowClaim = await anonymous.rpc("claim_workflow_step", { p_worker_id: "forbidden-anon-workflow", p_lease_seconds: 30 });
    record("strategic workflow worker RPCs are service-role-only", Boolean(authWorkflowClaim.error) && Boolean(anonWorkflowClaim.error), `authenticatedDenied=${Boolean(authWorkflowClaim.error)}, anonymousDenied=${Boolean(anonWorkflowClaim.error)}`);

    const workflowClaims = await Promise.all([
      admin.rpc("claim_workflow_step", { p_worker_id: "gate-strategic-a", p_lease_seconds: 30 }),
      admin.rpc("claim_workflow_step", { p_worker_id: "gate-strategic-b", p_lease_seconds: 30 }),
    ]);
    const successfulWorkflowClaims = workflowClaims.filter((result) => !result.error && result.data);
    record("strategic workflow lease contention is atomic", successfulWorkflowClaims.length === 1, `claims=${successfulWorkflowClaims.length}`);
    const firstWorkflowClaim = claimedWorkflowStepSchema.parse(successfulWorkflowClaims[0].data);
    const workflowHeartbeat = await admin.rpc("heartbeat_workflow_step", { p_step_id: firstWorkflowClaim.id, p_lease_token: firstWorkflowClaim.leaseToken, p_lease_seconds: 45 });
    const staleWorkflowHeartbeat = await admin.rpc("heartbeat_workflow_step", { p_step_id: firstWorkflowClaim.id, p_lease_token: randomUUID(), p_lease_seconds: 45 });
    record("strategic workflow heartbeat requires the winning lease", workflowHeartbeat.data === true && staleWorkflowHeartbeat.data === false, `current=${workflowHeartbeat.data}, stale=${staleWorkflowHeartbeat.data}`);

    const retryableFailure = await admin.rpc("fail_workflow_step", { p_step_id: firstWorkflowClaim.id, p_lease_token: firstWorkflowClaim.leaseToken, p_error_code: "TRANSIENT_PROVIDER", p_error_message: "Disposable retry test", p_retryable: true });
    record("retryable workflow failure enters bounded retry wait", !retryableFailure.error && (retryableFailure.data as { status?: string })?.status === "RETRY_WAIT", `status=${(retryableFailure.data as { status?: string } | null)?.status ?? "missing"}`);
    await database.query("update channelwright.workflow_steps set available_at = now() where id = $1", [firstWorkflowClaim.id]);
    const secondWorkflowClaimResult = await admin.rpc("claim_workflow_step", { p_worker_id: "gate-strategic-retry", p_lease_seconds: 30 });
    if (secondWorkflowClaimResult.error || !secondWorkflowClaimResult.data) throw new Error(`Workflow retry claim failed: ${secondWorkflowClaimResult.error?.message ?? "no claim"}`);
    const secondWorkflowClaim = claimedWorkflowStepSchema.parse(secondWorkflowClaimResult.data);
    await database.query("update channelwright.workflow_steps set lease_expires_at = now() - interval '1 second' where id = $1", [secondWorkflowClaim.id]);
    await admin.rpc("claim_workflow_step", { p_worker_id: "gate-strategic-expiry-sweep", p_lease_seconds: 30 });
    await database.query("update channelwright.workflow_steps set available_at = now() where id = $1", [secondWorkflowClaim.id]);
    const recoveredWorkflowClaimResult = await admin.rpc("claim_workflow_step", { p_worker_id: "gate-strategic-recovery", p_lease_seconds: 30 });
    if (recoveredWorkflowClaimResult.error || !recoveredWorkflowClaimResult.data) throw new Error(`Workflow expired-lease recovery failed: ${recoveredWorkflowClaimResult.error?.message ?? "no claim"}`);
    const recoveredWorkflowClaim = claimedWorkflowStepSchema.parse(recoveredWorkflowClaimResult.data);
    const staleWorkflowComplete = await admin.rpc("complete_workflow_step", { p_step_id: secondWorkflowClaim.id, p_lease_token: secondWorkflowClaim.leaseToken, p_output: { invalid: "stale" } });
    record("expired strategic lease recovers and stale holder cannot complete", recoveredWorkflowClaim.attemptCount === 3 && Boolean(staleWorkflowComplete.error), `attempt=${recoveredWorkflowClaim.attemptCount}, staleDenied=${Boolean(staleWorkflowComplete.error)}`);

    const conceptExecutor = new ChannelConceptValidationExecutor();
    const recoveredOutput = await conceptExecutor.execute(recoveredWorkflowClaim);
    const recoveredComplete = await admin.rpc("complete_workflow_step", { p_step_id: recoveredWorkflowClaim.id, p_lease_token: recoveredWorkflowClaim.leaseToken, p_output: recoveredOutput });
    if (recoveredComplete.error) throw new Error(`Recovered workflow completion failed: ${recoveredComplete.error.message}`);
    for (let stepIndex = 0; stepIndex < 3; stepIndex += 1) {
      const claim = await admin.rpc("claim_workflow_step", { p_worker_id: `gate-strategic-${stepIndex}`, p_lease_seconds: 30 });
      if (claim.error || !claim.data) throw new Error(`Workflow step ${stepIndex + 2} claim failed: ${claim.error?.message ?? "no claim"}`);
      const parsedClaim = claimedWorkflowStepSchema.parse(claim.data);
      const output = await conceptExecutor.execute(parsedClaim);
      const completion = await admin.rpc("complete_workflow_step", { p_step_id: parsedClaim.id, p_lease_token: parsedClaim.leaseToken, p_output: output });
      if (completion.error) throw new Error(`Workflow step ${parsedClaim.stepKey} completion failed: ${completion.error.message}`);
    }

    const pendingApproval = await clientA.from("workflow_approvals").select("id,status").eq("workflow_id", workflowId!).eq("status", "PENDING").single();
    const waitingRun = await clientA.from("workflow_runs").select("status,output_payload").eq("id", workflowRunId!).single();
    record("typed workflow output persists behind an explicit approval wait", !pendingApproval.error && waitingRun.data?.status === "WAITING_FOR_APPROVAL" && waitingRun.data.output_payload?.recommendation === "RESEARCH_REQUIRED" && waitingRun.data.output_payload?.providerBoundary === "NO_LIVE_YOUTUBE_OR_MARKET_PROVIDER_DATA", `approval=${pendingApproval.data?.status ?? "missing"}, run=${waitingRun.data?.status ?? "missing"}`);
    const crossOwnerDecision = await fetch(`${appUrl}/api/workflows/${workflowId}/approvals/${pendingApproval.data!.id}`, { method: "POST", headers: { cookie: cookieB, "content-type": "application/json" }, body: JSON.stringify({ decision: "APPROVE" }) });
    const ownerDecision = await fetch(`${appUrl}/api/workflows/${workflowId}/approvals/${pendingApproval.data!.id}`, { method: "POST", headers: { cookie: cookieA, "content-type": "application/json" }, body: JSON.stringify({ decision: "APPROVE", note: "Disposable gate approval" }) });
    const completedRun = await clientA.from("workflow_runs").select("status").eq("id", workflowRunId!).single();
    record("workflow approval is owner-only and completes the run", crossOwnerDecision.status === 404 && ownerDecision.status === 200 && completedRun.data?.status === "COMPLETED", `crossOwner=${crossOwnerDecision.status}, owner=${ownerDecision.status}, run=${completedRun.data?.status ?? "missing"}`);

    const cancellationStart = await postEngineWorkflow(cookieA, `cancel-${randomUUID()}`, { ...workflowInput, input: { ...workflowInput.input, proposedConcept: "Explain the operational systems behind independent online businesses" } });
    const cancellationPayload = await cancellationStart.json() as { operationResult?: { workflowId?: string } };
    const cancellationResponse = await fetch(`${appUrl}/api/workflows/${cancellationPayload.operationResult?.workflowId}`, { method: "DELETE", headers: { cookie: cookieA } });
    const canceledSteps = await clientA.from("workflow_steps").select("status").eq("workflow_id", cancellationPayload.operationResult?.workflowId);
    record("workflow cancellation leaves no falsely active steps", cancellationResponse.status === 200 && !canceledSteps.error && canceledSteps.data.every((step) => step.status === "CANCELED"), `status=${cancellationResponse.status}, steps=${canceledSteps.data?.map((step) => step.status).join(",") ?? "missing"}`);

    const terminalStart = await postEngineWorkflow(cookieA, `terminal-${randomUUID()}`, { ...workflowInput, input: { ...workflowInput.input, proposedConcept: "Explain the business systems behind specialized service companies" } });
    const terminalPayload = await terminalStart.json() as { operationResult?: { workflowId?: string } };
    const terminalClaimResult = await admin.rpc("claim_workflow_step", { p_worker_id: "gate-strategic-terminal", p_lease_seconds: 30 });
    if (terminalClaimResult.error || !terminalClaimResult.data) throw new Error(`Terminal workflow claim failed: ${terminalClaimResult.error?.message ?? "no claim"}`);
    const terminalClaim = claimedWorkflowStepSchema.parse(terminalClaimResult.data);
    const terminalFailure = await admin.rpc("fail_workflow_step", { p_step_id: terminalClaim.id, p_lease_token: terminalClaim.leaseToken, p_error_code: "INVALID_OUTPUT", p_error_message: "Disposable terminal test", p_retryable: false });
    const terminalWorkflow = await clientA.from("workflows").select("status").eq("id", terminalPayload.operationResult?.workflowId).single();
    record("terminal workflow failure stops retries", !terminalFailure.error && (terminalFailure.data as { retryable?: boolean })?.retryable === false && terminalWorkflow.data?.status === "FAILED", `retryable=${(terminalFailure.data as { retryable?: boolean } | null)?.retryable}, workflow=${terminalWorkflow.data?.status ?? "missing"}`);
    const workflowEvents = await clientA.from("workflow_events").select("actor_type,event_type,detail").eq("workflow_id", workflowId!);
    record("workflow transitions retain structured user and worker audit events", !workflowEvents.error && workflowEvents.data.some((event) => event.actor_type === "USER") && workflowEvents.data.some((event) => event.actor_type === "WORKER") && workflowEvents.data.every((event) => typeof event.event_type === "string" && event.detail && typeof event.detail === "object"), `events=${workflowEvents.data?.length ?? 0}`);

    const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlGQAAAAASUVORK5CYII=", "base64"));
    const assetMetadata = { kind: "IMAGE", provider: "channelwright-shared-project-gate", rightsStatus: "VERIFIED", provenance: { source: "generated-test-pixel" }, licenseReference: "Channelwright isolated shared-project test fixture" };
    const uploadAsset = async (idempotencyKey: string, contentType = "image/png") => {
      const form = new FormData();
      form.set("file", new File([png], "gate.png", { type: contentType }));
      form.set("metadata", JSON.stringify(assetMetadata));
      return fetch(`${appUrl}/api/media/assets`, { method: "POST", headers: { cookie: cookieA, "idempotency-key": idempotencyKey }, body: form });
    };
    const uploadKey = `asset-${randomUUID()}`;
    const assetUpload = await uploadAsset(uploadKey); const assetResult = await assetUpload.json() as { assetVersionId?: string; assetId?: string; error?: string };
    record("real private asset upload through HTTP", assetUpload.status === 201 && Boolean(assetResult.assetVersionId), `status=${assetUpload.status}, registered=${Boolean(assetResult.assetVersionId)}`);
    const assetVersionId = assetResult.assetVersionId!;
    const assetRow = await clientA.from("media_asset_versions").select("storage_key,checksum_sha256").eq("id", assetVersionId).single();
    if (assetRow.error) throw new Error(`Uploaded asset metadata is missing: ${assetRow.error.message}`);
    createdObjects.add(assetRow.data.storage_key);
    const assetRetry = await uploadAsset(uploadKey); const assetRetryResult = await assetRetry.json() as { assetVersionId?: string };
    record("exact asset retry is idempotent", assetRetry.status === 201 && assetRetryResult.assetVersionId === assetVersionId, `status=${assetRetry.status}, sameVersion=${assetRetryResult.assetVersionId === assetVersionId}`);
    const duplicate = await uploadAsset(`asset-${randomUUID()}`); const duplicateResult = await duplicate.json() as { assetVersionId?: string };
    record("duplicate ingestion reuses immutable version", duplicate.status === 201 && duplicateResult.assetVersionId === assetVersionId, `sameVersion=${duplicateResult.assetVersionId === assetVersionId}`);

    const invalidMime = await uploadAsset(`invalid-${randomUUID()}`, "text/html");
    record("invalid MIME upload rejected", invalidMime.status === 400 || invalidMime.status === 422, `status=${invalidMime.status}`);
    const oversizedMetadata = await clientA.rpc("register_media_asset_version", {
      p_idempotency_key: `oversize-${randomUUID()}`,
      p_input_fingerprint: "a".repeat(64),
      p_asset: { ...assetMetadata, storageBucket: bucketName, storageKey: `${ownerA.user.id}/assets/sha256/${"b".repeat(64)}.png`, checksumSha256: "b".repeat(64), mimeType: "image/png", byteSize: 524288001, width: 1, height: 1 },
    });
    record("excessive-size metadata rejected", Boolean(oversizedMetadata.error), `error=${oversizedMetadata.error?.code ?? "none"}`);

    const directA = await clientA.storage.from(bucketName).download(assetRow.data.storage_key);
    const directB = await clientB.storage.from(bucketName).download(assetRow.data.storage_key);
    const directAnon = await anonymous.storage.from(bucketName).download(assetRow.data.storage_key);
    const listB = await clientB.storage.from(bucketName).list(`${ownerA.user.id}/assets`);
    const overwriteA = await clientA.storage.from(bucketName).upload(assetRow.data.storage_key, png, { contentType: "image/png", upsert: true });
    const deleteA = await clientA.storage.from(bucketName).remove([assetRow.data.storage_key]);
    const objectAfterDeleteAttempt = await admin.storage.from(bucketName).download(assetRow.data.storage_key);
    const ownerDeleteDenied = !objectAfterDeleteAttempt.error
      && sha256(new Uint8Array(await objectAfterDeleteAttempt.data.arrayBuffer())) === assetRow.data.checksum_sha256;
    const ownerBListDenied = Boolean(listB.error) || listB.data?.length === 0;
    record("private Storage owner isolation", !directA.error && Boolean(directB.error) && Boolean(directAnon.error) && ownerBListDenied && Boolean(overwriteA.error) && ownerDeleteDenied, `ownerRead=${!directA.error}, ownerBReadDenied=${Boolean(directB.error)}, ownerBListDenied=${ownerBListDenied}, ownerBListError=${listB.error?.statusCode ?? "none"}, anonDenied=${Boolean(directAnon.error)}, ownerOverwriteDenied=${Boolean(overwriteA.error)}, deleteApiError=${Boolean(deleteA.error)}, objectPreservedAfterDelete=${ownerDeleteDenied}`);

    const signedResponse = await fetch(`${appUrl}/api/media/assets/${assetVersionId}/signed-url?expires=5`, { method: "POST", headers: { cookie: cookieA } });
    const signedPayload = await signedResponse.json() as { signedUrl?: string };
    const crossSigned = await fetch(`${appUrl}/api/media/assets/${assetVersionId}/signed-url?expires=30`, { method: "POST", headers: { cookie: cookieB } });
    if (!signedPayload.signedUrl) throw new Error(`Signed URL route failed with status ${signedResponse.status}`);
    const beforeExpiry = await fetch(signedPayload.signedUrl, { cache: "no-store" });
    const beforeExpiryError = beforeExpiry.ok ? "none" : (await beforeExpiry.clone().text()).slice(0, 300);
    await pause(6500);
    const afterExpiry = await fetch(signedPayload.signedUrl, { cache: "no-store" });
    record("server-mediated signed URL ownership and expiry", signedResponse.status === 200 && beforeExpiry.ok && !afterExpiry.ok && crossSigned.status === 404, `before=${beforeExpiry.status}, beforeError=${beforeExpiryError}, after=${afterExpiry.status}, crossOwner=${crossSigned.status}`);

    const renderAction = { type: "CREATE_RENDER_JOB", videoId, scriptVersion: 1, assetVersionIds: [] };
    const renderKey = `render-${randomUUID()}`;
    const postWorkflow = (cookie: string, key: string, action: unknown) => fetch(`${appUrl}/api/workflows`, { method: "POST", headers: { cookie, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(action) });
    const renderCreate = await postWorkflow(cookieA, renderKey, renderAction); const renderPayload = await renderCreate.json() as { operationResult?: { jobId?: string }; error?: string };
    record("production media action persists through HTTP and RPC", renderCreate.status === 200 && Boolean(renderPayload.operationResult?.jobId), `status=${renderCreate.status}, job=${Boolean(renderPayload.operationResult?.jobId)}`);
    const jobId = renderPayload.operationResult!.jobId!;
    const renderRetry = await postWorkflow(cookieA, renderKey, renderAction); const retryPayload = await renderRetry.json() as { operationResult?: { jobId?: string } };
    record("exact workflow retry is idempotent", renderRetry.status === 200 && retryPayload.operationResult?.jobId === jobId, `status=${renderRetry.status}, sameJob=${retryPayload.operationResult?.jobId === jobId}`);
    const idempotencyConflict = await postWorkflow(cookieA, renderKey, { ...renderAction, scriptVersion: 2 });
    record("idempotency conflict is rejected", idempotencyConflict.status === 409, `status=${idempotencyConflict.status}`);
    const unapprovedVersion = await postWorkflow(cookieA, `render-unapproved-${randomUUID()}`, { ...renderAction, scriptVersion: 2 });
    const crossOwnerRender = await postWorkflow(cookieB, `render-cross-${randomUUID()}`, renderAction);
    record("exact approval and owner identity enforced", unapprovedVersion.status === 409 && crossOwnerRender.status === 404, `unapproved=${unapprovedVersion.status}, crossOwner=${crossOwnerRender.status}`);

    const claims = await Promise.all([
      admin.rpc("claim_render_job", { p_worker_id: "gate-worker-a", p_lease_seconds: 30 }),
      admin.rpc("claim_render_job", { p_worker_id: "gate-worker-b", p_lease_seconds: 30 }),
    ]);
    const successfulClaims = claims.filter((item) => !item.error && item.data);
    record("atomic lease contention", successfulClaims.length === 1, `claims=${successfulClaims.length}`);
    const firstClaim = successfulClaims[0].data as { id: string; leaseToken: string; leasedBy: string };
    const secondWhileActive = await admin.rpc("claim_render_job", { p_worker_id: "gate-worker-second", p_lease_seconds: 30 });
    record("active lease excludes second worker", !secondWhileActive.error && secondWhileActive.data === null, `secondClaim=${secondWhileActive.data === null ? "none" : "unexpected"}`);
    const heartbeat = await admin.rpc("heartbeat_render_job", { p_job_id: jobId, p_lease_token: firstClaim.leaseToken, p_lease_seconds: 45 });
    const staleHeartbeat = await admin.rpc("heartbeat_render_job", { p_job_id: jobId, p_lease_token: randomUUID(), p_lease_seconds: 45 });
    record("lease renewal requires current holder", heartbeat.data === true && staleHeartbeat.data === false, `current=${heartbeat.data}, stale=${staleHeartbeat.data}`);

    await database.query("update channelwright.render_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [jobId]);
    const recovered = await admin.rpc("claim_render_job", { p_worker_id: "gate-worker-recovery", p_lease_seconds: 30 });
    if (recovered.error || !recovered.data) throw new Error(`Expired lease recovery failed: ${recovered.error?.message ?? "no claim"}`);
    const recoveryClaim = recovered.data as { id: string; leaseToken: string; leasedBy: string };
    const staleFail = await admin.rpc("fail_render_job", { p_job_id: jobId, p_lease_token: firstClaim.leaseToken, p_error_code: "STALE", p_error_message: "stale holder", p_retryable: false });
    const staleCompleteBefore = await admin.rpc("complete_render_job", { p_job_id: jobId, p_lease_token: firstClaim.leaseToken, p_completion: {} });
    record("expired lease recovers and stale holder cannot mutate", recoveryClaim.leasedBy === "gate-worker-recovery" && Boolean(staleFail.error) && Boolean(staleCompleteBefore.error), `recoveredBy=${recoveryClaim.leasedBy}, staleFailDenied=${Boolean(staleFail.error)}, staleCompleteDenied=${Boolean(staleCompleteBefore.error)}`);

    const masterOne = completionPayload(ownerA.user.id, sampleVideo, sampleInspection);
    const masterUpload = await admin.storage.from(bucketName).upload(masterOne.storageKey, sampleVideo, { contentType: "video/mp4", upsert: false });
    if (masterUpload.error) throw new Error(`Master upload failed: ${masterUpload.error.message}`);
    createdObjects.add(masterOne.storageKey);
    const masterDownload = await admin.storage.from(bucketName).download(masterOne.storageKey);
    record("real private master object round-trip", !masterDownload.error && sha256(new Uint8Array(await masterDownload.data.arrayBuffer())) === masterOne.checksumSha256, `bytes=${sampleVideo.byteLength}`);
    const completeOne = await admin.rpc("complete_render_job", { p_job_id: jobId, p_lease_token: recoveryClaim.leaseToken, p_completion: masterOne });
    if (completeOne.error) throw new Error(`Master completion failed: ${completeOne.error.message}`);
    const winningRetry = await admin.rpc("complete_render_job", { p_job_id: jobId, p_lease_token: recoveryClaim.leaseToken, p_completion: masterOne });
    const staleCompleteAfter = await admin.rpc("complete_render_job", { p_job_id: jobId, p_lease_token: firstClaim.leaseToken, p_completion: masterOne });
    record("completion retry binds to winning lease", !winningRetry.error && Boolean(staleCompleteAfter.error), `winnerRetry=${!winningRetry.error}, staleAfter=${Boolean(staleCompleteAfter.error)}`);
    const masterOneId = (completeOne.data as { masterId: string }).masterId;
    const approveOne = await postWorkflow(cookieA, `approve-${randomUUID()}`, { type: "APPROVE_PRODUCTION_MASTER", masterId: masterOneId, masterVersion: 1 });
    record("exact master version approval", approveOne.status === 200, `status=${approveOne.status}`);

    const approvalTwo = await clientA.from("script_approvals").insert({ video_project_id: videoId, script_version_id: scriptTwo.data.id, decision: "APPROVE", created_by: ownerA.user.id });
    if (approvalTwo.error) throw new Error(`Second script approval failed: ${approvalTwo.error.message}`);
    const renderTwoResponse = await postWorkflow(cookieA, `render-two-${randomUUID()}`, { ...renderAction, scriptVersion: 2 });
    const renderTwoPayload = await renderTwoResponse.json() as { operationResult?: { jobId?: string } };
    if (renderTwoResponse.status !== 200 || !renderTwoPayload.operationResult?.jobId) throw new Error(`Second render creation failed with ${renderTwoResponse.status}`);
    const jobTwoId = renderTwoPayload.operationResult.jobId;
    const claimTwo = await admin.rpc("claim_render_job", { p_worker_id: "gate-worker-version-two", p_lease_seconds: 30 });
    if (claimTwo.error || !claimTwo.data) throw new Error(`Second render claim failed: ${claimTwo.error?.message ?? "no claim"}`);
    const alteredVideo = new Uint8Array(Buffer.concat([Buffer.from(sampleVideo), Buffer.from([0])]));
    const alteredInspection = await inspectVideoBytes(alteredVideo);
    const masterTwo = completionPayload(ownerA.user.id, alteredVideo, alteredInspection);
    const uploadTwo = await admin.storage.from(bucketName).upload(masterTwo.storageKey, alteredVideo, { contentType: "video/mp4", upsert: false });
    if (uploadTwo.error) throw new Error(`Second master upload failed: ${uploadTwo.error.message}`);
    createdObjects.add(masterTwo.storageKey);
    const completeTwo = await admin.rpc("complete_render_job", { p_job_id: jobTwoId, p_lease_token: (claimTwo.data as { leaseToken: string }).leaseToken, p_completion: masterTwo });
    if (completeTwo.error) throw new Error(`Second master completion failed: ${completeTwo.error.message}`);
    const masterTwoId = (completeTwo.data as { masterId: string }).masterId;
    const versionStates = await clientA.from("production_master_versions").select("id,version_number,status,approved_at").in("id", [masterOneId, masterTwoId]).order("version_number");
    const approvalRows = await clientA.from("production_master_approvals").select("master_id,master_version").in("master_id", [masterOneId, masterTwoId]);
    const later = versionStates.data?.find((row) => row.id === masterTwoId);
    record("later master version does not inherit approval", !versionStates.error && !approvalRows.error && later?.status === "REVIEW_REQUIRED" && later.approved_at === null && approvalRows.data?.filter((row) => row.master_id === masterTwoId).length === 0, `laterStatus=${later?.status ?? "missing"}, laterApprovals=${approvalRows.data?.filter((row) => row.master_id === masterTwoId).length ?? -1}`);

    const removeAsset = await admin.storage.from(bucketName).remove([assetRow.data.storage_key]);
    if (removeAsset.error) throw new Error(`Reconciliation setup failed: ${removeAsset.error.message}`);
    let storageMetadataPresent = true;
    for (let attempt = 0; attempt < 20 && storageMetadataPresent; attempt += 1) {
      const state = await database.query<{ present: boolean }>("select exists(select 1 from storage.objects where bucket_id = $1 and name = $2) as present", [bucketName, assetRow.data.storage_key]);
      storageMetadataPresent = state.rows[0].present;
      if (storageMetadataPresent) await pause(100);
    }
    if (!storageMetadataPresent) createdObjects.delete(assetRow.data.storage_key);
    const missingDownload = await admin.storage.from(bucketName).download(assetRow.data.storage_key);
    const metadataStillPresent = await clientA.from("media_asset_versions").select("id").eq("id", assetVersionId).maybeSingle();
    const reconciliation = await admin.rpc("inspect_media_storage_reconciliation");
    const missingKeys = (reconciliation.data as { missingStorageObjects?: string[] } | null)?.missingStorageObjects ?? [];
    record("missing-object reconciliation is detectable", !storageMetadataPresent && !metadataStillPresent.error && metadataStillPresent.data?.id === assetVersionId && !reconciliation.error && missingKeys.includes(assetRow.data.storage_key), `storageMetadataMissing=${!storageMetadataPresent}, downloadCacheMiss=${Boolean(missingDownload.error)}, metadataPresent=${Boolean(metadataStillPresent.data)}, reportedMissing=${missingKeys.includes(assetRow.data.storage_key)}`);

    const cleanup = await cleanupGateArtifacts(admin, database);
    record("shared-project test artifacts cleaned", cleanup.removedUsers === 2 && cleanup.removedObjects >= 2, `users=${cleanup.removedUsers}, objects=${cleanup.removedObjects}`);

    const report = {
      gate: "SHARED_PROJECT_LIVE_PATH_PASSED",
      project: safeProjectIdentity(config),
      migrationVersions: ledger.rows.map((row) => row.version),
      checks,
      counts: { passed: checks.length, failed: 0, skipped: 0 },
      exercised: { authenticatedOwners: 2, httpRoutes: ["/api/auth/login", "/api/workflows", "/api/workflows/:id", "/api/workflows/:id/approvals/:id", "/api/media/assets", "/api/media/assets/:versionId/signed-url"], rpc: ["start_workflow", "claim_workflow_step", "heartbeat_workflow_step", "fail_workflow_step", "complete_workflow_step", "decide_workflow_approval", "cancel_workflow", "ensure_research_run_budget", "reserve_research_usage", "finalize_research_usage", "register_media_asset_version", "execute_media_production_action", "claim_render_job", "heartbeat_render_job", "fail_render_job", "complete_render_job", "inspect_media_storage_reconciliation"], objects: [...createdObjects] },
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await stopServer(server);
    if (createdObjects.size || createdUsers.length) {
      await cleanupGateArtifacts(admin, database).catch((error) => {
        console.error(JSON.stringify({ cleanup: "FAILED", error: error instanceof Error ? error.message : String(error) }));
      });
    }
    if ((database as unknown as { _ending?: boolean })._ending !== true) await database.end().catch(() => undefined);
  }
}

main().catch((error) => {
  const failedChecks = checks.filter((item) => !item.passed).length;
  console.error(JSON.stringify({ gate: "SHARED_PROJECT_LIVE_PATH_FAILED", error: error instanceof Error ? error.message : String(error), counts: { passed: checks.filter((item) => item.passed).length, failed: Math.max(1, failedChecks), skipped: 0 }, temporaryObjectsRemaining: createdObjects.size }, null, 2));
  process.exitCode = 1;
});
