import { createHash } from "node:crypto";
import { describeAuthException, describeSupabaseAuthError, parsePasswordLogin, type PasswordLoginErrorCode } from "@/domain/password-auth";
import { isMockMode } from "@/server/config";
import { MOCK_SESSION_COOKIE, signMockSession } from "@/server/mock-session";
import { logEvent, logFailure } from "@/server/observability";
import { signInWithCaptcha } from "@/server/password-auth";
import { sameOriginRedirect } from "@/server/same-origin-redirect";
import { createSupabaseServerClient } from "@/server/supabase";

// A relative Location keeps the browser on its own origin under form-action 'self'.
const loginRedirect = (path: "/studio" | `/login?error=${PasswordLoginErrorCode}`) => sameOriginRedirect(path);

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
    if (!error) return loginRedirect("/studio");
    // Only the provider's code, status and our classification: never credentials, tokens, cookies or provider text.
    const rejection = describeSupabaseAuthError(error);
    logEvent("password_login_rejected", rejection);
    return loginRedirect(`/login?error=${rejection.classification ?? "auth"}`);
  } catch (error) {
    const { errorName, providerStatus } = describeAuthException(error);
    logFailure("password_login_provider_unavailable", { message: errorName }, { providerStatus });
    return loginRedirect("/login?error=unavailable");
  }
}
