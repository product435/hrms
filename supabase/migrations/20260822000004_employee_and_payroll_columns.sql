-- The employee profile UI displays a "Blood group" field that has no backing
-- column (always rendered blank). Add it so Add/Edit Employee can persist it.
alter table public.employees add column if not exists blood_group text;

-- payroll_records only stored the totals (gross_salary, net_salary, pf, tax,
-- total_deductions), so payslips fell back to the employee's *current*
-- salary_structures row for the Basic/HRA/Allowances/Bonus breakdown --
-- wrong once that structure changes after the run. Add snapshot columns so
-- each payroll record freezes the breakdown that was actually used for that
-- run, independent of later salary changes.
alter table public.payroll_records add column if not exists basic numeric;
alter table public.payroll_records add column if not exists hra numeric;
alter table public.payroll_records add column if not exists allowances numeric;
alter table public.payroll_records add column if not exists bonus numeric;

-- One record per employee per run; also gives startRun() a safe upsert
-- target so re-processing a run doesn't create duplicate records.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payroll_records_employee_run_unique'
  ) then
    alter table public.payroll_records
      add constraint payroll_records_employee_run_unique unique (employee_id, payroll_run_id);
  end if;
end $$;
