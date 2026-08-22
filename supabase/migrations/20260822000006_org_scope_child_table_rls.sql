-- Completes the organization-isolation audit started in
-- 20260822000002_org_scope_rls_policies.sql. That migration scoped the 11
-- "hub" tables (departments, employees, assets, ...). This migration scopes
-- the remaining `..._admin_hr_all` policies, which currently check role
-- only (`is_admin_or_hr()`) with no organization check at all -- so an
-- admin/hr user, once they somehow have another org's employee_id/asset_id/
-- application_id (e.g. via a stray reference), could read or write that
-- org's attendance, leave, payroll, documents, expenses, goals, recruitment
-- records, etc.
--
-- Self-scoped policies (`employee_id = current_employee_id()`) and
-- manager/direct-report policies are already correctly scoped by identity
-- and are left untouched.

-- === single hop via employee_id -> employees.organization_id ===

drop policy if exists asset_assignments_admin_hr_all on public.asset_assignments;
create policy asset_assignments_admin_hr_all on public.asset_assignments for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = asset_assignments.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = asset_assignments.employee_id and e.organization_id = current_org_id()));

drop policy if exists attendance_corrections_admin_hr_all on public.attendance_corrections;
create policy attendance_corrections_admin_hr_all on public.attendance_corrections for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = attendance_corrections.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = attendance_corrections.employee_id and e.organization_id = current_org_id()));

drop policy if exists attendance_records_admin_hr_all on public.attendance_records;
create policy attendance_records_admin_hr_all on public.attendance_records for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = attendance_records.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = attendance_records.employee_id and e.organization_id = current_org_id()));

drop policy if exists documents_admin_hr_all on public.documents;
create policy documents_admin_hr_all on public.documents for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = documents.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = documents.employee_id and e.organization_id = current_org_id()));

drop policy if exists emergency_contacts_admin_hr_all on public.emergency_contacts;
create policy emergency_contacts_admin_hr_all on public.emergency_contacts for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = emergency_contacts.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = emergency_contacts.employee_id and e.organization_id = current_org_id()));

drop policy if exists employee_addresses_admin_hr_all on public.employee_addresses;
create policy employee_addresses_admin_hr_all on public.employee_addresses for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = employee_addresses.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = employee_addresses.employee_id and e.organization_id = current_org_id()));

drop policy if exists employee_bank_accounts_admin_hr_all on public.employee_bank_accounts;
create policy employee_bank_accounts_admin_hr_all on public.employee_bank_accounts for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = employee_bank_accounts.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = employee_bank_accounts.employee_id and e.organization_id = current_org_id()));

drop policy if exists employee_shifts_admin_hr_all on public.employee_shifts;
create policy employee_shifts_admin_hr_all on public.employee_shifts for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = employee_shifts.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = employee_shifts.employee_id and e.organization_id = current_org_id()));

drop policy if exists expense_claims_admin_hr_all on public.expense_claims;
create policy expense_claims_admin_hr_all on public.expense_claims for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = expense_claims.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = expense_claims.employee_id and e.organization_id = current_org_id()));

drop policy if exists goals_admin_hr_all on public.goals;
create policy goals_admin_hr_all on public.goals for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = goals.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = goals.employee_id and e.organization_id = current_org_id()));

drop policy if exists helpdesk_tickets_admin_hr_all on public.helpdesk_tickets;
create policy helpdesk_tickets_admin_hr_all on public.helpdesk_tickets for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = helpdesk_tickets.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = helpdesk_tickets.employee_id and e.organization_id = current_org_id()));

drop policy if exists onboarding_records_admin_hr_all on public.onboarding_records;
create policy onboarding_records_admin_hr_all on public.onboarding_records for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = onboarding_records.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = onboarding_records.employee_id and e.organization_id = current_org_id()));

drop policy if exists performance_reviews_admin_hr_all on public.performance_reviews;
create policy performance_reviews_admin_hr_all on public.performance_reviews for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = performance_reviews.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = performance_reviews.employee_id and e.organization_id = current_org_id()));

drop policy if exists salary_structures_admin_hr_all on public.salary_structures;
create policy salary_structures_admin_hr_all on public.salary_structures for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = salary_structures.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = salary_structures.employee_id and e.organization_id = current_org_id()));

drop policy if exists payroll_records_admin_hr_all on public.payroll_records;
create policy payroll_records_admin_hr_all on public.payroll_records for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = payroll_records.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = payroll_records.employee_id and e.organization_id = current_org_id()));

drop policy if exists leave_requests_admin_hr_all on public.leave_requests;
create policy leave_requests_admin_hr_all on public.leave_requests for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = leave_requests.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = leave_requests.employee_id and e.organization_id = current_org_id()));

