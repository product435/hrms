-- set_employee_role already writes audit_logs (old role / new role) through log_audit_event.
-- This migration does not replace that function or its guards.
-- It audits department, reporting-lead, and department-head changes the same way,
-- blocks circular reporting lines, and exposes org performance for the viewer's scope.

-- ------------------------------------------------------------
-- Circular reporting
-- ------------------------------------------------------------

create or replace function public.assert_reporting_acyclic(p_employee_id uuid, p_manager_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current uuid := p_manager_id;
  v_next uuid;
  v_guard integer := 0;
begin
  if p_manager_id is null then
    return;
  end if;
  if p_employee_id is null then
    raise exception 'Employee was not found.';
  end if;
  if p_manager_id = p_employee_id then
    raise exception 'An employee cannot report to themselves.';
  end if;

  while v_current is not null loop
    if v_current = p_employee_id then
      raise exception 'This reporting line would create a circular chain.';
    end if;
    v_guard := v_guard + 1;
    if v_guard > 64 then
      raise exception 'This reporting line would create a circular chain.';
    end if;

    select e.manager_id into v_next
    from public.employees e
    where e.id = v_current;

    exit when not found;
    v_current := v_next;
  end loop;
end;
$$;

create or replace function public.employees_block_reporting_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.manager_id is not distinct from old.manager_id then
    return new;
  end if;
  perform public.assert_reporting_acyclic(new.id, new.manager_id);
  return new;
end;
$$;

drop trigger if exists employees_block_reporting_cycle on public.employees;
create trigger employees_block_reporting_cycle
  before insert or update of manager_id on public.employees
  for each row
  execute function public.employees_block_reporting_cycle();

-- ------------------------------------------------------------
-- Assignment changes (department and reporting lead)
-- ------------------------------------------------------------

create or replace function public.set_employee_placement(
  p_employee_id uuid,
  p_department_id uuid,
  p_manager_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_old_department uuid;
  v_old_manager uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only a super admin can change assignments.';
  end if;

  select e.organization_id, e.department_id, e.manager_id
    into v_org, v_old_department, v_old_manager
  from public.employees e
  where e.id = p_employee_id
  for update;

  if v_org is null then
    raise exception 'Employee was not found.';
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'Employee is outside your organization.';
  end if;

  if p_department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = p_department_id and d.organization_id = v_org
  ) then
    raise exception 'Department is not in this organization.';
  end if;

  if p_manager_id is not null and not exists (
    select 1 from public.employees m
    where m.id = p_manager_id and m.organization_id = v_org
  ) then
    raise exception 'Reporting lead is not in this organization.';
  end if;

  if p_manager_id is distinct from v_old_manager then
    perform public.assert_reporting_acyclic(p_employee_id, p_manager_id);
  end if;

  if v_old_department is not distinct from p_department_id
     and v_old_manager is not distinct from p_manager_id then
    return;
  end if;

  update public.employees
  set department_id = p_department_id,
      manager_id = p_manager_id,
      updated_at = now()
  where id = p_employee_id;

  perform public.log_audit_event(
    'set_employee_placement',
    'employees',
    p_employee_id,
    jsonb_build_object('department_id', v_old_department, 'manager_id', v_old_manager),
    jsonb_build_object('department_id', p_department_id, 'manager_id', p_manager_id)
  );
end;
$$;

create or replace function public.set_department_head(
  p_department_id uuid,
  p_manager_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_old uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only a super admin can assign a department head.';
  end if;

  select d.organization_id, d.manager_id
    into v_org, v_old
  from public.departments d
  where d.id = p_department_id
  for update;

  if v_org is null then
    raise exception 'Department was not found.';
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'Department is outside your organization.';
  end if;

  if p_manager_id is not null and not exists (
    select 1 from public.employees e
    where e.id = p_manager_id and e.organization_id = v_org
  ) then
    raise exception 'Department head is not in this organization.';
  end if;

  if v_old is not distinct from p_manager_id then
    return;
  end if;

  update public.departments
  set manager_id = p_manager_id
  where id = p_department_id;

  perform public.log_audit_event(
    'set_department_head',
    'departments',
    p_department_id,
    jsonb_build_object('manager_id', v_old),
    jsonb_build_object('manager_id', p_manager_id)
  );
end;
$$;

-- ------------------------------------------------------------
-- Org performance, scoped by can_view_employee
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
  if public.current_user_role() not in ('admin', 'hr', 'dept_head', 'team_lead', 'manager') then
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

create or replace function public.org_department_comparison(period text)
returns table (
  department_id uuid,
  department_name text,
  headcount integer,
  performance_index numeric,
  attendance_percent numeric,
  dwr_compliance numeric,
  task_completion numeric
)
language sql
volatile
security definer
set search_path = public
as $$
  select
    m.department_id,
    m.department_name,
    count(*)::integer,
    round(avg(m.performance_index), 2),
    round(avg(m.attendance_percent), 2),
    round(avg(m.dwr_compliance), 2),
    round(avg(m.task_completion), 2)
  from public.org_employee_metrics(period) m
  group by m.department_id, m.department_name
  order by m.department_name;
$$;

create or replace function public.org_performance_outliers(period text, p_limit integer default 5)
returns table (
  edge text,
  employee_id uuid,
  employee_name text,
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
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
begin
  drop table if exists org_outlier_rows;
  create temp table org_outlier_rows on commit drop as
  select * from public.org_employee_metrics(period);

  return query
  select ranked.edge, ranked.employee_id, ranked.employee_name, ranked.department_name,
         ranked.performance_index, ranked.attendance_percent, ranked.dwr_compliance, ranked.task_completion
  from (
    (
      select
        'top'::text as edge,
        m.employee_id,
        m.employee_name,
        m.department_name,
        m.performance_index,
        m.attendance_percent,
        m.dwr_compliance,
        m.task_completion
      from org_outlier_rows m
      where m.performance_index is not null
      order by m.performance_index desc, m.employee_name
      limit v_limit
    )
    union all
    (
      select
        'bottom'::text,
        m.employee_id,
        m.employee_name,
        m.department_name,
        m.performance_index,
        m.attendance_percent,
        m.dwr_compliance,
        m.task_completion
      from org_outlier_rows m
      where m.performance_index is not null
      order by m.performance_index asc, m.employee_name
      limit v_limit
    )
  ) ranked;
end;
$$;

create or replace function public.org_performance_board(period text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_board jsonb;
begin
  drop table if exists org_board_rows;
  create temp table org_board_rows on commit drop as
  select * from public.org_employee_metrics(period);

  select jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(dept.row_data order by dept.department_name)
      from (
        select
          m.department_name,
          jsonb_build_object(
            'department_id', m.department_id,
            'department_name', m.department_name,
            'headcount', count(*)::integer,
            'performance_index', round(avg(m.performance_index), 2),
            'attendance_percent', round(avg(m.attendance_percent), 2),
            'dwr_compliance', round(avg(m.dwr_compliance), 2),
            'task_completion', round(avg(m.task_completion), 2)
          ) as row_data
        from org_board_rows m
        group by m.department_id, m.department_name
      ) dept
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'employee_id', m.employee_id,
          'employee_name', m.employee_name,
          'department_id', m.department_id,
          'department_name', m.department_name,
          'performance_index', m.performance_index,
          'attendance_percent', m.attendance_percent,
          'dwr_compliance', m.dwr_compliance,
          'task_completion', m.task_completion
        )
        order by m.department_name, m.employee_name
      )
      from org_board_rows m
    ), '[]'::jsonb),
    'top', coalesce((
      select jsonb_agg(top_row.row_data)
      from (
        select jsonb_build_object(
          'employee_id', m.employee_id,
          'employee_name', m.employee_name,
          'department_name', m.department_name,
          'performance_index', m.performance_index,
          'attendance_percent', m.attendance_percent,
          'dwr_compliance', m.dwr_compliance,
          'task_completion', m.task_completion
        ) as row_data
        from org_board_rows m
        where m.performance_index is not null
        order by m.performance_index desc, m.employee_name
        limit 5
      ) top_row
    ), '[]'::jsonb),
    'bottom', coalesce((
      select jsonb_agg(bottom_row.row_data)
      from (
        select jsonb_build_object(
          'employee_id', m.employee_id,
          'employee_name', m.employee_name,
          'department_name', m.department_name,
          'performance_index', m.performance_index,
          'attendance_percent', m.attendance_percent,
          'dwr_compliance', m.dwr_compliance,
          'task_completion', m.task_completion
        ) as row_data
        from org_board_rows m
        where m.performance_index is not null
        order by m.performance_index asc, m.employee_name
        limit 5
      ) bottom_row
    ), '[]'::jsonb)
  )
  into v_board;

  return coalesce(v_board, '{}'::jsonb);
end;
$$;

revoke all on function public.assert_reporting_acyclic(uuid, uuid) from public, anon, authenticated;
revoke all on function public.employees_block_reporting_cycle() from public, anon, authenticated;

revoke all on function public.set_employee_placement(uuid, uuid, uuid) from public, anon;
revoke all on function public.set_department_head(uuid, uuid) from public, anon;
revoke all on function public.org_employee_metrics(text) from public, anon;
revoke all on function public.org_department_comparison(text) from public, anon;
revoke all on function public.org_performance_outliers(text, integer) from public, anon;
revoke all on function public.org_performance_board(text) from public, anon;

grant execute on function public.set_employee_placement(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.set_department_head(uuid, uuid) to authenticated, service_role;
grant execute on function public.org_employee_metrics(text) to authenticated, service_role;
grant execute on function public.org_department_comparison(text) to authenticated, service_role;
grant execute on function public.org_performance_outliers(text, integer) to authenticated, service_role;
grant execute on function public.org_performance_board(text) to authenticated, service_role;
