-- Sunday is the only week off. Saturday is a working day.
-- Active employees are placed on Morning Shift from 2026-10-01 so earlier
-- Saturdays are not treated as absent. New employees default to the
-- organisation's single active shift.

update public.shifts
set week_offs = array['Sunday']::text[]
where id = '77777777-7777-7777-7777-777777777771';

update public.organization_settings
set working_days = array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']::text[]
where organization_id = (
  select s.organization_id
  from public.shifts s
  where s.id = '77777777-7777-7777-7777-777777777771'
);

insert into public.employee_shifts (employee_id, shift_id, effective_from)
select e.id, '77777777-7777-7777-7777-777777777771'::uuid, date '2026-10-01'
from public.employees e
where e.organization_id = (
    select s.organization_id
    from public.shifts s
    where s.id = '77777777-7777-7777-7777-777777777771'
  )
  and coalesce(e.employment_status, 'active') not in (
    'resigned', 'terminated', 'inactive', 'rejected', 'exited', 'pending_approval', 'profile_changes_requested'
  )
on conflict (employee_id, effective_from)
do update set shift_id = excluded.shift_id
where public.employee_shifts.shift_id is distinct from excluded.shift_id;

-- employee_shifts_sync_current sets employees.shift_id from the dated row.
-- Set it here as well so a row is correct even if that trigger is absent.
update public.employees e
set shift_id = '77777777-7777-7777-7777-777777777771'::uuid
where e.organization_id = (
    select s.organization_id
    from public.shifts s
    where s.id = '77777777-7777-7777-7777-777777777771'
  )
  and coalesce(e.employment_status, 'active') not in (
    'resigned', 'terminated', 'inactive', 'rejected', 'exited', 'pending_approval', 'profile_changes_requested'
  )
  and e.shift_id is distinct from '77777777-7777-7777-7777-777777777771'::uuid;

create or replace function public.employees_default_org_shift()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift uuid;
  v_active integer;
begin
  if tg_op <> 'INSERT' or new.shift_id is not null or new.organization_id is null then
    return new;
  end if;

  if to_regclass('public.shifts') is null then
    return new;
  end if;

  select count(*)::integer
    into v_active
  from public.shifts s
  where s.organization_id = new.organization_id
    and coalesce(s.is_active, true);

  if v_active = 1 then
    select s.id
      into v_shift
    from public.shifts s
    where s.organization_id = new.organization_id
      and coalesce(s.is_active, true)
    limit 1;
  elsif exists (
    select 1
    from public.shifts s
    where s.organization_id = new.organization_id
      and coalesce(s.is_active, true)
      and s.id = '77777777-7777-7777-7777-777777777771'::uuid
  ) then
    v_shift := '77777777-7777-7777-7777-777777777771'::uuid;
  end if;

  if v_shift is null then
    return new;
  end if;

  new.shift_id := v_shift;
  return new;
end;
$$;

drop trigger if exists employees_default_org_shift on public.employees;
create trigger employees_default_org_shift
  before insert on public.employees
  for each row
  execute function public.employees_default_org_shift();

create or replace function public.employees_default_org_shift_dated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date;
  v_month date;
begin
  if new.shift_id is null or new.id is null then
    return new;
  end if;

  if to_regclass('public.employee_shifts') is null then
    return new;
  end if;

  v_month := date_trunc('month', timezone('Asia/Kolkata', now()))::date;
  v_from := coalesce(new.joining_date, (timezone('Asia/Kolkata', now()))::date);
  if v_from < v_month then
    v_from := v_month;
  end if;

  insert into public.employee_shifts (employee_id, shift_id, effective_from)
  values (new.id, new.shift_id, v_from)
  on conflict (employee_id, effective_from)
  do update set shift_id = excluded.shift_id
  where public.employee_shifts.shift_id is distinct from excluded.shift_id;

  return new;
end;
$$;

drop trigger if exists employees_default_org_shift_dated on public.employees;
create trigger employees_default_org_shift_dated
  after insert on public.employees
  for each row
  execute function public.employees_default_org_shift_dated();

revoke all on function public.employees_default_org_shift() from public, anon, authenticated;
revoke all on function public.employees_default_org_shift_dated() from public, anon, authenticated;
grant execute on function public.employees_default_org_shift() to service_role;
grant execute on function public.employees_default_org_shift_dated() to service_role;
