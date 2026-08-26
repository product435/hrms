create or replace function public.debug_schema_audit(p_table text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'columns', (
      select jsonb_agg(jsonb_build_object('column_name', column_name, 'data_type', data_type, 'is_nullable', is_nullable))
      from information_schema.columns
      where table_schema = 'public' and table_name = p_table
    ),
    'policies', (
      select jsonb_agg(jsonb_build_object(
        'policyname', policyname,
        'cmd', cmd,
        'roles', roles,
        'qual', qual,
        'with_check', with_check
      ))
      from pg_policies
      where schemaname = 'public' and tablename = p_table
    ),
    'check_constraints', (
      select jsonb_agg(jsonb_build_object('conname', conname, 'definition', pg_get_constraintdef(oid)))
      from pg_constraint
      where conrelid = ('public.' || p_table)::regclass and contype = 'c'
    ),
    'row_count', (
      select count(*) from (select 1 from information_schema.tables where table_schema='public' and table_name=p_table) t
    )
  );
end;
$$;

create or replace function public.debug_row_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb := '{}'::jsonb; t text; c bigint;
begin
  foreach t in array array['job_openings','candidates','job_applications','performance_reviews'] loop
    execute format('select count(*) from public.%I', t) into c;
    result := result || jsonb_build_object(t, c);
  end loop;
  return result;
end;
$$;

create or replace function public.debug_cycle_tables()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_agg(table_name)
  from information_schema.tables
  where table_schema = 'public' and (table_name ilike '%cycle%' or table_name ilike '%review_period%');
$$;
