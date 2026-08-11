-- Channelwright business-studio foundation. Forward-only; no existing artifact is rewritten.

alter type public.concept_source add value if not exists 'REFERENCE_CHANNEL';
alter type public.channel_state add value if not exists 'REFERENCE_CHANNEL_RESEARCH_PENDING';
alter type public.channel_state add value if not exists 'REFERENCE_CHANNEL_REVIEW_REQUIRED';
alter type public.channel_state add value if not exists 'BUSINESS_STRATEGY_REVIEW_REQUIRED';

alter table public.channels add constraint channels_id_owner_unique unique (id, owner_id);
alter table public.video_projects add constraint video_projects_id_owner_channel_unique unique (id, owner_id, channel_id);

create table public.reference_channel_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null,
  input_url text not null check (char_length(input_url) between 10 and 500),
  canonical_url text not null check (char_length(canonical_url) between 10 and 500),
  stable_channel_id text not null check (char_length(stable_channel_id) between 3 and 160),
  source_kind text not null check (source_kind in ('HANDLE', 'CHANNEL_ID', 'CUSTOM_PATH', 'USER_PATH')),
  lookup_value text not null check (char_length(lookup_value) between 1 and 160),
  provider text not null,
  fixture boolean not null,
  source_payload jsonb not null,
  resolved_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  unique (channel_id, stable_channel_id),
  unique (id, owner_id, channel_id)
);

create table public.reference_research_report_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null,
  reference_source_id uuid not null,
  version_number integer not null check (version_number > 0),
  parent_version integer check (parent_version > 0),
  changed_section text,
  change_instructions text check (change_instructions is null or char_length(change_instructions) <= 4000),
  status text not null check (status in ('QA_REQUIRED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED')),
  report_payload jsonb not null,
  qa_payload jsonb not null,
  source_provenance jsonb not null default '[]'::jsonb,
  fixture boolean not null,
  created_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  foreign key (reference_source_id, owner_id, channel_id) references public.reference_channel_sources(id, owner_id, channel_id) on delete restrict,
  unique (channel_id, version_number),
  unique (id, owner_id, channel_id, version_number)
);

create table public.reference_report_decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null,
  report_id uuid not null,
  report_version integer not null check (report_version > 0),
  decision text not null check (decision in ('APPROVE', 'REJECT_DIRECTION', 'SWITCH_TO_USER_DEFINED', 'SWITCH_TO_DISCOVERY')),
  feedback text check (feedback is null or char_length(feedback) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (report_id, owner_id, channel_id, report_version) references public.reference_research_report_versions(id, owner_id, channel_id, version_number) on delete restrict,
  check (created_by = owner_id)
);

create table public.business_strategy_versions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, version_number integer not null check (version_number > 0), parent_version integer,
  status text not null check (status in ('QA_REQUIRED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED')),
  strategy_payload jsonb not null, qa_payload jsonb not null, change_instructions text,
  fixture boolean not null, created_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  unique (channel_id, version_number), unique (id, owner_id, channel_id, version_number)
);

create table public.business_strategy_decisions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, strategy_id uuid not null, strategy_version integer not null check (strategy_version > 0),
  decision text not null check (decision in ('APPROVE', 'REQUEST_CHANGES')), feedback text,
  created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
  foreign key (strategy_id, owner_id, channel_id, strategy_version) references public.business_strategy_versions(id, owner_id, channel_id, version_number) on delete restrict,
  check (created_by = owner_id)
);

alter table public.video_projects add column project_kind text not null default 'STANDARD' check (project_kind in ('STANDARD', 'PILLAR'));
alter table public.video_projects add column source_business_strategy_version integer;
alter table public.video_projects add constraint videos_business_strategy_version_fk
  foreign key (channel_id, source_business_strategy_version) references public.business_strategy_versions(channel_id, version_number) on delete restrict;

create table public.brand_system_versions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, version_number integer not null check (version_number > 0),
  source_report_version integer, status text not null check (status in ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED')),
  token_payload jsonb not null, created_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  unique (channel_id, version_number), unique (id, owner_id, channel_id, version_number)
);

