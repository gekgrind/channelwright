import pg from "pg";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { readSharedSupabaseConfig, safeProjectIdentity } from "./config";

try { process.loadEnvFile(".env.local"); } catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

const config = readSharedSupabaseConfig();
const database = new pg.Client({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: true, ca: readFileSync(config.databaseCa, "utf8") }, application_name: "channelwright-shared-schema-inspection" });
await database.connect();
try {
  const ledger = await database.query<{ version: string; name: string; checksum_sha256: string; applied_at: string }>("select version,name,checksum_sha256,applied_at::text from channelwright_migrations.schema_migrations order by version");
  const schema = await database.query<{ objects: number }>("select count(*)::int as objects from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relkind in ('r','p','v','m','f')", [config.schema]);
  const foreignSchemas = await database.query<{ count: number }>("select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ($1,'channelwright_migrations') and c.relname in ('research_run_budgets','research_usage_operations')", [config.schema]);
  const localChecksums = readdirSync(path.resolve(process.cwd(), "supabase/migrations"))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort()
    .map((name) => ({ name, version: name.slice(0, name.indexOf("_")), checksum_sha256: createHash("sha256").update(readFileSync(path.resolve(process.cwd(), "supabase/migrations", name))).digest("hex") }));
  console.log(JSON.stringify({
    mode: "READ_ONLY_SHARED_PROJECT_INSPECTION",
    project: safeProjectIdentity(config),
    schemaObjects: schema.rows[0].objects,
    migrationLedger: ledger.rows,
    localMigrations: localChecksums,
    divergence: ledger.rows.flatMap((remote, index) => {
      const local = localChecksums[index];
      return !local || local.version !== remote.version || local.name !== remote.name || local.checksum_sha256 !== remote.checksum_sha256
        ? [{ version: remote.version, remoteName: remote.name, localName: local?.name ?? null, remoteChecksum: remote.checksum_sha256, localChecksum: local?.checksum_sha256 ?? null }]
        : [];
    }),
    accountingNameCollisionsOutsideChannelwright: foreignSchemas.rows[0].count,
  }, null, 2));
} finally {
  await database.end();
}
