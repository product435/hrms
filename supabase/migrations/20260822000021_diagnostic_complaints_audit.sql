create or replace function public.debug_list_policies(target_tables text[])
returns table(table_name text, policy_name text, cmd text, using_expr text, check_expr text)
language sql
security definer
set search_path = public
as $$
  select tablename::text, policyname::text, cmd::text,
         coalesce(qual, '')::text, coalesce(with_check, '')::text
  from pg_policies
  where schemaname = 'public' and tablename = any(target_tables);
$$;
