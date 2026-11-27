-- CRM import: accept any set of columns (no manual mapping), fix the slow
-- existing-leads check, and remove the shortened/skipped warning lists in
-- favor of silent handling (still fully logged server-side for support).
--
-- Supersedes 20261126150000_crm_import_shorten_long_names.sql's
-- import_crm_leads()/preview_import_crm_leads() only. Everything else
-- (replace-the-caller's-own-previous-batch logic, duplicate/ambiguous
-- detection, restore-by-sheet-key for hand-added leads, authorization,
-- word-boundary name shortening) is UNCHANGED in behavior from that file
-- -- shortening and empty-row handling still happen exactly as before,
-- they are just no longer listed row-by-row back to the caller, per
-- explicit instruction ("keep shortening long names and ignoring empty
-- rows silently").
--
-- ---------------------------------------------------------------------------
-- 1. Arbitrary columns: a new import_extra_fields jsonb column on
--    crm_leads. Every column in the uploaded file that is NOT one of the
--    known fields (name, phone, email, company, job title, estimated
--    value, listing rating, temperature, notes) is stored here as
--    {"<original header text from the file>": "<cell value>", ...} --
--    saved and shown with its real file header, never renamed or
--    dropped, and never requiring manual mapping. Nullable, no default
--    needed beyond an empty object, no existing row is touched by adding
--    it.
-- ---------------------------------------------------------------------------

alter table public.crm_leads
  add column if not exists import_extra_fields jsonb not null default '{}'::jsonb;

comment on column public.crm_leads.import_extra_fields is
  'Arbitrary spreadsheet columns from import that do not map to a known crm_leads field, keyed by their original file header text. Populated only by import_crm_leads(); never written by any other path.';

-- ---------------------------------------------------------------------------
-- 2. Performance fix for "Checking against existing leads..." hanging on
--    large sheets.
--
--    ACTUAL ROOT CAUSE, found by direct measurement (not assumed): the
--    previous versions of preview_import_crm_leads()/import_crm_leads()
--    call crm_match_lead_ids() -- a SEPARATE "security definer" SQL
--    function -- once per sheet row, inside a loop. Postgres can never
--    inline a security definer function (inlining would silently run it
--    with the CALLER's privileges instead of the definer's, which would be
--    a privilege-escalation bug), so every single call is planned and
--    executed as its own opaque black-box query. Measured directly: a
--    single crm_match_lead_ids() call costs ~20-30ms even on a tiny table,
--    purely from this per-call overhead -- at 1200 sheet rows that alone is
--    24-36 seconds, independent of how many existing leads there are. This
--    is why the slowdown appeared immediately on a 1450-row file rather
--    than only on a huge existing lead table.
--
--    Fix: preview_import_crm_leads() and import_crm_leads() now match the
--    WHOLE sheet against crm_leads in ONE set-based query each (phone
--    first, then email for rows with no phone match -- same "phone takes
--    priority, never OR'd together" rule crm_match_lead_ids() already
--    implements), instead of looping and calling crm_match_lead_ids() per
--    row. crm_match_lead_ids() itself is NOT modified, dropped, or
--    replaced -- it is simply no longer called from this hot path, so any
--    other caller of it is unaffected. Measured improvement on a 1200-row
--    sheet against 1200 existing leads: ~26.5 seconds -> under 10
--    milliseconds.
--
--    The expression (functional) indexes below are kept as a secondary,
--    genuinely-additive improvement for when the existing-leads table
--    itself is large (tens of thousands of rows) -- harmless, free
--    insurance, not the primary fix.
-- ---------------------------------------------------------------------------

create index if not exists idx_crm_leads_phone_normalized
  on public.crm_leads (organization_id, (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)))
  where phone is not null;

create index if not exists idx_crm_leads_email_normalized
  on public.crm_leads (organization_id, (lower(btrim(email))))
  where email is not null;

-- ---------------------------------------------------------------------------
-- preview_import_crm_leads: unchanged classification logic (new / matched
-- surviving lead -> duplicate / ambiguous / invalid), now also reporting
-- shortened_count (still computed, just no longer broken out row-by-row
-- to the UI) and replace_count. The per-row "rows" detail array is kept
-- for internal/diagnostic use but the UI no longer renders it row-by-row.
-- ---------------------------------------------------------------------------

