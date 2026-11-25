-- Two attendance rule fixes, both applied at their single shared source
-- so every screen that reads attendance_records.status (check-in,
-- check-out, daily attendance, monthly calendar, summary cards, payroll)
-- reflects the same corrected value -- nothing here changes how any
-- screen DISPLAYS a status, only how that status is calculated.
--
-- IMPORTANT: this file supersedes the grace-period part of
-- 20261123105954_relax_attendance_dwr_leave_rules.sql, which floored
-- grace at 30 minutes. That migration was never applied (confirmed: its
-- wording still doesn't match what you're seeing live), and the correct
-- rule per this task is 15 minutes, not 30 -- do not apply that older
-- migration's attendance_shift_clock()/recompute_attendance_hours()
-- sections; this file's versions below are the ones that should actually
-- be run. (That older migration's dwr_upsert/leave-cap sections are a
-- separate, unrelated concern and are not touched or affected by this
-- file either way.)
--
-- 1. Check-in grace: effective grace is FIXED at exactly 15 minutes,
--    regardless of each shift's own configured grace_minutes value --
--    this is a fixed override, not a floor, per the exact requirement
--    "10:00-10:15 AM Present, 10:16 AM onwards Late" independent of any
--    previous grace setting (a shift configured with, say, 30 minutes of
--    grace would otherwise still allow 10:16-10:30 to read Present, which
--    is not what was asked for). A 10:00 AM shift start is Present
--    through 10:15 AM inclusive. Applied in attendance_shift_clock()
--    (feeds the live check-in status) and recompute_attendance_hours()
--    (the check-out recompute for a shift-having employee, which is the
--    normal case) -- the two actual sources every other screen's status
--    comes from. shifts.grace_minutes itself is left untouched (no data
--    changed) -- these functions simply no longer read it for this
--    purpose.
--
-- 2. Checkout-time half-day floor: half-day was being decided purely by
--    "worked hours < half_day_hours" (default 4), with no separate
--    checkout-time rule anywhere in the code -- so this adds one,
--    exactly as asked: a check-out at or after 18:30 IST clock time
--    never results in half-day, regardless of the worked-hours
--    threshold's configured value. Every other half-day condition
--    (worked hours below the threshold with an earlier checkout) is
--    unchanged. Applied in BOTH recompute_attendance_hours() (the normal,
--    shift-having path) and the no-shift fallback block inside
--    punch_attendance() (20260928130001_shift_assignment.sql), so an
--    employee with no shift assigned gets the identical rule.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- 1a. attendance_shift_clock -- floor the returned grace_minutes at 15.
-- ---------------------------------------------------------------------------

create or replace function public.attendance_shift_clock(p_employee uuid, p_on date)
returns table (
  shift_id uuid,
  start_time time,
  end_time time,
  break_minutes integer,
  grace_minutes integer,
  is_overnight boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shift uuid;
  v_start time := time '09:00';
  v_end time := time '18:00';
  v_break integer := 0;
  v_grace integer := 0;
  v_overnight boolean := false;
  v_org uuid;
  v_work_start time;
  v_work_end time;
begin
  v_shift := public.employee_shift_on(p_employee, p_on);

  if v_shift is not null then
    select
      coalesce(s.break_minutes, 0),
      coalesce(s.grace_minutes, 0),
      coalesce(s.start_time, time '09:00'),
      coalesce(s.end_time, time '18:00'),
      coalesce(s.is_overnight, false)
    into v_break, v_grace, v_start, v_end, v_overnight
    from public.shifts s
    where s.id = v_shift;

    if not found then
      v_shift := null;
    end if;
  end if;

  if v_shift is null then
    v_break := 0;
    v_grace := 0;
    v_start := time '09:00';
    v_end := time '18:00';
    v_overnight := false;

    select e.organization_id into v_org
    from public.employees e
    where e.id = p_employee;

    if to_regclass('public.organization_settings') is not null
       and exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'organization_settings'
           and column_name = 'work_start_time'
       ) then
      begin
        execute
          'select work_start_time::time, work_end_time::time
           from public.organization_settings
           where organization_id = $1'
          into v_work_start, v_work_end
          using v_org;
        v_start := coalesce(v_work_start, time '09:00');
        v_end := coalesce(v_work_end, time '18:00');
      exception
        when others then
          v_start := time '09:00';
          v_end := time '18:00';
      end;
    end if;
  end if;

  -- End at or before start is an overnight window even when the flag is off.
  v_overnight := v_overnight or v_end <= v_start;

  -- Effective grace is FIXED at exactly 15 minutes (not a floor -- a
  -- shift configured with a different grace_minutes value is overridden,
  -- not just raised): present up to and including 10:15 for a 10:00
  -- shift start, late starting 10:16.
  v_grace := 15;

  shift_id := v_shift;
  start_time := v_start;
  end_time := v_end;
  break_minutes := v_break;
  grace_minutes := v_grace;
  is_overnight := v_overnight;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1b + 2. recompute_attendance_hours -- same 15-minute grace floor at
-- check-out, plus the checkout-time half-day floor (checkout at/after
-- 18:30 IST clock time is never half-day).
-- ---------------------------------------------------------------------------

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
  v_checkout_clock time;
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

  -- Same fixed 15-minute grace as attendance_shift_clock() (an override,
  -- not a floor), so a check-out recompute never disagrees with the live
  -- check-in status.
  v_grace := 15;

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
  -- IST clock time of the actual check-out, independent of worked hours.
  v_checkout_clock := (r.check_out at time zone 'Asia/Kolkata')::time;

  if v_worked < v_threshold and v_checkout_clock < time '18:30' then
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

-- ---------------------------------------------------------------------------
-- 1c + 2b. punch_attendance's no-shift fallback -- same two fixes, for an
-- employee with no shift assigned (recompute_attendance_hours above
-- covers everyone WITH a shift; this duplicate block only runs when
-- v_shift is null, see 20260928130001_shift_assignment.sql).
-- ---------------------------------------------------------------------------

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
  v_checkout_clock time;
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
  v_checkout_clock := (r.check_out at time zone 'Asia/Kolkata')::time;

  if v_worked < v_threshold and v_checkout_clock < time '18:30' then
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
  'Check in or check out using the database clock. The caller may punch only their own employee row. Late marking uses the shift effective on the attendance date. Checkout at/after 18:30 IST never results in half-day.';
