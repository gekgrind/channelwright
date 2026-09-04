/**
 * Disposable PostgreSQL runtime gate for the CHANNEL_VIDEO_DIAGNOSIS migration
 * chain.
 *
 * Unlike the persisted gate (which targets shared Supabase), this creates a
 * throwaway database on a disposable PostgreSQL server, installs a minimal
 * Supabase-compatible shim (roles, auth/extensions/storage schemas, pgcrypto,
 * auth.uid/jwt), applies the ENTIRE migration chain from scratch, runtime-proves
 * behaviour that source-text tests cannot (migration execution, pgcrypto
 * resolution, the approved-release resolver trust boundary, RLS, immutability
 * including the new VIDEO_PERFORMANCE coverage, concurrency, canonical parity,
 * scope derivation, zero-retrieval accounting), then drops the database and
 * verifies cleanup.
 *
 * It never touches shared/production Supabase and requires no paid providers.
 *
 * Connection: ONLY the dedicated CHANNELWRIGHT_DISPOSABLE_DATABASE_URL is used.
 * There is deliberately no fallback to the application's DATABASE_URL and no
 * localhost default — this gate creates/drops databases and manages cluster-global
 * roles, so it must run only against a server the operator explicitly earmarked as
 * disposable. When that variable is unset (or the server is unreachable) it reports
 * UNAVAILABLE (exit 2) rather than silently passing or touching anything else.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { canonicalJson } from "../src/server/workflows/canonical-json";

try { process.loadEnvFile(".env.local"); } catch { /* optional */ }

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, passed: boolean, detail = "") => { checks.push({ name, passed, detail }); };
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

// ONLY a dedicated, explicit opt-in variable is honoured. There is deliberately
// no fallback to the application's DATABASE_URL and no localhost default: this
// gate creates and drops databases and manages cluster-global roles, so it must
// never run against a server the operator did not explicitly earmark as
// disposable. Point it at a throwaway PostgreSQL cluster.
const CONNECTION = process.env.CHANNELWRIGHT_DISPOSABLE_DATABASE_URL;

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

async function asAuthenticated<T>(db: pg.Client, ownerId: string, run: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ownerId, role: "authenticated" })]);
    const result = await run();
    await db.query("commit");
    return result;
  } catch (error) { await db.query("rollback"); throw error; }
}

