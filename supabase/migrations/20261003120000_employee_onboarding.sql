-- Onboarding tables and RPCs ported from 20260926000002_employee_onboarding.sql.
-- Guarded with IF NOT EXISTS / to_regprocedure. Does not replace handle_new_user:
-- the live copy from auth security already writes onboarding_submissions once this
-- table exists. Does not replace document storage policies.

-- Employee onboarding: pending sign-up, draft profile tables, HR approval.
-- Idempotent. Does not push itself; apply with the rest of the migration history.

-- ------------------------------------------------------------
-- 1. Employee columns
-- ------------------------------------------------------------

alter table public.employees add column if not exists middle_name text;
alter table public.employees add column if not exists personal_email text;
alter table public.employees add column if not exists alternate_phone text;
alter table public.employees add column if not exists nationality text;
alter table public.employees add column if not exists photo_url text;
alter table public.employees add column if not exists profile_completed_at timestamptz;

alter table public.employee_addresses add column if not exists years_at_address numeric;
alter table public.employee_addresses add column if not exists same_as_current boolean;

alter table public.employee_bank_accounts add column if not exists cancelled_cheque_path text;

-- ------------------------------------------------------------
-- 2. Draft tables
-- ------------------------------------------------------------

create table if not exists public.employee_family_members (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  relation text not null check (relation in ('father', 'mother', 'spouse', 'dependents')),
  name text,
  phone text,
  dependents_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employee_family_members_relation_unique
  on public.employee_family_members (employee_id, relation);

create table if not exists public.employee_education (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  qualification text,
  institute text,
  year integer,
  is_highest boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_experience (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  company text,
  role_title text,
  from_date date,
  to_date date,
  reason_for_leaving text,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_identity (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  pan text,
  aadhaar_last4 text,
  aadhaar_masked text generated always as (
    case
      when aadhaar_last4 is null or aadhaar_last4 = '' then null
      else 'XXXX-XXXX-' || aadhaar_last4
    end
  ) stored,
  passport_number text,
  uan text,
  pan_document_path text,
  aadhaar_document_path text,
  passport_document_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.onboarding_submissions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'rejected')),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  remarks text,
  section_flags jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  declaration_accepted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists onboarding_submissions_status_idx
  on public.onboarding_submissions (status, organization_id);

create table if not exists public.profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  section text not null check (section in ('address', 'bank', 'phone')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profile_change_requests_one_pending
  on public.profile_change_requests (employee_id, section)
  where status = 'pending';

create index if not exists profile_change_requests_status_idx
  on public.profile_change_requests (organization_id, status);

-- Format checks on new tables (empty on first create). Existing bank/address
-- rows may not match, so those checks are conditional below.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employee_identity_pan_format') then
    alter table public.employee_identity
      add constraint employee_identity_pan_format
      check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_identity_aadhaar_last4') then
    alter table public.employee_identity
      add constraint employee_identity_aadhaar_last4
      check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_identity_uan_format') then
    alter table public.employee_identity
      add constraint employee_identity_uan_format
      check (uan is null or uan ~ '^[0-9]{12}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_family_phone_format') then
    alter table public.employee_family_members
      add constraint employee_family_phone_format
      check (phone is null or phone ~ '^[0-9]{10}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_family_dependents_nonneg') then
    alter table public.employee_family_members
      add constraint employee_family_dependents_nonneg
      check (dependents_count is null or dependents_count >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from public.employee_bank_accounts
    where ifsc is not null and btrim(ifsc) <> '' and upper(ifsc) !~ '^[A-Z]{4}0[A-Z0-9]{6}$'
  ) and not exists (
    select 1 from pg_constraint where conname = 'employee_bank_accounts_ifsc_format'
  ) then
    alter table public.employee_bank_accounts
      add constraint employee_bank_accounts_ifsc_format
      check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$');
  end if;
exception when others then
  null;
end $$;

do $$
begin
  if not exists (
    select 1 from public.employee_addresses
    where postal_code is not null and btrim(postal_code) <> '' and postal_code !~ '^[0-9]{6}$'
  ) and not exists (
    select 1 from pg_constraint where conname = 'employee_addresses_pin_format'
  ) then
    alter table public.employee_addresses
      add constraint employee_addresses_pin_format
      check (postal_code is null or postal_code ~ '^[0-9]{6}$');
  end if;
exception when others then
  null;
end $$;

create unique index if not exists employees_personal_email_unique
  on public.employees (lower(personal_email))
  where personal_email is not null and btrim(personal_email) <> '';

-- ------------------------------------------------------------
-- 3. Validation + edit lock
-- ------------------------------------------------------------

create or replace function public.onboarding_section_editable(p_employee_id uuid, p_section text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_submission_status text;
  v_flags jsonb;
begin
  if p_employee_id is null then
    return false;
  end if;

  if public.is_admin_or_hr() and exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and e.organization_id = public.current_org_id()
  ) then
    return true;
  end if;

  if p_employee_id is distinct from public.current_employee_id() then
    return false;
  end if;

  select e.employment_status into v_status
  from public.employees e
  where e.id = p_employee_id;

  select s.status, s.section_flags into v_submission_status, v_flags
  from public.onboarding_submissions s
  where s.employee_id = p_employee_id;

  if v_status = 'pending_approval' and coalesce(v_submission_status, 'draft') = 'draft' then
    return true;
  end if;

  if v_status = 'profile_changes_requested' or v_submission_status = 'changes_requested' then
    if p_section = 'review' then
      return true;
    end if;
    return coalesce(v_flags, '{}'::jsonb) ? p_section
      or (p_section in ('education', 'experience') and (
        coalesce(v_flags, '{}'::jsonb) ? 'education'
        or coalesce(v_flags, '{}'::jsonb) ? 'experience'
      ));
  end if;

  return false;
end;
$$;

create or replace function public.employees_validate_profile_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_phone text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_check_phone boolean := tg_op = 'INSERT';
  v_check_alt boolean := tg_op = 'INSERT';
  v_check_email boolean := tg_op = 'INSERT';
  v_check_dob boolean := tg_op = 'INSERT';
begin
  if tg_op = 'UPDATE' then
    v_check_phone := new.phone is distinct from old.phone;
    v_check_alt := new.alternate_phone is distinct from old.alternate_phone;
    v_check_email := new.personal_email is distinct from old.personal_email;
    v_check_dob := new.date_of_birth is distinct from old.date_of_birth;
  end if;

  if v_check_phone and new.phone is not null and btrim(new.phone) <> '' then
    v_phone := right(regexp_replace(new.phone, '\D', '', 'g'), 10);
    if v_phone !~ '^[0-9]{10}$' then
      raise exception 'Mobile number must be 10 digits.';
    end if;
    new.phone := v_phone;
    if exists (
      select 1
      from public.employees e
      where e.id is distinct from new.id
        and right(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g'), 10) = v_phone
        and length(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g')) >= 10
    ) then
      raise exception 'This mobile number is already registered. Sign in or use forgot password if this is your account.';
    end if;
  end if;

  if v_check_alt then
    if new.alternate_phone is not null and btrim(new.alternate_phone) <> '' then
      new.alternate_phone := right(regexp_replace(new.alternate_phone, '\D', '', 'g'), 10);
      if new.alternate_phone !~ '^[0-9]{10}$' then
        raise exception 'Alternate mobile number must be 10 digits.';
      end if;
    else
      new.alternate_phone := null;
    end if;
  end if;

  if v_check_email then
    if new.personal_email is not null and btrim(new.personal_email) <> '' then
      new.personal_email := lower(btrim(new.personal_email));
      if exists (
        select 1
        from public.employees e
        where e.id is distinct from new.id
          and lower(e.personal_email) = new.personal_email
      ) then
        raise exception 'This personal email is already registered. Sign in or use forgot password if this is your account.';
      end if;
    else
      new.personal_email := null;
    end if;
  end if;

  if v_check_dob and new.date_of_birth is not null
     and new.date_of_birth > (v_today - interval '18 years')::date then
    raise exception 'Employee must be at least 18 years old.';
  end if;

  return new;
end;
$$;

drop trigger if exists employees_validate_profile_fields on public.employees;
create trigger employees_validate_profile_fields
  before insert or update of phone, alternate_phone, personal_email, date_of_birth
  on public.employees
  for each row
  execute function public.employees_validate_profile_fields();

create or replace function public.employees_guard_self_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.allow_onboarding_write', true), '') = 'on' then
    return new;
  end if;

  if auth.uid() is null or old.profile_id is distinct from auth.uid() then
    return new;
  end if;

  new.organization_id := old.organization_id;
  new.profile_id := old.profile_id;
  new.department_id := old.department_id;
  new.designation_id := old.designation_id;
  new.manager_id := old.manager_id;
  new.shift_id := old.shift_id;
  new.employee_code := old.employee_code;
  new.joining_date := old.joining_date;
  new.employment_status := old.employment_status;
  new.employment_type := old.employment_type;
  new.profile_completed_at := old.profile_completed_at;
  new.exit_date := old.exit_date;

  if old.employment_status in ('pending_approval', 'profile_changes_requested', 'rejected')
     and not public.onboarding_section_editable(old.id, 'personal') then
    new.first_name := old.first_name;
    new.middle_name := old.middle_name;
    new.last_name := old.last_name;
    new.date_of_birth := old.date_of_birth;
    new.gender := old.gender;
    new.blood_group := old.blood_group;
    new.marital_status := old.marital_status;
    new.nationality := old.nationality;
    new.personal_email := old.personal_email;
    new.photo_url := old.photo_url;
  end if;

  if old.employment_status not in ('pending_approval', 'profile_changes_requested')
     or not public.onboarding_section_editable(old.id, 'personal') then
    new.phone := old.phone;
    new.alternate_phone := old.alternate_phone;
  end if;

  return new;
end;
$$;

drop trigger if exists employees_guard_self_assignment on public.employees;
create trigger employees_guard_self_assignment
  before update on public.employees
  for each row
  execute function public.employees_guard_self_assignment();

create or replace function public.emergency_contacts_validate_phone()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_phone text;
  v_own text;
  v_alt text;
begin
  if new.phone is not null and btrim(new.phone) <> '' then
    v_phone := right(regexp_replace(new.phone, '\D', '', 'g'), 10);
    if v_phone !~ '^[0-9]{10}$' then
      raise exception 'Emergency contact number must be 10 digits.';
    end if;
    new.phone := v_phone;
    select
      right(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g'), 10),
      right(regexp_replace(coalesce(e.alternate_phone, ''), '\D', '', 'g'), 10)
      into v_own, v_alt
    from public.employees e
    where e.id = new.employee_id;
    if v_phone = v_own or (v_alt <> '' and v_phone = v_alt) then
      raise exception 'Emergency contact number must be different from your own mobile number.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists emergency_contacts_validate_phone on public.emergency_contacts;
create trigger emergency_contacts_validate_phone
  before insert or update of phone on public.emergency_contacts
  for each row
  execute function public.emergency_contacts_validate_phone();

create or replace function public.employee_addresses_validate_pin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.postal_code is not distinct from old.postal_code then
      return new;
    end if;
  end if;
  if new.postal_code is not null and btrim(new.postal_code) <> '' then
    if regexp_replace(new.postal_code, '\D', '', 'g') !~ '^[0-9]{6}$' then
      raise exception 'PIN code must be 6 digits.';
    end if;
    new.postal_code := regexp_replace(new.postal_code, '\D', '', 'g');
  end if;
  return new;
end;
$$;

drop trigger if exists employee_addresses_validate_pin on public.employee_addresses;
create trigger employee_addresses_validate_pin
  before insert or update of postal_code on public.employee_addresses
  for each row
  execute function public.employee_addresses_validate_pin();

create or replace function public.employee_bank_accounts_validate_ifsc()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_check_ifsc boolean := true;
  v_check_account boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_check_ifsc := new.ifsc is distinct from old.ifsc;
    v_check_account := new.account_number is distinct from old.account_number;
  end if;
  if v_check_ifsc and new.ifsc is not null and btrim(new.ifsc) <> '' then
    new.ifsc := upper(regexp_replace(new.ifsc, '\s', '', 'g'));
    if new.ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
      raise exception 'IFSC must be 11 characters, for example HDFC0001234.';
    end if;
  end if;
  if v_check_account and new.account_number is not null and btrim(new.account_number) <> '' then
    new.account_number := regexp_replace(new.account_number, '\s', '', 'g');
    if new.account_number !~ '^[0-9]{9,18}$' then
      raise exception 'Account number must be 9 to 18 digits.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists employee_bank_accounts_validate_ifsc on public.employee_bank_accounts;
create trigger employee_bank_accounts_validate_ifsc
  before insert or update of ifsc, account_number on public.employee_bank_accounts
  for each row
  execute function public.employee_bank_accounts_validate_ifsc();

create or replace function public.employee_identity_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.pan is not null and btrim(new.pan) <> '' then
    new.pan := upper(regexp_replace(new.pan, '\s', '', 'g'));
    if new.pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
      raise exception 'PAN must look like ABCDE1234F.';
    end if;
  else
    new.pan := null;
  end if;

  if new.aadhaar_last4 is not null and btrim(new.aadhaar_last4) <> '' then
    if new.aadhaar_last4 ~ '^[0-9]{12}$' then
      new.aadhaar_last4 := right(new.aadhaar_last4, 4);
    end if;
    if new.aadhaar_last4 !~ '^[0-9]{4}$' then
      raise exception 'Only the last 4 digits of Aadhaar are stored.';
    end if;
  else
    new.aadhaar_last4 := null;
  end if;

  if new.uan is not null and btrim(new.uan) <> '' then
    new.uan := regexp_replace(new.uan, '\D', '', 'g');
    if new.uan !~ '^[0-9]{12}$' then
      raise exception 'UAN must be 12 digits.';
    end if;
  else
    new.uan := null;
  end if;

  if new.passport_number is not null then
    new.passport_number := nullif(upper(btrim(new.passport_number)), '');
  end if;

  return new;
end;
$$;

drop trigger if exists employee_identity_normalize on public.employee_identity;
create trigger employee_identity_normalize
  before insert or update on public.employee_identity
  for each row
  execute function public.employee_identity_normalize();

create or replace function public.onboarding_submissions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.allow_onboarding_write', true), '') = 'on' then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if public.is_admin_or_hr() then
      return new;
    end if;
    new.status := 'draft';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.remarks := null;
    new.section_flags := '{}'::jsonb;
    new.history := '[]'::jsonb;
    new.declaration_accepted := false;
    new.submitted_at := null;
    return new;
  end if;

  if public.is_admin_or_hr()
     and exists (
       select 1 from public.employees e
       where e.id = new.employee_id
         and e.organization_id = public.current_org_id()
     ) then
    new.updated_at := now();
    return new;
  end if;

  new.status := old.status;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.remarks := old.remarks;
  new.section_flags := old.section_flags;
  new.history := old.history;
  new.declaration_accepted := old.declaration_accepted;
  new.submitted_at := old.submitted_at;
  new.organization_id := old.organization_id;
  new.employee_id := old.employee_id;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists onboarding_submissions_guard on public.onboarding_submissions;
create trigger onboarding_submissions_guard
  before insert or update on public.onboarding_submissions
  for each row
  execute function public.onboarding_submissions_guard();

create or replace function public.profile_change_requests_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.allow_onboarding_write', true), '') = 'on' then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if public.is_admin_or_hr() then
      return new;
    end if;
    if new.employee_id is distinct from public.current_employee_id() then
      raise exception 'You can only request a change to your own profile.';
    end if;
    if not exists (
      select 1 from public.employees e
      where e.id = new.employee_id
        and e.employment_status in ('active', 'probation', 'notice', 'on-leave')
    ) then
      raise exception 'Profile changes can be requested after HR activates the account.';
    end if;
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.remarks := null;
    return new;
  end if;

  if public.is_admin_or_hr() then
    new.updated_at := now();
    return new;
  end if;

  raise exception 'Profile change requests are reviewed by HR.';
end;
$$;

drop trigger if exists profile_change_requests_guard on public.profile_change_requests;
create trigger profile_change_requests_guard
  before insert or update on public.profile_change_requests
  for each row
  execute function public.profile_change_requests_guard();

-- ------------------------------------------------------------
-- 4. RLS. Leads are not granted identity or bank rows.
-- ------------------------------------------------------------

alter table public.employee_family_members enable row level security;
alter table public.employee_education enable row level security;
alter table public.employee_experience enable row level security;
alter table public.employee_identity enable row level security;
alter table public.onboarding_submissions enable row level security;
alter table public.profile_change_requests enable row level security;

grant select, insert, update, delete on public.employee_family_members to authenticated;
grant select, insert, update, delete on public.employee_education to authenticated;
grant select, insert, update, delete on public.employee_experience to authenticated;
grant select, insert, update, delete on public.employee_identity to authenticated;
grant select, insert, update, delete on public.onboarding_submissions to authenticated;
grant select, insert, update, delete on public.profile_change_requests to authenticated;

revoke all on public.employee_family_members from anon;
revoke all on public.employee_education from anon;
revoke all on public.employee_experience from anon;
revoke all on public.employee_identity from anon;
revoke all on public.onboarding_submissions from anon;
revoke all on public.profile_change_requests from anon;

-- Addresses: employees write only while the addresses step is unlocked.
drop policy if exists employee_addresses_self_insert on public.employee_addresses;
drop policy if exists employee_addresses_self_update on public.employee_addresses;
drop policy if exists employee_addresses_self_delete on public.employee_addresses;
create policy employee_addresses_self_insert on public.employee_addresses
  for insert with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'addresses')
  );
create policy employee_addresses_self_update on public.employee_addresses
  for update using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'addresses')
  ) with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'addresses')
  );
