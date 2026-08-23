import { describe, expect, it } from "vitest";
import { databaseError } from "./production-workflow-repository";

const map = (message: string) => {
  const mapped = databaseError({ message });
  return { code: mapped.code, status: mapped.status };
};

describe("workflow database error mapping", () => {
  it("surfaces the strategy concurrency guard as a stable retry-later code", () => {
    expect(map("STRATEGY_LIMIT_REACHED: an active strategy run already exists for this approved research")).toEqual({ code: "STRATEGY_LIMIT_REACHED", status: 429 });
    expect(map("STRATEGY_LIMIT_REACHED: a concurrent strategy run was already created for this approved research")).toEqual({ code: "STRATEGY_LIMIT_REACHED", status: 429 });
  });

  it("keeps the research guard distinct from the strategy guard", () => {
    expect(map("RESEARCH_LIMIT_REACHED: an active research run already exists")).toEqual({ code: "RESEARCH_LIMIT_REACHED", status: 429 });
  });

  it("surfaces the PostgreSQL video-brief guards as stable application errors", () => {
    expect(map("VIDEO_BRIEF_LIMIT_REACHED: an active video-brief run already exists for this approved topic")).toEqual({ code: "VIDEO_BRIEF_LIMIT_REACHED", status: 429 });
    expect(map("VIDEO_BRIEF_LIMIT_REACHED: a concurrent video-brief run was already created for this approved topic")).toEqual({ code: "VIDEO_BRIEF_LIMIT_REACHED", status: 429 });
  });

  it("maps every upstream-content invalidity to one opaque 409 conflict", () => {
    for (const message of [
      "UPSTREAM_CONTENT_NOT_FINAL: content intelligence must be completed and final",
      "UPSTREAM_CONTENT_NOT_APPROVED: exact content-intelligence run is not human approved",
      "UPSTREAM_CONTENT_INTEGRITY_MISMATCH: stored integrity data does not match",
      "UPSTREAM_CONTENT_QA_INVALID: final QA did not pass",
      "UPSTREAM_CONTENT_PROVENANCE_INVALID: discovery evidence is missing",
      "UPSTREAM_CONTENT_LINEAGE_INVALID",
    ]) expect(map(message)).toEqual({ code: "UPSTREAM_CONTENT_INVALID", status: 409 });
  });

  it("separates an unusable topic selection from a broken upstream artifact", () => {
    for (const message of [
      "TOPIC_NOT_IN_APPROVED_BACKLOG: the selected topic is not in the approved ranked backlog",
      "TOPIC_NOT_IN_APPROVED_ARTIFACT: the selected topic does not belong to this content-intelligence artifact",
      "TOPIC_VIEWER_VALUE_NOT_ELIGIBLE: the selected topic did not pass the Viewer Value gate",
      "TOPIC_EVIDENCE_MISSING: the selected topic cites no discovery evidence",
    ]) expect(map(message)).toEqual({ code: "TOPIC_INVALID", status: 422 });
  });

  it("keeps a cross-owner content-intelligence lookup non-enumerable", () => {
    expect(map("NOT_FOUND: exact CHANNEL_CONTENT_INTELLIGENCE run")).toEqual({ code: "NOT_FOUND", status: 404 });
    expect(map("NOT_FOUND: exact CHANNEL_CONTENT_INTELLIGENCE workflow")).toEqual({ code: "NOT_FOUND", status: 404 });
  });

  it("maps the established workflow failure surface unchanged", () => {
    expect(map("IDEMPOTENCY_CONFLICT: key reused with different workflow input")).toEqual({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    expect(map("UPSTREAM_RESEARCH_NOT_APPROVED: exact research run is not human approved")).toEqual({ code: "UPSTREAM_RESEARCH_INVALID", status: 409 });
    expect(map("UPSTREAM_RESEARCH_INTEGRITY_MISMATCH: stored integrity data does not match")).toEqual({ code: "UPSTREAM_RESEARCH_INVALID", status: 409 });
    expect(map("WORKFLOW_TYPE_INVALID: canonical workflow definition required")).toEqual({ code: "WORKFLOW_TYPE_INVALID", status: 422 });
    expect(map("PAYLOAD_TOO_LARGE: workflow input must be a bounded object")).toEqual({ code: "PAYLOAD_TOO_LARGE", status: 413 });
    expect(map("NOT_FOUND: workflow approval")).toEqual({ code: "NOT_FOUND", status: 404 });
    expect(map("INVALID_TRANSITION: approval is already final")).toEqual({ code: "INVALID_TRANSITION", status: 409 });
    expect(map("LEASE_NOT_ACTIVE: workflow step lease is not active")).toEqual({ code: "LEASE_NOT_ACTIVE", status: 409 });
    expect(map("VALIDATION_ERROR: exact research workflow and run IDs are required")).toEqual({ code: "VALIDATION_ERROR", status: 422 });
    expect(map("NOT_ALLOWED: authenticated owner required")).toEqual({ code: "INVALID_TRANSITION", status: 409 });
  });

  it("never leaks an unrecognised database message to the caller", () => {
    const mapped = databaseError({ message: 'duplicate key value violates unique constraint "workflow_runs_active_strategy_uniq"' });
    expect(mapped.code).toBe("DATABASE_ERROR");
    expect(mapped.status).toBe(500);
    expect(mapped.message).toBe("The workflow operation could not be completed.");
    expect(mapped.message).not.toContain("workflow_runs_active_strategy_uniq");
  });
});
