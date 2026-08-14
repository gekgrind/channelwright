-- Durable, owner-scoped strategic workflow orchestration. Forward-only and isolated to channelwright.

create table channelwright.workflows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid,
  workflow_type text not null check (workflow_type in ('CHANNEL_CONCEPT_VALIDATION')),
  definition_version integer not null check (definition_version > 0),
  objective text not null check (char_length(objective) between 1 and 1000),
  status text not null check (status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','BLOCKED','COMPLETED','FAILED','CANCELED')),
  current_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  canceled_at timestamptz,
  unique (id, owner_id),
  constraint workflows_channel_owner_fk foreign key (channel_id, owner_id) references channelwright.channels(id, owner_id) on delete cascade
);

alter table channelwright.workflow_runs drop constraint if exists workflow_runs_workflow_type_check;
alter table channelwright.workflow_runs add constraint workflow_runs_workflow_type_check
  check (workflow_type in ('CHANNEL','VIDEO','CHANNEL_CONCEPT_VALIDATION'));
alter table channelwright.workflow_runs drop constraint if exists workflow_runs_status_check;
alter table channelwright.workflow_runs add constraint workflow_runs_status_check
  check (status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','BLOCKED','PAUSED','COMPLETED','FAILED','CANCELED'));
alter table channelwright.workflow_runs
  add column workflow_id uuid,
  add column definition_version integer check (definition_version > 0),
  add column input_schema_version integer not null default 1 check (input_schema_version > 0),
  add column input_payload jsonb not null default '{}'::jsonb,
  add column context_payload jsonb not null default '{}'::jsonb,
  add column output_payload jsonb,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column canceled_at timestamptz;
alter table channelwright.workflow_runs
  add constraint workflow_runs_workflow_owner_fk foreign key (workflow_id, owner_id)
  references channelwright.workflows(id, owner_id) on delete cascade;
alter table channelwright.workflows
  add constraint workflows_current_run_fk foreign key (current_run_id, owner_id)
  references channelwright.workflow_runs(id, owner_id) on delete set null (current_run_id);

create table channelwright.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_id uuid not null,
  workflow_run_id uuid not null,
  step_key text not null check (step_key ~ '^[a-z][a-z0-9-]{1,119}$'),
  position integer not null check (position >= 0),
  kind text not null check (kind in ('WORKER','APPROVAL')),
  capability text not null check (char_length(capability) between 1 and 120),
  depends_on text[] not null default '{}',
  status text not null check (status in ('BLOCKED','QUEUED','LEASED','RETRY_WAIT','WAITING_FOR_APPROVAL','COMPLETED','FAILED','CANCELED')),
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null check (max_attempts between 1 and 20),
  retry_base_seconds integer not null check (retry_base_seconds between 0 and 3600),
  available_at timestamptz not null default now(),
  leased_by text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  cancellation_requested_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (workflow_run_id, step_key),
  unique (workflow_run_id, position),
  unique (id, owner_id),
  constraint workflow_steps_workflow_owner_fk foreign key (workflow_id, owner_id) references channelwright.workflows(id, owner_id) on delete cascade,
  constraint workflow_steps_run_owner_fk foreign key (workflow_run_id, owner_id) references channelwright.workflow_runs(id, owner_id) on delete cascade
);

create table channelwright.workflow_step_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_id uuid not null,
  workflow_run_id uuid not null,
  workflow_step_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  worker_id text not null check (char_length(worker_id) between 1 and 200),
  lease_token uuid not null,
  status text not null check (status in ('STARTED','SUCCEEDED','FAILED','LEASE_EXPIRED','CANCELED')),
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workflow_step_id, attempt_number),
  unique (workflow_step_id, lease_token),
  unique (id, owner_id),
  constraint workflow_attempts_workflow_owner_fk foreign key (workflow_id, owner_id) references channelwright.workflows(id, owner_id) on delete cascade,
  constraint workflow_attempts_run_owner_fk foreign key (workflow_run_id, owner_id) references channelwright.workflow_runs(id, owner_id) on delete cascade,
  constraint workflow_attempts_step_owner_fk foreign key (workflow_step_id, owner_id) references channelwright.workflow_steps(id, owner_id) on delete cascade
);

