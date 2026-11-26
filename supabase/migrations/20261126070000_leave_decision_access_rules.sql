-- Leave view/decision access rules, per explicit spec:
--   1. admin, hr: view + decide ALL leave requests.
--   2. general_manager: view + decide leave requests of ALL departments.
--   3. dept_head: view + decide only leave requests of the department they head.
--   4. team_lead: view + decide only leave requests of their own team (direct reports).
--   5. dept_head and team_lead can also view their own leave.
--   6. employee: view only their own leave.
--   7. general_manager, dept_head and team_lead must never decide their own
--      leave request (self-approval is blocked regardless of role).
--
-- Scope, per explicit instruction: ONLY leave view and leave decision logic
-- change. public.can_manage_employee() itself is NOT widened -- it still
-- backs attendance, goals, performance reviews, documents, and helpdesk
-- tickets for every role, and loosening it there was explicitly out of
-- scope. A new, narrow function -- public.can_decide_leave_request() --
-- is introduced instead, used ONLY by the leave decision path
-- (decide_leave_request() and the leave_requests update trigger). No other
-- table's RLS or function is touched.
--
-- What changes vs. today's live behavior (confirmed by reading the current
-- functions before writing this file):
--   * public.can_view_employee() (20261102100000_general_manager_role.sql)
--     already grants general_manager org-wide READ -- unchanged here, and
--     leave_requests_manager_view_team (SELECT policy) already uses it, so
--     rule 2's "view" half and rules 3-6 ("view" halves) already hold with
--     zero change. This file does not touch any SELECT policy.
--   * public.can_manage_employee() deliberately excludes general_manager
--     from DECIDE rights (that migration's own header says so explicitly).
--     That is the one real gap: today a General Manager can SEE every
--     department's leave requests but cannot approve/reject any outside
--     their own direct reports/headed department. This file closes that
--     gap for leave decisions only.
--   * decide_leave_request() and the enforce_leave_request_integrity()
--     trigger (both last defined, live, in
--     20260926120010_leave_cancel.sql) currently call
--     public.can_manage_employee(v_employee / new.employee_id) to decide
--     who may approve/reject. Both are updated here to call the new
--     public.can_decide_leave_request() instead. Every other check in both
--     functions (pending-only, rejected-cannot-be-approved, rejection
--     reason required, ledger crediting, ledger locking) is unchanged,
--     byte-for-byte, from the live 20260926120010 version.
--   * cancel_leave_request() is NOT touched -- cancellation was explicitly
--     not part of the stated rules, and already correctly uses
--     can_manage_employee for the "manager cancels on someone's behalf"
--     path (self-cancel uses the separate current_employee_id() branch,
--     unaffected either way).
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- 1. can_decide_leave_request: who may approve/reject a given employee's
--    leave request. Mirrors can_view_employee_scoped's dept-head/team-lead
--    branches (so dept_head is confined to the department they head, and
--    team_lead to their own direct reports), adds general_manager as an
--    org-wide branch (mirroring can_view_employee's GM branch), and keeps
--    the hr-cannot-touch-admin-or-GM exclusion that can_manage_employee
--    already enforces for every other table. Self-decision is blocked for
--    every role via the emp_id <> current_employee_id() check -- this is
--    rule 7, and it is unconditional, not role-specific, so there is no
--    special case to add for general_manager.
-- ---------------------------------------------------------------------------

create or replace function public.can_decide_leave_request(emp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    emp_id is not null
    and emp_id is distinct from public.current_employee_id()
    and (
      -- Rule 1: admin and hr decide every department's leave.
      (
        public.current_user_role() in ('admin', 'hr')
        and exists (
          select 1
          from public.employees e
          where e.id = emp_id
            and e.organization_id = public.current_org_id()
        )
      )
      -- Rule 2: general_manager decides every department's leave.
      or (
        public.current_user_role() = 'general_manager'
        and exists (
          select 1
          from public.employees e
          where e.id = emp_id
            and e.organization_id = public.current_org_id()
        )
      )
      -- Rule 3: dept_head decides only the department they head.
      or exists (
        select 1
        from public.employees e
        join public.departments d on d.id = e.department_id
        where e.id = emp_id
          and d.manager_id = public.current_employee_id()
          and e.organization_id = public.current_org_id()
      )
      -- Rule 4: team_lead decides only their own direct reports.
      or exists (
        select 1
        from public.employees e
        where e.id = emp_id
          and e.manager_id = public.current_employee_id()
          and e.organization_id = public.current_org_id()
      )
    )
    and not (
      -- Same hr exclusion can_manage_employee already enforces elsewhere:
      -- HR cannot decide an admin's or a general manager's leave.
      public.current_user_role() = 'hr'
      and exists (
        select 1
        from public.employees e
        join public.profiles p on p.id = e.profile_id
        where e.id = emp_id
          and p.role in ('admin', 'general_manager')
      )
    );
$$;

revoke all on function public.can_decide_leave_request(uuid) from public, anon;
grant execute on function public.can_decide_leave_request(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. decide_leave_request -- same as the live version, except the
--    can_manage_employee check is replaced with can_decide_leave_request.
-- ---------------------------------------------------------------------------

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
  if not public.can_decide_leave_request(v_employee) then
    raise exception 'Only the team lead, department head, general manager, HR, or an admin can decide this request.';
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

-- ---------------------------------------------------------------------------
-- 3. enforce_leave_request_integrity -- same as the live version
--    (20260926120010_leave_cancel.sql), except the approve/reject branch's
--    can_manage_employee check is replaced with can_decide_leave_request.
--    The cancel branch, the insert branch, overlap/balance checks, and the
--    rejection-reason requirement are all unchanged, byte-for-byte.
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

  -- Owner uses the self path. can_decide_leave_request is false for your own
  -- id, so a manager cannot cancel their own request on the manager path.
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
  if not public.can_decide_leave_request(new.employee_id) then
    raise exception 'Only the team lead, department head, general manager, HR, or an admin can decide this request.';
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

notify pgrst, 'reload schema';
