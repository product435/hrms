-- My Reports (end-of-day report) submission rules, Asia/Kolkata, server
-- time -- supersedes the still-unexecuted dwr_upsert_v2 definition in
-- 20261125055945_dwr_date_mandatory_fields_late_threshold.sql (confirmed
-- that file's own header still says "written to disk only... NOT
-- executed" -- do not apply that file after this one, or its 19:00
-- threshold and its missing today-only guard for EXISTING reports would
-- undo the fixes below).
--
-- Rules implemented here, as fixed IST clock times (not shift-relative --
-- the earlier 19:00 threshold used greatest(shift_end, 19:00 floor); the
-- new rule is a flat clock time for everyone, same approach as the
-- Attendance fixed-10:00-AM rules this session):
--
--   1. A new report may only be created for today. (Already true in the
--      unapplied file above -- confirmed unchanged here.)
--   2/3. Submitted by 20:00:59 IST on the report date -> "Submitted".
--      Submitted from 20:01:00 to 23:59:59 IST on the report date ->
--      "Late". Replaces the old 19:00/7 PM floor with a flat 20:00/8 PM
--      boundary, and drops the shift-end comparison entirely -- the rule
--      is now purely clock-based, same for every employee regardless of
--      shift.
--   4. Real gap closed: the unapplied file only blocked CREATING a new
--      report for a non-today date -- it never blocked saving a draft or
--      submitting an EXISTING report once its date has passed. From
--      00:00:00 IST the day after the report date, any further
--      save-draft or submit attempt on that report (new or existing) is
--      now rejected with an explicit "Missed" message, instead of
--      relying only on the separate mark_missed_dwrs() cron job to flip
--      the status after the fact -- the frontend's own today-only date
--      pickers already prevent navigating to this case in the normal UI,
--      but the database no longer depends on that alone.
--   5. A report dated before or after today can never be created or
--      edited through this function, at any time -- only today's report
--      is ever writable. Viewing an old report read-only is unaffected;
--      this function is never called for a read.
--
-- Everything else -- mandatory description/summary on draft and submit,
-- the AI-description guard, HTML handling, the 50-line and
-- 2000-character limits, the "link to a task or mark unplanned" rule,
-- the 3-unplanned-line cap, hour validation, the approved/missed row
-- guards, and the final insert/update -- is unchanged, byte-for-byte,
-- from 20261125055945_dwr_date_mandatory_fields_late_threshold.sql.
-- delete_dwr_report() (also defined in that same unapplied file) is
-- unrelated to these timing rules and is not touched or redefined here --
-- apply its definition separately if you still want the delete feature
-- (this file does not depend on it, and it does not depend on this file).
--
-- This file is written to disk only. It is NOT executed, pushed, or
-- applied by Claude Code -- run it yourself after reviewing it.

