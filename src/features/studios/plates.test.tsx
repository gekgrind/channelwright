// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ProductionGate } from "./plates";

/**
 * Structural regression coverage for Department 04's two-element responsive
 * treatment: a wide mirrored plate for desktop/tablet, and a separate,
 * self-framed phone crop — not the same image scaled down. Browser visual
 * QA (see the implementation report) covers what these look like at each
 * breakpoint; this only pins that both elements exist, point at distinct
 * assets, and carry the CSS hooks the responsive rules key off.
 */
describe("ProductionGate", () => {
  it("mounts both the wide and phone elements, never just one", () => {
    const { container } = render(<ProductionGate at={0.517} />);
    expect(container.querySelector(".cw-plate--gate__wide")).not.toBeNull();
    expect(container.querySelector(".cw-plate--gate__phone")).not.toBeNull();
  });

  it("points the phone element at its own crop, not the wide plate's source", () => {
    const { container } = render(<ProductionGate at={0.517} />);
    const wideImg = container.querySelector(".cw-plate--gate__wide img");
    const phoneImg = container.querySelector(".cw-plate--gate__phone img");
    expect(wideImg?.getAttribute("src")).toContain("production-department.jpg");
    expect(phoneImg?.getAttribute("src")).toContain("production-department-mobile.jpg");
  });

  it("carries the journey position through to the prop's own custom property", () => {
    const { container } = render(<ProductionGate at={0.517} />);
    const root = container.querySelector(".cw-plate--gate") as HTMLElement | null;
    expect(root?.style.getPropertyValue("--at")).toBe("0.517");
  });
});

/**
 * The stage's own width contract, which Department 04 depends on more than
 * any other room.
 *
 * `.cw-stage` stacks every layer in one grid cell. If that cell's column is
 * content-sized, the widest layer in the room decides how wide the *copy*
 * layer is laid out — and the instruments set `width: 100%` with an
 * `aspect-ratio` over a definite height, which on a phone resolves to a track
 * far wider than the screen. Department 04's composition is centred (`b6`),
 * so it was the room that lost its headline off the right edge first;
 * Department 02 (`b4`, right-aligned) was next. Pinning the declaration is
 * crude but it is the only part of this that a unit test can see — the
 * rendered proof is in the implementation report's 390x844 and 430x932
 * captures.
 */
describe("studios stage width contract", () => {
  it("fixes the stage's grid column to the stage box, not to its content", () => {
    const css = readFileSync(path.resolve(process.cwd(), "src/features/studios/studios.css"), "utf8");
    const stage = css.slice(css.indexOf(".cw-stage {"));
    const block = stage.slice(0, stage.indexOf("}"));
    expect(block).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
