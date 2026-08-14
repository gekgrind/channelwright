-- Provider-backed, owner-scoped CHANNEL_RESEARCH vertical slice.

alter table channelwright.workflows drop constraint if exists workflows_workflow_type_check;
alter table channelwright.workflows add constraint workflows_workflow_type_check
  check (workflow_type in ('CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH'));

alter table channelwright.workflow_runs drop constraint if exists workflow_runs_workflow_type_check;
alter table channelwright.workflow_runs add constraint workflow_runs_workflow_type_check
  check (workflow_type in ('CHANNEL','VIDEO','CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH'));

alter table channelwright.workflow_approvals drop constraint if exists workflow_approvals_status_check;
alter table channelwright.workflow_approvals add constraint workflow_approvals_status_check
  check (status in ('PENDING','APPROVED','REJECTED','REVISION_REQUESTED'));

create table channelwright.research_evidence_cache (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  cache_key text not null check (cache_key ~ '^[a-f0-9]{64}$'),
  provider text not null check (provider = 'YOUTUBE_DATA_API_V3'),
  normalized_query text not null check (char_length(normalized_query) between 1 and 2000),
  request_parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(request_parameters) = 'object' and octet_length(request_parameters::text) <= 8192),
  evidence_payload jsonb not null check (jsonb_typeof(evidence_payload) = 'array' and jsonb_array_length(evidence_payload) between 1 and 100 and octet_length(evidence_payload::text) <= 131072),
  usage_payload jsonb not null check (jsonb_typeof(usage_payload) = 'object' and octet_length(usage_payload::text) <= 16384),
  retrieved_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > retrieved_at),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, cache_key),
  unique (id, owner_id)
);

create index research_evidence_cache_expiry_idx on channelwright.research_evidence_cache(owner_id, expires_at);
create trigger research_evidence_cache_set_updated_at before update on channelwright.research_evidence_cache
  for each row execute function channelwright.set_updated_at();
alter table channelwright.research_evidence_cache enable row level security;
create policy research_evidence_cache_owner_select on channelwright.research_evidence_cache
  for select to authenticated using (owner_id = auth.uid());
revoke insert, update, delete on channelwright.research_evidence_cache from authenticated;
grant select on channelwright.research_evidence_cache to authenticated;

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
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  if char_length(p_idempotency_key) not between 1 and 300 or p_input_hash !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION_ERROR: invalid idempotency input'; end if;
  if not (p_definition_version = 1 and p_workflow_type in ('CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH')) then raise exception 'WORKFLOW_TYPE_INVALID: unsupported workflow definition'; end if;
  if jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 32768 then raise exception 'PAYLOAD_TOO_LARGE: workflow input must be a bounded object'; end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) not between 1 and 50 then raise exception 'VALIDATION_ERROR: invalid workflow steps'; end if;
  if exists (select 1 from jsonb_array_elements(p_steps) item group by item->>'key' having count(*) > 1) then raise exception 'VALIDATION_ERROR: duplicate workflow step key'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_idempotency_key, 0));
  select * into v_existing from channelwright.workflow_runs where owner_id = v_owner and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.input_hash <> p_input_hash then raise exception 'IDEMPOTENCY_CONFLICT: key reused with different workflow input'; end if;
    return jsonb_build_object('workflowId', v_existing.workflow_id, 'runId', v_existing.id, 'status', v_existing.status, 'idempotentReplay', true);
  end if;

  insert into channelwright.workflows(owner_id, workflow_type, definition_version, objective, status)
    values (v_owner, p_workflow_type, p_definition_version, left(p_objective, 1000), 'QUEUED') returning id into v_workflow_id;
  insert into channelwright.workflow_runs(owner_id, workflow_id, workflow_type, definition_version, status, idempotency_key, input_hash, input_payload)
    values (v_owner, v_workflow_id, p_workflow_type, p_definition_version, 'QUEUED', p_idempotency_key, p_input_hash, p_input) returning id into v_run_id;
  update channelwright.workflows set current_run_id = v_run_id where id = v_workflow_id;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    if coalesce(v_step->>'key','') !~ '^[a-z][a-z0-9-]{1,119}$'
      or coalesce(v_step->>'kind','') not in ('WORKER','APPROVAL')
      or coalesce((v_step->>'position')::integer, -1) < 0
      or coalesce((v_step->>'maxAttempts')::integer, 0) not between 1 and 20
      or coalesce((v_step->>'retryBaseSeconds')::integer, -1) not between 0 and 3600
    then raise exception 'VALIDATION_ERROR: invalid workflow step definition'; end if;
    v_status := case when jsonb_array_length(coalesce(v_step->'dependsOn','[]'::jsonb)) = 0
      then case when v_step->>'kind' = 'APPROVAL' then 'WAITING_FOR_APPROVAL' else 'QUEUED' end else 'BLOCKED' end;
    insert into channelwright.workflow_steps(owner_id, workflow_id, workflow_run_id, step_key, position, kind, capability, depends_on, status, max_attempts, retry_base_seconds)
      values (v_owner, v_workflow_id, v_run_id, v_step->>'key', (v_step->>'position')::integer, v_step->>'kind', left(v_step->>'capability',120),
        array(select jsonb_array_elements_text(coalesce(v_step->'dependsOn','[]'::jsonb))), v_status, (v_step->>'maxAttempts')::integer, (v_step->>'retryBaseSeconds')::integer);
  end loop;

  insert into channelwright.workflow_approvals(owner_id, workflow_id, workflow_run_id, workflow_step_id, gate_key, status, request_payload)
    select owner_id, workflow_id, workflow_run_id, id, step_key, 'PENDING', jsonb_build_object('workflowType', p_workflow_type, 'definitionVersion', p_definition_version)
    from channelwright.workflow_steps where workflow_run_id = v_run_id and status = 'WAITING_FOR_APPROVAL';
  insert into channelwright.workflow_events(owner_id, workflow_id, workflow_run_id, event_type, actor_type, actor_id, detail)
    values (v_owner, v_workflow_id, v_run_id, 'WORKFLOW_QUEUED', 'USER', v_owner::text, jsonb_build_object('workflowType', p_workflow_type, 'definitionVersion', p_definition_version));
  return jsonb_build_object('workflowId', v_workflow_id, 'runId', v_run_id, 'status', 'QUEUED', 'idempotentReplay', false);
