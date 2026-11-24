-- LIVE CORRECTION — submit_goal_progress
--
-- Prepared 2026-11-20. DO NOT execute automatically.
--
-- Read-only verification against the live goals row titled "test" confirmed
-- these columns exist: employee_id, status, progress, progress_remarks,
-- organization_id, kra_id, manager_review_reason, reviewed_by, reviewed_at.
-- The table has NO updated_at (or other general timestamp) column.
--
-- This is a complete replacement for the deployed Revision 5 function. It
-- preserves its exact three-argument RPC contract and every access/business
-- rule; the only operational change is removing the invalid updated_at write.

create or replace function public.submit_goal_progress(
  p_goal_id uuid,
  p_progress integer default null,
  p_remarks text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_status text;
  v_clamped integer;
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
    raise exception 'You can only update your own goal.';
  end if;
  if v_status = 'completed' then
    raise exception 'This goal has been marked completed by a reviewer and can no longer be updated directly. Ask your reviewer to reopen it.';
  end if;

  if p_progress is not null then
    v_clamped := greatest(0, least(100, p_progress));
  else
    v_clamped := null;
  end if;

  update public.goals
  set progress = coalesce(v_clamped, progress),
      progress_remarks = coalesce(p_remarks, progress_remarks)
  where id = p_goal_id;
end;
$$;

-- Preserve Revision 5's authenticated-only execution boundary.
revoke all on function public.submit_goal_progress(uuid, integer, text) from public, anon;
grant execute on function public.submit_goal_progress(uuid, integer, text) to authenticated, service_role;

-- Required for PostgREST to immediately refresh the RPC definition.
notify pgrst, 'reload schema';
