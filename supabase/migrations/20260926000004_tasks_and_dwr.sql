-- Stream C: tasks, daily work reports, and team conclusions.
-- Window rules live in these RPCs (the UI cannot submit early or after 10:00 IST).
-- Holidays are optional: migration 20260926000003 may create public.holidays later.
-- pg_cron is optional. Missing extension does not fail this migration.

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  assigned_by uuid references public.employees(id) on delete set null,
  assigned_to uuid not null references public.employees(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  due_date date,
  estimated_hours numeric(6, 2) check (estimated_hours is null or estimated_hours >= 0),
  status text not null default 'todo' check (status in ('todo', 'in-progress', 'blocked', 'done')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid references public.employees(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_work_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  report_date date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'late', 'missed')),
  submitted_at timestamptz,
  total_hours numeric(6, 2) not null default 0 check (total_hours >= 0),
  blockers text,
  plan_for_tomorrow text,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'needs-revision')),
  lead_rating smallint check (lead_rating is null or (lead_rating between 1 and 5)),
  lead_remarks text,
  reviewed_by uuid references public.employees(id) on delete set null,
  reviewed_at timestamptz,
  escalated boolean not null default false,
  reopen_reason text,
  waiver_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, report_date)
);

create table if not exists public.dwr_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.daily_work_reports(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  description text not null,
  hours numeric(5, 2) not null check (hours >= 0 and hours <= 24),
  item_status text not null default 'done' check (item_status in ('todo', 'in-progress', 'blocked', 'done')),
  created_at timestamptz not null default now()
);

create table if not exists public.team_daily_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_employee_id uuid not null references public.employees(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  report_date date not null,
  summary text not null,
  highlights text,
  risks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_employee_id, report_date)
);

create index if not exists idx_tasks_assigned_to_status on public.tasks (assigned_to, status);
create index if not exists idx_tasks_due_date on public.tasks (assigned_to, due_date);
create index if not exists idx_task_comments_task on public.task_comments (task_id, created_at);
create index if not exists idx_dwr_employee_date on public.daily_work_reports (employee_id, report_date);
create index if not exists idx_dwr_pending_review on public.daily_work_reports (submitted_at)
  where review_status = 'pending' and status in ('submitted', 'late');
create index if not exists idx_dwr_items_report on public.dwr_items (report_id);
create index if not exists idx_team_summaries_dept_date on public.team_daily_summaries (department_id, report_date);
create index if not exists idx_team_summaries_lead_date on public.team_daily_summaries (lead_employee_id, report_date);

-- ------------------------------------------------------------
-- Shift window, leave, holiday, week-off
-- ------------------------------------------------------------

create or replace function public.dwr_actor_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_org_id(),
    (select e.organization_id from public.employees e where e.id = public.current_employee_id())
  );
$$;

create or replace function public.dwr_shift_bounds(p_employee_id uuid, p_date date)
returns table(window_open timestamptz, shift_end timestamptz, late_until timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_start time;
  v_end time;
  v_overnight boolean;
  v_shift_end timestamptz;
  v_end_date date;
begin
  select s.start_time, s.end_time, coalesce(s.is_overnight, false)
    into v_start, v_end, v_overnight
  from public.employees e
  left join public.shifts s on s.id = e.shift_id
  where e.id = p_employee_id;

  v_start := coalesce(v_start, time '09:30');
  v_end := coalesce(v_end, time '18:30');
  v_overnight := coalesce(v_overnight, false);

  if v_overnight then
    v_shift_end := ((p_date + 1) + v_end) at time zone 'Asia/Kolkata';
  else
    v_shift_end := (p_date + v_end) at time zone 'Asia/Kolkata';
  end if;

  window_open := v_shift_end - interval '30 minutes';
  shift_end := v_shift_end;
  v_end_date := (v_shift_end at time zone 'Asia/Kolkata')::date;
  late_until := (v_end_date + time '10:00') at time zone 'Asia/Kolkata';
  if late_until <= v_shift_end then
    late_until := ((v_end_date + 1) + time '10:00') at time zone 'Asia/Kolkata';
  end if;
  return next;
end;
$fn$;

create or replace function public.dwr_is_holiday(p_org uuid, p_date date)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_col text;
  v_sql text;
  v_org_filter text := '';
  v_active_filter text := '';
  v_result boolean;
begin
  if to_regclass('public.holidays') is null then
    return false;
  end if;

  select c.column_name into v_col
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'holidays'
    and c.column_name in ('holiday_date', 'date', 'observed_on', 'on_date', 'day')
  order by case c.column_name
    when 'holiday_date' then 1
    when 'date' then 2
    when 'observed_on' then 3
    when 'on_date' then 4
    else 5
  end
  limit 1;

  if v_col is null then
    return false;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'holidays' and column_name = 'organization_id'
  ) then
    v_org_filter := ' and (organization_id is null or organization_id = $1)';
  else
    v_org_filter := ' and ($1 is null or $1 is not null)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'holidays' and column_name = 'is_active'
  ) then
    v_active_filter := ' and coalesce(is_active, true)';
  end if;

  v_sql := format(
    'select exists (select 1 from public.holidays where %I = $2%s%s)',
    v_col,
    v_org_filter,
    v_active_filter
  );
  execute v_sql into v_result using p_org, p_date;
  return coalesce(v_result, false);
