import { describe, expect, it } from "vitest";
import {
  deterministicViewerValueGate,
  resolveViewerValueGate,
  viewerValueAssessmentSchema,
  viewerValueProvenanceSchema,
  type ViewerValueAssessment,
} from "./viewer-value";
import { viewerValueFixture } from "@/server/workflows/content-fixtures.test-helper";

const withContract = (patch: Partial<ViewerValueAssessment["contract"]>): ViewerValueAssessment =>
  viewerValueFixture({ contract: { ...viewerValueFixture().contract, ...patch } });

const weak = (rationale: string) => ({ verdict: "weak" as const, rationale, evidenceIds: [] });

describe("Viewer Value contract", () => {
  it("accepts a genuinely useful problem-solving concept", () => {
    const assessment = viewerValueFixture();
    expect(viewerValueAssessmentSchema.safeParse(assessment).success).toBe(true);
    expect(deterministicViewerValueGate(assessment).gate).toBe("PASS");
  });

  it("requires strengths, assumptions, uncertainties, and at least one gate reason", () => {
    for (const field of ["strengths", "assumptions", "uncertainties", "gateReasons"] as const) {
      expect(viewerValueAssessmentSchema.safeParse({ ...viewerValueFixture(), [field]: [] }).success).toBe(false);
    }
  });

  it("requires at least one value kind and one original-contribution kind", () => {
    const base = viewerValueFixture();
    expect(viewerValueAssessmentSchema.safeParse(withContract({ valuePromise: { ...base.contract.valuePromise, kinds: [] } })).success).toBe(false);
    expect(viewerValueAssessmentSchema.safeParse(withContract({ originalContribution: { ...base.contract.originalContribution, kinds: [] } })).success).toBe(false);
  });

  it("stays extensible: an unlisted value kind is expressible through OTHER with a label", () => {
    const base = viewerValueFixture();
    const extended = withContract({ valuePromise: { ...base.contract.valuePromise, kinds: [{ kind: "OTHER", label: "Community coordination" }] } });
    expect(viewerValueAssessmentSchema.safeParse(extended).success).toBe(true);
  });
});

describe("deterministic Viewer Value Gate", () => {
  it("rejects an untrustworthy concept outright", () => {
    const result = deterministicViewerValueGate(withContract({ trustworthiness: weak("Depends on claims that cannot be supported.") }));
    expect(result.gate).toBe("REJECT");
    expect(result.reasons.join(" ")).toContain("Trustworthiness");
  });

  it("rejects any blocking content-integrity finding", () => {
    const assessment = viewerValueFixture({
      integrityFindings: [{ risk: "UNSUPPORTED_INCOME_CLAIM", label: null, severity: "blocking", explanation: "Promises a monthly income figure with no basis.", evidenceIds: [] }],
    });
    expect(deterministicViewerValueGate(assessment).gate).toBe("REJECT");
  });

  it("asks for revision when the idea has potential but lacks specificity, originality, or differentiation", () => {
    const base = viewerValueFixture().contract;
    for (const patch of [
      { valuePromise: { ...base.valuePromise, specificity: weak("The promise is generic.") } },
      { originalContribution: { ...base.originalContribution, assessment: weak("It restates existing videos.") } },
      { differentiation: weak("Nothing distinguishes it from the sample.") },
      { evidenceSupport: weak("No claim is traceable.") },
      { sustainability: weak("A one-off with no channel role.") },
    ]) {
      expect(deterministicViewerValueGate(withContract(patch)).gate).toBe("REVISE");
    }
  });

  it("treats a material integrity risk as revisable but a blocking one as terminal", () => {
    const material = viewerValueFixture({ integrityFindings: [{ risk: "FALSE_URGENCY", label: null, severity: "material", explanation: "Framing implies urgency that does not exist.", evidenceIds: [] }] });
    expect(deterministicViewerValueGate(material).gate).toBe("REVISE");
  });

  it("refuses not_applicable on dimensions that always apply", () => {
    for (const dimension of ["differentiation", "evidenceSupport", "trustworthiness", "sustainability"] as const) {
      const result = deterministicViewerValueGate(withContract({ [dimension]: { verdict: "not_applicable", rationale: "Skipped.", evidenceIds: [] } }));
      expect(result.gate).toBe("REVISE");
      expect(result.reasons.join(" ")).toContain(dimension);
    }
  });

  it("allows not_applicable actionability, because value is format sensitive", () => {
    const narrative = withContract({ actionability: { verdict: "not_applicable", rationale: "A narrative documentary offers understanding, not a checklist.", evidenceIds: [] } });
    expect(deterministicViewerValueGate(narrative).gate).toBe("PASS");
  });

  it("does not penalise a concept merely for being AI assisted", () => {
    const aiAssisted = viewerValueFixture({
      policySignals: [{ category: "SYNTHETIC_MEDIA_DISCLOSURE", label: null, status: "REVIEW_REQUIRED", note: "Narration will be synthesised and must be disclosed at publish time." }],
    });
    expect(deterministicViewerValueGate(aiAssisted).gate).toBe("PASS");
  });
});

describe("gate resolution", () => {
  it("always takes the stricter of the deterministic floor and the model claim", () => {
    expect(resolveViewerValueGate("REJECT", "PASS")).toBe("REJECT");
    expect(resolveViewerValueGate("PASS", "REJECT")).toBe("REJECT");
    expect(resolveViewerValueGate("REVISE", "PASS")).toBe("REVISE");
    expect(resolveViewerValueGate("PASS", "REVISE")).toBe("REVISE");
    expect(resolveViewerValueGate("PASS", "PASS")).toBe("PASS");
  });
});

describe("transitive value provenance", () => {
  it("carries the originating stage, subject, contract hash, and gate for later drift detection", () => {
    const provenance = {
      originStage: "CONTENT_INTELLIGENCE" as const,
      originWorkflowType: "CHANNEL_CONTENT_INTELLIGENCE",
      originRunId: crypto.randomUUID(),
      subjectId: "topic:weekly-schedule-walkthrough",
      contractHash: "a".repeat(64),
      gate: "PASS" as const,
      assessedAt: "2026-08-15T12:00:00.000Z",
    };
    expect(viewerValueProvenanceSchema.safeParse(provenance).success).toBe(true);
    expect(viewerValueProvenanceSchema.safeParse({ ...provenance, contractHash: "short" }).success).toBe(false);
    // A future SCRIPT stage records the same shape against the same subject.
    expect(viewerValueProvenanceSchema.safeParse({ ...provenance, originStage: "SCRIPT", originWorkflowType: "VIDEO_SCRIPT" }).success).toBe(true);
  });
});
