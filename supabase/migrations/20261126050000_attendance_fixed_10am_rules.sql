-- My Attendance check-in/check-out rules (Asia/Kolkata), replacing the
-- previous, never-applied 20261125050300_attendance_grace15_and_checkout_half_day_fix.sql
-- attempt at this -- that file never implemented the "reject an early
-- check-in and don't save it" rule at all, and never implemented the
-- "Late -> Present on a late-enough checkout" rule either. This migration
-- supersedes it entirely for punch_attendance()/recompute_attendance_hours();
-- do not apply 20261125050300 after this file, or its lack of these two
-- rules would overwrite them.
--
-- Rules implemented here, all against the IST wall-clock time, not each
-- employee's own shift start/end (confirmed this is the intended rule:
-- the exact times 10:00/10:15/18:30 were given as fixed clock times, not
-- "shift start + grace"):
--
--   1. Check-in before 10:00 AM: rejected with a distinct error message
--      the frontend recognises and shows as a plain notification, not a
--      toast error. NOTHING is written -- no attendance_records row is
--      touched by this call. attendance_lock_day() still runs first (as
--      it already does) to find/create the day's placeholder row, but
--      that row's check_in stays null, so the employee can simply call
--      check-in again later -- no state to undo.
--   2. Check-in 10:00:00-10:15:59 IST (10:00 through 10:15 inclusive):
--      Present.
--   3. Check-in 10:16:00 IST onward: Late.
--   4. A Late day checked out before 18:30 IST: stays Late.
--   5. A Late day checked out at/after 18:30 IST: becomes Present.
--
-- Nothing else about punch_attendance()/recompute_attendance_hours() is
-- changed: WFH handling, half-day-by-worked-hours, overtime, comp-off
-- remarks, the no-shift fallback block, and every RLS/grant on these
-- functions are byte-for-byte unchanged from their current live/pending
-- versions (20260926120001_attendance_punch.sql /
-- 20260926000003_attendance_rules.sql). shifts.grace_minutes and each
-- shift's own start/end time are left untouched and no longer read by
-- these two functions' status decision -- only the fixed clock times
-- above are used, per the exact rule given.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- 1. punch_attendance -- reject an early check-in outright; Present/Late by
--    fixed clock time on a normal check-in; Late -> Present on a late-
--    enough checkout, for an employee with NO shift assigned (the
--    no-shift fallback path already inside this function).
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
  v_worked numeric;
  v_scheduled numeric;
  v_overtime numeric;
  v_threshold numeric;
  v_comp boolean;
  v_id uuid;
  v_checkin_clock time;
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

  -- Rule 1: before 10:00 AM IST, reject and save nothing. A distinct
  -- message (checked for by the frontend) so it shows as a plain
  -- notification, not a generic error toast.
  if p_action = 'check_in' then
    v_checkin_clock := (v_now at time zone 'Asia/Kolkata')::time;
    if v_checkin_clock < time '10:00' then
      raise exception 'EARLY_CHECK_IN: You are checking in early, before 10:00 AM';
    end if;
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

  if p_action = 'check_in' then
    -- Rules 2 and 3: fixed 10:00-10:15 inclusive = Present, 10:16
    -- onward = Late. v_checkin_clock was already computed above (and
    -- is already >= 10:00, since an earlier check-in was rejected).
    if v_checkin_clock < time '10:16' then
      v_status := case when coalesce(r.work_mode, '') = 'wfh' then 'wfh' else 'present' end;
    else
      v_status := 'late';
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

  -- Rules 4 and 5: only ever applies when the day's current status is
  -- already Late (set at check-in time above or carried from a shift
  -- recompute). Any other status (present/wfh/half-day-by-hours) keeps
  -- its own existing derivation, unchanged.
  if r.status = 'late' then
    if v_checkout_clock >= time '18:30' then
      v_status := 'present';
    else
      v_status := 'late';
    end if;
  elsif v_worked < v_threshold and v_checkout_clock < time '18:30' then
    v_status := 'half-day';
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
  'Check in or check out using the database clock. The caller may punch only their own employee row. Check-in before 10:00 IST is rejected and nothing is saved. 10:00-10:15 IST inclusive is Present, 10:16 onward is Late. A Late day checked out at/after 18:30 IST becomes Present; otherwise it stays Late.';

-- ---------------------------------------------------------------------------
-- 2. recompute_attendance_hours -- the checkout-time recompute path for an
--    employee WHO HAS a shift assigned (the normal case). Same Late ->
--    Present rule on checkout; the check-in side (rules 1-3) is decided
--    once, at check-in time, directly in punch_attendance() above, and is
--    never re-derived here.
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
  v_worked numeric;
  v_scheduled numeric;
  v_overtime numeric;
  v_threshold numeric;
  v_status text;
  v_start_time time := time '09:00';
  v_end_time time := time '18:00';
  v_overnight boolean := false;
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
      coalesce(start_time, time '09:00'),
      coalesce(end_time, time '18:00'),
      coalesce(is_overnight, false)
    into v_break_minutes, v_start_time, v_end_time, v_overnight
    from public.shifts
    where id = r.shift_id;
    if not found then
      v_break_minutes := 0;
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

  -- IST clock time of the actual check-out, independent of worked hours.
  v_checkout_clock := (r.check_out at time zone 'Asia/Kolkata')::time;

  -- Rules 4 and 5: only when the day's current status (set at check-in
  -- time by punch_attendance(), rules 2-3) is already Late. Every other
  -- status keeps its existing derivation.
  if r.status = 'late' then
    if v_checkout_clock >= time '18:30' then
      v_status := 'present';
    else
      v_status := 'late';
    end if;
  elsif v_worked < v_threshold and v_checkout_clock < time '18:30' then
    v_status := 'half-day';
  elsif coalesce(r.work_mode, '') = 'wfh' then
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
