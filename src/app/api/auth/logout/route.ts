import { describeSupabaseAuthError } from "@/domain/password-auth";
import { isMockMode } from "@/server/config";
import { MOCK_SESSION_COOKIE } from "@/server/mock-session";
import { logEvent } from "@/server/observability";
import { sameOriginRedirect } from "@/server/same-origin-redirect";
import { createSupabaseServerClient } from "@/server/supabase";

export async function POST() {
  const response = sameOriginRedirect("/login");
  if (isMockMode()) response.cookies.delete(MOCK_SESSION_COOKIE);
  else {
    const { error } = await (await createSupabaseServerClient()).auth.signOut();
    if (error) logEvent("logout_provider_rejected", describeSupabaseAuthError(error));
  }
  return response;
}