/** Seeds a COMPLETED, human-approved paid run with an APPROVED approval. */
async function seedApprovedRun(db: pg.Client, ownerId: string, type: string, output: unknown, provStep: string, provOutput: unknown, opts: { approve?: boolean; corruptHash?: boolean; corruptProvenance?: boolean; qaPassed?: boolean; finalizerStep?: string; finalQaStep?: string; finalizerOutput?: unknown; input?: unknown; context?: unknown; current?: boolean } = {}) {
  const { approve = true, corruptHash = false, corruptProvenance = false, qaPassed = true, finalizerStep = "", finalQaStep = "", finalizerOutput = output, input = {}, context = {}, current = true } = opts;
  const workflowId = randomUUID();
  const runId = randomUUID();
  await db.query("insert into auth.users(id,email) values ($1,$2) on conflict do nothing", [ownerId, `${ownerId}@disposable.test`]);
  await db.query(`insert into channelwright.workflows(id,owner_id,workflow_type,definition_version,objective,status) values ($1,$2,$3,1,'disposable gate','COMPLETED')`, [workflowId, ownerId, type]);
  await db.query(`insert into channelwright.workflow_runs(id,owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload,context_payload,output_payload,completed_at)
    values ($1,$2,$3,$4,1,'COMPLETED',$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,now())`,
    [runId, ownerId, workflowId, type, `disp:${runId}`, "0".repeat(64), JSON.stringify(input), JSON.stringify(context), JSON.stringify(output)]);
  if (current) await db.query("update channelwright.workflows set current_run_id=$2 where id=$1", [workflowId, runId]);
  const steps: Array<[string, unknown]> = [];
  if (provStep) steps.push([provStep, provOutput]);
  if (finalQaStep) steps.push([finalQaStep, { qa: { passed: qaPassed, score: qaPassed ? 88 : 20, findings: [], recommendation: qaPassed ? "accept" : "revise", deterministicChecksPassed: qaPassed ? 30 : 2, deterministicChecksFailed: qaPassed ? 0 : 3, modelUsage: { model: "deterministic", inputTokens: 0, outputTokens: 0, totalTokens: 0 } } }]);
  if (finalizerStep) steps.push([finalizerStep, finalizerOutput]);
  let position = 0;
  for (const [key, out] of steps) {
    await db.query(`insert into channelwright.workflow_steps(id,owner_id,workflow_id,workflow_run_id,step_key,position,kind,capability,depends_on,status,max_attempts,retry_base_seconds,output_payload,completed_at)
      values ($1,$2,$3,$4,$5,$6,'WORKER','gate','{}','COMPLETED',1,0,$7::jsonb,now())`,
      [randomUUID(), ownerId, workflowId, runId, key, position++, JSON.stringify(out)]);
  }
  await db.query(corruptHash
    ? "update channelwright.workflow_runs set artifact_hash=$2 where id=$1"
    : "update channelwright.workflow_runs set artifact_hash=encode(extensions.digest(output_payload::text,'sha256'),'hex') where id=$1",
  corruptHash ? [runId, "f".repeat(64)] : [runId]);
  if (provStep) {
    await db.query(corruptProvenance
      ? "update channelwright.workflow_runs set provenance_hash=$2 where id=$1"
      : "update channelwright.workflow_runs set provenance_hash=encode(extensions.digest((select output_payload from channelwright.workflow_steps where workflow_run_id=$1 and step_key=$2)::text,'sha256'),'hex') where id=$1",
    corruptProvenance ? [runId, "e".repeat(64)] : [runId, provStep]);
  }
  const approvalStepId = randomUUID();
  await db.query(`insert into channelwright.workflow_steps(id,owner_id,workflow_id,workflow_run_id,step_key,position,kind,capability,depends_on,status,max_attempts,retry_base_seconds,completed_at)
    values ($1,$2,$3,$4,'review',99,'APPROVAL','human','{}','COMPLETED',1,0,now())`, [approvalStepId, ownerId, workflowId, runId]);
  await db.query(approve
    ? `insert into channelwright.workflow_approvals(id,owner_id,workflow_id,workflow_run_id,workflow_step_id,gate_key,status,request_payload,decided_by,decided_at) values ($1,$2,$3,$4,$5,'review','APPROVED','{}'::jsonb,$2,now())`
    : `insert into channelwright.workflow_approvals(id,owner_id,workflow_id,workflow_run_id,workflow_step_id,gate_key,status,request_payload) values ($1,$2,$3,$4,$5,'review','PENDING','{}'::jsonb)`,
    [randomUUID(), ownerId, workflowId, runId, approvalStepId]);
  const hashes = await db.query<{ artifact_hash: string | null; provenance_hash: string | null }>("select artifact_hash,provenance_hash from channelwright.workflow_runs where id=$1", [runId]);
  return { workflowId, runId, artifactHash: hashes.rows[0].artifact_hash!, provenanceHash: hashes.rows[0].provenance_hash! };
}

type Seeded = Awaited<ReturnType<typeof seedApprovedRun>>;

function upstreamRef(kind: string, seeded: Seeded, upstream?: unknown) {
  const lower = kind === "CONTENT" ? "content" : kind.toLowerCase();
  const ref: Record<string, unknown> = {
    [`${lower}WorkflowId`]: seeded.workflowId,
    [`${lower}RunId`]: seeded.runId,
    workflowDefinitionVersion: 1,
    outputSchemaVersion: 1,
    [`${lower}ArtifactHash`]: seeded.artifactHash,
  };
  if (upstream) ref[`upstream${kind === "STRATEGY" ? "Research" : kind === "CONTENT" ? "Strategy" : kind === "BRIEF" ? "ContentIntelligence" : kind === "SCRIPT" ? "VideoBrief" : kind === "PACKAGING" ? "VideoScript" : "VideoPackaging"}`] = upstream;
  return ref;
}

