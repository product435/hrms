-- P0 RLS repair. Drop leftover broad policies only. No new policies.
--
-- 20260818000000_kinetix_hrms.sql created, and no later migration drops:
--   {table}_select / {table}_insert / {table}_update
--     USING / WITH CHECK = public.is_org_member(organization_id)
--     so any org member can read or write every row, OR-ed with later rules.
--   roles_authenticated_select (roles)
--   permissions_authenticated_select (permissions)
--   role_permissions_authenticated_select (role_permissions)
--     FOR SELECT TO authenticated USING (true)
--
-- 20260820000002_fix_profiles_rls.sql created, and no later migration drops:
--   profiles_org_select (profiles)
--     FOR SELECT USING (auth.role() = 'authenticated')
--     with no organization or employee predicate.
--
-- Already dropped earlier, so not repeated here:
--   profiles_member_select, profiles_self_update
--     (20260820000002_fix_profiles_rls.sql and 20260820000003_complete_rls_fix.sql)
--
-- Kept on purpose. These are not the broad predicates above:
--   {table}_delete — is_org_member(organization_id) AND is_admin_or_hr()
--   organizations_member_select — id = current_org_id()
--   user_preferences_self_all, announcement_reads_self_all — own row
--   later replacements (*_admin_hr_all, *_self_select, *_self_insert,
--   *_self_update, *_manager_view_team, *_read_all, *_write_admin_hr,
--   attendance_records_self_update, salary_structures_self_insert,
--   salary_structures_self_select, and the rest)
--
-- Dropped names:
--   departments_select, departments_insert, departments_update
--   designations_select, designations_insert, designations_update
--   employees_select, employees_insert, employees_update
--   shifts_select, shifts_insert, shifts_update
--   shift_assignments_select, shift_assignments_insert, shift_assignments_update
--   attendance_select, attendance_insert, attendance_update
--   attendance_corrections_select, attendance_corrections_insert, attendance_corrections_update
--   leave_types_select, leave_types_insert, leave_types_update
--   leave_balances_select, leave_balances_insert, leave_balances_update
--   leave_select, leave_insert, leave_update
--   salary_structures_select, salary_structures_insert, salary_structures_update
--   payroll_runs_select, payroll_runs_insert, payroll_runs_update
--   payslips_select, payslips_insert, payslips_update
--   assets_select, assets_insert, assets_update
--   asset_history_select, asset_history_insert, asset_history_update
--   jobs_select, jobs_insert, jobs_update
--   candidates_select, candidates_insert, candidates_update
--   interviews_select, interviews_insert, interviews_update
--   offers_select, offers_insert, offers_update
--   onboarding_select, onboarding_insert, onboarding_update
--   onboarding_tasks_select, onboarding_tasks_insert, onboarding_tasks_update
--   goals_select, goals_insert, goals_update
--   performance_reviews_select, performance_reviews_insert, performance_reviews_update
--   documents_select, documents_insert, documents_update
--   expenses_select, expenses_insert, expenses_update
--   helpdesk_requests_select, helpdesk_requests_insert, helpdesk_requests_update
--   announcements_select, announcements_insert, announcements_update
--   notifications_select, notifications_insert, notifications_update
--   audit_logs_select, audit_logs_insert, audit_logs_update
--   organization_settings_select, organization_settings_insert, organization_settings_update
--   roles_authenticated_select
--   permissions_authenticated_select
--   role_permissions_authenticated_select
--   profiles_org_select

do $$
declare
  t text;
  action text;
begin
  foreach t in array array[
    'departments',
    'designations',
    'employees',
    'shifts',
    'shift_assignments',
    'attendance',
    'attendance_corrections',
    'leave_types',
    'leave_balances',
    'leave',
    'salary_structures',
    'payroll_runs',
    'payslips',
    'assets',
    'asset_history',
    'jobs',
    'candidates',
    'interviews',
    'offers',
    'onboarding',
    'onboarding_tasks',
    'goals',
    'performance_reviews',
    'documents',
    'expenses',
    'helpdesk_requests',
    'announcements',
    'notifications',
    'audit_logs',
    'organization_settings'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    foreach action in array array['select', 'insert', 'update']
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        t || '_' || action,
        t
      );
    end loop;
  end loop;

  if to_regclass('public.roles') is not null then
    execute 'drop policy if exists roles_authenticated_select on public.roles';
  end if;

  if to_regclass('public.permissions') is not null then
    execute 'drop policy if exists permissions_authenticated_select on public.permissions';
  end if;

  if to_regclass('public.role_permissions') is not null then
    execute 'drop policy if exists role_permissions_authenticated_select on public.role_permissions';
  end if;

  if to_regclass('public.profiles') is not null then
    execute 'drop policy if exists profiles_org_select on public.profiles';
  end if;
end $$;
