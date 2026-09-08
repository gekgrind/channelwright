/**
 * Disposable PostgreSQL runtime gate for the CHANNEL_VIDEO_PORTFOLIO migration
 * chain.
 *
 * Unlike the persisted gate (which targets shared Supabase), this creates a
 * throwaway database on a disposable PostgreSQL server, installs a minimal
 * Supabase-compatible shim (roles, auth/extensions/storage schemas, pgcrypto,
 * auth.uid/jwt), applies the ENTIRE migration chain from scratch, runtime-proves
 * behaviour that source-text tests cannot (migration execution, pgcrypto
 * resolution, the approved-Experiment resolver trust boundary and its
 * portfolio-eligibility gate, the eleven-artifact transitive re-hash and
 * supersession check, the bounded candidate projection, multi-candidate start
 * resolution, cycle-scoped concurrency, RLS, immutability including the new
 * VIDEO_PORTFOLIO coverage, and zero-retrieval/zero-revision accounting), then
 * drops the database and verifies cleanup.
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
  const research = await seedApprovedRun(db, ownerId, "CHANNEL_RESEARCH", { schemaVersion: 1, workflowType: "CHANNEL_RESEARCH" }, "", null);
  const researchRef = upstreamRef("RESEARCH", research);
  const strategy = await seedApprovedRun(db, ownerId, "CHANNEL_STRATEGY", { schemaVersion: 1, workflowType: "CHANNEL_STRATEGY", upstreamResearch: researchRef }, "", null);
  const strategyRef = upstreamRef("STRATEGY", strategy, researchRef);
  const content = await seedApprovedRun(db, ownerId, "CHANNEL_CONTENT_INTELLIGENCE", { schemaVersion: 1, workflowType: "CHANNEL_CONTENT_INTELLIGENCE", upstreamStrategy: strategyRef }, "", null);
  const contentRef = upstreamRef("CONTENT", content, strategyRef);
  const brief = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_BRIEF", { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_BRIEF", upstreamContentIntelligence: contentRef }, "", null);
  const briefRef = upstreamRef("BRIEF", brief, contentRef);
  const script = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_SCRIPT", { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_SCRIPT", upstreamVideoBrief: briefRef }, "", null);
  const scriptRef = upstreamRef("SCRIPT", script, briefRef);
  const packaging = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_PACKAGING", { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_PACKAGING", upstreamVideoScript: scriptRef }, "", null);
  const packagingRef = upstreamRef("PACKAGING", packaging, scriptRef);
  const releaseOutput = { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_RELEASE", upstreamVideoPackaging: packagingRef };
  const release = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_RELEASE", releaseOutput, "", null);
  const releaseRef = { releaseWorkflowId: release.workflowId, releaseRunId: release.runId, workflowDefinitionVersion: 1, outputSchemaVersion: 1, releaseArtifactHash: release.artifactHash, upstreamVideoPackaging: packagingRef };
  return { research, strategy, content, brief, script, packaging, release, releaseRef, releaseOutput };
}

type Lineage = Awaited<ReturnType<typeof seedLineage>>;

async function seedPerformance(db: pg.Client, ownerId: string, lineage: Lineage) {
  const output = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_PERFORMANCE",
    source: { releaseTopicId: "topic:decision", pillarId: "pillar:evidence", finalTitle: "What the evidence actually says" },
    upstreamVideoRelease: lineage.releaseRef,
  };
  return seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_PERFORMANCE", output, "validate-approved-release", { reference: lineage.releaseRef, releaseResult: lineage.releaseOutput }, {
    finalizerStep: "finalize-video-performance", finalQaStep: "final-video-performance-qa",
  });
}

function eightArtifactScope(lineage: Lineage, performance: Seeded) {
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

async function seedDiagnosis(db: pg.Client, ownerId: string, lineage: Lineage, performance: Seeded, performanceReference: Record<string, unknown>) {
  const output = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_DIAGNOSIS",
    source: { performanceRunId: performance.runId },
    upstreamVideoPerformance: performanceReference,
    diagnosisScope: { artifacts: eightArtifactScope(lineage, performance), entries: [], facts: [{ key: "fact:final-title", value: "What the evidence actually says", sourceRef: "performance:/source/finalTitle" }] },
    analysis: { findings: [], unknowns: [], viewerValueAnalysis: { state: "PRESERVED" }, summary: { outcome: "INCONCLUSIVE", overallConfidence: "low", decisionDeferred: true } },
  };
  return seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_DIAGNOSIS", output, "validate-approved-performance", { reference: performanceReference }, {
    finalizerStep: "finalize-video-diagnosis", finalQaStep: "final-video-diagnosis-qa",
  });
}

async function seedDecision(db: pg.Client, ownerId: string, lineage: Lineage, performance: Seeded, diagnosis: Seeded, diagnosisReference: Record<string, unknown>) {
  const output = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_DECISION",
    source: { diagnosisRunId: diagnosis.runId },
    approvedVideoDiagnosisReference: diagnosisReference,
    decisionScope: {
      artifacts: [...eightArtifactScope(lineage, performance), { workflowType: "CHANNEL_VIDEO_DIAGNOSIS", runId: diagnosis.runId, artifactHash: diagnosis.artifactHash, schemaVersion: 1 }],
      entries: [],
      facts: [{ key: "fact:diagnosis-outcome", value: "INCONCLUSIVE", sourceRef: "diagnosis:/analysis/summary/outcome" }],
    },
    content: { decision: { decisionType: "INVESTIGATE", category: "OPENING_PROMISE" }, experimentEligible: true },
  };
  return seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_DECISION", output, "validate-approved-diagnosis", { reference: diagnosisReference }, {
    finalizerStep: "finalize-video-decision", finalQaStep: "final-video-decision-qa",
  });
}

type ExperimentOptions = Parameters<typeof seedApprovedRun>[6] & {
  portfolioEligible?: boolean;
  experimentReady?: boolean;
  viewerValueState?: string;
  upstreamReference?: unknown;
  scopeArtifacts?: unknown[];
  topicId?: string;
};

/**
 * A complete approved CHANNEL_VIDEO_EXPERIMENT artifact: everything the Portfolio
 * resolver reads, including the ten-artifact experiment scope it extends to
 * eleven and every field the bounded candidate projection lifts out.
 */
