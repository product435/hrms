-- Reconciliation pass: this repo's migration history does not reproduce the
-- live database (see TEAMNEST_HRMS_FINAL_DOCUMENTATION.md §14) -- roughly a
-- third of the live tables, several RLS policies, and several helper
-- functions were created out-of-band and were never captured in a tracked
-- migration. Every statement below was verified against the live database
-- via `supabase db query --linked` (pg_proc / pg_policies / pg_indexes)
-- immediately before writing this file, so it reproduces exactly what is
-- already running -- nothing here changes live behavior.
--
-- Every statement is idempotent and additive:
--   - `create table if not exists` is a full no-op if the table already
--     exists (Postgres does not reconcile columns on an existing table), so
--     this is safe against the live database and only matters if this
--     migration history is ever replayed against an empty database.
--   - `create or replace function` reproduces the exact live body.
--   - `drop policy if exists <name> ...; create policy <name> ...` redefines
--     the exact live policy under its existing name -- no data is touched.
--   - `create index if not exists` is a no-op if the index already exists.
-- No table is dropped, no column is dropped, no row is touched.

-- ============================================================
-- 1. Untracked tables (exist live; no CREATE TABLE in any prior migration)
-- ============================================================

create table if not exists public.job_openings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  department_id uuid references public.departments(id),
  designation_id uuid references public.designations(id),
  title text,
  description text,
  requirements text,
  employment_type text,
  location text,
  openings integer,
  status text,
  opened_at timestamptz,
  closed_at timestamptz
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  leave_type_id uuid references public.leave_types(id),
  start_date date,
  end_date date,
  total_days numeric,
  reason text,
  status text,
  current_approver uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejection_reason text
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  shift_id uuid references public.shifts(id),
  attendance_date date,
  check_in timestamptz,
  check_out timestamptz,
  status text,
  work_mode text,
  source text,
  worked_hours numeric,
  overtime_hours numeric,
  remarks text
);

create table if not exists public.expense_claims (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  category text,
  amount numeric,
  expense_date date,
  description text,
  receipt_url text,
  status text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejection_reason text
);

create table if not exists public.helpdesk_tickets (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  subject text,
  description text,
  category text,
  priority text,
  status text,
  assigned_to uuid references public.profiles(id),
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create table if not exists public.onboarding_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  assigned_hr uuid references public.profiles(id),
  joining_date date,
  status text
);

create table if not exists public.employee_shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  shift_id uuid references public.shifts(id),
  effective_from date,
  effective_to date
);

create table if not exists public.asset_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id),
  employee_id uuid references public.employees(id),
  assigned_at timestamptz,
  assigned_by uuid references public.profiles(id),
  condition_on_assignment text,
  returned_at timestamptz,
  returned_by uuid references public.profiles(id),
  condition_on_return text,
  remarks text
);

create table if not exists public.asset_repairs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id),
  issue text,
  sent_at timestamptz,
  returned_at timestamptz,
  repair_cost numeric,
  repair_vendor text,
  status text,
  remarks text
);

create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  name text,
  relationship text,
  phone text,
  email text,
  address text
);

create table if not exists public.employee_addresses (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  address_type text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text
);

create table if not exists public.employee_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  account_name text,
  account_number text,
  ifsc text,
  bank_name text,
  branch text,
  is_primary boolean
);

alter table public.job_openings enable row level security;
alter table public.leave_requests enable row level security;
alter table public.attendance_records enable row level security;
alter table public.expense_claims enable row level security;
alter table public.helpdesk_tickets enable row level security;
alter table public.onboarding_records enable row level security;
alter table public.employee_shifts enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.asset_repairs enable row level security;
alter table public.emergency_contacts enable row level security;
alter table public.employee_addresses enable row level security;
alter table public.employee_bank_accounts enable row level security;

