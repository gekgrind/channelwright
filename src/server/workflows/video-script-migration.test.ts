import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8").toLowerCase();
const brief = read("202608150001_video_brief.sql");
const migration = read("202608160001_video_script.sql");
const immutability = read("202608160002_video_immutability.sql");

describe("CHANNEL_VIDEO_SCRIPT migration", () => {
  it("stays inside the isolated schema and touches no unrelated schema", () => {
    expect(migration).not.toMatch(/(?:create|alter|drop) table public\./);
    expect(migration).not.toMatch(/\bcreate schema\b/);
  });

  it("declares the correct search_path per function: extensions only where digest() is called", () => {
    // resolve_approved_video_brief_artifact and decide_workflow_approval call
    // digest() and must keep extensions on the path; start, complete, and ensure
    // do not call digest() and keep the narrow path.
    const widened = migration.match(/set search_path\s*=\s*channelwright,\s*extensions,\s*pg_temp/g) ?? [];
    expect(widened.length).toBe(2);
    const narrow = migration.match(/set search_path\s*=\s*channelwright,\s*pg_temp/g) ?? [];
    expect(narrow.length).toBe(3);
    // public must never appear on any actual search_path clause (bounded to the
    // header line so prose in the file comment does not produce a false match).
    expect(migration).not.toMatch(/set search_path[^\n]*public/);
  });

  it("registers the workflow type across both type constraints", () => {
    expect(migration).toContain("'channel_concept_validation','channel_research','channel_strategy','channel_content_intelligence','channel_video_brief','channel_video_script'");
    expect(migration).toContain("'channel','video','channel_concept_validation','channel_research','channel_strategy','channel_content_intelligence','channel_video_brief','channel_video_script'");
  });

  it("pins the canonical seven-step graph so an authenticated caller cannot forge one", () => {
    for (const step of [
      "validate-approved-brief", "draft-video-script", "initial-video-script-qa",
      "bounded-video-script-revision", "final-video-script-qa", "finalize-video-script", "review-video-script",
    ]) expect(migration).toContain(`'key','${step}'`);
    expect(migration).toContain("workflow_type_invalid: canonical workflow definition required");
  });

  it("resolves the approved brief in the database with full integrity checks", () => {
    expect(migration).toContain("create or replace function channelwright.resolve_approved_video_brief_artifact");
    for (const guard of [
      "upstream_brief_not_final",
      "upstream_brief_not_approved",
      "upstream_brief_qa_invalid",
      "upstream_brief_provenance_invalid",
      "upstream_brief_integrity_mismatch",
      "upstream_brief_lineage_invalid",
      "upstream_brief_viewer_value_not_eligible",
    ]) expect(migration).toContain(guard);
    // Owner verification, and terminal + approved-by-owner state.
    expect(migration).toContain("auth.uid() <> v_run.owner_id");
    expect(migration).toContain("decided_by = v_run.owner_id");
    // Artifact and provenance hashes are recomputed and compared, not trusted.
    expect(migration).toContain("v_run.artifact_hash <> v_artifact_hash");
    expect(migration).toContain("v_run.provenance_hash <> v_provenance_hash");
  });

  it("keeps cross-owner lookups non-enumerable", () => {
    const resolver = migration.slice(
      migration.indexOf("create or replace function channelwright.resolve_approved_video_brief_artifact"),
      migration.indexOf("create or replace function channelwright.start_workflow"),
    );
    expect(resolver).toContain("not_found: exact channel_video_brief run");
    expect(resolver).not.toMatch(/forbidden|not_allowed/);
  });

  it("derives Viewer Value provenance from the brief with a canonical hash", () => {
    expect(migration).toContain("inheritedviewervalueprovenance");
    expect(migration).toContain("'originstage', 'video_brief'");
    expect(migration).toContain("channelwright.canonical_jsonb_text(v_run.output_payload->'viewervalue'->'contract')");
  });

  it("carries the whole upstream chain transitively into the brief reference", () => {
    expect(migration).toContain("'upstreamcontentintelligence', v_run.output_payload->'upstreamcontentintelligence'");
    expect(migration).toContain("v_run.output_payload->'upstreamcontentintelligence' is distinct from v_provenance->'reference'");
  });

  it("persists the server-resolved reference rather than trusting client input", () => {
    // Only the two identifiers are accepted from the browser.
    expect(migration).toContain("'videobriefworkflowid','videobriefrunid'");
    expect(migration).toContain("jsonb_object_length(p_input) <> 2");
    expect(migration).toContain("jsonb_build_object('approvedvideobriefreference', v_approved_brief->'reference')");
  });

  it("guards concurrency with an explicit check and a transactional unique index", () => {
    expect(migration).toContain("create unique index workflow_runs_active_video_script_uniq");
    expect(migration).toContain("video_script_limit_reached");
    expect(migration).toContain("input_payload->'approvedvideobriefreference'->>'briefrunid'");
    // BLOCKED is excluded so a human-revision successor stays legal.
    expect(migration).toContain("where workflow_type = 'channel_video_script' and status in ('queued','running','waiting_for_approval','paused')");
  });

  it("keeps the earlier research, strategy, content, and brief guards intact", () => {
    expect(migration).toContain("research_limit_reached");
    expect(migration).toContain("strategy_limit_reached");
    expect(migration).toContain("content_limit_reached");
    expect(migration).toContain("video_brief_limit_reached");
    expect(migration).toContain("workflow_runs_active_strategy_uniq");
    expect(migration).toContain("workflow_runs_active_content_uniq");
    expect(migration).toContain("workflow_runs_active_video_brief_uniq");
  });

  it("promotes finalize-video-script as the run's durable output without disturbing the others", () => {
    expect(migration).toContain("when 'channel_video_script' then 'finalize-video-script'");
    expect(migration).toContain("when 'channel_video_brief' then 'finalize-video-brief'");
    expect(migration).toContain("when 'channel_content_intelligence' then 'finalize-content-intelligence'");
    expect(migration).toContain("when 'channel_strategy' then 'finalize-strategy'");
  });

  it("preserves the load-bearing parts of complete_workflow_step verbatim", () => {
    expect(migration).toContain("not_allowed: workflow worker service role required");
    expect(migration).toContain("idempotentreplay', true");
    expect(migration).toContain("lease_not_active: workflow step lease is not active");
    expect(migration).toContain("cancellation_requested_at is null");
    expect(migration).toContain("context_payload = jsonb_set(context_payload, array[v_step.step_key], p_output, true)");
  });

  it("hashes the validated upstream brief as the video script provenance record", () => {
    expect(migration).toContain("when 'channel_video_script' then 'validate-approved-brief'");
    expect(migration).toContain("invalid_transition: finalized workflow provenance is missing");
  });

  it("preserves human revision lineage and upstream identity", () => {
    expect(migration).toContain("workflow_revision_queued");
    expect(migration).toContain("'previousrunid',v_old_run.id");
    expect(migration).toContain("'upstreambriefrunid',v_old_run.input_payload->'approvedvideobriefreference'->>'briefrunid'");
    expect(migration).toContain("v_old_run.input_payload||jsonb_build_object('humanrevisionnote',p_note)");
  });

  it("admits the fifth paid workflow type to accounting without widening any ceiling", () => {
    expect(migration).toContain("'channel_research','channel_strategy','channel_content_intelligence','channel_video_brief','channel_video_script'");
    for (const ceiling of [
      "'providerrequests') not between (case when v_no_retrieval then 0 else 1 end) and 36",
      "'providerquotaunits') not between (case when v_no_retrieval then 0 else 1 end) and 1200",
      "'searches') not between (case when v_no_retrieval then 0 else 1 end) and 12",
      "'synthesiscalls') not between 1 and 6",
      "'qacalls') not between 1 and 12",
      "'revisioncalls') not between 1 and 4",
      "'inputtokens') not between 1000 and 1000000",
      "'outputtokens') not between 1000 and 100000",
      "'totaltokens') not between 2000 and 1100000",
    ]) expect(migration).toContain(ceiling);
    expect(migration).toContain("'automatedrevisions')<>1");
    // The video script performs no external retrieval, exactly like strategy and brief.
    expect(migration).toContain("v_run.workflow_type in ('channel_strategy','channel_video_brief','channel_video_script')");
  });

  it("keeps privileges owner-scoped and worker mutations service-role only", () => {
    expect(migration).toContain("revoke all on function channelwright.resolve_approved_video_brief_artifact(uuid,uuid) from public,anon");
    expect(migration).toContain("grant execute on function channelwright.resolve_approved_video_brief_artifact(uuid,uuid) to authenticated,service_role");
    expect(migration).toContain("revoke all on function channelwright.complete_workflow_step(uuid,uuid,jsonb) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function channelwright.complete_workflow_step(uuid,uuid,jsonb) to service_role");
    expect(migration).toContain("revoke all on function channelwright.ensure_research_run_budget(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated");
    expect(migration).not.toMatch(/grant[^;]*to anon/);
  });
});

