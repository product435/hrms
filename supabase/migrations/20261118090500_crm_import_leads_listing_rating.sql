-- Extends import_crm_leads to also read a numeric "listing_rating" value
-- (the business/listing rating column from an uploaded spreadsheet, e.g.
-- 4.9) and store it on the new crm_leads.listing_rating column added by
-- 20261118090000_crm_lead_listing_rating.sql. Never touches the existing
-- hot/warm/cold `rating` column, which keeps importing as 'warm' exactly
-- as before.
--
-- A row with no rating value, or one outside 0-5, is stored as null (not
-- rated) -- never a fabricated default.
--
-- "create or replace function" -- safe to run twice, no delete/drop of any
-- data. Only changes what import_crm_leads does the NEXT time it runs.
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

  -- Walk the sheet in order: skip only rows that duplicate a lead already
  -- in the database -- never against another row of this same file.
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
      v_listing_rating,
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
