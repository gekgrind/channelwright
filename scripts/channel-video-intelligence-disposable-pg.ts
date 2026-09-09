/**
 * Disposable PostgreSQL runtime gate for the CHANNEL_VIDEO_INTELLIGENCE
 * migration chain.
 *
 * Unlike the persisted gate (which targets shared Supabase), this creates a
 * throwaway database on a disposable PostgreSQL server, installs a minimal
 * Supabase-compatible shim (roles, auth/extensions/storage schemas, pgcrypto,
 * auth.uid/jwt), applies the ENTIRE migration chain from scratch, runtime-proves
 * behaviour that source-text tests cannot (migration execution, pgcrypto
 * resolution, the approved-Portfolio resolver trust boundary and its
 * intelligence-eligibility gate, the single-strategy anchor, the anchor re-hash
 * and supersession check, the bounded cycle projection, multi-cycle start
 * resolution, horizon-scoped concurrency, RLS, immutability including the new
 * VIDEO_INTELLIGENCE coverage, and zero-retrieval/zero-revision accounting), then
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
import { videoIntelligenceInputSchema } from "../src/domain/production-workflows";
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

/**
 * The full pre-Portfolio lineage. Research and Strategy here are the CHANNEL
 * ANCHORS the Intelligence resolver re-hashes and re-checks for supersession.
 */
async function seedLineage(db: pg.Client, ownerId: string) {
  const research = await seedApprovedRun(db, ownerId, "CHANNEL_RESEARCH", { schemaVersion: 1, workflowType: "CHANNEL_RESEARCH" }, "", null);
  const strategy = await seedApprovedRun(db, ownerId, "CHANNEL_STRATEGY", { schemaVersion: 1, workflowType: "CHANNEL_STRATEGY" }, "", null);
  const content = await seedApprovedRun(db, ownerId, "CHANNEL_CONTENT_INTELLIGENCE", { schemaVersion: 1, workflowType: "CHANNEL_CONTENT_INTELLIGENCE" }, "", null);
  const brief = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_BRIEF", { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_BRIEF" }, "", null);
  const script = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_SCRIPT", { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_SCRIPT" }, "", null);
  const packaging = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_PACKAGING", { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_PACKAGING" }, "", null);
  const release = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_RELEASE", { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_RELEASE" }, "", null);
  const performance = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_PERFORMANCE", { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_PERFORMANCE" }, "", null);
  const diagnosis = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_DIAGNOSIS", { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_DIAGNOSIS" }, "", null);
  const decision = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_DECISION", { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_DECISION" }, "", null);
  const experiment = await seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_EXPERIMENT", { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_EXPERIMENT" }, "", null);
  return { research, strategy, content, brief, script, packaging, release, performance, diagnosis, decision, experiment };
}

type Lineage = Awaited<ReturnType<typeof seedLineage>>;

const identity = (workflowType: string, seeded: Seeded) => ({ workflowType, runId: seeded.runId, artifactHash: seeded.artifactHash, schemaVersion: 1 });

/** The eleven-artifact chain Portfolio pins per candidate. Intelligence re-verifies only the two channel anchors inside it. */
function elevenArtifactChain(lineage: Lineage, overrides: { strategy?: Seeded; research?: Seeded } = {}) {
  return [
    identity("CHANNEL_RESEARCH", overrides.research ?? lineage.research),
    identity("CHANNEL_STRATEGY", overrides.strategy ?? lineage.strategy),
    identity("CHANNEL_CONTENT_INTELLIGENCE", lineage.content),
    identity("CHANNEL_VIDEO_BRIEF", lineage.brief),
    identity("CHANNEL_VIDEO_SCRIPT", lineage.script),
    identity("CHANNEL_VIDEO_PACKAGING", lineage.packaging),
    identity("CHANNEL_VIDEO_RELEASE", lineage.release),
    identity("CHANNEL_VIDEO_PERFORMANCE", lineage.performance),
    identity("CHANNEL_VIDEO_DIAGNOSIS", lineage.diagnosis),
    identity("CHANNEL_VIDEO_DECISION", lineage.decision),
    identity("CHANNEL_VIDEO_EXPERIMENT", lineage.experiment),
  ];
}

type PortfolioOptions = Parameters<typeof seedApprovedRun>[6] & {
  portfolioReady?: boolean;
  cycleLabel?: string;
  allocatedAt?: string;
  committedAtRisk?: number;
  committedCount?: number;
  chainOverrides?: { strategy?: Seeded; research?: Seeded };
  secondCandidateChain?: Array<Record<string, unknown>>;
  driftReferences?: boolean;
  driftScope?: boolean;
  shortChain?: boolean;
};

/**
 * A complete approved CHANNEL_VIDEO_PORTFOLIO artifact: everything the
 * Intelligence resolver reads, including the portfolio scope whose per-candidate
 * eleven-artifact chains carry the channel anchors, the allocation items and the
 * constraint candidates the bounded commitment projection joins.
 */
