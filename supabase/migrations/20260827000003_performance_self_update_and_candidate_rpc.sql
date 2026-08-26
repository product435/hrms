-- Employee currently has self_select + self_insert on performance_reviews but
-- no self_update, so they have no way to actually submit a self-review on an
-- existing (HR/manager-created) row. Mirrors the existing
-- performance_reviews_manager_update_team policy shape exactly.
create policy performance_reviews_self_update on public.performance_reviews for update
  using (employee_id = current_employee_id())
  with check (employee_id = current_employee_id());

-- Recruitment "Add candidate" is blocked today by a circular RLS dependency:
-- candidates_admin_hr_all's WITH CHECK requires an existing job_applications
-- row referencing the candidate, but job_applications.candidate_id has a FK
-- that requires the candidate to already exist. Neither insert order can
-- satisfy both constraints from the client. This RPC performs both inserts
-- in one definer-privileged transaction (with its own admin/HR + org check),
-- which is the only way to make the existing two-table design insertable at
-- all -- no new table, no change to either table's shape.
create or replace function public.add_candidate_application(
  p_job_id uuid,
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_source text default null,
  p_experience_years numeric default null,
  p_resume_url text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  return v_application_id;
end;
$$;
