-- Fix: ambiguous convert_crm_lead() overload.
--
-- Root cause (confirmed by inspecting migration history + the live error):
--   1. 20261102110000_sales_crm.sql originally defined convert_crm_lead with
--      5 params (p_lead_id, p_create_deal, p_deal_name, p_deal_amount,
--      p_existing_account_id).
--   2. final_fix_7.sql (a loose root-level file, already applied live --
--      it ends with `notify pgrst, 'reload schema'`) safely REPLACED that
--      same 5-param function (identical signature, so `create or replace`
--      correctly replaced it in place) to fix deal-default and
--      silently-missing-deal bugs. Still 5 params, still one function.
--   3. 20261126100000_crm_convert_lead_dedupe.sql (a drafted, unapplied
--      migration) adds a 6th parameter, p_existing_contact_id, to let a
--      conversion reuse an existing contact (not just an existing
--      account). Because it changes the parameter list, `create or
--      replace function` does NOT replace the 5-param function -- Postgres
--      creates a SECOND, separate overload instead. Nothing in that draft
--      (or anywhere else) ever drops the old 5-param signature.
--   4. src/services/crmService.ts's convertLead() already calls the RPC
--      with all 6 named parameters, including p_existing_contact_id, which
--      is correct for the INTENDED single 6-param function.
--   5. With both the 5-param and 6-param overloads simultaneously present,
--      PostgREST/Postgres cannot pick one for a named-argument call that
--      could match either (most arguments after p_lead_id have defaults),
--      and reports the function call as ambiguous.
--
-- Fix: explicitly DROP the obsolete 5-param overload, then (re)create the
-- correct 6-param version as the only convert_crm_lead function. The
-- 6-param body is otherwise identical to final_fix_7.sql's live version
-- (same F-4/F-5/F-6 fixes: deal defaults to stage='prospecting'/
-- probability=10 matching the New Deal form; the deal-insert is verified
-- to have actually persisted or the whole conversion rolls back; no
-- cross-lead matching by name/email/phone is ever guessed), with
-- 20261126100000's p_existing_contact_id reuse logic added on top.
-- Grants/security are preserved explicitly (this function was missing its
-- own grant statements in the 20261126100000 draft -- restored here to
-- match the pattern every other version of this function has used).
--
-- Safe to run once. Ends with `notify pgrst, 'reload schema'` so
-- PostgREST immediately picks up the corrected, single signature without
-- waiting for its own schema-cache refresh interval.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

drop function if exists public.convert_crm_lead(uuid, boolean, text, numeric, uuid);

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

  if v_contact is null then
    raise exception 'Failed to create or link the contact for this lead.';
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

revoke all on function public.convert_crm_lead(uuid, boolean, text, numeric, uuid, uuid) from public, anon;
grant execute on function public.convert_crm_lead(uuid, boolean, text, numeric, uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