async function seedPortfolio(db: pg.Client, ownerId: string, lineage: Lineage, options: PortfolioOptions = {}) {
  const committedCount = options.committedCount ?? 2;
  const committedAtRisk = options.committedAtRisk ?? 0;
  const experimentRunA = randomUUID();
  const experimentRunB = randomUUID();
  const candidateA = `cand:${experimentRunA}`;
  const candidateB = `cand:${experimentRunB}`;
  const chainA = options.shortChain ? elevenArtifactChain(lineage).slice(0, 10) : elevenArtifactChain(lineage);
  const chainB = options.secondCandidateChain ?? elevenArtifactChain(lineage, options.chainOverrides ?? {});
  const candidate = (candidateId: string, runId: string, category: string, metric: string, mechanism: string, viewerValueState: string) => ({
    candidateId, experimentWorkflowId: randomUUID(), experimentRunId: runId,
    experimentId: "experiment:opening-promise", title: "Opening promise clarity test",
    experimentType: "CONTROLLED_COMPARISON", disposition: "RUN_COMPARISON", measurementOnly: false,
    controlKind: "SIMULTANEOUS_CONTROL", category, unitOfAssignment: "VIDEO", treatmentMechanism: mechanism,
    primaryMetric: metric, primaryMetricDirection: "INCREASE", evidenceStrength: "MODERATE",
    confidenceInDesign: "medium", requiresHumanJudgment: false, experimentReady: true,
    viewerValueState, promiseIntegrityRisk: "NONE", escalationRequired: false,
    evidenceCanChangeShippingDecision: true, decisionId: "decision:opening-promise", decisionType: "INVESTIGATE",
    viewerValueContractHash: "a".repeat(64),
    lineage: { decisionRunId: lineage.decision.runId, diagnosisRunId: lineage.diagnosis.runId, performanceRunId: lineage.performance.runId, releaseRunId: lineage.release.runId, topicId: "topic:decision", pillarId: "pillar:evidence", finalTitle: "What the evidence actually says" },
  });
  const candidates = [
    candidate(candidateA, experimentRunA, "OPENING_PROMISE", "AVERAGE_PERCENTAGE_VIEWED", "PROMISE_FRAMING", committedAtRisk > 0 ? "AT_RISK" : "PRESERVED"),
    candidate(candidateB, experimentRunB, "PACKAGING", "IMPRESSION_CLICK_THROUGH_RATE", "THUMBNAIL_OR_TITLE", "PRESERVED"),
  ];
  const item = (candidateId: string, disposition: string, rank: number | null, basis: string, vvDisposition: string) => ({
    candidateId, disposition, rank, selectionBasis: basis,
    rationale: "The approved decision left this evidence gap open and this is the cheapest interpretable way to close it.",
    viewerValueDisposition: vvDisposition, justifiedByPredictedGrowthAlone: false,
    revisitCondition: disposition === "COMMITTED" ? null : "Revisit once capacity frees up.", citedCandidateIds: [],
  });
  const items = committedCount === 2
    ? [item(candidateA, "COMMITTED", 1, "DECISION_BOUND_EVIDENCE_GAP", committedAtRisk > 0 ? "ESCALATED_FOR_HUMAN_JUDGMENT" : "PRESERVED_NO_ACTION_NEEDED"), item(candidateB, "COMMITTED", 2, "HIGHEST_UNCERTAINTY_REDUCTION", "PRESERVED_NO_ACTION_NEEDED")]
    : [item(candidateA, "COMMITTED", 1, "DECISION_BOUND_EVIDENCE_GAP", committedAtRisk > 0 ? "ESCALATED_FOR_HUMAN_JUDGMENT" : "PRESERVED_NO_ACTION_NEEDED"), item(candidateB, "DEFERRED", null, "CAPACITY_EXHAUSTED", "PRESERVED_NO_ACTION_NEEDED")];
  const actualCommitted = items.filter((entry) => entry.disposition === "COMMITTED").length;
  const portfolioScope = {
    candidates: [
      { candidateId: candidateA, experimentRunId: experimentRunA, artifacts: chainA },
      { candidateId: candidateB, experimentRunId: experimentRunB, artifacts: chainB },
    ],
    facts: [{ key: "fact:cycle", value: options.cycleLabel ?? "cycle", sourceRef: "portfolio:/source/cycleLabel" }],
  };
  const references = candidates.map((entry) => ({ experimentRunId: entry.experimentRunId, portfolioEligible: true }));
  const output = {
    schemaVersion: 1,
    workflowType: "CHANNEL_VIDEO_PORTFOLIO",
    allocatedAt: options.allocatedAt ?? "2026-09-07T10:00:00.000Z",
    source: { cycleLabel: options.cycleLabel ?? "2026 Autumn Cycle", candidateCount: 2, experimentRunIds: [experimentRunA, experimentRunB], subjectIdentity: "portfolio-cycle:autumn" },
    approvedVideoExperimentReferences: options.driftReferences ? [{ experimentRunId: randomUUID(), portfolioEligible: true }] : references,
    portfolioScope: options.driftScope ? { candidates: portfolioScope.candidates, facts: [{ key: "fact:drifted", value: "x", sourceRef: "y" }] } : portfolioScope,
    portfolioConstraints: {
      cycleLabel: options.cycleLabel ?? "2026 Autumn Cycle", concurrentExperimentSlots: 2, candidates,
      citableCandidateIds: [candidateA, candidateB], atRiskCandidateIds: committedAtRisk > 0 ? [candidateA] : [],
      humanJudgmentCandidateIds: [], notReadyCandidateIds: [], confoundCollisionGroups: [],
      globalConfidenceCeiling: "medium", viewerValueEscalationRequired: committedAtRisk > 0,
    },
    content: {
      allocation: {
        id: "portfolio:autumn", cycleLabel: options.cycleLabel ?? "2026 Autumn Cycle",
        objective: "Close the open evidence gaps this cycle can actually interpret.",
        allocationHypothesis: "Committing the two cheapest interpretable tests closes the most decision-bound uncertainty.",
        items, committedCount: actualCommitted, deferredCount: items.length - actualCommitted, excludedCount: 0,
        capacityUtilization: actualCommitted >= 2 ? "AT_CAPACITY" : "UNDER_CAPACITY",
        sequencingNotes: "Run in rank order.", portfolioRisks: [{ risk: "Capacity slips.", mitigation: "Review weekly.", residualRisk: "LOW" }],
        viewerValueGuardrails: ["Stop if satisfaction drops."], reviewTrigger: "Any guardrail breach.",
        knownUnknowns: [], requiresHumanJudgment: committedAtRisk > 0, executionDeferred: true,
      },
      alternatives: [{ id: "alt:one", statement: "Commit only the first.", committedCandidateIds: [candidateA], notSelectedBecause: "LOWER_LEARNING_VALUE", notSelectedReason: "Leaves the second gap open." }],
      viewerValueSafeguards: {
        anyCandidateAtRisk: committedAtRisk > 0,
        committedAtRiskCandidateIds: committedAtRisk > 0 ? [candidateA] : [],
        metricGamingRisk: "Acquisition without satisfaction.", guardedMetricGaming: "Retention primary metric defends it.",
        escalationRequired: committedAtRisk > 0,
      },
      portfolioReady: options.portfolioReady ?? true,
    },
    crossModelReview: { outcome: "AGREED", safeToFinalize: true, findings: [], summary: "Agreed." },
    modelProvenance: [],
  };
  const provenance = {
    artifacts: candidates.map((entry, index) => ({
      reference: references[index],
      candidate: entry,
      artifacts: index === 0 ? chainA : chainB,
    })),
    portfolioScope,
  };
  return seedApprovedRun(db, ownerId, "CHANNEL_VIDEO_PORTFOLIO", output, "validate-approved-experiments", provenance, {
    ...options,
    finalizerStep: options.finalizerStep ?? "finalize-video-portfolio",
    finalQaStep: options.finalQaStep ?? "final-video-portfolio-qa",
  });
}

