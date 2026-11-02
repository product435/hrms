-- General Manager role.
--
-- Stored value: profiles.role = 'general_manager' (UI: "General Manager").
--
-- What a General Manager can do:
--   * Read every employee's work reports (DWRs + items), team summaries, AI DWR
--     analyses, tasks, attendance, leave, goals, performance reviews, KRA
--     assignments, KPI scores and performance indexes across the organisation.
--   * Read every project and its member list.
--   * Act as a normal lead for anyone who actually reports to them (manager_id)
--     or sits in a department they head.
--
-- What a General Manager cannot do (unchanged admin/HR-only or self-only data):
--   * Payroll, salary structures, payslips.
--   * Personal records: documents + document storage, bank accounts, addresses,
--     emergency contacts, family, education, experience, identity.
--   * Expense claims and helpdesk tickets of people outside their lead scope.
--   * Approve / review / edit records of people outside their lead scope:
--     can_manage_employee() keeps the original lead scope and never grants
--     org-wide write access to a General Manager.
--   * Assign roles. Only a Super Admin can make someone a General Manager.

-- ------------------------------------------------------------
-- 1. Allowed role values
-- ------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (
    role is null
    or role in ('admin', 'general_manager', 'hr', 'dept_head', 'team_lead', 'employee')
  );

insert into public.roles (id, name, description)
select gen_random_uuid(), 'general_manager', 'General Manager'
where not exists (select 1 from public.roles where name = 'general_manager');

-- Announcements can target the new role.
alter table public.announcements drop constraint if exists announcements_target_shape_check;
alter table public.announcements
  add constraint announcements_target_shape_check
  check (
    (
      target_scope = 'organization'
      and target_department_id is null
      and target_role is null
    )
    or (
      target_scope = 'department'
      and target_department_id is not null
      and target_role is null
    )
    or (
      target_scope = 'role'
      and target_department_id is null
      and target_role in ('admin', 'general_manager', 'hr', 'dept_head', 'team_lead', 'employee')
    )
  );

-- ------------------------------------------------------------
-- 2. Role helpers
-- ------------------------------------------------------------

create or replace function public.is_general_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'general_manager', false);
$$;

