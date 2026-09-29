-- Regularization integrity.
-- punch_attendance, request_work_from_home, and attendance admin/HR policies
-- are unchanged. attendance_records_self_update and attendance_records_self_insert
-- stay dropped: an employee still cannot write check_in, check_out, status,
-- or hours by updating attendance_records. Approval applies requested times
-- only inside the security definer trigger below, then
-- recompute_attendance_hours runs on the server. decide_attendance_correction
-- still only records the decision.

-- One pending request per attendance row. attendance_records is unique on
-- (employee_id, attendance_date), so this is also one pending request per
-- employee and day when that key is present. A second insert loses even if
-- both passed an unlocked count.
do $body$
declare
  v_dup integer;
begin
  select count(*)::integer into v_dup
  from (
    select attendance_id
    from public.attendance_corrections
    where status = 'pending'
      and attendance_id is not null
    group by attendance_id
    having count(*) > 1
  ) duplicates;

  if v_dup > 0 then
    raise exception
      'Cannot add one-pending regularization index: % attendance row(s) already have more than one pending request.',
      v_dup;
  end if;
end
$body$;

create unique index if not exists attendance_corrections_one_pending_attendance
  on public.attendance_corrections (attendance_id)
  where status = 'pending'
    and attendance_id is not null;

comment on index public.attendance_corrections_one_pending_attendance is
  'At most one pending regularization for an attendance row (one employee and date).';

-- ---------------------------------------------------------------------------
-- Monthly cap of 3 (organization setting, default 3) under one transaction
-- lock per employee and attendance month. Two parallel requests cannot both
-- count the same number and insert. HR and admin still skip the cap.
-- A future attendance date is rejected for every role. No attachments.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_regularization_monthly_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_actual date;
  v_start date;
  v_end date;
  v_org uuid;
  v_limit integer;
  v_count integer;
  v_override boolean;
  v_row_found boolean;
begin
  if new.status is null then
    new.status := 'pending';
  end if;

  if tg_op = 'INSERT'
     and new.status in ('pending', 'approved')
     and (new.employee_id is null or new.attendance_id is null) then
    raise exception 'Select the attendance record to correct.';
  end if;

  if new.employee_id is null or new.attendance_id is null then
    return new;
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

  v_row_found := found;
  v_actual := case when v_row_found then v_date else null end;

  if v_actual > (timezone('Asia/Kolkata', now()))::date and tg_op = 'INSERT' then
    raise exception 'Regularization cannot be requested for a future attendance date.';
  end if;

  -- Month window stays the existing fallback when the row has no date.
  -- The one-pending day check uses v_actual so that fallback cannot collide
  -- with a real attendance row dated today.
  v_date := coalesce(v_date, (timezone('Asia/Kolkata', now()))::date);
  v_start := date_trunc('month', v_date::timestamp)::date;
  v_end := (v_start + interval '1 month' - interval '1 day')::date;
  v_limit := public.attendance_setting(v_org, 'regularization_monthly_limit', 3)::integer;

  -- Held until commit. Do not row-lock other correction rows here: an UPDATE
  -- already locked its target before this trigger, and locking the rest would
  -- deadlock with a second approval waiting on this same key.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'attendance-regularization:' || new.employee_id::text || ':' || to_char(v_start, 'YYYY-MM'),
      0
    )
  );

  if new.status = 'pending' and exists (
    select 1
    from public.attendance_corrections c
    left join public.attendance_records r on r.id = c.attendance_id
    where c.id is distinct from new.id
      and c.status = 'pending'
      and (
        c.attendance_id = new.attendance_id
        or (
          v_actual is not null
          and c.employee_id = new.employee_id
          and r.attendance_date = v_actual
        )
      )
  ) then
    raise exception 'A regularization request is already pending for this day.';
  end if;

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
  v_date date;
  v_id uuid;
  v_constraint text;
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

  select employee_id, attendance_date
    into v_employee, v_date
  from public.attendance_records
  where id = p_attendance_id;

  if v_employee is null then
    raise exception 'Attendance record not found.';
  end if;
  if v_employee is distinct from public.current_employee_id() then
    raise exception 'You can only regularize your own attendance.';
  end if;
  if v_date > (timezone('Asia/Kolkata', now()))::date then
    raise exception 'Regularization cannot be requested for a future attendance date.';
  end if;

  -- Fast path. The partial unique index and the locked trigger check above
  -- are what still hold if two requests pass this select together.
  if exists (
    select 1
    from public.attendance_corrections
    where attendance_id = p_attendance_id
      and status = 'pending'
  ) then
    raise exception 'A regularization request is already pending for this day.';
  end if;

  begin
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
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'attendance_corrections_one_pending_attendance'
         or sqlerrm like '%attendance_corrections_one_pending_attendance%' then
        raise exception 'A regularization request is already pending for this day.';
      end if;
      raise;
  end;

  return v_id;
end;
$$;

revoke all on function public.enforce_regularization_monthly_limit() from public, anon;
grant execute on function public.enforce_regularization_monthly_limit() to authenticated, service_role;

revoke all on function public.request_attendance_regularization(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.request_attendance_regularization(uuid, timestamptz, timestamptz, text) to authenticated, service_role;

comment on function public.request_attendance_regularization(uuid, timestamptz, timestamptz, text) is
  'Employee regularization request. Rejects a future attendance date. One pending row per attendance day, and at most the monthly cap, both enforced in the database.';

-- Punch migration already dropped these. Restate the drop so this file does
-- not put self write back. Work from home and punch stay on their own RPCs.
do $body$
begin
  if to_regclass('public.attendance_records') is null then
    return;
  end if;

  execute 'drop policy if exists attendance_records_self_update on public.attendance_records';
  execute 'drop policy if exists attendance_records_self_insert on public.attendance_records';
end
$body$;
