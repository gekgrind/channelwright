-- CHANNEL_VIDEO_PERFORMANCE vertical slice. Additive and forward-only: it extends
-- the existing workflow, approval, lease, lineage, immutability, and usage-
-- accounting spine rather than introducing a parallel mechanism. No previously
-- applied migration is altered.
--
-- CHANNEL_VIDEO_PERFORMANCE is the Measurement link after CHANNEL_VIDEO_RELEASE.
-- It consumes exactly one approved CHANNEL_VIDEO_RELEASE record plus an
-- OPERATOR-SUPPLIED performance snapshot and produces a human-approved, immutable
-- performance learning record: a deterministic KPI/hypothesis adjudication of
-- every hypothesis the release bound, the durable learnings, a strategy-revisit
-- signal, and a next-decision recommendation. It performs NO analytics
-- ingestion, NO provider OAuth, NO publishing / re-upload / recut / scheduling /
-- rendering / media generation, and NO change to the approved release record.
--
-- Nothing here widens the database resource ceilings introduced in 202608130004.
-- Like strategy/brief/script/packaging/release this workflow performs no external
-- evidence retrieval at all: it reasons over the approved release, the discovery
-- evidence that the release's upstream content-intelligence run already paid for,
-- and the operator snapshot. Its provider-request, quota, and search ceilings are
-- zero and only model calls consume budget.
--
-- Functions that call digest() (the new resolver and the recreated
-- decide_workflow_approval) declare `search_path = channelwright, extensions,
-- pg_temp`, because pgcrypto lives in the `extensions` schema on Supabase. This
-- matches the state 202608150002 established for the sibling resolvers and avoids
-- a follow-up repair. `public` stays excluded throughout.

alter table channelwright.workflows drop constraint if exists workflows_workflow_type_check;
alter table channelwright.workflows add constraint workflows_workflow_type_check
  check (workflow_type in ('CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE'));

alter table channelwright.workflow_runs drop constraint if exists workflow_runs_workflow_type_check;
alter table channelwright.workflow_runs add constraint workflow_runs_workflow_type_check
  check (workflow_type in ('CHANNEL','VIDEO','CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE'));

-- One active video-performance run per owner per approved video-release run. A
-- release pins one video, so the release run alone is the key. BLOCKED is
-- excluded so a human-revision successor (predecessor moved to BLOCKED before the
-- successor is inserted) remains legal. A later re-measurement is a fresh run
-- started after the first performance run for that release completes.
create unique index workflow_runs_active_video_performance_uniq
  on channelwright.workflow_runs (
    owner_id,
    ((input_payload->'approvedVideoReleaseReference'->>'releaseRunId'))
  )
  where workflow_type = 'CHANNEL_VIDEO_PERFORMANCE' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED');

-- ---------------------------------------------------------------------------
-- Approved video-release resolver
--
-- Resolves the exact approved release a measurement is built from. Cross-owner
-- requests are NOT_FOUND rather than FORBIDDEN so the ID space stays
-- non-enumerable. The release must be completed, human-approved, immutable (its
-- artifact and provenance hashes are recomputed and compared, not trusted),
-- integrity-valid against its own upstream video-packaging reference, and have
-- passed the Viewer Value gate. The resolved scope carries the authoritative
-- topic/pillar/promise/final-title identity, the exact transitive strategy
-- identity every KPI/hypothesis outcome must anchor to, and the release's bound
-- KPI/hypothesis set — so what must be measured is decided by database state,
-- never the caller's word.
-- ---------------------------------------------------------------------------
create or replace function channelwright.resolve_approved_video_release_artifact(
  p_workflow_id uuid,
  p_run_id uuid
)
returns jsonb language plpgsql security definer set search_path = channelwright, extensions, pg_temp as $$
declare
  v_run channelwright.workflow_runs%rowtype;
  v_workflow channelwright.workflows%rowtype;
  v_approval channelwright.workflow_approvals%rowtype;
  v_finalizer jsonb;
  v_final_qa jsonb;
  v_provenance jsonb;
  v_parent uuid;
  v_root uuid;
  v_artifact_hash text;
  v_provenance_hash text;
  v_topic_id text;
  v_pillar_id text;
  v_promise text;
  v_final_title text;
  v_strategy_run_id text;
  v_kpi_bindings jsonb;
  v_gate text;
  v_role text := coalesce(auth.jwt()->>'role','');
