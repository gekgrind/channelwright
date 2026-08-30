/**
 * Persisted live verification for CHANNEL_VIDEO_SCRIPT.
 *
 * Exercises the parts of the slice that only a real database can prove:
 * canonical-JSON parity between SQL and TypeScript, the approved-brief resolver
 * under valid and invalid state, workflow-start pinning, the concurrency
 * boundary, owner isolation, immutability, and the zero-retrieval accounting
 * invariant.
 *
 * Every record it creates is owner-scoped and removed before exit. It never
 * touches `public`, Storage, or another owner's data. It requires no paid
 * provider calls.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { canonicalJson } from "../src/server/workflows/canonical-json";
import { CHANNELWRIGHT_SCHEMA, readSharedSupabaseConfig, safeProjectIdentity } from "./supabase-gate/config";
import { approvedVideoBriefArtifactFixture } from "../src/server/workflows/video-script-fixtures.test-helper";

try { process.loadEnvFile(".env.local"); } catch { /* optional */ }

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, passed: boolean, detail = "") => { checks.push({ name, passed, detail }); };

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

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
  try {
    await asOwner(db, ownerId, () => db.query(sql, params as never[]));
    return "";
  } catch (error) { return error instanceof Error ? error.message : String(error); }
}

async function verifyCanonicalParity(db: pg.Client) {
  const contract = approvedVideoBriefArtifactFixture.briefResult.viewerValue.contract as Record<string, unknown>;
  const cases: Array<{ name: string; value: unknown }> = [
    { name: "camelCase siblings", value: { originStage: "VIDEO_BRIEF", originalContribution: "x", zeta: 1, Alpha: 2 } },
    { name: "numeric scale 1.50", value: { weight: 1.5, whole: 1, small: 0.2 } },
    { name: "brief viewer value contract", value: contract },
  ];
  for (const item of cases) {
    const expected = canonicalJson(item.value);
    const row = await db.query<{ canonical: string; hash: string }>(
      `select channelwright.canonical_jsonb_text($1::jsonb) as canonical,
              encode(digest(channelwright.canonical_jsonb_text($1::jsonb), 'sha256'), 'hex') as hash`,
      [JSON.stringify(item.value)],
    );
    record(`canonical string parity: ${item.name}`, row.rows[0].canonical === expected,
      row.rows[0].canonical === expected ? `${expected.length} chars` : `sql=${row.rows[0].canonical.slice(0, 160)} ts=${expected.slice(0, 160)}`);
    record(`canonical hash parity: ${item.name}`, row.rows[0].hash === sha256(expected));
  }
  const tampered = { ...contract, valuePromise: { ...(contract.valuePromise as object), statement: "A quietly different promise." } };
  const drift = await db.query<{ same: boolean }>(
    "select channelwright.canonical_jsonb_text($1::jsonb) = channelwright.canonical_jsonb_text($2::jsonb) as same",
    [JSON.stringify(contract), JSON.stringify(tampered)],
  );
  record("changed promise changes the canonical string", drift.rows[0].same === false);
}

/**
 * Seeds a COMPLETED, human-approved CHANNEL_VIDEO_BRIEF run owned by `ownerId`.
 * Hashes are written before the approval row exists because a finalized artifact
 * is immutable; corrupt and unapproved variants are seeded as separate runs.
 */
