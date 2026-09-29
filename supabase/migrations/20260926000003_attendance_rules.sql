-- Stream B: attendance rules.
-- Holidays, shift week-offs, half-day and regularization settings,
-- auto-absent and missed check-out jobs, and regularization approval.
-- Check-out is not blocked here. Daily work reports belong to Stream C.
-- These functions stay callable when pg_cron is not installed.

-- ---------------------------------------------------------------------------
-- 1. Holidays
-- ---------------------------------------------------------------------------

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  date date not null,
  name text not null,
  is_optional boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, date)
);

alter table public.holidays
  add column if not exists is_optional boolean not null default false;

create index if not exists holidays_org_date_idx
  on public.holidays (organization_id, date);

alter table public.holidays enable row level security;

drop policy if exists holidays_org_select on public.holidays;
create policy holidays_org_select on public.holidays
  for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists holidays_admin_hr_write on public.holidays;
create policy holidays_admin_hr_write on public.holidays
  for all to authenticated
  using (
    public.current_user_role() in ('admin', 'hr')
    and organization_id = public.current_org_id()
  )
  with check (
    public.current_user_role() in ('admin', 'hr')
    and organization_id = public.current_org_id()
  );

revoke all on public.holidays from anon;
grant select, insert, update, delete on public.holidays to authenticated;
grant all on public.holidays to service_role;

-- ---------------------------------------------------------------------------
-- 2. Shift week-offs and missed check-out flag
-- ---------------------------------------------------------------------------

alter table public.shifts
  add column if not exists week_offs text[] not null default '{}';

alter table public.attendance_records
  add column if not exists missed_checkout boolean not null default false;

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
-- 3. Org attendance policy on the existing organization_settings row
--    { "half_day_hours": 4, "regularization_monthly_limit": 3 }
-- ---------------------------------------------------------------------------

do $body$
begin
  if to_regclass('public.organization_settings') is null then
    raise notice 'organization_settings is missing; attendance helpers use numeric defaults.';
    return;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_settings'
      and column_name = 'attendance_policy'
  ) then
    alter table public.organization_settings
      add column attendance_policy jsonb not null
      default '{"half_day_hours":4,"regularization_monthly_limit":3}'::jsonb;
  end if;

  update public.organization_settings
  set attendance_policy = '{"half_day_hours":4,"regularization_monthly_limit":3}'::jsonb
  where attendance_policy is null;
exception
  when others then
    raise notice 'attendance_policy column skipped: %', sqlerrm;
end
$body$;

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------

create or replace function public.attendance_setting(p_org uuid, p_key text, p_default numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw text;
begin
  if p_org is null or to_regclass('public.organization_settings') is null then
    return p_default;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_settings'
      and column_name = 'attendance_policy'
  ) then
    execute
      'select attendance_policy ->> $1 from public.organization_settings where organization_id = $2'
      into v_raw
      using p_key, p_org;
    if v_raw is not null and v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then
      return v_raw::numeric;
    end if;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_settings'
      and column_name = 'payroll_settings'
  ) then
    execute
      'select payroll_settings ->> $1 from public.organization_settings where organization_id = $2'
      into v_raw
      using p_key, p_org;
    if v_raw is not null and v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then
      return v_raw::numeric;
    end if;
  end if;

  return p_default;
exception
  when others then
    return p_default;
end;
$$;

create or replace function public.employee_shift_on(p_employee uuid, d date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select es.shift_id
      from public.employee_shifts es
      where es.employee_id = p_employee
        and (es.effective_from is null or es.effective_from <= d)
        and (es.effective_to is null or es.effective_to >= d)
      order by es.effective_from desc nulls last
      limit 1
    ),
    (select e.shift_id from public.employees e where e.id = p_employee)
  );
$$;

create or replace function public.employee_is_week_off(p_employee uuid, d date)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shift uuid;
  v_offs text[];
  v_key text;
  v_working text[];
  v_org uuid;
