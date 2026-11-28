-- My Goals: employee self-status update (including Completed) + an
-- Admin/HR delete action, with safe, explicit authorization and no
-- reliance on RLS alone for either.
--
-- CONTEXT / WHY A NEW RPC IS NEEDED FOR STATUS:
-- submit_goal_progress (supabase/fix_submit_goal_progress_live.sql, the
-- live, authoritative definition) is currently the ONLY self-edit path an
-- employee has for their own goal, and it deliberately NEVER touches
-- status -- its own comments in growth_module_fix.sql explain this was a
-- considered decision: "reaching 100% progress is self-reported, not
-- manager-verified completion... only review_goal() can [mark
-- completed]." This task explicitly asks to change that: an employee
-- must now be able to set their own goal's status directly, including
-- Completed. That is a real, acknowledged policy change from the earlier
-- decision, not an oversight -- flagged here in case you want to revisit
-- it later, but implemented as asked.
--
-- 20261125120000_drop_legacy_leave_goals_update_policies.sql separately
-- closed a loophole where a lead could change a goal's status via a raw
-- RLS UPDATE policy, bypassing review_goal()'s required-reason rule. This
-- migration does not reopen that: the Admin/HR "status pencil" in the UI
-- opens the EXISTING review_goal()-backed Review dialog (no new RPC for
-- that side), so review_goal() remains the only way a reviewer changes a
-- goal's status, same as before this migration.
--
-- submit_own_goal_status below is deliberately narrow: it is the ONLY new
-- write path this migration adds, it only ever touches employee_id's OWN
-- goal, it only ever writes to "status" and (same rule review_goal()
-- already uses -- completion and 100% progress can never disagree)
-- "progress" when the new status is 'completed'. It never touches
-- title/description/target/due_date/weight/kra_id/manager_review_reason/
-- reviewed_by/reviewed_at, and it does NOT write updated_at: an earlier
-- live-verified file (fix_submit_goal_progress_live.sql) found the live
-- goals table has no updated_at column, despite an older migration
-- (20260818000000_kinetix_hrms.sql) having created one -- this function
-- is written to match the confirmed-live shape, not the older migration.
--
-- DELETE SAFETY (delete_goal below):
-- No table in this codebase's SQL (migrations, growth_module_fix.sql,
-- final_fix_*.sql) has a foreign key pointing AT public.goals -- goals
-- only ever points outward (kra_id -> kra_templates). So deleting a goal
-- row cannot structurally orphan a KRA/KPI/performance-cycle record by
-- design; nothing references it. delete_goal() re-confirms this at
-- runtime (via information_schema) immediately before deleting, rather
-- than assuming it forever, and raises instead of deleting if that ever
-- stops being true -- so a schema change later that adds such a
-- reference fails loudly instead of silently cascading.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

create or replace function public.submit_own_goal_status(
  p_goal_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_current_status text;
begin
  if public.current_employee_id() is null then
    raise exception 'Your employee profile is not linked.';
  end if;

  if p_status not in ('on-track', 'at-risk', 'delayed', 'completed') then
    raise exception 'Status must be on-track, at-risk, delayed, or completed.';
  end if;

  select employee_id, status
    into v_employee_id, v_current_status
  from public.goals
  where id = p_goal_id;

  if v_employee_id is null then
    raise exception 'Goal not found.';
  end if;
  if v_employee_id <> public.current_employee_id() then
    raise exception 'You can only change the status of your own goal.';
  end if;
  if v_current_status = 'completed' then
    raise exception 'This goal has been marked completed by a reviewer and can no longer be updated directly. Ask your reviewer to reopen it.';
  end if;

  -- Same rule review_goal() already enforces: completion and 100%
  -- progress can never disagree, so a self-completed goal's progress is
  -- forced to 100 too, not left at whatever partial value it last had.
  update public.goals
  set status = p_status,
      progress = case when p_status = 'completed' then 100 else progress end
  where id = p_goal_id;
end;
$$;

revoke all on function public.submit_own_goal_status(uuid, text) from public, anon;
grant execute on function public.submit_own_goal_status(uuid, text) to authenticated, service_role;


create or replace function public.delete_goal(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_title text;
  v_referencing_count int;
begin
  if not (
    public.current_user_role() in ('admin', 'hr')
    or public.can_manage_employee((select employee_id from public.goals where id = p_goal_id))
  ) then
    raise exception 'Only an authorized manager, admin, or HR can delete this goal.';
  end if;

  select employee_id, title into v_employee_id, v_title
  from public.goals
  where id = p_goal_id;

  if v_employee_id is null then
    raise exception 'Goal not found.';
  end if;

  -- Defensive, not assumed: re-confirm at the moment of deletion that no
  -- table has a foreign key pointing at goals, so a future schema change
  -- that adds one fails this with a clear error instead of silently
  -- cascading or violating a constraint.
  select count(*) into v_referencing_count
  from information_schema.table_constraints tc
  join information_schema.constraint_column_usage ccu
    on tc.constraint_name = ccu.constraint_name
  where tc.constraint_type = 'FOREIGN KEY'
    and ccu.table_name = 'goals';

  if v_referencing_count > 0 then
    raise exception 'Cannot delete: another table now references goals. Update delete_goal() to handle it explicitly before deleting.';
  end if;

  delete from public.goals where id = p_goal_id;
end;
$$;

revoke all on function public.delete_goal(uuid) from public, anon;
grant execute on function public.delete_goal(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