create policy employee_addresses_self_delete on public.employee_addresses
  for delete using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'addresses')
  );

drop policy if exists employee_bank_accounts_self_insert on public.employee_bank_accounts;
drop policy if exists employee_bank_accounts_self_update on public.employee_bank_accounts;
drop policy if exists employee_bank_accounts_self_delete on public.employee_bank_accounts;
create policy employee_bank_accounts_self_insert on public.employee_bank_accounts
  for insert with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'bank')
  );
create policy employee_bank_accounts_self_update on public.employee_bank_accounts
  for update using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'bank')
  ) with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'bank')
  );
create policy employee_bank_accounts_self_delete on public.employee_bank_accounts
  for delete using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'bank')
  );

drop policy if exists emergency_contacts_self_insert on public.emergency_contacts;
drop policy if exists emergency_contacts_self_update on public.emergency_contacts;
drop policy if exists emergency_contacts_self_delete on public.emergency_contacts;
create policy emergency_contacts_self_insert on public.emergency_contacts
  for insert with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'emergency')
  );
create policy emergency_contacts_self_update on public.emergency_contacts
  for update using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'emergency')
  ) with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'emergency')
  );
create policy emergency_contacts_self_delete on public.emergency_contacts
  for delete using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'emergency')
  );

drop policy if exists employee_family_self_select on public.employee_family_members;
create policy employee_family_self_select on public.employee_family_members
  for select using (employee_id = public.current_employee_id());
