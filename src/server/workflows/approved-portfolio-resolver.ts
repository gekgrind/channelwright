import "server-only";

import {
  approvedVideoPortfolioArtifactSchema,
  approvedVideoPortfolioReferenceSchema,
  approvedVideoPortfolioSetSchema,
  videoIntelligenceScopeSchema,
  type ApprovedVideoPortfolioArtifact,
  type ApprovedVideoPortfolioReference,
  type ApprovedVideoPortfolioSet,
  type IntelligencePortfolioSelection,
} from "@/domain/production-workflows";
import { createSupabaseAdminClient } from "@/server/supabase-admin";
import { canonicalEquals } from "./canonical-json";

/**
 * Resolves the exact approved CHANNEL_VIDEO_PORTFOLIO artifacts a channel
 * learning record is built from. All invariant enforcement per cycle (owner
 * isolation, completed/finalized, human-approved, final-QA-valid,
 * finalizer-output equality, immutable/recomputed hashes, provenance hash,
 * lineage, latest/non-superseded, the `portfolioReady` downstream-eligibility
 * gate, the single-strategy anchor within the allocation, and transitive re-hash
 * plus supersession verification of the Strategy and Research anchors) lives in
 * the database RPC.
 *
 * The RPC deliberately returns a bounded server-extracted projection of each
 * allocation rather than the allocation artifact itself: the learning model never
 * receives a portfolio's mutable prose body, so an Intelligence run is
 * structurally incapable of restating or relitigating an approved allocation.
 *
 * This resolver's application-side responsibilities are a defense-in-depth
 * canonical-equality check between the references persisted at start_workflow
 * time and what the database resolves right now, the cross-cycle single-strategy
 * anchor check, and assembly of the compact intelligence-scope projection from
 * those authoritative per-cycle results.
 */
export interface ApprovedPortfolioResolver {
  resolve(selections: readonly IntelligencePortfolioSelection[], expected: readonly ApprovedVideoPortfolioReference[]): Promise<ApprovedVideoPortfolioSet>;
}

export class ApprovedPortfolioIntegrityError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Builds the compact lineage projection the record persists. Every fact is
 * derived from a server-authoritative cycle projection, never from model output,
 * so the durable artifact carries a re-derivable statement of what each cycle was
 * at synthesis time.
 */
export function buildIntelligenceScope(artifacts: readonly ApprovedVideoPortfolioArtifact[]) {
  return videoIntelligenceScopeSchema.parse({
    cycles: artifacts.map((artifact) => ({
      cycleId: artifact.cycle.cycleId,
      portfolioRunId: artifact.cycle.portfolioRunId,
      artifacts: artifact.artifacts,
    })),
    facts: artifacts.flatMap((artifact) => [
      { key: `fact:${artifact.cycle.cycleId}:committed-count`, value: artifact.cycle.committedCount, sourceRef: `portfolio:${artifact.cycle.portfolioRunId}/content/allocation/committedCount` },
      { key: `fact:${artifact.cycle.cycleId}:committed-at-risk-count`, value: artifact.cycle.committedAtRiskCount, sourceRef: `portfolio:${artifact.cycle.portfolioRunId}/content/viewerValueSafeguards/committedAtRiskCandidateIds` },
      { key: `fact:${artifact.cycle.cycleId}:confidence-ceiling`, value: artifact.cycle.globalConfidenceCeiling, sourceRef: `portfolio:${artifact.cycle.portfolioRunId}/portfolioConstraints/globalConfidenceCeiling` },
      { key: `fact:${artifact.cycle.cycleId}:strategy-anchor`, value: artifact.cycle.strategyRunId, sourceRef: `portfolio:${artifact.cycle.portfolioRunId}/portfolioScope/candidates/artifacts[CHANNEL_STRATEGY]` },
    ]),
  });
}

export class SupabaseApprovedPortfolioResolver implements ApprovedPortfolioResolver {
  async resolve(selections: readonly IntelligencePortfolioSelection[], expected: readonly ApprovedVideoPortfolioReference[]): Promise<ApprovedVideoPortfolioSet> {
    if (selections.length !== expected.length) {
      throw new ApprovedPortfolioIntegrityError("UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH", "The persisted approved Portfolio references do not cover the selected allocations.");
    }
    const client = createSupabaseAdminClient();
    const artifacts: ApprovedVideoPortfolioArtifact[] = [];
    for (const [index, selection] of selections.entries()) {
      const { data, error } = await client.rpc("resolve_approved_video_portfolio_artifact", {
        p_workflow_id: selection.portfolioWorkflowId,
        p_run_id: selection.portfolioRunId,
      });
      if (error) throw new ApprovedPortfolioIntegrityError("APPROVED_PORTFOLIO_INVALID", "An exact approved video-portfolio artifact could not be revalidated.");
      const artifact = approvedVideoPortfolioArtifactSchema.parse(data);
      const persisted = approvedVideoPortfolioReferenceSchema.parse(expected[index]);
      if (!canonicalEquals(artifact.reference, persisted)) {
        throw new ApprovedPortfolioIntegrityError("UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH", "A persisted approved Portfolio reference no longer matches authoritative database state.");
      }
      artifacts.push(artifact);
    }
    const runIds = new Set(artifacts.map((artifact) => artifact.cycle.portfolioRunId));
    if (runIds.size !== artifacts.length) {
      throw new ApprovedPortfolioIntegrityError("UPSTREAM_PORTFOLIO_DUPLICATE", "The same approved Portfolio run cannot appear twice in one channel learning record.");
    }
    // The channel identity itself. Cycles that descend from different approved
    // strategies are not one channel's history, and a "channel-wide" learning
    // synthesized across them would be comparing two different strategic bets.
    // The database enforces this at start; re-checked here because a strategy
    // successor could have landed between start and the first worker step.
    const strategyRunIds = new Set(artifacts.map((artifact) => artifact.cycle.strategyRunId));
    if (strategyRunIds.size !== 1) {
      throw new ApprovedPortfolioIntegrityError("UPSTREAM_PORTFOLIO_STRATEGY_ANCHOR_MISMATCH", "Every selected allocation must descend from the same approved CHANNEL_STRATEGY run.");
    }
    return approvedVideoPortfolioSetSchema.parse({ artifacts, intelligenceScope: buildIntelligenceScope(artifacts) });
  }
}
