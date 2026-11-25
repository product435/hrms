-- New RPC: update_own_goal -- lets an employee edit a self-created goal's
-- Title, Description, Target, Link to KRA (kra_id), Due date and Weight.
--
-- Why a new RPC instead of an RLS self-update policy: goals has NO
-- goals_self_update policy today (confirmed by reading
-- 20260831000001_reconcile_tracked_schema_with_live.sql -- only
-- goals_self_select and goals_self_insert exist for an employee's own
-- row). submit_goal_progress (supabase/fix_submit_goal_progress_live.sql,
-- the live, authoritative definition) is the ONLY existing self-edit path,
-- and it only ever touches progress/progress_remarks. A plain RLS policy
-- would let an employee update ANY column on their own goal, including
-- progress, status, manager_review_reason, reviewed_by, reviewed_at -- the
-- exact history/review fields the task says must never be touched by this
-- feature. This RPC updates only the six requested columns, explicitly,
-- and verifies ownership itself, the same enforcement style already used
-- by submit_goal_progress.
--
-- Rule carried over from submit_goal_progress (same wording, same
-- condition -- "This goal has been marked completed by a reviewer..."):
-- editing is blocked once status = 'completed'. This is NOT a new
-- behavior decision; it is the existing rule for ANY employee self-edit of
-- their own goal, applied consistently here too, since leaving this RPC
-- without that guard while submit_goal_progress has it would be an
-- inconsistent, easier-to-use bypass of the same protection.
--
-- Never touches progress, status, manager_review_reason, reviewed_by or
-- reviewed_at -- editing never resets progress or review history, and
-- "Overdue" (a pure frontend-computed label: status != 'completed' AND
-- due_date < today, never stored) simply stops showing once a moved due
-- date is in the future -- nothing else to change for that.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it, and only
-- after you've confirmed the "already reviewed" behavior below is what
-- you want.

create or replace function public.update_own_goal(
  p_goal_id uuid,
  p_title text,
  p_description text default null,
  p_target text default null,
  p_due_date date default null,
  p_weight numeric default null,
  p_kra_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_status text;
  v_title text;
begin
  if public.current_employee_id() is null then
    raise exception 'Your employee profile is not linked.';
  end if;

  select employee_id, status
    into v_employee_id, v_status
  from public.goals
  where id = p_goal_id;

  if v_employee_id is null then
    raise exception 'Goal not found.';
  end if;
  if v_employee_id <> public.current_employee_id() then
    raise exception 'You can only edit your own goal.';
  end if;
  if v_status = 'completed' then
    raise exception 'This goal has been marked completed by a reviewer and can no longer be updated directly. Ask your reviewer to reopen it.';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then
    raise exception 'Goal title is required.';
  end if;

  if p_weight is not null and (p_weight < 0 or p_weight > 100) then
    raise exception 'Weight must be between 0 and 100.';
  end if;

  update public.goals
  set title = v_title,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      target = nullif(btrim(coalesce(p_target, '')), ''),
      due_date = p_due_date,
      weight = coalesce(p_weight, weight),
      kra_id = p_kra_id
  where id = p_goal_id;
end;
$$;

revoke all on function public.update_own_goal(uuid, text, text, text, date, numeric, uuid) from public, anon;
grant execute on function public.update_own_goal(uuid, text, text, text, date, numeric, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
