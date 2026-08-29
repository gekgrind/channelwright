-- Production-grade CHANNEL_STRATEGY vertical slice. This migration is additive and
-- extends the existing workflow, approval, lease, lineage, and usage-accounting spine.

alter table channelwright.workflows drop constraint if exists workflows_workflow_type_check;
alter table channelwright.workflows add constraint workflows_workflow_type_check
  check (workflow_type in ('CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH','CHANNEL_STRATEGY'));

alter table channelwright.workflow_runs drop constraint if exists workflow_runs_workflow_type_check;
alter table channelwright.workflow_runs add constraint workflow_runs_workflow_type_check
  check (workflow_type in ('CHANNEL','VIDEO','CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH','CHANNEL_STRATEGY'));

alter table channelwright.workflow_runs
  add column artifact_hash text check (artifact_hash is null or artifact_hash ~ '^[a-f0-9]{64}$'),
  add column provenance_hash text check (provenance_hash is null or provenance_hash ~ '^[a-f0-9]{64}$');

-- pgcrypto lives in the `extensions` schema on Supabase. This top-level backfill
-- runs at migration apply time (not inside a plpgsql body), so its digest() calls
-- are resolved when the statement is planned, using the migration session's
-- search_path. On a clean cluster where `extensions` is not on that path, bare
-- digest() fails with "function digest(text, unknown) does not exist" and aborts
-- the whole chain. A later forward migration cannot repair an apply-time failure
-- here, so — matching every other DML digest() call in the chain — it is
-- schema-qualified. This changes only name resolution, not the hashes produced.
update channelwright.workflow_runs r set
  artifact_hash = encode(extensions.digest(r.output_payload::text, 'sha256'), 'hex'),
  provenance_hash = encode(extensions.digest(e.output_payload::text, 'sha256'), 'hex')
from channelwright.workflow_steps e
where r.workflow_type = 'CHANNEL_RESEARCH'
  and e.workflow_run_id = r.id and e.step_key = 'retrieve-youtube-evidence'
  and r.output_payload is not null and e.output_payload is not null
  and exists (select 1 from channelwright.workflow_approvals a where a.workflow_run_id = r.id and a.status in ('APPROVED','REJECTED','REVISION_REQUESTED'));

