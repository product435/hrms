-- Temporary read-only diagnostic RPC to inspect live RLS policies from the
-- application (no direct psql/pg_dump access available in this environment).
-- Dropped by a follow-up migration once no longer needed.
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