async function seedLineage(db: pg.Client, ownerId: string) {
  const researchOutput = { schemaVersion: 1, workflowType: "CHANNEL_RESEARCH" };
  const research = await seedApprovedRun(db, ownerId, "CHANNEL_RESEARCH", researchOutput, "", null);
  const researchRef = upstreamRef("RESEARCH", research);

  const strategyOutput = { schemaVersion: 1, workflowType: "CHANNEL_STRATEGY", contentPillars: [{ name: "Evidence systems" }], kpiFramework: [{ label: "Qualified CTR", metric: "CLICK_THROUGH_RATE" }], upstreamResearch: researchRef };
  const strategy = await seedApprovedRun(db, ownerId, "CHANNEL_STRATEGY", strategyOutput, "", null);
  const strategyRef = upstreamRef("STRATEGY", strategy, researchRef);

  const contentOutput = { schemaVersion: 1, workflowType: "CHANNEL_CONTENT_INTELLIGENCE", topics: [{ topicId: "topic:diagnosis", pillarId: "pillar:evidence" }], upstreamStrategy: strategyRef };
  const content = await seedApprovedRun(db, ownerId, "CHANNEL_CONTENT_INTELLIGENCE", contentOutput, "", null);
  const contentRef = upstreamRef("CONTENT", content, strategyRef);

  const briefOutput = { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_BRIEF", contentArchitecture: { beats: [{ sectionId: "beat:opening", title: "Opening" }] }, evidencePlan: { items: [{ claimId: "claim:one", claim: "A supported claim", evidenceIds: ["evidence:one"] }] }, upstreamContentIntelligence: contentRef };
  const brief = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_BRIEF", briefOutput, "", null);
  const briefRef = upstreamRef("BRIEF", brief, contentRef);

  const scriptOutput = { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_SCRIPT", openingHook: { spokenOpening: "This explains what the evidence does and does not establish." }, sections: [{ sectionId: "section:opening", briefBeatId: "beat:opening", title: "Opening" }], upstreamVideoBrief: briefRef };
  const script = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_SCRIPT", scriptOutput, "", null);
  const scriptRef = upstreamRef("SCRIPT", script, briefRef);

  const packagingOutput = { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_PACKAGING", titleCandidates: [{ candidateId: "title:one", text: "What the evidence actually says" }], thumbnailConcepts: [{ conceptId: "thumb:one", copyText: "EVIDENCE" }], chapters: [{ chapterId: "chapter:opening", sourceScriptSectionId: "section:opening", title: "Opening" }], upstreamVideoScript: scriptRef };
  const packaging = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_PACKAGING", packagingOutput, "", null);
  const packagingRef = upstreamRef("PACKAGING", packaging, scriptRef);

  const releaseOutput = { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_RELEASE", thumbnailDecision: { selectedConceptId: "thumb:one" }, titleDecision: { selectedCandidateId: "title:one" }, upstreamVideoPackaging: packagingRef };
  const release = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_RELEASE", releaseOutput, "", null);
  const releaseRef = {
    releaseWorkflowId: release.workflowId,
    releaseRunId: release.runId,
    workflowDefinitionVersion: 1,
    outputSchemaVersion: 1,
    releaseArtifactHash: release.artifactHash,
    upstreamVideoPackaging: packagingRef,
  };
  return { release, releaseRef, releaseOutput };
}

async function seedPerformance(db: pg.Client, ownerId: string, lineage: Awaited<ReturnType<typeof seedLineage>>, options: Parameters<typeof seedApprovedRun>[6] & { releaseReference?: unknown; releaseResult?: unknown; measuredSnapshot?: unknown; inputSnapshot?: unknown } = {}) {
  const snapshot = options.measuredSnapshot ?? {
    observationWindow: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-31T00:00:00.000Z" },
    capturedAt: "2026-09-01T00:00:00.000Z",
    videoDurationSeconds: 600,
    metrics: { impressions: 1000, views: 120, uniqueViewers: 110, clickThroughRatePct: 7.2, averageViewDurationSeconds: 300, averagePercentageViewedPct: 50, watchTimeHours: 10, subscribersGained: 8, subscribersLost: 1, likes: 22, comments: 4, shares: 3, returningViewersPct: 18, estimatedRevenueUsdIndicator: null },
    operatorBaselines: [{ label: "Channel median CTR", metric: "CLICK_THROUGH_RATE", value: 5.5, unit: "PERCENT" }],
  };
  const releaseReference = options.releaseReference ?? lineage.releaseRef;
  const output = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_PERFORMANCE",
    source: { releaseTopicId: "topic:diagnosis", pillarId: "pillar:evidence", pillarName: "Evidence systems", workingConcept: "Diagnose without inventing causes", releasePromise: "Explain what the evidence establishes", finalTitle: "What the evidence actually says" },
    measuredSnapshot: snapshot,
    snapshotIntegrity: { coverage: "PARTIAL" },
    performanceScope: { inheritedViewerValueProvenance: { originStage: "RELEASE", gate: "PASS", contractHash: "a".repeat(64) } },
    viewerValue: { gate: "PASS" },
    kpiHypothesisOutcomes: [],
    upstreamVideoRelease: releaseReference,
  };
  const provenance = { reference: lineage.releaseRef, releaseResult: options.releaseResult ?? lineage.releaseOutput, discoveryBundle: { evidence: [{ id: "evidence:one", title: "Primary evidence" }] } };
  return seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_PERFORMANCE", output, "validate-approved-release", provenance, {
    ...options,
    finalizerStep: options.finalizerStep ?? "finalize-video-performance",
    finalQaStep: options.finalQaStep ?? "final-video-performance-qa",
    input: { performanceSnapshot: options.inputSnapshot ?? snapshot },
  });
}

const diagnosisObjective = "Explain one exact approved CHANNEL_VIDEO_PERFORMANCE artifact using deterministic observations, bounded inference, independent critique, and human approval without recommending actions";
const diagnosisSteps = [
  { key: "validate-approved-performance", position: 0, kind: "WORKER", capability: "approved-performance-validation", dependsOn: [], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "derive-diagnosis-observations", position: 1, kind: "WORKER", capability: "deterministic-diagnosis-observation", dependsOn: ["validate-approved-performance"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "draft-video-diagnosis", position: 2, kind: "WORKER", capability: "video-diagnosis-analysis", dependsOn: ["derive-diagnosis-observations"], maxAttempts: 2, retryBaseSeconds: 10 },
  { key: "critique-video-diagnosis", position: 3, kind: "WORKER", capability: "independent-video-diagnosis-critique", dependsOn: ["draft-video-diagnosis"], maxAttempts: 2, retryBaseSeconds: 10 },
  { key: "final-video-diagnosis-qa", position: 4, kind: "WORKER", capability: "deterministic-video-diagnosis-qa", dependsOn: ["critique-video-diagnosis"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "finalize-video-diagnosis", position: 5, kind: "WORKER", capability: "video-diagnosis-finalizer", dependsOn: ["final-video-diagnosis-qa"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "review-video-diagnosis", position: 6, kind: "APPROVAL", capability: "human", dependsOn: ["finalize-video-diagnosis"], maxAttempts: 1, retryBaseSeconds: 0 },
];

async function startDiagnosis(db: pg.Client, ownerId: string, performance: Seeded, idempotencyKey: string, extra: Record<string, unknown> = {}) {
  return asAuthenticated(db, ownerId, () => db.query<{ result: Record<string, unknown> }>(
    "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_DIAGNOSIS',1,$3,$4::jsonb,$5::jsonb) as result",
    [idempotencyKey, sha256(idempotencyKey), diagnosisObjective, JSON.stringify({ videoPerformanceWorkflowId: performance.workflowId, videoPerformanceRunId: performance.runId, ...extra }), JSON.stringify(diagnosisSteps)],
  ));
}

async function runChecks(db: pg.Client) {
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const digest = await db.query<{ h: string }>("select encode(extensions.digest('x','sha256'),'hex') as h");
  record("pgcrypto extensions.digest resolves at runtime", digest.rows[0].h === sha256("x"));

  const fns = await db.query<{ count: string }>("select count(*)::text as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='channelwright' and p.proname in ('resolve_approved_research_artifact','resolve_approved_strategy_artifact','resolve_approved_content_artifact','resolve_approved_video_brief_artifact','resolve_approved_video_script_artifact','resolve_approved_video_packaging_artifact','resolve_approved_video_release_artifact','resolve_approved_video_performance_artifact')");
  record("all eight approved-artifact resolvers compiled", fns.rows[0].count === "8", `count=${fns.rows[0].count}`);

  const canonicalProbe = { z: [3, { b: true, a: "x" }], a: 1 };
  const canon = await db.query<{ c: string }>("select channelwright.canonical_jsonb_text($1::jsonb) as c", [JSON.stringify(canonicalProbe)]);
  record("canonical_jsonb_text parity with application", canon.rows[0].c === canonicalJson(canonicalProbe));

  const lineage = await seedLineage(db, ownerA);
  const performance = await seedPerformance(db, ownerA, lineage);
  const resolved = await asAuthenticated(db, ownerA, () => db.query<{
    result: {
      reference: Record<string, unknown>;
      diagnosisScope: { artifacts: unknown[]; entries: Array<{ key: string; locator: { kind: string } }>; facts: unknown[] };
    };
  }>("select channelwright.resolve_approved_video_performance_artifact($1,$2) as result", [performance.workflowId, performance.runId]));
  const approved = resolved.rows[0].result;
  record("approved Performance resolver executes for the owner", approved.reference.performanceRunId === performance.runId);
  record("compact scope contains exactly eight authoritative artifacts", approved.diagnosisScope.artifacts.length === 8);
  record("compact scope preserves stable lineage identifiers", ["lin:title:title:one", "lin:thumbnail:thumb:one", "lin:chapter:chapter:opening", "lin:script-section:section:opening", "lin:brief-beat:beat:opening", "lin:brief-claim:claim:one", "lin:evidence:evidence:one", "lin:topic:topic:diagnosis", "lin:pillar:pillar:evidence"].every((key) => approved.diagnosisScope.entries.some((entry) => entry.key === key)));
  record("compact scope uses artifact-local Strategy locators", approved.diagnosisScope.entries.filter((entry) => entry.locator.kind === "ARTIFACT_LOCAL").length === 2);
  record("compact scope projects immutable opening, promise, packaging, and coverage facts", approved.diagnosisScope.facts.length === 6);

  record("cross-owner approved Performance resolution is NOT_FOUND", (await expectFailure(db, ownerB, "select channelwright.resolve_approved_video_performance_artifact($1,$2)", [performance.workflowId, performance.runId])).includes("NOT_FOUND"));
  const unapproved = await seedPerformance(db, ownerA, lineage, { approve: false });
  record("unapproved Performance is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_performance_artifact($1,$2)", [unapproved.workflowId, unapproved.runId])).includes("UPSTREAM_PERFORMANCE_NOT_APPROVED"));
  const rejectedQa = await seedPerformance(db, ownerA, lineage, { qaPassed: false });
  record("rejected Performance final QA is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_performance_artifact($1,$2)", [rejectedQa.workflowId, rejectedQa.runId])).includes("UPSTREAM_PERFORMANCE_QA_INVALID"));
  const wrongFinalizer = await seedPerformance(db, ownerA, lineage, { finalizerOutput: { schemaVersion: 1, wrong: true } });
  record("Performance finalizer disagreement is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_performance_artifact($1,$2)", [wrongFinalizer.workflowId, wrongFinalizer.runId])).includes("UPSTREAM_PERFORMANCE_INTEGRITY_MISMATCH"));
  const corruptArtifact = await seedPerformance(db, ownerA, lineage, { corruptHash: true });
  record("altered Performance artifact hash is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_performance_artifact($1,$2)", [corruptArtifact.workflowId, corruptArtifact.runId])).includes("UPSTREAM_PERFORMANCE_INTEGRITY_MISMATCH"));
  const corruptProvenance = await seedPerformance(db, ownerA, lineage, { corruptProvenance: true });
  record("altered Performance provenance hash is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_performance_artifact($1,$2)", [corruptProvenance.workflowId, corruptProvenance.runId])).includes("UPSTREAM_PERFORMANCE_INTEGRITY_MISMATCH"));
  const driftedSnapshot = await seedPerformance(db, ownerA, lineage, { inputSnapshot: { different: true } });
  record("immutable Performance snapshot contradiction is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_performance_artifact($1,$2)", [driftedSnapshot.workflowId, driftedSnapshot.runId])).includes("UPSTREAM_PERFORMANCE_SNAPSHOT_MISMATCH"));
  const driftedRelease = await seedPerformance(db, ownerA, lineage, { releaseReference: { ...lineage.releaseRef, releaseRunId: randomUUID() } });
  record("nested Release reference drift is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_performance_artifact($1,$2)", [driftedRelease.workflowId, driftedRelease.runId])).includes("nested Release reference drift"));
  const superseded = await seedPerformance(db, ownerA, lineage, { current: false });
  record("superseded Performance is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_performance_artifact($1,$2)", [superseded.workflowId, superseded.runId])).includes("UPSTREAM_PERFORMANCE_SUPERSEDED"));
  const badParent = await seedPerformance(db, ownerA, lineage, { context: { previousRunId: randomUUID() } });
  record("Performance parent/root lineage drift is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_performance_artifact($1,$2)", [badParent.workflowId, badParent.runId])).includes("UPSTREAM_PERFORMANCE_LINEAGE_INVALID"));

  const rls = await db.query<{ enabled: boolean }>("select bool_and(c.relrowsecurity) as enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='channelwright' and c.relkind='r' and c.relname in ('workflows','workflow_runs','workflow_steps','workflow_approvals','research_run_budgets','research_usage_operations')");
  record("RLS enabled on every workflow table", rls.rows[0].enabled === true);
  const isolated = await asAuthenticated(db, ownerB, () => db.query<{ count: string }>("select count(*)::text as count from channelwright.workflow_runs where id=$1", [performance.runId]));
  record("RLS hides another owner's Performance run", isolated.rows[0].count === "0");

  const startKey = `diagnosis:${randomUUID()}`;
  const started = await startDiagnosis(db, ownerA, performance, startKey);
  const startedIds = started.rows[0].result as { workflowId: string; runId: string; idempotentReplay: boolean };
  const persisted = await db.query<{ input_payload: Record<string, unknown> }>("select input_payload from channelwright.workflow_runs where id=$1", [startedIds.runId]);
  record("Diagnosis start persists server-resolved Performance authority", Boolean(persisted.rows[0].input_payload.approvedVideoPerformanceReference));
  record("Diagnosis start accepts no caller artifact body", !("performanceResult" in persisted.rows[0].input_payload));
  const replay = await startDiagnosis(db, ownerA, performance, startKey);
  record("Diagnosis start is idempotent", replay.rows[0].result.runId === startedIds.runId && replay.rows[0].result.idempotentReplay === true);
  let strictError = "";
  try { await startDiagnosis(db, ownerA, performance, `strict:${randomUUID()}`, { performanceResult: { forged: true } }); } catch (error) { strictError = error instanceof Error ? error.message : String(error); }
  record("Diagnosis start rejects caller-supplied artifact content", strictError.includes("VALIDATION_ERROR"));
  let activeError = "";
  try { await startDiagnosis(db, ownerA, performance, `active:${randomUUID()}`); } catch (error) { activeError = error instanceof Error ? error.message : String(error); }
  record("active Diagnosis uniqueness is enforced by start", activeError.includes("VIDEO_DIAGNOSIS_LIMIT_REACHED"));
  let uniqueBlocked = false;
  try {
    await db.query(`insert into channelwright.workflow_runs(id,owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload) values ($1,$2,$3,'CHANNEL_VIDEO_DIAGNOSIS',1,'QUEUED',$4,$5,$6::jsonb)`, [randomUUID(), ownerA, startedIds.workflowId, `race:${randomUUID()}`, "1".repeat(64), JSON.stringify({ approvedVideoPerformanceReference: { performanceRunId: performance.runId } })]);
  } catch { uniqueBlocked = true; }
  record("concurrent Diagnosis insertion is blocked by database uniqueness", uniqueBlocked);

  const limits = (overrides: Record<string, number> = {}) => JSON.stringify({ providerRequests: 0, providerQuotaUnits: 0, searches: 0, synthesisCalls: 2, qaCalls: 2, revisionCalls: 0, inputTokens: 100000, outputTokens: 20000, totalTokens: 120000, automatedRevisions: 0, ...overrides });
  const withinCeiling = await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [startedIds.runId, randomUUID(), randomUUID(), "diagnosis", limits()]);
  record("Diagnosis accounting ceilings allow exactly four structural model attempts and no revision", withinCeiling.includes("LEASE_NOT_ACTIVE") && !withinCeiling.includes("VALIDATION_ERROR"), withinCeiling.split("\n")[0].slice(0, 160));
  const overCalls = await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [startedIds.runId, randomUUID(), randomUUID(), "diagnosis", limits({ synthesisCalls: 3 })]);
  record("Diagnosis accounting rejects a fifth structural model attempt", overCalls.includes("VALIDATION_ERROR"));
  const revision = await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [startedIds.runId, randomUUID(), randomUUID(), "diagnosis", limits({ revisionCalls: 1 })]);
  record("Diagnosis accounting rejects automated revision budget", revision.includes("VALIDATION_ERROR"));

  const diagnosisOutput = { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_DIAGNOSIS", source: { performanceRunId: performance.runId } };
  const approvedDiagnosis = await seedApprovedRun(db, ownerA, "CHANNEL_VIDEO_DIAGNOSIS", diagnosisOutput, "validate-approved-performance", { reference: approved.reference }, { finalizerStep: "finalize-video-diagnosis", finalQaStep: "final-video-diagnosis-qa" });
  record("human-approved Diagnosis output is durable", (await db.query<{ count: string }>("select count(*)::text as count from channelwright.workflow_approvals where workflow_run_id=$1 and status='APPROVED' and decided_by=$2", [approvedDiagnosis.runId, ownerA])).rows[0].count === "1");
  record("approved Diagnosis output is immutable", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload=output_payload||'{\"x\":1}'::jsonb where id=$1", [approvedDiagnosis.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  record("approved Diagnosis finalizer output is immutable", (await expectFailure(db, null, "update channelwright.workflow_steps set output_payload=output_payload||'{\"x\":1}'::jsonb where workflow_run_id=$1 and step_key='finalize-video-diagnosis'", [approvedDiagnosis.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  const successorDef = await db.query<{ source: string }>("select pg_get_functiondef(p.oid) as source from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='channelwright' and p.proname='decide_workflow_approval'");
  record("human revision wiring creates immutable Diagnosis successor lineage", successorDef.rows[0].source.includes("CHANNEL_VIDEO_DIAGNOSIS") && successorDef.rows[0].source.includes("previousRunId"));
}

const APP_ROLES = ["authenticated", "service_role", "anon"] as const;

async function main() {
  if (!CONNECTION) {
    console.log(JSON.stringify({ gate: "VIDEO_DIAGNOSIS_DISPOSABLE_PG_UNAVAILABLE", reason: "CHANNELWRIGHT_DISPOSABLE_DATABASE_URL is not set", hint: "Set CHANNELWRIGHT_DISPOSABLE_DATABASE_URL to a throwaway PostgreSQL cluster (never the application database)." }, null, 2));
    process.exitCode = 2;
    return;
  }
  const connection = CONNECTION;
  const admin = new pg.Client({ connectionString: connection, application_name: "cw-disposable-pg-probe" });
  try { await admin.connect(); }
  catch (error) {
    console.log(JSON.stringify({ gate: "VIDEO_DIAGNOSIS_DISPOSABLE_PG_UNAVAILABLE", reason: error instanceof Error ? error.message.split("\n")[0] : String(error), hint: "Set CHANNELWRIGHT_DISPOSABLE_DATABASE_URL to a reachable throwaway PostgreSQL cluster." }, null, 2));
    process.exitCode = 2;
    return;
  }
  const dbName = `cw_disposable_${randomUUID().replace(/-/g, "")}`;
  let created = false;
  // Roles are cluster-global, so dropping the database does not remove them. We
  // create only the roles that did not already exist and drop exactly those in
  // cleanup, leaving any operator-provided roles untouched and leaking none.
  let createdRoles: string[] = [];
  try {
    const existing = (await admin.query<{ rolname: string }>("select rolname from pg_roles where rolname = any($1)", [[...APP_ROLES]])).rows.map((r) => r.rolname);
    createdRoles = APP_ROLES.filter((role) => !existing.includes(role));
    await admin.query(`create database ${dbName}`);
    created = true;
    const url = new URL(connection);
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
    // Non-force drop: if a foreign connection is attached, the drop fails loudly
    // rather than force-killing a database that might not be exclusively ours.
    if (created) {
      try { await admin.query(`drop database if exists ${dbName}`); record("disposable database dropped", true, dbName); }
      catch (error) { record("disposable database dropped", false, error instanceof Error ? error.message.split("\n")[0] : String(error)); }
    }
    for (const role of createdRoles) {
      try { await admin.query(`drop role if exists ${role}`); }
      catch (error) { record(`gate-created role ${role} dropped`, false, error instanceof Error ? error.message.split("\n")[0] : String(error)); }
    }
    if (createdRoles.length) record("gate-created cluster roles removed", checks.every((c) => !/^gate-created role/.test(c.name) || c.passed), createdRoles.join(", "));
    await admin.end();
  }

  const failed = checks.filter((c) => !c.passed);
  console.log(JSON.stringify({
    gate: failed.length === 0 ? "VIDEO_DIAGNOSIS_DISPOSABLE_PG_PASSED" : "VIDEO_DIAGNOSIS_DISPOSABLE_PG_FAILED",
    database: connection.replace(/\/\/[^@]*@/, "//***@"),
    counts: { passed: checks.length - failed.length, failed: failed.length },
    checks,
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

await main();
