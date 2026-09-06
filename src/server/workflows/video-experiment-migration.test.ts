import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getWorkflowDefinition, WORKFLOW_FINALIZER_STEP } from "@/domain/production-workflows";

const migration = readFileSync(new URL("../../../supabase/migrations/202609060001_video_experiment.sql", import.meta.url), "utf8");
const immutability = readFileSync(new URL("../../../supabase/migrations/202609060002_video_experiment_immutability.sql", import.meta.url), "utf8");

describe("CHANNEL_VIDEO_EXPERIMENT migration", () => {
  it("extends workflow constraints and active uniqueness forward-only", () => {
    expect(migration).toContain("'CHANNEL_VIDEO_DECISION','CHANNEL_VIDEO_EXPERIMENT'");
    expect(migration).toContain("create unique index workflow_runs_active_video_experiment_uniq");
    expect(migration).toContain("approvedVideoDecisionReference");
  });

  it("defines database-authoritative exact approved-Decision resolution with the experiment-eligibility gate", () => {
    expect(migration).toContain("resolve_approved_video_decision_artifact");
    for (const invariant of ["UPSTREAM_DECISION_NOT_FINAL", "UPSTREAM_DECISION_SUPERSEDED", "UPSTREAM_DECISION_NOT_APPROVED", "UPSTREAM_DECISION_QA_INVALID", "UPSTREAM_DECISION_PROVENANCE_INVALID", "UPSTREAM_DECISION_LINEAGE_INVALID", "canonical hash mismatch", "nested Diagnosis reference drift", "parent/root drift", "UPSTREAM_DECISION_NOT_EXPERIMENT_ELIGIBLE"]) expect(migration).toContain(invariant);
    expect(migration).toContain("v_run.output_payload#>'{content,experimentEligible}' is distinct from 'true'::jsonb");
  });

  it("re-hashes the full ten-artifact transitive chain, not just the nine the Decision scope already carries", () => {
    expect(migration).toContain("jsonb_array_length(v_scope_artifacts)<>9");
    expect(migration).toContain("v_scope_artifacts || jsonb_build_array(jsonb_build_object('workflowType','CHANNEL_VIDEO_DECISION'");
    expect(migration).toContain("transitive artifact mismatch");
  });

  it("also enforces the current/non-superseded invariant on every transitive link, not only the direct run", () => {
    expect(migration).toContain("transitive artifact superseded");
    expect(migration.match(/context_payload->>'previousRunId'=/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("w.current_run_id=v_chain_run.id");
  });

  it("authoritatively reconciles parent/root lineage, not only whether previousRunId names some run", () => {
    expect(migration).toContain("budget parent disagrees with lineage parent");
    expect(migration).toContain("resolved root is not a real run of this workflow");
    expect(migration).toContain("select true, parent_run_id, root_run_id into v_budget_found, v_budget_parent, v_root");
  });

  it("accepts only two caller identifiers and injects authoritative state", () => {
    expect(migration).toContain("jsonb_object_length(p_input)<>2 or not (p_input?'videoDecisionWorkflowId') or not (p_input?'videoDecisionRunId')");
    expect(migration).toContain("k not in ('videoDecisionWorkflowId','videoDecisionRunId')");
    expect(migration).toContain("jsonb_build_object('approvedVideoDecisionReference',v_approved_decision->'reference')");
  });

  it("registers the exact no-revision graph and finalizer, matching the TypeScript registry exactly", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_EXPERIMENT", 1);
    for (const step of definition.steps) expect(migration).toContain(`'key','${step.key}'`);
    expect(migration).not.toContain("bounded-video-experiment-revision");
    expect(migration).toContain("when 'CHANNEL_VIDEO_EXPERIMENT' then 'finalize-video-experiment'");
    expect(WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_EXPERIMENT).toBe("finalize-video-experiment");
  });

  it("uses existing idempotency, leases, human successor runs, and canonical hashes", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("LEASE_NOT_ACTIVE");
    expect(migration).toContain("'human-revision:'||v_old_run.id::text");
    expect(migration).toContain("when 'CHANNEL_VIDEO_EXPERIMENT' then 'validate-approved-decision'");
    expect(migration).toContain("upstreamDecisionRunId");
    expect(migration).toContain("encode(digest(output_payload::text,'sha256'),'hex')");
  });

  it("sets Experiment accounting to no retrieval and exactly zero revisions, matching the tight ceilings", () => {
    expect(migration).toContain("v_tight_ceiling := v_run.workflow_type in ('CHANNEL_VIDEO_DIAGNOSIS','CHANNEL_VIDEO_DECISION','CHANNEL_VIDEO_EXPERIMENT')");
    expect(migration).toContain("case when v_tight_ceiling then 0 else 1 end)");
  });

  it("adds the required error/limit vocabulary for Experiment", () => {
    expect(migration).toContain("VIDEO_EXPERIMENT_LIMIT_REACHED");
    expect(migration).toContain("workflow_runs_active_video_experiment_uniq");
  });

  it("projects decision-type / category / experiment-eligible facts into the experiment scope", () => {
    expect(migration).toContain("'key','fact:decision-type'");
    expect(migration).toContain("'key','fact:decision-category'");
    expect(migration).toContain("'key','fact:experiment-eligible'");
  });
});

describe("CHANNEL_VIDEO_EXPERIMENT immutability migration", () => {
  it("protects approved output and finalized step payloads", () => {
    expect(immutability.match(/CHANNEL_VIDEO_EXPERIMENT/g)?.length).toBeGreaterThanOrEqual(2);
    expect(immutability).toContain("APPROVED_ARTIFACT_IMMUTABLE: finalized paid-workflow content cannot be mutated");
    expect(immutability).toContain("APPROVED_ARTIFACT_IMMUTABLE: finalized paid-workflow step output cannot be mutated");
  });
});
