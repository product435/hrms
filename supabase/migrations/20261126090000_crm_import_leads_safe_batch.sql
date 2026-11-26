-- CRM lead import: fix the live org-wide deletion bug AND the first_name
-- constraint crash that aborts an entire batch on one bad row.
--
-- IMPORTANT CORRECTION, found while building this file: the previously
-- drafted 20261125100000_crm_import_leads_owner_fix.sql is NOT actually a
-- byte-for-byte copy of the live function, despite its own header's claim.
-- Confirmed by reading the true live version directly
-- (20261118090500_crm_import_leads_listing_rating.sql, no "written to disk
-- only" marker): the live insert list is
-- (first_name, last_name, company, email, phone, job_title, source,
-- status, rating, estimated_value, listing_rating, import_batch_id,
-- import_sequence) with fixed literals source='website', status='new',
-- rating='warm' -- NOT the (..., owner_id, import_batch_id,
-- listing_rating, created_at) list that 20261125100000 used, which also
-- invented a created_at override that the real schema's own
-- crm_before_write() trigger unconditionally overwrites to now() anyway
-- (confirmed by reading that trigger -- it sets new.created_at := now()
-- on every INSERT when auth.uid() is not null, which is always true for a
-- normal import call). The real, working mechanism for preserving sheet
-- order within one import is the already-existing import_sequence column
-- (20261117100000_crm_lead_import_sequence.sql), which the trigger
-- explicitly never touches -- this file restores and uses THAT, not a
-- created_at trick that was silently defeated by the trigger the whole
-- time. owner_id is NOT set explicitly in the live function either (the
-- trigger defaults it to the caller when null) -- kept that way here too,
-- for exact parity with live behavior outside of the two fixes below.
--
-- This supersedes the import_crm_leads() definition in BOTH
-- 20261125100000_crm_import_leads_owner_fix.sql and (for just this one
-- function) 20261125090000_crm_role_visibility.sql -- neither is applied
-- as-is; this file replaces what they were trying to do, built correctly
-- from the verified live source instead. 20261125090000's broader,
-- separate role-visibility changes (HR CRM write access, dept_head scope)
-- are NOT touched or applied here; they remain your separate, pending
-- business decision.
--
-- Part 1 -- deletion-bug fix (same intent as 20261125100000, rebuilt
-- against the real live query shape -- the live lookup is actually
-- against crm_leads.import_batch_id, not crm_import_batches.id order,
-- though the effect is equivalent):
--   1. The "previous batch" lookup is scoped to the CALLER's own batches
--      (uploaded_by = caller), never the organisation's most recent batch
--      regardless of uploader.
--   2. The delete additionally requires owner_id = the caller right now --
--      a lead reassigned away from the caller survives even if still
--      tagged with their old batch id.
--
-- Part 2 -- new: a bad row no longer aborts the whole import.
--   Problem (confirmed): first_name has `check (char_length(btrim(first_name))
--   between 1 and 100)`. The old function builds first_name as
--   coalesce(nullif(btrim(p_row->>'first_name'), ''), 'Unknown') with no
--   length cap, and the per-row insert sits in a loop with no exception
--   handling -- so the first over-100-character name (or any other
--   constraint violation) raises out of the loop and rolls back every row
--   already inserted in that same call, exactly matching the reported
--   "1,449 rows, 0 inserted" symptom.
--   Fix: each row's insert is now wrapped in its own `begin ... exception
--   when others` block. A row that fails ANY check (not just first_name)
--   is counted in failed_count and recorded in
--   crm_import_batches.error_summary (row number, the offending value,
--   and the database's own error message) instead of aborting the batch.
--   Good rows are committed; nothing is silently dropped or truncated --
--   every failure is reported back to the caller by row number so the
--   Sales Head can see and fix exactly which rows need attention and
--   retry just those. No name is ever truncated by this function; an
--   over-length name is REJECTED and reported, matching the explicit "do
--   not silently truncate customer names" instruction. (The frontend
--   change in the same commit goes further and flags this before the
--   import button is even enabled, so this server-side path is a
--   backstop for anything the client missed, not the primary defense.)
--
-- Part 3 -- new: rating (Hot/Warm/Cold) is now accepted and mapped when
--   provided. Previously the import never set rating at all, so every
--   imported lead silently got the table's default ('warm') regardless of
--   any temperature signal in the source file. p_rows may now optionally
--   include a `rating` key with exactly 'hot', 'warm', or 'cold'
--   (case-insensitive, trimmed); anything else (missing, blank, or an
--   unrecognised value) leaves the column at its existing default -- this
--   never invents a temperature that wasn't in the source data, and is
--   kept entirely separate from listing_rating (the spreadsheet's own
--   numeric business rating), which is unchanged.
--
-- Part 4 -- correction, unrelated to the crash: the live function already
--   returns deleted_count correctly (confirmed by reading it directly --
--   an earlier pass of this investigation wrongly assumed it returned
--   "deleted_previous" based on a draft file that was not actually a
--   faithful copy of live behavior). The one real client/server mismatch
--   is restored_count: crmService.ts's importLeads() has always read
--   result["restored_count"], but neither this function nor the live one
--   has ever returned that key (there is no "restore" concept in this
--   import path) -- it has always silently defaulted to 0 client-side via
--   `num(result["restored_count"]) ?? 0`, which is harmless, so the
--   accompanying frontend change removes the dead field entirely instead
--   of inventing a value for it.
--
-- Everything else -- duplicate lookup against the whole organisation
-- (phone last-10-digits + email), batch bookkeeping, listing_rating
-- parsing -- is unchanged, byte-for-byte, from the live
-- 20261118090500_crm_import_leads_listing_rating.sql version.
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
  v_prev_batch uuid;
  v_deleted_count int := 0;
  v_row jsonb;
  v_phone text;
  v_email text;
  v_listing_rating numeric;
  v_rating text;
  v_existing_phones text[];
  v_existing_emails text[];
  v_duplicate_count int := 0;
  v_inserted_count int := 0;
  v_failed_count int := 0;
  v_sequence int := 0;
  v_row_number int := 0;
  v_batch_id uuid;
  v_errors jsonb := '[]'::jsonb;
  v_first_name text;
begin
  if not public.crm_can_write() then
    raise exception 'Only the sales team or Super Admin can import leads.';
  end if;
  if v_org is null then
    raise exception 'Your account is not linked to an organisation.';
  end if;

  -- Same lookup shape as live (most recent lead's import_batch_id), with
  -- the fix: scoped to a lead the CALLER uploaded AND still owns right
  -- now -- never the organisation's most recent lead regardless of who
  -- uploaded or now owns it. A lead reassigned away from the caller
  -- survives even if it still carries the caller's old batch id.
  select l.import_batch_id into v_prev_batch
  from public.crm_leads l
  join public.crm_import_batches cb on cb.id = l.import_batch_id
  where l.organization_id = v_org
    and cb.uploaded_by = v_me
    and l.owner_id = v_me
  order by l.created_at desc
  limit 1;

  if v_prev_batch is not null then
    delete from public.crm_whatsapp_messages
    where conversation_id in (
      select id from public.crm_whatsapp_conversations
      where lead_id in (
        select id from public.crm_leads
        where import_batch_id = v_prev_batch and owner_id = v_me
      )
    );
    delete from public.crm_whatsapp_conversations
    where lead_id in (
      select id from public.crm_leads
      where import_batch_id = v_prev_batch and owner_id = v_me
    );
    delete from public.crm_call_logs
    where lead_id in (
      select id from public.crm_leads
      where import_batch_id = v_prev_batch and owner_id = v_me
    );

    with deleted as (
      delete from public.crm_leads
      where import_batch_id = v_prev_batch and owner_id = v_me
      returning 1
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

  -- Walk the sheet in order: skip only rows that duplicate a lead already
  -- in the database -- never against another row of this same file.
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_number := v_row_number + 1;

    v_phone := right(regexp_replace(coalesce(v_row->>'phone', ''), '\D', '', 'g'), 10);
    if length(regexp_replace(coalesce(v_row->>'phone', ''), '\D', '', 'g')) < 10 then
      v_phone := null;
    end if;
    v_email := lower(btrim(coalesce(v_row->>'email', '')));
    if v_email = '' then
      v_email := null;
    end if;

    v_listing_rating := null;
    if v_row->>'listing_rating' ~ '^[0-9]+(\.[0-9]+)?$' then
      v_listing_rating := (v_row->>'listing_rating')::numeric;
      if v_listing_rating < 0 or v_listing_rating > 5 then
        v_listing_rating := null;
      end if;
    end if;

    if (v_phone is not null and v_phone = any(v_existing_phones))
       or (v_email is not null and v_email = any(v_existing_emails))
    then
      v_duplicate_count := v_duplicate_count + 1;
      continue;
    end if;

    -- Hot/Warm/Cold, only when the sheet actually supplied a recognised
    -- value. Never invented, never falls back to listing_rating. Anything
    -- unrecognised (missing, blank, or an unexpected word) leaves the
    -- column at the table's own default ('warm'), exactly as it already
    -- defaulted before this column was ever set here.
    v_rating := lower(btrim(coalesce(v_row->>'rating', '')));
    if v_rating not in ('hot', 'warm', 'cold') then
      v_rating := null;
    end if;

    v_first_name := coalesce(nullif(btrim(v_row->>'first_name'), ''), 'Unknown');

    -- Each row commits or fails on its own. A constraint violation (an
    -- over-100-character name, or anything else crm_leads enforces) is
    -- caught here, counted, and recorded with the row number and the
    -- database's own message -- it no longer aborts the rows already
    -- inserted before it, or the rows still to come after it.
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
        case when v_row->>'estimated_value' ~ '^[0-9.]+$' then (v_row->>'estimated_value')::numeric else null end,
        v_listing_rating,
        v_batch_id, v_sequence
      );

      v_inserted_count := v_inserted_count + 1;
      v_sequence := v_sequence + 1;
    exception when others then
      v_failed_count := v_failed_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object(
          'row', v_row_number,
          'first_name', v_first_name,
          'error', sqlerrm
        )
      );
    end;
  end loop;

  update public.crm_import_batches
  set inserted_count = v_inserted_count,
      duplicate_count = v_duplicate_count,
      failed_count = v_failed_count,
      error_summary = case when jsonb_array_length(v_errors) > 0 then v_errors else null end,
      status = 'done'
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'inserted_count', v_inserted_count,
    'duplicate_count', v_duplicate_count,
    'deleted_count', v_deleted_count,
    'failed_count', v_failed_count,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.import_crm_leads(text, jsonb) from public, anon;
grant execute on function public.import_crm_leads(text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
