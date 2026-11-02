-- Sales CRM: accounts, contacts, leads, deals (pipeline) and activities.
--
-- Who gets the CRM
--   * Members of a sales department (departments.is_sales = true), including
--     the head of a sales department.
--   * Super Admin (full access) and General Manager (read-only oversight).
--   Everyone else gets no CRM rows and no CRM navigation.
--
-- Who may change what
--   * Sales reps create records and edit/delete the ones they own.
--   * Sales leads (dept_head / team_lead inside a sales department, or the
--     head of a sales department) and Super Admin may edit any CRM record
--     and reassign owners.
--   * General Manager reads everything and writes nothing.
--
-- Records are shared across the sales team of one organisation so the
-- pipeline is visible to the whole team; ownership controls edits.

-- ------------------------------------------------------------
-- 1. Sales departments
-- ------------------------------------------------------------

alter table public.departments
  add column if not exists is_sales boolean not null default false;

update public.departments
set is_sales = true
where is_sales = false
  and name ~* '\msales\M';

create or replace function public.departments_default_is_sales()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.is_sales is not true and new.name ~* '\msales\M' then
    new.is_sales := true;
  end if;
  return new;
end;
$$;

drop trigger if exists departments_default_is_sales on public.departments;
create trigger departments_default_is_sales
  before insert on public.departments
  for each row
  execute function public.departments_default_is_sales();

revoke all on function public.departments_default_is_sales() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Access helpers
-- ------------------------------------------------------------

create or replace function public.is_sales_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    join public.departments d on d.id = e.department_id
    where e.id = public.current_employee_id()
      and d.is_sales
      and d.organization_id = e.organization_id
  )
  or exists (
    select 1
    from public.departments d
    where d.manager_id = public.current_employee_id()
      and d.is_sales
      and d.organization_id = public.current_org_id()
  );
$$;

create or replace function public.crm_can_manage_all()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin'
    or (
      public.is_sales_member()
      and public.current_user_role() in ('dept_head', 'team_lead')
    )
    or exists (
      select 1
      from public.departments d
      where d.manager_id = public.current_employee_id()
        and d.is_sales
        and d.organization_id = public.current_org_id()
    );
$$;

create or replace function public.crm_can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin' or public.is_sales_member();
$$;

create or replace function public.has_crm_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'general_manager')
    or public.is_sales_member();
$$;

-- One call for the app shell: which CRM controls to show.
create or replace function public.my_crm_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'has_access', public.has_crm_access(),
    'can_write', public.crm_can_write(),
    'can_manage_all', public.crm_can_manage_all(),
    'is_sales_member', public.is_sales_member()
  );
$$;