drop policy if exists employee_family_self_insert on public.employee_family_members;
create policy employee_family_self_insert on public.employee_family_members
  for insert with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'family')
  );
drop policy if exists employee_family_self_update on public.employee_family_members;
create policy employee_family_self_update on public.employee_family_members
  for update using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'family')
  ) with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'family')
  );
drop policy if exists employee_family_self_delete on public.employee_family_members;
create policy employee_family_self_delete on public.employee_family_members
  for delete using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'family')
  );
drop policy if exists employee_family_admin_hr_all on public.employee_family_members;
create policy employee_family_admin_hr_all on public.employee_family_members
  for all using (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = employee_family_members.employee_id
        and e.organization_id = public.current_org_id()
    )
  ) with check (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = employee_family_members.employee_id
        and e.organization_id = public.current_org_id()
    )
  );

drop policy if exists employee_education_self_select on public.employee_education;
create policy employee_education_self_select on public.employee_education
  for select using (employee_id = public.current_employee_id());
drop policy if exists employee_education_self_insert on public.employee_education;
create policy employee_education_self_insert on public.employee_education
  for insert with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'education')
  );
drop policy if exists employee_education_self_update on public.employee_education;
create policy employee_education_self_update on public.employee_education
  for update using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'education')
  ) with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'education')
  );
