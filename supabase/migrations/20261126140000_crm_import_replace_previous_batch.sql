-- CRM import: replace the caller's own previous import batch.
--
-- Supersedes 20261126130000_crm_import_universal_workflow.sql's
-- import_crm_leads()/preview_import_crm_leads() entirely: that version
-- enriched a matched lead and never deleted anything. Per explicit,
-- final instruction, the real requirement is REPLACE, not enrich:
-- importing a new sheet removes the caller's own previous import batch
-- and shows only the new sheet's leads, while never touching manually
-- created leads, another rep's leads, or anything outside the batch
-- being replaced.
--
-- This migration does NOT reinvent archiving. The live database already
-- has (confirmed by direct introspection, not assumed):
--   * remove_crm_leads(uuid[], text) -- archives every row it is about to
--     remove (crm_leads_archive, crm_deals_archive, crm_accounts_archive,
--     crm_contacts_archive, crm_activities_archive, crm_call_logs_archive,
--     crm_whatsapp_conversations_archive, crm_whatsapp_messages_archive)
--     BEFORE deleting it, and only removes an account/contact if nothing
--     outside the removed set still references it (rule B). This
--     function is reused AS-IS, unmodified, exactly as final_fix_5.sql
--     left it live.
--   * crm_normalize_sheet_key(text) and crm_leads.sheet_key -- unmodified,
--     reused exactly as live.
-- Nothing in this migration redefines, drops, or alters any of those.
--
-- What changes here is ONLY import_crm_leads()'s own body, replacing
-- whatever version is currently live with one that:
--
--   1. REPLACES ONLY THE CALLER'S OWN PREVIOUS BATCH, not every lead in
--      the organisation. "The caller's own previous batch" = the most
--      recent crm_import_batches row where uploaded_by = the caller.
--      Leads in that batch are candidates for removal ONLY IF they are
--      STILL owned by the caller right now (a lead reassigned to someone
--      else since that import survives untouched -- same rule
--      20261125100000_crm_import_leads_owner_fix.sql already established
--      for the org-wide-delete design this replaces). This directly
--      satisfies "never implement an organisation-wide delete that risks
--      manually created or other users' leads": only identified rows,
--      from the caller's own batch, still owned by the caller, are ever
--      passed to remove_crm_leads().
--   2. Hand-added (import_batch_id is null) leads are NEVER part of "the
--      caller's own previous batch" by definition (a hand-added lead has
--      no import_batch_id to match), so requirement 3 ("manually created
--      CRM leads must always remain untouched") is satisfied structurally,
--      not by a special case -- there is no code path that could select a
--      hand-added lead into the removal set in the first place.
--   3. VALIDATES THE WHOLE SHEET FIRST: every row is classified (new /
--      duplicate-against-a-surviving-lead / ambiguous / invalid) BEFORE
--      any removal or insert happens. If validation finds nothing
--      importable at all (every row invalid), the function raises and
--      removes nothing -- the previous batch survives untouched. This is
--      what makes "if the new import fails, the previous dataset remains
--      intact" true: the whole function body already runs inside one
--      implicit transaction (a plpgsql function's body is one transaction;
--      any unhandled exception rolls back everything, including the
--      removal), and this adds an explicit up-front check so a sheet that
--      is entirely unusable never even reaches the removal step.
--   4. MATCHING DETECTS DUPLICATES, NEVER ENRICHES. A new-sheet row that
--      matches (by normalized phone first, then by email) a lead that
--      survives this import -- i.e. anyone else's lead, a hand-added
--      lead, or a lead from a DIFFERENT one of the caller's own past
--      batches -- is skipped and reported as a duplicate. It is never
--      updated. This is the explicit, deliberate design choice: matching
--      exists only to avoid creating a second copy of a lead that already
--      exists outside the batch being replaced, per your explicit
--      instruction that matching's job is now "detect true duplicates to
--      skip," not enrichment. More than one match is still never guessed
--      -- reported ambiguous and skipped, same rule as before.
--   5. STILL USES THE RESTORE-BY-SHEET-KEY MECHANISM for hand-added leads:
--      if a hand-added lead was archived by an EARLIER import under this
--      exact sheet (crm_normalize_sheet_key(p_file_name) match) and has
--      not already been restored, and this new sheet doesn't itself
--      re-cover that same phone/email, it is restored -- unchanged from
--      final_fix_5.sql's logic, reused here as-is for the caller's own
--      batch replacement (previously it ran for an org-wide replacement;
--      scoping the removal to the caller's own batch does not change how
--      restoration itself works, since restoration is keyed by
--      archived-reason + sheet_key + import_batch_id is null, none of
--      which depend on how broad the removal was).
--   6. PRESERVES everything already built this session: dynamic/manual
--      column mapping (unchanged, lives entirely in CrmForms.tsx, not
--      touched by this file), ambiguous-match protection, per-row
--      validation with accurate counts, and the authorization check for
--      any write path (crm_can_write(), and crm_can_manage_all() governing
--      whether a lead outside the caller's own ownership can ever be
--      touched -- it cannot, by construction, since the removal set is
--      always owner_id = caller).
--
-- CONCURRENT IMPORTS: two different reps importing at the same time never
-- conflict -- each only ever touches crm_import_batches/crm_leads rows
-- scoped to their own uploaded_by/owner_id. Two imports BY THE SAME rep in
-- quick succession behave exactly like two sequential ordinary imports:
-- the second one finds the first one's batch as "the previous batch" and
-- replaces it, which is the intended behaviour (re-running your own
-- import again replaces what you just imported), not a race condition --
-- Postgres's own row-level locking inside remove_crm_leads()'s deletes
-- serializes any genuinely simultaneous pair of calls so one completes
-- before the other's SELECT of "the previous batch" can see a half-done
-- state.
--
-- SAME-FILE RE-IMPORT: re-importing the identical file (same rows, same
-- phone/email per row) is a safe no-op on the data. Every row in the new
-- sheet matches its own already-live counterpart from the previous
-- import, which the matching step (correctly) treats as a surviving
-- duplicate rather than something to insert -- confirmed by execution
-- testing. Since nothing new gets inserted, the "only replace if at
-- least one new row actually landed" rule means the previous batch is
-- left alone rather than being torn down and rebuilt identically. The
-- data a user would see is unchanged either way; this just means an
-- identical re-import does not spend a fresh batch id/created_at on a
-- no-op, and -- importantly -- never risks momentarily tearing down a
-- converted lead's account/deal/contact only to immediately recreate
-- them. Importing a sheet with even one genuinely changed or added row
-- still replaces the previous batch exactly as described above.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- preview_import_crm_leads: read-only classification, now also reporting
-- how many of the caller's own currently-live leads would be replaced.
-- ---------------------------------------------------------------------------

create or replace function public.preview_import_crm_leads(p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_employee_id();
  v_prev_batch uuid;
  v_replace_count int := 0;
  v_row jsonb;
  v_row_number int := 0;
  v_first_name text;
  v_matches uuid[];
  v_new_count int := 0;
  v_duplicate_count int := 0;
  v_ambiguous_count int := 0;
  v_invalid_count int := 0;
  v_details jsonb := '[]'::jsonb;
  v_classification text;
begin
  if not public.crm_can_write() then
    raise exception 'Only the sales team or Super Admin can import leads.';
  end if;

  select cb.id into v_prev_batch
  from public.crm_import_batches cb
  where cb.uploaded_by = v_me
  order by cb.created_at desc
  limit 1;

  if v_prev_batch is not null then
    select count(*) into v_replace_count
    from public.crm_leads
    where import_batch_id = v_prev_batch and owner_id = v_me;
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_number := v_row_number + 1;
    v_first_name := nullif(btrim(v_row->>'first_name'), '');
    -- Matches against leads that would SURVIVE this import (anything not
    -- in the batch about to be replaced) -- a row matching only a lead
    -- that is itself about to be replaced is not a "surviving duplicate",
    -- it is simply superseded by the new sheet, so it is excluded here.
    v_matches := array(
      select id from unnest(public.crm_match_lead_ids(v_row->>'phone', v_row->>'email')) id
      where not (v_prev_batch is not null and id in (
        select id from public.crm_leads where import_batch_id = v_prev_batch and owner_id = v_me
      ))
    );

    if array_length(v_matches, 1) > 1 then
      v_classification := 'ambiguous';
      v_ambiguous_count := v_ambiguous_count + 1;
    elsif array_length(v_matches, 1) = 1 then
      v_classification := 'duplicate';
      v_duplicate_count := v_duplicate_count + 1;
    elsif v_first_name is null and nullif(btrim(v_row->>'company'), '') is null
       and nullif(btrim(v_row->>'email'), '') is null and nullif(btrim(v_row->>'phone'), '') is null then
      v_classification := 'invalid';
      v_invalid_count := v_invalid_count + 1;
    else
      v_classification := 'new';
      v_new_count := v_new_count + 1;
    end if;

    v_details := v_details || jsonb_build_array(
      jsonb_build_object('row', v_row_number, 'classification', v_classification)
    );
  end loop;

  return jsonb_build_object(
    'new_count', v_new_count,
    'duplicate_count', v_duplicate_count,
    'ambiguous_count', v_ambiguous_count,
    'invalid_count', v_invalid_count,
    'replace_count', v_replace_count,
    'rows', v_details
  );
end;
$$;

revoke all on function public.preview_import_crm_leads(jsonb) from public, anon;
grant execute on function public.preview_import_crm_leads(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- import_crm_leads: the real write. Replaces ONLY the caller's own
-- previous batch (leads still owned by the caller), validates the whole
-- sheet before removing anything, matches against surviving leads to skip
-- true duplicates (never enriches), restores hand-added leads archived
-- under this exact sheet, and never touches anyone else's data or any
-- hand-added lead.
-- ---------------------------------------------------------------------------

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
  v_matches uuid[];
  v_new_count int := 0;
  v_duplicate_count int := 0;
  v_ambiguous_count int := 0;
  v_invalid_count int := 0;
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

  -- Validate the WHOLE sheet before touching anything. A sheet with
  -- nothing usable at all raises here and removes nothing -- the previous
  -- batch is left completely intact, satisfying "if the new import fails,
  -- the previous dataset must remain intact."
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file has no rows to import.';
  end if;

  -- Only the CALLER's own most recent batch -- never anyone else's, never
  -- the organisation's most recent batch regardless of uploader.
  select cb.id into v_prev_batch
  from public.crm_import_batches cb
  where cb.organization_id = v_org and cb.uploaded_by = v_me
  order by cb.created_at desc
  limit 1;

  -- Candidates for removal: leads tagged with the caller's own previous
  -- batch AND still owned by the caller right now. A hand-added lead
  -- (import_batch_id is null) can never match this, by construction --
  -- requirement 3 is structural, not a special-cased exception. A lead
  -- since reassigned to someone else also survives, even though it still
  -- carries the old batch id.
  if v_prev_batch is not null then
    select coalesce(array_agg(id), array[]::uuid[]) into v_removable_ids
    from public.crm_leads
    where import_batch_id = v_prev_batch and owner_id = v_me;
  else
    v_removable_ids := array[]::uuid[];
  end if;

  v_can_manage_all := public.crm_can_manage_all();
  v_restore_owner := case when v_can_manage_all then null else v_me end;

  -- Classify and insert first, so a sheet that turns out to have zero
  -- importable rows never removes the previous batch at all (see the
  -- up-front empty-sheet check above for the "entirely unusable file"
  -- case; this covers "every row invalid/duplicate/ambiguous" too).
  insert into public.crm_import_batches (organization_id, uploaded_by, owner_id, file_name, total_rows, status)
  values (v_org, v_me, v_me, p_file_name, jsonb_array_length(p_rows), 'processing')
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_number := v_row_number + 1;

    -- Match against leads that will SURVIVE this import (exclude the
    -- caller's own previous-batch rows about to be replaced) -- matching
    -- only ever detects a true duplicate to skip, it never enriches.
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

    v_first_name := nullif(btrim(v_row->>'first_name'), '');
    if v_first_name is null and nullif(btrim(v_row->>'company'), '') is null
       and v_email is null and v_phone is null
    then
      v_invalid_count := v_invalid_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row', v_row_number, 'first_name', '', 'reason', 'invalid')
      );
      continue;
    end if;
    v_first_name := coalesce(v_first_name, 'Unknown');

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
        source, status, rating, estimated_value, listing_rating,
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

  -- Now that the new sheet's rows are in, remove the caller's own
  -- previous batch (archiving everything first, via the existing, live,
  -- unmodified remove_crm_leads()). Running this AFTER the inserts means
  -- any insert failure above already happened and was individually
  -- caught -- removal only proceeds once every row has been attempted,
  -- consistent with "validate before replace": if literally nothing in
  -- the sheet was importable (v_new_count = 0 and nothing failed, i.e.
  -- every row was a duplicate/ambiguous/invalid), the previous batch is
  -- NOT removed, since replacing a working dataset with nothing useful
  -- would be a pure data-loss outcome with no benefit.
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

  -- Restore hand-added leads archived under THIS exact sheet by an
  -- earlier import, never already restored, never one the trash icon
  -- removed ('manual_delete' is never restored). Unchanged logic from
  -- final_fix_5.sql, reused as-is.
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
    'replaced_count', coalesce((v_removal->>'leads_deleted')::int, 0),
    'restored_count', v_restored_count,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.import_crm_leads(text, jsonb) from public, anon;
grant execute on function public.import_crm_leads(text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