-- Owner must be an employee of the caller's organisation.
create or replace function public.crm_owner_in_org(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_owner is not null and exists (
    select 1 from public.employees e
    where e.id = p_owner
      and e.organization_id = public.current_org_id()
  );
$$;

-- Admin/HR choose which departments are sales teams.
create or replace function public.set_department_sales_flag(p_department_id uuid, p_is_sales boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.current_user_role() not in ('admin', 'hr') then
    raise exception 'Only a super admin or HR can change CRM access for a department.';
  end if;
  update public.departments
  set is_sales = coalesce(p_is_sales, false)
  where id = p_department_id
    and organization_id = public.current_org_id();
  if not found then
    raise exception 'Department not found.';
  end if;
  if to_regprocedure('public.log_audit_event(text, text, uuid, jsonb, jsonb)') is not null then
    perform public.log_audit_event(
      'set_department_sales_flag',
      'departments',
      p_department_id,
      null,
      jsonb_build_object('is_sales', coalesce(p_is_sales, false))
    );
  end if;
end;
$$;

revoke all on function public.is_sales_member() from public, anon;
revoke all on function public.crm_can_manage_all() from public, anon;
revoke all on function public.crm_can_write() from public, anon;
revoke all on function public.has_crm_access() from public, anon;
revoke all on function public.my_crm_access() from public, anon;
revoke all on function public.crm_owner_in_org(uuid) from public, anon;
revoke all on function public.set_department_sales_flag(uuid, boolean) from public, anon;
grant execute on function public.is_sales_member() to authenticated, service_role;
grant execute on function public.crm_can_manage_all() to authenticated, service_role;
grant execute on function public.crm_can_write() to authenticated, service_role;
grant execute on function public.has_crm_access() to authenticated, service_role;
grant execute on function public.my_crm_access() to authenticated, service_role;
grant execute on function public.crm_owner_in_org(uuid) to authenticated, service_role;
grant execute on function public.set_department_sales_flag(uuid, boolean) to authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Tables
-- ------------------------------------------------------------

create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  industry text,
  website text,
  email text,
  phone text,
  city text,
  country text,
  annual_revenue numeric(16, 2) check (annual_revenue is null or annual_revenue >= 0),
  employee_count integer check (employee_count is null or employee_count >= 0),
  notes text,
  owner_id uuid not null references public.employees(id) on delete restrict,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid references public.crm_accounts(id) on delete set null,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name text,
  email text,
  phone text,
  job_title text,
  notes text,
  owner_id uuid not null references public.employees(id) on delete restrict,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  account_id uuid references public.crm_accounts(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  amount numeric(16, 2) not null default 0 check (amount >= 0),
  currency text not null default 'INR',
  stage text not null default 'prospecting'
    check (stage in ('prospecting', 'qualification', 'proposal', 'negotiation', 'won', 'lost')),
  probability smallint not null default 10 check (probability between 0 and 100),
  expected_close_date date,
  closed_at timestamptz,
  lost_reason text,
  notes text,
  owner_id uuid not null references public.employees(id) on delete restrict,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name text,
  company text,
  email text,
  phone text,
  job_title text,
  source text not null default 'other'
    check (source in ('website', 'referral', 'cold-call', 'email', 'event', 'social', 'partner', 'other')),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'unqualified', 'converted')),
  rating text not null default 'warm' check (rating in ('hot', 'warm', 'cold')),
  estimated_value numeric(16, 2) check (estimated_value is null or estimated_value >= 0),
  notes text,
  owner_id uuid not null references public.employees(id) on delete restrict,
  converted_at timestamptz,
  converted_account_id uuid references public.crm_accounts(id) on delete set null,
  converted_contact_id uuid references public.crm_contacts(id) on delete set null,
  converted_deal_id uuid references public.crm_deals(id) on delete set null,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  activity_type text not null default 'call'
    check (activity_type in ('call', 'meeting', 'email', 'task', 'note')),
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  description text,
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  due_at timestamptz,
  completed_at timestamptz,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  deal_id uuid references public.crm_deals(id) on delete cascade,
  account_id uuid references public.crm_accounts(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete cascade,
  owner_id uuid not null references public.employees(id) on delete restrict,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_accounts_org_name on public.crm_accounts (organization_id, name);
create index if not exists idx_crm_accounts_owner on public.crm_accounts (owner_id);
create index if not exists idx_crm_contacts_org on public.crm_contacts (organization_id, first_name);
create index if not exists idx_crm_contacts_account on public.crm_contacts (account_id);
create index if not exists idx_crm_contacts_owner on public.crm_contacts (owner_id);
create index if not exists idx_crm_leads_org_status on public.crm_leads (organization_id, status);
create index if not exists idx_crm_leads_owner on public.crm_leads (owner_id);
create index if not exists idx_crm_deals_org_stage on public.crm_deals (organization_id, stage);
create index if not exists idx_crm_deals_owner on public.crm_deals (owner_id);
create index if not exists idx_crm_deals_account on public.crm_deals (account_id);
create index if not exists idx_crm_activities_org_due on public.crm_activities (organization_id, due_at);
create index if not exists idx_crm_activities_owner on public.crm_activities (owner_id, status);
create index if not exists idx_crm_activities_lead on public.crm_activities (lead_id);
create index if not exists idx_crm_activities_deal on public.crm_activities (deal_id);

-- ------------------------------------------------------------
-- 4. Write guard: org, owner, timestamps, deal closing, linked records
-- ------------------------------------------------------------

create or replace function public.crm_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_me uuid := public.current_employee_id();
begin
  -- Service role / SQL editor (no auth user) may write freely.
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.organization_id := v_org;
    new.created_by := v_me;
    new.created_at := now();
    if new.owner_id is null then
      new.owner_id := v_me;
    end if;
  else
    if new.organization_id is distinct from old.organization_id then
      raise exception 'CRM records cannot move between organisations.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  if new.organization_id is null then
    raise exception 'Your account is not linked to an organisation.';
  end if;

  if not public.crm_owner_in_org(new.owner_id) then
    raise exception 'Owner must be an employee of your organisation.';
  end if;

  -- Only leads/admin may hand a record to someone else.
  if tg_op = 'INSERT' then
    if new.owner_id is distinct from v_me and not public.crm_can_manage_all() then
      raise exception 'Only a sales lead or super admin can assign CRM records to someone else.';
    end if;
  elsif new.owner_id is distinct from old.owner_id and not public.crm_can_manage_all() then
    raise exception 'Only a sales lead or super admin can assign CRM records to someone else.';
  end if;

  -- Table-specific checks. PL/pgSQL does not short-circuit, so each table's
  -- columns are only referenced inside its own branch.
  if tg_table_name = 'crm_contacts' then
    if new.account_id is not null and not exists (
      select 1 from public.crm_accounts a where a.id = new.account_id and a.organization_id = new.organization_id
    ) then
      raise exception 'Account not found.';
    end if;

  elsif tg_table_name = 'crm_deals' then
    if new.account_id is not null and not exists (
      select 1 from public.crm_accounts a where a.id = new.account_id and a.organization_id = new.organization_id
    ) then
      raise exception 'Account not found.';
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.crm_contacts c where c.id = new.contact_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Contact not found.';
    end if;
    if new.stage = 'won' then
      new.probability := 100;
      new.lost_reason := null;
      if tg_op = 'INSERT' then
        new.closed_at := now();
      elsif old.stage is distinct from 'won' then
        new.closed_at := now();
      end if;
    elsif new.stage = 'lost' then
      new.probability := 0;
      if tg_op = 'INSERT' then
        new.closed_at := now();
      elsif old.stage is distinct from 'lost' then
        new.closed_at := now();
      end if;
    else
      new.closed_at := null;
      new.lost_reason := null;
    end if;

  elsif tg_table_name = 'crm_activities' then
    if new.status = 'done' then
      if new.completed_at is null then
        new.completed_at := now();
      end if;
    else
      new.completed_at := null;
    end if;
    if new.lead_id is not null and not exists (
      select 1 from public.crm_leads l where l.id = new.lead_id and l.organization_id = new.organization_id
    ) then
      raise exception 'Lead not found.';
    end if;
    if new.deal_id is not null and not exists (
      select 1 from public.crm_deals d where d.id = new.deal_id and d.organization_id = new.organization_id
    ) then
      raise exception 'Deal not found.';
    end if;
    if new.account_id is not null and not exists (
      select 1 from public.crm_accounts a where a.id = new.account_id and a.organization_id = new.organization_id
    ) then
      raise exception 'Account not found.';
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.crm_contacts c where c.id = new.contact_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Contact not found.';
    end if;

  elsif tg_table_name = 'crm_leads' then
    if new.status = 'converted' then
      if new.converted_at is null then
        new.converted_at := now();
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.crm_before_write() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['crm_accounts', 'crm_contacts', 'crm_leads', 'crm_deals', 'crm_activities']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_before_write', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.crm_before_write()',
      t || '_before_write',
      t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 5. Row-level security
-- ------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['crm_accounts', 'crm_contacts', 'crm_leads', 'crm_deals', 'crm_activities']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         organization_id = public.current_org_id() and public.has_crm_access()
       )',
      t || '_select', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
         organization_id = public.current_org_id() and public.crm_can_write()
       )',
      t || '_insert', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (
           organization_id = public.current_org_id()
           and public.crm_can_write()
           and (owner_id = public.current_employee_id() or public.crm_can_manage_all())
         )
         with check (
           organization_id = public.current_org_id()
           and public.crm_can_write()
           and (owner_id = public.current_employee_id() or public.crm_can_manage_all())
         )',
      t || '_update', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (
         organization_id = public.current_org_id()
         and public.crm_can_write()
         and (owner_id = public.current_employee_id() or public.crm_can_manage_all())
       )',
      t || '_delete', t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 6. Lead conversion (runs as the caller, so RLS applies to every insert)