drop policy if exists employee_education_self_delete on public.employee_education;
create policy employee_education_self_delete on public.employee_education
  for delete using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'education')
  );
drop policy if exists employee_education_admin_hr_all on public.employee_education;
create policy employee_education_admin_hr_all on public.employee_education
  for all using (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = employee_education.employee_id
        and e.organization_id = public.current_org_id()
    )
  ) with check (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = employee_education.employee_id
        and e.organization_id = public.current_org_id()
    )
  );

drop policy if exists employee_experience_self_select on public.employee_experience;
create policy employee_experience_self_select on public.employee_experience
  for select using (employee_id = public.current_employee_id());
drop policy if exists employee_experience_self_insert on public.employee_experience;
create policy employee_experience_self_insert on public.employee_experience
  for insert with check (
    employee_id = public.current_employee_id()
    and (
      public.onboarding_section_editable(employee_id, 'experience')
      or public.onboarding_section_editable(employee_id, 'education')
    )
  );
drop policy if exists employee_experience_self_update on public.employee_experience;
create policy employee_experience_self_update on public.employee_experience
  for update using (
    employee_id = public.current_employee_id()
    and (
      public.onboarding_section_editable(employee_id, 'experience')
      or public.onboarding_section_editable(employee_id, 'education')
    )
  ) with check (
    employee_id = public.current_employee_id()
    and (
      public.onboarding_section_editable(employee_id, 'experience')
      or public.onboarding_section_editable(employee_id, 'education')
    )
  );
drop policy if exists employee_experience_self_delete on public.employee_experience;
create policy employee_experience_self_delete on public.employee_experience
  for delete using (
    employee_id = public.current_employee_id()
    and (
      public.onboarding_section_editable(employee_id, 'experience')
      or public.onboarding_section_editable(employee_id, 'education')
    )
  );
drop policy if exists employee_experience_admin_hr_all on public.employee_experience;
create policy employee_experience_admin_hr_all on public.employee_experience
  for all using (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = employee_experience.employee_id
        and e.organization_id = public.current_org_id()
    )
  ) with check (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = employee_experience.employee_id
        and e.organization_id = public.current_org_id()
    )
  );

drop policy if exists employee_identity_self_select on public.employee_identity;
create policy employee_identity_self_select on public.employee_identity
  for select using (employee_id = public.current_employee_id());
drop policy if exists employee_identity_self_insert on public.employee_identity;
create policy employee_identity_self_insert on public.employee_identity
  for insert with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'identity')
  );
drop policy if exists employee_identity_self_update on public.employee_identity;
create policy employee_identity_self_update on public.employee_identity
  for update using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'identity')
  ) with check (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'identity')
  );
drop policy if exists employee_identity_self_delete on public.employee_identity;
create policy employee_identity_self_delete on public.employee_identity
  for delete using (
    employee_id = public.current_employee_id()
    and public.onboarding_section_editable(employee_id, 'identity')
  );
drop policy if exists employee_identity_admin_hr_all on public.employee_identity;
create policy employee_identity_admin_hr_all on public.employee_identity
  for all using (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = employee_identity.employee_id
        and e.organization_id = public.current_org_id()
    )
  ) with check (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = employee_identity.employee_id
        and e.organization_id = public.current_org_id()
    )
  );

drop policy if exists onboarding_submissions_self_select on public.onboarding_submissions;
create policy onboarding_submissions_self_select on public.onboarding_submissions
  for select using (employee_id = public.current_employee_id());
drop policy if exists onboarding_submissions_self_insert on public.onboarding_submissions;
create policy onboarding_submissions_self_insert on public.onboarding_submissions
  for insert with check (employee_id = public.current_employee_id());
drop policy if exists onboarding_submissions_self_update on public.onboarding_submissions;
create policy onboarding_submissions_self_update on public.onboarding_submissions
  for update using (employee_id = public.current_employee_id())
  with check (employee_id = public.current_employee_id());
drop policy if exists onboarding_submissions_admin_hr_all on public.onboarding_submissions;
create policy onboarding_submissions_admin_hr_all on public.onboarding_submissions
  for all using (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = onboarding_submissions.employee_id
        and e.organization_id = public.current_org_id()
    )
  ) with check (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = onboarding_submissions.employee_id
        and e.organization_id = public.current_org_id()
    )
  );

drop policy if exists profile_change_requests_self_select on public.profile_change_requests;
create policy profile_change_requests_self_select on public.profile_change_requests
  for select using (employee_id = public.current_employee_id());
drop policy if exists profile_change_requests_self_insert on public.profile_change_requests;
create policy profile_change_requests_self_insert on public.profile_change_requests
  for insert with check (employee_id = public.current_employee_id());