-- ============================================================
-- 2. Untracked helper functions (bodies pulled verbatim from the live
--    database via pg_get_functiondef; reproduced exactly, including
--    current_role() which is legacy/dead -- it references profiles.role_id,
--    a column that does not exist live, and nothing live calls it -- left
--    as-is rather than "fixed", since correcting or removing it is outside
--    this hardening pass's explicit scope)
-- ============================================================

create or replace function public.current_employee_id()
returns uuid
language sql stable security definer
as $function$
  select id from public.employees where profile_id = auth.uid();
$function$;

create or replace function public.current_user_role()
returns text
language sql stable security definer
as $function$
  select role from public.profiles where id = auth.uid();
$function$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
as $function$
  select public.current_user_role() = 'admin';
$function$;

create or replace function public.is_manager()
returns boolean
language sql stable security definer
as $function$
  select public.current_user_role() = 'manager';
$function$;

create or replace function public.is_my_direct_report(emp_id uuid)
returns boolean
language sql stable security definer
as $function$
  select exists (
    select 1 from public.employees
    where id = emp_id and manager_id = public.current_employee_id()
  );
$function$;

-- current_role() (note: distinct from current_user_role() above) exists
-- live but references profiles.role_id, a column that was dropped from
-- profiles by an earlier migration -- it is dead code (nothing calls it;
-- is_admin/is_admin_or_hr/is_manager all use current_user_role() instead)
-- and, being a LANGUAGE SQL function, Postgres will not even let it be
-- re-declared anymore since the column it references no longer exists.
-- Deliberately left untouched rather than "fixed" or dropped -- both are
-- outside this hardening pass's explicit scope.

-- ============================================================
-- 3. Untracked RLS policies (self-scoped and manager-scoped access that
--    already works live but had no CREATE POLICY in any tracked migration --
--    reproduced verbatim from the live pg_policies catalog)
-- ============================================================

drop policy if exists employees_self_select on public.employees;
create policy employees_self_select on public.employees for select
  using (profile_id = auth.uid());
drop policy if exists employees_self_update on public.employees;
create policy employees_self_update on public.employees for update
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists employees_manager_view_team on public.employees;
create policy employees_manager_view_team on public.employees for select
  using (is_manager() and manager_id = current_employee_id());

drop policy if exists profiles_user_select on public.profiles;
create policy profiles_user_select on public.profiles for select
  using (auth.uid() = id);
drop policy if exists profiles_user_update on public.profiles;
create policy profiles_user_update on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists profiles_manager_view_team on public.profiles;
create policy profiles_manager_view_team on public.profiles for select
  using (is_manager() and employee_id in (select employees.id from employees where employees.manager_id = current_employee_id()));

drop policy if exists attendance_records_self_select on public.attendance_records;
create policy attendance_records_self_select on public.attendance_records for select
  using (employee_id = current_employee_id());
drop policy if exists attendance_records_self_insert on public.attendance_records;
create policy attendance_records_self_insert on public.attendance_records for insert
  with check (employee_id = current_employee_id());
drop policy if exists attendance_records_manager_view_team on public.attendance_records;
create policy attendance_records_manager_view_team on public.attendance_records for select
  using (is_manager() and is_my_direct_report(employee_id));
drop policy if exists attendance_records_manager_update_team on public.attendance_records;
create policy attendance_records_manager_update_team on public.attendance_records for update
  using (is_manager() and is_my_direct_report(employee_id)) with check (is_manager() and is_my_direct_report(employee_id));

drop policy if exists attendance_corrections_self_select on public.attendance_corrections;
create policy attendance_corrections_self_select on public.attendance_corrections for select
  using (employee_id = current_employee_id());
drop policy if exists attendance_corrections_self_insert on public.attendance_corrections;
create policy attendance_corrections_self_insert on public.attendance_corrections for insert
  with check (employee_id = current_employee_id());
drop policy if exists attendance_corrections_manager_view_team on public.attendance_corrections;
create policy attendance_corrections_manager_view_team on public.attendance_corrections for select
  using (is_manager() and is_my_direct_report(employee_id));
drop policy if exists attendance_corrections_manager_update_team on public.attendance_corrections;
create policy attendance_corrections_manager_update_team on public.attendance_corrections for update
  using (is_manager() and is_my_direct_report(employee_id)) with check (is_manager() and is_my_direct_report(employee_id));

drop policy if exists leave_requests_self_select on public.leave_requests;
create policy leave_requests_self_select on public.leave_requests for select
  using (employee_id = current_employee_id());
drop policy if exists leave_requests_self_insert on public.leave_requests;
create policy leave_requests_self_insert on public.leave_requests for insert
  with check (employee_id = current_employee_id());
drop policy if exists leave_requests_manager_view_team on public.leave_requests;
create policy leave_requests_manager_view_team on public.leave_requests for select
  using (is_manager() and is_my_direct_report(employee_id));
drop policy if exists leave_requests_manager_update_team on public.leave_requests;
create policy leave_requests_manager_update_team on public.leave_requests for update
  using (is_manager() and is_my_direct_report(employee_id)) with check (is_manager() and is_my_direct_report(employee_id));
drop policy if exists leave_requests_admin_hr_all on public.leave_requests;
create policy leave_requests_admin_hr_all on public.leave_requests for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = leave_requests.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = leave_requests.employee_id and e.organization_id = current_org_id()));

