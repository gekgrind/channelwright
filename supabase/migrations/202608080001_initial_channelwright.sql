create extension if not exists pgcrypto;

create type public.concept_source as enum ('USER_DEFINED', 'AGENT_DISCOVERED');
create type public.channel_state as enum ('DRAFT', 'CONCEPT_RESEARCH_PENDING', 'CONCEPT_REVIEW_REQUIRED', 'CONCEPT_DISCOVERY_PENDING', 'CONCEPT_SELECTION_REQUIRED', 'CONCEPT_ACCEPTED', 'CHANNEL_STRATEGY_PENDING', 'READY_FOR_VIDEO_PRODUCTION', 'FAILED');
create type public.viability_recommendation as enum ('GO', 'CAUTION', 'STOP_RECOMMENDED');
create type public.concept_decision_type as enum ('ACCEPT', 'OVERRIDE_AND_CONTINUE', 'REVISE', 'REQUEST_ALTERNATIVES', 'REJECT');
create type public.video_state as enum ('DRAFT', 'STRATEGY_PENDING', 'RESEARCH_PENDING', 'SCRIPT_PENDING', 'SCRIPT_QA_PENDING', 'SCRIPT_REVIEW_REQUIRED', 'SCRIPT_APPROVED', 'FAILED', 'CANCELLED');

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  state public.channel_state not null default 'DRAFT',
  concept_mode public.concept_source not null,
  preferences jsonb not null default '{}'::jsonb,
  selected_concept_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.channel_concept_versions (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  concept text not null check (char_length(concept) between 10 and 2000),
  niche text not null,
  source_type public.concept_source not null,
  created_at timestamptz not null default now(),
  unique (channel_id, version_number),
  unique (id, channel_id)
);

alter table public.channels add constraint channels_selected_concept_fk
  foreign key (selected_concept_version_id, id)
  references public.channel_concept_versions(id, channel_id)
  deferrable initially deferred;

create table public.concept_research_reports (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  concept_version_id uuid not null references public.channel_concept_versions(id) on delete cascade,
  report_version text not null,
  summary text not null,
  research_payload jsonb not null,
  source_provenance jsonb not null default '[]'::jsonb,
  fixture boolean not null default false,
  created_at timestamptz not null default now(),
  unique (concept_version_id, report_version)
);

create table public.concept_viability_reports (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  concept_version_id uuid not null references public.channel_concept_versions(id) on delete cascade,
  report_version text not null,
  recommendation public.viability_recommendation not null,
  overall_score integer not null check (overall_score between 0 and 100),
  gate_results jsonb not null,
  score_breakdown jsonb not null,
  strengths jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  repairable boolean not null,
  recommended_changes jsonb not null default '[]'::jsonb,
  revised_concept_examples jsonb not null default '[]'::jsonb,
  summary text not null,
  created_at timestamptz not null default now(),
  unique (concept_version_id, report_version)
);

