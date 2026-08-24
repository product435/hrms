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

create or replace function public.debug_employee_row(p_profile_id uuid)
returns table(
  profile_id uuid, profile_role text, profile_employee_id uuid,
  employee_id uuid, employee_org_id uuid, employee_profile_id uuid,
  employee_email text, employee_status text
)
language sql
security definer
set search_path = public
as $$
  select
    p.id, p.role, p.employee_id,
    e.id, e.organization_id, e.profile_id, e.email, e.employment_status
  from public.profiles p
  left join public.employees e on e.profile_id = p.id
  where p.id = p_profile_id;
$$;
