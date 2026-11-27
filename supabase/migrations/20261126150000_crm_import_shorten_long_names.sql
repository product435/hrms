-- CRM import: shorten over-length names instead of rejecting them, and
-- insert the notes field for new leads (previously silently dropped).
--
-- Supersedes 20261126140000_crm_import_replace_previous_batch.sql's
-- import_crm_leads() for the "new lead" insert path only. Everything else
-- in that migration (replace-the-caller's-own-previous-batch logic,
-- duplicate/ambiguous detection, restore-by-sheet-key for hand-added
-- leads, authorization) is UNCHANGED, byte-for-byte, from that file.
--
-- Problem (confirmed with a real 1450-row sheet): a business name over
-- crm_leads_first_name_check's 100-character limit (e.g. a long SEO-style
-- listing name) was sent to the database unmodified, the insert failed
-- with the check-constraint error, and the row was counted as "failed."
-- The frontend ALSO excluded these rows from the request entirely before
-- this point, so in practice the row simply vanished from the user's view
-- with no way to recover it short of manually editing the sheet.
--
-- Fix: a first_name over 100 characters is shortened to 100 characters at
-- a word boundary (never mid-word, and never a silent, undiscoverable
-- truncation) -- the FULL original name is preserved by appending
-- "Full name from sheet: <full name>" to the lead's notes field. This
-- mirrors the frontend's own shortenAtWordBoundary() in CrmForms.tsx
-- exactly, so the two never disagree about what the final stored name
-- looks like -- this is a defensive backstop in case a row ever reaches
-- this function without having already been shortened client-side (e.g.
-- a future caller, or a direct RPC call), not the primary place
-- shortening happens.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

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
  v_prev_batch uuid;
  v_removable_ids uuid[];
  v_removal jsonb := '{}'::jsonb;
  v_row jsonb;
  v_row_number int := 0;
  v_phone text;
  v_email text;
  v_listing_rating numeric;
  v_rating text;
  v_first_name text;
  v_first_name_full text;
  v_first_name_shortened boolean;
  v_notes text;
  v_matches uuid[];
  v_new_count int := 0;
  v_duplicate_count int := 0;
  v_ambiguous_count int := 0;
  v_invalid_count int := 0;
  v_shortened_count int := 0;
  v_failed_count int := 0;
  v_sequence int := 0;
  v_batch_id uuid;
  v_errors jsonb := '[]'::jsonb;
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

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file has no rows to import.';
  end if;

  select cb.id into v_prev_batch
  from public.crm_import_batches cb
  where cb.organization_id = v_org and cb.uploaded_by = v_me
  order by cb.created_at desc
  limit 1;

  if v_prev_batch is not null then
    select coalesce(array_agg(id), array[]::uuid[]) into v_removable_ids
    from public.crm_leads
    where import_batch_id = v_prev_batch and owner_id = v_me;
  else
    v_removable_ids := array[]::uuid[];
  end if;

  v_can_manage_all := public.crm_can_manage_all();
  v_restore_owner := case when v_can_manage_all then null else v_me end;

  insert into public.crm_import_batches (organization_id, uploaded_by, owner_id, file_name, total_rows, status)
  values (v_org, v_me, v_me, p_file_name, jsonb_array_length(p_rows), 'processing')
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_number := v_row_number + 1;

    v_matches := array(
      select id from unnest(public.crm_match_lead_ids(v_row->>'phone', v_row->>'email')) id
      where not (id = any(v_removable_ids))
    );

    if array_length(v_matches, 1) > 1 then
      v_ambiguous_count := v_ambiguous_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row', v_row_number, 'first_name', coalesce(v_row->>'first_name', ''), 'reason', 'ambiguous')
      );
      continue;
    end if;
    if array_length(v_matches, 1) = 1 then
      v_duplicate_count := v_duplicate_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row', v_row_number, 'first_name', coalesce(v_row->>'first_name', ''), 'reason', 'duplicate')
      );
      continue;
    end if;

    v_phone := right(regexp_replace(coalesce(v_row->>'phone', ''), '\D', '', 'g'), 10);
    if length(regexp_replace(coalesce(v_row->>'phone', ''), '\D', '', 'g')) < 10 then
      v_phone := null;
    end if;
    v_email := lower(btrim(coalesce(v_row->>'email', '')));
    if v_email = '' then
      v_email := null;
    end if;

    v_first_name_full := nullif(btrim(v_row->>'first_name'), '');
    if v_first_name_full is null and nullif(btrim(v_row->>'company'), '') is null
       and v_email is null and v_phone is null
    then
      v_invalid_count := v_invalid_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row', v_row_number, 'first_name', '', 'reason', 'invalid')
      );
      continue;
    end if;
    v_first_name_full := coalesce(v_first_name_full, 'Unknown');

    -- Shorten at a word boundary (never mid-word, never silently dropped
    -- from the batch) rather than rejecting the row. The frontend already
    -- does this before the row ever reaches here, with the identical
    -- 100-character limit and word-boundary rule -- this is the backstop
    -- for any caller that does not. The full original name is never lost:
    -- it is appended to notes.
    v_first_name_shortened := char_length(v_first_name_full) > 100;
    if v_first_name_shortened then
      v_first_name := left(
        regexp_replace(left(v_first_name_full, 100), '\s+\S*$', ''),
        100
      );
      if nullif(btrim(v_first_name), '') is null or char_length(v_first_name) < 50 then
        -- No reasonable word boundary near the limit (e.g. one very long
        -- word) -- a hard cut at 100 is the only option left.
        v_first_name := left(v_first_name_full, 100);
      end if;
      v_shortened_count := v_shortened_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row', v_row_number, 'first_name', v_first_name, 'reason', 'shortened')
      );
    else
      v_first_name := v_first_name_full;
    end if;

    v_notes := nullif(btrim(v_row->>'notes'), '');
    if v_first_name_shortened then
      v_notes := concat_ws(' | ', v_notes, 'Full name from sheet: ' || v_first_name_full);
    end if;

    v_listing_rating := null;
    if v_row->>'listing_rating' ~ '^[0-9]+(\.[0-9]+)?$' then
      v_listing_rating := (v_row->>'listing_rating')::numeric;
      if v_listing_rating < 0 or v_listing_rating > 5 then
        v_listing_rating := null;
      end if;
    end if;

    v_rating := lower(btrim(coalesce(v_row->>'rating', '')));
    if v_rating not in ('hot', 'warm', 'cold') then
      v_rating := null;
    end if;

    begin
      insert into public.crm_leads (
        first_name, last_name, company, email, phone, job_title,
        source, status, rating, estimated_value, listing_rating, notes,
        import_batch_id, import_sequence
      ) values (
        v_first_name,
        nullif(btrim(v_row->>'last_name'), ''),
        nullif(btrim(v_row->>'company'), ''),
        v_email,
        v_phone,
        nullif(btrim(v_row->>'job_title'), ''),
        'website', 'new', coalesce(v_rating, 'warm'),
        case when btrim(coalesce(v_row->>'estimated_value', '')) <> '' then (v_row->>'estimated_value')::numeric else null end,
        v_listing_rating,
        v_notes,
        v_batch_id, v_sequence
      );

      v_new_count := v_new_count + 1;
      v_sequence := v_sequence + 1;

      if v_phone is not null then
        v_sheet_phones := v_sheet_phones || v_phone;
      end if;
      if v_email is not null then
        v_sheet_emails := v_sheet_emails || v_email;
      end if;
    exception when others then
      v_failed_count := v_failed_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row', v_row_number, 'first_name', v_first_name, 'reason', 'failed', 'error', sqlerrm)
      );
    end;
  end loop;

  if v_new_count > 0 and array_length(v_removable_ids, 1) is not null then
    v_removal := public.remove_crm_leads(v_removable_ids, 'import_replace');
  end if;

  update public.crm_import_batches
  set inserted_count = v_new_count,
      duplicate_count = v_duplicate_count,
      failed_count = v_failed_count + v_ambiguous_count + v_invalid_count,
      error_summary = case when jsonb_array_length(v_errors) > 0 then v_errors else null end,
      status = 'done'
  where id = v_batch_id;

  if v_sheet_key is not null and v_new_count > 0 then
    for v_archived in
      select * from public.crm_leads_archive
      where archive_reason = 'import_replace'
        and sheet_key = v_sheet_key
        and import_batch_id is null
        and restored_at is null
        and organization_id = v_org
      order by archived_at asc
    loop
      if exists (select 1 from public.crm_leads where id = v_archived.id) then
        continue;
      end if;

      if (
        length(regexp_replace(coalesce(v_archived.phone, ''), '\D', '', 'g')) >= 10
        and right(regexp_replace(v_archived.phone, '\D', '', 'g'), 10) = any(v_sheet_phones)
      ) or (
        btrim(coalesce(v_archived.email, '')) <> ''
        and lower(btrim(v_archived.email)) = any(v_sheet_emails)
      ) then
        continue;
      end if;

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
    'new_count', v_new_count,
    'duplicate_count', v_duplicate_count,
    'ambiguous_count', v_ambiguous_count,
    'invalid_count', v_invalid_count,
    'failed_count', v_failed_count,
    'shortened_count', v_shortened_count,
    'replaced_count', coalesce((v_removal->>'leads_deleted')::int, 0),
    'restored_count', v_restored_count,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.import_crm_leads(text, jsonb) from public, anon;
grant execute on function public.import_crm_leads(text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
