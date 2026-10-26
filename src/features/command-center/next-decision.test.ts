import { describe, expect, it } from "vitest";
import { ESCALATE_AFTER_DAYS, parseInstant, rankNextDecision } from "./next-decision";
import { degradedScenario, firstRunScenario, operatingScenario } from "./fixtures";
import type { CommandCenterView, OperatorTask, PendingGate } from "./model";

const AS_OF = "2026-10-24T15:00:00.000Z";
const DAY_MS = 86_400_000;
const msBefore = (ms: number) => new Date(Date.parse(AS_OF) - ms).toISOString();
const daysBefore = (days: number) => msBefore(days * DAY_MS);

const gate = (overrides: Partial<PendingGate>): PendingGate => ({
  approvalId: "ap", workflowId: "wf", runId: "run", stage: "SCRIPT", version: 1, supersedesVersion: null,
  subject: "Video", note: "Note.", requestedAt: daysBefore(1), surface: "available", attribution: { status: "resolved" }, ...overrides,
});

const task = (overrides: Partial<OperatorTask>): OperatorTask => ({
  id: "t", kind: "RECORD_PERFORMANCE", stage: "PERFORMANCE", subject: "Record performance", detail: "Detail.", href: "/studio#stage-performance",
  dueAt: daysBefore(1), createdAt: daysBefore(20), surface: "available", attribution: { status: "resolved" }, ...overrides,
});

const view = (gates: PendingGate[], tasks: OperatorTask[] = [], asOf = AS_OF): Pick<CommandCenterView, "gates" | "tasks" | "asOf"> =>
  ({ gates: { status: "ready", data: gates }, tasks, asOf });
const order = (result: ReturnType<typeof rankNextDecision>) => [result.primary, ...result.deferred].map((item) => item?.id);

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

describe("parseInstant", () => {
  it("accepts RFC 3339 timestamps with an explicit offset", () => {
    expect(parseInstant(AS_OF)).toBe(Date.UTC(2026, 9, 24, 15));
    expect(parseInstant("2026-10-24T17:00:00+02:00")).toBe(Date.UTC(2026, 9, 24, 15));
    expect(parseInstant("2026-10-24T15:00:00.123456+00:00")).toBe(Date.UTC(2026, 9, 24, 15, 0, 0, 123));
    expect(parseInstant("2028-02-29T00:00:00Z")).toBe(Date.UTC(2028, 1, 29));
    expect(parseInstant("0099-10-24T15:00:00Z")).toBe(Date.parse("0099-10-24T15:00:00Z"));
    expect(new Date(parseInstant("0099-10-24T15:00:00Z")!).getUTCFullYear()).toBe(99);
    expect(parseInstant("0004-02-29T00:00:00Z")).not.toBeNull();
  });

  it.each([
    ["null", null], ["undefined", undefined], ["empty", ""], ["prose", "not a date"],
    ["date only", "2026-10-24"], ["no offset (server-local time)", "2026-10-24T15:00:00"], ["locale format", "Oct 24 2026"],
    ["impossible day", "2026-02-30T00:00:00Z"], ["non-leap Feb 29", "2026-02-29T00:00:00Z"], ["century non-leap Feb 29", "2100-02-29T00:00:00Z"], ["two-digit-era non-leap Feb 29", "0099-02-29T00:00:00Z"],
    ["hour 25", "2026-10-24T25:00:00Z"], ["minute 60", "2026-10-24T15:60:00Z"], ["offset hour 24", "2026-10-24T15:00:00+24:00"],
  ])("rejects %s", (_label, value) => {
    expect(parseInstant(value)).toBeNull();
  });
});

