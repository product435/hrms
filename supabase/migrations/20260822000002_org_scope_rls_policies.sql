-- The reference/catalog and admin-managed tables (departments, designations,
-- employees, assets, shifts, leave_types, job_openings, payroll_runs,
-- announcements, organizations, organization_settings) currently have RLS
-- policies of the form "any authenticated user" (`auth.uid() IS NOT NULL`)
-- or "any admin/hr" (`is_admin_or_hr()`) with no organization check at all.
-- Live data confirms this leaks across tenants: an admin/hr/employee in one
-- organization can read (and admins/hr can write) another organization's
-- departments, employees, assets, etc.
--
-- This scopes those policies to the caller's own organization. Per-employee
-- tables (attendance, leave, payroll records, documents, ...) already scope
-- correctly via `employee_id = current_employee_id()` / manager/direct-report
-- checks and are unaffected. Global lookup tables with no organization_id
-- column (roles, permissions, role_permissions) are intentionally shared
-- across tenants and are unaffected.
--
-- current_org_id() previously referenced profiles.organization_id, a column
-- that doesn't exist in this schema (organization lives on the linked
-- employees row, same as current_employee_id() already resolves), so the
-- function was dead code -- nothing currently relies on its old behavior.
create or replace function public.current_org_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select organization_id from public.employees where profile_id = auth.uid();
$$;

-- departments
drop policy if exists departments_read_all on public.departments;
create policy departments_read_all on public.departments for select
  using (organization_id = public.current_org_id());
drop policy if exists departments_write_admin_hr on public.departments;
create policy departments_write_admin_hr on public.departments for all
  using (is_admin_or_hr() and organization_id = public.current_org_id())
  with check (is_admin_or_hr() and organization_id = public.current_org_id());

-- designations
drop policy if exists designations_read_all on public.designations;
create policy designations_read_all on public.designations for select
  using (organization_id = public.current_org_id());
drop policy if exists designations_write_admin_hr on public.designations;
create policy designations_write_admin_hr on public.designations for all
  using (is_admin_or_hr() and organization_id = public.current_org_id())
  with check (is_admin_or_hr() and organization_id = public.current_org_id());

-- employees
drop policy if exists employees_admin_hr_all on public.employees;
create policy employees_admin_hr_all on public.employees for all
  using (is_admin_or_hr() and organization_id = public.current_org_id())
  with check (is_admin_or_hr() and organization_id = public.current_org_id());

-- assets
drop policy if exists assets_read_all on public.assets;
create policy assets_read_all on public.assets for select
  using (organization_id = public.current_org_id());
drop policy if exists assets_admin_hr_all on public.assets;
create policy assets_admin_hr_all on public.assets for all
  using (is_admin_or_hr() and organization_id = public.current_org_id())
  with check (is_admin_or_hr() and organization_id = public.current_org_id());

-- shifts
drop policy if exists shifts_read_all on public.shifts;
create policy shifts_read_all on public.shifts for select
  using (organization_id = public.current_org_id());
drop policy if exists shifts_write_admin_hr on public.shifts;
create policy shifts_write_admin_hr on public.shifts for all
  using (is_admin_or_hr() and organization_id = public.current_org_id())
  with check (is_admin_or_hr() and organization_id = public.current_org_id());

-- leave_types
drop policy if exists leave_types_read_all on public.leave_types;
create policy leave_types_read_all on public.leave_types for select
  using (organization_id = public.current_org_id());
drop policy if exists leave_types_write_admin_hr on public.leave_types;
create policy leave_types_write_admin_hr on public.leave_types for all
  using (is_admin_or_hr() and organization_id = public.current_org_id())
  with check (is_admin_or_hr() and organization_id = public.current_org_id());

-- job_openings
drop policy if exists job_openings_admin_hr_all on public.job_openings;
create policy job_openings_admin_hr_all on public.job_openings for all
  using (is_admin_or_hr() and organization_id = public.current_org_id())
  with check (is_admin_or_hr() and organization_id = public.current_org_id());

-- payroll_runs
drop policy if exists payroll_runs_admin_hr_all on public.payroll_runs;
create policy payroll_runs_admin_hr_all on public.payroll_runs for all
  using (is_admin_or_hr() and organization_id = public.current_org_id())
  with check (is_admin_or_hr() and organization_id = public.current_org_id());

-- announcements
drop policy if exists announcements_read_all on public.announcements;
create policy announcements_read_all on public.announcements for select
  using (organization_id = public.current_org_id());
drop policy if exists announcements_write_admin_hr on public.announcements;
create policy announcements_write_admin_hr on public.announcements for all
  using (is_admin_or_hr() and organization_id = public.current_org_id())
  with check (is_admin_or_hr() and organization_id = public.current_org_id());

-- organization_settings
drop policy if exists organization_settings_read_all on public.organization_settings;
create policy organization_settings_read_all on public.organization_settings for select
  using (organization_id = public.current_org_id());
drop policy if exists organization_settings_write_admin_hr on public.organization_settings;
create policy organization_settings_write_admin_hr on public.organization_settings for all
  using (is_admin_or_hr() and organization_id = public.current_org_id())
  with check (is_admin_or_hr() and organization_id = public.current_org_id());

-- organizations (the row itself is the org, so it's scoped by its own id)
drop policy if exists organizations_read_all on public.organizations;
create policy organizations_read_all on public.organizations for select
  using (id = public.current_org_id());
drop policy if exists organizations_write_admin_hr on public.organizations;
create policy organizations_write_admin_hr on public.organizations for all
  using (is_admin_or_hr() and id = public.current_org_id())
  with check (is_admin_or_hr() and id = public.current_org_id());
