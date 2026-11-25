-- Priority 6 (Projects team/department visibility) -- approved change:
-- narrow projects_select / project_members_select from org-wide-for-any-lead
-- to team/department-scoped, matching how Tasks already work.
--
-- Current live behavior (confirmed by reading the final, live definitions):
--   projects_select / project_members_select (20261102100000_general_manager_role.sql:230-257,
--   the latest create-or-replace for these two policies) use public.is_lead()
--   -- a pure role check (is_dept_head() or is_team_lead()), with NO
--   department/team predicate. Any dept_head or team_lead in the
--   organisation can see every project and every project's membership
--   list, not just their own team's or department's.
--
-- Compare to tasks_select/_update/_delete (20261001110000_projects_module.sql:466-527),
-- which correctly use can_view_employee(assigned_to)/can_manage_employee(assigned_to)
-- -- the same department/direct-report-scoped helpers used across the rest
-- of this app (Attendance, Leave, Goals, Performance, Helpdesk, Documents).
--
-- This migration replaces is_lead() with can_view_employee(owner_id) in
-- both policies: a dept_head sees projects owned by someone in their
-- department, a team_lead sees projects owned by a direct report, and
-- General Manager keeps the SAME org-wide read it already explicitly has
-- today (can_view_employee() preserves general_manager's org-wide branch --
-- confirmed by reading its definition in the same migration file that
-- defines the current live policy). admin/hr are unchanged (already listed
-- by role name, not through is_lead()).
--
-- NOT changed, per explicit instruction:
--   * projects_update (can_manage_project()) -- stays owner-or-admin/hr only.
--   * projects_insert -- stays admin/hr/any-lead-may-create; this governs
--     WHO may create a project at all, not project visibility, and the
--     approved decision was scoped to visibility only. A newly created
--     project's owner_id always becomes its creator (projects_before_write()
--     trigger), so this file does not need to touch insert for the
--     team/department-scoping to take effect on what a lead can SEE
--     afterward.
--   * tasks_select/_update/_delete -- already correctly scoped, untouched.
--   * can_manage_project(), is_project_member() -- untouched.
--
-- No existing rows are altered or deleted -- this is purely a visibility
-- (SELECT) change via create-or-replace policy, same pattern as every
-- other migration this session.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (
    organization_id = public.dwr_actor_org()
    and (
      public.current_user_role() in ('admin', 'hr', 'general_manager')
      or public.can_view_employee(owner_id)
      or owner_id = public.current_employee_id()
      or public.is_project_member(id)
    )
  );

drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
  for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_members.project_id
        and p.organization_id = public.dwr_actor_org()
        and (
          public.current_user_role() in ('admin', 'hr', 'general_manager')
          or public.can_view_employee(p.owner_id)
          or p.owner_id = public.current_employee_id()
        )
    )
    or public.is_project_member(project_id)
  );

notify pgrst, 'reload schema';
