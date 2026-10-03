-- Promote Lakshay Saxena to admin.
-- set_employee_role requires auth.uid(), which is null inside a migration,
-- so this repeats that function's writes: allow the role update, change only
-- this profile, and record the same audit event.

do $$
declare
  v_employee uuid := 'a7556eb9-0d19-4c1b-8fe4-eb80d58e384c';
  v_profile uuid;
  v_org uuid;
  v_old text;
  v_name text;
begin
  select p.id, e.organization_id, p.role, btrim(e.first_name || ' ' || e.last_name)
    into v_profile, v_org, v_old, v_name
  from public.employees e
  join public.profiles p on p.id = e.profile_id
  where e.id = v_employee
  limit 1
  for update of p;

  if v_profile is null then
    select p.id, e.organization_id, p.role, btrim(e.first_name || ' ' || e.last_name)
      into v_profile, v_org, v_old, v_name
    from public.employees e
    join public.profiles p on p.employee_id = e.id
    where e.id = v_employee
    limit 1
    for update of p;
  end if;

  if v_profile is null or v_name is distinct from 'Lakshay Saxena' then
    raise exception 'Lakshay Saxena was not found for employee %.', v_employee;
  end if;

  if v_old is not distinct from 'admin' then
    return;
  end if;

  perform set_config('app.allow_role_update', 'on', true);

  update public.profiles
  set role = 'admin',
      updated_at = now()
  where id = v_profile
    and id in (
      select e.profile_id from public.employees e where e.id = v_employee
      union
      select p.id from public.profiles p where p.employee_id = v_employee
    );

  if to_regprocedure('public.log_employee_assignment(uuid, text)') is not null then
    perform public.log_employee_assignment(v_employee, 'role');
  end if;

  insert into public.audit_logs (
    organization_id,
    user_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data
  )
  values (
    v_org,
    null,
    'set_employee_role',
    'profiles',
    v_profile,
    jsonb_build_object('role', v_old),
    jsonb_build_object(
      'role', 'admin',
      'employee_id', v_employee,
      'source', 'migration_20261003120400'
    )
  );
end
$$;
