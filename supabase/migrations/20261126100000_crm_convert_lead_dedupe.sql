-- Lead conversion duplicate-account/contact fix.
--
-- Confirmed bug (Phase 0 audit): convert_crm_lead() already accepts
-- p_existing_account_id to reuse an account instead of creating one, but
-- the frontend never surfaces it, and there is no equivalent parameter for
-- contacts at all -- every conversion unconditionally inserts a brand new
-- crm_contacts row. Converting two leads from the same company (or the
-- same person) without manually knowing to pass p_existing_account_id
-- creates duplicate accounts and duplicate contacts every time.
--
-- Fix: add p_existing_contact_id, mirroring p_existing_account_id exactly
-- (same found/not-found check, same "null means create one" default).
-- This function still never GUESSES a match on its own -- it only reuses
-- what the caller explicitly passed. The actual matching/suggestion logic
-- (by normalized company name for accounts, by email or phone for
-- contacts) lives in the frontend (crmService.ts's new
-- findMatchingAccounts()/findMatchingContacts(), both plain SELECTs --
-- crm_accounts_select/crm_contacts_select policies are already org-wide
-- for has_crm_access(), not owner-scoped, so no new RPC or RLS change is
-- needed for the lookup itself) and the Convert dialog, which shows the
-- match to the user and lets them choose "use existing" or "create new"
-- for the account and the contact independently -- never merged
-- automatically without the user seeing and confirming it.
--
-- Everything else in this function -- the deal creation, the lead status
-- update, moving open activities onto the new records -- is unchanged,
-- byte-for-byte, from the live 20261102110000_sales_crm.sql version.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

create or replace function public.convert_crm_lead(
  p_lead_id uuid,
  p_create_deal boolean default true,
  p_deal_name text default null,
  p_deal_amount numeric default null,
  p_existing_account_id uuid default null,
  p_existing_contact_id uuid default null
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

  if p_existing_contact_id is not null then
    select id into v_contact from public.crm_contacts where id = p_existing_contact_id;
    if v_contact is null then
      raise exception 'Contact not found.';
    end if;
    -- An existing contact picked up by this conversion should still be
    -- linked to the account this conversion resolved to, if it wasn't
    -- already linked to a different one -- never silently reassigns a
    -- contact away from an account it already belongs to.
    update public.crm_contacts
    set account_id = v_account
    where id = v_contact and account_id is null;
  else
    insert into public.crm_contacts (account_id, first_name, last_name, email, phone, job_title, owner_id)
    values (v_account, v_lead.first_name, v_lead.last_name, v_lead.email, v_lead.phone, v_lead.job_title, v_lead.owner_id)
    returning id into v_contact;
  end if;

  if coalesce(p_create_deal, true) then
    insert into public.crm_deals (name, account_id, contact_id, amount, stage, probability, owner_id)
    values (
      coalesce(
        nullif(btrim(p_deal_name), ''),
        coalesce(nullif(btrim(v_lead.company), ''), v_lead.first_name) || ' deal'
      ),
      v_account,
      v_contact,
      coalesce(p_deal_amount, v_lead.estimated_value, 0),
      'qualification',
      20,
      v_lead.owner_id
    )
    returning id into v_deal;
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