async function seedApprovedBrief(db: pg.Client, ownerId: string, options: { corruptHash?: boolean; approve?: boolean } = {}) {
  const { corruptHash = false, approve = true } = options;
  const brief = approvedVideoBriefArtifactFixture.briefResult;
  const discovery = approvedVideoBriefArtifactFixture.discoveryBundle;
  const contentRef = brief.upstreamContentIntelligence;
  const workflowId = randomUUID();
  const runId = randomUUID();

  await db.query(
    `insert into channelwright.workflows(id, owner_id, workflow_type, definition_version, objective, status)
     values ($1,$2,'CHANNEL_VIDEO_BRIEF',1,'persisted video script gate','COMPLETED')`,
    [workflowId, ownerId],
  );
  await db.query(
    `insert into channelwright.workflow_runs(id, owner_id, workflow_id, workflow_type, definition_version, status, idempotency_key, input_hash, input_payload, output_payload, completed_at)
     values ($1,$2,$3,'CHANNEL_VIDEO_BRIEF',1,'COMPLETED',$4,$5,$6::jsonb,$7::jsonb, now())`,
    [runId, ownerId, workflowId, `vs-gate:${runId}`, "0".repeat(64),
      JSON.stringify({ contentIntelligenceWorkflowId: contentRef.contentWorkflowId, contentIntelligenceRunId: contentRef.contentRunId, approvedContentReference: contentRef, selectedTopicId: brief.selectedTopic.topicId }),
      JSON.stringify(brief)],
  );
  await db.query("update channelwright.workflows set current_run_id = $2 where id = $1", [workflowId, runId]);

  // validate-approved-content is the brief's provenance step: it carries the
  // exact content reference and the discovery bundle.
  const provenance = { reference: contentRef, contentResult: {}, discoveryBundle: discovery, selectedTopic: {}, selection: {} };
  const steps: Array<[string, number, unknown]> = [
    ["validate-approved-content", 0, provenance],
    ["final-video-brief-qa", 5, { qa: { passed: true, score: 86, findings: [], recommendation: "accept", deterministicChecksPassed: 28, deterministicChecksFailed: 0, modelUsage: { model: "gate", inputTokens: 1, outputTokens: 1, totalTokens: 2 } } }],
    ["finalize-video-brief", 6, brief],
  ];
  for (const [key, position, output] of steps) {
    await db.query(
      `insert into channelwright.workflow_steps(id, owner_id, workflow_id, workflow_run_id, step_key, position, kind, capability, depends_on, status, max_attempts, retry_base_seconds, output_payload, completed_at)
       values ($1,$2,$3,$4,$5,$6,'WORKER','gate','{}','COMPLETED',1,0,$7::jsonb, now())`,
      [randomUUID(), ownerId, workflowId, runId, key, position, JSON.stringify(output)],
    );
  }
  await db.query(
    corruptHash
      ? `update channelwright.workflow_runs set artifact_hash = $2,
             provenance_hash = encode(digest((select output_payload from channelwright.workflow_steps
                                              where workflow_run_id = $1 and step_key = 'validate-approved-content')::text,'sha256'),'hex')
           where id = $1`
      : `update channelwright.workflow_runs
            set artifact_hash = encode(digest(output_payload::text,'sha256'),'hex'),
                provenance_hash = encode(digest((select output_payload from channelwright.workflow_steps
                                                 where workflow_run_id = $1 and step_key = 'validate-approved-content')::text,'sha256'),'hex')
          where id = $1`,
    corruptHash ? [runId, "f".repeat(64)] : [runId],
  );

  const approvalStepId = randomUUID();
  await db.query(
    `insert into channelwright.workflow_steps(id, owner_id, workflow_id, workflow_run_id, step_key, position, kind, capability, depends_on, status, max_attempts, retry_base_seconds, completed_at)
     values ($1,$2,$3,$4,'review-video-brief',7,'APPROVAL','human','{}','COMPLETED',1,0, now())`,
    [approvalStepId, ownerId, workflowId, runId],
  );
  await db.query(
    approve
      ? `insert into channelwright.workflow_approvals(id, owner_id, workflow_id, workflow_run_id, workflow_step_id, gate_key, status, request_payload, decided_by, decided_at)
         values ($1,$2,$3,$4,$5,'review-video-brief','APPROVED','{}'::jsonb,$2, now())`
      : `insert into channelwright.workflow_approvals(id, owner_id, workflow_id, workflow_run_id, workflow_step_id, gate_key, status, request_payload)
         values ($1,$2,$3,$4,$5,'review-video-brief','PENDING','{}'::jsonb)`,
    [randomUUID(), ownerId, workflowId, runId, approvalStepId],
  );
  return { workflowId, runId };
}

