import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { isMockMode } from "@/server/config";
import { ReviewPreview } from "@/features/studio/review-preview";
import { isPreviewKind, isPreviewOutcome } from "@/features/studio/review-preview-fixtures";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review screen preview" };

/**
 * Phase B fixture harness for the shared ReviewScreen. Outside fixture mode
 * this route does not exist. It reads no workflow data and sends no decision.
 */
export default async function ReviewPreviewPage({ searchParams }: { searchParams: Promise<{ kind?: string; outcome?: string }> }) {
  if (!isMockMode()) notFound();
  await requireUser();
  const { kind, outcome } = await searchParams;
  return <ReviewPreview kind={isPreviewKind(kind) ? kind : "performance"} outcome={isPreviewOutcome(outcome) ? outcome : "success"} />;
}
