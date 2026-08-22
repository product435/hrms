-- startRun() upserts on (organization_id, year, month) so re-opening a run
-- for the same period doesn't create a duplicate, but no such unique
-- constraint existed -- every "Start payroll run" click failed with
-- PostgREST 42P10 ("no unique or exclusion constraint matching the ON
-- CONFLICT specification"), a pre-existing bug unrelated to this pass's
-- other payroll changes.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payroll_runs_org_period_unique'
  ) then
    alter table public.payroll_runs
      add constraint payroll_runs_org_period_unique unique (organization_id, year, month);
  end if;
end $$;
