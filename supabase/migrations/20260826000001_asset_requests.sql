-- Employee Asset Request. New, standalone table -- no existing asset table
-- (assets, asset_assignments, asset_repairs) is touched. This is not a
-- duplicate of any of them: assets/asset_assignments record actual
-- inventory and completed hand-outs; this records a pre-approval ask, which
-- needs its own PENDING/APPROVED/REJECTED lifecycle that doesn't belong on
-- either of those tables.
create table if not exists public.asset_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  category text not null check (category in ('Laptop', 'Desktop', 'Monitor', 'Mobile', 'ID Card', 'Other')),
  details text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_asset_requests_employee on public.asset_requests(employee_id);
create index if not exists idx_asset_requests_status on public.asset_requests(status);

drop trigger if exists set_updated_at on public.asset_requests;
create trigger set_updated_at before update on public.asset_requests
  for each row execute function public.set_updated_at();

alter table public.asset_requests enable row level security;

-- Employee: insert + read only their own requests.
create policy asset_requests_self_select on public.asset_requests for select
  using (employee_id = current_employee_id());
create policy asset_requests_self_insert on public.asset_requests for insert
  with check (employee_id = current_employee_id());

-- HR/Admin: full read + manage (approve/reject), org-scoped -- same pattern
-- as every other child table (documents, goals, leave_requests, ...).
create policy asset_requests_admin_hr_all on public.asset_requests for all
  using (
    is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = asset_requests.employee_id and e.organization_id = current_org_id()
    )
  )
  with check (
    is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = asset_requests.employee_id and e.organization_id = current_org_id()
    )
  );
