export const CHANNELWRIGHT_SCHEMA = "channelwright";

export interface SharedSupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  databaseUrl: string;
  projectRef: string;
  schema: typeof CHANNELWRIGHT_SCHEMA;
  databaseCa: string;
}

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required shared-project gate variable: ${name}`);
  return value;
};

export function readSharedSupabaseConfig(): SharedSupabaseConfig {
  const url = required("CHANNELWRIGHT_SHARED_SUPABASE_URL");
  const anonKey = required("CHANNELWRIGHT_SHARED_SUPABASE_ANON_KEY");
  const serviceRoleKey = required("CHANNELWRIGHT_SHARED_SUPABASE_SERVICE_ROLE_KEY");
  const databaseUrl = required("CHANNELWRIGHT_SHARED_DATABASE_URL");
  const projectRef = required("CHANNELWRIGHT_SHARED_PROJECT_REF").toLowerCase();
  const confirmation = required("CHANNELWRIGHT_SHARED_CONFIRM_PROJECT_REF").toLowerCase();
  const schemaConfirmation = required("CHANNELWRIGHT_SHARED_CONFIRM_SCHEMA").toLowerCase();
  const databaseCaPath = required("CHANNELWRIGHT_SHARED_DATABASE_CA_PATH");

  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("CHANNELWRIGHT_SHARED_PROJECT_REF must be a 20-character Supabase project ref");
  if (confirmation !== projectRef) throw new Error("Shared project confirmation does not match the project ref");
  if (schemaConfirmation !== CHANNELWRIGHT_SCHEMA) throw new Error(`Shared schema confirmation must exactly equal ${CHANNELWRIGHT_SCHEMA}`);

  const apiUrl = new URL(url);
  if (apiUrl.protocol !== "https:" || apiUrl.hostname !== `${projectRef}.supabase.co`) {
    throw new Error("Shared Supabase URL does not match the confirmed project ref");
  }

  const database = new URL(databaseUrl);
  if (database.protocol !== "postgres:" && database.protocol !== "postgresql:") throw new Error("Shared database URL must use postgres:// or postgresql://");
  const databaseHost = database.hostname.toLowerCase();
  const databaseUser = decodeURIComponent(database.username).toLowerCase();
  const directDatabase = databaseHost === `db.${projectRef}.supabase.co` && databaseUser === "postgres";
  const pooledDatabase = (databaseHost === "pooler.supabase.com" || databaseHost.endsWith(".pooler.supabase.com")) && databaseUser === `postgres.${projectRef}`;
  if (!directDatabase && !pooledDatabase) throw new Error("Shared database URL is not visibly bound to an exact recognized Supabase host and the confirmed project ref");

  return { url: apiUrl.origin, anonKey, serviceRoleKey, databaseUrl, projectRef, schema: CHANNELWRIGHT_SCHEMA, databaseCa: databaseCaPath };
}

export function safeProjectIdentity(config: SharedSupabaseConfig) {
  return { projectRef: config.projectRef, host: new URL(config.url).hostname, schema: config.schema, mode: "SHARED_PROJECT_ISOLATED_SCHEMA" };
}
