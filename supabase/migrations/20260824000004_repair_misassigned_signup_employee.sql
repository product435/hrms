-- Data repair, not a schema change: the one real sign-up created while
-- handle_new_user() still had the org-selection bug (see previous
-- migration) is re-pointed at the correct organization instead of being
-- left broken or deleted.
update public.employees
set organization_id = (
  select e.organization_id
  from public.employees e
  where e.organization_id is not null
  group by e.organization_id
  order by count(*) desc
  limit 1
)
where email = 'newemployee.1787555698153@gmail.com';