drop policy if exists profile_change_requests_admin_hr_all on public.profile_change_requests;
create policy profile_change_requests_admin_hr_all on public.profile_change_requests
  for all using (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = profile_change_requests.employee_id
        and e.organization_id = public.current_org_id()
    )
  ) with check (
    public.is_admin_or_hr()
    and exists (
      select 1 from public.employees e
      where e.id = profile_change_requests.employee_id
        and e.organization_id = public.current_org_id()
    )
  );



-- HR may assign a non-admin role while approving onboarding. Super Admin rules stay.
create or replace function public.set_employee_role(p_employee_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_org uuid;
  v_old text;
  v_admin_count integer;
  v_caller text;
begin
  v_caller := public.current_user_role();

  if auth.uid() is null or v_caller not in ('admin', 'hr') then
    raise exception 'Only a super admin or HR can change roles.';
  end if;

  if p_role not in ('admin', 'hr', 'dept_head', 'team_lead', 'employee') then
    raise exception 'Invalid role.';
  end if;

  if v_caller = 'hr' and p_role = 'admin' then
    raise exception 'Only a super admin can assign the super admin role.';
  end if;

  select p.id, e.organization_id, p.role
    into v_profile_id, v_org, v_old
  from public.employees e
  join public.profiles p on p.id = e.profile_id
  where e.id = p_employee_id
  limit 1
  for update of p;

  if v_profile_id is null then
    select p.id, e.organization_id, p.role
      into v_profile_id, v_org, v_old
    from public.employees e
    join public.profiles p on p.employee_id = e.id
    where e.id = p_employee_id
    limit 1
    for update of p;
  end if;

  if v_profile_id is null then
    raise exception 'Employee profile not found.';
  end if;

  if v_org is distinct from public.current_org_id() then
    raise exception 'Employee is outside your organization.';
  end if;

  if v_caller = 'hr' and v_old = 'admin' then
    raise exception 'HR cannot change a super admin role.';
  end if;

  if v_old is not distinct from p_role then
    return;
  end if;

  if v_profile_id = auth.uid() and v_old = 'admin' and p_role <> 'admin' then
    raise exception 'You cannot remove your own super admin role.';
  end if;

  if v_old = 'admin' and p_role <> 'admin' then
    select count(distinct p.id) into v_admin_count
    from public.profiles p
    join public.employees e on e.profile_id = p.id or e.id = p.employee_id
    where p.role = 'admin'
      and e.organization_id = v_org;

    if v_admin_count <= 1 then
      raise exception 'Cannot demote the last super admin.';
    end if;
  end if;

  perform set_config('app.allow_role_update', 'on', true);

  update public.profiles
  set role = p_role,
      updated_at = now()
  where id = v_profile_id;

  if to_regprocedure('public.log_employee_assignment(uuid, text)') is not null then
    perform public.log_employee_assignment(p_employee_id, 'role');
  end if;
  perform public.log_audit_event(
    'set_employee_role',
    'profiles',
    v_profile_id,
    jsonb_build_object('role', v_old),
    jsonb_build_object('role', p_role, 'employee_id', p_employee_id)
  );
end;
$$;

-- ------------------------------------------------------------
-- 6. Submit, approve, reject, request changes
-- ------------------------------------------------------------

create sequence if not exists public.employee_code_seq;

create or replace function public.submit_employee_onboarding(p_declaration boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.current_employee_id();
  v_status text;
  v_marital text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_sub uuid;
begin
  if auth.uid() is null or v_emp is null then
    raise exception 'Employee profile was not found.';
  end if;
  if p_declaration is not true then
    raise exception 'Accept the declaration before submitting.';
  end if;

  select employment_status, lower(coalesce(marital_status, ''))
    into v_status, v_marital
  from public.employees
  where id = v_emp;

  if v_status not in ('pending_approval', 'profile_changes_requested') then
    raise exception 'This profile is not open for submission.';
  end if;

  if not exists (
    select 1 from public.employees e
    where e.id = v_emp
      and nullif(btrim(e.first_name), '') is not null
      and nullif(btrim(e.last_name), '') is not null
      and e.date_of_birth is not null
      and e.date_of_birth <= (v_today - interval '18 years')::date
      and nullif(btrim(e.gender), '') is not null
      and nullif(btrim(e.marital_status), '') is not null
      and e.phone ~ '^[0-9]{10}$'
  ) then
    raise exception 'Complete the personal step before submitting.';
  end if;

  if not exists (
    select 1 from public.employee_family_members
    where employee_id = v_emp and relation = 'father'
      and nullif(btrim(name), '') is not null and phone ~ '^[0-9]{10}$'
  ) or not exists (
    select 1 from public.employee_family_members
    where employee_id = v_emp and relation = 'mother'
      and nullif(btrim(name), '') is not null and phone ~ '^[0-9]{10}$'
  ) then
    raise exception 'Father and mother name and mobile are required.';
  end if;

  if v_marital = 'married' and not exists (
    select 1 from public.employee_family_members
    where employee_id = v_emp and relation = 'spouse'
      and nullif(btrim(name), '') is not null and phone ~ '^[0-9]{10}$'
  ) then
    raise exception 'Spouse name and mobile are required.';
  end if;

  if (
    select count(*) from public.emergency_contacts
    where employee_id = v_emp and nullif(btrim(name), '') is not null and phone ~ '^[0-9]{10}$'
  ) < 1 then
    raise exception 'Add at least one emergency contact.';
  end if;

  if not exists (
    select 1 from public.employee_addresses
    where employee_id = v_emp and address_type = 'current'
      and nullif(btrim(address_line1), '') is not null
      and nullif(btrim(city), '') is not null
      and nullif(btrim(state), '') is not null
      and postal_code ~ '^[0-9]{6}$'
  ) or not exists (
    select 1 from public.employee_addresses
    where employee_id = v_emp and address_type = 'permanent'
      and nullif(btrim(address_line1), '') is not null
      and postal_code ~ '^[0-9]{6}$'
  ) then
    raise exception 'Current and permanent addresses are required.';
  end if;

  if not exists (
    select 1 from public.employee_identity
    where employee_id = v_emp
      and pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
      and aadhaar_last4 ~ '^[0-9]{4}$'
      and nullif(btrim(pan_document_path), '') is not null
      and nullif(btrim(aadhaar_document_path), '') is not null
  ) then
    raise exception 'PAN, Aadhaar and their document uploads are required.';
  end if;

  if not exists (
    select 1 from public.employee_education
    where employee_id = v_emp
      and nullif(btrim(qualification), '') is not null
      and nullif(btrim(institute), '') is not null
      and year is not null
  ) then
    raise exception 'Highest qualification, institute and year are required.';
  end if;

  if not exists (
    select 1 from public.employee_bank_accounts
    where employee_id = v_emp
      and nullif(btrim(account_name), '') is not null
      and account_number ~ '^[0-9]{9,18}$'
      and ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'
      and nullif(btrim(bank_name), '') is not null
      and nullif(btrim(cancelled_cheque_path), '') is not null
  ) then
    raise exception 'Bank account, IFSC and cancelled cheque are required.';
  end if;

  perform set_config('app.allow_onboarding_write', 'on', true);

  select id into v_sub from public.onboarding_submissions where employee_id = v_emp;
  if v_sub is null then
    insert into public.onboarding_submissions (employee_id, organization_id, status)
    select e.id, e.organization_id, 'draft'
    from public.employees e
    where e.id = v_emp;
  end if;

  update public.onboarding_submissions
  set status = 'submitted',
      submitted_at = now(),
      declaration_accepted = true,
      remarks = null,
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('at', now(), 'action', 'submitted', 'by', auth.uid())
      )
  where employee_id = v_emp;

  update public.employees
  set employment_status = 'pending_approval'
  where id = v_emp
    and employment_status = 'profile_changes_requested';
end;
$$;

create or replace function public.approve_employee_onboarding(
  p_employee_id uuid,
  p_department_id uuid,
  p_designation_id uuid,
  p_role text,
  p_manager_id uuid,
  p_shift_id uuid,
  p_joining_date date,
  p_employee_code text,
  p_override_joining_date_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_code text;
  v_next_status text;
  v_profile uuid;
  i integer;
begin
  if auth.uid() is null or not public.is_admin_or_hr() then
    raise exception 'Only HR or a super admin can approve onboarding.';
  end if;

  select organization_id, employment_status, profile_id
    into v_org, v_status, v_profile
  from public.employees
  where id = p_employee_id
  for update;

  if v_org is null then
    raise exception 'Employee was not found.';
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'Employee is outside your organization.';
  end if;
  if v_status not in ('pending_approval', 'profile_changes_requested') then
    raise exception 'This employee is not waiting for approval.';
  end if;
  if p_department_id is null or p_designation_id is null or p_joining_date is null then
    raise exception 'Department, designation and joining date are required.';
  end if;
  if p_role is null or p_role not in ('admin', 'hr', 'dept_head', 'team_lead', 'employee') then
    raise exception 'Choose a valid role.';
  end if;
  if not exists (
    select 1 from public.departments d
    where d.id = p_department_id and d.organization_id = v_org
  ) then
    raise exception 'Department is not in this organization.';
  end if;
  if not exists (
    select 1 from public.designations d
    where d.id = p_designation_id and d.organization_id = v_org
  ) then
    raise exception 'Designation is not in this organization.';
  end if;
  if p_manager_id is not null then
    if p_manager_id = p_employee_id then
      raise exception 'An employee cannot report to themselves.';
    end if;
    if not exists (
      select 1 from public.employees m
      where m.id = p_manager_id and m.organization_id = v_org
    ) then
      raise exception 'Reporting lead is not in this organization.';
    end if;
  end if;
  if p_shift_id is not null and not exists (
    select 1 from public.shifts s
    where s.id = p_shift_id and s.organization_id = v_org
  ) then
    raise exception 'Shift is not in this organization.';
  end if;
  if p_joining_date < v_today and nullif(btrim(coalesce(p_override_joining_date_reason, '')), '') is null then
    raise exception 'Joining date is in the past. Provide a reason to override it.';
  end if;

  v_code := nullif(upper(btrim(coalesce(p_employee_code, ''))), '');
  if v_code is null then
    for i in 1..30 loop
      v_code := 'EMP-' || lpad(nextval('public.employee_code_seq')::text, 5, '0');
      exit when not exists (
        select 1 from public.employees e
        where e.organization_id = v_org and e.employee_code = v_code and e.id <> p_employee_id
      );
    end loop;
  elsif exists (
    select 1 from public.employees e
    where e.organization_id = v_org and e.employee_code = v_code and e.id <> p_employee_id
  ) then
    raise exception 'That employee code is already in use.';
  end if;

  v_next_status := case when p_joining_date > v_today then 'probation' else 'active' end;

  perform set_config('app.allow_onboarding_write', 'on', true);

  update public.employees
  set department_id = p_department_id,
      designation_id = p_designation_id,
      manager_id = p_manager_id,
      shift_id = p_shift_id,
      joining_date = p_joining_date,
      employee_code = v_code,
      employment_status = v_next_status,
      profile_completed_at = now()
  where id = p_employee_id;

  perform public.set_employee_role(p_employee_id, p_role);

  update public.onboarding_submissions
  set status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      remarks = nullif(btrim(coalesce(p_override_joining_date_reason, '')), ''),
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'at', now(),
          'action', 'approved',
          'by', auth.uid(),
          'role', p_role,
          'employee_code', v_code,
          'joining_date', p_joining_date,
          'override_reason', nullif(btrim(coalesce(p_override_joining_date_reason, '')), '')
        )
      )
  where employee_id = p_employee_id;

  if p_shift_id is not null then
    begin
      insert into public.employee_shifts (employee_id, shift_id, effective_from)
      select p_employee_id, p_shift_id, p_joining_date
      where not exists (
        select 1 from public.employee_shifts es
        where es.employee_id = p_employee_id
          and es.shift_id = p_shift_id
          and es.effective_from = p_joining_date
      );
    exception when others then
      null;
    end;
  end if;

  begin
    if not exists (
      select 1 from public.onboarding_records r where r.employee_id = p_employee_id
    ) then
      insert into public.onboarding_records (employee_id, assigned_hr, joining_date, status)
      values (p_employee_id, auth.uid(), p_joining_date, 'in-progress');
    end if;
  exception when others then
    null;
  end;

  if v_profile is not null then
    insert into public.notifications (user_id, title, message, type, reference_type, reference_id, is_read)
    values (
      v_profile,
      'Profile approved',
      'HR approved your profile. You can use JeeVijay HRMS now.',
      'onboarding',
      'employees',
      p_employee_id,
      false
    );
  end if;

  perform public.log_audit_event(
    'approve_employee_onboarding',
    'employees',
    p_employee_id,
    jsonb_build_object('employment_status', v_status),
    jsonb_build_object(
      'employment_status', v_next_status,
      'department_id', p_department_id,
      'designation_id', p_designation_id,
      'role', p_role,
      'manager_id', p_manager_id,
      'shift_id', p_shift_id,
      'joining_date', p_joining_date,
      'employee_code', v_code
    )
  );
