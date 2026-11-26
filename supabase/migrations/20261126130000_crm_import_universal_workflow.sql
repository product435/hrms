-- Universal CRM import workflow -- removes the Day-1/Day-2 mode toggle.
--
-- Supersedes 20261126110000_crm_import_two_mode_enrichment.sql's
-- import_crm_leads()/preview_import_crm_leads(): those required the user to
-- pick "Initial Import" or "Update Existing Leads" up front. Per explicit
-- instruction, there is no such mode anymore -- ONE workflow classifies
-- every row independently, automatically:
--
--   * Row matches an existing lead (by normalized phone first, then by
--     email if no phone match) -> ENRICH: only the mapped, NON-EMPTY
--     fields present in that row overwrite the matching lead's columns
--     (last_name, company, job_title, estimated_value, listing_rating,
--     notes). owner_id, status, rating (Hot/Warm/Cold), and everything
--     about calling history/activities/follow-ups are NEVER touched by
--     import, exactly as before. If the row matches MORE THAN ONE
--     existing lead, it is never guessed -- reported "ambiguous" and
--     skipped, for manual review.
--   * Row matches no existing lead -> CREATE as a new lead, exactly like
--     the old 'initial' mode's insert path.
--
-- This is the same underlying logic the two-mode version already had --
-- "a row either matches exactly one existing lead or it doesn't" was
-- already computed per row by crm_match_lead_ids() in both modes. The only
-- real change is that the CALLER no longer has to pre-declare which
-- outcome to expect; the function now decides it per row, every time,
-- which is what "one universal, project-independent workflow" requires.
--
-- Previous import batches and all existing leads, calling history and
-- activities are never deleted by this or any future import -- unchanged
-- from the prior two-mode version, still permanent.
--
-- The first_name length/constraint handling (per-row exception, never a
-- silent truncation, never aborts the whole batch) is kept exactly as
-- before.
--
-- Drops the mode-taking signatures explicitly so nothing is left calling
-- the old, now-obsolete 3-argument versions with a stale understanding of
-- what "mode" means.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- preview_import_crm_leads: read-only classification for the import
-- dialog's "before you commit" counts. One signature, no mode. Every row
-- is independently classified as new / matched / ambiguous / invalid.
-- ---------------------------------------------------------------------------

create or replace function public.preview_import_crm_leads(p_rows jsonb)
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
  v_ambiguous_count int := 0;
  v_invalid_count int := 0;
  v_details jsonb := '[]'::jsonb;
  v_classification text;
begin
  if not public.crm_can_write() then
    raise exception 'Only the sales team or Super Admin can import leads.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_number := v_row_number + 1;
    v_first_name := nullif(btrim(v_row->>'first_name'), '');
    v_matches := public.crm_match_lead_ids(v_row->>'phone', v_row->>'email');

    if v_matches is not null and array_length(v_matches, 1) > 1 then
      v_classification := 'ambiguous';
      v_ambiguous_count := v_ambiguous_count + 1;
    elsif v_matches is not null and array_length(v_matches, 1) = 1 then
      v_classification := 'matched';
      v_matched_count := v_matched_count + 1;
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
    'matched_count', v_matched_count,
    'ambiguous_count', v_ambiguous_count,
    'invalid_count', v_invalid_count,
    'rows', v_details
  );
end;
$$;

revoke all on function public.preview_import_crm_leads(jsonb) from public, anon;
grant execute on function public.preview_import_crm_leads(jsonb) to authenticated, service_role;

-- The old 2-argument (rows, mode) signature is dropped -- no caller should
-- keep passing a mode; the function no longer accepts one.
drop function if exists public.preview_import_crm_leads(jsonb, text);

-- ---------------------------------------------------------------------------
-- import_crm_leads: the real write. One signature, no mode. Every row is
-- independently matched-and-enriched, or created as new.
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
  v_row jsonb;
  v_phone text;
  v_email text;
  v_listing_rating numeric;
  v_rating text;
  v_new_count int := 0;
  v_updated_count int := 0;
  v_ambiguous_count int := 0;
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

  -- No previous batch is ever deleted, by anyone's import, regardless of
  -- who uploaded it. Re-importing never removes prior leads, calling
  -- history or activities. Permanent, not mode-dependent.

  insert into public.crm_import_batches (organization_id, uploaded_by, owner_id, file_name, total_rows, status)
  values (v_org, v_me, v_me, p_file_name, jsonb_array_length(p_rows), 'processing')
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_number := v_row_number + 1;

    -- Match by phone first, then email -- never names, never guessed.
    v_matches := public.crm_match_lead_ids(v_row->>'phone', v_row->>'email');

    if v_matches is not null and array_length(v_matches, 1) > 1 then
      v_ambiguous_count := v_ambiguous_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row', v_row_number, 'first_name', coalesce(v_row->>'first_name', ''), 'reason', 'ambiguous')
      );
      continue;
    end if;

    if v_matches is not null and array_length(v_matches, 1) = 1 then
      -- ENRICH an existing lead. This function is security definer (needed
      -- so the matching query above can see every lead in the org
      -- regardless of the caller's own row-level access, required for
      -- correct ambiguous-match detection) -- so it does NOT automatically
      -- inherit the crm_leads_update RLS policy's owner-or-manage-all
      -- restriction. Enforced manually here instead, to the same rule: a
      -- rep may only enrich a lead they own; a lead belonging to someone
      -- else requires crm_can_manage_all(), exactly like every other write
      -- path in this CRM.
      v_match_id := v_matches[1];

      if not (v_match_id in (select id from public.crm_leads where owner_id = v_me) or public.crm_can_manage_all()) then
        v_failed_count := v_failed_count + 1;
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('row', v_row_number, 'first_name', coalesce(v_row->>'first_name', ''), 'reason', 'not_authorized')
        );
        continue;
      end if;

      -- Only mapped, NON-EMPTY fields overwrite the existing value.
      -- owner_id, status and rating are never read from the row at all --
      -- not merely "not overwritten", genuinely never touched. Calling
      -- history, activities and follow-ups are untouched because this
      -- function never writes to crm_activities or any ledger/history
      -- table for a matched row.
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

    -- No match at all -> CREATE as a new lead.
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
      -- Genuinely empty row (no name, no company, no valid email, no
      -- valid phone) -- never inserted, never guessed, reported so the
      -- user can see exactly which sheet rows had nothing usable.
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
    exception when others then
      v_failed_count := v_failed_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row', v_row_number, 'first_name', v_first_name, 'reason', 'failed', 'error', sqlerrm)
      );
    end;
  end loop;

  update public.crm_import_batches
  set inserted_count = v_new_count + v_updated_count,
      duplicate_count = 0,
      failed_count = v_failed_count + v_ambiguous_count + v_invalid_count,
      error_summary = case when jsonb_array_length(v_errors) > 0 then v_errors else null end,
      status = 'done'
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'new_count', v_new_count,
    'updated_count', v_updated_count,
    'ambiguous_count', v_ambiguous_count,
    'invalid_count', v_invalid_count,
    'failed_count', v_failed_count,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.import_crm_leads(text, jsonb) from public, anon;
grant execute on function public.import_crm_leads(text, jsonb) to authenticated, service_role;

-- The old (text, jsonb, text) mode-taking signature is dropped -- no
-- caller should keep passing a mode; the function no longer accepts one.
drop function if exists public.import_crm_leads(text, jsonb, text);

notify pgrst, 'reload schema';
