// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** The workflow actions the studio POSTed, in order. */
const postedActions = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls
  .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);

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

  it("sends a conversation revision to the older video that is open, not the newest one", async () => {
    const { orchestrator, fetcher } = await fixtureStudio(async (instance) => {
      const channelId = await readyChannel(instance);
      await instance.execute("user-1", "video-1", { type: "CREATE_VIDEO", channelId, topic: "Why loyalty programs change decisions" });
      await instance.execute("user-1", "video-2", { type: "CREATE_VIDEO", channelId, topic: "How warranties quietly make money" });
    });
    const [olderVideo, newestVideo] = (await orchestrator.snapshot("user-1")).videos;
    render(<StudioApp user={{ email: "demo@example.com", mode: "mock" }} />);

    const work = await screen.findByRole("region", { name: /videos and builds/i });
    const older = within(work).getAllByRole("button", { name: /^video/i }).find((item) => item.getAttribute("aria-pressed") === "false")!;
    fireEvent.click(older);
    expect(older).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByRole("textbox", { name: /request a change/i }), { target: { value: "Tighten the opening for this video." } });
    fireEvent.click(screen.getByRole("button", { name: /create new version/i }));
    await waitFor(() => expect(postedActions(fetcher)).toHaveLength(1));
    expect(postedActions(fetcher)[0]).toMatchObject({ type: "SCRIPT_DECISION", videoId: olderVideo.id, decision: "REQUEST_CHANGES" });
    expect(postedActions(fetcher)[0].videoId).not.toBe(newestVideo.id);
  });

  it("targets the opened video's script rather than the newest build's specification", async () => {
    const { orchestrator, fetcher } = await fixtureStudio(async (instance) => {
      const channelId = await readyChannel(instance);
      await instance.execute("user-1", "video", { type: "CREATE_VIDEO", channelId, topic: "Why loyalty programs change decisions" });
      const option = (await instance.snapshot("user-1")).channels[0].businessStrategies[0].strategy.freeResourceOptions[0];
      await instance.execute("user-1", "select", { type: "SELECT_STRATEGY_OFFER", channelId, strategyVersion: 1, offerType: "FREE_RESOURCE", candidateId: option.id });
      await instance.execute("user-1", "build", { type: "CREATE_RESOURCE_BUILD", channelId, strategyVersion: 1 });
    });
    const { videos: [video] } = await orchestrator.snapshot("user-1");
    render(<StudioApp user={{ email: "demo@example.com", mode: "mock" }} />);

    const work = await screen.findByRole("region", { name: /videos and builds/i });
    expect(screen.getByText(/revising build specification/i)).toBeInTheDocument();
    fireEvent.click(within(work).getByRole("button", { name: /^video/i }));
    expect(screen.getByText(/revising script/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: /request a change/i }), { target: { value: "Rework the second act." } });
    fireEvent.click(screen.getByRole("button", { name: /create new version/i }));
    await waitFor(() => expect(postedActions(fetcher)).toHaveLength(1));
    expect(postedActions(fetcher)[0]).toMatchObject({ type: "SCRIPT_DECISION", videoId: video.id });
  });

  it("sends a build revision to the opened build when several builds exist", async () => {
    const { orchestrator, fetcher } = await fixtureStudio(async (instance) => {
      const channelId = await readyChannel(instance);
      const strategy = (await instance.snapshot("user-1")).channels[0].businessStrategies[0].strategy;
      await instance.execute("user-1", "select-free", { type: "SELECT_STRATEGY_OFFER", channelId, strategyVersion: 1, offerType: "FREE_RESOURCE", candidateId: strategy.freeResourceOptions[0].id });
      await instance.execute("user-1", "select-paid", { type: "SELECT_STRATEGY_OFFER", channelId, strategyVersion: 1, offerType: "PAID_PRODUCT", candidateId: strategy.paidProductOptions[0].id });
      await instance.execute("user-1", "build-free", { type: "CREATE_RESOURCE_BUILD", channelId, strategyVersion: 1 });
      await instance.execute("user-1", "build-paid", { type: "CREATE_PRODUCT_BUILD", channelId, strategyVersion: 1 });
    });
    const resourceBuild = (await orchestrator.snapshot("user-1")).buildProjects.find((item) => item.projectType === "FREE_RESOURCE")!;
    render(<StudioApp user={{ email: "demo@example.com", mode: "mock" }} />);

    const work = await screen.findByRole("region", { name: /videos and builds/i });
    expect(within(work).getByRole("button", { name: /paid product build/i })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(work).getByRole("button", { name: /free resource build/i }));

    fireEvent.change(screen.getByRole("textbox", { name: /request a change/i }), { target: { value: "Narrow the resource to one worksheet." } });
    fireEvent.click(screen.getByRole("button", { name: /create new version/i }));
    await waitFor(() => expect(postedActions(fetcher)).toHaveLength(1));
    expect(postedActions(fetcher)[0]).toMatchObject({ type: "BUILD_SPEC_DECISION", buildProjectId: resourceBuild.id });
  });

  it("never carries a conversation draft from one opened item to another", async () => {
    await fixtureStudio(async (instance) => {
      const channelId = await readyChannel(instance);
      await instance.execute("user-1", "video-1", { type: "CREATE_VIDEO", channelId, topic: "Why loyalty programs change decisions" });
      await instance.execute("user-1", "video-2", { type: "CREATE_VIDEO", channelId, topic: "How warranties quietly make money" });
    });
    render(<StudioApp user={{ email: "demo@example.com", mode: "mock" }} />);

    const work = await screen.findByRole("region", { name: /videos and builds/i });
    const videoItems = within(work).getAllByRole("button", { name: /^video/i });
    const newest = videoItems.find((item) => item.getAttribute("aria-pressed") === "true")!;
    const older = videoItems.find((item) => item.getAttribute("aria-pressed") === "false")!;
    fireEvent.change(screen.getByRole("textbox", { name: /request a change/i }), { target: { value: "Only about the newest video." } });
    fireEvent.click(older);
    expect(screen.getByRole("textbox", { name: /request a change/i })).toHaveValue("");
    fireEvent.click(older);
    // Nothing is open, so nothing can be revised.
    expect(screen.getByText(/no artifact awaiting changes/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /request a change/i })).toBeDisabled();
    fireEvent.click(newest);
    expect(screen.getByRole("textbox", { name: /request a change/i })).toHaveValue("");
  });

  it("hides one-shot creation actions once their artifact exists for the approved strategy version", async () => {
    const { orchestrator } = await fixtureStudio(async (instance) => {
      const channelId = await readyChannel(instance);
      const strategy = (await instance.snapshot("user-1")).channels[0].businessStrategies[0].strategy;
      await instance.execute("user-1", "pillar", { type: "CREATE_PILLAR_VIDEO", channelId, strategyVersion: 1 });
      await instance.execute("user-1", "select-free", { type: "SELECT_STRATEGY_OFFER", channelId, strategyVersion: 1, offerType: "FREE_RESOURCE", candidateId: strategy.freeResourceOptions[0].id });
      await instance.execute("user-1", "select-paid", { type: "SELECT_STRATEGY_OFFER", channelId, strategyVersion: 1, offerType: "PAID_PRODUCT", candidateId: strategy.paidProductOptions[0].id });
      await instance.execute("user-1", "build-free", { type: "CREATE_RESOURCE_BUILD", channelId, strategyVersion: 1 });
    });
    render(<StudioApp user={{ email: "demo@example.com", mode: "mock" }} />);

    await screen.findByRole("region", { name: /videos and builds/i });
    expect(screen.queryByRole("button", { name: /create pillar video/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /build selected resource/i })).toBeNull();
    // The paid product has a selection but no build yet, so it stays available.
    expect(screen.getByRole("button", { name: /build selected product/i })).toBeEnabled();
    cleanup();

    // Work created from a different strategy version does not consume this version's actions.
    const snapshot = await orchestrator.snapshot("user-1");
    snapshot.videos = snapshot.videos.map((item) => ({ ...item, sourceBusinessStrategyVersion: 99 }));
    snapshot.buildProjects = snapshot.buildProjects.map((item) => ({ ...item, strategyVersion: 99 }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 })));
    render(<StudioApp user={{ email: "demo@example.com", mode: "mock" }} />);
    await screen.findByRole("region", { name: /videos and builds/i });
    expect(screen.getByRole("button", { name: /create pillar video/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /build selected resource/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /build selected product/i })).toBeEnabled();
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
