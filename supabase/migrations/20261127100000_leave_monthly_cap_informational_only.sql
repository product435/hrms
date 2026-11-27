-- Leave: the monthly cap (2 days/month, from assert_monthly_leave_cap)
-- still blocked submission and approval, even though the annual balance
-- check was already made non-blocking in
-- 20261127090000_leave_allow_exceeding_balance.sql. Reported directly:
-- "Only 2 leave days are allowed per month. You already have 0 in
-- December 2026." on a 1-12 Dec Casual request with balance 10 -- the
-- exact message assert_monthly_leave_cap() raises.
--
-- FULL AUDIT OF EVERY RULE THAT CAN REJECT A REQUEST FOR BALANCE OR LIMIT
-- REASONS (as requested, point 5), read directly from the live trigger
-- functions, not assumed:
--
--   1. "This request exceeds the remaining leave balance (N days left)."
--      -- the ANNUAL balance check. Already removed (made non-blocking,
--      excess_days introduced instead) by 20261127090000. NOT touched
--      again here.
--   2. "Only N leave days are allowed per month. You already have M in
--      <Month Year>." -- the MONTHLY cap, from assert_monthly_leave_cap().
--      Called from enforce_leave_request_integrity() in TWO places: once
--      on INSERT (new request submission) and once again on UPDATE when
--      new.status = 'approved' (the approval re-check). THIS is the rule
--      this migration removes as a blocker.
--   3. No other rule in enforce_leave_request_integrity(),
--      leave_ledger_on_request_change(), cancel_leave_request(), or
--      decide_leave_request() rejects a request for a balance or limit
--      reason. Every other raise exception in those four functions is
--      about something else entirely: missing required fields, an
--      invalid date range, total_days not matching the date span, a
--      status-transition rule (a rejected/cancelled request can't be
--      approved, only a pending request can be decided, etc.), or an
--      authorization rule (you can't decide your own request; only a
--      manager/HR/admin can decide; you can only cancel your own leave or
--      a report's). None of those are balance or limit checks, and per
--      explicit instruction ("keep blocking only invalid dates and
--      overlapping requests"), none of them are touched here.
--
-- FIX: remove both assert_monthly_leave_cap() calls from
-- enforce_leave_request_integrity() (submission and approval). The
-- function itself, and its helpers leave_days_by_month()/
-- leave_policy_setting(), are NOT dropped -- they become unused by the
-- trigger but are left in place, same convention already used by the
-- (unapplied) 20261123105954_relax_attendance_dwr_leave_rules.sql draft
-- for this exact function. They are reused below, read-only, to compute
-- the SAME math for the new informational-only flag, so "would this
-- exceed the monthly cap" is answered identically to how it always was,
-- it simply no longer blocks anything.
--
-- INFORMATIONAL ONLY, PER EXPLICIT INSTRUCTION: two new read-only,
-- non-blocking functions expose the same "would exceed the monthly cap"
-- computation assert_monthly_leave_cap() already does internally, with no
-- new stored column and no snapshot taken at submission time -- every
-- call recomputes live against the CURRENT state of that employee's
-- requests, so it can never go stale (e.g. if an earlier request in the
-- same month is later cancelled, a previously-flagged request's live
-- status updates automatically the next time it's checked):
--   * leave_monthly_cap_preview(employee_id, start, end, total_days) --
--     for the "Apply for leave" dialog, before any request row exists.
--   * leave_monthly_cap_flags(request_ids uuid[]) -- batched, for an
--     approver's list of already-submitted requests, one query for the
--     whole visible page instead of one per row.
--
-- This file does NOT touch excess_days, the balance deduction, leave
-- notifications, or the approval/rejection/cancellation flow -- all
-- exactly as they are, per explicit instruction.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- 1. enforce_leave_request_integrity(): remove both
--    assert_monthly_leave_cap() calls. Everything else is byte-for-byte
--    identical to 20261127090000_leave_allow_exceeding_balance.sql (which
--    is itself byte-for-byte identical to the live function except for
--    the annual-balance block already removed there).
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
    if new.total_days <> v_span and new.total_days <> v_span - 0.5 then
      raise exception 'Leave days must equal the inclusive date range.';
    end if;

    if new.status is null or btrim(new.status) = '' then
      new.status := 'pending';
    elsif new.status <> 'pending' then
      raise exception 'New leave requests must start as pending.';
    end if;

    perform public.leave_lock_employee(new.employee_id);

    -- Unchanged: overlap check -- still the only date-based block, per
    -- explicit instruction ("keep blocking only invalid dates and
    -- overlapping requests").
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

    v_remaining := coalesce(v_limit, 0) + v_change;

    -- Unchanged from 20261127090000: the annual balance check is
    -- informational only (excess_days), never blocking.
    new.excess_days := greatest(new.total_days - greatest(v_remaining, 0), 0);

    -- REMOVED: perform public.assert_monthly_leave_cap(...) -- the
    -- monthly cap no longer blocks submission. See
    -- leave_monthly_cap_preview() below for the informational-only
    -- equivalent, called by the frontend before submit.

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
    -- REMOVED: perform public.assert_monthly_leave_cap(...) -- the
    -- monthly cap no longer blocks approval either.
  else
    new.rejection_reason := btrim(new.rejection_reason);
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_leave_request_integrity() from public, anon;
grant execute on function public.enforce_leave_request_integrity() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. leave_monthly_cap_preview(): informational-only, for the "Apply for
--    leave" dialog before any request row exists. Reuses the EXACT same
--    leave_days_by_month()/leave_policy_setting() math
--    assert_monthly_leave_cap() already used -- the numbers shown are
--    never invented separately from what the (now-informational) rule
--    actually means. p_exclude_request_id lets the same function be
--    reused for an existing request (see leave_monthly_cap_flags below)
--    by excluding that request's own rows from "already used."
-- ---------------------------------------------------------------------------

create or replace function public.leave_monthly_cap_preview(
  p_employee_id uuid,
  p_start date,
  p_end date,
  p_total numeric,
  p_exclude_request_id uuid default null
)
returns table (month_label text, limit_days numeric, already_used numeric, would_add numeric, exceeds boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_limit numeric;
  v_month date;
  v_existing numeric;
  v_adding numeric;
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
      and lr.id is distinct from p_exclude_request_id
      and lr.status in ('pending', 'approved')
      and used.month_start = v_month;

    month_label := trim(to_char(v_month, 'FMMonth YYYY'));
    limit_days := v_limit;
    already_used := coalesce(v_existing, 0);
    would_add := v_adding;
    exceeds := (coalesce(v_existing, 0) + v_adding > v_limit);
    return next;
  end loop;
end;
$$;

revoke all on function public.leave_monthly_cap_preview(uuid, date, date, numeric, uuid) from public, anon;
grant execute on function public.leave_monthly_cap_preview(uuid, date, date, numeric, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. leave_monthly_cap_flags(): batched, for an approver's (or the
--    requester's own) list of already-submitted requests -- one call for
--    the whole visible page, not one per row. Returns whether EACH given
--    request, on its own, currently pushes its month over the limit
--    (computed the same way, live, against the CURRENT set of that
--    employee's other pending/approved requests -- so it is never a
--    stale snapshot).
-- ---------------------------------------------------------------------------

create or replace function public.leave_monthly_cap_flags(p_request_ids uuid[])
returns table (request_id uuid, exceeds_monthly_limit boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_request record;
  v_result record;
  v_exceeds boolean;
begin
  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    return;
  end if;

  for v_request in
    select lr.id, lr.employee_id, lr.start_date, lr.end_date, lr.total_days
    from public.leave_requests lr
    where lr.id = any(p_request_ids)
  loop
    v_exceeds := false;
    for v_result in
      select *
      from public.leave_monthly_cap_preview(
        v_request.employee_id, v_request.start_date, v_request.end_date,
        v_request.total_days, v_request.id
      )
    loop
      if v_result.exceeds then
        v_exceeds := true;
      end if;
    end loop;

    request_id := v_request.id;
    exceeds_monthly_limit := v_exceeds;
    return next;
  end loop;
end;
$$;

revoke all on function public.leave_monthly_cap_flags(uuid[]) from public, anon;
grant execute on function public.leave_monthly_cap_flags(uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
