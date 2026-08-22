-- Remove the temporary read-only diagnostic re-added in
-- 20260822000005_diagnostic_rls_audit.sql, now that the child-table RLS
-- audit it supported is done and verified.
drop function if exists public.debug_list_policies(text[]);
