import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode } from "@/server/config";
import { createSupabaseServerClient } from "@/server/supabase";

const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(6) });

export async function POST(request: Request) {
  const form = await request.formData();
  const parsed = credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return NextResponse.redirect(new URL("/login?error=invalid", request.url), 303);

  if (isMockMode()) {
    const id = createHash("sha256").update(parsed.data.email.toLowerCase()).digest("hex").slice(0, 24);
    const value = Buffer.from(JSON.stringify({ id, email: parsed.data.email.toLowerCase() })).toString("base64url");
    const response = NextResponse.redirect(new URL("/studio", request.url), 303);
    response.cookies.set("cw_mock_user", value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
    return response;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  return NextResponse.redirect(new URL(error ? "/login?error=auth" : "/studio", request.url), 303);
}
