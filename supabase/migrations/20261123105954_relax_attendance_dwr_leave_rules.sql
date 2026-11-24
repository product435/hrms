-- Four targeted behavior changes, each re-declaring an existing function
-- with `create or replace` (no new tables/columns/migrations beyond this
-- one file, nothing renamed):
--
-- 1. Attendance late/grace: a check-in up to and including 30 minutes
--    after shift start is "Present"; only later than that is "Late".
--    Uses the EXISTING shifts.grace_minutes mechanism -- no new column,
--    no shift-data UPDATE -- by flooring the effective grace at 30
--    minutes wherever it is read, in both places that currently derive a
--    status from it: attendance_shift_clock() (check-in, and the
--    manual-correction path in 20260928130001_shift_assignment.sql which
--    calls the same function) and recompute_attendance_hours()
--    (check-out). A shift configured with MORE than 30 minutes of grace
--    keeps its own, larger value; only a smaller or zero grace is raised
--    to 30.
--
-- 2. Check-out no longer depends on a submitted work report. The
--    database-side gate (checkout_allowed) and its frontend call site
--    were already removed from the check-out flow in
--    src/services/attendanceService.ts; nothing else here needs a
--    database change for that item.
--
-- 3. Work report submission: dwr_upsert() no longer rejects a submission
--    for being before the window-open time or after the 10:00 IST
--    late-cutoff. The "late" vs "submitted" status label is unchanged
--    (still based on whether `now()` is after the shift end) -- only the
--    outright rejection is removed, so the report is still honestly
--    labelled late when it is, it simply is never blocked from being
--    submitted.
--
-- 4. Leave requests: enforce_leave_request_integrity() no longer calls
--    assert_monthly_leave_cap() on insert or on approval. The annual
--    per-leave-type balance check (the v_remaining calculation a few
--    lines above each removed call) is untouched, exactly as the task
--    requires. assert_monthly_leave_cap() and its helper functions
--    (leave_days_by_month, leave_policy_setting) are left in place,
--    unused, rather than dropped -- nothing else is known to reference
--    them, but dropping functions is outside this task's scope.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- 1a. attendance_shift_clock -- floor the returned grace_minutes at 30.
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

  -- Effective grace is at least 30 minutes: present up to and including
  -- 10:30 for a 10:00 shift start, late only after that.
  v_grace := greatest(coalesce(v_grace, 0), 30);

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
-- 1b. recompute_attendance_hours -- same 30-minute floor at check-out.
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

  -- Same 30-minute floor as attendance_shift_clock(), so a check-out
  -- recompute never disagrees with the live check-in status.
  v_grace := greatest(coalesce(v_grace, 0), 30);

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

-- ---------------------------------------------------------------------------
-- 3. dwr_upsert -- remove the submit-time-window rejection.
-- ---------------------------------------------------------------------------

