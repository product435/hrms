alter table public.salary_structures
  add column if not exists bonus numeric(14,2) not null default 0;

alter table public.salary_structures
  add column if not exists gross_salary numeric(14,2);

create or replace function public.salary_structures_set_gross()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.effective_from is null then
    raise exception 'Effective from must be a date.';
  end if;

  if new.basic is null or new.basic < 0
    or new.hra is null or new.hra < 0
    or new.allowances is null or new.allowances < 0
    or new.bonus is null or new.bonus < 0
    or new.deductions is null or new.deductions < 0 then
    raise exception 'Salary amounts must be zero or greater.';
  end if;

  new.gross_salary := new.basic + new.hra + new.allowances + new.bonus;
  return new;
end;
$$;

drop trigger if exists salary_structures_set_gross on public.salary_structures;
create trigger salary_structures_set_gross
  before insert or update on public.salary_structures
  for each row
  execute function public.salary_structures_set_gross();

revoke all on function public.salary_structures_set_gross() from public, anon;
grant execute on function public.salary_structures_set_gross() to authenticated, service_role;

alter table public.salary_structures
  drop constraint if exists salary_structures_component_gross_check;

alter table public.salary_structures
  add constraint salary_structures_component_gross_check
  check (
    basic is not null
    and basic >= 0
    and hra is not null
    and hra >= 0
    and allowances is not null
    and allowances >= 0
    and bonus is not null
    and bonus >= 0
    and deductions is not null
    and deductions >= 0
    and effective_from is not null
    and gross_salary = basic + hra + allowances + bonus
  )
  not valid;
