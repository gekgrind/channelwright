export const isMockMode = () => process.env.NODE_ENV !== "production"
  && (process.env.CHANNELWRIGHT_MOCK_MODE === "true"
    || (process.env.NODE_ENV === "development" && process.env.CHANNELWRIGHT_MOCK_MODE !== "false"));

export const SUPABASE_DB_SCHEMA = "channelwright";

export function assertSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  return { url, anonKey };
}

const boundedInteger = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Expected an integer between ${min} and ${max}`);
  return parsed;
};

export function workflowWorkerConfig() {
  return {
    workerId: process.env.WORKFLOW_WORKER_ID?.trim() ?? "",
    leaseSeconds: boundedInteger(process.env.WORKFLOW_LEASE_SECONDS, 120, 30, 900),
    pollIntervalMs: boundedInteger(process.env.WORKFLOW_POLL_INTERVAL_MS, 2_000, 100, 60_000),
  };
}
