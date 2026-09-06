/**
 * Disposable PostgreSQL runtime gate for the CHANNEL_VIDEO_EXPERIMENT migration
 * chain.
 *
 * Unlike the persisted gate (which targets shared Supabase), this creates a
 * throwaway database on a disposable PostgreSQL server, installs a minimal
 * Supabase-compatible shim (roles, auth/extensions/storage schemas, pgcrypto,
 * auth.uid/jwt), applies the ENTIRE migration chain from scratch, runtime-proves
 * behaviour that source-text tests cannot (migration execution, pgcrypto
 * resolution, the approved-Decision resolver trust boundary and its
 * experiment-eligibility gate, the ten-artifact transitive re-hash and
 * supersession check, RLS, immutability including the new VIDEO_EXPERIMENT
 * coverage, concurrency, canonical parity, experiment-scope derivation, and
 * zero-retrieval/zero-revision accounting), then drops the database and verifies
 * cleanup.
 *
 * It never touches shared/production Supabase and requires no paid providers.
 *
 * Connection: ONLY the dedicated CHANNELWRIGHT_DISPOSABLE_DATABASE_URL is used.
 * There is deliberately no fallback to the application's DATABASE_URL and no
 * localhost default. When that variable is unset (or the server is unreachable)
 * it reports UNAVAILABLE (exit 2) rather than silently passing or touching
 * anything else.
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

  const contentOutput = { schemaVersion: 1, workflowType: "CHANNEL_CONTENT_INTELLIGENCE", topics: [{ topicId: "topic:decision", pillarId: "pillar:evidence" }], upstreamStrategy: strategyRef };
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
  return { research, strategy, content, brief, script, packaging, release, releaseRef, releaseOutput };
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
    source: { releaseTopicId: "topic:decision", pillarId: "pillar:evidence", pillarName: "Evidence systems", workingConcept: "Decide without inventing causes", releasePromise: "Explain what the evidence establishes", finalTitle: "What the evidence actually says" },
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

function eightArtifactScope(lineage: Awaited<ReturnType<typeof seedLineage>>, performance: Seeded) {
  return [
    { workflowType: "CHANNEL_RESEARCH", runId: lineage.research.runId, artifactHash: lineage.research.artifactHash, schemaVersion: 1 },
    { workflowType: "CHANNEL_STRATEGY", runId: lineage.strategy.runId, artifactHash: lineage.strategy.artifactHash, schemaVersion: 1 },
    { workflowType: "CHANNEL_CONTENT_INTELLIGENCE", runId: lineage.content.runId, artifactHash: lineage.content.artifactHash, schemaVersion: 1 },
    { workflowType: "CHANNEL_VIDEO_BRIEF", runId: lineage.brief.runId, artifactHash: lineage.brief.artifactHash, schemaVersion: 1 },
    { workflowType: "CHANNEL_VIDEO_SCRIPT", runId: lineage.script.runId, artifactHash: lineage.script.artifactHash, schemaVersion: 1 },
    { workflowType: "CHANNEL_VIDEO_PACKAGING", runId: lineage.packaging.runId, artifactHash: lineage.packaging.artifactHash, schemaVersion: 1 },
    { workflowType: "CHANNEL_VIDEO_RELEASE", runId: lineage.release.runId, artifactHash: lineage.release.artifactHash, schemaVersion: 1 },
    { workflowType: "CHANNEL_VIDEO_PERFORMANCE", runId: performance.runId, artifactHash: performance.artifactHash, schemaVersion: 1 },
  ];
}

async function seedDiagnosis(db: pg.Client, ownerId: string, lineage: Awaited<ReturnType<typeof seedLineage>>, performance: Seeded, performanceReference: Record<string, unknown>, options: Parameters<typeof seedApprovedRun>[6] & { upstreamReference?: unknown; decisionDeferred?: boolean } = {}) {
  const output = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_DIAGNOSIS",
    source: { performanceRunId: performance.runId },
    upstreamVideoPerformance: options.upstreamReference ?? performanceReference,
    diagnosisScope: {
      artifacts: eightArtifactScope(lineage, performance),
      entries: [],
      facts: [{ key: "fact:final-title", value: "What the evidence actually says", sourceRef: "performance:/source/finalTitle" }],
    },
    analysis: { findings: [], unknowns: [{ id: "unknown:retention-curve" }], viewerValueAnalysis: { state: "PRESERVED" }, summary: { outcome: "INCONCLUSIVE", overallConfidence: "low", decisionDeferred: options.decisionDeferred ?? true } },
  };
  const provenance = { reference: performanceReference };
  return seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_DIAGNOSIS", output, "validate-approved-performance", provenance, {
    ...options,
    finalizerStep: options.finalizerStep ?? "finalize-video-diagnosis",
    finalQaStep: options.finalQaStep ?? "final-video-diagnosis-qa",
  });
}

async function seedDecision(db: pg.Client, ownerId: string, lineage: Awaited<ReturnType<typeof seedLineage>>, performance: Seeded, diagnosis: Seeded, diagnosisReference: Record<string, unknown>, options: Parameters<typeof seedApprovedRun>[6] & { experimentEligible?: boolean; decisionType?: string; upstreamReference?: unknown } = {}) {
  // The compact nine-artifact Decision scope must reference the real seeded
  // upstream runs: the Experiment resolver re-hashes every one of the ten
  // transitive artifacts against a live COMPLETED run rather than trusting the
  // projection (202609060001_video_experiment.sql).
  const output = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_DECISION",
    source: { diagnosisRunId: diagnosis.runId },
    approvedVideoDiagnosisReference: options.upstreamReference ?? diagnosisReference,
    decisionScope: {
      artifacts: [
        ...eightArtifactScope(lineage, performance),
        { workflowType: "CHANNEL_VIDEO_DIAGNOSIS", runId: diagnosis.runId, artifactHash: diagnosis.artifactHash, schemaVersion: 1 },
      ],
      entries: [],
      facts: [{ key: "fact:diagnosis-outcome", value: "INCONCLUSIVE", sourceRef: "diagnosis:/analysis/summary/outcome" }],
    },
    content: {
      decision: { decisionType: options.decisionType ?? "INVESTIGATE", category: "OPENING_PROMISE" },
      experimentEligible: options.experimentEligible ?? true,
    },
  };
  const provenance = { reference: diagnosisReference };
  return seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_DECISION", output, "validate-approved-diagnosis", provenance, {
    ...options,
    finalizerStep: options.finalizerStep ?? "finalize-video-decision",
    finalQaStep: options.finalQaStep ?? "final-video-decision-qa",
  });
}

const experimentObjective = "Convert one exact approved, experiment-eligible CHANNEL_VIDEO_DECISION artifact into a single controlled, measurable, independently critiqued, human-approved experiment design without re-diagnosing, rewriting the decision, or executing anything";
const experimentSteps = [
  { key: "validate-approved-decision", position: 0, kind: "WORKER", capability: "approved-decision-validation", dependsOn: [], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "derive-experiment-constraints", position: 1, kind: "WORKER", capability: "deterministic-experiment-constraints", dependsOn: ["validate-approved-decision"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "draft-video-experiment", position: 2, kind: "WORKER", capability: "video-experiment-design", dependsOn: ["derive-experiment-constraints"], maxAttempts: 2, retryBaseSeconds: 10 },
  { key: "critique-video-experiment", position: 3, kind: "WORKER", capability: "independent-video-experiment-critique", dependsOn: ["draft-video-experiment"], maxAttempts: 2, retryBaseSeconds: 10 },
  { key: "final-video-experiment-qa", position: 4, kind: "WORKER", capability: "deterministic-video-experiment-qa", dependsOn: ["critique-video-experiment"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "finalize-video-experiment", position: 5, kind: "WORKER", capability: "video-experiment-finalizer", dependsOn: ["final-video-experiment-qa"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "review-video-experiment", position: 6, kind: "APPROVAL", capability: "human", dependsOn: ["finalize-video-experiment"], maxAttempts: 1, retryBaseSeconds: 0 },
];

async function startExperiment(db: pg.Client, ownerId: string, decision: Seeded, idempotencyKey: string, extra: Record<string, unknown> = {}) {
  return asAuthenticated(db, ownerId, () => db.query<{ result: Record<string, unknown> }>(
    "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_EXPERIMENT',1,$3,$4::jsonb,$5::jsonb) as result",
    [idempotencyKey, sha256(idempotencyKey), experimentObjective, JSON.stringify({ videoDecisionWorkflowId: decision.workflowId, videoDecisionRunId: decision.runId, ...extra }), JSON.stringify(experimentSteps)],
  ));
}

async function runChecks(db: pg.Client) {
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const digest = await db.query<{ h: string }>("select encode(extensions.digest('x','sha256'),'hex') as h");
  record("pgcrypto extensions.digest resolves at runtime", digest.rows[0].h === sha256("x"));

  const fns = await db.query<{ count: string }>("select count(*)::text as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='channelwright' and p.proname in ('resolve_approved_research_artifact','resolve_approved_strategy_artifact','resolve_approved_content_artifact','resolve_approved_video_brief_artifact','resolve_approved_video_script_artifact','resolve_approved_video_packaging_artifact','resolve_approved_video_release_artifact','resolve_approved_video_performance_artifact','resolve_approved_video_diagnosis_artifact','resolve_approved_video_decision_artifact')");
  record("all ten approved-artifact resolvers compiled", fns.rows[0].count === "10", `count=${fns.rows[0].count}`);

  const canonicalProbe = { z: [3, { b: true, a: "x" }], a: 1 };
  const canon = await db.query<{ c: string }>("select channelwright.canonical_jsonb_text($1::jsonb) as c", [JSON.stringify(canonicalProbe)]);
  record("canonical_jsonb_text parity with application", canon.rows[0].c === canonicalJson(canonicalProbe));

  const lineage = await seedLineage(db, ownerA);
  const performance = await seedPerformance(db, ownerA, lineage);
  const performanceRef = (await asAuthenticated(db, ownerA, () => db.query<{ result: { reference: Record<string, unknown> } }>("select channelwright.resolve_approved_video_performance_artifact($1,$2) as result", [performance.workflowId, performance.runId]))).rows[0].result.reference;
  const diagnosis = await seedDiagnosis(db, ownerA, lineage, performance, performanceRef);
  const diagnosisRef = (await asAuthenticated(db, ownerA, () => db.query<{ result: { reference: Record<string, unknown> } }>("select channelwright.resolve_approved_video_diagnosis_artifact($1,$2) as result", [diagnosis.workflowId, diagnosis.runId]))).rows[0].result.reference;

  const decision = await seedDecision(db, ownerA, lineage, performance, diagnosis, diagnosisRef);
  const resolved = await asAuthenticated(db, ownerA, () => db.query<{
    result: { reference: Record<string, unknown>; experimentScope: { artifacts: unknown[]; entries: unknown[]; facts: Array<{ key: string }> } };
  }>("select channelwright.resolve_approved_video_decision_artifact($1,$2) as result", [decision.workflowId, decision.runId]));
  const approved = resolved.rows[0].result;
  record("approved Decision resolver executes for the owner", approved.reference.decisionRunId === decision.runId);
  record("resolver returns experimentEligible: true and the projected decision type", approved.reference.experimentEligible === true && approved.reference.decisionType === "INVESTIGATE");
  record("compact experiment scope contains exactly ten authoritative artifacts", approved.experimentScope.artifacts.length === 10);
  record("compact experiment scope projects decision-type, category, and eligibility facts",
    ["fact:decision-type", "fact:decision-category", "fact:experiment-eligible"].every((key) => approved.experimentScope.facts.some((fact) => fact.key === key)));

  record("cross-owner approved Decision resolution is NOT_FOUND", (await expectFailure(db, ownerB, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [decision.workflowId, decision.runId])).includes("NOT_FOUND"));
  const ineligible = await seedDecision(db, ownerA, lineage, performance, diagnosis, diagnosisRef, { experimentEligible: false });
  record("an experiment-ineligible Decision is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [ineligible.workflowId, ineligible.runId])).includes("UPSTREAM_DECISION_NOT_EXPERIMENT_ELIGIBLE"));
  const unapproved = await seedDecision(db, ownerA, lineage, performance, diagnosis, diagnosisRef, { approve: false });
  record("unapproved Decision is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [unapproved.workflowId, unapproved.runId])).includes("UPSTREAM_DECISION_NOT_APPROVED"));
  const rejectedQa = await seedDecision(db, ownerA, lineage, performance, diagnosis, diagnosisRef, { qaPassed: false });
  record("rejected Decision final QA is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [rejectedQa.workflowId, rejectedQa.runId])).includes("UPSTREAM_DECISION_QA_INVALID"));
  const wrongFinalizer = await seedDecision(db, ownerA, lineage, performance, diagnosis, diagnosisRef, { finalizerOutput: { schemaVersion: 1, wrong: true } });
  record("Decision finalizer disagreement is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [wrongFinalizer.workflowId, wrongFinalizer.runId])).includes("UPSTREAM_DECISION_INTEGRITY_MISMATCH"));
  const corruptArtifact = await seedDecision(db, ownerA, lineage, performance, diagnosis, diagnosisRef, { corruptHash: true });
  record("altered Decision artifact hash is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [corruptArtifact.workflowId, corruptArtifact.runId])).includes("UPSTREAM_DECISION_INTEGRITY_MISMATCH"));
  const corruptProvenance = await seedDecision(db, ownerA, lineage, performance, diagnosis, diagnosisRef, { corruptProvenance: true });
  record("altered Decision provenance hash is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [corruptProvenance.workflowId, corruptProvenance.runId])).includes("UPSTREAM_DECISION_INTEGRITY_MISMATCH"));
  const driftedDiagnosis = await seedDecision(db, ownerA, lineage, performance, diagnosis, diagnosisRef, { upstreamReference: { ...diagnosisRef, diagnosisArtifactHash: "9".repeat(64) } });
  record("nested Diagnosis reference drift is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [driftedDiagnosis.workflowId, driftedDiagnosis.runId])).includes("UPSTREAM_DECISION_INTEGRITY_MISMATCH"));
  const superseded = await seedDecision(db, ownerA, lineage, performance, diagnosis, diagnosisRef, { current: false });
  record("superseded Decision is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [superseded.workflowId, superseded.runId])).includes("UPSTREAM_DECISION_SUPERSEDED"));
  const badParent = await seedDecision(db, ownerA, lineage, performance, diagnosis, diagnosisRef, { context: { previousRunId: randomUUID() } });
  record("Decision parent/root lineage drift is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [badParent.workflowId, badParent.runId])).includes("UPSTREAM_DECISION_LINEAGE_INVALID"));

  // A structurally superseded transitive upstream (Diagnosis here) must be rejected even
  // though the Decision's frozen projection still hash-matches it.
  const supLineage = await seedLineage(db, ownerA);
  const supPerf = await seedPerformance(db, ownerA, supLineage);
  const supPerfRef = (await asAuthenticated(db, ownerA, () => db.query<{ result: { reference: Record<string, unknown> } }>("select channelwright.resolve_approved_video_performance_artifact($1,$2) as result", [supPerf.workflowId, supPerf.runId]))).rows[0].result.reference;
  const supDiag = await seedDiagnosis(db, ownerA, supLineage, supPerf, supPerfRef);
  const supDiagRef = (await asAuthenticated(db, ownerA, () => db.query<{ result: { reference: Record<string, unknown> } }>("select channelwright.resolve_approved_video_diagnosis_artifact($1,$2) as result", [supDiag.workflowId, supDiag.runId]))).rows[0].result.reference;
  const supDecision = await seedDecision(db, ownerA, supLineage, supPerf, supDiag, supDiagRef);
  record("transitive-supersession fixture resolves clean before tampering", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [supDecision.workflowId, supDecision.runId])) === "");
  const supDiagSuccessor = randomUUID();
  await db.query(`insert into channelwright.workflow_runs(id,owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload,context_payload,output_payload,completed_at)
    values ($1,$2,$3,'CHANNEL_VIDEO_DIAGNOSIS',1,'COMPLETED',$4,$5,'{}'::jsonb,$6::jsonb,$7::jsonb,now())`,
    [supDiagSuccessor, ownerA, supDiag.workflowId, `sup:${supDiagSuccessor}`, "0".repeat(64), JSON.stringify({ previousRunId: supDiag.runId }), JSON.stringify({ schemaVersion: 1, workflowType: "CHANNEL_VIDEO_DIAGNOSIS", superseded: true })]);
  await db.query("update channelwright.workflows set current_run_id=$2 where id=$1", [supDiag.workflowId, supDiagSuccessor]);
  const supMsg = await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_decision_artifact($1,$2)", [supDecision.workflowId, supDecision.runId]);
  record("superseded transitive Diagnosis is rejected", supMsg.includes("UPSTREAM_DECISION_LINEAGE_INVALID") && supMsg.includes("superseded"));

  const rls = await db.query<{ enabled: boolean }>("select bool_and(c.relrowsecurity) as enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='channelwright' and c.relkind='r' and c.relname in ('workflows','workflow_runs','workflow_steps','workflow_approvals','research_run_budgets','research_usage_operations')");
  record("RLS enabled on every workflow table", rls.rows[0].enabled === true);
  const isolated = await asAuthenticated(db, ownerB, () => db.query<{ count: string }>("select count(*)::text as count from channelwright.workflow_runs where id=$1", [decision.runId]));
  record("RLS hides another owner's Decision run", isolated.rows[0].count === "0");

  const startKey = `experiment:${randomUUID()}`;
  const started = await startExperiment(db, ownerA, decision, startKey);
  const startedIds = started.rows[0].result as { workflowId: string; runId: string; idempotentReplay: boolean };
  const persisted = await db.query<{ input_payload: Record<string, unknown> }>("select input_payload from channelwright.workflow_runs where id=$1", [startedIds.runId]);
  record("Experiment start persists server-resolved Decision authority", Boolean(persisted.rows[0].input_payload.approvedVideoDecisionReference));
  record("Experiment start accepts no caller artifact body", !("decisionResult" in persisted.rows[0].input_payload));
  const replay = await startExperiment(db, ownerA, decision, startKey);
  record("Experiment start is idempotent", replay.rows[0].result.runId === startedIds.runId && replay.rows[0].result.idempotentReplay === true);
  let strictError = "";
  try { await startExperiment(db, ownerA, decision, `strict:${randomUUID()}`, { decisionResult: { forged: true } }); } catch (error) { strictError = error instanceof Error ? error.message : String(error); }
  record("Experiment start rejects caller-supplied artifact content", strictError.includes("VALIDATION_ERROR"));
  let activeError = "";
  try { await startExperiment(db, ownerA, decision, `active:${randomUUID()}`); } catch (error) { activeError = error instanceof Error ? error.message : String(error); }
  record("active Experiment uniqueness is enforced by start", activeError.includes("VIDEO_EXPERIMENT_LIMIT_REACHED"));
  let uniqueBlocked = false;
  try {
    await db.query(`insert into channelwright.workflow_runs(id,owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload) values ($1,$2,$3,'CHANNEL_VIDEO_EXPERIMENT',1,'QUEUED',$4,$5,$6::jsonb)`, [randomUUID(), ownerA, startedIds.workflowId, `race:${randomUUID()}`, "1".repeat(64), JSON.stringify({ approvedVideoDecisionReference: { decisionRunId: decision.runId } })]);
  } catch { uniqueBlocked = true; }
  record("concurrent Experiment insertion is blocked by database uniqueness", uniqueBlocked);

  const limits = (overrides: Record<string, number> = {}) => JSON.stringify({ providerRequests: 0, providerQuotaUnits: 0, searches: 0, synthesisCalls: 2, qaCalls: 2, revisionCalls: 0, inputTokens: 100000, outputTokens: 20000, totalTokens: 120000, automatedRevisions: 0, ...overrides });
  const withinCeiling = await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [startedIds.runId, randomUUID(), randomUUID(), "experiment", limits()]);
  record("Experiment accounting ceilings allow exactly four structural model attempts and no revision", withinCeiling.includes("LEASE_NOT_ACTIVE") && !withinCeiling.includes("VALIDATION_ERROR"), withinCeiling.split("\n")[0].slice(0, 160));
  const overCalls = await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [startedIds.runId, randomUUID(), randomUUID(), "experiment", limits({ synthesisCalls: 3 })]);
  record("Experiment accounting rejects a fifth structural model attempt", overCalls.includes("VALIDATION_ERROR"));
  const revision = await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [startedIds.runId, randomUUID(), randomUUID(), "experiment", limits({ revisionCalls: 1 })]);
  record("Experiment accounting rejects automated revision budget", revision.includes("VALIDATION_ERROR"));

  const experimentOutput = { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_EXPERIMENT", source: { decisionRunId: decision.runId } };
  const approvedExperiment = await seedApprovedRun(db, ownerA, "CHANNEL_VIDEO_EXPERIMENT", experimentOutput, "validate-approved-decision", { reference: approved.reference }, { finalizerStep: "finalize-video-experiment", finalQaStep: "final-video-experiment-qa" });
  record("human-approved Experiment output is durable", (await db.query<{ count: string }>("select count(*)::text as count from channelwright.workflow_approvals where workflow_run_id=$1 and status='APPROVED' and decided_by=$2", [approvedExperiment.runId, ownerA])).rows[0].count === "1");
  record("approved Experiment output is immutable", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload=output_payload||'{\"x\":1}'::jsonb where id=$1", [approvedExperiment.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  record("approved Experiment finalizer output is immutable", (await expectFailure(db, null, "update channelwright.workflow_steps set output_payload=output_payload||'{\"x\":1}'::jsonb where workflow_run_id=$1 and step_key='finalize-video-experiment'", [approvedExperiment.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  record("approved Decision output remains immutable (no regression from Experiment's migration)", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload=output_payload||'{\"x\":1}'::jsonb where id=$1", [decision.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  const approvalDef = await db.query<{ source: string }>("select pg_get_functiondef(p.oid) as source from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='channelwright' and p.proname='decide_workflow_approval'");
  record("human revision wiring creates immutable Experiment successor lineage", approvalDef.rows[0].source.includes("CHANNEL_VIDEO_EXPERIMENT") && approvalDef.rows[0].source.includes("previousRunId"));

  await db.query("update channelwright.workflow_runs set status='COMPLETED' where id=$1", [startedIds.runId]);
  await db.query("update channelwright.workflows set status='COMPLETED' where id=$1", [startedIds.workflowId]);
  let sequentialOk = false;
  try { await startExperiment(db, ownerA, decision, `sequential:${randomUUID()}`); sequentialOk = true; } catch { sequentialOk = false; }
  record("a sequential Experiment run after completion is allowed", sequentialOk);
}

const APP_ROLES = ["authenticated", "service_role", "anon"] as const;

async function main() {
  if (!CONNECTION) {
    console.log(JSON.stringify({ gate: "VIDEO_EXPERIMENT_DISPOSABLE_PG_UNAVAILABLE", reason: "CHANNELWRIGHT_DISPOSABLE_DATABASE_URL is not set", hint: "Set CHANNELWRIGHT_DISPOSABLE_DATABASE_URL to a throwaway PostgreSQL cluster (never the application database)." }, null, 2));
    process.exitCode = 2;
    return;
  }
  const connection = CONNECTION;
  const admin = new pg.Client({ connectionString: connection, application_name: "cw-disposable-pg-probe" });
  try { await admin.connect(); }
  catch (error) {
    console.log(JSON.stringify({ gate: "VIDEO_EXPERIMENT_DISPOSABLE_PG_UNAVAILABLE", reason: error instanceof Error ? error.message.split("\n")[0] : String(error), hint: "Set CHANNELWRIGHT_DISPOSABLE_DATABASE_URL to a reachable throwaway PostgreSQL cluster." }, null, 2));
    process.exitCode = 2;
    return;
  }
  const dbName = `cw_disposable_${randomUUID().replace(/-/g, "")}`;
  let created = false;
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
    gate: failed.length === 0 ? "VIDEO_EXPERIMENT_DISPOSABLE_PG_PASSED" : "VIDEO_EXPERIMENT_DISPOSABLE_PG_FAILED",
    database: connection.replace(/\/\/[^@]*@/, "//***@"),
    counts: { passed: checks.length - failed.length, failed: failed.length },
    checks,
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

await main();