begin
  v_key := case extract(dow from d)::int
    when 0 then 'sun'
    when 1 then 'mon'
    when 2 then 'tue'
    when 3 then 'wed'
    when 4 then 'thu'
    when 5 then 'fri'
    else 'sat'
  end;

  v_shift := public.employee_shift_on(p_employee, d);
  if v_shift is not null then
    select week_offs into v_offs from public.shifts where id = v_shift;
    if v_offs is not null and cardinality(v_offs) > 0 then
      return exists (
        select 1
        from unnest(v_offs) as offs(day_name)
        where lower(left(trim(offs.day_name), 3)) = v_key
      );
    end if;
  end if;

  select organization_id into v_org from public.employees where id = p_employee;
  if to_regclass('public.organization_settings') is not null then
    select working_days into v_working
    from public.organization_settings
    where organization_id = v_org;
    if v_working is not null and cardinality(v_working) > 0 then
      return not exists (
        select 1
        from unnest(v_working) as days(day_name)
        where lower(left(trim(days.day_name), 3)) = v_key
      );
    end if;
  end if;

  return false;
end;
$$;

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

-- ---------------------------------------------------------------------------
-- 5. Day close jobs (manual, and scheduled when pg_cron exists)
--    11:00 IST next morning so a night shift that started the day before has ended.
-- ---------------------------------------------------------------------------

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
    employee_id,
    shift_id,
    attendance_date,
    status,
    source,
    worked_hours,
    overtime_hours
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
      select 1
      from public.attendance_records ar
      where ar.employee_id = e.id
        and ar.attendance_date = d
    )
    and not exists (
      select 1
      from public.leave_requests lr
      where lr.employee_id = e.id
        and lr.status = 'approved'
        and lr.start_date is not null
        and lr.end_date is not null
        and d between lr.start_date and lr.end_date
    )
    and not exists (
      select 1
      from public.holidays h
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

comment on function public.mark_absent_for_date(date) is
  'Insert absent rows for the date when there is no punch, no approved leave, and the day is not a mandatory holiday or week-off.';

comment on function public.close_missed_checkouts(date) is
  'Close open punches for the date with a synthetic shift-end check-out and flag them missed-checkout so the employee can regularize.';

revoke all on function public.mark_absent_for_date(date) from public, anon, authenticated;
revoke all on function public.close_missed_checkouts(date) from public, anon, authenticated;
grant execute on function public.mark_absent_for_date(date) to service_role;
grant execute on function public.close_missed_checkouts(date) to service_role;

-- pg_cron is optional. A missing extension must not fail this migration.
do $body$
declare
  v_absent text := $cmd$select public.mark_absent_for_date((timezone('Asia/Kolkata', now()))::date - 1);$cmd$;
  v_close text := $cmd$select public.close_missed_checkouts((timezone('Asia/Kolkata', now()))::date - 1);$cmd$;
begin
  begin
    create extension if not exists pg_cron;
  exception
    when others then
      raise notice 'pg_cron extension not available: %', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed. Call mark_absent_for_date(date) and close_missed_checkouts(date) manually.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'hrms_close_missed_checkouts') then
    perform cron.unschedule('hrms_close_missed_checkouts');
  end if;
  if exists (select 1 from cron.job where jobname = 'hrms_mark_absent_previous_day') then
    perform cron.unschedule('hrms_mark_absent_previous_day');
  end if;

  -- 05:15 and 05:30 UTC = 10:45 and 11:00 Asia/Kolkata.
  perform cron.schedule('hrms_close_missed_checkouts', '15 5 * * *', v_close);
  perform cron.schedule('hrms_mark_absent_previous_day', '30 5 * * *', v_absent);
exception
  when others then
    raise notice 'Attendance cron schedules skipped: %', sqlerrm;
end
$body$;

-- ---------------------------------------------------------------------------
-- 6. Regularization: monthly limit, team-lead approval, HR/admin override
-- ---------------------------------------------------------------------------

create or replace function public.enforce_regularization_monthly_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_start date;
  v_end date;
  v_org uuid;
  v_limit integer;
  v_count integer;
  v_override boolean;
