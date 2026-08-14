import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { isMockMode } from "@/server/config";
import { SupabaseObjectStorage } from "@/server/media/supabase-storage";
import { createSupabaseServerClient } from "@/server/supabase";

const paramsSchema = z.object({ versionId: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ versionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isMockMode()) return NextResponse.json({ error: "Local filesystem evidence never issues signed URLs" }, { status: 501 });
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid asset version" }, { status: 422 });
  const requestedExpiry = Number(new URL(request.url).searchParams.get("expires") ?? 300);
  if (!Number.isInteger(requestedExpiry) || requestedExpiry < 1 || requestedExpiry > 900) return NextResponse.json({ error: "Signed URL expiry must be 1 to 900 seconds" }, { status: 422 });
  const client = await createSupabaseServerClient();
  const result = await client.from("media_asset_versions").select("owner_id,storage_key,status").eq("id", parsed.data.versionId).maybeSingle();
  if (result.error || !result.data || result.data.owner_id !== user.id) return NextResponse.json({ error: "Asset version not found" }, { status: 404 });
  if (result.data.status !== "READY") return NextResponse.json({ error: "Only ready asset versions can be signed" }, { status: 409 });
  const signedUrl = await new SupabaseObjectStorage().createSignedReadUrl({ ownerId: user.id, key: result.data.storage_key, expiresInSeconds: requestedExpiry });
  return NextResponse.json({ signedUrl, expiresInSeconds: requestedExpiry }, { headers: { "cache-control": "no-store" } });
}
