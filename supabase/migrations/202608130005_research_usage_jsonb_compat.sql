-- Compatibility helper used by the applied durable-budget function.
-- PostgreSQL exposes jsonb_object_keys but not jsonb_object_length in every supported environment.

create or replace function channelwright.jsonb_object_length(p_value jsonb)
returns integer language sql immutable strict parallel safe set search_path = pg_catalog, pg_temp as $$
  select count(*)::integer from jsonb_object_keys(p_value)
$$;

revoke all on function channelwright.jsonb_object_length(jsonb) from public, anon, authenticated;
grant execute on function channelwright.jsonb_object_length(jsonb) to service_role;
