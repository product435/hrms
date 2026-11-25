-- CRM role-based visibility AND write/reassign scope -- supersedes both
-- earlier drafts of this same file (neither was ever applied, so replacing
-- outright is safe).
--
-- Rules implemented here, per your instructions across this thread:
--   1. A plain sales rep: SELECT, UPDATE, DELETE and reassign ONLY their
--      own records -- including crm_leads.
--   2. admin, hr: see and manage everyone's CRM records (hr is a NEW grant
--      -- hr has NO CRM access at all today).
--   3. team_lead/manager: own + own team's records, and may reassign a
--      record only to/from someone in their own team.
--   4. dept_head: NO extra CRM access at all.
--   5. import_crm_leads(): replacing a previous import deletes ONLY the
--      caller's own earlier batch, and never a lead whose owner_id has
--      since been reassigned away from the caller -- even if it's still
--      tagged with that caller's old batch id.
--   6. crm_sales_targets, crm_call_logs, crm_whatsapp_conversations,
--      crm_whatsapp_messages, crm_import_batches get the same own/team/all
--      SELECT scoping as the 5 original CRM tables, AND the same
--      team-scoped reassignment/write rule as the 5 original tables: a
--      team_lead may only assign/write within their own team on
--      crm_call_logs, crm_whatsapp_conversations, crm_whatsapp_messages
--      and crm_import_batches (crm_new_tables_before_write(), section H
--      below); and on crm_sales_targets, a team_lead may only set a
--      target for themselves or their own team, NEVER the company-wide
--      target (owner_id is null) -- only admin/hr may set that one.
--   7. Incoming call/WhatsApp paths verified unaffected (see below).
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

-- ---------------------------------------------------------------------------
-- A. Access helpers -- hr added, dept_head removed from "manage all".
-- ---------------------------------------------------------------------------

-- is_sales_member() is UNCHANGED (still department-membership-based).
-- crm_can_write() is updated below (point 2): hr added, admin kept, any
-- sales-department member kept.

create or replace function public.crm_can_manage_all()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'hr')
    or (
      public.is_sales_member()
      and public.current_user_role() = 'team_lead'
    );
$$;

create or replace function public.has_crm_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'hr', 'general_manager')
    or public.is_sales_member();
$$;

-- admin/hr manage all CRM records even when neither is personally a sales-
-- department member -- crm_can_write() previously only admitted admin or
-- is_sales_member(), which silently excluded hr from ever creating/editing
-- a CRM record despite has_crm_access()/crm_can_manage_all() already
-- treating hr as a full manager. Fixed here.
create or replace function public.crm_can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'hr') or public.is_sales_member();
$$;

revoke all on function public.crm_can_manage_all() from public, anon;
revoke all on function public.has_crm_access() from public, anon;
revoke all on function public.crm_can_write() from public, anon;
grant execute on function public.crm_can_manage_all() to authenticated, service_role;
grant execute on function public.has_crm_access() to authenticated, service_role;
grant execute on function public.crm_can_write() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- B. Team membership helper.
-- ---------------------------------------------------------------------------

create or replace function public.crm_team_member_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(e.id),
    array[public.current_employee_id()]
  )
  from public.employees e
  where e.manager_id = public.current_employee_id()
     or e.id = public.current_employee_id();
$$;

