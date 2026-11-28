-- READ-ONLY. Does not insert, update, delete, or alter anything.
-- Run this in your Supabase SQL editor and paste back the full output
-- of each query below.

-- 1. Real, current columns on goals (to resolve a contradiction: an
--    earlier migration created goals WITH updated_at, but a later "live
--    correction" file says the live table has NO updated_at column).
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'goals'
order by ordinal_position;

-- 2. Every RLS policy currently on goals (select/insert/update/delete),
--    so self-update/self-status and delete permissions are based on what
--    is REALLY enforced, not assumed from a migration file.
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr,
       pg_get_expr(polwithcheck, polrelid) as with_check_expr
from pg_policy
where polrelid = 'public.goals'::regclass;

-- 3. Which of the goal RPCs actually exist live right now, and their
--    real signatures (confirms whether update_own_goal was ever applied,
--    and the true live review_goal/submit_goal_progress bodies).
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('submit_goal_progress', 'review_goal', 'update_own_goal',
                     'delete_goal', 'can_manage_employee', 'current_user_role');

-- 4. Full live source of review_goal (to check for the column mismatch
--    directly, e.g. "updated_at" not existing).
select pg_get_functiondef(oid)
from pg_proc
where proname = 'review_goal' and pronamespace = 'public'::regnamespace;

-- 5. What references a goal, to know what "unsafe cascading deletion"
--    would mean here -- does anything (KRA, KPI, performance-cycle
--    tables) have a foreign key pointing AT goals, which a delete would
--    need to handle explicitly rather than relying on an ON DELETE rule?
select
  tc.table_name as referencing_table,
  kcu.column_name as referencing_column,
  rc.update_rule, rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
join information_schema.constraint_column_usage ccu
  on tc.constraint_name = ccu.constraint_name
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
where tc.constraint_type = 'FOREIGN KEY'
  and ccu.table_name = 'goals';
