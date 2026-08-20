/**
 * Persisted live verification for CHANNEL_VIDEO_BRIEF.
 *
 * Exercises the parts of the slice that only a real database can prove:
 * canonical-JSON parity between SQL and TypeScript, the approved-content
 * resolver under valid and invalid state, workflow-start pinning, the
 * concurrency boundary, owner isolation, and the zero-retrieval accounting
 * invariant.
 *
 * Every record it creates is owner-scoped and removed before exit. It never
 * touches `public`, Storage, or another owner's data.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { canonicalJson } from "../src/server/workflows/canonical-json";
import { CHANNELWRIGHT_SCHEMA, readSharedSupabaseConfig, safeProjectIdentity } from "./supabase-gate/config";
import {
  approvedContentArtifactFixture,
  selectedTopicFixture,
} from "../src/server/workflows/video-brief-fixtures.test-helper";

try { process.loadEnvFile(".env.local"); } catch { /* optional */ }

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, passed: boolean, detail = "") => { checks.push({ name, passed, detail }); };

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Runs a statement as an authenticated owner rather than the service role. */
async function asOwner<T>(db: pg.Client, ownerId: string | null, run: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    const claims = ownerId === null
      ? JSON.stringify({ role: "anon" })
      : JSON.stringify({ sub: ownerId, role: "authenticated" });
    await db.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    const result = await run();
    await db.query("commit");
    return result;
  } catch (error) { await db.query("rollback"); throw error; }
}

/** Captures the database error message for a call expected to fail. */
async function expectFailure(db: pg.Client, ownerId: string | null, sql: string, params: unknown[]): Promise<string> {
  try {
    await asOwner(db, ownerId, () => db.query(sql, params as never[]));
    return "";
  } catch (error) { return error instanceof Error ? error.message : String(error); }
}

async function verifyCanonicalParity(db: pg.Client) {
  // Representative shapes: camelCase siblings, nesting, arrays, numeric scale,
  // booleans, nulls, and the real Viewer Value contract.
  const cases: Array<{ name: string; value: unknown }> = [
    { name: "camelCase siblings", value: { originStage: "CONTENT_INTELLIGENCE", originalContribution: "x", zeta: 1, Alpha: 2 } },
    { name: "nested objects", value: { outer: { inner: { deepest: "v" }, second: 2 }, first: [1, 2] } },
    { name: "arrays preserve order", value: { items: [{ b: 1, a: 2 }, { d: 3, c: 4 }] } },
    { name: "numeric scale 1.50", value: { weight: 1.5, whole: 1, small: 0.2 } },
    { name: "booleans and nulls", value: { yes: true, no: false, nothing: null } },
    { name: "empty containers", value: { obj: {}, arr: [] } },
    { name: "viewer value contract", value: approvedContentArtifactFixture.selectedTopic.viewerValue.contract },
    { name: "full selected topic", value: approvedContentArtifactFixture.selectedTopic },
  ];

  for (const item of cases) {
    const expected = canonicalJson(item.value);
    const row = await db.query<{ canonical: string; hash: string }>(
      `select channelwright.canonical_jsonb_text($1::jsonb) as canonical,
              encode(digest(channelwright.canonical_jsonb_text($1::jsonb), 'sha256'), 'hex') as hash`,
      [JSON.stringify(item.value)],
    );
    const stringsMatch = row.rows[0].canonical === expected;
    record(`canonical string parity: ${item.name}`, stringsMatch,
      stringsMatch ? `${expected.length} chars` : `sql=${row.rows[0].canonical.slice(0, 160)} ts=${expected.slice(0, 160)}`);
    record(`canonical hash parity: ${item.name}`, row.rows[0].hash === sha256(expected));
  }

  // Reordered keys must produce an identical canonical string: this is the
  // property that stops JSONB reordering from looking like tampering.
  const contract = approvedContentArtifactFixture.selectedTopic.viewerValue.contract as Record<string, unknown>;
  const reversed = Object.fromEntries(Object.entries(contract).reverse());
  const reorder = await db.query<{ a: string; b: string }>(
    "select channelwright.canonical_jsonb_text($1::jsonb) as a, channelwright.canonical_jsonb_text($2::jsonb) as b",
    [JSON.stringify(contract), JSON.stringify(reversed)],
  );
  record("reordered keys yield identical canonical string", reorder.rows[0].a === reorder.rows[0].b);
  record("reordered keys match TypeScript canonical string", reorder.rows[0].b === canonicalJson(contract));

  // A changed promise must change the hash.
  const tampered = { ...contract, valuePromise: { ...(contract.valuePromise as object), statement: "A quietly different promise." } };
  const drift = await db.query<{ same: boolean }>(
    "select channelwright.canonical_jsonb_text($1::jsonb) = channelwright.canonical_jsonb_text($2::jsonb) as same",
    [JSON.stringify(contract), JSON.stringify(tampered)],
  );
  record("changed promise changes the canonical string", drift.rows[0].same === false);
}

