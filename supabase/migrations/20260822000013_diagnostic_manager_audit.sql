create or replace function public.debug_list_policies(target_tables text[])
returns table(table_name text, policy_name text, cmd text, roles text, using_expr text, check_expr text)
language sql
security definer
set search_path = public
as $$
  select tablename::text, policyname::text, cmd::text, roles::text,
         coalesce(qual, '')::text, coalesce(with_check, '')::text
  from pg_policies
  where schemaname = 'public' and tablename = any(target_tables);
$$;

create or replace function public.debug_list_functions()
returns table(function_name text, arguments text)
language sql
security definer
set search_path = public
as $$
  select p.proname::text, pg_get_function_identity_arguments(p.oid)::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname ilike '%manager%' or p.proname ilike 'is_%' or p.proname ilike 'current_%';
$$;
