export const isMockMode = () => process.env.NODE_ENV !== "production"
  && (process.env.CHANNELWRIGHT_MOCK_MODE === "true"
    || (process.env.NODE_ENV === "development" && process.env.CHANNELWRIGHT_MOCK_MODE !== "false"));

/**
 * Live Command Center rollout gate, step one: the exact flag, never in fixture
 * mode. Checked before authentication, so it cannot depend on the user.
 */
export const isLiveCommandCenterOn = () => !isMockMode() && process.env.CHANNELWRIGHT_LIVE_COMMAND_CENTER === "on";

const ALLOWLIST_ENTRY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Step two, after sign-in: the optional user allowlist. Unset admits every
 * signed-in user; set but empty admits nobody; any entry that is not a UUID
 * makes the whole list invalid, which also admits nobody (fail closed).
 */
export function isLiveCommandCenterUser(userId: string) {
  const raw = process.env.CHANNELWRIGHT_LIVE_COMMAND_CENTER_USERS;
  if (raw === undefined) return true;
  const entries = raw.split(",").map((entry) => entry.trim().toLowerCase());
  if (entries.some((entry) => !ALLOWLIST_ENTRY.test(entry))) return false;
  return entries.includes(userId.trim().toLowerCase());
}

export const SUPABASE_DB_SCHEMA = "channelwright";

export function assertSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  return { url, anonKey };
}

export function boundedInteger(value: string | undefined, fallback: number, min: number, max: number, name?: string) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name ? `${name} must be` : "Expected"} an integer between ${min} and ${max}`);
  return parsed;
}

export const boundedIntegerEnv = (name: string, fallback: number, min: number, max: number) =>
  boundedInteger(process.env[name], fallback, min, max, name);

export function workflowWorkerConfig() {
  return {
    workerId: process.env.WORKFLOW_WORKER_ID?.trim() ?? "",
    leaseSeconds: boundedInteger(process.env.WORKFLOW_LEASE_SECONDS, 120, 30, 900),
    pollIntervalMs: boundedInteger(process.env.WORKFLOW_POLL_INTERVAL_MS, 2_000, 100, 60_000),
  };
}
