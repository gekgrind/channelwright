import { createClient } from "@supabase/supabase-js";
import { assertSupabaseConfig, SUPABASE_DB_SCHEMA } from "./config";

export function createSupabaseAdminClient() {
  const { url } = assertSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required by the isolated media worker and server-side storage adapter");
  return createClient(url, serviceRoleKey, {
    db: { schema: SUPABASE_DB_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
