-- Auth-only repair for the existing deployed profiles shape.
-- This does not create or alter tables, columns, keys, constraints, or seed data.
-- Run this migration in the existing Supabase project.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
