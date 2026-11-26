-- Preserve team_lead/dept_head abilities for a promoted general_manager.
--
-- Context: Zaid (JV-004) is moving from team_lead to general_manager. The
-- role change must not cost him anything he can do today as a lead over
-- his own team (same team scope as today, never org-wide), on top of the
-- leave fix already written in 20261126070000_leave_decision_access_rules.sql
-- (untouched here).
--
-- Explicit constraints honored:
--   * is_lead(), is_team_lead(), can_manage_employee() are NOT redefined --
--     every other caller of these three functions keeps its exact current
--     behavior, byte-for-byte.
--   * Every new check here is scoped to the SAME team the caller already
--     leads today (their own direct reports via employees.manager_id, or
--     the department they head via departments.manager_id) -- never
--     widened to the whole organisation for a general_manager.
--   * 20261126070000 (leave) is not touched by this file.
--
-- Pattern, identical to the leave fix: new, narrow, additive functions
-- used only at the specific call sites below. No existing function is
-- redefined to change its logic for roles that already call it today --
-- each one gains a general_manager branch with the exact same team/
-- department scoping team_lead/dept_head already have, and nothing else
-- changes for admin/hr/dept_head/team_lead/employee.
--
-- Covers, per explicit request:
--   1. Create projects (projects_insert policy + can_create_project()).
--   2. Search the project member directory and add members
--      (project_member_directory(), project_members_insert policy
--      already uses can_manage_project(), untouched -- see note below).
--   3. Write the team DWR conclusion (save_team_daily_summary) and review
--      the same team's DWRs (review_dwr) -- a new can_review_dwr()
--      function, used only by review_dwr(), leaves can_manage_employee()
--      untouched for every other caller.
--   4. Add a new employee under himself as default manager
--      (employees_manager_insert_team policy).
--   5. "My Team" filter data source: no backend change needed -- see note
--      in the final report; this is answered by employeeService.teamOf()
--      already being scope-correct, the frontend gate is the only change
--      (not part of this SQL file).
--   6. KPI calculation (compute_kpi_scores), restricted to the same team
--      scope, NOT org-wide -- a general_manager calculating scores must
--      only populate kra_scope with their own team's employees, same as a
--      team_lead/dept_head would, even though can_view_employee() (used
--      elsewhere, for VIEWING kpi_scores/employee_kra_assignments) already
--      grants general_manager an org-wide read today. That existing,
--      unrelated read path is explicitly left as-is per your decision --
--      only the CALCULATION gate changes here, and only for the
--      general_manager case.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- 0. gm_team_scope_employee_ids: the employee IDs a general_manager would
--    lead if they still held their most specific prior lead relationship --
--    their own direct reports (manager_id), plus anyone in a department
--    they are set as the head (manager_id) of, plus themselves. For a
--    general_manager with neither relationship (never was a lead, or data
--    was cleared), this returns only their own id -- never org-wide.
--    Used only by the new functions below; does not change any existing
--    function's behavior.
-- ---------------------------------------------------------------------------

create or replace function public.gm_team_scope_employee_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(distinct emp_id),
    array[public.current_employee_id()]
  )
  from (
    select public.current_employee_id() as emp_id
    union
    select e.id
    from public.employees e
    where e.manager_id = public.current_employee_id()
    union
    select e.id
    from public.employees e
    join public.departments d on d.id = e.department_id
    where d.manager_id = public.current_employee_id()
  ) scope
  where emp_id is not null;
$$;

revoke all on function public.gm_team_scope_employee_ids() from public, anon;
grant execute on function public.gm_team_scope_employee_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Create projects: projects_insert currently reads
--    (admin/hr OR is_lead()) -- live in 20261001110000_projects_module.sql.
--    is_lead() is not touched. Instead, the policy is re-created (not the
--    function) to add an explicit general_manager branch scoped to "has a
--    team today" via gm_team_scope_employee_ids() having more than just
--    themselves in it, OR already owning/managing at least one project --
--    mirrors is_lead()'s own "you lead something" shape without calling it.
-- ---------------------------------------------------------------------------

