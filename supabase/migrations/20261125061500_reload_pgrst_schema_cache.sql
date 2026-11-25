-- delete_dwr_report (defined in 20261125055945_dwr_date_mandatory_fields_late_threshold.sql)
-- has not been applied yet, so PostgREST has never seen it; this file adds
-- nothing new, it only tells PostgREST to reload its schema cache once that
-- pending migration (and this one) are applied, in case the cache is stale.
notify pgrst, 'reload schema';
