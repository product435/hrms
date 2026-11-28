-- Hand-added leads follow their sheet: when the same sheet is imported again,
-- they become part of the new batch. No lead is deleted by this script.

-- 1. After a successful import, move that sheet's hand-added leads to the new batch.
create or replace function public.crm_reattach_hand_added_leads()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and coalesce(new.inserted_count, 0) > 0 then
    update public.crm_leads
       set active_batch_id = new.id
     where organization_id = new.organization_id
       and owner_id = new.owner_id
       and import_batch_id is null
       and sheet_key = public.crm_normalize_sheet_key(new.file_name);
  end if;
  return new;
end $$;

drop trigger if exists crm_import_batches_reattach on public.crm_import_batches;
create trigger crm_import_batches_reattach
  after update on public.crm_import_batches
  for each row execute function public.crm_reattach_hand_added_leads();

-- 2. A new lead takes the sheet name of the owner's OWN last successful import
--    (before: the last import by anyone in the company).
create or replace function public.crm_leads_stamp_sheet_key()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if new.import_batch_id is not null or new.sheet_key is not null then
    return new;
  end if;
  v_org := coalesce(new.organization_id, public.current_org_id());
  select public.crm_normalize_sheet_key(file_name) into new.sheet_key
  from public.crm_import_batches
  where organization_id = v_org
    and owner_id = new.owner_id
    and coalesce(inserted_count, 0) > 0
  order by created_at desc
  limit 1;
  return new;
end $$;