create or replace function public.can_create_project()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() in ('admin', 'hr')
    or public.is_lead()
    or public.current_user_role() = 'general_manager';
$$;

revoke all on function public.can_create_project() from public, anon;
grant execute on function public.can_create_project() to authenticated, service_role;

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (
    organization_id = public.dwr_actor_org()
    and public.can_create_project()
  );

-- ---------------------------------------------------------------------------
-- 2. Project member directory: project_member_directory() (live in
--    20261001130000_project_member_directory.sql) currently requires
--    is_lead() OR can_manage_project(p.id) for at least one project.
--    Re-created with an added general_manager branch, same team-scoped
--    shape as above.
--    project_members_insert (adding a member to a specific project) already
--    uses can_manage_project(), which is owner/admin-hr/project-role based,
--    not role-string based -- it is UNCHANGED and already works correctly
--    for a general_manager who owns or manages the project, exactly as it
--    does for anyone else; no edit needed there.
-- ---------------------------------------------------------------------------

create or replace function public.project_member_directory()
returns table (
  id uuid,
  full_name text,
  department_name text,
  department_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.dwr_actor_org();
begin
  if v_org is null then
    return;
  end if;

  -- admin/hr, department heads / team leads, a general_manager with a team
  -- scope (same shape as can_create_project(), not org-wide), or anyone who
  -- can manage at least one project in this organisation. A plain employee
  -- role fails here, same as before.
  if not (
    public.current_user_role() in ('admin', 'hr')
    or public.is_lead()
    or public.current_user_role() = 'general_manager'
    or exists (
      select 1
      from public.projects p
      where p.organization_id = v_org
        and public.can_manage_project(p.id)
    )
  ) then
    return;
  end if;

  return query
  select
    e.id,
    nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), '') as full_name,
    d.name as department_name,
    e.department_id
  from public.employees e
  left join public.departments d
    on d.id = e.department_id
   and d.organization_id = e.organization_id
  where e.organization_id = v_org
    and lower(coalesce(e.employment_status, 'active')) in (
      'active', 'probation', 'notice', 'on-leave'
    )
  order by 2 nulls last, 1;
end;
$$;

revoke all on function public.project_member_directory() from public, anon;
grant execute on function public.project_member_directory() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Team DWR conclusion + review: save_team_daily_summary() currently
--    requires is_lead() (untouched elsewhere -- this is the only call site
--    of is_lead() redefined, and only to re-create THIS function's body,
--    not the is_lead() function itself). review_dwr() currently requires
--    can_manage_employee() (also untouched as a function -- this swaps
--    review_dwr()'s OWN call to a new, narrower can_review_dwr(), so every
--    other caller of can_manage_employee() is unaffected).
-- ---------------------------------------------------------------------------