exception when others then
  return false;
end;
$fn$;

create or replace function public.dwr_is_week_off(p_employee_id uuid, p_date date)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_raw text;
  v_days text[];
  v_iso int;
  v_names text[];
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shifts' and column_name = 'week_offs'
  ) then
    return false;
  end if;

  begin
    execute
      'select s.week_offs::text
       from public.employees e
       join public.shifts s on s.id = e.shift_id
       where e.id = $1'
      into v_raw
      using p_employee_id;
  exception when others then
    return false;
  end;

  if v_raw is null or btrim(v_raw) in ('', '{}', '[]', 'null') then
    return false;
  end if;

  begin
    if left(btrim(v_raw), 1) = '[' then
      select coalesce(array_agg(lower(btrim(entry))), '{}'::text[])
        into v_days
      from jsonb_array_elements_text(v_raw::jsonb) as days(entry);
    else
      select coalesce(array_agg(lower(btrim(day_name, '"'))), '{}'::text[])
        into v_days
      from unnest(v_raw::text[]) as days(day_name);
    end if;
  exception when others then
    return false;
  end;

  v_iso := extract(isodow from p_date)::int;
  v_names := case v_iso
    when 1 then array['monday', 'mon', '1']
    when 2 then array['tuesday', 'tue', 'tues', '2']
    when 3 then array['wednesday', 'wed', '3']
    when 4 then array['thursday', 'thu', 'thur', 'thurs', '4']
    when 5 then array['friday', 'fri', '5']
    when 6 then array['saturday', 'sat', '6']
    else array['sunday', 'sun', '0', '7']
  end;

  return exists (
    select 1 from unnest(coalesce(v_days, '{}'::text[])) as day_name
    where day_name = any (v_names)
  );
end;
$fn$;

-- any_leave covers every approved request overlapping the date, including half days.
-- full_leave is false for a single-day request whose total_days is under 1, or a half-day flag.
create or replace function public.dwr_leave_flags(
  p_employee_id uuid,
  p_date date,
  out any_leave boolean,
  out full_leave boolean
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_half text := 'lr.start_date = lr.end_date and lr.total_days is not null and lr.total_days < 1';
  v_sql text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leave_requests' and column_name = 'is_half_day'
  ) then
    v_half := v_half || ' or coalesce(lr.is_half_day, false)';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leave_requests' and column_name = 'half_day'
  ) then
    v_half := v_half || ' or coalesce(lr.half_day, false)';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leave_requests' and column_name = 'day_part'
  ) then
    v_half := v_half || ' or lower(coalesce(lr.day_part::text, '''')) in (''first'', ''second'', ''am'', ''pm'', ''half'')';
  end if;

  v_sql := format(
    'select coalesce(bool_or(true), false), coalesce(bool_or(not (%s)), false)
     from public.leave_requests lr
     where lr.employee_id = $1
       and lower(coalesce(lr.status, '''')) = ''approved''
       and lr.start_date is not null
       and lr.end_date is not null
       and $2 between lr.start_date and lr.end_date',
    v_half
  );
  execute v_sql into any_leave, full_leave using p_employee_id, p_date;
  any_leave := coalesce(any_leave, false);
  full_leave := coalesce(full_leave, false);
end;
$fn$;

create or replace function public.dwr_profile_id(p_employee_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    e.profile_id,
    (select p.id from public.profiles p where p.employee_id = e.id limit 1)
  )
  from public.employees e
  where e.id = p_employee_id;
$$;

