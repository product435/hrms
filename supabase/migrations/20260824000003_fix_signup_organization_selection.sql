-- Root cause of "new employee is incomplete": handle_new_user() picked the
-- organization by `order by created_at limit 1` -- the OLDEST org row. Live
-- data has two organizations: "Kinetix Technologies" (created 2026-08-19,
-- zero employees/departments/data -- orphaned bootstrap debris) and
-- "Jeevijay Technologies" (created 2026-08-21, every real seeded record).
-- Every new sign-up was silently linked to the empty orphaned org, so
-- org-scoped RLS (leave_types_read_all, assets_read_all, departments_read_all,
-- ...) correctly returned nothing for them -- confirmed live by creating a
-- real test signup and inspecting its employees.organization_id directly.
--
-- Fixed by picking the organization with the most existing employees (i.e.
-- the one actually in use) instead of the oldest row. No data is deleted;
-- this only changes which organization a *future* sign-up resolves to. A
-- brand-new, genuinely empty database still falls through to the existing
-- "no organization yet" branch below, unchanged.
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
      -- Profile creation remains successful; the repair migration can link
      -- an existing employee later without rolling back Auth user creation.
      null;
    end;
  end if;

  return new;
end;
$$;
