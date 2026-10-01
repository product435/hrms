-- Narrow directory for project membership pickers.
-- Security definer so a department head, team lead, or project owner/manager
-- can see every active employee in their organisation. Employee-table SELECT
-- policies stay unchanged, so salary, documents, and payroll are not exposed.
-- Callers who are only employees (and do not manage a project) get no rows.

create or replace function public.project_member_directory()
returns table (
  id uuid,
  full_name text,
  department_name text,
  department_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.dwr_actor_org();
begin
  if v_org is null then
    return;
  end if;

  -- admin/hr and department heads / team leads, or anyone who can manage
  -- at least one project in this organisation. A plain employee role fails here.
  if not (
    public.current_user_role() in ('admin', 'hr')
    or public.is_lead()
    or exists (
      select 1
      from public.projects p
      where p.organization_id = v_org
        and public.can_manage_project(p.id)
    )
  ) then
    return;
  end if;

  return query
  select
    e.id,
    nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), '') as full_name,
    d.name as department_name,
    e.department_id
  from public.employees e
  left join public.departments d
    on d.id = e.department_id
   and d.organization_id = e.organization_id
  where e.organization_id = v_org
    and lower(coalesce(e.employment_status, 'active')) in (
      'active', 'probation', 'notice', 'on-leave'
    )
  order by 2 nulls last, 1;
end;
$$;

revoke all on function public.project_member_directory() from public, anon;
grant execute on function public.project_member_directory() to authenticated, service_role;
