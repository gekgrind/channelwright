alter table channelwright.channels
  add column distribution_targets jsonb not null
  default '{"youtube":true,"tiktok":false,"instagramFacebookReels":false}'::jsonb;

alter table channelwright.video_projects
  add column distribution_targets jsonb not null
  default '{"youtube":true,"tiktok":false,"instagramFacebookReels":false}'::jsonb;

alter table channelwright.channels add constraint channels_distribution_targets_valid check (
  jsonb_typeof(distribution_targets) = 'object'
  and distribution_targets @> '{"youtube":true}'::jsonb
  and distribution_targets ? 'tiktok'
  and distribution_targets ? 'instagramFacebookReels'
  and jsonb_typeof(distribution_targets -> 'tiktok') = 'boolean'
  and jsonb_typeof(distribution_targets -> 'instagramFacebookReels') = 'boolean'
);

alter table channelwright.video_projects add constraint videos_distribution_targets_valid check (
  jsonb_typeof(distribution_targets) = 'object'
  and distribution_targets @> '{"youtube":true}'::jsonb
  and distribution_targets ? 'tiktok'
  and distribution_targets ? 'instagramFacebookReels'
  and jsonb_typeof(distribution_targets -> 'tiktok') = 'boolean'
  and jsonb_typeof(distribution_targets -> 'instagramFacebookReels') = 'boolean'
);

create table channelwright.platform_adaptation_artifacts (
  id uuid primary key default gen_random_uuid(),
  video_project_id uuid not null references channelwright.video_projects(id) on delete cascade,
  target text not null check (target in ('TIKTOK', 'INSTAGRAM_FACEBOOK_REELS')),
  version_number integer not null check (version_number > 0),
  source_script_version integer not null check (source_script_version > 0),
  source_master_version text,
  artifact_kind text not null check (artifact_kind in ('ADAPTATION_PLAN', 'RENDERED_MEDIA')),
  status text not null check (status in ('GENERATING', 'QA_REQUIRED', 'REVIEW_REQUIRED', 'APPROVED', 'FAILED', 'READY_TO_EXPORT', 'READY_TO_PUBLISH')),
  package_payload jsonb,
  output_asset_reference text,
  media_metadata jsonb,
  fixture boolean not null default false,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_project_id, target, version_number),
  unique (id, video_project_id),
  unique (id, video_project_id, version_number, source_script_version)
);

create table channelwright.platform_qa_reports (
  id uuid primary key default gen_random_uuid(),
  video_project_id uuid not null references channelwright.video_projects(id) on delete cascade,
  platform_artifact_id uuid not null,
  verdict text not null check (verdict in ('PASS', 'REVISE')),
  findings jsonb not null default '[]'::jsonb,
  media_validation jsonb,
  created_at timestamptz not null default now(),
  foreign key (platform_artifact_id, video_project_id)
    references channelwright.platform_adaptation_artifacts(id, video_project_id) on delete cascade,
  unique (platform_artifact_id)
);

create table channelwright.platform_artifact_approvals (
  id uuid primary key default gen_random_uuid(),
  video_project_id uuid not null references channelwright.video_projects(id) on delete cascade,
  platform_artifact_id uuid not null,
  artifact_version integer not null check (artifact_version > 0),
  source_script_version integer not null check (source_script_version > 0),
  decision text not null check (decision in ('APPROVE', 'REQUEST_CHANGES')),
  feedback text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (platform_artifact_id, video_project_id, artifact_version, source_script_version)
    references channelwright.platform_adaptation_artifacts(id, video_project_id, version_number, source_script_version) on delete restrict
);

create index platform_artifacts_video_idx on channelwright.platform_adaptation_artifacts(video_project_id, target, version_number desc);
create index platform_qa_video_idx on channelwright.platform_qa_reports(video_project_id, created_at desc);
create index platform_approvals_video_idx on channelwright.platform_artifact_approvals(video_project_id, created_at desc);

create trigger platform_artifacts_set_updated_at before update on channelwright.platform_adaptation_artifacts
  for each row execute function channelwright.set_updated_at();

alter table channelwright.platform_adaptation_artifacts enable row level security;
alter table channelwright.platform_qa_reports enable row level security;
alter table channelwright.platform_artifact_approvals enable row level security;

create policy platform_artifacts_owner_all on channelwright.platform_adaptation_artifacts for all
  using (exists (select 1 from channelwright.video_projects v where v.id = video_project_id and v.owner_id = auth.uid()))
  with check (exists (select 1 from channelwright.video_projects v where v.id = video_project_id and v.owner_id = auth.uid()));

create policy platform_qa_owner_all on channelwright.platform_qa_reports for all
  using (exists (select 1 from channelwright.video_projects v where v.id = video_project_id and v.owner_id = auth.uid()))
  with check (exists (select 1 from channelwright.video_projects v where v.id = video_project_id and v.owner_id = auth.uid()));

create policy platform_approvals_owner_all on channelwright.platform_artifact_approvals for all
  using (created_by = auth.uid() and exists (select 1 from channelwright.video_projects v where v.id = video_project_id and v.owner_id = auth.uid()))
  with check (created_by = auth.uid() and exists (select 1 from channelwright.video_projects v where v.id = video_project_id and v.owner_id = auth.uid()));

grant select, insert, update, delete on channelwright.platform_adaptation_artifacts to authenticated;
grant select, insert, update, delete on channelwright.platform_qa_reports to authenticated;
grant select, insert, update, delete on channelwright.platform_artifact_approvals to authenticated;
