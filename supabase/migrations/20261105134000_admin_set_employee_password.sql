-- Super Admin can set another employee's sign-in password directly.
-- The password is hashed in the database and never written to audit logs,
-- notifications, or the function result. Existing sessions for that account
-- are revoked so the previous password stops working.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_set_employee_password(
  p_employee_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_org uuid;
  v_employee_org uuid;
  v_user_id uuid;
  v_email text;
  v_name text;
begin
  if public.is_admin() is not true then
    raise exception 'Only a Super Admin can change someone else''s password.';
  end if;

  if p_employee_id is null then
    raise exception 'Choose an employee.';
  end if;

  if p_password is null
     or octet_length(p_password) < 8
     or octet_length(p_password) > 72
     or p_password !~ '[A-Z]'
     or p_password !~ '[a-z]'
     or p_password !~ '[0-9]'
     or p_password !~ '[^A-Za-z0-9]' then
    raise exception 'Password does not meet the requirements.';
  end if;

  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'Your account is not linked to an organisation.';
  end if;

  select e.organization_id, e.profile_id, lower(btrim(coalesce(e.email, ''))),
         btrim(concat_ws(' ', e.first_name, e.last_name))
    into v_employee_org, v_user_id, v_email, v_name
  from public.employees e
  where e.id = p_employee_id;

  if v_employee_org is null then
    raise exception 'Employee not found.';
  end if;

  if v_employee_org is distinct from v_org then
    raise exception 'That employee is not in your organisation.';
  end if;

  if v_user_id is null and v_email <> '' then
    select u.id into v_user_id
    from auth.users u
    where lower(btrim(u.email)) = v_email
    limit 1;
  end if;

  if v_user_id is null then
    raise exception 'This employee has not created a login yet.';
  end if;

  if v_user_id = auth.uid() then
    raise exception 'Change your own password from Settings.';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
      updated_at = now()
  where id = v_user_id;

  if not found then
    raise exception 'This employee has not created a login yet.';
  end if;

  begin
    update auth.refresh_tokens
    set revoked = true
    where user_id::text = v_user_id::text
      and revoked is distinct from true;
  exception
    when undefined_table or undefined_column then
      null;
  end;

  begin
    delete from auth.sessions where user_id = v_user_id;
  exception
    when undefined_table or undefined_column then
      null;
  end;

  update public.password_reset_requests
  set status = 'COMPLETED',
      approved_by = auth.uid(),
      approved_at = coalesce(approved_at, now())
  where status in ('PENDING', 'APPROVED')
    and (user_id = v_user_id or employee_id = p_employee_id);

  insert into public.notifications (user_id, title, message, type, reference_id, reference_type)
  values (
    v_user_id,
    'Password changed',
    'A Super Admin changed your sign-in password. Sign in with the new password. If you did not expect this, contact your administrator.',
    'system',
    p_employee_id,
    'employee'
  );

  perform public.log_audit_event(
    'admin_set_password',
    'employees',
    p_employee_id,
    null,
    jsonb_build_object(
      'target_user_id', v_user_id,
      'employee_name', nullif(v_name, ''),
      'sessions_revoked', true
    )
  );
end;
$$;

revoke all on function public.admin_set_employee_password(uuid, text) from public, anon;
grant execute on function public.admin_set_employee_password(uuid, text) to authenticated;
