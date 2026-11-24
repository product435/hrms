-- ============================================================
-- growth_module_fix.sql (revision 5 -- final one-pass correction)
--
-- Growth module (My Goals / My KRA & KPI / My Performance) fixes.
-- Prepared for review. NOT executed. Safe to run once approved: every
-- object uses "create or replace function" / "add column if not exists".
-- No table, column or row is dropped. Existing rows are only touched by
-- two backfills (goals.organization_id, performance_reviews.
-- organization_id), which each fill a brand-new column that is currently
-- NULL for every row -- a one-time, additive repair of a genuinely
-- missing value, not a change to data the app already depended on.
--
-- Nothing in any earlier revision of this file was ever run (confirmed
-- live, repeatedly, before writing each revision) -- every fix below
-- applies to the SAME unapplied file, not to a change already made.
--
-- Revision 1 -> 2 fixed:
--   1. organization_id was only backfilled on EXISTING rows; nothing set
--      it on a NEW insert, so every goal created after running revision
--      1 would still have gotten organization_id = NULL. Fixed with a
--      BEFORE INSERT trigger (goals_set_organization), mirroring the
--      existing set_updated_at trigger's style used across every other
--      HRMS table.
--   2. create_review_cycle had no duplicate-prevention at all in
--      revision 1.
--   3. submit_goal_progress let an employee edit description/target/
--      due_date on their own goal with no review step -- confirmed (per
--      your explicit decision) this should be narrower: employees edit
--      ONLY progress and remarks themselves. A description/target/
--      due_date change now goes through review_goal() as a reviewer-
--      applied edit (with the existing required-reason rule still
--      covering it), not a raw self-edit.
--   4. review_goal could set status = 'completed' while leaving progress
--      at whatever it already was (e.g. 40%), creating a genuinely
--      inconsistent row. Fixed: setting status to 'completed' through
--      review_goal now also sets progress = 100, so "completed" and
--      "100% progress" can never disagree.
--
-- Revision 2 -> 3 fixed (this revision; points 1/3/4 above are
-- unchanged from revision 2):
--   2 (corrected again). Revision 2's duplicate-prevention used
--      unique(employee_id, review_cycle) -- a BUSINESS LOGIC BUG you
--      caught: that would have permanently blocked the same employee
--      from ever having two reviews with the same cycle NAME in
--      different periods (e.g. "Monthly Performance Review" for both
--      November and December is a completely normal, intended case).
--      Fixed: the uniqueness key is now employee + cycle name + PERIOD
--      (period_start, period_end), using a NULL-safe expression unique
--      index (coalesce() to a sentinel date) so two genuinely duplicate
--      "no period given" rows for the same employee/cycle still collide
--      correctly -- a plain multi-column UNIQUE CONSTRAINT would NOT
--      have caught that case, since Postgres treats every NULL as
--      distinct from every other NULL in an ordinary constraint. This
--      mirrors the exact NULL-safe pattern this codebase already uses
--      for kra_templates_set_name_uidx (20260926000005_kra_kpi.sql).
--      create_review_cycle's "on conflict" clause and the trailing
--      review-only duplicate-finder SELECT were both updated to match.
--
-- Revision 3 -> 4 fixed (this revision -- final pass, task letters A/B/C):
--   A. review_goal() required a reason only when p_status changed, not
--      when description/target/due_date changed with no status change --
--      a reviewer could silently edit a goal's description/target/due
--      date with zero accountability. Fixed: a reason is now required
--      whenever ANY review-controlled field actually changes. Also
--      closed an empty-string bypass: p_description/p_target/p_reason of
--      '' (not NULL) now normalize to "no value" the same as NULL, so a
--      caller can no longer dodge the reason requirement, or blank out
--      an existing description/target, by passing '' instead of
--      omitting the argument.
--   B. submit_self_review/submit_manager_review had NO check at all for
--      an already-finalized (status = 'completed') review -- either
--      side could keep resubmitting and silently overwrite the other's
--      already-finalized rating/feedback indefinitely. Fixed: both RPCs
--      now raise if the review's current status is already 'completed',
--      checked inside the SECURITY DEFINER function itself (not only in
--      the frontend, which already hid the action once a score existed
--      but never enforced it server-side). The intended workflow is
--      unchanged: self submits, manager submits, status becomes
--      'completed' only once both exist -- these RPCs still set that
--      transition themselves; this fix only stops either RPC from
--      running again AFTER that point.
--   C. submit_goal_progress let an employee's own 100%-progress update
--      auto-set status = 'completed' -- i.e. self-reported progress WAS
--      manager-verified completion, which the task says must never be
--      true: "Only an authorized reviewer can mark the goal completed."
--      Fixed: submit_goal_progress no longer touches status in ANY
--      direction (neither completing nor un-completing) -- completion is
--      now exclusively a review_goal() action, which already sets
--      progress to 100 when it does so (unchanged from revision 2).
--      Symmetrically, once a goal IS reviewer-completed,
--      submit_goal_progress now refuses further progress/remarks edits
--      outright ("reopening... must not silently bypass reviewer
--      decisions") -- reopening a completed goal is itself a
--      review_goal() call (setting status to something other than
--      'completed', with the now-mandatory reason).
--
-- Revision 4 -> 5 fixed (this revision -- final one-pass correction,
-- issues 1-4):
--   1. create_review_cycle's duplicate-prevention relied on "ON CONFLICT
--      (coalesce(period_start, ...), coalesce(period_end, ...)) DO
--      NOTHING" inferring against the expression unique index. This
--      cannot be executed to confirm Postgres resolves that inference
--      correctly for an INSERT ... SELECT in this environment. Replaced
--      with a plain, unambiguous "NOT EXISTS" filter using the identical
--      NULL-safe coalesce() comparison -- ordinary SQL, no dependency on
--      expression-index inference. The unique index itself is kept as a
--      hard backstop against a genuine race between two concurrent
--      calls (which would now correctly fail with a unique-violation
--      error instead of silently duplicating).
--   2. submit_self_review/submit_manager_review validated rating range
--      with "p_rating < 0 or p_rating > 5", which evaluates to NULL (not
--      TRUE) when p_rating is NULL -- so a NULL rating silently passed
--      validation and would have been written to self_rating/
--      manager_rating (and corrupted final_rating's average). Fixed:
--      both RPCs now explicitly raise if the rating argument is NULL,
--      before the range check runs.
--   3. review_goal()'s reason requirement checked "was a non-NULL
--      argument supplied", not "does the supplied value actually differ
--      from what the goal already has" -- so a reviewer resubmitting
--      the SAME status/description/target/due_date the goal already had
--      was still forced to provide a reason for a no-op change. Fixed:
--      the function now fetches the goal's current status/description/
--      target/due_date/progress first, and requires a reason only when
--      a supplied value is "is distinct from" (NULL-safe, unlike a plain
--      "<>") the corresponding current value.
--   4. Reopening behavior (status changed away from 'completed') was
--      previously undefined/accidental: progress was simply left
--      untouched, with no way to correct it without a confusing second
--      call. Documented and implemented deliberately: review_goal()
--      gains an optional p_progress argument; reopening preserves the
--      goal's existing progress UNLESS the reviewer explicitly supplies
--      p_progress in the same call, in which case that value is used
--      instead (clamped to 0-100, same as submit_goal_progress). This
--      both "preserves legitimate progress wherever possible" (the
--      default, no-argument case) and gives the reviewer an explicit,
--      auditable way to correct it when reopening really does mean the
--      goal is not as far along as 100% (the reason requirement already
--      covers this, since changing progress now also counts as a
--      review-controlled change).
--
-- WHY EACH PIECE IS NEEDED (verified against the LIVE database with
-- read-only SELECT/RPC probes, not assumed from the tracked migration
-- files, several of which have drifted from what is actually live --
-- confirmed again for this revision, not re-assumed from the first
-- draft):
--
-- - public.goals is missing organization_id entirely (confirmed live).
--   Every other HRMS table is organization-scoped; goals' tracked RLS
--   policies check "e.organization_id = current_org_id()" via a join to
--   employees, so goals has never actually NEEDED its own
--   organization_id for RLS to work -- but the new self-update/review
--   RPCs and the duplicate-cycle fix both benefit from every table being
--   consistently org-scoped, and it is a one-line trigger to guarantee
--   correctly going forward.
-- - public.goals has no column linking a goal to the KRA it supports, no
--   column for progress remarks, and no column for a manager's override
--   reason (confirmed live via column probes).
-- - public.goals has SELECT/INSERT policies scoped to the owning
--   employee but NO self-update policy anywhere in any tracked migration
--   (confirmed by grepping every migration -- zero matches -- and by the
--   comment already in src/services/talentService.ts recording this was
--   verified live). An employee genuinely cannot update their own goal's
--   progress today; only a manager or admin/hr can.
-- - current_user_role() reads public.profiles.role (confirmed:
--   20260831000001_reconcile_tracked_schema_with_live.sql), whose live
--   values are admin/hr/team_lead/employee/dept_head/general_manager
--   (confirmed live) -- public.employees.role is a separate, unused
--   column (confirmed live: every employees.role value is empty/unused)
--   and is never read by any RPC in this file. is_manager() reads
--   is_lead() = is_dept_head() or is_team_lead() per its LATEST
--   definition (20260926000001_role_hierarchy_access_scope.sql, which
--   "create or replace"s an earlier, stale "role = 'manager'" version
--   from 20260831000001 -- Postgres keeps only the last-applied body, so
--   the stale version is dead and does not run live). Every role check
--   in this file's RPCs uses current_user_role()/is_admin_or_hr()/
--   is_manager()/can_manage_employee(), all of which are confirmed live
--   and confirmed to resolve correctly.
-- - public.performance_reviews.feedback is a SINGLE column written by
--   BOTH submit_self_review and submit_manager_review (confirmed by
--   reading 20260827000004_performance_review_submit_rpcs.sql) -- so
--   whichever submits second silently overwrites the other's text.
--   Fixed by adding self_feedback/manager_feedback (distinct columns).
--   Audited: no frontend code anywhere in this project reads the shared
--   "feedback" column (mapReview in talentService.ts only ever reads
--   self_feedback/manager_feedback) -- the shared column is still
--   written for backward compatibility with any OTHER consumer outside
--   this codebase (a report, an export, direct SQL), but nothing in this
--   app depends on it being read.
-- - performance_reviews is also missing organization_id (confirmed
--   live), period_start/period_end/designation_id (confirmed live).
-- ============================================================


-- ------------------------------------------------------------
-- 1. goals.organization_id -- nullable, backfilled for EXISTING rows,
--    and set automatically on every FUTURE insert by a trigger (closes
--    the gap the first draft of this file left open).
-- ------------------------------------------------------------

alter table public.goals
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.goals g
set organization_id = e.organization_id
from public.employees e
where g.employee_id = e.id
  and g.organization_id is null;

create index if not exists idx_goals_organization on public.goals (organization_id);

create or replace function public.goals_set_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is null then
    select e.organization_id into new.organization_id
    from public.employees e
    where e.id = new.employee_id;
  end if;
  return new;
end;
$$;

drop trigger if exists goals_set_organization on public.goals;
create trigger goals_set_organization
  before insert on public.goals
  for each row
  execute function public.goals_set_organization();

revoke all on function public.goals_set_organization() from public, anon, authenticated;


-- ------------------------------------------------------------
-- 2. goals: KRA link, progress remarks, manager override reason.
-- ------------------------------------------------------------

alter table public.goals
  add column if not exists kra_id uuid references public.kra_templates(id) on delete set null,
  add column if not exists progress_remarks text,
  add column if not exists manager_review_reason text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

create index if not exists idx_goals_kra on public.goals (kra_id);


-- ------------------------------------------------------------
-- 3. submit_goal_progress: the ONLY way an employee updates their own
--    goal. NARROWED per your confirmation: progress and remarks only.
--    description/target/due_date are no longer accepted here -- an
--    employee who wants one of those changed records the request in
--    remarks; a reviewer applies it via review_goal() below.
--
--    STATUS IS NEVER CHANGED HERE (revision 4 correction -- task C):
--    reaching 100% progress is self-reported, not manager-verified
--    completion, so it must NOT flip status to 'completed' on its own --
--    only review_goal() can do that. Symmetrically, this function also
--    never flips a reviewer-completed goal's status back to 'on-track'
--    just because progress was edited afterwards: "reopening or changing
--    a goal's progress must not silently bypass reviewer decisions"
--    (task C) means un-completing a goal is itself a review decision,
--    made through review_goal(), not an automatic side effect of a
--    progress number changing. status is left untouched by this
--    function in every case.
-- ------------------------------------------------------------

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

  select employee_id, status into v_employee_id, v_status
  from public.goals
  where id = p_goal_id;

  if v_employee_id is null then
    raise exception 'Goal not found.';
  end if;
  if v_employee_id <> public.current_employee_id() then
    raise exception 'You can only update your own goal.';
  end if;
  -- Once a reviewer has marked a goal completed, further progress/remarks
  -- changes must go through a reviewer (review_goal, which can also
  -- reopen it) -- not silently through the employee's own update path.
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
      progress_remarks = coalesce(p_remarks, progress_remarks),
      updated_at = now()
  where id = p_goal_id;
end;
$$;

revoke all on function public.submit_goal_progress(uuid, integer, text) from public, anon;
grant execute on function public.submit_goal_progress(uuid, integer, text) to authenticated, service_role;

-- The first draft's 6-argument signature (with description/target/
-- due_date) is replaced by the 3-argument one above. Dropped explicitly
-- so only one submit_goal_progress exists to grant/revoke on -- harmless
-- no-op if the first draft was never actually run (confirmed it was not).
drop function if exists public.submit_goal_progress(uuid, integer, text, text, text, date);


-- ------------------------------------------------------------
-- 4. review_goal: the reviewer (manager/dept head/admin/hr) action for
--    "Review and approve relevant goal changes", "Verify goal
--    completion", and "review or override with an appropriate reason".
--    Can now also apply a description/target/due_date change on the
--    employee's behalf (the counterpart to narrowing #3) -- still never
--    touches weight or the KRA link. Setting status to 'completed' now
--    also sets progress = 100, so the two can never disagree.
-- ------------------------------------------------------------

-- REOPENING BEHAVIOR (issue 4 -- documented, deliberate choice):
-- when a reviewer changes status AWAY FROM 'completed' (reopening a
-- goal), progress is preserved exactly as it was UNLESS the reviewer
-- explicitly supplies a new p_progress value in the same call. This
-- avoids two bad alternatives: (a) silently leaving progress at 100
-- while status says 'at-risk'/'on-track'/'delayed' with no way to ever
-- correct it without a second call, and (b) forcibly resetting progress
-- to some arbitrary lower number on every reopen, which could erase
-- genuinely accurate progress (e.g. a goal that really is 90% done but
-- was prematurely marked complete). A reviewer who reopens a goal and
-- wants to reflect that it is not actually as far along as 100% can
-- pass p_progress in that same review_goal() call; otherwise the
-- existing progress number is trusted and kept.
create or replace function public.review_goal(
  p_goal_id uuid,
  p_status text default null,
  p_reason text default null,
  p_description text default null,
  p_target text default null,
  p_due_date date default null,
  p_progress integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_current_status text;
  v_current_description text;
  v_current_target text;
  v_current_due_date date;
  v_current_progress integer;
  v_description text;
  v_target text;
  v_reason text;
  v_progress integer;
  v_changing boolean;
begin
  select employee_id, status, description, target, due_date, progress
    into v_employee_id, v_current_status, v_current_description, v_current_target, v_current_due_date, v_current_progress
  from public.goals where id = p_goal_id;
  if v_employee_id is null then
    raise exception 'Goal not found.';
  end if;

  if not (
    public.current_user_role() in ('admin', 'hr')
    or public.can_manage_employee(v_employee_id)
  ) then
    raise exception 'Only an authorized manager, admin, or HR can review this goal.';
  end if;

  if p_status is not null and p_status not in ('on-track', 'at-risk', 'delayed', 'completed') then
    raise exception 'Status must be on-track, at-risk, delayed, or completed.';
  end if;

  -- Empty-string means "no value supplied" for every optional text
  -- argument, exactly like NULL does -- so a caller cannot write a blank
  -- string over an existing description/target by passing '' instead of
  -- omitting the argument.
  v_description := nullif(btrim(coalesce(p_description, '')), '');
  v_target := nullif(btrim(coalesce(p_target, '')), '');
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  v_progress := case when p_progress is not null then greatest(0, least(100, p_progress)) else null end;

  -- A reason is required only when a review-controlled value is
  -- ACTUALLY CHANGING -- i.e. the proposed value both was supplied and
  -- genuinely differs from the goal's current stored value -- not
  -- merely because a non-NULL argument was passed. "is distinct from"
  -- is used throughout (not "<>") because it is NULL-safe: it correctly
  -- treats two NULLs as NOT distinct (no change) and a NULL-vs-non-NULL
  -- pair as distinct (a real change), where a plain "<>" would instead
  -- silently evaluate to NULL (neither true nor false) the moment
  -- either side is NULL -- e.g. v_current_due_date is distinct from
  -- p_due_date correctly stays FALSE when both are NULL (goal has no
  -- due date, reviewer didn't set one), and correctly stays TRUE when
  -- the goal has no due date today but the reviewer is now setting one.
  -- Completing a goal (status -> 'completed') always forces progress to
  -- 100 regardless of what progress already was, so it counts as a
  -- progress change in its own right even without an explicit
  -- p_progress argument.
  v_changing :=
    (p_status is not null and p_status is distinct from v_current_status)
    or (v_description is not null and v_description is distinct from v_current_description)
    or (v_target is not null and v_target is distinct from v_current_target)
    or (p_due_date is not null and p_due_date is distinct from v_current_due_date)
    or (v_progress is not null and v_progress is distinct from v_current_progress)
    or (p_status = 'completed' and v_current_progress is distinct from 100);

  if v_changing and v_reason is null then
    raise exception 'A reason is required when a reviewer changes a goal''s status, description, target, due date, or progress.';
  end if;

  update public.goals
  set status = coalesce(p_status, status),
      -- Completion and 100% progress can never disagree: a reviewer
      -- marking a goal complete also closes out its progress, whether
      -- the employee's own self-reported progress had caught up or not
      -- (that gap is exactly what the required reason explains).
      -- Reopening (status set to anything else) preserves progress
      -- as-is unless the reviewer explicitly supplied p_progress in this
      -- same call -- see the "REOPENING BEHAVIOR" note above.
      progress = case
        when p_status = 'completed' then 100
        when v_progress is not null then v_progress
        else progress
      end,
      manager_review_reason = case when v_changing then v_reason else manager_review_reason end,
      description = coalesce(v_description, description),
      target = coalesce(v_target, target),
      due_date = coalesce(p_due_date, due_date),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = p_goal_id;
end;
$$;

revoke all on function public.review_goal(uuid, text, text, text, text, date, integer) from public, anon;
grant execute on function public.review_goal(uuid, text, text, text, text, date, integer) to authenticated, service_role;

-- Earlier revisions' 3-argument and 6-argument signatures are replaced
-- by the 7-argument one above (the 7th, p_progress, added in revision 5
-- for issue 4's reopening behavior). Dropped explicitly so only one
-- review_goal exists to grant/revoke on -- harmless no-op if an earlier
-- revision was never run (confirmed it was not).
drop function if exists public.review_goal(uuid, text, text);
drop function if exists public.review_goal(uuid, text, text, text, text, date);


-- ------------------------------------------------------------
-- 5. performance_reviews: self_feedback / manager_feedback (distinct
--    columns, see the top-of-file note on the shared "feedback" column),
--    period_start/period_end/designation_id, and organization_id (same
--    gap as goals -- confirmed live missing -- backfilled + a matching
--    insert-time trigger).
-- ------------------------------------------------------------

alter table public.performance_reviews
  add column if not exists self_feedback text,
  add column if not exists manager_feedback text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists designation_id uuid references public.designations(id) on delete set null,
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.performance_reviews pr
set organization_id = e.organization_id
from public.employees e
where pr.employee_id = e.id
  and pr.organization_id is null;

create index if not exists idx_performance_reviews_organization on public.performance_reviews (organization_id);

create or replace function public.performance_reviews_set_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is null then
    select e.organization_id into new.organization_id
    from public.employees e
    where e.id = new.employee_id;
  end if;
  return new;
end;
$$;

drop trigger if exists performance_reviews_set_organization on public.performance_reviews;
create trigger performance_reviews_set_organization
  before insert on public.performance_reviews
  for each row
  execute function public.performance_reviews_set_organization();

revoke all on function public.performance_reviews_set_organization() from public, anon, authenticated;

-- Duplicate-prevention (audit point 2, CORRECTED after a second review):
-- the business key is employee + cycle NAME + PERIOD, not employee +
-- cycle name alone. A plain unique(employee_id, review_cycle) would
-- wrongly block the same employee from ever having a "Monthly
-- Performance Review" in both November and December -- two genuinely
-- different, valid reviews that happen to share a name. The period is
-- what distinguishes them, so it has to be part of the key.
--
-- period_start/period_end are nullable (a cycle can be launched with no
-- explicit period), and a plain unique CONSTRAINT on nullable columns
-- treats every NULL as distinct from every other NULL -- so two
-- genuinely duplicate "no period given" rows for the same employee and
-- cycle name would NOT collide and both would be inserted, defeating
-- de-duplication for the single most common case (most cycles launched
-- via the UI today have no period set). Fixed with a NULL-safe UNIQUE
-- INDEX using coalesce() to a sentinel date, the exact same pattern this
-- codebase already uses for kra_templates_set_name_uidx
-- (20260926000005_kra_kpi.sql) to make nullable department_id/
-- designation_id columns NULL-safe in a unique index.

-- Review-only: run first. Any (employee_id, review_cycle, period_start,
-- period_end) group with more than one row would make the unique index
-- below fail to create -- confirmed live there are currently zero
-- performance_reviews rows at all, so this returns no rows today; if it
-- ever returns rows before you run this file, resolve those duplicates
-- first, then continue.
select employee_id, review_cycle, period_start, period_end, count(*) as duplicate_count
from public.performance_reviews
group by employee_id, review_cycle, period_start, period_end
having count(*) > 1;

create unique index if not exists performance_reviews_employee_cycle_period_uidx
  on public.performance_reviews (
    employee_id,
    review_cycle,
    coalesce(period_start, '0001-01-01'::date),
    coalesce(period_end, '0001-01-01'::date)
  );

-- task B: once a review is finalized (status = 'completed'), neither RPC
-- may overwrite its ratings or feedback -- checked inside the SECURITY
-- DEFINER function itself (not only in the frontend), so a direct RPC
-- call can't bypass it either.
create or replace function public.submit_self_review(p_review_id uuid, p_self_rating numeric, p_feedback text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_manager_rating numeric; v_employee_id uuid; v_status text;
begin
  select manager_rating, employee_id, status into v_manager_rating, v_employee_id, v_status
  from public.performance_reviews where id = p_review_id;

  if v_employee_id is null or v_employee_id <> current_employee_id() then
    raise exception 'Review not found or not yours to submit.';
  end if;
  if v_status = 'completed' then
    raise exception 'This review is already finalized and can no longer be changed.';
  end if;
  -- Explicit NULL check (revision 5, issue 2): "x < 0 or x > 5" evaluates
  -- to NULL, not TRUE, when x is NULL, so that comparison alone would
  -- silently let a NULL rating through and get written to self_rating.
  if p_self_rating is null then
    raise exception 'A self rating is required.';
  end if;
  if p_self_rating < 0 or p_self_rating > 5 then
    raise exception 'Score must be between 0 and 5.';
  end if;

  update public.performance_reviews
  set self_rating = p_self_rating,
      self_feedback = nullif(trim(coalesce(p_feedback, '')), ''),
      -- feedback kept in sync with self_feedback for any OTHER consumer
      -- of the old shared column outside this app (confirmed: nothing in
      -- this codebase reads it -- see the top-of-file audit note).
      feedback = nullif(trim(coalesce(p_feedback, '')), ''),
      status = case when v_manager_rating is not null then 'completed' else 'in-progress' end,
      final_rating = case when v_manager_rating is not null then round((p_self_rating + v_manager_rating) / 2, 2) else final_rating end,
      reviewed_at = now()
  where id = p_review_id;
end;
$$;

create or replace function public.submit_manager_review(p_review_id uuid, p_manager_rating numeric, p_feedback text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_self_rating numeric; v_employee_id uuid; v_status text;
begin
  select self_rating, employee_id, status into v_self_rating, v_employee_id, v_status
  from public.performance_reviews where id = p_review_id;

  if v_employee_id is null then
    raise exception 'Review not found.';
  end if;
  if not (is_admin_or_hr() or (is_manager() and is_my_direct_report(v_employee_id))) then
    raise exception 'Only the reviewing manager, admin or HR can submit this score.';
  end if;
  if v_status = 'completed' then
    raise exception 'This review is already finalized and can no longer be changed.';
  end if;
  -- Explicit NULL check (revision 5, issue 2) -- same reasoning as
  -- submit_self_review above.
  if p_manager_rating is null then
    raise exception 'A manager rating is required.';
  end if;
  if p_manager_rating < 0 or p_manager_rating > 5 then
    raise exception 'Score must be between 0 and 5.';
  end if;

  update public.performance_reviews
  set manager_rating = p_manager_rating,
      manager_feedback = nullif(trim(coalesce(p_feedback, '')), ''),
      feedback = nullif(trim(coalesce(p_feedback, '')), ''),
      status = case when v_self_rating is not null then 'completed' else 'in-progress' end,
      final_rating = case when v_self_rating is not null then round((v_self_rating + p_manager_rating) / 2, 2) else final_rating end,
      reviewed_at = now()
  where id = p_review_id;
end;
$$;

revoke all on function public.submit_self_review(uuid, numeric, text) from public, anon;
grant execute on function public.submit_self_review(uuid, numeric, text) to authenticated, service_role;
revoke all on function public.submit_manager_review(uuid, numeric, text) from public, anon;
grant execute on function public.submit_manager_review(uuid, numeric, text) to authenticated, service_role;


-- ------------------------------------------------------------
-- 6. create_review_cycle: replaces the frontend's direct multi-row
--    insert into performance_reviews with a SECURITY DEFINER RPC, so
--    period_start/period_end and designation-based selection can be
--    validated server-side, this action is auditable in one place, and
--    a retry/double-click, OR a genuinely new cycle for the same
--    employee with the SAME name but a DIFFERENT period (e.g. "Monthly
--    Performance Review" for November, then again for December), both
--    behave correctly: the former is silently skipped, the latter is
--    inserted as a new row.
--
--    REVISION 5 CORRECTION (issue 1): the previous revision relied on
--    "ON CONFLICT (coalesce(period_start, ...), coalesce(period_end,
--    ...)) DO NOTHING" to infer against
--    performance_reviews_employee_cycle_period_uidx. ON CONFLICT's
--    expression-based inference requires the conflict target's
--    expressions to match the index's expressions in parsed form, and
--    this cannot be executed to confirm it resolves correctly for an
--    INSERT ... SELECT (as opposed to a single-row VALUES insert) in
--    this Postgres version. Rather than ship an ON CONFLICT clause that
--    cannot be verified without running it, this is now written with a
--    plain "NOT EXISTS" filter using the SAME NULL-safe coalesce()
--    comparison the unique index itself encodes -- ordinary SQL with no
--    dependency on expression-index inference at all, and the unique
--    index from #5 above still exists as a hard backstop (a genuine race
--    between two concurrent calls would raise a unique-violation error
--    instead of silently duplicating, which is an acceptable, correctly-
--    failing outcome -- not the question this fix is answering).
-- ------------------------------------------------------------

create or replace function public.create_review_cycle(
  p_cycle_name text,
  p_employee_ids uuid[] default null,
  p_designation_id uuid default null,
  p_period_start date default null,
  p_period_end date default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_name text := btrim(coalesce(p_cycle_name, ''));
  v_count integer := 0;
begin
  if public.current_user_role() not in ('admin', 'hr') then
    raise exception 'Only Super Admin or HR can launch a performance review cycle.';
  end if;
  if v_name = '' then
    raise exception 'Cycle name is required.';
  end if;
  if v_org is null then
    raise exception 'Your profile is not linked to an organization.';
  end if;
  if p_period_start is not null and p_period_end is not null and p_period_start > p_period_end then
    raise exception 'Period start must be on or before period end.';
  end if;

  insert into public.performance_reviews (
    organization_id, employee_id, reviewer_id, review_cycle, status,
    period_start, period_end, designation_id
  )
  select
    e.organization_id,
    e.id,
    m.profile_id,
    v_name,
    'not-started',
    p_period_start,
    p_period_end,
    p_designation_id
  from public.employees e
  left join public.employees m on m.id = e.manager_id
  where e.organization_id = v_org
    and (
      (p_employee_ids is not null and e.id = any (p_employee_ids))
      or (p_designation_id is not null and e.designation_id = p_designation_id)
    )
    and not exists (
      select 1
      from public.performance_reviews pr
      where pr.employee_id = e.id
        and pr.review_cycle = v_name
        and coalesce(pr.period_start, '0001-01-01'::date) = coalesce(p_period_start, '0001-01-01'::date)
        and coalesce(pr.period_end, '0001-01-01'::date) = coalesce(p_period_end, '0001-01-01'::date)
    );

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'No new reviews were created -- either no employees matched, or every matching employee already has a review for this exact cycle name and period.';
  end if;

  return v_count;
end;
$$;

revoke all on function public.create_review_cycle(text, uuid[], uuid, date, date) from public, anon;
grant execute on function public.create_review_cycle(text, uuid[], uuid, date, date) to authenticated, service_role;


-- ------------------------------------------------------------
-- 7. Expose kra_resolved_templates to authenticated users (currently
--    granted only to postgres/service_role -- confirmed live). Re-
--    audited: it is STABLE SECURITY DEFINER, gates on
--    can_view_employee(p_employee_id) internally (returns zero rows,
--    not an error, for anyone unauthorized), and filters templates by
--    t.organization_id = emp.organization_id -- no org leakage. This
--    grant does not widen who can see what; it only lets the Goal form
--    resolve "which KRAs are actually assigned to me right now" instead
--    of needing to offer every KRA template in the organisation.
-- ------------------------------------------------------------

grant execute on function public.kra_resolved_templates(uuid, text) to authenticated;


-- ------------------------------------------------------------
-- 8. goals_self_update RLS note: intentionally NOT added. Self-updates go
--    exclusively through submit_goal_progress() above (SECURITY
--    DEFINER), so no row-level self-update policy is created -- adding
--    one in addition to the RPC would let a raw client update bypass the
--    RPC's narrowed scope (progress/remarks only, never weight, status,
--    description, target, or due_date).
-- ------------------------------------------------------------


notify pgrst, 'reload schema';
