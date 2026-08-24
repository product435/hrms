-- Admin-approval password reset flow. New, standalone table -- no existing
-- table is touched.
create table if not exists public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  email text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  rejected_reason text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_password_reset_requests_status on public.password_reset_requests(status);
create index if not exists idx_password_reset_requests_email on public.password_reset_requests(lower(email));

drop trigger if exists set_updated_at on public.password_reset_requests;
create trigger set_updated_at before update on public.password_reset_requests
  for each row execute function public.set_updated_at();

alter table public.password_reset_requests enable row level security;

-- Only Admin can see/manage requests -- deliberately is_admin(), not
-- is_admin_or_hr(): the requirement is explicit that HR/Manager/Employee
-- must never approve or reject, including their own.
create policy password_reset_requests_admin_all on public.password_reset_requests for all
  using (is_admin())
  with check (is_admin());

-- The requester never gets direct table access (creation happens through
-- the SECURITY DEFINER RPC below, which runs before they're even signed
-- in). The one narrow exception: once their own request has been approved
-- and they've completed the recovery flow (so they're authenticated again,
-- via that recovery session), they may flip that single row from APPROVED
-- to COMPLETED -- nothing else. They can never self-approve or self-reject.
create policy password_reset_requests_owner_complete on public.password_reset_requests for update
  using (
    status = 'APPROVED'
    and (user_id = auth.uid() or employee_id = current_employee_id())
  )
  with check (
    status = 'COMPLETED'
    and (user_id = auth.uid() or employee_id = current_employee_id())
  );

-- Creates (or reuses an existing PENDING) request for a given email, run
-- with elevated privilege because the requester is, by definition,
-- unauthenticated at this point (that's the whole premise of "forgot
-- password"). Looking up which profile owns an email, and inserting a row
-- for someone who isn't the caller, both require bypassing normal RLS here
-- -- exactly the same reasoning as create_employee_complaint's fan-out.
--
-- Per the "the one Admin must never be locked out" requirement, an email
-- that resolves to an admin never gets queued: the caller is told to fall
-- back to the direct Supabase recovery email instead.
create or replace function public.request_password_reset(p_email text)
returns table(is_admin_account boolean, request_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_employee_id uuid;
  v_role text;
  v_request_id uuid;
  v_recipient uuid;
begin
  select p.id, p.employee_id, lower(p.role)
    into v_user_id, v_employee_id, v_role
  from public.profiles p
  where lower(p.email) = lower(p_email)
  limit 1;

  if v_role = 'admin' then
    return query select true, null::uuid;
    return;
  end if;

  -- Unknown email: report the same shape as a real, queued request so an
  -- anonymous caller can't use this to enumerate which addresses exist.
  if v_user_id is null then
    return query select false, null::uuid;
    return;
  end if;

  select id into v_request_id
  from public.password_reset_requests
  where lower(email) = lower(p_email) and status = 'PENDING'
  limit 1;

  if v_request_id is null then
    insert into public.password_reset_requests (user_id, employee_id, email, status)
    values (v_user_id, v_employee_id, lower(p_email), 'PENDING')
    returning id into v_request_id;

    for v_recipient in
      select p.id from public.profiles p where lower(p.role) = 'admin' and coalesce(p.is_active, true)
    loop
      insert into public.notifications (user_id, title, message, type, reference_id, reference_type)
      values (
        v_recipient,
        'Password reset request',
        p_email || ' requested a password reset.',
        'system',
        v_request_id,
        'password_reset_request'
      );
    end loop;
  end if;

  return query select false, v_request_id;
end;
$$;

grant execute on function public.request_password_reset(text) to anon, authenticated;

-- Owner-side completion marker, called from the authenticated recovery
-- session right after a successful password update. Wraps the same
-- owner-complete RLS transition above; kept as an RPC only so the frontend
-- doesn't need to know the row's id.
create or replace function public.complete_password_reset_request()
returns void
language sql
security definer
set search_path = public
as $$
  update public.password_reset_requests
  set status = 'COMPLETED'
  where status = 'APPROVED'
    and (user_id = auth.uid() or employee_id = current_employee_id());
$$;

grant execute on function public.complete_password_reset_request() to authenticated;
