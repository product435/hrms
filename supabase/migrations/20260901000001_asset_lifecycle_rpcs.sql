-- Keep asset status, assignment history, and repair history consistent.
-- Employees may report a repair only for an asset currently assigned to them;
-- Admin/HR may report repairs and return assets within their organisation.

create or replace function public.request_asset_repair(
  p_asset_code text,
  p_issue text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_id uuid;
  v_repair_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select a.id
    into v_asset_id
    from public.assets a
   where a.asset_code = p_asset_code
     and a.organization_id = public.current_org_id();

  if v_asset_id is null then
    raise exception 'Asset not found';
  end if;

  if not public.is_admin_or_hr() and not exists (
    select 1
      from public.asset_assignments aa
     where aa.asset_id = v_asset_id
       and aa.employee_id = public.current_employee_id()
       and aa.returned_at is null
  ) then
    raise exception 'Asset is not assigned to the current employee';
  end if;

  insert into public.asset_repairs (asset_id, issue, sent_at, status, remarks)
  values (v_asset_id, nullif(trim(p_issue), ''), now(), 'sent', nullif(trim(p_issue), ''))
  returning id into v_repair_id;

  update public.assets set status = 'in-repair' where id = v_asset_id;
  return v_repair_id;
end;
$$;

create or replace function public.return_asset(p_asset_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_id uuid;
  v_assignment_id uuid;
begin
  if auth.uid() is null or not public.is_admin_or_hr() then
    raise exception 'Admin or HR access required';
  end if;

  select a.id
    into v_asset_id
    from public.assets a
   where a.asset_code = p_asset_code
     and a.organization_id = public.current_org_id();

  if v_asset_id is null then
    raise exception 'Asset not found';
  end if;

  update public.asset_assignments
     set returned_at = now(), returned_by = auth.uid()
   where id = (
     select aa.id
       from public.asset_assignments aa
      where aa.asset_id = v_asset_id and aa.returned_at is null
      order by aa.assigned_at desc nulls last
      limit 1
   )
  returning id into v_assignment_id;

  if v_assignment_id is null then
    raise exception 'No active assignment found';
  end if;

  update public.assets set status = 'available' where id = v_asset_id;
  return v_assignment_id;
end;
$$;

revoke all on function public.request_asset_repair(text, text) from public;
revoke all on function public.return_asset(text) from public;
grant execute on function public.request_asset_repair(text, text) to authenticated;
grant execute on function public.return_asset(text) to authenticated;
