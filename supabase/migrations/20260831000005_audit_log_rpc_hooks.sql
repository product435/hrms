-- Wires audit logging directly into the three existing SECURITY DEFINER RPCs
-- that already perform the highest-value approval/create actions, so those
-- events are captured server-side rather than relying on every client call
-- site to remember to log them. Logic is otherwise byte-for-byte identical
-- to the live functions (verified via pg_get_functiondef immediately before
-- writing this file) -- only a trailing `perform log_audit_event(...)` call
-- was added to each.

create or replace function public.submit_self_review(p_review_id uuid, p_self_rating numeric, p_feedback text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_manager_rating numeric; v_employee_id uuid;
begin
  select manager_rating, employee_id into v_manager_rating, v_employee_id
  from public.performance_reviews where id = p_review_id;

  if v_employee_id is null or v_employee_id <> current_employee_id() then
    raise exception 'Review not found or not yours to submit.';
  end if;
  if p_self_rating < 0 or p_self_rating > 5 then
    raise exception 'Score must be between 0 and 5.';
  end if;

  update public.performance_reviews
  set self_rating = p_self_rating,
      feedback = nullif(trim(coalesce(p_feedback, '')), ''),
      status = case when v_manager_rating is not null then 'completed' else 'in-progress' end,
      final_rating = case when v_manager_rating is not null then round((p_self_rating + v_manager_rating) / 2, 2) else final_rating end,
      reviewed_at = now()
  where id = p_review_id;

  perform public.log_audit_event('submit_self_review', 'performance_reviews', p_review_id, null, jsonb_build_object('self_rating', p_self_rating));
end;
$function$;

create or replace function public.submit_manager_review(p_review_id uuid, p_manager_rating numeric, p_feedback text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_self_rating numeric; v_employee_id uuid;
begin
  select self_rating, employee_id into v_self_rating, v_employee_id
  from public.performance_reviews where id = p_review_id;

  if v_employee_id is null then
    raise exception 'Review not found.';
  end if;
  if not (is_admin_or_hr() or (is_manager() and is_my_direct_report(v_employee_id))) then
    raise exception 'Only the reviewing manager, admin or HR can submit this score.';
  end if;
  if p_manager_rating < 0 or p_manager_rating > 5 then
    raise exception 'Score must be between 0 and 5.';
  end if;

  update public.performance_reviews
  set manager_rating = p_manager_rating,
      feedback = nullif(trim(coalesce(p_feedback, '')), ''),
      status = case when v_self_rating is not null then 'completed' else 'in-progress' end,
      final_rating = case when v_self_rating is not null then round((v_self_rating + p_manager_rating) / 2, 2) else final_rating end,
      reviewed_at = now()
  where id = p_review_id;

  perform public.log_audit_event('submit_manager_review', 'performance_reviews', p_review_id, null, jsonb_build_object('manager_rating', p_manager_rating));
end;
$function$;

create or replace function public.add_candidate_application(p_job_id uuid, p_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_experience_years numeric DEFAULT NULL::numeric, p_resume_url text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_candidate_id uuid;
  v_application_id uuid;
begin
  if not is_admin_or_hr() then
    raise exception 'Only admin or HR can add candidates.';
  end if;
  if not exists (select 1 from public.job_openings j where j.id = p_job_id and j.organization_id = current_org_id()) then
    raise exception 'Requisition not found.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Candidate name is required.';
  end if;

  insert into public.candidates (name, email, phone, source, experience_years, resume_url)
  values (trim(p_name), nullif(trim(coalesce(p_email, '')), ''), nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_source, '')), ''), p_experience_years, nullif(trim(coalesce(p_resume_url, '')), ''))
  returning id into v_candidate_id;

  insert into public.job_applications (candidate_id, job_id, stage, status, applied_at)
  values (v_candidate_id, p_job_id, 'applied', 'active', now())
  returning id into v_application_id;

  perform public.log_audit_event('add_candidate_application', 'job_applications', v_application_id, null, jsonb_build_object('job_id', p_job_id, 'candidate_id', v_candidate_id));

  return v_application_id;
end;
$function$;
