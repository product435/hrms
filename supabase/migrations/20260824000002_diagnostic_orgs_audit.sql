create or replace function public.debug_all_organizations()
returns table(id uuid, name text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select o.id, o.name, o.created_at from public.organizations o order by o.created_at asc;
$$;
