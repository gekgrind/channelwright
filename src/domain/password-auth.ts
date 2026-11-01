import { z } from "zod";

const baseCredentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(6).max(1_024),
}).strict();

export const captchaTokenSchema = z.string().trim().min(10).max(4_096);

export function parsePasswordLogin(input: unknown, captchaRequired: boolean) {
  return baseCredentialsSchema.extend({
    captchaToken: captchaRequired ? captchaTokenSchema : captchaTokenSchema.optional(),
  }).safeParse(input);
}

export type PasswordLoginInput = z.infer<typeof baseCredentialsSchema> & { captchaToken?: string };

export type PasswordLoginErrorCode = "invalid" | "captcha_required" | "captcha_failed" | "auth" | "unavailable";

export interface SupabaseAuthErrorLike { message?: string; code?: string; status?: number; name?: string }

export function classifySupabaseAuthError(error: SupabaseAuthErrorLike | null): PasswordLoginErrorCode | null {
  if (!error) return null;
  const detail = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (detail.includes("captcha")) return "captcha_failed";
  if (detail.includes("fetch") || detail.includes("network") || detail.includes("unavailable")) return "unavailable";
  return "auth";
}

const PROVIDER_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const providerStatus = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;

/**
 * Log-safe description of a Supabase auth rejection. Provider codes are a closed snake_case vocabulary
 * (invalid_credentials, captcha_failed, ...); anything else is reduced to "unrecognized". The free-text message is
 * never included because it can echo request input.
 */
export function describeSupabaseAuthError(error: SupabaseAuthErrorLike) {
  const code = typeof error.code === "string" && error.code ? (PROVIDER_CODE.test(error.code) ? error.code : "unrecognized") : undefined;
  return { classification: classifySupabaseAuthError(error), providerCode: code, providerStatus: providerStatus(error.status) };
}

/** Log-safe description of a thrown auth failure: its class name and HTTP status only, never its message. */
export function describeAuthException(error: unknown) {
  const carrier = typeof error === "object" && error !== null ? error as { name?: unknown; status?: unknown } : {};
  const name = typeof carrier.name === "string" && ERROR_NAME.test(carrier.name) ? carrier.name : "Error";
  return { errorName: name, providerStatus: providerStatus(carrier.status) };
}

