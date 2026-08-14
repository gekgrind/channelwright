import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/202608110002_tenant_integrity.sql"), "utf8");

describe("tenant integrity migration contract", () => {
  it("binds owner-bearing relationships at the database boundary", () => {
    for (const constraint of [
      "video_projects_channel_owner_fk",
      "workflow_runs_channel_owner_fk",
      "workflow_runs_video_owner_fk",
      "agent_runs_workflow_owner_fk",
      "cost_events_channel_owner_fk",
      "cost_events_video_owner_fk",
      "cost_events_agent_owner_fk",
    ]) expect(sql).toContain(`constraint ${constraint}`);
  });

  it("binds versioned child records to the same parent aggregate", () => {
    for (const constraint of [
      "concept_research_version_channel_fk",
      "concept_viability_version_channel_fk",
      "concept_decisions_report_version_channel_fk",
      "script_qa_script_video_fk",
      "script_approvals_script_video_fk",
    ]) expect(sql).toContain(`constraint ${constraint}`);
  });
});
