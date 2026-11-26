-- CRM import, two-mode redesign for the real business workflow:
--   Day 1: import an initial sheet of fresh leads.
--   Day 2: import a SEPARATE sheet with more detail about the Warm leads,
--     matched against the leads already in the CRM by phone (first) then
--     email -- enriching them, never duplicating or deleting them.
--
-- This supersedes 20261126090000_crm_import_leads_safe_batch.sql's
-- import_crm_leads() entirely. That file's two real fixes are KEPT:
--   * the first_name length/constraint crash no longer aborts the whole
--     batch (per-row exception handling, unchanged in spirit here);
--   * names are never silently truncated -- an invalid row is reported,
--     not mutated.
-- Its cross-uploader deletion-bug fix is also kept in spirit, but the
-- fix is now moot in the best way possible: Initial Import mode no longer
-- deletes ANY previous batch, belonging to the caller or anyone else --
-- per your explicit instruction, re-importing must never delete a prior
-- import at all. The entire "find and delete the previous batch" block
-- is removed, not just re-scoped.
--
-- Two new RPCs:
--
-- 1. public.preview_import_crm_leads(p_rows jsonb, p_mode text)
--    READ-ONLY. Classifies every row (matched/updated-if-committed/new/
--    unmatched/ambiguous/invalid) WITHOUT writing anything, so the import
--    dialog can show accurate counts before the user commits -- matching
--    requires querying live crm_leads (for ambiguous-match detection in
--    particular), which cannot be done correctly client-side.
--
-- 2. public.import_crm_leads(p_file_name text, p_rows jsonb, p_mode text
--    default 'initial')
--    Does the real write. p_mode:
--      'initial' -- same behavior as the live function's insert path
--        (new leads only; a phone/email match against an EXISTING lead is
--        still skipped as a duplicate, exactly as before), MINUS the
--        delete-previous-batch step, which is gone entirely.
--      'update_existing' -- the new Day-2 path. Every row MUST match
--        exactly one existing lead (by normalized phone, then by email if
--        no phone match) or it is not written at all -- reported as
--        unmatched (no match) or ambiguous (matched more than one lead),
--        never guessed, never inserted as a new lead, per your explicit
--        "never guess a match using names alone" instruction. A matched
--        row updates ONLY the mapped fields that are present AND
--        non-empty in that row: last_name, company, job_title,
--        estimated_value, listing_rating, notes. Empty/missing cells
--        never blank out an existing value. owner_id, status, rating
--        (Hot/Warm/Cold), and everything about calling history/
--        activities/follow-ups are NEVER touched by this function in
--        either mode -- an authorized user changes those afterward
--        through the normal lead-edit UI or bulk actions, which already
--        exist and are unaffected by this file.
--
-- Rating (Hot/Warm/Cold) parameter kept for 'initial' mode only (new
-- leads may still arrive with a known temperature on Day 1); it is
-- accepted but ignored in 'update_existing' mode, since temperature is
-- explicitly a protected field once a lead exists.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- Shared matching helper: given a row's raw phone/email, find the existing
-- lead(s) in the caller's organisation it matches. Returns 0, 1 (a real
-- match) or 2+ rows (ambiguous) -- the caller decides what "0" or "2+"
-- means for its own purposes (invalid/unmatched/ambiguous). Phone is
-- normalized to its last 10 digits, same rule already used for duplicate
-- detection; email is matched case-insensitively, trimmed. Phone is tried
-- first; email is only tried when phone produced no match at all, exactly
-- per your explicit "phone first, then email" instruction -- never both
-- OR'd together in one query, which could not express "phone takes
-- priority."
-- ---------------------------------------------------------------------------

