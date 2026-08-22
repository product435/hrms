-- asset_repairs only ever had asset_repairs_admin_hr_all -- unlike
-- asset_assignments, which already has asset_assignments_self_select. An
-- employee could see that an asset was assigned to them but never its
-- repair history, so "My assets" > Asset History always came back empty for
-- repair events regardless of real data. Scoped to assets the employee
-- currently or previously held (not just current assignments), so past
-- repair history stays visible after a return.
create policy asset_repairs_self_select on public.asset_repairs for select
  using (
    exists (
      select 1 from public.asset_assignments aa
      where aa.asset_id = asset_repairs.asset_id
        and aa.employee_id = current_employee_id()
    )
  );
