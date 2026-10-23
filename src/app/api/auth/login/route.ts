import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { classifySupabaseAuthError, parsePasswordLogin, type PasswordLoginErrorCode } from "@/domain/password-auth";
import { isMockMode } from "@/server/config";
import { MOCK_SESSION_COOKIE, signMockSession } from "@/server/mock-session";
import { logFailure } from "@/server/observability";
import { signInWithCaptcha } from "@/server/password-auth";
import { createSupabaseServerClient } from "@/server/supabase";

function loginRedirect(path: "/studio" | `/login?error=${PasswordLoginErrorCode}`) {
  // Behind TLS termination, request.url can contain the internal Next.js host.
  // A relative Location keeps the browser on its own origin under form-action 'self'.
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const mock = isMockMode();
  const parsed = parsePasswordLogin({ email: form.get("email"), password: form.get("password"), captchaToken: form.get("captchaToken") || undefined }, !mock);
  if (!parsed.success) {
    const error = !mock && !form.get("captchaToken") ? "captcha_required" : "invalid";
    return loginRedirect(`/login?error=${error}`);
  }

  if (mock) {
    const id = createHash("sha256").update(parsed.data.email.toLowerCase()).digest("hex").slice(0, 24);
    const value = signMockSession({ id, email: parsed.data.email.toLowerCase() });
    const response = loginRedirect("/studio");
    response.cookies.set(MOCK_SESSION_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
    return response;
  }

  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await signInWithCaptcha(supabase, parsed.data);
    const code = classifySupabaseAuthError(error);
    return loginRedirect(code ? `/login?error=${code}` : "/studio");
  } catch (error) {
    logFailure("password_login_provider_unavailable", error);
    return loginRedirect("/login?error=unavailable");
  }
}
