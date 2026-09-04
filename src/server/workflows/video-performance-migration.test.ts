import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8").toLowerCase();
const release = read("202608180001_video_release.sql");
const migration = read("202608190001_video_performance.sql");
const immutability = read("202608190002_video_performance_immutability.sql");

describe("CHANNEL_VIDEO_PERFORMANCE migration", () => {
  it("stays inside the isolated schema and touches no unrelated schema", () => {
    expect(migration).not.toMatch(/(?:create|alter|drop) table public\./);
    expect(migration).not.toMatch(/\bcreate schema\b/);
  });

  it("declares the correct search_path per function: extensions only where digest() is called", () => {
    // resolve_approved_video_release_artifact and decide_workflow_approval call
    // digest() and keep extensions on the path; start, complete, and ensure do not.
    const widened = migration.match(/set search_path\s*=\s*channelwright,\s*extensions,\s*pg_temp/g) ?? [];
    expect(widened.length).toBe(2);
    const narrow = migration.match(/set search_path\s*=\s*channelwright,\s*pg_temp/g) ?? [];
    expect(narrow.length).toBe(3);
    expect(migration).not.toMatch(/set search_path[^\n]*public/);
  });

  it("registers the workflow type across both type constraints", () => {
    expect(migration).toContain("'channel_concept_validation','channel_research','channel_strategy','channel_content_intelligence','channel_video_brief','channel_video_script','channel_video_packaging','channel_video_release','channel_video_performance'");
    expect(migration).toContain("'channel','video','channel_concept_validation','channel_research','channel_strategy','channel_content_intelligence','channel_video_brief','channel_video_script','channel_video_packaging','channel_video_release','channel_video_performance'");
  });

  it("pins the canonical seven-step graph so an authenticated caller cannot forge one", () => {
    for (const step of [
      "validate-approved-release", "draft-video-performance", "initial-video-performance-qa",
      "bounded-video-performance-revision", "final-video-performance-qa", "finalize-video-performance", "review-video-performance",
    ]) expect(migration).toContain(`'key','${step}'`);
    expect(migration).toContain("workflow_type_invalid: canonical workflow definition required");
  });

  it("resolves the approved release in the database with full integrity checks", () => {
    expect(migration).toContain("create or replace function channelwright.resolve_approved_video_release_artifact");
    expect(migration).toContain("not_found: exact channel_video_release run");
    // NOT_FOUND, never FORBIDDEN, so the id space stays non-enumerable.
    const resolver = migration.slice(
      migration.indexOf("create or replace function channelwright.resolve_approved_video_release_artifact"),
      migration.indexOf("create or replace function channelwright.start_workflow"),
    );
    expect(resolver).not.toMatch(/forbidden|not_allowed/);
  });

  it("persists the server-resolved release reference rather than trusting client input", () => {
    expect(migration).toContain("not (p_input ? 'videoreleaseworkflowid') or not (p_input ? 'videoreleaserunid') or not (p_input ? 'performancesnapshot')");
    expect(migration).toContain("jsonb_build_object('approvedvideoreleasereference', v_approved_release->'reference')");
  });

  it("derives Viewer Value provenance from the release with a canonical hash", () => {
    expect(migration).toContain("'originstage', 'release'");
    expect(migration).toContain("channelwright.canonical_jsonb_text(v_run.output_payload->'viewervalue'->'contract')");
  });

  it("projects the release's bound KPI/hypothesis set into scope identity-only", () => {
    expect(migration).toContain("jsonb_array_elements(v_run.output_payload->'kpihypothesisbindings')");
    expect(migration).toContain("'kpibindings', v_kpi_bindings");
  });

  it("guards concurrency with an explicit check and a transactional unique index", () => {
    expect(migration).toContain("create unique index workflow_runs_active_video_performance_uniq");
    expect(migration).toContain("video_performance_limit_reached");
    expect(migration).toContain("where workflow_type = 'channel_video_performance' and status in ('queued','running','waiting_for_approval','paused')");
  });

  it("keeps the earlier per-vertical concurrency guards intact", () => {
    for (const guard of [
      "workflow_runs_active_strategy_uniq", "workflow_runs_active_content_uniq", "workflow_runs_active_video_brief_uniq",
      "workflow_runs_active_video_script_uniq", "workflow_runs_active_video_packaging_uniq", "workflow_runs_active_video_release_uniq",
    ]) expect(migration).toContain(guard);
  });

  it("promotes finalize-video-performance as the run's durable output without disturbing the others", () => {
    expect(migration).toContain("when 'channel_video_performance' then 'finalize-video-performance'");
    expect(migration).toContain("when 'channel_video_release' then 'finalize-video-release'");
    expect(migration).toContain("when 'channel_video_packaging' then 'finalize-video-packaging'");
  });

  it("hashes the validated upstream release as the video performance provenance record", () => {
    expect(migration).toContain("when 'channel_video_performance' then 'validate-approved-release'");
  });

  it("admits the workflow type to accounting without widening any ceiling", () => {
    expect(migration).toContain("v_no_retrieval := v_run.workflow_type in ('channel_strategy','channel_video_brief','channel_video_script','channel_video_packaging','channel_video_release','channel_video_performance')");
  });

  it("keeps privileges owner-scoped and worker mutations service-role only", () => {
    expect(migration).toContain("revoke all on function channelwright.resolve_approved_video_release_artifact(uuid,uuid) from public,anon");
    expect(migration).toContain("grant execute on function channelwright.resolve_approved_video_release_artifact(uuid,uuid) to authenticated,service_role");
    expect(migration).toContain("revoke all on function channelwright.complete_workflow_step(uuid,uuid,jsonb) from public, anon, authenticated");
    expect(migration).not.toMatch(/grant[^;]*to anon/);
  });

  it("declares exactly one new index the migration gate can verify", () => {
    const indexes = migration.match(/create (?:unique )?index/g) ?? [];
    expect(indexes.length).toBe(1);
  });
});

describe("CHANNEL_VIDEO_PERFORMANCE immutability migration", () => {
  it("widens the finalized-artifact guard to the new workflow type without touching triggers", () => {
    expect(immutability).toContain("create or replace function channelwright.protect_final_research_artifact");
    expect(immutability).toContain("create or replace function channelwright.protect_final_research_step_output");
    expect(immutability).toContain("'channel_video_release','channel_video_performance'");
    expect(immutability).not.toMatch(/create trigger/);
    expect(immutability).not.toMatch(/set search_path[^\n]*public/);
  });

  it("keeps the immutability functions unreachable from client roles", () => {
    expect(immutability).toContain("revoke all on function channelwright.protect_final_research_artifact() from public, anon, authenticated");
    expect(immutability).toContain("revoke all on function channelwright.protect_final_research_step_output() from public, anon, authenticated");
  });
});

describe("forward-only migration discipline", () => {
  it("does not modify the video-release migration", () => {
    expect(release).toContain("create or replace function channelwright.resolve_approved_video_packaging_artifact");
    expect(release).not.toContain("channel_video_performance");
  });

  it("orders after the video-release chain and stays adjacent to its own immutability step", () => {
    const files = readdirSync(resolve(process.cwd(), "supabase/migrations")).sort().filter((name) => name.endsWith(".sql"));
    expect(files.indexOf("202608190001_video_performance.sql")).toBeGreaterThan(files.indexOf("202608180003_video_release_kpi_scope.sql"));
    expect(files.indexOf("202608190002_video_performance_immutability.sql")).toBe(files.indexOf("202608190001_video_performance.sql") + 1);
  });
});