describe("rankNextDecision with untrustworthy timestamps", () => {
  it("excludes learning work whose due date is invalid, with its reason, and never ranks on NaN", () => {
    const result = rankNextDecision(view([gate({ approvalId: "script" })], [
      task({ id: "perf-bad", dueAt: "not a date" }),
      task({ id: "diag-bad", kind: "START_DIAGNOSIS", stage: "DIAGNOSIS", dueAt: "2026-02-30T00:00:00Z" }),
      task({ id: "perf-local", dueAt: "2026-10-01T00:00:00" }),
    ]));
    expect(order(result)).toEqual(["gate:script"]);
    const reason = "Its due date is not a valid timestamp, so it is not ranked.";
    expect(result.excluded.map((item) => [item.id, item.reason])).toEqual([["task:diag-bad", reason], ["task:perf-bad", reason], ["task:perf-local", reason]]);
  });

  it("keeps ranking gates and recovery when the evaluation time is invalid, but holds back due work", () => {
    const result = rankNextDecision(view([gate({ approvalId: "script" })], [
      task({ id: "perf", dueAt: daysBefore(30) }),
      task({ id: "fail", kind: "RESOLVE_FAILURE", dueAt: null }),
      task({ id: "brief", kind: "START_BRIEF", dueAt: null }),
    ], "garbage"));
    expect(order(result)).toEqual(["task:fail", "gate:script", "task:brief"]);
    expect(result.excluded.map((item) => [item.id, item.reason])).toEqual([["task:perf", "The evaluation time is not a valid timestamp, so due work is not ranked."]]);
    expect(JSON.stringify(result)).not.toContain("NaN");
  });

  it("treats a missing due date as no rule for measurement, but still ranks other learning work by creation time", () => {
    const result = rankNextDecision(view([], [
      task({ id: "perf", dueAt: null }),
      task({ id: "diag-new", kind: "START_DIAGNOSIS", stage: "DIAGNOSIS", dueAt: null, createdAt: daysBefore(1) }),
      task({ id: "diag-old", kind: "START_DIAGNOSIS", stage: "DIAGNOSIS", dueAt: null, createdAt: daysBefore(5) }),
    ]));
    expect(order(result)).toEqual(["task:diag-old", "task:diag-new"]);
    expect(result.primary).toMatchObject({ tier: 2, rule: "Learning work is due" });
    expect(result.excluded.map((item) => item.reason)).toEqual(["No rule defines when measurement is due, so it is not ranked."]);
  });

  it("does not rank a future due date, ranks one due exactly now, and sorts future request times after older ones", () => {
    const result = rankNextDecision(view([
      gate({ approvalId: "pack-future", stage: "PACKAGING", requestedAt: "2026-12-01T00:00:00Z" }),
      gate({ approvalId: "pack-past", stage: "PACKAGING", requestedAt: daysBefore(1) }),
    ], [task({ id: "perf-future", dueAt: msBefore(-1) }), task({ id: "perf-now", dueAt: AS_OF })]));
    expect(order(result)).toEqual(["gate:pack-past", "gate:pack-future", "task:perf-now"]);
    expect(result.deferred.at(-1)).toMatchObject({ tier: 2, rule: "Learning work is due" });
    expect(result.excluded.map((item) => [item.id, item.reason])).toEqual([["task:perf-future", "Measurement window is still open."]]);
  });

  it("escalates at exactly seven days overdue and not one millisecond sooner", () => {
    const justBefore = rankNextDecision(view([gate({ approvalId: "script" })], [task({ dueAt: msBefore(ESCALATE_AFTER_DAYS * DAY_MS - 1) })]));
    expect(order(justBefore)).toEqual(["gate:script", "task:t"]);
    expect(justBefore.deferred[0]).toMatchObject({ tier: 2, rule: "Learning work is due" });
    const atBoundary = rankNextDecision(view([gate({ approvalId: "script" })], [task({ dueAt: daysBefore(ESCALATE_AFTER_DAYS) })]));
    expect(order(atBoundary)).toEqual(["task:t", "gate:script"]);
    expect(atBoundary.primary).toMatchObject({ tier: 1, rule: "Overdue 7 days: escalated" });
  });

  it("sorts invalid request and creation times after valid ones in the same group, breaking ties by id", () => {
    const result = rankNextDecision(view([
      gate({ approvalId: "script-b", requestedAt: "bad" }),
      gate({ approvalId: "script-a", requestedAt: "" }),
      gate({ approvalId: "script-valid", requestedAt: daysBefore(1) }),
    ], [
      task({ id: "fail-bad", kind: "RESOLVE_FAILURE", dueAt: null, createdAt: "bad" }),
      task({ id: "fail-valid", kind: "RESOLVE_FAILURE", dueAt: null, createdAt: daysBefore(1) }),
    ]));
    expect(order(result)).toEqual(["task:fail-valid", "task:fail-bad", "gate:script-valid", "gate:script-a", "gate:script-b"]);
  });

  it("returns the same ranking and exclusions whatever order the inputs arrive in", () => {
    const tie = daysBefore(2);
    const gates = [
      gate({ approvalId: "script-z", requestedAt: tie }),
      gate({ approvalId: "script-a", requestedAt: tie }),
      gate({ approvalId: "script-bad", requestedAt: "bad" }),
      gate({ approvalId: "diag", stage: "DIAGNOSIS", surface: "unavailable" }),
      gate({ approvalId: "orphan", attribution: { status: "ambiguous", reason: "upstream run does not resolve" } }),
      gate({ approvalId: "strategy", stage: "STRATEGY", requestedAt: tie }),
    ];
    const tasks = [
      task({ id: "perf-overdue", dueAt: daysBefore(9) }),
      task({ id: "perf-bad", dueAt: "bad" }),
      task({ id: "perf-open", dueAt: "2027-01-01T00:00:00Z" }),
      task({ id: "perf-none", dueAt: null }),
      task({ id: "brief-2", kind: "START_BRIEF", dueAt: null, createdAt: tie }),
      task({ id: "brief-1", kind: "START_BRIEF", dueAt: null, createdAt: tie }),
    ];
    const forward = rankNextDecision(view(gates, tasks));
    const reversed = rankNextDecision(view([...gates].reverse(), [...tasks].reverse()));
    expect(reversed).toEqual(forward);
    expect(order(forward)).toEqual(["task:perf-overdue", "gate:strategy", "gate:script-a", "gate:script-z", "gate:script-bad", "task:brief-1", "task:brief-2"]);
    expect(forward.excluded.map((item) => item.id)).toEqual(["gate:diag", "gate:orphan", "task:perf-bad", "task:perf-none", "task:perf-open"]);
  });
});