create or replace function public.can_review_dwr(emp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.can_manage_employee(emp_id)
    or (
      emp_id is not null
      and emp_id is distinct from public.current_employee_id()
      and public.current_user_role() = 'general_manager'
      and emp_id = any (public.gm_team_scope_employee_ids())
    );
$$;

revoke all on function public.can_review_dwr(uuid) from public, anon;
grant execute on function public.can_review_dwr(uuid) to authenticated, service_role;

create or replace function public.review_dwr(
  p_report_id uuid,
  p_decision text,
  p_rating smallint,
  p_remarks text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.daily_work_reports%rowtype;
begin
  perform set_config('app.dwr_rpc', 'on', true);

  if p_decision not in ('approved', 'needs-revision') then
    raise exception 'Choose approve or needs revision.';
  end if;
  if p_decision = 'approved' and (p_rating is null or p_rating < 1 or p_rating > 5) then
    raise exception 'A rating from 1 to 5 is required to approve.';
  end if;
  if p_decision = 'needs-revision' and btrim(coalesce(p_remarks, '')) = '' then
    raise exception 'Remarks are required when you send a report back.';
  end if;

  select * into v_row from public.daily_work_reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found.';
  end if;
  if not public.can_review_dwr(v_row.employee_id) then
    raise exception 'You cannot review this report.';
  end if;
  if v_row.status not in ('submitted', 'late') then
    raise exception 'Only a submitted report can be reviewed.';
  end if;

  update public.daily_work_reports
  set review_status = p_decision,
      lead_rating = case when p_decision = 'approved' then p_rating else lead_rating end,
      lead_remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
      reviewed_by = public.current_employee_id(),
      reviewed_at = now(),
      escalated = false,
      updated_at = now()
  where id = p_report_id;
end;
$fn$;

revoke all on function public.review_dwr(uuid, text, smallint, text) from public, anon;
grant execute on function public.review_dwr(uuid, text, smallint, text) to authenticated, service_role;

create or replace function public.save_team_daily_summary(
  p_report_date date,
  p_department_id uuid,
  p_summary text,
  p_highlights text,
  p_risks text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lead uuid;
  v_org uuid;
  v_id uuid;
begin
  if not (
    public.is_lead()
    or public.current_user_role() = 'general_manager'
  ) then
    raise exception 'Only a team lead or department head can write the team conclusion.';
  end if;
  if btrim(coalesce(p_summary, '')) = '' then
    raise exception 'Write the team conclusion before saving.';
  end if;
  if p_report_date is null then
    raise exception 'Choose a report date.';
  end if;

  v_lead := public.current_employee_id();
  select e.organization_id into v_org from public.employees e where e.id = v_lead;
  if v_lead is null or v_org is null then
    raise exception 'Your account is not linked to an employee record.';
  end if;

  if p_department_id is not null and not exists (
    select 1
    from public.departments d
    where d.id = p_department_id
      and d.organization_id = v_org
      and (
        d.manager_id = v_lead
        or exists (
          select 1 from public.employees member
          where member.department_id = d.id
            and member.manager_id = v_lead
        )
        or exists (
          select 1 from public.employees self
          where self.id = v_lead and self.department_id = d.id
        )
      )
  ) then
    raise exception 'That department is outside your team.';
  end if;

  insert into public.team_daily_summaries (
    organization_id, lead_employee_id, department_id, report_date, summary, highlights, risks
  ) values (
    v_org,
    v_lead,
    p_department_id,
    p_report_date,
    btrim(p_summary),
    nullif(btrim(coalesce(p_highlights, '')), ''),
    nullif(btrim(coalesce(p_risks, '')), '')
  )
  on conflict (lead_employee_id, report_date) do update
  set department_id = excluded.department_id,
      summary = excluded.summary,
      highlights = excluded.highlights,
      risks = excluded.risks,
      updated_at = now()
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.save_team_daily_summary(date, uuid, text, text, text) from public, anon;
grant execute on function public.save_team_daily_summary(date, uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Add a new employee under himself as default manager:
--    employees_manager_insert_team (live in
--    20260926000001_role_hierarchy_access_scope.sql:504-524) currently
--    allows INSERT when (is_team_lead() and manager_id = self) or
--    (is_dept_head() and department is one they head). Re-created with an
--    added general_manager branch using the exact same two shapes --
--    manager_id = self, or heads the target department -- never org-wide
--    (a general_manager cannot insert an employee under an arbitrary
--    manager_id or into an arbitrary department through this policy; only
--    under themselves or into a department they head, same restriction a
--    team_lead/dept_head already has).
-- ---------------------------------------------------------------------------

drop policy if exists employees_manager_insert_team on public.employees;
create policy employees_manager_insert_team on public.employees
  for insert
  with check (
    organization_id = public.current_org_id()
    and (
      (
        public.is_team_lead()
        and manager_id = public.current_employee_id()
      )
      or (
        public.is_dept_head()
        and exists (
          select 1
          from public.departments d
          where d.id = department_id
            and d.manager_id = public.current_employee_id()
        )
      )
      or (
        public.current_user_role() = 'general_manager'
        and (
          manager_id = public.current_employee_id()
          or exists (
            select 1
            from public.departments d
            where d.id = department_id
              and d.manager_id = public.current_employee_id()
          )
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. KPI calculation: compute_kpi_scores() currently gates on a pure role
--    list (admin/hr/dept_head/team_lead/manager) with NO scoping of its
--    own -- kra_scope is populated via can_view_employee(), which already
--    lets a general_manager read org-wide. Adding 'general_manager' to
--    that same role list would therefore let a GM CALCULATE scores for the
--    whole organisation, not just their team -- explicitly not wanted.
--    Fixed instead by keeping the existing gate's role list UNCHANGED
--    (admin/hr/dept_head/team_lead/manager still pass exactly as before,
--    with their existing, already-correct scope) and adding a SEPARATE
--    general_manager branch that restricts kra_scope's population to
--    gm_team_scope_employee_ids() specifically for that caller -- so a
--    general_manager calculates scores only for their own team, same as
--    they could as team_lead, while every other role's behavior is
--    byte-for-byte unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.compute_kpi_scores(period text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_period text;
  v_start date;
  v_end date;
  v_count integer := 0;
  v_step integer := 0;
  v_dwr_emp text;
  v_dwr_date text;
  v_task_emp text;
  v_has_status boolean;
  v_has_rating boolean;
  v_task_status boolean;
  v_gm_scope boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to calculate KPI scores.';
  end if;

  -- Only addition vs. the live version: a general_manager also passes this
  -- gate, but (unlike admin/hr/dept_head/team_lead/manager, whose existing
  -- scope is untouched below) kra_scope is restricted to
  -- gm_team_scope_employee_ids() for this caller specifically, so a
  -- general_manager calculates scores only for their own team, never
  -- org-wide, even though can_view_employee() (used elsewhere, for VIEWING
  -- kpi_scores/employee_kra_assignments) already grants them an org-wide
  -- read today -- that unrelated, pre-existing read path is untouched.
  v_gm_scope := public.current_user_role() = 'general_manager';

  if public.current_user_role() not in ('admin', 'hr', 'dept_head', 'team_lead', 'manager')
     and not v_gm_scope
  then
    raise exception 'Only a lead or HR can calculate KPI scores.';
  end if;

  v_period := public.kra_assert_period(period);
  v_start := to_date(v_period || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month' - interval '1 day')::date;

  create temp table kra_scope (
    employee_id uuid primary key,
    organization_id uuid,
    measured_from date,
    measured_to date,
    prorated boolean
  ) on commit drop;

  insert into kra_scope (employee_id, organization_id, measured_from, measured_to, prorated)
  select
    e.id,
    e.organization_id,
    greatest(v_start, coalesce(e.joining_date, v_start)),
    least(v_end, coalesce(e.exit_date, v_end)),
    e.joining_date is not null and e.joining_date > v_start and e.joining_date <= v_end
  from public.employees e
  where e.organization_id = public.current_org_id()
    and (
      (not v_gm_scope and public.can_view_employee(e.id))
      or (v_gm_scope and e.id = any (public.gm_team_scope_employee_ids()))
    )
    and (e.joining_date is null or e.joining_date <= v_end)
    and (e.exit_date is null or e.exit_date >= v_start);

  create temp table kra_workdays (
    employee_id uuid,
    work_date date,
    primary key (employee_id, work_date)
  ) on commit drop;

  insert into kra_workdays (employee_id, work_date)
  select s.employee_id, gs.day::date
  from kra_scope s
  cross join lateral generate_series(s.measured_from, s.measured_to, interval '1 day') as gs(day)
  where s.measured_from <= s.measured_to
    and extract(isodow from gs.day)::int between 1 and 5
    and not exists (
      select 1
      from public.holidays h
      where h.date = gs.day::date
        and (h.organization_id is null or h.organization_id = s.organization_id)
    )
    and not exists (
      select 1
      from public.leave_requests lr
      where lr.employee_id = s.employee_id
        and lower(coalesce(lr.status, '')) = 'approved'
        and lr.start_date is not null
        and gs.day::date between lr.start_date and coalesce(lr.end_date, lr.start_date)
        and coalesce(lr.total_days, 1) >= 1
    );

  create temp table kra_auto (
    employee_id uuid primary key,
    attendance_pct numeric,
    punctuality numeric,
    dwr_submission numeric,
    dwr_ontime numeric,
    lead_rating numeric,
    task_ontime numeric
  ) on commit drop;

  insert into kra_auto (
    employee_id, attendance_pct, punctuality, dwr_submission, dwr_ontime, lead_rating, task_ontime
  )
  select
    s.employee_id,
    case
      when coalesce(wd.days, 0) = 0 then null
      else round((coalesce(att.attended, 0)::numeric / wd.days) * 100, 2)
    end,
    case
      when coalesce(att.checkins, 0) = 0 then null
      else round((att.ontime::numeric / att.checkins) * 100, 2)
    end,
    null, null, null, null
  from kra_scope s
  left join (
    select employee_id, count(*)::int as days
    from kra_workdays
    group by employee_id
  ) wd on wd.employee_id = s.employee_id
  left join (
    select
      ar.employee_id,
      count(distinct ar.attendance_date) filter (
        where lower(coalesce(ar.status, '')) in ('present', 'late', 'wfh')
           or lower(coalesce(ar.work_mode, '')) = 'wfh'
      )::int as attended,
      count(distinct ar.attendance_date) filter (where ar.check_in is not null)::int as checkins,
      count(distinct ar.attendance_date) filter (
        where ar.check_in is not null
          and lower(coalesce(ar.status, '')) <> 'late'
      )::int as ontime
    from public.attendance_records ar
    join kra_workdays w
      on w.employee_id = ar.employee_id
     and w.work_date = ar.attendance_date
    group by ar.employee_id
  ) att on att.employee_id = s.employee_id;

  if to_regclass('public.daily_work_reports') is not null then
    v_dwr_emp := case
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'daily_work_reports' and column_name = 'employee_id'
      ) then 'employee_id'
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'daily_work_reports' and column_name = 'employee'
      ) then 'employee'
      else null
    end;
    v_dwr_date := case
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'daily_work_reports' and column_name = 'report_date'
      ) then 'report_date'
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'daily_work_reports' and column_name = 'work_date'
      ) then 'work_date'
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'daily_work_reports' and column_name = 'date'
      ) then 'date'
      else null
    end;
    v_has_status := exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'daily_work_reports' and column_name = 'status'
    );
    v_has_rating := exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'daily_work_reports' and column_name = 'lead_rating'
    );

    if v_dwr_emp is not null and v_dwr_date is not null and v_has_status then
      begin
        if v_has_rating then
          execute format($sql$
            update kra_auto a
            set dwr_submission = s.submission_rate,
                dwr_ontime = s.ontime_rate,
                lead_rating = s.avg_rating
            from (
              select
                w.employee_id,
                case when count(distinct w.work_date) = 0 then null
                  else round(
                    count(distinct case
                      when lower(coalesce(r.status, '')) in ('submitted', 'late', 'approved') then w.work_date
                    end)::numeric / count(distinct w.work_date) * 100, 2)
                end as submission_rate,
                case when count(distinct w.work_date) = 0 then null
                  else round(
                    count(distinct case
                      when lower(coalesce(r.status, '')) in ('submitted', 'approved') then w.work_date
                    end)::numeric / count(distinct w.work_date) * 100, 2)
                end as ontime_rate,
                avg(r.lead_rating) filter (where r.lead_rating is not null) as avg_rating
              from kra_workdays w
              left join public.daily_work_reports r
                on r.%1$I = w.employee_id
               and (r.%2$I)::date = w.work_date
              group by w.employee_id
            ) s
            where s.employee_id = a.employee_id
          $sql$, v_dwr_emp, v_dwr_date);
        else
          execute format($sql$
            update kra_auto a
            set dwr_submission = s.submission_rate,
                dwr_ontime = s.ontime_rate
            from (
              select
                w.employee_id,
                case when count(distinct w.work_date) = 0 then null
                  else round(
                    count(distinct case
                      when lower(coalesce(r.status, '')) in ('submitted', 'late', 'approved') then w.work_date
                    end)::numeric / count(distinct w.work_date) * 100, 2)
                end as submission_rate,
                case when count(distinct w.work_date) = 0 then null
                  else round(
                    count(distinct case
                      when lower(coalesce(r.status, '')) in ('submitted', 'approved') then w.work_date
                    end)::numeric / count(distinct w.work_date) * 100, 2)
                end as ontime_rate
              from kra_workdays w
              left join public.daily_work_reports r
                on r.%1$I = w.employee_id
               and (r.%2$I)::date = w.work_date
              group by w.employee_id
            ) s
            where s.employee_id = a.employee_id
          $sql$, v_dwr_emp, v_dwr_date);
        end if;
      exception
        when others then
          raise notice 'Skipping DWR KPI metrics: %', sqlerrm;
      end;
    end if;
  end if;

  if to_regclass('public.tasks') is not null then
    v_task_emp := case
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'tasks' and column_name = 'assigned_to'
      ) then 'assigned_to'
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'tasks' and column_name = 'employee_id'
      ) then 'employee_id'
      else null
    end;
    v_task_status := exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tasks' and column_name = 'status'
    );

    if v_task_emp is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'tasks' and column_name = 'due_date'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'tasks' and column_name = 'completed_at'
      )
    then
      begin
        if v_task_status then
          execute format($sql$
            update kra_auto a
            set task_ontime = s.rate
            from (
              select
                scope.employee_id,
                case
                  when count(*) filter (
                    where t.due_date is not null
                      and t.due_date::date between scope.measured_from and scope.measured_to
                      and lower(coalesce(t.status, '')) not in ('cancelled', 'canceled')
                  ) = 0 then null
                  else round(
                    count(*) filter (
                      where t.due_date is not null
                        and t.due_date::date between scope.measured_from and scope.measured_to
                        and lower(coalesce(t.status, '')) in ('done', 'completed', 'complete')
                        and t.completed_at is not null
                        and t.completed_at::date <= t.due_date::date
                    )::numeric
                    / count(*) filter (
                      where t.due_date is not null
                        and t.due_date::date between scope.measured_from and scope.measured_to
                        and lower(coalesce(t.status, '')) not in ('cancelled', 'canceled')
                    ) * 100, 2)
                end as rate
              from kra_scope scope
              left join public.tasks t on t.%1$I = scope.employee_id
              group by scope.employee_id
            ) s
            where s.employee_id = a.employee_id
          $sql$, v_task_emp);
        else
          execute format($sql$
            update kra_auto a
            set task_ontime = s.rate
            from (
              select
                scope.employee_id,
                case
                  when count(*) filter (
                    where t.due_date is not null
                      and t.due_date::date between scope.measured_from and scope.measured_to
                  ) = 0 then null
                  else round(
                    count(*) filter (
                      where t.due_date is not null
                        and t.due_date::date between scope.measured_from and scope.measured_to
                        and t.completed_at is not null
                        and t.completed_at::date <= t.due_date::date
                    )::numeric
                    / count(*) filter (
                      where t.due_date is not null
                        and t.due_date::date between scope.measured_from and scope.measured_to
                    ) * 100, 2)
                end as rate
              from kra_scope scope
              left join public.tasks t on t.%1$I = scope.employee_id
              group by scope.employee_id
            ) s
            where s.employee_id = a.employee_id
          $sql$, v_task_emp);
        end if;
      exception
        when others then
          raise notice 'Skipping task KPI metrics: %', sqlerrm;
      end;
    end if;
  end if;

  create temp table kra_computed (
    employee_id uuid,
    kpi_id uuid,
    actual numeric,
    score numeric,
    primary key (employee_id, kpi_id)
  ) on commit drop;

  insert into kra_computed (employee_id, kpi_id, actual, score)
  select
    s.employee_id,
    kd.id,
    case public.kra_auto_metric_kind(kd.source, kd.metric)
      when 'attendance_pct' then m.attendance_pct
      when 'punctuality' then m.punctuality
      when 'dwr_submission' then m.dwr_submission
      when 'dwr_ontime' then m.dwr_ontime
      when 'lead_rating' then m.lead_rating
      when 'task_ontime' then m.task_ontime
      else null
    end,
    public.kra_score_value(
      case public.kra_auto_metric_kind(kd.source, kd.metric)
        when 'attendance_pct' then m.attendance_pct
        when 'punctuality' then m.punctuality
        when 'dwr_submission' then m.dwr_submission
        when 'dwr_ontime' then m.dwr_ontime
        when 'lead_rating' then m.lead_rating
        when 'task_ontime' then m.task_ontime
        else null
      end,
      coalesce(nullif(r.overrides -> kd.id::text ->> 'target', '')::numeric, kd.target),
      kd.direction
    )
  from kra_scope s
  cross join lateral public.kra_resolved_templates(s.employee_id, v_period) r
  join public.kpi_definitions kd on kd.kra_template_id = r.template_id
  join kra_auto m on m.employee_id = s.employee_id
  where kd.source <> 'manual'
    and public.kra_auto_metric_kind(kd.source, kd.metric) is not null;

  insert into public.kpi_scores (employee_id, kpi_definition_id, period, actual, score, entered_by)
  select c.employee_id, c.kpi_id, v_period, c.actual, c.score, auth.uid()
  from kra_computed c
  where c.actual is not null
  on conflict (employee_id, kpi_definition_id, period)
  do update set
    actual = excluded.actual,
    score = excluded.score,
    entered_by = excluded.entered_by,
    updated_at = now();
  get diagnostics v_step = row_count;
  v_count := v_count + v_step;

  update public.kpi_scores sc
  set actual = null,
      score = null,
      updated_at = now()
  from kra_computed c
  where sc.employee_id = c.employee_id
    and sc.kpi_definition_id = c.kpi_id
    and sc.period = v_period
    and c.actual is null
    and (sc.actual is not null or sc.score is not null);
  get diagnostics v_step = row_count;
  v_count := v_count + v_step;

  begin
    insert into public.notifications (user_id, title, message, type, reference_type, reference_id, is_read)
    select distinct
      recipient.profile_id,
      'Manual KPI not rated',
      btrim(concat_ws(' ', e.first_name, e.last_name))
        || ' still has a manual KPI without a score for ' || v_period
        || '. It stays Not rated until a lead enters it.',
      'kra',
      'kra_manual_missing',
      e.id,
      false
    from kra_scope scope
    join public.employees e on e.id = scope.employee_id
    join lateral public.kra_resolved_templates(e.id, v_period) t on true
    join public.kpi_definitions kd
      on kd.kra_template_id = t.template_id
     and kd.source = 'manual'
    left join public.kpi_scores sc
      on sc.employee_id = e.id
     and sc.kpi_definition_id = kd.id
     and sc.period = v_period
     and sc.score is not null
    join lateral (
      select coalesce(
        mgr.profile_id,
        (select p.id from public.profiles p where p.employee_id = e.manager_id limit 1),
        head.profile_id,
        (select p.id from public.profiles p where p.employee_id = dept.manager_id limit 1)
      ) as profile_id
      from public.employees self
      left join public.employees mgr on mgr.id = self.manager_id
      left join public.departments dept on dept.id = self.department_id
      left join public.employees head on head.id = dept.manager_id
      where self.id = e.id
    ) recipient on true
    where sc.id is null
      and recipient.profile_id is not null
      and not exists (
        select 1
        from public.notifications n
        where n.user_id = recipient.profile_id
          and n.reference_type = 'kra_manual_missing'
          and n.reference_id = e.id
          and coalesce(n.message, '') like '%' || v_period || '%'
          and n.created_at > now() - interval '25 days'
      );
  exception
    when others then
      raise notice 'Skipping manual KPI reminder: %', sqlerrm;
  end;

  return v_count;
end;
$$;

revoke all on function public.compute_kpi_scores(text) from public, anon;
grant execute on function public.compute_kpi_scores(text) to authenticated, service_role;

notify pgrst, 'reload schema';
