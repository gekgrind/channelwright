// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import StudioApp from "./studio-app";
import { ChannelwrightOrchestrator } from "@/server/orchestrator";
import { MemoryWorkspaceRepository } from "@/server/repository";

const preferences = {
  name: "Systems Lab", niche: "Business", targetAudience: "Independent founders",
  videoStyle: "Editorial documentary", preferredVoice: "Measured", targetDurationMinutes: 10,
  postingFrequency: "Weekly", monetizationGoal: "Sponsors", language: "English", productionComplexity: "BALANCED" as const,
  distributionTargets: { youtube: true as const, tiktok: false, instagramFacebookReels: false },
};

/** A fixture orchestrator behind a fake /api/workflows that mirrors the mock-mode route (no media snapshot). */
async function fixtureStudio(setup: (orchestrator: ChannelwrightOrchestrator) => Promise<unknown>) {
  const orchestrator = new ChannelwrightOrchestrator(new MemoryWorkspaceRepository());
  await setup(orchestrator);
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.method === "POST"
      ? await orchestrator.execute("user-1", crypto.randomUUID(), JSON.parse(String(init.body)) as Parameters<ChannelwrightOrchestrator["execute"]>[2])
      : await orchestrator.snapshot("user-1");
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetcher);
  return { orchestrator, fetcher };
}

const readyChannel = async (orchestrator: ChannelwrightOrchestrator) => {
  const created = await orchestrator.execute("user-1", "channel", { type: "CREATE_CHANNEL", mode: "USER_DEFINED", concept: "Hidden systems behind everyday businesses", preferences });
  const channelId = created.channels[0].id;
  await orchestrator.execute("user-1", "approve", { type: "BUSINESS_STRATEGY_DECISION", channelId, strategyVersion: 1, decision: "APPROVE" });
  return channelId;
};

/** Every in-page nav link must point at an element that exists. */
const expectLinksResolve = (nav: HTMLElement) => {
  const links = within(nav).getAllByRole("link");
  for (const link of links) {
    const target = link.getAttribute("href")!;
    expect(target.startsWith("#")).toBe(true);
    expect(document.getElementById(target.slice(1)), `missing target ${target}`).not.toBeNull();
  }
  return links;
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("StudioApp production mode", () => {
  it("navigates by the workflow stages that exist and has no dead channel destinations or New channel action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      channels: [], videos: [], buildProjects: [], products: [], agentRuns: [], auditEvents: [], conversationMessages: [],
      mediaProduction: { evidence: "SUPABASE_DATABASE", assets: [], renderInputs: [], renderJobs: [], masters: [] },
      workflowEngine: { workflows: [], runs: [], pendingApprovals: [] },
    }), { status: 200 })));
    render(<StudioApp user={{ email: "operator@example.com", mode: "supabase" }} />);
    await screen.findByRole("heading", { name: /production workflows/i });

    const nav = screen.getByRole("navigation", { name: /production stages/i });
    const links = expectLinksResolve(nav);
    expect(links.map((link) => link.textContent?.trim())).toEqual(["Research", "Strategy", "Content plan", "Brief", "Script", "Packaging", "Release", "Performance"]);
    for (const dead of ["#channels", "#videos", "#offers", "#products", "#funnels", "#monetization"]) {
      expect(document.querySelector(`a[href="${dead}"]`)).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /new channel/i })).toBeNull();
  });
});

