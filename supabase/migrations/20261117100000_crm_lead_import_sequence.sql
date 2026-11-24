-- The crm_before_write trigger forces created_at := now() on every insert
-- (a deliberate write guard -- see 20261102110000_sales_crm.sql), so a bulk
-- import cannot get sheet-ordered rows from created_at alone: every row in
-- one import lands within the same transaction, often the same millisecond,
-- in no guaranteed order. import_sequence is a tiebreak only, set by the
-- import insert itself (the trigger never touches it): 0 for the sheet's
-- first data row, 1 for the second, and so on. Leads added by hand (not
-- imported) leave it null and are ordered purely by created_at, as before.
alter table public.crm_leads
  add column if not exists import_sequence integer;

create index if not exists idx_crm_leads_import_sequence
  on public.crm_leads (import_batch_id, import_sequence);