function createGateAdmin(config: ReturnType<typeof readSharedSupabaseConfig>) {
  return createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createTemporaryOwner(admin: ReturnType<typeof createGateAdmin>, label: string) {
  const email = `channelwright-vs-gate-${label}-${randomUUID()}@example.com`;
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
    application_name: "channelwright-video-script-persisted-gate",
  });
  // Every resource is acquired INSIDE the try so the finally cleans up exactly
  // what was created: if the second owner fails to create, the first (and the
  // connection) are still torn down. `owners` holds whatever exists.
  const owners: string[] = [];
  let connected = false;

  try {
    await db.connect();
    connected = true;
    owners.push(await createTemporaryOwner(admin, "a"));
    owners.push(await createTemporaryOwner(admin, "b"));
    const [ownerA, ownerB] = owners;

    await verifyCanonicalParity(db);

    const { workflowId, runId } = await seedApprovedBrief(db, ownerA);

    // --- Resolver: valid path --------------------------------------------
    const resolved = await asOwner(db, ownerA, () => db.query<{ result: Record<string, unknown> }>(
      "select channelwright.resolve_approved_video_brief_artifact($1,$2) as result", [workflowId, runId]));
    const scope = (resolved.rows[0].result as { scope: Record<string, unknown> }).scope;
    const provenance = (scope as { inheritedViewerValueProvenance: Record<string, unknown> }).inheritedViewerValueProvenance;
    const expectedHash = sha256(canonicalJson(approvedVideoBriefArtifactFixture.briefResult.viewerValue.contract));
    record("resolver returns the approved brief scope", typeof scope.briefTopicId === "string", `topicId=${scope.briefTopicId}`);
    record("inherited Viewer Value contract hash matches the application canonical hash",
      provenance.contractHash === expectedHash, `db=${String(provenance.contractHash).slice(0, 16)} app=${expectedHash.slice(0, 16)}`);
    record("inherited Viewer Value provenance records the VIDEO_BRIEF origin and PASS gate",
      provenance.originStage === "VIDEO_BRIEF" && provenance.gate === "PASS");
    const reference = (resolved.rows[0].result as { reference: Record<string, unknown> }).reference;
    record("resolver carries transitive content-intelligence provenance", Boolean((reference as { upstreamContentIntelligence?: unknown }).upstreamContentIntelligence));

    // --- Resolver: invalid paths -----------------------------------------
    record("cross-owner resolution is NOT_FOUND, not FORBIDDEN",
      (await expectFailure(db, ownerB, "select channelwright.resolve_approved_video_brief_artifact($1,$2)", [workflowId, runId])).includes("NOT_FOUND"));
    record("owner may resolve their own artifact",
      (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_brief_artifact($1,$2)", [workflowId, runId])) === "");
    record("unknown run is NOT_FOUND",
      (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_brief_artifact($1,$2)", [workflowId, randomUUID()])).includes("NOT_FOUND"));

    const corrupt = await seedApprovedBrief(db, ownerA, { corruptHash: true });
    record("altered artifact hash fails integrity",
      (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_brief_artifact($1,$2)", [corrupt.workflowId, corrupt.runId])).includes("UPSTREAM_BRIEF_INTEGRITY_MISMATCH"));

    const unapproved = await seedApprovedBrief(db, ownerA, { approve: false });
    record("unapproved artifact is rejected",
      (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_brief_artifact($1,$2)", [unapproved.workflowId, unapproved.runId])).includes("UPSTREAM_BRIEF_NOT_APPROVED"));

    await db.query("update channelwright.workflow_runs set status = 'RUNNING' where id = $1", [runId]);
    record("non-terminal artifact is rejected",
      (await expectFailure(db, ownerA, "select channelwright.resolve_approved_video_brief_artifact($1,$2)", [workflowId, runId])).includes("UPSTREAM_BRIEF_NOT_FINAL"));
    await db.query("update channelwright.workflow_runs set status = 'COMPLETED' where id = $1", [runId]);

    const mutated = await expectFailure(db, null,
      "update channelwright.workflow_runs set output_payload = output_payload || '{\"tampered\":true}'::jsonb where id = $1", [runId]);
    record("approved artifact payload is immutable", mutated.includes("APPROVED_ARTIFACT_IMMUTABLE"), mutated.split(String.fromCharCode(10))[0].slice(0, 120));

    // --- Privileges -------------------------------------------------------
    const privileges = await db.query<Record<string, boolean>>(`select
      has_function_privilege('authenticated','channelwright.resolve_approved_video_brief_artifact(uuid,uuid)','EXECUTE') as auth_resolve,
      has_function_privilege('anon','channelwright.resolve_approved_video_brief_artifact(uuid,uuid)','EXECUTE') as anon_resolve,
      has_function_privilege('authenticated','channelwright.complete_workflow_step(uuid,uuid,jsonb)','EXECUTE') as auth_complete,
      has_function_privilege('service_role','channelwright.complete_workflow_step(uuid,uuid,jsonb)','EXECUTE') as service_complete,
      has_function_privilege('authenticated','channelwright.ensure_research_run_budget(uuid,uuid,uuid,text,jsonb)','EXECUTE') as auth_budget`);
    const p = privileges.rows[0];
    record("anon cannot execute the brief resolver", p.anon_resolve === false);
    record("authenticated may execute the brief resolver", p.auth_resolve === true);
    record("authenticated cannot complete workflow steps", p.auth_complete === false);
    record("service role may complete workflow steps", p.service_complete === true);
    record("authenticated cannot touch durable accounting", p.auth_budget === false);

    // --- RLS ownership isolation -----------------------------------------
    const rls = await db.query<{ relname: string; enabled: boolean }>(
      `select c.relname, c.relrowsecurity as enabled from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relkind = 'r' and c.relname in ('workflows','workflow_runs','workflow_steps','workflow_approvals','research_run_budgets','research_usage_operations')`,
      [CHANNELWRIGHT_SCHEMA]);
    record("RLS remains enabled on every workflow table",
      rls.rows.length > 0 && rls.rows.every((r) => r.enabled), rls.rows.map((r) => `${r.relname}=${r.enabled}`).join(", "));

    // --- Concurrency boundary --------------------------------------------
    const uniq = await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = $1 and indexname = 'workflow_runs_active_video_script_uniq'", [CHANNELWRIGHT_SCHEMA]);
    record("video script concurrency index exists", uniq.rows.length === 1);
    const definition = uniq.rows[0]?.indexdef ?? "";
    record("concurrency key includes owner and brief run", definition.includes("owner_id") && definition.includes("briefRunId"), definition.slice(0, 200));
    record("concurrency guard excludes BLOCKED so revision successors stay legal",
      definition.includes("'QUEUED'") && !definition.includes("'BLOCKED'"));

    const insertRun = async (briefRunId: string) => db.query(
      `insert into channelwright.workflow_runs(id, owner_id, workflow_id, workflow_type, definition_version, status, idempotency_key, input_hash, input_payload)
       values ($1,$2,$3,'CHANNEL_VIDEO_SCRIPT',1,'QUEUED',$4,$5,$6::jsonb)`,
      [randomUUID(), ownerA, workflowId, `vs-conc:${randomUUID()}`, "1".repeat(64),
        JSON.stringify({ approvedVideoBriefReference: { briefRunId } })]);
    await insertRun(runId);
    let duplicateBlocked = false;
    try { await insertRun(runId); } catch { duplicateBlocked = true; }
    record("a second active script for the same owner+brief is blocked", duplicateBlocked);
    let differentBriefAllowed = true;
    try { await insertRun(randomUUID()); } catch { differentBriefAllowed = false; }
    record("a script for a different approved brief may run concurrently", differentBriefAllowed);

    // --- Accounting invariant: zero external retrieval --------------------
    const limits = (searches: number) => JSON.stringify({
      providerRequests: searches === 0 ? 0 : 4, providerQuotaUnits: searches === 0 ? 0 : 100, searches,
      synthesisCalls: 4, qaCalls: 6, revisionCalls: 2, inputTokens: 500_000, outputTokens: 72_000, totalTokens: 572_000, automatedRevisions: 1,
    });
    const budgetRun = (await db.query<{ id: string }>(
      "select id from channelwright.workflow_runs where owner_id = $1 and workflow_type = 'CHANNEL_VIDEO_SCRIPT' limit 1", [ownerA])).rows[0].id;
    // Budget ceiling validation runs BEFORE the lease check, so a nonzero-retrieval
    // budget must be rejected specifically with VALIDATION_ERROR — never merely
    // LEASE_NOT_ACTIVE, which would mean ceiling validation was skipped and the
    // invariant was not actually proven.
    const nonZero = await expectFailure(db, null,
      "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [budgetRun, randomUUID(), randomUUID(), "gate", limits(4)]);
    record("video script budget declaring external retrieval is rejected by ceiling validation",
      nonZero.includes("VALIDATION_ERROR") && !nonZero.includes("LEASE_NOT_ACTIVE"), nonZero.split("\n")[0].slice(0, 160));
    const zero = await expectFailure(db, null,
      "select channelwright.ensure_research_run_budget($1,$2,$3,$4,$5::jsonb)", [budgetRun, randomUUID(), randomUUID(), "gate", limits(0)]);
    record("zero-retrieval video script budget passes ceiling validation (fails only on lease)",
      zero.includes("LEASE_NOT_ACTIVE") && !zero.includes("VALIDATION_ERROR"), zero.split("\n")[0].slice(0, 160));

    // --- All resolvers and finalizer promotion still hold -----------------
    const resolvers = await db.query<{ count: string }>(
      "select count(*)::text as count from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname in ('resolve_approved_research_artifact','resolve_approved_strategy_artifact','resolve_approved_content_artifact','resolve_approved_video_brief_artifact')",
      [CHANNELWRIGHT_SCHEMA]);
    record("all four approved-artifact resolvers exist after migration", resolvers.rows[0].count === "4", `count=${resolvers.rows[0].count}`);
    const finalizers = await db.query<{ src: string }>(
      "select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname = 'complete_workflow_step'", [CHANNELWRIGHT_SCHEMA]);
    const source = finalizers.rows[0]?.src ?? "";
    record("finalizer promotion covers all five workflow types",
      ["finalize-strategy", "finalize-content-intelligence", "finalize-video-brief", "finalize-video-script", "synthesize-validation"].every((k) => source.includes(k)));
    record("service-role guard preserved in complete_workflow_step", source.includes("service_role"));
    record("context_payload write preserved for priorOutputs", source.includes("context_payload"));
  } finally {
    // Cleanup must be proven, not assumed, and each phase is guarded so one
    // failure cannot skip the rest — the connection is always closed last, even
    // if verification of leftovers or user deletion throws. `owners` reflects
    // exactly what was created, so a partial setup is still fully torn down.
    const OWNED_TABLES = ["research_usage_operations", "research_run_budgets", "workflow_events", "workflow_approvals", "workflow_step_attempts", "workflow_steps", "workflow_runs", "workflows"];
    try {
      if (connected && owners.length) {
        const deleteErrors: string[] = [];
        for (const owner of owners) {
          for (const table of OWNED_TABLES) {
            try { await db.query(`delete from channelwright.${table} where owner_id = $1`, [owner]); }
            catch (error) { deleteErrors.push(`${table}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); }
          }
        }
        record("cleanup deletes ran without error on every owned table", deleteErrors.length === 0, deleteErrors.join("; ").slice(0, 200));
        try {
          const counts = await db.query<Record<string, string>>(
            `select ${OWNED_TABLES.map((t) => `(select count(*) from channelwright.${t} where owner_id = any($1))::int as ${t}`).join(", ")}`,
            [owners]);
          const leftovers = Object.entries(counts.rows[0]).filter(([, n]) => Number(n) !== 0);
          record("gate removed every record it created across all owned tables", leftovers.length === 0,
            leftovers.length ? leftovers.map(([t, n]) => `${t}=${n}`).join(", ") : "all owned tables empty");
        } catch (error) { record("verified owned tables empty", false, error instanceof Error ? error.message.split("\n")[0] : String(error)); }
      }
      for (const owner of owners) {
        try {
          const deleted = await admin.auth.admin.deleteUser(owner, false);
          if (deleted.error) record(`temporary owner ${owner.slice(0, 8)} deleted`, false, deleted.error.message);
        } catch (error) { record(`temporary owner ${owner.slice(0, 8)} deleted`, false, error instanceof Error ? error.message.split("\n")[0] : String(error)); }
      }
      if (connected && owners.length) {
        try {
          const usersGone = await db.query<{ count: string }>("select count(*)::text as count from auth.users where id = any($1)", [owners]);
          record("temporary auth owners removed", usersGone.rows[0].count === "0", `remaining=${usersGone.rows[0].count}`);
        } catch (error) { record("temporary auth owners removed", false, error instanceof Error ? error.message.split("\n")[0] : String(error)); }
      }
    } finally {
      if (connected) { try { await db.end(); } catch { /* connection already gone */ } }
    }
  }

  const failed = checks.filter((c) => !c.passed);
  console.log(JSON.stringify({
    gate: failed.length === 0 ? "VIDEO_SCRIPT_PERSISTED_LIVE_PASSED" : "VIDEO_SCRIPT_PERSISTED_LIVE_FAILED",
    project: safeProjectIdentity(config),
    counts: { passed: checks.length - failed.length, failed: failed.length },
    checks,
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

await main();
