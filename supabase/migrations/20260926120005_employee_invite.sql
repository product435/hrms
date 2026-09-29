-- Work email must be unique so a later sign-up can attach to the
-- HR-created employee row (profile_id still null) instead of inserting another.
-- 20260926120000 may already have created this index as lower(trim(email)),
-- which Postgres stores as lower(TRIM(BOTH FROM email)). Create
-- employees_work_email_unique only when that expression is not already unique.
-- Duplicate work emails skip with a notice, same as the auth migration.

do $body$
begin
  if exists (
    select 1
    from pg_index idx
    join pg_class tbl on tbl.oid = idx.indrelid
    join pg_namespace nsp on nsp.oid = tbl.relnamespace
    where nsp.nspname = 'public'
      and tbl.relname = 'employees'
      and idx.indisunique
      and idx.indnkeyatts = 1
      and idx.indexprs is not null
      and regexp_replace(
            regexp_replace(lower(pg_get_expr(idx.indexprs, idx.indrelid)), '\s+', '', 'g'),
            'trim\(bothfromemail\)|btrim\(email\)|trim\(email\)',
            'work_email',
            'g'
          ) = 'lower(work_email)'
  ) or exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'employees'
      and indexdef ~* '^create unique index '
      and regexp_replace(
            regexp_replace(
              substring(lower(indexdef) from 'using btree \((.*)\) where'),
              '\s+', '', 'g'
            ),
            'trim\(bothfromemail\)|btrim\(email\)|trim\(email\)',
            'work_email',
            'g'
          ) = 'lower(work_email)'
  ) then
    return;
  end if;

  if exists (
    select 1
    from (
      select lower(btrim(email)) as normalized_email
      from public.employees
      where email is not null
        and btrim(email) <> ''
      group by lower(btrim(email))
      having count(*) > 1
    ) duplicates
  ) then
    raise notice 'employees.email has duplicate work emails; unique index employees_work_email_unique skipped.';
    return;
  end if;

  create unique index if not exists employees_work_email_unique
    on public.employees (lower(btrim(email)))
    where email is not null and btrim(email) <> '';
exception
  when unique_violation then
    raise notice 'employees.email has duplicate work emails; unique index employees_work_email_unique skipped.';
end
$body$;