create table public.pillar_video_plans (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, video_project_id uuid,
  version_number integer not null check (version_number > 0), status text not null check (status in ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED')),
  plan_payload jsonb not null, created_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  foreign key (video_project_id, owner_id, channel_id) references public.video_projects(id, owner_id, channel_id) on delete restrict,
  unique (channel_id, version_number), unique (id, owner_id, channel_id, version_number)
);

create table public.offer_candidates (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, source_report_version integer not null check (source_report_version > 0),
  offer_type text not null check (offer_type in ('FREE_RESOURCE', 'PAID_PRODUCT')),
  rank integer not null check (rank > 0), candidate_payload jsonb not null, created_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  unique (channel_id, source_report_version, offer_type, rank), unique (id, owner_id, channel_id)
);

create table public.offer_selections (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, offer_candidate_id uuid not null, decision text not null check (decision in ('SELECT', 'REJECT', 'REQUEST_CHANGES')),
  exact_candidate_payload jsonb not null, feedback text, created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (offer_candidate_id, owner_id, channel_id) references public.offer_candidates(id, owner_id, channel_id) on delete restrict,
  check (created_by = owner_id)
);

create table public.build_projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, offer_candidate_id uuid,
  build_type text not null check (build_type in ('FREE_RESOURCE', 'PAID_PRODUCT')),
  state text not null check (state in ('DRAFT', 'SPEC_REVIEW', 'BUILDING', 'QA', 'USER_REVIEW', 'APPROVED', 'DEPLOYMENT_BLOCKED', 'READY_TO_DEPLOY', 'DEPLOYED')),
  specification_version integer not null default 1 check (specification_version > 0), specification_payload jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  foreign key (offer_candidate_id, owner_id, channel_id) references public.offer_candidates(id, owner_id, channel_id) on delete restrict,
  unique (id, owner_id, channel_id)
);

create table public.build_artifact_versions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, build_project_id uuid not null, version_number integer not null check (version_number > 0),
  parent_version integer check (parent_version > 0), status text not null check (status in ('BUILDING', 'QA_REQUIRED', 'USER_REVIEW', 'APPROVED', 'FAILED')),
  file_manifest jsonb not null, artifact_metadata jsonb not null, object_reference text,
  qa_payload jsonb, fixture boolean not null, created_at timestamptz not null default now(),
  foreign key (build_project_id, owner_id, channel_id) references public.build_projects(id, owner_id, channel_id) on delete cascade,
  unique (build_project_id, version_number), unique (id, owner_id, channel_id, build_project_id, version_number)
);

create table public.artifact_decisions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, build_project_id uuid not null, artifact_id uuid not null, artifact_version integer not null check (artifact_version > 0),
  decision text not null check (decision in ('APPROVE', 'REQUEST_CHANGES', 'RESTORE_AS_NEW_VERSION', 'REJECT')),
  feedback text, created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
  foreign key (artifact_id, owner_id, channel_id, build_project_id, artifact_version) references public.build_artifact_versions(id, owner_id, channel_id, build_project_id, version_number) on delete restrict,
  check (created_by = owner_id)
);

create table public.funnel_page_versions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, build_project_id uuid not null, page_type text not null check (page_type in ('OPT_IN', 'THANK_YOU', 'RESOURCE_ACCESS')),
  version_number integer not null check (version_number > 0), status text not null check (status in ('DRAFT', 'QA_REQUIRED', 'USER_REVIEW', 'APPROVED')),
  page_payload jsonb not null, sanitized_preview_reference text, created_at timestamptz not null default now(),
  foreign key (build_project_id, owner_id, channel_id) references public.build_projects(id, owner_id, channel_id) on delete cascade,
  unique (build_project_id, page_type, version_number)
);