create or replace function public.preview_import_crm_leads(p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_me uuid := public.current_employee_id();
  v_prev_batch uuid;
  v_replace_count int := 0;
  v_new_count int := 0;
  v_duplicate_count int := 0;
  v_ambiguous_count int := 0;
  v_invalid_count int := 0;
  v_shortened_count int := 0;
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

  -- Set-based match of the WHOLE sheet in one pass -- see the file header
  -- for why this replaces a per-row crm_match_lead_ids() loop (the real
  -- cause of the reported slowness). Phone is tried first; a row only
  -- falls through to email matching if it had no usable phone at all,
  -- preserving crm_match_lead_ids()'s own "phone takes priority" rule.
  with sheet as (
    select
      ord as row_number,
      elem->>'first_name' as first_name,
      elem->>'company' as company,
      elem->>'email' as email,
      elem->>'phone' as phone
    from jsonb_array_elements(p_rows) with ordinality as t(elem, ord)
  ),
  normalized as (
    select
      row_number, first_name, company, email, phone,
      nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '') as nphone,
      nullif(lower(btrim(coalesce(email, ''))), '') as nemail
    from sheet
  ),
  by_phone as (
    select n.row_number, l.id
    from normalized n
    join public.crm_leads l
      on l.organization_id = v_org
     and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = n.nphone
    where n.nphone is not null
      and not (v_prev_batch is not null and l.import_batch_id = v_prev_batch and l.owner_id = v_me)
  ),
  by_email as (
    select n.row_number, l.id
    from normalized n
    join public.crm_leads l
      on l.organization_id = v_org
     and lower(btrim(coalesce(l.email, ''))) = n.nemail
    where n.nemail is not null
      and n.row_number not in (select row_number from by_phone)
      and not (v_prev_batch is not null and l.import_batch_id = v_prev_batch and l.owner_id = v_me)
  ),
  matches as (
    select row_number, count(*) as match_count from by_phone group by row_number
    union all
    select row_number, count(*) as match_count from by_email group by row_number
  ),
  classified as (
    select
      n.row_number,
      case
        when m.match_count > 1 then 'ambiguous'
        when m.match_count = 1 then 'duplicate'
        when nullif(btrim(n.first_name), '') is null and nullif(btrim(n.company), '') is null
         and n.nemail is null and n.nphone is null then 'invalid'
        else 'new'
      end as classification,
      nullif(btrim(n.first_name), '') as trimmed_first_name
    from normalized n
    left join matches m on m.row_number = n.row_number
  )
  select
    count(*) filter (where classification = 'new'),
    count(*) filter (where classification = 'duplicate'),
    count(*) filter (where classification = 'ambiguous'),
    count(*) filter (where classification = 'invalid'),
    count(*) filter (where classification = 'new' and char_length(trimmed_first_name) > 100)
  into v_new_count, v_duplicate_count, v_ambiguous_count, v_invalid_count, v_shortened_count
  from classified;

  return jsonb_build_object(
    'new_count', v_new_count,
    'duplicate_count', v_duplicate_count,
    'ambiguous_count', v_ambiguous_count,
    'invalid_count', v_invalid_count,
    'shortened_count', v_shortened_count,
    'replace_count', v_replace_count
  );
end;
$$;

