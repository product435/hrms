-- ============================================================
-- final_fix_5.sql
--
-- Builds on final_fix_4.sql: a hand-added lead now belongs to whichever
-- sheet was the active import when it was added (its "sheet_key"). When a
-- different sheet is imported, that lead is archived (reason
-- 'import_replace', same as every other lead an import removes) along
-- with everything it created. When ITS OWN sheet is imported again, the
-- archived lead -- and its deal/account/contact/activities/call logs/
-- WhatsApp rows -- are restored, landing back above the sheet's rows
-- exactly where a hand-added lead belongs. A lead removed by the trash
-- icon (reason 'manual_delete') is never restored by any import, and a
-- lead is never restored under the wrong sheet.
--
-- Depends on final_fix_4.sql having been run first (crm_leads_archive and
-- the other *_archive tables, remove_crm_leads, import_crm_leads,
-- delete_crm_lead). Safe to run twice: every object uses "create or
-- replace function" / "add column if not exists". No table or column is
-- ever dropped. Ends with "notify pgrst, 'reload schema';".
-- ============================================================


-- ------------------------------------------------------------
-- 1. sheet_key / archive_reason / restored_at columns, and the normalize
--    function.
-- ------------------------------------------------------------

alter table public.crm_leads
  add column if not exists sheet_key text;

-- crm_leads_archive was created in final_fix_4.sql as a snapshot of
-- crm_leads's columns AT THAT TIME ("like crm_leads including all"), which
-- did not yet include sheet_key -- adding sheet_key to crm_leads just
-- above does not retroactively add it to the already-created archive
-- table, so it must be added here explicitly too.
alter table public.crm_leads_archive
  add column if not exists sheet_key text,
  add column if not exists archive_reason text,
  add column if not exists restored_at timestamptz;

-- restored_at is also needed on every other archive table: once a
-- hand-added lead is restored, its converted deal/account/contact and
-- every activity/call log/WhatsApp row archived alongside it are marked
-- restored too (see import_crm_leads below), so none of them is ever
-- restored a second time if the same sheet is imported yet again.
alter table public.crm_deals_archive add column if not exists restored_at timestamptz;
alter table public.crm_accounts_archive add column if not exists restored_at timestamptz;
alter table public.crm_contacts_archive add column if not exists restored_at timestamptz;
alter table public.crm_activities_archive add column if not exists restored_at timestamptz;
alter table public.crm_call_logs_archive add column if not exists restored_at timestamptz;
alter table public.crm_whatsapp_conversations_archive add column if not exists restored_at timestamptz;
alter table public.crm_whatsapp_messages_archive add column if not exists restored_at timestamptz;

-- File name -> sheet key: lowercased, trimmed, with a trailing Windows/
-- browser duplicate-download suffix like " (1)", " (2)" removed, so
-- "2 Nov. to 7 Nov Sheet.xlsx" and "2 nov. to 7 nov sheet (1).xlsx" are the
-- same sheet.
create or replace function public.crm_normalize_sheet_key(p_file_name text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(lower(btrim(coalesce(p_file_name, ''))), '\s*\([0-9]+\)$', ''),
    ''
  );
$$;

revoke all on function public.crm_normalize_sheet_key(text) from public, anon;
grant execute on function public.crm_normalize_sheet_key(text) to authenticated, service_role;


-- ------------------------------------------------------------
-- 2. Trigger: a hand-added lead (import_batch_id is null on insert, i.e.
--    not inserted by import_crm_leads itself) is stamped with the sheet
--    key of whatever sheet is currently active (the most recent import
--    batch for this org), UNLESS it already has an explicit sheet_key
--    (e.g. the restore step in import_crm_leads inserting a restored
--    lead back with its original sheet_key -- that insert must not be
--    overwritten by "the sheet currently being imported", since the
--    restore runs AFTER the new batch row already exists).
-- ------------------------------------------------------------

create or replace function public.crm_leads_stamp_sheet_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if new.import_batch_id is not null then
    return new;
  end if;
  if new.sheet_key is not null then
    return new;
  end if;
  v_org := new.organization_id;
  if v_org is null then
    v_org := public.current_org_id();
  end if;
  select public.crm_normalize_sheet_key(file_name) into new.sheet_key
  from public.crm_import_batches
  where organization_id = v_org
  order by created_at desc
  limit 1;
  return new;
end;
$$;

revoke all on function public.crm_leads_stamp_sheet_key() from public, anon, authenticated;

drop trigger if exists crm_leads_stamp_sheet_key on public.crm_leads;
create trigger crm_leads_stamp_sheet_key
  before insert on public.crm_leads
  for each row
  execute function public.crm_leads_stamp_sheet_key();