create or replace function public.dwr_upsert(
  p_report_date date,
  p_blockers text,
  p_plan_for_tomorrow text,
  p_items jsonb,
  p_submit boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_employee uuid;
  v_org uuid;
  v_existing public.daily_work_reports%rowtype;
  v_has_existing boolean := false;
  v_resubmit boolean := false;
  v_open timestamptz;
  v_shift_end timestamptz;
  v_late timestamptz;
  v_status text;
  v_review text;
  v_element jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_desc text;
  v_hours numeric;
  v_item_status text;
  v_task uuid;
  v_has_tasks boolean;
  v_total numeric := 0;
  v_row jsonb;
  v_id uuid;
begin
  perform set_config('app.dwr_rpc', 'on', true);

  v_employee := public.current_employee_id();
  if v_employee is null then
    raise exception 'Your account is not linked to an employee record.';
  end if;
  if p_report_date is null then
    raise exception 'Choose a report date.';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'Report items must be a list.';
  end if;

  select e.organization_id into v_org from public.employees e where e.id = v_employee;
  if v_org is null then
    raise exception 'Your employee record has no organisation.';
  end if;

  select * into v_existing
  from public.daily_work_reports
  where employee_id = v_employee and report_date = p_report_date
  for update;

  v_has_existing := found;
  if v_has_existing and v_existing.review_status = 'approved' then
    raise exception 'This report is approved. Your lead can reopen it with a reason.';
  end if;
  if v_has_existing and v_existing.status = 'missed' then
    raise exception 'This report was missed. Ask HR to waive it.';
  end if;

  v_resubmit := v_has_existing and v_existing.review_status = 'needs-revision';

  if p_submit then
    select b.window_open, b.shift_end, b.late_until
      into v_open, v_shift_end, v_late
    from public.dwr_shift_bounds(v_employee, p_report_date) b;

    -- Submission is allowed at any time of day; "late" is still an honest
    -- status label (based on shift end), it is just never a rejection.
    v_status := case when now() > v_shift_end then 'late' else 'submitted' end;
    v_review := 'pending';
  else
    if v_has_existing and v_existing.status in ('submitted', 'late') then
      v_status := v_existing.status;
    else
      v_status := 'draft';
    end if;
    v_review := case
      when v_has_existing and v_existing.review_status = 'needs-revision' then 'needs-revision'
      else 'pending'
    end;
  end if;

  select exists (
    select 1
    from public.tasks t
    where t.assigned_to = v_employee
      and (
        t.status <> 'done'
        or (
          t.completed_at is not null
          and (t.completed_at at time zone 'Asia/Kolkata')::date = p_report_date
        )
      )
  ) into v_has_tasks;

  for v_element in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_desc := btrim(coalesce(v_element->>'description', ''));
    if v_desc = '' then
      if p_submit then
        raise exception 'Each report item needs a description.';
      end if;
      continue;
    end if;

    begin
      v_hours := round(coalesce((v_element->>'hours')::numeric, 0), 2);
    exception when others then
      raise exception 'Item hours must be a number.';
    end;
    if v_hours < 0 or v_hours > 24 then
      raise exception 'Item hours must be between 0 and 24.';
    end if;

    v_item_status := coalesce(nullif(v_element->>'item_status', ''), 'done');
    if v_item_status not in ('todo', 'in-progress', 'blocked', 'done') then
      raise exception 'Invalid item status.';
    end if;

    v_task := null;
    if nullif(v_element->>'task_id', '') is not null then
      begin
        v_task := (v_element->>'task_id')::uuid;
      exception when others then
        raise exception 'Invalid task.';
      end;
    end if;

    if v_has_tasks and v_task is null then
      raise exception 'Free-text items are only allowed when you have no assigned tasks.';
    end if;

    if v_task is not null and not exists (
      select 1
      from public.tasks t
      where t.id = v_task
        and t.assigned_to = v_employee
        and (
          t.status <> 'done'
          or (
            t.completed_at is not null
            and (t.completed_at at time zone 'Asia/Kolkata')::date = p_report_date
          )
        )
    ) then
      raise exception 'That task is not on your list for this report.';
    end if;

    v_total := v_total + v_hours;
    v_clean := v_clean || jsonb_build_array(
      jsonb_build_object(
        'task_id', v_task,
        'description', v_desc,
        'hours', v_hours,
        'item_status', v_item_status
      )
    );
  end loop;

  if p_submit and jsonb_array_length(v_clean) = 0 then
    raise exception 'Add at least one line before you submit.';
  end if;
  if p_submit and v_total <= 0 then
    raise exception 'Enter the hours you worked before you submit.';
  end if;

  if v_has_existing then
    update public.daily_work_reports
    set status = v_status,
        submitted_at = case when p_submit then now() else submitted_at end,
        total_hours = v_total,
        blockers = nullif(btrim(coalesce(p_blockers, '')), ''),
        plan_for_tomorrow = nullif(btrim(coalesce(p_plan_for_tomorrow, '')), ''),
        review_status = v_review,
        escalated = case when p_submit then false else escalated end,
        updated_at = now()
    where id = v_existing.id
    returning id into v_id;
  else
    insert into public.daily_work_reports (
      organization_id, employee_id, report_date, status, submitted_at, total_hours,
      blockers, plan_for_tomorrow, review_status
    ) values (
      v_org,
      v_employee,
      p_report_date,
      v_status,
      case when p_submit then now() else null end,
      v_total,
      nullif(btrim(coalesce(p_blockers, '')), ''),
      nullif(btrim(coalesce(p_plan_for_tomorrow, '')), ''),
      v_review
    )
    returning id into v_id;
  end if;

  delete from public.dwr_items where report_id = v_id;

  insert into public.dwr_items (report_id, task_id, description, hours, item_status)
  select
    v_id,
    nullif(item->>'task_id', '')::uuid,
    item->>'description',
    (item->>'hours')::numeric,
    item->>'item_status'
  from jsonb_array_elements(v_clean) as item;

  v_row := jsonb_build_object('id', v_id, 'status', v_status, 'total_hours', v_total);
  return v_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. enforce_leave_request_integrity -- remove the monthly-cap checks.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_leave_request_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit numeric;
  v_change numeric;
  v_remaining numeric;
  v_year_start timestamptz;
  v_year_end timestamptz;
  v_span numeric;
begin
  if TG_OP = 'INSERT' then
    if new.employee_id is null then
      raise exception 'A leave request must belong to an employee.';
    end if;
    if new.leave_type_id is null then
      raise exception 'A leave type is required.';
    end if;
    if new.start_date is null or new.end_date is null then
      raise exception 'Leave start and end dates are required.';
    end if;
    if new.end_date < new.start_date then
      raise exception 'Leave end date cannot be before the start date.';
    end if;
    if new.total_days is null or new.total_days <= 0 then
      raise exception 'Leave must cover at least one day.';
    end if;

    v_span := (new.end_date - new.start_date + 1)::numeric;
    -- Whole days match the inclusive range. A single half day in the range
    -- is stored as 0.5 less than that range and counts as 0.5 against the cap.
    if new.total_days <> v_span and new.total_days <> v_span - 0.5 then
      raise exception 'Leave days must equal the inclusive date range.';
    end if;

    if new.status is null or btrim(new.status) = '' then
      new.status := 'pending';
    elsif new.status <> 'pending' then
      raise exception 'New leave requests must start as pending.';
    end if;

    perform public.leave_lock_employee(new.employee_id);

    if exists (
      select 1
      from public.leave_requests lr
      where lr.employee_id = new.employee_id
        and lr.id is distinct from new.id
        and lr.status in ('pending', 'approved')
        and lr.start_date is not null
        and lr.end_date is not null
        and lr.start_date <= new.end_date
        and lr.end_date >= new.start_date
    ) then
      raise exception 'This leave overlaps another pending or approved request.';
    end if;

    select lt.annual_limit
      into v_limit
    from public.leave_types lt
    where lt.id = new.leave_type_id;

    if not found then
      raise exception 'Leave type not found.';
    end if;

    v_year_start := date_trunc('year', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
    v_year_end := (date_trunc('year', now() at time zone 'Asia/Kolkata') + interval '1 year') at time zone 'Asia/Kolkata';

    select coalesce(sum(ll.change_days), 0)
      into v_change
    from public.leave_ledger ll
    where ll.employee_id = new.employee_id
      and ll.leave_type_id = new.leave_type_id
      and ll.created_at >= v_year_start
      and ll.created_at < v_year_end;

    -- used = -sum(change_days); remaining = annual_limit - used.
    v_remaining := coalesce(v_limit, 0) + v_change;
    if new.total_days > v_remaining then
      raise exception 'This request exceeds the remaining leave balance (% days left).',
        greatest(v_remaining, 0);
    end if;

    return new;
  end if;

  if old.employee_id is distinct from new.employee_id
     or old.leave_type_id is distinct from new.leave_type_id
     or old.start_date is distinct from new.start_date
     or old.end_date is distinct from new.end_date
     or old.total_days is distinct from new.total_days
  then
    raise exception 'Leave employee, type, dates, and days cannot be changed after submission.';
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  perform public.leave_lock_employee(new.employee_id);

  -- Owner uses the self path. can_manage_employee is false for your own id,
  -- so a manager cannot cancel their own request on the manager path.
  if new.status = 'cancelled' then
    if old.status = 'rejected' then
      raise exception 'A rejected leave request cannot be cancelled.';
    end if;
    if old.status not in ('pending', 'approved') then
      raise exception 'Only a pending or approved leave request can be cancelled.';
    end if;
    if new.employee_id is not distinct from public.current_employee_id() then
      return new;
    end if;
    if not public.can_manage_employee(new.employee_id) then
      raise exception 'You can only cancel your own leave, or leave for an employee you manage.';
    end if;
    return new;
  end if;

  if old.status = 'cancelled' and new.status in ('approved', 'rejected') then
    raise exception 'A cancelled leave request cannot be approved or rejected.';
  end if;
  if old.status = 'rejected' and new.status = 'approved' then
    raise exception 'A rejected leave request cannot be approved.';
  end if;
  if old.status is distinct from 'pending' or new.status not in ('approved', 'rejected') then
    raise exception 'Only a pending leave request can be approved or rejected.';
  end if;

  if new.employee_id is not distinct from public.current_employee_id() then
    raise exception 'You cannot decide your own leave request.';
  end if;
  if not public.can_manage_employee(new.employee_id) then
    raise exception 'Only the team lead, department head, HR, or an admin can decide this request.';
  end if;

  if new.status = 'rejected' and nullif(btrim(coalesce(new.rejection_reason, '')), '') is null then
    raise exception 'A rejection reason is required.';
  end if;

  new.approved_by := auth.uid();
  new.approved_at := now();
  if new.status = 'approved' then
    new.rejection_reason := null;
  else
    new.rejection_reason := btrim(new.rejection_reason);
  end if;

  return new;
end;
$$;
