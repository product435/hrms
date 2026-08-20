-- Repair existing Auth users against the existing HRMS schema.
-- This migration only links existing rows; it does not create tables or users.

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
    role = coalesce(public.profiles.role, excluded.role),
    updated_at = now();

update public.employees e
set profile_id = u.id,
    updated_at = now()
from auth.users u
where e.profile_id is null
  and lower(e.email) = lower(u.email)
  and not exists (select 1 from public.employees linked where linked.profile_id = u.id);

update public.profiles p
set employee_id = e.id,
    updated_at = now()
from public.employees e
where p.id = e.profile_id
  and p.employee_id is null;
