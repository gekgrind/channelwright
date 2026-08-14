-- Durable aggregate accounting for one logical CHANNEL_RESEARCH workflow run.
-- Reservations are made before external spend and survive attempts, leases, and process restarts.

alter table channelwright.research_evidence_cache drop constraint if exists research_evidence_cache_evidence_payload_check;
alter table channelwright.research_evidence_cache add constraint research_evidence_cache_evidence_payload_check
  check (jsonb_typeof(evidence_payload) = 'array' and jsonb_array_length(evidence_payload) between 1 and 50 and octet_length(evidence_payload::text) <= 65536);
drop policy if exists research_evidence_cache_owner_select on channelwright.research_evidence_cache;
create policy research_evidence_cache_owner_select on channelwright.research_evidence_cache
  for select to authenticated using (owner_id = (select auth.uid()));

create or replace function channelwright.purge_expired_research_cache(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare v_deleted integer;
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: research cache maintenance requires service role'; end if;
  if p_limit not between 1 and 5000 then raise exception 'VALIDATION_ERROR: invalid purge limit'; end if;
  delete from channelwright.research_evidence_cache where id in (
    select id from channelwright.research_evidence_cache where expires_at <= now() order by expires_at limit p_limit
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
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
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  if char_length(p_idempotency_key) not between 1 and 300 or p_input_hash !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION_ERROR: invalid idempotency input'; end if;
  if not (p_definition_version = 1 and p_workflow_type in ('CHANNEL_CONCEPT_VALIDATION','CHANNEL_RESEARCH')) then raise exception 'WORKFLOW_TYPE_INVALID: unsupported workflow definition'; end if;
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
    if jsonb_typeof(p_input) <> 'object'
      or not ((p_input ? 'channelConcept') or (p_input ? 'niche'))
      or (p_input ? 'channelConcept' and (jsonb_typeof(p_input->'channelConcept') <> 'string' or char_length(p_input->>'channelConcept') not between 10 and 2000))
      or (p_input ? 'niche' and (jsonb_typeof(p_input->'niche') <> 'string' or char_length(p_input->>'niche') not between 2 and 500))
    then raise exception 'VALIDATION_ERROR: invalid CHANNEL_RESEARCH input'; end if;
  else
    v_expected_objective := 'Evaluate a proposed channel concept against content depth, audience demand, and monetization readiness';
    v_expected_steps := jsonb_build_array(
      jsonb_build_object('key','assess-content-depth','position',0,'kind','WORKER','capability','strategist','dependsOn','[]'::jsonb,'maxAttempts',3,'retryBaseSeconds',2),
      jsonb_build_object('key','assess-audience-demand','position',1,'kind','WORKER','capability','researcher','dependsOn',jsonb_build_array('assess-content-depth'),'maxAttempts',3,'retryBaseSeconds',2),
      jsonb_build_object('key','assess-monetization','position',2,'kind','WORKER','capability','monetization-strategist','dependsOn',jsonb_build_array('assess-audience-demand'),'maxAttempts',3,'retryBaseSeconds',2),
      jsonb_build_object('key','synthesize-validation','position',3,'kind','WORKER','capability','strategist','dependsOn',jsonb_build_array('assess-monetization'),'maxAttempts',3,'retryBaseSeconds',2),
      jsonb_build_object('key','approve-validation','position',4,'kind','APPROVAL','capability','human','dependsOn',jsonb_build_array('synthesize-validation'),'maxAttempts',1,'retryBaseSeconds',0)
    );
    if jsonb_typeof(p_input) <> 'object' or not (p_input ? 'proposedConcept') or jsonb_typeof(p_input->'proposedConcept') <> 'string' or char_length(p_input->>'proposedConcept') not between 20 and 2000
    then raise exception 'VALIDATION_ERROR: invalid CHANNEL_CONCEPT_VALIDATION input'; end if;
  end if;
  if p_objective <> v_expected_objective or p_steps <> v_expected_steps then raise exception 'WORKFLOW_TYPE_INVALID: canonical workflow definition required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_idempotency_key, 0));
  select * into v_existing from channelwright.workflow_runs where owner_id = v_owner and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.input_hash <> p_input_hash then raise exception 'IDEMPOTENCY_CONFLICT: key reused with different workflow input'; end if;
    return jsonb_build_object('workflowId', v_existing.workflow_id, 'runId', v_existing.id, 'status', v_existing.status, 'idempotentReplay', true);
  end if;
  if p_workflow_type = 'CHANNEL_RESEARCH' and exists (
    select 1 from channelwright.workflow_runs where owner_id = v_owner and workflow_type = 'CHANNEL_RESEARCH' and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','BLOCKED','PAUSED')
  ) then raise exception 'RESEARCH_LIMIT_REACHED: an active research run already exists'; end if;

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
declare
  v_owner uuid := auth.uid();
  v_approval channelwright.workflow_approvals%rowtype;
  v_old_run channelwright.workflow_runs%rowtype;
  v_old_step channelwright.workflow_steps%rowtype;
  v_run_status text;
  v_result_run_id uuid;
  v_new_run_id uuid;
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  if p_decision not in ('APPROVE','REJECT','REQUEST_REVISION') or char_length(coalesce(p_note,'')) > 2000 or (p_decision = 'REQUEST_REVISION' and char_length(coalesce(p_note,'')) = 0) then raise exception 'VALIDATION_ERROR: invalid approval decision'; end if;
  select * into v_approval from channelwright.workflow_approvals where id = p_approval_id and workflow_id = p_workflow_id and owner_id = v_owner for update;
  if not found then raise exception 'NOT_FOUND: workflow approval'; end if;
  if v_approval.status <> 'PENDING' then raise exception 'INVALID_TRANSITION: approval is already final'; end if;
  v_result_run_id := v_approval.workflow_run_id;
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
    select * into v_old_run from channelwright.workflow_runs where id = v_approval.workflow_run_id and owner_id = v_owner for update;
    insert into channelwright.workflow_runs(owner_id, workflow_id, workflow_type, definition_version, status, idempotency_key, input_hash, input_payload, context_payload)
      values (v_owner, p_workflow_id, v_old_run.workflow_type, v_old_run.definition_version, 'QUEUED',
        'human-revision:' || v_old_run.id::text,
        md5(v_old_run.input_hash || p_note) || md5(p_note || v_old_run.input_hash),
        v_old_run.input_payload || jsonb_build_object('humanRevisionNote', p_note),
        jsonb_build_object('previousRunId', v_old_run.id, 'revisionReason', p_note))
      returning id into v_new_run_id;
    for v_old_step in select * from channelwright.workflow_steps where workflow_run_id = v_old_run.id order by position loop
      insert into channelwright.workflow_steps(owner_id, workflow_id, workflow_run_id, step_key, position, kind, capability, depends_on, status, max_attempts, retry_base_seconds)
        values (v_owner, p_workflow_id, v_new_run_id, v_old_step.step_key, v_old_step.position, v_old_step.kind, v_old_step.capability, v_old_step.depends_on,
          case when cardinality(v_old_step.depends_on) = 0 then case when v_old_step.kind = 'APPROVAL' then 'WAITING_FOR_APPROVAL' else 'QUEUED' end else 'BLOCKED' end,
          v_old_step.max_attempts, v_old_step.retry_base_seconds);
    end loop;
    insert into channelwright.workflow_approvals(owner_id, workflow_id, workflow_run_id, workflow_step_id, gate_key, status, request_payload)
      select owner_id, workflow_id, workflow_run_id, id, step_key, 'PENDING', jsonb_build_object('workflowType', v_old_run.workflow_type, 'definitionVersion', v_old_run.definition_version)
      from channelwright.workflow_steps where workflow_run_id = v_new_run_id and status = 'WAITING_FOR_APPROVAL';
    update channelwright.workflows set current_run_id = v_new_run_id, status = 'QUEUED', completed_at = null where id = p_workflow_id;
    insert into channelwright.workflow_events(owner_id, workflow_id, workflow_run_id, event_type, actor_type, actor_id, detail)
      values (v_owner, p_workflow_id, v_new_run_id, 'WORKFLOW_REVISION_QUEUED', 'USER', v_owner::text, jsonb_build_object('previousRunId', v_old_run.id));
    v_result_run_id := v_new_run_id;
    v_run_status := 'QUEUED';
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
  return jsonb_build_object('workflowId', p_workflow_id, 'runId', v_result_run_id, 'approvalId', p_approval_id, 'decision', p_decision, 'runStatus', v_run_status);
end $$;

create table channelwright.research_run_budgets (
  workflow_run_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_id uuid not null,
  parent_run_id uuid,
  root_run_id uuid not null,
  limits jsonb not null check (jsonb_typeof(limits) = 'object' and octet_length(limits::text) <= 8192),
  used_totals jsonb not null default '{}'::jsonb check (jsonb_typeof(used_totals) = 'object' and octet_length(used_totals::text) <= 8192),
  reserved_totals jsonb not null default '{}'::jsonb check (jsonb_typeof(reserved_totals) = 'object' and octet_length(reserved_totals::text) <= 8192),
  provider_identities jsonb not null default '[]'::jsonb check (jsonb_typeof(provider_identities) = 'array' and jsonb_array_length(provider_identities) <= 20),
  model_identities jsonb not null default '[]'::jsonb check (jsonb_typeof(model_identities) = 'array' and jsonb_array_length(model_identities) <= 20),
  exhaustion_code text,
  exhausted_at timestamptz,
  first_reserved_at timestamptz,
  last_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_run_id, owner_id),
  constraint research_budgets_workflow_owner_fk foreign key (workflow_id, owner_id) references channelwright.workflows(id, owner_id) on delete cascade,
  constraint research_budgets_run_owner_fk foreign key (workflow_run_id, owner_id) references channelwright.workflow_runs(id, owner_id) on delete cascade,
  constraint research_budgets_parent_owner_fk foreign key (parent_run_id, owner_id) references channelwright.workflow_runs(id, owner_id) on delete restrict,
  constraint research_budgets_root_owner_fk foreign key (root_run_id, owner_id) references channelwright.workflow_runs(id, owner_id) on delete restrict
);

create table channelwright.research_usage_operations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_id uuid not null,
  workflow_run_id uuid not null,
  workflow_step_id uuid not null,
  workflow_attempt_id uuid,
  operation_key text not null check (char_length(operation_key) between 1 and 300),
  operation_kind text not null check (operation_kind in (
    'STEP_ATTEMPT','CACHE_LOOKUP','YOUTUBE_SEARCH','YOUTUBE_VIDEOS','YOUTUBE_CHANNELS',
    'MODEL_SYNTHESIS','MODEL_QA','MODEL_REVISION','EVIDENCE_RESULT','AUTOMATED_REVISION'
  )),
  provider_identity text check (provider_identity is null or char_length(provider_identity) between 1 and 200),
  model_identity text check (model_identity is null or char_length(model_identity) between 1 and 200),
  status text not null check (status in ('RESERVED','SUCCEEDED','FAILED','REJECTED')),
  reservation jsonb not null default '{}'::jsonb check (jsonb_typeof(reservation) = 'object' and octet_length(reservation::text) <= 8192),
  actual_usage jsonb not null default '{}'::jsonb check (jsonb_typeof(actual_usage) = 'object' and octet_length(actual_usage::text) <= 8192),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 16384),
  reserved_at timestamptz not null default now(),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workflow_run_id, operation_key),
  unique (id, owner_id),
  constraint research_usage_workflow_owner_fk foreign key (workflow_id, owner_id) references channelwright.workflows(id, owner_id) on delete cascade,
  constraint research_usage_run_owner_fk foreign key (workflow_run_id, owner_id) references channelwright.workflow_runs(id, owner_id) on delete cascade,
  constraint research_usage_step_owner_fk foreign key (workflow_step_id, owner_id) references channelwright.workflow_steps(id, owner_id) on delete cascade,
  constraint research_usage_attempt_owner_fk foreign key (workflow_attempt_id, owner_id) references channelwright.workflow_step_attempts(id, owner_id) on delete restrict
);

