-- Stream D: KRA templates, KPI definitions, assignments, scores, and the
-- performance index.
--
-- Sibling migration 20260926000003 owns the holidays calendar. This file
-- creates public.holidays only when it is missing, with organization_id,
-- holiday_date, and name, and never drops columns.
-- Sibling migration 20260926000004 owns daily_work_reports and tasks.
-- compute_kpi_scores uses those tables only when they exist (to_regclass)
-- and skips them on a dynamic-SQL error so attendance scoring still lands.

-- ------------------------------------------------------------
-- Holidays fallback (no-op when Stream B already created the table)
-- ------------------------------------------------------------

do $$
begin
  if to_regclass('public.holidays') is null then
    create table public.holidays (
      organization_id uuid,
      holiday_date date,
      name text
    );
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'holidays'
      and column_name = 'organization_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'holidays'
      and column_name = 'holiday_date'
  ) then
    execute 'create index if not exists holidays_org_date_idx on public.holidays (organization_id, holiday_date)';
  end if;
end $$;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

create table if not exists public.kra_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  designation_id uuid references public.designations(id) on delete cascade,
  name text not null,
  weightage numeric(6, 2) not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kra_templates_weightage_check check (weightage > 0 and weightage <= 100),
  constraint kra_templates_name_check check (char_length(btrim(name)) > 0)
);