create or replace function public.dwr_notify(
  p_employee_id uuid,
  p_title text,
  p_message text,
  p_reference_type text,
  p_reference_id uuid,
  p_once_per_day boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
begin
  v_profile := public.dwr_profile_id(p_employee_id);
  if v_profile is null then
    return false;
  end if;

  if exists (
    select 1
    from public.notifications n
    where n.user_id = v_profile
      and n.reference_type = p_reference_type
      and n.reference_id is not distinct from p_reference_id
      and (
        not p_once_per_day
        or (n.created_at at time zone 'Asia/Kolkata')::date = (timezone('Asia/Kolkata', now()))::date
      )
  ) then
    return false;
  end if;

  insert into public.notifications (user_id, title, message, type, reference_id, reference_type)
  values (v_profile, p_title, p_message, 'system', p_reference_id, p_reference_type);
  return true;
end;
$fn$;

create or replace function public.dwr_write_audit(
  p_action text,
  p_entity_id uuid,
  p_old jsonb,
  p_new jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if to_regprocedure('public.log_audit_event(text,text,uuid,jsonb,jsonb)') is not null then
    perform public.log_audit_event(p_action, 'daily_work_report', p_entity_id, p_old, p_new);
    return;
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_logs'
      and column_name in ('organization_id', 'user_id', 'action', 'entity_type', 'entity_id', 'old_data', 'new_data')
  ) = 7 then
    insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, old_data, new_data)
    values (
      public.current_org_id(),
      auth.uid(),
      p_action,
      'daily_work_report',
      p_entity_id,
      p_old,
      p_new
    );
  end if;
exception when others then
  -- Column list or log_audit_event shape did not match; the business change stands.
  return;
end;
$fn$;

-- ------------------------------------------------------------
-- Report writes
-- ------------------------------------------------------------

create or replace function public.dwr_guard_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(current_setting('app.dwr_rpc', true), '') is distinct from 'on' then
    raise exception 'Work reports change only through the work-report functions.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$fn$;

create or replace function public.dwr_guard_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(current_setting('app.dwr_rpc', true), '') is distinct from 'on' then
    raise exception 'Work report items change only through the work-report functions.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$fn$;

drop trigger if exists dwr_guard_report_trigger on public.daily_work_reports;
create trigger dwr_guard_report_trigger
  before insert or update or delete on public.daily_work_reports
  for each row
  execute function public.dwr_guard_report();

drop trigger if exists dwr_guard_item_trigger on public.dwr_items;
create trigger dwr_guard_item_trigger
  before insert or update or delete on public.dwr_items
  for each row
  execute function public.dwr_guard_item();

