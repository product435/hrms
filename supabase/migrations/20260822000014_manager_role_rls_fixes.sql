-- Two genuine RLS gaps that block Manager (and, as an unavoidable side
-- effect, Employee) functionality that already exists in the frontend.
-- Both are additive grants; no existing policy is touched.

-- 1) attendance_records had self_insert + self_select but no self UPDATE
--    policy. Checking in (INSERT, when no row exists yet for today) already
--    worked; checking out (UPDATE of that same-day row) was silently
--    rejected by RLS for anyone who isn't admin/hr (they were covered by
--    admin_hr_all's ALL grant, masking the gap). Confirmed live: a direct
--    PATCH as the manager returned 200 with an empty body and no row change.
create policy attendance_records_self_update on public.attendance_records for update
  using (employee_id = current_employee_id())
  with check (employee_id = current_employee_id());

-- 2) employees had no INSERT policy for managers at all (only
--    employees_admin_hr_all), so the existing "Add employee" flow -- which
--    the UI already exposes to managers and sets manager_id to the caller's
--    own employee id -- was rejected outright. Scoped to the manager's own
--    organization and requires them to be the manager of the new hire.
create policy employees_manager_insert_team on public.employees for insert
  with check (
    is_manager()
    and organization_id = current_org_id()
    and manager_id = current_employee_id()
  );
