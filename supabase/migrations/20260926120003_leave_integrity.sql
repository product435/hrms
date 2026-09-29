-- Leave integrity: overlap, balance, and a single pending decision.
-- Apply still inserts a pending leave_requests row. These rules run in the
-- database so a direct insert or update cannot skip them.
--
-- Balance matches leaveService.balance: remaining = annual_limit minus the
-- days already taken this calendar year. The ledger stores a debit as a
-- negative change_days and a rejection credit as a positive change_days, so
-- used = -sum(change_days) and remaining = annual_limit + sum(change_days).
-- The year is the Asia/Kolkata calendar year of leave_ledger.created_at,
-- including all of 31 December.
--
-- The ledger still debits on insert and credits once on pending -> rejected.
-- A rejected row cannot later be approved, and no other status change credits
-- the balance. Cancel, half-day, and carry-forward are not part of this change.

alter table public.leave_requests
  add column if not exists rejection_reason text;

-- Same lock for apply and decide. Advisory lock covers the first request,
-- when there is no ledger or request row to lock yet. Row locks cover an
-- existing balance so a parallel transaction waits.
create or replace function public.leave_lock_employee(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_employee_id is null then
    raise exception 'A leave request must belong to an employee.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 0));

  perform 1
  from public.leave_requests
  where employee_id = p_employee_id
  for update;

  perform 1
  from public.leave_ledger
  where employee_id = p_employee_id
  for update;
end;
$$;

revoke all on function public.leave_lock_employee(uuid) from public, anon, authenticated;
-- The security definer trigger runs as the migration owner and calls this helper.
grant execute on function public.leave_lock_employee(uuid) to current_user;

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
    if new.total_days <> v_span then
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

revoke all on function public.enforce_leave_request_integrity() from public, anon;
grant execute on function public.enforce_leave_request_integrity() to authenticated, service_role;

drop trigger if exists leave_requests_integrity on public.leave_requests;
create trigger leave_requests_integrity
  before insert or update on public.leave_requests
  for each row
  execute function public.enforce_leave_request_integrity();

-- Credit only pending -> rejected. Any other status change, including
-- rejected -> approved, does not touch the ledger. The before trigger already
-- rejects those transitions; this keeps the credit rule correct on its own.
create or replace function public.leave_ledger_on_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  running numeric;
begin
  if TG_OP = 'INSERT' then
    select coalesce(sum(change_days), 0) into running
      from public.leave_ledger
      where employee_id = new.employee_id and leave_type_id is not distinct from new.leave_type_id;
    running := running - coalesce(new.total_days, 0);
    insert into public.leave_ledger (employee_id, leave_type_id, leave_request_id, change_days, balance_after, transaction_type, reason, created_by)
    values (new.employee_id, new.leave_type_id, new.id, -coalesce(new.total_days, 0), running, 'request', 'Leave requested', auth.uid());
  elsif TG_OP = 'UPDATE' and old.status is distinct from new.status then
    if old.status = 'rejected' and new.status = 'approved' then
      raise exception 'A rejected leave request cannot be approved.';
    end if;
    if old.status = 'pending' and new.status = 'rejected' then
      if nullif(btrim(coalesce(new.rejection_reason, '')), '') is null then
        raise exception 'A rejection reason is required.';
      end if;
      select coalesce(sum(change_days), 0) into running
        from public.leave_ledger
        where employee_id = new.employee_id and leave_type_id is not distinct from new.leave_type_id;
      running := running + coalesce(new.total_days, 0);
      insert into public.leave_ledger (employee_id, leave_type_id, leave_request_id, change_days, balance_after, transaction_type, reason, created_by)
      values (new.employee_id, new.leave_type_id, new.id, coalesce(new.total_days, 0), running, 'rejection', 'Leave request rejected -- balance restored', auth.uid());
    elsif old.status is distinct from 'pending' or new.status not in ('approved', 'rejected') then
      raise exception 'Only a pending leave request can be approved or rejected.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.decide_leave_request(
  p_request_id uuid,
  p_decision text,
  p_rejection_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid;
  v_status text;
  v_reason text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  v_reason := nullif(btrim(coalesce(p_rejection_reason, '')), '');
  if p_decision = 'rejected' and v_reason is null then
    raise exception 'A rejection reason is required.';
  end if;

  select employee_id, status
    into v_employee, v_status
  from public.leave_requests
  where id = p_request_id;

  if not found or v_employee is null then
    raise exception 'Leave request not found.';
  end if;

  -- Lock before the row lock so this cannot deadlock with apply, which takes
  -- the same employee advisory lock in the before-insert trigger.
  perform public.leave_lock_employee(v_employee);

  select employee_id, status
    into v_employee, v_status
  from public.leave_requests
  where id = p_request_id
  for update;

  if not found or v_employee is null then
    raise exception 'Leave request not found.';
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'Only a pending leave request can be decided (current status: %).', coalesce(v_status, 'missing');
  end if;
  if v_employee is not distinct from public.current_employee_id() then
    raise exception 'You cannot decide your own leave request.';
  end if;
  if not public.can_manage_employee(v_employee) then
    raise exception 'Only the team lead, department head, HR, or an admin can decide this request.';
  end if;

  update public.leave_requests
  set status = p_decision,
      rejection_reason = case when p_decision = 'rejected' then v_reason else null end,
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_request_id;
end;
$$;

revoke all on function public.decide_leave_request(uuid, text, text) from public;
revoke all on function public.decide_leave_request(uuid, text, text) from anon;
grant execute on function public.decide_leave_request(uuid, text, text) to authenticated;
