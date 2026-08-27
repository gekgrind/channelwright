/**
 * Disposable PostgreSQL runtime gate for the CHANNEL_VIDEO_SCRIPT migration chain.
 *
 * Unlike the persisted gate (which targets shared Supabase), this creates a
 * throwaway database on a disposable PostgreSQL server, installs a minimal
 * Supabase-compatible shim (roles, auth/extensions/storage schemas, pgcrypto,
 * auth.uid/jwt), applies the ENTIRE migration chain from scratch, runtime-proves
 * behaviour that source-text tests cannot (migration execution, pgcrypto
 * resolution, resolver trust boundary, RLS, immutability including the new
 * VIDEO_BRIEF/VIDEO_SCRIPT coverage, concurrency, canonical parity, zero-retrieval
 * accounting), then drops the database and verifies cleanup.
 *
 * It never touches shared/production Supabase and requires no paid providers.
 *
 * Connection: CHANNELWRIGHT_DISPOSABLE_DATABASE_URL, else DATABASE_URL, else a
 * local default. If no server is reachable it reports UNAVAILABLE (exit 2) rather
 * than silently passing.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { canonicalJson } from "../src/server/workflows/canonical-json";
import { approvedVideoBriefArtifactFixture } from "../src/server/workflows/video-script-fixtures.test-helper";

try { process.loadEnvFile(".env.local"); } catch { /* optional */ }

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, passed: boolean, detail = "") => { checks.push({ name, passed, detail }); };
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const CONNECTION = process.env.CHANNELWRIGHT_DISPOSABLE_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";

const migrationsDir = resolve(process.cwd(), "supabase", "migrations");
const loadMigrations = () => readdirSync(migrationsDir)
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
  .sort((a, b) => a.localeCompare(b))
  .map((name) => ({ name, sql: readFileSync(resolve(migrationsDir, name), "utf8") }));

