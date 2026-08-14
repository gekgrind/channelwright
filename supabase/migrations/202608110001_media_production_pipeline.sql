-- Transactional, owner-scoped media production. Forward-only.

create type channelwright.media_asset_kind as enum ('IMAGE', 'VIDEO', 'NARRATION', 'MUSIC', 'OTHER');
create type channelwright.media_asset_status as enum ('UPLOADING', 'READY', 'QUARANTINED', 'FAILED');
create type channelwright.media_rights_status as enum ('UNKNOWN', 'PENDING', 'VERIFIED', 'RESTRICTED', 'REJECTED');
create type channelwright.render_job_status as enum ('QUEUED', 'LEASED', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED');
create type channelwright.production_master_status as enum ('INSPECTION_PENDING', 'QA_BLOCKED', 'REVIEW_REQUIRED', 'APPROVED', 'EXPORT_READY');
create type channelwright.media_qa_category as enum ('TECHNICAL', 'RIGHTS', 'CONTENT', 'VISUAL', 'AUDIO', 'PLATFORM');
create type channelwright.media_qa_verdict as enum ('PASS', 'FAIL', 'BLOCKED', 'UNKNOWN');

alter table channelwright.script_versions
  add constraint script_versions_exact_version_unique unique (id, video_project_id, version_number);

alter table channelwright.video_projects
  add constraint video_projects_id_owner_unique unique (id, owner_id);

create table channelwright.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind channelwright.media_asset_kind not null,
  status channelwright.media_asset_status not null default 'UPLOADING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table channelwright.media_asset_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null,
  version_number integer not null check (version_number > 0),
  kind channelwright.media_asset_kind not null,
  status channelwright.media_asset_status not null,
  provider text not null check (char_length(provider) between 1 and 120),
  provenance jsonb not null default '{}'::jsonb,
  rights_status channelwright.media_rights_status not null default 'UNKNOWN',
  license_reference text,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm','audio/wav','audio/mpeg','audio/mp4','audio/aac','audio/ogg')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 524288000),
  duration_seconds numeric(14,6) check (duration_seconds is null or duration_seconds >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  storage_bucket text not null check (storage_bucket = 'channelwright-private-media'),
  storage_key text not null,
  created_at timestamptz not null default now(),
  foreign key (asset_id, owner_id) references channelwright.media_assets(id, owner_id) on delete cascade,
  check (storage_key like owner_id::text || '/assets/sha256/%'),
  unique (asset_id, version_number),
  unique (owner_id, checksum_sha256, mime_type),
  unique (storage_bucket, storage_key),
  unique (id, owner_id, asset_id)
);

create table channelwright.render_input_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_project_id uuid not null,
  version_number integer not null check (version_number > 0),
  source_script_version_id uuid not null,
  source_script_version integer not null check (source_script_version > 0),
  input_payload jsonb not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (video_project_id, owner_id) references channelwright.video_projects(id, owner_id) on delete cascade,
  foreign key (source_script_version_id, video_project_id, source_script_version) references channelwright.script_versions(id, video_project_id, version_number) on delete restrict,
  unique (video_project_id, version_number),
  unique (video_project_id, input_hash),
  unique (id, owner_id, video_project_id)
);

create table channelwright.render_input_assets (
  owner_id uuid not null references auth.users(id) on delete cascade,
  render_input_id uuid not null,
  video_project_id uuid not null,
  asset_version_id uuid not null,
  asset_id uuid not null,
  role text not null check (role in ('VISUAL', 'NARRATION', 'MUSIC', 'OTHER')),
  created_at timestamptz not null default now(),
  primary key (render_input_id, asset_version_id),
  foreign key (render_input_id, owner_id, video_project_id) references channelwright.render_input_versions(id, owner_id, video_project_id) on delete cascade,
  foreign key (asset_version_id, owner_id, asset_id) references channelwright.media_asset_versions(id, owner_id, asset_id) on delete restrict
);

create table channelwright.render_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_project_id uuid not null,
  render_input_id uuid not null,
  status channelwright.render_job_status not null default 'QUEUED',
  priority integer not null default 100 check (priority between 0 and 1000),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
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
  foreign key (render_input_id, owner_id, video_project_id) references channelwright.render_input_versions(id, owner_id, video_project_id) on delete restrict,
  unique (render_input_id),
  unique (id, owner_id, video_project_id)
);

create table channelwright.render_job_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  render_job_id uuid not null,
  video_project_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  worker_id text not null,
  lease_token uuid not null,
  status text not null check (status in ('STARTED', 'SUCCEEDED', 'FAILED', 'LEASE_EXPIRED', 'CANCELLED')),
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (render_job_id, owner_id, video_project_id) references channelwright.render_jobs(id, owner_id, video_project_id) on delete cascade,
  unique (render_job_id, attempt_number),
  unique (render_job_id, lease_token)
);

