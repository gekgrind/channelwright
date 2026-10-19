// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage, { metadata } from "./page";
import StudiosPreviewPage from "./studios-preview/page";

vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("REDIRECT_HOME"); }) }));
import { redirect } from "next/navigation";

beforeEach(() => {
  // Exercise the real accessible narrative without starting cinematic playback.
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("public homepage", () => {
  it("exposes the Journey, working anchors and protected Studio links without preview claims", () => {
    const { container } = render(<HomePage />);
    expect(container.querySelector("main#main h1")?.textContent).toBe("Every channel starts with an idea.");
    expect(container.querySelector(".cw-topbar__mark")?.getAttribute("href")).toBe("/");
    expect(container.textContent).not.toMatch(/preview surface|Preview Â·|production site remains/i);
    expect(container.querySelector("video")).toBeNull();
    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")];
    const studioLinks = links.filter((link) => link.textContent?.includes("Enter the studio"));
    expect(studioLinks.length).toBeGreaterThan(1);
    for (const link of studioLinks) expect(link.getAttribute("href")).toBe("/studio");
    for (const link of links) {
      const href = link.getAttribute("href")!;
      if (href.startsWith("#")) expect(container.querySelector(href)).not.toBeNull();
      else expect(["/", "/studio"]).toContain(href);
    }
    expect(container.textContent).toContain("Manual performance capture");
    expect(container.textContent).toContain("Designed, not built");
  });

  it("publishes root metadata and preserves old preview links with a fixed destination", () => {
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe("https://channelwright.entrepreneuria.io/");
    expect(() => StudiosPreviewPage()).toThrow("REDIRECT_HOME");
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
