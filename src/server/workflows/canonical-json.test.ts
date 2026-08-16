import { describe, expect, it } from "vitest";
import { canonicalEquals, canonicalJson } from "./canonical-json";
import { approvedResearchReferenceFixture } from "./strategy-fixtures.test-helper";

describe("canonical provenance serialization", () => {
  it("treats reordered keys as identical", () => {
    const reordered = Object.fromEntries(Object.entries(approvedResearchReferenceFixture).reverse());
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(approvedResearchReferenceFixture));
    expect(canonicalEquals(reordered, approvedResearchReferenceFixture)).toBe(true);
  });

  it("still detects every provenance-significant change", () => {
    const changes = [
      { researchRunId: crypto.randomUUID() },
      { researchWorkflowId: crypto.randomUUID() },
      { approvedBy: crypto.randomUUID() },
      { approvalId: crypto.randomUUID() },
      { researchArtifactHash: "c".repeat(64) },
      { evidenceProvenanceHash: "d".repeat(64) },
      { rootRunId: crypto.randomUUID() },
      { parentRunId: crypto.randomUUID() },
      { finalQaScore: 91 },
      { finalQaState: "human_review_required" as const },
      { workflowDefinitionVersion: 2 },
    ];
    for (const change of changes) {
      expect(canonicalEquals({ ...approvedResearchReferenceFixture, ...change }, approvedResearchReferenceFixture)).toBe(false);
    }
  });

  it("does not confuse null, absent, and falsy members", () => {
    expect(canonicalEquals({ parentRunId: null }, {})).toBe(false);
    expect(canonicalEquals({ a: undefined }, {})).toBe(true);
    expect(canonicalEquals({ a: 0 }, { a: "0" })).toBe(false);
    expect(canonicalEquals({ a: false }, { a: null })).toBe(false);
  });

  it("preserves array order while sorting object keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2, 1], c: 2 } })).toBe('{"a":{"c":2,"d":[3,2,1]},"b":1}');
    expect(canonicalEquals({ list: [1, 2] }, { list: [2, 1] })).toBe(false);
  });

  it("sorts by code unit so output is locale independent", () => {
    expect(canonicalJson({ Z: 1, a: 2, A: 3 })).toBe('{"A":3,"Z":1,"a":2}');
  });
});