-- The original lead/admin/HR visibility scope, without the General Manager's
-- org-wide read. Personal-record policies and can_manage_employee() use this.
create or replace function public.can_view_employee_scoped(emp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select emp_id is not null and (
    emp_id = public.current_employee_id()
    or (
      public.current_user_role() in ('admin', 'hr')
      and exists (
        select 1
        from public.employees e
        where e.id = emp_id
          and e.organization_id = public.current_org_id()
      )
    )
    or exists (
      select 1
      from public.employees e
      join public.departments d on d.id = e.department_id
      where e.id = emp_id
        and d.manager_id = public.current_employee_id()
        and e.organization_id = public.current_org_id()
    )
    or exists (
      select 1
      from public.employees e
      where e.id = emp_id
        and e.manager_id = public.current_employee_id()
        and e.organization_id = public.current_org_id()
    )
  );
$$;

-- Work, performance and KPI visibility. A General Manager sees the whole
-- organisation; everyone else keeps the scoped rule.
create or replace function public.can_view_employee(emp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select emp_id is not null and (
    public.can_view_employee_scoped(emp_id)
    or (
      public.current_user_role() = 'general_manager'
      and exists (
        select 1
        from public.employees e
        where e.id = emp_id
          and e.organization_id = public.current_org_id()
      )
    )
  );
$$;

-- Write access stays on the scoped rule, so org-wide read never becomes
-- org-wide approve/edit for a General Manager.
create or replace function public.can_manage_employee(emp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    emp_id is not null
    and emp_id is distinct from public.current_employee_id()
    and public.can_view_employee_scoped(emp_id)
    and not (
      public.current_user_role() = 'hr'
      and exists (
        select 1
        from public.employees e
        join public.profiles p on p.id = e.profile_id
        where e.id = emp_id
          and p.role in ('admin', 'general_manager')
      )
    );
$$;

revoke all on function public.is_general_manager() from public, anon;
revoke all on function public.can_view_employee_scoped(uuid) from public, anon;
grant execute on function public.is_general_manager() to authenticated, service_role;
grant execute on function public.can_view_employee_scoped(uuid) to authenticated, service_role;
grant execute on function public.can_view_employee(uuid) to authenticated, service_role;
grant execute on function public.can_manage_employee(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Personal records stay on the scoped rule
-- ------------------------------------------------------------

drop policy if exists documents_manager_view_team on public.documents;
create policy documents_manager_view_team on public.documents
  for select
  using (
    public.can_view_employee_scoped(employee_id)
    and coalesce(category, '') not in ('Identity', 'Bank', 'KYC')
  );

drop policy if exists employee_documents_manager_select on storage.objects;
create policy employee_documents_manager_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and split_part(name, '/', 2) not in ('kyc', 'bank')
    and exists (
      select 1
      from public.employees e
      where e.id::text = split_part(name, '/', 1)
        and public.can_view_employee_scoped(e.id)
        and e.id is distinct from public.current_employee_id()
    )
  );

drop policy if exists emergency_contacts_lead_select on public.emergency_contacts;
create policy emergency_contacts_lead_select on public.emergency_contacts
  for select using (public.can_view_employee_scoped(employee_id));

drop policy if exists employee_addresses_lead_select on public.employee_addresses;
create policy employee_addresses_lead_select on public.employee_addresses
  for select using (public.can_view_employee_scoped(employee_id));

drop policy if exists employee_bank_accounts_lead_select on public.employee_bank_accounts;
create policy employee_bank_accounts_lead_select on public.employee_bank_accounts
  for select using (public.can_view_employee_scoped(employee_id));

drop policy if exists employee_education_lead_select on public.employee_education;
create policy employee_education_lead_select on public.employee_education
  for select using (public.can_view_employee_scoped(employee_id));

drop policy if exists employee_experience_lead_select on public.employee_experience;
create policy employee_experience_lead_select on public.employee_experience
  for select using (public.can_view_employee_scoped(employee_id));

drop policy if exists employee_family_lead_select on public.employee_family_members;
create policy employee_family_lead_select on public.employee_family_members
  for select using (public.can_view_employee_scoped(employee_id));

drop policy if exists helpdesk_tickets_lead_select on public.helpdesk_tickets;
create policy helpdesk_tickets_lead_select on public.helpdesk_tickets
  for select
  using (public.can_view_employee_scoped(employee_id));

drop policy if exists expense_claims_manager_view_team on public.expense_claims;
create policy expense_claims_manager_view_team on public.expense_claims
  for select
  using (public.can_view_employee_scoped(employee_id));

-- ------------------------------------------------------------
-- 4. Org-wide reads that were admin/HR-only by role name
-- ------------------------------------------------------------

drop policy if exists team_daily_summaries_select on public.team_daily_summaries;
create policy team_daily_summaries_select on public.team_daily_summaries
  for select
  using (
    organization_id = public.dwr_actor_org()
    and (
      lead_employee_id = public.current_employee_id()
      or public.current_user_role() in ('admin', 'hr', 'general_manager')
      or exists (
        select 1
        from public.departments d
        where d.manager_id = public.current_employee_id()
          and (
            d.id = team_daily_summaries.department_id
            or exists (
              select 1
              from public.employees e
              where e.id = team_daily_summaries.lead_employee_id
                and e.department_id = d.id
            )
          )
      )
    )
  );

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (
    organization_id = public.dwr_actor_org()
    and (
      public.current_user_role() in ('admin', 'hr', 'general_manager')
      or public.is_lead()
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
    )
    and (
      public.current_user_role() in ('admin', 'hr', 'general_manager')
      or public.is_lead()
      or public.is_project_member(project_id)
    )
  );

-- ------------------------------------------------------------
-- 5. Org performance board: allow the General Manager
-- ------------------------------------------------------------

create or replace function public.org_employee_metrics(period text)
returns table (
  employee_id uuid,
  employee_name text,
  department_id uuid,
  department_name text,
  performance_index numeric,
  attendance_percent numeric,
  dwr_compliance numeric,
  task_completion numeric
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_period text;
  v_start date;
  v_end date;
  v_holiday_col text;
  v_index jsonb;
  r record;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view performance.';
  end if;
  if public.current_user_role() not in ('admin', 'general_manager', 'hr', 'dept_head', 'team_lead', 'manager') then
    raise exception 'You cannot view organization performance.';
  end if;

  if to_regprocedure('public.kra_assert_period(text)') is not null then
    v_period := public.kra_assert_period(period);
  elsif period ~ '^\d{4}-(0[1-9]|1[0-2])$' then
    v_period := period;
  else
    raise exception 'Period must be YYYY-MM.';
  end if;

  v_start := to_date(v_period || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month' - interval '1 day')::date;

  drop table if exists org_scope;
  drop table if exists org_workdays;
  drop table if exists org_metrics;

  create temp table org_scope (
    employee_id uuid primary key,
    employee_name text,
    department_id uuid,
    department_name text,
    organization_id uuid,
    measured_from date,
    measured_to date
  ) on commit drop;

  insert into org_scope (
    employee_id, employee_name, department_id, department_name,
    organization_id, measured_from, measured_to
  )
  select
    e.id,
    coalesce(nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), ''), 'Employee'),
    e.department_id,
    coalesce(nullif(btrim(d.name), ''), 'Unassigned'),
    e.organization_id,
    greatest(v_start, coalesce(e.joining_date, v_start)),
    least(v_end, coalesce(e.exit_date, v_end))
  from public.employees e
  left join public.departments d on d.id = e.department_id
  where e.organization_id = public.current_org_id()
    and public.can_view_employee(e.id)
    and (e.joining_date is null or e.joining_date <= v_end)
    and (e.exit_date is null or e.exit_date >= v_start);

  create temp table org_workdays (
    employee_id uuid,
    work_date date,
    primary key (employee_id, work_date)
  ) on commit drop;

  insert into org_workdays (employee_id, work_date)
  select s.employee_id, gs.day::date
  from org_scope s
  cross join lateral generate_series(s.measured_from, s.measured_to, interval '1 day') as gs(day)
  where s.measured_from <= s.measured_to
    and extract(isodow from gs.day)::int between 1 and 5
    and not exists (
      select 1
      from public.leave_requests lr
      where lr.employee_id = s.employee_id
        and lower(coalesce(lr.status, '')) = 'approved'
        and lr.start_date is not null
        and gs.day::date between lr.start_date and coalesce(lr.end_date, lr.start_date)
        and coalesce(lr.total_days, 1) >= 1
    );

  if to_regclass('public.holidays') is not null then
    select case
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'holidays' and column_name = 'date'
      ) then 'date'
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'holidays' and column_name = 'holiday_date'
      ) then 'holiday_date'
      else null
    end
    into v_holiday_col;

    if v_holiday_col is not null then
      execute format($sql$
        delete from org_workdays w
        using public.holidays h, org_scope s
        where w.employee_id = s.employee_id
          and h.%1$I = w.work_date
          and h.organization_id = s.organization_id
      $sql$, v_holiday_col);
    end if;
  end if;

  create temp table org_metrics (
    employee_id uuid primary key,
    attendance_percent numeric,
    dwr_compliance numeric,
    task_completion numeric,
    performance_index numeric
  ) on commit drop;

  insert into org_metrics (employee_id, attendance_percent)
  select
    s.employee_id,
    case
      when coalesce(wd.days, 0) = 0 then null
      else round((coalesce(att.attended, 0)::numeric / wd.days) * 100, 2)
    end
  from org_scope s
  left join (
    select wdays.employee_id, count(*)::int as days
    from org_workdays wdays
    group by wdays.employee_id
  ) wd on wd.employee_id = s.employee_id
  left join (
    select
      ar.employee_id,
      count(distinct ar.attendance_date) filter (
        where lower(coalesce(ar.status, '')) in ('present', 'late', 'wfh', 'half-day', 'half_day')
           or lower(coalesce(ar.work_mode, '')) = 'wfh'
      )::int as attended
    from public.attendance_records ar
    join org_workdays w
      on w.employee_id = ar.employee_id
     and w.work_date = ar.attendance_date
    group by ar.employee_id
  ) att on att.employee_id = s.employee_id;

  if to_regclass('public.daily_work_reports') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'daily_work_reports' and column_name = 'employee_id'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'daily_work_reports' and column_name = 'report_date'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'daily_work_reports' and column_name = 'status'
     )
  then
    execute $sql$
      update org_metrics m
      set dwr_compliance = s.rate
      from (
        select
          w.employee_id,
          case
            when count(*) = 0 then null
            else round(
              (count(*) filter (
                where lower(coalesce(r.status, '')) in ('submitted', 'late')
              ))::numeric / count(*) * 100,
              2
            )
          end as rate
        from org_workdays w
        left join public.daily_work_reports r
          on r.employee_id = w.employee_id
         and r.report_date = w.work_date
        group by w.employee_id
      ) s
      where s.employee_id = m.employee_id
    $sql$;
  end if;

  if to_regclass('public.tasks') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'tasks' and column_name = 'assigned_to'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'tasks' and column_name = 'status'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'tasks' and column_name = 'due_date'
     )
  then
    execute format($sql$
      update org_metrics m
      set task_completion = s.rate
      from (
        select
          t.assigned_to as employee_id,
          case
            when count(*) = 0 then null
            else round(
              (count(*) filter (where t.status = 'done'))::numeric / count(*) * 100,
              2
            )
          end as rate
        from public.tasks t
        where t.assigned_to in (select org_scope.employee_id from org_scope)
          and t.due_date between %L::date and %L::date
        group by t.assigned_to
      ) s
      where s.employee_id = m.employee_id
    $sql$, v_start, v_end);
  end if;

  if to_regprocedure('public.employee_performance_index(uuid,text)') is not null then
    for r in select org_scope.employee_id from org_scope loop
      begin
        v_index := public.employee_performance_index(r.employee_id, v_period);
        update org_metrics
        set performance_index = nullif(v_index ->> 'index', '')::numeric
        where org_metrics.employee_id = r.employee_id;
      exception
        when others then
          null;
      end;
    end loop;
  end if;

  return query
  select
    s.employee_id,
    s.employee_name,
    s.department_id,
    s.department_name,
    m.performance_index,
    m.attendance_percent,
    m.dwr_compliance,
    m.task_completion
  from org_scope s
  join org_metrics m on m.employee_id = s.employee_id
  order by s.department_name, s.employee_name;