revoke all on function public.crm_team_member_ids() from public, anon;
grant execute on function public.crm_team_member_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- C. SELECT/UPDATE/DELETE on the 5 original CRM tables -- own / team / all.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['crm_accounts', 'crm_contacts', 'crm_leads', 'crm_deals', 'crm_activities']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         organization_id = public.current_org_id()
         and public.has_crm_access()
         and (
           public.current_user_role() in (''admin'', ''hr'', ''general_manager'')
           or (public.current_user_role() = ''team_lead'' and owner_id = any (public.crm_team_member_ids()))
           or owner_id = public.current_employee_id()
         )
       )',
      t || '_select', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (
           organization_id = public.current_org_id()
           and public.crm_can_write()
           and (
             owner_id = public.current_employee_id()
             or (public.current_user_role() = ''team_lead'' and owner_id = any (public.crm_team_member_ids()))
             or public.current_user_role() in (''admin'', ''hr'')
           )
         )
         with check (
           organization_id = public.current_org_id()
           and public.crm_can_write()
           and (
             owner_id = public.current_employee_id()
             or (public.current_user_role() = ''team_lead'' and owner_id = any (public.crm_team_member_ids()))
             or public.current_user_role() in (''admin'', ''hr'')
           )
         )',
      t || '_update', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (
         organization_id = public.current_org_id()
         and public.crm_can_write()
         and (
           owner_id = public.current_employee_id()
           or (public.current_user_role() = ''team_lead'' and owner_id = any (public.crm_team_member_ids()))
           or public.current_user_role() in (''admin'', ''hr'')
         )
       )',
      t || '_delete', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- D. Reassignment target: a team_lead may only hand a record to/from a
--    member of their own team, not anyone org-wide. admin/hr unrestricted.
--    Everything else in this trigger is unchanged, byte-for-byte, from
--    20261102110000_sales_crm.sql.
-- ---------------------------------------------------------------------------

create or replace function public.crm_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_me uuid := public.current_employee_id();
  v_team uuid[];
begin
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.organization_id := v_org;
    new.created_by := v_me;
    new.created_at := now();
    if new.owner_id is null then
      new.owner_id := v_me;
    end if;
  else
    if new.organization_id is distinct from old.organization_id then
      raise exception 'CRM records cannot move between organisations.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  if new.organization_id is null then
    raise exception 'Your account is not linked to an organisation.';
  end if;

  if not public.crm_owner_in_org(new.owner_id) then
    raise exception 'Owner must be an employee of your organisation.';
  end if;

  if tg_op = 'INSERT' then
    if new.owner_id is distinct from v_me and not public.crm_can_manage_all() then
      raise exception 'Only a sales lead, HR or super admin can assign CRM records to someone else.';
    end if;
    if new.owner_id is distinct from v_me and public.current_user_role() = 'team_lead' then
      v_team := public.crm_team_member_ids();
      if not (new.owner_id = any (v_team)) then
        raise exception 'A sales lead can only assign CRM records within their own team.';
      end if;
    end if;
  elsif new.owner_id is distinct from old.owner_id then
    if not public.crm_can_manage_all() then
      raise exception 'Only a sales lead, HR or super admin can assign CRM records to someone else.';
    end if;
    if public.current_user_role() = 'team_lead' then
      v_team := public.crm_team_member_ids();
      if not (old.owner_id = any (v_team) and new.owner_id = any (v_team)) then
        raise exception 'A sales lead can only assign CRM records within their own team.';
      end if;
    end if;
  end if;

  if tg_table_name = 'crm_contacts' then
    if new.account_id is not null and not exists (
      select 1 from public.crm_accounts a where a.id = new.account_id and a.organization_id = new.organization_id
    ) then
      raise exception 'Account not found.';
    end if;

  elsif tg_table_name = 'crm_deals' then
    if new.account_id is not null and not exists (
      select 1 from public.crm_accounts a where a.id = new.account_id and a.organization_id = new.organization_id
    ) then
      raise exception 'Account not found.';
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.crm_contacts c where c.id = new.contact_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Contact not found.';
    end if;
    if new.stage = 'won' then
      new.probability := 100;
      new.lost_reason := null;
      if tg_op = 'INSERT' then
        new.closed_at := now();
      elsif old.stage is distinct from 'won' then
        new.closed_at := now();
      end if;
    elsif new.stage = 'lost' then
      new.probability := 0;
      if tg_op = 'INSERT' then
        new.closed_at := now();
      elsif old.stage is distinct from 'lost' then
        new.closed_at := now();
      end if;
    else
      new.closed_at := null;
      new.lost_reason := null;
    end if;

  elsif tg_table_name = 'crm_activities' then
    if new.status = 'done' then
      if new.completed_at is null then
        new.completed_at := now();
      end if;
    else
      new.completed_at := null;
    end if;
    if new.lead_id is not null and not exists (
      select 1 from public.crm_leads l where l.id = new.lead_id and l.organization_id = new.organization_id
    ) then
      raise exception 'Lead not found.';
    end if;
    if new.deal_id is not null and not exists (
      select 1 from public.crm_deals d where d.id = new.deal_id and d.organization_id = new.organization_id
    ) then
      raise exception 'Deal not found.';
    end if;
    if new.account_id is not null and not exists (
      select 1 from public.crm_accounts a where a.id = new.account_id and a.organization_id = new.organization_id
    ) then
      raise exception 'Account not found.';
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.crm_contacts c where c.id = new.contact_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Contact not found.';
    end if;

  elsif tg_table_name = 'crm_leads' then
    if new.status = 'converted' then
      if new.converted_at is null then
        new.converted_at := now();
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.crm_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- E. crm_owner_directory(): roster for every Owner/Salesperson filter.
--    admin/hr see everyone; team_lead sees own team; dept_head gets no
--    special case (falls through to has_crm_access()'s own-membership
--    rule, same as any plain rep).
-- ---------------------------------------------------------------------------