create or replace function public.dwr_upsert(
  p_report_date date,
  p_blockers text,
  p_plan_for_tomorrow text,
  p_items jsonb,
  p_submit boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_employee uuid;
  v_org uuid;
  v_existing public.daily_work_reports%rowtype;
  v_has_existing boolean := false;
  v_resubmit boolean := false;
  v_open timestamptz;
  v_shift_end timestamptz;
  v_late timestamptz;
  v_status text;
  v_review text;
  v_element jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_desc text;
  v_hours numeric;
  v_item_status text;
  v_task uuid;
  v_has_tasks boolean;
  v_total numeric := 0;
  v_row jsonb;
  v_id uuid;
begin
  perform set_config('app.dwr_rpc', 'on', true);

  v_employee := public.current_employee_id();
  if v_employee is null then
    raise exception 'Your account is not linked to an employee record.';
  end if;
  if p_report_date is null then
    raise exception 'Choose a report date.';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'Report items must be a list.';
  end if;

  select e.organization_id into v_org from public.employees e where e.id = v_employee;
  if v_org is null then
    raise exception 'Your employee record has no organisation.';
  end if;

  select * into v_existing
  from public.daily_work_reports
  where employee_id = v_employee and report_date = p_report_date
  for update;

  v_has_existing := found;
  if v_has_existing and v_existing.review_status = 'approved' then
    raise exception 'This report is approved. Your lead can reopen it with a reason.';
  end if;
  if v_has_existing and v_existing.status = 'missed' then
    raise exception 'This report was missed. Ask HR to waive it.';
  end if;

  v_resubmit := v_has_existing and v_existing.review_status = 'needs-revision';

  if p_submit then
    select b.window_open, b.shift_end, b.late_until
      into v_open, v_shift_end, v_late
    from public.dwr_shift_bounds(v_employee, p_report_date) b;

    if not v_resubmit and now() < v_open then
      raise exception 'The report window opens 30 minutes before your shift ends. You can still save a draft.';
    end if;
    if not v_resubmit and now() >= v_late then
      raise exception 'The submission window closed at 10:00 IST. This report will be marked missed.';
    end if;
    v_status := case when now() > v_shift_end then 'late' else 'submitted' end;
    v_review := 'pending';
  else
    if v_has_existing and v_existing.status in ('submitted', 'late') then
      v_status := v_existing.status;
    else
      v_status := 'draft';
    end if;
    v_review := case
      when v_has_existing and v_existing.review_status = 'needs-revision' then 'needs-revision'
      else 'pending'
    end;
  end if;

  select exists (
    select 1
    from public.tasks t
    where t.assigned_to = v_employee
      and (
        t.status <> 'done'
        or (
          t.completed_at is not null
          and (t.completed_at at time zone 'Asia/Kolkata')::date = p_report_date
        )
      )
  ) into v_has_tasks;

  for v_element in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_desc := btrim(coalesce(v_element->>'description', ''));
    if v_desc = '' then
      if p_submit then
        raise exception 'Each report item needs a description.';
      end if;
      continue;
    end if;

    begin
      v_hours := round(coalesce((v_element->>'hours')::numeric, 0), 2);
    exception when others then
      raise exception 'Item hours must be a number.';
    end;
    if v_hours < 0 or v_hours > 24 then
      raise exception 'Item hours must be between 0 and 24.';
    end if;

    v_item_status := coalesce(nullif(v_element->>'item_status', ''), 'done');
    if v_item_status not in ('todo', 'in-progress', 'blocked', 'done') then
      raise exception 'Invalid item status.';
    end if;

    v_task := null;
    if nullif(v_element->>'task_id', '') is not null then
      begin
        v_task := (v_element->>'task_id')::uuid;
      exception when others then
        raise exception 'Invalid task.';
      end;
    end if;

    if v_has_tasks and v_task is null then
      raise exception 'Free-text items are only allowed when you have no assigned tasks.';
    end if;

    if v_task is not null and not exists (
      select 1
      from public.tasks t
      where t.id = v_task
        and t.assigned_to = v_employee
        and (
          t.status <> 'done'
          or (
            t.completed_at is not null
            and (t.completed_at at time zone 'Asia/Kolkata')::date = p_report_date
          )
        )
    ) then
      raise exception 'That task is not on your list for this report.';
    end if;

    v_total := v_total + v_hours;
    v_clean := v_clean || jsonb_build_array(
      jsonb_build_object(
        'task_id', v_task,
        'description', v_desc,
        'hours', v_hours,
        'item_status', v_item_status
      )
    );
  end loop;

  if p_submit and jsonb_array_length(v_clean) = 0 then
    raise exception 'Add at least one line before you submit.';
  end if;
  if p_submit and v_total <= 0 then
    raise exception 'Enter the hours you worked before you submit.';
  end if;

  if v_has_existing then
    update public.daily_work_reports
    set status = v_status,
        submitted_at = case when p_submit then now() else submitted_at end,
        total_hours = v_total,
        blockers = nullif(btrim(coalesce(p_blockers, '')), ''),
        plan_for_tomorrow = nullif(btrim(coalesce(p_plan_for_tomorrow, '')), ''),
        review_status = v_review,
        escalated = case when p_submit then false else escalated end,
        updated_at = now()
    where id = v_existing.id
    returning id into v_id;
  else
    insert into public.daily_work_reports (
      organization_id, employee_id, report_date, status, submitted_at, total_hours,
      blockers, plan_for_tomorrow, review_status
    ) values (
      v_org,
      v_employee,
      p_report_date,
      v_status,
      case when p_submit then now() else null end,
      v_total,
      nullif(btrim(coalesce(p_blockers, '')), ''),
      nullif(btrim(coalesce(p_plan_for_tomorrow, '')), ''),
      v_review
    )
    returning id into v_id;
  end if;

  delete from public.dwr_items where report_id = v_id;

  insert into public.dwr_items (report_id, task_id, description, hours, item_status)
  select
    v_id,
    nullif(item->>'task_id', '')::uuid,
    item->>'description',
    (item->>'hours')::numeric,
    item->>'item_status'
  from jsonb_array_elements(v_clean) as item;

  v_row := jsonb_build_object('id', v_id, 'status', v_status, 'total_hours', v_total);
  return v_row;
end;
$fn$;

create or replace function public.save_dwr_draft(
  p_report_date date,
  p_blockers text,
  p_plan_for_tomorrow text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row jsonb;
begin
  v_row := public.dwr_upsert(p_report_date, p_blockers, p_plan_for_tomorrow, p_items, false);
  return (v_row->>'id')::uuid;
end;
$fn$;

create or replace function public.submit_dwr(
  p_report_date date,
  p_blockers text,
  p_plan_for_tomorrow text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return public.dwr_upsert(p_report_date, p_blockers, p_plan_for_tomorrow, p_items, true);
end;
$fn$;

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
  if not public.can_manage_employee(v_row.employee_id) then
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

create or replace function public.reopen_dwr(p_report_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.daily_work_reports%rowtype;
begin
  perform set_config('app.dwr_rpc', 'on', true);

  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required to reopen a report.';
  end if;

  select * into v_row from public.daily_work_reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found.';
  end if;
  if not public.can_manage_employee(v_row.employee_id) then
    raise exception 'You cannot reopen this report.';
  end if;
  if v_row.review_status <> 'approved' then
    raise exception 'Only an approved report can be reopened.';
  end if;

  update public.daily_work_reports
  set review_status = 'needs-revision',
      reopen_reason = btrim(p_reason),
      lead_remarks = btrim(p_reason),
      updated_at = now()
  where id = p_report_id;

  perform public.dwr_write_audit(
    'dwr.reopen',
    p_report_id,
    jsonb_build_object('review_status', v_row.review_status, 'lead_remarks', v_row.lead_remarks),
    jsonb_build_object('review_status', 'needs-revision', 'reason', btrim(p_reason))
  );
end;
$fn$;

create or replace function public.waive_missed_dwr(p_report_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.daily_work_reports%rowtype;
begin
  perform set_config('app.dwr_rpc', 'on', true);

  if public.current_user_role() not in ('admin', 'hr') then
    raise exception 'Only HR can waive a missed report.';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required to waive a missed report.';
  end if;

  select * into v_row from public.daily_work_reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found.';
  end if;
  if v_row.organization_id is distinct from public.dwr_actor_org() then
    raise exception 'Report not found.';
  end if;
  if v_row.status <> 'missed' then
    raise exception 'Only a missed report can be waived.';
  end if;

  update public.daily_work_reports
  set status = 'late',
      submitted_at = coalesce(submitted_at, now()),
      waiver_reason = btrim(p_reason),
      review_status = 'pending',
      updated_at = now()
  where id = p_report_id;

  perform public.dwr_write_audit(
    'dwr.waive_missed',
    p_report_id,
    jsonb_build_object('status', 'missed'),
    jsonb_build_object('status', 'late', 'reason', btrim(p_reason))
  );
end;
$fn$;

create or replace function public.checkout_allowed(p_employee_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_status text;
  v_org uuid;
  v_any_leave boolean;
  v_holiday boolean;
  v_week_off boolean;
begin
  if p_employee_id is null or p_date is null then
    return jsonb_build_object('allowed', false, 'reason', 'Choose an employee and a date.');
  end if;
  if not public.can_view_employee(p_employee_id) then
    raise exception 'Not allowed to view this employee.';
  end if;

  select r.status into v_status
  from public.daily_work_reports r
  where r.employee_id = p_employee_id and r.report_date = p_date;

  select e.organization_id into v_org from public.employees e where e.id = p_employee_id;
  select flags.any_leave into v_any_leave
  from public.dwr_leave_flags(p_employee_id, p_date) as flags;
  v_holiday := public.dwr_is_holiday(v_org, p_date);
  v_week_off := public.dwr_is_week_off(p_employee_id, p_date);

  if v_status in ('submitted', 'late') or coalesce(v_any_leave, false) or v_holiday or v_week_off then
    return jsonb_build_object('allowed', true);
  end if;

  if v_status = 'draft' then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Today''s work report is still a draft. Submit it before check-out.'
    );
  end if;
  if v_status = 'missed' then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Today''s work report was missed. Ask HR to waive it before check-out.'
    );
  end if;
  return jsonb_build_object(
    'allowed', false,
    'reason', 'Submit today''s work report before check-out.'
  );
end;
$fn$;

create or replace function public.mark_missed_dwrs(d date)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_emp record;
  v_bounds record;
  v_full_leave boolean;
  v_report public.daily_work_reports%rowtype;
  v_count integer := 0;
begin
  perform set_config('app.dwr_rpc', 'on', true);
  if d is null then
    return 0;
  end if;

  for v_emp in
    select e.id, e.organization_id
    from public.employees e
    where e.organization_id is not null
      and lower(coalesce(e.employment_status, 'active')) in ('active', 'probation', 'notice', 'on-leave')
      and (e.exit_date is null or e.exit_date >= d)
  loop
    select * into v_bounds from public.dwr_shift_bounds(v_emp.id, d);
    if now() < v_bounds.late_until then
      continue;
    end if;
    if public.dwr_is_holiday(v_emp.organization_id, d) or public.dwr_is_week_off(v_emp.id, d) then
      continue;
    end if;

    select flags.full_leave into v_full_leave
    from public.dwr_leave_flags(v_emp.id, d) as flags;
    if coalesce(v_full_leave, false) then
      continue;
    end if;

    select * into v_report
    from public.daily_work_reports r
    where r.employee_id = v_emp.id and r.report_date = d
    for update;

    if found then
      if v_report.status in ('submitted', 'late', 'missed') then
        continue;
      end if;
      if v_report.review_status = 'needs-revision' then
        continue;
      end if;
      update public.daily_work_reports
      set status = 'missed', updated_at = now()
      where id = v_report.id;
      v_count := v_count + 1;
    else
      insert into public.daily_work_reports (
        organization_id, employee_id, report_date, status, total_hours, review_status
      ) values (
        v_emp.organization_id, v_emp.id, d, 'missed', 0, 'pending'
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$fn$;

create or replace function public.remind_dwr_windows()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_emp record;
  v_date date;
  v_bounds record;
  v_status text;
  v_lead record;
  v_sent integer := 0;
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  for v_emp in
    select e.id, e.organization_id
    from public.employees e
    where e.organization_id is not null
      and lower(coalesce(e.employment_status, 'active')) in ('active', 'probation', 'notice', 'on-leave')
      and (e.exit_date is null or e.exit_date >= v_today)
      and public.dwr_profile_id(e.id) is not null
  loop
    for v_date in
      select dates.report_date
      from (values (v_today), (v_today - 1)) as dates(report_date)
    loop
      select * into v_bounds from public.dwr_shift_bounds(v_emp.id, v_date);
      if now() < v_bounds.window_open or now() >= v_bounds.shift_end then
        continue;
      end if;
      if public.dwr_is_holiday(v_emp.organization_id, v_date) or public.dwr_is_week_off(v_emp.id, v_date) then
        continue;
      end if;

      select r.status into v_status
      from public.daily_work_reports r
      where r.employee_id = v_emp.id and r.report_date = v_date;

      if v_status in ('submitted', 'late', 'missed') then
        continue;
      end if;

      if public.dwr_notify(
        v_emp.id,
        'Work report window is open',
        'Submit your work report for ' || to_char(v_date, 'DD Mon YYYY') || ' before your shift ends so you can check out.',
        'dwr_window_open',
        v_emp.id,
        true
      ) then
        v_sent := v_sent + 1;
      end if;

      if now() >= v_bounds.shift_end - interval '10 minutes' then
        if public.dwr_notify(
          v_emp.id,
          'Work report closes soon',
          'Your shift ends in about 10 minutes. Submit the work report for ' || to_char(v_date, 'DD Mon YYYY') || ' before check-out.',
          'dwr_ten_minutes',
          v_emp.id,
          true
        ) then
          v_sent := v_sent + 1;
        end if;
      end if;
    end loop;
  end loop;

  for v_lead in
    select e.manager_id as lead_id, count(*)::int as pending_count
    from public.daily_work_reports r
    join public.employees e on e.id = r.employee_id
    where r.review_status = 'pending'
      and r.status in ('submitted', 'late')
      and e.manager_id is not null
    group by e.manager_id
  loop
    if public.dwr_notify(
      v_lead.lead_id,
      'Work reports to review',
      'You have ' || v_lead.pending_count || ' team work report' ||
        case when v_lead.pending_count = 1 then '' else 's' end || ' waiting for review.',
      'dwr_pending_review',
      v_lead.lead_id,
      true
    ) then
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$fn$;

create or replace function public.escalate_stale_dwr_reviews()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row record;
  v_target uuid;
  v_name text;
  v_count integer := 0;
begin
  perform set_config('app.dwr_rpc', 'on', true);

  for v_row in
    select
      r.id,
      r.employee_id,
      r.organization_id,
      e.manager_id,
      e.department_id,
      d.manager_id as department_head_id,
      btrim(concat_ws(' ', e.first_name, e.last_name)) as employee_name
    from public.daily_work_reports r
    join public.employees e on e.id = r.employee_id
    left join public.departments d on d.id = e.department_id
    where r.review_status = 'pending'
      and r.status in ('submitted', 'late')
      and r.escalated = false
      and (
        e.manager_id is null
        or (r.submitted_at is not null and r.submitted_at < now() - interval '48 hours')
      )
  loop
    update public.daily_work_reports
    set escalated = true, updated_at = now()
    where id = v_row.id;

    v_target := coalesce(v_row.department_head_id, null);
    v_name := coalesce(nullif(v_row.employee_name, ''), 'An employee');

    if v_target is not null then
      perform public.dwr_notify(
        v_target,
        'Work report escalated',
        v_name || '''s work report is unreviewed and is now with the department head. It is not rejected.',
        'dwr_escalated',
        v_row.id,
        false
      );
    else
      for v_target in
        select p_emp.id
        from public.employees p_emp
        join public.profiles p on p.id = p_emp.profile_id
        where p_emp.organization_id = v_row.organization_id
          and p.role in ('admin', 'hr')
          and coalesce(p.is_active, true)
      loop
        perform public.dwr_notify(
          v_target,
          'Work report escalated',
          v_name || '''s work report has no reviewer. It is unreviewed, not rejected.',
          'dwr_escalated',
          v_row.id,
          false
        );
      end loop;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

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
  if not public.is_lead() then
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

-- ------------------------------------------------------------
-- Tasks
-- ------------------------------------------------------------

create or replace function public.tasks_guard_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.organization_id is null then
      select e.organization_id into new.organization_id
      from public.employees e
      where e.id = new.assigned_to;
    end if;
  elsif public.can_manage_employee(old.assigned_to)
     or public.current_user_role() in ('admin', 'hr') then
    null;
  elsif old.assigned_to = public.current_employee_id() then
    if new.assigned_to is distinct from old.assigned_to
       or new.assigned_by is distinct from old.assigned_by
       or new.organization_id is distinct from old.organization_id
       or new.project_id is distinct from old.project_id
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.priority is distinct from old.priority
       or new.due_date is distinct from old.due_date
       or new.estimated_hours is distinct from old.estimated_hours
    then
      raise exception 'You can only update the status of a task assigned to you.';
    end if;
  else
    raise exception 'You cannot update this task.';
  end if;

  if new.project_id is not null and not exists (
    select 1
    from public.projects p
    where p.id = new.project_id
      and p.organization_id = new.organization_id
  ) then
    raise exception 'Project is not in this organisation.';
  end if;

  if new.status = 'done' then
    if tg_op = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status is distinct from 'done' or new.completed_at is null then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists tasks_guard_write_trigger on public.tasks;
create trigger tasks_guard_write_trigger
  before insert or update on public.tasks
  for each row
  execute function public.tasks_guard_write();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.daily_work_reports enable row level security;
alter table public.dwr_items enable row level security;
alter table public.team_daily_summaries enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select
  using (organization_id = public.dwr_actor_org());

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert
  with check (
    organization_id = public.dwr_actor_org()
    and (public.current_user_role() in ('admin', 'hr') or public.is_lead())
  );

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update
  using (
    organization_id = public.dwr_actor_org()
    and (public.current_user_role() in ('admin', 'hr') or public.is_lead())
  )
  with check (organization_id = public.dwr_actor_org());

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select
  using (
    organization_id = public.dwr_actor_org()
    and (
      public.can_view_employee(assigned_to)
      or assigned_by = public.current_employee_id()
    )
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert
  with check (
    assigned_by = public.current_employee_id()
    and public.can_manage_employee(assigned_to)
    and organization_id = (
      select e.organization_id from public.employees e where e.id = assigned_to
    )
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update
  using (
    organization_id = public.dwr_actor_org()
    and (
      public.can_manage_employee(assigned_to)
      or assigned_to = public.current_employee_id()
    )
  )
  with check (
    organization_id = public.dwr_actor_org()
    and (
      public.can_manage_employee(assigned_to)
      or assigned_to = public.current_employee_id()
    )
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete
  using (
    organization_id = public.dwr_actor_org()
    and public.can_manage_employee(assigned_to)
  );

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
  for select
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_comments.task_id
        and t.organization_id = public.dwr_actor_org()
        and (
          public.can_view_employee(t.assigned_to)
          or t.assigned_by = public.current_employee_id()
        )
    )
  );

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments
  for insert
  with check (
    author_id = public.current_employee_id()
    and exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and t.organization_id = public.dwr_actor_org()
        and (
          public.can_view_employee(t.assigned_to)
          or t.assigned_by = public.current_employee_id()
        )
    )
  );

drop policy if exists daily_work_reports_select on public.daily_work_reports;
create policy daily_work_reports_select on public.daily_work_reports
  for select
  using (
    organization_id = public.dwr_actor_org()
    and public.can_view_employee(employee_id)
  );

drop policy if exists dwr_items_select on public.dwr_items;
create policy dwr_items_select on public.dwr_items
  for select
  using (
    exists (
      select 1
      from public.daily_work_reports r
      where r.id = dwr_items.report_id
        and r.organization_id = public.dwr_actor_org()
        and public.can_view_employee(r.employee_id)
    )
  );

drop policy if exists team_daily_summaries_select on public.team_daily_summaries;
create policy team_daily_summaries_select on public.team_daily_summaries
  for select
  using (
    organization_id = public.dwr_actor_org()
    and (
      lead_employee_id = public.current_employee_id()
      or public.current_user_role() in ('admin', 'hr')
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

revoke all on public.projects from public, anon;
revoke all on public.tasks from public, anon;
revoke all on public.task_comments from public, anon;
revoke all on public.daily_work_reports from public, anon;
revoke all on public.dwr_items from public, anon;
revoke all on public.team_daily_summaries from public, anon;

grant select, insert, update on public.projects to authenticated, service_role;
grant select, insert, update, delete on public.tasks to authenticated, service_role;
grant select, insert on public.task_comments to authenticated, service_role;
grant select on public.daily_work_reports to authenticated, service_role;
grant select on public.dwr_items to authenticated, service_role;
grant select on public.team_daily_summaries to authenticated, service_role;

revoke all on function public.dwr_upsert(date, text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.dwr_guard_report() from public, anon, authenticated;
revoke all on function public.dwr_guard_item() from public, anon, authenticated;
revoke all on function public.tasks_guard_write() from public, anon, authenticated;
revoke all on function public.dwr_notify(uuid, text, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.dwr_write_audit(text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.dwr_profile_id(uuid) from public, anon, authenticated;
revoke all on function public.dwr_shift_bounds(uuid, date) from public, anon, authenticated;
revoke all on function public.dwr_is_holiday(uuid, date) from public, anon, authenticated;
revoke all on function public.dwr_is_week_off(uuid, date) from public, anon, authenticated;
revoke all on function public.dwr_leave_flags(uuid, date) from public, anon, authenticated;

grant execute on function public.dwr_actor_org() to authenticated, service_role;
grant execute on function public.save_dwr_draft(date, text, text, jsonb) to authenticated, service_role;
grant execute on function public.submit_dwr(date, text, text, jsonb) to authenticated, service_role;
grant execute on function public.review_dwr(uuid, text, smallint, text) to authenticated, service_role;
grant execute on function public.reopen_dwr(uuid, text) to authenticated, service_role;
grant execute on function public.waive_missed_dwr(uuid, text) to authenticated, service_role;
grant execute on function public.checkout_allowed(uuid, date) to authenticated, service_role;
grant execute on function public.mark_missed_dwrs(date) to authenticated, service_role;
grant execute on function public.remind_dwr_windows() to authenticated, service_role;
grant execute on function public.escalate_stale_dwr_reviews() to authenticated, service_role;
grant execute on function public.save_team_daily_summary(date, uuid, text, text, text) to authenticated, service_role;

-- Schedules are best-effort. Calling the functions manually is enough when cron is absent.
do $cron$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is not installed. Call mark_missed_dwrs, remind_dwr_windows, and escalate_stale_dwr_reviews manually.';
    return;
  end if;

  begin
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in ('mark_missed_dwrs_daily', 'remind_dwr_windows', 'escalate_stale_dwr_reviews');
  exception when others then
    raise notice 'Could not clear existing DWR cron jobs: %', sqlerrm;
  end;

  begin
    perform cron.schedule(
      'mark_missed_dwrs_daily',
      '40 4 * * *',
      $cmd$select public.mark_missed_dwrs((timezone('Asia/Kolkata', now()))::date - 1); select public.mark_missed_dwrs((timezone('Asia/Kolkata', now()))::date - 2);$cmd$
    );
    perform cron.schedule(
      'remind_dwr_windows',
      '*/10 * * * *',
      $cmd$select public.remind_dwr_windows()$cmd$
    );
    perform cron.schedule(
      'escalate_stale_dwr_reviews',
      '20 * * * *',
      $cmd$select public.escalate_stale_dwr_reviews()$cmd$
    );
  exception when others then
    raise notice 'pg_cron schedule skipped: %', sqlerrm;
  end;
end;
$cron$;
