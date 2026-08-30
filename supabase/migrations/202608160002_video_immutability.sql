-- Extends approved-artifact immutability to CHANNEL_VIDEO_BRIEF and
-- CHANNEL_VIDEO_SCRIPT. Forward-only: no previously applied migration is edited.
--
-- Defect: the shared immutability triggers (workflow_runs_protect_final_research,
-- workflow_steps_protect_final_research) were last defined in 202608140003 with a
-- workflow-type allow-list of ('CHANNEL_RESEARCH','CHANNEL_STRATEGY',
-- 'CHANNEL_CONTENT_INTELLIGENCE'). The video-brief and video-script migrations
-- hashed approved state but never widened that list, so a privileged/service-role
-- write could rewrite an approved VIDEO_BRIEF or VIDEO_SCRIPT run payload or a
-- finalized step output and re-stamp its hashes.
--
-- These triggers already exist and bind to the functions by name, so replacing
-- the function bodies (identical logic, widened allow-list) extends coverage
-- without touching triggers, RESEARCH/STRATEGY/CONTENT_INTELLIGENCE behaviour, or
-- the approval-immutability trigger (which is already workflow-type agnostic).
-- No digest() call here, so the narrow search_path is preserved.

create or replace function channelwright.protect_final_research_artifact()
returns trigger language plpgsql set search_path=channelwright,pg_temp as $$
begin
  if old.workflow_type in ('CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT')
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
    where r.id=old.workflow_run_id and r.workflow_type in ('CHANNEL_RESEARCH','CHANNEL_STRATEGY','CHANNEL_CONTENT_INTELLIGENCE','CHANNEL_VIDEO_BRIEF','CHANNEL_VIDEO_SCRIPT') and a.status in ('APPROVED','REJECTED','REVISION_REQUESTED'))
  then raise exception 'APPROVED_ARTIFACT_IMMUTABLE: finalized paid-workflow step output cannot be mutated'; end if;
  return new;
end $$;

revoke all on function channelwright.protect_final_research_artifact() from public, anon, authenticated;
revoke all on function channelwright.protect_final_research_step_output() from public, anon, authenticated;