create table channelwright.workflow_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_id uuid not null,
  workflow_run_id uuid not null,
  workflow_step_id uuid not null,
  gate_key text not null check (char_length(gate_key) between 1 and 120),
  status text not null check (status in ('PENDING','APPROVED','REJECTED')),
  request_payload jsonb not null default '{}'::jsonb,
  decision_note text,
  decided_by uuid references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (workflow_step_id),
  unique (id, owner_id),
  constraint workflow_approvals_workflow_owner_fk foreign key (workflow_id, owner_id) references channelwright.workflows(id, owner_id) on delete cascade,
  constraint workflow_approvals_run_owner_fk foreign key (workflow_run_id, owner_id) references channelwright.workflow_runs(id, owner_id) on delete cascade,
  constraint workflow_approvals_step_owner_fk foreign key (workflow_step_id, owner_id) references channelwright.workflow_steps(id, owner_id) on delete cascade
);

create table channelwright.workflow_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_id uuid not null,
  workflow_run_id uuid not null,
  workflow_step_id uuid,
  workflow_attempt_id uuid,
  event_type text not null check (char_length(event_type) between 1 and 120),
  actor_type text not null check (actor_type in ('USER','WORKER','SYSTEM','AI')),
  actor_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workflow_events_workflow_owner_fk foreign key (workflow_id, owner_id) references channelwright.workflows(id, owner_id) on delete cascade,
  constraint workflow_events_run_owner_fk foreign key (workflow_run_id, owner_id) references channelwright.workflow_runs(id, owner_id) on delete cascade,
  constraint workflow_events_step_owner_fk foreign key (workflow_step_id, owner_id) references channelwright.workflow_steps(id, owner_id) on delete cascade,
  constraint workflow_events_attempt_owner_fk foreign key (workflow_attempt_id, owner_id) references channelwright.workflow_step_attempts(id, owner_id) on delete cascade
);

create index workflows_owner_created_idx on channelwright.workflows(owner_id, created_at desc);
create index workflow_runs_workflow_idx on channelwright.workflow_runs(workflow_id, created_at desc);
create index workflow_steps_claim_idx on channelwright.workflow_steps(status, available_at, created_at) where kind = 'WORKER';
create index workflow_steps_run_idx on channelwright.workflow_steps(workflow_run_id, position);
create index workflow_attempts_step_idx on channelwright.workflow_step_attempts(workflow_step_id, attempt_number desc);
create index workflow_approvals_owner_idx on channelwright.workflow_approvals(owner_id, status, requested_at desc);
create index workflow_events_run_idx on channelwright.workflow_events(workflow_run_id, created_at, id);

create trigger workflows_set_updated_at before update on channelwright.workflows for each row execute function channelwright.set_updated_at();
create trigger workflow_runs_set_updated_at before update on channelwright.workflow_runs for each row execute function channelwright.set_updated_at();
create trigger workflow_steps_set_updated_at before update on channelwright.workflow_steps for each row execute function channelwright.set_updated_at();

alter table channelwright.workflows enable row level security;
alter table channelwright.workflow_steps enable row level security;
alter table channelwright.workflow_step_attempts enable row level security;
alter table channelwright.workflow_approvals enable row level security;
alter table channelwright.workflow_events enable row level security;

create policy workflows_owner_select on channelwright.workflows for select to authenticated using (owner_id = auth.uid());
create policy workflow_steps_owner_select on channelwright.workflow_steps for select to authenticated using (owner_id = auth.uid());
create policy workflow_attempts_owner_select on channelwright.workflow_step_attempts for select to authenticated using (owner_id = auth.uid());
create policy workflow_approvals_owner_select on channelwright.workflow_approvals for select to authenticated using (owner_id = auth.uid());
create policy workflow_events_owner_select on channelwright.workflow_events for select to authenticated using (owner_id = auth.uid());

revoke insert, update, delete on channelwright.workflow_runs from authenticated;
grant select on channelwright.workflows, channelwright.workflow_runs, channelwright.workflow_steps,
  channelwright.workflow_step_attempts, channelwright.workflow_approvals, channelwright.workflow_events to authenticated;

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
  if p_workflow_type <> 'CHANNEL_CONCEPT_VALIDATION' or p_definition_version <> 1 then raise exception 'WORKFLOW_TYPE_INVALID: unsupported workflow definition'; end if;
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

