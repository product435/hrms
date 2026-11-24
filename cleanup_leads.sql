-- ============================================================
-- CRM lead cleanup: keep only "Rahul Sharma" (Sunrise Clinic), remove
-- every other lead and whatever is linked ONLY to those other leads.
--
-- HOW TO RUN THIS FILE: three separate sections, in order.
--   SECTION 1 (BACKUP)  -- run first. No deletes. Safe to run any number
--                          of times: every backup table uses "create
--                          table if not exists ... as select", which in
--                          Postgres is a full no-op (including the SELECT)
--                          when the table already exists -- so re-running
--                          this section never duplicates rows and never
--                          overwrites an existing backup table.
--   SECTION 2 (PREVIEW) -- plain selects, run and read before touching
--                          SECTION 3. Re-runnable any time.
--   SECTION 3 (DELETE)  -- one transaction (begin ... commit). Only run
--                          this after reviewing SECTION 2's output. Also
--                          re-runnable: if everything except Rahul Sharma
--                          has already been deleted, the DELETE statements
--                          just affect zero rows the second time.
--
-- Nothing in this file has been run. Nothing in this file drops a table
-- or column (except a tiny same-transaction bookkeeping table this file
-- creates and drops itself, inside SECTION 3 -- see the comment there).
-- crm_import_batches is never touched.
--
-- Fix applied after the first run failed: Postgres has no max()/min()
-- aggregate for uuid (no default ordering is defined for that type), so
-- "select max(id) from crm_leads where ..." raised
-- "function max(uuid) does not exist". Every place that needed "the id of
-- the one matching lead" now gets it with a plain scalar subquery
-- (select id from ... where ... limit 1) instead of an aggregate -- there
-- is exactly one match by the time this runs (the safety check in
-- SECTION 3 guarantees that), so no ordering is even needed.
-- ============================================================


-- ============================================================
-- SECTION 1: BACKUP
-- Full copy of every table a delete below could affect, taken BEFORE any
-- delete runs.
-- ============================================================

-- All current leads, unconditionally.
create table if not exists public.crm_leads_backup_20261117 as
select * from public.crm_leads;

-- Activities, call logs and WhatsApp rows about to be removed because the
-- lead they point to is about to be removed (Rahul Sharma's own activity/
-- call-log/WhatsApp rows are excluded by the "lead_id <> rahul" filter, so
-- they are never backed up here because they are never deleted).
create table if not exists public.crm_activities_backup_20261117 as
select * from public.crm_activities
where lead_id is not null
  and lead_id <> (
    select id from public.crm_leads
    where first_name = 'Rahul' and last_name = 'Sharma' and company = 'Sunrise Clinic'
    limit 1
  );

create table if not exists public.crm_whatsapp_conversations_backup_20261117 as
select * from public.crm_whatsapp_conversations
where lead_id is not null
  and lead_id <> (
    select id from public.crm_leads
    where first_name = 'Rahul' and last_name = 'Sharma' and company = 'Sunrise Clinic'
    limit 1
  );

create table if not exists public.crm_whatsapp_messages_backup_20261117 as
select m.* from public.crm_whatsapp_messages m
where m.conversation_id in (select id from public.crm_whatsapp_conversations_backup_20261117);

create table if not exists public.crm_call_logs_backup_20261117 as
select * from public.crm_call_logs
where lead_id is not null
  and lead_id <> (
    select id from public.crm_leads
    where first_name = 'Rahul' and last_name = 'Sharma' and company = 'Sunrise Clinic'
    limit 1
  );

-- Accounts/contacts/deals that exist ONLY because a lead was converted,
-- and that lead is about to be deleted (Rahul Sharma's own
-- converted_account_id/converted_contact_id/converted_deal_id are all
-- null right now, so none of his records can ever appear in this set).
create table if not exists public.crm_deals_backup_20261117 as
select d.* from public.crm_deals d
where d.id in (
  select converted_deal_id from public.crm_leads
  where converted_deal_id is not null
    and id <> (
      select id from public.crm_leads
      where first_name = 'Rahul' and last_name = 'Sharma' and company = 'Sunrise Clinic'
      limit 1
    )
);

create table if not exists public.crm_contacts_backup_20261117 as
select c.* from public.crm_contacts c
where c.id in (
  select converted_contact_id from public.crm_leads
  where converted_contact_id is not null
    and id <> (
      select id from public.crm_leads
      where first_name = 'Rahul' and last_name = 'Sharma' and company = 'Sunrise Clinic'
      limit 1
    )
);

create table if not exists public.crm_accounts_backup_20261117 as
select a.* from public.crm_accounts a
where a.id in (
  select converted_account_id from public.crm_leads
  where converted_account_id is not null
    and id <> (
      select id from public.crm_leads
      where first_name = 'Rahul' and last_name = 'Sharma' and company = 'Sunrise Clinic'
      limit 1
    )
);


-- ============================================================
-- SECTION 2: PREVIEW
-- Plain selects. Run these and read the results before running SECTION 3.
-- ============================================================

-- Total leads right now.
select count(*) as total_leads_before from public.crm_leads;