-- ------------------------------------------------------------

create or replace function public.convert_crm_lead(
  p_lead_id uuid,
  p_create_deal boolean default true,
  p_deal_name text default null,
  p_deal_amount numeric default null,
  p_existing_account_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead public.crm_leads%rowtype;
  v_account uuid;
  v_contact uuid;
  v_deal uuid;
begin
  select * into v_lead from public.crm_leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found.';
  end if;
  if v_lead.status = 'converted' then
    raise exception 'This lead is already converted.';
  end if;
  if v_lead.status = 'unqualified' then
    raise exception 'Re-qualify this lead before converting it.';
  end if;

  if p_existing_account_id is not null then
    select id into v_account from public.crm_accounts where id = p_existing_account_id;
    if v_account is null then
      raise exception 'Account not found.';
    end if;
  else
    insert into public.crm_accounts (name, email, phone, owner_id)
    values (
      coalesce(
        nullif(btrim(v_lead.company), ''),
        btrim(concat_ws(' ', v_lead.first_name, v_lead.last_name))
      ),
      v_lead.email,
      v_lead.phone,
      v_lead.owner_id
    )
    returning id into v_account;
  end if;

  insert into public.crm_contacts (account_id, first_name, last_name, email, phone, job_title, owner_id)
  values (v_account, v_lead.first_name, v_lead.last_name, v_lead.email, v_lead.phone, v_lead.job_title, v_lead.owner_id)
  returning id into v_contact;

  if coalesce(p_create_deal, true) then
    insert into public.crm_deals (name, account_id, contact_id, amount, stage, probability, owner_id)
    values (
      coalesce(
        nullif(btrim(p_deal_name), ''),
        coalesce(nullif(btrim(v_lead.company), ''), v_lead.first_name) || ' deal'
      ),
      v_account,
      v_contact,
      coalesce(p_deal_amount, v_lead.estimated_value, 0),
      'qualification',
      20,
      v_lead.owner_id
    )
    returning id into v_deal;
  end if;

  update public.crm_leads
  set status = 'converted',
      converted_at = now(),
      converted_account_id = v_account,
      converted_contact_id = v_contact,
      converted_deal_id = v_deal
  where id = p_lead_id;

  -- Move open lead activities onto the new records.
  update public.crm_activities
  set account_id = coalesce(account_id, v_account),
      contact_id = coalesce(contact_id, v_contact),
      deal_id = coalesce(deal_id, v_deal)
  where lead_id = p_lead_id;

  return jsonb_build_object('account_id', v_account, 'contact_id', v_contact, 'deal_id', v_deal);
end;
$$;

revoke all on function public.convert_crm_lead(uuid, boolean, text, numeric, uuid) from public, anon;
grant execute on function public.convert_crm_lead(uuid, boolean, text, numeric, uuid) to authenticated, service_role;

-- Owner picker for the CRM: people who can own CRM records in this org.
create or replace function public.crm_owner_directory()
returns table (id uuid, full_name text, department_name text)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), ''),
    d.name
  from public.employees e
  left join public.departments d on d.id = e.department_id
  where public.has_crm_access()
    and e.organization_id = public.current_org_id()
    and lower(coalesce(e.employment_status, 'active')) in ('active', 'probation', 'notice', 'on-leave')
    and (
      d.is_sales
      or exists (
        select 1 from public.departments h
        where h.manager_id = e.id and h.is_sales and h.organization_id = e.organization_id
      )
    )
  order by 2 nulls last;
$$;

revoke all on function public.crm_owner_directory() from public, anon;
grant execute on function public.crm_owner_directory() to authenticated, service_role;
