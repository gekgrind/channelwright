import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { assertSupabaseConfig, SUPABASE_DB_SCHEMA } from "./config";

export async function createSupabaseServerClient() {
  const { url, anonKey } = assertSupabaseConfig();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    db: { schema: SUPABASE_DB_SCHEMA },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* Server Components cannot write cookies. */ }
      },
    },
  });
}
