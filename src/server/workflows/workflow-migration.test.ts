import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/202608130001_production_workflow_engine.sql"), "utf8").toLowerCase();

describe("production workflow migration contract", () => {
  it("keeps every new relation inside the Channelwright schema", () => {
    for (const table of ["workflows", "workflow_steps", "workflow_step_attempts", "workflow_approvals", "workflow_events"]) {
      expect(migration).toContain(`create table channelwright.${table}`);
      expect(migration).toContain(`alter table channelwright.${table} enable row level security`);
    }
    expect(migration).not.toMatch(/(?:create|alter|drop) table public\./);
  });

  it("models runs, steps, attempts, approvals, and structured events", () => {
    expect(migration).toContain("workflow_runs_workflow_owner_fk");
    expect(migration).toContain("unique (workflow_run_id, step_key)");
    expect(migration).toContain("unique (workflow_step_id, attempt_number)");
    expect(migration).toContain("status in ('pending','approved','rejected')");
    expect(migration).toContain("actor_type text not null check (actor_type in ('user','worker','system','ai'))");
  });

  it("enforces authenticated ownership and service-role-only worker mutation", () => {
    expect(migration).toContain("v_owner uuid := auth.uid()");
    expect(migration).toContain("workflow worker service role required");
    expect(migration).toContain("revoke all on function channelwright.claim_workflow_step(text,integer) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function channelwright.claim_workflow_step(text,integer) to service_role");
    expect(migration).toContain("revoke insert, update, delete on channelwright.workflow_runs from authenticated");
  });

  it("implements idempotency, leases, retry bounds, recovery, cancellation, and approval transitions", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("idempotency_conflict");
    expect(migration).toContain("for update skip locked limit 1");
    expect(migration).toContain("lease_expired");
    expect(migration).toContain("attempt_count < s.max_attempts");
    expect(migration).toContain("p_retryable and v_step.attempt_count < v_step.max_attempts");
    expect(migration).toContain("create or replace function channelwright.cancel_workflow");
    expect(migration).toContain("create or replace function channelwright.decide_workflow_approval");
  });

  it("pins SECURITY DEFINER search paths and bounds durable JSON", () => {
    const functions = migration.match(/security definer set search_path = channelwright, pg_temp/g) ?? [];
    expect(functions).toHaveLength(7);
    expect(migration).toContain("octet_length(p_input::text) > 32768");
    expect(migration).toContain("octet_length(p_output::text) > 65536");
  });
});