create or replace function channelwright.resolve_approved_research_artifact(p_workflow_id uuid, p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare
  v_run channelwright.workflow_runs%rowtype;
  v_workflow channelwright.workflows%rowtype;
  v_approval channelwright.workflow_approvals%rowtype;
  v_finalizer jsonb;
  v_final_qa jsonb;
  v_evidence jsonb;
  v_parent uuid;
  v_root uuid;
  v_artifact_hash text;
  v_provenance_hash text;
  v_role text := coalesce(auth.jwt()->>'role','');
begin
  select * into v_run from channelwright.workflow_runs where id = p_run_id and workflow_id = p_workflow_id and workflow_type = 'CHANNEL_RESEARCH';
  if not found then raise exception 'NOT_FOUND: exact CHANNEL_RESEARCH run'; end if;
  select * into v_workflow from channelwright.workflows where id = p_workflow_id and owner_id = v_run.owner_id and workflow_type = 'CHANNEL_RESEARCH';
  if not found then raise exception 'NOT_FOUND: exact CHANNEL_RESEARCH workflow'; end if;
  if v_role <> 'service_role' and (auth.uid() is null or auth.uid() <> v_run.owner_id) then raise exception 'NOT_FOUND: exact CHANNEL_RESEARCH run'; end if;
  if v_run.status <> 'COMPLETED' or v_run.output_payload is null then raise exception 'UPSTREAM_RESEARCH_NOT_FINAL: research must be completed and final'; end if;
  select * into v_approval from channelwright.workflow_approvals
    where workflow_run_id = v_run.id and owner_id = v_run.owner_id and status = 'APPROVED' and decided_by = v_run.owner_id and decided_at is not null;
  if not found then raise exception 'UPSTREAM_RESEARCH_NOT_APPROVED: exact research run is not human approved'; end if;
  select output_payload into v_finalizer from channelwright.workflow_steps where workflow_run_id = v_run.id and step_key = 'synthesize-validation' and status = 'COMPLETED';
  select output_payload into v_final_qa from channelwright.workflow_steps where workflow_run_id = v_run.id and step_key = 'final-qa' and status = 'COMPLETED';
  select output_payload into v_evidence from channelwright.workflow_steps where workflow_run_id = v_run.id and step_key = 'retrieve-youtube-evidence' and status = 'COMPLETED';
  if v_finalizer is null or v_finalizer is distinct from v_run.output_payload then raise exception 'UPSTREAM_RESEARCH_INTEGRITY_MISMATCH: final output disagreement'; end if;
  if v_final_qa is null or coalesce((v_final_qa->>'passed')::boolean,false) is not true or v_final_qa->>'recommendation' not in ('accept','human_review_required')
    or coalesce((v_final_qa->>'score')::integer,-1) not between 0 and 100 then raise exception 'UPSTREAM_RESEARCH_QA_INVALID: final QA did not pass'; end if;
  if v_evidence is null or jsonb_typeof(v_evidence->'evidence') <> 'array' or jsonb_array_length(v_evidence->'evidence') < 1 then raise exception 'UPSTREAM_RESEARCH_PROVENANCE_INVALID: evidence is missing'; end if;
  v_artifact_hash := encode(digest(v_run.output_payload::text, 'sha256'), 'hex');
  v_provenance_hash := encode(digest(v_evidence::text, 'sha256'), 'hex');
  if v_run.artifact_hash is null or v_run.provenance_hash is null or v_run.artifact_hash <> v_artifact_hash or v_run.provenance_hash <> v_provenance_hash then
    raise exception 'UPSTREAM_RESEARCH_INTEGRITY_MISMATCH: stored integrity data does not match';
  end if;
  begin v_parent := nullif(v_run.context_payload->>'previousRunId','')::uuid; exception when invalid_text_representation then raise exception 'UPSTREAM_RESEARCH_LINEAGE_INVALID'; end;
  select root_run_id into v_root from channelwright.research_run_budgets where workflow_run_id = v_run.id and owner_id = v_run.owner_id;
  v_root := coalesce(v_root, v_parent, v_run.id);
  return jsonb_build_object(
    'reference', jsonb_build_object(
      'researchWorkflowId', v_workflow.id,
      'researchRunId', v_run.id,
      'workflowDefinitionVersion', v_run.definition_version,
      'outputSchemaVersion', (v_run.output_payload->>'schemaVersion')::integer,
      'approvalId', v_approval.id,
      'approvedBy', v_approval.decided_by,
      'approvedAt', to_char(v_approval.decided_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'finalQaState', v_final_qa->>'recommendation',
      'finalQaScore', (v_final_qa->>'score')::integer,
      'researchArtifactHash', v_artifact_hash,
      'evidenceProvenanceHash', v_provenance_hash,
      'parentRunId', v_parent,
      'rootRunId', v_root
    ),
    'researchResult', v_run.output_payload,
    'evidenceBundle', v_evidence
  );
end $$;

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
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  if char_length(p_idempotency_key) not between 1 and 300 or p_input_hash !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION_ERROR: invalid idempotency input'; end if;
  if not (p_definition_version = 1 and p_workflow_type in ('CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH','CHANNEL_STRATEGY')) then raise exception 'WORKFLOW_TYPE_INVALID: unsupported workflow definition'; end if;
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

  insert into channelwright.workflows(owner_id,workflow_type,definition_version,objective,status)
    values(v_owner,p_workflow_type,p_definition_version,left(p_objective,1000),'QUEUED') returning id into v_workflow_id;
  insert into channelwright.workflow_runs(owner_id,workflow_id,workflow_type,definition_version,status,idempotency_key,input_hash,input_payload)
    values(v_owner,v_workflow_id,p_workflow_type,p_definition_version,'QUEUED',p_idempotency_key,p_input_hash,v_persisted_input) returning id into v_run_id;
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

create or replace function channelwright.decide_workflow_approval(p_workflow_id uuid,p_approval_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=channelwright,pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_approval channelwright.workflow_approvals%rowtype;
  v_old_run channelwright.workflow_runs%rowtype;
  v_old_step channelwright.workflow_steps%rowtype;
  v_run_status text;
  v_result_run_id uuid;
  v_new_run_id uuid;
  v_provenance jsonb;
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  if p_decision not in ('APPROVE','REJECT','REQUEST_REVISION') or char_length(coalesce(p_note,''))>2000 or (p_decision='REQUEST_REVISION' and char_length(coalesce(p_note,''))=0) then raise exception 'VALIDATION_ERROR: invalid approval decision'; end if;
  select * into v_approval from channelwright.workflow_approvals where id=p_approval_id and workflow_id=p_workflow_id and owner_id=v_owner for update;
  if not found then raise exception 'NOT_FOUND: workflow approval'; end if;
  if v_approval.status<>'PENDING' then raise exception 'INVALID_TRANSITION: approval is already final'; end if;
  select * into v_old_run from channelwright.workflow_runs where id=v_approval.workflow_run_id and owner_id=v_owner for update;
  v_result_run_id := v_old_run.id;
  if v_old_run.workflow_type in ('CHANNEL_RESEARCH','CHANNEL_STRATEGY') and v_old_run.output_payload is not null then
    select output_payload into v_provenance from channelwright.workflow_steps where workflow_run_id=v_old_run.id and step_key=case when v_old_run.workflow_type='CHANNEL_RESEARCH' then 'retrieve-youtube-evidence' else 'validate-approved-research' end;
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
      values(v_owner,p_workflow_id,v_new_run_id,'WORKFLOW_REVISION_QUEUED','USER',v_owner::text,jsonb_build_object('previousRunId',v_old_run.id,'upstreamResearchRunId',v_old_run.input_payload->'approvedResearchReference'->>'researchRunId'));
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

create or replace function channelwright.ensure_research_run_budget(p_run_id uuid,p_step_id uuid,p_lease_token uuid,p_operation_key text,p_limits jsonb)
returns jsonb language plpgsql security definer set search_path=channelwright,pg_temp as $$
declare
  v_run channelwright.workflow_runs%rowtype;
  v_step channelwright.workflow_steps%rowtype;
  v_attempt channelwright.workflow_step_attempts%rowtype;
  v_parent uuid;
  v_root uuid;
  v_inserted integer;
  v_is_strategy boolean;
begin
  if session_user<>'postgres' and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'NOT_ALLOWED: workflow accounting requires service role'; end if;
  perform channelwright.assert_research_usage_shape(p_limits,false);
  select * into v_run from channelwright.workflow_runs where id=p_run_id and workflow_type in ('CHANNEL_RESEARCH','CHANNEL_STRATEGY');
  if not found then raise exception 'NOT_FOUND: paid workflow run'; end if;
  v_is_strategy := v_run.workflow_type='CHANNEL_STRATEGY';
  if jsonb_object_length(p_limits)<>10
    or channelwright.research_usage_value(p_limits,'providerRequests') not between (case when v_is_strategy then 0 else 1 end) and 36
    or channelwright.research_usage_value(p_limits,'providerQuotaUnits') not between (case when v_is_strategy then 0 else 1 end) and 1200
    or channelwright.research_usage_value(p_limits,'searches') not between (case when v_is_strategy then 0 else 1 end) and 12
    or channelwright.research_usage_value(p_limits,'synthesisCalls') not between 1 and 6
    or channelwright.research_usage_value(p_limits,'qaCalls') not between 1 and 12
    or channelwright.research_usage_value(p_limits,'revisionCalls') not between 1 and 4
    or channelwright.research_usage_value(p_limits,'inputTokens') not between 1000 and 1000000
    or channelwright.research_usage_value(p_limits,'outputTokens') not between 1000 and 100000
    or channelwright.research_usage_value(p_limits,'totalTokens') not between 2000 and 1100000
    or channelwright.research_usage_value(p_limits,'automatedRevisions')<>1
    or (v_is_strategy and (channelwright.research_usage_value(p_limits,'providerRequests')<>0 or channelwright.research_usage_value(p_limits,'providerQuotaUnits')<>0 or channelwright.research_usage_value(p_limits,'searches')<>0))
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

create or replace function channelwright.protect_final_research_artifact()
returns trigger language plpgsql set search_path=channelwright,pg_temp as $$
begin
  if old.workflow_type in ('CHANNEL_RESEARCH','CHANNEL_STRATEGY')
    and exists(select 1 from channelwright.workflow_approvals a where a.workflow_run_id=old.id and a.status in ('APPROVED','REJECTED','REVISION_REQUESTED'))
    and (new.input_payload is distinct from old.input_payload or new.context_payload is distinct from old.context_payload
      or new.output_payload is distinct from old.output_payload or new.input_hash is distinct from old.input_hash
      or new.workflow_type is distinct from old.workflow_type or new.definition_version is distinct from old.definition_version
      or new.artifact_hash is distinct from old.artifact_hash or new.provenance_hash is distinct from old.provenance_hash)
  then raise exception 'APPROVED_ARTIFACT_IMMUTABLE: finalized paid-workflow content cannot be mutated'; end if;
  return new;
end $$;

create or replace function channelwright.protect_final_research_step_output()
returns trigger language plpgsql set search_path=channelwright,pg_temp as $$
begin
  if new.output_payload is distinct from old.output_payload and exists(
    select 1 from channelwright.workflow_runs r join channelwright.workflow_approvals a on a.workflow_run_id=r.id
    where r.id=old.workflow_run_id and r.workflow_type in ('CHANNEL_RESEARCH','CHANNEL_STRATEGY') and a.status in ('APPROVED','REJECTED','REVISION_REQUESTED'))
  then raise exception 'APPROVED_ARTIFACT_IMMUTABLE: finalized paid-workflow step output cannot be mutated'; end if;
  return new;
end $$;

create or replace function channelwright.protect_final_workflow_approval()
returns trigger language plpgsql set search_path=channelwright,pg_temp as $$
begin
  if old.status in ('APPROVED','REJECTED','REVISION_REQUESTED') and (new.status is distinct from old.status or new.request_payload is distinct from old.request_payload
    or new.decision_note is distinct from old.decision_note or new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at)
  then raise exception 'APPROVED_ARTIFACT_IMMUTABLE: final approval record cannot be mutated'; end if;
  return new;
end $$;

create trigger workflow_approvals_protect_final before update on channelwright.workflow_approvals
  for each row execute function channelwright.protect_final_workflow_approval();

revoke all on function channelwright.resolve_approved_research_artifact(uuid,uuid) from public,anon;
grant execute on function channelwright.resolve_approved_research_artifact(uuid,uuid) to authenticated,service_role;
revoke all on function channelwright.protect_final_workflow_approval() from public,anon,authenticated;