create or replace function channelwright.claim_workflow_step(p_worker_id text, p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare
  v_step channelwright.workflow_steps%rowtype;
  v_attempt_id uuid;
  v_token uuid := gen_random_uuid();
  v_input jsonb;
  v_type text;
  v_version integer;
  v_prior jsonb;
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: workflow worker service role required'; end if;
  if char_length(p_worker_id) not between 1 and 200 or p_lease_seconds not between 30 and 900 then raise exception 'VALIDATION_ERROR: invalid workflow lease'; end if;

  update channelwright.workflow_step_attempts a set status = 'LEASE_EXPIRED', error_code = 'LEASE_EXPIRED', error_message = 'Worker lease expired before completion', completed_at = now()
    from channelwright.workflow_steps s where a.workflow_step_id = s.id and a.lease_token = s.lease_token and a.status = 'STARTED' and s.status = 'LEASED' and s.lease_expires_at <= now();
  update channelwright.workflow_steps set status = case when attempt_count >= max_attempts then 'FAILED' else 'RETRY_WAIT' end,
    available_at = now() + make_interval(secs => least(3600, retry_base_seconds * power(2, greatest(attempt_count - 1, 0))::integer)),
    leased_by = null, lease_token = null, lease_expires_at = null, error_code = 'LEASE_EXPIRED', error_message = 'Worker lease expired before completion'
    where status = 'LEASED' and lease_expires_at <= now();
  update channelwright.workflow_runs r set status = 'FAILED', error_code = 'MAX_ATTEMPTS_EXHAUSTED', completed_at = now()
    where r.status not in ('COMPLETED','FAILED','CANCELED') and exists (select 1 from channelwright.workflow_steps s where s.workflow_run_id = r.id and s.status = 'FAILED');
  update channelwright.workflows w set status = 'FAILED', completed_at = now()
    where w.status not in ('COMPLETED','FAILED','CANCELED') and exists (select 1 from channelwright.workflow_runs r where r.workflow_id = w.id and r.status = 'FAILED');

  select * into v_step from channelwright.workflow_steps s
    where s.kind = 'WORKER' and s.status in ('QUEUED','RETRY_WAIT') and s.available_at <= now() and s.attempt_count < s.max_attempts
      and s.cancellation_requested_at is null
      and not exists (select 1 from unnest(s.depends_on) dependency where not exists (
        select 1 from channelwright.workflow_steps prior where prior.workflow_run_id = s.workflow_run_id and prior.step_key = dependency and prior.status = 'COMPLETED'))
    order by s.created_at, s.position for update skip locked limit 1;
  if not found then return null; end if;

  update channelwright.workflow_steps set status = 'LEASED', attempt_count = attempt_count + 1, leased_by = p_worker_id, lease_token = v_token,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds), last_heartbeat_at = now(), started_at = coalesce(started_at, now())
    where id = v_step.id returning * into v_step;
  insert into channelwright.workflow_step_attempts(owner_id, workflow_id, workflow_run_id, workflow_step_id, attempt_number, worker_id, lease_token, status)
    values (v_step.owner_id, v_step.workflow_id, v_step.workflow_run_id, v_step.id, v_step.attempt_count, p_worker_id, v_token, 'STARTED') returning id into v_attempt_id;
  update channelwright.workflow_runs set status = 'RUNNING' where id = v_step.workflow_run_id and status in ('QUEUED','RUNNING','BLOCKED');
  update channelwright.workflows set status = 'RUNNING' where id = v_step.workflow_id and status in ('QUEUED','RUNNING','BLOCKED');
  select input_payload, workflow_type, definition_version into v_input, v_type, v_version from channelwright.workflow_runs where id = v_step.workflow_run_id;
  select coalesce(jsonb_object_agg(step_key, output_payload) filter (where output_payload is not null), '{}'::jsonb) into v_prior
    from channelwright.workflow_steps where workflow_run_id = v_step.workflow_run_id and status = 'COMPLETED';
  insert into channelwright.workflow_events(owner_id, workflow_id, workflow_run_id, workflow_step_id, workflow_attempt_id, event_type, actor_type, actor_id, detail)
    values (v_step.owner_id, v_step.workflow_id, v_step.workflow_run_id, v_step.id, v_attempt_id, 'STEP_LEASED', 'WORKER', p_worker_id, jsonb_build_object('attempt', v_step.attempt_count));
  return jsonb_build_object('id', v_step.id, 'ownerId', v_step.owner_id, 'workflowId', v_step.workflow_id, 'runId', v_step.workflow_run_id,
    'workflowType', v_type, 'definitionVersion', v_version, 'stepKey', v_step.step_key, 'capability', v_step.capability,
    'attemptCount', v_step.attempt_count, 'maxAttempts', v_step.max_attempts, 'leaseToken', v_token, 'leaseExpiresAt', v_step.lease_expires_at,
    'input', v_input, 'priorOutputs', v_prior);
