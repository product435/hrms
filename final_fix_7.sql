-- ============================================================
-- final_fix_7.sql
--
-- Fixes convert_crm_lead() for audit findings F-4, F-5, F-6.
--
-- F-4 (wrong converted-Deal defaults): the deal this function creates was
-- hardcoded to stage='qualification', probability=20. The New Deal form's
-- own default (dealDraft() in CrmForms.tsx) is stage='prospecting',
-- probability=10. Fixed to match exactly.
--
-- F-5 (deal silently missing during conversion): live data showed 2 of 6
-- converted leads with a real Account and Contact created, but no Deal,
-- and no error shown to the user. Every code path was checked
-- (RPC signature vs. live PostgREST spec, the client call, the checkbox
-- state) and found correct, so the exact original trigger could not be
-- reproduced. What IS true: this function is already fully transactional
-- (a plpgsql function's own body is one implicit transaction -- any
-- unhandled exception rolls back everything the function did, including
-- the account/contact insert), so the only way "account+contact exist,
-- deal doesn't, lead is marked converted" can happen is if v_deal stayed
-- null while the function reached its final UPDATE/RETURN without
-- raising -- i.e. the deal-insert's "returning id into v_deal" either
-- never ran, or ran against a row that didn't actually persist for a
-- reason this insert itself didn't check. This fix makes that
-- structurally impossible going forward: immediately after attempting the
-- deal insert, it explicitly re-selects the deal by its own returned id
-- and RAISES if a deal was requested but is not actually there -- so the
-- whole conversion rolls back (including the account/contact) and the
-- caller gets a real exception, never a false "converted" state with a
-- silently missing deal.
--
-- F-6 (duplicate Accounts/Contacts): tracing the actual data showed the
-- 2 live duplicate Account/Contact pairs ("Apollo Clinic", "Dr. Yadav
-- medicare") belong to TWO DIFFERENT lead rows that happen to share a
-- company name (most likely two leads from two different sheet imports),
-- not the same lead converted twice. A single lead cannot structurally be
-- converted twice: Edit Lead disables the status field once a lead is
-- 'converted' (see LeadDialog in CrmForms.tsx), and this function already
-- raises 'This lead is already converted.' for a retry on the same lead
-- id. Combined with the F-5 fix above (now fully atomic: a conversion
-- either creates Account+Contact+Deal and marks the lead converted, or
-- rolls back every bit of it), a single lead can never end up owning more
-- than one Account/Contact, and a retry of the SAME lead id after a
-- genuine failure safely creates fresh records (nothing was left behind
-- to collide with). This function intentionally does NOT add cross-lead
-- matching by company name, phone, or email: two different real
-- customers can share a company name, and merging unrelated leads into
-- one Account/Contact would be a worse bug than the duplicates it avoids.
-- The 2 existing duplicate records are NOT touched by this file -- no
-- data is created, modified, or deleted; they remain exactly as the audit
-- found them, since no data changes were approved for this fix.
--
-- Safe to run twice ("create or replace function"). No table, column or
-- data is dropped or modified. Ends with "notify pgrst, 'reload schema';".
-- ============================================================

create or replace function public.convert_crm_lead(
  p_lead_id uuid,
  p_create_deal boolean default true,
  p_deal_name text default null,
  p_deal_amount numeric default null,
  p_existing_account_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead public.crm_leads%rowtype;
  v_account uuid;
  v_contact uuid;
  v_deal uuid;
  v_deal_exists boolean;
begin
  select * into v_lead from public.crm_leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found.';
  end if;
  if v_lead.status = 'converted' then
    raise exception 'This lead is already converted.';
  end if;
  if v_lead.status = 'unqualified' then
    raise exception 'Re-qualify this lead before converting it.';
  end if;

  if p_existing_account_id is not null then
    select id into v_account from public.crm_accounts where id = p_existing_account_id;
    if v_account is null then
      raise exception 'Account not found.';
    end if;
  else
    insert into public.crm_accounts (name, email, phone, owner_id)
    values (
      coalesce(
        nullif(btrim(v_lead.company), ''),
        btrim(concat_ws(' ', v_lead.first_name, v_lead.last_name))
      ),
      v_lead.email,
      v_lead.phone,
      v_lead.owner_id
    )
    returning id into v_account;
  end if;

  if v_account is null then
    raise exception 'Failed to create or link the account for this lead.';
  end if;

  insert into public.crm_contacts (account_id, first_name, last_name, email, phone, job_title, owner_id)
  values (v_account, v_lead.first_name, v_lead.last_name, v_lead.email, v_lead.phone, v_lead.job_title, v_lead.owner_id)
  returning id into v_contact;

  if v_contact is null then
    raise exception 'Failed to create the contact for this lead.';
  end if;

  if coalesce(p_create_deal, true) then
    -- F-4: 'prospecting' / probability 10 -- the SAME default the New
    -- Deal form itself uses (dealDraft() in CrmForms.tsx), not a
    -- separate, invented stage.
    insert into public.crm_deals (name, account_id, contact_id, amount, stage, probability, owner_id)
    values (
      coalesce(
        nullif(btrim(p_deal_name), ''),
        coalesce(nullif(btrim(v_lead.company), ''), v_lead.first_name) || ' deal'
      ),
      v_account,
      v_contact,
      coalesce(p_deal_amount, v_lead.estimated_value, 0),
      'prospecting',
      10,
      v_lead.owner_id
    )
    returning id into v_deal;

    -- F-5: never report success with a requested Deal silently missing.
    -- Re-verify the row actually exists (not just that an id was
    -- returned) before proceeding; if not, raise so the ENTIRE
    -- conversion rolls back -- the account/contact created above are
    -- undone too, and the lead is never marked converted. The caller
    -- gets a real exception instead of a false success.
    select exists (select 1 from public.crm_deals where id = v_deal) into v_deal_exists;
    if v_deal is null or not v_deal_exists then
      raise exception 'Failed to create the deal for this lead. The conversion was not completed.';
    end if;
  end if;

  update public.crm_leads
  set status = 'converted',
      converted_at = now(),
      converted_account_id = v_account,
      converted_contact_id = v_contact,
      converted_deal_id = v_deal
  where id = p_lead_id;

  -- Move open lead activities onto the new records.
  update public.crm_activities
  set account_id = coalesce(account_id, v_account),
      contact_id = coalesce(contact_id, v_contact),
      deal_id = coalesce(deal_id, v_deal)
  where lead_id = p_lead_id;

  return jsonb_build_object('account_id', v_account, 'contact_id', v_contact, 'deal_id', v_deal);
end;
$$;

revoke all on function public.convert_crm_lead(uuid, boolean, text, numeric, uuid) from public, anon;
grant execute on function public.convert_crm_lead(uuid, boolean, text, numeric, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
