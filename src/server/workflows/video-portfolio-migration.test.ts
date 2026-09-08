import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getWorkflowDefinition, WORKFLOW_FINALIZER_STEP } from "@/domain/production-workflows";

const migration = readFileSync(new URL("../../../supabase/migrations/202609070001_video_portfolio.sql", import.meta.url), "utf8");
const immutability = readFileSync(new URL("../../../supabase/migrations/202609070002_video_portfolio_immutability.sql", import.meta.url), "utf8");

describe("CHANNEL_VIDEO_PORTFOLIO migration", () => {
  it("extends workflow constraints and active uniqueness forward-only", () => {
    expect(migration).toContain("'CHANNEL_VIDEO_EXPERIMENT','CHANNEL_VIDEO_PORTFOLIO'");
    expect(migration).toContain("create unique index workflow_runs_active_video_portfolio_uniq");
    expect(migration).toContain("input_payload->>'portfolioCycleKey'");
    // Forward-only: the slice never edits a previously applied migration.
    expect(migration).not.toMatch(/drop\s+(?:function|index|trigger)\s+(?!if exists)/i);
  });

  it("keys concurrency on the cycle, which is the capacity a second allocation would double-spend", () => {
    expect(migration).toMatch(/workflow_runs_active_video_portfolio_uniq[\s\S]*?owner_id,[\s\S]*?portfolioCycleKey/);
    expect(migration).toContain("where workflow_type = 'CHANNEL_VIDEO_PORTFOLIO' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')");
    expect(migration).toContain("VIDEO_PORTFOLIO_LIMIT_REACHED: an active portfolio allocation already exists for this cycle");
    expect(migration).toContain("VIDEO_PORTFOLIO_LIMIT_REACHED: a concurrent portfolio allocation was already created for this cycle");
  });

  it("defines database-authoritative exact approved-Experiment resolution with the portfolio-eligibility gate", () => {
    expect(migration).toContain("resolve_approved_video_experiment_artifact");
    for (const invariant of [
      "UPSTREAM_EXPERIMENT_NOT_FINAL", "UPSTREAM_EXPERIMENT_SUPERSEDED", "UPSTREAM_EXPERIMENT_NOT_APPROVED",
      "UPSTREAM_EXPERIMENT_QA_INVALID", "UPSTREAM_EXPERIMENT_PROVENANCE_INVALID", "UPSTREAM_EXPERIMENT_LINEAGE_INVALID",
      "canonical hash mismatch", "nested Decision reference drift", "parent/root drift",
      "UPSTREAM_EXPERIMENT_NOT_PORTFOLIO_ELIGIBLE",
    ]) expect(migration).toContain(invariant);
    expect(migration).toContain("v_run.output_payload#>'{content,portfolioEligible}' is distinct from 'true'::jsonb");
  });

  it("re-hashes the full eleven-artifact transitive chain, not just the ten the Experiment scope already carries", () => {
    expect(migration).toContain("jsonb_array_length(v_scope_artifacts)<>10");
    expect(migration).toContain("v_scope_artifacts || jsonb_build_array(jsonb_build_object('workflowType','CHANNEL_VIDEO_EXPERIMENT'");
    expect(migration).toContain("transitive artifact mismatch");
  });

  it("enforces the current/non-superseded invariant on every transitive link, not only the direct run", () => {
    expect(migration).toContain("transitive artifact superseded");
    expect(migration.match(/context_payload->>'previousRunId'=/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("w.current_run_id=v_chain_run.id");
  });

  it("carries forward the root-lineage workflow_id pin rather than reintroducing the weaker predicate", () => {
    expect(migration).toContain("budget parent disagrees with lineage parent");
    expect(migration).toContain("resolved root is not a real run of this workflow");
    expect(migration).toContain("id=v_root and owner_id=v_run.owner_id and workflow_type=v_run.workflow_type and workflow_id=v_run.workflow_id");
  });

  it("treats a cross-owner experiment as NOT_FOUND rather than leaking its existence", () => {
    expect(migration).toContain("if v_role<>'service_role' and (auth.uid() is null or auth.uid()<>v_run.owner_id) then raise exception 'NOT_FOUND: exact CHANNEL_VIDEO_EXPERIMENT run'");
    expect(migration).not.toMatch(/raise exception 'FORBIDDEN/);
  });

  it("returns a bounded server-extracted candidate projection, never the experiment body", () => {
    for (const field of [
      "'candidateId','cand:'||v_run.id::text", "'treatmentMechanism',v_exp#>>'{semanticIntent,treatmentMechanism}'",
      "'primaryMetric',v_exp#>>'{primaryMetric,metric}'", "'experimentReady',v_out#>'{content,experimentReady}'",
      "'viewerValueState',v_out#>>'{content,viewerValueSafeguards,inheritedState}'",
      "'viewerValueContractHash',v_out#>>'{viewerValueProvenance,contractHash}'",
    ]) expect(migration).toContain(field);
    // The prose surfaces an allocation must never see are absent from the projection.
    for (const leaked of ["treatmentCondition", "stoppingConditions", "hypothesis", "interpretationPlan", "rollbackPlan", "viewerValueGuardrails"]) {
      expect(migration).not.toContain(`'${leaked}',`);
    }
  });

  it("preserves the full decision lineage in the projection so a commitment is traceable to its evidence", () => {
    for (const field of ["'decisionRunId',v_src->>'decisionRunId'", "'diagnosisRunId',v_src->>'diagnosisRunId'", "'performanceRunId',v_src->>'performanceRunId'", "'releaseRunId',v_src->>'releaseRunId'", "'topicId',v_src->>'topicId'"]) {
      expect(migration).toContain(field);
    }
  });

  it("validates the portfolio start input and resolves every selection pre-spend", () => {
    expect(migration).toContain("a cycle label, a slot count between one and six, and one to six experiment selections are required");
    expect(migration).toContain("each experiment selection needs exactly an experiment workflow and run ID");
    expect(migration).toContain("the same experiment run cannot be selected twice");
    expect(migration).toContain("for v_selection in select value from jsonb_array_elements(p_input->'experimentSelections') loop");
    expect(migration).toContain("v_experiment_refs := v_experiment_refs || jsonb_build_array(v_approved_experiment->'reference')");
    expect(migration).toContain("(p_input->>'concurrentExperimentSlots')::integer not between 1 and 6");
  });

  it("registers the canonical seven-step graph exactly as the domain definition declares it", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_PORTFOLIO", 1);
    expect(migration).toContain(definition.objective);
    for (const [position, step] of definition.steps.entries()) {
      expect(migration).toContain(`'key','${step.key}','position',${position},'kind','${step.kind}','capability','${step.capability}'`);
    }
  });

  it("promotes the portfolio finalizer and pins its provenance step", () => {
    expect(migration).toContain(`when 'CHANNEL_VIDEO_PORTFOLIO' then '${WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_PORTFOLIO}'`);
    expect(migration).toContain("when 'CHANNEL_VIDEO_PORTFOLIO' then 'validate-approved-experiments'");
    expect(migration).toContain("'portfolioCycleKey',v_old_run.input_payload->>'portfolioCycleKey'");
  });

  it("admits the eleventh paid workflow to accounting on the tighter no-retrieval ceilings", () => {
    expect(migration).toMatch(/v_no_retrieval := v_run\.workflow_type in \([^)]*'CHANNEL_VIDEO_PORTFOLIO'\)/);
    expect(migration).toMatch(/v_tight_ceiling := v_run\.workflow_type in \([^)]*'CHANNEL_VIDEO_PORTFOLIO'\)/);
    // Ceilings themselves are untouched by this slice.
    expect(migration).toContain("channelwright.research_usage_value(p_limits,'synthesisCalls') not between 1 and (case when v_tight_ceiling then 2 else 6 end)");
    expect(migration).toContain("channelwright.research_usage_value(p_limits,'automatedRevisions')<>(case when v_tight_ceiling then 0 else 1 end)");
  });

  it("keeps digest-calling functions on the widened search_path and everything else narrow", () => {
    expect(migration).toContain("create or replace function channelwright.resolve_approved_video_experiment_artifact(p_workflow_id uuid,p_run_id uuid)\nreturns jsonb language plpgsql security definer set search_path=channelwright,extensions,pg_temp");
    expect(migration).toContain("channelwright.decide_workflow_approval(p_workflow_id uuid,p_approval_id uuid,p_decision text,p_note text default null)\nreturns jsonb language plpgsql security definer set search_path=channelwright,extensions,pg_temp");
    expect(migration).not.toContain("search_path=public");
    expect(migration).not.toContain("search_path = public");
  });

  it("grants the new resolver to authenticated and service roles only", () => {
    expect(migration).toContain("revoke all on function channelwright.resolve_approved_video_experiment_artifact(uuid,uuid) from public,anon;");
    expect(migration).toContain("grant execute on function channelwright.resolve_approved_video_experiment_artifact(uuid,uuid) to authenticated,service_role;");
  });

  it("extends approved-artifact immutability to the allocation record without touching triggers", () => {
    expect(immutability).toContain("'CHANNEL_VIDEO_EXPERIMENT','CHANNEL_VIDEO_PORTFOLIO'");
    expect(immutability).toContain("create or replace function channelwright.protect_final_research_artifact()");
    expect(immutability).toContain("create or replace function channelwright.protect_final_research_step_output()");
    expect(immutability).toContain("APPROVED_ARTIFACT_IMMUTABLE");
    expect(immutability).not.toMatch(/create\s+trigger/i);
    expect(immutability).not.toMatch(/drop\s+trigger/i);
  });
});