drop policy if exists expense_claims_self_select on public.expense_claims;
create policy expense_claims_self_select on public.expense_claims for select
  using (employee_id = current_employee_id());
drop policy if exists expense_claims_self_insert on public.expense_claims;
create policy expense_claims_self_insert on public.expense_claims for insert
  with check (employee_id = current_employee_id());
drop policy if exists expense_claims_manager_view_team on public.expense_claims;
create policy expense_claims_manager_view_team on public.expense_claims for select
  using (is_manager() and is_my_direct_report(employee_id));
drop policy if exists expense_claims_manager_update_team on public.expense_claims;
create policy expense_claims_manager_update_team on public.expense_claims for update
  using (is_manager() and is_my_direct_report(employee_id)) with check (is_manager() and is_my_direct_report(employee_id));
drop policy if exists expense_claims_admin_hr_all on public.expense_claims;
create policy expense_claims_admin_hr_all on public.expense_claims for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = expense_claims.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = expense_claims.employee_id and e.organization_id = current_org_id()));

drop policy if exists goals_self_select on public.goals;
create policy goals_self_select on public.goals for select
  using (employee_id = current_employee_id());
drop policy if exists goals_self_insert on public.goals;
create policy goals_self_insert on public.goals for insert
  with check (employee_id = current_employee_id());
drop policy if exists goals_manager_view_team on public.goals;
create policy goals_manager_view_team on public.goals for select
  using (is_manager() and is_my_direct_report(employee_id));
drop policy if exists goals_manager_update_team on public.goals;
create policy goals_manager_update_team on public.goals for update
  using (is_manager() and is_my_direct_report(employee_id)) with check (is_manager() and is_my_direct_report(employee_id));
drop policy if exists goals_admin_hr_all on public.goals;
create policy goals_admin_hr_all on public.goals for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = goals.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = goals.employee_id and e.organization_id = current_org_id()));

drop policy if exists performance_reviews_self_select on public.performance_reviews;
create policy performance_reviews_self_select on public.performance_reviews for select
  using (employee_id = current_employee_id());
drop policy if exists performance_reviews_self_insert on public.performance_reviews;
create policy performance_reviews_self_insert on public.performance_reviews for insert
  with check (employee_id = current_employee_id());
drop policy if exists performance_reviews_manager_view_team on public.performance_reviews;
create policy performance_reviews_manager_view_team on public.performance_reviews for select
  using (is_manager() and is_my_direct_report(employee_id));
drop policy if exists performance_reviews_manager_update_team on public.performance_reviews;
create policy performance_reviews_manager_update_team on public.performance_reviews for update
  using (is_manager() and is_my_direct_report(employee_id)) with check (is_manager() and is_my_direct_report(employee_id));

drop policy if exists documents_self_select on public.documents;
create policy documents_self_select on public.documents for select
  using (employee_id = current_employee_id());
drop policy if exists documents_self_insert on public.documents;
create policy documents_self_insert on public.documents for insert
  with check (employee_id = current_employee_id());
drop policy if exists documents_manager_view_team on public.documents;
create policy documents_manager_view_team on public.documents for select
  using (is_manager() and is_my_direct_report(employee_id));

drop policy if exists helpdesk_tickets_self_select on public.helpdesk_tickets;
create policy helpdesk_tickets_self_select on public.helpdesk_tickets for select
  using (employee_id = current_employee_id());
