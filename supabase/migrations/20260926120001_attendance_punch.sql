-- P0: attendance punch time integrity.
-- The browser must not choose check_in or check_out. Employees punch only
-- themselves, and the row is locked so a double-click cannot double-write.
-- Status, worked hours, and overtime are computed here. An employee cannot
-- write those columns. Admin/HR policies are unchanged.

-- The lock/insert path needs this unique key. Skip when older duplicates exist.
do $body$
begin
  create unique index if not exists attendance_records_employee_date_key
    on public.attendance_records (employee_id, attendance_date);
exception
  when unique_violation then
    raise notice 'attendance_records has duplicate employee/date rows; unique index skipped.';
end
$body$;

-- ---------------------------------------------------------------------------
-- 1. Shift clock used to pick the attendance date and the late threshold.
--    Matches recompute_attendance_hours, plus organization work hours when
--    the employee has no shift (the same fallback the web client used).
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
-- 2. Lock today's or yesterday's row, or insert one under the unique
--    (employee_id, attendance_date) key. A concurrent insert re-locks.
-- ---------------------------------------------------------------------------

create or replace function public.attendance_lock_day(p_employee_id uuid)
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.attendance_records%rowtype;
  v_local timestamp;
  v_today date;
  v_open date;
  v_date date;
  v_minutes integer;
  v_end_minutes integer;
  v_shift uuid;
  v_end time;
  v_overnight boolean;
  v_employment text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  if p_employee_id is null or p_employee_id is distinct from public.current_employee_id() then
    raise exception 'You can only record your own attendance.';
  end if;

  select e.employment_status into v_employment
  from public.employees e
  where e.id = p_employee_id;

  if not found then
    raise exception 'Employee record not found.';
  end if;

  if lower(coalesce(v_employment, 'active')) in (
    'resigned', 'terminated', 'inactive', 'rejected', 'exited', 'suspended', 'pending_approval'
  ) then
    raise exception 'Attendance is closed for this employment status.';
  end if;

  v_local := timezone('Asia/Kolkata', now());
  v_today := v_local::date;
  v_minutes := extract(hour from v_local)::integer * 60
    + extract(minute from v_local)::integer;

  -- Serialize double-clicks against rows that already exist for this window.
  perform 1
  from public.attendance_records
  where employee_id = p_employee_id
    and attendance_date in (v_today - 1, v_today)
  order by attendance_date, id
  for update;

  select ar.attendance_date into v_open
  from public.attendance_records ar
  where ar.employee_id = p_employee_id
    and ar.attendance_date in (v_today - 1, v_today)
    and ar.check_in is not null
    and ar.check_out is null
  order by ar.attendance_date
  limit 1;

  select c.shift_id, c.end_time, c.is_overnight
    into v_shift, v_end, v_overnight
  from public.attendance_shift_clock(p_employee_id, v_today) c;

  v_end_minutes := extract(hour from v_end)::integer * 60
    + extract(minute from v_end)::integer;

  if v_open is not null then
    v_date := v_open;
  elsif coalesce(v_overnight, false) and v_minutes < v_end_minutes then
    -- Still inside an overnight shift that started yesterday.
    v_date := v_today - 1;
  else
    v_date := v_today;
  end if;

  select * into r
  from public.attendance_records
  where employee_id = p_employee_id
    and attendance_date = v_date
  order by id
  limit 1
  for update;

  if not found then
    begin
      insert into public.attendance_records (
        employee_id,
        attendance_date,
        shift_id,
        source
      )
      values (
        p_employee_id,
        v_date,
        v_shift,
        'web'
      )
      returning * into r;
    exception
      when unique_violation then
        select * into r
        from public.attendance_records
        where employee_id = p_employee_id
          and attendance_date = v_date
        order by id
        limit 1
        for update;

        if not found then
          raise exception 'Could not lock the attendance row.';
        end if;
    end;
  end if;

  return r;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Punch. p_action is check_in or check_out. The timestamptz is now().
--    The attendance date is Asia/Kolkata. No client timestamp is accepted.
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

  -- Clock rules follow the shift that is active on today's IST date, which
  -- is also how an open overnight punch is assigned to yesterday.
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
    (timezone('Asia/Kolkata', v_now))::date
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

-- ---------------------------------------------------------------------------
-- 4. Work from home. Writes work mode, the reason, and a server-chosen
--    status. It does not write punch times or hours.
--    Status stays late or half-day when the employee has already punched
--    in; otherwise the day is marked wfh. Same rule the client used.
-- ---------------------------------------------------------------------------

create or replace function public.request_work_from_home(p_employee_id uuid, p_reason text)
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.attendance_records%rowtype;
  v_reason text;
  v_flag text;
  v_remarks text;
  v_status text;
  v_shift uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A reason is required for work from home.';
  end if;

  r := public.attendance_lock_day(p_employee_id);
  v_id := r.id;

  v_flag := 'wfh: ' || v_reason;
  if strpos(lower(coalesce(r.remarks, '')), lower(v_flag)) > 0 then
    v_remarks := r.remarks;
  else
    v_remarks := trim(both ' ' from concat_ws(' ', nullif(trim(coalesce(r.remarks, '')), ''), v_flag));
  end if;

  if r.check_in is not null
     and nullif(trim(coalesce(r.status, '')), '') is not null
     and r.status is distinct from 'present' then
    v_status := r.status;
  else
    v_status := 'wfh';
  end if;

  select c.shift_id into v_shift
  from public.attendance_shift_clock(
    p_employee_id,
    (timezone('Asia/Kolkata', now()))::date
  ) c;

  update public.attendance_records
  set work_mode = 'wfh',
      remarks = v_remarks,
      status = v_status,
      shift_id = coalesce(v_shift, shift_id)
  where id = v_id
  returning * into r;

  return r;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Employees can no longer write their own punch.
--    self_update had no column list, so any timestamp and status was allowed.
--    self_insert had the same hole on the first row of the day (both times
--    could be set in one insert). Work from home goes through the RPC above.
--    Admin/HR and lead policies are left in place. can_manage_employee
--    excludes the caller, so a lead cannot rewrite their own punch that way.
-- ---------------------------------------------------------------------------

drop policy if exists attendance_records_self_update on public.attendance_records;
drop policy if exists attendance_records_self_insert on public.attendance_records;

revoke all on function public.attendance_shift_clock(uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.attendance_lock_day(uuid) from public, anon, authenticated, service_role;

revoke all on function public.punch_attendance(uuid, text) from public, anon, service_role;
revoke all on function public.request_work_from_home(uuid, text) from public, anon, service_role;

grant execute on function public.punch_attendance(uuid, text) to authenticated;
grant execute on function public.request_work_from_home(uuid, text) to authenticated;

comment on function public.punch_attendance(uuid, text) is
  'Check in or check out using the database clock. The caller may punch only their own employee row.';

comment on function public.request_work_from_home(uuid, text) is
  'Marks the caller work-from-home for the current attendance day without writing punch times.';
