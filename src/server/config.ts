export const isMockMode = () => process.env.NODE_ENV !== "production"
  && (process.env.CHANNELWRIGHT_MOCK_MODE === "true"
    || (process.env.NODE_ENV === "development" && process.env.CHANNELWRIGHT_MOCK_MODE !== "false"));

export function assertSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  return { url, anonKey };
}
