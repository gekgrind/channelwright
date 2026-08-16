import { NextResponse } from "next/server";
import { isMockMode } from "@/server/config";
import { MOCK_SESSION_COOKIE } from "@/server/mock-session";
import { createSupabaseServerClient } from "@/server/supabase";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  if (isMockMode()) response.cookies.delete(MOCK_SESSION_COOKIE);
  else await (await createSupabaseServerClient()).auth.signOut();
  return response;
}
