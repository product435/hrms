-- job_openings only ever had job_openings_admin_hr_all, unlike every other
-- reference table (departments, assets, leave_types, ...) which also has a
-- broad "<table>_read_all" policy for any org member. That left the Manager
-- (and Employee) dashboard's "Hiring pipeline" card with zero visible rows
-- even when real open requisitions exist -- confirmed live: a manager's own
-- REST query for job_openings returned an empty array. This mirrors the
-- existing read-all pattern exactly.
create policy job_openings_read_all on public.job_openings for select
  using (organization_id = current_org_id());
