-- Fix: ambiguous overloads of preview_import_crm_leads() and
-- import_crm_leads().
--
-- Root cause, confirmed by reproducing it in a disposable database that
-- had migrations applied in a real-world, imperfect order (NOT just a
-- clean from-scratch apply):
--
--   1. 20261126110000_crm_import_two_mode_enrichment.sql introduced
--      preview_import_crm_leads(jsonb, text) and
--      import_crm_leads(text, jsonb, text) -- the "p_mode" two-mode
--      design (Day-1/Day-2).
--   2. 20261126130000_crm_import_universal_workflow.sql replaced those
--      with the mode-less preview_import_crm_leads(jsonb) and
--      import_crm_leads(text, jsonb), and correctly DROPPED the 2-arg/
--      3-arg "p_mode" versions in that SAME file.
--   3. 20261126140000, 20261126150000 and 20261126160000 each only ever
--      redefine the mode-less (jsonb) / (text, jsonb) signatures via
--      "create or replace function" -- which only replaces a function
--      with an IDENTICAL argument list. None of them repeats the drop
--      from step 2, because each assumed step 2 (20261126130000) had
--      already been applied first.
--
--   If 20261126130000 is skipped -- for example, applying
--   20261126110000 and then jumping straight to a later file such as
--   20261126160000, which is exactly what reproduced this bug in testing
--   -- the "p_mode" 2-arg/3-arg versions from step 1 are NEVER dropped,
--   so both the old (p_mode) and new (mode-less) signatures exist
--   simultaneously. A client call that omits p_mode (every current
--   caller does -- the frontend has sent no p_mode since the universal
--   workflow shipped) can match either overload once p_mode has a
--   default, which is exactly the "could not choose the best candidate
--   function" error.
--
-- p_mode is confirmed NOT needed by any current feature: grep across
-- src/services/crmService.ts and src/components/crm/CrmForms.tsx finds
-- zero references to p_mode or a mode argument anywhere in the CRM
-- import code. The two-mode (Day-1/Day-2) design was deliberately
-- superseded by the universal, mode-less workflow earlier in this
-- project's history. Nothing needs to be merged forward -- the p_mode
-- overloads are safe to drop outright.
--
-- This migration is idempotent and safe to run regardless of which of
-- the five files above were actually applied to this database, or in
-- what order: every drop below is a "drop function if exists" against an
-- EXACT argument-type signature (no CASCADE), so a signature that was
-- never created, or was already removed, is simply skipped with a
-- notice, never an error. After this migration, exactly one signature of
-- each function exists -- the mode-less, current one -- with its grants
-- restored explicitly (a defensive measure: if this ever runs on a
-- database where the mode-less version's own grants were somehow lost,
-- they are reapplied here too).
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- 1. Drop every obsolete "p_mode" overload, by its exact argument types.
--    No CASCADE -- if anything else in the database depends on one of
--    these exact signatures, this will fail loudly and tell you what,
--    rather than silently removing a dependency.
-- ---------------------------------------------------------------------------

drop function if exists public.preview_import_crm_leads(jsonb, text);
drop function if exists public.import_crm_leads(text, jsonb, text);

-- ---------------------------------------------------------------------------
-- 2. Also defend against the equally possible mirror case -- a database
--    that somehow only has the OLD 2-argument import_crm_leads(text,
--    jsonb) signature from before 20261126110000 ever ran (i.e. the
--    "p_mode" migration itself was skipped too) coexisting with a newer
--    one some other way. There is only ever one "mode-less" signature
--    shape for each function going forward
--    (preview_import_crm_leads(jsonb), import_crm_leads(text, jsonb)),
--    so nothing further needs dropping there -- "create or replace" on
--    that exact shape below (step 3) is what keeps it current, not a
--    drop.
-- ---------------------------------------------------------------------------

-- (No action needed here -- see comment above. Listed as its own section
-- so the next person reading this file's history doesn't wonder whether
-- this case was considered.)

-- ---------------------------------------------------------------------------
-- 3. Re-assert the one correct, current version of each function -- the
--    exact body from 20261126160000_crm_import_arbitrary_columns.sql,
--    byte-for-byte. "create or replace function" on this exact,
--    already-current signature is a safe no-op if it's already exactly
--    this; it also means this migration is the single source of truth
--    for "what is live" regardless of which of the five historical files
--    actually ran.
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
      v_invalid_count := v_invalid_count + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row', v_row_number, 'first_name', '', 'reason', 'invalid')
      );
      continue;
    end if;
    v_first_name_full := coalesce(v_first_name_full, 'Unknown');

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

-- ---------------------------------------------------------------------------
-- 4. Reload PostgREST's schema cache so the API layer picks up the single,
--    now-unambiguous signature immediately, without waiting for its own
--    periodic refresh.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
