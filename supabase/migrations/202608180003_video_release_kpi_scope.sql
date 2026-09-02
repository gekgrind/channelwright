-- CHANNEL_VIDEO_RELEASE repair: thread the approved upstream strategy's KPI
-- framework into the resolved release scope.
--
-- Forward-only and additive. It re-`create or replace`s exactly one function,
-- channelwright.resolve_approved_video_packaging_artifact, reproducing its prior
-- body verbatim plus one addition: the resolver now reads the metrics the
-- upstream CHANNEL_STRATEGY run adopted in its KPI framework and returns them as
-- scope.strategyKpiMetrics. Deterministic release QA rejects a KPI/hypothesis
-- binding whose metric is not a member of that set, exactly as a title or
-- thumbnail selection must be a member of the candidate id sets.
--
-- The strategy run is read owner-scoped and workflow-type-scoped directly; its
-- own final-artifact immutability trigger already protects that payload, and the
-- full chain-integrity resolve was performed when packaging was produced. No
-- table, constraint, index, trigger, grant, or ceiling changes. `public` stays
-- excluded; `extensions` remains on the path because the body still calls
-- digest().

create or replace function channelwright.resolve_approved_video_packaging_artifact(
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
  v_title_ids jsonb;
  v_thumb_ids jsonb;
  v_strategy_run_id uuid;
  v_kpi_metrics jsonb;
  v_gate text;
  v_role text := coalesce(auth.jwt()->>'role','');
begin
  select * into v_run from channelwright.workflow_runs
    where id = p_run_id and workflow_id = p_workflow_id and workflow_type = 'CHANNEL_VIDEO_PACKAGING';
  if not found then raise exception 'NOT_FOUND: exact CHANNEL_VIDEO_PACKAGING run'; end if;
  select * into v_workflow from channelwright.workflows
    where id = p_workflow_id and owner_id = v_run.owner_id and workflow_type = 'CHANNEL_VIDEO_PACKAGING';
  if not found then raise exception 'NOT_FOUND: exact CHANNEL_VIDEO_PACKAGING workflow'; end if;
  if v_role <> 'service_role' and (auth.uid() is null or auth.uid() <> v_run.owner_id) then
    raise exception 'NOT_FOUND: exact CHANNEL_VIDEO_PACKAGING run';
  end if;

  if v_run.status <> 'COMPLETED' or v_run.output_payload is null then
    raise exception 'UPSTREAM_PACKAGING_NOT_FINAL: the video packaging must be completed and final';
  end if;

  select * into v_approval from channelwright.workflow_approvals
    where workflow_run_id = v_run.id and owner_id = v_run.owner_id and status = 'APPROVED'
      and decided_by = v_run.owner_id and decided_at is not null;
  if not found then raise exception 'UPSTREAM_PACKAGING_NOT_APPROVED: exact video-packaging run is not human approved'; end if;

  select output_payload into v_finalizer from channelwright.workflow_steps
    where workflow_run_id = v_run.id and step_key = 'finalize-video-packaging' and status = 'COMPLETED';
  select output_payload into v_final_qa from channelwright.workflow_steps
    where workflow_run_id = v_run.id and step_key = 'final-video-packaging-qa' and status = 'COMPLETED';
  -- validate-approved-script is the packaging's provenance step: it carries the
  -- exact upstream video-script reference and the discovery evidence bundle every
  -- downstream claim must cite.
  select output_payload into v_provenance from channelwright.workflow_steps
    where workflow_run_id = v_run.id and step_key = 'validate-approved-script' and status = 'COMPLETED';

  if v_finalizer is null or v_finalizer is distinct from v_run.output_payload then
    raise exception 'UPSTREAM_PACKAGING_INTEGRITY_MISMATCH: final output disagreement';
  end if;
  if v_final_qa is null
    or coalesce((v_final_qa->'qa'->>'passed')::boolean,false) is not true
    or v_final_qa->'qa'->>'recommendation' not in ('accept','human_review_required')
    or coalesce((v_final_qa->'qa'->>'score')::integer,-1) not between 0 and 100
  then raise exception 'UPSTREAM_PACKAGING_QA_INVALID: final QA did not pass'; end if;
  if v_provenance is null or v_provenance->'reference' is null
    or jsonb_typeof(v_provenance->'discoveryBundle'->'evidence') <> 'array'
    or jsonb_array_length(v_provenance->'discoveryBundle'->'evidence') < 1
  then raise exception 'UPSTREAM_PACKAGING_PROVENANCE_INVALID: discovery evidence is missing'; end if;
  -- The packaging artifact must still agree with the video-script reference it was
  -- built on, which itself already carries the approved
  -- brief/content/strategy/research chain.
  if v_run.output_payload->'upstreamVideoScript' is distinct from v_provenance->'reference' then
    raise exception 'UPSTREAM_PACKAGING_INTEGRITY_MISMATCH: the packaging no longer agrees with its upstream script reference';
  end if;

  v_artifact_hash := encode(digest(v_run.output_payload::text, 'sha256'), 'hex');
  v_provenance_hash := encode(digest(v_provenance::text, 'sha256'), 'hex');
  if v_run.artifact_hash is null or v_run.provenance_hash is null
    or v_run.artifact_hash <> v_artifact_hash or v_run.provenance_hash <> v_provenance_hash then
    raise exception 'UPSTREAM_PACKAGING_INTEGRITY_MISMATCH: stored integrity data does not match';
  end if;

  begin v_parent := nullif(v_run.context_payload->>'previousRunId','')::uuid;
  exception when invalid_text_representation then raise exception 'UPSTREAM_PACKAGING_LINEAGE_INVALID'; end;
  select root_run_id into v_root from channelwright.research_run_budgets
    where workflow_run_id = v_run.id and owner_id = v_run.owner_id;
  v_root := coalesce(v_root, v_parent, v_run.id);

  v_topic_id := v_run.output_payload->'packagingScope'->>'scriptTopicId';
  v_pillar_id := v_run.output_payload->'packagingScope'->>'pillarId';
  v_promise := v_run.output_payload->'source'->>'packagedPromise';
  if v_topic_id is null or v_pillar_id is null or v_promise is null then
    raise exception 'UPSTREAM_PACKAGING_INTEGRITY_MISMATCH: the packaging carries no scope or promise identity';
  end if;

  -- The authoritative selectable candidate/concept identity the release must
  -- choose from. A release can never select a title or thumbnail that is not a
  -- member of these sets.
  select jsonb_agg(t->>'candidateId' order by t->>'candidateId')
    into v_title_ids from jsonb_array_elements(v_run.output_payload->'titleCandidates') t;
  select jsonb_agg(c->>'conceptId' order by c->>'conceptId')
    into v_thumb_ids from jsonb_array_elements(v_run.output_payload->'thumbnailConcepts') c;
  if v_title_ids is null or v_thumb_ids is null then
    raise exception 'UPSTREAM_PACKAGING_INTEGRITY_MISMATCH: the packaging carries no title candidates or thumbnail concepts';
  end if;

  -- The KPI framework the approved upstream strategy actually adopted. The
  -- strategy identity is carried transitively in the packaging's own
  -- upstream-video-script reference; the strategy run's payload is read
  -- owner-scoped and type-scoped, and its final-artifact immutability trigger
  -- already protects it. A release may bind a KPI/hypothesis only to a metric in
  -- this set.
  begin
    v_strategy_run_id := (v_run.output_payload #>> '{upstreamVideoScript,upstreamVideoBrief,upstreamContentIntelligence,upstreamStrategy,strategyRunId}')::uuid;
  exception when invalid_text_representation then
    raise exception 'UPSTREAM_PACKAGING_LINEAGE_INVALID: the packaging carries no upstream strategy identity';
  end;
  if v_strategy_run_id is null then
    raise exception 'UPSTREAM_PACKAGING_LINEAGE_INVALID: the packaging carries no upstream strategy identity';
  end if;

  select jsonb_agg(distinct k.item->>'metric' order by k.item->>'metric')
    into v_kpi_metrics
    from channelwright.workflow_runs v_strategy
    cross join lateral jsonb_array_elements(v_strategy.output_payload->'kpiFramework') k(item)
    where v_strategy.id = v_strategy_run_id
      and v_strategy.owner_id = v_run.owner_id
      and v_strategy.workflow_type = 'CHANNEL_STRATEGY'
      and v_strategy.status = 'COMPLETED';
  if v_kpi_metrics is null or jsonb_array_length(v_kpi_metrics) < 1 then
    raise exception 'UPSTREAM_PACKAGING_INTEGRITY_MISMATCH: the upstream strategy KPI framework could not be resolved';
  end if;

  -- Viewer Value eligibility. A packaging that did not pass its own gate is not
  -- eligible to be released.
  v_gate := v_run.output_payload->'viewerValue'->>'gate';
  if v_gate is distinct from 'PASS' then
    raise exception 'UPSTREAM_PACKAGING_VIEWER_VALUE_NOT_ELIGIBLE: the approved packaging did not pass the Viewer Value gate';
  end if;

  return jsonb_build_object(
    'reference', jsonb_build_object(
      'packagingWorkflowId', v_workflow.id,
      'packagingRunId', v_run.id,
      'workflowDefinitionVersion', v_run.definition_version,
      'outputSchemaVersion', (v_run.output_payload->>'schemaVersion')::integer,
      'approvalId', v_approval.id,
      'approvedBy', v_approval.decided_by,
      'approvedAt', to_char(v_approval.decided_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'finalQaState', v_final_qa->'qa'->>'recommendation',
      'finalQaScore', (v_final_qa->'qa'->>'score')::integer,
      'packagingArtifactHash', v_artifact_hash,
      'packagingProvenanceHash', v_provenance_hash,
      'parentRunId', v_parent,
      'rootRunId', v_root,
      'upstreamVideoScript', v_run.output_payload->'upstreamVideoScript'
    ),
    'packagingResult', v_run.output_payload,
    'discoveryBundle', v_provenance->'discoveryBundle',
    'scope', jsonb_build_object(
      'packagingTopicId', v_topic_id,
      'pillarId', v_pillar_id,
      'packagedPromise', v_promise,
      'titleCandidateIds', v_title_ids,
      'thumbnailConceptIds', v_thumb_ids,
      'strategyKpiMetrics', v_kpi_metrics,
      -- Viewer Value provenance is derived from authoritative upstream state,
      -- never accepted from a caller. The contract hash is canonical over the
      -- packaging's own viewer-value contract, so a release that quietly changes
      -- the promise no longer matches its source.
      'inheritedViewerValueProvenance', jsonb_build_object(
        'originStage', 'PACKAGING',
        'originWorkflowType', 'CHANNEL_VIDEO_PACKAGING',
        'originRunId', v_run.id,
        'subjectId', v_topic_id,
        'contractHash', encode(digest(channelwright.canonical_jsonb_text(v_run.output_payload->'viewerValue'->'contract'), 'sha256'), 'hex'),
        'gate', v_gate,
        'assessedAt', to_char(v_approval.decided_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    )
  );
end $$;

revoke all on function channelwright.resolve_approved_video_packaging_artifact(uuid,uuid) from public,anon;
grant execute on function channelwright.resolve_approved_video_packaging_artifact(uuid,uuid) to authenticated,service_role;
