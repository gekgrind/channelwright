import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/202608130002_workflow_advisor_hardening.sql"), "utf8");

describe("workflow advisor hardening migration", () => {
  it("uses init-plan owner checks for every new workflow policy", () => {
    for (const policy of ["workflows_owner_select", "workflow_steps_owner_select", "workflow_attempts_owner_select", "workflow_approvals_owner_select", "workflow_events_owner_select"]) {
      expect(sql).toContain(`alter policy ${policy}`);
    }
    expect(sql.match(/owner_id = \(select auth\.uid\(\)\)/g)).toHaveLength(5);
  });

  it("removes indexes duplicated by unique constraints", () => {
    expect(sql).toContain("drop index if exists channelwright.workflow_steps_run_idx");
    expect(sql).toContain("drop index if exists channelwright.workflow_attempts_step_idx");
  });
});