describe("forward-only migration discipline", () => {
  it("does not modify the video-brief migration", () => {
    // The video-brief migration must be untouched: it must not know about scripts.
    expect(brief).toContain("create or replace function channelwright.resolve_approved_content_artifact");
    expect(brief).not.toContain("channel_video_script");
  });

  it("declares exactly one new index the migration gate can verify", () => {
    const indexes = migration.match(/create (?:unique )?index/g) ?? [];
    expect(indexes.length).toBe(1);
  });

  it("uses a new resolver function rather than altering an applied one", () => {
    expect(migration).toContain("create or replace function channelwright.resolve_approved_video_brief_artifact");
    // It reuses the canonical_jsonb_text created by the video-brief migration.
    expect(migration).not.toContain("create or replace function channelwright.canonical_jsonb_text");
    expect(migration).toContain("channelwright.canonical_jsonb_text");
  });

  it("orders after the video-brief search-path repair", () => {
    const files = readdirSync(resolve(process.cwd(), "supabase/migrations")).sort();
    expect(files.indexOf("202608160001_video_script.sql")).toBeGreaterThan(files.indexOf("202608150002_extension_search_path.sql"));
    expect(files.indexOf("202608160002_video_immutability.sql")).toBeGreaterThan(files.indexOf("202608160001_video_script.sql"));
    expect(files[files.length - 1]).toBe("202608160002_video_immutability.sql");
  });
});

