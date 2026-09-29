-- The approve/reject button calls decide_attendance_correction. That
-- function was defined with the attendance rules but never reached the
-- hosted database, so PostgREST reported it missing from the schema cache.

create or replace function public.decide_attendance_correction(p_correction_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid;
  v_status text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  select employee_id, status into v_employee, v_status
  from public.attendance_corrections
  where id = p_correction_id;

  if v_employee is null then
    raise exception 'Regularization request not found.';
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'This request is already %.', v_status;
  end if;
  if not public.can_manage_employee(v_employee) then
    raise exception 'Only the team lead, department head, HR, or an admin can decide this request.';
  end if;

  update public.attendance_corrections
  set status = p_decision,
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_correction_id;
end;
$$;

revoke all on function public.decide_attendance_correction(uuid, text) from public, anon;
grant execute on function public.decide_attendance_correction(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
