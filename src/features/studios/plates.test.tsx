// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
