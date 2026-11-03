-- Lock the scheduled DWR jobs to the database owner.
--
-- These SECURITY DEFINER functions run from pg_cron as `postgres`. They do not
-- check the caller, and EXECUTE was granted to PUBLIC by default, so anyone
-- holding the public anon key could call them through /rest/v1/rpc/...:
--   mark_missed_dwrs(d)          -> write "missed" reports for every employee on any past date
--   escalate_stale_dwr_reviews() -> escalate pending reviews early
--   remind_dwr_windows()         -> spam reminder notifications
--
-- pg_cron jobs run as the job owner (postgres), which keeps EXECUTE, so the
-- schedules are unaffected. No app code calls these RPCs.

revoke execute on function public.mark_missed_dwrs(date) from public, anon, authenticated;
revoke execute on function public.escalate_stale_dwr_reviews() from public, anon, authenticated;
revoke execute on function public.remind_dwr_windows() from public, anon, authenticated;