end;
$$;

create or replace function public.reject_employee_onboarding(p_employee_id uuid, p_remarks text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text;
  v_profile uuid;
begin
  if auth.uid() is null or not public.is_admin_or_hr() then
    raise exception 'Only HR or a super admin can reject onboarding.';
  end if;
  if nullif(btrim(coalesce(p_remarks, '')), '') is null then
    raise exception 'A rejection reason is required.';
  end if;

  select organization_id, employment_status, profile_id
    into v_org, v_status, v_profile
  from public.employees
  where id = p_employee_id
  for update;

  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'Employee is outside your organization.';
  end if;
  if v_status not in ('pending_approval', 'profile_changes_requested') then
    raise exception 'This employee is not waiting for a decision.';
  end if;

  perform set_config('app.allow_onboarding_write', 'on', true);

  update public.employees
  set employment_status = 'rejected'
  where id = p_employee_id;

  update public.onboarding_submissions
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      remarks = btrim(p_remarks),
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('at', now(), 'action', 'rejected', 'by', auth.uid(), 'remarks', btrim(p_remarks))
      )
  where employee_id = p_employee_id;

  if v_profile is not null then
    insert into public.notifications (user_id, title, message, type, reference_type, reference_id, is_read)
    values (
      v_profile,
      'Profile not approved',
      btrim(p_remarks),
      'onboarding',
      'employees',
      p_employee_id,
      false
    );
  end if;
