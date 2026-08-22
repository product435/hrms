-- Employee Complaints feature. New, standalone table -- no existing HRMS
-- table is touched.
create table if not exists public.employee_complaints (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  subject text not null,
  category text,
  description text not null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in-progress', 'resolved', 'closed')),
  assigned_to uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_employee_complaints_employee on public.employee_complaints(employee_id);

drop trigger if exists set_updated_at on public.employee_complaints;
create trigger set_updated_at before update on public.employee_complaints
  for each row execute function public.set_updated_at();

alter table public.employee_complaints enable row level security;

-- Employee: insert + read only their own complaints.
create policy employee_complaints_self_select on public.employee_complaints for select
  using (employee_id = current_employee_id());
create policy employee_complaints_self_insert on public.employee_complaints for insert
  with check (employee_id = current_employee_id());

-- HR/Admin: full read + manage (status, assigned_to) within their own
-- organization only -- same org-scoping pattern as every other child table.
create policy employee_complaints_admin_hr_all on public.employee_complaints for all
  using (
    is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = employee_complaints.employee_id and e.organization_id = current_org_id()
    )
  )
  with check (
    is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = employee_complaints.employee_id and e.organization_id = current_org_id()
    )
  );

-- Manager gets no dedicated policy: the requirement is "tab may be visible,
-- but no HR/Admin complaint-management access" -- a manager only sees rows
-- via the self-select policy above (their own complaints, if any), never a
-- direct report's or anyone else's.

-- Raising a complaint requires notifying every HR/Admin user in the same
-- organization. An employee's own session can't do that directly: they have
-- no SELECT on other users' profiles and notifications RLS only allows
-- inserting rows for yourself (both correctly, and neither should be
-- loosened just for this feature). A SECURITY DEFINER RPC does the insert +
-- fan-out atomically with elevated privilege, the same pattern already used
-- for current_org_id()/is_admin_or_hr() etc.
create or replace function public.create_employee_complaint(
  p_subject text,
  p_category text,
  p_description text,
  p_priority text default 'medium'
)
returns public.employee_complaints
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_org_id uuid;
  v_employee_name text;
  v_complaint public.employee_complaints;
  v_recipient uuid;
begin
  v_employee_id := current_employee_id();
  if v_employee_id is null then
    raise exception 'No linked employee profile for the current user.';
  end if;
  v_org_id := current_org_id();

  select first_name || ' ' || last_name into v_employee_name
  from public.employees where id = v_employee_id;

  insert into public.employee_complaints (employee_id, subject, category, description, priority, status)
  values (v_employee_id, p_subject, p_category, p_description, coalesce(nullif(p_priority, ''), 'medium'), 'open')
  returning * into v_complaint;

  for v_recipient in
    select p.id
    from public.profiles p
    join public.employees e on e.id = p.employee_id
    where e.organization_id = v_org_id
      and lower(p.role) in ('admin', 'hr')
      and coalesce(p.is_active, true)
  loop
    insert into public.notifications (user_id, title, message, type, reference_id, reference_type)
    values (
      v_recipient,
      'New complaint: ' || p_subject,
      coalesce(v_employee_name, 'An employee') || ' raised a ' || v_complaint.priority || ' priority complaint (status: ' || v_complaint.status || ').',
      'system',
      v_employee_id,
      'employee_complaint'
    );
  end loop;

  return v_complaint;
end;
$$;

grant execute on function public.create_employee_complaint(text, text, text, text) to authenticated;