drop policy if exists helpdesk_tickets_self_insert on public.helpdesk_tickets;
create policy helpdesk_tickets_self_insert on public.helpdesk_tickets for insert
  with check (employee_id = current_employee_id());
drop policy if exists helpdesk_tickets_admin_hr_all on public.helpdesk_tickets;
create policy helpdesk_tickets_admin_hr_all on public.helpdesk_tickets for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = helpdesk_tickets.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = helpdesk_tickets.employee_id and e.organization_id = current_org_id()));

drop policy if exists onboarding_records_self_select on public.onboarding_records;
create policy onboarding_records_self_select on public.onboarding_records for select
  using (employee_id = current_employee_id());
drop policy if exists onboarding_records_self_insert on public.onboarding_records;
create policy onboarding_records_self_insert on public.onboarding_records for insert
  with check (employee_id = current_employee_id());
drop policy if exists onboarding_records_admin_hr_all on public.onboarding_records;
create policy onboarding_records_admin_hr_all on public.onboarding_records for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = onboarding_records.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = onboarding_records.employee_id and e.organization_id = current_org_id()));
drop policy if exists onboarding_tasks_admin_hr_all on public.onboarding_tasks;
create policy onboarding_tasks_admin_hr_all on public.onboarding_tasks for all
  using (is_admin_or_hr() and exists (select 1 from onboarding_records o join employees e on e.id = o.employee_id where o.id = onboarding_tasks.onboarding_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from onboarding_records o join employees e on e.id = o.employee_id where o.id = onboarding_tasks.onboarding_id and e.organization_id = current_org_id()));

drop policy if exists salary_structures_self_select on public.salary_structures;
create policy salary_structures_self_select on public.salary_structures for select
  using (employee_id = current_employee_id());
drop policy if exists salary_structures_self_insert on public.salary_structures;
create policy salary_structures_self_insert on public.salary_structures for insert
  with check (employee_id = current_employee_id());
drop policy if exists salary_structures_admin_hr_all on public.salary_structures;
create policy salary_structures_admin_hr_all on public.salary_structures for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = salary_structures.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = salary_structures.employee_id and e.organization_id = current_org_id()));

drop policy if exists employee_addresses_self_select on public.employee_addresses;
create policy employee_addresses_self_select on public.employee_addresses for select
  using (employee_id = current_employee_id());
drop policy if exists employee_addresses_self_insert on public.employee_addresses;
create policy employee_addresses_self_insert on public.employee_addresses for insert
  with check (employee_id = current_employee_id());
drop policy if exists employee_addresses_admin_hr_all on public.employee_addresses;
create policy employee_addresses_admin_hr_all on public.employee_addresses for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = employee_addresses.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = employee_addresses.employee_id and e.organization_id = current_org_id()));

drop policy if exists employee_bank_accounts_self_select on public.employee_bank_accounts;
create policy employee_bank_accounts_self_select on public.employee_bank_accounts for select
  using (employee_id = current_employee_id());
drop policy if exists employee_bank_accounts_self_insert on public.employee_bank_accounts;
create policy employee_bank_accounts_self_insert on public.employee_bank_accounts for insert
  with check (employee_id = current_employee_id());
drop policy if exists employee_bank_accounts_admin_hr_all on public.employee_bank_accounts;
create policy employee_bank_accounts_admin_hr_all on public.employee_bank_accounts for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = employee_bank_accounts.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = employee_bank_accounts.employee_id and e.organization_id = current_org_id()));

drop policy if exists emergency_contacts_self_select on public.emergency_contacts;
create policy emergency_contacts_self_select on public.emergency_contacts for select
  using (employee_id = current_employee_id());
drop policy if exists emergency_contacts_self_insert on public.emergency_contacts;
create policy emergency_contacts_self_insert on public.emergency_contacts for insert
  with check (employee_id = current_employee_id());
drop policy if exists emergency_contacts_admin_hr_all on public.emergency_contacts;
create policy emergency_contacts_admin_hr_all on public.emergency_contacts for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = emergency_contacts.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = emergency_contacts.employee_id and e.organization_id = current_org_id()));