create table public.subscribers (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, normalized_email text not null check (char_length(normalized_email) between 3 and 320),
  status text not null check (status in ('PENDING', 'ACTIVE', 'UNSUBSCRIBED', 'SUPPRESSED')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  unique (channel_id, normalized_email), unique (id, owner_id, channel_id)
);

create table public.consent_events (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, subscriber_id uuid not null, consent_type text not null,
  consented boolean not null, source text not null, occurred_at timestamptz not null, metadata jsonb not null default '{}'::jsonb,
  foreign key (subscriber_id, owner_id, channel_id) references public.subscribers(id, owner_id, channel_id) on delete cascade
);

create table public.delivery_events (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, subscriber_id uuid not null, build_project_id uuid,
  status text not null check (status in ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'ACCESSED', 'REVOKED')),
  provider text, provider_message_id text, secure_token_hash text, expires_at timestamptz, error_code text,
  created_at timestamptz not null default now(),
  foreign key (subscriber_id, owner_id, channel_id) references public.subscribers(id, owner_id, channel_id) on delete cascade,
  foreign key (build_project_id, owner_id, channel_id) references public.build_projects(id, owner_id, channel_id) on delete restrict
);

create table public.products (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, build_project_id uuid,
  status text not null check (status in ('DRAFT', 'ACTIVE', 'ARCHIVED')), name text not null, product_payload jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  foreign key (build_project_id, owner_id, channel_id) references public.build_projects(id, owner_id, channel_id) on delete restrict,
  unique (id, owner_id, channel_id)
);

create table public.prices (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, product_id uuid not null, provider text not null, provider_price_id text,
  currency text not null check (char_length(currency) = 3), amount_minor bigint not null check (amount_minor >= 0), active boolean not null default false,
  pricing_hypothesis boolean not null default true, created_at timestamptz not null default now(),
  foreign key (product_id, owner_id, channel_id) references public.products(id, owner_id, channel_id) on delete cascade,
  unique (id, owner_id, channel_id)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, product_id uuid not null, price_id uuid not null,
  provider text not null, provider_checkout_id text not null, provider_payment_id text,
  customer_reference text not null, status text not null check (status in ('PENDING', 'PAID', 'REFUNDED', 'DISPUTED', 'FAILED')),
  verified_at timestamptz, created_at timestamptz not null default now(),
  foreign key (product_id, owner_id, channel_id) references public.products(id, owner_id, channel_id) on delete restrict,
  foreign key (price_id, owner_id, channel_id) references public.prices(id, owner_id, channel_id) on delete restrict,
  unique (provider, provider_checkout_id), unique (id, owner_id, channel_id)
);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, product_id uuid not null, purchase_id uuid not null,
  subject_reference text not null, status text not null check (status in ('ACTIVE', 'REVOKED', 'REFUNDED', 'EXPIRED')),
  granted_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now(),
  foreign key (purchase_id, owner_id, channel_id) references public.purchases(id, owner_id, channel_id) on delete restrict,
  unique (purchase_id, subject_reference)
);

create table public.commerce_events (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, purchase_id uuid not null, provider text not null, provider_event_id text not null,
  event_type text not null check (event_type in ('PAYMENT_CONFIRMED', 'PAYMENT_REFUNDED')),
  verified boolean not null check (verified = true), event_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null, created_at timestamptz not null default now(),
  foreign key (purchase_id, owner_id, channel_id) references public.purchases(id, owner_id, channel_id) on delete restrict,
  unique (provider, provider_event_id)
);

create table public.monetization_plan_versions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, version_number integer not null check (version_number > 0), parent_version integer,
  status text not null check (status in ('DRAFT', 'QA_REQUIRED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED')),
  plan_payload jsonb not null, qa_payload jsonb not null, created_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  unique (channel_id, version_number), unique (id, owner_id, channel_id, version_number)
);

create table public.monetization_plan_decisions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, plan_id uuid not null, plan_version integer not null check (plan_version > 0),
  decision text not null check (decision in ('APPROVE', 'REQUEST_CHANGES', 'REJECT')), feedback text,
  created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
  foreign key (plan_id, owner_id, channel_id, plan_version) references public.monetization_plan_versions(id, owner_id, channel_id, version_number) on delete restrict,
  check (created_by = owner_id)
);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, role text not null check (role in ('USER', 'ASSISTANT', 'SYSTEM', 'AGENT')),
  message_text text not null check (char_length(message_text) between 1 and 8000), fixture boolean not null,
  created_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  unique (id, owner_id, channel_id)
);