end;
$$;

revoke all on function public.org_employee_metrics(text) from public, anon;
grant execute on function public.org_employee_metrics(text) to authenticated, service_role;

-- ------------------------------------------------------------
-- 6. Work-report rollup for the General Manager overview
--    SECURITY INVOKER: RLS on daily_work_reports/employees decides which rows
--    count, so each caller only aggregates what they could already read.
-- ------------------------------------------------------------

create or replace function public.org_work_report_rollup(p_from date, p_to date)
returns table (
  employee_id uuid,
  employee_name text,
  employee_code text,
  department_name text,
  submitted_count integer,
  late_count integer,
  missed_count integer,
  draft_count integer,
  approved_count integer,
  needs_revision_count integer,
  pending_review_count integer,
  avg_lead_rating numeric,
  total_hours numeric,
  last_report_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.id,
    nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), ''),
    e.employee_code,
    d.name,
    count(r.id) filter (where r.status = 'submitted')::integer,
    count(r.id) filter (where r.status = 'late')::integer,
    count(r.id) filter (where r.status = 'missed')::integer,
    count(r.id) filter (where r.status = 'draft')::integer,
    count(r.id) filter (where r.review_status = 'approved')::integer,
    count(r.id) filter (where r.review_status = 'needs-revision')::integer,
    count(r.id) filter (
      where r.review_status = 'pending' and r.status in ('submitted', 'late')
    )::integer,
    round(avg(r.lead_rating)::numeric, 2),
    coalesce(sum(r.total_hours) filter (where r.status in ('submitted', 'late')), 0),
    max(r.report_date) filter (where r.status in ('submitted', 'late'))
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.daily_work_reports r
    on r.employee_id = e.id
   and r.report_date between p_from and p_to
  where e.organization_id = public.current_org_id()
    and lower(coalesce(e.employment_status, 'active')) in (
      'active', 'probation', 'notice', 'on-leave'
    )
    and public.can_view_employee(e.id)
    and p_from is not null
    and p_to is not null
    and p_to >= p_from
    and p_to - p_from <= 366
  group by e.id, e.first_name, e.last_name, e.employee_code, d.name
  order by 2 nulls last;