drop policy if exists employee_shifts_self_select on public.employee_shifts;
create policy employee_shifts_self_select on public.employee_shifts for select
  using (employee_id = current_employee_id());
drop policy if exists employee_shifts_self_insert on public.employee_shifts;
create policy employee_shifts_self_insert on public.employee_shifts for insert
  with check (employee_id = current_employee_id());
drop policy if exists employee_shifts_admin_hr_all on public.employee_shifts;
create policy employee_shifts_admin_hr_all on public.employee_shifts for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = employee_shifts.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = employee_shifts.employee_id and e.organization_id = current_org_id()));

drop policy if exists asset_assignments_self_select on public.asset_assignments;
create policy asset_assignments_self_select on public.asset_assignments for select
  using (employee_id = current_employee_id());
drop policy if exists asset_assignments_admin_hr_all on public.asset_assignments;
create policy asset_assignments_admin_hr_all on public.asset_assignments for all
  using (is_admin_or_hr() and exists (select 1 from employees e where e.id = asset_assignments.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from employees e where e.id = asset_assignments.employee_id and e.organization_id = current_org_id()));

drop policy if exists asset_repairs_self_select on public.asset_repairs;
create policy asset_repairs_self_select on public.asset_repairs for select
  using (exists (select 1 from asset_assignments aa where aa.asset_id = asset_repairs.asset_id and aa.employee_id = current_employee_id()));
drop policy if exists asset_repairs_admin_hr_all on public.asset_repairs;
create policy asset_repairs_admin_hr_all on public.asset_repairs for all
  using (is_admin_or_hr() and exists (select 1 from assets a where a.id = asset_repairs.asset_id and a.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from assets a where a.id = asset_repairs.asset_id and a.organization_id = current_org_id()));

drop policy if exists payroll_records_self_select on public.payroll_records;
create policy payroll_records_self_select on public.payroll_records for select
  using (employee_id = current_employee_id());

drop policy if exists payroll_runs_self_select on public.payroll_runs;
create policy payroll_runs_self_select on public.payroll_runs for select
  using (exists (select 1 from payroll_records pr where pr.payroll_run_id = payroll_runs.id and pr.employee_id = current_employee_id()));

drop policy if exists payslips_self_select on public.payslips;
create policy payslips_self_select on public.payslips for select
  using (payroll_record_id in (select payroll_records.id from payroll_records where payroll_records.employee_id = current_employee_id()));

drop policy if exists interviews_manager_own on public.interviews;
create policy interviews_manager_own on public.interviews for select
  using (is_manager() and interviewer_id = current_employee_id());

drop policy if exists job_openings_read_all on public.job_openings;
create policy job_openings_read_all on public.job_openings for select
  using (organization_id = current_org_id());
drop policy if exists job_openings_admin_hr_all on public.job_openings;
create policy job_openings_admin_hr_all on public.job_openings for all
  using (is_admin_or_hr() and organization_id = current_org_id())
  with check (is_admin_or_hr() and organization_id = current_org_id());

drop policy if exists candidates_admin_hr_all on public.candidates;
create policy candidates_admin_hr_all on public.candidates for all
  using (is_admin_or_hr() and exists (select 1 from job_applications ja join job_openings j on j.id = ja.job_id where ja.candidate_id = candidates.id and j.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from job_applications ja join job_openings j on j.id = ja.job_id where ja.candidate_id = candidates.id and j.organization_id = current_org_id()));

drop policy if exists job_applications_admin_hr_all on public.job_applications;
create policy job_applications_admin_hr_all on public.job_applications for all
  using (is_admin_or_hr() and exists (select 1 from job_openings j where j.id = job_applications.job_id and j.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from job_openings j where j.id = job_applications.job_id and j.organization_id = current_org_id()));

drop policy if exists offers_admin_hr_all on public.offers;
create policy offers_admin_hr_all on public.offers for all
  using (is_admin_or_hr() and exists (select 1 from job_applications ja join job_openings j on j.id = ja.job_id where ja.id = offers.application_id and j.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from job_applications ja join job_openings j on j.id = ja.job_id where ja.id = offers.application_id and j.organization_id = current_org_id()));

