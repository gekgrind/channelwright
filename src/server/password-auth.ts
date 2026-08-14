import type { PasswordLoginInput } from "@/domain/password-auth";

interface PasswordAuthClient {
  auth: {
    signInWithPassword(credentials: {
      email: string;
      password: string;
      options: { captchaToken: string };
    }): Promise<{ error: { message?: string; code?: string } | null }>;
  };
}

export async function signInWithCaptcha(client: PasswordAuthClient, credentials: PasswordLoginInput) {
  if (!credentials.captchaToken) throw new Error("CAPTCHA_TOKEN_REQUIRED");
  return client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
    options: { captchaToken: credentials.captchaToken },
  });
}