create table channelwright.production_master_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_project_id uuid not null,
  render_input_id uuid not null,
  render_job_id uuid not null,
  version_number integer not null check (version_number > 0),
  status channelwright.production_master_status not null default 'INSPECTION_PENDING',
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type = 'video/mp4'),
  byte_size bigint not null check (byte_size > 0),
  duration_seconds numeric(14,6) not null check (duration_seconds > 0),
  storage_bucket text not null check (storage_bucket = 'channelwright-private-media'),
  storage_key text not null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (render_input_id, owner_id, video_project_id) references channelwright.render_input_versions(id, owner_id, video_project_id) on delete restrict,
  foreign key (render_job_id, owner_id, video_project_id) references channelwright.render_jobs(id, owner_id, video_project_id) on delete restrict,
  check (storage_key like owner_id::text || '/masters/sha256/%'),
  unique (video_project_id, version_number),
  unique (render_job_id),
  unique (storage_bucket, storage_key),
  unique (id, owner_id, video_project_id, version_number)
);

create table channelwright.technical_media_inspections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_project_id uuid not null,
  master_id uuid not null,
  master_version integer not null,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  container text not null,
  video_codec text,
  audio_codec text,
  video_stream_count integer not null check (video_stream_count >= 0),
  audio_stream_count integer not null check (audio_stream_count >= 0),
  width integer,
  height integer,
  frame_rate numeric(12,6),
  pixel_format text,
  duration_seconds numeric(14,6) not null,
  file_size bigint not null,
  audio_sample_rate integer,
  audio_channels integer,
  integrated_loudness_lufs numeric(8,3),
  true_peak_dbfs numeric(8,3),
  max_volume_dbfs numeric(8,3),
  silence_ratio numeric(8,6) check (silence_ratio is null or silence_ratio between 0 and 1),
  inspection_payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (master_id, owner_id, video_project_id, master_version) references channelwright.production_master_versions(id, owner_id, video_project_id, version_number) on delete cascade,
  unique (master_id)
);

create table channelwright.media_qa_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_project_id uuid not null,
  master_id uuid not null,
  master_version integer not null,
  category channelwright.media_qa_category not null,
  version_number integer not null default 1 check (version_number > 0),
  verdict channelwright.media_qa_verdict not null,
  automated boolean not null,
  findings jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (master_id, owner_id, video_project_id, master_version) references channelwright.production_master_versions(id, owner_id, video_project_id, version_number) on delete cascade,
  check (created_by is null or created_by = owner_id),
  unique (master_id, category, version_number)
);

create table channelwright.production_master_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_project_id uuid not null,
  master_id uuid not null,
  master_version integer not null,
  decision text not null check (decision in ('APPROVE', 'REQUEST_CHANGES', 'REJECT')),
  feedback text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (master_id, owner_id, video_project_id, master_version) references channelwright.production_master_versions(id, owner_id, video_project_id, version_number) on delete restrict,
  check (created_by = owner_id)
);

create table channelwright.production_idempotency (
  owner_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 300),
  input_fingerprint text not null check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  result_payload jsonb not null,
  completed_at timestamptz not null default now(),
  primary key (owner_id, idempotency_key)
);

create index media_asset_versions_owner_idx on channelwright.media_asset_versions(owner_id, created_at desc);
create index render_inputs_video_idx on channelwright.render_input_versions(owner_id, video_project_id, version_number desc);
create index render_jobs_claim_idx on channelwright.render_jobs(status, available_at, priority desc, created_at);
create index render_jobs_owner_idx on channelwright.render_jobs(owner_id, updated_at desc);
create index render_attempts_job_idx on channelwright.render_job_attempts(render_job_id, attempt_number desc);
create index masters_video_idx on channelwright.production_master_versions(owner_id, video_project_id, version_number desc);
create index qa_master_idx on channelwright.media_qa_reports(master_id, category, version_number desc);

create trigger media_assets_set_updated_at before update on channelwright.media_assets for each row execute function channelwright.set_updated_at();
create trigger render_jobs_set_updated_at before update on channelwright.render_jobs for each row execute function channelwright.set_updated_at();

alter table channelwright.media_assets enable row level security;
alter table channelwright.media_asset_versions enable row level security;
alter table channelwright.render_input_versions enable row level security;
alter table channelwright.render_input_assets enable row level security;
alter table channelwright.render_jobs enable row level security;
alter table channelwright.render_job_attempts enable row level security;
alter table channelwright.production_master_versions enable row level security;
alter table channelwright.technical_media_inspections enable row level security;
alter table channelwright.media_qa_reports enable row level security;
alter table channelwright.production_master_approvals enable row level security;
alter table channelwright.production_idempotency enable row level security;

