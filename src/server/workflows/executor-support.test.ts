import { describe, expect, it } from "vitest";
import type { ClaimedWorkflowStep } from "@/domain/production-workflows";
import { findingFingerprint, newlyIntroducedErrors, requirePriorOutput } from "./executor-support";

const step = { priorOutputs: { present: { value: 1 } } } as unknown as ClaimedWorkflowStep;

describe("shared workflow executor support", () => {
  it("parses a present prior output and raises the caller's error when missing", () => {
    expect(requirePriorOutput(step, "present", (value) => value, () => new Error("unused"))).toEqual({ value: 1 });
    expect(() => requirePriorOutput(step, "absent", (value) => value, (key) => new Error(`missing ${key}`))).toThrow("missing absent");
  });

  it("reports only errors that the revision introduced", () => {
    const before = [{ severity: "error", code: "A", evidenceIds: ["two", "one"] }];
    const after = [
      { severity: "error", code: "A", evidenceIds: ["one", "two"] },
      { severity: "error", code: "B", evidenceIds: [] },
      { severity: "warning", code: "C", evidenceIds: [] },
    ];
    expect(newlyIntroducedErrors(before, after).map(findingFingerprint)).toEqual(["B:"]);
  });
});
