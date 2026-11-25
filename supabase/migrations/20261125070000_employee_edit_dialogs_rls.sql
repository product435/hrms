-- Supports the new "Add employee" / "Edit employee" shared-field-set work:
--
-- 1. employee_code and joining_date are now editable from the admin "Edit
--    employee" dialog (previously only set at creation). Both already go
--    through employees_guard_self_assignment() below, which already
--    reverts an employee's own attempt to change either -- confirmed by
--    reading that function (20261003120000_employee_onboarding.sql) before
--    writing this file. No RLS/table change needed for that part.
--
-- 2. Real gap found while reviewing RLS for this task: employees_self_update
--    (20260831000001_reconcile_tracked_schema_with_live.sql) has no column
--    restriction -- `using (profile_id = auth.uid()) with check (profile_id
--    = auth.uid())` -- so by raw policy alone an employee could update ANY
--    column on their own row, including `email` (their work/login email).
--    employees_guard_self_assignment() already reverts a self-update of
--    department_id, designation_id, manager_id, shift_id, employee_code,
--    joining_date, employment_status, employment_type, profile_completed_at,
--    and exit_date back to their old value -- but it never mentions `email`
--    at all. This migration adds exactly one line to revert `email` the
--    same way, so "Work email is read-only" (self-edit route) becomes a
--    real, unbypassable backend rule, not just a disabled input in the UI.
--    Everything else in the function is unchanged, byte-for-byte, from
--    20261003120000_employee_onboarding.sql.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

create or replace function public.employees_guard_self_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.allow_onboarding_write', true), '') = 'on' then
    return new;
  end if;

  if auth.uid() is null or old.profile_id is distinct from auth.uid() then
    return new;
  end if;

  new.organization_id := old.organization_id;
  new.profile_id := old.profile_id;
  new.department_id := old.department_id;
  new.designation_id := old.designation_id;
  new.manager_id := old.manager_id;
  new.shift_id := old.shift_id;
  new.employee_code := old.employee_code;
  new.joining_date := old.joining_date;
  new.employment_status := old.employment_status;
  new.employment_type := old.employment_type;
  new.profile_completed_at := old.profile_completed_at;
  new.exit_date := old.exit_date;
  -- Work email is tied to login (handle_new_user() links a new sign-up to
  -- this row by email) -- an employee can never change their own, even via
  -- a direct API call, only admin/HR (employees_admin_hr_all) can.
  new.email := old.email;

  if old.employment_status in ('pending_approval', 'profile_changes_requested', 'rejected')
     and not public.onboarding_section_editable(old.id, 'personal') then
    new.first_name := old.first_name;
    new.middle_name := old.middle_name;
    new.last_name := old.last_name;
    new.date_of_birth := old.date_of_birth;
    new.gender := old.gender;
    new.blood_group := old.blood_group;
    new.marital_status := old.marital_status;
    new.nationality := old.nationality;
    new.personal_email := old.personal_email;
    new.photo_url := old.photo_url;
  end if;

  if old.employment_status not in ('pending_approval', 'profile_changes_requested')
     or not public.onboarding_section_editable(old.id, 'personal') then
    new.phone := old.phone;
    new.alternate_phone := old.alternate_phone;
  end if;

  return new;
end;
$$;