create policy media_assets_owner_select on channelwright.media_assets for select using (owner_id = auth.uid());
create policy media_assets_owner_insert on channelwright.media_assets for insert with check (owner_id = auth.uid());
create policy media_assets_owner_update on channelwright.media_assets for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy media_asset_versions_owner_select on channelwright.media_asset_versions for select using (owner_id = auth.uid());
create policy media_asset_versions_owner_insert on channelwright.media_asset_versions for insert with check (owner_id = auth.uid());
create policy render_inputs_owner_select on channelwright.render_input_versions for select using (owner_id = auth.uid());
create policy render_inputs_owner_insert on channelwright.render_input_versions for insert with check (owner_id = auth.uid());
create policy render_input_assets_owner_select on channelwright.render_input_assets for select using (owner_id = auth.uid());
create policy render_input_assets_owner_insert on channelwright.render_input_assets for insert with check (owner_id = auth.uid());
create policy render_jobs_owner_select on channelwright.render_jobs for select using (owner_id = auth.uid());
create policy render_jobs_owner_insert on channelwright.render_jobs for insert with check (owner_id = auth.uid());
create policy render_jobs_owner_update on channelwright.render_jobs for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy render_attempts_owner_select on channelwright.render_job_attempts for select using (owner_id = auth.uid());
create policy masters_owner_select on channelwright.production_master_versions for select using (owner_id = auth.uid());
create policy inspections_owner_select on channelwright.technical_media_inspections for select using (owner_id = auth.uid());
create policy media_qa_owner_select on channelwright.media_qa_reports for select using (owner_id = auth.uid());
create policy media_qa_owner_insert on channelwright.media_qa_reports for insert with check (owner_id = auth.uid() and created_by = auth.uid() and automated = false);
create policy master_approvals_owner_select on channelwright.production_master_approvals for select using (owner_id = auth.uid());
create policy master_approvals_owner_insert on channelwright.production_master_approvals for insert with check (owner_id = auth.uid() and created_by = auth.uid());
create policy production_idempotency_owner_select on channelwright.production_idempotency for select using (owner_id = auth.uid());
create policy production_idempotency_owner_insert on channelwright.production_idempotency for insert with check (owner_id = auth.uid());

revoke all on channelwright.media_assets, channelwright.media_asset_versions, channelwright.render_input_versions, channelwright.render_input_assets,
  channelwright.render_jobs, channelwright.render_job_attempts, channelwright.production_master_versions, channelwright.technical_media_inspections,
  channelwright.media_qa_reports, channelwright.production_master_approvals, channelwright.production_idempotency from anon, authenticated;
grant select on channelwright.media_assets, channelwright.media_asset_versions, channelwright.render_input_versions, channelwright.render_input_assets,
  channelwright.render_jobs, channelwright.render_job_attempts, channelwright.production_master_versions, channelwright.technical_media_inspections,
  channelwright.media_qa_reports, channelwright.production_master_approvals to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('channelwright-private-media', 'channelwright-private-media', false, 524288000,
  array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm','audio/wav','audio/mpeg','audio/mp4','audio/aac','audio/ogg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy channelwright_media_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'channelwright-private-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Uploads, moves, signing, and deletion are performed only by trusted server code using service_role.

create or replace function channelwright.register_media_asset_version(
  p_idempotency_key text,
  p_input_fingerprint text,
  p_asset jsonb
) returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare
  v_owner uuid := auth.uid(); v_prior channelwright.production_idempotency%rowtype;
  v_asset_id uuid; v_version_id uuid; v_result jsonb; v_kind channelwright.media_asset_kind;
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_idempotency_key, 0));
  select * into v_prior from channelwright.production_idempotency where owner_id = v_owner and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.input_fingerprint <> p_input_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT: key reused with different asset input'; end if;
    return v_prior.result_payload;
  end if;
  if coalesce(p_asset->>'storageBucket','') <> 'channelwright-private-media'
     or coalesce(p_asset->>'storageKey','') not like v_owner::text || '/assets/sha256/%'
     or coalesce(p_asset->>'checksumSha256','') !~ '^[a-f0-9]{64}$'
  then raise exception 'NOT_ALLOWED: invalid private asset storage record'; end if;
  v_kind := (p_asset->>'kind')::channelwright.media_asset_kind;
  select mav.asset_id, mav.id into v_asset_id, v_version_id
    from channelwright.media_asset_versions mav
    where mav.owner_id = v_owner and mav.checksum_sha256 = p_asset->>'checksumSha256' and mav.mime_type = p_asset->>'mimeType';
  if v_asset_id is null then
    insert into channelwright.media_assets(owner_id, kind, status) values (v_owner, v_kind, 'READY') returning id into v_asset_id;
    insert into channelwright.media_asset_versions(owner_id, asset_id, version_number, kind, status, provider, provenance, rights_status, license_reference, checksum_sha256, mime_type, byte_size, duration_seconds, width, height, storage_bucket, storage_key)
    values (v_owner, v_asset_id, 1, v_kind, 'READY', p_asset->>'provider', coalesce(p_asset->'provenance','{}'::jsonb), (p_asset->>'rightsStatus')::channelwright.media_rights_status,
      p_asset->>'licenseReference', p_asset->>'checksumSha256', p_asset->>'mimeType', (p_asset->>'byteSize')::bigint,
      nullif(p_asset->>'durationSeconds','')::numeric, nullif(p_asset->>'width','')::integer, nullif(p_asset->>'height','')::integer,
      p_asset->>'storageBucket', p_asset->>'storageKey') returning id into v_version_id;
  end if;
  v_result := jsonb_build_object('assetId', v_asset_id, 'assetVersionId', v_version_id, 'status', 'READY', 'evidence', 'SUPABASE_STORAGE');
  insert into channelwright.production_idempotency(owner_id, idempotency_key, input_fingerprint, result_payload) values (v_owner, p_idempotency_key, p_input_fingerprint, v_result);
  return v_result;