-- This trigger and crm_before_write both fire "before insert" on
-- crm_leads; Postgres runs same-timing triggers on a table in alphabetical
-- order by trigger name, so "crm_before_write" (b) runs before
-- "crm_leads_stamp_sheet_key" (l). crm_before_write never touches
-- organization_id for an unauthenticated (service-role) caller and sets it
-- from current_org_id() for an authenticated one, either way before this
-- trigger reads new.organization_id, so the order is correct in both
-- cases.


-- ------------------------------------------------------------
-- 3. remove_crm_leads: add p_reason, stamp it onto every archived lead row.
--    Cascade and safety rules unchanged from final_fix_4.sql. Still
--    callable only by service_role; import_crm_leads and delete_crm_lead
--    call it as a normal internal function call, unaffected by that
--    revoke.
-- ------------------------------------------------------------

create or replace function public.remove_crm_leads(p_lead_ids uuid[], p_reason text default 'manual_delete')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal_ids uuid[];
  v_account_ids uuid[];
  v_contact_ids uuid[];
  v_removable_account_ids uuid[];
  v_removable_contact_ids uuid[];
  v_leads_deleted int := 0;
  v_deals_deleted int := 0;
  v_accounts_deleted int := 0;
  v_contacts_deleted int := 0;
  v_activities_deleted int := 0;
  v_call_logs_deleted int := 0;
  v_whatsapp_conversations_deleted int := 0;
  v_whatsapp_messages_deleted int := 0;
