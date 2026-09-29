-- Dated shift assignment.
-- Admin/HR assign employee_shifts through assign_employee_shift.
-- One row per employee and effective_from. An earlier open-ended row is
-- closed the day before the new start in the same transaction. A later
-- overlap is rejected. Punch times, attendance_records_self_update, and
-- attendance_records_self_insert stay as they are: employees still cannot
-- write check_in or check_out. punch_attendance still uses now() and still
-- punches only the caller. Late marking reads the shift effective on the
-- locked attendance date (Asia/Kolkata), not always today's assignment.

-- Keep the newest open row when the same start date was stored twice.
delete from public.employee_shifts
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by employee_id, effective_from
        order by (effective_to is null) desc, id desc
      ) as rn
    from public.employee_shifts
    where employee_id is not null
      and effective_from is not null
  ) ranked
  where rn > 1
);

create unique index if not exists employee_shifts_employee_effective_from_key
  on public.employee_shifts (employee_id, effective_from);

do $body$
begin
  if not exists (
    select 1
    from public.employee_shifts
    where effective_from is not null
      and effective_to is not null
      and effective_to < effective_from
  ) then
    alter table public.employee_shifts
      drop constraint if exists employee_shifts_effective_range_chk;
    alter table public.employee_shifts
      add constraint employee_shifts_effective_range_chk
      check (
        effective_to is null
        or effective_from is null
        or effective_to >= effective_from
      );
  end if;
end
$body$;

-- Employees must not grant themselves a shift. Admin/HR writes go through
-- assign_employee_shift. Self read stays.
drop policy if exists employee_shifts_self_insert on public.employee_shifts;

-- End at or before start is an overnight window, even when the flag was left off.
update public.shifts
set is_overnight = true
where start_time is not null
  and end_time is not null
  and end_time <= start_time
  and coalesce(is_overnight, false) = false;

create or replace function public.shifts_keep_overnight()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.start_time is not null
     and new.end_time is not null
     and new.end_time <= new.start_time then
    new.is_overnight := true;
  end if;
  return new;
end;
$$;

drop trigger if exists shifts_keep_overnight on public.shifts;
create trigger shifts_keep_overnight
  before insert or update of start_time, end_time, is_overnight
  on public.shifts
  for each row
  execute function public.shifts_keep_overnight();

create or replace function public.employee_shifts_guard_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Closing an earlier open row updates this table again. Do not re-enter.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.employee_id is null or new.shift_id is null or new.effective_from is null then
    raise exception 'Employee, shift, and effective from date are required.';
  end if;

  if new.effective_to is not null and new.effective_to < new.effective_from then
    raise exception 'Effective to must be on or after effective from.';
  end if;

  perform 1
  from public.employees
  where id = new.employee_id
  for update;

  if not exists (
    select 1
    from public.employees e
    join public.shifts s on s.id = new.shift_id
    where e.id = new.employee_id
      and e.organization_id is not null
      and e.organization_id = s.organization_id
  ) then
    raise exception 'Choose a shift from the employee''s organization.';
  end if;

  update public.employee_shifts
  set effective_to = new.effective_from - 1
  where employee_id = new.employee_id
    and id is distinct from new.id
    and effective_to is null
    and (effective_from is null or effective_from < new.effective_from);

  if exists (
    select 1
    from public.employee_shifts es
    where es.employee_id = new.employee_id
      and es.id is distinct from new.id
      and es.effective_from is distinct from new.effective_from
      and coalesce(es.effective_from, '-infinity'::date) <= coalesce(new.effective_to, 'infinity'::date)
      and new.effective_from <= coalesce(es.effective_to, 'infinity'::date)
  ) then
    raise exception 'This assignment overlaps another shift for this employee.';
  end if;

  return new;
end;
$$;

drop trigger if exists employee_shifts_guard_assignment on public.employee_shifts;
create trigger employee_shifts_guard_assignment
  before insert or update
  on public.employee_shifts
  for each row
  execute function public.employee_shifts_guard_assignment();

