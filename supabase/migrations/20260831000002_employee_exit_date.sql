-- Real exit/termination date, replacing the updated_at approximation the
-- Dashboard's "Joiners vs exits" chart previously fell back to (employees
-- had no date-of-exit column at all before this). Nullable/additive: no
-- existing row is affected, no data is lost or rewritten.
alter table public.employees add column if not exists exit_date date;

comment on column public.employees.exit_date is
  'Real termination/exit date, set explicitly when employment_status transitions to resigned. Source of truth for attrition/exit reporting -- supersedes the old updated_at-based approximation.';