create table public.structured_change_requests (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null, message_id uuid not null,
  target_type text not null, target_id uuid not null, target_version integer not null check (target_version > 0),
  action_payload jsonb not null, status text not null check (status in ('PENDING', 'APPLIED_AS_NEW_VERSION', 'REJECTED', 'FAILED')),
  created_at timestamptz not null default now(),
  foreign key (channel_id, owner_id) references public.channels(id, owner_id) on delete cascade,
  foreign key (message_id, owner_id, channel_id) references public.conversation_messages(id, owner_id, channel_id) on delete cascade
);

create index reference_sources_owner_idx on public.reference_channel_sources(owner_id, channel_id);
create index reference_reports_owner_idx on public.reference_research_report_versions(owner_id, channel_id, version_number desc);
create index subscribers_owner_idx on public.subscribers(owner_id, channel_id, created_at desc);
create index purchases_owner_idx on public.purchases(owner_id, channel_id, created_at desc);
create index conversations_owner_idx on public.conversation_messages(owner_id, channel_id, created_at desc);

create trigger build_projects_set_updated_at before update on public.build_projects for each row execute function public.set_updated_at();
create trigger subscribers_set_updated_at before update on public.subscribers for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();

alter table public.reference_channel_sources enable row level security;
alter table public.reference_research_report_versions enable row level security;
alter table public.reference_report_decisions enable row level security;
alter table public.business_strategy_versions enable row level security;
alter table public.business_strategy_decisions enable row level security;
alter table public.brand_system_versions enable row level security;
alter table public.pillar_video_plans enable row level security;
alter table public.offer_candidates enable row level security;
alter table public.offer_selections enable row level security;
alter table public.build_projects enable row level security;
alter table public.build_artifact_versions enable row level security;
alter table public.artifact_decisions enable row level security;
alter table public.funnel_page_versions enable row level security;
alter table public.subscribers enable row level security;
alter table public.consent_events enable row level security;
alter table public.delivery_events enable row level security;
alter table public.products enable row level security;
alter table public.prices enable row level security;
alter table public.purchases enable row level security;
alter table public.entitlements enable row level security;
alter table public.commerce_events enable row level security;
alter table public.monetization_plan_versions enable row level security;
alter table public.monetization_plan_decisions enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.structured_change_requests enable row level security;

create policy reference_sources_owner_all on public.reference_channel_sources for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy reference_reports_owner_all on public.reference_research_report_versions for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy reference_decisions_owner_all on public.reference_report_decisions for all using (owner_id = auth.uid() and created_by = auth.uid()) with check (owner_id = auth.uid() and created_by = auth.uid());
create policy business_strategies_owner_all on public.business_strategy_versions for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy business_strategy_decisions_owner_all on public.business_strategy_decisions for all using (owner_id = auth.uid() and created_by = auth.uid()) with check (owner_id = auth.uid() and created_by = auth.uid());
create policy brand_systems_owner_all on public.brand_system_versions for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy pillar_plans_owner_all on public.pillar_video_plans for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy offer_candidates_owner_all on public.offer_candidates for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy offer_selections_owner_all on public.offer_selections for all using (owner_id = auth.uid() and created_by = auth.uid()) with check (owner_id = auth.uid() and created_by = auth.uid());
create policy build_projects_owner_all on public.build_projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy build_artifacts_owner_all on public.build_artifact_versions for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy artifact_decisions_owner_all on public.artifact_decisions for all using (owner_id = auth.uid() and created_by = auth.uid()) with check (owner_id = auth.uid() and created_by = auth.uid());
create policy funnel_pages_owner_all on public.funnel_page_versions for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy subscribers_owner_all on public.subscribers for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy consent_events_owner_all on public.consent_events for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy delivery_events_owner_all on public.delivery_events for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy products_owner_all on public.products for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy prices_owner_all on public.prices for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy purchases_owner_all on public.purchases for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy entitlements_owner_all on public.entitlements for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy commerce_events_owner_all on public.commerce_events for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy monetization_plans_owner_all on public.monetization_plan_versions for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy monetization_decisions_owner_all on public.monetization_plan_decisions for all using (owner_id = auth.uid() and created_by = auth.uid()) with check (owner_id = auth.uid() and created_by = auth.uid());
create policy conversation_messages_owner_all on public.conversation_messages for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy change_requests_owner_all on public.structured_change_requests for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
