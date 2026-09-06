import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getWorkflowDefinition, WORKFLOW_FINALIZER_STEP } from "@/domain/production-workflows";

const migration = readFileSync(new URL("../../../supabase/migrations/202609050001_video_decision.sql", import.meta.url), "utf8");
const immutability = readFileSync(new URL("../../../supabase/migrations/202609050002_video_decision_immutability.sql", import.meta.url), "utf8");

describe("CHANNEL_VIDEO_DECISION migration", () => {
  it("extends workflow constraints and active uniqueness forward-only", () => {
    expect(migration).toContain("'CHANNEL_VIDEO_DIAGNOSIS','CHANNEL_VIDEO_DECISION'");
    expect(migration).toContain("create unique index workflow_runs_active_video_decision_uniq");
    expect(migration).toContain("approvedVideoDiagnosisReference");
  });

  it("defines database-authoritative exact approved-Diagnosis resolution", () => {
    expect(migration).toContain("resolve_approved_video_diagnosis_artifact");
    for (const invariant of ["UPSTREAM_DIAGNOSIS_NOT_FINAL", "UPSTREAM_DIAGNOSIS_SUPERSEDED", "UPSTREAM_DIAGNOSIS_NOT_APPROVED", "UPSTREAM_DIAGNOSIS_QA_INVALID", "UPSTREAM_DIAGNOSIS_PROVENANCE_INVALID", "UPSTREAM_DIAGNOSIS_LINEAGE_INVALID", "canonical hash mismatch", "nested Performance reference drift", "parent/root drift", "Diagnosis did not defer its decision"]) expect(migration).toContain(invariant);
  });

  it("re-hashes the full nine-artifact transitive chain, not just the eight Diagnosis already verified", () => {
    expect(migration).toContain("jsonb_array_length(v_scope_artifacts)<>8");
    expect(migration).toContain("v_scope_artifacts || jsonb_build_array(jsonb_build_object('workflowType','CHANNEL_VIDEO_DIAGNOSIS'");
    expect(migration).toContain("transitive artifact mismatch");
  });

  it("also enforces the current/non-superseded invariant on every transitive link, not only the direct run", () => {
    expect(migration).toContain("transitive artifact superseded");
    // the direct-run supersession test and the per-link test share the same shape:
    // current_run_id must match and no previousRunId successor may exist.
    expect(migration.match(/context_payload->>'previousRunId'=/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("w.current_run_id=v_chain_run.id");
  });

  it("accepts only two caller identifiers and injects authoritative state", () => {
    expect(migration).toContain("jsonb_object_length(p_input)<>2 or not (p_input?'videoDiagnosisWorkflowId') or not (p_input?'videoDiagnosisRunId')");
    expect(migration).toContain("k not in ('videoDiagnosisWorkflowId','videoDiagnosisRunId')");
    expect(migration).toContain("jsonb_build_object('approvedVideoDiagnosisReference',v_approved_diagnosis->'reference')");
  });

  it("registers the exact no-revision graph and finalizer, matching the TypeScript registry exactly", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_DECISION", 1);
    for (const step of definition.steps) expect(migration).toContain(`'key','${step.key}'`);
    expect(migration).not.toContain("bounded-video-decision-revision");
    expect(migration).toContain("when 'CHANNEL_VIDEO_DECISION' then 'finalize-video-decision'");
    expect(WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_DECISION).toBe("finalize-video-decision");
  });

  it("uses existing idempotency, leases, human successor runs, and canonical hashes", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("LEASE_NOT_ACTIVE");
    expect(migration).toContain("'human-revision:'||v_old_run.id::text");
    expect(migration).toContain("when 'CHANNEL_VIDEO_DECISION' then 'validate-approved-diagnosis'");
    expect(migration).toContain("upstreamDiagnosisRunId");
    expect(migration).toContain("encode(digest(output_payload::text,'sha256'),'hex')");
  });

  it("sets Decision accounting to no retrieval and exactly zero revisions, matching Diagnosis's tighter ceilings", () => {
    expect(migration).toContain("v_tight_ceiling := v_run.workflow_type in ('CHANNEL_VIDEO_DIAGNOSIS','CHANNEL_VIDEO_DECISION')");
    expect(migration).toContain("case when v_tight_ceiling then 0 else 1 end)");
  });

  it("adds the required error/limit vocabulary for Decision", () => {
    expect(migration).toContain("VIDEO_DECISION_LIMIT_REACHED");
    expect(migration).toContain("workflow_runs_active_video_decision_uniq");
  });
});

describe("CHANNEL_VIDEO_DECISION immutability migration", () => {
  it("protects approved output and finalized step payloads", () => {
    expect(immutability.match(/CHANNEL_VIDEO_DECISION/g)?.length).toBeGreaterThanOrEqual(2);
    expect(immutability).toContain("APPROVED_ARTIFACT_IMMUTABLE: finalized paid-workflow content cannot be mutated");
    expect(immutability).toContain("APPROVED_ARTIFACT_IMMUTABLE: finalized paid-workflow step output cannot be mutated");
  });
});
