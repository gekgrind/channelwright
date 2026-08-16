// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { channelStrategyResultSchema } from "@/domain/production-workflows";
import { StrategyResultReview } from "./channel-strategy-workspace";
import { approvedResearchArtifactFixture, strategyResultFixture } from "@/server/workflows/strategy-fixtures.test-helper";

afterEach(cleanup);

describe("CHANNEL_STRATEGY review surface", () => {
  it("makes upstream identity, recommendation, uncertainty, hypotheses, QA, usage, and lineage visible", () => {
    render(<StrategyResultReview
      result={strategyResultFixture}
      upstream={approvedResearchArtifactFixture}
      initialQa={{ passed: true, score: 88, findings: [], recommendation: "accept", deterministicChecksPassed: 12, deterministicChecksFailed: 0, modelUsage: { model: "qa-one", inputTokens: 10, outputTokens: 5, totalTokens: 15 } }}
      finalQa={{ passed: true, score: 92, findings: [{ severity: "warning", code: "BOUNDED_SAMPLE", message: "Retain the sample limitation.", evidenceIds: [] }], recommendation: "human_review_required", deterministicChecksPassed: 12, deterministicChecksFailed: 0, modelUsage: { model: "qa-two", inputTokens: 10, outputTokens: 5, totalTokens: 15 } }}
      revised
      budget={{ workflow_run_id: crypto.randomUUID(), parent_run_id: crypto.randomUUID(), root_run_id: crypto.randomUUID(), used_totals: { inputTokens: 200, outputTokens: 80 }, provider_identities: [], model_identities: ["synthesis-model", "qa-model"], exhaustion_code: null }}
      artifactHash={"c".repeat(64)}
      provenanceHash={"d".repeat(64)}
    />);
    expect(screen.getByText(strategyResultFixture.upstreamResearch.researchRunId)).toBeTruthy();
    expect(screen.getAllByText("PROCEED WITH CONDITIONS").length).toBe(2);
    expect(screen.getByText(/No private analytics or buyer-conversion data/)).toBeTruthy();
    expect(screen.getByText(/No revenue estimate is asserted/)).toBeTruthy();
    expect(screen.getByText(/BOUNDED_SAMPLE/)).toBeTruthy();
    expect(screen.getByText(/synthesis-model, qa-model/)).toBeTruthy();
    expect(screen.getByText(/bounded research sample, not a complete census/i)).toBeTruthy();
  });

  it("renders from the exact payload shape that finalize-strategy persists as run output", () => {
    // The workspace reads run.output_payload and parses it with this schema. Before
    // migration 202608140002 the engine never promoted finalize-strategy to run
    // output, so this parse failed and the studio stayed on the pending notice.
    const persistedRunOutput: unknown = JSON.parse(JSON.stringify(strategyResultFixture));
    const parsed = channelStrategyResultSchema.safeParse(persistedRunOutput);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    render(<StrategyResultReview result={parsed.data} upstream={approvedResearchArtifactFixture} revised={false} artifactHash={null} provenanceHash={null} />);
    expect(screen.getByText(parsed.data.upstreamResearch.researchRunId)).toBeTruthy();
    expect(screen.getByText(parsed.data.strategicThesis.channelConcept.statement)).toBeTruthy();
    // Artifact and provenance hashes are both assigned at the final human decision.
    expect(screen.getAllByText(/assigned at final human decision/)).toHaveLength(2);
  });

  it("treats a run without persisted output as not-yet-reviewable rather than rendering a partial strategy", () => {
    expect(channelStrategyResultSchema.safeParse(null).success).toBe(false);
    expect(channelStrategyResultSchema.safeParse(undefined).success).toBe(false);
    // An intermediate step output must never satisfy the final artifact contract.
    expect(channelStrategyResultSchema.safeParse({ attempted: false, reason: "no revision", result: strategyResultFixture }).success).toBe(false);
  });
});