begin
  if p_lead_ids is null or array_length(p_lead_ids, 1) is null then
    return jsonb_build_object(
      'leads_deleted', 0, 'deals_deleted', 0, 'accounts_deleted', 0,
      'contacts_deleted', 0, 'activities_deleted', 0, 'call_logs_deleted', 0,
      'whatsapp_conversations_deleted', 0, 'whatsapp_messages_deleted', 0
    );
  end if;

  -- What each removed lead converted into.
  select
    array_agg(distinct converted_deal_id) filter (where converted_deal_id is not null),
    array_agg(distinct converted_account_id) filter (where converted_account_id is not null),
    array_agg(distinct converted_contact_id) filter (where converted_contact_id is not null)
  into v_deal_ids, v_account_ids, v_contact_ids
  from public.crm_leads
  where id = any(p_lead_ids);
  v_deal_ids := coalesce(v_deal_ids, array[]::uuid[]);
  v_account_ids := coalesce(v_account_ids, array[]::uuid[]);
  v_contact_ids := coalesce(v_contact_ids, array[]::uuid[]);

  -- Safety check (rule B): an account/contact is removed only if no
  -- SURVIVING lead, deal or contact still references it. "Surviving" means
  -- any row outside this delete's own account/contact/deal set.
  select coalesce(array_agg(a.id), array[]::uuid[]) into v_removable_account_ids
  from unnest(v_account_ids) a(id)
  where not exists (
    select 1 from public.crm_leads l
    where l.converted_account_id = a.id and not (l.id = any(p_lead_ids))
  )
  and not exists (
    select 1 from public.crm_deals d
    where d.account_id = a.id and not (d.id = any(v_deal_ids))
  )
  and not exists (
    select 1 from public.crm_contacts c
    where c.account_id = a.id and not (c.id = any(v_contact_ids))
  );

  select coalesce(array_agg(c.id), array[]::uuid[]) into v_removable_contact_ids
  from unnest(v_contact_ids) c(id)
  where not exists (
    select 1 from public.crm_leads l
    where l.converted_contact_id = c.id and not (l.id = any(p_lead_ids))
  )
  and not exists (
    select 1 from public.crm_deals d
    where d.contact_id = c.id and not (d.id = any(v_deal_ids))
  );

  -- 3a. Archive every row this call will remove, BEFORE removing any of
  -- it. Only crm_leads_archive carries archive_reason (the other archive
  -- tables are keyed to the lead/deal/account/contact ids they belong to,
  -- which already say why they were archived by following those ids back
  -- to the lead row). Every archive table now has TWO trailing columns of
  -- its own (archived_at added by final_fix_4.sql, restored_at added by
  -- final_fix_5.sql), so a positional "select *, now()" (one extra value)
  -- no longer matches an archive table's column count -- every archive
  -- insert here uses an explicit column list instead and supplies null for
  -- restored_at.
  insert into public.crm_activities_archive (
    id, organization_id, activity_type, subject, description, status, due_at, completed_at,
    lead_id, deal_id, account_id, contact_id, owner_id, created_by, created_at, updated_at,
    archived_at, restored_at
  )
  select
    id, organization_id, activity_type, subject, description, status, due_at, completed_at,
    lead_id, deal_id, account_id, contact_id, owner_id, created_by, created_at, updated_at,
    now(), null
  from public.crm_activities
  where lead_id = any(p_lead_ids)
     or deal_id = any(v_deal_ids)
     or account_id = any(v_removable_account_ids)
     or contact_id = any(v_removable_contact_ids);

  insert into public.crm_call_logs_archive (
    id, organization_id, activity_id, lead_id, deal_id, account_id, contact_id, direction,
    outcome, duration_seconds, recording_url, provider, provider_call_id, remarks,
    owner_id, created_by, created_at, updated_at, archived_at, restored_at
  )
  select
    id, organization_id, activity_id, lead_id, deal_id, account_id, contact_id, direction,
    outcome, duration_seconds, recording_url, provider, provider_call_id, remarks,
    owner_id, created_by, created_at, updated_at, now(), null
  from public.crm_call_logs
  where lead_id = any(p_lead_ids)
     or deal_id = any(v_deal_ids)
     or account_id = any(v_removable_account_ids)
     or contact_id = any(v_removable_contact_ids)
     or activity_id in (
       select id from public.crm_activities
       where lead_id = any(p_lead_ids)
          or deal_id = any(v_deal_ids)
          or account_id = any(v_removable_account_ids)
          or contact_id = any(v_removable_contact_ids)
     );

  insert into public.crm_whatsapp_messages_archive (
    id, organization_id, conversation_id, direction, body, provider_message_id, status,
    created_by, created_at, archived_at, restored_at
  )
  select
    m.id, m.organization_id, m.conversation_id, m.direction, m.body, m.provider_message_id,
    m.status, m.created_by, m.created_at, now(), null
  from public.crm_whatsapp_messages m
  where m.conversation_id in (
    select id from public.crm_whatsapp_conversations
    where lead_id = any(p_lead_ids) or contact_id = any(v_removable_contact_ids)
  );

  insert into public.crm_whatsapp_conversations_archive (
    id, organization_id, lead_id, contact_id, customer_phone, status, owner_id,
    created_by, created_at, updated_at, archived_at, restored_at
  )
  select
    id, organization_id, lead_id, contact_id, customer_phone, status, owner_id,
    created_by, created_at, updated_at, now(), null
  from public.crm_whatsapp_conversations
  where lead_id = any(p_lead_ids) or contact_id = any(v_removable_contact_ids);

  insert into public.crm_deals_archive (
    id, organization_id, name, account_id, contact_id, amount, currency, stage,
    probability, expected_close_date, closed_at, lost_reason, notes, owner_id,
    created_by, created_at, updated_at, archived_at, restored_at
  )
  select
    id, organization_id, name, account_id, contact_id, amount, currency, stage,
    probability, expected_close_date, closed_at, lost_reason, notes, owner_id,
    created_by, created_at, updated_at, now(), null
  from public.crm_deals where id = any(v_deal_ids);

  insert into public.crm_contacts_archive (
    id, organization_id, account_id, first_name, last_name, email, phone, job_title,
    notes, owner_id, created_by, created_at, updated_at, archived_at, restored_at
  )
  select
    id, organization_id, account_id, first_name, last_name, email, phone, job_title,
    notes, owner_id, created_by, created_at, updated_at, now(), null
  from public.crm_contacts where id = any(v_removable_contact_ids);

  insert into public.crm_accounts_archive (
    id, organization_id, name, industry, website, email, phone, city, country,
    annual_revenue, employee_count, notes, owner_id, created_by, created_at, updated_at,
    archived_at, restored_at
  )
  select
    id, organization_id, name, industry, website, email, phone, city, country,
    annual_revenue, employee_count, notes, owner_id, created_by, created_at, updated_at,
    now(), null
  from public.crm_accounts where id = any(v_removable_account_ids);

  -- Explicit column list, not "select *, now(), ...": crm_leads_archive's
  -- own trailing columns (archived_at from final_fix_4.sql; sheet_key,
  -- archive_reason, restored_at added by final_fix_5.sql, in that order)
  -- are NOT in the same position as crm_leads.sheet_key (a real column on
  -- the live table itself, positioned wherever its own "add column"
  -- landed) -- a positional "select l.*, ..." would silently misalign
  -- columns the moment the two tables' column orders diverge like this.
  insert into public.crm_leads_archive (
    id, organization_id, first_name, last_name, company, email, phone, job_title,
    source, status, rating, listing_rating, estimated_value, notes, owner_id,
    converted_at, converted_account_id, converted_contact_id, converted_deal_id,
    created_by, created_at, updated_at,
    demo_status, demo_at, demo_outcome, demo_notes, next_follow_up_at,
    import_batch_id, import_sequence, sheet_key,
    archived_at, archive_reason, restored_at
  )
  select
    l.id, l.organization_id, l.first_name, l.last_name, l.company, l.email, l.phone,
    l.job_title, l.source, l.status, l.rating, l.listing_rating, l.estimated_value,
    l.notes, l.owner_id,
    l.converted_at, l.converted_account_id, l.converted_contact_id, l.converted_deal_id,
    l.created_by, l.created_at, l.updated_at,
    l.demo_status, l.demo_at, l.demo_outcome, l.demo_notes, l.next_follow_up_at,
    l.import_batch_id, l.import_sequence, l.sheet_key,
    now(), coalesce(p_reason, 'manual_delete'), null
  from public.crm_leads l where l.id = any(p_lead_ids);

  -- 3b. Delete, dependents first.
  delete from public.crm_whatsapp_messages
  where conversation_id in (
    select id from public.crm_whatsapp_conversations
    where lead_id = any(p_lead_ids) or contact_id = any(v_removable_contact_ids)
  );
  get diagnostics v_whatsapp_messages_deleted = row_count;

  delete from public.crm_whatsapp_conversations
  where lead_id = any(p_lead_ids) or contact_id = any(v_removable_contact_ids);
  get diagnostics v_whatsapp_conversations_deleted = row_count;

  delete from public.crm_call_logs
  where lead_id = any(p_lead_ids)
     or deal_id = any(v_deal_ids)
     or account_id = any(v_removable_account_ids)
     or contact_id = any(v_removable_contact_ids)
     or activity_id in (
       select id from public.crm_activities
       where lead_id = any(p_lead_ids)
          or deal_id = any(v_deal_ids)
          or account_id = any(v_removable_account_ids)
          or contact_id = any(v_removable_contact_ids)
     );
  get diagnostics v_call_logs_deleted = row_count;

  delete from public.crm_activities
  where lead_id = any(p_lead_ids)
     or deal_id = any(v_deal_ids)
     or account_id = any(v_removable_account_ids)
     or contact_id = any(v_removable_contact_ids);
  get diagnostics v_activities_deleted = row_count;

  delete from public.crm_leads where id = any(p_lead_ids);
  get diagnostics v_leads_deleted = row_count;

  delete from public.crm_deals where id = any(v_deal_ids);
  get diagnostics v_deals_deleted = row_count;

  delete from public.crm_contacts where id = any(v_removable_contact_ids);
  get diagnostics v_contacts_deleted = row_count;

  delete from public.crm_accounts where id = any(v_removable_account_ids);
  get diagnostics v_accounts_deleted = row_count;

  return jsonb_build_object(
    'leads_deleted', v_leads_deleted,
    'deals_deleted', v_deals_deleted,
    'accounts_deleted', v_accounts_deleted,
    'contacts_deleted', v_contacts_deleted,
    'activities_deleted', v_activities_deleted,
    'call_logs_deleted', v_call_logs_deleted,
    'whatsapp_conversations_deleted', v_whatsapp_conversations_deleted,
    'whatsapp_messages_deleted', v_whatsapp_messages_deleted
  );
