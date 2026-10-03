-- Submit-only anti-AI check for daily work report item descriptions.
-- Mirrors src/lib/dwr-ai-guard.ts. Draft saves (p_submit = false) stay lenient.

create or replace function public.dwr_description_looks_ai(p_text text)
returns boolean
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v text := btrim(coalesce(p_text, ''));
  v_lower text;
  v_phrase text;
  v_hits int := 0;
  v_numbered int := 0;
  v_bullets int := 0;
  v_norm text;
  v_sentences text[];
  v_sent text;
  v_sent_count int := 0;
  v_len int;
  v_sum numeric := 0;
  v_sumsq numeric := 0;
  v_mean numeric;
  v_var numeric;
  v_all_long boolean := true;
  v_score int := 0;
  v_word_count int := 0;
  v_func_count int := 0;
  v_phrases text[] := array[
    'as an ai',
    'i hope this helps',
    'it is important to note',
    'it''s important to note',
    'it is worth noting',
    'it''s worth noting',
    'plays a crucial role',
    'a wide range of',
    'in conclusion',
    'in summary',
    'in today''s',
    'cutting-edge',
    'ever-evolving',
    'furthermore',
    'moreover',
    'additionally',
    'leveraging',
    'delve',
    'comprehensive',
    'facilitate',
    'underscore',
    'multifaceted',
    'holistic',
    'pivotal',
    'paramount',
    'seamless',
    'tapestry',
    'foster',
    'robust'
  ];
  v_function_words text[] := array[
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
    'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'i', 'if', 'in',
    'is', 'it', 'its', 'my', 'not', 'of', 'on', 'or', 'our', 'that', 'the',
    'their', 'these', 'this', 'those', 'to', 'was', 'we', 'were', 'with', 'you', 'your'
  ];
begin
  if v = '' then
    return false;
  end if;

  v_lower := lower(v);
  foreach v_phrase in array v_phrases loop
    if v_phrase = 'as an ai' then
      if v_lower ~ '(^|[^a-z])as an ai([^a-z]|$)' then
        v_hits := v_hits + 1;
      end if;
    elsif position(v_phrase in v_lower) > 0 then
      v_hits := v_hits + 1;
    end if;
  end loop;

  select count(*)::int into v_numbered
  from regexp_matches(v, '(^|\n)[[:space:]]*[[:digit:]]+\.[[:space:]]+[^[:space:]]', 'g');

  select count(*)::int into v_bullets
  from regexp_matches(v, '(^|\n)[[:space:]]*[-*•][[:space:]]+[^[:space:]]', 'g');

  v_norm := regexp_replace(v, '[[:space:]]*\n+[[:space:]]*', '. ', 'g');
  v_sentences := array(
    select btrim(piece)
    from regexp_split_to_table(v_norm, '[.!?]+') as piece
    where btrim(piece) <> ''
  );
  v_sent_count := coalesce(cardinality(v_sentences), 0);

  if char_length(v) <= 360
     and v_sent_count <= 3
     and v_hits <= 1
     and v_numbered < 3
     and v_bullets < 3
     and position('**' in v) = 0 then
    return false;
  end if;

  if v_sent_count > 0 then
    foreach v_sent in array v_sentences loop
      v_len := char_length(v_sent);
      v_sum := v_sum + v_len;
      v_sumsq := v_sumsq + (v_len * v_len);
      if v_len <= 80 then
        v_all_long := false;
      end if;
    end loop;
  end if;

  v_score := least(v_hits, 4) * 2;
  if position('**' in v) > 0 then
    v_score := v_score + 3;
  end if;
  if v_numbered >= 3 then
    v_score := v_score + 3;
  end if;
  if v_bullets >= 3 then
    v_score := v_score + 2;
  end if;
  if char_length(v) > 400 and v_sent_count between 1 and 3 and v_all_long then
    v_score := v_score + 4;
  end if;
  if char_length(v) > 400 and v_sent_count = 1 then
    v_score := v_score + 2;
  end if;

  if v_sent_count >= 4 then
    v_mean := v_sum / v_sent_count;
    v_var := (v_sumsq / v_sent_count) - (v_mean * v_mean);
    if v_var < 0 then
      v_var := 0;
    end if;
    if v_mean >= 80 and sqrt(v_var) / v_mean < 0.28 then
      v_score := v_score + 5;
    end if;
  end if;

  select count(*)::int into v_word_count
  from regexp_split_to_table(v_lower, '[^a-z0-9'']+') as word
  where word <> '';

  if v_word_count >= 55 then
    select count(*)::int into v_func_count
    from regexp_split_to_table(v_lower, '[^a-z0-9'']+') as word
    where word <> '' and word = any (v_function_words);
    if v_func_count::numeric / v_word_count > 0.5 then
      v_score := v_score + 2;
    end if;
  end if;

  return v_hits >= 3 or v_score >= 5;
end;
$fn$;

revoke all on function public.dwr_description_looks_ai(text) from public, anon;
grant execute on function public.dwr_description_looks_ai(text) to authenticated, service_role;

-- ------------------------------------------------------------
-- dwr_upsert_v2: existing validation kept; anti-AI runs on submit only.
-- ------------------------------------------------------------

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
  v_open timestamptz;
  v_shift_end timestamptz;
  v_late timestamptz;
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
    select b.window_open, b.shift_end, b.late_until
      into v_open, v_shift_end, v_late
    from public.dwr_shift_bounds(v_employee, p_report_date) b;

    if not v_resubmit and now() < v_open then
      raise exception 'The report window opens 30 minutes before your shift ends. You can still save a draft.';
    end if;
    if not v_resubmit and now() >= v_late then
      raise exception 'The submission window closed at 10:00 IST. This report will be marked missed.';
    end if;
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
