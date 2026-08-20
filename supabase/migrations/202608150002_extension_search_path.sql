-- Repairs a runtime defect discovered during live verification of the
-- CHANNEL_VIDEO_BRIEF slice.
--
-- pgcrypto is installed in the `extensions` schema on Supabase, but the
-- approved-artifact resolvers and the approval function were created with
-- `set search_path = channelwright, pg_temp`. That excludes `extensions`, so
-- every runtime call to digest() inside them failed with:
--
--   ERROR: function digest(text, unknown) does not exist
--
-- Nothing caught this earlier because plpgsql resolves identifiers when the
-- function runs, not when it is created, so the migrations applied cleanly and
-- the text-based migration tests passed. The failure only appears the first
-- time an approved artifact is resolved or an approval is decided.
--
-- The whole Research -> Strategy -> Content Intelligence -> Video Brief
-- provenance chain depends on those calls, so all four are repaired here.
--
-- This is deliberately expressed as ALTER FUNCTION rather than by recreating
-- the bodies: it cannot drift from the definitions established in
-- 202608140001, 202608140003, and 202608150001, and it changes nothing except
-- name resolution. `public` remains excluded, so the search_path hardening that
-- motivated the narrow setting is preserved.

alter function channelwright.resolve_approved_research_artifact(uuid, uuid)
  set search_path = channelwright, extensions, pg_temp;

alter function channelwright.resolve_approved_strategy_artifact(uuid, uuid)
  set search_path = channelwright, extensions, pg_temp;

alter function channelwright.resolve_approved_content_artifact(uuid, uuid, text)
  set search_path = channelwright, extensions, pg_temp;

alter function channelwright.decide_workflow_approval(uuid, uuid, text, text)
  set search_path = channelwright, extensions, pg_temp;

-- Fail loudly if pgcrypto is ever relocated, rather than leaving the chain
-- silently broken again.
do $$
begin
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_extension e on e.extnamespace = n.oid
     where p.proname = 'digest' and e.extname = 'pgcrypto' and n.nspname = 'extensions'
  ) then
    raise exception 'PGCRYPTO_SCHEMA_UNEXPECTED: digest() is not in the extensions schema; the resolver search_path must be updated';
  end if;
end $$;
