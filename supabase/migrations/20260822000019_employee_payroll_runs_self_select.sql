-- payroll_runs only ever had payroll_runs_admin_hr_all. An employee has
-- self_select on payroll_records, but the embedded `payroll_runs(year,month)`
-- join inside payrollService.payslips() silently resolves to null for them
-- (PostgREST drops an embed the caller can't read, even though the parent
-- row is visible) -- confirmed live: an employee's own payroll_records rows
-- came back with payroll_runs: null, so their payslip period was always
-- blank and the download toast read "for ." instead of the real period.
-- Scoped to only the runs that contain one of the employee's own records --
-- not the full org-wide payroll_runs table.
create policy payroll_runs_self_select on public.payroll_runs for select
  using (
    exists (
      select 1 from public.payroll_records pr
      where pr.payroll_run_id = payroll_runs.id
        and pr.employee_id = current_employee_id()
    )
  );
