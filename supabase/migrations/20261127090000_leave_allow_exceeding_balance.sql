-- Leave: allow a request to exceed the remaining annual balance instead
-- of rejecting it outright. Deduct only up to what's available; store the
-- excess separately; restore only what was actually deducted on reject/
-- cancel.
--
-- Scope, per explicit instruction: ONLY the "exceeds the remaining leave
-- balance" block is removed. Everything else in
-- enforce_leave_request_integrity() is unchanged, byte-for-byte, from the
-- live version in 20261003120300_leave_monthly_cap.sql -- day-counting
-- (v_span check), overlap check, status-transition rules, the monthly cap
-- (assert_monthly_leave_cap), and the approval/rejection/cancellation
-- flow are all untouched. The monthly cap in particular is a DIFFERENT
-- rule from the annual balance check and was not asked to change --
-- requesting more days than remain in the annual allocation is now
-- allowed; exceeding the monthly cap is not touched by this file.
--
-- PAYROLL/REPORTS DEPENDENCY CHECK (done before writing any code, as
-- requested): grepped src/services/payrollService.ts -- zero references
-- to leave, leave_requests, leave_ledger, or leave_balances anywhere.
-- Payroll's only "deductions" figure comes from salary_structures.deductions,
-- a fixed value HR sets manually per employee; it has never read leave data
-- at all. insightsService.leaveMix() (shown on the Reports page as
-- "Approved leave days by type") reads leave_requests.total_days directly,
-- which this migration does NOT change -- a request's total_days still
-- always equals the full requested span, exactly as before. Extra days are
-- NOT marked unpaid, and no payroll logic is added here, per explicit
-- instruction not to make that call unilaterally.
--
-- ---------------------------------------------------------------------------
-- 1. New column: leave_requests.excess_days. The portion of total_days
--    that was NOT deducted from the balance because the balance didn't
--    cover it. 0 for the ordinary case (request fits within balance).
--    Nullable-free, defaulted to 0, additive only -- no existing row's
--    total_days/status/anything else is touched by adding it.
-- ---------------------------------------------------------------------------

alter table public.leave_requests
  add column if not exists excess_days numeric(6,2) not null default 0
  check (excess_days >= 0);

comment on column public.leave_requests.excess_days is
  'Portion of total_days that exceeded the remaining annual balance at submission time and was therefore never deducted from the ledger. 0 for an ordinary, fully-covered request. Set once at insert by enforce_leave_request_integrity(); never changed afterward.';

-- ---------------------------------------------------------------------------
-- 2. enforce_leave_request_integrity(): remove the "exceeds the remaining
--    leave balance" rejection. Compute and store new.excess_days instead.
--    The deducted amount (what the ledger trigger below will actually
--    debit) is total_days - excess_days = least(total_days, remaining),
--    floored at 0 remaining (a request made with zero or negative balance
--    deducts nothing and is entirely excess).
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
    -- Unchanged from the live rule: whole days match the inclusive range;
    -- a single half day in the range is stored as 0.5 less than that
    -- range and counts as 0.5 against the cap.
    if new.total_days <> v_span and new.total_days <> v_span - 0.5 then
      raise exception 'Leave days must equal the inclusive date range.';
    end if;

    if new.status is null or btrim(new.status) = '' then
      new.status := 'pending';
    elsif new.status <> 'pending' then
      raise exception 'New leave requests must start as pending.';
    end if;

    perform public.leave_lock_employee(new.employee_id);

    -- Unchanged: overlap check.
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

    -- Unchanged: same "used so far this year" computation, from the
    -- ledger (which after this migration reflects only what was actually
    -- DEDUCTED, i.e. never includes anyone's excess days -- so this
    -- correctly measures real remaining balance, not inflated by past
    -- over-the-limit requests).
    select coalesce(sum(ll.change_days), 0)
      into v_change
    from public.leave_ledger ll
    where ll.employee_id = new.employee_id
      and ll.leave_type_id = new.leave_type_id
      and ll.created_at >= v_year_start
      and ll.created_at < v_year_end;

    -- used = -sum(change_days); remaining = annual_limit - used.
    v_remaining := coalesce(v_limit, 0) + v_change;

    -- REMOVED: "raise exception 'This request exceeds the remaining
    -- leave balance...'" -- a request over the remaining balance is now
    -- ALLOWED. Instead: deduct only up to what's available (never
    -- negative), and store whatever's left over as excess_days. A
    -- request made with zero or negative remaining balance deducts
    -- nothing at all -- the whole thing is excess.
    new.excess_days := greatest(new.total_days - greatest(v_remaining, 0), 0);

    perform public.assert_monthly_leave_cap(
      new.employee_id,
      new.id,
      new.start_date,
      new.end_date,
      new.total_days
    );

    return new;
  end if;

  -- Everything below is UNCHANGED from the live function -- status
  -- transitions, cancellation, approval/rejection authorization and the
  -- monthly cap re-check on approval are untouched.

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