end $$;

create or replace function channelwright.heartbeat_workflow_step(p_step_id uuid, p_lease_token uuid, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = channelwright, pg_temp as $$
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: workflow worker service role required'; end if;
  if p_lease_seconds not between 30 and 900 then raise exception 'VALIDATION_ERROR: invalid workflow lease'; end if;
  update channelwright.workflow_steps set last_heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    where id = p_step_id and lease_token = p_lease_token and status = 'LEASED' and lease_expires_at > now() and cancellation_requested_at is null;
  return found;
end $$;

create or replace function channelwright.complete_workflow_step(p_step_id uuid, p_lease_token uuid, p_output jsonb)
returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare
  v_step channelwright.workflow_steps%rowtype;
  v_attempt_id uuid;
  v_next channelwright.workflow_steps%rowtype;
  v_run_status text;
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
  update channelwright.workflow_runs set context_payload = jsonb_set(context_payload, array[v_step.step_key], p_output, true),
    output_payload = case when v_step.step_key = 'synthesize-validation' then p_output else output_payload end where id = v_step.workflow_run_id;

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

create or replace function channelwright.fail_workflow_step(p_step_id uuid, p_lease_token uuid, p_error_code text, p_error_message text, p_retryable boolean)
returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare v_step channelwright.workflow_steps%rowtype; v_retry boolean; v_status text;
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: workflow worker service role required'; end if;
  select * into v_step from channelwright.workflow_steps where id = p_step_id and lease_token = p_lease_token and status = 'LEASED' and lease_expires_at > now() for update;
  if not found then raise exception 'LEASE_NOT_ACTIVE: workflow step lease is not active'; end if;
  v_retry := p_retryable and v_step.attempt_count < v_step.max_attempts;
  v_status := case when v_retry then 'RETRY_WAIT' else 'FAILED' end;
  update channelwright.workflow_step_attempts set status = 'FAILED', error_code = left(p_error_code,120), error_message = left(p_error_message,2000), completed_at = now()
    where workflow_step_id = p_step_id and lease_token = p_lease_token and status = 'STARTED';
  update channelwright.workflow_steps set status = v_status,
    available_at = now() + make_interval(secs => case when v_retry then least(3600, retry_base_seconds * power(2, greatest(attempt_count - 1,0))::integer) else 0 end),
    leased_by = null, lease_token = null, lease_expires_at = null, error_code = left(p_error_code,120), error_message = left(p_error_message,2000)
    where id = p_step_id;
  if not v_retry then
    update channelwright.workflow_runs set status = 'FAILED', error_code = left(p_error_code,120), completed_at = now() where id = v_step.workflow_run_id;
    update channelwright.workflows set status = 'FAILED', completed_at = now() where id = v_step.workflow_id;
  end if;
  insert into channelwright.workflow_events(owner_id, workflow_id, workflow_run_id, workflow_step_id, event_type, actor_type, actor_id, detail)
    values (v_step.owner_id, v_step.workflow_id, v_step.workflow_run_id, v_step.id, 'STEP_FAILED', 'WORKER', v_step.leased_by,
      jsonb_build_object('errorCode', left(p_error_code,120), 'retryable', v_retry, 'attempt', v_step.attempt_count));
  return jsonb_build_object('stepId', v_step.id, 'status', v_status, 'retryable', v_retry);
end $$;

create or replace function channelwright.cancel_workflow(p_workflow_id uuid)
returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare v_owner uuid := auth.uid(); v_workflow channelwright.workflows%rowtype;
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  select * into v_workflow from channelwright.workflows where id = p_workflow_id and owner_id = v_owner for update;
  if not found then raise exception 'NOT_FOUND: workflow'; end if;
  if v_workflow.status = 'CANCELED' then return jsonb_build_object('workflowId', v_workflow.id, 'status', 'CANCELED', 'idempotentReplay', true); end if;
  if v_workflow.status in ('COMPLETED','FAILED') then raise exception 'INVALID_TRANSITION: final workflow cannot be canceled'; end if;
  update channelwright.workflow_step_attempts a set status = 'CANCELED', completed_at = now()
    from channelwright.workflow_steps s where a.workflow_step_id = s.id and s.workflow_id = p_workflow_id and a.status = 'STARTED';
  update channelwright.workflow_steps set status = 'CANCELED', cancellation_requested_at = now(), leased_by = null, lease_token = null, lease_expires_at = null, completed_at = now()
    where workflow_id = p_workflow_id and status not in ('COMPLETED','FAILED','CANCELED');
  update channelwright.workflow_approvals set status = 'REJECTED', decision_note = 'Workflow canceled', decided_by = v_owner, decided_at = now()
    where workflow_id = p_workflow_id and status = 'PENDING';
  update channelwright.workflow_runs set status = 'CANCELED', canceled_at = now(), completed_at = now() where workflow_id = p_workflow_id and status not in ('COMPLETED','FAILED','CANCELED');
  update channelwright.workflows set status = 'CANCELED', canceled_at = now(), completed_at = now() where id = p_workflow_id;
  insert into channelwright.workflow_events(owner_id, workflow_id, workflow_run_id, event_type, actor_type, actor_id)
    select v_owner, p_workflow_id, id, 'WORKFLOW_CANCELED', 'USER', v_owner::text from channelwright.workflow_runs where workflow_id = p_workflow_id order by created_at desc limit 1;
  return jsonb_build_object('workflowId', p_workflow_id, 'status', 'CANCELED', 'idempotentReplay', false);
end $$;

create or replace function channelwright.decide_workflow_approval(p_workflow_id uuid, p_approval_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare v_owner uuid := auth.uid(); v_approval channelwright.workflow_approvals%rowtype; v_run_status text;
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  if p_decision not in ('APPROVE','REJECT') or char_length(coalesce(p_note,'')) > 2000 then raise exception 'VALIDATION_ERROR: invalid approval decision'; end if;
  select * into v_approval from channelwright.workflow_approvals where id = p_approval_id and workflow_id = p_workflow_id and owner_id = v_owner for update;
  if not found then raise exception 'NOT_FOUND: workflow approval'; end if;
  if v_approval.status <> 'PENDING' then raise exception 'INVALID_TRANSITION: approval is already final'; end if;
  if p_decision = 'REJECT' then
    update channelwright.workflow_approvals set status = 'REJECTED', decision_note = p_note, decided_by = v_owner, decided_at = now() where id = p_approval_id;
    update channelwright.workflow_steps set status = 'CANCELED', completed_at = now() where id = v_approval.workflow_step_id;
    update channelwright.workflow_runs set status = 'CANCELED', canceled_at = now(), completed_at = now() where id = v_approval.workflow_run_id;
    update channelwright.workflows set status = 'CANCELED', canceled_at = now(), completed_at = now() where id = p_workflow_id;
    v_run_status := 'CANCELED';
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
revoke all on function channelwright.cancel_workflow(uuid) from public, anon;
revoke all on function channelwright.decide_workflow_approval(uuid,uuid,text,text) from public, anon;
grant execute on function channelwright.start_workflow(text,text,text,integer,text,jsonb,jsonb) to authenticated;
grant execute on function channelwright.cancel_workflow(uuid) to authenticated;
grant execute on function channelwright.decide_workflow_approval(uuid,uuid,text,text) to authenticated;

revoke all on function channelwright.claim_workflow_step(text,integer) from public, anon, authenticated;
revoke all on function channelwright.heartbeat_workflow_step(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function channelwright.complete_workflow_step(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function channelwright.fail_workflow_step(uuid,uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function channelwright.claim_workflow_step(text,integer) to service_role;
grant execute on function channelwright.heartbeat_workflow_step(uuid,uuid,integer) to service_role;
grant execute on function channelwright.complete_workflow_step(uuid,uuid,jsonb) to service_role;
grant execute on function channelwright.fail_workflow_step(uuid,uuid,text,text,boolean) to service_role;
