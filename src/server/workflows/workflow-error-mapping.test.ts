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
