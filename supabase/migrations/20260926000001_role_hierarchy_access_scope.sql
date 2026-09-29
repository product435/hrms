-- Phase 0: five-level roles. Stored value stays `admin` (UI: Super Admin).
-- Existing `profiles.role = 'manager'` becomes `team_lead`.
-- Payroll and salary policies are left as admin + hr + self.

-- ------------------------------------------------------------
-- 1. Data + allowed role values (before the guard trigger exists)
-- ------------------------------------------------------------

update public.profiles
set role = 'team_lead'
where lower(role) = 'manager';

do $$
declare
  r record;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'role'
  ) then
    execute $sql$
      update public.employees
      set role = 'team_lead'
      where lower(role) = 'manager'
    $sql$;
  end if;

  for r in
    select c.conname
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any (c.conkey)
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'c'
      and a.attname = 'role'
  loop
    execute format('alter table public.profiles drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role is null or role in ('admin', 'hr', 'dept_head', 'team_lead', 'employee'));

insert into public.roles (id, name, description)
select gen_random_uuid(), 'dept_head', 'Department Head'
where not exists (select 1 from public.roles where name = 'dept_head');

insert into public.roles (id, name, description)
select gen_random_uuid(), 'team_lead', 'Team Lead'
where not exists (select 1 from public.roles where name = 'team_lead');

-- ------------------------------------------------------------
-- 2. Role helpers. is_manager() stays as the name policies already call.
-- ------------------------------------------------------------

create or replace function public.is_dept_head()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'dept_head';
$$;

create or replace function public.is_team_lead()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('team_lead', 'manager');
$$;

create or replace function public.is_lead()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_dept_head() or public.is_team_lead();
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_lead();
$$;

create or replace function public.can_view_employee(emp_id uuid)
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
    and public.can_view_employee(emp_id)
    and not (
      public.current_user_role() = 'hr'
      and exists (
        select 1
        from public.employees e
        join public.profiles p on p.id = e.profile_id
        where e.id = emp_id
          and p.role = 'admin'
      )
    );
$$;

-- ------------------------------------------------------------
-- 3. Assignment history (role, department, reporting lead)
-- ------------------------------------------------------------

create table if not exists public.employee_assignment_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  manager_id uuid references public.employees(id) on delete set null,
  role text,
  effective_from date not null default current_date,
  effective_to date,
  change_type text not null check (change_type in ('initial', 'role', 'department', 'manager')),
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_employee_assignment_history_employee
  on public.employee_assignment_history (employee_id, effective_from);

alter table public.employee_assignment_history enable row level security;

drop policy if exists employee_assignment_history_select on public.employee_assignment_history;
create policy employee_assignment_history_select
  on public.employee_assignment_history
  for select
  using (public.can_view_employee(employee_id));

create or replace function public.log_employee_assignment(p_employee_id uuid, p_change_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_department uuid;
  v_manager uuid;
  v_role text;
begin
  if p_change_type not in ('initial', 'role', 'department', 'manager') then
    raise exception 'Invalid assignment change type.';
  end if;

  select e.organization_id, e.department_id, e.manager_id, p.role
    into v_org, v_department, v_manager, v_role
  from public.employees e
  left join public.profiles p on p.id = e.profile_id
  where e.id = p_employee_id;

  if not found then
    return;
  end if;

  update public.employee_assignment_history
  set effective_to = current_date
  where employee_id = p_employee_id
    and change_type = p_change_type
    and effective_to is null
    and effective_from < current_date;

  if exists (
    select 1
    from public.employee_assignment_history
    where employee_id = p_employee_id
      and change_type = p_change_type
      and effective_to is null
      and effective_from = current_date
  ) then
    update public.employee_assignment_history
    set organization_id = v_org,
        department_id = v_department,
        manager_id = v_manager,
        role = v_role,
        changed_by = auth.uid()
    where employee_id = p_employee_id
      and change_type = p_change_type
      and effective_to is null
      and effective_from = current_date;
    return;
  end if;

  insert into public.employee_assignment_history (
    employee_id, organization_id, department_id, manager_id, role,
    effective_from, change_type, changed_by
  ) values (
    p_employee_id, v_org, v_department, v_manager, v_role,
    current_date, p_change_type, auth.uid()
  );
end;
$$;

create or replace function public.employee_assignment_history_on_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_employee_assignment(new.id, 'initial');
    return new;
  end if;

  if new.department_id is distinct from old.department_id then
    perform public.log_employee_assignment(new.id, 'department');
  end if;
  if new.manager_id is distinct from old.manager_id then
    perform public.log_employee_assignment(new.id, 'manager');
  end if;
  return new;
end;
$$;

drop trigger if exists employee_assignment_history_trigger on public.employees;
create trigger employee_assignment_history_trigger
  after insert or update of department_id, manager_id on public.employees
  for each row
  execute function public.employee_assignment_history_on_employee();

insert into public.employee_assignment_history (
  employee_id, organization_id, department_id, manager_id, role, effective_from, change_type
)
select
  e.id,
  e.organization_id,
  e.department_id,
  e.manager_id,
  pr.role,
  coalesce(e.joining_date, current_date),
  'initial'
from public.employees e
left join public.profiles pr on pr.id = e.profile_id
where not exists (
  select 1
  from public.employee_assignment_history h
  where h.employee_id = e.id
);

-- ------------------------------------------------------------
-- 4. Role changes go through set_employee_role only
-- ------------------------------------------------------------

create or replace function public.block_direct_profile_role_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('app.allow_role_update', true), '') is distinct from 'on' then
    raise exception 'Role changes must go through set_employee_role().';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_block_direct_role_update on public.profiles;
create trigger profiles_block_direct_role_update
  before update of role on public.profiles
  for each row
  execute function public.block_direct_profile_role_update();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_uuid uuid;
  organization_uuid uuid;
begin
  -- Signup may fill a null role with employee. The flag is transaction-local.
  perform set_config('app.allow_role_update', 'on', true);

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    'employee'
  )
  on conflict (id) do update
    set full_name = case
      when coalesce(public.profiles.full_name, '') = '' then excluded.full_name
      else public.profiles.full_name
    end,
    email = excluded.email,
    role = coalesce(public.profiles.role, excluded.role);

  select e.organization_id into organization_uuid
  from public.employees e
  where e.organization_id is not null
  group by e.organization_id
  order by count(*) desc
  limit 1;

  if organization_uuid is null then
    select id into organization_uuid
    from public.organizations
    order by created_at
    limit 1;
  end if;

  if organization_uuid is not null then
    begin
      insert into public.employees (
        organization_id, profile_id, employee_code, first_name, last_name,
        email, employment_type, employment_status
      )
      values (
        organization_uuid,
        new.id,
        'USR-' || upper(substr(replace(new.id::text, '-', ''), 1, 8)),
        coalesce(split_part(new.raw_user_meta_data->>'full_name', ' ', 1), 'New'),
        coalesce(nullif(split_part(new.raw_user_meta_data->>'full_name', ' ', 2), ''), 'Employee'),
        coalesce(new.email, ''),
        'full-time',
        'active'
      )
      returning id into employee_uuid;

      update public.profiles
      set employee_id = employee_uuid
      where id = new.id;
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$$;

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
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only a super admin can change roles.';
  end if;

  if p_role not in ('admin', 'hr', 'dept_head', 'team_lead', 'employee') then
    raise exception 'Invalid role.';
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

  perform public.log_employee_assignment(p_employee_id, 'role');
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