create unique index if not exists kra_templates_set_name_uidx
  on public.kra_templates (
    organization_id,
    coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(designation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

create index if not exists kra_templates_org_set_idx
  on public.kra_templates (organization_id, department_id, designation_id);

create table if not exists public.kpi_definitions (
  id uuid primary key default gen_random_uuid(),
  kra_template_id uuid not null references public.kra_templates(id) on delete cascade,
  metric text not null,
  unit text,
  target numeric,
  direction text not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint kpi_definitions_metric_check check (char_length(btrim(metric)) > 0),
  constraint kpi_definitions_direction_check check (direction in ('higher', 'lower')),
  constraint kpi_definitions_source_check check (source in ('manual', 'attendance', 'dwr', 'tasks', 'lead_rating')),
  constraint kpi_definitions_target_check check (target is null or target >= 0)
);

create index if not exists kpi_definitions_template_idx
  on public.kpi_definitions (kra_template_id);

create table if not exists public.employee_kra_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  cycle text not null,
  template_ids uuid[] not null default '{}'::uuid[],
  overrides jsonb not null default '{}'::jsonb,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_kra_assignments_cycle_check check (cycle ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint employee_kra_assignments_employee_cycle_key unique (employee_id, cycle)
);

create index if not exists employee_kra_assignments_cycle_idx
  on public.employee_kra_assignments (cycle);

create table if not exists public.kpi_scores (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  kpi_definition_id uuid not null references public.kpi_definitions(id) on delete restrict,
  period text not null,
  actual numeric,
  score numeric,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kpi_scores_period_check check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint kpi_scores_score_range check (score is null or (score >= 0 and score <= 100)),
  constraint kpi_scores_employee_kpi_period_key unique (employee_id, kpi_definition_id, period)
);

create index if not exists kpi_scores_employee_period_idx
  on public.kpi_scores (employee_id, period);

comment on table public.kra_templates is
  'KRA rows for one designation/department set. Weights in a set must total 100, enforced by save_kra_template_set.';
comment on table public.kpi_scores is
  'Monthly KPI actuals. A missing manual score stays NULL and is never stored as 0.';

-- ------------------------------------------------------------
-- Scoring helpers
-- ------------------------------------------------------------

create or replace function public.performance_band(score numeric)
returns text
language sql
immutable
as $$
  select case
    when score is null then 'Not rated'
    when score >= 90 then 'Outstanding'
    when score >= 75 then 'Exceeds'
    when score >= 60 then 'Meets'
    else 'Needs Improvement'
  end;
$$;

comment on function public.performance_band(numeric) is
  'Outstanding >= 90, Exceeds >= 75, Meets >= 60, Needs Improvement below 60, Not rated when null.';

create or replace function public.kra_score_value(p_actual numeric, p_target numeric, p_direction text)
returns numeric
language plpgsql
immutable
as $$
declare
  v numeric;
begin
  if p_actual is null then
    return null;
  end if;

  if p_direction = 'lower' then
    if p_actual = 0 then
      return 100;
    end if;
    if p_target is null or p_target <= 0 then
      return 0;
    end if;
    v := (p_target / p_actual) * 100;
  else
    if p_target is null or p_target = 0 then
      v := p_actual;
    else
      v := (p_actual / p_target) * 100;
    end if;
  end if;

  if v < 0 then
    v := 0;
  elsif v > 100 then
    v := 100;
  end if;
  return round(v, 2);
end;
$$;

create or replace function public.kra_auto_metric_kind(p_source text, p_metric text)
returns text
language sql
immutable
as $$
  select case
    when p_source = 'manual' then null
    when p_source = 'lead_rating' then 'lead_rating'
    when p_source = 'tasks' then 'task_ontime'
    when p_source = 'dwr' and coalesce(p_metric, '') ~* 'on[- ]?time' then 'dwr_ontime'
    when p_source = 'dwr' then 'dwr_submission'
    when p_source = 'attendance' and coalesce(p_metric, '') ~* 'punctual' then 'punctuality'
    when p_source = 'attendance' then 'attendance_pct'
    else null
  end;
$$;

create or replace function public.kra_assert_period(p_period text)
returns text
language plpgsql
immutable
as $$
begin
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Period must be YYYY-MM.';
  end if;
  return p_period;
end;
$$;

-- Templates that apply to an employee for a cycle: the explicit assignment,
-- otherwise the most specific designation/department set in the organization.
create or replace function public.kra_resolved_templates(p_employee_id uuid, p_period text)
returns table (
  template_id uuid,
  template_name text,
  weightage numeric,
  overrides jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_employee_id is null or not public.can_view_employee(p_employee_id) then
    return;
  end if;

  perform public.kra_assert_period(p_period);

  if exists (
    select 1
    from public.employee_kra_assignments a
    where a.employee_id = p_employee_id
      and a.cycle = p_period
      and cardinality(a.template_ids) > 0
  ) then
    return query
    select t.id, t.name, t.weightage, a.overrides
    from public.employee_kra_assignments a
    join public.kra_templates t on t.id = any (a.template_ids)
    where a.employee_id = p_employee_id
      and a.cycle = p_period;
    return;
  end if;

  return query
  with emp as (
    select e.department_id, e.designation_id, e.organization_id
    from public.employees e
    where e.id = p_employee_id
  ),
  ranked as (
    select
      t.id,
      t.name,
      t.weightage,
      case
        when t.department_id is not distinct from emp.department_id
         and t.designation_id is not distinct from emp.designation_id
         and (t.department_id is not null or t.designation_id is not null)
          then 1
        when t.department_id is null
         and emp.designation_id is not null
         and t.designation_id is not distinct from emp.designation_id
          then 2
        when t.designation_id is null
         and emp.department_id is not null
         and t.department_id is not distinct from emp.department_id
          then 3
        when t.department_id is null and t.designation_id is null
          then 4
        else null
      end as set_rank
    from public.kra_templates t
    cross join emp
    where t.organization_id = emp.organization_id
  )
  select ranked.id, ranked.name, ranked.weightage, '{}'::jsonb
  from ranked
  where ranked.set_rank = (select min(r.set_rank) from ranked r where r.set_rank is not null);
end;
$$;

-- ------------------------------------------------------------
-- Template set, targets, assignment, manual actuals
-- ------------------------------------------------------------

create or replace function public.save_kra_template_set(definitions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_department uuid;
  v_designation uuid;
  v_templates jsonb;
  v_total numeric := 0;
  v_tpl record;
  v_kpi record;
  v_template_id uuid;
  v_name text;
  v_weight numeric;
  v_metric text;
  v_kept_templates uuid[] := '{}'::uuid[];
  v_kept_kpis uuid[] := '{}'::uuid[];
  v_kpi_id uuid;
  v_direction text;
  v_source text;
begin
  if auth.uid() is null or public.current_user_role() not in ('admin', 'hr') then
    raise exception 'Only Super Admin or HR can save KRA templates.';
  end if;
  if v_org is null then
    raise exception 'Your profile is not linked to an organization.';
  end if;
  if definitions is null or jsonb_typeof(definitions) <> 'object' then
    raise exception 'Template set payload is required.';
  end if;

  v_department := nullif(definitions ->> 'department_id', '')::uuid;
  v_designation := nullif(definitions ->> 'designation_id', '')::uuid;
  v_templates := definitions -> 'templates';

  if v_templates is null or jsonb_typeof(v_templates) <> 'array' or jsonb_array_length(v_templates) = 0 then
    raise exception 'Add at least one KRA. Weights must total 100.';
  end if;

  if v_department is not null and not exists (
    select 1 from public.departments d
    where d.id = v_department and d.organization_id = v_org
  ) then
    raise exception 'Department is outside your organization.';
  end if;

  if v_designation is not null and not exists (
    select 1 from public.designations d
    where d.id = v_designation and d.organization_id = v_org
  ) then
    raise exception 'Designation is outside your organization.';
  end if;

  select coalesce(sum(round((item ->> 'weightage')::numeric, 2)), 0)
    into v_total
  from jsonb_array_elements(v_templates) item;

  if v_total <> 100 then
    raise exception 'KRA weights must total 100 (current total: %).', v_total;
  end if;

  for v_tpl in
    select tpl.item
    from jsonb_array_elements(v_templates) as tpl(item)
  loop
    v_name := btrim(v_tpl.item ->> 'name');
    v_weight := round((v_tpl.item ->> 'weightage')::numeric, 2);
    if v_name is null or v_name = '' then
      raise exception 'Every KRA needs a name.';
    end if;
    if v_weight is null or v_weight <= 0 or v_weight > 100 then
      raise exception 'Each KRA weight must be greater than 0 and at most 100.';
    end if;
    if v_tpl.item -> 'kpis' is null
      or jsonb_typeof(v_tpl.item -> 'kpis') <> 'array'
      or jsonb_array_length(v_tpl.item -> 'kpis') = 0
    then
      raise exception 'KRA "%" needs at least one KPI.', v_name;
    end if;

    for v_kpi in
      select kpi.item
      from jsonb_array_elements(v_tpl.item -> 'kpis') as kpi(item)
    loop
      v_metric := btrim(v_kpi.item ->> 'metric');
      v_direction := lower(btrim(coalesce(v_kpi.item ->> 'direction', '')));
      v_source := lower(btrim(coalesce(v_kpi.item ->> 'source', '')));
      if v_metric is null or v_metric = '' then
        raise exception 'Every KPI needs a metric name.';
      end if;
      if v_direction not in ('higher', 'lower') then
        raise exception 'KPI direction must be higher or lower.';
      end if;
      if v_source not in ('manual', 'attendance', 'dwr', 'tasks', 'lead_rating') then
        raise exception 'KPI source must be manual, attendance, dwr, tasks, or lead_rating.';
      end if;
      if (v_kpi.item ->> 'target') is not null
        and (v_kpi.item ->> 'target') <> ''
        and (v_kpi.item ->> 'target')::numeric < 0
      then
        raise exception 'KPI target cannot be negative.';
      end if;
    end loop;

    v_template_id := nullif(v_tpl.item ->> 'id', '')::uuid;
    if v_template_id is not null and not exists (
      select 1
      from public.kra_templates t
      where t.id = v_template_id
        and t.organization_id = v_org
        and t.department_id is not distinct from v_department
        and t.designation_id is not distinct from v_designation
    ) then
      raise exception 'KRA "%" is not part of this template set.', v_name;
    end if;

    if v_template_id is null then
      insert into public.kra_templates (
        organization_id, department_id, designation_id, name, weightage, created_by
      )
      values (v_org, v_department, v_designation, v_name, v_weight, auth.uid())
      returning id into v_template_id;
    else
      update public.kra_templates
      set name = v_name,
          weightage = v_weight,
          updated_at = now()
      where id = v_template_id;
    end if;

    v_kept_templates := array_append(v_kept_templates, v_template_id);

    for v_kpi in
      select kpi.item
      from jsonb_array_elements(v_tpl.item -> 'kpis') as kpi(item)
    loop
      v_kpi_id := nullif(v_kpi.item ->> 'id', '')::uuid;
      v_metric := btrim(v_kpi.item ->> 'metric');
      v_direction := lower(btrim(v_kpi.item ->> 'direction'));
      v_source := lower(btrim(v_kpi.item ->> 'source'));

      if v_kpi_id is not null and not exists (
        select 1
        from public.kpi_definitions kd
        where kd.id = v_kpi_id
          and kd.kra_template_id = v_template_id
      ) then
        raise exception 'KPI "%" does not belong to this KRA.', v_metric;
      end if;

      if v_kpi_id is null then
        insert into public.kpi_definitions (kra_template_id, metric, unit, target, direction, source)
        values (
          v_template_id,
          v_metric,
          nullif(btrim(coalesce(v_kpi.item ->> 'unit', '')), ''),
          nullif(v_kpi.item ->> 'target', '')::numeric,
          v_direction,
          v_source
        )
        returning id into v_kpi_id;
      else
        update public.kpi_definitions
        set metric = v_metric,
            unit = nullif(btrim(coalesce(v_kpi.item ->> 'unit', '')), ''),
            target = nullif(v_kpi.item ->> 'target', '')::numeric,
            direction = v_direction,
            source = v_source
        where id = v_kpi_id;
      end if;
      v_kept_kpis := array_append(v_kept_kpis, v_kpi_id);
    end loop;
  end loop;

  begin
    delete from public.kpi_definitions kd
    where kd.kra_template_id = any (v_kept_templates)
      and not (kd.id = any (v_kept_kpis));

    delete from public.kra_templates t
    where t.organization_id = v_org
      and t.department_id is not distinct from v_department
      and t.designation_id is not distinct from v_designation
      and not (t.id = any (v_kept_templates));
  exception
    when foreign_key_violation then
      raise exception 'This KRA set already has scores. Keep those KPIs, or remove the scores before deleting them.';
  end;

  return jsonb_build_object(
    'department_id', v_department,
    'designation_id', v_designation,
    'template_ids', to_jsonb(v_kept_templates)
  );
end;
$$;

create or replace function public.adjust_department_kpi_targets(department_id uuid, updates jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_item jsonb;
  v_kpi uuid;
  v_target numeric;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in to adjust KPI targets.';
  end if;
  if v_org is null or department_id is null then
    raise exception 'A department is required.';
  end if;
  if updates is null or jsonb_typeof(updates) <> 'array' or jsonb_array_length(updates) = 0 then
    raise exception 'Provide at least one target update.';
  end if;

  if public.current_user_role() in ('admin', 'hr') then
    if not exists (
      select 1 from public.departments d
      where d.id = department_id and d.organization_id = v_org
    ) then
      raise exception 'Department is outside your organization.';
    end if;
  elsif public.is_dept_head() then
    if not exists (
      select 1
      from public.departments d
      where d.id = department_id
        and d.organization_id = v_org
        and d.manager_id = public.current_employee_id()
    ) then
      raise exception 'Department heads can adjust targets only for departments they lead.';
    end if;
  else
    raise exception 'Only a department head can adjust targets for their department.';
  end if;

  for v_item in
    select value from jsonb_array_elements(updates)
  loop
    v_kpi := nullif(v_item ->> 'kpi_definition_id', '')::uuid;
    if v_kpi is null then
      raise exception 'Each update needs a KPI.';
    end if;
    if (v_item ->> 'target') is null or btrim(v_item ->> 'target') = '' then
      raise exception 'Each update needs a target.';
    end if;
    v_target := (v_item ->> 'target')::numeric;
    if v_target < 0 then
      raise exception 'KPI target cannot be negative.';
    end if;

    update public.kpi_definitions kd
    set target = v_target
    from public.kra_templates t
    where kd.id = v_kpi
      and t.id = kd.kra_template_id
      and t.organization_id = v_org
      and t.department_id = department_id;

    if not found then
      raise exception 'KPI % is not in this department template set.', v_kpi;
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.assign_employee_kras(
  employee_id uuid,
  cycle text,
  template_ids uuid[],
  overrides jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_weight numeric;
  v_found integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to assign KRAs.';
  end if;
  perform public.kra_assert_period(cycle);
  if employee_id is null or template_ids is null or cardinality(template_ids) = 0 then
    raise exception 'Choose an employee and at least one KRA.';
  end if;
  if overrides is null or jsonb_typeof(overrides) <> 'object' then
    raise exception 'Overrides must be an object.';
  end if;

  if not exists (
    select 1
    from public.employees e
    where e.id = employee_id
      and e.organization_id = v_org
  ) then
    raise exception 'Employee is outside your organization.';
  end if;

  if public.current_user_role() in ('admin', 'hr') then
    null;
  elsif public.is_dept_head() and public.can_manage_employee(employee_id) then
    null;
  else
    raise exception 'Only Super Admin, HR, or the department head can assign KRAs.';
  end if;

  select count(*), coalesce(sum(t.weightage), 0)
    into v_found, v_weight
  from public.kra_templates t
  where t.id = any (template_ids)
    and t.organization_id = v_org;

  if v_found <> cardinality(template_ids) then
    raise exception 'One or more KRAs are outside your organization.';
  end if;
  if v_weight <> 100 then
    raise exception 'Assigned KRA weights must total 100 (current total: %).', v_weight;
  end if;

  insert into public.employee_kra_assignments (employee_id, cycle, template_ids, overrides, assigned_by)
  values (employee_id, cycle, template_ids, overrides, auth.uid())
  on conflict (employee_id, cycle)
  do update set
    template_ids = excluded.template_ids,
    overrides = excluded.overrides,
    assigned_by = excluded.assigned_by,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.enter_manual_kpi_actual(
  employee_id uuid,
  kpi_definition_id uuid,
  period text,
  actual numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
  v_direction text;
  v_target numeric;
  v_override numeric;
  v_score numeric;
  v_period text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to enter a KPI actual.';
  end if;
  v_period := public.kra_assert_period(period);

  if public.current_user_role() not in ('admin', 'hr', 'dept_head', 'team_lead', 'manager')
    or not public.can_manage_employee(employee_id)
  then
    raise exception 'You can enter manual KPI actuals only for people you manage.';
  end if;

  select kd.source, kd.direction, kd.target
    into v_source, v_direction, v_target
  from public.kpi_definitions kd
  join public.kra_templates t on t.id = kd.kra_template_id
  join public.employees e on e.id = employee_id
  where kd.id = kpi_definition_id
    and t.organization_id = e.organization_id;

  if v_source is null then
    raise exception 'KPI not found.';
  end if;
  if v_source <> 'manual' then
    raise exception 'This KPI is calculated automatically.';
  end if;

  -- No assignment row must not wipe the definition target (SELECT INTO sets NULL).
  select nullif(a.overrides -> enter_manual_kpi_actual.kpi_definition_id::text ->> 'target', '')::numeric
    into v_override
  from public.employee_kra_assignments a
  where a.employee_id = enter_manual_kpi_actual.employee_id
    and a.cycle = v_period;
  if found and v_override is not null then
    v_target := v_override;
  end if;

  -- A missing actual stays NULL. Never insert a row that stores 0 in its place.
  if actual is null then
    update public.kpi_scores
    set actual = null,
        score = null,
        entered_by = auth.uid(),
        updated_at = now()
    where kpi_scores.employee_id = enter_manual_kpi_actual.employee_id
      and kpi_scores.kpi_definition_id = enter_manual_kpi_actual.kpi_definition_id
      and kpi_scores.period = v_period;
    return null;
  end if;

  v_score := public.kra_score_value(actual, v_target, v_direction);

  insert into public.kpi_scores (employee_id, kpi_definition_id, period, actual, score, entered_by)
  values (employee_id, kpi_definition_id, v_period, actual, v_score, auth.uid())
  on conflict (employee_id, kpi_definition_id, period)
  do update set
    actual = excluded.actual,
    score = excluded.score,
    entered_by = excluded.entered_by,
    updated_at = now();

  return v_score;
end;
$$;

-- ------------------------------------------------------------
-- Performance index
-- ------------------------------------------------------------

create or replace function public.employee_performance_index(employee_id uuid, period text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period text;
  v_start date;
  v_end date;
  v_joining date;
  v_measured date;
  v_prorated boolean := false;
  v_weight numeric;
  v_index numeric;
  v_blocked boolean;
begin
  if employee_id is null or not public.can_view_employee(employee_id) then
    raise exception 'You cannot view this performance index.';
  end if;
  v_period := public.kra_assert_period(period);
  v_start := to_date(v_period || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month' - interval '1 day')::date;

  select e.joining_date
    into v_joining
  from public.employees e
  where e.id = employee_id;

  v_measured := greatest(v_start, coalesce(v_joining, v_start));
  v_prorated := v_joining is not null and v_joining > v_start and v_joining <= v_end;

  select coalesce(sum(t.weightage), 0)
    into v_weight
  from public.kra_resolved_templates(employee_id, v_period) t;

  if v_weight <> 100 then
    v_index := null;
  else
    select exists (
      select 1
      from public.kra_resolved_templates(employee_id, v_period) t
      left join public.kpi_definitions kd on kd.kra_template_id = t.template_id
      where kd.id is null
    )
    or exists (
      select 1
      from public.kra_resolved_templates(employee_id, v_period) t
      join public.kpi_definitions kd on kd.kra_template_id = t.template_id
      left join public.kpi_scores sc
        on sc.kpi_definition_id = kd.id
       and sc.employee_id = employee_performance_index.employee_id
       and sc.period = v_period
       and sc.score is not null
      group by t.template_id
      having count(kd.id) = 0 or count(sc.score) < count(kd.id)
    )
    or not exists (
      select 1 from public.kra_resolved_templates(employee_id, v_period)
    )
      into v_blocked;

    if v_blocked then
      v_index := null;
    else
      select round(sum(kra.kra_score * kra.weightage) / 100, 2)
        into v_index
      from (
        select
          t.weightage,
          avg(sc.score) as kra_score
        from public.kra_resolved_templates(employee_id, v_period) t
        join public.kpi_definitions kd on kd.kra_template_id = t.template_id
        join public.kpi_scores sc
          on sc.kpi_definition_id = kd.id
         and sc.employee_id = employee_performance_index.employee_id
         and sc.period = v_period
         and sc.score is not null
        group by t.template_id, t.weightage
      ) kra;
    end if;
  end if;

  return jsonb_build_object(
    'index', v_index,
    'band', public.performance_band(v_index),
    'prorated', v_prorated,
    'measured_from', v_measured
  );
end;
$$;

create or replace function public.list_performance_indexes(period text)
returns table (
  employee_id uuid,
  performance_index numeric,
  band text,
  prorated boolean,
  measured_from date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period text;
  v_emp record;
  v_index jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view performance indexes.';
  end if;
  v_period := public.kra_assert_period(period);

  for v_emp in
    select e.id
    from public.employees e
    where e.organization_id = public.current_org_id()
      and public.can_view_employee(e.id)
  loop
    v_index := public.employee_performance_index(v_emp.id, v_period);
    employee_id := v_emp.id;
    performance_index := nullif(v_index ->> 'index', '')::numeric;
    band := v_index ->> 'band';
    prorated := coalesce((v_index ->> 'prorated')::boolean, false);
    measured_from := nullif(v_index ->> 'measured_from', '')::date;
    return next;
  end loop;
end;
$$;

create or replace function public.performance_index_trend(
  employee_id uuid,
  through_period text,
  months integer default 6
)
returns table (
  period text,
  performance_index numeric,
  band text,
  prorated boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_through text;
  v_months integer;
  v_index jsonb;
  i integer;
begin
  if employee_id is null or not public.can_view_employee(employee_id) then
    raise exception 'You cannot view this performance index.';
  end if;
  v_through := public.kra_assert_period(through_period);
  v_months := least(greatest(coalesce(months, 6), 1), 12);

  for i in reverse (v_months - 1)..0 loop
    period := to_char((to_date(v_through || '-01', 'YYYY-MM-DD') - make_interval(months => i))::date, 'YYYY-MM');
    v_index := public.employee_performance_index(employee_id, period);
    performance_index := nullif(v_index ->> 'index', '')::numeric;
    band := v_index ->> 'band';
    prorated := coalesce((v_index ->> 'prorated')::boolean, false);
    return next;
  end loop;
end;
$$;

create or replace function public.kra_monthly_grid(period text)
returns table (
  employee_id uuid,
  employee_name text,
  kra_template_id uuid,
  kra_name text,
  weightage numeric,
  kpi_definition_id uuid,
  metric text,
  unit text,
  target numeric,
  direction text,
  source text,
  actual numeric,
  score numeric,
  prorated boolean,
  measured_from date,
  performance_index numeric,
  band text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view KRA scores.';
  end if;
  v_period := public.kra_assert_period(period);

  return query
  with visible as (
    select e.id, btrim(concat_ws(' ', e.first_name, e.last_name)) as employee_name
    from public.employees e
    where e.organization_id = public.current_org_id()
      and public.can_view_employee(e.id)
  ),
  idx as (
    select
      v.id,
      nullif(payload ->> 'index', '')::numeric as performance_index,
      payload ->> 'band' as band,
      coalesce((payload ->> 'prorated')::boolean, false) as prorated,
      nullif(payload ->> 'measured_from', '')::date as measured_from
    from visible v
    cross join lateral (
      select public.employee_performance_index(v.id, v_period) as payload
    ) scored
  )
  select
    v.id,
    v.employee_name,
    t.template_id,
    t.template_name,
    t.weightage,
    kd.id,
    kd.metric,
    kd.unit,
    coalesce(nullif(t.overrides -> kd.id::text ->> 'target', '')::numeric, kd.target),
    kd.direction,
    kd.source,
    sc.actual,
    sc.score,
    idx.prorated,
    idx.measured_from,
    idx.performance_index,
    idx.band
  from visible v
  join idx on idx.id = v.id
  cross join lateral public.kra_resolved_templates(v.id, v_period) t
  join public.kpi_definitions kd on kd.kra_template_id = t.template_id
  left join public.kpi_scores sc
    on sc.employee_id = v.id
   and sc.kpi_definition_id = kd.id
   and sc.period = v_period
  order by v.employee_name, t.template_name, kd.metric;
end;
$$;

-- ------------------------------------------------------------
-- Auto KPI scores
-- ------------------------------------------------------------

create or replace function public.compute_kpi_scores(period text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
begin
  if auth.uid() is null then
    raise exception 'Sign in to calculate KPI scores.';
  end if;
  if public.current_user_role() not in ('admin', 'hr', 'dept_head', 'team_lead', 'manager') then
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
    and public.can_view_employee(e.id)
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
      where h.holiday_date = gs.day::date
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

-- ------------------------------------------------------------
-- RLS: reads only. Writes go through the RPCs above.
-- ------------------------------------------------------------

alter table public.kra_templates enable row level security;
alter table public.kpi_definitions enable row level security;
alter table public.employee_kra_assignments enable row level security;
alter table public.kpi_scores enable row level security;

drop policy if exists kra_templates_select on public.kra_templates;
create policy kra_templates_select
  on public.kra_templates
  for select
  using (organization_id = public.current_org_id());

drop policy if exists kpi_definitions_select on public.kpi_definitions;
create policy kpi_definitions_select
  on public.kpi_definitions
  for select
  using (
    exists (
      select 1
      from public.kra_templates t
      where t.id = kpi_definitions.kra_template_id
        and t.organization_id = public.current_org_id()
    )
  );

drop policy if exists employee_kra_assignments_select on public.employee_kra_assignments;
create policy employee_kra_assignments_select
  on public.employee_kra_assignments
  for select
  using (public.can_view_employee(employee_id));

drop policy if exists kpi_scores_select on public.kpi_scores;
create policy kpi_scores_select
  on public.kpi_scores
  for select
  using (public.can_view_employee(employee_id));

grant select on public.kra_templates to authenticated;
grant select on public.kpi_definitions to authenticated;
grant select on public.employee_kra_assignments to authenticated;
grant select on public.kpi_scores to authenticated;

grant all on public.kra_templates to service_role;
grant all on public.kpi_definitions to service_role;
grant all on public.employee_kra_assignments to service_role;
grant all on public.kpi_scores to service_role;

revoke all on function public.kra_score_value(numeric, numeric, text) from public;
revoke all on function public.kra_auto_metric_kind(text, text) from public;
revoke all on function public.kra_assert_period(text) from public;
revoke all on function public.kra_resolved_templates(uuid, text) from public;
revoke all on function public.performance_band(numeric) from public;
revoke all on function public.save_kra_template_set(jsonb) from public;
revoke all on function public.adjust_department_kpi_targets(uuid, jsonb) from public;
revoke all on function public.assign_employee_kras(uuid, text, uuid[], jsonb) from public;
revoke all on function public.enter_manual_kpi_actual(uuid, uuid, text, numeric) from public;
revoke all on function public.compute_kpi_scores(text) from public;
revoke all on function public.employee_performance_index(uuid, text) from public;
revoke all on function public.list_performance_indexes(text) from public;
revoke all on function public.performance_index_trend(uuid, text, integer) from public;
revoke all on function public.kra_monthly_grid(text) from public;

grant execute on function public.kra_score_value(numeric, numeric, text) to postgres, service_role;
grant execute on function public.kra_auto_metric_kind(text, text) to postgres, service_role;
grant execute on function public.kra_assert_period(text) to postgres, service_role;
grant execute on function public.kra_resolved_templates(uuid, text) to postgres, service_role;

grant execute on function public.performance_band(numeric) to postgres, authenticated, service_role;
grant execute on function public.save_kra_template_set(jsonb) to postgres, authenticated, service_role;
grant execute on function public.adjust_department_kpi_targets(uuid, jsonb) to postgres, authenticated, service_role;
grant execute on function public.assign_employee_kras(uuid, text, uuid[], jsonb) to postgres, authenticated, service_role;
grant execute on function public.enter_manual_kpi_actual(uuid, uuid, text, numeric) to postgres, authenticated, service_role;
grant execute on function public.compute_kpi_scores(text) to postgres, authenticated, service_role;
grant execute on function public.employee_performance_index(uuid, text) to postgres, authenticated, service_role;
grant execute on function public.list_performance_indexes(text) to postgres, authenticated, service_role;
grant execute on function public.performance_index_trend(uuid, text, integer) to postgres, authenticated, service_role;
grant execute on function public.kra_monthly_grid(text) to postgres, authenticated, service_role;
