// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AudienceFooterStatic } from "./audience-footer";

/**
 * The reduced-motion path's own contract: not the animated scene stopped
 * part-way, and not the artwork withheld — plate 4 (the settled, fully-
 * turned state), held still, and nothing else. Pinned as a render test
 * because this is exactly the kind of silent drift a future edit to the
 * animated `PASSES` choreography could accidentally take down with it,
 * since the two components share no code path.
 */
describe("AudienceFooterStatic", () => {
  it("renders the settled plate 4, not the resting plate 1", () => {
    const { container } = render(<AudienceFooterStatic />);
    const plate = container.querySelector(".cw-aud__plate--base");
    expect(plate?.getAttribute("data-plate")).toBe("4");
  });

  it("mounts no Cue-driven swap or shadow layers — nothing left to animate", () => {
    const { container } = render(<AudienceFooterStatic />);
    expect(container.querySelectorAll(".cw-aud__plate--swap")).toHaveLength(0);
    expect(container.querySelectorAll(".cw-aud__dim")).toHaveLength(0);
  });
});