end;
$$;

create or replace function public.request_onboarding_changes(
  p_employee_id uuid,
  p_section_flags jsonb,
  p_remarks text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text;
  v_profile uuid;
  v_flags jsonb;
begin
  if auth.uid() is null or not public.is_admin_or_hr() then
    raise exception 'Only HR or a super admin can request changes.';
  end if;

  v_flags := coalesce(p_section_flags, '{}'::jsonb);
  if v_flags = '{}'::jsonb or jsonb_typeof(v_flags) <> 'object' then
    raise exception 'Choose at least one section to send back.';
  end if;

  select organization_id, employment_status, profile_id
    into v_org, v_status, v_profile
  from public.employees
  where id = p_employee_id
  for update;

  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'Employee is outside your organization.';
  end if;
  if v_status not in ('pending_approval', 'profile_changes_requested') then
    raise exception 'This employee is not in review.';
  end if;

  perform set_config('app.allow_onboarding_write', 'on', true);

  update public.employees
  set employment_status = 'profile_changes_requested'
  where id = p_employee_id;

  update public.onboarding_submissions
  set status = 'changes_requested',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
      section_flags = v_flags,
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'at', now(),
          'action', 'changes_requested',
          'by', auth.uid(),
          'remarks', nullif(btrim(coalesce(p_remarks, '')), ''),
          'sections', v_flags
        )
      )
  where employee_id = p_employee_id;

  if v_profile is not null then
    insert into public.notifications (user_id, title, message, type, reference_type, reference_id, is_read)
    values (
      v_profile,
      'Profile changes requested',
      coalesce(nullif(btrim(coalesce(p_remarks, '')), ''), 'HR asked you to update part of your profile.'),
      'onboarding',
      'employees',
      p_employee_id,
      false
    );
  end if;
end;
$$;