end $$;

create or replace function channelwright.decide_workflow_approval(p_workflow_id uuid, p_approval_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare v_owner uuid := auth.uid(); v_approval channelwright.workflow_approvals%rowtype; v_run_status text;
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  if p_decision not in ('APPROVE','REJECT','REQUEST_REVISION') or char_length(coalesce(p_note,'')) > 2000 or (p_decision = 'REQUEST_REVISION' and char_length(coalesce(p_note,'')) = 0) then raise exception 'VALIDATION_ERROR: invalid approval decision'; end if;
  select * into v_approval from channelwright.workflow_approvals where id = p_approval_id and workflow_id = p_workflow_id and owner_id = v_owner for update;
  if not found then raise exception 'NOT_FOUND: workflow approval'; end if;
  if v_approval.status <> 'PENDING' then raise exception 'INVALID_TRANSITION: approval is already final'; end if;
  if p_decision = 'REJECT' then
    update channelwright.workflow_approvals set status = 'REJECTED', decision_note = p_note, decided_by = v_owner, decided_at = now() where id = p_approval_id;
    update channelwright.workflow_steps set status = 'CANCELED', completed_at = now() where id = v_approval.workflow_step_id;
    update channelwright.workflow_runs set status = 'CANCELED', canceled_at = now(), completed_at = now() where id = v_approval.workflow_run_id;
    update channelwright.workflows set status = 'CANCELED', canceled_at = now(), completed_at = now() where id = p_workflow_id;
    v_run_status := 'CANCELED';
  elsif p_decision = 'REQUEST_REVISION' then
    update channelwright.workflow_approvals set status = 'REVISION_REQUESTED', decision_note = p_note, decided_by = v_owner, decided_at = now() where id = p_approval_id;
    update channelwright.workflow_steps set status = 'CANCELED', completed_at = now() where id = v_approval.workflow_step_id;
    update channelwright.workflow_runs set status = 'BLOCKED', context_payload = jsonb_set(context_payload, '{humanRevision}', jsonb_build_object('note', p_note, 'requestedAt', now()), true) where id = v_approval.workflow_run_id;
    update channelwright.workflows set status = 'BLOCKED' where id = p_workflow_id;
    v_run_status := 'BLOCKED';
  else
    update channelwright.workflow_approvals set status = 'APPROVED', decision_note = p_note, decided_by = v_owner, decided_at = now() where id = p_approval_id;
    update channelwright.workflow_steps set status = 'COMPLETED', completed_at = now() where id = v_approval.workflow_step_id;
    update channelwright.workflow_steps s set status = 'QUEUED', available_at = now()
      where s.workflow_run_id = v_approval.workflow_run_id and s.status = 'BLOCKED'
        and not exists (select 1 from unnest(s.depends_on) dependency where not exists (
          select 1 from channelwright.workflow_steps prior where prior.workflow_run_id = s.workflow_run_id and prior.step_key = dependency and prior.status = 'COMPLETED'));
    if not exists (select 1 from channelwright.workflow_steps where workflow_run_id = v_approval.workflow_run_id and status <> 'COMPLETED') then v_run_status := 'COMPLETED'; else v_run_status := 'RUNNING'; end if;
    update channelwright.workflow_runs set status = v_run_status, completed_at = case when v_run_status = 'COMPLETED' then now() else null end where id = v_approval.workflow_run_id;
    update channelwright.workflows set status = v_run_status, completed_at = case when v_run_status = 'COMPLETED' then now() else null end where id = p_workflow_id;
  end if;
  insert into channelwright.workflow_events(owner_id, workflow_id, workflow_run_id, workflow_step_id, event_type, actor_type, actor_id, detail)
    values (v_owner, p_workflow_id, v_approval.workflow_run_id, v_approval.workflow_step_id, 'APPROVAL_DECIDED', 'USER', v_owner::text, jsonb_build_object('decision', p_decision));
  return jsonb_build_object('workflowId', p_workflow_id, 'runId', v_approval.workflow_run_id, 'approvalId', p_approval_id, 'decision', p_decision, 'runStatus', v_run_status);
end $$;

revoke all on function channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb) from public, anon;
revoke all on function channelwright.decide_workflow_approval(uuid,uuid,text,text) from public, anon;
grant execute on function channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb) to authenticated;
grant execute on function channelwright.decide_workflow_approval(uuid,uuid,text,text) to authenticated;