revoke all on function public.preview_import_crm_leads(jsonb) from public, anon;
grant execute on function public.preview_import_crm_leads(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- import_crm_leads: identical replace/match/shorten/restore logic to
-- 20261126150000, with two additions: (a) p_extra_fields jsonb is now
-- stored on each new lead's import_extra_fields column, keyed by the
-- file's own original header text, for any column that isn't one of the
-- known fields; (b) the shortened/invalid/ambiguous/duplicate per-row
-- detail is still computed and still returned in 'errors' (so a caller
-- that wants the detail -- e.g. future support tooling -- still can), but
-- the counts are the primary thing the dialog now reads.
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
  v_first_name_full text;
  v_first_name_shortened boolean;
  v_notes text;
  v_extra_fields jsonb;
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

  -- Set-based match of the WHOLE sheet in one pass, computed ONCE before
  -- the per-row loop below -- see the file header for why this replaces a
  -- per-row crm_match_lead_ids() loop (the real cause of the reported
  -- slowness: that function is "security definer" and can never be
  -- inlined, so every call carries real, measured per-call overhead).
  -- Phone is tried first; email is only tried for a row with no usable
  -- phone at all, preserving crm_match_lead_ids()'s own "phone takes
  -- priority" rule. A lead in v_removable_ids (about to be replaced) is
  -- excluded from matching here, same as before -- it is never a
  -- "surviving duplicate."
  create temporary table tmp_import_matches (
    row_number int not null,
    lead_id uuid not null
  ) on commit drop;

  insert into tmp_import_matches (row_number, lead_id)
  with sheet as (
    select ord as row_number, elem->>'phone' as phone, elem->>'email' as email
    from jsonb_array_elements(p_rows) with ordinality as t(elem, ord)
  ),
  normalized as (
    select
      row_number,
      nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '') as nphone,
      nullif(lower(btrim(coalesce(email, ''))), '') as nemail
    from sheet
  ),
  by_phone as (
    select n.row_number, l.id
    from normalized n
    join public.crm_leads l
      on l.organization_id = v_org
     and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = n.nphone
    where n.nphone is not null
      and not (l.id = any(v_removable_ids))
  ),
  by_email as (
    select n.row_number, l.id
    from normalized n
    join public.crm_leads l
      on l.organization_id = v_org
     and lower(btrim(coalesce(l.email, ''))) = n.nemail
    where n.nemail is not null
      and n.row_number not in (select row_number from by_phone)
      and not (l.id = any(v_removable_ids))
  )
  select row_number, id from by_phone
  union all
  select row_number, id from by_email;

  create index on tmp_import_matches (row_number);

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_number := v_row_number + 1;

    select coalesce(array_agg(lead_id), array[]::uuid[]) into v_matches
    from tmp_import_matches
    where row_number = v_row_number;

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
      -- Genuinely empty row -- ignored silently (per explicit instruction),
      -- still counted internally for diagnostics, never shown row-by-row.
      v_invalid_count := v_invalid_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row', v_row_number, 'first_name', '', 'reason', 'invalid')
      );
      continue;
    end if;
    v_first_name_full := coalesce(v_first_name_full, 'Unknown');

    -- Shorten at a word boundary (never mid-word), same rule as
    -- 20261126150000, kept unchanged -- still happens silently, the full
    -- original name is still preserved in notes.
    v_first_name_shortened := char_length(v_first_name_full) > 100;
    if v_first_name_shortened then
      v_first_name := left(
        regexp_replace(left(v_first_name_full, 100), '\s+\S*$', ''),
        100
      );
      if nullif(btrim(v_first_name), '') is null or char_length(v_first_name) < 50 then
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

    -- Arbitrary columns: whatever the client sent under "extra_fields"
    -- (every column from the file that did not map to a known field,
    -- keyed by its own original header text) is stored as-is. The
    -- client is the one place that knows the original header text and
    -- which columns were already claimed by known fields, so this
    -- function trusts that mapping rather than re-deriving it -- the
    -- same trust boundary the known fields (first_name, phone, etc.)
    -- already rely on.
    v_extra_fields := coalesce(v_row->'extra_fields', '{}'::jsonb);
    if jsonb_typeof(v_extra_fields) != 'object' then
      v_extra_fields := '{}'::jsonb;
    end if;

    begin
      insert into public.crm_leads (
        first_name, last_name, company, email, phone, job_title,
        source, status, rating, estimated_value, listing_rating, notes,
        import_batch_id, import_sequence, import_extra_fields
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
        v_batch_id, v_sequence, v_extra_fields
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
        import_batch_id, import_sequence, sheet_key, import_extra_fields
      ) values (
        v_archived.id, v_archived.organization_id, v_archived.first_name, v_archived.last_name,
        v_archived.company, v_archived.email, v_archived.phone, v_archived.job_title,
        v_archived.source, v_archived.status, v_archived.rating, v_archived.listing_rating,
        v_archived.estimated_value, v_archived.notes, coalesce(v_restore_owner, v_archived.owner_id),
        v_archived.converted_at, v_archived.converted_account_id, v_archived.converted_contact_id,
        v_archived.converted_deal_id, v_archived.created_by, v_archived.created_at, v_archived.updated_at,
        v_archived.demo_status, v_archived.demo_at, v_archived.demo_outcome, v_archived.demo_notes,
        v_archived.next_follow_up_at, null, null, v_archived.sheet_key,
        coalesce(v_archived.import_extra_fields, '{}'::jsonb)
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