describe("CHANNEL_VIDEO immutability migration (defect #1)", () => {
  it("extends both protect functions to VIDEO_BRIEF and VIDEO_SCRIPT", () => {
    expect(immutability).toContain("create or replace function channelwright.protect_final_research_artifact");
    expect(immutability).toContain("create or replace function channelwright.protect_final_research_step_output");
    // Both functions must now allow-list all five paid workflow types.
    const allowLists = immutability.match(/'channel_research','channel_strategy','channel_content_intelligence','channel_video_brief','channel_video_script'/g) ?? [];
    expect(allowLists.length).toBe(2);
  });

  it("does not recreate the triggers (they bind by name) or touch unrelated schema", () => {
    expect(immutability).not.toMatch(/create trigger/);
    expect(immutability).not.toMatch(/(?:create|alter|drop) table public\./);
    expect(immutability).not.toMatch(/create or replace function channelwright\.start_workflow/);
  });

  it("keeps the protect functions privileged (no direct grants to app roles)", () => {
    expect(immutability).toContain("revoke all on function channelwright.protect_final_research_artifact() from public, anon, authenticated");
    expect(immutability).toContain("revoke all on function channelwright.protect_final_research_step_output() from public, anon, authenticated");
    expect(immutability).not.toMatch(/grant[^;]*to (?:anon|authenticated)/);
  });

  it("does not edit the previously applied content-intelligence definition", () => {
    // 202608140003 remains the applied source that only covered three types.
    const content = read("202608140003_content_intelligence.sql");
    expect(content).not.toContain("channel_video_script");
  });
});
