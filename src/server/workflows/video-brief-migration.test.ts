import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8").toLowerCase();
const content = read("202608140003_content_intelligence.sql");
const migration = read("202608150001_video_brief.sql");

describe("CHANNEL_VIDEO_BRIEF migration", () => {
  it("stays inside the isolated schema and touches no unrelated schema", () => {
    expect(migration).not.toMatch(/(?:create|alter|drop) table public\./);
    expect(migration).not.toMatch(/\bcreate schema\b/);
    // resolve_approved_content_artifact, start_workflow, complete_workflow_step,
    // decide_workflow_approval, ensure_research_run_budget (canonical_jsonb_text
    // is `immutable` rather than `security definer`, and is counted separately).
    const definers = migration.match(/security definer set search_path\s*=\s*channelwright,\s*pg_temp/g) ?? [];
    expect(definers.length).toBe(5);
    expect(migration).toContain("create or replace function channelwright.canonical_jsonb_text");
  });

  it("registers the workflow type across both type constraints", () => {
    expect(migration).toContain("'channel_concept_validation','channel_research','channel_strategy','channel_content_intelligence','channel_video_brief'");
    expect(migration).toContain("'channel','video','channel_concept_validation','channel_research','channel_strategy','channel_content_intelligence','channel_video_brief'");
  });

  it("pins the canonical eight-step graph so an authenticated caller cannot forge one", () => {
    for (const step of [
      "validate-approved-content", "design-viewer-promise", "build-video-brief", "initial-video-brief-qa",
      "bounded-video-brief-revision", "final-video-brief-qa", "finalize-video-brief", "review-video-brief",
    ]) expect(migration).toContain(`'key','${step}'`);
    expect(migration).toContain("workflow_type_invalid: canonical workflow definition required");
  });

  it("resolves the approved content artifact in the database with full integrity checks", () => {
    expect(migration).toContain("create or replace function channelwright.resolve_approved_content_artifact");
    for (const guard of [
      "upstream_content_not_final",
      "upstream_content_not_approved",
      "upstream_content_qa_invalid",
      "upstream_content_provenance_invalid",
      "upstream_content_integrity_mismatch",
      "upstream_content_lineage_invalid",
    ]) expect(migration).toContain(guard);
    // Owner verification, and terminal + approved-by-owner state.
    expect(migration).toContain("auth.uid() <> v_run.owner_id");
    expect(migration).toContain("decided_by = v_run.owner_id");
    // Artifact and provenance hashes are recomputed and compared, not trusted.
    expect(migration).toContain("v_run.artifact_hash <> v_artifact_hash");
    expect(migration).toContain("v_run.provenance_hash <> v_provenance_hash");
  });

  it("keeps cross-owner lookups non-enumerable", () => {
    // A foreign run must be indistinguishable from a missing one, so the
    // resolver body may never distinguish "exists but yours" from "absent".
    const resolver = migration.slice(
      migration.indexOf("create or replace function channelwright.resolve_approved_content_artifact"),
      migration.indexOf("create or replace function channelwright.canonical_jsonb_text"),
    );
    expect(resolver).toContain("not_found: exact channel_content_intelligence run");
    expect(resolver).not.toMatch(/forbidden|not_allowed/);
  });

  it("validates the selected topic against the approved artifact rather than the caller", () => {
    expect(migration).toContain("topic_not_in_approved_backlog");
    expect(migration).toContain("topic_not_in_approved_artifact");
    expect(migration).toContain("topic_viewer_value_not_eligible");
    expect(migration).toContain("topic_evidence_missing");
    // Absent topicId falls back to the artifact's own authoritative recommendation.
    expect(migration).toContain("nextvideorecommendation'->>'topicid'");
    expect(migration).toContain("next_video_recommendation");
    expect(migration).toContain("operator_selected");
  });

  it("iterates upstream arrays with a named column rather than a bare table alias", () => {
    // `jsonb_array_elements(x) entry` names the TABLE; the column stays `value`,
    // so `entry->>'topicId'` would resolve `entry` to the composite row type and
    // fail at runtime with "operator does not exist: record ->> unknown".
    expect(migration).toContain("jsonb_array_elements(v_run.output_payload->'backlog') as t(entry)");
    expect(migration).toContain("jsonb_array_elements(v_run.output_payload->'topics') as t(topic)");
    expect(migration).not.toMatch(/jsonb_array_elements\([^)]*\)\s+(entry|topic)/);
  });

  it("orders canonical keys collation-independently so provenance cannot spuriously fail", () => {
    // The application sorts by UTF-16 code unit. A bare `order by key` would use
    // the database collation, which orders case-insensitively at primary
    // strength and disagrees for sibling camelCase keys.
    // `read()` lowercases, so the assertion matches the lowercased source.
    expect(migration).toContain('order by key collate "c"');
    expect(migration).not.toMatch(/order by key\)/);
    // jsonb preserves numeric scale; JSON.stringify does not.
    expect(migration).toContain("when 'number' then trim_scale(p_value::numeric)::text");
  });

  it("derives Viewer Value provenance from authoritative state with a canonical hash", () => {
    expect(migration).toContain("inheritedviewervalueprovenance");
    expect(migration).toContain("'originstage', 'content_intelligence'");
    expect(migration).toContain("channelwright.canonical_jsonb_text(v_topic->'viewervalue'->'contract')");
    // Key-order independence is what makes downstream drift detectable.
    expect(migration).toContain("order by key");
  });

  it("carries strategy and research provenance transitively into the content reference", () => {
    expect(migration).toContain("'upstreamstrategy', v_upstream_strategy->'reference'");
    expect(migration).toContain("v_run.output_payload->'upstreamstrategy' is distinct from v_upstream_strategy->'reference'");
  });

  it("persists the server-resolved reference rather than trusting client input", () => {
    // Only identifiers plus one bounded selector are accepted from the browser.
    expect(migration).toContain("'contentintelligenceworkflowid','contentintelligencerunid','topicid'");
    expect(migration).toContain("jsonb_object_length(p_input) not between 2 and 3");
    expect(migration).toContain("jsonb_build_object('approvedcontentreference', v_approved_content->'reference')");
    expect(migration).toContain("jsonb_build_object('selectedtopicid', v_approved_content->'selection'->>'topicid')");
  });

  it("guards concurrency with an explicit check and a transactional unique index", () => {
    expect(migration).toContain("create unique index workflow_runs_active_video_brief_uniq");
    expect(migration).toContain("video_brief_limit_reached");
    // The topic is part of the key: two different topics may be briefed at once.
    expect(migration).toContain("input_payload->>'selectedtopicid'");
    // BLOCKED is excluded so a human-revision successor stays legal.
    expect(migration).toContain("where workflow_type = 'channel_video_brief' and status in ('queued','running','waiting_for_approval','paused')");
  });

  it("keeps the earlier research, strategy, and content guards intact", () => {
    expect(migration).toContain("research_limit_reached");
    expect(migration).toContain("strategy_limit_reached");
    expect(migration).toContain("content_limit_reached");
    expect(migration).toContain("workflow_runs_active_strategy_uniq");
    expect(migration).toContain("workflow_runs_active_content_uniq");
  });

  it("promotes finalize-video-brief as the run's durable output without disturbing the others", () => {
    expect(migration).toContain("when 'channel_video_brief' then 'finalize-video-brief'");
    expect(migration).toContain("when 'channel_strategy' then 'finalize-strategy'");
    expect(migration).toContain("when 'channel_content_intelligence' then 'finalize-content-intelligence'");
  });

  it("preserves the load-bearing parts of complete_workflow_step verbatim", () => {
    // A drift here would break every workflow, not just this one.
    expect(migration).toContain("not_allowed: workflow worker service role required");
    expect(migration).toContain("idempotentreplay', true");
    expect(migration).toContain("lease_not_active: workflow step lease is not active");
    expect(migration).toContain("cancellation_requested_at is null");
    // priorOutputs is fed by this write.
    expect(migration).toContain("context_payload = jsonb_set(context_payload, array[v_step.step_key], p_output, true)");
  });

  it("hashes the validated upstream artifact as the video brief provenance record", () => {
    expect(migration).toContain("when 'channel_video_brief' then 'validate-approved-content'");
    expect(migration).toContain("invalid_transition: finalized workflow provenance is missing");
  });

  it("preserves human revision lineage, upstream identity, and topic identity", () => {
    expect(migration).toContain("workflow_revision_queued");
    expect(migration).toContain("'previousrunid',v_old_run.id");
    expect(migration).toContain("'upstreamcontentrunid',v_old_run.input_payload->'approvedcontentreference'->>'contentrunid'");
    expect(migration).toContain("'selectedtopicid',v_old_run.input_payload->>'selectedtopicid'");
    // The successor inherits the pinned input payload; the original is not overwritten.
    expect(migration).toContain("v_old_run.input_payload||jsonb_build_object('humanrevisionnote',p_note)");
  });

  it("admits the fourth paid workflow to accounting without widening any ceiling", () => {
    expect(migration).toContain("'channel_research','channel_strategy','channel_content_intelligence','channel_video_brief'");
    // Ceilings identical to the content-intelligence migration.
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
    // The video brief performs no external retrieval, exactly like strategy.
    expect(migration).toContain("v_run.workflow_type in ('channel_strategy','channel_video_brief')");
  });

  it("keeps privileges owner-scoped and worker mutations service-role only", () => {
    expect(migration).toContain("revoke all on function channelwright.resolve_approved_content_artifact(uuid,uuid,text) from public,anon");
    expect(migration).toContain("grant execute on function channelwright.resolve_approved_content_artifact(uuid,uuid,text) to authenticated,service_role");
    expect(migration).toContain("revoke all on function channelwright.complete_workflow_step(uuid,uuid,jsonb) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function channelwright.complete_workflow_step(uuid,uuid,jsonb) to service_role");
    expect(migration).toContain("revoke all on function channelwright.ensure_research_run_budget(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated");
    expect(migration).not.toMatch(/grant[^;]*to anon/);
  });
});

describe("forward-only migration discipline", () => {
  it("does not modify any already-written migration", () => {
    // The content-intelligence migration must be byte-identical to what shipped:
    // this test fails if a prior migration is edited rather than superseded.
    expect(content).toContain("create or replace function channelwright.resolve_approved_strategy_artifact");
    expect(content).not.toContain("channel_video_brief");
  });

  it("declares exactly one new index the migration gate can verify", () => {
    const indexes = migration.match(/create (?:unique )?index/g) ?? [];
    expect(indexes.length).toBe(1);
  });

  it("orders after the content-intelligence migration", () => {
    const files = readdirSync(resolve(process.cwd(), "supabase/migrations")).sort();
    expect(files.indexOf("202608150001_video_brief.sql")).toBeGreaterThan(files.indexOf("202608140003_content_intelligence.sql"));
    expect(files[files.length - 1]).toBe("202608150001_video_brief.sql");
  });
});
