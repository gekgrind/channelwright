import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getWorkflowDefinition, WORKFLOW_FINALIZER_STEP } from "@/domain/production-workflows";

/**
 * Migration source is read with line endings NORMALIZED.
 *
 * On Windows checkouts these files land as CRLF, so any assertion that spans
 * more than one line is otherwise comparing against `\n`-joined text that never
 * exists on disk. Normalizing here keeps multi-line assertions honest on every
 * platform; single-line `toContain` checks are unaffected either way.
 */
const readSql = (name: string) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const migration = readSql("202609080001_video_intelligence.sql");
const immutability = readSql("202609080002_video_intelligence_immutability.sql");
const portfolioMigration = readSql("202609070001_video_portfolio.sql");

describe("CHANNEL_VIDEO_INTELLIGENCE migration", () => {
  it("extends workflow constraints and active uniqueness forward-only", () => {
    expect(migration).toContain("'CHANNEL_VIDEO_PORTFOLIO','CHANNEL_VIDEO_INTELLIGENCE'");
    expect(migration).toContain("create unique index workflow_runs_active_video_intelligence_uniq");
    expect(migration).toContain("input_payload->>'intelligenceHorizonKey'");
    // Forward-only: the slice never edits a previously applied migration.
    expect(migration).not.toMatch(/drop\s+(?:function|index|trigger)\s+(?!if exists)/i);
    // And it must not recreate an index an earlier migration already created.
    expect(migration).not.toContain("create unique index workflow_runs_active_video_portfolio_uniq");
  });

  it("keys concurrency on the horizon, which is what a second record would compete to define", () => {
    expect(migration).toMatch(/workflow_runs_active_video_intelligence_uniq[\s\S]*?owner_id,[\s\S]*?intelligenceHorizonKey/);
    expect(migration).toContain("where workflow_type = 'CHANNEL_VIDEO_INTELLIGENCE' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')");
    expect(migration).toContain("VIDEO_INTELLIGENCE_LIMIT_REACHED: an active channel learning record already exists for this horizon");
    expect(migration).toContain("VIDEO_INTELLIGENCE_LIMIT_REACHED: a concurrent channel learning record was already created for this horizon");
  });

  it("defines database-authoritative exact approved-Portfolio resolution with the intelligence-eligibility gate", () => {
    expect(migration).toContain("resolve_approved_video_portfolio_artifact");
    for (const invariant of [
      "UPSTREAM_PORTFOLIO_NOT_FINAL", "UPSTREAM_PORTFOLIO_SUPERSEDED", "UPSTREAM_PORTFOLIO_NOT_APPROVED",
      "UPSTREAM_PORTFOLIO_QA_INVALID", "UPSTREAM_PORTFOLIO_PROVENANCE_INVALID", "UPSTREAM_PORTFOLIO_LINEAGE_INVALID",
      "canonical hash mismatch", "nested Experiment reference drift", "portfolio scope drift", "parent/root drift",
      "UPSTREAM_PORTFOLIO_NOT_INTELLIGENCE_ELIGIBLE",
    ]) expect(migration).toContain(invariant);
    expect(migration).toContain("v_run.output_payload#>'{content,portfolioReady}' is distinct from 'true'::jsonb");
  });

  it("enforces the single channel anchor inside one allocation and across selections", () => {
    expect(migration).toContain("UPSTREAM_PORTFOLIO_STRATEGY_ANCHOR_MISMATCH");
    expect(migration).toContain("the allocation does not resolve to exactly one approved Strategy and Research anchor");
    expect(migration).toContain("every selected allocation must descend from the same approved CHANNEL_STRATEGY run");
    expect(migration).toContain("coalesce(v_strategy_count,0)<>1 or coalesce(v_research_count,0)<>1");
  });

  it("re-hashes and re-checks supersession on both channel anchors rather than trusting the frozen projection", () => {
    expect(migration).toContain("transitive artifact mismatch");
    expect(migration).toContain("transitive artifact superseded");
    expect(migration).toContain("w.current_run_id=v_chain_run.id");
    expect((migration.match(/context_payload->>'previousRunId'=/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("requires every portfolio candidate to still carry its full eleven-artifact chain", () => {
    expect(migration).toContain("jsonb_array_length(cand->'artifacts')<>11");
    expect(migration).toContain("every portfolio candidate must carry its full eleven-artifact chain");
  });

  it("carries forward the root-lineage workflow_id pin rather than reintroducing the weaker predicate", () => {
    expect(migration).toContain("budget parent disagrees with lineage parent");
    expect(migration).toContain("resolved root is not a real run of this workflow");
    expect(migration).toContain("id=v_root and owner_id=v_run.owner_id and workflow_type=v_run.workflow_type and workflow_id=v_run.workflow_id");
  });

  it("treats a cross-owner portfolio as NOT_FOUND rather than leaking its existence", () => {
    expect(migration).toContain("if v_role<>'service_role' and (auth.uid() is null or auth.uid()<>v_run.owner_id) then raise exception 'NOT_FOUND: exact CHANNEL_VIDEO_PORTFOLIO run'");
    expect(migration).not.toMatch(/raise exception 'FORBIDDEN/);
  });

  it("returns a bounded server-extracted cycle projection, never the allocation body", () => {
    for (const field of [
      "'cycleId','cycle:'||v_run.id::text",
      "'committedAtRiskCount',jsonb_array_length(coalesce(v_safeguards->'committedAtRiskCandidateIds','[]'::jsonb))",
      "'globalConfidenceCeiling',v_constraints->>'globalConfidenceCeiling'",
      "'strategyRunId',v_strategy_run",
    ]) expect(migration).toContain(field);
    // The prose surfaces a portfolio artifact carries must never be projected.
    for (const prose of ["'rationale'", "'allocationHypothesis'", "'sequencingNotes'", "'viewerValueGuardrails'", "'revisitCondition'"]) {
      expect(migration.slice(migration.indexOf("return jsonb_build_object('reference'"))).not.toContain(prose);
    }
  });

  it("projects commitments by joining committed items to their server-projected candidates", () => {
    expect(migration).toContain("where cand->>'candidateId'=item->>'candidateId' and item->>'disposition'='COMMITTED'");
    expect(migration).toContain("committed items do not resolve against the allocation candidate set");
  });

  it("registers the canonical graph in SQL identically to the TypeScript definition", () => {
    const definition = getWorkflowDefinition("CHANNEL_VIDEO_INTELLIGENCE", 1);
    expect(migration).toContain(definition.objective);
    for (const entry of definition.steps) {
      expect(migration).toContain(`'key','${entry.key}'`);
      expect(migration).toContain(`'capability','${entry.capability}'`);
    }
    expect(migration).toContain(`when 'CHANNEL_VIDEO_INTELLIGENCE' then '${WORKFLOW_FINALIZER_STEP.CHANNEL_VIDEO_INTELLIGENCE}'`);
    expect(migration).toContain("when 'CHANNEL_VIDEO_INTELLIGENCE' then 'validate-approved-portfolios'");
  });

  it("accepts only the two caller keys and stamps the server-owned fields itself", () => {
    expect(migration).toContain("jsonb_object_length(p_input)<>2");
    expect(migration).toContain("k not in ('horizonLabel','portfolioSelections')");
    expect(migration).toContain("jsonb_array_length(p_input->'portfolioSelections') not between 2 and 4");
    expect(migration).toContain("the same portfolio run cannot be selected twice");
    expect(migration).toContain("v_intelligence_horizon_key := lower(btrim(p_input->>'horizonLabel'))");
    expect(migration).toContain("jsonb_build_object('approvedVideoPortfolioReferences',v_portfolio_refs,'intelligenceHorizonKey',v_intelligence_horizon_key)");
  });

  it("keeps the tight zero-retrieval, zero-revision accounting class", () => {
    expect(migration).toContain("v_no_retrieval := v_run.workflow_type in ('CHANNEL_STRATEGY'");
    expect(migration).toMatch(/v_no_retrieval[^;]*'CHANNEL_VIDEO_INTELLIGENCE'\);/);
    expect(migration).toMatch(/v_tight_ceiling[^;]*'CHANNEL_VIDEO_INTELLIGENCE'\);/);
  });

  it("preserves the widened search_path for the digest-calling functions", () => {
    expect(migration).toContain("create or replace function channelwright.resolve_approved_video_portfolio_artifact(p_workflow_id uuid,p_run_id uuid)\nreturns jsonb language plpgsql security definer set search_path=channelwright,extensions,pg_temp");
    expect(migration).toContain("create or replace function channelwright.decide_workflow_approval(p_workflow_id uuid,p_approval_id uuid,p_decision text,p_note text default null)\nreturns jsonb language plpgsql security definer set search_path=channelwright,extensions,pg_temp");
    expect(migration).not.toMatch(/search_path\s*=\s*[^;\n]*\bpublic\b/);
  });

  it("grants the new resolver to authenticated and service_role only", () => {
    expect(migration).toContain("revoke all on function channelwright.resolve_approved_video_portfolio_artifact(uuid,uuid) from public,anon;");
    expect(migration).toContain("grant execute on function channelwright.resolve_approved_video_portfolio_artifact(uuid,uuid) to authenticated,service_role;");
    expect(migration).toContain("revoke all on function channelwright.complete_workflow_step(uuid,uuid,jsonb) from public, anon, authenticated;");
  });

  it("does not redefine the Experiment resolver Portfolio already owns", () => {
    expect(migration).not.toContain("create or replace function channelwright.resolve_approved_video_experiment_artifact");
    expect(portfolioMigration).toContain("create or replace function channelwright.resolve_approved_video_experiment_artifact");
  });

  it("extends approved-artifact immutability without touching triggers or earlier behaviour", () => {
    expect(immutability).toContain("'CHANNEL_VIDEO_PORTFOLIO','CHANNEL_VIDEO_INTELLIGENCE'");
    expect(immutability).toContain("create or replace function channelwright.protect_final_research_artifact()");
    expect(immutability).toContain("create or replace function channelwright.protect_final_research_step_output()");
    expect(immutability).toContain("APPROVED_ARTIFACT_IMMUTABLE");
    expect(immutability).not.toMatch(/create\s+trigger/i);
    expect(immutability).not.toMatch(/drop\s+(?:function|index|trigger)\s+(?!if exists)/i);
  });

  it("keeps every previously covered workflow type in the immutability allow-list", () => {
    for (const type of [
      "CHANNEL_RESEARCH", "CHANNEL_STRATEGY", "CHANNEL_CONTENT_INTELLIGENCE", "CHANNEL_VIDEO_BRIEF",
      "CHANNEL_VIDEO_SCRIPT", "CHANNEL_VIDEO_PACKAGING", "CHANNEL_VIDEO_RELEASE", "CHANNEL_VIDEO_PERFORMANCE",
      "CHANNEL_VIDEO_DIAGNOSIS", "CHANNEL_VIDEO_DECISION", "CHANNEL_VIDEO_EXPERIMENT", "CHANNEL_VIDEO_PORTFOLIO",
    ]) expect(immutability).toContain(`'${type}'`);
  });
});
