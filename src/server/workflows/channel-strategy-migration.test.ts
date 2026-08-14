import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202608140001_channel_strategy.sql", "utf8").toLowerCase();

describe("CHANNEL_STRATEGY migration", () => {
  it("extends the canonical workflow and exact approved-research boundary", () => {
    expect(migration).toContain("'channel_strategy'");
    expect(migration).toContain("resolve_approved_research_artifact");
    expect(migration).toContain("upstream_research_integrity_mismatch");
    expect(migration).toContain("jsonb_object_length(p_input) <> 2");
  });

  it("reuses durable accounting, successor lineage, and immutable final artifacts", () => {
    expect(migration).toContain("ensure_research_run_budget");
    expect(migration).toContain("'human-revision:'||v_old_run.id::text");
    expect(migration).toContain("artifact_hash");
    expect(migration).toContain("provenance_hash");
    expect(migration).toContain("workflow_approvals_protect_final");
  });
});