describe("StudioApp fixture channel home", () => {
  it("keeps strategy, offers, existing videos, and Develop another video reachable after a video exists", async () => {
    await fixtureStudio(async (orchestrator) => {
      const channelId = await readyChannel(orchestrator);
      await orchestrator.execute("user-1", "video", { type: "CREATE_VIDEO", channelId, topic: "Why loyalty programs change decisions" });
    });
    render(<StudioApp user={{ email: "demo@example.com", mode: "mock" }} />);

    const work = await screen.findByRole("region", { name: /videos and builds/i });
    const videoItem = within(work).getByRole("button", { name: /video/i });
    // The newest work opens by default, exactly as before, and renders even without a media snapshot.
    expect(videoItem).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText(/independent script qa/i)).toBeInTheDocument();
    // ...but the channel no longer disappears behind it.
    expect(screen.getByRole("heading", { name: /develop another video/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create pillar video/i })).toBeInTheDocument();
    expect(screen.getByText(/select the free resource/i)).toBeInTheDocument();
    expectLinksResolve(screen.getByRole("navigation", { name: /studio/i }));

    fireEvent.click(videoItem);
    expect(videoItem).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/independent script qa/i)).toBeNull();
  });

  it("never carries typed review feedback from one video to another when switching", async () => {
    await fixtureStudio(async (orchestrator) => {
      const channelId = await readyChannel(orchestrator);
      await orchestrator.execute("user-1", "video-1", { type: "CREATE_VIDEO", channelId, topic: "Why loyalty programs change decisions" });
      await orchestrator.execute("user-1", "video-2", { type: "CREATE_VIDEO", channelId, topic: "How warranties quietly make money" });
    });
    render(<StudioApp user={{ email: "demo@example.com", mode: "mock" }} />);

    const work = await screen.findByRole("region", { name: /videos and builds/i });
    const [newest, older] = within(work).getAllByRole("button", { name: /^video/i });
    expect(newest).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("textbox", { name: /revision feedback/i }), { target: { value: "Feedback about the newest video only." } });

    fireEvent.click(older);
    expect(older).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: /revision feedback/i })).toHaveValue("");
    expect(screen.getByRole("button", { name: /request changes/i })).toBeDisabled();
  });

  it("lists builds beside videos and lets the operator switch between them", async () => {
    await fixtureStudio(async (orchestrator) => {
      const channelId = await readyChannel(orchestrator);
      await orchestrator.execute("user-1", "video", { type: "CREATE_VIDEO", channelId, topic: "Why loyalty programs change decisions" });
      const snapshot = await orchestrator.snapshot("user-1");
      const option = snapshot.channels[0].businessStrategies[0].strategy.freeResourceOptions[0];
      await orchestrator.execute("user-1", "select", { type: "SELECT_STRATEGY_OFFER", channelId, strategyVersion: 1, offerType: "FREE_RESOURCE", candidateId: option.id });
      await orchestrator.execute("user-1", "build", { type: "CREATE_RESOURCE_BUILD", channelId, strategyVersion: 1 });
    });
    render(<StudioApp user={{ email: "demo@example.com", mode: "mock" }} />);

    const work = await screen.findByRole("region", { name: /videos and builds/i });
    const buildItem = within(work).getByRole("button", { name: /free resource build/i });
    const videoItem = within(work).getByRole("button", { name: /^video/i });
    expect(buildItem).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/product builder \/ specification/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /develop another video/i })).toBeInTheDocument();

    fireEvent.click(videoItem);
    expect(videoItem).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/product builder \/ specification/i)).toBeNull();
    expect(screen.getByText(/independent script qa/i)).toBeInTheDocument();
  });

  it("gives a failed channel a recovery path instead of an empty panel", async () => {
    const { orchestrator } = await fixtureStudio(async (instance) => { await readyChannel(instance); });
    const snapshot = await orchestrator.snapshot("user-1");
    snapshot.channels[0] = { ...snapshot.channels[0], state: "FAILED" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 })));
    render(<StudioApp user={{ email: "demo@example.com", mode: "mock" }} />);

    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent(/could not finish its current step/i);
    expect(within(failure).getByRole("link", { name: /view activity ledger/i })).toHaveAttribute("href", "#runs");
    expect(document.getElementById("runs")).not.toBeNull();
    fireEvent.click(within(failure).getByRole("button", { name: /start a new channel/i }));
    expect(screen.getByRole("heading", { name: /set the editorial brief/i })).toBeInTheDocument();
    // The demo operator can always return to the existing channel.
    fireEvent.click(screen.getByRole("button", { name: /back to systems lab/i }));
    expect(screen.getByText(/could not finish its current step/i)).toBeInTheDocument();
  });
});