$$;

revoke all on function public.org_work_report_rollup(date, date) from public, anon;
grant execute on function public.org_work_report_rollup(date, date) to authenticated, service_role;

-- ------------------------------------------------------------
-- 7. Role assignment: Super Admin only for General Manager
-- ------------------------------------------------------------

create or replace function public.set_employee_role(p_employee_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_org uuid;
  v_old text;
  v_admin_count integer;
  v_caller text;
begin
  v_caller := public.current_user_role();

  if auth.uid() is null or v_caller not in ('admin', 'hr') then
    raise exception 'Only a super admin or HR can change roles.';
  end if;

  if p_role not in ('admin', 'general_manager', 'hr', 'dept_head', 'team_lead', 'employee') then
    raise exception 'Invalid role.';
  end if;

  if v_caller = 'hr' and p_role = 'admin' then
    raise exception 'Only a super admin can assign the super admin role.';
  end if;

  if v_caller = 'hr' and p_role = 'general_manager' then
    raise exception 'Only a super admin can assign the general manager role.';
  end if;

  select p.id, e.organization_id, p.role
    into v_profile_id, v_org, v_old
  from public.employees e
  join public.profiles p on p.id = e.profile_id
  where e.id = p_employee_id
  limit 1
  for update of p;

  if v_profile_id is null then
    select p.id, e.organization_id, p.role
      into v_profile_id, v_org, v_old
    from public.employees e
    join public.profiles p on p.employee_id = e.id
    where e.id = p_employee_id
    limit 1
    for update of p;
  end if;

  if v_profile_id is null then
    raise exception 'Employee profile not found.';
  end if;

  if v_org is distinct from public.current_org_id() then
    raise exception 'Employee is outside your organization.';
  end if;

  if v_caller = 'hr' and v_old = 'admin' then
    raise exception 'HR cannot change a super admin role.';
  end if;

  if v_caller = 'hr' and v_old = 'general_manager' then
    raise exception 'HR cannot change a general manager role.';
  end if;

  if v_old is not distinct from p_role then
    return;
  end if;

  if v_profile_id = auth.uid() and v_old = 'admin' and p_role <> 'admin' then
    raise exception 'You cannot remove your own super admin role.';
  end if;

  if v_old = 'admin' and p_role <> 'admin' then
    select count(distinct p.id) into v_admin_count
    from public.profiles p
    join public.employees e on e.profile_id = p.id or e.id = p.employee_id
    where p.role = 'admin'
      and e.organization_id = v_org;

    if v_admin_count <= 1 then
      raise exception 'Cannot demote the last super admin.';
    end if;
  end if;

  perform set_config('app.allow_role_update', 'on', true);

  update public.profiles
  set role = p_role,
      updated_at = now()
  where id = v_profile_id;

  if to_regprocedure('public.log_employee_assignment(uuid, text)') is not null then
    perform public.log_employee_assignment(p_employee_id, 'role');
  end if;
  perform public.log_audit_event(
    'set_employee_role',
    'profiles',
    v_profile_id,
    jsonb_build_object('role', v_old),
    jsonb_build_object('role', p_role, 'employee_id', p_employee_id)
  );
end;
$$;

revoke all on function public.set_employee_role(uuid, text) from public, anon;
grant execute on function public.set_employee_role(uuid, text) to authenticated, service_role;

create or replace function public.approve_employee_onboarding(
  p_employee_id uuid,
  p_department_id uuid,
  p_designation_id uuid,
  p_role text,
  p_manager_id uuid,
  p_shift_id uuid,
  p_joining_date date,
  p_employee_code text,
  p_override_joining_date_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_code text;
  v_next_status text;
  v_profile uuid;
  i integer;
begin
  if auth.uid() is null or not public.is_admin_or_hr() then
    raise exception 'Only HR or a super admin can approve onboarding.';
  end if;

  select organization_id, employment_status, profile_id
    into v_org, v_status, v_profile
  from public.employees
  where id = p_employee_id
  for update;

  if v_org is null then
    raise exception 'Employee was not found.';
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'Employee is outside your organization.';
  end if;
  if v_status not in ('pending_approval', 'profile_changes_requested') then
    raise exception 'This employee is not waiting for approval.';
  end if;
  if p_department_id is null or p_designation_id is null or p_joining_date is null then
    raise exception 'Department, designation and joining date are required.';
  end if;
  if p_role is null or p_role not in ('admin', 'general_manager', 'hr', 'dept_head', 'team_lead', 'employee') then
    raise exception 'Choose a valid role.';
  end if;
  if not exists (
    select 1 from public.departments d
    where d.id = p_department_id and d.organization_id = v_org
  ) then
    raise exception 'Department is not in this organization.';
  end if;
  if not exists (
    select 1 from public.designations d
    where d.id = p_designation_id and d.organization_id = v_org
  ) then
    raise exception 'Designation is not in this organization.';
  end if;
  if p_manager_id is not null then
    if p_manager_id = p_employee_id then
      raise exception 'An employee cannot report to themselves.';
    end if;
    if not exists (
      select 1 from public.employees m
      where m.id = p_manager_id and m.organization_id = v_org
    ) then
      raise exception 'Reporting lead is not in this organization.';
    end if;
  end if;
  if p_shift_id is not null and not exists (
    select 1 from public.shifts s
    where s.id = p_shift_id and s.organization_id = v_org
  ) then
    raise exception 'Shift is not in this organization.';
  end if;
  if p_joining_date < v_today and nullif(btrim(coalesce(p_override_joining_date_reason, '')), '') is null then
    raise exception 'Joining date is in the past. Provide a reason to override it.';
  end if;

  v_code := nullif(upper(btrim(coalesce(p_employee_code, ''))), '');
  if v_code is null then
    for i in 1..30 loop
      v_code := 'EMP-' || lpad(nextval('public.employee_code_seq')::text, 5, '0');
      exit when not exists (
        select 1 from public.employees e
        where e.organization_id = v_org and e.employee_code = v_code and e.id <> p_employee_id
      );
    end loop;
  elsif exists (
    select 1 from public.employees e
    where e.organization_id = v_org and e.employee_code = v_code and e.id <> p_employee_id
  ) then
    raise exception 'That employee code is already in use.';
  end if;

  v_next_status := case when p_joining_date > v_today then 'probation' else 'active' end;

  perform set_config('app.allow_onboarding_write', 'on', true);

  update public.employees
  set department_id = p_department_id,
      designation_id = p_designation_id,
      manager_id = p_manager_id,
      shift_id = p_shift_id,
      joining_date = p_joining_date,
      employee_code = v_code,
      employment_status = v_next_status,
      profile_completed_at = now()
  where id = p_employee_id;

  perform public.set_employee_role(p_employee_id, p_role);

  update public.onboarding_submissions
  set status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      remarks = nullif(btrim(coalesce(p_override_joining_date_reason, '')), ''),
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'at', now(),
          'action', 'approved',
          'by', auth.uid(),
          'role', p_role,
          'employee_code', v_code,
          'joining_date', p_joining_date,
          'override_reason', nullif(btrim(coalesce(p_override_joining_date_reason, '')), '')
        )
      )
  where employee_id = p_employee_id;

  if p_shift_id is not null then
    begin
      insert into public.employee_shifts (employee_id, shift_id, effective_from)
      select p_employee_id, p_shift_id, p_joining_date
      where not exists (
        select 1 from public.employee_shifts es
        where es.employee_id = p_employee_id
          and es.shift_id = p_shift_id
          and es.effective_from = p_joining_date
      );
    exception when others then
      null;
    end;
  end if;

  begin
    if not exists (
      select 1 from public.onboarding_records r where r.employee_id = p_employee_id
    ) then
      insert into public.onboarding_records (employee_id, assigned_hr, joining_date, status)
      values (p_employee_id, auth.uid(), p_joining_date, 'in-progress');
    end if;
  exception when others then
    null;
  end;

  if v_profile is not null then
    insert into public.notifications (user_id, title, message, type, reference_type, reference_id, is_read)
    values (
      v_profile,
      'Profile approved',
      'HR approved your profile. You can use JeeVijay HRMS now.',
      'onboarding',
      'employees',
      p_employee_id,
      false
    );
  end if;

  perform public.log_audit_event(
    'approve_employee_onboarding',
    'employees',
    p_employee_id,
    jsonb_build_object('employment_status', v_status),
    jsonb_build_object(
      'employment_status', v_next_status,
      'department_id', p_department_id,
      'designation_id', p_designation_id,
      'role', p_role,
      'manager_id', p_manager_id,
      'shift_id', p_shift_id,
      'joining_date', p_joining_date,
      'employee_code', v_code
    )
  );
end;
$$;

revoke all on function public.approve_employee_onboarding(uuid, uuid, uuid, text, uuid, uuid, date, text, text) from public, anon;
grant execute on function public.approve_employee_onboarding(uuid, uuid, uuid, text, uuid, uuid, date, text, text) to authenticated, service_role;
