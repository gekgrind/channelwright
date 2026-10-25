import { describe, expect, it } from "vitest";
import { ESCALATE_AFTER_DAYS, rankNextDecision } from "./next-decision";
import { degradedScenario, firstRunScenario, operatingScenario } from "./fixtures";
import type { CommandCenterView, OperatorTask, PendingGate } from "./model";

const AS_OF = "2026-10-24T15:00:00.000Z";
const daysBefore = (days: number) => new Date(Date.parse(AS_OF) - days * 86_400_000).toISOString();

const gate = (overrides: Partial<PendingGate>): PendingGate => ({
  approvalId: "ap", workflowId: "wf", runId: "run", stage: "SCRIPT", version: 1, supersedesVersion: null,
  subject: "Video", note: "Note.", requestedAt: daysBefore(1), surface: "available", attribution: { status: "resolved" }, ...overrides,
});

const task = (overrides: Partial<OperatorTask>): OperatorTask => ({
  id: "t", kind: "RECORD_PERFORMANCE", stage: "PERFORMANCE", subject: "Record performance", detail: "Detail.", href: "/studio#stage-performance",
  dueAt: daysBefore(1), createdAt: daysBefore(20), surface: "available", attribution: { status: "resolved" }, ...overrides,
});

const view = (gates: PendingGate[], tasks: OperatorTask[] = []): Pick<CommandCenterView, "gates" | "tasks" | "asOf"> =>
  ({ gates: { status: "ready", data: gates }, tasks, asOf: AS_OF });

describe("rankNextDecision", () => {
  it("never puts routine performance entry ahead of a pending script approval", () => {
    const result = rankNextDecision(view([gate({ approvalId: "script" })], [task({ dueAt: daysBefore(2) })]));
    expect(result.primary?.id).toBe("gate:script");
    expect(result.deferred.map((item) => item.id)).toEqual(["task:t"]);
  });

  it("escalates measurement above production gates only once it is overdue past the threshold", () => {
    const below = rankNextDecision(view([gate({ approvalId: "script" })], [task({ dueAt: daysBefore(ESCALATE_AFTER_DAYS - 1) })]));
    expect(below.primary?.id).toBe("gate:script");
    const past = rankNextDecision(view([gate({ approvalId: "script" })], [task({ dueAt: daysBefore(ESCALATE_AFTER_DAYS) })]));
    expect(past.primary?.id).toBe("task:t");
    expect(past.primary?.rule).toContain("escalated");
  });

  it("keeps an escalated measurement behind a pending learning gate", () => {
    const result = rankNextDecision(view([gate({ approvalId: "perf", stage: "PERFORMANCE" })], [task({ dueAt: daysBefore(30) })]));
    expect(result.primary?.id).toBe("gate:perf");
  });

  it("ranks learning gates first, then channel gates, then video gates downstream-first, oldest breaking ties", () => {
    const result = rankNextDecision(view([
      gate({ approvalId: "brief", stage: "BRIEF", requestedAt: daysBefore(9) }),
      gate({ approvalId: "pack-new", stage: "PACKAGING", requestedAt: daysBefore(1) }),
      gate({ approvalId: "pack-old", stage: "PACKAGING", requestedAt: daysBefore(3) }),
      gate({ approvalId: "strategy", stage: "STRATEGY", requestedAt: daysBefore(1) }),
      gate({ approvalId: "perf", stage: "PERFORMANCE", requestedAt: daysBefore(1) }),
    ]));
    expect([result.primary, ...result.deferred].map((item) => item?.id)).toEqual(["gate:perf", "gate:strategy", "gate:pack-old", "gate:pack-new", "gate:brief"]);
  });

  it("does not rank measurement when no rule defines when it is due, or while its window is open", () => {
    const result = rankNextDecision(view([], [task({ id: "no-rule", dueAt: null }), task({ id: "open", dueAt: new Date(Date.parse(AS_OF) + 86_400_000).toISOString() })]));
    expect(result.primary).toBeNull();
    expect(result.excluded.map((item) => item.reason)).toEqual([
      "No rule defines when measurement is due, so it is not ranked.",
      "Measurement window is still open.",
    ]);
  });

  it("excludes work with no screen to act on and work that lineage cannot attribute", () => {
    const result = rankNextDecision(view([
      gate({ approvalId: "diag", stage: "DIAGNOSIS", surface: "unavailable" }),
      gate({ approvalId: "orphan", attribution: { status: "ambiguous", reason: "upstream run does not resolve" } }),
    ]));
    expect(result.primary).toBeNull();
    expect(result.excluded.map((item) => item.id)).toEqual(["gate:diag", "gate:orphan"]);
    expect(result.excluded[1].reason).toContain("upstream run does not resolve");
  });

  it("puts recovery first and production or foundation work last", () => {
    const result = rankNextDecision(view([gate({ approvalId: "script" })], [
      task({ id: "brief", kind: "START_BRIEF", dueAt: null }),
      task({ id: "fail", kind: "RESOLVE_FAILURE", dueAt: null }),
    ]));
    expect([result.primary, ...result.deferred].map((item) => item?.id)).toEqual(["task:fail", "gate:script", "task:brief"]);
  });

  it("flags the ranking incomplete when approvals did not load", () => {
    expect(rankNextDecision(degradedScenario).complete).toBe(false);
    expect(rankNextDecision(degradedScenario).primary?.tier).toBe(0);
  });

  it("recommends the most downstream actionable gate in the operating fixture and explains every exclusion", () => {
    const result = rankNextDecision(operatingScenario);
    expect(result.primary?.title).toBe("Review Packaging v1 · Lubing $8 switches: worth it?");
    expect(result.deferred.map((item) => item.id)).toEqual(["gate:ap-script-cheap", "task:brief-topic-6"]);
    expect(result.excluded.map((item) => item.id).sort()).toEqual(["gate:ap-diag-gasket", "gate:ap-script-keychron", "task:perf-10-setup"]);
  });

  it("recommends research on first run", () => {
    expect(rankNextDecision(firstRunScenario).primary).toMatchObject({ tier: 4, cta: "Start research" });
  });
});