revoke all on function public.log_employee_assignment(uuid, text) from public, anon, authenticated;
revoke all on function public.block_direct_profile_role_update() from public, anon, authenticated;
revoke all on function public.employee_assignment_history_on_employee() from public, anon, authenticated;

grant execute on function public.is_dept_head() to authenticated, service_role;
grant execute on function public.is_team_lead() to authenticated, service_role;
grant execute on function public.is_lead() to authenticated, service_role;
grant execute on function public.can_view_employee(uuid) to authenticated, service_role;
grant execute on function public.can_manage_employee(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 5. Lead scope: department for a department head, direct reports for a team lead.
--    Salary, payroll, and payslips are intentionally not touched.
-- ------------------------------------------------------------

drop policy if exists employees_manager_view_team on public.employees;
create policy employees_manager_view_team on public.employees
  for select
  using (public.can_view_employee(id));

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
    )
  );

drop policy if exists profiles_manager_view_team on public.profiles;
create policy profiles_manager_view_team on public.profiles
  for select
  using (employee_id is not null and public.can_view_employee(employee_id));

drop policy if exists attendance_records_manager_view_team on public.attendance_records;
create policy attendance_records_manager_view_team on public.attendance_records
  for select
  using (public.can_view_employee(employee_id));

drop policy if exists attendance_records_manager_update_team on public.attendance_records;
create policy attendance_records_manager_update_team on public.attendance_records
  for update
  using (public.can_manage_employee(employee_id))
  with check (public.can_manage_employee(employee_id));

