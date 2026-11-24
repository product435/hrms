-- Sales CRM enhancements: bulk lead import tracking, call logs, WhatsApp
-- conversation foundation, and demo tracking on leads.
--
-- This migration is additive only. It does not alter crm_before_write,
-- convert_crm_lead, or any RLS policy on the five original CRM tables
-- (crm_accounts, crm_contacts, crm_leads, crm_deals, crm_activities).
-- Every new table repeats the exact access model already established in
-- 20261102110000_sales_crm.sql: visible to has_crm_access() (admin,
-- general_manager, or a sales-department member), writable by crm_can_write()
-- (admin or sales-department member), and editable/deletable only by the
-- row's own owner unless crm_can_manage_all() (admin, or a sales lead).

-- ------------------------------------------------------------
-- 1. Demo tracking on crm_leads (reuses the lead row, no new entity)
-- ------------------------------------------------------------

alter table public.crm_leads
  add column if not exists demo_status text not null default 'none'
    check (demo_status in ('none', 'scheduled', 'completed', 'rescheduled', 'cancelled')),
  add column if not exists demo_at timestamptz,
  add column if not exists demo_outcome text,
  add column if not exists demo_notes text,
  add column if not exists next_follow_up_at timestamptz;

create index if not exists idx_crm_leads_demo_status on public.crm_leads (organization_id, demo_status);
create index if not exists idx_crm_leads_next_follow_up on public.crm_leads (next_follow_up_at);

-- ------------------------------------------------------------
-- 2. Extend crm_activities.activity_type with demo and whatsapp
-- ------------------------------------------------------------

alter table public.crm_activities drop constraint if exists crm_activities_activity_type_check;
alter table public.crm_activities
  add constraint crm_activities_activity_type_check
  check (activity_type in ('call', 'meeting', 'email', 'task', 'note', 'demo', 'whatsapp'));

-- ------------------------------------------------------------
-- 3. Bulk import batch tracking
-- ------------------------------------------------------------