begin
  select * into v_run from channelwright.workflow_runs
    where id = p_run_id and workflow_id = p_workflow_id and workflow_type = 'CHANNEL_VIDEO_RELEASE';
  if not found then raise exception 'NOT_FOUND: exact CHANNEL_VIDEO_RELEASE run'; end if;
  select * into v_workflow from channelwright.workflows
    where id = p_workflow_id and owner_id = v_run.owner_id and workflow_type = 'CHANNEL_VIDEO_RELEASE';
  if not found then raise exception 'NOT_FOUND: exact CHANNEL_VIDEO_RELEASE workflow'; end if;
  if v_role <> 'service_role' and (auth.uid() is null or auth.uid() <> v_run.owner_id) then
    raise exception 'NOT_FOUND: exact CHANNEL_VIDEO_RELEASE run';
  end if;

  if v_run.status <> 'COMPLETED' or v_run.output_payload is null then
    raise exception 'UPSTREAM_RELEASE_NOT_FINAL: the video release must be completed and final';
  end if;

  select * into v_approval from channelwright.workflow_approvals
    where workflow_run_id = v_run.id and owner_id = v_run.owner_id and status = 'APPROVED'
      and decided_by = v_run.owner_id and decided_at is not null;
  if not found then raise exception 'UPSTREAM_RELEASE_NOT_APPROVED: exact video-release run is not human approved'; end if;

  select output_payload into v_finalizer from channelwright.workflow_steps
    where workflow_run_id = v_run.id and step_key = 'finalize-video-release' and status = 'COMPLETED';
  select output_payload into v_final_qa from channelwright.workflow_steps
    where workflow_run_id = v_run.id and step_key = 'final-video-release-qa' and status = 'COMPLETED';
  -- validate-approved-packaging is the release's provenance step: it carries the
  -- exact upstream video-packaging reference and the discovery evidence bundle
  -- every downstream claim must cite.
  select output_payload into v_provenance from channelwright.workflow_steps
    where workflow_run_id = v_run.id and step_key = 'validate-approved-packaging' and status = 'COMPLETED';

  if v_finalizer is null or v_finalizer is distinct from v_run.output_payload then
    raise exception 'UPSTREAM_RELEASE_INTEGRITY_MISMATCH: final output disagreement';
  end if;
  if v_final_qa is null
    or coalesce((v_final_qa->'qa'->>'passed')::boolean,false) is not true
    or v_final_qa->'qa'->>'recommendation' not in ('accept','human_review_required')
    or coalesce((v_final_qa->'qa'->>'score')::integer,-1) not between 0 and 100
  then raise exception 'UPSTREAM_RELEASE_QA_INVALID: final QA did not pass'; end if;
  if v_provenance is null or v_provenance->'reference' is null
    or jsonb_typeof(v_provenance->'discoveryBundle'->'evidence') <> 'array'
    or jsonb_array_length(v_provenance->'discoveryBundle'->'evidence') < 1
  then raise exception 'UPSTREAM_RELEASE_PROVENANCE_INVALID: discovery evidence is missing'; end if;
  -- The release artifact must still agree with the video-packaging reference it
  -- was built on, which itself already carries the approved
  -- script/brief/content/strategy/research chain.
  if v_run.output_payload->'upstreamVideoPackaging' is distinct from v_provenance->'reference' then
    raise exception 'UPSTREAM_RELEASE_INTEGRITY_MISMATCH: the release no longer agrees with its upstream packaging reference';
  end if;

  v_artifact_hash := encode(digest(v_run.output_payload::text, 'sha256'), 'hex');
  v_provenance_hash := encode(digest(v_provenance::text, 'sha256'), 'hex');
  if v_run.artifact_hash is null or v_run.provenance_hash is null
    or v_run.artifact_hash <> v_artifact_hash or v_run.provenance_hash <> v_provenance_hash then
    raise exception 'UPSTREAM_RELEASE_INTEGRITY_MISMATCH: stored integrity data does not match';
  end if;

  begin v_parent := nullif(v_run.context_payload->>'previousRunId','')::uuid;
  exception when invalid_text_representation then raise exception 'UPSTREAM_RELEASE_LINEAGE_INVALID'; end;
  select root_run_id into v_root from channelwright.research_run_budgets
    where workflow_run_id = v_run.id and owner_id = v_run.owner_id;
  v_root := coalesce(v_root, v_parent, v_run.id);

  v_topic_id := v_run.output_payload->'source'->>'packagingTopicId';
  v_pillar_id := v_run.output_payload->'source'->>'pillarId';
  v_promise := v_run.output_payload->'source'->>'releasePromise';
  v_final_title := v_run.output_payload->'reconciledMetadata'->>'finalTitle';
  -- The exact strategy identity carried transitively through the whole chain.
  -- Every KPI/hypothesis outcome and the strategy-revisit signal must anchor to
  -- it.
  v_strategy_run_id := v_run.output_payload
    #>> '{upstreamVideoPackaging,upstreamVideoScript,upstreamVideoBrief,upstreamContentIntelligence,upstreamStrategy,strategyRunId}';
  if v_topic_id is null or v_pillar_id is null or v_promise is null or v_final_title is null or v_strategy_run_id is null then
    raise exception 'UPSTREAM_RELEASE_INTEGRITY_MISMATCH: the release carries no scope, promise, title, or strategy identity';
  end if;

  -- The release's bound KPI/hypothesis set, projected to identity only. The
  -- measurement must adjudicate exactly this set, once each. Original order is
  -- preserved.
  select jsonb_agg(jsonb_build_object(
    'metric', b.value->>'metric',
    'label', b.value->>'label',
    'hypothesis', b.value->>'hypothesis',
    'strategyRunId', b.value->>'strategyRunId'
  ) order by b.ord)
    into v_kpi_bindings
    from jsonb_array_elements(v_run.output_payload->'kpiHypothesisBindings') with ordinality b(value, ord);
  if v_kpi_bindings is null or jsonb_array_length(v_kpi_bindings) < 1 then
    raise exception 'UPSTREAM_RELEASE_INTEGRITY_MISMATCH: the release bound no KPI/hypothesis';
  end if;

  -- Viewer Value eligibility. A release that did not pass its own gate is not
  -- eligible to be measured.
  v_gate := v_run.output_payload->'viewerValue'->>'gate';
  if v_gate is distinct from 'PASS' then
    raise exception 'UPSTREAM_RELEASE_VIEWER_VALUE_NOT_ELIGIBLE: the approved release did not pass the Viewer Value gate';
  end if;

  return jsonb_build_object(
    'reference', jsonb_build_object(
      'releaseWorkflowId', v_workflow.id,
      'releaseRunId', v_run.id,
      'workflowDefinitionVersion', v_run.definition_version,
      'outputSchemaVersion', (v_run.output_payload->>'schemaVersion')::integer,
      'approvalId', v_approval.id,
      'approvedBy', v_approval.decided_by,
      'approvedAt', to_char(v_approval.decided_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'finalQaState', v_final_qa->'qa'->>'recommendation',
      'finalQaScore', (v_final_qa->'qa'->>'score')::integer,
      'releaseArtifactHash', v_artifact_hash,
      'releaseProvenanceHash', v_provenance_hash,
      'parentRunId', v_parent,
      'rootRunId', v_root,
      'upstreamVideoPackaging', v_run.output_payload->'upstreamVideoPackaging'
    ),
    'releaseResult', v_run.output_payload,
    'discoveryBundle', v_provenance->'discoveryBundle',
    'scope', jsonb_build_object(
      'releaseTopicId', v_topic_id,
      'pillarId', v_pillar_id,
      'releasePromise', v_promise,
      'finalTitle', v_final_title,
      'strategyRunId', v_strategy_run_id,
      'kpiBindings', v_kpi_bindings,
      -- Viewer Value provenance is derived from authoritative upstream state,
      -- never accepted from a caller. The contract hash is canonical over the
      -- release's own viewer-value contract, so a measurement that quietly
      -- changes the promise no longer matches its source.
      'inheritedViewerValueProvenance', jsonb_build_object(
        'originStage', 'RELEASE',
        'originWorkflowType', 'CHANNEL_VIDEO_RELEASE',
        'originRunId', v_run.id,
        'subjectId', v_topic_id,
        'contractHash', encode(digest(channelwright.canonical_jsonb_text(v_run.output_payload->'viewerValue'->'contract'), 'sha256'), 'hex'),
        'gate', v_gate,
        'assessedAt', to_char(v_approval.decided_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- Canonical graph registration, input validation, and concurrency guards.
--
-- Reproduced from 202608180001 with the added CHANNEL_VIDEO_PERFORMANCE branch:
-- the earlier branches, the idempotency and advisory-lock behaviour, and the
-- step-insertion loop are load-bearing for every workflow and must not drift.
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
  v_upstream_run text;
  v_upstream_topic text;
  v_constraint text;
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  if char_length(p_idempotency_key) not between 1 and 300 or p_input_hash !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION_ERROR: invalid idempotency input'; end if;
  if not (p_definition_version = 1 and p_workflow_type in ('CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE')) then raise exception 'WORKFLOW_TYPE_INVALID: unsupported workflow definition'; end if;
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
    -- Only identifiers plus the operator snapshot are accepted. The browser can
    -- never submit a release object, a provenance hash, or any QA state: those
    -- are resolved from authoritative database state below. The snapshot's
    -- internal structure is validated by the application schema and re-checked by
    -- deterministic QA; here it is guarded for shape and identity only.
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
-- Finalizer promotion for the eighth paid workflow type.
--
-- Reproduced verbatim from 202608180001 apart from the added
-- CHANNEL_VIDEO_PERFORMANCE finalizer case: the service-role guard,
-- idempotent-replay path, lease and attempt checks, and the context_payload write
-- that feeds priorOutputs are all load-bearing for every workflow and must not
-- drift.
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
-- Approval, revision lineage, and provenance hashing extend to the video
-- performance record. The performance record's provenance step is
-- validate-approved-release: it carries the exact upstream release, the resolved
-- scope, and the discovery bundle every downstream claim must cite. A
-- human-requested revision preserves the original run, the pinned upstream
-- reference, the operator snapshot, and root lineage.
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
  if v_old_run.workflow_type in ('CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE') and v_old_run.output_payload is not null then
    v_provenance_step := case v_old_run.workflow_type
      when 'CHANNEL_RESEARCH' then 'retrieve-youtube-evidence'
      when 'CHANNEL_STRATEGY' then 'validate-approved-research'
      when 'CHANNEL_VIDEO_BRIEF' then 'validate-approved-content'
      when 'CHANNEL_VIDEO_SCRIPT' then 'validate-approved-brief'
      when 'CHANNEL_VIDEO_PACKAGING' then 'validate-approved-script'
      when 'CHANNEL_VIDEO_RELEASE' then 'validate-approved-packaging'
      when 'CHANNEL_VIDEO_PERFORMANCE' then 'validate-approved-release'
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
      values(v_owner,p_workflow_id,v_new_run_id,'WORKFLOW_REVISION_QUEUED','USER',v_owner::text,jsonb_build_object('previousRunId',v_old_run.id,'upstreamResearchRunId',v_old_run.input_payload->'approvedResearchReference'->>'researchRunId','upstreamStrategyRunId',v_old_run.input_payload->'approvedStrategyReference'->>'strategyRunId','upstreamContentRunId',v_old_run.input_payload->'approvedContentReference'->>'contentRunId','upstreamBriefRunId',v_old_run.input_payload->'approvedVideoBriefReference'->>'briefRunId','upstreamScriptRunId',v_old_run.input_payload->'approvedVideoScriptReference'->>'scriptRunId','upstreamPackagingRunId',v_old_run.input_payload->'approvedVideoPackagingReference'->>'packagingRunId','upstreamReleaseRunId',v_old_run.input_payload->'approvedVideoReleaseReference'->>'releaseRunId','selectedTopicId',v_old_run.input_payload->>'selectedTopicId'));
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
-- Durable accounting accepts the eighth paid workflow type. Ceilings unchanged.
--
-- CHANNEL_VIDEO_PERFORMANCE joins CHANNEL_STRATEGY, CHANNEL_VIDEO_BRIEF,
-- CHANNEL_VIDEO_SCRIPT, CHANNEL_VIDEO_PACKAGING, and CHANNEL_VIDEO_RELEASE as a
-- workflow that performs no external retrieval, so it is required to declare
-- exactly zero provider requests, quota units, and searches. Model-call and token
-- ceilings are unchanged from 202608130004.
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
begin
  if session_user<>'postgres' and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'NOT_ALLOWED: workflow accounting requires service role'; end if;
  perform channelwright.assert_research_usage_shape(p_limits,false);
  select * into v_run from channelwright.workflow_runs where id=p_run_id and workflow_type in ('CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE');
  if not found then raise exception 'NOT_FOUND: paid workflow run'; end if;
  v_no_retrieval := v_run.workflow_type in ('CHANNEL_STRATEGY','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT','CHANNEL_VIDEO_PACKAGING','CHANNEL_VIDEO_RELEASE','CHANNEL_VIDEO_PERFORMANCE');
  if jsonb_object_length(p_limits)<>10
    or channelwright.research_usage_value(p_limits,'providerRequests') not between (case when v_no_retrieval then 0 else 1 end) and 36
    or channelwright.research_usage_value(p_limits,'providerQuotaUnits') not between (case when v_no_retrieval then 0 else 1 end) and 1200
    or channelwright.research_usage_value(p_limits,'searches') not between (case when v_no_retrieval then 0 else 1 end) and 12
    or channelwright.research_usage_value(p_limits,'synthesisCalls') not between 1 and 6
    or channelwright.research_usage_value(p_limits,'qaCalls') not between 1 and 12
    or channelwright.research_usage_value(p_limits,'revisionCalls') not between 1 and 4
    or channelwright.research_usage_value(p_limits,'inputTokens') not between 1000 and 1000000
    or channelwright.research_usage_value(p_limits,'outputTokens') not between 1000 and 100000
    or channelwright.research_usage_value(p_limits,'totalTokens') not between 2000 and 1100000
    or channelwright.research_usage_value(p_limits,'automatedRevisions')<>1
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

revoke all on function channelwright.resolve_approved_video_release_artifact(uuid,uuid) from public,anon;
grant execute on function channelwright.resolve_approved_video_release_artifact(uuid,uuid) to authenticated,service_role;
revoke all on function channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb) from public, anon;
grant execute on function channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb) to authenticated;
revoke all on function channelwright.complete_workflow_step(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function channelwright.complete_workflow_step(uuid,uuid,jsonb) to service_role;
revoke all on function channelwright.decide_workflow_approval(uuid,uuid,text,text) from public, anon;
grant execute on function channelwright.decide_workflow_approval(uuid,uuid,text,text) to authenticated;
revoke all on function channelwright.ensure_research_run_budget(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function channelwright.ensure_research_run_budget(uuid,uuid,uuid,text,jsonb) to service_role;