create table public.concept_decisions (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  concept_version_id uuid not null references public.channel_concept_versions(id) on delete cascade,
  viability_report_id uuid not null references public.concept_viability_reports(id) on delete restrict,
  system_recommendation public.viability_recommendation not null,
  decision public.concept_decision_type not null,
  feedback text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.concept_candidates (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  concept text not null,
  niche text not null,
  promise text not null,
  rank integer not null check (rank > 0),
  viability_payload jsonb not null,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (channel_id, rank)
);

create table public.channel_strategies (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  concept_version_id uuid not null references public.channel_concept_versions(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  strategy_payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (channel_id, version_number)
);

create table public.video_projects (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  state public.video_state not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete cascade,
  video_project_id uuid references public.video_projects(id) on delete cascade,
  workflow_type text not null check (workflow_type in ('CHANNEL', 'VIDEO')),
  status text not null check (status in ('RUNNING', 'PAUSED', 'COMPLETED', 'FAILED')),
  idempotency_key text not null,
  input_hash text not null,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (owner_id, idempotency_key)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_run_id uuid references public.workflow_runs(id) on delete cascade,
  agent_type text not null,
  status text not null check (status in ('STARTED', 'COMPLETED', 'FAILED')),
  input_hash text not null,
  trace_metadata jsonb not null default '{}'::jsonb,
  fixture boolean not null default false,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.video_strategy_artifacts (
  id uuid primary key default gen_random_uuid(),
  video_project_id uuid not null references public.video_projects(id) on delete cascade,
  version_number integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (video_project_id, version_number)
);

create table public.video_research_artifacts (
  id uuid primary key default gen_random_uuid(),
  video_project_id uuid not null references public.video_projects(id) on delete cascade,
  version_number integer not null,
  payload jsonb not null,
  source_provenance jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (video_project_id, version_number)
);

create table public.script_versions (
  id uuid primary key default gen_random_uuid(),
  video_project_id uuid not null references public.video_projects(id) on delete cascade,
  version_number integer not null,
  script_payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (video_project_id, version_number)
);

create table public.script_qa_reports (
  id uuid primary key default gen_random_uuid(),
  video_project_id uuid not null references public.video_projects(id) on delete cascade,
  script_version_id uuid not null references public.script_versions(id) on delete cascade,
  verdict text not null check (verdict in ('PASS', 'REVISE')),
  findings jsonb not null,
  created_at timestamptz not null default now(),
  unique (script_version_id)
);

create table public.script_approvals (
  id uuid primary key default gen_random_uuid(),
  video_project_id uuid not null references public.video_projects(id) on delete cascade,
  script_version_id uuid not null references public.script_versions(id) on delete restrict,
  decision text not null check (decision in ('APPROVE', 'REQUEST_CHANGES', 'REJECT')),
  feedback text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.cost_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete cascade,
  video_project_id uuid references public.video_projects(id) on delete cascade,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  category text not null,
  provider text not null,
  amount_usd numeric(12, 6) not null check (amount_usd >= 0),
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index channels_owner_idx on public.channels(owner_id, updated_at desc);
create index concept_versions_channel_idx on public.channel_concept_versions(channel_id, version_number desc);
create index viability_channel_idx on public.concept_viability_reports(channel_id, created_at desc);
create index decisions_channel_idx on public.concept_decisions(channel_id, created_at desc);
create index videos_channel_idx on public.video_projects(channel_id, updated_at desc);
create index agent_runs_owner_idx on public.agent_runs(owner_id, started_at desc);
create index cost_events_channel_idx on public.cost_events(channel_id, created_at desc);
create index cost_events_video_idx on public.cost_events(video_project_id, created_at desc);
create index audit_events_owner_idx on public.audit_events(owner_id, created_at desc);
create index audit_events_entity_idx on public.audit_events(entity_id, created_at desc);

create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger channels_set_updated_at before update on public.channels for each row execute function public.set_updated_at();
create trigger videos_set_updated_at before update on public.video_projects for each row execute function public.set_updated_at();

alter table public.channels enable row level security;
alter table public.channel_concept_versions enable row level security;
alter table public.concept_research_reports enable row level security;
alter table public.concept_viability_reports enable row level security;
alter table public.concept_decisions enable row level security;
alter table public.concept_candidates enable row level security;
alter table public.channel_strategies enable row level security;
alter table public.video_projects enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.agent_runs enable row level security;
alter table public.video_strategy_artifacts enable row level security;
alter table public.video_research_artifacts enable row level security;
alter table public.script_versions enable row level security;
alter table public.script_qa_reports enable row level security;
alter table public.script_approvals enable row level security;
alter table public.cost_events enable row level security;
alter table public.audit_events enable row level security;

create policy channels_owner_all on public.channels for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy concept_versions_owner_all on public.channel_concept_versions for all using (exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid())) with check (exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid()));
create policy concept_research_owner_all on public.concept_research_reports for all using (exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid())) with check (exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid()));
create policy concept_viability_owner_all on public.concept_viability_reports for all using (exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid())) with check (exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid()));
create policy concept_decisions_owner_all on public.concept_decisions for all using (created_by = auth.uid() and exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid())) with check (created_by = auth.uid() and exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid()));
create policy concept_candidates_owner_all on public.concept_candidates for all using (exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid())) with check (exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid()));
create policy channel_strategies_owner_all on public.channel_strategies for all using (exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid())) with check (exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid()));
create policy videos_owner_all on public.video_projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid()));
create policy workflow_runs_owner_all on public.workflow_runs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy agent_runs_owner_all on public.agent_runs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy video_strategy_owner_all on public.video_strategy_artifacts for all using (exists (select 1 from public.video_projects v where v.id = video_project_id and v.owner_id = auth.uid())) with check (exists (select 1 from public.video_projects v where v.id = video_project_id and v.owner_id = auth.uid()));
create policy video_research_owner_all on public.video_research_artifacts for all using (exists (select 1 from public.video_projects v where v.id = video_project_id and v.owner_id = auth.uid())) with check (exists (select 1 from public.video_projects v where v.id = video_project_id and v.owner_id = auth.uid()));
create policy scripts_owner_all on public.script_versions for all using (exists (select 1 from public.video_projects v where v.id = video_project_id and v.owner_id = auth.uid())) with check (exists (select 1 from public.video_projects v where v.id = video_project_id and v.owner_id = auth.uid()));
create policy script_qa_owner_all on public.script_qa_reports for all using (exists (select 1 from public.video_projects v where v.id = video_project_id and v.owner_id = auth.uid())) with check (exists (select 1 from public.video_projects v where v.id = video_project_id and v.owner_id = auth.uid()));
create policy approvals_owner_all on public.script_approvals for all using (created_by = auth.uid() and exists (select 1 from public.video_projects v where v.id = video_project_id and v.owner_id = auth.uid())) with check (created_by = auth.uid() and exists (select 1 from public.video_projects v where v.id = video_project_id and v.owner_id = auth.uid()));
create policy costs_owner_all on public.cost_events for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy audit_events_owner_all on public.audit_events for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