create or replace function public.crm_owner_directory()
returns table (id uuid, full_name text, department_name text)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), ''),
    d.name
  from public.employees e
  left join public.departments d on d.id = e.department_id
  where public.has_crm_access()
    and e.organization_id = public.current_org_id()
    and lower(coalesce(e.employment_status, 'active')) in ('active', 'probation', 'notice', 'on-leave')
    and (
      d.is_sales
      or exists (
        select 1 from public.departments h
        where h.manager_id = e.id and h.is_sales and h.organization_id = e.organization_id
      )
    )
    and (
      public.current_user_role() not in ('team_lead')
      or e.id = any (public.crm_team_member_ids())
    )
  order by 2 nulls last;
$$;

revoke all on function public.crm_owner_directory() from public, anon;
grant execute on function public.crm_owner_directory() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- F. import_crm_leads(): replacing a previous import now deletes ONLY the
--    caller's own earlier batch (uploaded_by = caller), and only leads
--    still owned by the caller -- never a lead reassigned to someone else
--    in the meantime, even if it is still tagged with that batch id.
--    Everything else in this function (duplicate lookup, row-by-row
--    insert, listing_rating handling) is unchanged, byte-for-byte, from
--    20261118090500_crm_import_leads_listing_rating.sql.
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

-- ---------------------------------------------------------------------------
-- G. crm_sales_targets, crm_call_logs, crm_whatsapp_conversations,
--    crm_import_batches: SELECT scoped the same way (own/team/all). Their
--    UPDATE/DELETE RLS policies (owner_id = me OR crm_can_manage_all()) are
--    untouched here -- the team-scoping for a team_lead's write/reassign on
--    these tables is enforced in the before-write triggers instead
--    (sections H and I below), the same split already used for the 5
--    original tables (RLS owner-or-manage-all + crm_before_write's
--    reassignment-target check in section D).
-- ---------------------------------------------------------------------------

drop policy if exists crm_sales_targets_select on public.crm_sales_targets;
create policy crm_sales_targets_select on public.crm_sales_targets for select to authenticated
  using (
    organization_id = public.current_org_id()
    and public.has_crm_access()
    and (
      owner_id is null -- the organisation-wide/company target: visible to anyone with CRM access
      or public.current_user_role() in ('admin', 'hr', 'general_manager')
      or (public.current_user_role() = 'team_lead' and owner_id = any (public.crm_team_member_ids()))
      or owner_id = public.current_employee_id()
    )
  );

do $$
declare
  t text;