drop policy if exists interviews_admin_hr_all on public.interviews;
create policy interviews_admin_hr_all on public.interviews for all
  using (is_admin_or_hr() and exists (select 1 from job_applications ja join job_openings j on j.id = ja.job_id where ja.id = interviews.application_id and j.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from job_applications ja join job_openings j on j.id = ja.job_id where ja.id = interviews.application_id and j.organization_id = current_org_id()));

drop policy if exists notifications_self_all on public.notifications;
create policy notifications_self_all on public.notifications for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_preferences_self_all on public.user_preferences;
create policy user_preferences_self_all on public.user_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists roles_read_all on public.roles;
create policy roles_read_all on public.roles for select using (auth.uid() is not null);
drop policy if exists roles_write_admin_hr on public.roles;
create policy roles_write_admin_hr on public.roles for all using (is_admin_or_hr()) with check (is_admin_or_hr());
drop policy if exists permissions_read_all on public.permissions;
create policy permissions_read_all on public.permissions for select using (auth.uid() is not null);
drop policy if exists permissions_write_admin_hr on public.permissions;
create policy permissions_write_admin_hr on public.permissions for all using (is_admin_or_hr()) with check (is_admin_or_hr());
drop policy if exists role_permissions_read_all on public.role_permissions;
create policy role_permissions_read_all on public.role_permissions for select using (auth.uid() is not null);
drop policy if exists role_permissions_write_admin_hr on public.role_permissions;
create policy role_permissions_write_admin_hr on public.role_permissions for all using (is_admin_or_hr()) with check (is_admin_or_hr());

drop policy if exists organizations_read_all on public.organizations;
create policy organizations_read_all on public.organizations for select using (id = current_org_id());
drop policy if exists organizations_write_admin_hr on public.organizations;
create policy organizations_write_admin_hr on public.organizations for all
  using (is_admin_or_hr() and id = current_org_id()) with check (is_admin_or_hr() and id = current_org_id());

-- ============================================================
-- 4. Untracked indexes (already live; reproduced verbatim, all IF NOT EXISTS)
-- ============================================================

create index if not exists idx_asset_requests_employee on public.asset_requests using btree (employee_id);
create index if not exists idx_asset_requests_status on public.asset_requests using btree (status);
create index if not exists idx_assets_organization on public.assets using btree (organization_id);
create unique index if not exists ux_assets_asset_code on public.assets using btree (asset_code);
create index if not exists idx_attendance_employee_date on public.attendance_records using btree (employee_id, attendance_date);
create unique index if not exists ux_departments_org_code on public.departments using btree (organization_id, code);
create unique index if not exists ux_designations_org_code on public.designations using btree (organization_id, code);
create index if not exists idx_documents_employee on public.documents using btree (employee_id);
create index if not exists idx_employee_complaints_employee on public.employee_complaints using btree (employee_id);
create index if not exists idx_employees_department on public.employees using btree (department_id);
create index if not exists idx_employees_organization on public.employees using btree (organization_id);
create unique index if not exists ux_employees_employee_code on public.employees using btree (employee_code);
create unique index if not exists ux_employees_profile_id on public.employees using btree (profile_id);
create index if not exists idx_goals_employee on public.goals using btree (employee_id);
create index if not exists idx_leave_requests_employee on public.leave_requests using btree (employee_id);
create unique index if not exists ux_leave_types_org_code on public.leave_types using btree (organization_id, code);
create index if not exists idx_notifications_user on public.notifications using btree (user_id);
create unique index if not exists ux_organizations_email on public.organizations using btree (email);
create index if not exists idx_password_reset_requests_email on public.password_reset_requests using btree (lower(email));
create index if not exists idx_password_reset_requests_status on public.password_reset_requests using btree (status);
create index if not exists idx_payroll_records_employee on public.payroll_records using btree (employee_id);
create unique index if not exists ux_permissions_key on public.permissions using btree (key);
create unique index if not exists ux_profiles_email on public.profiles using btree (email);
create unique index if not exists ux_role_permissions on public.role_permissions using btree (role_id, permission_id);
create unique index if not exists ux_roles_name on public.roles using btree (name);
create unique index if not exists ux_shifts_org_code on public.shifts using btree (organization_id, code);