async function seedExperiment(db: pg.Client, ownerId: string, lineage: Lineage, performance: Seeded, diagnosis: Seeded, decision: Seeded, decisionReference: Record<string, unknown>, options: ExperimentOptions = {}) {
  const output = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_EXPERIMENT",
    designedAt: "2026-09-06T10:00:00.000Z",
    source: {
      decisionWorkflowId: decision.workflowId, decisionRunId: decision.runId,
      diagnosisWorkflowId: diagnosis.workflowId, diagnosisRunId: diagnosis.runId,
      performanceWorkflowId: performance.workflowId, performanceRunId: performance.runId,
      releaseWorkflowId: lineage.release.workflowId, releaseRunId: lineage.release.runId,
      topicId: options.topicId ?? "topic:decision", pillarId: "pillar:evidence",
      finalTitle: "What the evidence actually says", subjectIdentity: `decision:${decision.runId}`,
    },
    approvedVideoDecisionReference: options.upstreamReference ?? decisionReference,
    experimentScope: {
      artifacts: options.scopeArtifacts ?? [
        ...eightArtifactScope(lineage, performance),
        { workflowType: "CHANNEL_VIDEO_DIAGNOSIS", runId: diagnosis.runId, artifactHash: diagnosis.artifactHash, schemaVersion: 1 },
        { workflowType: "CHANNEL_VIDEO_DECISION", runId: decision.runId, artifactHash: decision.artifactHash, schemaVersion: 1 },
      ],
      entries: [],
      facts: [{ key: "fact:experiment-eligible", value: true, sourceRef: "decision:/content/experimentEligible" }],
    },
    viewerValueProvenance: { originStage: "RELEASE", originWorkflowType: "CHANNEL_VIDEO_RELEASE", originRunId: lineage.release.runId, subjectId: "topic:decision", contractHash: "a".repeat(64), gate: "PASS", assessedAt: "2026-09-01T00:00:00.000Z" },
    content: {
      experiment: {
        id: "experiment:opening-promise", experimentType: "CONTROLLED_COMPARISON", disposition: "RUN_COMPARISON",
        measurementOnly: false, category: "OPENING_PROMISE", title: "Opening promise clarity test",
        hypothesis: "A clearer opening promise raises how much of the video viewers actually watch.",
        decisionLinkage: { decisionId: "decision:opening-promise", decisionType: "INVESTIGATE", hypothesisUnderTest: "The opening promise is unclear.", testsDecisionStatement: "Investigate the opening promise." },
        targetVariable: "Opening promise wording", unitOfAssignment: "VIDEO",
        controlCondition: { kind: "SIMULTANEOUS_CONTROL", description: "Current opening", comparability: "Same subject and length." },
        treatmentCondition: { description: "Reworked opening", whatChanges: "The promise wording", whatStaysConstant: ["Runtime"] },
        primaryMetric: { metric: "AVERAGE_PERCENTAGE_VIEWED", unit: "PERCENT", direction: "INCREASE", rationale: "Reflects whether the promise held." },
        semanticIntent: { treatmentMechanism: "PROMISE_FRAMING", evidenceCanChangeShippingDecision: true, adoptionCondition: "CHALLENGER_WINS_PRIMARY", preservationCondition: "CHALLENGER_FAILS_TO_WIN" },
        evidenceStrength: "MODERATE", confidenceInDesign: "medium",
        requiresHumanJudgment: false, executionDeferred: true,
      },
      viewerValueSafeguards: { inheritedState: options.viewerValueState ?? "PRESERVED", promiseIntegrityRisk: "NONE", metricGamingRisk: "Acquisition without satisfaction.", guardedMetricGaming: "Retention primary.", escalationRequired: false },
      experimentReady: options.experimentReady ?? true,
      portfolioEligible: options.portfolioEligible ?? true,
    },
  };
  // The provenance step always carries the authoritative Decision reference, so
  // `upstreamReference` drifts only the finalized output -- which is exactly the
  // nested-reference disagreement the resolver must catch.
  return seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_EXPERIMENT", output, "validate-approved-decision", { reference: decisionReference }, {
    ...options,
    finalizerStep: options.finalizerStep ?? "finalize-video-experiment",
    finalQaStep: options.finalQaStep ?? "final-video-experiment-qa",
  });
}