end $$;

create or replace function channelwright.execute_media_production_action(
  p_idempotency_key text,
  p_input_fingerprint text,
  p_action jsonb
) returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare
  v_owner uuid := auth.uid(); v_prior channelwright.production_idempotency%rowtype; v_type text := p_action->>'type';
  v_video uuid; v_script_version integer; v_script_id uuid; v_input_id uuid; v_job_id uuid; v_master_id uuid;
  v_version integer; v_result jsonb; v_asset_count integer; v_valid_count integer; v_job channelwright.render_jobs%rowtype;
begin
  if v_owner is null then raise exception 'NOT_ALLOWED: authenticated owner required'; end if;
  if char_length(p_idempotency_key) not between 1 and 300 or p_input_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'NOT_ALLOWED: invalid idempotency input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_idempotency_key, 0));
  select * into v_prior from channelwright.production_idempotency where owner_id = v_owner and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.input_fingerprint <> p_input_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT: key reused with different workflow input'; end if;
    return v_prior.result_payload;
  end if;

  if v_type = 'CREATE_RENDER_JOB' then
    v_video := (p_action->>'videoId')::uuid; v_script_version := (p_action->>'scriptVersion')::integer;
    perform 1 from channelwright.video_projects where id = v_video and owner_id = v_owner for update;
    if not found then raise exception 'NOT_FOUND: video project'; end if;
    select sv.id into v_script_id from channelwright.script_versions sv
      where sv.video_project_id = v_video and sv.version_number = v_script_version
      and exists (select 1 from channelwright.script_approvals sa where sa.video_project_id = v_video and sa.script_version_id = sv.id and sa.created_by = v_owner and sa.decision = 'APPROVE');
    if v_script_id is null then raise exception 'NOT_ALLOWED: exact script version is not approved'; end if;
    if (p_action->'renderInput'->>'videoId')::uuid <> v_video or (p_action->'renderInput'->>'approvedScriptVersion')::integer <> v_script_version then raise exception 'NOT_ALLOWED: render input source mismatch'; end if;
    v_asset_count := jsonb_array_length(coalesce(p_action->'assetVersionIds','[]'::jsonb));
    select count(*) into v_valid_count from channelwright.media_asset_versions mav
      where mav.owner_id = v_owner and mav.id in (select value::uuid from jsonb_array_elements_text(coalesce(p_action->'assetVersionIds','[]'::jsonb)))
      and mav.status = 'READY' and mav.rights_status = 'VERIFIED';
    if v_asset_count <> v_valid_count then raise exception 'NOT_ALLOWED: one or more render assets are missing, unowned, quarantined, or rights-blocked'; end if;
    select coalesce(max(version_number), 0) + 1 into v_version from channelwright.render_input_versions where video_project_id = v_video;
    insert into channelwright.render_input_versions(owner_id, video_project_id, version_number, source_script_version_id, source_script_version, input_payload, input_hash)
      values (v_owner, v_video, v_version, v_script_id, v_script_version, p_action->'renderInput', encode(extensions.digest((p_action->'renderInput')::text, 'sha256'), 'hex')) returning id into v_input_id;
    insert into channelwright.render_input_assets(owner_id, render_input_id, video_project_id, asset_version_id, asset_id, role)
      select v_owner, v_input_id, v_video, mav.id, mav.asset_id,
        case mav.kind when 'NARRATION' then 'NARRATION' when 'MUSIC' then 'MUSIC' when 'IMAGE' then 'VISUAL' when 'VIDEO' then 'VISUAL' else 'OTHER' end
      from channelwright.media_asset_versions mav where mav.owner_id = v_owner and mav.id in (select value::uuid from jsonb_array_elements_text(coalesce(p_action->'assetVersionIds','[]'::jsonb)));
    insert into channelwright.render_jobs(owner_id, video_project_id, render_input_id) values (v_owner, v_video, v_input_id) returning id into v_job_id;
    insert into channelwright.audit_events(owner_id, entity_id, event_type, detail) values (v_owner, v_job_id, 'RENDER_JOB_QUEUED', jsonb_build_object('videoId', v_video, 'renderInputId', v_input_id, 'renderInputVersion', v_version, 'sourceScriptVersion', v_script_version));
    v_result := jsonb_build_object('jobId', v_job_id, 'renderInputId', v_input_id, 'renderInputVersion', v_version, 'status', 'QUEUED');
  elsif v_type = 'RETRY_RENDER_JOB' then
    select * into v_job from channelwright.render_jobs where id = (p_action->>'jobId')::uuid and owner_id = v_owner for update;
    if not found then raise exception 'NOT_FOUND: render job'; end if;
    if v_job.status not in ('FAILED','RETRY_WAIT') or v_job.attempt_count >= v_job.max_attempts then raise exception 'NOT_ALLOWED: render job is not retryable'; end if;
    update channelwright.render_jobs set status = 'QUEUED', available_at = now(), leased_by = null, lease_token = null, lease_expires_at = null, error_code = null, error_message = null where id = v_job.id;
    v_result := jsonb_build_object('jobId', v_job.id, 'status', 'QUEUED');
  elsif v_type = 'CANCEL_RENDER_JOB' then
    select * into v_job from channelwright.render_jobs where id = (p_action->>'jobId')::uuid and owner_id = v_owner for update;
    if not found then raise exception 'NOT_FOUND: render job'; end if;
    if v_job.status in ('SUCCEEDED','FAILED','CANCELLED') then raise exception 'NOT_ALLOWED: render job is already final'; end if;
    update channelwright.render_jobs set cancellation_requested_at = now(), status = case when status in ('QUEUED','RETRY_WAIT') then 'CANCELLED' else status end where id = v_job.id;
    v_result := jsonb_build_object('jobId', v_job.id, 'status', case when v_job.status in ('QUEUED','RETRY_WAIT') then 'CANCELLED' else 'CANCELLATION_REQUESTED' end);
  elsif v_type = 'RECORD_MASTER_QA' then
    v_master_id := (p_action->>'masterId')::uuid; v_version := (p_action->>'masterVersion')::integer;
    perform 1 from channelwright.production_master_versions where id = v_master_id and owner_id = v_owner and version_number = v_version for update;
    if not found then raise exception 'NOT_FOUND: production master version'; end if;
    if p_action->>'category' = 'TECHNICAL' then raise exception 'NOT_ALLOWED: technical QA is worker-inspection owned'; end if;
    insert into channelwright.media_qa_reports(owner_id, video_project_id, master_id, master_version, category, version_number, verdict, automated, findings, created_by)
      select v_owner, video_project_id, id, version_number, (p_action->>'category')::channelwright.media_qa_category,
        coalesce((select max(q.version_number) + 1 from channelwright.media_qa_reports q where q.master_id = v_master_id and q.category = (p_action->>'category')::channelwright.media_qa_category), 1),
        (p_action->>'verdict')::channelwright.media_qa_verdict, false,
        jsonb_build_array(jsonb_build_object('code','HUMAN_REVIEW','severity',case when p_action->>'verdict' = 'PASS' then 'INFO' else 'BLOCKER' end,'message',p_action->>'finding')), v_owner
      from channelwright.production_master_versions where id = v_master_id;
    update channelwright.production_master_versions pm set status = case when (
      select count(distinct q.category) = 6 and bool_and(q.verdict = 'PASS') from channelwright.media_qa_reports q
      where q.master_id = v_master_id and q.version_number = (select max(q2.version_number) from channelwright.media_qa_reports q2 where q2.master_id = q.master_id and q2.category = q.category)
    ) then 'REVIEW_REQUIRED'::channelwright.production_master_status else 'QA_BLOCKED'::channelwright.production_master_status end where pm.id = v_master_id;
    v_result := jsonb_build_object('masterId', v_master_id, 'masterVersion', v_version, 'category', p_action->>'category', 'verdict', p_action->>'verdict');
  elsif v_type = 'APPROVE_PRODUCTION_MASTER' then
    v_master_id := (p_action->>'masterId')::uuid; v_version := (p_action->>'masterVersion')::integer;
    perform 1 from channelwright.production_master_versions where id = v_master_id and owner_id = v_owner and version_number = v_version for update;
    if not found then raise exception 'NOT_FOUND: production master version'; end if;
    if (select count(distinct category) from channelwright.media_qa_reports q where q.master_id = v_master_id and q.verdict = 'PASS'
        and q.version_number = (select max(q2.version_number) from channelwright.media_qa_reports q2 where q2.master_id = q.master_id and q2.category = q.category)) <> 6
    then raise exception 'NOT_ALLOWED: every latest required QA category must pass'; end if;
    insert into channelwright.production_master_approvals(owner_id, video_project_id, master_id, master_version, decision, created_by)
      select v_owner, video_project_id, id, version_number, 'APPROVE', v_owner from channelwright.production_master_versions where id = v_master_id;
    update channelwright.production_master_versions set status = 'EXPORT_READY', approved_at = now() where id = v_master_id;
    v_result := jsonb_build_object('masterId', v_master_id, 'masterVersion', v_version, 'status', 'EXPORT_READY');
  else
    raise exception 'NOT_ALLOWED: unsupported media production action %', v_type;
  end if;
  insert into channelwright.production_idempotency(owner_id, idempotency_key, input_fingerprint, result_payload) values (v_owner, p_idempotency_key, p_input_fingerprint, v_result);
  return v_result;
