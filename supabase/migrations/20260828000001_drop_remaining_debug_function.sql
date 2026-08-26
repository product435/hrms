-- Cleanup: debug_perf_schema_audit was the original diagnostic function from
-- an earlier debugging session (superseded by debug_schema_audit, which was
-- already dropped in 20260827000005). It was never callable-only-by-admin --
-- any authenticated user could see RLS policy internals for performance_reviews.
drop function if exists public.debug_perf_schema_audit();
