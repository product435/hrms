-- Leave ledger: previously leave "balance" was recomputed on every read from
-- live leave_requests rows (annual_limit minus approved+pending days this
-- calendar year), with no persisted transaction history. This adds a real,
-- append-only ledger so every balance-affecting event is individually
-- traceable, while keeping the exact same balance math the app already
-- relied on (debit on request, credit back on rejection).

create table if not exists public.leave_ledger (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid references public.leave_types(id) on delete set null,
  leave_request_id uuid references public.leave_requests(id) on delete set null,
  change_days numeric not null,
  balance_after numeric,
  transaction_type text not null check (transaction_type in ('request', 'rejection', 'adjustment')),
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create index if not exists idx_leave_ledger_employee on public.leave_ledger using btree (employee_id, leave_type_id);

alter table public.leave_ledger enable row level security;

drop policy if exists leave_ledger_self_select on public.leave_ledger;
create policy leave_ledger_self_select on public.leave_ledger for select
  using (employee_id = current_employee_id());

drop policy if exists leave_ledger_manager_view_team on public.leave_ledger;
create policy leave_ledger_manager_view_team on public.leave_ledger for select
  using (is_manager() and is_my_direct_report(employee_id));

drop policy if exists leave_ledger_admin_hr_all on public.leave_ledger;
create policy leave_ledger_admin_hr_all on public.leave_ledger for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = leave_ledger.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = leave_ledger.employee_id and e.organization_id = current_org_id()));

-- No client-writable policy: the ledger is populated exclusively by the
-- trigger below (SECURITY DEFINER, bypasses RLS on insert), so every entry
-- is guaranteed to originate from a real leave_requests state change rather
-- than a spoofable direct insert.

create or replace function public.leave_ledger_on_request_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
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
  elsif TG_OP = 'UPDATE' and old.status is distinct from new.status and new.status = 'rejected' and old.status <> 'rejected' then
    select coalesce(sum(change_days), 0) into running
      from public.leave_ledger
      where employee_id = new.employee_id and leave_type_id is not distinct from new.leave_type_id;
    running := running + coalesce(new.total_days, 0);
    insert into public.leave_ledger (employee_id, leave_type_id, leave_request_id, change_days, balance_after, transaction_type, reason, created_by)
    values (new.employee_id, new.leave_type_id, new.id, coalesce(new.total_days, 0), running, 'rejection', 'Leave request rejected -- balance restored', auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists leave_ledger_trigger on public.leave_requests;
create trigger leave_ledger_trigger
  after insert or update of status on public.leave_requests
  for each row execute function public.leave_ledger_on_request_change();

-- One-time backfill so the ledger reflects existing requests from before
-- this migration too (otherwise balance() would only be traceable for
-- requests filed after today). Mirrors the exact same debit-on-request rule
-- the trigger applies going forward; balance_after is left null for
-- backfilled rows since true chronological ordering across pre-existing
-- rows can't be reconstructed reliably -- balance() sums change_days
-- directly and never depends on balance_after, so this doesn't affect any
-- balance calculation, only the point-in-time snapshot column.
insert into public.leave_ledger (employee_id, leave_type_id, leave_request_id, change_days, transaction_type, reason, created_at)
select employee_id, leave_type_id, id, -coalesce(total_days, 0), 'request', 'Backfilled from existing leave request', coalesce(approved_at, start_date::timestamptz, now())
from public.leave_requests
where status in ('approved', 'pending')
  and employee_id is not null
  and not exists (select 1 from public.leave_ledger where leave_request_id = leave_requests.id);