end;
$$;

revoke all on function public.remove_crm_leads(uuid[], text) from public, anon, authenticated;
grant execute on function public.remove_crm_leads(uuid[], text) to service_role;

-- The old 1-argument signature from final_fix_4.sql is replaced by this
-- 2-argument one (p_reason has a default, so every existing 1-argument
-- call site -- there are none left outside this file -- would still
-- resolve). Drop the old overload explicitly so there is only ever one
-- remove_crm_leads to grant/revoke on.
drop function if exists public.remove_crm_leads(uuid[]);


-- ------------------------------------------------------------
-- 4. delete_crm_lead: unchanged behaviour (still 'manual_delete', still
--    security invoker with its own ownership + organisation checks via
--    RLS and crm_can_write()/crm_can_manage_all()), just updated to call
--    the 2-argument remove_crm_leads explicitly.
-- ------------------------------------------------------------

create or replace function public.delete_crm_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead public.crm_leads%rowtype;
begin
  select * into v_lead from public.crm_leads where id = p_lead_id;
  if not found then
    raise exception 'Lead not found.';
  end if;
  if not public.crm_can_write()
     or (v_lead.owner_id <> public.current_employee_id() and not public.crm_can_manage_all())
  then
    raise exception 'You can only delete CRM records you own.';
  end if;
  return public.remove_crm_leads(array[p_lead_id], 'manual_delete');
end;
$$;

