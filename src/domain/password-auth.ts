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

export function classifySupabaseAuthError(error: { message?: string; code?: string } | null): PasswordLoginErrorCode | null {
  if (!error) return null;
  const detail = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (detail.includes("captcha")) return "captcha_failed";
  if (detail.includes("fetch") || detail.includes("network") || detail.includes("unavailable")) return "unavailable";
  return "auth";
}