-- owner_id is included here (and backfilled below for a table that already
-- exists without it) because the live database already has this table with
-- a NOT NULL owner_id column, created before this migration file existed.
-- This definition is written to match that reality, not the other way
-- around.
create table if not exists public.crm_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by uuid not null references public.employees(id) on delete restrict,
  owner_id uuid not null references public.employees(id) on delete restrict,
  file_name text,
  total_rows integer not null default 0 check (total_rows >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  status text not null default 'processing' check (status in ('processing', 'done', 'failed')),
  error_summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill path for a database where this table already exists from before
-- this migration: adds the column only if missing, defaulting existing rows
-- to their own uploader, then enforces not-null going forward.
alter table public.crm_import_batches add column if not exists owner_id uuid references public.employees(id) on delete restrict;
update public.crm_import_batches set owner_id = uploaded_by where owner_id is null;
alter table public.crm_import_batches alter column owner_id set not null;
create index if not exists idx_crm_import_batches_owner on public.crm_import_batches (owner_id);

alter table public.crm_leads
  add column if not exists import_batch_id uuid references public.crm_import_batches(id) on delete set null;

create index if not exists idx_crm_import_batches_org on public.crm_import_batches (organization_id, created_at desc);
create index if not exists idx_crm_leads_import_batch on public.crm_leads (import_batch_id);

-- ------------------------------------------------------------
-- 4. Call logs (call-specific detail; crm_activities stays the log entry)
-- ------------------------------------------------------------

create table if not exists public.crm_call_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  activity_id uuid not null references public.crm_activities(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  deal_id uuid references public.crm_deals(id) on delete set null,
  account_id uuid references public.crm_accounts(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  outcome text check (outcome in (
    'connected', 'no_answer', 'wrong_number', 'busy', 'call_back_required', 'interested', 'not_interested'
  )),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  recording_url text,
  provider text,
  provider_call_id text,
  remarks text,
  owner_id uuid not null references public.employees(id) on delete restrict,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_call_logs_activity on public.crm_call_logs (activity_id);
create index if not exists idx_crm_call_logs_owner on public.crm_call_logs (owner_id);
create index if not exists idx_crm_call_logs_lead on public.crm_call_logs (lead_id);

-- ------------------------------------------------------------
-- 5. WhatsApp conversations and messages (foundation only)
-- ------------------------------------------------------------

create table if not exists public.crm_whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  customer_phone text not null check (char_length(btrim(customer_phone)) between 3 and 32),
  status text not null default 'open' check (status in ('open', 'closed')),
  owner_id uuid not null references public.employees(id) on delete restrict,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.crm_whatsapp_conversations(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  body text not null check (char_length(btrim(body)) between 1 and 4096),
  provider_message_id text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_whatsapp_conversations_org_phone
  on public.crm_whatsapp_conversations (organization_id, customer_phone);
create index if not exists idx_crm_whatsapp_conversations_owner
  on public.crm_whatsapp_conversations (owner_id);
create index if not exists idx_crm_whatsapp_messages_conversation
  on public.crm_whatsapp_messages (conversation_id, created_at);

-- ------------------------------------------------------------
-- 6. Write guard for the new owned tables (mirrors crm_before_write)
-- ------------------------------------------------------------

create or replace function public.crm_new_tables_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_me uuid := public.current_employee_id();
begin
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.organization_id := v_org;
    -- crm_import_batches has owner_id (confirmed against the live
    -- database) but no created_by column -- only uploaded_by, which the
    -- caller sets explicitly. So it joins the owner_id branches below but
    -- stays out of the created_by ones.
    if tg_table_name in ('crm_call_logs', 'crm_whatsapp_conversations') then
      new.created_by := coalesce(new.created_by, v_me);
    end if;
    if tg_table_name = 'crm_whatsapp_messages' then
      new.created_by := coalesce(new.created_by, v_me);
    end if;
    new.created_at := now();
    if tg_table_name in ('crm_import_batches', 'crm_call_logs', 'crm_whatsapp_conversations')
       and new.owner_id is null then
      new.owner_id := v_me;
    end if;
  else
    if new.organization_id is distinct from old.organization_id then
      raise exception 'CRM records cannot move between organisations.';
    end if;
    new.created_at := old.created_at;
  end if;

  if new.organization_id is null then
    raise exception 'Your account is not linked to an organisation.';
  end if;

  if tg_table_name in ('crm_import_batches', 'crm_call_logs', 'crm_whatsapp_conversations') then
    if not public.crm_owner_in_org(new.owner_id) then
      raise exception 'Owner must be an employee of your organisation.';
    end if;
    if tg_op = 'INSERT' then
      if new.owner_id is distinct from v_me and not public.crm_can_manage_all() then
        raise exception 'Only a sales lead or super admin can assign CRM records to someone else.';
      end if;
    elsif new.owner_id is distinct from old.owner_id and not public.crm_can_manage_all() then
      raise exception 'Only a sales lead or super admin can assign CRM records to someone else.';
    end if;
  end if;

  if tg_table_name = 'crm_call_logs' then
    select a.lead_id, a.deal_id, a.account_id, a.contact_id
      into new.lead_id, new.deal_id, new.account_id, new.contact_id
      from public.crm_activities a
      where a.id = new.activity_id and a.organization_id = new.organization_id;
    if new.activity_id is null or not found then
      raise exception 'Activity not found.';
    end if;

  elsif tg_table_name = 'crm_whatsapp_conversations' then
    if new.lead_id is not null and not exists (
      select 1 from public.crm_leads l where l.id = new.lead_id and l.organization_id = new.organization_id
    ) then
      raise exception 'Lead not found.';
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.crm_contacts c where c.id = new.contact_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Contact not found.';
    end if;

  elsif tg_table_name = 'crm_whatsapp_messages' then
    declare
      v_conv_org uuid;
      v_conv_owner uuid;
    begin
      select organization_id, owner_id into v_conv_org, v_conv_owner
        from public.crm_whatsapp_conversations
        where id = new.conversation_id;
      if v_conv_org is null or v_conv_org is distinct from v_org then
        raise exception 'Conversation not found.';
      end if;
      if v_conv_owner is distinct from v_me and not public.crm_can_manage_all() then
        raise exception 'Only the conversation owner or a sales lead can write to it.';
      end if;
      new.organization_id := v_conv_org;
    end;
  end if;

  if tg_table_name <> 'crm_whatsapp_messages' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.crm_new_tables_before_write() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['crm_import_batches', 'crm_call_logs', 'crm_whatsapp_conversations', 'crm_whatsapp_messages']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_before_write', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.crm_new_tables_before_write()',
      t || '_before_write',
      t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 7. Row-level security on every new table (identical pattern)
-- ------------------------------------------------------------

do $$
declare
  t text;
  -- crm_import_batches really does have owner_id (confirmed against the
  -- live database), so all three tables here get the same owner-or-
  -- manage-all check on update/delete.
  owner_clause text := ' and (owner_id = public.current_employee_id() or public.crm_can_manage_all())';
begin
  foreach t in array array['crm_import_batches', 'crm_call_logs', 'crm_whatsapp_conversations']
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
           and public.crm_can_write()' || owner_clause || '
         )
         with check (
           organization_id = public.current_org_id()
           and public.crm_can_write()' || owner_clause || '
         )',
      t || '_update', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (
         organization_id = public.current_org_id()
         and public.crm_can_write()' || owner_clause || '
       )',
      t || '_delete', t
    );
  end loop;
end $$;

-- crm_whatsapp_messages has no owner_id of its own; ownership comes from its
-- parent conversation, so its policies check that instead.
alter table public.crm_whatsapp_messages enable row level security;
revoke all on public.crm_whatsapp_messages from anon;
grant select, insert, update, delete on public.crm_whatsapp_messages to authenticated;

drop policy if exists crm_whatsapp_messages_select on public.crm_whatsapp_messages;
create policy crm_whatsapp_messages_select on public.crm_whatsapp_messages for select to authenticated using (
  organization_id = public.current_org_id() and public.has_crm_access()
);

drop policy if exists crm_whatsapp_messages_insert on public.crm_whatsapp_messages;
create policy crm_whatsapp_messages_insert on public.crm_whatsapp_messages for insert to authenticated with check (
  organization_id = public.current_org_id()
  and public.crm_can_write()
  and exists (
    select 1 from public.crm_whatsapp_conversations c
    where c.id = conversation_id
      and c.organization_id = public.current_org_id()
      and (c.owner_id = public.current_employee_id() or public.crm_can_manage_all())
  )
);

drop policy if exists crm_whatsapp_messages_delete on public.crm_whatsapp_messages;
create policy crm_whatsapp_messages_delete on public.crm_whatsapp_messages for delete to authenticated using (
  organization_id = public.current_org_id()
  and public.crm_can_write()
  and exists (
    select 1 from public.crm_whatsapp_conversations c
    where c.id = conversation_id
      and c.organization_id = public.current_org_id()
      and (c.owner_id = public.current_employee_id() or public.crm_can_manage_all())
  )
);
-- No update policy: messages are append-only once sent/received.
