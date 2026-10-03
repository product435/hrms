-- Two leave days per calendar month, across every leave type.
-- A request that crosses a month boundary is split. Half days count as 0.5.
-- Cancelled and rejected requests are excluded. Approval checks again.
-- The annual per-type balance check is unchanged.

update public.organization_settings
set leave_policy = coalesce(leave_policy, '{}'::jsonb) || jsonb_build_object('monthly_leave_limit', 2);

create or replace function public.leave_policy_setting(p_org uuid, p_key text, p_default numeric)
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

  select os.leave_policy ->> p_key
    into v_raw
  from public.organization_settings os
  where os.organization_id = p_org;

  if v_raw is not null and v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then
    return v_raw::numeric;
  end if;

  return p_default;
exception
  when others then
    return p_default;
end;
$$;

-- Split total_days across the inclusive date range. Each day takes at most 1,
-- and the last day keeps the remainder, so a one-day request of 0.5 stays 0.5
-- and a request that crosses a month is not charged entirely to the start month.
create or replace function public.leave_days_by_month(p_start date, p_end date, p_total numeric)
returns table (month_start date, days numeric)
language plpgsql
stable
set search_path = public
as $$
declare
  v_day date;
  v_remaining numeric := coalesce(p_total, 0);
  v_charge numeric;
begin
  if p_start is null or p_end is null or p_end < p_start then
    return;
  end if;

  v_day := p_start;
  while v_day <= p_end loop
    if v_day = p_end then
      v_charge := v_remaining;
    else
      v_charge := least(1, greatest(v_remaining, 0));
    end if;
    v_remaining := v_remaining - v_charge;
    month_start := date_trunc('month', v_day)::date;
    days := v_charge;
    return next;
    v_day := v_day + 1;
  end loop;
end;
$$;

create or replace function public.assert_monthly_leave_cap(
  p_employee_id uuid,
  p_request_id uuid,
  p_start date,
  p_end date,
  p_total numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_limit numeric;
  v_month date;
  v_existing numeric;
  v_adding numeric;
  v_label text;
  v_shown text;
begin
  if p_employee_id is null or p_start is null or p_end is null or p_total is null then
    return;
  end if;

  select e.organization_id
    into v_org
  from public.employees e
  where e.id = p_employee_id;

  v_limit := public.leave_policy_setting(v_org, 'monthly_leave_limit', 2);
  if v_limit is null then
    return;
  end if;

  for v_month, v_adding in
    select allocated.month_start, sum(allocated.days)
    from public.leave_days_by_month(p_start, p_end, p_total) as allocated
    group by allocated.month_start
  loop
    if coalesce(v_adding, 0) <= 0 then
      continue;
    end if;

    select coalesce(sum(used.days), 0)
      into v_existing
    from public.leave_requests lr
    cross join lateral public.leave_days_by_month(lr.start_date, lr.end_date, lr.total_days) as used
    where lr.employee_id = p_employee_id
      and lr.id is distinct from p_request_id
      and lr.status in ('pending', 'approved')
      and used.month_start = v_month;

    if coalesce(v_existing, 0) + v_adding > v_limit then
      v_label := trim(to_char(v_month, 'FMMonth YYYY'));
      v_shown := trim(trailing '.' from trim(trailing '0' from to_char(coalesce(v_existing, 0), 'FM999990.0')));
      raise exception 'Only % leave days are allowed per month. You already have % in %.',
        trim(trailing '.' from trim(trailing '0' from to_char(v_limit, 'FM999990.0'))),
        v_shown,
        v_label;
    end if;
  end loop;
end;
$$;

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

    perform public.assert_monthly_leave_cap(
      new.employee_id,
      new.id,
      new.start_date,
      new.end_date,
      new.total_days
    );

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
    perform public.assert_monthly_leave_cap(
      new.employee_id,
      new.id,
      new.start_date,
      new.end_date,
      new.total_days
    );
  else
    new.rejection_reason := btrim(new.rejection_reason);
  end if;

  return new;
end;
$$;

revoke all on function public.leave_policy_setting(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.leave_days_by_month(date, date, numeric) from public, anon, authenticated;
revoke all on function public.assert_monthly_leave_cap(uuid, uuid, date, date, numeric) from public, anon, authenticated;
grant execute on function public.leave_policy_setting(uuid, text, numeric) to service_role;
grant execute on function public.leave_days_by_month(date, date, numeric) to service_role;
grant execute on function public.assert_monthly_leave_cap(uuid, uuid, date, date, numeric) to service_role;

revoke all on function public.enforce_leave_request_integrity() from public, anon;
grant execute on function public.enforce_leave_request_integrity() to authenticated, service_role;
