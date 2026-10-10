// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { channelStrategyResultSchema } from "@/domain/production-workflows";
import { ChannelStrategyWorkspace, StrategyResultReview } from "./channel-strategy-workspace";
import { approvedResearchArtifactFixture, strategyResultFixture } from "@/server/workflows/strategy-fixtures.test-helper";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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

describe("CHANNEL_STRATEGY start", () => {
  const RESEARCH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const RESEARCH_RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
  const researchOutput = { concept: { normalizedConcept: "Hidden systems behind everyday businesses" }, recommendation: { verdict: "PROCEED_WITH_CONDITIONS" } };

  it("identifies the approved research in plain language instead of asking for raw UUIDs", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ operationResult: { workflowId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1" } }), { status: 202 });
      if (url === "/api/workflows") return new Response(JSON.stringify({ workflowEngine: { workflows: [], runs: [], pendingApprovals: [] } }), { status: 200 });
      if (url.includes(RESEARCH_ID)) return new Response(JSON.stringify({ workflow: { id: RESEARCH_ID, status: "COMPLETED", created_at: "2026-08-13T10:00:00.000Z", current_run_id: RESEARCH_RUN_ID }, runs: [{ id: RESEARCH_RUN_ID, status: "COMPLETED", output_payload: researchOutput, error_code: null, created_at: "2026-08-13T10:00:00.000Z", completed_at: "2026-08-13T11:00:00.000Z" }], steps: [], approvals: [], researchBudgets: [] }), { status: 200 });
      return new Response(JSON.stringify({ workflow: { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", status: "QUEUED", created_at: "2026-08-14T10:00:00.000Z" }, runs: [], steps: [], approvals: [], researchBudgets: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<ChannelStrategyWorkspace initial={{ workflows: [{ id: RESEARCH_ID, workflow_type: "CHANNEL_RESEARCH", status: "COMPLETED", created_at: "2026-08-13T10:00:00.000Z", current_run_id: RESEARCH_RUN_ID }], runs: [], pendingApprovals: [] }} />);

    const card = await screen.findByRole("region", { name: /selected approved research/i });
    expect(card).toHaveTextContent("Hidden systems behind everyday businesses");
    expect(card).toHaveTextContent(/verdict: proceed with conditions/i);
    expect(screen.queryByRole("textbox", { name: /workflow id|run id/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /start bounded strategy/i }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse(String((post?.[1] as RequestInit).body)).input).toEqual({ researchWorkflowId: RESEARCH_ID, researchRunId: RESEARCH_RUN_ID });
  });
});
