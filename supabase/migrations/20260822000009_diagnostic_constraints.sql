create or replace function public.debug_check_constraints(target_tables text[])
returns table(table_name text, constraint_name text, definition text)
language sql
security definer
set search_path = public
as $$
  select rel.relname::text, con.conname::text, pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and con.contype = 'c'
    and rel.relname = any(target_tables);
$$;
