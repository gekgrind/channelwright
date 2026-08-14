-- Harden the shared-schema API surface and use init-plan friendly auth checks.

alter default privileges for role postgres in schema channelwright
  revoke execute on functions from public;

alter function channelwright.set_updated_at() set search_path = pg_catalog;

do $$
declare
  policy_record record;
  altered_qual text;
  altered_check text;
  statement text;
begin
  for policy_record in
    select
      p.polname,
      n.nspname as schema_name,
      c.relname as table_name,
      pg_get_expr(p.polqual, p.polrelid) as using_expression,
      pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'channelwright'
       or (n.nspname = 'storage' and c.relname = 'objects' and p.polname = 'channelwright_media_owner_read')
  loop
    altered_qual := case
      when policy_record.using_expression is null then null
      else replace(policy_record.using_expression, 'auth.uid()', '(select auth.uid())')
    end;
    altered_check := case
      when policy_record.check_expression is null then null
      else replace(policy_record.check_expression, 'auth.uid()', '(select auth.uid())')
    end;

    if altered_qual is distinct from policy_record.using_expression
       or altered_check is distinct from policy_record.check_expression then
      statement := format(
        'alter policy %I on %I.%I',
        policy_record.polname,
        policy_record.schema_name,
        policy_record.table_name
      );
      if altered_qual is not null then
        statement := statement || format(' using (%s)', altered_qual);
      end if;
      if altered_check is not null then
        statement := statement || format(' with check (%s)', altered_check);
      end if;
      execute statement;
    end if;
  end loop;
end $$;

alter table channelwright.channel_concept_versions
  drop constraint if exists concept_versions_id_channel_unique;
