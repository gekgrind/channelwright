import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isMockMode } from "./config";
import { createSupabaseServerClient } from "./supabase";

export interface AuthenticatedUser { id: string; email: string; mode: "mock" | "supabase"; }

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  if (isMockMode()) {
    const value = (await cookies()).get("cw_mock_user")?.value;
    if (!value) return null;
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { id: string; email: string };
      return { ...parsed, mode: "mock" };
    } catch { return null; }
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