create or replace function public.employee_shifts_sync_current()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_shift uuid;
begin
  if pg_trigger_depth() > 1 or new.employee_id is null then
    return null;
  end if;

  v_shift := public.employee_shift_on(new.employee_id, v_today);

  -- The self-assignment guard otherwise freezes shift_id when an admin
  -- assigns their own row. The dated row stays the source of truth.
  perform set_config('app.allow_onboarding_write', 'on', true);

  update public.employees
  set shift_id = v_shift
  where id = new.employee_id
    and shift_id is distinct from v_shift;

  return null;
end;
$$;

drop trigger if exists employee_shifts_sync_current on public.employee_shifts;
create trigger employee_shifts_sync_current
  after insert or update
  on public.employee_shifts
  for each row
  execute function public.employee_shifts_sync_current();

create or replace function public.assign_employee_shift(
  p_employee_id uuid,
  p_shift_id uuid,
  p_effective_from date,
  p_effective_to date default null
)
returns public.employee_shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_shift_org uuid;
  v_row public.employee_shifts;
begin
  if auth.uid() is null or not public.is_admin_or_hr() then
    raise exception 'Only admin or HR can assign shifts.';
  end if;

  if p_employee_id is null or p_shift_id is null or p_effective_from is null then
    raise exception 'Employee, shift, and effective from date are required.';
  end if;

  if p_effective_to is not null and p_effective_to < p_effective_from then
    raise exception 'Effective to must be on or after effective from.';
  end if;

  select e.organization_id into v_org
  from public.employees e
  where e.id = p_employee_id;

  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'Employee is not in your organization.';
  end if;

  select s.organization_id into v_shift_org
  from public.shifts s
  where s.id = p_shift_id;

  if v_shift_org is null or v_shift_org is distinct from v_org then
    raise exception 'Choose a shift from your organization.';
  end if;

  insert into public.employee_shifts (employee_id, shift_id, effective_from, effective_to)
  values (p_employee_id, p_shift_id, p_effective_from, p_effective_to)
  on conflict (employee_id, effective_from)
  do update set
    shift_id = excluded.shift_id,
    effective_to = excluded.effective_to
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.shift_assigned_counts(p_on date default null)
returns table (shift_id uuid, assigned integer)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select coalesce(p_on, (timezone('Asia/Kolkata', now()))::date) as on_date
  )
  select resolved.shift_id, count(*)::integer as assigned
  from (
    select public.employee_shift_on(e.id, params.on_date) as shift_id
    from public.employees e
    cross join params
    where e.organization_id = public.current_org_id()
      and coalesce(e.employment_status, 'active') not in (
        'resigned', 'terminated', 'inactive', 'pending_approval', 'rejected', 'exited'
      )
  ) resolved
  where resolved.shift_id is not null
  group by resolved.shift_id;
$$;

revoke all on function public.shifts_keep_overnight() from public, anon;
revoke all on function public.employee_shifts_guard_assignment() from public, anon;
revoke all on function public.employee_shifts_sync_current() from public, anon;
grant execute on function public.shifts_keep_overnight() to authenticated, service_role;
grant execute on function public.employee_shifts_guard_assignment() to authenticated, service_role;
grant execute on function public.employee_shifts_sync_current() to authenticated, service_role;

revoke all on function public.assign_employee_shift(uuid, uuid, date, date) from public, anon;
grant execute on function public.assign_employee_shift(uuid, uuid, date, date) to authenticated, service_role;

revoke all on function public.shift_assigned_counts(date) from public, anon;
grant execute on function public.shift_assigned_counts(date) to authenticated, service_role;

comment on function public.assign_employee_shift(uuid, uuid, date, date) is
  'Assigns a shift from an effective date. Closes an earlier open assignment the day before, and rejects any remaining overlap.';

-- Late and scheduled hours follow the assignment on the attendance date.
-- Date selection (including an overnight window still belonging to yesterday)
-- stays in attendance_lock_day and still uses the shift effective today.
create or replace function public.punch_attendance(p_employee_id uuid, p_action text)
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.attendance_records%rowtype;
  v_now timestamptz := now();
  v_org uuid;
  v_shift uuid;
  v_start time := time '09:00';
  v_end time := time '18:00';
  v_break integer := 0;
  v_grace integer := 0;
  v_overnight boolean := false;
  v_remarks text;
  v_status text;
  v_shift_start timestamptz;
  v_worked numeric;
  v_scheduled numeric;
  v_overtime numeric;
  v_threshold numeric;
  v_comp boolean;
  v_id uuid;
