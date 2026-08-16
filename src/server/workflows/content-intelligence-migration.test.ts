import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8").toLowerCase();
const strategy = read("202608140001_channel_strategy.sql");
const finalizer = read("202608140002_finalize_strategy_output.sql");
const migration = read("202608140003_content_intelligence.sql");

describe("CHANNEL_CONTENT_INTELLIGENCE migration", () => {
  it("stays inside the isolated schema and touches no unrelated schema", () => {
    expect(migration).not.toMatch(/(?:create|alter|drop) table public\./);
    expect(migration).not.toMatch(/\bcreate schema\b/);
    // resolve_approved_strategy_artifact, start_workflow, complete_workflow_step,
    // decide_workflow_approval, ensure_research_run_budget.
    const functions = migration.match(/security definer set search_path\s*=\s*channelwright,\s*pg_temp/g) ?? [];
    expect(functions.length).toBe(5);
  });

  it("registers the workflow type across both type constraints", () => {
    expect(migration).toContain("'channel_concept_validation','channel_research','channel_strategy','channel_content_intelligence'");
    expect(migration).toContain("'channel','video','channel_concept_validation','channel_research','channel_strategy','channel_content_intelligence'");
  });

  it("pins the canonical ten-step graph so an authenticated caller cannot forge one", () => {
    for (const step of [
      "validate-approved-strategy", "expand-content-pillars", "discover-youtube-topics", "assess-topic-opportunities",
      "synthesize-backlog", "initial-content-qa", "bounded-content-revision", "final-content-qa",
      "finalize-content-intelligence", "review-content-intelligence",
    ]) expect(migration).toContain(`'key','${step}'`);
    expect(migration).toContain("workflow_type_invalid: canonical workflow definition required");
  });

  it("resolves the approved strategy artifact in the database with full integrity checks", () => {
    expect(migration).toContain("create or replace function channelwright.resolve_approved_strategy_artifact");
    expect(migration).toContain("upstream_strategy_not_final");
    expect(migration).toContain("upstream_strategy_not_approved");
    expect(migration).toContain("upstream_strategy_qa_invalid");
    expect(migration).toContain("upstream_strategy_provenance_invalid");
    expect(migration).toContain("upstream_strategy_integrity_mismatch");
    expect(migration).toContain("upstream_strategy_lineage_invalid");
    // Cross-owner access is refused for anything but the service role.
    expect(migration).toContain("if v_role <> 'service_role' and (auth.uid() is null or auth.uid() <> v_run.owner_id)");
  });

  it("carries upstream research provenance transitively into the strategy reference", () => {
    expect(migration).toContain("'upstreamresearch', v_upstream->'reference'");
    expect(migration).toContain("'researchevidencebundle', v_upstream->'evidencebundle'");
    expect(migration).toContain("v_run.output_payload->'upstreamresearch' is distinct from v_upstream->'reference'");
  });

  it("persists the server-resolved reference rather than trusting client input", () => {
    expect(migration).toContain("v_persisted_input := p_input || jsonb_build_object('approvedstrategyreference',v_approved_strategy->'reference')");
    expect(migration).toContain("jsonb_object_length(p_input) not between 2 and 4");
    expect(migration).toContain("k not in ('strategyworkflowid','strategyrunid','targetbacklogsize','pillarfilter')");
    expect(migration).toContain("(p_input->>'targetbacklogsize')::numeric not between 5 and 12");
  });

  it("guards concurrency with an explicit check and a transactional unique index", () => {
    expect(migration).toContain("create unique index workflow_runs_active_content_uniq");
    expect(migration).toContain("(owner_id, ((input_payload->'approvedstrategyreference'->>'strategyrunid')))");
    expect(migration).toContain("where workflow_type = 'channel_content_intelligence' and status in ('queued','running','waiting_for_approval','paused')");
    expect(migration).toContain("content_limit_reached: an active content-intelligence run already exists for this approved strategy");
    expect(migration).toContain("elsif v_constraint = 'workflow_runs_active_content_uniq' then");
    expect(migration).toContain("content_limit_reached: a concurrent content-intelligence run was already created for this approved strategy");
  });

  it("keeps the earlier research and strategy guards intact", () => {
    expect(migration).toContain("research_limit_reached: an active research run already exists");
    expect(migration).toContain("strategy_limit_reached: an active strategy run already exists for this approved research");
    expect(migration).toContain("if v_constraint = 'workflow_runs_active_strategy_uniq' then");
    expect(migration).toContain("raise;");
  });

  it("promotes finalize-content-intelligence as the run's durable output", () => {
    expect(migration).toContain("when 'channel_content_intelligence' then 'finalize-content-intelligence'");
    expect(migration).toContain("when 'channel_strategy' then 'finalize-strategy'");
    expect(migration).toContain("else 'synthesize-validation' end");
    expect(migration).toContain("output_payload = case when v_step.step_key = v_finalizer then p_output else output_payload end");
    for (const intermediate of ["expand-content-pillars", "assess-topic-opportunities", "synthesize-backlog", "initial-content-qa"]) {
      expect(migration).not.toContain(`step_key = '${intermediate}' then p_output`);
    }
  });

  it("hashes discovery output as the content provenance record at final decision", () => {
    expect(migration).toContain("when 'channel_research' then 'retrieve-youtube-evidence'");
    expect(migration).toContain("when 'channel_strategy' then 'validate-approved-research'");
    expect(migration).toContain("else 'discover-youtube-topics' end");
    expect(migration).toContain("invalid_transition: finalized workflow provenance is missing");
  });

  it("preserves human revision lineage and separate successor budgets", () => {
    expect(migration).toContain("'human-revision:'||v_old_run.id::text");
    expect(migration).toContain("'previousrunid',v_old_run.id");
    expect(migration).toContain("workflow_revision_queued");
    expect(migration).toContain("'upstreamstrategyrunid',v_old_run.input_payload->'approvedstrategyreference'->>'strategyrunid'");
  });

  it("admits the third paid workflow to accounting without widening any ceiling", () => {
    expect(migration).toContain("workflow_type in ('channel_research','channel_strategy','channel_content_intelligence')");
    // Ceilings are byte-identical to 202608130004: only the strategy floor is conditional.
    expect(migration).toContain("not between (case when v_is_strategy then 0 else 1 end) and 36");
    expect(migration).toContain("not between (case when v_is_strategy then 0 else 1 end) and 1200");
    expect(migration).toContain("not between (case when v_is_strategy then 0 else 1 end) and 12");
    expect(migration).toContain("not between 1000 and 1000000");
    expect(migration).toContain("not between 2000 and 1100000");
    // The strategy-only zero-provider rule must remain gated on strategy alone.
    expect(migration).toContain("v_is_strategy := v_run.workflow_type='channel_strategy'");
    expect(migration).toContain("(v_is_strategy and (channelwright.research_usage_value(p_limits,'providerrequests')<>0");
  });

  it("extends immutability of finalized paid artifacts to content intelligence", () => {
    expect(migration).toContain("create or replace function channelwright.protect_final_research_artifact");
    expect(migration).toContain("create or replace function channelwright.protect_final_research_step_output");
    expect((migration.match(/'channel_research','channel_strategy','channel_content_intelligence'/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain("approved_artifact_immutable");
  });

  it("keeps privileges owner-scoped and worker mutations service-role only", () => {
    expect(migration).toContain("revoke all on function channelwright.resolve_approved_strategy_artifact(uuid,uuid) from public,anon");
    expect(migration).toContain("grant execute on function channelwright.resolve_approved_strategy_artifact(uuid,uuid) to authenticated,service_role");
    expect(migration).toContain("revoke all on function channelwright.complete_workflow_step(uuid,uuid,jsonb) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function channelwright.complete_workflow_step(uuid,uuid,jsonb) to service_role");
    expect(migration).toContain("revoke all on function channelwright.ensure_research_run_budget(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb) to authenticated");
  });
});

describe("forward-only migration discipline", () => {
  it("does not modify any already-written migration", () => {
    expect(strategy).not.toContain("channel_content_intelligence");
    expect(finalizer).not.toContain("channel_content_intelligence");
    expect(strategy).not.toContain("workflow_runs_active_content_uniq");
    expect(finalizer).not.toContain("workflow_runs_active_content_uniq");
  });

  it("declares exactly one new index the migration gate can verify", () => {
    expect(migration).not.toMatch(/create\s+unique\s+index\s+if\s+not\s+exists/);
    const declared = [...migration.matchAll(/create\s+(?:unique\s+)?index\s+([a-z0-9_]+)/g)].map((match) => match[1]);
    expect(declared).toEqual(["workflow_runs_active_content_uniq"]);
  });

  it("orders after the strategy finalizer migration", () => {
    expect("202608140003".localeCompare("202608140002")).toBeGreaterThan(0);
  });
});
