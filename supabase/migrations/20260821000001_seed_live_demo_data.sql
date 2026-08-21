-- Safe demo seed for the deployed schema discovered by PostgREST.
-- This migration does not create tables, roles, columns, or Auth users.
-- It uses deterministic UUIDs and skips rows that already exist.

do $$
declare
  org_id uuid := '11111111-1111-4111-8111-111111111111';
  dept_id uuid := '22222222-2222-4222-8222-222222222222';
  design_id uuid := '33333333-3333-4333-8333-333333333333';
  shift_id uuid := '44444444-4444-4444-8444-444444444444';
  emp_id uuid := '55555555-5555-4555-8555-555555555555';
  hr_emp_id uuid := '66666666-6666-4666-8666-666666666666';
  manager_emp_id uuid := '77777777-7777-4777-8777-777777777777';
  employee_emp_id uuid := '88888888-8888-4888-8888-888888888888';
  payroll_id uuid := '99999999-9999-4999-8999-999999999999';
  asset_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  candidate_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  interview_id uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  offer_id uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  goal_id uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  review_id uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  demo jsonb;
begin
  demo := jsonb_build_object('id', org_id, 'name', 'TeamNest Demo Organisation', 'slug', 'kinetix-demo', 'timezone', 'Asia/Kolkata', 'currency', 'INR');
  if to_regclass('public.organizations') is not null then
    execute 'insert into public.organizations select * from jsonb_populate_record(null::public.organizations, $1) where not exists (select 1 from public.organizations where id = $2)' using demo, org_id;
  end if;

  demo := jsonb_build_object('id', dept_id, 'organization_id', org_id, 'name', 'People Operations', 'code', 'PEO');
  if to_regclass('public.departments') is not null then
    execute 'insert into public.departments select * from jsonb_populate_record(null::public.departments, $1) where not exists (select 1 from public.departments where id = $2)' using demo, dept_id;
  end if;

  demo := jsonb_build_object('id', design_id, 'organization_id', org_id, 'department_id', dept_id, 'name', 'People Operations Specialist', 'level', 'L2', 'description', 'HR operations and employee experience');
  if to_regclass('public.designations') is not null then
    execute 'insert into public.designations select * from jsonb_populate_record(null::public.designations, $1) where not exists (select 1 from public.designations where id = $2)' using demo, design_id;
  end if;

  demo := jsonb_build_object('id', shift_id, 'organization_id', org_id, 'name', 'Standard Day', 'start_time', '09:30', 'end_time', '18:30', 'break_minutes', 60, 'grace_minutes', 15, 'week_offs', jsonb_build_array('Saturday','Sunday'), 'is_night_shift', false);
  if to_regclass('public.shifts') is not null then
    execute 'insert into public.shifts select * from jsonb_populate_record(null::public.shifts, $1) where not exists (select 1 from public.shifts where id = $2)' using demo, shift_id;
  end if;

  -- Link only already-created demo Auth users. This never creates Auth users.
  if to_regclass('public.profiles') is not null then
    insert into public.profiles (id, full_name, email, role, is_active)
    select u.id, coalesce(u.raw_user_meta_data->>'full_name', 'Demo Admin'), u.email, 'admin', true
    from auth.users u where lower(u.email) = 'admin@test.com'
      and not exists (select 1 from public.profiles p where p.id = u.id);
    insert into public.profiles (id, full_name, email, role, is_active)
    select u.id, coalesce(u.raw_user_meta_data->>'full_name', 'Demo HR'), u.email, 'hr', true
    from auth.users u where lower(u.email) = 'hr@test.com'
      and not exists (select 1 from public.profiles p where p.id = u.id);
    insert into public.profiles (id, full_name, email, role, is_active)
    select u.id, coalesce(u.raw_user_meta_data->>'full_name', 'Demo Manager'), u.email, 'manager', true
    from auth.users u where lower(u.email) = 'manager@test.com'
      and not exists (select 1 from public.profiles p where p.id = u.id);
    insert into public.profiles (id, full_name, email, role, is_active)
    select u.id, coalesce(u.raw_user_meta_data->>'full_name', 'Demo Employee'), u.email, 'employee', true
    from auth.users u where lower(u.email) = 'employee@test.com'
      and not exists (select 1 from public.profiles p where p.id = u.id);
  end if;

  demo := jsonb_build_object('id', emp_id, 'organization_id', org_id, 'employee_code', 'KIN-0001', 'first_name', 'Aarav', 'last_name', 'Sharma', 'email', 'admin@test.com', 'employment_type', 'full-time', 'department_id', dept_id, 'designation_id', design_id, 'shift_id', shift_id, 'joining_date', current_date);
  if to_regclass('public.employees') is not null then
    execute 'insert into public.employees select * from jsonb_populate_record(null::public.employees, $1) where not exists (select 1 from public.employees where id = $2)' using demo, emp_id;
    demo := jsonb_set(demo, '{id}', to_jsonb(hr_emp_id)); demo := jsonb_set(demo, '{employee_code}', '"KIN-0002"'); demo := jsonb_set(demo, '{first_name}', '"Meera"'); demo := jsonb_set(demo, '{last_name}', '"Iyer"'); demo := jsonb_set(demo, '{email}', '"hr@test.com"'); execute 'insert into public.employees select * from jsonb_populate_record(null::public.employees, $1) where not exists (select 1 from public.employees where id = $2)' using demo, hr_emp_id;
    demo := jsonb_set(demo, '{id}', to_jsonb(manager_emp_id)); demo := jsonb_set(demo, '{employee_code}', '"KIN-0003"'); demo := jsonb_set(demo, '{first_name}', '"Rohan"'); demo := jsonb_set(demo, '{last_name}', '"Patel"'); demo := jsonb_set(demo, '{email}', '"manager@test.com"'); execute 'insert into public.employees select * from jsonb_populate_record(null::public.employees, $1) where not exists (select 1 from public.employees where id = $2)' using demo, manager_emp_id;
    demo := jsonb_set(demo, '{id}', to_jsonb(employee_emp_id)); demo := jsonb_set(demo, '{employee_code}', '"KIN-0004"'); demo := jsonb_set(demo, '{first_name}', '"Nisha"'); demo := jsonb_set(demo, '{last_name}', '"Kapoor"'); demo := jsonb_set(demo, '{email}', '"employee@test.com"'); execute 'insert into public.employees select * from jsonb_populate_record(null::public.employees, $1) where not exists (select 1 from public.employees where id = $2)' using demo, employee_emp_id;
  end if;

  -- The remaining rows use only deployed tables and are guarded by table existence.
  demo := jsonb_build_object('id', payroll_id, 'organization_id', org_id, 'status', 'paid');
  if to_regclass('public.payroll_runs') is not null then execute 'insert into public.payroll_runs select * from jsonb_populate_record(null::public.payroll_runs, $1) where not exists (select 1 from public.payroll_runs where id = $2)' using demo, payroll_id; end if;
  demo := jsonb_build_object('id', asset_id, 'organization_id', org_id, 'name', 'Demo MacBook Pro', 'category', 'Laptop', 'status', 'available');
  if to_regclass('public.assets') is not null then execute 'insert into public.assets select * from jsonb_populate_record(null::public.assets, $1) where not exists (select 1 from public.assets where id = $2)' using demo, asset_id; end if;
  demo := jsonb_build_object('id', candidate_id, 'name', 'Ishaan Verma', 'email', 'ishaan@example.com', 'source', 'Referral');
  if to_regclass('public.candidates') is not null then execute 'insert into public.candidates select * from jsonb_populate_record(null::public.candidates, $1) where not exists (select 1 from public.candidates where id = $2)' using demo, candidate_id; end if;
  demo := jsonb_build_object('id', interview_id, 'candidate_id', candidate_id, 'status', 'scheduled', 'scheduled_at', now(), 'feedback', 'Initial screening scheduled');
  if to_regclass('public.interviews') is not null then execute 'insert into public.interviews select * from jsonb_populate_record(null::public.interviews, $1) where not exists (select 1 from public.interviews where id = $2)' using demo, interview_id; end if;
  demo := jsonb_build_object('id', offer_id, 'candidate_id', candidate_id, 'status', 'draft', 'joining_date', current_date + 30);
  if to_regclass('public.offers') is not null then execute 'insert into public.offers select * from jsonb_populate_record(null::public.offers, $1) where not exists (select 1 from public.offers where id = $2)' using demo, offer_id; end if;
  demo := jsonb_build_object('id', goal_id, 'employee_id', employee_emp_id, 'title', 'Improve onboarding experience', 'description', 'Reduce new-hire setup time', 'status', 'on-track', 'category', 'Business', 'progress', 40, 'weight', 20, 'due_date', current_date + 90);
  if to_regclass('public.goals') is not null then execute 'insert into public.goals select * from jsonb_populate_record(null::public.goals, $1) where not exists (select 1 from public.goals where id = $2)' using demo, goal_id; end if;
  demo := jsonb_build_object('id', review_id, 'employee_id', employee_emp_id, 'status', 'in-progress', 'feedback', 'Quarterly review in progress', 'final_rating', 4.2);
  if to_regclass('public.performance_reviews') is not null then execute 'insert into public.performance_reviews select * from jsonb_populate_record(null::public.performance_reviews, $1) where not exists (select 1 from public.performance_reviews where id = $2)' using demo, review_id; end if;
end $$;
