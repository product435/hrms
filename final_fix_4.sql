-- ============================================================
-- final_fix_4.sql
--
-- Replaces the "delete only the previous import batch" behaviour with:
-- an import replaces ALL leads (hand-added and converted included), and
-- removing a lead (by import or by the trash icon) cascades to everything
-- that lead created or that points to it -- archiving every row first.
--
-- Safe to run twice: every object below uses "create or replace function"
-- or "create table if not exists". No table or column is ever dropped.
-- Ends with "notify pgrst, 'reload schema';".
--
-- WHY "RAHUL SHARMA" / SUNRISE CLINIC STAYED AFTER AN IMPORT AND AFTER
-- BEING DELETED FROM THE LEADS TAB (read before running):
--
-- 1. import_crm_leads (both the tracked migration
--    supabase/migrations/20261117110000_crm_import_leads_rpc.sql and the
--    live override final_fix.sql) only ever deletes
--    "where import_batch_id = v_prev_batch" -- the ONE most recent import
--    batch. A hand-added lead ("+ New lead") has import_batch_id = null,
--    so that WHERE clause never matches it; a lead converted during an
--    earlier import also keeps that old batch's id, but once a NEWER
--    import has run, v_prev_batch points at the newer batch, not the one
--    Rahul's row belongs to -- so his row is skipped by every import after
--    his own. Either way the DELETE's WHERE clause simply never selects
--    his row, so it is never touched.
-- 2. crm_leads.leads() (src/services/crmService.ts) has no status or
--    batch filter at all -- it selects every row in crm_leads, ordered by
--    import_sequence/created_at. So any lead the import's DELETE missed
--    (rule 1) keeps showing up in the Leads list forever, converted or not.
-- 3. The trash icon calls crmService.deleteLead(id), which is a plain
--    "delete from crm_leads where id = :id" (see remove() in
--    crmService.ts). crm_leads.converted_account_id /
--    converted_contact_id / converted_deal_id are FOREIGN KEYS *FROM*
--    crm_leads *TO* crm_accounts/crm_contacts/crm_deals ("on delete set
--    null" -- see 20261102110000_sales_crm.sql). That direction means
--    deleting the lead only clears those three columns on the lead row
--    itself; nothing ever pointed the other way (account -> lead), so his
--    account "Sunrise Clinic", contact "Rahul Sharma" and deal "Sunrise
--    Clinic" have no foreign key telling them anything happened, and stay
--    exactly as they were -- fully visible in Accounts/Contacts/Deals, with
--    every crm_activities/crm_call_logs/crm_whatsapp_* row still pointing
--    at them (and, for activities and call logs, often still pointing at
--    his now-gone lead_id too, which is allowed because those FKs don't
--    require the lead to still exist once it's gone -- they only enforce
--    it going forward through crm_before_write on INSERT/UPDATE).
--
-- TABLES WITH A FOREIGN KEY INTO crm_leads / crm_deals / crm_accounts /
-- crm_contacts (found by reading every migration under supabase/migrations
-- and the untracked final_fix.sql / combined_import_migration.sql /
-- fix_import_owner.sql / cleanup_leads.sql in the project root):
--   - crm_leads.converted_account_id -> crm_accounts   (on delete set null)
--   - crm_leads.converted_contact_id -> crm_contacts   (on delete set null)
--   - crm_leads.converted_deal_id    -> crm_deals       (on delete set null)
--   - crm_deals.account_id           -> crm_accounts   (on delete set null)
--   - crm_deals.contact_id           -> crm_contacts   (on delete set null)
--   - crm_contacts.account_id        -> crm_accounts   (on delete set null)
--   - crm_activities.lead_id         -> crm_leads       (on delete cascade)
--   - crm_activities.deal_id         -> crm_deals       (on delete cascade)
--   - crm_activities.account_id      -> crm_accounts   (on delete cascade)
--   - crm_activities.contact_id      -> crm_contacts   (on delete cascade)
--   - crm_call_logs.lead_id          -> crm_leads       (on delete set null)
--   - crm_call_logs.deal_id          -> crm_deals       (on delete set null)
--   - crm_call_logs.account_id       -> crm_accounts   (on delete set null)
--   - crm_call_logs.contact_id       -> crm_contacts   (on delete set null)
--   - crm_call_logs.activity_id      -> crm_activities (on delete cascade)
--   - crm_whatsapp_conversations.lead_id    -> crm_leads    (on delete set null)
--   - crm_whatsapp_conversations.contact_id -> crm_contacts (on delete set null)
--   - crm_whatsapp_messages.conversation_id -> crm_whatsapp_conversations (on delete cascade)
--   - crm_leads.import_batch_id      -> crm_import_batches (on delete set null)
--     (the only FK pointing the OTHER way -- a batch is never removed by
--     this file, so it is irrelevant to the cascade and left alone)
-- No other table in any migration references crm_leads, crm_deals,
-- crm_accounts or crm_contacts.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Archive tables. One per table that can be removed by the cascade
--    below, plus crm_leads itself. "like <table> including all" copies
--    every column, default and constraint shape; archived_at is added on
--    top. Never selected by leads()/deals()/accounts()/contacts()/
--    activities() in crmService.ts, so never shown in the app.
-- ------------------------------------------------------------

create table if not exists public.crm_leads_archive (
  like public.crm_leads including all
);
alter table public.crm_leads_archive
  add column if not exists archived_at timestamptz not null default now();

create table if not exists public.crm_deals_archive (
  like public.crm_deals including all
);
alter table public.crm_deals_archive
  add column if not exists archived_at timestamptz not null default now();

create table if not exists public.crm_accounts_archive (
  like public.crm_accounts including all
);
alter table public.crm_accounts_archive
  add column if not exists archived_at timestamptz not null default now();

create table if not exists public.crm_contacts_archive (
  like public.crm_contacts including all
);
alter table public.crm_contacts_archive
  add column if not exists archived_at timestamptz not null default now();

create table if not exists public.crm_activities_archive (
  like public.crm_activities including all
);
alter table public.crm_activities_archive
  add column if not exists archived_at timestamptz not null default now();

create table if not exists public.crm_call_logs_archive (
  like public.crm_call_logs including all
);
alter table public.crm_call_logs_archive
  add column if not exists archived_at timestamptz not null default now();

create table if not exists public.crm_whatsapp_conversations_archive (
  like public.crm_whatsapp_conversations including all
);
alter table public.crm_whatsapp_conversations_archive
  add column if not exists archived_at timestamptz not null default now();

create table if not exists public.crm_whatsapp_messages_archive (
  like public.crm_whatsapp_messages including all
);
alter table public.crm_whatsapp_messages_archive
  add column if not exists archived_at timestamptz not null default now();

-- "like ... including all" on an archive table copies the source table's
-- own foreign keys, primary key and unique constraints/indexes too, which
-- would wrongly stop an archive table from ever holding more than one
-- snapshot of the same row (e.g. the same lead id archived twice, by two
-- different deletes over time), or from outliving the original row's
-- deletion. Archive tables must not enforce the live schema's PK/FKs/
-- uniques -- only keep the copied columns. Constraints (primary key,
-- foreign key, unique) are read from pg_constraint; a unique index that
-- exists WITHOUT a backing constraint (possible in Postgres, and not
-- caught by only checking pg_constraint) is read separately from pg_index.
do $$
declare
  t text;
  c record;
  i record;
begin
  foreach t in array array[
    'crm_leads_archive', 'crm_deals_archive', 'crm_accounts_archive',
    'crm_contacts_archive', 'crm_activities_archive', 'crm_call_logs_archive',
    'crm_whatsapp_conversations_archive', 'crm_whatsapp_messages_archive'
  ]
  loop
    for c in
      select conname from pg_constraint
      where conrelid = ('public.' || t)::regclass
        and contype in ('p', 'f', 'u')
    loop
      execute format('alter table public.%I drop constraint if exists %I', t, c.conname);
    end loop;

    -- Any index still marked unique (indisunique) or primary (indisprimary)
    -- after the constraint drops above -- i.e. one that was never backed by
    -- a named constraint in pg_constraint in the first place -- is dropped
    -- directly by name.
    for i in
      select ic.relname as index_name
      from pg_index ix
      join pg_class ic on ic.oid = ix.indexrelid
      where ix.indrelid = ('public.' || t)::regclass
        and (ix.indisunique or ix.indisprimary)
    loop
      execute format('drop index if exists public.%I', i.index_name);
    end loop;

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
end $$;

-- Hidden from the app: RLS with no policies at all denies every row to
-- "authenticated", and these tables are never queried by crmService.ts.


-- ------------------------------------------------------------
-- 2. remove_crm_leads(p_lead_ids uuid[])
--
-- Archives then deletes: the given leads; the account/contact/deal each
-- one converted into (converted_account_id/converted_contact_id/
-- converted_deal_id); and every activity, call log, WhatsApp conversation
-- and WhatsApp message that points at any of those leads/deals/accounts/
-- contacts. An account/contact is only removed if no SURVIVING lead, deal
-- or contact still references it (rule B's safety check). Runs inside the
-- caller's transaction (plain SQL function, not a new transaction of its
-- own) so a caller wrapping this in more work still gets one atomic unit;
-- any exception here aborts everything the caller has done so far too.
-- ------------------------------------------------------------

create or replace function public.remove_crm_leads(p_lead_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal_ids uuid[];
  v_account_ids uuid[];
  v_contact_ids uuid[];
  v_removable_account_ids uuid[];
  v_removable_contact_ids uuid[];
  v_leads_deleted int := 0;
  v_deals_deleted int := 0;
  v_accounts_deleted int := 0;
  v_contacts_deleted int := 0;
  v_activities_deleted int := 0;
  v_call_logs_deleted int := 0;
  v_whatsapp_conversations_deleted int := 0;
  v_whatsapp_messages_deleted int := 0;
begin
  if p_lead_ids is null or array_length(p_lead_ids, 1) is null then
    return jsonb_build_object(
      'leads_deleted', 0, 'deals_deleted', 0, 'accounts_deleted', 0,
      'contacts_deleted', 0, 'activities_deleted', 0, 'call_logs_deleted', 0,
      'whatsapp_conversations_deleted', 0, 'whatsapp_messages_deleted', 0
    );
  end if;

  -- What each removed lead converted into.
  select
    array_agg(distinct converted_deal_id) filter (where converted_deal_id is not null),
    array_agg(distinct converted_account_id) filter (where converted_account_id is not null),
    array_agg(distinct converted_contact_id) filter (where converted_contact_id is not null)
  into v_deal_ids, v_account_ids, v_contact_ids
  from public.crm_leads
  where id = any(p_lead_ids);
  v_deal_ids := coalesce(v_deal_ids, array[]::uuid[]);
  v_account_ids := coalesce(v_account_ids, array[]::uuid[]);
  v_contact_ids := coalesce(v_contact_ids, array[]::uuid[]);

  -- Safety check (rule B): an account/contact is removed only if no
  -- SURVIVING lead, deal or contact still references it. "Surviving" means
  -- any row outside this delete's own account/contact/deal set.
  select coalesce(array_agg(a.id), array[]::uuid[]) into v_removable_account_ids
  from unnest(v_account_ids) a(id)
  where not exists (
    select 1 from public.crm_leads l
    where l.converted_account_id = a.id and not (l.id = any(p_lead_ids))
  )
  and not exists (
    select 1 from public.crm_deals d
    where d.account_id = a.id and not (d.id = any(v_deal_ids))
  )
  and not exists (
    select 1 from public.crm_contacts c
    where c.account_id = a.id and not (c.id = any(v_contact_ids))
  );

  select coalesce(array_agg(c.id), array[]::uuid[]) into v_removable_contact_ids
  from unnest(v_contact_ids) c(id)
  where not exists (
    select 1 from public.crm_leads l
    where l.converted_contact_id = c.id and not (l.id = any(p_lead_ids))
  )
  and not exists (
    select 1 from public.crm_deals d
    where d.contact_id = c.id and not (d.id = any(v_deal_ids))
  );

  -- 2a. Archive every row this call will remove, BEFORE removing any of it.
  insert into public.crm_activities_archive
  select *, now() from public.crm_activities
  where lead_id = any(p_lead_ids)
     or deal_id = any(v_deal_ids)
     or account_id = any(v_removable_account_ids)
     or contact_id = any(v_removable_contact_ids);

  insert into public.crm_call_logs_archive
  select *, now() from public.crm_call_logs
  where lead_id = any(p_lead_ids)
     or deal_id = any(v_deal_ids)
     or account_id = any(v_removable_account_ids)
     or contact_id = any(v_removable_contact_ids)
     or activity_id in (
       select id from public.crm_activities
       where lead_id = any(p_lead_ids)
          or deal_id = any(v_deal_ids)
          or account_id = any(v_removable_account_ids)
          or contact_id = any(v_removable_contact_ids)
     );

  insert into public.crm_whatsapp_messages_archive
  select m.*, now() from public.crm_whatsapp_messages m
  where m.conversation_id in (
    select id from public.crm_whatsapp_conversations
    where lead_id = any(p_lead_ids) or contact_id = any(v_removable_contact_ids)
  );

  insert into public.crm_whatsapp_conversations_archive
  select *, now() from public.crm_whatsapp_conversations
  where lead_id = any(p_lead_ids) or contact_id = any(v_removable_contact_ids);

  insert into public.crm_deals_archive
  select *, now() from public.crm_deals where id = any(v_deal_ids);

  insert into public.crm_contacts_archive
  select *, now() from public.crm_contacts where id = any(v_removable_contact_ids);

  insert into public.crm_accounts_archive
  select *, now() from public.crm_accounts where id = any(v_removable_account_ids);

  insert into public.crm_leads_archive
  select *, now() from public.crm_leads where id = any(p_lead_ids);

  -- 2b. Delete, dependents first. crm_activities/crm_call_logs/
  -- crm_whatsapp_* rows pointing at a removed lead/deal/account/contact
  -- are already covered by "on delete cascade"/"on delete set null" once
  -- their parent is deleted below, but they are deleted explicitly here
  -- too so the counts returned are accurate and so a row that points at,
  -- say, a removable account via account_id but not via any removed lead
  -- is still caught.
  delete from public.crm_whatsapp_messages
  where conversation_id in (
    select id from public.crm_whatsapp_conversations
    where lead_id = any(p_lead_ids) or contact_id = any(v_removable_contact_ids)
  );
  get diagnostics v_whatsapp_messages_deleted = row_count;

  delete from public.crm_whatsapp_conversations
  where lead_id = any(p_lead_ids) or contact_id = any(v_removable_contact_ids);
  get diagnostics v_whatsapp_conversations_deleted = row_count;

  delete from public.crm_call_logs
  where lead_id = any(p_lead_ids)
     or deal_id = any(v_deal_ids)
     or account_id = any(v_removable_account_ids)
     or contact_id = any(v_removable_contact_ids)
     or activity_id in (
       select id from public.crm_activities
       where lead_id = any(p_lead_ids)
          or deal_id = any(v_deal_ids)
          or account_id = any(v_removable_account_ids)
          or contact_id = any(v_removable_contact_ids)
     );
  get diagnostics v_call_logs_deleted = row_count;

  delete from public.crm_activities
  where lead_id = any(p_lead_ids)
     or deal_id = any(v_deal_ids)
     or account_id = any(v_removable_account_ids)
     or contact_id = any(v_removable_contact_ids);
  get diagnostics v_activities_deleted = row_count;

  delete from public.crm_leads where id = any(p_lead_ids);
  get diagnostics v_leads_deleted = row_count;

  delete from public.crm_deals where id = any(v_deal_ids);
  get diagnostics v_deals_deleted = row_count;

  delete from public.crm_contacts where id = any(v_removable_contact_ids);
  get diagnostics v_contacts_deleted = row_count;

  delete from public.crm_accounts where id = any(v_removable_account_ids);
  get diagnostics v_accounts_deleted = row_count;

  return jsonb_build_object(
    'leads_deleted', v_leads_deleted,
    'deals_deleted', v_deals_deleted,
    'accounts_deleted', v_accounts_deleted,
    'contacts_deleted', v_contacts_deleted,
    'activities_deleted', v_activities_deleted,
    'call_logs_deleted', v_call_logs_deleted,
    'whatsapp_conversations_deleted', v_whatsapp_conversations_deleted,
    'whatsapp_messages_deleted', v_whatsapp_messages_deleted
  );
end;
$$;

-- SECURITY: remove_crm_leads is security definer and does no authorization
-- check of its own (it trusts its caller to have already checked). It must
-- never be callable directly over RPC by an ordinary authenticated user --
-- only through import_crm_leads and delete_crm_lead, which each check
-- crm_can_write()/ownership before calling it. A function this function
-- calls (including one it calls internally, like this one from those two)
-- runs with ITS OWN privilege mode, not the caller's -- so a security
-- definer function calling another security definer function is unaffected
-- by what "authenticated" can or cannot EXECUTE directly; only an RPC call
-- straight from the client is blocked by this revoke. import_crm_leads and
-- delete_crm_lead both call public.remove_crm_leads(...) as a normal
-- function call inside their own function bodies, not via rpc(), so this
-- revoke does not break either of them.
revoke all on function public.remove_crm_leads(uuid[]) from public, anon, authenticated;
grant execute on function public.remove_crm_leads(uuid[]) to service_role;


-- ------------------------------------------------------------
-- 3. import_crm_leads: rule A. Removes EVERY existing lead in the caller's
--    organisation (hand-added and converted included) through
--    remove_crm_leads(), then inserts the new sheet -- all inside this one
--    function call, so it is one transaction: if anything raises, nothing
--    is removed or inserted. Column mapping, any-column import rules and
--    DB-only duplicate detection are unchanged from final_fix.sql.
-- ------------------------------------------------------------

create or replace function public.import_crm_leads(p_file_name text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_me uuid := public.current_employee_id();
  v_all_lead_ids uuid[];
  v_removal jsonb := '{}'::jsonb;
  v_row jsonb;
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

  -- Rule A: an import replaces ALL leads, not just the previous batch.
  select coalesce(array_agg(id), array[]::uuid[]) into v_all_lead_ids
  from public.crm_leads
  where organization_id = v_org;

  if array_length(v_all_lead_ids, 1) is not null then
    v_removal := public.remove_crm_leads(v_all_lead_ids);
  end if;

  insert into public.crm_import_batches (organization_id, uploaded_by, owner_id, file_name, total_rows, status)
  values (v_org, v_me, v_me, p_file_name, jsonb_array_length(p_rows), 'processing')
  returning id into v_batch_id;

  -- Every lead in the org was just removed by remove_crm_leads() above, so
  -- there is nothing left in the database to duplicate-check against, and
  -- the client no longer filters duplicate rows out of the same sheet
  -- before sending them (see final_fix.sql's own comment on this). Every
  -- row of the sheet is imported; duplicate_count is always 0, but the key
  -- is kept in the returned JSON so the caller does not need to change.
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
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
      case when v_row->>'listing_rating' ~ '^[0-9.]+$' then (v_row->>'listing_rating')::numeric else null end,
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
    'deleted_count', coalesce((v_removal->>'leads_deleted')::int, 0)
  );
end;
$$;

revoke all on function public.import_crm_leads(text, jsonb) from public, anon;
grant execute on function public.import_crm_leads(text, jsonb) to authenticated, service_role;


-- ------------------------------------------------------------
-- 4. Trash icon (single lead): wraps remove_crm_leads() with the same
--    ownership check already enforced by RLS on a plain delete, so the
--    permission behaviour the UI already relies on (crmService.ts's
--    "You can only delete CRM records you own." message) is unchanged.
-- ------------------------------------------------------------

create or replace function public.delete_crm_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead public.crm_leads%rowtype;
begin
  select * into v_lead from public.crm_leads where id = p_lead_id;
  if not found then
    raise exception 'Lead not found.';
  end if;
  if not public.crm_can_write()
     or (v_lead.owner_id <> public.current_employee_id() and not public.crm_can_manage_all())
  then
    raise exception 'You can only delete CRM records you own.';
  end if;
  return public.remove_crm_leads(array[p_lead_id]);
end;
$$;

revoke all on function public.delete_crm_lead(uuid) from public, anon;
grant execute on function public.delete_crm_lead(uuid) to authenticated, service_role;


-- ------------------------------------------------------------
-- 5. Stop relying on archived_at for hiding. No list query in this project
--    (leads()/deals()/accounts()/contacts()/activities() in
--    crmService.ts) ever filtered on an archived_at column -- that
--    filtering was never actually wired into the live code despite the
--    "final_fix_3" name implying it was. This section is a guard, not a
--    fix: it drops any such filter from EVERY view in public that still
--    references a column named archived_at on a crm_* table, so that if a
--    hide-by-archived_at view was created directly in the SQL editor
--    outside this codebase's tracked files, it stops filtering too. The
--    archived_at column itself (on crm_leads_archive etc., created in
--    section 1 of this file) is never dropped.
-- ------------------------------------------------------------

do $$
declare
  v record;
begin
  for v in
    select n.nspname as schema_name, c.relname as view_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'v'
      and n.nspname = 'public'
      and c.relname like 'crm_%'
      and pg_get_viewdef(c.oid) ilike '%archived_at%'
  loop
    raise notice 'View %.% still references archived_at -- review manually, not dropped automatically.', v.schema_name, v.view_name;
  end loop;
end $$;


-- ------------------------------------------------------------
-- 6. ONE-TIME CLEANUP: Rahul Sharma / Sunrise Clinic, plus any already-
--    orphaned leftovers from leads deleted before this file existed.
--    Matches by exact name, applies rule B's safety check through
--    remove_crm_leads() itself (no separate safety logic needed here).
-- ------------------------------------------------------------

do $$
declare
  v_rahul_lead_id uuid;
  v_result jsonb;
begin
  select id into v_rahul_lead_id
  from public.crm_leads
  where first_name = 'Rahul' and last_name = 'Sharma' and company = 'Sunrise Clinic'
  limit 1;

  if v_rahul_lead_id is not null then
    v_result := public.remove_crm_leads(array[v_rahul_lead_id]);
    raise notice 'Rahul Sharma / Sunrise Clinic cleanup: %', v_result;
  else
    raise notice 'Rahul Sharma / Sunrise Clinic: no matching lead row found (already removed or never present).';
  end if;
end $$;

-- By-name cleanup for the case the lead row is ALREADY gone (deleted with
-- the old trash icon before this file's delete_crm_lead existed), so the
-- block above found no lead to pass to remove_crm_leads() and did nothing
-- -- but his account "Sunrise Clinic", contact "Rahul Sharma" and deal
-- "Sunrise Clinic" are not orphans (nothing points at them that no longer
-- exists; their old lead simply never cleaned them up), so the orphan
-- cleanup below this block would not touch them either. Matches by exact
-- name only; does not touch any other deal/account/contact. Archives, then
-- removes, applying rule B's safety check by hand since remove_crm_leads()
-- only accepts lead ids and these rows no longer have a lead pointing at
-- them to pass it.
do $$
declare
  v_deal_ids uuid[];
  v_contact_ids uuid[];
  v_account_ids uuid[];
  v_removable_contact_ids uuid[];
  v_removable_account_ids uuid[];
  v_activity_count int;
  v_call_log_count int;
  v_whatsapp_conversation_count int;
  v_whatsapp_message_count int;
  v_deals_removed int := 0;
  v_contacts_removed int := 0;
  v_accounts_removed int := 0;
begin
  select coalesce(array_agg(id), array[]::uuid[]) into v_deal_ids
  from public.crm_deals where name = 'Sunrise Clinic';

  select coalesce(array_agg(id), array[]::uuid[]) into v_contact_ids
  from public.crm_contacts where first_name = 'Rahul' and last_name = 'Sharma';

  select coalesce(array_agg(id), array[]::uuid[]) into v_account_ids
  from public.crm_accounts where name = 'Sunrise Clinic';

  select count(*) into v_activity_count from public.crm_activities
  where deal_id = any(v_deal_ids) or contact_id = any(v_contact_ids) or account_id = any(v_account_ids);
  select count(*) into v_call_log_count from public.crm_call_logs
  where deal_id = any(v_deal_ids) or contact_id = any(v_contact_ids) or account_id = any(v_account_ids);
  select count(*) into v_whatsapp_conversation_count from public.crm_whatsapp_conversations
  where contact_id = any(v_contact_ids);
  select count(*) into v_whatsapp_message_count from public.crm_whatsapp_messages
  where conversation_id in (
    select id from public.crm_whatsapp_conversations where contact_id = any(v_contact_ids)
  );

  raise notice 'By-name Rahul Sharma / Sunrise Clinic leftovers found: % deal(s) named "Sunrise Clinic", % contact(s) named Rahul Sharma, % account(s) named "Sunrise Clinic", % activity/activities, % call log(s), % whatsapp conversation(s), % whatsapp message(s).',
    coalesce(array_length(v_deal_ids, 1), 0), coalesce(array_length(v_contact_ids, 1), 0),
    coalesce(array_length(v_account_ids, 1), 0), v_activity_count, v_call_log_count,
    v_whatsapp_conversation_count, v_whatsapp_message_count;

  -- Safety check (rule B): only remove a contact/account if no remaining
  -- lead, deal or contact (outside this same by-name set) still references
  -- it.
  select coalesce(array_agg(c.id), array[]::uuid[]) into v_removable_contact_ids
  from unnest(v_contact_ids) c(id)
  where not exists (
    select 1 from public.crm_leads l where l.converted_contact_id = c.id
  )
  and not exists (
    select 1 from public.crm_deals d where d.contact_id = c.id and not (d.id = any(v_deal_ids))
  );

  select coalesce(array_agg(a.id), array[]::uuid[]) into v_removable_account_ids
  from unnest(v_account_ids) a(id)
  where not exists (
    select 1 from public.crm_leads l where l.converted_account_id = a.id
  )
  and not exists (
    select 1 from public.crm_deals d where d.account_id = a.id and not (d.id = any(v_deal_ids))
  )
  and not exists (
    select 1 from public.crm_contacts c where c.account_id = a.id and not (c.id = any(v_removable_contact_ids))
  );

  if coalesce(array_length(v_deal_ids, 1), 0) > 0
     or coalesce(array_length(v_removable_contact_ids, 1), 0) > 0
     or coalesce(array_length(v_removable_account_ids, 1), 0) > 0 then

    insert into public.crm_activities_archive
    select *, now() from public.crm_activities
    where deal_id = any(v_deal_ids) or contact_id = any(v_removable_contact_ids) or account_id = any(v_removable_account_ids);

    insert into public.crm_call_logs_archive
    select *, now() from public.crm_call_logs
    where deal_id = any(v_deal_ids) or contact_id = any(v_removable_contact_ids) or account_id = any(v_removable_account_ids)
       or activity_id in (
         select id from public.crm_activities
         where deal_id = any(v_deal_ids) or contact_id = any(v_removable_contact_ids) or account_id = any(v_removable_account_ids)
       );

    insert into public.crm_whatsapp_messages_archive
    select m.*, now() from public.crm_whatsapp_messages m
    where m.conversation_id in (
      select id from public.crm_whatsapp_conversations where contact_id = any(v_removable_contact_ids)
    );

    insert into public.crm_whatsapp_conversations_archive
    select *, now() from public.crm_whatsapp_conversations where contact_id = any(v_removable_contact_ids);

    insert into public.crm_deals_archive
    select *, now() from public.crm_deals where id = any(v_deal_ids);

    insert into public.crm_contacts_archive
    select *, now() from public.crm_contacts where id = any(v_removable_contact_ids);

    insert into public.crm_accounts_archive
    select *, now() from public.crm_accounts where id = any(v_removable_account_ids);

    delete from public.crm_whatsapp_messages
    where conversation_id in (
      select id from public.crm_whatsapp_conversations where contact_id = any(v_removable_contact_ids)
    );
    delete from public.crm_whatsapp_conversations where contact_id = any(v_removable_contact_ids);
    delete from public.crm_call_logs
    where deal_id = any(v_deal_ids) or contact_id = any(v_removable_contact_ids) or account_id = any(v_removable_account_ids)
       or activity_id in (
         select id from public.crm_activities
         where deal_id = any(v_deal_ids) or contact_id = any(v_removable_contact_ids) or account_id = any(v_removable_account_ids)
       );
    delete from public.crm_activities
    where deal_id = any(v_deal_ids) or contact_id = any(v_removable_contact_ids) or account_id = any(v_removable_account_ids);

    delete from public.crm_deals where id = any(v_deal_ids);
    get diagnostics v_deals_removed = row_count;
    delete from public.crm_contacts where id = any(v_removable_contact_ids);
    get diagnostics v_contacts_removed = row_count;
    delete from public.crm_accounts where id = any(v_removable_account_ids);
    get diagnostics v_accounts_removed = row_count;

    raise notice 'By-name Rahul Sharma / Sunrise Clinic leftovers removed: % deal(s), % contact(s), % account(s) (archived first).',
      v_deals_removed, v_contacts_removed, v_accounts_removed;
  else
    raise notice 'By-name Rahul Sharma / Sunrise Clinic leftovers: nothing matched by exact name, or everything found is still referenced elsewhere -- nothing removed.';
  end if;
end $$;

-- Leftovers of leads that were ALREADY deleted (e.g. before this file
-- existed), where the lead row is gone but dependents were left behind
-- by the old plain "delete from crm_leads" path: an activity/call log/
-- WhatsApp row whose lead_id is set but no longer matches any crm_leads
-- row, and a deal/account/contact that some NOW-GONE lead's
-- converted_deal_id/converted_account_id/converted_contact_id used to
-- point at but which no remaining lead, deal or contact still references.
-- (crm_activities.lead_id/deal_id/account_id/contact_id normally cannot
-- outlive their parent going forward, thanks to "on delete cascade" --
-- this only matches rows left behind by deletes that ran before that
-- constraint existed, or through a path that bypassed it.)
do $$
declare
  v_orphan_activities int;
  v_orphan_call_logs int;
  v_orphan_whatsapp_conversations int;
  v_orphan_whatsapp_messages int;
begin
  insert into public.crm_activities_archive
  select a.*, now() from public.crm_activities a
  where (a.lead_id is not null and not exists (select 1 from public.crm_leads l where l.id = a.lead_id))
     or (a.deal_id is not null and not exists (select 1 from public.crm_deals d where d.id = a.deal_id))
     or (a.account_id is not null and not exists (select 1 from public.crm_accounts acc where acc.id = a.account_id))
     or (a.contact_id is not null and not exists (select 1 from public.crm_contacts c where c.id = a.contact_id));

  insert into public.crm_call_logs_archive
  select cl.*, now() from public.crm_call_logs cl
  where (cl.lead_id is not null and not exists (select 1 from public.crm_leads l where l.id = cl.lead_id))
     or (cl.deal_id is not null and not exists (select 1 from public.crm_deals d where d.id = cl.deal_id))
     or (cl.account_id is not null and not exists (select 1 from public.crm_accounts acc where acc.id = cl.account_id))
     or (cl.contact_id is not null and not exists (select 1 from public.crm_contacts c where c.id = cl.contact_id))
     or (cl.activity_id is not null and not exists (select 1 from public.crm_activities act where act.id = cl.activity_id));

  insert into public.crm_whatsapp_conversations_archive
  select wc.*, now() from public.crm_whatsapp_conversations wc
  where (wc.lead_id is not null and not exists (select 1 from public.crm_leads l where l.id = wc.lead_id))
     or (wc.contact_id is not null and not exists (select 1 from public.crm_contacts c where c.id = wc.contact_id));

  insert into public.crm_whatsapp_messages_archive
  select wm.*, now() from public.crm_whatsapp_messages wm
  where wm.conversation_id is not null
    and not exists (select 1 from public.crm_whatsapp_conversations wc where wc.id = wm.conversation_id);

  delete from public.crm_whatsapp_messages
  where conversation_id is not null
    and not exists (select 1 from public.crm_whatsapp_conversations wc where wc.id = conversation_id);
  get diagnostics v_orphan_whatsapp_messages = row_count;

  delete from public.crm_whatsapp_conversations
  where (lead_id is not null and not exists (select 1 from public.crm_leads l where l.id = lead_id))
     or (contact_id is not null and not exists (select 1 from public.crm_contacts c where c.id = contact_id));
  get diagnostics v_orphan_whatsapp_conversations = row_count;

  delete from public.crm_call_logs
  where (lead_id is not null and not exists (select 1 from public.crm_leads l where l.id = lead_id))
     or (deal_id is not null and not exists (select 1 from public.crm_deals d where d.id = deal_id))
     or (account_id is not null and not exists (select 1 from public.crm_accounts acc where acc.id = account_id))
     or (contact_id is not null and not exists (select 1 from public.crm_contacts c where c.id = contact_id))
     or (activity_id is not null and not exists (select 1 from public.crm_activities act where act.id = activity_id));
  get diagnostics v_orphan_call_logs = row_count;

  delete from public.crm_activities
  where (lead_id is not null and not exists (select 1 from public.crm_leads l where l.id = lead_id))
     or (deal_id is not null and not exists (select 1 from public.crm_deals d where d.id = deal_id))
     or (account_id is not null and not exists (select 1 from public.crm_accounts acc where acc.id = account_id))
     or (contact_id is not null and not exists (select 1 from public.crm_contacts c where c.id = contact_id));
  get diagnostics v_orphan_activities = row_count;

  raise notice 'Pre-existing orphan cleanup: % activities, % call logs, % whatsapp conversations, % whatsapp messages removed (archived first).',
    v_orphan_activities, v_orphan_call_logs, v_orphan_whatsapp_conversations, v_orphan_whatsapp_messages;
end $$;


-- ------------------------------------------------------------
-- 7. Review-only SELECTs (no deletes). Run these any time to see what, if
--    anything, is currently orphaned.
-- ------------------------------------------------------------

-- Accounts created from a lead that no longer exists (converted_account_id
-- used to point here from some lead that is now gone).
select a.*
from public.crm_accounts a
where exists (
  select 1 from public.crm_leads_archive la where la.converted_account_id = a.id
)
and not exists (
  select 1 from public.crm_leads l where l.converted_account_id = a.id
);

-- Contacts created from a lead that no longer exists.
select c.*
from public.crm_contacts c
where exists (
  select 1 from public.crm_leads_archive la where la.converted_contact_id = c.id
)
and not exists (
  select 1 from public.crm_leads l where l.converted_contact_id = c.id
);

-- Deals created from a lead that no longer exists.
select d.*
from public.crm_deals d
where exists (
  select 1 from public.crm_leads_archive la where la.converted_deal_id = d.id
)
and not exists (
  select 1 from public.crm_leads l where l.converted_deal_id = d.id
);

-- Activities whose lead/deal/contact/account no longer exists.
select a.*
from public.crm_activities a
where (a.lead_id is not null and not exists (select 1 from public.crm_leads l where l.id = a.lead_id))
   or (a.deal_id is not null and not exists (select 1 from public.crm_deals d where d.id = a.deal_id))
   or (a.account_id is not null and not exists (select 1 from public.crm_accounts acc where acc.id = a.account_id))
   or (a.contact_id is not null and not exists (select 1 from public.crm_contacts c where c.id = a.contact_id));

-- Call logs whose lead/deal/contact/account/activity no longer exists.
select cl.*
from public.crm_call_logs cl
where (cl.lead_id is not null and not exists (select 1 from public.crm_leads l where l.id = cl.lead_id))
   or (cl.deal_id is not null and not exists (select 1 from public.crm_deals d where d.id = cl.deal_id))
   or (cl.account_id is not null and not exists (select 1 from public.crm_accounts acc where acc.id = cl.account_id))
   or (cl.contact_id is not null and not exists (select 1 from public.crm_contacts c where c.id = cl.contact_id))
   or (cl.activity_id is not null and not exists (select 1 from public.crm_activities act where act.id = cl.activity_id));

-- WhatsApp conversations whose lead/contact no longer exists.
select wc.*
from public.crm_whatsapp_conversations wc
where (wc.lead_id is not null and not exists (select 1 from public.crm_leads l where l.id = wc.lead_id))
   or (wc.contact_id is not null and not exists (select 1 from public.crm_contacts c where c.id = wc.contact_id));

-- WhatsApp messages whose conversation no longer exists.
select wm.*
from public.crm_whatsapp_messages wm
where wm.conversation_id is not null
  and not exists (select 1 from public.crm_whatsapp_conversations wc where wc.id = wm.conversation_id);


notify pgrst, 'reload schema';
