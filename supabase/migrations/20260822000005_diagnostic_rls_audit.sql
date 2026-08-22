-- Temporary read-only diagnostic for the full RLS audit. Dropped by a
-- follow-up migration once the audit's fixes are applied and verified.
create or replace function public.debug_list_policies(target_tables text[] default null)
returns table(tablename text, policyname text, cmd text, roles text, qual text, with_check text)
language sql
security definer
set search_path = public
as $$
  select tablename, policyname, cmd, roles::text, qual, with_check
  from pg_policies
  where schemaname = 'public'
    and (target_tables is null or tablename = any(target_tables))
  order by tablename, policyname;
$$;

grant execute on function public.debug_list_policies(text[]) to authenticated;
