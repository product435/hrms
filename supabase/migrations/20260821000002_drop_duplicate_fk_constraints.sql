-- Several earlier migrations each added their own foreign key on the same
-- columns (e.g. leave_requests.employee_id -> employees.id has both
-- fk_leave_requests_employee and leave_requests_employee_id_fkey). Postgres
-- allows duplicate FKs, but PostgREST cannot pick one when a request embeds
-- the related table, and returns 300 Multiple Choices (PGRST201) instead of
-- data -- e.g. GET /leave_requests?select=*,employees(...) fails outright.
--
-- This drops the redundant custom-named constraint from each duplicate pair
-- and keeps the standard "<table>_<column>_fkey" one, so exactly one FK
-- remains per relationship and embeds resolve unambiguously again. Purely
-- structural: both constraints in each pair enforce the identical column/
-- target relationship, so no data or validation behavior changes.

ALTER TABLE public.asset_assignments DROP CONSTRAINT IF EXISTS fk_asset_assignments_asset;
ALTER TABLE public.asset_assignments DROP CONSTRAINT IF EXISTS fk_asset_assignments_employee;
ALTER TABLE public.asset_repairs DROP CONSTRAINT IF EXISTS fk_asset_repairs_asset;
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS fk_assets_organization;
ALTER TABLE public.attendance_corrections DROP CONSTRAINT IF EXISTS fk_attendance_corrections_attendance;
ALTER TABLE public.attendance_corrections DROP CONSTRAINT IF EXISTS fk_attendance_corrections_employee;
ALTER TABLE public.attendance_records DROP CONSTRAINT IF EXISTS fk_attendance_employee;
ALTER TABLE public.attendance_records DROP CONSTRAINT IF EXISTS fk_attendance_shift;
ALTER TABLE public.departments DROP CONSTRAINT IF EXISTS fk_departments_organization;
ALTER TABLE public.designations DROP CONSTRAINT IF EXISTS fk_designations_department;
ALTER TABLE public.designations DROP CONSTRAINT IF EXISTS fk_designations_organization;
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS fk_documents_employee;
ALTER TABLE public.employee_shifts DROP CONSTRAINT IF EXISTS fk_employee_shifts_employee;
ALTER TABLE public.employee_shifts DROP CONSTRAINT IF EXISTS fk_employee_shifts_shift;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS fk_employees_department;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS fk_employees_designation;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS fk_employees_organization;
ALTER TABLE public.expense_claims DROP CONSTRAINT IF EXISTS fk_expenses_employee;
ALTER TABLE public.goals DROP CONSTRAINT IF EXISTS fk_goals_employee;
ALTER TABLE public.helpdesk_tickets DROP CONSTRAINT IF EXISTS fk_helpdesk_employee;
ALTER TABLE public.interviews DROP CONSTRAINT IF EXISTS fk_interviews_application;
ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS fk_applications_candidate;
ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS fk_applications_job;
ALTER TABLE public.job_openings DROP CONSTRAINT IF EXISTS fk_job_openings_organization;
ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS fk_leave_requests_employee;
ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS fk_leave_requests_type;
ALTER TABLE public.leave_types DROP CONSTRAINT IF EXISTS fk_leave_types_organization;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS fk_notifications_profile;
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS fk_offers_application;
ALTER TABLE public.onboarding_records DROP CONSTRAINT IF EXISTS fk_onboarding_employee;
ALTER TABLE public.onboarding_tasks DROP CONSTRAINT IF EXISTS fk_onboarding_tasks_record;
ALTER TABLE public.organization_settings DROP CONSTRAINT IF EXISTS fk_org_settings_organization;
ALTER TABLE public.payroll_records DROP CONSTRAINT IF EXISTS fk_payroll_records_employee;
ALTER TABLE public.payroll_records DROP CONSTRAINT IF EXISTS fk_payroll_records_run;
ALTER TABLE public.payroll_runs DROP CONSTRAINT IF EXISTS fk_payroll_runs_organization;
ALTER TABLE public.payslips DROP CONSTRAINT IF EXISTS fk_payslips_payroll_record;
ALTER TABLE public.performance_reviews DROP CONSTRAINT IF EXISTS fk_reviews_employee;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS fk_profiles_employee;
ALTER TABLE public.salary_structures DROP CONSTRAINT IF EXISTS fk_salary_employee;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS fk_shifts_organization;
