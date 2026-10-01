-- Phase 4: deterministic delivery metrics. No LLM involvement: the AI only narrates these numbers.
-- Based on tasks + daily_work_reports. Project info is read through tasks.project_id only.

create or replace function public.project_delivery_metrics(
  p_employee_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_org uuid;
  v_join date;
  v_exit date;
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_last_expected date;
  v_assigned int := 0;
  v_done int := 0;
  v_on_time int := 0;
  v_late int := 0;
  v_open_overdue int := 0;
  v_open_not_due int := 0;
  v_median_late numeric;
  v_no_due int := 0;
  v_by_project jsonb;
  v_expected int := 0;
  v_submitted int := 0;
  v_late_reports int := 0;
  v_missed int := 0;
  v_excused int := 0;
  v_reports_total int := 0;
  v_d date;
  v_report_status text;
  v_any_leave boolean;
  v_full_leave boolean;
begin
  if p_employee_id is null or p_from is null or p_to is null then
    raise exception 'Employee and period are required.';
  end if;
  if p_to < p_from then
    raise exception 'The period end is before its start.';
  end if;
  if p_to - p_from > 92 then
    raise exception 'The period cannot be longer than 93 days.';
  end if;

  if v_role <> 'service_role' and not public.can_view_employee(p_employee_id) then
    raise exception 'Not allowed to view this employee.';
  end if;

  select e.organization_id, e.joining_date, e.exit_date
    into v_org, v_join, v_exit
  from public.employees e
  where e.id = p_employee_id;
  if v_org is null then
    raise exception 'Employee not found.';
  end if;

  -- Cohort: tasks due inside the window. Completion is judged on the India calendar date.
  with cohort as (
    select t.id, t.project_id, t.status, t.due_date,
           (t.completed_at at time zone 'Asia/Kolkata')::date as done_on
    from public.tasks t
    where t.assigned_to = p_employee_id
      and t.due_date between p_from and p_to
  )
  select
    count(*),
    count(*) filter (where status = 'done'),
    count(*) filter (where status = 'done' and done_on <= due_date),
    count(*) filter (where status = 'done' and done_on > due_date),
    count(*) filter (where status <> 'done' and due_date < v_today),
    count(*) filter (where status <> 'done' and due_date >= v_today),
    (select percentile_cont(0.5) within group (order by (c2.done_on - c2.due_date))
       from cohort c2 where c2.status = 'done' and c2.done_on > c2.due_date)
  into v_assigned, v_done, v_on_time, v_late, v_open_overdue, v_open_not_due, v_median_late
  from cohort;

  select count(*) into v_no_due
  from public.tasks t
  where t.assigned_to = p_employee_id
    and t.due_date is null
    and t.created_at >= p_from::timestamptz
    and t.created_at < (p_to + 1)::timestamptz;

  select coalesce(jsonb_agg(row_to_json(x) order by x.assigned desc), '[]'::jsonb)
  into v_by_project
  from (
    select
      t.project_id,
      coalesce(p.name, 'No project') as project_name,
      count(*) as assigned,
      count(*) filter (where t.status = 'done'
        and (t.completed_at at time zone 'Asia/Kolkata')::date <= t.due_date) as on_time,
      count(*) filter (where t.status = 'done'
        and (t.completed_at at time zone 'Asia/Kolkata')::date > t.due_date) as late,
      count(*) filter (where t.status <> 'done' and t.due_date < v_today) as open_overdue
    from public.tasks t
    left join public.projects p on p.id = t.project_id
    where t.assigned_to = p_employee_id
      and t.due_date between p_from and p_to
    group by t.project_id, p.name
  ) x;

  -- DWR compliance: only fully elapsed days count; holidays, week-offs, full leave and
  -- days outside the employment span are excluded from the denominator.
  v_last_expected := least(p_to, v_today - 1);
  v_d := greatest(p_from, coalesce(v_join, p_from));
  while v_d <= v_last_expected loop
    if v_exit is not null and v_d > v_exit then
      exit;
    end if;
    if public.dwr_is_holiday(v_org, v_d) or public.dwr_is_week_off(p_employee_id, v_d) then
      v_excused := v_excused + 1;
    else
      select flags.any_leave, flags.full_leave into v_any_leave, v_full_leave
      from public.dwr_leave_flags(p_employee_id, v_d) as flags;
      if coalesce(v_full_leave, false) then
        v_excused := v_excused + 1;
      else
        v_expected := v_expected + 1;
        select r.status into v_report_status
        from public.daily_work_reports r
        where r.employee_id = p_employee_id and r.report_date = v_d;
        if v_report_status = 'submitted' then
          v_submitted := v_submitted + 1;
        elsif v_report_status = 'late' then
          v_late_reports := v_late_reports + 1;
        elsif v_report_status = 'missed' then
          v_missed := v_missed + 1;
        end if;
        v_report_status := null;
      end if;
    end if;
    v_d := v_d + 1;
  end loop;

  select count(*) into v_reports_total
  from public.daily_work_reports r
  where r.employee_id = p_employee_id
    and r.report_date between p_from and p_to
    and r.status in ('submitted', 'late');

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'period_start', p_from,
    'period_end', p_to,
    'tasks', jsonb_build_object(
      'due_in_period', v_assigned,
      'completed', v_done,
      'completed_on_time', v_on_time,
      'completed_late', v_late,
      'open_past_due', v_open_overdue,
      'open_not_yet_due', v_open_not_due,
      'median_days_late', v_median_late,
      'on_time_rate', case when v_done > 0 then round(v_on_time::numeric / v_done, 4) end,
      'completion_rate', case when v_assigned > 0 then round(v_done::numeric / v_assigned, 4) end,
      'created_without_due_date', v_no_due
    ),
    'by_project', v_by_project,
    'dwr', jsonb_build_object(
      'expected_days', v_expected,
      'excused_days', v_excused,
      'submitted_on_time', v_submitted,
      'submitted_late', v_late_reports,
      'missed', v_missed,
      'submission_rate', case when v_expected > 0
        then round(least(1, (v_submitted + v_late_reports)::numeric / v_expected), 4) end,
      'on_time_share', case when (v_submitted + v_late_reports) > 0
        then round(v_submitted::numeric / (v_submitted + v_late_reports), 4) end,
      'submitted_reports_in_period', v_reports_total
    )
  );
end;
$fn$;

revoke all on function public.project_delivery_metrics(uuid, date, date) from public, anon;
grant execute on function public.project_delivery_metrics(uuid, date, date) to authenticated, service_role;
