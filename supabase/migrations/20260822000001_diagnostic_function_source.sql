-- See 20260822000000_diagnostic_list_policies.sql. Temporary read-only helper.
create or replace function public.debug_function_source(fn_name text)
returns text
language sql
security definer
set search_path = public
as $$
  select pg_get_functiondef(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = fn_name
  limit 1;
$$;

grant execute on function public.debug_function_source(text) to authenticated;