begin
  if new.employee_id is null or new.attendance_id is null then
    return new;
  end if;

  if new.status is null then
    new.status := 'pending';
  end if;

  if new.status not in ('pending', 'approved') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  v_override := public.current_user_role() in ('admin', 'hr');

  select r.attendance_date, e.organization_id
    into v_date, v_org
  from public.attendance_records r
  join public.employees e on e.id = r.employee_id
  where r.id = new.attendance_id;

  v_date := coalesce(v_date, (timezone('Asia/Kolkata', now()))::date);
  v_start := date_trunc('month', v_date::timestamp)::date;
  v_end := (v_start + interval '1 month' - interval '1 day')::date;
  v_limit := public.attendance_setting(v_org, 'regularization_monthly_limit', 3)::integer;

  if tg_op = 'INSERT' and not v_override then
    select count(*) into v_count
    from public.attendance_corrections c
    join public.attendance_records r on r.id = c.attendance_id
    where c.employee_id = new.employee_id
      and c.id is distinct from new.id
      and c.status in ('pending', 'approved')
      and r.attendance_date between v_start and v_end;

    if v_count >= v_limit then
      raise exception 'Monthly regularization limit of % reached for this month.', v_limit;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' then
    if not v_override then
      select count(*) into v_count
      from public.attendance_corrections c
      join public.attendance_records r on r.id = c.attendance_id
      where c.employee_id = new.employee_id
        and c.id is distinct from new.id
        and c.status = 'approved'
        and r.attendance_date between v_start and v_end;

      if v_count >= v_limit then
        raise exception 'Monthly regularization limit of % reached. HR or an admin can override.', v_limit;
      end if;
    end if;

    update public.attendance_records
    set check_in = coalesce(new.requested_check_in, check_in),
        check_out = coalesce(new.requested_check_out, check_out),
        missed_checkout = case
          when new.requested_check_out is not null then false
          else missed_checkout
        end
    where id = new.attendance_id;

    perform public.recompute_attendance_hours(new.attendance_id);
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_corrections_monthly_limit on public.attendance_corrections;
create trigger attendance_corrections_monthly_limit
  before insert or update on public.attendance_corrections
  for each row
  execute function public.enforce_regularization_monthly_limit();

create or replace function public.request_attendance_regularization(
  p_attendance_id uuid,
  p_requested_check_in timestamptz,
  p_requested_check_out timestamptz,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid;
  v_id uuid;
begin
  if p_attendance_id is null then
    raise exception 'Select the attendance record to correct.';
  end if;
  if p_requested_check_in is null and p_requested_check_out is null then
    raise exception 'Provide a requested check-in or check-out time.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required.';
  end if;

  select employee_id into v_employee
  from public.attendance_records
  where id = p_attendance_id;

  if v_employee is null then
    raise exception 'Attendance record not found.';
  end if;
  if v_employee is distinct from public.current_employee_id() then
    raise exception 'You can only regularize your own attendance.';
  end if;

  if exists (
    select 1
    from public.attendance_corrections
    where attendance_id = p_attendance_id
      and status = 'pending'
  ) then
    raise exception 'A regularization request is already pending for this day.';
  end if;

  insert into public.attendance_corrections (
    employee_id,
    attendance_id,
    requested_check_in,
    requested_check_out,
    reason,
    status
  )
  values (
    v_employee,
    p_attendance_id,
    p_requested_check_in,
    p_requested_check_out,
    trim(p_reason),
    'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.decide_attendance_correction(p_correction_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid;
  v_status text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  select employee_id, status into v_employee, v_status
  from public.attendance_corrections
  where id = p_correction_id;

  if v_employee is null then
    raise exception 'Regularization request not found.';
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'This request is already %.', v_status;
  end if;
  if not public.can_manage_employee(v_employee) then
    raise exception 'Only the team lead, department head, HR, or an admin can decide this request.';
  end if;

  update public.attendance_corrections
  set status = p_decision,
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_correction_id;
end;
$$;

revoke all on function public.attendance_setting(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.employee_shift_on(uuid, date) from public, anon, authenticated;
revoke all on function public.employee_is_week_off(uuid, date) from public, anon, authenticated;
revoke all on function public.recompute_attendance_hours(uuid) from public, anon, authenticated;
grant execute on function public.attendance_setting(uuid, text, numeric) to service_role;
grant execute on function public.employee_shift_on(uuid, date) to service_role;
grant execute on function public.employee_is_week_off(uuid, date) to service_role;
grant execute on function public.recompute_attendance_hours(uuid) to service_role;

revoke all on function public.enforce_regularization_monthly_limit() from public, anon;
grant execute on function public.enforce_regularization_monthly_limit() to authenticated, service_role;

revoke all on function public.request_attendance_regularization(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.decide_attendance_correction(uuid, text) from public, anon;
grant execute on function public.request_attendance_regularization(uuid, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.decide_attendance_correction(uuid, text) to authenticated, service_role;