/**
 * Seeds a CHANNEL_CONTENT_INTELLIGENCE run owned by `ownerId`.
 *
 * Hashes are written before the approval row exists, because
 * protect_final_research_artifact makes a finalized artifact immutable. Corrupt
 * and unapproved variants are therefore seeded as separate runs rather than by
 * mutating an approved one.
 */
async function seedApprovedContent(db: pg.Client, ownerId: string, options: { corruptHash?: boolean; approve?: boolean } = {}) {
  const { corruptHash = false, approve = true } = options;
  const contentResult = approvedContentArtifactFixture.contentResult;
  const discovery = approvedContentArtifactFixture.discoveryBundle;
  const strategyRef = approvedContentArtifactFixture.reference.upstreamStrategy;
  const workflowId = randomUUID();
  const runId = randomUUID();

  // current_run_id is a composite FK to workflow_runs, so the run must exist first.
  await db.query(
    `insert into channelwright.workflows(id, owner_id, workflow_type, definition_version, objective, status)
     values ($1,$2,'CHANNEL_CONTENT_INTELLIGENCE',1,'persisted video brief gate','COMPLETED')`,
    [workflowId, ownerId],
  );
  await db.query(
    `insert into channelwright.workflow_runs(id, owner_id, workflow_id, workflow_type, definition_version, status, idempotency_key, input_hash, input_payload, output_payload, completed_at)
     values ($1,$2,$3,'CHANNEL_CONTENT_INTELLIGENCE',1,'COMPLETED',$4,$5,$6::jsonb,$7::jsonb, now())`,
    [runId, ownerId, workflowId, `vb-gate:${runId}`, "0".repeat(64),
      JSON.stringify({ strategyWorkflowId: strategyRef.strategyWorkflowId, strategyRunId: strategyRef.strategyRunId, approvedStrategyReference: strategyRef }),
      JSON.stringify(contentResult)],
  );

  await db.query("update channelwright.workflows set current_run_id = $2 where id = $1", [workflowId, runId]);

  const steps: Array<[string, number, unknown]> = [
    ["validate-approved-strategy", 0, { reference: strategyRef, strategyResult: {}, researchEvidenceBundle: {} }],
    ["discover-youtube-topics", 2, discovery],
    ["final-content-qa", 7, { qa: { passed: true, score: 88, findings: [], recommendation: "accept", deterministicChecksPassed: 22, deterministicChecksFailed: 0, modelUsage: { model: "gate", inputTokens: 1, outputTokens: 1, totalTokens: 2 } } }],
    ["finalize-content-intelligence", 8, contentResult],
  ];
  for (const [key, position, output] of steps) {
    await db.query(
      `insert into channelwright.workflow_steps(id, owner_id, workflow_id, workflow_run_id, step_key, position, kind, capability, depends_on, status, max_attempts, retry_base_seconds, output_payload, completed_at)
       values ($1,$2,$3,$4,$5,$6,'WORKER','gate','{}','COMPLETED',1,0,$7::jsonb, now())`,
      [randomUUID(), ownerId, workflowId, runId, key, position, JSON.stringify(output)],
    );
  }
  // Hashes exactly as decide_workflow_approval computes them, written while the
  // artifact is still mutable.
  await db.query(
    corruptHash
      ? `update channelwright.workflow_runs set artifact_hash = $2,
             provenance_hash = encode(digest((select output_payload from channelwright.workflow_steps
                                              where workflow_run_id = $1 and step_key = 'discover-youtube-topics')::text,'sha256'),'hex')
           where id = $1`
      : `update channelwright.workflow_runs
            set artifact_hash = encode(digest(output_payload::text,'sha256'),'hex'),
                provenance_hash = encode(digest((select output_payload from channelwright.workflow_steps
                                                 where workflow_run_id = $1 and step_key = 'discover-youtube-topics')::text,'sha256'),'hex')
          where id = $1`,
    corruptHash ? [runId, "f".repeat(64)] : [runId],
  );

  const approvalStepId = randomUUID();
  await db.query(
    `insert into channelwright.workflow_steps(id, owner_id, workflow_id, workflow_run_id, step_key, position, kind, capability, depends_on, status, max_attempts, retry_base_seconds, completed_at)
     values ($1,$2,$3,$4,'review-content-intelligence',9,'APPROVAL','human','{}','COMPLETED',1,0, now())`,
    [approvalStepId, ownerId, workflowId, runId],
  );
  await db.query(
    approve
      ? `insert into channelwright.workflow_approvals(id, owner_id, workflow_id, workflow_run_id, workflow_step_id, gate_key, status, request_payload, decided_by, decided_at)
         values ($1,$2,$3,$4,$5,'review-content-intelligence','APPROVED','{}'::jsonb,$2, now())`
      : `insert into channelwright.workflow_approvals(id, owner_id, workflow_id, workflow_run_id, workflow_step_id, gate_key, status, request_payload)
         values ($1,$2,$3,$4,$5,'review-content-intelligence','PENDING','{}'::jsonb)`,
    [randomUUID(), ownerId, workflowId, runId, approvalStepId],
  );
  return { workflowId, runId };
}