begin
  foreach t in array array['crm_import_batches', 'crm_call_logs', 'crm_whatsapp_conversations']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         organization_id = public.current_org_id()
         and public.has_crm_access()
         and (
           public.current_user_role() in (''admin'', ''hr'', ''general_manager'')
           or (public.current_user_role() = ''team_lead'' and owner_id = any (public.crm_team_member_ids()))
           or owner_id = public.current_employee_id()
         )
       )',
      t || '_select', t
    );
  end loop;
end $$;

-- crm_whatsapp_messages has no owner_id of its own; ownership is its parent
-- conversation's owner_id, same as its existing insert/delete policies
-- already check.
drop policy if exists crm_whatsapp_messages_select on public.crm_whatsapp_messages;
create policy crm_whatsapp_messages_select on public.crm_whatsapp_messages for select to authenticated using (
  organization_id = public.current_org_id()
  and public.has_crm_access()
  and exists (
    select 1 from public.crm_whatsapp_conversations c
    where c.id = conversation_id
      and c.organization_id = public.current_org_id()
      and (
        public.current_user_role() in ('admin', 'hr', 'general_manager')
        or (public.current_user_role() = 'team_lead' and c.owner_id = any (public.crm_team_member_ids()))
        or c.owner_id = public.current_employee_id()
      )
  )
);

-- ---------------------------------------------------------------------------
-- H. crm_new_tables_before_write(): same team-scoped reassignment rule as
--    crm_before_write() (section D), for crm_import_batches, crm_call_logs,
--    crm_whatsapp_conversations and crm_whatsapp_messages. A team_lead may
--    only assign/write one of these to/from a member of their own team;
--    admin/hr unrestricted. Everything else in this function is unchanged,
--    byte-for-byte, from 20261112130740_crm_bulk_import_calls_whatsapp_demo.sql.
-- ---------------------------------------------------------------------------

create or replace function public.crm_new_tables_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_me uuid := public.current_employee_id();
  v_team uuid[];
