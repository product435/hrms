-- Leave cancellation. Replaces the integrity trigger function and the ledger
-- function from 20260926120003 without relaxing those rules.
--
-- Insert still debits leave_ledger. Pending -> rejected still credits once.
-- A rejected row still cannot be approved. Pending -> approved still does not
-- credit. Apply still checks overlap, balance, and date order under the same
-- employee advisory lock. decide_leave_request is unchanged.
--
-- Cancel is a separate path. The owner of a pending or approved request can
-- cancel it (pending is a withdrawal). A manager uses can_manage_employee,
-- which is already false for their own employee id, so they cannot cancel
-- their own request on the manager path. Cancellation credits the ledger
-- once, because the debit happened on insert. A second cancel, or cancelling
-- a rejected row, does not credit. A cancelled row cannot be approved or
-- rejected.

alter table public.leave_ledger drop constraint if exists leave_ledger_transaction_type_check;

do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'leave_ledger'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%transaction_type%'
  loop
    execute format('alter table public.leave_ledger drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.leave_ledger
  add constraint leave_ledger_transaction_type_check
  check (transaction_type in ('request', 'rejection', 'cancellation', 'adjustment'));

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

revoke all on function public.enforce_leave_request_integrity() from public, anon;
grant execute on function public.enforce_leave_request_integrity() to authenticated, service_role;

-- Credit only pending -> rejected, and pending or approved -> cancelled.
-- A second cancel does not change status, so it never reaches the credit.
-- Cancelling a rejected row is rejected above and does not credit. Any other
-- status change, including rejected -> approved, does not touch the ledger.
create or replace function public.leave_ledger_on_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  running numeric;
  v_already_restored boolean;
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
      running := running + coalesce(new.total_days, 0);
      insert into public.leave_ledger (employee_id, leave_type_id, leave_request_id, change_days, balance_after, transaction_type, reason, created_by)
      values (new.employee_id, new.leave_type_id, new.id, coalesce(new.total_days, 0), running, 'rejection', 'Leave request rejected -- balance restored', auth.uid());
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
        running := running + coalesce(new.total_days, 0);
        insert into public.leave_ledger (employee_id, leave_type_id, leave_request_id, change_days, balance_after, transaction_type, reason, created_by)
        values (new.employee_id, new.leave_type_id, new.id, coalesce(new.total_days, 0), running, 'cancellation', 'Leave request cancelled -- balance restored', auth.uid());
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
  for each row
  execute function public.leave_ledger_on_request_change();

create or replace function public.cancel_leave_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid;
  v_status text;
begin
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
  if v_status is distinct from 'pending' and v_status is distinct from 'approved' then
    raise exception 'Only a pending or approved leave request can be cancelled (current status: %).', coalesce(v_status, 'missing');
  end if;

  -- Requester uses the self path. can_manage_employee is false for the
  -- caller's own employee id, so this does not treat a manager as allowed
  -- to cancel their own request through the manager check.
  if v_employee is distinct from public.current_employee_id()
     and not public.can_manage_employee(v_employee) then
    raise exception 'You can only cancel your own leave, or leave for an employee you manage.';
  end if;

  update public.leave_requests
  set status = 'cancelled'
  where id = p_request_id;
end;
$$;

revoke all on function public.cancel_leave_request(uuid) from public;
revoke all on function public.cancel_leave_request(uuid) from anon;
revoke all on function public.cancel_leave_request(uuid) from service_role;
grant execute on function public.cancel_leave_request(uuid) to authenticated;