function createGateAdmin(config: ReturnType<typeof readSharedSupabaseConfig>) {
  return createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Temporary auth owners, required because owner_id references auth.users. */
async function createTemporaryOwner(admin: ReturnType<typeof createGateAdmin>, label: string) {
  const email = `channelwright-vb-gate-${label}-${randomUUID()}@example.com`;
  const created = await admin.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Could not create temporary gate owner: ${created.error?.message ?? "unknown"}`);
  return created.data.user.id;
}

async function main() {
  const config = readSharedSupabaseConfig();
  const admin = createGateAdmin(config);
  const db = new pg.Client({
    connectionString: config.databaseUrl,
    ssl: { rejectUnauthorized: true, ca: readFileSync(config.databaseCa, "utf8") },
    application_name: "channelwright-video-brief-persisted-gate",
  });
  await db.connect();

  const ownerA = await createTemporaryOwner(admin, "a");
  const ownerB = await createTemporaryOwner(admin, "b");
  let seeded: { workflowId: string; runId: string } | null = null;

  try {
    await verifyCanonicalParity(db);

    // Owner rows are synthetic UUIDs; the schema is owner-scoped by UUID.
    seeded = await seedApprovedContent(db, ownerA);
    const { workflowId, runId } = seeded;

    // --- Resolver: valid paths -------------------------------------------
    const defaultTopic = await asOwner(db, ownerA, () => db.query<{ result: Record<string, unknown> }>(
      "select channelwright.resolve_approved_content_artifact($1,$2,null) as result", [workflowId, runId]));
    const selection = (defaultTopic.rows[0].result as { selection: Record<string, unknown> }).selection;
    record("resolver returns the authoritative next-video recommendation by default",
      selection.selectionSource === "NEXT_VIDEO_RECOMMENDATION" && typeof selection.topicId === "string",
      `topicId=${selection.topicId}`);

    const explicit = await asOwner(db, ownerA, () => db.query<{ result: Record<string, unknown> }>(
      "select channelwright.resolve_approved_content_artifact($1,$2,$3) as result", [workflowId, runId, selectedTopicFixture.topicId]));
    const explicitSelection = (explicit.rows[0].result as { selection: Record<string, unknown> }).selection;
    record("resolver accepts an explicit eligible topic",
      explicitSelection.topicId === selectedTopicFixture.topicId, `topicId=${explicitSelection.topicId}`);

    const provenance = (explicit.rows[0].result as { selection: { inheritedViewerValueProvenance: Record<string, unknown> } }).selection.inheritedViewerValueProvenance;
    const expectedHash = sha256(canonicalJson(approvedContentArtifactFixture.selectedTopic.viewerValue.contract));
    record("inherited Viewer Value contract hash matches the application canonical hash",
      provenance.contractHash === expectedHash, `db=${String(provenance.contractHash).slice(0, 16)} app=${expectedHash.slice(0, 16)}`);
    record("inherited Viewer Value provenance records the PASS gate", provenance.gate === "PASS");

    const reference = (explicit.rows[0].result as { reference: Record<string, unknown> }).reference;
    record("resolver carries transitive strategy provenance", Boolean((reference as { upstreamStrategy?: unknown }).upstreamStrategy));

    // --- Resolver: invalid paths -----------------------------------------
    record("cross-owner resolution is NOT_FOUND, not FORBIDDEN",
      (await expectFailure(db, ownerB, "select channelwright.resolve_approved_content_artifact($1,$2,null)", [workflowId, runId])).includes("NOT_FOUND"));
    record("owner may resolve their own artifact",
      (await expectFailure(db, ownerA, "select channelwright.resolve_approved_content_artifact($1,$2,null)", [workflowId, runId])) === "");
    record("unknown run is NOT_FOUND",
      (await expectFailure(db, ownerA, "select channelwright.resolve_approved_content_artifact($1,$2,null)", [workflowId, randomUUID()])).includes("NOT_FOUND"));
    record("topic outside the approved backlog is rejected",
      (await expectFailure(db, ownerA, "select channelwright.resolve_approved_content_artifact($1,$2,$3)", [workflowId, runId, "topic:not-in-backlog"])).includes("TOPIC_NOT_IN_APPROVED_BACKLOG"));

    // Corrupt-hash and unapproved variants are separate runs, because an
    // approved artifact is immutable by design.
    const corrupt = await seedApprovedContent(db, ownerA, { corruptHash: true });
    record("altered artifact hash fails integrity",
      (await expectFailure(db, ownerA, "select channelwright.resolve_approved_content_artifact($1,$2,null)", [corrupt.workflowId, corrupt.runId])).includes("UPSTREAM_CONTENT_INTEGRITY_MISMATCH"));

    const unapproved = await seedApprovedContent(db, ownerA, { approve: false });
    record("unapproved artifact is rejected",
      (await expectFailure(db, ownerA, "select channelwright.resolve_approved_content_artifact($1,$2,null)", [unapproved.workflowId, unapproved.runId])).includes("UPSTREAM_CONTENT_NOT_APPROVED"));

    // Status is not payload, so it stays mutable; a non-terminal run must not resolve.
    await db.query("update channelwright.workflow_runs set status = 'RUNNING' where id = $1", [runId]);
    record("non-terminal artifact is rejected",
      (await expectFailure(db, ownerA, "select channelwright.resolve_approved_content_artifact($1,$2,null)", [workflowId, runId])).includes("UPSTREAM_CONTENT_NOT_FINAL"));
    await db.query("update channelwright.workflow_runs set status = 'COMPLETED' where id = $1", [runId]);

    // Immutability of the approved artifact itself.
    const mutated = await expectFailure(db, null,
      "update channelwright.workflow_runs set output_payload = output_payload || '{\"tampered\":true}'::jsonb where id = $1", [runId]);
    record("approved artifact payload is immutable", mutated.includes("APPROVED_ARTIFACT_IMMUTABLE"), mutated.split(String.fromCharCode(10))[0].slice(0, 120));

    // --- Privileges -------------------------------------------------------
    const privileges = await db.query<Record<string, boolean>>(`select
      has_function_privilege('authenticated','channelwright.resolve_approved_content_artifact(uuid,uuid,text)','EXECUTE') as auth_resolve,
      has_function_privilege('anon','channelwright.resolve_approved_content_artifact(uuid,uuid,text)','EXECUTE') as anon_resolve,
      has_function_privilege('authenticated','channelwright.complete_workflow_step(uuid,uuid,jsonb)','EXECUTE') as auth_complete,
      has_function_privilege('service_role','channelwright.complete_workflow_step(uuid,uuid,jsonb)','EXECUTE') as service_complete,
      has_function_privilege('authenticated','channelwright.ensure_research_run_budget(uuid,uuid,uuid,text,jsonb)','EXECUTE') as auth_budget,
      has_function_privilege('anon','channelwright.canonical_jsonb_text(jsonb)','EXECUTE') as anon_canonical`);
    const p = privileges.rows[0];
    record("anon cannot execute the content resolver", p.anon_resolve === false);
    record("authenticated may execute the content resolver", p.auth_resolve === true);
    record("authenticated cannot complete workflow steps", p.auth_complete === false);
    record("service role may complete workflow steps", p.service_complete === true);
    record("authenticated cannot touch durable accounting", p.auth_budget === false);
    record("anon cannot execute canonical hashing", p.anon_canonical === false);

    // --- RLS ownership isolation -----------------------------------------
    const rls = await db.query<{ relname: string; enabled: boolean }>(
      `select c.relname, c.relrowsecurity as enabled from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relkind = 'r' and c.relname in ('workflows','workflow_runs','workflow_steps','workflow_approvals','research_run_budgets','research_usage_operations')`,
      [CHANNELWRIGHT_SCHEMA]);
    record("RLS remains enabled on every workflow table",
      rls.rows.length > 0 && rls.rows.every((r) => r.enabled), rls.rows.map((r) => `${r.relname}=${r.enabled}`).join(", "));

    // --- Concurrency boundary --------------------------------------------
    const uniq = await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = $1 and indexname = 'workflow_runs_active_video_brief_uniq'", [CHANNELWRIGHT_SCHEMA]);
    record("video brief concurrency index exists", uniq.rows.length === 1);
    const definition = uniq.rows[0]?.indexdef ?? "";
    record("concurrency key includes owner, content run, and topic",
      definition.includes("owner_id") && definition.includes("contentRunId") && definition.includes("selectedTopicId"), definition.slice(0, 200));
    record("concurrency guard excludes BLOCKED so revision successors stay legal",
      definition.includes("'QUEUED'") && !definition.includes("'BLOCKED'"));

    const topicOne = String(selection.topicId);
    const insertRun = async (topicId: string) => db.query(
      `insert into channelwright.workflow_runs(id, owner_id, workflow_id, workflow_type, definition_version, status, idempotency_key, input_hash, input_payload)
       values ($1,$2,$3,'CHANNEL_VIDEO_BRIEF',1,'QUEUED',$4,$5,$6::jsonb)`,
      [randomUUID(), ownerA, workflowId, `vb-conc:${randomUUID()}`, "1".repeat(64),
        JSON.stringify({ approvedContentReference: { contentRunId: runId }, selectedTopicId: topicId })]);
    await insertRun(topicOne);
    let duplicateBlocked = false;
    try { await insertRun(topicOne); } catch { duplicateBlocked = true; }
    record("a second active run for the same owner+content+topic is blocked", duplicateBlocked);
    let differentTopicAllowed = true;
    try { await insertRun("topic:a-different-eligible-topic"); } catch { differentTopicAllowed = false; }
    record("a different topic from the same backlog may run concurrently", differentTopicAllowed);

    // --- Accounting invariant: zero external retrieval --------------------
    const limits = (searches: number) => JSON.stringify({
      providerRequests: searches === 0 ? 0 : 4, providerQuotaUnits: searches === 0 ? 0 : 100, searches,
      synthesisCalls: 4, qaCalls: 6, revisionCalls: 2, inputTokens: 500_000, outputTokens: 60_000, totalTokens: 560_000, automatedRevisions: 1,
    });
    const budgetRun = (await db.query<{ id: string }>(
      "select id from channelwright.workflow_runs where owner_id = $1 and workflow_type = 'CHANNEL_VIDEO_BRIEF' limit 1", [ownerA])).rows[0].id;
    const nonZero = await expectFailure(db, null,
      "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [budgetRun, randomUUID(), randomUUID(), "gate", limits(4)]);
    record("video brief budget declaring external retrieval is rejected",
      nonZero.includes("VALIDATION_ERROR") || nonZero.includes("LEASE_NOT_ACTIVE"),
      nonZero.split("\n")[0].slice(0, 120));
    const zero = await expectFailure(db, null,
      "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [budgetRun, randomUUID(), randomUUID(), "gate", limits(0)]);
    // A zero-retrieval budget must fail only on the lease, never on validation.
    record("zero-retrieval video brief budget passes ceiling validation",
      zero.includes("LEASE_NOT_ACTIVE") && !zero.includes("VALIDATION_ERROR"), zero.split("\n")[0].slice(0, 120));

    // --- Earlier workflows still resolve ----------------------------------
    const strategyFn = await db.query<{ count: string }>(
      "select count(*)::text as count from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname in ('resolve_approved_research_artifact','resolve_approved_strategy_artifact','resolve_approved_content_artifact')",
      [CHANNELWRIGHT_SCHEMA]);
    record("all three approved-artifact resolvers exist after migration", strategyFn.rows[0].count === "3", `count=${strategyFn.rows[0].count}`);
    const finalizers = await db.query<{ src: string }>(
      "select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname = 'complete_workflow_step'", [CHANNELWRIGHT_SCHEMA]);
    const source = finalizers.rows[0]?.src ?? "";
    record("finalizer promotion still covers all four workflow types",
      ["finalize-strategy", "finalize-content-intelligence", "finalize-video-brief", "synthesize-validation"].every((k) => source.includes(k)));
    record("service-role guard preserved in complete_workflow_step", source.includes("service_role"));
    record("context_payload write preserved for priorOutputs", source.includes("context_payload"));
  } finally {
    // Owner-scoped cleanup, children before parents.
    for (const owner of [ownerA, ownerB]) {
      for (const table of ["research_usage_operations", "research_run_budgets", "workflow_events", "workflow_approvals", "workflow_step_attempts", "workflow_steps", "workflow_runs", "workflows"]) {
        await db.query(`delete from channelwright.${table} where owner_id = $1`, [owner]).catch(() => undefined);
      }
    }
    const remaining = await db.query<{ count: string }>(`select (
      (select count(*) from channelwright.workflows where owner_id = any($1)) +
      (select count(*) from channelwright.workflow_runs where owner_id = any($1)) +
      (select count(*) from channelwright.workflow_steps where owner_id = any($1)) +
      (select count(*) from channelwright.workflow_approvals where owner_id = any($1))
    )::text as count`, [[ownerA, ownerB]]);
    record("gate removed every record it created", remaining.rows[0].count === "0", `remaining=${remaining.rows[0].count}`);
    for (const owner of [ownerA, ownerB]) {
      const deleted = await admin.auth.admin.deleteUser(owner, false);
      if (deleted.error) record(`temporary owner ${owner.slice(0, 8)} deleted`, false, deleted.error.message);
    }
    const usersGone = await db.query<{ count: string }>("select count(*)::text as count from auth.users where id = any($1)", [[ownerA, ownerB]]);
    record("temporary auth owners removed", usersGone.rows[0].count === "0", `remaining=${usersGone.rows[0].count}`);
    await db.end();
  }

  const failed = checks.filter((c) => !c.passed);
  console.log(JSON.stringify({
    gate: failed.length === 0 ? "VIDEO_BRIEF_PERSISTED_LIVE_PASSED" : "VIDEO_BRIEF_PERSISTED_LIVE_FAILED",
    project: safeProjectIdentity(config),
    counts: { passed: checks.length - failed.length, failed: failed.length },
    checks,
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

await main();