begin
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.organization_id := v_org;
    if tg_table_name in ('crm_call_logs', 'crm_whatsapp_conversations') then
      new.created_by := coalesce(new.created_by, v_me);
    end if;
    if tg_table_name = 'crm_whatsapp_messages' then
      new.created_by := coalesce(new.created_by, v_me);
    end if;
    new.created_at := now();
    if tg_table_name in ('crm_import_batches', 'crm_call_logs', 'crm_whatsapp_conversations')
       and new.owner_id is null then
      new.owner_id := v_me;
    end if;
  else
    if new.organization_id is distinct from old.organization_id then
      raise exception 'CRM records cannot move between organisations.';
    end if;
    new.created_at := old.created_at;
  end if;

  if new.organization_id is null then
    raise exception 'Your account is not linked to an organisation.';
  end if;

  if tg_table_name in ('crm_import_batches', 'crm_call_logs', 'crm_whatsapp_conversations') then
    if not public.crm_owner_in_org(new.owner_id) then
      raise exception 'Owner must be an employee of your organisation.';
    end if;
    if tg_op = 'INSERT' then
      if new.owner_id is distinct from v_me and not public.crm_can_manage_all() then
        raise exception 'Only a sales lead, HR or super admin can assign CRM records to someone else.';
      end if;
      if new.owner_id is distinct from v_me and public.current_user_role() = 'team_lead' then
        v_team := public.crm_team_member_ids();
        if not (new.owner_id = any (v_team)) then
          raise exception 'A sales lead can only assign CRM records within their own team.';
        end if;
      end if;
    elsif new.owner_id is distinct from old.owner_id then
      if not public.crm_can_manage_all() then
        raise exception 'Only a sales lead, HR or super admin can assign CRM records to someone else.';
      end if;
      if public.current_user_role() = 'team_lead' then
        v_team := public.crm_team_member_ids();
        if not (old.owner_id = any (v_team) and new.owner_id = any (v_team)) then
          raise exception 'A sales lead can only assign CRM records within their own team.';
        end if;
      end if;
    end if;
  end if;

  if tg_table_name = 'crm_call_logs' then
    select a.lead_id, a.deal_id, a.account_id, a.contact_id
      into new.lead_id, new.deal_id, new.account_id, new.contact_id
      from public.crm_activities a
      where a.id = new.activity_id and a.organization_id = new.organization_id;
    if new.activity_id is null or not found then
      raise exception 'Activity not found.';
    end if;

  elsif tg_table_name = 'crm_whatsapp_conversations' then
    if new.lead_id is not null and not exists (
      select 1 from public.crm_leads l where l.id = new.lead_id and l.organization_id = new.organization_id
    ) then
      raise exception 'Lead not found.';
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.crm_contacts c where c.id = new.contact_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Contact not found.';
    end if;

  elsif tg_table_name = 'crm_whatsapp_messages' then
    declare
      v_conv_org uuid;
      v_conv_owner uuid;
    begin
      select organization_id, owner_id into v_conv_org, v_conv_owner
        from public.crm_whatsapp_conversations
        where id = new.conversation_id;
      if v_conv_org is null or v_conv_org is distinct from v_org then
        raise exception 'Conversation not found.';
      end if;
      -- Only the conversation's own owner may write to it, or someone who
      -- can manage it: admin/hr unrestricted, a team_lead only if the
      -- conversation's owner is within their own team.
      if v_conv_owner is distinct from v_me then
        if not public.crm_can_manage_all() then
          raise exception 'Only the conversation owner or a sales lead can write to it.';
        end if;
        if public.current_user_role() = 'team_lead' then
          v_team := public.crm_team_member_ids();
          if not (v_conv_owner = any (v_team)) then
            raise exception 'A sales lead can only write to a conversation within their own team.';
          end if;
        end if;
      end if;
      new.organization_id := v_conv_org;
    end;
  end if;

  if tg_table_name <> 'crm_whatsapp_messages' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.crm_new_tables_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- I. crm_sales_targets_before_write(): a team_lead may only set/edit a
--    target for themselves or a member of their own team -- NEVER the
--    company-wide target (owner_id is null). Only admin/hr may write the
--    company-wide target, or any other salesperson's target outside the
--    team_lead's own team. Everything else in this function is unchanged,
--    byte-for-byte, from 20261123090000_crm_sales_targets.sql.
-- ---------------------------------------------------------------------------

create or replace function public.crm_sales_targets_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_me uuid := public.current_employee_id();
begin
  -- Service role / SQL editor (no auth user) may write freely.
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.organization_id := v_org;
    new.created_by := v_me;
    new.created_at := now();
  else
    if new.organization_id is distinct from old.organization_id then
      raise exception 'Sales targets cannot move between organisations.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  if new.organization_id is null then
    raise exception 'Your account is not linked to an organisation.';
  end if;

  if new.owner_id is not null and not public.crm_owner_in_org(new.owner_id) then
    raise exception 'Target owner must be an employee of your organisation.';
  end if;

  -- Only a sales lead, HR or Super Admin may set a target (never a plain
  -- rep, even for themselves).
  if not public.crm_can_manage_all() then
    raise exception 'Only a sales lead, HR or super admin can set sales targets.';
  end if;

  -- The company-wide target (owner_id is null) may only be set by admin/hr.
  if new.owner_id is null and public.current_user_role() not in ('admin', 'hr') then
    raise exception 'Only HR or super admin can set the company-wide sales target.';
  end if;

  -- A team_lead may only set a target for themselves or a member of their
  -- own team, never anyone outside it.
  if new.owner_id is not null and public.current_user_role() = 'team_lead' then
    if not (new.owner_id = any (public.crm_team_member_ids())) then
      raise exception 'A sales lead can only set targets within their own team.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.crm_sales_targets_before_write() from public, anon, authenticated;

notify pgrst, 'reload schema';
