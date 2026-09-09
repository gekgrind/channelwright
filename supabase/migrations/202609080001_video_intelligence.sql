-- CHANNEL_VIDEO_INTELLIGENCE vertical slice. Additive and forward-only: it
-- extends the existing workflow, approval, lease, lineage, immutability, and
-- usage-accounting spine rather than introducing a parallel mechanism. No
-- previously applied migration is altered.
--
-- CHANNEL_VIDEO_INTELLIGENCE is the channel-level meta-learning boundary above
-- CHANNEL_VIDEO_PORTFOLIO. The contract was RECOVERED, not invented: two shipped
-- verticals already reserved this workflow by name and enumerated what it owns.
-- `video-experiment-validation.ts` and `video-portfolio-validation.ts` both raise
-- INTELLIGENCE_RESPONSIBILITY_LEAKED for "channel-wide strategy / meta-learning
-- work reserved for CHANNEL_VIDEO_INTELLIGENCE" -- channel strategy, strategic
-- pivots, channel-wide learning / pattern / insight / takeaway, meta-analysis of
-- all cycles, reasoning across the entire channel history, and redefining the
-- audience, niche, or pillars -- and `docs/video-portfolio.md` records that
-- Portfolio does not own "channel strategy (a future Intelligence vertical)".
--
-- It consumes TWO TO FOUR exact approved, intelligence-eligible allocation
-- records that all descend from ONE approved CHANNEL_STRATEGY run, and produces a
-- single human-approved, immutable CHANNEL LEARNING RECORD plus a STRATEGY REVIEW
-- SIGNAL. It performs ZERO external retrieval, ZERO allocation, and ZERO
-- publishing / provider action. It never authors strategy, never proposes topics
-- or a backlog, never invents a research conclusion, never redesigns an
-- experiment, and never revisits a decision or diagnosis.
--
-- Two structural properties are load-bearing here:
--
--   1. The BOUNDED SERVER-EXTRACTED PROJECTION. The resolver returns
--      closed-vocabulary scalars per cycle -- counts, capacity state, Viewer
--      Value state, and the committed experiments' classification -- never the
--      allocation artifact. The learning model therefore never receives an
--      allocation's mutable prose body (rationales, hypotheses, sequencing notes,
--      guardrails, alternatives) and is structurally incapable of restating or
--      relitigating an approved allocation.
--
--   2. The SINGLE STRATEGY ANCHOR. Every candidate inside every selected
--      allocation must resolve to the same CHANNEL_STRATEGY run, and every
--      selected allocation must agree on it. That shared anchor is what makes a
--      "channel-wide" learning meaningful and is what the strategy review signal
--      points at; cycles under different strategies are not one channel history.
--      Enforced here rather than in application code because it is an authority
--      boundary across independently started runs.
--
-- Payload discipline is deliberate and carries forward the lesson Portfolio paid
-- for at six-candidate fan-out: the reference carries FLAT strategy/research
-- anchors and a THREE-artifact chain per cycle instead of re-nesting Portfolio's
-- own eleven-artifact per-candidate chains, and the horizon is capped at four
-- cycles rather than six.
--
-- Nothing here widens the database resource ceilings introduced in 202608130004.
-- Like Diagnosis, Decision, Experiment and Portfolio, this workflow performs no
-- external evidence retrieval and makes zero automated revisions
-- (maxAutomatedRevisions = 0), so it shares their tighter 2/2/0/0
-- synthesis/QA/revision/automated-revision ceilings.
--
-- Functions that call digest() (the new resolver and the recreated
-- decide_workflow_approval) declare `search_path = channelwright, extensions,
-- pg_temp`, matching the state 202608150002 established for the sibling
-- resolvers. `public` stays excluded throughout.

alter table channelwright.workflows drop constraint if exists workflows_workflow_type_check;
alter table channelwright.workflows add constraint workflows_workflow_type_check
  check (workflow_type in ('CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE','CHANNEL_VIDEO_DIAGNOSIS','CHANNEL_VIDEO_DECISION','CHANNEL_VIDEO_EXPERIMENT','CHANNEL_VIDEO_PORTFOLIO','CHANNEL_VIDEO_INTELLIGENCE'));

alter table channelwright.workflow_runs drop constraint if exists workflow_runs_workflow_type_check;
alter table channelwright.workflow_runs add constraint workflow_runs_workflow_type_check
  check (workflow_type in ('CHANNEL','VIDEO','CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE','CHANNEL_VIDEO_DIAGNOSIS','CHANNEL_VIDEO_DECISION','CHANNEL_VIDEO_EXPERIMENT','CHANNEL_VIDEO_PORTFOLIO','CHANNEL_VIDEO_INTELLIGENCE'));

-- One active channel learning record per owner per horizon. The key is the
-- normalised horizon label persisted by start_workflow: two concurrent records
-- for one horizon would each become a competing durable statement of what the
-- channel learned, and each could raise a different strategy review signal
-- against the same anchored strategy. BLOCKED is excluded so a human-revision
-- successor (predecessor moved to BLOCKED before the successor is inserted)
-- remains legal.
create unique index workflow_runs_active_video_intelligence_uniq
  on channelwright.workflow_runs (
    owner_id,
    ((input_payload->>'intelligenceHorizonKey'))
  )
  where workflow_type = 'CHANNEL_VIDEO_INTELLIGENCE' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED');

