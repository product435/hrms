-- Fixes a wrong assumption from the earlier migration work: crm_import_batches
-- on the LIVE database already has a NOT NULL owner_id column (confirmed by
-- querying it directly), which the migration files never recorded. That
-- caused import_crm_leads to fail with:
--   null value in column "owner_id" of relation "crm_import_batches"
--   violates not-null constraint
--
-- This file only recreates functions and policies (create or replace /
-- drop+create policy) and adds a column if it is somehow still missing.
-- It deletes no rows, drops no table, and is safe to run more than once.

-- ------------------------------------------------------------
-- 1. Make sure owner_id exists and is populated (no-op if it already does,
--    as it does on this database).
-- ------------------------------------------------------------
alter table public.crm_import_batches
  add column if not exists owner_id uuid references public.employees(id) on delete restrict;
update public.crm_import_batches set owner_id = uploaded_by where owner_id is null;
alter table public.crm_import_batches alter column owner_id set not null;
create index if not exists idx_crm_import_batches_owner on public.crm_import_batches (owner_id);

-- ------------------------------------------------------------
-- 2. Trigger: crm_import_batches rejoins the owner_id branches
--    (it has owner_id, just not created_by).
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
    -- crm_import_batches has owner_id but no created_by (only
    -- uploaded_by, set explicitly by the caller).
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

-- ------------------------------------------------------------
-- 3. RLS: crm_import_batches rejoins the owner-or-manage-all check on
--    update/delete (same as crm_call_logs/crm_whatsapp_conversations).
-- ------------------------------------------------------------
do $$
declare
  t text;
  owner_clause text := ' and (owner_id = public.current_employee_id() or public.crm_can_manage_all())';
begin
  foreach t in array array['crm_import_batches', 'crm_call_logs', 'crm_whatsapp_conversations']
  loop
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

-- ------------------------------------------------------------
-- 4. import_crm_leads: set owner_id explicitly on the batch insert (same
--    owner logic the app already uses for new leads -- the current
--    employee, from current_employee_id()/auth.uid()).
-- ------------------------------------------------------------
create or replace function public.import_crm_leads(p_file_name text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_me uuid := public.current_employee_id();
  v_prev_batch uuid;
  v_deleted_count int := 0;
  v_row jsonb;
  v_phone text;
  v_email text;
  v_seen_phones text[] := array[]::text[];
  v_seen_emails text[] := array[]::text[];
  v_existing_phones text[];
  v_existing_emails text[];
  v_duplicate_count int := 0;
  v_inserted_count int := 0;
  v_sequence int := 0;
  v_batch_id uuid;
begin
  if not public.crm_can_write() then
    raise exception 'Only the sales team or Super Admin can import leads.';
  end if;
  if v_org is null then
    raise exception 'Your account is not linked to an organisation.';
  end if;

  select l.import_batch_id into v_prev_batch
  from public.crm_leads l
  where l.organization_id = v_org and l.import_batch_id is not null
  order by l.created_at desc
  limit 1;

  if v_prev_batch is not null then
    delete from public.crm_whatsapp_messages
    where conversation_id in (
      select id from public.crm_whatsapp_conversations
      where lead_id in (select id from public.crm_leads where import_batch_id = v_prev_batch)
    );
    delete from public.crm_whatsapp_conversations
    where lead_id in (select id from public.crm_leads where import_batch_id = v_prev_batch);
    delete from public.crm_call_logs
    where lead_id in (select id from public.crm_leads where import_batch_id = v_prev_batch);

    with deleted as (
      delete from public.crm_leads where import_batch_id = v_prev_batch returning 1
    )
    select count(*) into v_deleted_count from deleted;
  end if;

  select
    array_agg(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10))
      filter (where length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10),
    array_agg(lower(btrim(email))) filter (where btrim(coalesce(email, '')) <> '')
  into v_existing_phones, v_existing_emails
  from public.crm_leads
  where organization_id = v_org;
  v_existing_phones := coalesce(v_existing_phones, array[]::text[]);
  v_existing_emails := coalesce(v_existing_emails, array[]::text[]);

  insert into public.crm_import_batches (organization_id, uploaded_by, owner_id, file_name, total_rows, status)
  values (v_org, v_me, v_me, p_file_name, jsonb_array_length(p_rows), 'processing')
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_phone := right(regexp_replace(coalesce(v_row->>'phone', ''), '\D', '', 'g'), 10);
    if length(regexp_replace(coalesce(v_row->>'phone', ''), '\D', '', 'g')) < 10 then
      v_phone := null;
    end if;
    v_email := lower(btrim(coalesce(v_row->>'email', '')));
    if v_email = '' then
      v_email := null;
    end if;

    if (v_phone is not null and (v_phone = any(v_existing_phones) or v_phone = any(v_seen_phones)))
       or (v_email is not null and (v_email = any(v_existing_emails) or v_email = any(v_seen_emails)))
    then
      v_duplicate_count := v_duplicate_count + 1;
      continue;
    end if;

    if v_phone is not null then
      v_seen_phones := v_seen_phones || v_phone;
    end if;
    if v_email is not null then
      v_seen_emails := v_seen_emails || v_email;
    end if;

    insert into public.crm_leads (
      first_name, last_name, company, email, phone, job_title,
      source, status, rating, estimated_value,
      import_batch_id, import_sequence
    ) values (
      coalesce(nullif(btrim(v_row->>'first_name'), ''), 'Unknown'),
      nullif(btrim(v_row->>'last_name'), ''),
      nullif(btrim(v_row->>'company'), ''),
      nullif(btrim(v_row->>'email'), ''),
      nullif(btrim(v_row->>'phone'), ''),
      nullif(btrim(v_row->>'job_title'), ''),
      'website', 'new', 'warm',
      case when v_row->>'estimated_value' ~ '^[0-9.]+$' then (v_row->>'estimated_value')::numeric else null end,
      v_batch_id, v_sequence
    );
    v_inserted_count := v_inserted_count + 1;
    v_sequence := v_sequence + 1;
  end loop;

  update public.crm_import_batches
  set inserted_count = v_inserted_count,
      duplicate_count = v_duplicate_count,
      status = 'done'
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'inserted_count', v_inserted_count,
    'duplicate_count', v_duplicate_count,
    'deleted_count', v_deleted_count
  );
end;
$$;

revoke all on function public.import_crm_leads(text, jsonb) from public, anon;
grant execute on function public.import_crm_leads(text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
