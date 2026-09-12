// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AudienceFooterStatic } from "./audience-footer";
import { FOOTER, OPEN } from "./copy";

/**
 * The reduced-motion path's own contract: not the animated scene stopped
 * part-way, and not the artwork withheld — plate 4 (the settled, fully-
 * turned state), held still, with the same closing line and the same action
 * over it. Pinned as a render test because this is exactly the kind of
 * silent drift a future edit to the animated choreography could take down
 * with it, since the two components share no scroll code path.
 */
describe("AudienceFooterStatic", () => {
  it("renders the settled plate 4 only, not the resting plate 1", () => {
    const { container } = render(<AudienceFooterStatic />);
    const plates = container.querySelectorAll(".cw-aud__plate");
    expect(plates).toHaveLength(1);
    expect(plates[0].getAttribute("data-plate")).toBe("4");
    expect(container.querySelector(".cw-aud")?.getAttribute("data-beat")).toBe("3");
  });

  it("mounts no cover layer — nothing left to animate", () => {
    const { container } = render(<AudienceFooterStatic />);
    expect(container.querySelector(".cw-aud__cover")).toBeNull();
  });

  it("closes on the site's own last line and its one action, over the frame", () => {
    const { container } = render(<AudienceFooterStatic />);
    expect(container.querySelector(".cw-aud__line")?.textContent).toBe(FOOTER.line);
    const cta = container.querySelector(".cw-aud__close a");
    expect(cta?.textContent).toBe(OPEN.primaryCta);
    expect(cta?.getAttribute("href")).toBe("/login");
  });
});