create or replace function public.review_profile_change_request(
  p_request_id uuid,
  p_decision text,
  p_remarks text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.profile_change_requests%rowtype;
  v_org uuid;
  v_address jsonb;
  v_type text;
begin
  if auth.uid() is null or not public.is_admin_or_hr() then
    raise exception 'Only HR or a super admin can review profile changes.';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  select * into v_req
  from public.profile_change_requests
  where id = p_request_id
  for update;

  if v_req.id is null then
    raise exception 'Change request was not found.';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This change request is already decided.';
  end if;

  select organization_id into v_org from public.employees where id = v_req.employee_id;
  if v_org is distinct from public.current_org_id() then
    raise exception 'Employee is outside your organization.';
  end if;

  perform set_config('app.allow_onboarding_write', 'on', true);

  if p_decision = 'approved' then
    if v_req.section = 'phone' then
      update public.employees
      set phone = nullif(v_req.payload->>'phone', ''),
          alternate_phone = nullif(v_req.payload->>'alternatePhone', '')
      where id = v_req.employee_id;
    elsif v_req.section = 'address' then
      for v_type, v_address in
        select key, value
        from jsonb_each(v_req.payload)
        where key in ('current', 'permanent') and jsonb_typeof(value) = 'object'
      loop
        if exists (
          select 1 from public.employee_addresses a
          where a.employee_id = v_req.employee_id and a.address_type = v_type
        ) then
          update public.employee_addresses
          set address_line1 = v_address->>'addressLine1',
              address_line2 = nullif(v_address->>'addressLine2', ''),
              city = v_address->>'city',
              state = v_address->>'state',
              postal_code = v_address->>'postalCode',
              country = coalesce(nullif(v_address->>'country', ''), 'India'),
              years_at_address = nullif(v_address->>'yearsAtAddress', '')::numeric,
              same_as_current = coalesce((v_address->>'sameAsCurrent')::boolean, false)
          where employee_id = v_req.employee_id and address_type = v_type;
        else
          insert into public.employee_addresses (
            employee_id, address_type, address_line1, address_line2, city, state,
            postal_code, country, years_at_address, same_as_current
          ) values (
            v_req.employee_id,
            v_type,
            v_address->>'addressLine1',
            nullif(v_address->>'addressLine2', ''),
            v_address->>'city',
            v_address->>'state',
            v_address->>'postalCode',
            coalesce(nullif(v_address->>'country', ''), 'India'),
            nullif(v_address->>'yearsAtAddress', '')::numeric,
            coalesce((v_address->>'sameAsCurrent')::boolean, false)
          );
        end if;
      end loop;
    elsif v_req.section = 'bank' then
      if exists (
        select 1 from public.employee_bank_accounts b
        where b.employee_id = v_req.employee_id and coalesce(b.is_primary, false)
      ) then
        update public.employee_bank_accounts
        set account_name = v_req.payload->>'accountName',
            account_number = v_req.payload->>'accountNumber',
            ifsc = v_req.payload->>'ifsc',
            bank_name = v_req.payload->>'bankName',
            branch = nullif(v_req.payload->>'branch', ''),
            cancelled_cheque_path = coalesce(nullif(v_req.payload->>'cancelledChequePath', ''), cancelled_cheque_path),
            is_primary = true
        where employee_id = v_req.employee_id and coalesce(is_primary, false);
      elsif exists (
        select 1 from public.employee_bank_accounts b where b.employee_id = v_req.employee_id
      ) then
        update public.employee_bank_accounts
        set account_name = v_req.payload->>'accountName',
            account_number = v_req.payload->>'accountNumber',
            ifsc = v_req.payload->>'ifsc',
            bank_name = v_req.payload->>'bankName',
            branch = nullif(v_req.payload->>'branch', ''),
            cancelled_cheque_path = coalesce(nullif(v_req.payload->>'cancelledChequePath', ''), cancelled_cheque_path),
            is_primary = true
        where id = (
          select b.id from public.employee_bank_accounts b
          where b.employee_id = v_req.employee_id
          order by b.id
          limit 1
        );
      else
        insert into public.employee_bank_accounts (
          employee_id, account_name, account_number, ifsc, bank_name, branch,
          is_primary, cancelled_cheque_path
        ) values (
          v_req.employee_id,
          v_req.payload->>'accountName',
          v_req.payload->>'accountNumber',
          v_req.payload->>'ifsc',
          v_req.payload->>'bankName',
          nullif(v_req.payload->>'branch', ''),
          true,
          nullif(v_req.payload->>'cancelledChequePath', '')
        );
      end if;
    end if;
  end if;

  update public.profile_change_requests
  set status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      remarks = nullif(btrim(coalesce(p_remarks, '')), '')
  where id = p_request_id;

  perform public.log_audit_event(
    'review_profile_change_request',
    'profile_change_requests',
    p_request_id,
    jsonb_build_object('status', 'pending', 'section', v_req.section),
    jsonb_build_object('status', p_decision, 'employee_id', v_req.employee_id)
  );
end;
$$;

create or replace function public.remind_incomplete_onboarding()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null or not public.is_admin_or_hr() then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, reference_type, reference_id, is_read)
  select
    e.profile_id,
    'Incomplete profile',
    'Your profile has been incomplete for more than 30 days. Finish it so HR can review.',
    'onboarding',
    'employees',
    e.id,
    false
  from public.employees e
  join public.onboarding_submissions s on s.employee_id = e.id
  where e.organization_id = public.current_org_id()
    and e.employment_status = 'pending_approval'
    and s.status = 'draft'
    and e.profile_id is not null
    and e.created_at < now() - interval '30 days'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = e.profile_id
        and n.type = 'onboarding'
        and n.reference_id = e.id
        and n.title = 'Incomplete profile'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.onboarding_section_editable(uuid, text) from public, anon;
revoke all on function public.employees_validate_profile_fields() from public, anon, authenticated;
revoke all on function public.employees_guard_self_assignment() from public, anon, authenticated;
revoke all on function public.emergency_contacts_validate_phone() from public, anon, authenticated;
revoke all on function public.employee_addresses_validate_pin() from public, anon, authenticated;
revoke all on function public.employee_bank_accounts_validate_ifsc() from public, anon, authenticated;
revoke all on function public.employee_identity_normalize() from public, anon, authenticated;
revoke all on function public.onboarding_submissions_guard() from public, anon, authenticated;
revoke all on function public.profile_change_requests_guard() from public, anon, authenticated;

grant execute on function public.onboarding_section_editable(uuid, text) to authenticated, service_role;
grant execute on function public.submit_employee_onboarding(boolean) to authenticated, service_role;
grant execute on function public.approve_employee_onboarding(uuid, uuid, uuid, text, uuid, uuid, date, text, text) to authenticated, service_role;
grant execute on function public.reject_employee_onboarding(uuid, text) to authenticated, service_role;
grant execute on function public.request_onboarding_changes(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.review_profile_change_request(uuid, text, text) to authenticated, service_role;
grant execute on function public.remind_incomplete_onboarding() to authenticated, service_role;

revoke all on function public.submit_employee_onboarding(boolean) from public, anon;
revoke all on function public.approve_employee_onboarding(uuid, uuid, uuid, text, uuid, uuid, date, text, text) from public, anon;
revoke all on function public.reject_employee_onboarding(uuid, text) from public, anon;
revoke all on function public.request_onboarding_changes(uuid, jsonb, text) from public, anon;
revoke all on function public.review_profile_change_request(uuid, text, text) from public, anon;
revoke all on function public.remind_incomplete_onboarding() from public, anon;

-- Lead-scope read. can_view_employee is security definer and only reads
-- employees and departments, so these policies do not recurse.
-- Identity stays with the employee and HR. Address, emergency contact, bank,
-- family, education, and experience are visible to a lead for their team.
drop policy if exists employee_addresses_lead_select on public.employee_addresses;
create policy employee_addresses_lead_select on public.employee_addresses
  for select using (public.can_view_employee(employee_id));

drop policy if exists emergency_contacts_lead_select on public.emergency_contacts;
create policy emergency_contacts_lead_select on public.emergency_contacts
  for select using (public.can_view_employee(employee_id));

drop policy if exists employee_bank_accounts_lead_select on public.employee_bank_accounts;
create policy employee_bank_accounts_lead_select on public.employee_bank_accounts
  for select using (public.can_view_employee(employee_id));

drop policy if exists employee_family_lead_select on public.employee_family_members;
create policy employee_family_lead_select on public.employee_family_members
  for select using (public.can_view_employee(employee_id));

drop policy if exists employee_education_lead_select on public.employee_education;
create policy employee_education_lead_select on public.employee_education
  for select using (public.can_view_employee(employee_id));

drop policy if exists employee_experience_lead_select on public.employee_experience;
create policy employee_experience_lead_select on public.employee_experience
  for select using (public.can_view_employee(employee_id));