const portfolioObjective = "Allocate one operator-declared cycle capacity across one to six exact approved, portfolio-eligible CHANNEL_VIDEO_EXPERIMENT designs into a single independently critiqued, human-approved allocation of record without redesigning an experiment, revisiting a decision, or executing anything";
const portfolioSteps = [
  { key: "validate-approved-experiments", position: 0, kind: "WORKER", capability: "approved-experiment-validation", dependsOn: [], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "derive-portfolio-constraints", position: 1, kind: "WORKER", capability: "deterministic-portfolio-constraints", dependsOn: ["validate-approved-experiments"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "draft-video-portfolio", position: 2, kind: "WORKER", capability: "video-portfolio-allocation", dependsOn: ["derive-portfolio-constraints"], maxAttempts: 2, retryBaseSeconds: 10 },
  { key: "critique-video-portfolio", position: 3, kind: "WORKER", capability: "independent-video-portfolio-critique", dependsOn: ["draft-video-portfolio"], maxAttempts: 2, retryBaseSeconds: 10 },
  { key: "final-video-portfolio-qa", position: 4, kind: "WORKER", capability: "deterministic-video-portfolio-qa", dependsOn: ["critique-video-portfolio"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "finalize-video-portfolio", position: 5, kind: "WORKER", capability: "video-portfolio-finalizer", dependsOn: ["final-video-portfolio-qa"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "review-video-portfolio", position: 6, kind: "APPROVAL", capability: "human", dependsOn: ["finalize-video-portfolio"], maxAttempts: 1, retryBaseSeconds: 0 },
];

async function startPortfolio(db: pg.Client, ownerId: string, input: Record<string, unknown>, idempotencyKey: string) {
  return asAuthenticated(db, ownerId, () => db.query<{ result: Record<string, unknown> }>(
    "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_PORTFOLIO',1,$3,$4::jsonb,$5::jsonb) as result",
    [idempotencyKey, sha256(idempotencyKey), portfolioObjective, JSON.stringify(input), JSON.stringify(portfolioSteps)],
  ));
}

const selectionsOf = (...experiments: Seeded[]) => experiments.map((experiment) => ({ experimentWorkflowId: experiment.workflowId, experimentRunId: experiment.runId }));
const portfolioInput = (cycleLabel: string, slots: number, experiments: Seeded[], extra: Record<string, unknown> = {}) => ({ cycleLabel, concurrentExperimentSlots: slots, experimentSelections: selectionsOf(...experiments), ...extra });

async function runChecks(db: pg.Client) {
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const digest = await db.query<{ h: string }>("select encode(extensions.digest('x','sha256'),'hex') as h");
  record("pgcrypto extensions.digest resolves at runtime", digest.rows[0].h === sha256("x"));

  const fns = await db.query<{ count: string }>("select count(*)::text as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='channelwright' and p.proname in ('resolve_approved_research_artifact','resolve_approved_strategy_artifact','resolve_approved_content_artifact','resolve_approved_video_brief_artifact','resolve_approved_video_script_artifact','resolve_approved_video_packaging_artifact','resolve_approved_video_release_artifact','resolve_approved_video_performance_artifact','resolve_approved_video_diagnosis_artifact','resolve_approved_video_decision_artifact','resolve_approved_video_experiment_artifact')");
  record("all eleven approved-artifact resolvers compiled", fns.rows[0].count === "11", `count=${fns.rows[0].count}`);

  const canonicalProbe = { z: [3, { b: true, a: "x" }], a: 1 };
  const canon = await db.query<{ c: string }>("select channelwright.canonical_jsonb_text($1::jsonb) as c", [JSON.stringify(canonicalProbe)]);
  record("canonical_jsonb_text parity with application", canon.rows[0].c === canonicalJson(canonicalProbe));

  const lineage = await seedLineage(db, ownerA);
  const performance = await seedPerformance(db, ownerA, lineage);
  const performanceRef = (await asAuthenticated(db, ownerA, () => db.query<{ result: { reference: Record<string, unknown> } }>("select channelwright.resolve_approved_video_performance_artifact($1,$2) as result", [performance.workflowId, performance.runId]))).rows[0].result.reference;
  const diagnosis = await seedDiagnosis(db, ownerA, lineage, performance, performanceRef);
  const diagnosisRef = (await asAuthenticated(db, ownerA, () => db.query<{ result: { reference: Record<string, unknown> } }>("select channelwright.resolve_approved_video_diagnosis_artifact($1,$2) as result", [diagnosis.workflowId, diagnosis.runId]))).rows[0].result.reference;
  const decision = await seedDecision(db, ownerA, lineage, performance, diagnosis, diagnosisRef);
  const decisionRef = (await asAuthenticated(db, ownerA, () => db.query<{ result: { reference: Record<string, unknown> } }>("select channelwright.resolve_approved_video_decision_artifact($1,$2) as result", [decision.workflowId, decision.runId]))).rows[0].result.reference;

  const seed = (options: ExperimentOptions = {}) => seedExperiment(db, ownerA, lineage, performance, diagnosis, decision, decisionRef, options);
  const experimentOne = await seed();
  const resolveExperiment = (target: Seeded, owner = ownerA) => asAuthenticated(db, owner, () => db.query<{
    result: { reference: Record<string, unknown>; candidate: Record<string, unknown>; artifacts: unknown[] };
  }>("select channelwright.resolve_approved_video_experiment_artifact($1,$2) as result", [target.workflowId, target.runId]));

  const resolved = (await resolveExperiment(experimentOne)).rows[0].result;
  record("approved Experiment resolver executes for the owner", resolved.reference.experimentRunId === experimentOne.runId);
  record("resolver returns portfolioEligible: true and the projected experiment type", resolved.reference.portfolioEligible === true && resolved.reference.experimentType === "CONTROLLED_COMPARISON");
  record("compact portfolio lineage contains exactly eleven authoritative artifacts", resolved.artifacts.length === 11);
  record("candidate id is server-derived from the experiment run", resolved.candidate.candidateId === `cand:${experimentOne.runId}`);
  record("candidate projection lifts the closed-vocabulary allocation facts", [
    ["experimentType", "CONTROLLED_COMPARISON"], ["disposition", "RUN_COMPARISON"], ["controlKind", "SIMULTANEOUS_CONTROL"],
    ["category", "OPENING_PROMISE"], ["unitOfAssignment", "VIDEO"], ["treatmentMechanism", "PROMISE_FRAMING"],
    ["primaryMetric", "AVERAGE_PERCENTAGE_VIEWED"], ["primaryMetricDirection", "INCREASE"], ["evidenceStrength", "MODERATE"],
    ["confidenceInDesign", "medium"], ["viewerValueState", "PRESERVED"], ["promiseIntegrityRisk", "NONE"],
    ["decisionId", "decision:opening-promise"], ["decisionType", "INVESTIGATE"],
  ].every(([key, value]) => resolved.candidate[key] === value)
    && resolved.candidate.measurementOnly === false && resolved.candidate.experimentReady === true
    && resolved.candidate.requiresHumanJudgment === false && resolved.candidate.escalationRequired === false
    && resolved.candidate.evidenceCanChangeShippingDecision === true
    && resolved.candidate.viewerValueContractHash === "a".repeat(64));
  const lineageProjection = resolved.candidate.lineage as Record<string, string>;
  record("candidate projection preserves the full decision-to-release provenance chain",
    lineageProjection.decisionRunId === decision.runId && lineageProjection.diagnosisRunId === diagnosis.runId
    && lineageProjection.performanceRunId === performance.runId && lineageProjection.releaseRunId === lineage.release.runId
    && lineageProjection.topicId === "topic:decision");
  const upstreamSummary = resolved.reference.upstreamVideoDecision as Record<string, unknown>;
  record("resolver returns a FLAT upstream Decision summary, not a nested reference chain",
    Object.keys(upstreamSummary).sort().join(",") === "decisionArtifactHash,decisionProvenanceHash,decisionRunId,decisionType,decisionWorkflowId,experimentEligible"
    && upstreamSummary.decisionRunId === decision.runId && upstreamSummary.experimentEligible === true,
    Object.keys(upstreamSummary).join(","));
  const referenceBytes = Buffer.byteLength(JSON.stringify(resolved), "utf8");
  record("one resolved candidate stays small enough that six fit inside the 64 KiB step-output ceiling",
    referenceBytes * 6 < 65_536, `${referenceBytes} bytes x6 = ${referenceBytes * 6}`);

  const projectionKeys = Object.keys(resolved.candidate);
  record("candidate projection exposes no experiment prose beyond the bounded title",
    !projectionKeys.some((key) => ["hypothesis", "treatmentCondition", "controlCondition", "stoppingConditions", "interpretationPlan", "rollbackPlan", "viewerValueGuardrails", "guardrailMetrics"].includes(key))
    && typeof resolved.candidate.title === "string" && (resolved.candidate.title as string).length <= 200,
    projectionKeys.join(","));

  record("cross-owner approved Experiment resolution is NOT_FOUND", (await expectFailure(db, ownerB, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [experimentOne.workflowId, experimentOne.runId])).includes("NOT_FOUND"));
  const ineligible = await seed({ portfolioEligible: false });
  record("a portfolio-ineligible Experiment is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [ineligible.workflowId, ineligible.runId])).includes("UPSTREAM_EXPERIMENT_NOT_PORTFOLIO_ELIGIBLE"));
  const unapproved = await seed({ approve: false });
  record("unapproved Experiment is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [unapproved.workflowId, unapproved.runId])).includes("UPSTREAM_EXPERIMENT_NOT_APPROVED"));
  const rejectedQa = await seed({ qaPassed: false });
  record("rejected Experiment final QA is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [rejectedQa.workflowId, rejectedQa.runId])).includes("UPSTREAM_EXPERIMENT_QA_INVALID"));
  const wrongFinalizer = await seed({ finalizerOutput: { schemaVersion: 1, wrong: true } });
  record("Experiment finalizer disagreement is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [wrongFinalizer.workflowId, wrongFinalizer.runId])).includes("UPSTREAM_EXPERIMENT_INTEGRITY_MISMATCH"));
  const corruptArtifact = await seed({ corruptHash: true });
  record("altered Experiment artifact hash is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [corruptArtifact.workflowId, corruptArtifact.runId])).includes("UPSTREAM_EXPERIMENT_INTEGRITY_MISMATCH"));
  const corruptProvenance = await seed({ corruptProvenance: true });
  record("altered Experiment provenance hash is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [corruptProvenance.workflowId, corruptProvenance.runId])).includes("UPSTREAM_EXPERIMENT_INTEGRITY_MISMATCH"));
  const driftedDecision = await seed({ upstreamReference: { ...decisionRef, decisionArtifactHash: "9".repeat(64) } });
  record("nested Decision reference drift is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [driftedDecision.workflowId, driftedDecision.runId])).includes("UPSTREAM_EXPERIMENT_INTEGRITY_MISMATCH"));
  const superseded = await seed({ current: false });
  record("superseded Experiment is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [superseded.workflowId, superseded.runId])).includes("UPSTREAM_EXPERIMENT_SUPERSEDED"));
  const badParent = await seed({ context: { previousRunId: randomUUID() } });
  record("Experiment parent/root lineage drift is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [badParent.workflowId, badParent.runId])).includes("UPSTREAM_EXPERIMENT_LINEAGE_INVALID"));
  const shortScope = await seed({ scopeArtifacts: eightArtifactScope(lineage, performance) });
  record("an Experiment scope short of ten artifacts is rejected", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [shortScope.workflowId, shortScope.runId])).includes("exactly ten upstream artifacts"));

  // The resolved lineage root must belong to THIS EXACT Experiment workflow: a
  // same-owner run of another CHANNEL_VIDEO_EXPERIMENT workflow must not satisfy
  // the root predicate. Carried forward from the round-3 Experiment hardening.
  const rootProbe = await seed();
  const foreignExperimentRun = await seed();
  await db.query("insert into channelwright.research_run_budgets(workflow_run_id,owner_id,workflow_id,parent_run_id,root_run_id,limits) values ($1,$2,$3,null,$4,'{}'::jsonb)", [rootProbe.runId, ownerA, rootProbe.workflowId, rootProbe.runId]);
  record("valid same-workflow lineage root still resolves", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [rootProbe.workflowId, rootProbe.runId])) === "");
  await db.query("update channelwright.research_run_budgets set root_run_id=$2 where workflow_run_id=$1", [rootProbe.runId, foreignExperimentRun.runId]);
  const foreignRootMsg = await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [rootProbe.workflowId, rootProbe.runId]);
  record("same-owner root from a different Experiment workflow is rejected",
    foreignRootMsg.includes("UPSTREAM_EXPERIMENT_LINEAGE_INVALID") && foreignRootMsg.includes("resolved root is not a real run of this workflow"),
    foreignRootMsg.split("\n")[0].slice(0, 160));

  // A structurally superseded transitive upstream (Decision here) must be rejected
  // even though the Experiment's frozen projection still hash-matches it.
  const supLineage = await seedLineage(db, ownerA);
  const supPerf = await seedPerformance(db, ownerA, supLineage);
  const supPerfRef = (await asAuthenticated(db, ownerA, () => db.query<{ result: { reference: Record<string, unknown> } }>("select channelwright.resolve_approved_video_performance_artifact($1,$2) as result", [supPerf.workflowId, supPerf.runId]))).rows[0].result.reference;
  const supDiag = await seedDiagnosis(db, ownerA, supLineage, supPerf, supPerfRef);
  const supDiagRef = (await asAuthenticated(db, ownerA, () => db.query<{ result: { reference: Record<string, unknown> } }>("select channelwright.resolve_approved_video_diagnosis_artifact($1,$2) as result", [supDiag.workflowId, supDiag.runId]))).rows[0].result.reference;
  const supDecision = await seedDecision(db, ownerA, supLineage, supPerf, supDiag, supDiagRef);
  const supDecisionRef = (await asAuthenticated(db, ownerA, () => db.query<{ result: { reference: Record<string, unknown> } }>("select channelwright.resolve_approved_video_decision_artifact($1,$2) as result", [supDecision.workflowId, supDecision.runId]))).rows[0].result.reference;
  const supExperiment = await seedExperiment(db, ownerA, supLineage, supPerf, supDiag, supDecision, supDecisionRef);
  record("transitive-supersession fixture resolves clean before tampering", (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [supExperiment.workflowId, supExperiment.runId])) === "");
  const supDecisionSuccessor = randomUUID();
  await db.query(`insert into channelwright.workflow_runs(id,owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload,context_payload,output_payload,completed_at)
    values ($1,$2,$3,'CHANNEL_VIDEO_DECISION',1,'COMPLETED',$4,$5,'{}'::jsonb,$6::jsonb,$7::jsonb,now())`,
    [supDecisionSuccessor, ownerA, supDecision.workflowId, `sup:${supDecisionSuccessor}`, "0".repeat(64), JSON.stringify({ previousRunId: supDecision.runId }), JSON.stringify({ schemaVersion: 1, workflowType: "CHANNEL_VIDEO_DECISION", superseded: true })]);
  await db.query("update channelwright.workflows set current_run_id=$2 where id=$1", [supDecision.workflowId, supDecisionSuccessor]);
  const supMsg = await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_experiment_artifact($1,$2)", [supExperiment.workflowId, supExperiment.runId]);
  record("superseded transitive Decision is rejected", supMsg.includes("UPSTREAM_EXPERIMENT_LINEAGE_INVALID") && supMsg.includes("superseded"));

  const rls = await db.query<{ enabled: boolean }>("select bool_and(c.relrowsecurity) as enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='channelwright' and c.relkind='r' and c.relname in ('workflows','workflow_runs','workflow_steps','workflow_approvals','research_run_budgets','research_usage_operations')");
  record("RLS enabled on every workflow table", rls.rows[0].enabled === true);
  const isolated = await asAuthenticated(db, ownerB, () => db.query<{ count: string }>("select count(*)::text as count from channelwright.workflow_runs where id=$1", [experimentOne.runId]));
  record("RLS hides another owner's Experiment run", isolated.rows[0].count === "0");

  // --- Multi-candidate start ------------------------------------------------
  const experimentTwo = await seed({ topicId: "topic:second-video" });
  const cycle = "2026 Autumn Learning Cycle";
  const startKey = `portfolio:${randomUUID()}`;
  const started = await startPortfolio(db, ownerA, portfolioInput(cycle, 2, [experimentOne, experimentTwo]), startKey);
  const startedIds = started.rows[0].result as { workflowId: string; runId: string; idempotentReplay: boolean };
  const persisted = await db.query<{ input_payload: Record<string, unknown> }>("select input_payload from channelwright.workflow_runs where id=$1", [startedIds.runId]);
  const refs = persisted.rows[0].input_payload.approvedVideoExperimentReferences as Array<{ experimentRunId: string; portfolioEligible: boolean }>;
  record("Portfolio start resolves and persists one server-resolved reference per selection, in order",
    Array.isArray(refs) && refs.length === 2 && refs[0].experimentRunId === experimentOne.runId && refs[1].experimentRunId === experimentTwo.runId && refs.every((ref) => ref.portfolioEligible === true));
  record("Portfolio start normalises the cycle key for concurrency", persisted.rows[0].input_payload.portfolioCycleKey === cycle.toLowerCase());
  record("Portfolio start accepts no caller artifact body", !("candidate" in persisted.rows[0].input_payload) && !("portfolioScope" in persisted.rows[0].input_payload));
  const replay = await startPortfolio(db, ownerA, portfolioInput(cycle, 2, [experimentOne, experimentTwo]), startKey);
  record("Portfolio start is idempotent", replay.rows[0].result.runId === startedIds.runId && replay.rows[0].result.idempotentReplay === true);

  const strictError = await expectFailure(db, ownerA, "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_PORTFOLIO',1,$3,$4::jsonb,$5::jsonb)",
    [`strict:${randomUUID()}`, sha256("strict"), portfolioObjective, JSON.stringify(portfolioInput(`strict ${randomUUID()}`, 1, [experimentOne], { approvedVideoExperimentReferences: [{ forged: true }] })), JSON.stringify(portfolioSteps)]);
  record("Portfolio start rejects caller-supplied artifact content", strictError.includes("VALIDATION_ERROR"));
  const dupError = await expectFailure(db, ownerA, "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_PORTFOLIO',1,$3,$4::jsonb,$5::jsonb)",
    [`dup:${randomUUID()}`, sha256("dup"), portfolioObjective, JSON.stringify(portfolioInput(`dup ${randomUUID()}`, 1, [experimentOne, experimentOne])), JSON.stringify(portfolioSteps)]);
  record("Portfolio start rejects the same Experiment selected twice", dupError.includes("the same experiment run cannot be selected twice"));
  const slotError = await expectFailure(db, ownerA, "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_PORTFOLIO',1,$3,$4::jsonb,$5::jsonb)",
    [`slots:${randomUUID()}`, sha256("slots"), portfolioObjective, JSON.stringify(portfolioInput(`slots ${randomUUID()}`, 9, [experimentOne])), JSON.stringify(portfolioSteps)]);
  record("Portfolio start rejects a slot count outside one to six", slotError.includes("VALIDATION_ERROR"));
  const ineligibleStart = await expectFailure(db, ownerA, "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_PORTFOLIO',1,$3,$4::jsonb,$5::jsonb)",
    [`inel:${randomUUID()}`, sha256("inel"), portfolioObjective, JSON.stringify(portfolioInput(`inel ${randomUUID()}`, 1, [experimentOne, ineligible])), JSON.stringify(portfolioSteps)]);
  record("one ineligible candidate fails the whole Portfolio start, pre-spend", ineligibleStart.includes("UPSTREAM_EXPERIMENT_NOT_PORTFOLIO_ELIGIBLE"));

  const activeError = await expectFailure(db, ownerA, "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_PORTFOLIO',1,$3,$4::jsonb,$5::jsonb)",
    [`active:${randomUUID()}`, sha256("active"), portfolioObjective, JSON.stringify(portfolioInput(cycle.toUpperCase(), 1, [experimentOne])), JSON.stringify(portfolioSteps)]);
  record("active Portfolio uniqueness is enforced per cycle, case-insensitively", activeError.includes("VIDEO_PORTFOLIO_LIMIT_REACHED"));
  const otherCycleOk = await expectFailure(db, ownerA, "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_PORTFOLIO',1,$3,$4::jsonb,$5::jsonb)",
    [`other:${randomUUID()}`, sha256("other"), portfolioObjective, JSON.stringify(portfolioInput("2026 Winter Cycle", 1, [experimentOne])), JSON.stringify(portfolioSteps)]);
  record("a different cycle may allocate concurrently", otherCycleOk === "", otherCycleOk.split("\n")[0].slice(0, 160));
  let uniqueBlocked = false;
  try {
    await db.query(`insert into channelwright.workflow_runs(id,owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload) values ($1,$2,$3,'CHANNEL_VIDEO_PORTFOLIO',1,'QUEUED',$4,$5,$6::jsonb)`,
      [randomUUID(), ownerA, startedIds.workflowId, `race:${randomUUID()}`, "1".repeat(64), JSON.stringify({ portfolioCycleKey: cycle.toLowerCase() })]);
  } catch { uniqueBlocked = true; }
  record("concurrent Portfolio insertion for one cycle is blocked by database uniqueness", uniqueBlocked);

  const limits = (overrides: Record<string, number> = {}) => JSON.stringify({ providerRequests: 0, providerQuotaUnits: 0, searches: 0, synthesisCalls: 2, qaCalls: 2, revisionCalls: 0, inputTokens: 100000, outputTokens: 20000, totalTokens: 120000, automatedRevisions: 0, ...overrides });
  const withinCeiling = await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [startedIds.runId, randomUUID(), randomUUID(), "portfolio", limits()]);
  record("Portfolio accounting ceilings allow exactly four structural model attempts and no revision", withinCeiling.includes("LEASE_NOT_ACTIVE") && !withinCeiling.includes("VALIDATION_ERROR"), withinCeiling.split("\n")[0].slice(0, 160));
  record("Portfolio accounting rejects a fifth structural model attempt", (await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [startedIds.runId, randomUUID(), randomUUID(), "portfolio", limits({ synthesisCalls: 3 })])).includes("VALIDATION_ERROR"));
  record("Portfolio accounting rejects automated revision budget", (await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [startedIds.runId, randomUUID(), randomUUID(), "portfolio", limits({ revisionCalls: 1 })])).includes("VALIDATION_ERROR"));
  record("Portfolio accounting rejects any external retrieval budget", (await expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [startedIds.runId, randomUUID(), randomUUID(), "portfolio", limits({ searches: 1 })])).includes("VALIDATION_ERROR"));

  const portfolioOutput = { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_PORTFOLIO", source: { cycleLabel: cycle, candidateCount: 2 } };
  const approvedPortfolio = await seedApprovedRun(db, ownerA, "CHANNEL_VIDEO_PORTFOLIO", portfolioOutput, "validate-approved-experiments", { artifacts: [{ reference: resolved.reference }] }, { finalizerStep: "finalize-video-portfolio", finalQaStep: "final-video-portfolio-qa" });
  record("human-approved Portfolio output is durable", (await db.query<{ count: string }>("select count(*)::text as count from channelwright.workflow_approvals where workflow_run_id=$1 and status='APPROVED' and decided_by=$2", [approvedPortfolio.runId, ownerA])).rows[0].count === "1");
  record("approved Portfolio output is immutable", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload=output_payload||'{\"x\":1}'::jsonb where id=$1", [approvedPortfolio.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  record("approved Portfolio finalizer output is immutable", (await expectFailure(db, null, "update channelwright.workflow_steps set output_payload=output_payload||'{\"x\":1}'::jsonb where workflow_run_id=$1 and step_key='finalize-video-portfolio'", [approvedPortfolio.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  record("approved Experiment output remains immutable (no regression from Portfolio's migration)", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload=output_payload||'{\"x\":1}'::jsonb where id=$1", [experimentOne.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  record("approved Decision output remains immutable (no regression from Portfolio's migration)", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload=output_payload||'{\"x\":1}'::jsonb where id=$1", [decision.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  const approvalDef = await db.query<{ source: string }>("select pg_get_functiondef(p.oid) as source from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='channelwright' and p.proname='decide_workflow_approval'");
  record("human revision wiring creates immutable Portfolio successor lineage", approvalDef.rows[0].source.includes("CHANNEL_VIDEO_PORTFOLIO") && approvalDef.rows[0].source.includes("validate-approved-experiments") && approvalDef.rows[0].source.includes("previousRunId"));

  await db.query("update channelwright.workflow_runs set status='COMPLETED' where id=$1", [startedIds.runId]);
  await db.query("update channelwright.workflows set status='COMPLETED' where id=$1", [startedIds.workflowId]);
  const sequential = await expectFailure(db, ownerA, "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_PORTFOLIO',1,$3,$4::jsonb,$5::jsonb)",
    [`sequential:${randomUUID()}`, sha256("sequential"), portfolioObjective, JSON.stringify(portfolioInput(cycle, 1, [experimentOne])), JSON.stringify(portfolioSteps)]);
  record("a sequential Portfolio run for the same cycle after completion is allowed", sequential === "", sequential.split("\n")[0].slice(0, 160));
}

const APP_ROLES = ["authenticated", "service_role", "anon"] as const;

async function main() {
  if (!CONNECTION) {
    console.log(JSON.stringify({ gate: "VIDEO_PORTFOLIO_DISPOSABLE_PG_UNAVAILABLE", reason: "CHANNELWRIGHT_DISPOSABLE_DATABASE_URL is not set", hint: "Set CHANNELWRIGHT_DISPOSABLE_DATABASE_URL to a throwaway PostgreSQL cluster (never the application database)." }, null, 2));
    process.exitCode = 2;
    return;
  }
  const connection = CONNECTION;
  const admin = new pg.Client({ connectionString: connection, application_name: "cw-disposable-pg-probe" });
  try { await admin.connect(); }
  catch (error) {
    console.log(JSON.stringify({ gate: "VIDEO_PORTFOLIO_DISPOSABLE_PG_UNAVAILABLE", reason: error instanceof Error ? error.message.split("\n")[0] : String(error), hint: "Set CHANNELWRIGHT_DISPOSABLE_DATABASE_URL to a reachable throwaway PostgreSQL cluster." }, null, 2));
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
    gate: failed.length === 0 ? "VIDEO_PORTFOLIO_DISPOSABLE_PG_PASSED" : "VIDEO_PORTFOLIO_DISPOSABLE_PG_FAILED",
    database: connection.replace(/\/\/[^@]*@/, "//***@"),
    counts: { passed: checks.length - failed.length, failed: failed.length },
    checks,
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

await main();
