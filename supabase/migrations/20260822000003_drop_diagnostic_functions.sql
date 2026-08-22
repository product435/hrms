-- Remove the temporary read-only diagnostics added in
-- 20260822000000_diagnostic_list_policies.sql and
-- 20260822000001_diagnostic_function_source.sql, now that the RLS audit
-- they supported is done. No app code depends on them.
drop function if exists public.debug_list_policies(text[]);
drop function if exists public.debug_function_source(text);
