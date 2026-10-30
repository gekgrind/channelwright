import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guards for the shared ReviewScreen. jsdom cannot lay out CSS, so
 * these prove the two things that make a duplicate Approve impossible: the
 * entry controls exist once in the DOM (review-screen.test.tsx), and no rule
 * active at the required widths hides or swaps the decision region. Layout
 * itself is checked in a browser against /studio/preview/review; neither is
 * proof of production accessibility.
 */

const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const WIDTHS = [1440, 1024, 390, 375];

type Rule = { media: string | null; selector: string; body: string };

/** Splits the stylesheet into rules, one level of @media nesting deep. */
function rules(source: string): Rule[] {
  const out: Rule[] = [];
  let index = 0;
  const readBlock = (start: number) => {
    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") { depth -= 1; if (depth === 0) return i; }
    }
    return source.length;
  };
  const flat = (block: string, media: string | null) => {
    for (const match of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ media, selector: match[1].trim(), body: match[2] });
  };
  while (index < source.length) {
    const open = source.indexOf("{", index);
    if (open < 0) break;
    const head = source.slice(index, open).trim();
    const close = readBlock(open);
    if (head.startsWith("@media")) flat(source.slice(open + 1, close), head);
    else if (!head.startsWith("@")) out.push({ media: null, selector: head, body: source.slice(open + 1, close) });
    index = close + 1;
  }
  return out;
}

/** Evaluates the width conditions this stylesheet uses; any other feature (e.g. reduced motion) is treated as active, the worst case. */
function active(media: string | null, width: number) {
  if (!media) return true;
  const max = [...media.matchAll(/max-width:\s*(\d+)px/g)].map((match) => Number(match[1]));
  const min = [...media.matchAll(/min-width:\s*(\d+)px/g)].map((match) => Number(match[1]));
  return max.every((value) => width <= value) && min.every((value) => width >= value);
}

const REVIEW_SELECTOR = /review-|approval-panel|decision-actions|data-review-action/;
const HIDES = /display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden/;

describe("ReviewScreen responsive structure", () => {
  const all = rules(css);

  it("parses the stylesheet's media blocks (sanity check for the evaluator)", () => {
    expect(all.some((rule) => rule.media?.includes("max-width: 700px") && rule.selector.includes("decision-actions"))).toBe(true);
    expect(all.some((rule) => rule.media === null && rule.selector.includes(".review-actions .button"))).toBe(true);
  });

  it.each(WIDTHS)("no rule active at %ipx hides the decision region, its entry controls, or its dialog", (width) => {
    const hiding = all.filter((rule) => active(rule.media, width) && REVIEW_SELECTOR.test(rule.selector) && HIDES.test(rule.body));
    expect(hiding).toEqual([]);
  });

  it.each(WIDTHS)("decision buttons keep a target of at least 48px at %ipx", (width) => {
    const heights = all
      .filter((rule) => active(rule.media, width) && /\.review-(actions|dialog-actions) \.button\b/.test(rule.selector))
      .flatMap((rule) => [...rule.body.matchAll(/min-height:\s*(\d+)px/g)].map((match) => Number(match[1])));
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(48);
  });

  it.each(WIDTHS)("dialog actions keep DOM order on screen at %ipx, so the visual order matches the Tab order from Cancel", (width) => {
    const reversed = all.filter((rule) => active(rule.media, width) && /review-dialog-actions/.test(rule.selector) && /(row|column)-reverse/.test(rule.body));
    expect(reversed).toEqual([]);
  });

  it("mutation check: the evaluator catches the prototype's .panel/.decide defect class", () => {
    const defective = rules(`${css}\n@media (max-width: 1279px) { .review-actions { display: none; } }`);
    expect(defective.filter((rule) => active(rule.media, 1024) && REVIEW_SELECTOR.test(rule.selector) && HIDES.test(rule.body))).toHaveLength(1);
    expect(defective.filter((rule) => active(rule.media, 1440) && REVIEW_SELECTOR.test(rule.selector) && HIDES.test(rule.body))).toHaveLength(0);
  });
});

describe("Review actions stay on their review screens", () => {
  const source = (file: string) => readFileSync(file, "utf8");
  const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full.replaceAll("\\", "/")] : [];
  });
  const files = sourceFiles("src");

  it("only the workspace hook sends decisions, through the one API client", () => {
    const senders = files.filter((file) => source(file).includes("submitApprovalDecision(")).sort();
    expect(senders).toEqual(["src/features/studio/use-workflow-workspace.ts", "src/features/studio/workflow-api.ts"]);
    expect(files.filter((file) => /\/approvals\/\$\{/.test(source(file)))).toEqual(["src/features/studio/workflow-api.ts"]);
  });

  it("the fixture route validates its query against a plain module, never values exported from a client module", () => {
    // Values imported by a server component from a "use client" module are opaque client references there.
    expect(source("src/features/studio/review-preview-fixtures.ts")).not.toMatch(/^\s*["']use client["']/);
    const page = source("src/app/studio/preview/review/page.tsx");
    expect(page).toMatch(/from "@\/features\/studio\/review-preview-fixtures"/);
    expect(page).toMatch(/import \{ ReviewPreview \} from "@\/features\/studio\/review-preview";/);
  });

  it("only ReviewScreen renders decision entry controls, and the retired DecisionBar is gone", () => {
    expect(files.filter((file) => source(file).includes("data-review-action"))).toEqual(["src/features/studio/review-screen.tsx"]);
    expect(files.filter((file) => /\bDecisionBar\b/.test(source(file)))).toEqual([]);
  });

  it("each stage workspace mounts exactly one ReviewScreen; overview and list surfaces mount none", () => {
    const workspaces = files.filter((file) => /src\/features\/studio\/[a-z-]+-workspace\.tsx$/.test(file));
    expect(workspaces).toHaveLength(8);
    for (const file of workspaces) expect([file, source(file).match(/<ReviewScreen\b/g)?.length ?? 0]).toEqual([file, 1]);
    const overviews = files.filter((file) => file.startsWith("src/features/command-center/") || file === "src/features/studio/studio-app.tsx" || file === "src/app/studio/preview/page.tsx");
    for (const file of overviews) expect([file, /<ReviewScreen\b|decide\(/.test(source(file))]).toEqual([file, false]);
  });
});