/** Minimal Supabase-compatible shim so the chain can apply on bare PostgreSQL. */
const SUPABASE_SHIM = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb, '{}'::jsonb)
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name,'/'))[1:greatest(array_length(string_to_array(name,'/'),1)-1,0)]
$$;
grant usage on schema extensions, auth, storage to authenticated, service_role, anon;
`;

async function asOwner<T>(db: pg.Client, ownerId: string | null, run: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    const claims = ownerId === null ? JSON.stringify({ role: "anon" }) : JSON.stringify({ sub: ownerId, role: "authenticated" });
    await db.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    const result = await run();
    await db.query("commit");
    return result;
  } catch (error) { await db.query("rollback"); throw error; }
}

async function expectFailure(db: pg.Client, ownerId: string | null, sql: string, params: unknown[]): Promise<string> {
  try { await asOwner(db, ownerId, () => db.query(sql, params as never[])); return ""; }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}

/** Seeds a COMPLETED, human-approved paid run with an APPROVED approval. */
async function seedApprovedRun(db: pg.Client, ownerId: string, type: string, output: unknown, provStep: string, provOutput: unknown, opts: { approve?: boolean; corruptHash?: boolean; finalizerStep: string; finalQaStep: string } = { finalizerStep: "", finalQaStep: "" }) {
  const { approve = true, corruptHash = false, finalizerStep, finalQaStep } = opts;
  const workflowId = randomUUID();
  const runId = randomUUID();
  await db.query("insert into auth.users(id,email) values ($1,$2) on conflict do nothing", [ownerId, `${ownerId}@disposable.test`]);
  await db.query(`insert into channelwright.workflows(id,owner_id,workflow_type,definition_version,objective,status) values ($1,$2,$3,1,'disposable gate','COMPLETED')`, [workflowId, ownerId, type]);
  await db.query(`insert into channelwright.workflow_runs(id,owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload,output_payload,completed_at)
    values ($1,$2,$3,$4,1,'COMPLETED',$5,$6,'{}'::jsonb,$7::jsonb,now())`,
    [runId, ownerId, workflowId, type, `disp:${runId}`, "0".repeat(64), JSON.stringify(output)]);
  await db.query("update channelwright.workflows set current_run_id=$2 where id=$1", [workflowId, runId]);
  const steps: Array<[string, unknown]> = [];
  if (provStep) steps.push([provStep, provOutput]);
  if (finalQaStep) steps.push([finalQaStep, { qa: { passed: true, score: 86, findings: [], recommendation: "accept", deterministicChecksPassed: 30, deterministicChecksFailed: 0, modelUsage: { model: "g", inputTokens: 1, outputTokens: 1, totalTokens: 2 } } }]);
  if (finalizerStep) steps.push([finalizerStep, output]);
  let position = 0;
  for (const [key, out] of steps) {
    await db.query(`insert into channelwright.workflow_steps(id,owner_id,workflow_id,workflow_run_id,step_key,position,kind,capability,depends_on,status,max_attempts,retry_base_seconds,output_payload,completed_at)
      values ($1,$2,$3,$4,$5,$6,'WORKER','gate','{}','COMPLETED',1,0,$7::jsonb,now())`,
      [randomUUID(), ownerId, workflowId, runId, key, position++, JSON.stringify(out)]);
  }
  if (provStep) {
    await db.query(corruptHash
      ? `update channelwright.workflow_runs set artifact_hash=$2, provenance_hash=encode(extensions.digest((select output_payload from channelwright.workflow_steps where workflow_run_id=$1 and step_key=$3)::text,'sha256'),'hex') where id=$1`
      : `update channelwright.workflow_runs set artifact_hash=encode(extensions.digest(output_payload::text,'sha256'),'hex'), provenance_hash=encode(extensions.digest((select output_payload from channelwright.workflow_steps where workflow_run_id=$1 and step_key=$3)::text,'sha256'),'hex') where id=$1`,
      corruptHash ? [runId, "f".repeat(64), provStep] : [runId, null, provStep]);
  }
  const approvalStepId = randomUUID();
  await db.query(`insert into channelwright.workflow_steps(id,owner_id,workflow_id,workflow_run_id,step_key,position,kind,capability,depends_on,status,max_attempts,retry_base_seconds,completed_at)
    values ($1,$2,$3,$4,'review',99,'APPROVAL','human','{}','COMPLETED',1,0,now())`, [approvalStepId, ownerId, workflowId, runId]);
  await db.query(approve
    ? `insert into channelwright.workflow_approvals(id,owner_id,workflow_id,workflow_run_id,workflow_step_id,gate_key,status,request_payload,decided_by,decided_at) values ($1,$2,$3,$4,$5,'review','APPROVED','{}'::jsonb,$2,now())`
    : `insert into channelwright.workflow_approvals(id,owner_id,workflow_id,workflow_run_id,workflow_step_id,gate_key,status,request_payload) values ($1,$2,$3,$4,$5,'review','PENDING','{}'::jsonb)`,
    [randomUUID(), ownerId, workflowId, runId, approvalStepId]);
  return { workflowId, runId };
}

async function runChecks(db: pg.Client) {
  const brief = approvedVideoBriefArtifactFixture.briefResult;
  const discovery = approvedVideoBriefArtifactFixture.discoveryBundle;
  const contentRef = brief.upstreamContentIntelligence;
  const provenance = { reference: contentRef, contentResult: {}, discoveryBundle: discovery, selectedTopic: {}, selection: {} };
  const ownerA = randomUUID();
  const ownerB = randomUUID();

  // --- pgcrypto / search_path -------------------------------------------
  const digest = await db.query<{ h: string }>("select encode(extensions.digest('x','sha256'),'hex') as h");
  record("pgcrypto extensions.digest resolves at runtime", digest.rows[0].h === sha256("x"));

  // --- functions compiled -----------------------------------------------
  const fns = await db.query<{ count: string }>(
    "select count(*)::text as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='channelwright' and p.proname in ('resolve_approved_research_artifact','resolve_approved_strategy_artifact','resolve_approved_content_artifact','resolve_approved_video_brief_artifact')");
  record("all four approved-artifact resolvers compiled", fns.rows[0].count === "4", `count=${fns.rows[0].count}`);

  // --- canonical parity --------------------------------------------------
  const contract = brief.viewerValue.contract;
  const canon = await db.query<{ c: string }>("select channelwright.canonical_jsonb_text($1::jsonb) as c", [JSON.stringify(contract)]);
  record("canonical_jsonb_text parity with application", canon.rows[0].c === canonicalJson(contract));

  // --- resolver valid ----------------------------------------------------
  const seeded = await seedApprovedRun(db, ownerA, "CHANNEL_VIDEO_BRIEF", brief, "validate-approved-content", provenance, { finalizerStep: "finalize-video-brief", finalQaStep: "final-video-brief-qa" });
  const resolved = await asOwner(db, ownerA, () => db.query<{ result: Record<string, unknown> }>("select channelwright.resolve_approved_video_brief_artifact($1,$2) as result", [seeded.workflowId, seeded.runId]));
  const scope = (resolved.rows[0].result as { scope: Record<string, unknown> }).scope;
  const prov = (scope as { inheritedViewerValueProvenance: Record<string, unknown> }).inheritedViewerValueProvenance;
  record("resolver returns scope for the approved brief owner", typeof scope.briefTopicId === "string");
  record("inherited Viewer Value contract hash matches app canonical hash", prov.contractHash === sha256(canonicalJson(contract)));
  record("inherited provenance records VIDEO_BRIEF origin and PASS gate", prov.originStage === "VIDEO_BRIEF" && prov.gate === "PASS");

  // --- resolver invalid --------------------------------------------------
  record("cross-owner resolution is NOT_FOUND", (await expectFailure(db, ownerB, "select channelwright.resolve_approved_video_brief_artifact($1,$2)", [seeded.workflowId, seeded.runId])).includes("NOT_FOUND"));
  const unapproved = await seedApprovedRun(db, ownerA, "CHANNEL_VIDEO_BRIEF", brief, "validate-approved-content", provenance, { approve: false, finalizerStep: "finalize-video-brief", finalQaStep: "final-video-brief-qa" });
  record("unapproved brief is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_brief_artifact($1,$2)", [unapproved.workflowId, unapproved.runId])).includes("UPSTREAM_BRIEF_NOT_APPROVED"));
  const corrupt = await seedApprovedRun(db, ownerA, "CHANNEL_VIDEO_BRIEF", brief, "validate-approved-content", provenance, { corruptHash: true, finalizerStep: "finalize-video-brief", finalQaStep: "final-video-brief-qa" });
  record("altered brief hash fails integrity", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_brief_artifact($1,$2)", [corrupt.workflowId, corrupt.runId])).includes("UPSTREAM_BRIEF_INTEGRITY_MISMATCH"));

  // --- RLS ---------------------------------------------------------------
  const rls = await db.query<{ enabled: boolean }>("select bool_and(c.relrowsecurity) as enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='channelwright' and c.relkind='r' and c.relname in ('workflows','workflow_runs','workflow_steps','workflow_approvals','research_run_budgets','research_usage_operations')");
  record("RLS enabled on every workflow table", rls.rows[0].enabled === true);

  // --- immutability (defect #1) — privileged writes must still be blocked -
  const briefRun = seeded.runId;
  record("approved VIDEO_BRIEF run payload cannot be rewritten", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload = output_payload || '{\"x\":1}'::jsonb where id=$1", [briefRun])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  record("approved VIDEO_BRIEF finalized step output cannot be rewritten", (await expectFailure(db, null, "update channelwright.workflow_steps set output_payload = output_payload || '{\"x\":1}'::jsonb where workflow_run_id=$1 and step_key='finalize-video-brief'", [briefRun])).includes("APPROVED_ARTIFACT_IMMUTABLE"));

  const scriptSeed = await seedApprovedRun(db, ownerA, "CHANNEL_VIDEO_SCRIPT", { schemaVersion: 1 }, "validate-approved-brief", { reference: {} }, { finalizerStep: "finalize-video-script", finalQaStep: "final-video-script-qa" });
  record("approved VIDEO_SCRIPT run payload cannot be rewritten", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload = output_payload || '{\"x\":1}'::jsonb where id=$1", [scriptSeed.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  record("approved VIDEO_SCRIPT finalized step output cannot be rewritten", (await expectFailure(db, null, "update channelwright.workflow_steps set output_payload = output_payload || '{\"x\":1}'::jsonb where workflow_run_id=$1 and step_key='finalize-video-script'", [scriptSeed.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));

  // Backward compatibility: earlier verticals must still be immutable.
  const research = await seedApprovedRun(db, ownerA, "CHANNEL_RESEARCH", { schemaVersion: 1 }, "", null);
  record("approved CHANNEL_RESEARCH run payload still immutable (no regression)", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload = output_payload || '{\"x\":1}'::jsonb where id=$1", [research.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));

  // --- concurrency (DB-level unique index) -------------------------------
  const briefRunId = seeded.runId;
  const scriptWorkflow = scriptSeed.workflowId;
  const insertScript = () => db.query(`insert into channelwright.workflow_runs(id,owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload)
    values ($1,$2,$3,'CHANNEL_VIDEO_SCRIPT',1,'QUEUED',$4,$5,$6::jsonb)`,
    [randomUUID(), ownerA, scriptWorkflow, `disp-conc:${randomUUID()}`, "1".repeat(64), JSON.stringify({ approvedVideoBriefReference: { briefRunId } })]);
  await insertScript();
  let blocked = false;
  try { await insertScript(); } catch { blocked = true; }
  record("second active VIDEO_SCRIPT for same owner+brief blocked by unique index", blocked);

  // --- accounting / zero retrieval --------------------------------------
  const limits = (searches: number) => JSON.stringify({ providerRequests: searches ? 4 : 0, providerQuotaUnits: searches ? 100 : 0, searches, synthesisCalls: 4, qaCalls: 6, revisionCalls: 2, inputTokens: 500000, outputTokens: 72000, totalTokens: 572000, automatedRevisions: 1 });
  const nonZero = await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [scriptSeed.runId, randomUUID(), randomUUID(), "g", limits(4)]);
  record("nonzero-retrieval VIDEO_SCRIPT budget rejected by VALIDATION_ERROR", nonZero.includes("VALIDATION_ERROR") && !nonZero.includes("LEASE_NOT_ACTIVE"), nonZero.split("\n")[0].slice(0, 160));
  const zero = await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [scriptSeed.runId, randomUUID(), randomUUID(), "g", limits(0)]);
  record("zero-retrieval VIDEO_SCRIPT budget passes ceilings (fails only on lease)", zero.includes("LEASE_NOT_ACTIVE") && !zero.includes("VALIDATION_ERROR"), zero.split("\n")[0].slice(0, 160));
}

async function main() {
  const admin = new pg.Client({ connectionString: CONNECTION, application_name: "cw-disposable-pg-probe" });
  try { await admin.connect(); }
  catch (error) {
    console.log(JSON.stringify({ gate: "VIDEO_SCRIPT_DISPOSABLE_PG_UNAVAILABLE", reason: error instanceof Error ? error.message.split("\n")[0] : String(error), hint: "Set CHANNELWRIGHT_DISPOSABLE_DATABASE_URL to a disposable PostgreSQL server." }, null, 2));
    process.exitCode = 2;
    return;
  }
  const dbName = `cw_disposable_${randomUUID().replace(/-/g, "")}`;
  let created = false;
  try {
    await admin.query(`create database ${dbName}`);
    created = true;
    const url = new URL(CONNECTION);
    url.pathname = `/${dbName}`;
    const db = new pg.Client({ connectionString: url.toString(), application_name: "cw-disposable-pg-gate" });
    await db.connect();
    try {
      await db.query(SUPABASE_SHIM);
      record("supabase shim installed", true);
      for (const migration of loadMigrations()) {
        try { await db.query(migration.sql); }
        catch (error) {
          record(`migration applies: ${migration.name}`, false, error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : String(error));
          throw error;
        }
      }
      record("full migration chain applied from scratch", true, `${loadMigrations().length} migrations`);
      await runChecks(db);
    } finally { await db.end(); }
  } catch (error) {
    record("gate completed without a fatal error", false, error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : String(error));
  } finally {
    if (created) {
      try { await admin.query(`drop database if exists ${dbName} with (force)`); record("disposable database dropped", true, dbName); }
      catch (error) { record("disposable database dropped", false, error instanceof Error ? error.message.split("\n")[0] : String(error)); }
    }
    await admin.end();
  }

  const failed = checks.filter((c) => !c.passed);
  console.log(JSON.stringify({
    gate: failed.length === 0 ? "VIDEO_SCRIPT_DISPOSABLE_PG_PASSED" : "VIDEO_SCRIPT_DISPOSABLE_PG_FAILED",
    database: CONNECTION.replace(/\/\/[^@]*@/, "//***@"),
    counts: { passed: checks.length - failed.length, failed: failed.length },
    checks,
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

await main();