end $$;

create or replace function channelwright.claim_render_job(p_worker_id text, p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare v_job channelwright.render_jobs%rowtype; v_token uuid := gen_random_uuid(); v_assets jsonb;
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: worker service role required'; end if;
  if char_length(p_worker_id) not between 1 and 200 or p_lease_seconds not between 30 and 900 then raise exception 'NOT_ALLOWED: invalid worker lease'; end if;
  update channelwright.render_job_attempts a set status = 'LEASE_EXPIRED', error_code = 'LEASE_EXPIRED', completed_at = now()
    from channelwright.render_jobs j where a.render_job_id = j.id and a.lease_token = j.lease_token and a.status = 'STARTED' and j.status = 'LEASED' and j.lease_expires_at <= now();
  update channelwright.render_jobs set status = case when attempt_count >= max_attempts then 'FAILED'::channelwright.render_job_status else 'RETRY_WAIT'::channelwright.render_job_status end,
    available_at = now(), leased_by = null, lease_token = null, lease_expires_at = null, error_code = 'LEASE_EXPIRED', error_message = 'Worker lease expired before completion'
    where status = 'LEASED' and lease_expires_at <= now();
  select * into v_job from channelwright.render_jobs where status in ('QUEUED','RETRY_WAIT') and available_at <= now() and attempt_count < max_attempts and cancellation_requested_at is null
    order by priority desc, created_at for update skip locked limit 1;
  if not found then return null; end if;
  update channelwright.render_jobs set status = 'LEASED', attempt_count = attempt_count + 1, leased_by = p_worker_id, lease_token = v_token,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds), last_heartbeat_at = now()
    where id = v_job.id returning * into v_job;
  insert into channelwright.render_job_attempts(owner_id, render_job_id, video_project_id, attempt_number, worker_id, lease_token, status)
    values (v_job.owner_id, v_job.id, v_job.video_project_id, v_job.attempt_count, p_worker_id, v_token, 'STARTED');
  select coalesce(jsonb_agg(jsonb_build_object('id', mav.id, 'ownerId', mav.owner_id, 'storageKey', mav.storage_key, 'checksumSha256', mav.checksum_sha256,
    'mimeType', mav.mime_type, 'byteSize', mav.byte_size, 'status', mav.status, 'rightsStatus', mav.rights_status)), '[]'::jsonb) into v_assets
    from channelwright.render_input_assets ria join channelwright.media_asset_versions mav on mav.id = ria.asset_version_id where ria.render_input_id = v_job.render_input_id;
  return jsonb_build_object('id', v_job.id, 'ownerId', v_job.owner_id, 'renderInputId', v_job.render_input_id, 'status', v_job.status,
    'attemptCount', v_job.attempt_count, 'maxAttempts', v_job.max_attempts, 'availableAt', v_job.available_at, 'leasedBy', v_job.leased_by,
    'leaseToken', v_token, 'leaseExpiresAt', v_job.lease_expires_at, 'lastHeartbeatAt', v_job.last_heartbeat_at,
    'cancellationRequestedAt', v_job.cancellation_requested_at, 'errorCode', v_job.error_code, 'errorMessage', v_job.error_message,
    'createdAt', v_job.created_at, 'updatedAt', v_job.updated_at,
    'input', (select input_payload from channelwright.render_input_versions where id = v_job.render_input_id), 'assets', v_assets);
