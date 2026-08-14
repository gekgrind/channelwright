// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