const intelligenceObjective = "Synthesize two to four exact approved, intelligence-eligible CHANNEL_VIDEO_PORTFOLIO allocation records sharing one anchored CHANNEL_STRATEGY into a single independently critiqued, human-approved channel learning record and strategy review signal without authoring strategy, allocating capacity, or executing anything";
const intelligenceSteps = [
  { key: "validate-approved-portfolios", position: 0, kind: "WORKER", capability: "approved-portfolio-validation", dependsOn: [], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "derive-intelligence-constraints", position: 1, kind: "WORKER", capability: "deterministic-intelligence-constraints", dependsOn: ["validate-approved-portfolios"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "draft-video-intelligence", position: 2, kind: "WORKER", capability: "video-intelligence-synthesis", dependsOn: ["derive-intelligence-constraints"], maxAttempts: 2, retryBaseSeconds: 10 },
  { key: "critique-video-intelligence", position: 3, kind: "WORKER", capability: "independent-video-intelligence-critique", dependsOn: ["draft-video-intelligence"], maxAttempts: 2, retryBaseSeconds: 10 },
  { key: "final-video-intelligence-qa", position: 4, kind: "WORKER", capability: "deterministic-video-intelligence-qa", dependsOn: ["critique-video-intelligence"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "finalize-video-intelligence", position: 5, kind: "WORKER", capability: "video-intelligence-finalizer", dependsOn: ["final-video-intelligence-qa"], maxAttempts: 1, retryBaseSeconds: 0 },
  { key: "review-video-intelligence", position: 6, kind: "APPROVAL", capability: "human", dependsOn: ["finalize-video-intelligence"], maxAttempts: 1, retryBaseSeconds: 0 },
];

async function startIntelligence(db: pg.Client, ownerId: string, input: Record<string, unknown>, idempotencyKey: string) {
  return asAuthenticated(db, ownerId, () => db.query<{ result: Record<string, unknown> }>(
    "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_INTELLIGENCE',1,$3,$4::jsonb,$5::jsonb) as result",
    [idempotencyKey, sha256(idempotencyKey), intelligenceObjective, JSON.stringify(input), JSON.stringify(intelligenceSteps)],
  ));
}

const selectionsOf = (...portfolios: Seeded[]) => portfolios.map((entry) => ({ portfolioWorkflowId: entry.workflowId, portfolioRunId: entry.runId }));
const intelligenceInput = (horizonLabel: string, portfolios: Seeded[], extra: Record<string, unknown> = {}) => ({ horizonLabel, portfolioSelections: selectionsOf(...portfolios), ...extra });

async function runChecks(db: pg.Client) {
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const digest = await db.query<{ h: string }>("select encode(extensions.digest('x','sha256'),'hex') as h");
  record("pgcrypto extensions.digest resolves at runtime", digest.rows[0].h === sha256("x"));

  const fns = await db.query<{ count: string }>("select count(*)::text as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='channelwright' and p.proname in ('resolve_approved_research_artifact','resolve_approved_strategy_artifact','resolve_approved_content_artifact','resolve_approved_video_brief_artifact','resolve_approved_video_script_artifact','resolve_approved_video_packaging_artifact','resolve_approved_video_release_artifact','resolve_approved_video_performance_artifact','resolve_approved_video_diagnosis_artifact','resolve_approved_video_decision_artifact','resolve_approved_video_experiment_artifact','resolve_approved_video_portfolio_artifact')");
  record("all twelve approved-artifact resolvers compiled", fns.rows[0].count === "12", `count=${fns.rows[0].count}`);

  const canonicalProbe = { z: [3, { b: true, a: "x" }], a: 1 };
  const canon = await db.query<{ c: string }>("select channelwright.canonical_jsonb_text($1::jsonb) as c", [JSON.stringify(canonicalProbe)]);
  record("canonical_jsonb_text parity with application", canon.rows[0].c === canonicalJson(canonicalProbe));

  const lineage = await seedLineage(db, ownerA);
  const seed = (options: PortfolioOptions = {}) => seedPortfolio(db, ownerA, lineage, options);
  const portfolioOne = await seed({ cycleLabel: "2026 Spring Cycle", allocatedAt: "2026-03-01T10:00:00.000Z" });

  const resolvePortfolio = (target: Seeded, owner = ownerA) => asAuthenticated(db, owner, () => db.query<{
    result: { reference: Record<string, unknown>; cycle: Record<string, unknown>; artifacts: unknown[] };
  }>("select channelwright.resolve_approved_video_portfolio_artifact($1,$2) as result", [target.workflowId, target.runId]));

  const resolved = (await resolvePortfolio(portfolioOne)).rows[0].result;
  record("approved Portfolio resolver executes for the owner", resolved.reference.portfolioRunId === portfolioOne.runId);
  record("resolver returns portfolioReady: true as the intelligence-eligibility gate", resolved.reference.portfolioReady === true);
  const strategyAnchor = resolved.reference.strategyAnchor as Record<string, string>;
  const researchAnchor = resolved.reference.researchAnchor as Record<string, string>;
  record("resolver returns FLAT channel anchors, not a nested reference chain",
    Object.keys(resolved.reference).every((key) => key !== "upstreamVideoExperiment")
    && strategyAnchor.strategyRunId === lineage.strategy.runId && strategyAnchor.strategyArtifactHash === lineage.strategy.artifactHash
    && researchAnchor.researchRunId === lineage.research.runId && researchAnchor.researchArtifactHash === lineage.research.artifactHash);
  record("compact intelligence lineage contains exactly three authoritative artifacts", resolved.artifacts.length === 3);
  record("cycle id is server-derived from the portfolio run", resolved.cycle.cycleId === `cycle:${portfolioOne.runId}`);
  record("cycle projection lifts the closed-vocabulary allocation facts", [
    ["cycleLabel", "2026 Spring Cycle"], ["capacityUtilization", "AT_CAPACITY"], ["globalConfidenceCeiling", "medium"],
  ].every(([key, value]) => resolved.cycle[key] === value)
    && resolved.cycle.committedCount === 2 && resolved.cycle.deferredCount === 0 && resolved.cycle.excludedCount === 0
    && resolved.cycle.candidateCount === 2 && resolved.cycle.concurrentExperimentSlots === 2
    && resolved.cycle.requiresHumanJudgment === false && resolved.cycle.anyCandidateAtRisk === false
    && resolved.cycle.committedAtRiskCount === 0 && resolved.cycle.strategyRunId === lineage.strategy.runId,
    JSON.stringify({ committed: resolved.cycle.committedCount, capacity: resolved.cycle.capacityUtilization }));
  const commitments = resolved.cycle.commitments as Array<Record<string, unknown>>;
  record("commitment projection carries closed-vocabulary classification for every committed item",
    commitments.length === 2
    && commitments[0].category === "OPENING_PROMISE" && commitments[0].primaryMetric === "AVERAGE_PERCENTAGE_VIEWED"
    && commitments[0].treatmentMechanism === "PROMISE_FRAMING" && commitments[0].selectionBasis === "DECISION_BOUND_EVIDENCE_GAP"
    && commitments[1].category === "PACKAGING" && commitments[1].primaryMetric === "IMPRESSION_CLICK_THROUGH_RATE"
    && commitments.every((entry) => entry.pillarId === "pillar:evidence" && entry.decisionType === "INVESTIGATE"),
    JSON.stringify(commitments[0] ?? {}).slice(0, 200));
  const commitmentKeys = commitments.length ? Object.keys(commitments[0]) : [];
  record("cycle projection exposes no allocation prose at all",
    !Object.keys(resolved.cycle).some((key) => ["objective", "allocationHypothesis", "sequencingNotes", "portfolioRisks", "viewerValueGuardrails", "alternatives", "reviewTrigger", "items"].includes(key))
    && !commitmentKeys.some((key) => ["rationale", "revisitCondition", "title", "hypothesis"].includes(key)),
    commitmentKeys.join(","));
  const referenceBytes = Buffer.byteLength(JSON.stringify(resolved), "utf8");
  record("one resolved cycle stays small enough that four fit inside the 64 KiB step-output ceiling",
    referenceBytes * 4 < 65_536, `${referenceBytes} bytes x4 = ${referenceBytes * 4}`);

  const rpc = "select channelwright.resolve_approved_video_portfolio_artifact($1,$2)";
  record("cross-owner approved Portfolio resolution is NOT_FOUND", (await expectFailure(db, ownerB, rpc, [portfolioOne.workflowId, portfolioOne.runId])).includes("NOT_FOUND"));
  const notReady = await seed({ portfolioReady: false });
  record("an unready Portfolio allocation is rejected", (await expectFailure(db, ownerA, rpc, [notReady.workflowId, notReady.runId])).includes("UPSTREAM_PORTFOLIO_NOT_INTELLIGENCE_ELIGIBLE"));
  const unapproved = await seed({ approve: false });
  record("unapproved Portfolio is rejected", (await expectFailure(db, ownerA, rpc, [unapproved.workflowId, unapproved.runId])).includes("UPSTREAM_PORTFOLIO_NOT_APPROVED"));
  const rejectedQa = await seed({ qaPassed: false });
  record("rejected Portfolio final QA is rejected", (await expectFailure(db, ownerA, rpc, [rejectedQa.workflowId, rejectedQa.runId])).includes("UPSTREAM_PORTFOLIO_QA_INVALID"));
  const wrongFinalizer = await seed({ finalizerOutput: { schemaVersion: 1, wrong: true } });
  record("Portfolio finalizer disagreement is rejected", (await expectFailure(db, ownerA, rpc, [wrongFinalizer.workflowId, wrongFinalizer.runId])).includes("UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH"));
  const corruptArtifact = await seed({ corruptHash: true });
  record("altered Portfolio artifact hash is rejected", (await expectFailure(db, ownerA, rpc, [corruptArtifact.workflowId, corruptArtifact.runId])).includes("UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH"));
  const corruptProvenance = await seed({ corruptProvenance: true });
  record("altered Portfolio provenance hash is rejected", (await expectFailure(db, ownerA, rpc, [corruptProvenance.workflowId, corruptProvenance.runId])).includes("UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH"));
  const driftedRefs = await seed({ driftReferences: true });
  record("nested Experiment reference drift is rejected", (await expectFailure(db, ownerA, rpc, [driftedRefs.workflowId, driftedRefs.runId])).includes("UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH"));
  const driftedScope = await seed({ driftScope: true });
  record("portfolio scope drift between finalized output and provenance is rejected", (await expectFailure(db, ownerA, rpc, [driftedScope.workflowId, driftedScope.runId])).includes("UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH"));
  const superseded = await seed({ current: false });
  record("superseded Portfolio is rejected", (await expectFailure(db, ownerA, rpc, [superseded.workflowId, superseded.runId])).includes("UPSTREAM_PORTFOLIO_SUPERSEDED"));
  const badParent = await seed({ context: { previousRunId: randomUUID() } });
  record("Portfolio parent/root lineage drift is rejected", (await expectFailure(db, ownerA, rpc, [badParent.workflowId, badParent.runId])).includes("UPSTREAM_PORTFOLIO_LINEAGE_INVALID"));
  const shortChain = await seed({ shortChain: true });
  record("a portfolio candidate short of its eleven-artifact chain is rejected", (await expectFailure(db, ownerA, rpc, [shortChain.workflowId, shortChain.runId])).includes("eleven-artifact chain"));

  // The single-strategy anchor, enforced INSIDE one allocation: a portfolio whose
  // candidates descend from two different approved strategies is not one channel.
  const otherLineage = await seedLineage(db, ownerA);
  const splitAnchor = await seed({ chainOverrides: { strategy: otherLineage.strategy } });
  record("an allocation spanning two approved strategies is rejected", (await expectFailure(db, ownerA, rpc, [splitAnchor.workflowId, splitAnchor.runId])).includes("UPSTREAM_PORTFOLIO_STRATEGY_ANCHOR_MISMATCH"));

  // The resolved lineage root must belong to THIS EXACT Portfolio workflow.
  const rootProbe = await seed();
  const foreignPortfolioRun = await seed();
  await db.query("insert into channelwright.research_run_budgets(workflow_run_id,owner_id,workflow_id,parent_run_id,root_run_id,limits) values ($1,$2,$3,null,$4,'{}'::jsonb)", [rootProbe.runId, ownerA, rootProbe.workflowId, rootProbe.runId]);
  record("valid same-workflow lineage root still resolves", (await expectFailure(db, ownerA, rpc, [rootProbe.workflowId, rootProbe.runId])) === "");
  await db.query("update channelwright.research_run_budgets set root_run_id=$2 where workflow_run_id=$1", [rootProbe.runId, foreignPortfolioRun.runId]);
  const foreignRootMsg = await expectFailure(db, ownerA, rpc, [rootProbe.workflowId, rootProbe.runId]);
  record("same-owner root from a different Portfolio workflow is rejected",
    foreignRootMsg.includes("UPSTREAM_PORTFOLIO_LINEAGE_INVALID") && foreignRootMsg.includes("resolved root is not a real run of this workflow"),
    foreignRootMsg.split("\n")[0].slice(0, 160));

  // A structurally superseded channel anchor must be rejected even though the
  // Portfolio's frozen projection still hash-matches it. This is the check that
  // stops a stale strategy from silently anchoring a strategy review signal.
  const supLineage = await seedLineage(db, ownerA);
  const supPortfolio = await seedPortfolio(db, ownerA, supLineage, { cycleLabel: "Superseded probe" });
  record("anchor-supersession fixture resolves clean before tampering", (await expectFailure(db, ownerA, rpc, [supPortfolio.workflowId, supPortfolio.runId])) === "");
  const supStrategySuccessor = randomUUID();
  await db.query(`insert into channelwright.workflow_runs(id,owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload,context_payload,output_payload,completed_at)
    values ($1,$2,$3,'CHANNEL_STRATEGY',1,'COMPLETED',$4,$5,'{}'::jsonb,$6::jsonb,$7::jsonb,now())`,
    [supStrategySuccessor, ownerA, supLineage.strategy.workflowId, `sup:${supStrategySuccessor}`, "0".repeat(64), JSON.stringify({ previousRunId: supLineage.strategy.runId }), JSON.stringify({ schemaVersion: 1, workflowType: "CHANNEL_STRATEGY", superseded: true })]);
  await db.query("update channelwright.workflows set current_run_id=$2 where id=$1", [supLineage.strategy.workflowId, supStrategySuccessor]);
  const supMsg = await expectFailure(db, ownerA, rpc, [supPortfolio.workflowId, supPortfolio.runId]);
  record("superseded Strategy anchor is rejected", supMsg.includes("UPSTREAM_PORTFOLIO_LINEAGE_INVALID") && supMsg.includes("superseded"), supMsg.split("\n")[0].slice(0, 160));

  const rls = await db.query<{ enabled: boolean }>("select bool_and(c.relrowsecurity) as enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='channelwright' and c.relkind='r' and c.relname in ('workflows','workflow_runs','workflow_steps','workflow_approvals','research_run_budgets','research_usage_operations')");
  record("RLS enabled on every workflow table", rls.rows[0].enabled === true);
  const isolated = await asAuthenticated(db, ownerB, () => db.query<{ count: string }>("select count(*)::text as count from channelwright.workflow_runs where id=$1", [portfolioOne.runId]));
  record("RLS hides another owner's Portfolio run", isolated.rows[0].count === "0");

  // --- Multi-cycle start ----------------------------------------------------
  const portfolioTwo = await seed({ cycleLabel: "2026 Summer Cycle", allocatedAt: "2026-06-01T10:00:00.000Z", committedCount: 1 });
  const horizon = "2026 Learning Horizon";
  const startKey = `intelligence:${randomUUID()}`;
  const started = await startIntelligence(db, ownerA, intelligenceInput(horizon, [portfolioOne, portfolioTwo]), startKey);
  const startedIds = started.rows[0].result as { workflowId: string; runId: string; idempotentReplay: boolean };
  const persisted = await db.query<{ input_payload: Record<string, unknown> }>("select input_payload from channelwright.workflow_runs where id=$1", [startedIds.runId]);
  const refs = persisted.rows[0].input_payload.approvedVideoPortfolioReferences as Array<{ portfolioRunId: string; portfolioReady: boolean }>;
  record("Intelligence start resolves and persists one server-resolved reference per selection, in order",
    Array.isArray(refs) && refs.length === 2 && refs[0].portfolioRunId === portfolioOne.runId && refs[1].portfolioRunId === portfolioTwo.runId && refs.every((ref) => ref.portfolioReady === true));
  record("Intelligence start normalises the horizon key for concurrency", persisted.rows[0].input_payload.intelligenceHorizonKey === horizon.toLowerCase());
  record("Intelligence start accepts no caller artifact body", !("cycle" in persisted.rows[0].input_payload) && !("intelligenceScope" in persisted.rows[0].input_payload));
  // The mandatory runtime crossing: the row start_workflow actually persisted must
  // parse cleanly through the STRICT executor-side schema claim_workflow_step
  // hands the worker. Simulated schema tests are not enough; Portfolio proved that.
  const executorParse = videoIntelligenceInputSchema.safeParse(persisted.rows[0].input_payload);
  record("persisted Intelligence input parses through the executor-side schema (SQL <-> TypeScript contract)",
    executorParse.success, executorParse.success ? "" : JSON.stringify(executorParse.error.issues[0]));
  const replay = await startIntelligence(db, ownerA, intelligenceInput(horizon, [portfolioOne, portfolioTwo]), startKey);
  record("Intelligence start is idempotent", replay.rows[0].result.runId === startedIds.runId && replay.rows[0].result.idempotentReplay === true);

  const startFailure = (label: string, input: Record<string, unknown>) => expectFailure(db, ownerA, "select channelwright.start_workflow($1,$2,'CHANNEL_VIDEO_INTELLIGENCE',1,$3,$4::jsonb,$5::jsonb)",
    [`${label}:${randomUUID()}`, sha256(label), intelligenceObjective, JSON.stringify(input), JSON.stringify(intelligenceSteps)]);

  record("Intelligence start rejects caller-supplied artifact content",
    (await startFailure("strict", intelligenceInput(`strict ${randomUUID()}`, [portfolioOne, portfolioTwo], { approvedVideoPortfolioReferences: [{ forged: true }] }))).includes("VALIDATION_ERROR"));
  record("Intelligence start rejects a caller-supplied horizon key",
    (await startFailure("key", intelligenceInput(`key ${randomUUID()}`, [portfolioOne, portfolioTwo], { intelligenceHorizonKey: "forged" }))).includes("VALIDATION_ERROR"));
  record("Intelligence start rejects the same Portfolio selected twice",
    (await startFailure("dup", intelligenceInput(`dup ${randomUUID()}`, [portfolioOne, portfolioOne]))).includes("the same portfolio run cannot be selected twice"));
  record("Intelligence start rejects a single-cycle horizon", (await startFailure("one", intelligenceInput(`one ${randomUUID()}`, [portfolioOne]))).includes("VALIDATION_ERROR"));
  const portfolioThree = await seed({ cycleLabel: "2026 Winter Cycle", allocatedAt: "2026-12-01T10:00:00.000Z" });
  const portfolioFour = await seed({ cycleLabel: "2027 Spring Cycle", allocatedAt: "2027-03-01T10:00:00.000Z" });
  const portfolioFive = await seed({ cycleLabel: "2027 Summer Cycle", allocatedAt: "2027-06-01T10:00:00.000Z" });
  record("Intelligence start rejects a horizon beyond four cycles",
    (await startFailure("five", intelligenceInput(`five ${randomUUID()}`, [portfolioOne, portfolioTwo, portfolioThree, portfolioFour, portfolioFive]))).includes("VALIDATION_ERROR"));
  record("one unready allocation fails the whole Intelligence start, pre-spend",
    (await startFailure("unready", intelligenceInput(`unready ${randomUUID()}`, [portfolioOne, notReady]))).includes("UPSTREAM_PORTFOLIO_NOT_INTELLIGENCE_ELIGIBLE"));

  // The channel identity gate ACROSS selections: two allocations that are each
  // internally consistent but anchored to different strategies cannot form one
  // channel learning record.
  const otherChannelPortfolioA = await seedPortfolio(db, ownerA, otherLineage, { cycleLabel: "Other channel A" });
  record("selections anchored to different strategies fail the whole start",
    (await startFailure("anchor", intelligenceInput(`anchor ${randomUUID()}`, [portfolioOne, otherChannelPortfolioA]))).includes("UPSTREAM_PORTFOLIO_STRATEGY_ANCHOR_MISMATCH"));

  record("active Intelligence uniqueness is enforced per horizon, case-insensitively",
    (await startFailure("active", intelligenceInput(horizon.toUpperCase(), [portfolioOne, portfolioTwo]))).includes("VIDEO_INTELLIGENCE_LIMIT_REACHED"));
  const otherHorizonOk = await startFailure("other", intelligenceInput("2027 Learning Horizon", [portfolioOne, portfolioTwo]));
  record("a different horizon may synthesize concurrently", otherHorizonOk === "", otherHorizonOk.split("\n")[0].slice(0, 160));
  let uniqueBlocked = false;
  try {
    await db.query(`insert into channelwright.workflow_runs(id,owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload) values ($1,$2,$3,'CHANNEL_VIDEO_INTELLIGENCE',1,'QUEUED',$4,$5,$6::jsonb)`,
      [randomUUID(), ownerA, startedIds.workflowId, `race:${randomUUID()}`, "1".repeat(64), JSON.stringify({ intelligenceHorizonKey: horizon.toLowerCase() })]);
  } catch { uniqueBlocked = true; }
  record("concurrent Intelligence insertion for one horizon is blocked by database uniqueness", uniqueBlocked);

  const limits = (overrides: Record<string, number> = {}) => JSON.stringify({ providerRequests: 0, providerQuotaUnits: 0, searches: 0, synthesisCalls: 2, qaCalls: 2, revisionCalls: 0, inputTokens: 100000, outputTokens: 20000, totalTokens: 120000, automatedRevisions: 0, ...overrides });
  const budget = (overrides: Record<string, number> = {}) => expectFailure(db, null, "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [startedIds.runId, randomUUID(), randomUUID(), "intelligence", limits(overrides)]);
  const withinCeiling = await budget();
  record("Intelligence accounting ceilings allow exactly four structural model attempts and no revision", withinCeiling.includes("LEASE_NOT_ACTIVE") && !withinCeiling.includes("VALIDATION_ERROR"), withinCeiling.split("\n")[0].slice(0, 160));
  record("Intelligence accounting rejects a fifth structural model attempt", (await budget({ synthesisCalls: 3 })).includes("VALIDATION_ERROR"));
  record("Intelligence accounting rejects automated revision budget", (await budget({ revisionCalls: 1 })).includes("VALIDATION_ERROR"));
  record("Intelligence accounting rejects any external retrieval budget", (await budget({ searches: 1 })).includes("VALIDATION_ERROR"));

  const intelligenceOutput = { schemaVersion: 1, workflowType: "CHANNEL_VIDEO_INTELLIGENCE", source: { horizonLabel: horizon, cycleCount: 2 } };
  const approvedIntelligence = await seedApprovedRun(db, ownerA, "CHANNEL_VIDEO_INTELLIGENCE", intelligenceOutput, "validate-approved-portfolios", { artifacts: [{ reference: resolved.reference }] }, { finalizerStep: "finalize-video-intelligence", finalQaStep: "final-video-intelligence-qa" });
  record("human-approved Intelligence output is durable", (await db.query<{ count: string }>("select count(*)::text as count from channelwright.workflow_approvals where workflow_run_id=$1 and status='APPROVED' and decided_by=$2", [approvedIntelligence.runId, ownerA])).rows[0].count === "1");
  record("approved Intelligence output is immutable", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload=output_payload||'{\"x\":1}'::jsonb where id=$1", [approvedIntelligence.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  record("approved Intelligence finalizer output is immutable", (await expectFailure(db, null, "update channelwright.workflow_steps set output_payload=output_payload||'{\"x\":1}'::jsonb where workflow_run_id=$1 and step_key='finalize-video-intelligence'", [approvedIntelligence.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  record("approved Portfolio output remains immutable (no regression from Intelligence's migration)", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload=output_payload||'{\"x\":1}'::jsonb where id=$1", [portfolioOne.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  record("approved Strategy output remains immutable (no regression from Intelligence's migration)", (await expectFailure(db, null, "update channelwright.workflow_runs set output_payload=output_payload||'{\"x\":1}'::jsonb where id=$1", [lineage.strategy.runId])).includes("APPROVED_ARTIFACT_IMMUTABLE"));
  const approvalDef = await db.query<{ source: string }>("select pg_get_functiondef(p.oid) as source from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='channelwright' and p.proname='decide_workflow_approval'");
  record("human revision wiring creates immutable Intelligence successor lineage", approvalDef.rows[0].source.includes("CHANNEL_VIDEO_INTELLIGENCE") && approvalDef.rows[0].source.includes("validate-approved-portfolios") && approvalDef.rows[0].source.includes("previousRunId"));

  // Existing verticals must still start after this migration recreated the shared
  // start_workflow / complete_workflow_step / approval / accounting functions.
  const portfolioRegression = await expectFailure(db, ownerA, "select channelwright.start_workflow($1,$2,'CHANNEL_RESEARCH',1,$3,$4::jsonb,$5::jsonb)",
    [`research:${randomUUID()}`, sha256("research"), "unexpected objective", JSON.stringify({ channelIdea: "x" }), JSON.stringify([])]);
  record("existing workflow types still validate their canonical definition (no start_workflow regression)", portfolioRegression.includes("VALIDATION_ERROR") || portfolioRegression.includes("WORKFLOW_TYPE_INVALID"), portfolioRegression.split("\n")[0].slice(0, 160));

  await db.query("update channelwright.workflow_runs set status='COMPLETED' where id=$1", [startedIds.runId]);
  await db.query("update channelwright.workflows set status='COMPLETED' where id=$1", [startedIds.workflowId]);
  const sequential = await startFailure("sequential", intelligenceInput(horizon, [portfolioOne, portfolioTwo]));
  record("a sequential Intelligence run for the same horizon after completion is allowed", sequential === "", sequential.split("\n")[0].slice(0, 160));
}

const APP_ROLES = ["authenticated", "service_role", "anon"] as const;

async function main() {
  if (!CONNECTION) {
    console.log(JSON.stringify({ gate: "VIDEO_INTELLIGENCE_DISPOSABLE_PG_UNAVAILABLE", reason: "CHANNELWRIGHT_DISPOSABLE_DATABASE_URL is not set", hint: "Set CHANNELWRIGHT_DISPOSABLE_DATABASE_URL to a throwaway PostgreSQL cluster (never the application database)." }, null, 2));
    process.exitCode = 2;
    return;
  }
  const connection = CONNECTION;
  const admin = new pg.Client({ connectionString: connection, application_name: "cw-disposable-pg-probe" });
  try { await admin.connect(); }
  catch (error) {
    console.log(JSON.stringify({ gate: "VIDEO_INTELLIGENCE_DISPOSABLE_PG_UNAVAILABLE", reason: error instanceof Error ? error.message.split("\n")[0] : String(error), hint: "Set CHANNELWRIGHT_DISPOSABLE_DATABASE_URL to a reachable throwaway PostgreSQL cluster." }, null, 2));
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
    gate: failed.length === 0 ? "VIDEO_INTELLIGENCE_DISPOSABLE_PG_PASSED" : "VIDEO_INTELLIGENCE_DISPOSABLE_PG_FAILED",
    database: connection.replace(/\/\/[^@]*@/, "//***@"),
    counts: { passed: checks.length - failed.length, failed: failed.length },
    checks,
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

await main();