end $$;

create or replace function channelwright.heartbeat_render_job(p_job_id uuid, p_lease_token uuid, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = channelwright, pg_temp as $$
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: worker service role required'; end if;
  if p_lease_seconds not between 30 and 900 then raise exception 'NOT_ALLOWED: invalid worker lease'; end if;
  if exists (select 1 from channelwright.render_jobs where id = p_job_id and lease_token = p_lease_token and status = 'LEASED' and lease_expires_at > now() and cancellation_requested_at is not null) then
    update channelwright.render_jobs set status = 'CANCELLED', leased_by = null, lease_token = null, lease_expires_at = null where id = p_job_id and lease_token = p_lease_token;
    update channelwright.render_job_attempts set status = 'CANCELLED', completed_at = now() where render_job_id = p_job_id and lease_token = p_lease_token;
    return false;
  end if;
  update channelwright.render_jobs set last_heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    where id = p_job_id and lease_token = p_lease_token and status = 'LEASED' and lease_expires_at > now();
  return found;
end $$;

create or replace function channelwright.fail_render_job(p_job_id uuid, p_lease_token uuid, p_error_code text, p_error_message text, p_retryable boolean)
returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare v_job channelwright.render_jobs%rowtype; v_retry boolean;
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: worker service role required'; end if;
  select * into v_job from channelwright.render_jobs where id = p_job_id and lease_token = p_lease_token and status = 'LEASED' and lease_expires_at > now() for update;
  if not found then raise exception 'NOT_ALLOWED: render lease is not active'; end if;
  v_retry := p_retryable and v_job.attempt_count < v_job.max_attempts;
  update channelwright.render_jobs set status = case when v_retry then 'RETRY_WAIT'::channelwright.render_job_status else 'FAILED'::channelwright.render_job_status end,
    available_at = now() + make_interval(secs => case when v_retry then least(60, power(2, v_job.attempt_count)::integer) else 0 end),
    leased_by = null, lease_token = null, lease_expires_at = null, error_code = left(p_error_code, 120), error_message = left(p_error_message, 4000) where id = p_job_id returning * into v_job;
  update channelwright.render_job_attempts set status = 'FAILED', error_code = left(p_error_code,120), error_message = left(p_error_message,4000), completed_at = now()
    where render_job_id = p_job_id and lease_token = p_lease_token;
  return to_jsonb(v_job);
end $$;

create or replace function channelwright.complete_render_job(p_job_id uuid, p_lease_token uuid, p_completion jsonb)
returns jsonb language plpgsql security definer set search_path = channelwright, pg_temp as $$
declare v_job channelwright.render_jobs%rowtype; v_existing channelwright.production_master_versions%rowtype; v_master_id uuid; v_version integer; v_inspection jsonb; v_report jsonb; v_all_pass boolean;
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: worker service role required'; end if;
  select * into v_existing from channelwright.production_master_versions where render_job_id = p_job_id;
  if found then
    if exists (select 1 from channelwright.render_job_attempts where render_job_id = p_job_id and lease_token = p_lease_token and status = 'SUCCEEDED') then
      return jsonb_build_object('masterId', v_existing.id, 'version', v_existing.version_number);
    end if;
    raise exception 'NOT_ALLOWED: completion belongs to a different render lease';
  end if;
  select * into v_job from channelwright.render_jobs where id = p_job_id and lease_token = p_lease_token and status = 'LEASED' and lease_expires_at > now() and cancellation_requested_at is null for update;
  if not found then raise exception 'NOT_ALLOWED: render lease is not active'; end if;
  if p_completion->>'storageBucket' <> 'channelwright-private-media' or p_completion->>'storageKey' not like v_job.owner_id::text || '/masters/sha256/%' then raise exception 'NOT_ALLOWED: invalid durable master key'; end if;
  perform 1 from channelwright.video_projects where id = v_job.video_project_id for update;
  select coalesce(max(version_number),0)+1 into v_version from channelwright.production_master_versions where video_project_id = v_job.video_project_id;
  insert into channelwright.production_master_versions(owner_id, video_project_id, render_input_id, render_job_id, version_number, status, checksum_sha256, mime_type, byte_size, duration_seconds, storage_bucket, storage_key)
    values (v_job.owner_id, v_job.video_project_id, v_job.render_input_id, v_job.id, v_version, 'INSPECTION_PENDING', p_completion->>'checksumSha256', 'video/mp4',
      (p_completion->>'byteSize')::bigint, (p_completion->>'durationSeconds')::numeric, p_completion->>'storageBucket', p_completion->>'storageKey') returning id into v_master_id;
  v_inspection := p_completion->'inspection';
  if v_inspection->>'checksumSha256' <> p_completion->>'checksumSha256' then raise exception 'NOT_ALLOWED: inspection checksum does not match uploaded master'; end if;
  insert into channelwright.technical_media_inspections(owner_id, video_project_id, master_id, master_version, checksum_sha256, container, video_codec, audio_codec, video_stream_count, audio_stream_count, width, height, frame_rate, pixel_format, duration_seconds, file_size, audio_sample_rate, audio_channels, integrated_loudness_lufs, true_peak_dbfs, max_volume_dbfs, silence_ratio, inspection_payload)
    values (v_job.owner_id, v_job.video_project_id, v_master_id, v_version, v_inspection->>'checksumSha256', v_inspection->>'container', v_inspection->>'videoCodec', v_inspection->>'audioCodec',
      (v_inspection->>'videoStreamCount')::integer, (v_inspection->>'audioStreamCount')::integer, nullif(v_inspection->>'width','')::integer, nullif(v_inspection->>'height','')::integer,
      nullif(v_inspection->>'frameRate','')::numeric, v_inspection->>'pixelFormat', (v_inspection->>'durationSeconds')::numeric, (v_inspection->>'fileSize')::bigint,
      nullif(v_inspection->>'audioSampleRate','')::integer, nullif(v_inspection->>'audioChannels','')::integer, nullif(v_inspection->>'integratedLoudnessLufs','')::numeric,
      nullif(v_inspection->>'truePeakDbfs','')::numeric, nullif(v_inspection->>'maxVolumeDbfs','')::numeric, nullif(v_inspection->>'silenceRatio','')::numeric, v_inspection);
  for v_report in select value from jsonb_array_elements(p_completion->'qaReports') loop
    insert into channelwright.media_qa_reports(owner_id, video_project_id, master_id, master_version, category, verdict, automated, findings)
      values (v_job.owner_id, v_job.video_project_id, v_master_id, v_version, (v_report->>'category')::channelwright.media_qa_category, (v_report->>'verdict')::channelwright.media_qa_verdict, (v_report->>'automated')::boolean, coalesce(v_report->'findings','[]'::jsonb));
  end loop;
  select count(*) = 6 and bool_and(verdict = 'PASS') into v_all_pass from channelwright.media_qa_reports where master_id = v_master_id;
  update channelwright.production_master_versions set status = case when v_all_pass then 'REVIEW_REQUIRED'::channelwright.production_master_status else 'QA_BLOCKED'::channelwright.production_master_status end where id = v_master_id;
  update channelwright.render_jobs set status = 'SUCCEEDED', leased_by = null, lease_token = null, lease_expires_at = null where id = p_job_id;
  update channelwright.render_job_attempts set status = 'SUCCEEDED', completed_at = now() where render_job_id = p_job_id and lease_token = p_lease_token;
  insert into channelwright.audit_events(owner_id, entity_id, event_type, detail) values (v_job.owner_id, v_master_id, 'PRODUCTION_MASTER_CREATED', jsonb_build_object('videoId', v_job.video_project_id, 'masterVersion', v_version, 'status', case when v_all_pass then 'REVIEW_REQUIRED' else 'QA_BLOCKED' end));
  return jsonb_build_object('masterId', v_master_id, 'version', v_version);
end $$;

create or replace function channelwright.inspect_media_storage_reconciliation()
returns jsonb language plpgsql security definer set search_path = channelwright, storage, pg_temp as $$
declare v_result jsonb;
begin
  if session_user <> 'postgres' and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'NOT_ALLOWED: worker service role required'; end if;
  with database_objects as (
    select storage_key from channelwright.media_asset_versions
    union
    select storage_key from channelwright.production_master_versions
  ), missing_storage as (
    select d.storage_key
    from database_objects d
    left join storage.objects o on o.bucket_id = 'channelwright-private-media' and o.name = d.storage_key
    where o.id is null
  ), orphaned_storage as (
    select o.name as storage_key
    from storage.objects o
    left join database_objects d on d.storage_key = o.name
    where o.bucket_id = 'channelwright-private-media' and d.storage_key is null
  )
  select jsonb_build_object(
    'missingStorageObjects', coalesce((select jsonb_agg(storage_key order by storage_key) from missing_storage), '[]'::jsonb),
    'orphanedStorageObjects', coalesce((select jsonb_agg(storage_key order by storage_key) from orphaned_storage), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

revoke all on function channelwright.register_media_asset_version(text,text,jsonb) from public, anon;
revoke all on function channelwright.execute_media_production_action(text,text,jsonb) from public, anon;
grant execute on function channelwright.register_media_asset_version(text,text,jsonb) to authenticated;
grant execute on function channelwright.execute_media_production_action(text,text,jsonb) to authenticated;
revoke all on function channelwright.claim_render_job(text,integer), channelwright.heartbeat_render_job(uuid,uuid,integer), channelwright.fail_render_job(uuid,uuid,text,text,boolean), channelwright.complete_render_job(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function channelwright.claim_render_job(text,integer), channelwright.heartbeat_render_job(uuid,uuid,integer), channelwright.fail_render_job(uuid,uuid,text,text,boolean), channelwright.complete_render_job(uuid,uuid,jsonb) to service_role;
revoke all on function channelwright.inspect_media_storage_reconciliation() from public, anon, authenticated;
grant execute on function channelwright.inspect_media_storage_reconciliation() to service_role;