create index research_run_budgets_lineage_idx on channelwright.research_run_budgets(owner_id, root_run_id, created_at);
create index research_usage_operations_run_idx on channelwright.research_usage_operations(workflow_run_id, created_at);
create index research_usage_operations_attempt_idx on channelwright.research_usage_operations(workflow_attempt_id, created_at);
create trigger research_run_budgets_set_updated_at before update on channelwright.research_run_budgets
  for each row execute function channelwright.set_updated_at();

alter table channelwright.research_run_budgets enable row level security;
alter table channelwright.research_usage_operations enable row level security;
create policy research_run_budgets_owner_select on channelwright.research_run_budgets
  for select to authenticated using (owner_id = (select auth.uid()));
create policy research_usage_operations_owner_select on channelwright.research_usage_operations
  for select to authenticated using (owner_id = (select auth.uid()));
revoke insert, update, delete on channelwright.research_run_budgets from authenticated;
revoke insert, update, delete on channelwright.research_usage_operations from authenticated;
grant select on channelwright.research_run_budgets, channelwright.research_usage_operations to authenticated;

create or replace function channelwright.research_usage_value(p_value jsonb, p_key text)
returns bigint language sql immutable parallel safe as $$
  select case when coalesce(p_value, '{}'::jsonb) ? p_key then (p_value->>p_key)::bigint else 0::bigint end