drop policy if exists attendance_corrections_manager_view_team on public.attendance_corrections;
create policy attendance_corrections_manager_view_team on public.attendance_corrections
  for select
  using (public.can_view_employee(employee_id));

drop policy if exists attendance_corrections_manager_update_team on public.attendance_corrections;
create policy attendance_corrections_manager_update_team on public.attendance_corrections
  for update
  using (public.can_manage_employee(employee_id))
  with check (public.can_manage_employee(employee_id));

drop policy if exists leave_requests_manager_view_team on public.leave_requests;
create policy leave_requests_manager_view_team on public.leave_requests
  for select
  using (public.can_view_employee(employee_id));

drop policy if exists leave_requests_manager_update_team on public.leave_requests;
create policy leave_requests_manager_update_team on public.leave_requests
  for update
  using (public.can_manage_employee(employee_id))
  with check (public.can_manage_employee(employee_id));

drop policy if exists leave_ledger_manager_view_team on public.leave_ledger;
create policy leave_ledger_manager_view_team on public.leave_ledger
  for select
  using (public.can_view_employee(employee_id));

drop policy if exists expense_claims_manager_view_team on public.expense_claims;
create policy expense_claims_manager_view_team on public.expense_claims
  for select
  using (public.can_view_employee(employee_id));

drop policy if exists expense_claims_manager_update_team on public.expense_claims;
create policy expense_claims_manager_update_team on public.expense_claims
  for update
  using (public.can_manage_employee(employee_id))
  with check (public.can_manage_employee(employee_id));

drop policy if exists goals_manager_view_team on public.goals;
create policy goals_manager_view_team on public.goals
  for select
  using (public.can_view_employee(employee_id));

drop policy if exists goals_manager_update_team on public.goals;
create policy goals_manager_update_team on public.goals
  for update
  using (public.can_manage_employee(employee_id))
  with check (public.can_manage_employee(employee_id));

drop policy if exists performance_reviews_manager_view_team on public.performance_reviews;
create policy performance_reviews_manager_view_team on public.performance_reviews
  for select
  using (public.can_view_employee(employee_id));

drop policy if exists performance_reviews_manager_update_team on public.performance_reviews;
create policy performance_reviews_manager_update_team on public.performance_reviews
  for update
  using (public.can_manage_employee(employee_id))
  with check (public.can_manage_employee(employee_id));

drop policy if exists documents_manager_view_team on public.documents;
create policy documents_manager_view_team on public.documents
  for select
  using (public.can_view_employee(employee_id));

drop policy if exists helpdesk_tickets_lead_select on public.helpdesk_tickets;
create policy helpdesk_tickets_lead_select on public.helpdesk_tickets
  for select
  using (public.can_view_employee(employee_id));

drop policy if exists helpdesk_tickets_lead_update on public.helpdesk_tickets;
create policy helpdesk_tickets_lead_update on public.helpdesk_tickets
  for update
  using (public.can_manage_employee(employee_id))
  with check (public.can_manage_employee(employee_id));

drop policy if exists employee_documents_manager_select on storage.objects;
create policy employee_documents_manager_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1
      from public.employees e
      where e.id::text = split_part(name, '/', 1)
        and public.can_view_employee(e.id)
        and e.id is distinct from public.current_employee_id()
    )
  );

create or replace function public.submit_manager_review(p_review_id uuid, p_manager_rating numeric, p_feedback text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_rating numeric;
  v_employee_id uuid;
begin
  select self_rating, employee_id into v_self_rating, v_employee_id
  from public.performance_reviews
  where id = p_review_id;

  if v_employee_id is null then
    raise exception 'Review not found.';
  end if;
  if not public.can_manage_employee(v_employee_id) then
    raise exception 'Only the reviewing lead, admin or HR can submit this score.';
  end if;
  if p_manager_rating < 0 or p_manager_rating > 5 then
    raise exception 'Score must be between 0 and 5.';
  end if;

  update public.performance_reviews
  set manager_rating = p_manager_rating,
      feedback = nullif(trim(coalesce(p_feedback, '')), ''),
      status = case when v_self_rating is not null then 'completed' else 'in-progress' end,
      final_rating = case when v_self_rating is not null then round((v_self_rating + p_manager_rating) / 2, 2) else final_rating end,
      reviewed_at = now()
  where id = p_review_id;

  perform public.log_audit_event(
    'submit_manager_review',
    'performance_reviews',
    p_review_id,
    null,
    jsonb_build_object('manager_rating', p_manager_rating)
  );
end;
$$;