begin
  if p_action not in ('check_in', 'check_out') then
    raise exception 'Punch action must be check_in or check_out.';
  end if;

  r := public.attendance_lock_day(p_employee_id);
  v_id := r.id;

  if p_action = 'check_in' and r.check_in is not null then
    raise exception 'You are already checked in today.';
  end if;
  if p_action = 'check_out' and r.check_in is null then
    raise exception 'Check in before checking out.';
  end if;
  if p_action = 'check_out' and r.check_out is not null then
    raise exception 'You are already checked out today.';
  end if;

  select e.organization_id into v_org
  from public.employees e
  where e.id = p_employee_id;

  select
    c.shift_id,
    c.start_time,
    c.end_time,
    c.break_minutes,
    c.grace_minutes,
    c.is_overnight
  into v_shift, v_start, v_end, v_break, v_grace, v_overnight
  from public.attendance_shift_clock(
    p_employee_id,
    coalesce(r.attendance_date, (timezone('Asia/Kolkata', v_now))::date)
  ) c;

  v_comp := public.employee_is_week_off(p_employee_id, r.attendance_date)
    or exists (
      select 1
      from public.holidays h
      where h.organization_id = v_org
        and h.date = r.attendance_date
        and coalesce(h.is_optional, false) = false
    );

  v_remarks := r.remarks;
  if v_comp and strpos(lower(coalesce(v_remarks, '')), 'comp-off-eligible') = 0 then
    v_remarks := trim(both ' ' from concat_ws(' ', nullif(v_remarks, ''), 'comp-off-eligible'));
  end if;

  v_shift_start := (r.attendance_date + v_start) at time zone 'Asia/Kolkata';

  if p_action = 'check_in' then
    if v_now > v_shift_start + make_interval(mins => coalesce(v_grace, 0)) then
      v_status := 'late';
    elsif coalesce(r.work_mode, '') = 'wfh' then
      v_status := 'wfh';
    else
      v_status := 'present';
    end if;

    update public.attendance_records
    set check_in = v_now,
        status = v_status,
        remarks = v_remarks,
        shift_id = v_shift,
        source = 'web',
        worked_hours = null,
        overtime_hours = null
    where id = v_id
    returning * into r;

    return r;
  end if;

  update public.attendance_records
  set check_out = v_now,
      remarks = v_remarks,
      shift_id = v_shift,
      source = 'web'
  where id = v_id
  returning * into r;

  -- A real shift uses the shared hours function. With no shift, that function
  -- would ignore organization work hours and assume 09:00-18:00.
  if v_shift is not null then
    perform public.recompute_attendance_hours(v_id);
    select * into r from public.attendance_records where id = v_id;
    return r;
  end if;

  v_worked := greatest(
    0,
    extract(epoch from (r.check_out - r.check_in)) / 3600.0 - (coalesce(v_break, 0) / 60.0)
  );

  if v_overnight or v_end <= v_start then
    v_scheduled := extract(epoch from ((r.attendance_date + 1 + v_end) - (r.attendance_date + v_start))) / 3600.0;
  else
    v_scheduled := extract(epoch from ((r.attendance_date + v_end) - (r.attendance_date + v_start))) / 3600.0;
  end if;
  v_scheduled := greatest(0, v_scheduled - (coalesce(v_break, 0) / 60.0));
  if v_scheduled <= 0 then
    v_scheduled := 8;
  end if;
  v_overtime := greatest(0, v_worked - v_scheduled);
  v_threshold := public.attendance_setting(v_org, 'half_day_hours', 4);

  if v_worked < v_threshold then
    v_status := 'half-day';
  elsif r.check_in > v_shift_start + make_interval(mins => coalesce(v_grace, 0)) then
    v_status := 'late';
  elsif coalesce(r.work_mode, '') = 'wfh' then
    v_status := 'wfh';
  else
    v_status := 'present';
  end if;

  update public.attendance_records
  set worked_hours = round(v_worked, 2),
      overtime_hours = round(v_overtime, 2),
      status = v_status
  where id = v_id
  returning * into r;

  return r;
end;
$$;

comment on function public.punch_attendance(uuid, text) is
  'Check in or check out using the database clock. The caller may punch only their own employee row. Late marking uses the shift effective on the attendance date.';