-- The lead that will be KEPT (should return exactly one row).
select id, first_name, last_name, phone, company
from public.crm_leads
where first_name = 'Rahul' and last_name = 'Sharma' and company = 'Sunrise Clinic';

-- How many leads will be deleted.
select count(*) as leads_to_be_deleted
from public.crm_leads
where id <> (
  select id from public.crm_leads
  where first_name = 'Rahul' and last_name = 'Sharma' and company = 'Sunrise Clinic'
  limit 1
);

-- What dependent data will be deleted alongside them (reads from the
-- backup tables taken in SECTION 1, so run SECTION 1 first).
select
  (select count(*) from public.crm_activities_backup_20261117) as activities_to_delete,
  (select count(*) from public.crm_whatsapp_conversations_backup_20261117) as whatsapp_conversations_to_delete,
  (select count(*) from public.crm_whatsapp_messages_backup_20261117) as whatsapp_messages_to_delete,
  (select count(*) from public.crm_call_logs_backup_20261117) as call_logs_to_delete,
  (select count(*) from public.crm_deals_backup_20261117) as deals_to_delete,
  (select count(*) from public.crm_contacts_backup_20261117) as contacts_to_delete,
  (select count(*) from public.crm_accounts_backup_20261117) as accounts_to_delete;


-- ============================================================
-- SECTION 3: DELETE
-- One transaction. Only run after reviewing SECTION 2's output above.
-- ============================================================

begin;

-- Captures the true lead count at the start of THIS transaction (not
-- whatever SECTION 1's backup happened to see, which may have been taken
-- earlier), so the final counts below are accurate even if time passed
-- between SECTION 1 and this section, or this section runs more than
-- once. This bookkeeping table is created and dropped entirely within
-- this same transaction -- it never persists, so it is not one of "your"
-- tables and dropping it here does not conflict with "do not drop any
-- table."
drop table if exists public.crm_leads_delete_run_20261117;
create table public.crm_leads_delete_run_20261117 as
select count(*) as total_before from public.crm_leads;

do $$
declare
  v_keep_id uuid;
  v_match_count int;
begin
  -- Safety check: abort the whole transaction unless exactly one lead
  -- matches "Rahul Sharma" / "Sunrise Clinic". If zero or more than one
  -- match, nothing below runs. (No aggregate on the uuid column here --
  -- just a row count and a plain, unaggregated id from that same row.)
  select count(*) into v_match_count
  from public.crm_leads
  where first_name = 'Rahul' and last_name = 'Sharma' and company = 'Sunrise Clinic';

  if v_match_count <> 1 then
    raise exception 'Expected exactly one lead named Rahul Sharma / Sunrise Clinic, found %. Aborting -- nothing was deleted.', v_match_count;
  end if;

  select id into v_keep_id
  from public.crm_leads
  where first_name = 'Rahul' and last_name = 'Sharma' and company = 'Sunrise Clinic'
  limit 1;

  -- 1. WhatsApp messages/conversations linked to a lead that is about to
  -- be deleted (never Rahul Sharma's own conversation, excluded by this
  -- same lead_id <> v_keep_id filter).
  delete from public.crm_whatsapp_messages
  where conversation_id in (
    select id from public.crm_whatsapp_conversations
    where lead_id is not null and lead_id <> v_keep_id
  );
  delete from public.crm_whatsapp_conversations
  where lead_id is not null and lead_id <> v_keep_id;

  -- 2. Call logs linked to a lead that is about to be deleted.
  delete from public.crm_call_logs
  where lead_id is not null and lead_id <> v_keep_id;

  -- 3. Deals/contacts/accounts that exist only because a now-deleted lead
  -- was converted into them (Rahul Sharma is not converted, so none of
  -- this can ever match his converted_account_id/converted_contact_id/
  -- converted_deal_id, which are all null).
  delete from public.crm_deals
  where id in (
    select converted_deal_id from public.crm_leads
    where converted_deal_id is not null and id <> v_keep_id
  );
  delete from public.crm_contacts
  where id in (
    select converted_contact_id from public.crm_leads
    where converted_contact_id is not null and id <> v_keep_id
  );
  delete from public.crm_accounts
  where id in (
    select converted_account_id from public.crm_leads
    where converted_account_id is not null and id <> v_keep_id
  );

  -- 4. The leads themselves. crm_activities.lead_id is "on delete cascade"
  -- (see supabase/migrations/20261102110000_sales_crm.sql), so each
  -- deleted lead's own activities are removed automatically here -- no
  -- separate activities delete needed, and Rahul Sharma's activities are
  -- untouched because his lead row is excluded by this same filter.
  delete from public.crm_leads
  where id <> v_keep_id;
end $$;

-- Final counts. Expect: after = 1.
select
  r.total_before as total_leads_before,
  r.total_before - (select count(*) from public.crm_leads) as leads_deleted,
  1 as leads_kept,
  (select count(*) from public.crm_leads) as total_leads_after
from public.crm_leads_delete_run_20261117 r;

drop table public.crm_leads_delete_run_20261117;

commit;