$$;

create or replace function channelwright.research_usage_add(p_base jsonb, p_delta jsonb)
returns jsonb language plpgsql immutable as $$
declare v_result jsonb := coalesce(p_base, '{}'::jsonb); v_key text; v_value bigint;
begin
  for v_key, v_value in select key, value::text::bigint from jsonb_each(coalesce(p_delta, '{}'::jsonb)) loop
    v_result := jsonb_set(v_result, array[v_key], to_jsonb(channelwright.research_usage_value(v_result, v_key) + v_value), true);
  end loop;
  return v_result;
end $$;

create or replace function channelwright.research_usage_subtract(p_base jsonb, p_delta jsonb)
returns jsonb language plpgsql immutable as $$
declare v_result jsonb := coalesce(p_base, '{}'::jsonb); v_key text; v_value bigint; v_current bigint;
begin
  for v_key, v_value in select key, value::text::bigint from jsonb_each(coalesce(p_delta, '{}'::jsonb)) loop
    v_current := channelwright.research_usage_value(v_result, v_key);
    if v_value < 0 or v_value > v_current then raise exception 'VALIDATION_ERROR: invalid usage subtraction'; end if;
    v_result := jsonb_set(v_result, array[v_key], to_jsonb(v_current - v_value), true);
  end loop;
  return v_result;
