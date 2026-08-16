// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { channelContentIntelligenceResultSchema } from "@/domain/production-workflows";
import { ContentBacklogReview, ViewerValuePanel } from "./content-intelligence-workspace";
import { contentResultFixture, discoveryBundleFixture, viewerValueFixture, contentTopicFixture } from "@/server/workflows/content-fixtures.test-helper";

afterEach(cleanup);

const renderReview = (result = contentResultFixture) => render(<ContentBacklogReview
  result={result}
  discovery={discoveryBundleFixture}
  initialQa={{ passed: true, score: 88, findings: [], recommendation: "accept", deterministicChecksPassed: 22, deterministicChecksFailed: 0, modelUsage: { model: "qa-one", inputTokens: 10, outputTokens: 5, totalTokens: 15 } }}
  finalQa={{ passed: true, score: 91, findings: [{ severity: "warning", code: "BOUNDED_SAMPLE", message: "Retain the sample limitation.", evidenceIds: [] }], recommendation: "human_review_required", deterministicChecksPassed: 22, deterministicChecksFailed: 0, modelUsage: { model: "qa-two", inputTokens: 10, outputTokens: 5, totalTokens: 15 } }}
  revised={false}
  budget={{ workflow_run_id: crypto.randomUUID(), parent_run_id: null, root_run_id: crypto.randomUUID(), used_totals: { inputTokens: 4000, outputTokens: 900, searches: 2, providerQuotaUnits: 202 }, provider_identities: ["YOUTUBE_DATA_API_V3"], model_identities: ["synthesis-model", "qa-model"], exhaustion_code: null }}
  artifactHash={null}
  provenanceHash={null}
  upstreamStrategyRunId={contentResultFixture.upstreamStrategy.strategyRunId}
/>);

describe("CONTENT_INTELLIGENCE review surface", () => {
  it("renders from the exact payload shape finalize-content-intelligence persists as run output", () => {
    const parsed = channelContentIntelligenceResultSchema.safeParse(JSON.parse(JSON.stringify(contentResultFixture)));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    renderReview(parsed.data);
    expect(screen.getByText(contentResultFixture.recommendedNextAction)).toBeTruthy();
  });

  it("makes the next-video recommendation prominent with its reasons", () => {
    renderReview();
    expect(screen.getByText("Make this next")).toBeTruthy();
    const heading = screen.getAllByText(contentResultFixture.topics[0].workingConcept);
    expect(heading.length).toBeGreaterThan(0);
    for (const reason of contentResultFixture.nextVideoRecommendation.reasons) expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.getByText(/no view, subscriber, or revenue prediction is asserted/i)).toBeTruthy();
  });

  it("renders the ranked backlog with every topic and its tier", () => {
    renderReview();
    for (const entry of contentResultFixture.backlog) {
      expect(screen.getByText(entry.inclusionRationale)).toBeTruthy();
      expect(screen.getAllByText(entry.tier).length).toBeGreaterThan(0);
    }
  });

  it("renders the full score decomposition rather than a bare number", () => {
    renderReview();
    const score = contentResultFixture.scores[0];
    for (const component of score.components) {
      expect(screen.getAllByText(component.dimension.replaceAll("_", " ").toLowerCase()).length).toBeGreaterThan(0);
      expect(screen.getAllByText(component.rationale).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(score.weightedTotal.toFixed(1)).length).toBeGreaterThan(0);
  });

  it("shows why Channelwright believes an idea deserves to exist", () => {
    render(<ViewerValuePanel topic={contentTopicFixture()} />);
    const contract = contentTopicFixture().viewerValue.contract;
    expect(screen.getByText("Viewer value: PASS")).toBeTruthy();
    expect(screen.getByText(contract.intendedViewer)).toBeTruthy();
    expect(screen.getByText(contract.valuePromise.statement)).toBeTruthy();
    expect(screen.getByText(contract.valuePromise.viewerOutcome)).toBeTruthy();
    expect(screen.getByText(contract.originalContribution.statement)).toBeTruthy();
    for (const label of ["Specificity", "Originality", "Differentiation", "Evidence", "Actionability", "Trust", "Sustainability"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("surfaces a failing gate and its blocking integrity finding", () => {
    const rejected = contentTopicFixture({
      viewerValue: viewerValueFixture({
        gate: "REJECT",
        gateReasons: ["The premise depends on an invented customer outcome."],
        integrityFindings: [{ risk: "FABRICATED_TESTIMONIAL", label: null, severity: "blocking", explanation: "Relies on an invented customer story.", evidenceIds: [] }],
      }),
    });
    render(<ViewerValuePanel topic={rejected} />);
    expect(screen.getByText("Viewer value: REJECT")).toBeTruthy();
    expect(screen.getByText(/Relies on an invented customer story/)).toBeTruthy();
    expect(screen.getByText(/blocking · FABRICATED TESTIMONIAL/)).toBeTruthy();
  });

  it("distinguishes search observations from resource evidence and shows provenance", () => {
    renderReview();
    expect(screen.getAllByText("Search observation").length).toBe(2);
    expect(screen.getByText(contentResultFixture.upstreamStrategy.strategyRunId, { exact: false })).toBeTruthy();
    expect(screen.getByText(/relevance, not demand or search volume/i)).toBeTruthy();
  });

  it("reports independent QA, usage, models, and lineage", () => {
    renderReview();
    expect(screen.getByText(/BOUNDED_SAMPLE/)).toBeTruthy();
    expect(screen.getByText(/synthesis-model, qa-model/)).toBeTruthy();
    const footer = screen.getByText(/automated revision/);
    expect(within(footer).getByText("4000")).toBeTruthy();
  });
});
