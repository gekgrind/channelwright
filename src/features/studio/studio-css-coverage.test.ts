import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const studioDirectory = "src/features/studio";
const css = readFileSync("src/app/globals.css", "utf8");
const defined = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((match) => match[1]));

/**
 * Structural hook classes that intentionally carry no styles of their own; the
 * element is styled through a sibling class (e.g. `research-workspace`).
 */
const UNSTYLED_HOOKS = new Set(["artifact-workspace", "product-build", "strategy-workspace", "strategy-result", "content-workspace", "content-result"]);

const components = readdirSync(studioDirectory).filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"));

describe("studio CSS coverage", () => {
  it.each(components)("every static className in %s is defined in globals.css", (file) => {
    const source = readFileSync(path.join(studioDirectory, file), "utf8");
    const literals = [...source.matchAll(/className="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)).filter(Boolean);
    const missing = [...new Set(literals)].filter((name) => !defined.has(name) && !UNSTYLED_HOOKS.has(name));
    expect(missing).toEqual([]);
  });

  it("defines distinct styles for every dynamic state the production workspaces emit", () => {
    const dynamic = [
      // Viewer Value, integrity guards, and hypothesis verdicts
      "badge-done", "badge-warning", "badge-failed",
      // durable step states rendered by StageList
      "stage-completed", "stage-failed", "stage-queued", "stage-leased", "stage-retry_wait", "stage-waiting_for_approval", "stage-canceled",
      // ledger selection, destructive actions, and callout tones
      "chip-active", "button-danger", "button-danger-solid", "callout-warning", "callout-danger",
    ];
    expect(dynamic.filter((name) => !defined.has(name))).toEqual([]);
  });

  it("never lets a failure state share the pass styling", () => {
    const rule = (selector: string) => css.match(new RegExp(`\\.${selector} \\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule("badge-failed")).toContain("var(--state-fail)");
    expect(rule("badge-done")).toContain("var(--state-pass)");
    expect(rule("button-danger")).toContain("var(--state-fail)");
    // A glyph accompanies color so state is not communicated by color alone.
    expect(css).toMatch(/\.badge-done::before \{ content: "✓"/);
    expect(css).toMatch(/\.badge-failed::before \{ content: "✕"/);
  });
});
