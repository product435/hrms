-- Drop employee self-insert of salary. Employees may still read their own row.
drop policy if exists salary_structures_self_insert on public.salary_structures;

create or replace function public.payroll_runs_freeze_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old jsonb;
  v_new jsonb;
  v_key text;
begin
  if tg_op = 'DELETE' then
    if old.status = 'approved' then
      raise exception 'An approved payroll run cannot be deleted.';
    end if;
    return old;
  end if;

  if old.status is distinct from 'approved' then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'An approved payroll run cannot be moved back to draft.';
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_key in array array[
    'gross', 'deductions', 'net', 'basic', 'hra', 'allowances', 'bonus',
    'pf', 'tax', 'gross_salary', 'net_salary', 'total_deductions'
  ]
  loop
    if v_old ? v_key and v_old -> v_key is distinct from v_new -> v_key then
      raise exception 'Monetary columns on an approved payroll run cannot be changed.';
    end if;
  end loop;

  return new;
end;
$fn$;

create or replace function public.payroll_records_freeze_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_approved boolean;
begin
  select r.status = 'approved' into v_approved
  from public.payroll_runs r
  where r.id = case when tg_op = 'DELETE' then old.payroll_run_id else new.payroll_run_id end;

  if coalesce(v_approved, false) then
    raise exception 'Payroll records for an approved run cannot be changed.';
  end if;

  if tg_op = 'UPDATE' and old.payroll_run_id is distinct from new.payroll_run_id then
    select r.status = 'approved' into v_approved
    from public.payroll_runs r
    where r.id = old.payroll_run_id;
    if coalesce(v_approved, false) then
      raise exception 'Payroll records for an approved run cannot be changed.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$fn$;

create or replace function public.payslips_freeze_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_approved boolean;
begin
  select r.status = 'approved' into v_approved
  from public.payroll_records pr
  join public.payroll_runs r on r.id = pr.payroll_run_id
  where pr.id = case when tg_op = 'DELETE' then old.payroll_record_id else new.payroll_record_id end;

  if coalesce(v_approved, false) then
    raise exception 'Payslips for an approved payroll run cannot be changed.';
  end if;

  if tg_op = 'UPDATE' and old.payroll_record_id is distinct from new.payroll_record_id then
    select r.status = 'approved' into v_approved
    from public.payroll_records pr
    join public.payroll_runs r on r.id = pr.payroll_run_id
    where pr.id = old.payroll_record_id;
    if coalesce(v_approved, false) then
      raise exception 'Payslips for an approved payroll run cannot be changed.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$fn$;

drop trigger if exists payroll_runs_freeze_approved on public.payroll_runs;
create trigger payroll_runs_freeze_approved
  before update or delete on public.payroll_runs
  for each row
  execute function public.payroll_runs_freeze_approved();

drop trigger if exists payroll_records_freeze_approved on public.payroll_records;
create trigger payroll_records_freeze_approved
  before insert or update or delete on public.payroll_records
  for each row
  execute function public.payroll_records_freeze_approved();

drop trigger if exists payslips_freeze_approved on public.payslips;
create trigger payslips_freeze_approved
  before insert or update or delete on public.payslips
  for each row
  execute function public.payslips_freeze_approved();

revoke all on function public.payroll_runs_freeze_approved() from public, anon;
revoke all on function public.payroll_records_freeze_approved() from public, anon;
revoke all on function public.payslips_freeze_approved() from public, anon;
grant execute on function public.payroll_runs_freeze_approved() to authenticated, service_role;
grant execute on function public.payroll_records_freeze_approved() to authenticated, service_role;
grant execute on function public.payslips_freeze_approved() to authenticated, service_role;
