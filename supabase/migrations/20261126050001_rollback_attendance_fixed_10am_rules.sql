-- ROLLBACK for 20261126050000_attendance_fixed_10am_rules.sql.
--
-- Restores punch_attendance() and recompute_attendance_hours() to their
-- exact current live bodies -- copied verbatim from the latest-applied
-- definition of each (confirmed by direct read, both files already
-- committed and unmodified):
--   * punch_attendance()        <- 20260928130001_shift_assignment.sql
--   * recompute_attendance_hours() <- 20260926000003_attendance_rules.sql
--
-- Run this ONLY if you need to undo 20261126050000 and go back to the
-- previous (shift-relative grace, no early-check-in block, no Late ->
-- Present on late checkout) behavior. It does not touch any other
-- function, table, or row -- a day already marked Present/Late/Half-day
-- by the new rules keeps whatever status it was last given; this only
-- changes how FUTURE punches are evaluated.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself if and when you decide to roll back.

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

create or replace function public.recompute_attendance_hours(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.attendance_records%rowtype;
  v_org uuid;
  v_break_minutes numeric := 0;
  v_grace integer := 0;
  v_start_time time := time '09:00';
  v_end_time time := time '18:00';
  v_overnight boolean := false;
  v_worked numeric;
  v_scheduled numeric;
  v_overtime numeric;
  v_threshold numeric;
  v_shift_start timestamptz;
  v_status text;
  v_work_mode text;
begin
  select * into r from public.attendance_records where id = p_id;
  if not found or r.check_in is null or r.check_out is null or r.attendance_date is null then
    return;
  end if;

  select organization_id into v_org from public.employees where id = r.employee_id;
  v_threshold := public.attendance_setting(v_org, 'half_day_hours', 4);

  if r.shift_id is not null then
    select
      coalesce(break_minutes, 0),
      coalesce(grace_minutes, 0),
      coalesce(start_time, time '09:00'),
      coalesce(end_time, time '18:00'),
      coalesce(is_overnight, false)
    into v_break_minutes, v_grace, v_start_time, v_end_time, v_overnight
    from public.shifts
    where id = r.shift_id;
    if not found then
      v_break_minutes := 0;
      v_grace := 0;
      v_start_time := time '09:00';
      v_end_time := time '18:00';
      v_overnight := false;
    end if;
  end if;

  v_worked := greatest(
    0,
    extract(epoch from (r.check_out - r.check_in)) / 3600.0 - (coalesce(v_break_minutes, 0) / 60.0)
  );

  if v_overnight or v_end_time <= v_start_time then
    v_scheduled := extract(epoch from ((r.attendance_date + 1 + v_end_time) - (r.attendance_date + v_start_time))) / 3600.0;
  else
    v_scheduled := extract(epoch from ((r.attendance_date + v_end_time) - (r.attendance_date + v_start_time))) / 3600.0;
  end if;
  v_scheduled := greatest(0, v_scheduled - (coalesce(v_break_minutes, 0) / 60.0));
  if v_scheduled <= 0 then
    v_scheduled := 8;
  end if;
  v_overtime := greatest(0, v_worked - v_scheduled);

  v_shift_start := (r.attendance_date + v_start_time) at time zone 'Asia/Kolkata';
  v_work_mode := coalesce(r.work_mode, '');

  if v_worked < v_threshold then
    v_status := 'half-day';
  elsif r.check_in > v_shift_start + make_interval(mins => coalesce(v_grace, 0)) then
    v_status := 'late';
  elsif v_work_mode = 'wfh' then
    v_status := 'wfh';
  else
    v_status := 'present';
  end if;

  update public.attendance_records
  set worked_hours = round(v_worked, 2),
      overtime_hours = round(v_overtime, 2),
      status = v_status
  where id = p_id;
end;
$$;

revoke all on function public.punch_attendance(uuid, text) from public, anon;
revoke all on function public.recompute_attendance_hours(uuid) from public, anon;
grant execute on function public.punch_attendance(uuid, text) to authenticated, service_role;
grant execute on function public.recompute_attendance_hours(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
