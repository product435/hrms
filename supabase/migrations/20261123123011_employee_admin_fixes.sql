-- Three small, independent fixes to the employee directory / admin flows:
--
-- 1. An admin/HR user can no longer change their OWN employment_status
--    through the normal employees.update() path (suspend, terminate,
--    reinstate, activate, resign) -- the frontend already disables this
--    control for your own row (see src/routes/employees.index.tsx), this
--    adds the same rule as a real, unbypassable backend guard.
--
-- 2. employee_code must look like "JV-" followed by one or more digits.
--    Added as NOT VALID so it only applies to new inserts/updates --
--    existing rows (if any don't already match) are never touched or
--    broken by this migration, matching the live "JV-001", "JV-90" style
--    codes already in use.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- 1. Guard against self-deactivation.
-- ---------------------------------------------------------------------------

create or replace function public.employees_guard_self_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id = public.current_employee_id()
     and new.employment_status is distinct from old.employment_status then
    raise exception 'You cannot change your own employment status.';
  end if;
  return new;
end;
$$;

revoke all on function public.employees_guard_self_status() from public, anon, authenticated;

drop trigger if exists employees_guard_self_status on public.employees;
create trigger employees_guard_self_status
  before update on public.employees
  for each row
  execute function public.employees_guard_self_status();

-- ---------------------------------------------------------------------------
-- 2. employee_code format: "JV-" + digits.
-- ---------------------------------------------------------------------------

alter table public.employees
  drop constraint if exists employees_employee_code_format;

alter table public.employees
  add constraint employees_employee_code_format
  check (employee_code is null or employee_code ~ '^JV-[0-9]+$')
  not valid;