-- profiles.employee_id can be null for a profile not yet linked to an
-- employee record; such a profile is invisible to is_admin_or_hr() here
-- until it's linked (nothing to scope it to yet).
drop policy if exists profiles_admin_hr_all on public.profiles;
create policy profiles_admin_hr_all on public.profiles for all
  using (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = profiles.employee_id and e.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.employees e where e.id = profiles.employee_id and e.organization_id = current_org_id()));

-- === single hop via asset_id -> assets.organization_id ===

drop policy if exists asset_repairs_admin_hr_all on public.asset_repairs;
create policy asset_repairs_admin_hr_all on public.asset_repairs for all
  using (is_admin_or_hr() and exists (select 1 from public.assets a where a.id = asset_repairs.asset_id and a.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.assets a where a.id = asset_repairs.asset_id and a.organization_id = current_org_id()));

-- === recruitment chain: job_openings.organization_id ===

drop policy if exists job_applications_admin_hr_all on public.job_applications;
create policy job_applications_admin_hr_all on public.job_applications for all
  using (is_admin_or_hr() and exists (select 1 from public.job_openings j where j.id = job_applications.job_id and j.organization_id = current_org_id()))
  with check (is_admin_or_hr() and exists (select 1 from public.job_openings j where j.id = job_applications.job_id and j.organization_id = current_org_id()));

drop policy if exists interviews_admin_hr_all on public.interviews;
create policy interviews_admin_hr_all on public.interviews for all
  using (is_admin_or_hr() and exists (
    select 1 from public.job_applications ja join public.job_openings j on j.id = ja.job_id
    where ja.id = interviews.application_id and j.organization_id = current_org_id()
  ))
  with check (is_admin_or_hr() and exists (
    select 1 from public.job_applications ja join public.job_openings j on j.id = ja.job_id
    where ja.id = interviews.application_id and j.organization_id = current_org_id()
  ));

drop policy if exists offers_admin_hr_all on public.offers;
create policy offers_admin_hr_all on public.offers for all
  using (is_admin_or_hr() and exists (
    select 1 from public.job_applications ja join public.job_openings j on j.id = ja.job_id
    where ja.id = offers.application_id and j.organization_id = current_org_id()
  ))
  with check (is_admin_or_hr() and exists (
    select 1 from public.job_applications ja join public.job_openings j on j.id = ja.job_id
    where ja.id = offers.application_id and j.organization_id = current_org_id()
  ));

-- A candidate can apply to jobs at more than one organization; visible to an
-- org's admin/hr only once they have an application to one of that org's
-- job openings.
drop policy if exists candidates_admin_hr_all on public.candidates;
create policy candidates_admin_hr_all on public.candidates for all
  using (is_admin_or_hr() and exists (
    select 1 from public.job_applications ja join public.job_openings j on j.id = ja.job_id
    where ja.candidate_id = candidates.id and j.organization_id = current_org_id()
  ))
  with check (is_admin_or_hr() and exists (
    select 1 from public.job_applications ja join public.job_openings j on j.id = ja.job_id
    where ja.candidate_id = candidates.id and j.organization_id = current_org_id()
  ));

-- === double hop via onboarding_records / payroll_records ===

drop policy if exists onboarding_tasks_admin_hr_all on public.onboarding_tasks;
create policy onboarding_tasks_admin_hr_all on public.onboarding_tasks for all
  using (is_admin_or_hr() and exists (
    select 1 from public.onboarding_records o join public.employees e on e.id = o.employee_id
    where o.id = onboarding_tasks.onboarding_id and e.organization_id = current_org_id()
  ))
  with check (is_admin_or_hr() and exists (
    select 1 from public.onboarding_records o join public.employees e on e.id = o.employee_id
    where o.id = onboarding_tasks.onboarding_id and e.organization_id = current_org_id()
  ));

drop policy if exists payslips_admin_hr_all on public.payslips;
create policy payslips_admin_hr_all on public.payslips for all
  using (is_admin_or_hr() and exists (
    select 1 from public.payroll_records pr join public.employees e on e.id = pr.employee_id
    where pr.id = payslips.payroll_record_id and e.organization_id = current_org_id()
  ))
  with check (is_admin_or_hr() and exists (
    select 1 from public.payroll_records pr join public.employees e on e.id = pr.employee_id
    where pr.id = payslips.payroll_record_id and e.organization_id = current_org_id()
  ));

-- === direct organization_id column ===

drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs for select
  using (is_admin() and organization_id = current_org_id());
