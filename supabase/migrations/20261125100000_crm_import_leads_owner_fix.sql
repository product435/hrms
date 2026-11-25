-- Standalone fix for Priority 3 (CRM import data-loss bug), extracted from
-- the larger, still-pending 20261125090000_crm_role_visibility.sql so it
-- can ship independently of that migration's broader, business-sensitive
-- role-visibility changes (HR CRM write access, dept_head scope, etc.),
-- which are still awaiting approval.
--
-- Live bug (confirmed in the currently-applied function, defined in
-- 20261118090500_crm_import_leads_listing_rating.sql): on re-import,
-- import_crm_leads() finds the ORGANIZATION's most recent import batch
-- (order by created_at desc limit 1, no uploaded_by filter) and deletes
-- every lead in that batch -- plus its linked crm_whatsapp_conversations,
-- crm_whatsapp_messages and crm_call_logs -- with NO ownership check. Any
-- sales rep re-importing a lead sheet can delete a different rep's leads
-- and their call/WhatsApp history today.
--
-- This fix (identical to the one already drafted inside 20261125090000,
-- copied here verbatim so both files stay consistent if 20261125090000 is
-- applied later -- re-applying the same function body via create or
-- replace is a no-op, not a conflict):
--   1. The "previous batch" lookup is scoped to crm_import_batches where
--      uploaded_by = the caller -- never the org's most recent batch
--      regardless of who uploaded it.
--   2. The delete of that batch's leads (and their WhatsApp/call-log data)
--      additionally requires owner_id = the caller right now -- a lead
--      still tagged with the caller's old batch id but since reassigned
--      to someone else (existing reassignment business logic, untouched)
--      survives and is never deleted by this function.
-- Everything else in the function -- duplicate lookup against the whole
-- organisation, row-by-row insert, listing_rating parsing, batch-status
-- bookkeeping -- is unchanged, byte-for-byte, from
-- 20261118090500_crm_import_leads_listing_rating.sql.
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

  -- Only the CALLER's own most recent batch, never anyone else's.
  select cb.id into v_prev_batch
  from public.crm_import_batches cb
  where cb.organization_id = v_org and cb.uploaded_by = v_me
  order by cb.created_at desc
  limit 1;

  if v_prev_batch is not null then
    -- Only leads that are (a) tagged with the caller's own previous batch
    -- AND (b) still owned by the caller right now. A lead since reassigned
    -- to someone else survives, even though it still carries the old
    -- batch id -- it is no longer "the caller's own lead" to replace.
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
    v_phone := right(regexp_replace(coalesce(v_row->>'phone', ''), '\D', '', 'g'), 10);
    if length(regexp_replace(coalesce(v_row->>'phone', ''), '\D', '', 'g')) < 10 then
      v_phone := null;
    end if;
    v_email := nullif(lower(btrim(coalesce(v_row->>'email', ''))), '');

    if (v_phone is not null and v_phone = any (v_existing_phones))
       or (v_email is not null and v_email = any (v_existing_emails)) then
      v_duplicate_count := v_duplicate_count + 1;
      continue;
    end if;

    v_listing_rating := null;
    begin
      v_listing_rating := (v_row->>'listing_rating')::numeric;
      if v_listing_rating < 0 or v_listing_rating > 5 then
        v_listing_rating := null;
      end if;
    exception when others then
      v_listing_rating := null;
    end;

    v_sequence := v_sequence + 1;

    insert into public.crm_leads (
      first_name, last_name, company, email, phone, job_title,
      source, notes, estimated_value, owner_id, import_batch_id, listing_rating, created_at
    ) values (
      coalesce(nullif(btrim(v_row->>'first_name'), ''), 'Unknown'),
      nullif(btrim(v_row->>'last_name'), ''),
      nullif(btrim(v_row->>'company'), ''),
      v_email,
      v_phone,
      nullif(btrim(v_row->>'job_title'), ''),
      case when (v_row->>'source') in ('website', 'referral', 'cold-call', 'email', 'event', 'social', 'partner')
        then v_row->>'source' else 'other' end,
      nullif(btrim(v_row->>'notes'), ''),
      case when btrim(coalesce(v_row->>'estimated_value', '')) <> '' then (v_row->>'estimated_value')::numeric else null end,
      v_me,
      v_batch_id,
      v_listing_rating,
      now() + (v_sequence || ' microseconds')::interval
    );

    if v_phone is not null then
      v_existing_phones := array_append(v_existing_phones, v_phone);
    end if;
    if v_email is not null then
      v_existing_emails := array_append(v_existing_emails, v_email);
    end if;
    v_inserted_count := v_inserted_count + 1;
  end loop;

  update public.crm_import_batches
  set status = 'done',
      inserted_count = v_inserted_count,
      duplicate_count = v_duplicate_count,
      failed_count = 0
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'deleted_previous', v_deleted_count,
    'inserted_count', v_inserted_count,
    'duplicate_count', v_duplicate_count,
    'failed_count', 0
  );
end;
$$;

revoke all on function public.import_crm_leads(text, jsonb) from public, anon;
grant execute on function public.import_crm_leads(text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
