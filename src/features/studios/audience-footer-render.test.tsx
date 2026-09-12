// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AudienceFooter, AudienceFooterStatic } from "./audience-footer";
import { FOOTER, OPEN } from "./copy";

/**
 * The cinematic path's contract. The turn is a video asset now, so what this
 * pins is the handful of attributes that decide whether it plays at all, and
 * the two stills that stand behind it — the artifacts that a later edit could
 * silently drop, turning the footer into a black rectangle or a loop.
 */
describe("AudienceFooter", () => {
  it("mounts exactly one video, muted and inline, with no controls and no loop", () => {
    const { container } = render(<AudienceFooter />);
    const videos = container.querySelectorAll("video");
    expect(videos).toHaveLength(1);
    const video = videos[0] as HTMLVideoElement;
    // Muted and inline are what make an autoplay permissible at all; without
    // either, the turn never runs on a phone.
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    // The final frame has to hold. A loop attribute is the one thing that
    // would send the room back to facing the screen behind the closing copy.
    expect(video.hasAttribute("loop")).toBe(false);
    expect(video.hasAttribute("controls")).toBe(false);
    // Buffered over the long scroll before the footer, so arrival is not a load.
    expect(video.getAttribute("preload")).toBe("auto");
  });

  it("offers the turn as sources in order rather than a single hard-coded src", () => {
    const { container } = render(<AudienceFooter />);
    const sources = [...container.querySelectorAll("video source")];
    expect(sources.map((source) => source.getAttribute("type"))).toEqual(["video/webm", "video/mp4"]);
    expect(sources[sources.length - 1].getAttribute("src")).toBe("/studios/audience-turn.mp4");
  });

  it("stands two stills behind the video: the state it opens on and the one it ends on", () => {
    const { container } = render(<AudienceFooter />);
    const stills = [...container.querySelectorAll(".cw-aud__still")];
    // Exactly two — the poster and the held final state. Not the old four-plate
    // compositor left mounted underneath.
    expect(stills.map((still) => still.getAttribute("data-plate"))).toEqual(["1", "4"]);
  });

  it("leaves no projector-cut machinery behind", () => {
    const { container } = render(<AudienceFooter />);
    expect(container.querySelector(".cw-aud__cover")).toBeNull();
    expect(container.querySelector(".cw-aud__plate")).toBeNull();
    expect(container.querySelector(".cw-aud")?.hasAttribute("data-beat")).toBe(false);
  });

  it("starts un-ended, so the still behind the video is the state it opens on", () => {
    const { container } = render(<AudienceFooter />);
    expect(container.querySelector(".cw-aud")?.getAttribute("data-state")).toBeNull();
  });
});

/**
 * The reduced-motion path's own contract: not the turn stopped part-way, and
 * not the artwork withheld — the settled, fully-turned state held still, with
 * the same closing line and the same action over it, and no video element
 * mounted at all. Pinned as a render test because this is exactly the kind of
 * silent drift a future edit to the animated path could take down with it,
 * since the two components share no playback code.
 */
describe("AudienceFooterStatic", () => {
  it("renders the settled final still only, not the state the video opens on", () => {
    const { container } = render(<AudienceFooterStatic />);
    const stills = container.querySelectorAll(".cw-aud__still");
    expect(stills).toHaveLength(1);
    expect(stills[0].getAttribute("data-plate")).toBe("4");
    expect(container.querySelector(".cw-aud")?.getAttribute("data-state")).toBe("ended");
  });

  it("mounts no video — nothing is fetched, decoded or played", () => {
    const { container } = render(<AudienceFooterStatic />);
    expect(container.querySelector("video")).toBeNull();
  });

  it("closes on the site's own last line and its one action, over the frame", () => {
    const { container } = render(<AudienceFooterStatic />);
    expect(container.querySelector(".cw-aud__line")?.textContent).toBe(FOOTER.line);
    // A landmark, not a div: the closing action stays reachable by landmark
    // navigation as the standalone footer it replaces was.
    expect(container.querySelector("footer.cw-aud__close")?.getAttribute("role")).toBe("contentinfo");
    const cta = container.querySelector(".cw-aud__close a");
    expect(cta?.textContent).toBe(OPEN.primaryCta);
    expect(cta?.getAttribute("href")).toBe("/login");
  });
});
