-- Password-reset responses are identical for unknown, employee, and admin
-- emails. Non-admins still queue a PENDING request. Admins do not. Recent
-- recovery tokens for non-admins are cleared so the client can call Auth
-- recover for every address without learning which emails are admins.
-- Sign-up attaches an unlinked employee with the same work email instead of
-- inserting a second row. Work email is unique when the table is clean.

create or replace function public.request_password_reset(p_email text)
returns table(is_admin_account boolean, request_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_auth_id uuid;
  v_user_id uuid;
  v_employee_id uuid;
  v_role text;
  v_request_id uuid;
  v_recipient uuid;
begin
  v_email := lower(trim(coalesce(p_email, '')));

  if v_email = '' then
    return query select false, null::uuid;
    return;
  end if;

  select u.id, p.id, p.employee_id, lower(coalesce(p.role, ''))
    into v_auth_id, v_user_id, v_employee_id, v_role
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(trim(u.email)) = v_email
  limit 1;

  if v_auth_id is null then
    select p.id, p.employee_id, lower(coalesce(p.role, ''))
      into v_user_id, v_employee_id, v_role
    from public.profiles p
    where lower(trim(p.email)) = v_email
    limit 1;
  end if;

  if v_employee_id is null and v_user_id is not null then
    select e.id into v_employee_id
    from public.employees e
    where e.profile_id = v_user_id
    limit 1;
  end if;

  if v_user_id is not null and v_role is distinct from 'admin' then
    select id into v_request_id
    from public.password_reset_requests
    where lower(email) = v_email and status = 'PENDING'
    limit 1;

    if v_request_id is null then
      insert into public.password_reset_requests (user_id, employee_id, email, status)
      values (coalesce(v_auth_id, v_user_id), v_employee_id, v_email, 'PENDING')
      returning id into v_request_id;

      for v_recipient in
        select p.id
        from public.profiles p
        where lower(p.role) = 'admin' and coalesce(p.is_active, true)
      loop
        insert into public.notifications (user_id, title, message, type, reference_id, reference_type)
        values (
          v_recipient,
          'Password reset request',
          v_email || ' requested a password reset.',
          'system',
          v_request_id,
          'password_reset_request'
        );
      end loop;
    end if;
  end if;

  if v_auth_id is not null and v_role is distinct from 'admin' then
    begin
      update auth.users
      set recovery_token = '',
          recovery_sent_at = null
      where id = v_auth_id
        and recovery_sent_at is not null
        and recovery_sent_at > now() - interval '2 minutes';
    exception
      when others then
        null;
    end;

    begin
      delete from auth.one_time_tokens
      where user_id = v_auth_id
        and token_type::text = 'recovery_token'
        and created_at > now() - interval '2 minutes';
    exception
      when others then
        null;
    end;
  end if;

  return query select false, null::uuid;
end;
$$;

grant execute on function public.request_password_reset(text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_uuid uuid;
  organization_uuid uuid;
  v_email text;
  v_existing_profile uuid;
  v_status text;
begin
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
    v_email := nullif(lower(trim(coalesce(new.email, ''))), '');

    if v_email is not null then
      select e.id, e.employment_status
        into employee_uuid, v_status
      from public.employees e
      where e.organization_id = organization_uuid
        and e.email is not null
        and lower(trim(e.email)) = v_email
        and e.profile_id is null
      order by e.created_at nulls last, e.id
      limit 1
      for update;

      if employee_uuid is not null then
        update public.employees
        set profile_id = new.id
        where id = employee_uuid
          and profile_id is null;

        if found then
          update public.profiles
          set employee_id = employee_uuid
          where id = new.id;

          if v_status in ('pending_approval', 'profile_changes_requested') then
            insert into public.onboarding_submissions (employee_id, organization_id, status)
            values (employee_uuid, organization_uuid, 'draft')
            on conflict (employee_id) do nothing;
          end if;

          return new;
        end if;

        employee_uuid := null;
      end if;

      select e.profile_id
        into v_existing_profile
      from public.employees e
      where e.organization_id = organization_uuid
        and e.email is not null
        and lower(trim(e.email)) = v_email
        and e.profile_id is not null
      limit 1;

      if v_existing_profile is not null then
        if v_existing_profile = new.id then
          update public.profiles p
          set employee_id = e.id
          from public.employees e
          where p.id = new.id
            and e.profile_id = new.id
            and e.organization_id = organization_uuid;
          return new;
        end if;

        raise exception 'An account for this work email already exists. Sign in or use forgot password.';
      end if;
    end if;

    begin
      insert into public.employees (
        organization_id, profile_id, employee_code, first_name, last_name,
        email, employment_type, employment_status, nationality
      )
      values (
        organization_uuid,
        new.id,
        'USR-' || upper(substr(replace(new.id::text, '-', ''), 1, 8)),
        coalesce(split_part(new.raw_user_meta_data->>'full_name', ' ', 1), 'New'),
        coalesce(nullif(split_part(new.raw_user_meta_data->>'full_name', ' ', 2), ''), 'Employee'),
        coalesce(new.email, ''),
        'full-time',
        'pending_approval',
        'Indian'
      )
      returning id into employee_uuid;

      update public.profiles
      set employee_id = employee_uuid
      where id = new.id;

      insert into public.onboarding_submissions (employee_id, organization_id, status)
      values (employee_uuid, organization_uuid, 'draft')
      on conflict (employee_id) do nothing;
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$$;

do $body$
begin
  if exists (
    select 1
    from (
      select lower(trim(email)) as normalized_email
      from public.employees
      where email is not null
      group by lower(trim(email))
      having count(*) > 1
    ) duplicates
  ) then
    raise notice 'employees.email has duplicate work emails; unique index employees_work_email_unique skipped.';
    return;
  end if;

  create unique index if not exists employees_work_email_unique
    on public.employees (lower(trim(email)))
    where email is not null;
exception
  when unique_violation then
    raise notice 'employees.email has duplicate work emails; unique index employees_work_email_unique skipped.';
end
$body$;
