// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CommandCenter, age, formatDate, type ActionTargets } from "./command-center";
import { AppShell } from "./app-shell";
import { FixtureRecord, findFixtureItem, fixtureTargets } from "./fixture-record";
import { degradedScenario, firstRunScenario, operatingScenario } from "./fixtures";
import type { CommandCenterView } from "./model";

afterEach(cleanup);

const renderView = (view = operatingScenario, targets?: ActionTargets) => render(<AppShell channelLabel="Budget mechanical keyboards" channelDetail="Strategy v3" pendingCount={view.globalPendingCount}><CommandCenter view={view} targets={targets} /></AppShell>);
const hrefs = () => screen.getAllByRole("link").map((link) => link.getAttribute("href"));

describe("Command Center", () => {
  it("renders one main landmark, one h1, and the sections in priority order", () => {
    renderView();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Budget mechanical keyboards" })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Review Packaging v1 · Lubing $8 switches: worth it?",
      "02Needs your decision",
      "03Videos in flight",
      "04What we're learning",
      "05Recent performance",
    ]);
  });

  it("names the exact artifact and version for every attributed gate, and never offers to approve inline", () => {
    renderView();
    const gates = screen.getByRole("region", { name: "02Needs your decision" });
    expect(within(gates).getByText("Script · v2")).toBeInTheDocument();
    expect(within(gates).getByText("Supersedes v1")).toBeInTheDocument();
    expect(within(gates).getByText("No review screen yet")).toBeInTheDocument();
    expect(within(gates).queryByText("Keychron vs. no-name: same board?")).not.toBeInTheDocument();
    expect(within(gates).queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });

  it("states unattributed work instead of guessing where it belongs", () => {
    renderView();
    expect(screen.getByRole("note")).toHaveTextContent("Unattributed · 1 video, 1 gate");
    expect(screen.getByRole("note")).toHaveTextContent("Nothing was guessed.");
  });

  it("explains deferred and unranked work behind the Next Decision", () => {
    renderView();
    expect(screen.getByText(/Why this, not something else\? · 5 more/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Not ranked" })).toHaveTextContent("No rule defines when measurement is due");
    expect(screen.getByRole("link", { name: /Review Packaging v1/ })).toHaveAttribute("href", "/studio#stage-packaging");
  });

  it("describes every stage track in words, not color alone", () => {
    renderView();
    expect(screen.getByRole("img", { name: "4 of 8 stages done. Performance: your move." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "0 of 8 stages done. Brief: running." })).toBeInTheDocument();
  });

  it("labels performance as operator-entered", () => {
    renderView();
    expect(screen.getByText("Entered by you · YouTube not connected")).toBeInTheDocument();
    expect(screen.getByText("Not entered")).toBeInTheDocument();
  });

  it("keeps unbuilt destinations visible but never as dead links", () => {
    renderView();
    const nav = screen.getByRole("navigation", { name: "Studio" });
    expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/studio/preview", "/studio"]);
    expect(within(nav).getByText("Strategy")).toBeInTheDocument();
    expect(within(nav).getByText("4", { exact: false })).toBeInTheDocument();
  });

  it("shows first-run guidance and empty states that say what fills them", () => {
    renderView(firstRunScenario);
    expect(screen.getByRole("heading", { level: 1, name: "Earn the right to make a video first." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Research a channel opportunity" })).toBeInTheDocument();
    expect(screen.getByText(/Videos start from topics in an approved content plan/)).toBeInTheDocument();
  });

  it("isolates section failures, unavailable capabilities, and loading", () => {
    renderView(degradedScenario);
    expect(screen.getByRole("alert")).toHaveTextContent("Pending approvals did not load.");
    expect(screen.getByRole("alert")).toHaveTextContent("Request ID cw_req_8f2a41c0");
    expect(screen.getByText("Not available yet · D3 · D8")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "05Recent performance" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(/a pending decision may be missing/)).toBeInTheDocument();
    expect(screen.getByText("pending count unavailable", { exact: false }).parentElement).toHaveClass("cw-badge-unknown");
    expect(screen.getByRole("heading", { level: 2, name: /Resolve failed Brief v2/ })).toBeInTheDocument();
  });
});

describe("age", () => {
  it("is relative to the view's evaluation time", () => {
    expect(age("2026-10-24T14:56:00.000Z", "2026-10-24T15:00:00.000Z")).toBe("4m");
    expect(age("2026-10-24T10:00:00.000Z", "2026-10-24T15:00:00.000Z")).toBe("5h");
    expect(age("2026-10-09T14:00:00.000Z", "2026-10-24T15:00:00.000Z")).toBe("15d");
  });

  it("shows a dash for invalid times and zero for future ones", () => {
    expect(age("not a date", "2026-10-24T15:00:00.000Z")).toBe("—");
    expect(age("2026-10-24T14:56:00.000Z", "garbage")).toBe("—");
    expect(age("2026-12-01T00:00:00.000Z", "2026-10-24T15:00:00.000Z")).toBe("0m");
    expect(formatDate("2026-02-30T00:00:00Z")).toBe("—");
  });
});

describe("Command Center with invalid timestamps", () => {
  it("renders instead of throwing, and shows no NaN", () => {
    const broken: CommandCenterView = {
      ...operatingScenario,
      asOf: "garbage",
      channel: operatingScenario.channel.status === "ready" ? { status: "ready", data: { ...operatingScenario.channel.data, strategyApprovedAt: "bad" } } : operatingScenario.channel,
    };
    renderView(broken);
    expect(screen.getByText("v3 · —")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("NaN");
  });
});

describe("fixture-safe destinations", () => {
  it("sends every preview action to a fixture record, never to a Studio stage the preview cannot show", () => {
    renderView(operatingScenario, fixtureTargets("operating"));
    expect(hrefs().filter((href) => href?.startsWith("/studio#"))).toEqual([]);
    expect(screen.getByRole("link", { name: /Review Packaging v1/ })).toHaveAttribute("href", "/studio/preview?scenario=operating&item=gate%3Aap-pack-lube");
    const gates = screen.getByRole("region", { name: "02Needs your decision" });
    expect(within(gates).getAllByRole("link", { name: /Open fixture record/ }).map((link) => link.getAttribute("href"))).toEqual([
      "/studio/preview?scenario=operating&item=gate%3Aap-script-cheap",
      "/studio/preview?scenario=operating&item=gate%3Aap-pack-lube",
    ]);
    expect(within(gates).getByText("No review screen yet")).toBeInTheDocument();
  });

  it("marks an action with no fixture record as unavailable instead of linking it", () => {
    renderView(firstRunScenario, fixtureTargets("first-run"));
    expect(screen.getByText("Start research · Not available here")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Start research/ }).map((link) => link.getAttribute("href"))).toEqual(["/studio/preview?scenario=first-run&item=task%3Aresearch-first"]);
  });

  it("keeps live destinations unchanged outside the preview", () => {
    renderView();
    expect(screen.getByRole("link", { name: /Review Packaging v1/ })).toHaveAttribute("href", "/studio#stage-packaging");
    expect(screen.getAllByRole("link", { name: /Review in current Studio/ })).toHaveLength(2);
  });

  it("every link the preview renders resolves to a fixture record of the same scenario", () => {
    for (const view of [operatingScenario, firstRunScenario, degradedScenario]) {
      renderView(view, fixtureTargets(view.scenario));
      const items = hrefs().filter((href) => href?.startsWith("/studio/preview?") && href.includes("&item="));
      expect(items.length).toBeGreaterThan(0);
      for (const href of items) {
        const params = new URLSearchParams(href!.split("?")[1]);
        expect(params.get("scenario")).toBe(view.scenario);
        expect(findFixtureItem(view, params.get("item")!)).not.toBeNull();
      }
      cleanup();
    }
  });

  it("shows the synthetic gate it was opened for, with its exact version and no decision controls", () => {
    render(<FixtureRecord view={operatingScenario} scenarioLabel="Operating" itemId="gate:ap-script-cheap" />);
    expect(screen.getByRole("heading", { level: 1, name: "Review Script v2 · Why cheap keyboards feel better than expensive ones" })).toBeInTheDocument();
    expect(screen.getByText("Supersedes v1")).toBeInTheDocument();
    expect(screen.getByText("run-script-cheap-2")).toBeInTheDocument();
    expect(screen.getByText("Fixture record · demonstration data")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is approved from here/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to Command Center/ })).toHaveAttribute("href", "/studio/preview?scenario=operating");
  });

  it("shows a synthetic task record", () => {
    render(<FixtureRecord view={degradedScenario} scenarioLabel="Degraded" itemId="task:fail-brief-returned" />);
    expect(screen.getByRole("heading", { level: 1, name: "Resolve failed Brief v2 · The keyboard I returned" })).toBeInTheDocument();
    expect(screen.getByText("No due rule")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is started from here/)).toBeInTheDocument();
  });

  it.each(["gate:ap-diag-gasket", "gate:ap-script-keychron", "task:perf-10-setup", "gate:missing", "gate:ap-pack-lube?"])(
    "does not open a record for %s, which the operating Command Center does not link to",
    (itemId) => {
      render(<FixtureRecord view={operatingScenario} scenarioLabel="Operating" itemId={itemId} />);
      expect(screen.getByRole("heading", { level: 1, name: "That item is not in the Operating scenario." })).toBeInTheDocument();
    },
  );
});

describe("command center CSS coverage", () => {
  const directory = "src/features/command-center";
  const css = readFileSync(path.join(directory, "command-center.css"), "utf8");
  const defined = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((match) => match[1]));
  const sources = [...readdirSync(directory).filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx")).map((file) => path.join(directory, file)), "src/app/studio/preview/page.tsx"];

  it.each(sources)("every static cw- className in %s is defined", (file) => {
    const source = readFileSync(file, "utf8");
    const literals = [...source.matchAll(/className[=:]\s*[{"`]+([^"`}]+)/g)].flatMap((match) => match[1].split(/\s+/)).filter((name) => /^cw-[\w-]+$/.test(name));
    expect([...new Set(literals)].filter((name) => !defined.has(name))).toEqual([]);
  });

  it("defines every stage cell state", () => {
    for (const state of ["done", "you", "system", "recover", "none"]) expect(defined.has(`cw-cell-${state}`)).toBe(true);
  });
});
