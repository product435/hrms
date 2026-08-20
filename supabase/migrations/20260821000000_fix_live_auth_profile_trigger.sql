-- Live-schema auth repair.
-- The deployed database uses profiles.role, profiles.employee_id and
-- employees.profile_id. It does not use profiles.role_id or employees.user_id.
-- No tables, columns, constraints or roles are created by this migration.

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

  -- If an organization already exists, create the matching employee row.
  -- The guarded block keeps Auth signup usable for a brand-new empty tenant.
  select id into organization_uuid
  from public.organizations
  order by created_at
  limit 1;

  if organization_uuid is not null then
    begin
      insert into public.employees (
        organization_id, profile_id, employee_code, first_name, last_name,
        email, employment_type
      )
      values (
        organization_uuid,
        new.id,
        'USR-' || upper(substr(replace(new.id::text, '-', ''), 1, 8)),
        coalesce(split_part(new.raw_user_meta_data->>'full_name', ' ', 1), 'New'),
        coalesce(nullif(split_part(new.raw_user_meta_data->>'full_name', ' ', 2), ''), 'Employee'),
        coalesce(new.email, ''),
        'full-time'
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, full_name, email, role)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  coalesce(u.email, ''),
  'employee'
from auth.users u
on conflict (id) do update
set email = excluded.email,
    full_name = case
      when coalesce(public.profiles.full_name, '') = '' then excluded.full_name
      else public.profiles.full_name
    end,
    updated_at = now();

update public.employees e
set profile_id = u.id,
    updated_at = now()
from auth.users u
where e.profile_id is null
  and lower(e.email) = lower(u.email)
  and not exists (
    select 1 from public.employees linked where linked.profile_id = u.id
  );

update public.profiles p
set employee_id = e.id,
    updated_at = now()
from public.employees e
where p.id = e.profile_id
  and p.employee_id is null;
