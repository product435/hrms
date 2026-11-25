-- Priority 8 (legacy Leave/Goals RLS policies) -- approved change: drop
-- leave_requests_manager_update_team and goals_manager_update_team.
--
-- Both are live RLS UPDATE policies (last defined in
-- 20260926000001_role_hierarchy_access_scope.sql:558-562 and :585-589)
-- that let a lead UPDATE a team member's leave_requests/goals row directly
-- via the Supabase client, bypassing decide_leave_request()/review_goal()'s
-- extra business rules:
--   * no block on approving/reviewing one's own request or goal,
--   * no required reason on rejection,
--   * no forced progress-to-100 when a goal is marked completed.
--
-- Confirmed before writing this file: zero .update() calls on
-- leave_requests or goals anywhere in src/services/leaveService.ts or
-- src/services/talentService.ts -- the normal app UI never uses this
-- path. All real status changes already go through
-- decide_leave_request/cancel_leave_request (leave_requests) and
-- submit_goal_progress/review_goal (goals) RPCs instead. Dropping these
-- two policies closes the bypass with zero effect on the app's actual
-- behavior.
--
-- NOT touched, per the explicit, narrower scope of this decision:
--   * expense_claims_manager_update_team -- same pattern, different
--     module, not part of this approval; left exactly as-is.
--   * leave_requests_manager_view_team / goals_manager_view_team (SELECT)
--     -- unaffected, still needed for leads to see their team's
--     requests/goals in the UI.
--   * decide_leave_request, cancel_leave_request, submit_goal_progress,
--     review_goal -- unchanged; these RPCs remain the only way to change
--     a leave_requests or goals row going forward.
--
-- No existing rows are altered or deleted -- this only removes two policy
-- objects; it never touches table data.
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

drop policy if exists leave_requests_manager_update_team on public.leave_requests;
drop policy if exists goals_manager_update_team on public.goals;

notify pgrst, 'reload schema';
