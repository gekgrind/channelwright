import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608130004_research_usage_accounting.sql"), "utf8").toLowerCase();
const compatibilityMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608130005_research_usage_jsonb_compat.sql"), "utf8").toLowerCase();

describe("durable CHANNEL_RESEARCH usage migration", () => {
  it("keeps run budgets and operation events inside the isolated schema", () => {
    expect(migration).toContain("create table channelwright.research_run_budgets");
    expect(migration).toContain("create table channelwright.research_usage_operations");
    expect(migration).not.toMatch(/(?:create|alter|drop) table public\./);
    expect(migration).toContain("research_budgets_run_owner_fk");
    expect(migration).toContain("research_usage_attempt_owner_fk");
  });

  it("uses an atomic row-locked reservation and idempotent operation key", () => {
    expect(migration).toContain("unique (workflow_run_id, operation_key)");
    expect(migration).toContain("where workflow_run_id = p_run_id for update");
    expect(migration).toContain("used_totals,v_key) + channelwright.research_usage_value(v_budget.reserved_totals,v_key)");
    expect(migration).toContain("idempotency_conflict: research operation key changed");
    expect(migration).toContain("research_resource_budget_exhausted");
  });

  it("binds reservations to the active attempt while allowing post-spend finalization", () => {
    expect(migration).toContain("lease_token = p_lease_token and status = 'leased' and lease_expires_at > now()");
    expect(migration).toContain("workflow_step_attempts where workflow_step_id = p_step_id and lease_token = p_lease_token and status = 'started'");
    expect(migration).toContain("status in ('reserved','succeeded','failed','rejected')");
    expect(migration).toContain("actual usage exceeds reservation");
  });

  it("makes accounting owner-readable but service-role-maintained", () => {
    expect(migration).toContain("research_run_budgets_owner_select");
    expect(migration).toContain("research_usage_operations_owner_select");
    expect(migration).toContain("revoke insert, update, delete on channelwright.research_run_budgets from authenticated");
    expect(migration).toContain("revoke all on function channelwright.reserve_research_usage(uuid,uuid,uuid,text,text,text,text,jsonb) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function channelwright.reserve_research_usage(uuid,uuid,uuid,text,text,text,text,jsonb) to service_role");
  });

  it("keeps successor budgets separate with queryable lineage and freezes final artifacts", () => {
    expect(migration).toContain("parent_run_id uuid");
    expect(migration).toContain("root_run_id uuid not null");
    expect(migration).toContain("previousrunid");
    expect(migration).toContain("approved_artifact_immutable");
    expect(migration).toContain("workflow_runs_protect_final_research");
    expect(migration).toContain("workflow_steps_protect_final_research");
  });

  it("provides the project-compatible bounded-object length helper through a forward migration", () => {
    expect(compatibilityMigration).toContain("create or replace function channelwright.jsonb_object_length");
    expect(compatibilityMigration).toContain("jsonb_object_keys(p_value)");
    expect(compatibilityMigration).toContain("revoke all on function channelwright.jsonb_object_length(jsonb) from public, anon, authenticated");
  });
});