create or replace function public.crm_match_lead_ids(p_phone text, p_email text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select
      nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), '') as phone,
      nullif(lower(btrim(coalesce(p_email, ''))), '') as email
  ),
  by_phone as (
    select l.id
    from public.crm_leads l, normalized n
    where n.phone is not null
      and length(n.phone) = 10
      and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = n.phone
      and l.organization_id = public.current_org_id()
  ),
  by_email as (
    select l.id
    from public.crm_leads l, normalized n
    where n.email is not null
      and lower(btrim(coalesce(l.email, ''))) = n.email
      and l.organization_id = public.current_org_id()
  )
  select coalesce(
    (select array_agg(id) from by_phone),
    (select array_agg(id) from by_email)
  );
$$;

revoke all on function public.crm_match_lead_ids(text, text) from public, anon;
grant execute on function public.crm_match_lead_ids(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- preview_import_crm_leads: read-only classification for the import
-- dialog's "before you commit" counts. Never writes anything.
-- ---------------------------------------------------------------------------

create or replace function public.preview_import_crm_leads(p_rows jsonb, p_mode text default 'initial')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_row_number int := 0;
  v_first_name text;
  v_matches uuid[];
  v_new_count int := 0;
  v_matched_count int := 0;
  v_unmatched_count int := 0;
  v_ambiguous_count int := 0;
  v_duplicate_count int := 0;
  v_invalid_count int := 0;
  v_details jsonb := '[]'::jsonb;
  v_classification text;
begin
  if not public.crm_can_write() then
    raise exception 'Only the sales team or Super Admin can import leads.';
  end if;
  if p_mode not in ('initial', 'update_existing') then
    raise exception 'Invalid import mode.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_number := v_row_number + 1;
    v_first_name := nullif(btrim(v_row->>'first_name'), '');
    v_matches := public.crm_match_lead_ids(v_row->>'phone', v_row->>'email');

    if p_mode = 'update_existing' then
      if v_matches is null or array_length(v_matches, 1) is distinct from 1 then
        if v_matches is not null and array_length(v_matches, 1) > 1 then
          v_classification := 'ambiguous';
          v_ambiguous_count := v_ambiguous_count + 1;
        else
          v_classification := 'unmatched';
          v_unmatched_count := v_unmatched_count + 1;
        end if;
      else
        v_classification := 'matched';
        v_matched_count := v_matched_count + 1;
      end if;
    else
      -- initial mode: no name at all (and no fallback value possible) is
      -- the only truly invalid case pre-write; a too-long name is caught
      -- at write time and reported there instead, same as today, since
      -- the actual constraint lives on the table, not here.
      if v_first_name is null and nullif(btrim(v_row->>'company'), '') is null
         and nullif(btrim(v_row->>'email'), '') is null and nullif(btrim(v_row->>'phone'), '') is null then
        v_classification := 'invalid';
        v_invalid_count := v_invalid_count + 1;
      elsif v_matches is not null and array_length(v_matches, 1) >= 1 then
        v_classification := 'duplicate';
        v_duplicate_count := v_duplicate_count + 1;
      else
        v_classification := 'new';
        v_new_count := v_new_count + 1;
      end if;
    end if;

    v_details := v_details || jsonb_build_array(
      jsonb_build_object('row', v_row_number, 'classification', v_classification)
    );
  end loop;

  return jsonb_build_object(
    'mode', p_mode,
    'new_count', v_new_count,
    'matched_count', v_matched_count,
    'unmatched_count', v_unmatched_count,
    'ambiguous_count', v_ambiguous_count,
    'duplicate_count', v_duplicate_count,
    'invalid_count', v_invalid_count,
    'rows', v_details
  );
end;
$$;

revoke all on function public.preview_import_crm_leads(jsonb, text) from public, anon;
grant execute on function public.preview_import_crm_leads(jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- import_crm_leads: the real write. Mode-dependent behavior as described
-- in the file header above.
-- ---------------------------------------------------------------------------

create or replace function public.import_crm_leads(p_file_name text, p_rows jsonb, p_mode text default 'initial')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_me uuid := public.current_employee_id();
  v_row jsonb;
  v_phone text;
  v_email text;
  v_listing_rating numeric;
  v_rating text;
  v_existing_phones text[];
  v_existing_emails text[];
  v_new_count int := 0;
  v_updated_count int := 0;
  v_unmatched_count int := 0;
  v_ambiguous_count int := 0;
  v_duplicate_count int := 0;
  v_invalid_count int := 0;
  v_failed_count int := 0;
  v_sequence int := 0;
  v_row_number int := 0;
  v_batch_id uuid;
  v_errors jsonb := '[]'::jsonb;
  v_first_name text;
  v_matches uuid[];
  v_match_id uuid;
  v_last_name text;
  v_company text;
  v_job_title text;
  v_estimated_value numeric;
  v_notes text;
begin
  if not public.crm_can_write() then
    raise exception 'Only the sales team or Super Admin can import leads.';
  end if;
  if v_org is null then
    raise exception 'Your account is not linked to an organisation.';
  end if;
  if p_mode not in ('initial', 'update_existing') then
    raise exception 'Invalid import mode.';
  end if;

  -- No previous batch is ever deleted, in either mode, by anyone's import,
  -- regardless of who uploaded it. This is intentional and permanent --
  -- re-importing must never remove prior leads, calling history or
  -- activities. (This also makes the earlier cross-uploader deletion bug
  -- moot: there is no delete path left to be scoped incorrectly.)

  if p_mode = 'initial' then
    select
      array_agg(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10))
        filter (where length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10),
      array_agg(lower(btrim(email))) filter (where btrim(coalesce(email, '')) <> '')
    into v_existing_phones, v_existing_emails
    from public.crm_leads
    where organization_id = v_org;
    v_existing_phones := coalesce(v_existing_phones, array[]::text[]);
    v_existing_emails := coalesce(v_existing_emails, array[]::text[]);
  end if;

  insert into public.crm_import_batches (organization_id, uploaded_by, owner_id, file_name, total_rows, status)
  values (v_org, v_me, v_me, p_file_name, jsonb_array_length(p_rows), 'processing')
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_number := v_row_number + 1;

    if p_mode = 'update_existing' then
      -- Match by phone first, then email -- never names, never guessed.
      v_matches := public.crm_match_lead_ids(v_row->>'phone', v_row->>'email');

      if v_matches is null or array_length(v_matches, 1) = 0 then
        v_unmatched_count := v_unmatched_count + 1;
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('row', v_row_number, 'first_name', coalesce(v_row->>'first_name', ''), 'reason', 'unmatched')
        );
        continue;
      end if;
      if array_length(v_matches, 1) > 1 then
        v_ambiguous_count := v_ambiguous_count + 1;
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('row', v_row_number, 'first_name', coalesce(v_row->>'first_name', ''), 'reason', 'ambiguous')
        );
        continue;
      end if;

      v_match_id := v_matches[1];

      -- This function is security definer (needed so the matching query
      -- above can see every lead in the org regardless of the caller's
      -- own row-level access, which is required for correct ambiguous-
      -- match detection) -- so it does NOT automatically inherit the
      -- crm_leads_update RLS policy's owner-or-manage-all restriction.
      -- Enforced manually here instead, to the same rule: a rep may only
      -- enrich a lead they own; a lead belonging to someone else requires
      -- crm_can_manage_all(), exactly like every other write path in this
      -- CRM. This is NOT counted as "ambiguous" or "unmatched" -- it is
      -- its own, distinct outcome: a real, unambiguous match the caller
      -- is not authorised to write to.
      if not (v_match_id in (select id from public.crm_leads where owner_id = v_me) or public.crm_can_manage_all()) then
        v_failed_count := v_failed_count + 1;
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('row', v_row_number, 'first_name', coalesce(v_row->>'first_name', ''), 'reason', 'not_authorized')
        );
        continue;
      end if;

      -- Only mapped, NON-EMPTY fields overwrite the existing value.
      -- owner_id, status and rating are never read from the row at all in
      -- this mode -- not merely "not overwritten", genuinely never touched.
      v_last_name := nullif(btrim(v_row->>'last_name'), '');
      v_company := nullif(btrim(v_row->>'company'), '');
      v_job_title := nullif(btrim(v_row->>'job_title'), '');
      v_estimated_value := case when v_row->>'estimated_value' ~ '^[0-9.]+$' then (v_row->>'estimated_value')::numeric else null end;
      v_notes := nullif(btrim(v_row->>'notes'), '');
      v_listing_rating := null;
      if v_row->>'listing_rating' ~ '^[0-9]+(\.[0-9]+)?$' then
        v_listing_rating := (v_row->>'listing_rating')::numeric;
        if v_listing_rating < 0 or v_listing_rating > 5 then
          v_listing_rating := null;
        end if;
      end if;

      begin
        -- Counted as "updated" once it matches -- this row's enrichment
        -- fields were applied (coalesce means a cell already matching the
        -- existing value, or genuinely empty, is a no-op write, not an
        -- error); it is never counted separately from "no real change",
        -- since that distinction has no bearing on correctness here.
        update public.crm_leads
        set last_name = coalesce(v_last_name, last_name),
            company = coalesce(v_company, company),
            job_title = coalesce(v_job_title, job_title),
            estimated_value = coalesce(v_estimated_value, estimated_value),
            listing_rating = coalesce(v_listing_rating, listing_rating),
            notes = coalesce(v_notes, notes)
        where id = v_match_id;

        v_updated_count := v_updated_count + 1;
      exception when others then
        v_failed_count := v_failed_count + 1;
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('row', v_row_number, 'first_name', coalesce(v_row->>'first_name', ''), 'reason', 'failed', 'error', sqlerrm)
        );
      end;
      continue;
    end if;

    -- p_mode = 'initial' from here down -- same shape as the prior fix,
    -- minus the deleted "find and delete previous batch" step.
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

    v_rating := lower(btrim(coalesce(v_row->>'rating', '')));
    if v_rating not in ('hot', 'warm', 'cold') then
      v_rating := null;
    end if;

    v_first_name := coalesce(nullif(btrim(v_row->>'first_name'), ''), 'Unknown');

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

      if v_phone is not null then
        v_existing_phones := array_append(v_existing_phones, v_phone);
      end if;
      if v_email is not null then
        v_existing_emails := array_append(v_existing_emails, v_email);
      end if;
      v_new_count := v_new_count + 1;
      v_sequence := v_sequence + 1;
    exception when others then
      v_failed_count := v_failed_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row', v_row_number, 'first_name', v_first_name, 'reason', 'failed', 'error', sqlerrm)
      );
    end;
  end loop;

  update public.crm_import_batches
  set inserted_count = v_new_count + v_updated_count,
      duplicate_count = v_duplicate_count,
      failed_count = v_failed_count + v_unmatched_count + v_ambiguous_count,
      error_summary = case when jsonb_array_length(v_errors) > 0 then v_errors else null end,
      status = 'done'
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'mode', p_mode,
    'new_count', v_new_count,
    'updated_count', v_updated_count,
    'duplicate_count', v_duplicate_count,
    'unmatched_count', v_unmatched_count,
    'ambiguous_count', v_ambiguous_count,
    'failed_count', v_failed_count,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.import_crm_leads(text, jsonb, text) from public, anon;
grant execute on function public.import_crm_leads(text, jsonb, text) to authenticated, service_role;

-- The old 2-argument signature is dropped; every caller must now specify a
-- mode (the frontend change in this same commit always passes one). If
-- any other, unreviewed caller still invokes the 2-argument form, it will
-- fail loudly with "function does not exist" rather than silently running
-- in the wrong mode.
drop function if exists public.import_crm_leads(text, jsonb);

notify pgrst, 'reload schema';