revoke all on function public.delete_crm_lead(uuid) from public, anon;
grant execute on function public.delete_crm_lead(uuid) to authenticated, service_role;


-- ------------------------------------------------------------
-- 5. import_crm_leads: remove ALL existing leads with reason
--    'import_replace', insert the sheet, then RESTORE any hand-added lead
--    that belongs to this same sheet and was archived with reason
--    'import_replace' (never 'manual_delete') and not already restored.
--    All inside this one function call: one transaction, nothing removed/
--    inserted/restored unless the whole call succeeds.
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
  v_sheet_key text := public.crm_normalize_sheet_key(p_file_name);
  v_all_lead_ids uuid[];
  v_removal jsonb := '{}'::jsonb;
  v_row jsonb;
  v_duplicate_count int := 0;
  v_inserted_count int := 0;
  v_sequence int := 0;
  v_batch_id uuid;
  v_sheet_phones text[] := array[]::text[];
  v_sheet_emails text[] := array[]::text[];
  v_archived public.crm_leads_archive%rowtype;
  v_restored_count int := 0;
  v_new_lead_id uuid;
  v_can_manage_all boolean;
  v_restore_owner uuid;
begin
  if not public.crm_can_write() then
    raise exception 'Only the sales team or Super Admin can import leads.';
  end if;
  if v_org is null then
    raise exception 'Your account is not linked to an organisation.';
  end if;

  -- crm_before_write/crm_new_tables_before_write both block INSERTing a
  -- row owned by someone other than the caller unless the caller is a
  -- sales lead or admin (crm_can_manage_all()). A restored row's original
  -- owner may be a different rep, so: a sales lead/admin importing keeps
  -- the original owner_id; a plain rep importing gets restored rows
  -- re-assigned to themselves instead, so the import never fails because
  -- of who used to own a restored record.
  v_can_manage_all := public.crm_can_manage_all();
  v_restore_owner := case when v_can_manage_all then null else v_me end;

  -- Rule A: an import replaces ALL leads, not just the previous batch.
  select coalesce(array_agg(id), array[]::uuid[]) into v_all_lead_ids
  from public.crm_leads
  where organization_id = v_org;

  if array_length(v_all_lead_ids, 1) is not null then
    v_removal := public.remove_crm_leads(v_all_lead_ids, 'import_replace');
  end if;

  insert into public.crm_import_batches (organization_id, uploaded_by, owner_id, file_name, total_rows, status)
  values (v_org, v_me, v_me, p_file_name, jsonb_array_length(p_rows), 'processing')
  returning id into v_batch_id;

  -- Every lead in the org was just removed by remove_crm_leads() above, so
  -- there is nothing left in the database to duplicate-check against, and
  -- the client no longer filters duplicate rows out of the same sheet
  -- before sending them. Every row of the sheet is imported; also collect
  -- each row's normalized phone/email so the restore step below can skip
  -- restoring a hand-added lead that the sheet itself already covers.
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    insert into public.crm_leads (
      first_name, last_name, company, email, phone, job_title,
      source, status, rating, estimated_value, listing_rating,
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
      case when v_row->>'listing_rating' ~ '^[0-9.]+$' then (v_row->>'listing_rating')::numeric else null end,
      v_batch_id, v_sequence
    );
    v_inserted_count := v_inserted_count + 1;
    v_sequence := v_sequence + 1;

    if length(regexp_replace(coalesce(v_row->>'phone', ''), '\D', '', 'g')) >= 10 then
      v_sheet_phones := v_sheet_phones || right(regexp_replace(v_row->>'phone', '\D', '', 'g'), 10);
    end if;
    if btrim(coalesce(v_row->>'email', '')) <> '' then
      v_sheet_emails := v_sheet_emails || lower(btrim(v_row->>'email'));
    end if;
  end loop;

  update public.crm_import_batches
  set inserted_count = v_inserted_count,
      duplicate_count = v_duplicate_count,
      status = 'done'
  where id = v_batch_id;

  -- Restore hand-added leads that belong to THIS sheet: archived by an
  -- earlier import ('import_replace'), never deleted by the trash icon
  -- ('manual_delete'), hand-added (import_batch_id is null), matching this
  -- sheet's key, and not already restored. Processed oldest-archived-first
  -- so that if the same sheet_key was archived more than once over time
  -- (re-imported several times with manual leads added each time), the
  -- earliest surviving snapshot restores first -- "skip if id already
  -- exists" then protects against restoring the same lead id twice if
  -- more than one archive row for it exists for any reason.
  if v_sheet_key is not null then
    for v_archived in
      select * from public.crm_leads_archive
      where archive_reason = 'import_replace'
        and sheet_key = v_sheet_key
        and import_batch_id is null
        and restored_at is null
        and organization_id = v_org
      order by archived_at asc
    loop
      -- Skip if this id somehow already exists live (should not happen,
      -- since it was archived precisely because it did not survive the
      -- removal above, but a restore must never risk a duplicate key).
      if exists (select 1 from public.crm_leads where id = v_archived.id) then
        continue;
      end if;

      -- Skip restoring this lead if its own phone/email is already covered
      -- by a row in the sheet just imported (the sheet itself re-added the
      -- same person).
      if (
        length(regexp_replace(coalesce(v_archived.phone, ''), '\D', '', 'g')) >= 10
        and right(regexp_replace(v_archived.phone, '\D', '', 'g'), 10) = any(v_sheet_phones)
      ) or (
        btrim(coalesce(v_archived.email, '')) <> ''
        and lower(btrim(v_archived.email)) = any(v_sheet_emails)
      ) then
        continue;
      end if;

      -- NOTE on created_at/created_by/organization_id: the pre-existing
      -- crm_before_write trigger (20261102110000_sales_crm.sql) always
      -- forces new.organization_id/created_by/created_at on INSERT when
      -- auth.uid() is not null, i.e. whenever a real logged-in user is
      -- the one running this import over the normal RPC path. So when
      -- import_crm_leads runs as an authenticated sales rep (the normal
      -- case), a restored lead's organization_id/created_by/created_at
      -- below are NOT actually what gets stored -- they become the
      -- current org/importing user/now() instead, same as any other
      -- INSERT by that trigger's design. Everything else (id, contact
      -- info, status, rating, listing_rating, conversion links, demo
      -- fields, sheet_key) is preserved exactly. This is accepted,
      -- intentional behaviour -- not a bug -- so as not to modify that
      -- trigger's existing security behaviour for this one restore step.
      -- import_sequence stays null and sheet_key is preserved, which is
      -- what keeps the restored lead sorted above the sheet's own rows.
      insert into public.crm_leads (
        id, organization_id, first_name, last_name, company, email, phone, job_title,
        source, status, rating, listing_rating, estimated_value, notes, owner_id,
        converted_at, converted_account_id, converted_contact_id, converted_deal_id,
        created_by, created_at, updated_at,
        demo_status, demo_at, demo_outcome, demo_notes, next_follow_up_at,
        import_batch_id, import_sequence, sheet_key
      ) values (
        v_archived.id, v_archived.organization_id, v_archived.first_name, v_archived.last_name,
        v_archived.company, v_archived.email, v_archived.phone, v_archived.job_title,
        v_archived.source, v_archived.status, v_archived.rating, v_archived.listing_rating,
        v_archived.estimated_value, v_archived.notes, coalesce(v_restore_owner, v_archived.owner_id),
        v_archived.converted_at, v_archived.converted_account_id, v_archived.converted_contact_id,
        v_archived.converted_deal_id, v_archived.created_by, v_archived.created_at, v_archived.updated_at,
        v_archived.demo_status, v_archived.demo_at, v_archived.demo_outcome, v_archived.demo_notes,
        v_archived.next_follow_up_at, null, null, v_archived.sheet_key
      );
      v_new_lead_id := v_archived.id;

      -- Restore what it converted into, and everything linked to any of
      -- those, from the other archive tables -- by the SAME original ids,
      -- skipping any id that already exists live for the same reason as
      -- above. Each archive table has extra columns (archived_at,
      -- restored_at) beyond its live table's own columns, so every one of
      -- these restores an explicit column list rather than "select *".
      -- ORDER MATTERS: account and contact must be restored BEFORE the
      -- deal, because crm_before_write's crm_deals branch validates that
      -- new.account_id/new.contact_id already exist and raises "Account
      -- not found."/"Contact not found." otherwise.
      if v_archived.converted_account_id is not null
         and not exists (select 1 from public.crm_accounts where id = v_archived.converted_account_id) then
        insert into public.crm_accounts (
          id, organization_id, name, industry, website, email, phone, city, country,
          annual_revenue, employee_count, notes, owner_id, created_by, created_at, updated_at
        )
        select
          id, organization_id, name, industry, website, email, phone, city, country,
          annual_revenue, employee_count, notes, coalesce(v_restore_owner, owner_id),
          created_by, created_at, updated_at
        from public.crm_accounts_archive where id = v_archived.converted_account_id;
      end if;
      if v_archived.converted_contact_id is not null
         and not exists (select 1 from public.crm_contacts where id = v_archived.converted_contact_id) then
        insert into public.crm_contacts (
          id, organization_id, account_id, first_name, last_name, email, phone, job_title,
          notes, owner_id, created_by, created_at, updated_at
        )
        select
          id, organization_id, account_id, first_name, last_name, email, phone, job_title,
          notes, coalesce(v_restore_owner, owner_id), created_by, created_at, updated_at
        from public.crm_contacts_archive where id = v_archived.converted_contact_id;
      end if;
      if v_archived.converted_deal_id is not null
         and not exists (select 1 from public.crm_deals where id = v_archived.converted_deal_id) then
        insert into public.crm_deals (
          id, organization_id, name, account_id, contact_id, amount, currency, stage,
          probability, expected_close_date, closed_at, lost_reason, notes, owner_id,
          created_by, created_at, updated_at
        )
        select
          id, organization_id, name, account_id, contact_id, amount, currency, stage,
          probability, expected_close_date, closed_at, lost_reason, notes,
          coalesce(v_restore_owner, owner_id), created_by, created_at, updated_at
        from public.crm_deals_archive where id = v_archived.converted_deal_id;
      end if;

      insert into public.crm_activities (
        id, organization_id, activity_type, subject, description, status, due_at, completed_at,
        lead_id, deal_id, account_id, contact_id, owner_id, created_by, created_at, updated_at
      )
      select
        aa.id, aa.organization_id, aa.activity_type, aa.subject, aa.description, aa.status,
        aa.due_at, aa.completed_at, aa.lead_id, aa.deal_id, aa.account_id, aa.contact_id,
        coalesce(v_restore_owner, aa.owner_id), aa.created_by, aa.created_at, aa.updated_at
      from public.crm_activities_archive aa
      where (
          aa.lead_id = v_new_lead_id
          or (v_archived.converted_deal_id is not null and aa.deal_id = v_archived.converted_deal_id)
          or (v_archived.converted_account_id is not null and aa.account_id = v_archived.converted_account_id)
          or (v_archived.converted_contact_id is not null and aa.contact_id = v_archived.converted_contact_id)
        )
        and not exists (select 1 from public.crm_activities act where act.id = aa.id);

      insert into public.crm_call_logs (
        id, organization_id, activity_id, lead_id, deal_id, account_id, contact_id, direction,
        outcome, duration_seconds, recording_url, provider, provider_call_id, remarks,
        owner_id, created_by, created_at, updated_at
      )
      select
        ca.id, ca.organization_id, ca.activity_id, ca.lead_id, ca.deal_id, ca.account_id,
        ca.contact_id, ca.direction, ca.outcome, ca.duration_seconds, ca.recording_url,
        ca.provider, ca.provider_call_id, ca.remarks, coalesce(v_restore_owner, ca.owner_id),
        ca.created_by, ca.created_at, ca.updated_at
      from public.crm_call_logs_archive ca
      where (
          ca.lead_id = v_new_lead_id
          or (v_archived.converted_deal_id is not null and ca.deal_id = v_archived.converted_deal_id)
          or (v_archived.converted_account_id is not null and ca.account_id = v_archived.converted_account_id)
          or (v_archived.converted_contact_id is not null and ca.contact_id = v_archived.converted_contact_id)
          or exists (select 1 from public.crm_activities act where act.id = ca.activity_id)
        )
        and not exists (select 1 from public.crm_call_logs cl where cl.id = ca.id);

      insert into public.crm_whatsapp_conversations (
        id, organization_id, lead_id, contact_id, customer_phone, status, owner_id,
        created_by, created_at, updated_at
      )
      select
        wca.id, wca.organization_id, wca.lead_id, wca.contact_id, wca.customer_phone,
        wca.status, coalesce(v_restore_owner, wca.owner_id), wca.created_by, wca.created_at,
        wca.updated_at
      from public.crm_whatsapp_conversations_archive wca
      where (
          wca.lead_id = v_new_lead_id
          or (v_archived.converted_contact_id is not null and wca.contact_id = v_archived.converted_contact_id)
        )
        and not exists (select 1 from public.crm_whatsapp_conversations wc where wc.id = wca.id);

      insert into public.crm_whatsapp_messages (
        id, organization_id, conversation_id, direction, body, provider_message_id, status,
        created_by, created_at
      )
      select
        wma.id, wma.organization_id, wma.conversation_id, wma.direction, wma.body,
        wma.provider_message_id, wma.status, wma.created_by, wma.created_at
      from public.crm_whatsapp_messages_archive wma
      where exists (
          select 1 from public.crm_whatsapp_conversations wc where wc.id = wma.conversation_id
        )
        and not exists (select 1 from public.crm_whatsapp_messages wm where wm.id = wma.id);

      -- Mark this archive row (and the matching rows in the other archive
      -- tables, for completeness/auditability) as restored so it is never
      -- restored again.
      update public.crm_leads_archive set restored_at = now() where id = v_archived.id and restored_at is null;
      if v_archived.converted_deal_id is not null then
        update public.crm_deals_archive set restored_at = now() where id = v_archived.converted_deal_id and restored_at is null;
      end if;
      if v_archived.converted_account_id is not null then
        update public.crm_accounts_archive set restored_at = now() where id = v_archived.converted_account_id and restored_at is null;
      end if;
      if v_archived.converted_contact_id is not null then
        update public.crm_contacts_archive set restored_at = now() where id = v_archived.converted_contact_id and restored_at is null;
      end if;
      update public.crm_activities_archive set restored_at = now()
      where restored_at is null
        and (
          lead_id = v_new_lead_id
          or (v_archived.converted_deal_id is not null and deal_id = v_archived.converted_deal_id)
          or (v_archived.converted_account_id is not null and account_id = v_archived.converted_account_id)
          or (v_archived.converted_contact_id is not null and contact_id = v_archived.converted_contact_id)
        );
      update public.crm_call_logs_archive set restored_at = now()
      where restored_at is null
        and (
          lead_id = v_new_lead_id
          or (v_archived.converted_deal_id is not null and deal_id = v_archived.converted_deal_id)
          or (v_archived.converted_account_id is not null and account_id = v_archived.converted_account_id)
          or (v_archived.converted_contact_id is not null and contact_id = v_archived.converted_contact_id)
        );
      update public.crm_whatsapp_conversations_archive set restored_at = now()
      where restored_at is null
        and (
          lead_id = v_new_lead_id
          or (v_archived.converted_contact_id is not null and contact_id = v_archived.converted_contact_id)
        );
      update public.crm_whatsapp_messages_archive set restored_at = now()
      where restored_at is null
        and conversation_id in (
          select id from public.crm_whatsapp_conversations_archive
          where lead_id = v_new_lead_id
             or (v_archived.converted_contact_id is not null and contact_id = v_archived.converted_contact_id)
        );

      v_restored_count := v_restored_count + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'inserted_count', v_inserted_count,
    'duplicate_count', v_duplicate_count,
    'deleted_count', coalesce((v_removal->>'leads_deleted')::int, 0),
    'restored_count', v_restored_count
  );
