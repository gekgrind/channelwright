import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../../supabase/migrations/202609040001_video_diagnosis.sql", import.meta.url), "utf8");
const immutability = readFileSync(new URL("../../../supabase/migrations/202609040002_video_diagnosis_immutability.sql", import.meta.url), "utf8");

describe("CHANNEL_VIDEO_DIAGNOSIS migration", () => {
  it("extends workflow constraints and active uniqueness forward-only", () => {
    expect(migration).toContain("'CHANNEL_VIDEO_PERFORMANCE','CHANNEL_VIDEO_DIAGNOSIS'");
    expect(migration).toContain("create unique index workflow_runs_active_video_diagnosis_uniq");
    expect(migration).toContain("approvedVideoPerformanceReference");
  });

  it("defines database-authoritative exact approved-Performance resolution", () => {
    expect(migration).toContain("resolve_approved_video_performance_artifact");
    for (const invariant of ["UPSTREAM_PERFORMANCE_NOT_FINAL", "UPSTREAM_PERFORMANCE_SUPERSEDED", "UPSTREAM_PERFORMANCE_NOT_APPROVED", "UPSTREAM_PERFORMANCE_QA_INVALID", "UPSTREAM_PERFORMANCE_PROVENANCE_INVALID", "UPSTREAM_PERFORMANCE_SNAPSHOT_MISMATCH", "UPSTREAM_PERFORMANCE_TIMESTAMP_INVALID", "canonical hash mismatch", "nested Release reference drift", "parent/root drift"]) expect(migration).toContain(invariant);
  });

  it("builds the compact eight-artifact lineage and artifact-local locators", () => {
    for (const type of ["CHANNEL_RESEARCH", "CHANNEL_STRATEGY", "CHANNEL_CONTENT_INTELLIGENCE", "CHANNEL_VIDEO_BRIEF", "CHANNEL_VIDEO_SCRIPT", "CHANNEL_VIDEO_PACKAGING", "CHANNEL_VIDEO_RELEASE", "CHANNEL_VIDEO_PERFORMANCE"]) expect(migration).toContain(`'workflowType','${type}'`);
    for (const entity of ["TITLE_CANDIDATE", "THUMBNAIL_CONCEPT", "CHAPTER", "SCRIPT_SECTION", "BRIEF_BEAT", "BRIEF_CLAIM", "EVIDENCE", "TOPIC", "PILLAR", "STRATEGY_KPI", "STRATEGY_PILLAR"]) expect(migration).toContain(`'${entity}'`);
    expect(migration).toContain("'kind','ARTIFACT_LOCAL'");
    expect(migration).toContain("'jsonPointer','/kpiFramework/'");
  });

  it("accepts only two caller identifiers and injects authoritative state", () => {
    expect(migration).toContain("jsonb_object_length(p_input)<>2");
    expect(migration).toContain("k not in ('videoPerformanceWorkflowId','videoPerformanceRunId')");
    expect(migration).toContain("jsonb_build_object('approvedVideoPerformanceReference',v_approved_performance->'reference')");
  });

  it("registers the exact no-revision graph and finalizer", () => {
    for (const key of ["validate-approved-performance", "derive-diagnosis-observations", "draft-video-diagnosis", "critique-video-diagnosis", "final-video-diagnosis-qa", "finalize-video-diagnosis", "review-video-diagnosis"]) expect(migration).toContain(`'key','${key}'`);
    expect(migration).not.toContain("bounded-video-diagnosis-revision");
    expect(migration).toContain("when 'CHANNEL_VIDEO_DIAGNOSIS' then 'finalize-video-diagnosis'");
  });

  it("uses existing idempotency, leases, human successor runs, and canonical hashes", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("LEASE_NOT_ACTIVE");
    expect(migration).toContain("'human-revision:'||v_old_run.id::text");
    expect(migration).toContain("when 'CHANNEL_VIDEO_DIAGNOSIS' then 'validate-approved-performance'");
    expect(migration).toContain("encode(digest(output_payload::text,'sha256'),'hex')");
  });

  it("sets Diagnosis accounting to no retrieval and exactly zero revisions", () => {
    expect(migration).toContain("v_run.workflow_type='CHANNEL_VIDEO_DIAGNOSIS' then 0 else 1");
    expect(migration).toContain("'CHANNEL_VIDEO_PERFORMANCE','CHANNEL_VIDEO_DIAGNOSIS'");
  });
});

describe("CHANNEL_VIDEO_DIAGNOSIS immutability migration", () => {
  it("protects approved output and finalized step payloads", () => {
    expect(immutability.match(/CHANNEL_VIDEO_DIAGNOSIS/g)?.length).toBeGreaterThanOrEqual(3);
    expect(immutability).toContain("APPROVED_ARTIFACT_IMMUTABLE: finalized paid-workflow content cannot be mutated");
    expect(immutability).toContain("APPROVED_ARTIFACT_IMMUTABLE: finalized paid-workflow step output cannot be mutated");
  });
});
