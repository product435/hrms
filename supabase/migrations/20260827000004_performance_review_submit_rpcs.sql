-- The self_update policy added in 20260827000003 is row-scoped only, not
-- column-scoped -- it let an employee overwrite manager_rating/status on
-- their own row via a raw update, not just self_rating. Replaced here with
-- two SECURITY DEFINER RPCs that each write only the columns their caller is
-- allowed to set, verified live: a manager's "enter score" action landed on
-- their own row (self_select makes it visible to them) and successfully set
-- manager_rating through the old policy -- exactly the gap this closes.
drop policy if exists performance_reviews_self_update on public.performance_reviews;

create or replace function public.submit_self_review(p_review_id uuid, p_self_rating numeric, p_feedback text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
end;
$$;

create or replace function public.submit_manager_review(p_review_id uuid, p_manager_rating numeric, p_feedback text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
end;
$$;