end;
$$;

revoke all on function public.import_crm_leads(text, jsonb) from public, anon;
grant execute on function public.import_crm_leads(text, jsonb) to authenticated, service_role;


-- ------------------------------------------------------------
-- 6. ONE-TIME BACKFILL for leads already archived by earlier imports
--    (before sheet_key/archive_reason existed).
--
--    archive_reason = 'import_replace' for every crm_leads_archive row
--    whose archived_at equals some crm_import_batches.created_at (archived
--    in the same transaction as that import -- import_crm_leads inserts
--    the batch row and archives the replaced leads inside the same
--    function call, so their timestamps, both from now(), coincide to the
--    same transaction snapshot time in Postgres). Everything else gets
--    'manual_delete' (archived by the trash icon, which has no batch to
--    coincide with).
--
--    For the 'import_replace' rows that are hand-added (import_batch_id
--    is null), sheet_key is backfilled to the normalized file_name of the
--    latest batch whose created_at <= the archived lead's own created_at
--    -- the sheet that was active when that lead was originally added.
-- ------------------------------------------------------------

update public.crm_leads_archive la
set archive_reason = 'import_replace'
where la.archive_reason is null
  and exists (
    select 1 from public.crm_import_batches b
    where b.organization_id = la.organization_id
      and b.created_at = la.archived_at
  );

update public.crm_leads_archive la
set archive_reason = 'manual_delete'
where la.archive_reason is null;

update public.crm_leads_archive la
set sheet_key = public.crm_normalize_sheet_key(
  (
    select b.file_name from public.crm_import_batches b
    where b.organization_id = la.organization_id
      and b.created_at <= la.created_at
    order by b.created_at desc
    limit 1
  )
)
where la.archive_reason = 'import_replace'
  and la.import_batch_id is null
  and la.sheet_key is null;

-- Review: hand-added leads that are now restorable, with the sheet_key
-- they will come back under.
select
  la.id, la.first_name, la.last_name, la.company, la.phone, la.email,
  la.sheet_key, la.archived_at, la.restored_at
from public.crm_leads_archive la
where la.archive_reason = 'import_replace'
  and la.import_batch_id is null
  and la.restored_at is null
order by la.archived_at desc;


notify pgrst, 'reload schema';