create or replace function public.dwr_upsert_v2(
  p_report_date date,
  p_blockers text,
  p_plan_for_tomorrow text,
  p_items jsonb,
  p_summary_html text,
  p_submit boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_employee uuid;
  v_org uuid;
  v_existing public.daily_work_reports%rowtype;
  v_has_existing boolean := false;
  v_resubmit boolean := false;
  v_status text;
  v_review text;
  v_element jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_desc text;
  v_desc_html text;
  v_plain text;
  v_hours numeric;
  v_item_status text;
  v_task uuid;
  v_unplanned boolean;
  v_unplanned_count int := 0;
  v_has_tasks boolean;
  v_total numeric := 0;
  v_summary_text text;
  v_summary_html text;
  v_id uuid;
  v_today date;
  v_now_ist timestamp;
begin
  perform set_config('app.dwr_rpc', 'on', true);

  v_employee := public.current_employee_id();
  if v_employee is null then
    raise exception 'Your account is not linked to an employee record.';
  end if;
  if p_report_date is null then
    raise exception 'Choose a report date.';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'Report items must be a list.';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 50 then
    raise exception 'A report can have at most 50 lines.';
  end if;

  perform public.dwr_check_html(p_summary_html, 20000);
  v_summary_text := public.dwr_strip_html(p_summary_html);
  v_summary_html := case when v_summary_text = '' then null else p_summary_html end;
  v_summary_text := nullif(v_summary_text, '');

  if v_summary_text is null then
    raise exception 'Day summary is required.';
  end if;

  select e.organization_id into v_org from public.employees e where e.id = v_employee;
  if v_org is null then
    raise exception 'Your employee record has no organisation.';
  end if;

  v_now_ist := now() at time zone 'Asia/Kolkata';
  v_today := v_now_ist::date;

  -- Rules 1 and 5: only today's date is ever writable through this
  -- function, whether creating a brand new report or saving/submitting
  -- an existing one. A past date is rejected as Missed (rule 4); a
  -- future date is rejected outright -- neither can ever be saved here.
  if p_report_date <> v_today then
    if p_report_date < v_today then
      raise exception 'This report date has passed and is now Missed. It can no longer be submitted.';
    else
      raise exception 'You can only submit a report for today (%).', v_today;
    end if;
  end if;

  select * into v_existing
  from public.daily_work_reports
  where employee_id = v_employee and report_date = p_report_date
  for update;

  v_has_existing := found;

  if v_has_existing and v_existing.review_status = 'approved' then
    raise exception 'This report is approved. Your lead can reopen it with a reason.';
  end if;
  if v_has_existing and v_existing.status = 'missed' then
    raise exception 'This report was missed. Ask HR to waive it.';
  end if;

  v_resubmit := v_has_existing and v_existing.review_status = 'needs-revision';

  if p_submit then
    -- Rules 2 and 3: flat 20:00:59 IST boundary on the report date,
    -- clock time only -- no shift comparison. 20:00:00-20:00:59 is
    -- still Submitted; 20:01:00 onward is Late.
    if v_now_ist::time < time '20:01' then
      v_status := 'submitted';
    else
      v_status := 'late';
    end if;
    v_review := 'pending';
  else
    if v_has_existing and v_existing.status in ('submitted', 'late') then
      v_status := v_existing.status;
    else
      v_status := 'draft';
    end if;
    v_review := case
      when v_has_existing and v_existing.review_status = 'needs-revision' then 'needs-revision'
      else 'pending'
    end;
  end if;

  select exists (
    select 1
    from public.tasks t
    where t.assigned_to = v_employee
      and (
        t.status <> 'done'
        or (
          t.completed_at is not null
          and (t.completed_at at time zone 'Asia/Kolkata')::date = p_report_date
        )
      )
  ) into v_has_tasks;

  for v_element in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_desc_html := nullif(v_element->>'description_html', '');
    perform public.dwr_check_html(v_desc_html, 5000);
    if v_desc_html is not null then
      -- Emptiness and the plain mirror are decided on stripped text, never on the HTML.
      v_desc := public.dwr_strip_html(v_desc_html);
      if v_desc = '' then
        v_desc_html := null;
      end if;
    else
      v_desc := btrim(coalesce(v_element->>'description', ''));
    end if;

    -- "What you did" is required for a draft save too, not only submit --
    -- an empty line is no longer silently skipped.
    if v_desc = '' then
      raise exception 'Each report item needs a description.';
    end if;
    if char_length(v_desc) > 2000 then
      raise exception 'A report line is too long (2000 characters maximum).';
    end if;

    -- Hard-fail AI-looking lines on submit only. Check the stored plain text
    -- (stripped description_html when present) and a different raw description.
    if p_submit then
      if public.dwr_description_looks_ai(v_desc) then
        raise exception 'Description looks AI-generated or pasted. Rewrite each line in your own words.';
      end if;
      v_plain := btrim(coalesce(v_element->>'description', ''));
      if v_plain <> '' and v_plain <> v_desc and public.dwr_description_looks_ai(v_plain) then
        raise exception 'Description looks AI-generated or pasted. Rewrite each line in your own words.';
      end if;
    end if;

    begin
      v_hours := round(coalesce((v_element->>'hours')::numeric, 0), 2);
    exception when others then
      raise exception 'Item hours must be a number.';
    end;
    if v_hours < 0 or v_hours > 24 then
      raise exception 'Item hours must be between 0 and 24.';
    end if;

    v_item_status := coalesce(nullif(v_element->>'item_status', ''), 'done');
    if v_item_status not in ('todo', 'in-progress', 'blocked', 'done') then
      raise exception 'Invalid item status.';
    end if;

    v_task := null;
    if nullif(v_element->>'task_id', '') is not null then
      begin
        v_task := (v_element->>'task_id')::uuid;
      exception when others then
        raise exception 'Invalid task.';
      end;
    end if;

    v_unplanned := false;
    if v_task is null then
      begin
        v_unplanned := coalesce((v_element->>'is_unplanned')::boolean, false);
      exception when others then
        v_unplanned := false;
      end;
      if v_has_tasks and not v_unplanned then
        raise exception 'Link this line to a task, or mark it as unplanned work.';
      end if;
      if v_unplanned then
        v_unplanned_count := v_unplanned_count + 1;
        if v_unplanned_count > 3 then
          raise exception 'At most 3 unplanned lines are allowed per report.';
        end if;
      end if;
    end if;

    if v_task is not null and not exists (
      select 1
      from public.tasks t
      where t.id = v_task
        and t.assigned_to = v_employee
        and (
          t.status <> 'done'
          or (
            t.completed_at is not null
            and (t.completed_at at time zone 'Asia/Kolkata')::date = p_report_date
          )
        )
    ) then
      raise exception 'That task is not on your list for this report.';
    end if;

    v_total := v_total + v_hours;
    v_clean := v_clean || jsonb_build_array(
      jsonb_build_object(
        'task_id', v_task,
        'description', v_desc,
        'description_html', v_desc_html,
        'hours', v_hours,
        'item_status', v_item_status,
        'is_unplanned', v_unplanned
      )
    );
  end loop;

  -- "At least one line with a description" is now required for a draft
  -- too (every line that reached this point already has a non-empty
  -- description, since an empty one raises above) -- an empty items list
  -- is still rejected regardless of p_submit.
  if jsonb_array_length(v_clean) = 0 then
    raise exception 'Add at least one line with what you did.';
  end if;
  if p_submit and v_total <= 0 then
    raise exception 'Enter the hours you worked before you submit.';
  end if;

  if v_has_existing then
    update public.daily_work_reports
    set status = v_status,
        submitted_at = case when p_submit then now() else submitted_at end,
        total_hours = v_total,
        blockers = nullif(btrim(coalesce(p_blockers, '')), ''),
        plan_for_tomorrow = nullif(btrim(coalesce(p_plan_for_tomorrow, '')), ''),
        summary_html = v_summary_html,
        summary_text = v_summary_text,
        review_status = v_review,
        escalated = case when p_submit then false else escalated end,
        updated_at = now()
    where id = v_existing.id
    returning id into v_id;
  else
    insert into public.daily_work_reports (
      organization_id, employee_id, report_date, status, submitted_at, total_hours,
      blockers, plan_for_tomorrow, summary_html, summary_text, review_status
    ) values (
      v_org,
      v_employee,
      p_report_date,
      v_status,
      case when p_submit then now() else null end,
      v_total,
      nullif(btrim(coalesce(p_blockers, '')), ''),
      nullif(btrim(coalesce(p_plan_for_tomorrow, '')), ''),
      v_summary_html,
      v_summary_text,
      v_review
    )
    returning id into v_id;
  end if;

  delete from public.dwr_items where report_id = v_id;

  insert into public.dwr_items (report_id, task_id, description, description_html, hours, item_status, is_unplanned)
  select
    v_id,
    nullif(item->>'task_id', '')::uuid,
    item->>'description',
    nullif(item->>'description_html', ''),
    (item->>'hours')::numeric,
    item->>'item_status',
    coalesce((item->>'is_unplanned')::boolean, false)
  from jsonb_array_elements(v_clean) as item;

  return jsonb_build_object('id', v_id, 'status', v_status, 'total_hours', v_total);
end;
$fn$;

revoke all on function public.dwr_upsert_v2(date, text, text, jsonb, text, boolean) from public, anon;
grant execute on function public.dwr_upsert_v2(date, text, text, jsonb, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';