-- ---------------------------------------------------------------------------
-- Exact approved-Portfolio resolution for CHANNEL_VIDEO_INTELLIGENCE. The RPC is
-- the sole authority for upstream identity, the intelligence-eligibility gate,
-- the single-strategy anchor, compact transitive lineage, and the bounded cycle
-- projection.
--
-- Nineteen invariants, all pre-spend and identical in shape to the Experiment
-- resolver Portfolio established: existence + owner (cross-owner -> NOT_FOUND,
-- never FORBIDDEN); COMPLETED with output; not superseded (workflow.current_run_id
-- plus no previousRunId successor); human APPROVED by owner; finalizer output
-- identical to run.output_payload; final QA passed with a legal
-- recommendation/score; the Portfolio's own upstream provenance step
-- (validate-approved-experiments) present and in agreement with the finalized
-- output on BOTH the reference set and the portfolio scope;
-- content.portfolioReady = true (an unready allocation can never reach
-- Intelligence -> UPSTREAM_PORTFOLIO_NOT_INTELLIGENCE_ELIGIBLE); recomputed
-- artifact + provenance hashes match stored; parent/root lineage well-formed with
-- the root pinned to THIS EXACT Portfolio workflow; every candidate in the
-- allocation resolving to exactly ONE CHANNEL_STRATEGY run and ONE
-- CHANNEL_RESEARCH run; and both anchors re-hashed AND re-checked for supersession
-- here rather than trusted.
--
-- The Portfolio resolver's own semantic checks -- including its eleven-artifact
-- per-candidate chain -- are not repeated: they are pinned by
-- portfolioProvenanceHash, which this re-hash re-derives.
--
-- The returned `cycle` object is the ONLY view of the allocation the learning
-- model ever receives. Every field is a scalar or closed-vocabulary value lifted
-- from the immutable artifact. No allocation prose is projected at all: not a
-- rationale, not the objective, not the allocation hypothesis, not the sequencing
-- notes, not a guardrail, not an alternative, not even the 200-char experiment
-- titles Portfolio's own candidate projection carried.
-- ---------------------------------------------------------------------------
create or replace function channelwright.resolve_approved_video_portfolio_artifact(p_workflow_id uuid,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=channelwright,extensions,pg_temp as $$
declare
  v_run channelwright.workflow_runs%rowtype; v_workflow channelwright.workflows%rowtype; v_approval channelwright.workflow_approvals%rowtype;
  v_finalizer jsonb; v_final_qa jsonb; v_provenance jsonb; v_parent uuid; v_root uuid; v_artifact_hash text; v_provenance_hash text;
  v_budget_found boolean; v_budget_parent uuid;
  v_scope jsonb; v_prov_refs jsonb; v_commitments jsonb;
  v_strategy_count integer; v_research_count integer;
  v_strategy_run uuid; v_strategy_hash text; v_strategy_version integer;
  v_research_run uuid; v_research_hash text; v_research_version integer;
  v_anchor jsonb; v_chain_run channelwright.workflow_runs%rowtype;
  v_out jsonb; v_src jsonb; v_alloc jsonb; v_safeguards jsonb; v_constraints jsonb;
  v_role text:=coalesce(auth.jwt()->>'role','');
begin
  select * into v_run from channelwright.workflow_runs where id=p_run_id and workflow_id=p_workflow_id and workflow_type='CHANNEL_VIDEO_PORTFOLIO';
  if not found then raise exception 'NOT_FOUND: exact CHANNEL_VIDEO_PORTFOLIO run'; end if;
  select * into v_workflow from channelwright.workflows where id=p_workflow_id and owner_id=v_run.owner_id and workflow_type='CHANNEL_VIDEO_PORTFOLIO';
  if not found then raise exception 'NOT_FOUND: exact CHANNEL_VIDEO_PORTFOLIO workflow'; end if;
  if v_role<>'service_role' and (auth.uid() is null or auth.uid()<>v_run.owner_id) then raise exception 'NOT_FOUND: exact CHANNEL_VIDEO_PORTFOLIO run'; end if;
  if v_run.status<>'COMPLETED' or v_run.output_payload is null then raise exception 'UPSTREAM_PORTFOLIO_NOT_FINAL: Portfolio must be completed and final'; end if;
  if v_workflow.current_run_id is distinct from v_run.id or exists(select 1 from channelwright.workflow_runs r where r.workflow_id=v_run.workflow_id and r.owner_id=v_run.owner_id and r.context_payload->>'previousRunId'=v_run.id::text)
    then raise exception 'UPSTREAM_PORTFOLIO_SUPERSEDED: Portfolio is not the latest immutable successor'; end if;
  select * into v_approval from channelwright.workflow_approvals where workflow_run_id=v_run.id and owner_id=v_run.owner_id and status='APPROVED' and decided_by=v_run.owner_id and decided_at is not null;
  if not found then raise exception 'UPSTREAM_PORTFOLIO_NOT_APPROVED: exact Portfolio run is not human approved'; end if;
  select output_payload into v_finalizer from channelwright.workflow_steps where workflow_run_id=v_run.id and step_key='finalize-video-portfolio' and status='COMPLETED';
  select output_payload into v_final_qa from channelwright.workflow_steps where workflow_run_id=v_run.id and step_key='final-video-portfolio-qa' and status='COMPLETED';
  select output_payload into v_provenance from channelwright.workflow_steps where workflow_run_id=v_run.id and step_key='validate-approved-experiments' and status='COMPLETED';
  if v_finalizer is null or v_finalizer is distinct from v_run.output_payload then raise exception 'UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH: finalizer output disagreement'; end if;
  if v_final_qa is null or coalesce((v_final_qa->'qa'->>'passed')::boolean,false) is not true or v_final_qa->'qa'->>'recommendation' not in ('accept','human_review_required') or coalesce((v_final_qa->'qa'->>'score')::integer,-1) not between 0 and 100
    then raise exception 'UPSTREAM_PORTFOLIO_QA_INVALID: final QA did not pass'; end if;
  if v_provenance is null or v_provenance->'artifacts' is null or v_provenance->'portfolioScope' is null then raise exception 'UPSTREAM_PORTFOLIO_PROVENANCE_INVALID: authoritative Experiment-set provenance is missing'; end if;
  select coalesce(jsonb_agg(entry->'reference' order by ordinality),'[]'::jsonb) into v_prov_refs
    from jsonb_array_elements(v_provenance->'artifacts') with ordinality as t(entry,ordinality);
  if v_run.output_payload->'approvedVideoExperimentReferences' is distinct from v_prov_refs then raise exception 'UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH: nested Experiment reference drift'; end if;
  if v_run.output_payload->'portfolioScope' is distinct from v_provenance->'portfolioScope' then raise exception 'UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH: portfolio scope drift'; end if;
  if v_run.output_payload#>'{content,portfolioReady}' is distinct from 'true'::jsonb then raise exception 'UPSTREAM_PORTFOLIO_NOT_INTELLIGENCE_ELIGIBLE: the approved Portfolio allocation is not ready and cannot inform channel learning'; end if;
  v_artifact_hash:=encode(digest(v_run.output_payload::text,'sha256'),'hex'); v_provenance_hash:=encode(digest(v_provenance::text,'sha256'),'hex');
  if v_run.artifact_hash is null or v_run.provenance_hash is null or v_run.artifact_hash<>v_artifact_hash or v_run.provenance_hash<>v_provenance_hash then raise exception 'UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH: canonical hash mismatch'; end if;
  begin v_parent:=nullif(v_run.context_payload->>'previousRunId','')::uuid; exception when invalid_text_representation then raise exception 'UPSTREAM_PORTFOLIO_LINEAGE_INVALID: malformed parent'; end;
  select true, parent_run_id, root_run_id into v_budget_found, v_budget_parent, v_root from channelwright.research_run_budgets where workflow_run_id=v_run.id and owner_id=v_run.owner_id;
  v_root:=coalesce(v_root,v_parent,v_run.id);
  if v_parent is not null and not exists(select 1 from channelwright.workflow_runs where id=v_parent and workflow_id=v_run.workflow_id and owner_id=v_run.owner_id and workflow_type=v_run.workflow_type) then raise exception 'UPSTREAM_PORTFOLIO_LINEAGE_INVALID: parent/root drift'; end if;
  -- Authoritative parent/root lineage, carrying forward the round-3 hardening
  -- Experiment established and Portfolio preserved: when the Portfolio run carries
  -- an accounting budget, its recorded parent must agree with context_payload's
  -- previousRunId, and the resolved root must itself be a real owner-scoped run of
  -- THIS EXACT Portfolio workflow -- not merely some same-owner
  -- CHANNEL_VIDEO_PORTFOLIO run in a different workflow.
  if coalesce(v_budget_found,false) and v_budget_parent is distinct from v_parent then raise exception 'UPSTREAM_PORTFOLIO_LINEAGE_INVALID: budget parent disagrees with lineage parent'; end if;
  if v_root is not null and not exists(select 1 from channelwright.workflow_runs where id=v_root and owner_id=v_run.owner_id and workflow_type=v_run.workflow_type and workflow_id=v_run.workflow_id) then raise exception 'UPSTREAM_PORTFOLIO_LINEAGE_INVALID: resolved root is not a real run of this workflow'; end if;

  v_scope:=v_run.output_payload->'portfolioScope';
  if v_scope is null or v_scope->'candidates' is null or jsonb_array_length(v_scope->'candidates') not between 1 and 6 then raise exception 'UPSTREAM_PORTFOLIO_LINEAGE_INVALID: portfolio scope must carry one to six candidate lineages'; end if;
  if exists(select 1 from jsonb_array_elements(v_scope->'candidates') as c(cand) where jsonb_array_length(cand->'artifacts')<>11)
    then raise exception 'UPSTREAM_PORTFOLIO_LINEAGE_INVALID: every portfolio candidate must carry its full eleven-artifact chain'; end if;

  -- The channel anchor. Every candidate in the allocation must resolve to one
  -- Strategy run and one Research run; a portfolio spanning two strategies is not
  -- one channel's history and can never contribute to a channel learning record.
  select count(distinct art->>'runId') into v_strategy_count
    from jsonb_array_elements(v_scope->'candidates') as c(cand), jsonb_array_elements(c.cand->'artifacts') as a(art)
    where art->>'workflowType'='CHANNEL_STRATEGY';
  select count(distinct art->>'runId') into v_research_count
    from jsonb_array_elements(v_scope->'candidates') as c(cand), jsonb_array_elements(c.cand->'artifacts') as a(art)
    where art->>'workflowType'='CHANNEL_RESEARCH';
  if coalesce(v_strategy_count,0)<>1 or coalesce(v_research_count,0)<>1 then raise exception 'UPSTREAM_PORTFOLIO_STRATEGY_ANCHOR_MISMATCH: the allocation does not resolve to exactly one approved Strategy and Research anchor'; end if;
  select (art->>'runId')::uuid, art->>'artifactHash', (art->>'schemaVersion')::integer into v_strategy_run, v_strategy_hash, v_strategy_version
    from jsonb_array_elements(v_scope->'candidates') as c(cand), jsonb_array_elements(c.cand->'artifacts') as a(art)
    where art->>'workflowType'='CHANNEL_STRATEGY' limit 1;
  select (art->>'runId')::uuid, art->>'artifactHash', (art->>'schemaVersion')::integer into v_research_run, v_research_hash, v_research_version
    from jsonb_array_elements(v_scope->'candidates') as c(cand), jsonb_array_elements(c.cand->'artifacts') as a(art)
    where art->>'workflowType'='CHANNEL_RESEARCH' limit 1;

  -- Both anchors are re-hashed and re-checked for supersession here rather than
  -- trusted from the frozen Portfolio projection: a strategy that has since been
  -- superseded must not be laundered into an approvable channel learning record
  -- just because its old hash still matches.
  for v_anchor in select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('workflowType','CHANNEL_RESEARCH','runId',v_research_run,'artifactHash',v_research_hash,'schemaVersion',v_research_version),
      jsonb_build_object('workflowType','CHANNEL_STRATEGY','runId',v_strategy_run,'artifactHash',v_strategy_hash,'schemaVersion',v_strategy_version))) loop
    select * into v_chain_run from channelwright.workflow_runs where id=(v_anchor->>'runId')::uuid and owner_id=v_run.owner_id and workflow_type=v_anchor->>'workflowType';
    if not found or v_chain_run.status<>'COMPLETED' or v_chain_run.output_payload is null or encode(digest(v_chain_run.output_payload::text,'sha256'),'hex')<>v_anchor->>'artifactHash' or (v_chain_run.output_payload->>'schemaVersion')::integer<>(v_anchor->>'schemaVersion')::integer then raise exception 'UPSTREAM_PORTFOLIO_LINEAGE_INVALID: transitive artifact mismatch'; end if;
    if not exists(select 1 from channelwright.workflows w where w.id=v_chain_run.workflow_id and w.owner_id=v_run.owner_id and w.current_run_id=v_chain_run.id)
      or exists(select 1 from channelwright.workflow_runs r where r.workflow_id=v_chain_run.workflow_id and r.owner_id=v_run.owner_id and r.context_payload->>'previousRunId'=v_chain_run.id::text)
      then raise exception 'UPSTREAM_PORTFOLIO_LINEAGE_INVALID: transitive artifact superseded'; end if;
  end loop;

  v_out:=v_run.output_payload; v_src:=v_out->'source'; v_alloc:=v_out#>'{content,allocation}';
  v_safeguards:=v_out#>'{content,viewerValueSafeguards}'; v_constraints:=v_out->'portfolioConstraints';
  if v_src is null or v_alloc is null or v_safeguards is null or v_constraints is null then raise exception 'UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH: portfolio artifact is missing its canonical projection surfaces'; end if;

  -- The bounded commitment projection: closed-vocabulary classification of each
  -- COMMITTED allocation item, joined to its server-projected candidate. Item
  -- rationale, revisit condition and citations are deliberately not projected.
  select coalesce(jsonb_agg(jsonb_build_object(
      'candidateId', item->>'candidateId',
      'experimentType', cand->>'experimentType',
      'category', cand->>'category',
      'treatmentMechanism', cand->>'treatmentMechanism',
      'primaryMetric', cand->>'primaryMetric',
      'primaryMetricDirection', cand->>'primaryMetricDirection',
      'selectionBasis', item->>'selectionBasis',
      'viewerValueDisposition', item->>'viewerValueDisposition',
      'viewerValueState', cand->>'viewerValueState',
      'promiseIntegrityRisk', cand->>'promiseIntegrityRisk',
      'decisionType', cand->>'decisionType',
      'pillarId', cand#>>'{lineage,pillarId}')
      order by (item->>'rank')::integer),'[]'::jsonb) into v_commitments
    from jsonb_array_elements(v_alloc->'items') as i(item), jsonb_array_elements(v_constraints->'candidates') as c(cand)
    where cand->>'candidateId'=item->>'candidateId' and item->>'disposition'='COMMITTED';
  if jsonb_array_length(v_commitments) is distinct from coalesce((v_alloc->>'committedCount')::integer,-1)
    then raise exception 'UPSTREAM_PORTFOLIO_INTEGRITY_MISMATCH: committed items do not resolve against the allocation candidate set'; end if;

  return jsonb_build_object('reference',jsonb_build_object(
    'portfolioWorkflowId',v_workflow.id,'portfolioRunId',v_run.id,'workflowDefinitionVersion',v_run.definition_version,'outputSchemaVersion',(v_out->>'schemaVersion')::integer,
    'approvalId',v_approval.id,'approvedBy',v_approval.decided_by,'approvedAt',to_char(v_approval.decided_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'finalQaState',v_final_qa->'qa'->>'recommendation','finalQaScore',(v_final_qa->'qa'->>'score')::integer,'portfolioArtifactHash',v_artifact_hash,'portfolioProvenanceHash',v_provenance_hash,
    'parentRunId',v_parent,'rootRunId',v_root,
    'portfolioReady',true,
    -- FLAT channel anchors, not a nested reference chain. Intelligence carries up
    -- to four cycles and each portfolio nests up to six eleven-artifact candidate
    -- chains; re-nesting those would exceed the 64 KiB step-output ceiling many
    -- times over. Nothing is lost: both anchor hashes are here and re-verified
    -- above, and every deeper chain hash is pinned by portfolioProvenanceHash.
    'strategyAnchor',jsonb_build_object('strategyRunId',v_strategy_run,'strategyArtifactHash',v_strategy_hash),
    'researchAnchor',jsonb_build_object('researchRunId',v_research_run,'researchArtifactHash',v_research_hash)),
    'cycle',jsonb_build_object(
      'cycleId','cycle:'||v_run.id::text,
      'portfolioWorkflowId',v_workflow.id,
      'portfolioRunId',v_run.id,
      'cycleLabel',v_src->>'cycleLabel',
      'allocatedAt',v_out->>'allocatedAt',
      'concurrentExperimentSlots',(v_constraints->>'concurrentExperimentSlots')::integer,
      'candidateCount',(v_src->>'candidateCount')::integer,
      'committedCount',(v_alloc->>'committedCount')::integer,
      'deferredCount',(v_alloc->>'deferredCount')::integer,
      'excludedCount',(v_alloc->>'excludedCount')::integer,
      'capacityUtilization',v_alloc->>'capacityUtilization',
      'globalConfidenceCeiling',v_constraints->>'globalConfidenceCeiling',
      'requiresHumanJudgment',v_alloc->'requiresHumanJudgment',
      'anyCandidateAtRisk',v_safeguards->'anyCandidateAtRisk',
      'committedAtRiskCount',jsonb_array_length(coalesce(v_safeguards->'committedAtRiskCandidateIds','[]'::jsonb)),
      'commitments',v_commitments,
      'strategyRunId',v_strategy_run),
    'artifacts',jsonb_build_array(
      jsonb_build_object('workflowType','CHANNEL_RESEARCH','runId',v_research_run,'artifactHash',v_research_hash,'schemaVersion',v_research_version),
      jsonb_build_object('workflowType','CHANNEL_STRATEGY','runId',v_strategy_run,'artifactHash',v_strategy_hash,'schemaVersion',v_strategy_version),
      jsonb_build_object('workflowType','CHANNEL_VIDEO_PORTFOLIO','runId',v_run.id,'artifactHash',v_artifact_hash,'schemaVersion',(v_out->>'schemaVersion')::integer)));
end $$;

-- ---------------------------------------------------------------------------
-- Canonical graph registration, input validation, and concurrency guards.
--
-- Reproduced from 202609070001 with the added CHANNEL_VIDEO_INTELLIGENCE branch:
-- the earlier branches, the idempotency and advisory-lock behaviour, and the
-- step-insertion loop are load-bearing for every workflow and must not drift.
--
-- The Portfolio branch is the first to resolve a SET of upstream artifacts. Each
-- selection is resolved through the same single-artifact resolver, pre-spend, in
-- request order; a duplicate selection is rejected before any run is created.
-- ---------------------------------------------------------------------------
create or replace function channelwright.start_workflow(
  p_idempotency_key text,
  p_input_hash text,
  p_workflow_type text,
  p_definition_version integer,
  p_objective text,
  p_input jsonb,
  p_steps jsonb
) returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_existing channelwright.workflow_runs%rowtype;
  v_workflow_id uuid;
  v_run_id uuid;
  v_step jsonb;
  v_status text;
  v_expected_steps jsonb;
  v_expected_objective text;
  v_persisted_input jsonb := p_input;
  v_approved_research jsonb;
  v_approved_strategy jsonb;
  v_approved_content jsonb;
  v_approved_brief jsonb;
  v_approved_script jsonb;
  v_approved_packaging jsonb;
  v_approved_release jsonb;
  v_approved_performance jsonb;
  v_approved_diagnosis jsonb;
  v_approved_decision jsonb;
  v_approved_experiment jsonb;
  v_selection jsonb;
  v_experiment_refs jsonb;
  v_portfolio_cycle_key text;
  v_approved_portfolio jsonb;
  v_portfolio_refs jsonb;
  v_intelligence_horizon_key text;
  v_strategy_anchor text;
  v_upstream_run text;
  v_upstream_topic text;
  v_constraint text;
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  if char_length(p_idempotency_key) not between 1 and 300 or p_input_hash !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION_ERROR: invalid idempotency input'; end if;
  if not (p_definition_version = 1 and p_workflow_type in ('CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE','CHANNEL_VIDEO_DIAGNOSIS','CHANNEL_VIDEO_DECISION','CHANNEL_VIDEO_EXPERIMENT','CHANNEL_VIDEO_PORTFOLIO','CHANNEL_VIDEO_INTELLIGENCE')) then raise exception 'WORKFLOW_TYPE_INVALID: unsupported workflow definition'; end if;
  if jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 32768 then raise exception 'PAYLOAD_TOO_LARGE: workflow input must be a bounded object'; end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) not between 1 and 50 then raise exception 'VALIDATION_ERROR: invalid workflow steps'; end if;
  if exists (select 1 from jsonb_array_elements(p_steps) item group by item->>'key' having count(*) > 1) then raise exception 'VALIDATION_ERROR: duplicate workflow step key'; end if;

  if p_workflow_type = 'CHANNEL_RESEARCH' then
    v_expected_objective := 'Evaluate an operator-supplied channel concept using current YouTube evidence, typed strategy, independent QA, and human review';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','retrieve-youtube-evidence','position',0,'kind','WORKER','capability','youtube-research','dependsOn','[]'::jsonb,'maxAttempts',3,'retryBaseSeconds',10),
      jsonb_build_object('key','draft-research','position',1,'kind','WORKER','capability','research-synthesis','dependsOn',jsonb_build_array('retrieve-youtube-evidence'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','initial-qa','position',2,'kind','WORKER','capability','independent-research-qa','dependsOn',jsonb_build_array('draft-research'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','bounded-revision','position',3,'kind','WORKER','capability','research-revision','dependsOn',jsonb_build_array('initial-qa'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-qa','position',4,'kind','WORKER','capability','independent-research-qa','dependsOn',jsonb_build_array('bounded-revision'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','synthesize-validation','position',5,'kind','WORKER','capability','research-finalizer','dependsOn',jsonb_build_array('final-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-research','position',6,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('synthesize-validation'),'maxAttempts',1,'retryBaseSeconds',0)
    );
    if not ((p_input ? 'channelConcept') or (p_input ? 'niche'))
      or (p_input ? 'channelConcept' and (jsonb_typeof(p_input->'channelConcept') <> 'string' or char_length(p_input->>'channelConcept') not between 10 and 2000))
      or (p_input ? 'niche' and (jsonb_typeof(p_input->'niche') <> 'string' or char_length(p_input->>'niche') not between 2 and 500))
    then raise exception 'VALIDATION_ERROR: invalid CHANNEL_RESEARCH input'; end if;
  elsif p_workflow_type = 'CHANNEL_STRATEGY' then
    v_expected_objective := 'Transform one exact approved CHANNEL_RESEARCH artifact into an evidence-traceable, independently QA''d, human-approved channel strategy';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-research','position',0,'kind','WORKER','capability','approved-research-validation','dependsOn','[]'::jsonb,'maxAttempts',2,'retryBaseSeconds',5),
      jsonb_build_object('key','draft-strategy','position',1,'kind','WORKER','capability','strategy-synthesis','dependsOn',jsonb_build_array('validate-approved-research'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','initial-strategy-qa','position',2,'kind','WORKER','capability','independent-strategy-qa','dependsOn',jsonb_build_array('draft-strategy'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','bounded-strategy-revision','position',3,'kind','WORKER','capability','strategy-revision','dependsOn',jsonb_build_array('initial-strategy-qa'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-strategy-qa','position',4,'kind','WORKER','capability','independent-strategy-qa','dependsOn',jsonb_build_array('bounded-strategy-revision'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','finalize-strategy','position',5,'kind','WORKER','capability','strategy-finalizer','dependsOn',jsonb_build_array('final-strategy-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-strategy','position',6,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-strategy'),'maxAttempts',1,'retryBaseSeconds',0)
    );
    if jsonb_object_length(p_input) <> 2 or not (p_input ? 'researchWorkflowId') or not (p_input ? 'researchRunId')
      or jsonb_typeof(p_input->'researchWorkflowId') <> 'string' or jsonb_typeof(p_input->'researchRunId') <> 'string'
    then raise exception 'VALIDATION_ERROR: exact research workflow and run IDs are required'; end if;
    begin
      v_approved_research := channelwright.resolve_approved_research_artifact((p_input->>'researchWorkflowId')::uuid,(p_input->>'researchRunId')::uuid);
    exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved research reference'; end;
    v_persisted_input := p_input || jsonb_build_object('approvedResearchReference',v_approved_research->'reference');
    v_upstream_run := v_approved_research->'reference'->>'researchRunId';
  elsif p_workflow_type = 'CHANNEL_CONTENT_INTELLIGENCE' then
    v_expected_objective := 'Turn one exact approved CHANNEL_STRATEGY artifact into an evidence-backed, viewer-value-gated, independently QA''d content backlog and next-video recommendation';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-strategy','position',0,'kind','WORKER','capability','approved-strategy-validation','dependsOn','[]'::jsonb,'maxAttempts',2,'retryBaseSeconds',5),
      jsonb_build_object('key','expand-content-pillars','position',1,'kind','WORKER','capability','content-pillar-expansion','dependsOn',jsonb_build_array('validate-approved-strategy'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','discover-youtube-topics','position',2,'kind','WORKER','capability','youtube-topic-discovery','dependsOn',jsonb_build_array('expand-content-pillars'),'maxAttempts',3,'retryBaseSeconds',10),
      jsonb_build_object('key','assess-topic-opportunities','position',3,'kind','WORKER','capability','topic-opportunity-assessment','dependsOn',jsonb_build_array('discover-youtube-topics'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','synthesize-backlog','position',4,'kind','WORKER','capability','content-backlog-synthesis','dependsOn',jsonb_build_array('assess-topic-opportunities'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','initial-content-qa','position',5,'kind','WORKER','capability','independent-content-qa','dependsOn',jsonb_build_array('synthesize-backlog'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','bounded-content-revision','position',6,'kind','WORKER','capability','content-revision','dependsOn',jsonb_build_array('initial-content-qa'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-content-qa','position',7,'kind','WORKER','capability','independent-content-qa','dependsOn',jsonb_build_array('bounded-content-revision'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','finalize-content-intelligence','position',8,'kind','WORKER','capability','content-finalizer','dependsOn',jsonb_build_array('final-content-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-content-intelligence','position',9,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-content-intelligence'),'maxAttempts',1,'retryBaseSeconds',0)
    );
    if jsonb_object_length(p_input) not between 2 and 4
      or not (p_input ? 'strategyWorkflowId') or not (p_input ? 'strategyRunId')
      or jsonb_typeof(p_input->'strategyWorkflowId') <> 'string' or jsonb_typeof(p_input->'strategyRunId') <> 'string'
      or (p_input ? 'targetBacklogSize' and (jsonb_typeof(p_input->'targetBacklogSize') <> 'number' or (p_input->>'targetBacklogSize')::numeric not between 5 and 8 or (p_input->>'targetBacklogSize') !~ '^\d+$'))
      or (p_input ? 'pillarFilter' and (jsonb_typeof(p_input->'pillarFilter') <> 'array' or jsonb_array_length(p_input->'pillarFilter') not between 1 and 8))
      or (select count(*) from jsonb_object_keys(p_input) k where k not in ('strategyWorkflowId','strategyRunId','targetBacklogSize','pillarFilter')) > 0
    then raise exception 'VALIDATION_ERROR: exact strategy workflow and run IDs are required'; end if;
    begin
      v_approved_strategy := channelwright.resolve_approved_strategy_artifact((p_input->>'strategyWorkflowId')::uuid,(p_input->>'strategyRunId')::uuid);
    exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved strategy reference'; end;
    v_persisted_input := p_input || jsonb_build_object('approvedStrategyReference',v_approved_strategy->'reference');
    v_upstream_run := v_approved_strategy->'reference'->>'strategyRunId';
  elsif p_workflow_type = 'CHANNEL_VIDEO_BRIEF' then
    v_expected_objective := 'Turn one exact approved CHANNEL_CONTENT_INTELLIGENCE topic into a viewer-value-gated, evidence-aware, independently critiqued production brief for a single video';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-content','position',0,'kind','WORKER','capability','approved-content-validation','dependsOn','[]'::jsonb,'maxAttempts',2,'retryBaseSeconds',5),
      jsonb_build_object('key','design-viewer-promise','position',1,'kind','WORKER','capability','viewer-promise-design','dependsOn',jsonb_build_array('validate-approved-content'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','build-video-brief','position',2,'kind','WORKER','capability','video-brief-synthesis','dependsOn',jsonb_build_array('design-viewer-promise'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','initial-video-brief-qa','position',3,'kind','WORKER','capability','independent-video-brief-qa','dependsOn',jsonb_build_array('build-video-brief'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','bounded-video-brief-revision','position',4,'kind','WORKER','capability','video-brief-revision','dependsOn',jsonb_build_array('initial-video-brief-qa'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-video-brief-qa','position',5,'kind','WORKER','capability','independent-video-brief-qa','dependsOn',jsonb_build_array('bounded-video-brief-revision'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','finalize-video-brief','position',6,'kind','WORKER','capability','video-brief-finalizer','dependsOn',jsonb_build_array('final-video-brief-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-video-brief','position',7,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-video-brief'),'maxAttempts',1,'retryBaseSeconds',0)
    );
    if jsonb_object_length(p_input) not between 2 and 3
      or not (p_input ? 'contentIntelligenceWorkflowId') or not (p_input ? 'contentIntelligenceRunId')
      or jsonb_typeof(p_input->'contentIntelligenceWorkflowId') <> 'string' or jsonb_typeof(p_input->'contentIntelligenceRunId') <> 'string'
      or (p_input ? 'topicId' and (jsonb_typeof(p_input->'topicId') <> 'string' or (p_input->>'topicId') !~ '^topic:[a-z0-9][a-z0-9-]{0,58}$'))
      or (select count(*) from jsonb_object_keys(p_input) k where k not in ('contentIntelligenceWorkflowId','contentIntelligenceRunId','topicId')) > 0
    then raise exception 'VALIDATION_ERROR: exact content-intelligence workflow and run IDs are required'; end if;
    begin
      v_approved_content := channelwright.resolve_approved_content_artifact(
        (p_input->>'contentIntelligenceWorkflowId')::uuid,
        (p_input->>'contentIntelligenceRunId')::uuid,
        p_input->>'topicId');
    exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved content reference'; end;
    v_persisted_input := p_input
      || jsonb_build_object('approvedContentReference', v_approved_content->'reference')
      || jsonb_build_object('selectedTopicId', v_approved_content->'selection'->>'topicId');
    v_upstream_run := v_approved_content->'reference'->>'contentRunId';
    v_upstream_topic := v_approved_content->'selection'->>'topicId';
  elsif p_workflow_type = 'CHANNEL_VIDEO_SCRIPT' then
    v_expected_objective := 'Turn one exact approved CHANNEL_VIDEO_BRIEF into a viewer-value-gated, evidence-disciplined, independently critiqued, structured and timed script for a single video';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-brief','position',0,'kind','WORKER','capability','approved-brief-validation','dependsOn','[]'::jsonb,'maxAttempts',2,'retryBaseSeconds',5),
      jsonb_build_object('key','draft-video-script','position',1,'kind','WORKER','capability','video-script-synthesis','dependsOn',jsonb_build_array('validate-approved-brief'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','initial-video-script-qa','position',2,'kind','WORKER','capability','independent-video-script-qa','dependsOn',jsonb_build_array('draft-video-script'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','bounded-video-script-revision','position',3,'kind','WORKER','capability','video-script-revision','dependsOn',jsonb_build_array('initial-video-script-qa'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-video-script-qa','position',4,'kind','WORKER','capability','independent-video-script-qa','dependsOn',jsonb_build_array('bounded-video-script-revision'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','finalize-video-script','position',5,'kind','WORKER','capability','video-script-finalizer','dependsOn',jsonb_build_array('final-video-script-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-video-script','position',6,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-video-script'),'maxAttempts',1,'retryBaseSeconds',0)
    );
    if jsonb_object_length(p_input) <> 2
      or not (p_input ? 'videoBriefWorkflowId') or not (p_input ? 'videoBriefRunId')
      or jsonb_typeof(p_input->'videoBriefWorkflowId') <> 'string' or jsonb_typeof(p_input->'videoBriefRunId') <> 'string'
      or (select count(*) from jsonb_object_keys(p_input) k where k not in ('videoBriefWorkflowId','videoBriefRunId')) > 0
    then raise exception 'VALIDATION_ERROR: exact video-brief workflow and run IDs are required'; end if;
    begin
      v_approved_brief := channelwright.resolve_approved_video_brief_artifact(
        (p_input->>'videoBriefWorkflowId')::uuid,
        (p_input->>'videoBriefRunId')::uuid);
    exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved brief reference'; end;
    v_persisted_input := p_input
      || jsonb_build_object('approvedVideoBriefReference', v_approved_brief->'reference');
    v_upstream_run := v_approved_brief->'reference'->>'briefRunId';
  elsif p_workflow_type = 'CHANNEL_VIDEO_PACKAGING' then
    v_expected_objective := 'Turn one exact approved CHANNEL_VIDEO_SCRIPT into viewer-value-gated, evidence-disciplined, independently critiqued, provider-neutral packaging direction for a single video';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-script','position',0,'kind','WORKER','capability','approved-script-validation','dependsOn','[]'::jsonb,'maxAttempts',2,'retryBaseSeconds',5),
      jsonb_build_object('key','draft-video-packaging','position',1,'kind','WORKER','capability','video-packaging-synthesis','dependsOn',jsonb_build_array('validate-approved-script'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','initial-video-packaging-qa','position',2,'kind','WORKER','capability','independent-video-packaging-qa','dependsOn',jsonb_build_array('draft-video-packaging'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','bounded-video-packaging-revision','position',3,'kind','WORKER','capability','video-packaging-revision','dependsOn',jsonb_build_array('initial-video-packaging-qa'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-video-packaging-qa','position',4,'kind','WORKER','capability','independent-video-packaging-qa','dependsOn',jsonb_build_array('bounded-video-packaging-revision'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','finalize-video-packaging','position',5,'kind','WORKER','capability','video-packaging-finalizer','dependsOn',jsonb_build_array('final-video-packaging-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-video-packaging','position',6,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-video-packaging'),'maxAttempts',1,'retryBaseSeconds',0)
    );
    if jsonb_object_length(p_input) <> 2
      or not (p_input ? 'videoScriptWorkflowId') or not (p_input ? 'videoScriptRunId')
      or jsonb_typeof(p_input->'videoScriptWorkflowId') <> 'string' or jsonb_typeof(p_input->'videoScriptRunId') <> 'string'
      or (select count(*) from jsonb_object_keys(p_input) k where k not in ('videoScriptWorkflowId','videoScriptRunId')) > 0
    then raise exception 'VALIDATION_ERROR: exact video-script workflow and run IDs are required'; end if;
    begin
      v_approved_script := channelwright.resolve_approved_video_script_artifact(
        (p_input->>'videoScriptWorkflowId')::uuid,
        (p_input->>'videoScriptRunId')::uuid);
    exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved script reference'; end;
    v_persisted_input := p_input
      || jsonb_build_object('approvedVideoScriptReference', v_approved_script->'reference');
    v_upstream_run := v_approved_script->'reference'->>'scriptRunId';
  elsif p_workflow_type = 'CHANNEL_VIDEO_RELEASE' then
    v_expected_objective := 'Turn one exact approved CHANNEL_VIDEO_PACKAGING into a viewer-value-gated, evidence-disciplined, independently critiqued, human-approved immutable release decision for a single video';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-packaging','position',0,'kind','WORKER','capability','approved-packaging-validation','dependsOn','[]'::jsonb,'maxAttempts',2,'retryBaseSeconds',5),
      jsonb_build_object('key','draft-video-release','position',1,'kind','WORKER','capability','video-release-synthesis','dependsOn',jsonb_build_array('validate-approved-packaging'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','initial-video-release-qa','position',2,'kind','WORKER','capability','independent-video-release-qa','dependsOn',jsonb_build_array('draft-video-release'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','bounded-video-release-revision','position',3,'kind','WORKER','capability','video-release-revision','dependsOn',jsonb_build_array('initial-video-release-qa'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-video-release-qa','position',4,'kind','WORKER','capability','independent-video-release-qa','dependsOn',jsonb_build_array('bounded-video-release-revision'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','finalize-video-release','position',5,'kind','WORKER','capability','video-release-finalizer','dependsOn',jsonb_build_array('final-video-release-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-video-release','position',6,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-video-release'),'maxAttempts',1,'retryBaseSeconds',0)
    );
    if jsonb_object_length(p_input) <> 2
      or not (p_input ? 'videoPackagingWorkflowId') or not (p_input ? 'videoPackagingRunId')
      or jsonb_typeof(p_input->'videoPackagingWorkflowId') <> 'string' or jsonb_typeof(p_input->'videoPackagingRunId') <> 'string'
      or (select count(*) from jsonb_object_keys(p_input) k where k not in ('videoPackagingWorkflowId','videoPackagingRunId')) > 0
    then raise exception 'VALIDATION_ERROR: exact video-packaging workflow and run IDs are required'; end if;
    begin
      v_approved_packaging := channelwright.resolve_approved_video_packaging_artifact(
        (p_input->>'videoPackagingWorkflowId')::uuid,
        (p_input->>'videoPackagingRunId')::uuid);
    exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved packaging reference'; end;
    v_persisted_input := p_input
      || jsonb_build_object('approvedVideoPackagingReference', v_approved_packaging->'reference');
    v_upstream_run := v_approved_packaging->'reference'->>'packagingRunId';
  elsif p_workflow_type = 'CHANNEL_VIDEO_PERFORMANCE' then
    v_expected_objective := 'Turn one exact approved CHANNEL_VIDEO_RELEASE plus an operator-supplied performance snapshot into a viewer-value-gated, evidence-disciplined, independently critiqued, human-approved immutable performance learning record for a single video';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-release','position',0,'kind','WORKER','capability','approved-release-validation','dependsOn','[]'::jsonb,'maxAttempts',2,'retryBaseSeconds',5),
      jsonb_build_object('key','draft-video-performance','position',1,'kind','WORKER','capability','video-performance-synthesis','dependsOn',jsonb_build_array('validate-approved-release'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','initial-video-performance-qa','position',2,'kind','WORKER','capability','independent-video-performance-qa','dependsOn',jsonb_build_array('draft-video-performance'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','bounded-video-performance-revision','position',3,'kind','WORKER','capability','video-performance-revision','dependsOn',jsonb_build_array('initial-video-performance-qa'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-video-performance-qa','position',4,'kind','WORKER','capability','independent-video-performance-qa','dependsOn',jsonb_build_array('bounded-video-performance-revision'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','finalize-video-performance','position',5,'kind','WORKER','capability','video-performance-finalizer','dependsOn',jsonb_build_array('final-video-performance-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-video-performance','position',6,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-video-performance'),'maxAttempts',1,'retryBaseSeconds',0)
    );
    if jsonb_object_length(p_input) <> 3
      or not (p_input ? 'videoReleaseWorkflowId') or not (p_input ? 'videoReleaseRunId') or not (p_input ? 'performanceSnapshot')
      or jsonb_typeof(p_input->'videoReleaseWorkflowId') <> 'string' or jsonb_typeof(p_input->'videoReleaseRunId') <> 'string'
      or jsonb_typeof(p_input->'performanceSnapshot') <> 'object'
      or (select count(*) from jsonb_object_keys(p_input) k where k not in ('videoReleaseWorkflowId','videoReleaseRunId','performanceSnapshot')) > 0
    then raise exception 'VALIDATION_ERROR: exact video-release workflow and run IDs and a performance snapshot are required'; end if;
    begin
      v_approved_release := channelwright.resolve_approved_video_release_artifact(
        (p_input->>'videoReleaseWorkflowId')::uuid,
        (p_input->>'videoReleaseRunId')::uuid);
    exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved release reference'; end;
    v_persisted_input := p_input
      || jsonb_build_object('approvedVideoReleaseReference', v_approved_release->'reference');
    v_upstream_run := v_approved_release->'reference'->>'releaseRunId';
  elsif p_workflow_type = 'CHANNEL_VIDEO_DIAGNOSIS' then
    v_expected_objective := 'Explain one exact approved CHANNEL_VIDEO_PERFORMANCE artifact using deterministic observations, bounded inference, independent critique, and human approval without recommending actions';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-performance','position',0,'kind','WORKER','capability','approved-performance-validation','dependsOn','[]'::jsonb,'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','derive-diagnosis-observations','position',1,'kind','WORKER','capability','deterministic-diagnosis-observation','dependsOn',jsonb_build_array('validate-approved-performance'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','draft-video-diagnosis','position',2,'kind','WORKER','capability','video-diagnosis-analysis','dependsOn',jsonb_build_array('derive-diagnosis-observations'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','critique-video-diagnosis','position',3,'kind','WORKER','capability','independent-video-diagnosis-critique','dependsOn',jsonb_build_array('draft-video-diagnosis'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-video-diagnosis-qa','position',4,'kind','WORKER','capability','deterministic-video-diagnosis-qa','dependsOn',jsonb_build_array('critique-video-diagnosis'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','finalize-video-diagnosis','position',5,'kind','WORKER','capability','video-diagnosis-finalizer','dependsOn',jsonb_build_array('final-video-diagnosis-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-video-diagnosis','position',6,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-video-diagnosis'),'maxAttempts',1,'retryBaseSeconds',0));
    if jsonb_object_length(p_input)<>2 or not (p_input?'videoPerformanceWorkflowId') or not (p_input?'videoPerformanceRunId')
      or jsonb_typeof(p_input->'videoPerformanceWorkflowId')<>'string' or jsonb_typeof(p_input->'videoPerformanceRunId')<>'string'
      or (select count(*) from jsonb_object_keys(p_input) k where k not in ('videoPerformanceWorkflowId','videoPerformanceRunId'))>0
    then raise exception 'VALIDATION_ERROR: exact Performance workflow and run IDs are required'; end if;
    begin v_approved_performance:=channelwright.resolve_approved_video_performance_artifact((p_input->>'videoPerformanceWorkflowId')::uuid,(p_input->>'videoPerformanceRunId')::uuid);
    exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved Performance reference'; end;
    v_persisted_input:=p_input||jsonb_build_object('approvedVideoPerformanceReference',v_approved_performance->'reference');
    v_upstream_run:=v_approved_performance->'reference'->>'performanceRunId';
  elsif p_workflow_type = 'CHANNEL_VIDEO_DECISION' then
    v_expected_objective := 'Convert one exact approved CHANNEL_VIDEO_DIAGNOSIS artifact into a single evidence-cited, independently critiqued, human-approved decision of record without designing an experiment or executing an action';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-diagnosis','position',0,'kind','WORKER','capability','approved-diagnosis-validation','dependsOn','[]'::jsonb,'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','derive-decision-evidence','position',1,'kind','WORKER','capability','deterministic-decision-evidence','dependsOn',jsonb_build_array('validate-approved-diagnosis'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','draft-video-decision','position',2,'kind','WORKER','capability','video-decision-analysis','dependsOn',jsonb_build_array('derive-decision-evidence'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','critique-video-decision','position',3,'kind','WORKER','capability','independent-video-decision-critique','dependsOn',jsonb_build_array('draft-video-decision'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-video-decision-qa','position',4,'kind','WORKER','capability','deterministic-video-decision-qa','dependsOn',jsonb_build_array('critique-video-decision'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','finalize-video-decision','position',5,'kind','WORKER','capability','video-decision-finalizer','dependsOn',jsonb_build_array('final-video-decision-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-video-decision','position',6,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-video-decision'),'maxAttempts',1,'retryBaseSeconds',0));
    if jsonb_object_length(p_input)<>2 or not (p_input?'videoDiagnosisWorkflowId') or not (p_input?'videoDiagnosisRunId')
      or jsonb_typeof(p_input->'videoDiagnosisWorkflowId')<>'string' or jsonb_typeof(p_input->'videoDiagnosisRunId')<>'string'
      or (select count(*) from jsonb_object_keys(p_input) k where k not in ('videoDiagnosisWorkflowId','videoDiagnosisRunId'))>0
    then raise exception 'VALIDATION_ERROR: exact Diagnosis workflow and run IDs are required'; end if;
    begin v_approved_diagnosis:=channelwright.resolve_approved_video_diagnosis_artifact((p_input->>'videoDiagnosisWorkflowId')::uuid,(p_input->>'videoDiagnosisRunId')::uuid);
    exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved Diagnosis reference'; end;
    v_persisted_input:=p_input||jsonb_build_object('approvedVideoDiagnosisReference',v_approved_diagnosis->'reference');
    v_upstream_run:=v_approved_diagnosis->'reference'->>'diagnosisRunId';
  elsif p_workflow_type = 'CHANNEL_VIDEO_EXPERIMENT' then
    v_expected_objective := 'Convert one exact approved, experiment-eligible CHANNEL_VIDEO_DECISION artifact into a single controlled, measurable, independently critiqued, human-approved experiment design without re-diagnosing, rewriting the decision, or executing anything';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-decision','position',0,'kind','WORKER','capability','approved-decision-validation','dependsOn','[]'::jsonb,'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','derive-experiment-constraints','position',1,'kind','WORKER','capability','deterministic-experiment-constraints','dependsOn',jsonb_build_array('validate-approved-decision'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','draft-video-experiment','position',2,'kind','WORKER','capability','video-experiment-design','dependsOn',jsonb_build_array('derive-experiment-constraints'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','critique-video-experiment','position',3,'kind','WORKER','capability','independent-video-experiment-critique','dependsOn',jsonb_build_array('draft-video-experiment'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-video-experiment-qa','position',4,'kind','WORKER','capability','deterministic-video-experiment-qa','dependsOn',jsonb_build_array('critique-video-experiment'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','finalize-video-experiment','position',5,'kind','WORKER','capability','video-experiment-finalizer','dependsOn',jsonb_build_array('final-video-experiment-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-video-experiment','position',6,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-video-experiment'),'maxAttempts',1,'retryBaseSeconds',0));
    if jsonb_object_length(p_input)<>2 or not (p_input?'videoDecisionWorkflowId') or not (p_input?'videoDecisionRunId')
      or jsonb_typeof(p_input->'videoDecisionWorkflowId')<>'string' or jsonb_typeof(p_input->'videoDecisionRunId')<>'string'
      or (select count(*) from jsonb_object_keys(p_input) k where k not in ('videoDecisionWorkflowId','videoDecisionRunId'))>0
    then raise exception 'VALIDATION_ERROR: exact Decision workflow and run IDs are required'; end if;
    begin v_approved_decision:=channelwright.resolve_approved_video_decision_artifact((p_input->>'videoDecisionWorkflowId')::uuid,(p_input->>'videoDecisionRunId')::uuid);
    exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved Decision reference'; end;
    v_persisted_input:=p_input||jsonb_build_object('approvedVideoDecisionReference',v_approved_decision->'reference');
    v_upstream_run:=v_approved_decision->'reference'->>'decisionRunId';
  elsif p_workflow_type = 'CHANNEL_VIDEO_PORTFOLIO' then
    v_expected_objective := 'Allocate one operator-declared cycle capacity across one to six exact approved, portfolio-eligible CHANNEL_VIDEO_EXPERIMENT designs into a single independently critiqued, human-approved allocation of record without redesigning an experiment, revisiting a decision, or executing anything';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-experiments','position',0,'kind','WORKER','capability','approved-experiment-validation','dependsOn','[]'::jsonb,'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','derive-portfolio-constraints','position',1,'kind','WORKER','capability','deterministic-portfolio-constraints','dependsOn',jsonb_build_array('validate-approved-experiments'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','draft-video-portfolio','position',2,'kind','WORKER','capability','video-portfolio-allocation','dependsOn',jsonb_build_array('derive-portfolio-constraints'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','critique-video-portfolio','position',3,'kind','WORKER','capability','independent-video-portfolio-critique','dependsOn',jsonb_build_array('draft-video-portfolio'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-video-portfolio-qa','position',4,'kind','WORKER','capability','deterministic-video-portfolio-qa','dependsOn',jsonb_build_array('critique-video-portfolio'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','finalize-video-portfolio','position',5,'kind','WORKER','capability','video-portfolio-finalizer','dependsOn',jsonb_build_array('final-video-portfolio-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-video-portfolio','position',6,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-video-portfolio'),'maxAttempts',1,'retryBaseSeconds',0));
    if jsonb_object_length(p_input)<>3 or not (p_input?'cycleLabel') or not (p_input?'concurrentExperimentSlots') or not (p_input?'experimentSelections')
      or jsonb_typeof(p_input->'cycleLabel')<>'string' or char_length(btrim(p_input->>'cycleLabel')) not between 1 and 120
      or jsonb_typeof(p_input->'concurrentExperimentSlots')<>'number' or (p_input->>'concurrentExperimentSlots') !~ '^\d+$' or (p_input->>'concurrentExperimentSlots')::integer not between 1 and 6
      or jsonb_typeof(p_input->'experimentSelections')<>'array' or jsonb_array_length(p_input->'experimentSelections') not between 1 and 6
      or (select count(*) from jsonb_object_keys(p_input) k where k not in ('cycleLabel','concurrentExperimentSlots','experimentSelections'))>0
    then raise exception 'VALIDATION_ERROR: a cycle label, a slot count between one and six, and one to six experiment selections are required'; end if;
    if exists(select 1 from jsonb_array_elements(p_input->'experimentSelections') s
      where jsonb_typeof(s)<>'object' or jsonb_object_length(s)<>2 or not (s?'experimentWorkflowId') or not (s?'experimentRunId')
        or jsonb_typeof(s->'experimentWorkflowId')<>'string' or jsonb_typeof(s->'experimentRunId')<>'string')
    then raise exception 'VALIDATION_ERROR: each experiment selection needs exactly an experiment workflow and run ID'; end if;
    if exists(select 1 from jsonb_array_elements(p_input->'experimentSelections') s group by s->>'experimentRunId' having count(*)>1)
    then raise exception 'VALIDATION_ERROR: the same experiment run cannot be selected twice'; end if;
    -- Every selection is resolved pre-spend through the same single-artifact
    -- resolver, in request order, so the persisted reference array is positionally
    -- aligned with the operator's selections and a single ineligible, superseded,
    -- unapproved, or foreign-owner candidate fails the whole start.
    v_experiment_refs := '[]'::jsonb;
    for v_selection in select value from jsonb_array_elements(p_input->'experimentSelections') loop
      begin v_approved_experiment:=channelwright.resolve_approved_video_experiment_artifact((v_selection->>'experimentWorkflowId')::uuid,(v_selection->>'experimentRunId')::uuid);
      exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved Experiment reference'; end;
      v_experiment_refs := v_experiment_refs || jsonb_build_array(v_approved_experiment->'reference');
    end loop;
    v_portfolio_cycle_key := lower(btrim(p_input->>'cycleLabel'));
    v_persisted_input:=p_input||jsonb_build_object('approvedVideoExperimentReferences',v_experiment_refs,'portfolioCycleKey',v_portfolio_cycle_key);
  elsif p_workflow_type = 'CHANNEL_VIDEO_INTELLIGENCE' then
    v_expected_objective := 'Synthesize two to four exact approved, intelligence-eligible CHANNEL_VIDEO_PORTFOLIO allocation records sharing one anchored CHANNEL_STRATEGY into a single independently critiqued, human-approved channel learning record and strategy review signal without authoring strategy, allocating capacity, or executing anything';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','validate-approved-portfolios','position',0,'kind','WORKER','capability','approved-portfolio-validation','dependsOn','[]'::jsonb,'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','derive-intelligence-constraints','position',1,'kind','WORKER','capability','deterministic-intelligence-constraints','dependsOn',jsonb_build_array('validate-approved-portfolios'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','draft-video-intelligence','position',2,'kind','WORKER','capability','video-intelligence-synthesis','dependsOn',jsonb_build_array('derive-intelligence-constraints'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','critique-video-intelligence','position',3,'kind','WORKER','capability','independent-video-intelligence-critique','dependsOn',jsonb_build_array('draft-video-intelligence'),'maxAttempts',2,'retryBaseSeconds',10),
      jsonb_build_object('key','final-video-intelligence-qa','position',4,'kind','WORKER','capability','deterministic-video-intelligence-qa','dependsOn',jsonb_build_array('critique-video-intelligence'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','finalize-video-intelligence','position',5,'kind','WORKER','capability','video-intelligence-finalizer','dependsOn',jsonb_build_array('final-video-intelligence-qa'),'maxAttempts',1,'retryBaseSeconds',0),
      jsonb_build_object('key','review-video-intelligence','position',6,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('finalize-video-intelligence'),'maxAttempts',1,'retryBaseSeconds',0));
    if jsonb_object_length(p_input)<>2 or not (p_input?'horizonLabel') or not (p_input?'portfolioSelections')
      or jsonb_typeof(p_input->'horizonLabel')<>'string' or char_length(btrim(p_input->>'horizonLabel')) not between 1 and 120
      or jsonb_typeof(p_input->'portfolioSelections')<>'array' or jsonb_array_length(p_input->'portfolioSelections') not between 2 and 4
      or (select count(*) from jsonb_object_keys(p_input) k where k not in ('horizonLabel','portfolioSelections'))>0
    then raise exception 'VALIDATION_ERROR: a horizon label and two to four portfolio selections are required'; end if;
    if exists(select 1 from jsonb_array_elements(p_input->'portfolioSelections') s
      where jsonb_typeof(s)<>'object' or jsonb_object_length(s)<>2 or not (s?'portfolioWorkflowId') or not (s?'portfolioRunId')
        or jsonb_typeof(s->'portfolioWorkflowId')<>'string' or jsonb_typeof(s->'portfolioRunId')<>'string')
    then raise exception 'VALIDATION_ERROR: each portfolio selection needs exactly a portfolio workflow and run ID'; end if;
    if exists(select 1 from jsonb_array_elements(p_input->'portfolioSelections') s group by s->>'portfolioRunId' having count(*)>1)
    then raise exception 'VALIDATION_ERROR: the same portfolio run cannot be selected twice'; end if;
    -- Every selection is resolved pre-spend through the same single-artifact
    -- resolver, in request order, so the persisted reference array is positionally
    -- aligned with the operator's selections and a single unready, superseded,
    -- unapproved, or foreign-owner allocation fails the whole start.
    v_portfolio_refs := '[]'::jsonb;
    v_strategy_anchor := null;
    for v_selection in select value from jsonb_array_elements(p_input->'portfolioSelections') loop
      begin v_approved_portfolio:=channelwright.resolve_approved_video_portfolio_artifact((v_selection->>'portfolioWorkflowId')::uuid,(v_selection->>'portfolioRunId')::uuid);
      exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: malformed approved Portfolio reference'; end;
      -- The channel identity gate. A learning record synthesized across cycles
      -- that ran under different approved strategies is not channel-wide learning;
      -- it is a comparison of two different strategic bets, and the strategy
      -- review signal it produces would have no single anchor to point at.
      if v_strategy_anchor is null then v_strategy_anchor := v_approved_portfolio#>>'{reference,strategyAnchor,strategyRunId}';
      elsif v_strategy_anchor is distinct from v_approved_portfolio#>>'{reference,strategyAnchor,strategyRunId}'
        then raise exception 'UPSTREAM_PORTFOLIO_STRATEGY_ANCHOR_MISMATCH: every selected allocation must descend from the same approved CHANNEL_STRATEGY run'; end if;
      v_portfolio_refs := v_portfolio_refs || jsonb_build_array(v_approved_portfolio->'reference');
    end loop;
    v_intelligence_horizon_key := lower(btrim(p_input->>'horizonLabel'));
    v_persisted_input:=p_input||jsonb_build_object('approvedVideoPortfolioReferences',v_portfolio_refs,'intelligenceHorizonKey',v_intelligence_horizon_key);
  else
    v_expected_objective := 'Evaluate a proposed channel concept against content depth, audience demand, and monetization readiness';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','assess-content-depth','position',0,'kind','WORKER','capability','strategist','dependsOn','[]'::jsonb,'maxAttempts',3,'retryBaseSeconds',2),
      jsonb_build_object('key','assess-audience-demand','position',1,'kind','WORKER','capability','researcher','dependsOn',jsonb_build_array('assess-content-depth'),'maxAttempts',3,'retryBaseSeconds',2),
      jsonb_build_object('key','assess-monetization','position',2,'kind','WORKER','capability','monetization-strategist','dependsOn',jsonb_build_array('assess-audience-demand'),'maxAttempts',3,'retryBaseSeconds',2),
      jsonb_build_object('key','synthesize-validation','position',3,'kind','WORKER','capability','strategist','dependsOn',jsonb_build_array('assess-monetization'),'maxAttempts',3,'retryBaseSeconds',2),
      jsonb_build_object('key','approve-validation','position',4,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('synthesize-validation'),'maxAttempts',1,'retryBaseSeconds',0)
    );
    if not (p_input ? 'proposedConcept') or jsonb_typeof(p_input->'proposedConcept') <> 'string' or char_length(p_input->>'proposedConcept') not between 20 and 2000
    then raise exception 'VALIDATION_ERROR: invalid CHANNEL_CONCEPT_VALIDATION input'; end if;
  end if;
  if p_objective <> v_expected_objective or p_steps <> v_expected_steps then raise exception 'WORKFLOW_TYPE_INVALID: canonical workflow definition required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_idempotency_key, 0));
  select * into v_existing from channelwright.workflow_runs where owner_id = v_owner and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.input_hash <> p_input_hash then raise exception 'IDEMPOTENCY_CONFLICT: key reused with different workflow input'; end if;
    return jsonb_build_object('workflowId',v_existing.workflow_id,'runId',v_existing.id,'status',v_existing.status,'idempotentReplay',true);
  end if;
  if p_workflow_type = 'CHANNEL_RESEARCH' and exists (select 1 from channelwright.workflow_runs where owner_id=v_owner and workflow_type='CHANNEL_RESEARCH' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','BLOCKED','PAUSED'))
    then raise exception 'RESEARCH_LIMIT_REACHED: an active research run already exists'; end if;
  if p_workflow_type = 'CHANNEL_STRATEGY' and exists (
    select 1 from channelwright.workflow_runs
    where owner_id = v_owner and workflow_type = 'CHANNEL_STRATEGY' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->'approvedResearchReference'->>'researchRunId' = v_upstream_run)
    then raise exception 'STRATEGY_LIMIT_REACHED: an active strategy run already exists for this approved research'; end if;
  if p_workflow_type = 'CHANNEL_CONTENT_INTELLIGENCE' and exists (
    select 1 from channelwright.workflow_runs
    where owner_id = v_owner and workflow_type = 'CHANNEL_CONTENT_INTELLIGENCE' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->'approvedStrategyReference'->>'strategyRunId' = v_upstream_run)
    then raise exception 'CONTENT_LIMIT_REACHED: an active content-intelligence run already exists for this approved strategy'; end if;
  if p_workflow_type = 'CHANNEL_VIDEO_BRIEF' and exists (
    select 1 from channelwright.workflow_runs
    where owner_id = v_owner and workflow_type = 'CHANNEL_VIDEO_BRIEF' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->'approvedContentReference'->>'contentRunId' = v_upstream_run
      and input_payload->>'selectedTopicId' = v_upstream_topic)
    then raise exception 'VIDEO_BRIEF_LIMIT_REACHED: an active video-brief run already exists for this approved topic'; end if;
  if p_workflow_type = 'CHANNEL_VIDEO_SCRIPT' and exists (
    select 1 from channelwright.workflow_runs
    where owner_id = v_owner and workflow_type = 'CHANNEL_VIDEO_SCRIPT' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->'approvedVideoBriefReference'->>'briefRunId' = v_upstream_run)
    then raise exception 'VIDEO_SCRIPT_LIMIT_REACHED: an active video-script run already exists for this approved brief'; end if;
  if p_workflow_type = 'CHANNEL_VIDEO_PACKAGING' and exists (
    select 1 from channelwright.workflow_runs
    where owner_id = v_owner and workflow_type = 'CHANNEL_VIDEO_PACKAGING' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->'approvedVideoScriptReference'->>'scriptRunId' = v_upstream_run)
    then raise exception 'VIDEO_PACKAGING_LIMIT_REACHED: an active video-packaging run already exists for this approved script'; end if;
  if p_workflow_type = 'CHANNEL_VIDEO_RELEASE' and exists (
    select 1 from channelwright.workflow_runs
    where owner_id = v_owner and workflow_type = 'CHANNEL_VIDEO_RELEASE' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->'approvedVideoPackagingReference'->>'packagingRunId' = v_upstream_run)
    then raise exception 'VIDEO_RELEASE_LIMIT_REACHED: an active video-release run already exists for this approved packaging'; end if;
  if p_workflow_type = 'CHANNEL_VIDEO_PERFORMANCE' and exists (
    select 1 from channelwright.workflow_runs
    where owner_id = v_owner and workflow_type = 'CHANNEL_VIDEO_PERFORMANCE' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->'approvedVideoReleaseReference'->>'releaseRunId' = v_upstream_run)
    then raise exception 'VIDEO_PERFORMANCE_LIMIT_REACHED: an active video-performance run already exists for this approved release'; end if;
  if p_workflow_type = 'CHANNEL_VIDEO_DIAGNOSIS' and exists (
    select 1 from channelwright.workflow_runs where owner_id=v_owner and workflow_type='CHANNEL_VIDEO_DIAGNOSIS'
      and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->'approvedVideoPerformanceReference'->>'performanceRunId'=v_upstream_run)
    then raise exception 'VIDEO_DIAGNOSIS_LIMIT_REACHED: an active diagnosis already exists for this approved Performance artifact'; end if;
  if p_workflow_type = 'CHANNEL_VIDEO_DECISION' and exists (
    select 1 from channelwright.workflow_runs where owner_id=v_owner and workflow_type='CHANNEL_VIDEO_DECISION'
      and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->'approvedVideoDiagnosisReference'->>'diagnosisRunId'=v_upstream_run)
    then raise exception 'VIDEO_DECISION_LIMIT_REACHED: an active decision already exists for this approved Diagnosis artifact'; end if;
  if p_workflow_type = 'CHANNEL_VIDEO_EXPERIMENT' and exists (
    select 1 from channelwright.workflow_runs where owner_id=v_owner and workflow_type='CHANNEL_VIDEO_EXPERIMENT'
      and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->'approvedVideoDecisionReference'->>'decisionRunId'=v_upstream_run)
    then raise exception 'VIDEO_EXPERIMENT_LIMIT_REACHED: an active experiment design already exists for this approved Decision artifact'; end if;
  if p_workflow_type = 'CHANNEL_VIDEO_PORTFOLIO' and exists (
    select 1 from channelwright.workflow_runs where owner_id=v_owner and workflow_type='CHANNEL_VIDEO_PORTFOLIO'
      and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->>'portfolioCycleKey'=v_portfolio_cycle_key)
    then raise exception 'VIDEO_PORTFOLIO_LIMIT_REACHED: an active portfolio allocation already exists for this cycle'; end if;
  if p_workflow_type = 'CHANNEL_VIDEO_INTELLIGENCE' and exists (
    select 1 from channelwright.workflow_runs where owner_id=v_owner and workflow_type='CHANNEL_VIDEO_INTELLIGENCE'
      and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED')
      and input_payload->>'intelligenceHorizonKey'=v_intelligence_horizon_key)
    then raise exception 'VIDEO_INTELLIGENCE_LIMIT_REACHED: an active channel learning record already exists for this horizon'; end if;

  insert into channelwright.workflows(owner_id,workflow_type,definition_version,objective,status)
    values(v_owner,p_workflow_type,p_definition_version,left(p_objective,1000),'QUEUED') returning id into v_workflow_id;
  begin
    insert into channelwright.workflow_runs(owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload)
      values(v_owner,v_workflow_id,p_workflow_type,p_definition_version,'QUEUED',p_idempotency_key,p_input_hash,v_persisted_input) returning id into v_run_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'workflow_runs_active_strategy_uniq' then
      raise exception 'STRATEGY_LIMIT_REACHED: a concurrent strategy run was already created for this approved research';
    elsif v_constraint = 'workflow_runs_active_content_uniq' then
      raise exception 'CONTENT_LIMIT_REACHED: a concurrent content-intelligence run was already created for this approved strategy';
    elsif v_constraint = 'workflow_runs_active_video_brief_uniq' then
      raise exception 'VIDEO_BRIEF_LIMIT_REACHED: a concurrent video-brief run was already created for this approved topic';
    elsif v_constraint = 'workflow_runs_active_video_script_uniq' then
      raise exception 'VIDEO_SCRIPT_LIMIT_REACHED: a concurrent video-script run was already created for this approved brief';
    elsif v_constraint = 'workflow_runs_active_video_packaging_uniq' then
      raise exception 'VIDEO_PACKAGING_LIMIT_REACHED: a concurrent video-packaging run was already created for this approved script';
    elsif v_constraint = 'workflow_runs_active_video_release_uniq' then
      raise exception 'VIDEO_RELEASE_LIMIT_REACHED: a concurrent video-release run was already created for this approved packaging';
    elsif v_constraint = 'workflow_runs_active_video_performance_uniq' then
      raise exception 'VIDEO_PERFORMANCE_LIMIT_REACHED: a concurrent video-performance run was already created for this approved release';
    elsif v_constraint = 'workflow_runs_active_video_diagnosis_uniq' then
      raise exception 'VIDEO_DIAGNOSIS_LIMIT_REACHED: a concurrent diagnosis was already created for this approved Performance artifact';
    elsif v_constraint = 'workflow_runs_active_video_decision_uniq' then
      raise exception 'VIDEO_DECISION_LIMIT_REACHED: a concurrent decision was already created for this approved Diagnosis artifact';
    elsif v_constraint = 'workflow_runs_active_video_experiment_uniq' then
      raise exception 'VIDEO_EXPERIMENT_LIMIT_REACHED: a concurrent experiment design was already created for this approved Decision artifact';
    elsif v_constraint = 'workflow_runs_active_video_portfolio_uniq' then
      raise exception 'VIDEO_PORTFOLIO_LIMIT_REACHED: a concurrent portfolio allocation was already created for this cycle';
    elsif v_constraint = 'workflow_runs_active_video_intelligence_uniq' then
      raise exception 'VIDEO_INTELLIGENCE_LIMIT_REACHED: a concurrent channel learning record was already created for this horizon';
    end if;
    raise;
  end;
  update channelwright.workflows set current_run_id=v_run_id where id=v_workflow_id;
  for v_step in select value from jsonb_array_elements(p_steps) loop
    if coalesce(v_step->>'key','') !~ '^[a-z][a-z0-9-]{1,119}$' or coalesce(v_step->>'kind','') not in ('WORKER','APPROVAL')
      or coalesce((v_step->>'position')::integer,-1)<0 or coalesce((v_step->>'maxAttempts')::integer,0) not between 1 and 20
      or coalesce((v_step->>'retryBaseSeconds')::integer,-1) not between 0 and 3600 then raise exception 'VALIDATION_ERROR: invalid workflow step definition'; end if;
    v_status := case when jsonb_array_length(coalesce(v_step->'dependsOn','[]'::jsonb))=0 then case when v_step->>'kind'='APPROVAL' then 'WAITING_FOR_APPROVAL' else 'QUEUED' end else 'BLOCKED' end;
    insert into channelwright.workflow_steps(owner_id,workflow_id,workflow_run_id,step_key,position,kind,capability,depends_on,status,max_attempts,retry_base_seconds)
      values(v_owner,v_workflow_id,v_run_id,v_step->>'key',(v_step->>'position')::integer,v_step->>'kind',left(v_step->>'capability',120),array(select jsonb_array_elements_text(coalesce(v_step->'dependsOn','[]'::jsonb))),v_status,(v_step->>'maxAttempts')::integer,(v_step->>'retryBaseSeconds')::integer);
  end loop;
  insert into channelwright.workflow_approvals(owner_id,workflow_id,workflow_run_id,workflow_step_id,gate_key,status,request_payload)
    select owner_id,workflow_id,workflow_run_id,id,step_key,'PENDING',jsonb_build_object('workflowType',p_workflow_type,'definitionVersion',p_definition_version)
    from channelwright.workflow_steps where workflow_run_id=v_run_id and status='WAITING_FOR_APPROVAL';
  insert into channelwright.workflow_events(owner_id,workflow_id,workflow_run_id,event_type,actor_type,actor_id,detail)
    values(v_owner,v_workflow_id,v_run_id,'WORKFLOW_QUEUED','USER',v_owner::text,jsonb_build_object('workflowType',p_workflow_type,'definitionVersion',p_definition_version));
  return jsonb_build_object('workflowId',v_workflow_id,'runId',v_run_id,'status','QUEUED','idempotentReplay',false);
end $$;

-- ---------------------------------------------------------------------------
-- Finalizer promotion for the twelfth paid workflow type.
--
-- Reproduced verbatim from 202609070001 apart from the added
-- CHANNEL_VIDEO_INTELLIGENCE finalizer case: the service-role guard, idempotent-
-- replay path, lease and attempt checks, and the context_payload write that
-- feeds priorOutputs are all load-bearing for every workflow and must not drift.
-- ---------------------------------------------------------------------------
create or replace function channelwright.complete_workflow_step(p_step_id uuid, p_lease_token uuid, p_output jsonb)
returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare
  v_step channelwright.workflow_steps%rowtype;
  v_attempt_id uuid;
  v_next channelwright.workflow_steps%rowtype;
  v_run_status text;
  v_run_type text;
  v_finalizer text;
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: workflow worker service role required'; end if;
  if jsonb_typeof(p_output) not in ('object','array') or octet_length(p_output::text) > 65536 then raise exception 'PAYLOAD_TOO_LARGE: workflow output must be bounded structured data'; end if;
  select s.* into v_step from channelwright.workflow_steps s
    where s.id = p_step_id and exists (select 1 from channelwright.workflow_step_attempts a where a.workflow_step_id = s.id and a.lease_token = p_lease_token and a.status = 'SUCCEEDED');
  if found then return jsonb_build_object('stepId', v_step.id, 'status', 'COMPLETED', 'idempotentReplay', true); end if;
  select * into v_step from channelwright.workflow_steps where id = p_step_id and lease_token = p_lease_token and status = 'LEASED' and lease_expires_at > now() and cancellation_requested_at is null for update;
  if not found then raise exception 'LEASE_NOT_ACTIVE: workflow step lease is not active'; end if;
  select id into v_attempt_id from channelwright.workflow_step_attempts where workflow_step_id = p_step_id and lease_token = p_lease_token and status = 'STARTED' for update;
  update channelwright.workflow_step_attempts set status = 'SUCCEEDED', completed_at = now() where id = v_attempt_id;
  update channelwright.workflow_steps set status = 'COMPLETED', output_payload = p_output, leased_by = null, lease_token = null, lease_expires_at = null, completed_at = now()
    where id = p_step_id;
  select workflow_type into v_run_type from channelwright.workflow_runs where id = v_step.workflow_run_id;
  v_finalizer := case v_run_type
    when 'CHANNEL_STRATEGY' then 'finalize-strategy'
    when 'CHANNEL_CONTENT_INTELLIGENCE' then 'finalize-content-intelligence'
    when 'CHANNEL_VIDEO_BRIEF' then 'finalize-video-brief'
    when 'CHANNEL_VIDEO_SCRIPT' then 'finalize-video-script'
    when 'CHANNEL_VIDEO_PACKAGING' then 'finalize-video-packaging'
    when 'CHANNEL_VIDEO_RELEASE' then 'finalize-video-release'
    when 'CHANNEL_VIDEO_PERFORMANCE' then 'finalize-video-performance'
    when 'CHANNEL_VIDEO_DIAGNOSIS' then 'finalize-video-diagnosis'
    when 'CHANNEL_VIDEO_DECISION' then 'finalize-video-decision'
    when 'CHANNEL_VIDEO_EXPERIMENT' then 'finalize-video-experiment'
    when 'CHANNEL_VIDEO_PORTFOLIO' then 'finalize-video-portfolio'
    when 'CHANNEL_VIDEO_INTELLIGENCE' then 'finalize-video-intelligence'
    else 'synthesize-validation' end;
  update channelwright.workflow_runs set context_payload = jsonb_set(context_payload, array[v_step.step_key], p_output, true),
    output_payload = case when v_step.step_key = v_finalizer then p_output else output_payload end
    where id = v_step.workflow_run_id;

  for v_next in select * from channelwright.workflow_steps s where s.workflow_run_id = v_step.workflow_run_id and s.status = 'BLOCKED'
    and not exists (select 1 from unnest(s.depends_on) dependency where not exists (
      select 1 from channelwright.workflow_steps prior where prior.workflow_run_id = s.workflow_run_id and prior.step_key = dependency and prior.status = 'COMPLETED'))
    order by s.position for update
  loop
    if v_next.kind = 'APPROVAL' then
      update channelwright.workflow_steps set status = 'WAITING_FOR_APPROVAL' where id = v_next.id;
      insert into channelwright.workflow_approvals(owner_id, workflow_id, workflow_run_id, workflow_step_id, gate_key, status, request_payload)
        values (v_next.owner_id, v_next.workflow_id, v_next.workflow_run_id, v_next.id, v_next.step_key, 'PENDING', jsonb_build_object('output', p_output))
        on conflict (workflow_step_id) do nothing;
    else
      update channelwright.workflow_steps set status = 'QUEUED', available_at = now() where id = v_next.id;
    end if;
  end loop;

  if not exists (select 1 from channelwright.workflow_steps where workflow_run_id = v_step.workflow_run_id and status <> 'COMPLETED') then v_run_status := 'COMPLETED';
  elsif exists (select 1 from channelwright.workflow_steps where workflow_run_id = v_step.workflow_run_id and status = 'WAITING_FOR_APPROVAL') then v_run_status := 'WAITING_FOR_APPROVAL';
  else v_run_status := 'RUNNING'; end if;
  update channelwright.workflow_runs set status = v_run_status, completed_at = case when v_run_status = 'COMPLETED' then now() else null end where id = v_step.workflow_run_id;
  update channelwright.workflows set status = v_run_status, completed_at = case when v_run_status = 'COMPLETED' then now() else null end where id = v_step.workflow_id;
  insert into channelwright.workflow_events(owner_id, workflow_id, workflow_run_id, workflow_step_id, workflow_attempt_id, event_type, actor_type, actor_id, detail)
    values (v_step.owner_id, v_step.workflow_id, v_step.workflow_run_id, v_step.id, v_attempt_id, 'STEP_COMPLETED', 'WORKER', v_step.leased_by, jsonb_build_object('runStatus', v_run_status));
  return jsonb_build_object('stepId', v_step.id, 'status', 'COMPLETED', 'runStatus', v_run_status, 'idempotentReplay', false);
end $$;

-- ---------------------------------------------------------------------------
-- Approval, revision lineage, and provenance hashing extend to the channel
-- learning record. Its provenance step is validate-approved-portfolios: it
-- carries the exact upstream Portfolio reference set and the cycle-scope lineage
-- every downstream citation must resolve against. A human-requested revision
-- preserves the original run, the pinned upstream references, and root lineage.
--
-- This recreation preserves the widened search_path established by 202608150002:
-- decide_workflow_approval calls digest() and must keep `extensions` on its path.
-- ---------------------------------------------------------------------------
create or replace function channelwright.decide_workflow_approval(p_workflow_id uuid,p_approval_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=channelwright,extensions,pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_approval channelwright.workflow_approvals%rowtype;
  v_old_run channelwright.workflow_runs%rowtype;
  v_old_step channelwright.workflow_steps%rowtype;
  v_run_status text;
  v_result_run_id uuid;
  v_new_run_id uuid;
  v_provenance jsonb;
  v_provenance_step text;
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  if p_decision not in ('APPROVE','REJECT','REQUEST_REVISION') or char_length(coalesce(p_note,''))>2000 or (p_decision='REQUEST_REVISION' and char_length(coalesce(p_note,''))=0) then raise exception 'VALIDATION_ERROR: invalid approval decision'; end if;
  select * into v_approval from channelwright.workflow_approvals where id=p_approval_id and workflow_id=p_workflow_id and owner_id=v_owner for update;
  if not found then raise exception 'NOT_FOUND: workflow approval'; end if;
  if v_approval.status<>'PENDING' then raise exception 'INVALID_TRANSITION: approval is already final'; end if;
  select * into v_old_run from channelwright.workflow_runs where id=v_approval.workflow_run_id and owner_id=v_owner for update;
  v_result_run_id := v_old_run.id;
  if v_old_run.workflow_type in ('CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE','CHANNEL_VIDEO_DIAGNOSIS','CHANNEL_VIDEO_DECISION','CHANNEL_VIDEO_EXPERIMENT','CHANNEL_VIDEO_PORTFOLIO','CHANNEL_VIDEO_INTELLIGENCE') and v_old_run.output_payload is not null then
    v_provenance_step := case v_old_run.workflow_type
      when 'CHANNEL_RESEARCH' then 'retrieve-youtube-evidence'
      when 'CHANNEL_STRATEGY' then 'validate-approved-research'
      when 'CHANNEL_VIDEO_BRIEF' then 'validate-approved-content'
      when 'CHANNEL_VIDEO_SCRIPT' then 'validate-approved-brief'
      when 'CHANNEL_VIDEO_PACKAGING' then 'validate-approved-script'
      when 'CHANNEL_VIDEO_RELEASE' then 'validate-approved-packaging'
      when 'CHANNEL_VIDEO_PERFORMANCE' then 'validate-approved-release'
      when 'CHANNEL_VIDEO_DIAGNOSIS' then 'validate-approved-performance'
      when 'CHANNEL_VIDEO_DECISION' then 'validate-approved-diagnosis'
      when 'CHANNEL_VIDEO_EXPERIMENT' then 'validate-approved-decision'
      when 'CHANNEL_VIDEO_PORTFOLIO' then 'validate-approved-experiments'
      when 'CHANNEL_VIDEO_INTELLIGENCE' then 'validate-approved-portfolios'
      else 'discover-youtube-topics' end;
    select output_payload into v_provenance from channelwright.workflow_steps where workflow_run_id=v_old_run.id and step_key=v_provenance_step;
    if v_provenance is null then raise exception 'INVALID_TRANSITION: finalized workflow provenance is missing'; end if;
    update channelwright.workflow_runs set artifact_hash=encode(digest(output_payload::text,'sha256'),'hex'),provenance_hash=encode(digest(v_provenance::text,'sha256'),'hex') where id=v_old_run.id;
  end if;
  if p_decision='REJECT' then
    update channelwright.workflow_approvals set status='REJECTED',decision_note=p_note,decided_by=v_owner,decided_at=now() where id=p_approval_id;
    update channelwright.workflow_steps set status='CANCELED',completed_at=now() where id=v_approval.workflow_step_id;
    update channelwright.workflow_runs set status='CANCELED',canceled_at=now(),completed_at=now() where id=v_old_run.id;
    update channelwright.workflows set status='CANCELED',canceled_at=now(),completed_at=now() where id=p_workflow_id;
    v_run_status := 'CANCELED';
  elsif p_decision='REQUEST_REVISION' then
    update channelwright.workflow_runs set status='BLOCKED',context_payload=jsonb_set(context_payload,'{humanRevision}',jsonb_build_object('note',p_note,'requestedAt',now()),true) where id=v_old_run.id;
    update channelwright.workflow_approvals set status='REVISION_REQUESTED',decision_note=p_note,decided_by=v_owner,decided_at=now() where id=p_approval_id;
    update channelwright.workflow_steps set status='CANCELED',completed_at=now() where id=v_approval.workflow_step_id;
    insert into channelwright.workflow_runs(owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload,context_payload)
      values(v_owner,p_workflow_id,v_old_run.workflow_type,v_old_run.definition_version,'QUEUED','human-revision:'||v_old_run.id::text,md5(v_old_run.input_hash||p_note)||md5(p_note||v_old_run.input_hash),v_old_run.input_payload||jsonb_build_object('humanRevisionNote',p_note),jsonb_build_object('previousRunId',v_old_run.id,'revisionReason',p_note)) returning id into v_new_run_id;
    for v_old_step in select * from channelwright.workflow_steps where workflow_run_id=v_old_run.id order by position loop
      insert into channelwright.workflow_steps(owner_id,workflow_id,workflow_run_id,step_key,position,kind,capability,depends_on,status,max_attempts,retry_base_seconds)
        values(v_owner,p_workflow_id,v_new_run_id,v_old_step.step_key,v_old_step.position,v_old_step.kind,v_old_step.capability,v_old_step.depends_on,case when cardinality(v_old_step.depends_on)=0 then case when v_old_step.kind='APPROVAL' then 'WAITING_FOR_APPROVAL' else 'QUEUED' end else 'BLOCKED' end,v_old_step.max_attempts,v_old_step.retry_base_seconds);
    end loop;
    insert into channelwright.workflow_approvals(owner_id,workflow_id,workflow_run_id,workflow_step_id,gate_key,status,request_payload)
      select owner_id,workflow_id,workflow_run_id,id,step_key,'PENDING',jsonb_build_object('workflowType',v_old_run.workflow_type,'definitionVersion',v_old_run.definition_version)
      from channelwright.workflow_steps where workflow_run_id=v_new_run_id and status='WAITING_FOR_APPROVAL';
    update channelwright.workflows set current_run_id=v_new_run_id,status='QUEUED',completed_at=null where id=p_workflow_id;
    insert into channelwright.workflow_events(owner_id,workflow_id,workflow_run_id,event_type,actor_type,actor_id,detail)
      values(v_owner,p_workflow_id,v_new_run_id,'WORKFLOW_REVISION_QUEUED','USER',v_owner::text,jsonb_build_object('previousRunId',v_old_run.id,'upstreamResearchRunId',v_old_run.input_payload->'approvedResearchReference'->>'researchRunId','upstreamStrategyRunId',v_old_run.input_payload->'approvedStrategyReference'->>'strategyRunId','upstreamContentRunId',v_old_run.input_payload->'approvedContentReference'->>'contentRunId','upstreamBriefRunId',v_old_run.input_payload->'approvedVideoBriefReference'->>'briefRunId','upstreamScriptRunId',v_old_run.input_payload->'approvedVideoScriptReference'->>'scriptRunId','upstreamPackagingRunId',v_old_run.input_payload->'approvedVideoPackagingReference'->>'packagingRunId','upstreamReleaseRunId',v_old_run.input_payload->'approvedVideoReleaseReference'->>'releaseRunId','upstreamPerformanceRunId',v_old_run.input_payload->'approvedVideoPerformanceReference'->>'performanceRunId','upstreamDiagnosisRunId',v_old_run.input_payload->'approvedVideoDiagnosisReference'->>'diagnosisRunId','upstreamDecisionRunId',v_old_run.input_payload->'approvedVideoDecisionReference'->>'decisionRunId','portfolioCycleKey',v_old_run.input_payload->>'portfolioCycleKey','intelligenceHorizonKey',v_old_run.input_payload->>'intelligenceHorizonKey','selectedTopicId',v_old_run.input_payload->>'selectedTopicId'));
    v_result_run_id := v_new_run_id; v_run_status := 'QUEUED';
  else
    update channelwright.workflow_approvals set status='APPROVED',decision_note=p_note,decided_by=v_owner,decided_at=now() where id=p_approval_id;
    update channelwright.workflow_steps set status='COMPLETED',completed_at=now() where id=v_approval.workflow_step_id;
    update channelwright.workflow_steps s set status='QUEUED',available_at=now() where s.workflow_run_id=v_old_run.id and s.status='BLOCKED'
      and not exists(select 1 from unnest(s.depends_on) dependency where not exists(select 1 from channelwright.workflow_steps prior where prior.workflow_run_id=s.workflow_run_id and prior.step_key=dependency and prior.status='COMPLETED'));
    if not exists(select 1 from channelwright.workflow_steps where workflow_run_id=v_old_run.id and status<>'COMPLETED') then v_run_status:='COMPLETED'; else v_run_status:='RUNNING'; end if;
    update channelwright.workflow_runs set status=v_run_status,completed_at=case when v_run_status='COMPLETED' then now() else null end where id=v_old_run.id;
    update channelwright.workflows set status=v_run_status,completed_at=case when v_run_status='COMPLETED' then now() else null end where id=p_workflow_id;
  end if;
  insert into channelwright.workflow_events(owner_id,workflow_id,workflow_run_id,workflow_step_id,event_type,actor_type,actor_id,detail)
    values(v_owner,p_workflow_id,v_approval.workflow_run_id,v_approval.workflow_step_id,'APPROVAL_DECIDED','USER',v_owner::text,jsonb_build_object('decision',p_decision));
  return jsonb_build_object('workflowId',p_workflow_id,'runId',v_result_run_id,'approvalId',p_approval_id,'decision',p_decision,'runStatus',v_run_status);
end $$;

-- ---------------------------------------------------------------------------
-- Durable accounting accepts the twelfth paid workflow type. Ceilings unchanged.
--
-- CHANNEL_VIDEO_INTELLIGENCE joins CHANNEL_VIDEO_DIAGNOSIS, CHANNEL_VIDEO_DECISION,
-- CHANNEL_VIDEO_EXPERIMENT and CHANNEL_VIDEO_PORTFOLIO as a workflow that performs no external retrieval
-- and no automated revision, so it shares their tighter 2/2/0/0
-- synthesis/QA/revision/automated-revision ceilings rather than the wider
-- ceilings the revision-capable verticals use.
-- ---------------------------------------------------------------------------
create or replace function channelwright.ensure_research_run_budget(p_run_id uuid,p_step_id uuid,p_lease_token uuid,p_operation_key text,p_limits jsonb)
returns jsonb language plpgsql security definer set search_path=channelwright,pg_temp as $$
declare
  v_run channelwright.workflow_runs%rowtype;
  v_step channelwright.workflow_steps%rowtype;
  v_attempt channelwright.workflow_step_attempts%rowtype;
  v_parent uuid;
  v_root uuid;
  v_inserted integer;
  v_no_retrieval boolean;
  v_tight_ceiling boolean;
begin
  if session_user<>'postgres' and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'NOT_ALLOWED: workflow accounting requires service role'; end if;
  perform channelwright.assert_research_usage_shape(p_limits,false);
  select * into v_run from channelwright.workflow_runs where id=p_run_id and workflow_type in ('CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE','CHANNEL_VIDEO_DIAGNOSIS','CHANNEL_VIDEO_DECISION','CHANNEL_VIDEO_EXPERIMENT','CHANNEL_VIDEO_PORTFOLIO','CHANNEL_VIDEO_INTELLIGENCE');
  if not found then raise exception 'NOT_FOUND: paid workflow run'; end if;
  v_no_retrieval := v_run.workflow_type in ('CHANNEL_STRATEGY','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE','CHANNEL_VIDEO_DIAGNOSIS','CHANNEL_VIDEO_DECISION','CHANNEL_VIDEO_EXPERIMENT','CHANNEL_VIDEO_PORTFOLIO','CHANNEL_VIDEO_INTELLIGENCE');
  v_tight_ceiling := v_run.workflow_type in ('CHANNEL_VIDEO_DIAGNOSIS','CHANNEL_VIDEO_DECISION','CHANNEL_VIDEO_EXPERIMENT','CHANNEL_VIDEO_PORTFOLIO','CHANNEL_VIDEO_INTELLIGENCE');
  if jsonb_object_length(p_limits)<>10
    or channelwright.research_usage_value(p_limits,'providerRequests') not between (case when v_no_retrieval then 0 else 1 end) and 36
    or channelwright.research_usage_value(p_limits,'providerQuotaUnits') not between (case when v_no_retrieval then 0 else 1 end) and 1200
    or channelwright.research_usage_value(p_limits,'searches') not between (case when v_no_retrieval then 0 else 1 end) and 12
    or channelwright.research_usage_value(p_limits,'synthesisCalls') not between 1 and (case when v_tight_ceiling then 2 else 6 end)
    or channelwright.research_usage_value(p_limits,'qaCalls') not between 1 and (case when v_tight_ceiling then 2 else 12 end)
    or channelwright.research_usage_value(p_limits,'revisionCalls') not between (case when v_tight_ceiling then 0 else 1 end) and (case when v_tight_ceiling then 0 else 4 end)
    or channelwright.research_usage_value(p_limits,'inputTokens') not between 1000 and 1000000
    or channelwright.research_usage_value(p_limits,'outputTokens') not between 1000 and 100000
    or channelwright.research_usage_value(p_limits,'totalTokens') not between 2000 and 1100000
    or channelwright.research_usage_value(p_limits,'automatedRevisions')<>(case when v_tight_ceiling then 0 else 1 end)
    or (v_no_retrieval and (channelwright.research_usage_value(p_limits,'providerRequests')<>0 or channelwright.research_usage_value(p_limits,'providerQuotaUnits')<>0 or channelwright.research_usage_value(p_limits,'searches')<>0))
  then raise exception 'VALIDATION_ERROR: workflow budget exceeds database safety ceilings or is incomplete'; end if;
  select * into v_step from channelwright.workflow_steps where id=p_step_id and workflow_run_id=p_run_id and lease_token=p_lease_token and status='LEASED' and lease_expires_at>now();
  if not found then raise exception 'LEASE_NOT_ACTIVE: workflow usage requires the active lease'; end if;
  select * into v_attempt from channelwright.workflow_step_attempts where workflow_step_id=p_step_id and lease_token=p_lease_token and status='STARTED';
  if not found then raise exception 'LEASE_NOT_ACTIVE: workflow attempt is not active'; end if;
  begin v_parent:=nullif(v_run.context_payload->>'previousRunId','')::uuid; exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: invalid workflow lineage'; end;
  if v_parent is not null and not exists(select 1 from channelwright.workflow_runs where id=v_parent and workflow_id=v_run.workflow_id and owner_id=v_run.owner_id and workflow_type=v_run.workflow_type) then raise exception 'VALIDATION_ERROR: invalid workflow parent lineage'; end if;
  select root_run_id into v_root from channelwright.research_run_budgets where workflow_run_id=v_parent and owner_id=v_run.owner_id;
  v_root:=coalesce(v_root,v_parent,v_run.id);
  insert into channelwright.research_run_budgets(workflow_run_id,owner_id,workflow_id,parent_run_id,root_run_id,limits)
    values(v_run.id,v_run.owner_id,v_run.workflow_id,v_parent,v_root,p_limits) on conflict(workflow_run_id) do nothing;
  if exists(select 1 from channelwright.research_run_budgets where workflow_run_id=v_run.id and limits<>p_limits) then raise exception 'IDEMPOTENCY_CONFLICT: workflow run budget configuration changed'; end if;
  insert into channelwright.research_usage_operations(owner_id,workflow_id,workflow_run_id,workflow_step_id,workflow_attempt_id,operation_key,operation_kind,status,actual_usage,finalized_at)
    values(v_run.owner_id,v_run.workflow_id,v_run.id,v_step.id,v_attempt.id,p_operation_key,'STEP_ATTEMPT','SUCCEEDED',jsonb_build_object('executionAttempts',1),now()) on conflict(workflow_run_id,operation_key) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=1 then update channelwright.research_run_budgets set used_totals=channelwright.research_usage_add(used_totals,jsonb_build_object('executionAttempts',1)),last_recorded_at=now() where workflow_run_id=v_run.id; end if;
  return (select to_jsonb(b) from channelwright.research_run_budgets b where workflow_run_id=v_run.id);
end $$;

revoke all on function channelwright.resolve_approved_video_portfolio_artifact(uuid,uuid) from public,anon;
grant execute on function channelwright.resolve_approved_video_portfolio_artifact(uuid,uuid) to authenticated,service_role;
revoke all on function channelwright.resolve_approved_video_experiment_artifact(uuid,uuid) from public,anon;
grant execute on function channelwright.resolve_approved_video_experiment_artifact(uuid,uuid) to authenticated,service_role;
revoke all on function channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb) from public, anon;
grant execute on function channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb) to authenticated;
revoke all on function channelwright.complete_workflow_step(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function channelwright.complete_workflow_step(uuid,uuid,jsonb) to service_role;
revoke all on function channelwright.decide_workflow_approval(uuid,uuid,text,text) from public, anon;
grant execute on function channelwright.decide_workflow_approval(uuid,uuid,text,text) to authenticated;
revoke all on function channelwright.ensure_research_run_budget(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function channelwright.ensure_research_run_budget(uuid,uuid,uuid,text,jsonb) to service_role;
