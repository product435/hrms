-- Removes the submit-time-window rejection from dwr_upsert_v2 -- the
-- function actually called by the frontend (src/services/workService.ts
-- calls save_dwr_draft_v2 / submit_dwr_v2, both of which call
-- dwr_upsert_v2, not the plain dwr_upsert patched in
-- 20261123105954_relax_attendance_dwr_leave_rules.sql).
--
-- That earlier migration correctly removed the "report window opens 30
-- minutes before your shift ends" / "submission window closed at 10:00
-- IST" rejections from dwr_upsert, but dwr_upsert_v2 is a SEPARATE
-- function (added later, in 20261001120000_dwr_rich_text.sql, carrying
-- the identical window check, and re-declared again with the anti-AI
-- guard and the 3-unplanned-line limit in
-- 20261003130000_dwr_anti_ai_guard.sql) -- it was never touched, so the
-- live, actually-used submit path kept rejecting early/late submissions
-- with exactly that error text, contradicting the already-fixed frontend
-- copy ("Drafts can be saved now. You can submit anytime.").
--
-- This is the LAST definition of dwr_upsert_v2 to be applied (its
-- filename timestamp is after every existing one), so it is the one that
-- takes effect once run.
--
-- Changed here, and ONLY here, vs. the version in
-- 20261003130000_dwr_anti_ai_guard.sql:
--   * Removed the "now() < v_open" and "now() >= v_late" rejections.
--   * "late" vs "submitted" classification (now() > v_shift_end) is kept
--     exactly as-is -- still an honest status label, never a rejection.
-- Everything else is byte-for-byte unchanged: the approved/missed guards,
-- the AI-description guard, HTML handling, the 50-line and 2000-character
-- limits, the "link to a task or mark unplanned" rule, the 3-unplanned-
-- line cap, hour validation, and the final insert/update are untouched.
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
  v_shift_end timestamptz;
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

  select e.organization_id into v_org from public.employees e where e.id = v_employee;
  if v_org is null then
    raise exception 'Your employee record has no organisation.';
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
    select b.shift_end
      into v_shift_end
    from public.dwr_shift_bounds(v_employee, p_report_date) b;

    -- Submission is allowed at any time of day; "late" is still an honest
    -- status label (based on shift end), it is just never a rejection.
    v_status := case when now() > v_shift_end then 'late' else 'submitted' end;
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

    if v_desc = '' then
      if p_submit then
        raise exception 'Each report item needs a description.';
      end if;
      continue;
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

  if p_submit and jsonb_array_length(v_clean) = 0 then
    raise exception 'Add at least one line before you submit.';
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
