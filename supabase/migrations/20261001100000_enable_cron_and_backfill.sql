-- Phase 0: revive the attendance / DWR automation.
-- pg_cron was never installed, and earlier migrations swallowed that failure.
-- This migration is deliberately loud: if an extension or job cannot be created,
-- the migration fails.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Schema gaps found on the live project: 20260926000003_attendance_rules was
-- never applied there, so these were missing.
--  * shifts.week_offs is read by employee_is_week_off() (live copy would error
--    for any employee that has a shift)
--  * attendance_records.missed_checkout
--  * mark_absent_for_date / close_missed_checkouts themselves
-- ---------------------------------------------------------------------------
alter table public.shifts
  add column if not exists week_offs text[] not null default '{}';

alter table public.attendance_records
  add column if not exists missed_checkout boolean not null default false;

create or replace function public.mark_absent_for_date(d date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  if d is null then
    raise exception 'A date is required.';
  end if;

  insert into public.attendance_records (
    employee_id, shift_id, attendance_date, status, source, worked_hours, overtime_hours
  )
  select
    e.id,
    public.employee_shift_on(e.id, d),
    d,
    'absent',
    'manual',
    0,
    0
  from public.employees e
  where coalesce(e.employment_status, 'active') not in (
      'resigned', 'terminated', 'inactive', 'pending_approval', 'rejected', 'exited'
    )
    and (e.exit_date is null or e.exit_date >= d)
    and (e.joining_date is null or e.joining_date <= d)
    and not exists (
      select 1 from public.attendance_records ar
      where ar.employee_id = e.id and ar.attendance_date = d
    )
    and not exists (
      select 1 from public.leave_requests lr
      where lr.employee_id = e.id
        and lr.status = 'approved'
        and lr.start_date is not null
        and lr.end_date is not null
        and d between lr.start_date and lr.end_date
    )
    and not exists (
      select 1 from public.holidays h
      where h.organization_id = e.organization_id
        and h.date = d
        and coalesce(h.is_optional, false) = false
    )
    and not public.employee_is_week_off(e.id, d);

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.close_missed_checkouts(d date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_shift uuid;
  v_start time;
  v_end time;
  v_overnight boolean;
  v_out timestamptz;
  closed integer := 0;
begin
  if d is null then
    raise exception 'A date is required.';
  end if;

  for rec in
    select id, employee_id, check_in, shift_id, remarks
    from public.attendance_records
    where attendance_date = d
      and check_in is not null
      and check_out is null
  loop
    v_shift := coalesce(rec.shift_id, public.employee_shift_on(rec.employee_id, d));
    v_start := time '09:00';
    v_end := time '18:00';
    v_overnight := false;

    if v_shift is not null then
      select
        coalesce(start_time, time '09:00'),
        coalesce(end_time, time '18:00'),
        coalesce(is_overnight, false)
      into v_start, v_end, v_overnight
      from public.shifts
      where id = v_shift;
      if not found then
        v_start := time '09:00';
        v_end := time '18:00';
        v_overnight := false;
      end if;
    end if;

    if v_overnight or v_end <= v_start then
      v_out := ((d + 1) + v_end) at time zone 'Asia/Kolkata';
    else
      v_out := (d + v_end) at time zone 'Asia/Kolkata';
    end if;

    if v_out < rec.check_in then
      v_out := rec.check_in;
    end if;

    update public.attendance_records
    set check_out = v_out,
        missed_checkout = true,
        shift_id = coalesce(shift_id, v_shift),
        remarks = case
          when coalesce(remarks, '') ilike '%missed-checkout%' then remarks
          else trim(both ' ' from concat_ws(' ', nullif(remarks, ''), 'missed-checkout'))
        end
    where id = rec.id;

    perform public.recompute_attendance_hours(rec.id);
    closed := closed + 1;
  end loop;

  return closed;
end;
$$;

revoke all on function public.mark_absent_for_date(date) from public, anon, authenticated;
revoke all on function public.close_missed_checkouts(date) from public, anon, authenticated;
grant execute on function public.mark_absent_for_date(date) to service_role;
grant execute on function public.close_missed_checkouts(date) to service_role;

-- ---------------------------------------------------------------------------
-- Job registration (idempotent). Same expressions as 20260926000003 / 000004.
-- Cron runs as the job owner (postgres), so grant execute explicitly.
-- ---------------------------------------------------------------------------
grant execute on function public.mark_absent_for_date(date) to postgres;
grant execute on function public.close_missed_checkouts(date) to postgres;

do $body$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'hrms_close_missed_checkouts',
      'hrms_mark_absent_previous_day',
      'mark_missed_dwrs_daily',
      'remind_dwr_windows',
      'escalate_stale_dwr_reviews'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  -- 05:15 and 05:30 UTC = 10:45 and 11:00 Asia/Kolkata.
  perform cron.schedule(
    'hrms_close_missed_checkouts',
    '15 5 * * *',
    $cmd$select public.close_missed_checkouts((timezone('Asia/Kolkata', now()))::date - 1);$cmd$
  );
  perform cron.schedule(
    'hrms_mark_absent_previous_day',
    '30 5 * * *',
    $cmd$select public.mark_absent_for_date((timezone('Asia/Kolkata', now()))::date - 1);$cmd$
  );
  perform cron.schedule(
    'mark_missed_dwrs_daily',
    '40 4 * * *',
    $cmd$select public.mark_missed_dwrs((timezone('Asia/Kolkata', now()))::date - 1); select public.mark_missed_dwrs((timezone('Asia/Kolkata', now()))::date - 2);$cmd$
  );
  perform cron.schedule(
    'remind_dwr_windows',
    '*/10 * * * *',
    $cmd$select public.remind_dwr_windows()$cmd$
  );
  perform cron.schedule(
    'escalate_stale_dwr_reviews',
    '20 * * * *',
    $cmd$select public.escalate_stale_dwr_reviews()$cmd$
  );
end
$body$;

-- ---------------------------------------------------------------------------
-- One-shot cleanup of open punches from past dates (no historic absences).
-- ---------------------------------------------------------------------------
create or replace function public.close_all_stale_open_punches(p_before date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d date;
  closed integer := 0;
begin
  if p_before is null then
    raise exception 'A cut-off date is required.';
  end if;

  for d in
    select distinct attendance_date
    from public.attendance_records
    where attendance_date < p_before
      and check_in is not null
      and check_out is null
    order by 1
  loop
    closed := closed + public.close_missed_checkouts(d);
  end loop;

  return closed;
end;
$$;

revoke all on function public.close_all_stale_open_punches(date) from public, anon, authenticated;
grant execute on function public.close_all_stale_open_punches(date) to service_role, postgres;

comment on function public.close_all_stale_open_punches(date) is
  'One-shot: close every open punch dated before p_before via close_missed_checkouts. Does not create absences.';

-- ---------------------------------------------------------------------------
-- Cron health for Settings
-- ---------------------------------------------------------------------------
create or replace function public.cron_job_health()
returns table (
  job_name text,
  schedule text,
  is_scheduled boolean,
  is_active boolean,
  last_run_at timestamptz,
  last_status text,
  last_message text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('admin', 'hr') then
    raise exception 'Only admin or HR can view automation health.';
  end if;

  if to_regclass('cron.job') is null then
    return query
      select n, null::text, false, false, null::timestamptz, null::text, 'pg_cron is not installed'::text
      from unnest(array[
        'hrms_mark_absent_previous_day',
        'hrms_close_missed_checkouts',
        'mark_missed_dwrs_daily',
        'remind_dwr_windows',
        'escalate_stale_dwr_reviews'
      ]) as n;
    return;
  end if;

  return query execute $q$
    select
      e.n::text,
      j.schedule::text,
      (j.jobid is not null),
      coalesce(j.active, false),
      r.start_time,
      r.status::text,
      left(r.return_message, 300)::text
    from unnest(array[
      'hrms_mark_absent_previous_day',
      'hrms_close_missed_checkouts',
      'mark_missed_dwrs_daily',
      'remind_dwr_windows',
      'escalate_stale_dwr_reviews'
    ]) as e(n)
    left join cron.job j on j.jobname = e.n
    left join lateral (
      select d.start_time, d.status, d.return_message
      from cron.job_run_details d
      where d.jobid = j.jobid
      order by d.start_time desc
      limit 1
    ) r on true
    order by e.n
  $q$;
end;
$$;

revoke all on function public.cron_job_health() from public, anon;
grant execute on function public.cron_job_health() to authenticated, service_role;
