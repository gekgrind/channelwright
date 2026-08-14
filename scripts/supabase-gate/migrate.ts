import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { readSharedSupabaseConfig, safeProjectIdentity } from "./config";

try { process.loadEnvFile(".env.local"); } catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];
const check = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
const migrationDirectory = path.resolve(process.cwd(), "supabase", "migrations");

async function loadMigrations() {
  const names = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort((left, right) => left.localeCompare(right));
  if (names.length === 0) throw new Error("No ordered Supabase migrations were found");
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(path.join(migrationDirectory, name), "utf8");
    const version = name.slice(0, name.indexOf("_"));
    return { name, version, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));
}

const namesFromSql = (migrations: Awaited<ReturnType<typeof loadMigrations>>, expression: RegExp) => {
  const names = new Set<string>();
  for (const migration of migrations) {
    for (const match of migration.sql.matchAll(expression)) names.add(match[1]);
  }
  return [...names].sort();
};

async function main() {
  const config = readSharedSupabaseConfig();
  const migrations = await loadMigrations();
  const client = new pg.Client({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: true, ca: readFileSync(config.databaseCa, "utf8") }, application_name: "channelwright-shared-schema-gate" });
  await client.connect();
  try {
    const initial = await client.query<{
      target_schema: string; target_objects: string; target_bucket: string; target_storage_policy: string; tracker_schema: string; tracked_migrations: string;
    }>(`select
      (select count(*) from pg_namespace where nspname = $1)::text as target_schema,
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind in ('r','p','v','m','f'))::text as target_objects,
      (select count(*) from storage.buckets where id = 'channelwright-private-media')::text as target_bucket,
      (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'channelwright_media_owner_read')::text as target_storage_policy,
      (select count(*) from pg_namespace where nspname = 'channelwright_migrations')::text as tracker_schema,
      (select count(*) from information_schema.tables where table_schema = 'channelwright_migrations' and table_name = 'schema_migrations')::text as tracked_migrations`, [config.schema]);
    const state = initial.rows[0];
    let previouslyApplied: Array<{ version: string; name: string; checksum_sha256: string }> = [];
    if (state.tracked_migrations === "0") {
      const namespaceAvailable = state.target_schema === "0" && state.target_objects === "0" && state.target_bucket === "0" && state.target_storage_policy === "0" && state.tracker_schema === "0";
      check("isolated shared-project namespace available", namespaceAvailable, `schemaExists=${state.target_schema}, schemaObjects=${state.target_objects}, bucketExists=${state.target_bucket}, storagePolicyExists=${state.target_storage_policy}, trackerSchemaExists=${state.tracker_schema}`);
      if (!namespaceAvailable) throw new Error("Refusing to mutate: a Channelwright-owned schema, object, bucket, policy, or migration tracker already exists without a ledger");
      await client.query("begin");
      try {
        await client.query(`create schema channelwright_migrations`);
        await client.query(`create table channelwright_migrations.schema_migrations (
          version text primary key,
          name text not null,
          checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
          applied_at timestamptz not null default now()
        )`);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    } else {
      previouslyApplied = (await client.query<{ version: string; name: string; checksum_sha256: string }>("select version, name, checksum_sha256 from channelwright_migrations.schema_migrations order by version")).rows;
      const resumable = state.tracker_schema === "1" && (previouslyApplied.length === 0 ? state.target_schema === "0" : state.target_schema === "1");
      check("existing Channelwright migration ledger is resumable", resumable, `applied=${previouslyApplied.length}, schemaExists=${state.target_schema}, trackerSchemaExists=${state.tracker_schema}`);
      if (!resumable) throw new Error("Refusing to mutate: Channelwright schema state does not match its migration ledger");
      for (let index = 0; index < previouslyApplied.length; index += 1) {
        const actual = previouslyApplied[index]; const expected = migrations[index];
        if (!expected || actual.version !== expected.version || actual.name !== expected.name || actual.checksum_sha256 !== expected.checksum) {
          throw new Error(`Refusing to mutate: migration ledger diverges at ${actual.version}`);
        }
      }
    }

    for (const migration of migrations) {
      if (previouslyApplied.some((item) => item.version === migration.version)) continue;
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          "insert into channelwright_migrations.schema_migrations(version, name, checksum_sha256) values ($1, $2, $3)",
          [migration.version, migration.name, migration.checksum],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${migration.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const expectedTables = namesFromSql(migrations, /create\s+table\s+channelwright\.([a-z0-9_]+)/gi);
    const droppedIndexes = namesFromSql(migrations, /drop\s+index\s+(?:if\s+exists\s+)?(?:channelwright\.)?([a-z0-9_]+)/gi);
    const expectedIndexes = namesFromSql(migrations, /create\s+(?:unique\s+)?index\s+([a-z0-9_]+)/gi).filter((name) => !droppedIndexes.includes(name));
    const expectedTriggers = namesFromSql(migrations, /create\s+trigger\s+([a-z0-9_]+)/gi);
    const expectedFunctions = namesFromSql(migrations, /create\s+(?:or\s+replace\s+)?function\s+channelwright\.([a-z0-9_]+)/gi);
    const expectedPublicPolicies = namesFromSql(migrations, /create\s+policy\s+([a-z0-9_]+)\s+on\s+channelwright\./gi);

    const tables = await client.query<{ tablename: string; rowsecurity: boolean }>("select tablename, rowsecurity from pg_tables where schemaname = $1 order by tablename", [config.schema]);
    const actualTables = tables.rows.map((row) => row.tablename);
    const missingTables = expectedTables.filter((name) => !actualTables.includes(name));
    const rlsDisabled = tables.rows.filter((row) => expectedTables.includes(row.tablename) && !row.rowsecurity).map((row) => row.tablename);
    check("required Channelwright tables", missingTables.length === 0, missingTables.length ? `missing=${missingTables.join(",")}` : `${expectedTables.length} present`);
    check("RLS enabled on application tables", rlsDisabled.length === 0, rlsDisabled.length ? `disabled=${rlsDisabled.join(",")}` : `${expectedTables.length} enabled`);

    const indexes = await client.query<{ indexname: string }>("select indexname from pg_indexes where schemaname = $1", [config.schema]);
    const indexNames = indexes.rows.map((row) => row.indexname);
    const missingIndexes = expectedIndexes.filter((name) => !indexNames.includes(name));
    check("required indexes", missingIndexes.length === 0, missingIndexes.length ? `missing=${missingIndexes.join(",")}` : `${expectedIndexes.length} present`);

    const triggers = await client.query<{ tgname: string }>(`select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and not t.tgisinternal`, [config.schema]);
    const triggerNames = triggers.rows.map((row) => row.tgname);
    const missingTriggers = expectedTriggers.filter((name) => !triggerNames.includes(name));
    check("required triggers", missingTriggers.length === 0, missingTriggers.length ? `missing=${missingTriggers.join(",")}` : `${expectedTriggers.length} present`);

    const functions = await client.query<{ proname: string }>(`select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1`, [config.schema]);
    const functionNames = functions.rows.map((row) => row.proname);
    const missingFunctions = expectedFunctions.filter((name) => !functionNames.includes(name));
    check("required functions", missingFunctions.length === 0, missingFunctions.length ? `missing=${missingFunctions.join(",")}` : `${expectedFunctions.length} present`);

    const policies = await client.query<{ policyname: string }>("select policyname from pg_policies where schemaname = $1", [config.schema]);
    const policyNames = policies.rows.map((row) => row.policyname);
    const missingPolicies = expectedPublicPolicies.filter((name) => !policyNames.includes(name));
    check("required Channelwright RLS policies", missingPolicies.length === 0, missingPolicies.length ? `missing=${missingPolicies.join(",")}` : `${expectedPublicPolicies.length} present`);

    const invalidForeignKeys = await client.query<{ name: string }>(`select conname as name from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = $1 and c.contype = 'f' and not c.convalidated`, [config.schema]);
    check("foreign keys validated", invalidForeignKeys.rowCount === 0, invalidForeignKeys.rowCount ? `invalid=${invalidForeignKeys.rows.map((row) => row.name).join(",")}` : "all validated");

    const requiredTenantConstraints = [
      "video_projects_channel_owner_fk", "workflow_runs_channel_owner_fk", "workflow_runs_video_owner_fk", "agent_runs_workflow_owner_fk",
      "concept_research_version_channel_fk", "concept_viability_version_channel_fk", "concept_decisions_report_version_channel_fk",
      "script_qa_script_video_fk", "script_approvals_script_video_fk", "cost_events_channel_owner_fk", "cost_events_video_owner_fk", "cost_events_agent_owner_fk",
      "workflow_runs_workflow_owner_fk", "workflows_current_run_fk", "workflows_channel_owner_fk", "workflow_steps_workflow_owner_fk", "workflow_steps_run_owner_fk",
      "workflow_attempts_step_owner_fk", "workflow_approvals_step_owner_fk", "workflow_events_run_owner_fk",
      "research_budgets_run_owner_fk", "research_budgets_parent_owner_fk", "research_budgets_root_owner_fk",
      "research_usage_run_owner_fk", "research_usage_step_owner_fk", "research_usage_attempt_owner_fk",
    ];
    const tenantConstraints = await client.query<{ conname: string }>("select conname from pg_constraint where conname = any($1::text[])", [requiredTenantConstraints]);
    const actualTenantConstraints = tenantConstraints.rows.map((row) => row.conname);
    const missingTenantConstraints = requiredTenantConstraints.filter((name) => !actualTenantConstraints.includes(name));
    check("cross-tenant relationship constraints", missingTenantConstraints.length === 0, missingTenantConstraints.length ? `missing=${missingTenantConstraints.join(",")}` : `${requiredTenantConstraints.length} present`);

    const anonPrivileges = await client.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = $1 and (
      has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'SELECT') or
      has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'INSERT') or
      has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'UPDATE') or
      has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'DELETE'))`, [config.schema]);
    check("anonymous Channelwright-table privileges", anonPrivileges.rowCount === 0, anonPrivileges.rowCount ? `unexpected=${anonPrivileges.rows.map((row) => row.tablename).join(",")}` : "none");

    const schemaPrivileges = await client.query<{ auth_usage: boolean; anon_usage: boolean; service_usage: boolean }>(`select
      has_schema_privilege('authenticated', $1, 'USAGE') as auth_usage,
      has_schema_privilege('anon', $1, 'USAGE') as anon_usage,
      has_schema_privilege('service_role', $1, 'USAGE') as service_usage`, [config.schema]);
    const schemaGrants = schemaPrivileges.rows[0];
    check("isolated schema privileges", schemaGrants.auth_usage && !schemaGrants.anon_usage && schemaGrants.service_usage, JSON.stringify(schemaGrants));

    const missingAuthenticatedSelect = await client.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = $1 and tablename <> 'production_idempotency' and not has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'SELECT')`, [config.schema]);
    check("authenticated read grants on API-readable Channelwright tables", missingAuthenticatedSelect.rowCount === 0, missingAuthenticatedSelect.rowCount ? `missing=${missingAuthenticatedSelect.rows.map((row) => row.tablename).join(",")}` : "all present");

    const idempotencyPrivileges = await client.query<{ can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }>(`select
      has_table_privilege('authenticated', 'channelwright.production_idempotency', 'SELECT') as can_select,
      has_table_privilege('authenticated', 'channelwright.production_idempotency', 'INSERT') as can_insert,
      has_table_privilege('authenticated', 'channelwright.production_idempotency', 'UPDATE') as can_update,
      has_table_privilege('authenticated', 'channelwright.production_idempotency', 'DELETE') as can_delete`);
    const idempotency = idempotencyPrivileges.rows[0];
    check("production idempotency is RPC-only", !idempotency.can_select && !idempotency.can_insert && !idempotency.can_update && !idempotency.can_delete, JSON.stringify(idempotency));

    const rpcPrivileges = await client.query<{
      auth_claim: boolean; anon_claim: boolean; auth_complete: boolean; anon_complete: boolean; service_complete: boolean; auth_reconcile: boolean; service_reconcile: boolean;
      auth_workflow_claim: boolean; anon_workflow_claim: boolean; service_workflow_claim: boolean; auth_workflow_start: boolean; anon_workflow_start: boolean;
      auth_usage_reserve: boolean; anon_usage_reserve: boolean; service_usage_reserve: boolean; auth_usage_finalize: boolean; service_usage_finalize: boolean;
    }>(`select
      has_function_privilege('authenticated', 'channelwright.claim_render_job(text,integer)', 'EXECUTE') as auth_claim,
      has_function_privilege('anon', 'channelwright.claim_render_job(text,integer)', 'EXECUTE') as anon_claim,
      has_function_privilege('authenticated', 'channelwright.complete_render_job(uuid,uuid,jsonb)', 'EXECUTE') as auth_complete,
      has_function_privilege('anon', 'channelwright.complete_render_job(uuid,uuid,jsonb)', 'EXECUTE') as anon_complete,
      has_function_privilege('service_role', 'channelwright.complete_render_job(uuid,uuid,jsonb)', 'EXECUTE') as service_complete,
      has_function_privilege('authenticated', 'channelwright.inspect_media_storage_reconciliation()', 'EXECUTE') as auth_reconcile,
      has_function_privilege('service_role', 'channelwright.inspect_media_storage_reconciliation()', 'EXECUTE') as service_reconcile,
      has_function_privilege('authenticated', 'channelwright.claim_workflow_step(text,integer)', 'EXECUTE') as auth_workflow_claim,
      has_function_privilege('anon', 'channelwright.claim_workflow_step(text,integer)', 'EXECUTE') as anon_workflow_claim,
      has_function_privilege('service_role', 'channelwright.claim_workflow_step(text,integer)', 'EXECUTE') as service_workflow_claim,
      has_function_privilege('authenticated', 'channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb)', 'EXECUTE') as auth_workflow_start,
      has_function_privilege('anon', 'channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb)', 'EXECUTE') as anon_workflow_start,
      has_function_privilege('authenticated', 'channelwright.reserve_research_usage(uuid,uuid,uuid,text,text,text,text,jsonb)', 'EXECUTE') as auth_usage_reserve,
      has_function_privilege('anon', 'channelwright.reserve_research_usage(uuid,uuid,uuid,text,text,text,text,jsonb)', 'EXECUTE') as anon_usage_reserve,
      has_function_privilege('service_role', 'channelwright.reserve_research_usage(uuid,uuid,uuid,text,text,text,text,jsonb)', 'EXECUTE') as service_usage_reserve,
      has_function_privilege('authenticated', 'channelwright.finalize_research_usage(uuid,text,jsonb,jsonb)', 'EXECUTE') as auth_usage_finalize,
      has_function_privilege('service_role', 'channelwright.finalize_research_usage(uuid,text,jsonb,jsonb)', 'EXECUTE') as service_usage_finalize`);
    const rpc = rpcPrivileges.rows[0];
    check("worker RPC privileges", !rpc.auth_claim && !rpc.anon_claim && !rpc.auth_complete && !rpc.anon_complete && rpc.service_complete && !rpc.auth_reconcile && rpc.service_reconcile, JSON.stringify(rpc));
    check("strategic workflow RPC privileges", !rpc.auth_workflow_claim && !rpc.anon_workflow_claim && rpc.service_workflow_claim && rpc.auth_workflow_start && !rpc.anon_workflow_start, JSON.stringify(rpc));
    check("research usage RPC privileges", !rpc.auth_usage_reserve && !rpc.anon_usage_reserve && rpc.service_usage_reserve && !rpc.auth_usage_finalize && rpc.service_usage_finalize, JSON.stringify(rpc));

    const bucket = await client.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>("select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'channelwright-private-media'");
    check("private media bucket", bucket.rowCount === 1 && bucket.rows[0].public === false && bucket.rows[0].file_size_limit === "524288000", bucket.rowCount ? `public=${bucket.rows[0].public}, limit=${bucket.rows[0].file_size_limit}` : "missing");
    const storagePolicy = await client.query<{ policyname: string }>("select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'channelwright_media_owner_read'");
    check("owner-scoped storage policy", storagePolicy.rowCount === 1, storagePolicy.rowCount === 1 ? "present" : "missing");

    const applied = await client.query<{ version: string; name: string; checksum_sha256: string }>("select version, name, checksum_sha256 from channelwright_migrations.schema_migrations order by version");
    const exactVersions = applied.rows.length === migrations.length && applied.rows.every((row, index) => row.version === migrations[index].version && row.checksum_sha256 === migrations[index].checksum);
    check("ordered migration ledger", exactVersions, applied.rows.map((row) => row.version).join(","));

    const failed = checks.filter((item) => !item.passed);
    const report = {
      gate: failed.length === 0 ? "SHARED_SCHEMA_MIGRATION_CATALOG_PASSED" : "SHARED_SCHEMA_MIGRATION_CATALOG_FAILED",
      project: safeProjectIdentity(config),
      migrationVersions: applied.rows.map((row) => row.version),
      checks,
      counts: { passed: checks.length - failed.length, failed: failed.length, skipped: 0 },
    };
    console.log(JSON.stringify(report, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const failedChecks = checks.filter((item) => !item.passed).length;
  console.error(JSON.stringify({ gate: "SHARED_SCHEMA_MIGRATION_CATALOG_FAILED", error: error instanceof Error ? error.message : String(error), counts: { passed: checks.filter((item) => item.passed).length, failed: Math.max(1, failedChecks), skipped: 0 } }, null, 2));
  process.exitCode = 1;
});
