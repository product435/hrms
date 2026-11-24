-- Sales Targets for the Forecasting tab's "Sales Target" KPI.
--
-- Confirmed before writing this: no sales/revenue target or quota source
-- exists anywhere in the schema (exhaustive search of every migration,
-- every *.sql file, src/types/*.ts, src/services/*.ts). The KRA/KPI
-- `kpi_definitions.target` column is a different, unrelated concept
-- (generic per-employee/per-department performance metrics such as
-- attendance % or DWR submission rate -- not currency, not CRM-scoped,
-- governed by its own RLS) and must not be conflated with this.
--
-- A target row is either:
--   * organisation-wide (owner_id is null) -- the company's target for a period.
--   * a specific salesperson's target (owner_id set).
-- for one period_kind ('monthly' | 'quarterly' | 'yearly') starting at
-- period_start (the first day of that month/quarter/year -- same
-- convention as src/services/forecastService.ts's ForecastPeriod.start).
--
-- Visibility and write rules follow the SAME pattern already used by the
-- 5 existing CRM tables (crm_accounts/crm_contacts/crm_leads/crm_deals/
-- crm_activities, see 20261102110000_sales_crm.sql): select = any CRM
-- member in the organisation (has_crm_access()); write = only a sales
-- lead or Super Admin (crm_can_manage_all()) -- a plain rep can read
-- targets (including their own) but never set one, since a target is
-- management-set, not self-reported. This differs from the existing
-- crm_before_write trigger's "owner_id defaults to the writer, any
-- writer may create their own row" model, which does not fit a target a
-- rep should never be able to set for themselves -- so this table gets
-- its own small trigger instead of being folded into crm_before_write.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself (e.g. `supabase db push` or
-- the dashboard SQL editor) after reviewing it.

create table if not exists public.crm_sales_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- null = organisation-wide target; set = one salesperson's target.
  owner_id uuid references public.employees(id) on delete cascade,
  period_kind text not null check (period_kind in ('monthly', 'quarterly', 'yearly')),
  -- First day of the month/quarter/year, matching ForecastPeriod.start.
  period_start date not null,
  target_amount numeric(16, 2) not null check (target_amount >= 0),
  currency text not null default 'INR',
  notes text,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- At most one target per (org, owner-or-company, period_kind, period_start).
  constraint crm_sales_targets_unique unique (organization_id, owner_id, period_kind, period_start)
);

create index if not exists idx_crm_sales_targets_org_period
  on public.crm_sales_targets (organization_id, period_kind, period_start);
create index if not exists idx_crm_sales_targets_owner
  on public.crm_sales_targets (owner_id);

create or replace function public.crm_sales_targets_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_me uuid := public.current_employee_id();
begin
  -- Service role / SQL editor (no auth user) may write freely.
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.organization_id := v_org;
    new.created_by := v_me;
    new.created_at := now();
  else
    if new.organization_id is distinct from old.organization_id then
      raise exception 'Sales targets cannot move between organisations.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  if new.organization_id is null then
    raise exception 'Your account is not linked to an organisation.';
  end if;

  if new.owner_id is not null and not public.crm_owner_in_org(new.owner_id) then
    raise exception 'Target owner must be an employee of your organisation.';
  end if;

  -- Only a sales lead or Super Admin may set a target (never a plain rep,
  -- even for themselves -- a target is management-set, not self-reported).
  if not public.crm_can_manage_all() then
    raise exception 'Only a sales lead or super admin can set sales targets.';
  end if;

  return new;
end;
$$;

revoke all on function public.crm_sales_targets_before_write() from public, anon, authenticated;

drop trigger if exists crm_sales_targets_before_write on public.crm_sales_targets;
create trigger crm_sales_targets_before_write
  before insert or update on public.crm_sales_targets
  for each row
  execute function public.crm_sales_targets_before_write();

alter table public.crm_sales_targets enable row level security;
revoke all on public.crm_sales_targets from anon;
grant select, insert, update, delete on public.crm_sales_targets to authenticated;

drop policy if exists crm_sales_targets_select on public.crm_sales_targets;
create policy crm_sales_targets_select on public.crm_sales_targets for select to authenticated
  using (
    organization_id = public.current_org_id() and public.has_crm_access()
  );

drop policy if exists crm_sales_targets_insert on public.crm_sales_targets;
create policy crm_sales_targets_insert on public.crm_sales_targets for insert to authenticated
  with check (
    organization_id = public.current_org_id() and public.crm_can_manage_all()
  );

drop policy if exists crm_sales_targets_update on public.crm_sales_targets;
create policy crm_sales_targets_update on public.crm_sales_targets for update to authenticated
  using (
    organization_id = public.current_org_id() and public.crm_can_manage_all()
  )
  with check (
    organization_id = public.current_org_id() and public.crm_can_manage_all()
  );

drop policy if exists crm_sales_targets_delete on public.crm_sales_targets;
create policy crm_sales_targets_delete on public.crm_sales_targets for delete to authenticated
  using (
    organization_id = public.current_org_id() and public.crm_can_manage_all()
  );
