begin;

alter table public.crm_leads
  add column if not exists active_batch_id uuid references public.crm_import_batches(id) on delete set null;

create index if not exists crm_leads_active_batch_id_idx on public.crm_leads (active_batch_id);

-- One-time backfill for every EXISTING row, computed with the exact same
-- "latest batch per owner" rule the frontend used to infer on the fly, so
-- current data lands in the same visible/hidden state as it already is
-- today -- this backfill does not change what is currently shown, it only
-- makes the current state explicit and durable instead of recomputed.
with latest_batch_per_owner as (
  select distinct on (owner_id) owner_id, import_batch_id, created_at
  from public.crm_leads
  where import_batch_id is not null
  order by owner_id, created_at desc
)
update public.crm_leads l
set active_batch_id = case
  when l.import_batch_id is not null then l.import_batch_id
  else lb.import_batch_id
end
from latest_batch_per_owner lb
where lb.owner_id = l.owner_id
  and l.active_batch_id is distinct from (
    case when l.import_batch_id is not null then l.import_batch_id else lb.import_batch_id end
  );

-- Rows whose owner has an import_batch_id but no prior import at all
-- (owner never imported) are left with active_batch_id null by the
-- default -- correctly "not anchored to any sheet," same as today.
update public.crm_leads l
set active_batch_id = l.import_batch_id
where l.import_batch_id is not null
  and l.active_batch_id is distinct from l.import_batch_id;

-- Keeps active_batch_id correct for every future insert without each
-- caller (import RPC, "New lead" form save) having to compute it itself.
create or replace function public.crm_leads_set_active_batch()
returns trigger
language plpgsql
as $$
declare
  v_latest uuid;
begin
  if new.import_batch_id is not null then
    new.active_batch_id := new.import_batch_id;
    return new;
  end if;

  if new.active_batch_id is null then
    select l.import_batch_id into v_latest
    from public.crm_leads l
    where l.owner_id = new.owner_id and l.import_batch_id is not null
    order by l.created_at desc
    limit 1;
    new.active_batch_id := v_latest;
  end if;

  return new;
end;
$$;

drop trigger if exists crm_leads_set_active_batch_trg on public.crm_leads;
create trigger crm_leads_set_active_batch_trg
  before insert on public.crm_leads
  for each row
  execute function public.crm_leads_set_active_batch();

notify pgrst, 'reload schema';

commit;