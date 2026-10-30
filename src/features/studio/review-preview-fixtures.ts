import type { ReviewKindKey } from "./review-kinds";
import type { DecisionOutcome } from "./workflow-api";

/*
 * Plain (non-client) module: the server page validates query parameters
 * against these. Importing them from the "use client" harness would hand the
 * server opaque client references instead of the objects.
 */

/** The kinds the Phase B review boards cover; only Performance has a production screen today. */
export const PREVIEW_KINDS = {
  performance: "CHANNEL_VIDEO_PERFORMANCE",
  diagnosis: "CHANNEL_VIDEO_DIAGNOSIS",
  decision: "CHANNEL_VIDEO_DECISION",
  experiment: "CHANNEL_VIDEO_EXPERIMENT",
} as const satisfies Record<string, ReviewKindKey>;
export type PreviewKind = keyof typeof PREVIEW_KINDS;

/** Simulated server answers, so every dialog state can be inspected without a workflow. */
export const PREVIEW_OUTCOMES = {
  success: { ok: true },
  stale: { ok: false, reason: "stale", message: "Nothing was recorded by this request. This approval can no longer be decided from this screen: it was most likely already decided, for example in another tab, or replaced by a newer version. Reload to see its current state." },
  network: { ok: false, reason: "unconfirmed", message: "Channelwright couldn't confirm whether this decision was recorded. It may or may not have been saved. Reload to see the current state before deciding again." },
  unauthorized: { ok: false, reason: "unauthorized", message: "Nothing was recorded: you need to sign in again before deciding." },
} as const satisfies Record<string, DecisionOutcome>;
export type PreviewOutcome = keyof typeof PREVIEW_OUTCOMES;

export const isPreviewKind = (value: unknown): value is PreviewKind => typeof value === "string" && Object.hasOwn(PREVIEW_KINDS, value);
export const isPreviewOutcome = (value: unknown): value is PreviewOutcome => typeof value === "string" && Object.hasOwn(PREVIEW_OUTCOMES, value);
