// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppShell } from "@/features/command-center/app-shell";
import { CommandCenter } from "@/features/command-center/command-center";
import { toCommandCenterView } from "./command-center-view";
import { LineageBuilder } from "./lineage-fixtures.test-helper";
import { resolveLineage } from "./resolve-lineage";

afterEach(cleanup);

/** The live mapper's view rendered through the unchanged Command Center UI. */
function renderLive(builder: LineageBuilder, channelKey: string | null) {
  const rows = builder.rows();
  const view = toCommandCenterView({ rows, graph: resolveLineage(rows), approvalsError: null, outputs: { status: "ok", outputs: { strategy: {}, content: {}, performance: {} } } }, channelKey, "2026-10-30T12:00:00.000Z");
  render(<AppShell channelLabel="" channelDetail="" pendingCount={view.globalPendingCount} channels={[]} commandCenterHref="/c"><CommandCenter view={view} /></AppShell>);
  return view;
}

describe("live Command Center rendering", () => {
  it("on the zero-channel landing, names and counts pre-research and unattributed work without ranking it", () => {
    const builder = new LineageBuilder();
    builder.pending(builder.conceptValidation());
    const broken = builder.chain("CHANNEL_VIDEO_BRIEF");
    delete builder.input(broken.CHANNEL_STRATEGY).approvedResearchReference;
    // The research root of the broken chain is still a channel; render the landing for an account without one.
    builder.workflows.splice(builder.workflows.findIndex((workflow) => workflow.id === broken.CHANNEL_RESEARCH.workflowId), 1);
    const view = renderLive(builder, null);

    expect(screen.getByRole("heading", { level: 1, name: "Earn the right to make a video first." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Research a channel opportunity" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Unattributed · 1 video, 1 gate");
    const unattributed = within(screen.getByRole("list", { name: "Unattributed work" })).getAllByRole("listitem").map((item) => item.textContent);
    expect(unattributed).toContainEqual(expect.stringMatching(/^GateConcept validation v1 · Workflow [0-9a-f]{8}Not attributed: it is a pre-research concept validation and belongs to no channel$/));
    expect(unattributed).toContainEqual(expect.stringMatching(/^VideoUntitled videoNot attributed: /));
    expect(within(screen.getByRole("list", { name: "Not ranked" })).getByText(/Review Concept validation v1/)).toBeInTheDocument();
    expect(view.globalPendingCount).toBe(1);
    expect(screen.getByText("1", { selector: ".cw-badge" })).toBeInTheDocument();
  });

  it("states that measurement is unranked because no publication date is recorded", () => {
    const builder = new LineageBuilder();
    const chain = builder.chain("CHANNEL_VIDEO_RELEASE");
    renderLive(builder, chain.CHANNEL_RESEARCH.workflowId);
    expect(within(screen.getByRole("list", { name: "Not ranked" })).getByText("No publication date is recorded, so measurement is not ranked.")).toBeInTheDocument();
  });
});