revoke all on function public.enforce_leave_request_integrity() from public, anon;
grant execute on function public.enforce_leave_request_integrity() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. leave_ledger_on_request_change(): debit/credit only the ACTUALLY
--    DEDUCTED amount (total_days - excess_days), never the full
--    total_days, never the excess. On insert this is new.total_days -
--    new.excess_days (excess_days was just set by the trigger above, in
--    the same BEFORE-trigger pass, so it's already on NEW by the time
--    this AFTER trigger fires). On rejection/cancellation, the SAME
--    formula is used to compute what to credit back, so exactly what was
--    debited is restored -- never more, never the excess, matching
--    "restore only what was actually deducted" exactly.
-- ---------------------------------------------------------------------------

create or replace function public.leave_ledger_on_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  running numeric;
  v_already_restored boolean;
  v_deducted numeric;
begin
  v_deducted := greatest(coalesce(new.total_days, 0) - coalesce(new.excess_days, 0), 0);

  if TG_OP = 'INSERT' then
    select coalesce(sum(change_days), 0) into running
      from public.leave_ledger
      where employee_id = new.employee_id and leave_type_id is not distinct from new.leave_type_id;
    running := running - v_deducted;
    insert into public.leave_ledger (employee_id, leave_type_id, leave_request_id, change_days, balance_after, transaction_type, reason, created_by)
    values (
      new.employee_id, new.leave_type_id, new.id, -v_deducted, running, 'request',
      case when new.excess_days > 0
        then format('Leave requested (%s days from balance, %s days extra)', v_deducted, new.excess_days)
        else 'Leave requested'
      end,
      auth.uid()
    );
  elsif TG_OP = 'UPDATE' and old.status is distinct from new.status then
    if old.status = 'rejected' and new.status = 'approved' then
      raise exception 'A rejected leave request cannot be approved.';
    end if;
    if old.status = 'cancelled' and new.status in ('approved', 'rejected') then
      raise exception 'A cancelled leave request cannot be approved or rejected.';
    end if;
    if old.status = 'rejected' and new.status = 'cancelled' then
      raise exception 'A rejected leave request cannot be cancelled.';
    end if;
    if old.status = 'pending' and new.status = 'rejected' then
      if nullif(btrim(coalesce(new.rejection_reason, '')), '') is null then
        raise exception 'A rejection reason is required.';
      end if;
      select coalesce(sum(change_days), 0) into running
        from public.leave_ledger
        where employee_id = new.employee_id and leave_type_id is not distinct from new.leave_type_id;
      running := running + v_deducted;
      insert into public.leave_ledger (employee_id, leave_type_id, leave_request_id, change_days, balance_after, transaction_type, reason, created_by)
      values (new.employee_id, new.leave_type_id, new.id, v_deducted, running, 'rejection', 'Leave request rejected -- balance restored', auth.uid());
    elsif old.status in ('pending', 'approved') and new.status = 'cancelled' then
      select exists (
        select 1
        from public.leave_ledger ll
        where ll.leave_request_id = new.id
          and ll.change_days > 0
          and ll.transaction_type in ('rejection', 'cancellation')
      ) into v_already_restored;
      if not v_already_restored then
        select coalesce(sum(change_days), 0) into running
          from public.leave_ledger
          where employee_id = new.employee_id and leave_type_id is not distinct from new.leave_type_id;
        running := running + v_deducted;
        insert into public.leave_ledger (employee_id, leave_type_id, leave_request_id, change_days, balance_after, transaction_type, reason, created_by)
        values (new.employee_id, new.leave_type_id, new.id, v_deducted, running, 'cancellation', 'Leave request cancelled -- balance restored', auth.uid());
      end if;
    elsif old.status is distinct from 'pending' or new.status not in ('approved', 'rejected') then
      raise exception 'Only a pending leave request can be approved or rejected.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists leave_requests_integrity on public.leave_requests;
create trigger leave_requests_integrity
  before insert or update on public.leave_requests
  for each row
  execute function public.enforce_leave_request_integrity();

drop trigger if exists leave_ledger_trigger on public.leave_requests;
create trigger leave_ledger_trigger
  after insert or update of status on public.leave_requests
  for each row execute function public.leave_ledger_on_request_change();

-- ---------------------------------------------------------------------------
-- 4. One-time, additive-only backfill: existing rows all have
--    excess_days = 0 by the column default, which is already correct for
--    every historical request (none of them could have exceeded the
--    balance before this migration, since the old trigger always
--    rejected that case) -- no backfill UPDATE is needed or performed.
-- ---------------------------------------------------------------------------

-- (Intentionally no backfill statement -- see comment above.)

notify pgrst, 'reload schema';
