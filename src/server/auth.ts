import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isMockMode } from "./config";
import { MOCK_SESSION_COOKIE, verifyMockSession } from "./mock-session";
import { createSupabaseServerClient } from "./supabase";

export interface AuthenticatedUser { id: string; email: string; mode: "mock" | "supabase"; }

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  if (isMockMode()) {
    const session = verifyMockSession((await cookies()).get(MOCK_SESSION_COOKIE)?.value);
    return session ? { ...session, mode: "mock" } : null;
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ? { id: user.id, email: user.email, mode: "supabase" } : null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
