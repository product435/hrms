-- Adds a separate numeric "listing rating" column to crm_leads for the
-- business/listing rating value found in imported spreadsheets (e.g. 4.9,
-- 3.8), distinct from the existing hot/warm/cold sales-priority `rating`
-- column, which is untouched and keeps its current meaning and default.
--
-- "add column if not exists" -- safe to run twice, never drops or rewrites
-- any existing column or data. Nullable with no default, so every lead
-- imported or created before this migration reads as null ("not rated"),
-- never a fabricated 0 or default value.
alter table public.crm_leads
  add column if not exists listing_rating numeric(3, 1)
    check (listing_rating is null or (listing_rating >= 0 and listing_rating <= 5));

comment on column public.crm_leads.listing_rating is
  'Business/listing rating imported from a spreadsheet (e.g. 4.9). Distinct from the hot/warm/cold "rating" sales-priority column.';

notify pgrst, 'reload schema';
