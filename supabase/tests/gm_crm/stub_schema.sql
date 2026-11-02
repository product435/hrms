-- Roles are cluster-wide; created by run.sh when missing.
-- Minimal stand-in for the live Supabase schema: only what the two new
-- migrations reference. Not a copy of production.
create schema auth;
create schema storage;
grant usage on schema auth, storage, public to anon, authenticated, service_role;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to public;

create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;

create table public.roles (id uuid primary key, name text, description text);
create table public.organizations (id uuid primary key default gen_random_uuid(), name text, created_at timestamptz default now());
create table public.profiles (id uuid primary key, full_name text, email text, role text, employee_id uuid, updated_at timestamptz);
create table public.departments (id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id), name text, manager_id uuid);
create table public.designations (id uuid primary key default gen_random_uuid(), organization_id uuid, name text);
create table public.employees (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id),
  profile_id uuid references public.profiles(id), department_id uuid references public.departments(id),
  manager_id uuid references public.employees(id), first_name text, last_name text, employee_code text,
  employment_status text default 'active', email text);
create table public.announcements (id uuid primary key default gen_random_uuid(), target_scope text, target_department_id uuid, target_role text);
create table public.documents (id uuid primary key default gen_random_uuid(), employee_id uuid, category text);
create table public.emergency_contacts (id uuid primary key default gen_random_uuid(), employee_id uuid);
create table public.employee_addresses (id uuid primary key default gen_random_uuid(), employee_id uuid);
create table public.employee_bank_accounts (id uuid primary key default gen_random_uuid(), employee_id uuid);
create table public.employee_education (id uuid primary key default gen_random_uuid(), employee_id uuid);
create table public.employee_experience (id uuid primary key default gen_random_uuid(), employee_id uuid);
create table public.employee_family_members (id uuid primary key default gen_random_uuid(), employee_id uuid);
create table public.helpdesk_tickets (id uuid primary key default gen_random_uuid(), employee_id uuid);
create table public.expense_claims (id uuid primary key default gen_random_uuid(), employee_id uuid);
create table public.team_daily_summaries (id uuid primary key default gen_random_uuid(), organization_id uuid, lead_employee_id uuid, department_id uuid);
create table public.projects (id uuid primary key default gen_random_uuid(), organization_id uuid, owner_id uuid);
create table public.project_members (id uuid primary key default gen_random_uuid(), project_id uuid);
create table public.daily_work_reports (
  id uuid primary key default gen_random_uuid(), organization_id uuid, employee_id uuid references public.employees(id),
  report_date date, status text, total_hours numeric default 0, review_status text default 'pending', lead_rating smallint);

create function public.current_user_role() returns text language sql stable security definer set search_path = public as
  $$ select role from public.profiles where id = auth.uid() $$;
create function public.current_employee_id() returns uuid language sql stable security definer set search_path = public as
  $$ select id from public.employees where profile_id = auth.uid() limit 1 $$;
create function public.current_org_id() returns uuid language sql stable security definer set search_path = public as
  $$ select organization_id from public.employees where profile_id = auth.uid() limit 1 $$;
create function public.dwr_actor_org() returns uuid language sql stable security definer set search_path = public as
  $$ select public.current_org_id() $$;
create function public.is_admin() returns boolean language sql stable as $$ select public.current_user_role() = 'admin' $$;
create function public.is_admin_or_hr() returns boolean language sql stable as $$ select public.current_user_role() in ('admin','hr') $$;
create function public.is_lead() returns boolean language sql stable as $$ select public.current_user_role() in ('dept_head','team_lead') $$;
create function public.is_project_member(uuid) returns boolean language sql stable as $$ select false $$;
create function public.can_view_employee(emp_id uuid) returns boolean language sql stable as $$ select false $$;
create function public.can_manage_employee(emp_id uuid) returns boolean language sql stable as $$ select false $$;
create function public.log_audit_event(text, text, uuid, jsonb, jsonb) returns void language sql as $$ select $$;
create function public.log_employee_assignment(uuid, text) returns void language sql as $$ select $$;

-- Existing RLS on employees/profiles/daily_work_reports (simplified live shape).
alter table public.employees enable row level security;
create policy employees_manager_view_team on public.employees for select using (public.can_view_employee(id));
alter table public.daily_work_reports enable row level security;
create policy daily_work_reports_select on public.daily_work_reports for select
  using (organization_id = public.dwr_actor_org() and public.can_view_employee(employee_id));
alter table public.employee_bank_accounts enable row level security;
alter table public.documents enable row level security;
alter table public.departments enable row level security;
create policy departments_org_select on public.departments for select using (organization_id = public.current_org_id());
grant select, insert, update, delete on all tables in schema public to authenticated;
