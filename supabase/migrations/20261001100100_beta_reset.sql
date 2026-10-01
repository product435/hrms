-- Phase 5: beta mode + admin "Clear beta data".
-- reset_beta_data() tolerates tables that may not exist yet (projects module,
-- AI analysis tables) via to_regclass + dynamic SQL.

alter table public.organization_settings
  add column if not exists beta_until date;

-- Any signed-in user may read the beta end date for their own organisation
-- (drives the banner).
create or replace function public.beta_status()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select s.beta_until
  from public.organization_settings s
  where s.organization_id = public.current_org_id();
$$;

revoke all on function public.beta_status() from public, anon;
grant execute on function public.beta_status() to authenticated, service_role;

create or replace function public.set_beta_until(p_date date)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change the beta end date.';
  end if;
  update public.organization_settings
  set beta_until = p_date
  where organization_id = v_org;
  if not found then
    raise exception 'Organisation settings row not found.';
  end if;
  return p_date;
end;
$$;

revoke all on function public.set_beta_until(date) from public, anon;
grant execute on function public.set_beta_until(date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- reset_beta_data: one transaction (a plpgsql function body), admin only.
-- Returns { counts: {table: n}, skipped_payroll_runs: [...], storage_paths: [...] }.
-- Storage objects are not touched here; the caller removes storage_paths from
-- the "documents" bucket through the Storage API.
-- ---------------------------------------------------------------------------
create or replace function public.reset_beta_data(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_beta date;
  v_emp text := 'select id from public.employees where organization_id = $1';
  v_counts jsonb := '{}'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_paths jsonb := '[]'::jsonb;
  v_n bigint;
  v_item text[];
  v_where text;
  v_tbl text;
  v_steps text[][];
begin
  -- 1. admin only
  if public.current_user_role() is distinct from 'admin' or v_org is null then
    raise exception 'Only an admin can reset beta data.';
  end if;

  -- 2. explicit confirmation
  if p_confirm is distinct from 'RESET' then
    raise exception 'Type RESET to confirm.';
  end if;

  -- 3. beta window must be active
  select beta_until into v_beta
  from public.organization_settings
  where organization_id = v_org;
  if v_beta is null or v_beta < (timezone('Asia/Kolkata', now()))::date then
    raise exception 'Beta mode is not active. Set a future beta end date first.';
  end if;

  -- 4. rate limit: one reset per 60 seconds
  if exists (
    select 1 from public.audit_logs
    where organization_id = v_org
      and action = 'beta_reset'
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'A reset ran less than 60 seconds ago. Wait a moment and try again.';
  end if;

  -- 5. allow the DWR guard triggers (transaction-local)
  perform set_config('app.dwr_rpc', 'on', true);

  -- Storage paths of employee documents about to be removed.
  select coalesce(jsonb_agg(d.file_url), '[]'::jsonb) into v_paths
  from public.documents d
  where d.file_url is not null
    and d.employee_id in (select id from public.employees where organization_id = v_org);

  -- Employees stranded mid-onboarding go back to active before their
  -- onboarding rows are removed.
  update public.employees e
  set employment_status = 'active'
  where e.organization_id = v_org
    and e.employment_status in ('pending_approval', 'rejected')
    and exists (select 1 from public.onboarding_records o where o.employee_id = e.id);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('employees_status_reset', v_n);

  -- Approved payroll runs cannot be deleted; report and keep them.
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'month', month, 'year', year)), '[]'::jsonb)
  into v_skipped
  from public.payroll_runs
  where organization_id = v_org and status = 'approved';

  -- {table, where-clause using $1 = organisation id}. Children before parents.
  -- 'auto' resolves to organization_id or employee_id when the table has one.
  v_steps := array[
    ['dwr_ai_analyses',         'auto'],
    ['dwr_ai_runs',             'auto'],
    ['dwr_items',               'report_id in (select id from public.daily_work_reports where organization_id = $1)'],
    ['daily_work_reports',      'organization_id = $1'],
    ['team_daily_summaries',    'organization_id = $1'],
    ['task_comments',           'task_id in (select id from public.tasks where organization_id = $1)'],
    ['tasks',                   'organization_id = $1'],
    ['project_messages',        'project_id in (select id from public.projects where organization_id = $1)'],
    ['projects',                'organization_id = $1'],
    ['leave_ledger',            'employee_id in (' || v_emp || ')'],
    ['leave_requests',          'employee_id in (' || v_emp || ')'],
    ['attendance_corrections',  'employee_id in (' || v_emp || ')'],
    ['attendance_records',      'employee_id in (' || v_emp || ')'],
    ['notifications',           'user_id in (select profile_id from public.employees where organization_id = $1 and profile_id is not null)'],
    ['announcement_reads',      'announcement_id in (select id from public.announcements where organization_id = $1)'],
    ['announcements',           'organization_id = $1'],
    ['expense_claims',          'employee_id in (' || v_emp || ')'],
    ['helpdesk_tickets',        'employee_id in (' || v_emp || ')'],
    ['employee_complaints',     'employee_id in (' || v_emp || ')'],
    ['goals',                   'employee_id in (' || v_emp || ')'],
    ['performance_reviews',     'employee_id in (' || v_emp || ')'],
    ['kpi_scores',              'employee_id in (' || v_emp || ')'],
    ['employee_kra_assignments','employee_id in (' || v_emp || ')'],
    ['asset_assignments',       'employee_id in (' || v_emp || ')'],
    ['asset_requests',          'employee_id in (' || v_emp || ')'],
    ['asset_repairs',           'asset_id in (select id from public.assets where organization_id = $1)'],
    ['documents',               'employee_id in (' || v_emp || ')'],
    ['password_reset_requests', 'employee_id in (' || v_emp || ') or user_id in (select profile_id from public.employees where organization_id = $1 and profile_id is not null)'],
    ['onboarding_tasks',        'onboarding_id in (select id from public.onboarding_records where employee_id in (' || v_emp || '))'],
    ['onboarding_records',      'employee_id in (' || v_emp || ')'],
    ['interviews',              'application_id in (select a.id from public.job_applications a join public.job_openings j on j.id = a.job_id where j.organization_id = $1)'],
    ['offers',                  'application_id in (select a.id from public.job_applications a join public.job_openings j on j.id = a.job_id where j.organization_id = $1)'],
    ['job_applications',        'job_id in (select id from public.job_openings where organization_id = $1)'],
    ['candidates',              'not exists (select 1 from public.job_applications a where a.candidate_id = candidates.id)'],
    ['payslips',                'payroll_record_id in (select pr.id from public.payroll_records pr join public.payroll_runs r on r.id = pr.payroll_run_id where r.organization_id = $1 and r.status <> ''approved'')'],
    ['payroll_records',         'payroll_run_id in (select id from public.payroll_runs where organization_id = $1 and status <> ''approved'')'],
    ['payroll_runs',            'organization_id = $1 and status <> ''approved''']
  ];

  foreach v_item slice 1 in array v_steps
  loop
    v_tbl := v_item[1];
    v_where := v_item[2];

    if to_regclass('public.' || quote_ident(v_tbl)) is null then
      v_counts := v_counts || jsonb_build_object(v_tbl, null);  -- table not present yet
      continue;
    end if;

    if v_where = 'auto' then
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = v_tbl and column_name = 'organization_id'
      ) then
        v_where := 'organization_id = $1';
      elsif exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = v_tbl and column_name = 'employee_id'
      ) then
        v_where := 'employee_id in (' || v_emp || ')';
      else
        v_counts := v_counts || jsonb_build_object(v_tbl, 'skipped: no organisation scope');
        continue;
      end if;
    end if;

    execute format('delete from public.%I where %s', v_tbl, v_where) using v_org;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(v_tbl, v_n);
  end loop;

  -- project_members go via ON DELETE CASCADE from projects (the member guard
  -- blocks removing the owner directly); count what is left to be sure.
  if to_regclass('public.project_members') is not null then
    execute 'select count(*) from public.project_members where project_id in (select id from public.projects where organization_id = $1)'
      into v_n using v_org;
    v_counts := v_counts || jsonb_build_object('project_members_remaining', v_n);
  end if;

  insert into public.audit_logs (organization_id, user_id, action, entity_type, new_data)
  values (
    v_org,
    auth.uid(),
    'beta_reset',
    'organization',
    jsonb_build_object('counts', v_counts, 'skipped_payroll_runs', v_skipped)
  );

  return jsonb_build_object(
    'counts', v_counts,
    'skipped_payroll_runs', v_skipped,
    'storage_paths', v_paths
  );
end;
$$;

revoke all on function public.reset_beta_data(text) from public, anon;
grant execute on function public.reset_beta_data(text) to authenticated, service_role;

comment on function public.reset_beta_data(text) is
  'Admin-only, org-scoped wipe of operational beta data in one transaction. Refuses outside the beta window.';