end $$;

create or replace function channelwright.assert_research_usage_shape(p_value jsonb, p_allow_observations boolean default false)
returns void language plpgsql immutable as $$
declare v_key text; v_raw jsonb;
begin
  if jsonb_typeof(p_value) <> 'object' or octet_length(p_value::text) > 8192 then raise exception 'VALIDATION_ERROR: usage must be a bounded object'; end if;
  for v_key, v_raw in select key, value from jsonb_each(p_value) loop
    if v_key not in ('providerRequests','providerQuotaUnits','searches','synthesisCalls','qaCalls','revisionCalls','inputTokens','outputTokens','totalTokens','automatedRevisions')
      and not (p_allow_observations and v_key in ('videosRetrieved','channelsRetrieved','cacheHits','cacheMisses','executionAttempts','failedOperations'))
    then raise exception 'VALIDATION_ERROR: unsupported usage counter %', v_key; end if;
    if jsonb_typeof(v_raw) <> 'number' or v_raw::text !~ '^\d+$' then raise exception 'VALIDATION_ERROR: usage counters must be non-negative integers'; end if;
  end loop;
end $$;

create or replace function channelwright.ensure_research_run_budget(
  p_run_id uuid, p_step_id uuid, p_lease_token uuid, p_operation_key text, p_limits jsonb
) returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare
  v_run channelwright.workflow_runs%rowtype;
  v_step channelwright.workflow_steps%rowtype;
  v_attempt channelwright.workflow_step_attempts%rowtype;
  v_parent uuid;
  v_root uuid;
  v_inserted integer;
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: research accounting requires service role'; end if;
  perform channelwright.assert_research_usage_shape(p_limits, false);
  if jsonb_object_length(p_limits) <> 10
    or channelwright.research_usage_value(p_limits,'providerRequests') not between 1 and 36
    or channelwright.research_usage_value(p_limits,'providerQuotaUnits') not between 1 and 1200
    or channelwright.research_usage_value(p_limits,'searches') not between 1 and 12
    or channelwright.research_usage_value(p_limits,'synthesisCalls') not between 1 and 6
    or channelwright.research_usage_value(p_limits,'qaCalls') not between 1 and 12
    or channelwright.research_usage_value(p_limits,'revisionCalls') not between 1 and 4
    or channelwright.research_usage_value(p_limits,'inputTokens') not between 1000 and 1000000
    or channelwright.research_usage_value(p_limits,'outputTokens') not between 1000 and 100000
    or channelwright.research_usage_value(p_limits,'totalTokens') not between 2000 and 1100000
    or channelwright.research_usage_value(p_limits,'automatedRevisions') <> 1
  then raise exception 'VALIDATION_ERROR: research budget exceeds database safety ceilings or is incomplete'; end if;

  select * into v_run from channelwright.workflow_runs where id = p_run_id and workflow_type = 'CHANNEL_RESEARCH';
  if not found then raise exception 'NOT_FOUND: CHANNEL_RESEARCH run'; end if;
  select * into v_step from channelwright.workflow_steps where id = p_step_id and workflow_run_id = p_run_id and lease_token = p_lease_token and status = 'LEASED' and lease_expires_at > now();
  if not found then raise exception 'LEASE_NOT_ACTIVE: research usage requires the active lease'; end if;
  select * into v_attempt from channelwright.workflow_step_attempts where workflow_step_id = p_step_id and lease_token = p_lease_token and status = 'STARTED';
  if not found then raise exception 'LEASE_NOT_ACTIVE: research attempt is not active'; end if;

  begin v_parent := nullif(v_run.context_payload->>'previousRunId','')::uuid; exception when invalid_text_representation then raise exception 'VALIDATION_ERROR: invalid research lineage'; end;
  if v_parent is not null and not exists (select 1 from channelwright.workflow_runs where id = v_parent and workflow_id = v_run.workflow_id and owner_id = v_run.owner_id) then
    raise exception 'VALIDATION_ERROR: invalid research parent lineage';
  end if;
  select root_run_id into v_root from channelwright.research_run_budgets where workflow_run_id = v_parent and owner_id = v_run.owner_id;
  v_root := coalesce(v_root, v_parent, v_run.id);

  insert into channelwright.research_run_budgets(workflow_run_id, owner_id, workflow_id, parent_run_id, root_run_id, limits)
    values (v_run.id, v_run.owner_id, v_run.workflow_id, v_parent, v_root, p_limits)
    on conflict (workflow_run_id) do nothing;
  if exists (select 1 from channelwright.research_run_budgets where workflow_run_id = v_run.id and limits <> p_limits) then
    raise exception 'IDEMPOTENCY_CONFLICT: research run budget configuration changed';
  end if;

  insert into channelwright.research_usage_operations(owner_id, workflow_id, workflow_run_id, workflow_step_id, workflow_attempt_id, operation_key, operation_kind, status, actual_usage, finalized_at)
    values (v_run.owner_id, v_run.workflow_id, v_run.id, v_step.id, v_attempt.id, p_operation_key, 'STEP_ATTEMPT', 'SUCCEEDED', jsonb_build_object('executionAttempts',1), now())
    on conflict (workflow_run_id, operation_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    update channelwright.research_run_budgets set used_totals = channelwright.research_usage_add(used_totals, jsonb_build_object('executionAttempts',1)), last_recorded_at = now()
      where workflow_run_id = v_run.id;
  end if;
  return (select to_jsonb(b) from channelwright.research_run_budgets b where workflow_run_id = v_run.id);
end $$;

create or replace function channelwright.reserve_research_usage(
  p_run_id uuid, p_step_id uuid, p_lease_token uuid, p_operation_key text, p_operation_kind text,
  p_provider_identity text, p_model_identity text, p_reservation jsonb
) returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare
  v_budget channelwright.research_run_budgets%rowtype;
  v_step channelwright.workflow_steps%rowtype;
  v_attempt channelwright.workflow_step_attempts%rowtype;
  v_existing channelwright.research_usage_operations%rowtype;
  v_id uuid := gen_random_uuid();
  v_key text;
  v_value bigint;
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: research accounting requires service role'; end if;
  perform channelwright.assert_research_usage_shape(p_reservation, false);
  if char_length(p_operation_key) not between 1 and 300 or p_operation_kind not in ('CACHE_LOOKUP','YOUTUBE_SEARCH','YOUTUBE_VIDEOS','YOUTUBE_CHANNELS','MODEL_SYNTHESIS','MODEL_QA','MODEL_REVISION','EVIDENCE_RESULT','AUTOMATED_REVISION') then
    raise exception 'VALIDATION_ERROR: invalid research operation';
  end if;
  select * into v_existing from channelwright.research_usage_operations where workflow_run_id = p_run_id and operation_key = p_operation_key;
  if found then
    if v_existing.workflow_step_id <> p_step_id or v_existing.operation_kind <> p_operation_kind or v_existing.reservation <> p_reservation then raise exception 'IDEMPOTENCY_CONFLICT: research operation key changed'; end if;
    return jsonb_build_object('operationId',v_existing.id,'status',v_existing.status,'idempotentReplay',true,'exhaustionCode',case when v_existing.status='REJECTED' then 'RESEARCH_RESOURCE_BUDGET_EXHAUSTED' else null end);
  end if;
  select * into v_step from channelwright.workflow_steps where id = p_step_id and workflow_run_id = p_run_id and lease_token = p_lease_token and status = 'LEASED' and lease_expires_at > now();
  if not found then raise exception 'LEASE_NOT_ACTIVE: research usage requires the active lease'; end if;
  select * into v_attempt from channelwright.workflow_step_attempts where workflow_step_id = p_step_id and lease_token = p_lease_token and status = 'STARTED';
  if not found then raise exception 'LEASE_NOT_ACTIVE: research attempt is not active'; end if;
  select * into v_budget from channelwright.research_run_budgets where workflow_run_id = p_run_id for update;
  if not found then raise exception 'NOT_FOUND: research run budget'; end if;
  for v_key, v_value in select key, value::text::bigint from jsonb_each(p_reservation) loop
    if channelwright.research_usage_value(v_budget.used_totals,v_key) + channelwright.research_usage_value(v_budget.reserved_totals,v_key) + v_value > channelwright.research_usage_value(v_budget.limits,v_key) then
      insert into channelwright.research_usage_operations(id,owner_id,workflow_id,workflow_run_id,workflow_step_id,workflow_attempt_id,operation_key,operation_kind,provider_identity,model_identity,status,reservation,metadata,finalized_at)
        values(v_id,v_budget.owner_id,v_budget.workflow_id,p_run_id,p_step_id,v_attempt.id,p_operation_key,p_operation_kind,p_provider_identity,p_model_identity,'REJECTED',p_reservation,jsonb_build_object('exhaustedCounter',v_key),now());
      update channelwright.research_run_budgets set exhaustion_code = 'RESEARCH_RESOURCE_BUDGET_EXHAUSTED:'||v_key, exhausted_at = coalesce(exhausted_at,now()), last_recorded_at = now() where workflow_run_id = p_run_id;
      return jsonb_build_object('operationId',v_id,'status','REJECTED','idempotentReplay',false,'exhaustionCode','RESEARCH_RESOURCE_BUDGET_EXHAUSTED:'||v_key);
    end if;
  end loop;
  insert into channelwright.research_usage_operations(id,owner_id,workflow_id,workflow_run_id,workflow_step_id,workflow_attempt_id,operation_key,operation_kind,provider_identity,model_identity,status,reservation)
    values(v_id,v_budget.owner_id,v_budget.workflow_id,p_run_id,p_step_id,v_attempt.id,p_operation_key,p_operation_kind,p_provider_identity,p_model_identity,'RESERVED',p_reservation);
  update channelwright.research_run_budgets set reserved_totals = channelwright.research_usage_add(reserved_totals,p_reservation),
    provider_identities = case when p_provider_identity is null or provider_identities ? p_provider_identity then provider_identities else provider_identities || to_jsonb(p_provider_identity) end,
    model_identities = case when p_model_identity is null or model_identities ? p_model_identity then model_identities else model_identities || to_jsonb(p_model_identity) end,
    first_reserved_at = coalesce(first_reserved_at,now()), last_recorded_at = now() where workflow_run_id = p_run_id;
  return jsonb_build_object('operationId',v_id,'status','RESERVED','idempotentReplay',false,'exhaustionCode',null);
end $$;

create or replace function channelwright.finalize_research_usage(
  p_operation_id uuid, p_status text, p_actual_usage jsonb, p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare v_operation channelwright.research_usage_operations%rowtype; v_key text; v_value bigint;
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: research accounting requires service role'; end if;
  if p_status not in ('SUCCEEDED','FAILED') or jsonb_typeof(p_metadata) <> 'object' or octet_length(p_metadata::text) > 16384 then raise exception 'VALIDATION_ERROR: invalid usage finalization'; end if;
  perform channelwright.assert_research_usage_shape(p_actual_usage, true);
  select * into v_operation from channelwright.research_usage_operations where id = p_operation_id for update;
  if not found then raise exception 'NOT_FOUND: research usage operation'; end if;
  if v_operation.status in ('SUCCEEDED','FAILED') then return jsonb_build_object('operationId',v_operation.id,'status',v_operation.status,'idempotentReplay',true); end if;
  if v_operation.status <> 'RESERVED' then raise exception 'INVALID_TRANSITION: research usage operation cannot be finalized'; end if;
  for v_key, v_value in select key, value::text::bigint from jsonb_each(p_actual_usage) loop
    if v_key in ('providerRequests','providerQuotaUnits','searches','synthesisCalls','qaCalls','revisionCalls','inputTokens','outputTokens','totalTokens','automatedRevisions')
      and v_value > channelwright.research_usage_value(v_operation.reservation,v_key) then raise exception 'VALIDATION_ERROR: actual usage exceeds reservation'; end if;
  end loop;
  update channelwright.research_run_budgets set reserved_totals = channelwright.research_usage_subtract(reserved_totals,v_operation.reservation),
    used_totals = channelwright.research_usage_add(used_totals,p_actual_usage), last_recorded_at = now()
    where workflow_run_id = v_operation.workflow_run_id;
  update channelwright.research_usage_operations set status=p_status, actual_usage=p_actual_usage, metadata=p_metadata, finalized_at=now() where id=p_operation_id;
  return jsonb_build_object('operationId',v_operation.id,'status',p_status,'idempotentReplay',false);
end $$;

create or replace function channelwright.protect_final_research_artifact()
returns trigger language plpgsql set search_path = channelwright, pg_temp as $$
begin
  if old.workflow_type = 'CHANNEL_RESEARCH'
    and exists (
      select 1 from channelwright.workflow_approvals a
      where a.workflow_run_id = old.id and a.status in ('APPROVED','REJECTED','REVISION_REQUESTED')
    )
    and (new.input_payload is distinct from old.input_payload
      or new.output_payload is distinct from old.output_payload
      or new.input_hash is distinct from old.input_hash
      or new.workflow_type is distinct from old.workflow_type
      or new.definition_version is distinct from old.definition_version)
  then raise exception 'APPROVED_ARTIFACT_IMMUTABLE: finalized CHANNEL_RESEARCH content cannot be mutated'; end if;
  return new;
end $$;

create or replace function channelwright.protect_final_research_step_output()
returns trigger language plpgsql set search_path = channelwright, pg_temp as $$
begin
  if new.output_payload is distinct from old.output_payload
    and exists (
      select 1 from channelwright.workflow_runs r join channelwright.workflow_approvals a on a.workflow_run_id = r.id
      where r.id = old.workflow_run_id and r.workflow_type = 'CHANNEL_RESEARCH'
        and a.status in ('APPROVED','REJECTED','REVISION_REQUESTED')
    )
  then raise exception 'APPROVED_ARTIFACT_IMMUTABLE: finalized CHANNEL_RESEARCH step output cannot be mutated'; end if;
  return new;
end $$;

create trigger workflow_runs_protect_final_research before update on channelwright.workflow_runs
  for each row execute function channelwright.protect_final_research_artifact();
create trigger workflow_steps_protect_final_research before update on channelwright.workflow_steps
  for each row execute function channelwright.protect_final_research_step_output();

revoke all on function channelwright.research_usage_value(jsonb,text) from public, anon, authenticated;
revoke all on function channelwright.research_usage_add(jsonb,jsonb) from public, anon, authenticated;
revoke all on function channelwright.research_usage_subtract(jsonb,jsonb) from public, anon, authenticated;
revoke all on function channelwright.assert_research_usage_shape(jsonb,boolean) from public, anon, authenticated;
revoke all on function channelwright.ensure_research_run_budget(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function channelwright.reserve_research_usage(uuid,uuid,uuid,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function channelwright.finalize_research_usage(uuid,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function channelwright.protect_final_research_artifact() from public, anon, authenticated;
revoke all on function channelwright.protect_final_research_step_output() from public, anon, authenticated;
grant execute on function channelwright.ensure_research_run_budget(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function channelwright.reserve_research_usage(uuid,uuid,uuid,text,text,text,text,jsonb) to service_role;
grant execute on function channelwright.finalize_research_usage(uuid,text,jsonb,jsonb) to service_role;
revoke all on function channelwright.purge_expired_research_cache(integer) from public, anon, authenticated;
grant execute on function channelwright.purge_expired_research_cache(integer) to service_role;
