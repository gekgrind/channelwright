import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const engine = readFileSync(resolve(process.cwd(), "supabase/migrations/202608130001_production_workflow_engine.sql"), "utf8").toLowerCase();
const strategy = readFileSync(resolve(process.cwd(), "supabase/migrations/202608140001_channel_strategy.sql"), "utf8").toLowerCase();
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608140002_finalize_strategy_output.sql"), "utf8").toLowerCase();

describe("CHANNEL_STRATEGY final output persistence migration", () => {
  it("documents the defect it corrects: the engine only promoted the research finalizer", () => {
    expect(engine).toContain("when v_step.step_key = 'synthesize-validation' then p_output");
    expect(engine).not.toContain("finalize-strategy");
    expect(strategy).not.toContain("create or replace function channelwright.complete_workflow_step");
  });

  it("promotes the canonical finalizer for each workflow type", () => {
    expect(migration).toContain("create or replace function channelwright.complete_workflow_step");
    expect(migration).toContain("when v_run_type = 'channel_strategy' and v_step.step_key = 'finalize-strategy' then p_output");
    expect(migration).toContain("when v_run_type <> 'channel_strategy' and v_step.step_key = 'synthesize-validation' then p_output");
    expect(migration).toContain("else output_payload end");
  });

  it("keys promotion on the run's workflow type so intermediate steps never become final output", () => {
    expect(migration).toContain("select workflow_type into v_run_type from channelwright.workflow_runs where id = v_step.workflow_run_id");
    for (const intermediate of ["validate-approved-research", "draft-strategy", "initial-strategy-qa", "bounded-strategy-revision", "final-strategy-qa"]) {
      expect(migration).not.toContain(`step_key = '${intermediate}' then p_output`);
    }
  });

  it("preserves every worker guarantee the engine already enforced", () => {
    expect(migration).toContain("workflow worker service role required");
    expect(migration).toContain("octet_length(p_output::text) > 65536");
    expect(migration).toContain("lease_token = p_lease_token and status = 'leased' and lease_expires_at > now() and cancellation_requested_at is null for update");
    expect(migration).toContain("lease_not_active: workflow step lease is not active");
    expect(migration).toContain("'completed', 'idempotentreplay', true");
    expect(migration).toContain("step_completed");
    expect(migration).toContain("revoke all on function channelwright.complete_workflow_step(uuid,uuid,jsonb) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function channelwright.complete_workflow_step(uuid,uuid,jsonb) to service_role");
  });

  it("keeps the corrected function inside the isolated schema with a pinned search path", () => {
    expect(migration).toContain("security definer set search_path = channelwright, pg_temp");
    expect(migration).not.toMatch(/(?:create|alter|drop) table public\./);
  });
});

describe("CHANNEL_STRATEGY concurrency guard migration", () => {
  it("adds a transactional partial unique index scoped to owner and approved research", () => {
    expect(migration).toContain("create unique index workflow_runs_active_strategy_uniq");
    expect(migration).toContain("(owner_id, ((input_payload->'approvedresearchreference'->>'researchrunid')))");
    expect(migration).toContain("where workflow_type = 'channel_strategy' and status in ('queued','running','waiting_for_approval','paused')");
  });

  it("excludes BLOCKED so lineage-preserving human-revision successors stay legal", () => {
    // decide_workflow_approval moves the predecessor to BLOCKED before inserting
    // the QUEUED successor, so only one row is ever indexed for a revision chain.
    expect(migration).not.toContain("'queued','running','waiting_for_approval','blocked','paused')\n  where workflow_type = 'channel_strategy'");
    expect(strategy).toContain("update channelwright.workflow_runs set status='blocked'");
    expect(strategy).toContain("'human-revision:'||v_old_run.id::text");
  });

  it("raises a stable typed error from both the explicit check and the race backstop", () => {
    expect(migration).toContain("strategy_limit_reached: an active strategy run already exists for this approved research");
    expect(migration).toContain("get stacked diagnostics v_constraint = constraint_name");
    expect(migration).toContain("if v_constraint = 'workflow_runs_active_strategy_uniq' then");
    expect(migration).toContain("strategy_limit_reached: a concurrent strategy run was already created for this approved research");
  });

  it("derives the guard identity from the canonical resolved reference, not raw client input", () => {
    expect(migration).toContain("v_upstream_run := v_approved_research->'reference'->>'researchrunid'");
    expect(migration).toContain("input_payload->'approvedresearchreference'->>'researchrunid' = v_upstream_run");
  });

  it("re-raises non-strategy unique violations instead of mislabelling idempotency conflicts", () => {
    expect(migration).toContain("raise;");
    expect(migration).toContain("idempotency_conflict: key reused with different workflow input");
  });

  it("leaves the CHANNEL_RESEARCH single-active-run guard exactly as it was", () => {
    expect(migration).toContain("research_limit_reached: an active research run already exists");
    expect(migration).toContain("workflow_type='channel_research' and status in ('queued','running','waiting_for_approval','blocked','paused')");
  });

  it("preserves canonical graph enforcement, ownership, idempotency, and payload bounds", () => {
    expect(migration).toContain("v_owner uuid := auth.uid()");
    expect(migration).toContain("not_allowed: authenticated owner required");
    expect(migration).toContain("workflow_type_invalid: canonical workflow definition required");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("octet_length(p_input::text) > 32768");
    expect(migration).toContain("resolve_approved_research_artifact");
    expect(migration).toContain("revoke all on function channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb) from public, anon");
    expect(migration).toContain("grant execute on function channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb) to authenticated");
  });
});

describe("forward-only migration discipline", () => {
  it("does not rewrite any already-applied migration", () => {
    // The corrected behaviour must live only in the new forward migration.
    expect(engine).not.toContain("v_run_type");
    expect(strategy).not.toContain("workflow_runs_active_strategy_uniq");
    expect(strategy).not.toContain("strategy_limit_reached");
  });

  it("uses an index name the migration gate can verify (no IF NOT EXISTS capture hazard)", () => {
    expect(migration).not.toMatch(/create\s+unique\s+index\s+if\s+not\s+exists/);
    const declared = [...migration.matchAll(/create\s+(?:unique\s+)?index\s+([a-z0-9_]+)/g)].map((match) => match[1]);
    expect(declared).toEqual(["workflow_runs_active_strategy_uniq"]);
  });
});
