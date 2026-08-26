-- Reconciles migration history with the actual live/working shape of
-- performance_reviews. The original create-table migration
-- (20260818000000_kinetix_hrms.sql) defined organization_id, cycle,
-- self_score, manager_score, review_notes, created_at, and a status CHECK
-- constraint -- none of which exist on the live table today (confirmed by
-- direct live schema introspection: the actual columns are id, employee_id,
-- reviewer_id, review_cycle, self_rating, manager_rating, final_rating,
-- feedback, status, reviewed_at, with no CHECK constraint on status). That
-- drift predates this migration history and was never applied through it.
--
-- Every statement here is a guarded no-op against the CURRENT live
-- database (the target column names already exist, the obsolete ones
-- already don't) -- nothing here touches live data. Its only purpose is
-- reproducibility: replaying the full migration history from scratch
-- against a fresh database must land on the same shape that is actually
-- running in production.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'performance_reviews' and column_name = 'cycle') then
    alter table public.performance_reviews rename column cycle to review_cycle;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'performance_reviews' and column_name = 'self_score') then
    alter table public.performance_reviews rename column self_score to self_rating;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'performance_reviews' and column_name = 'manager_score') then
    alter table public.performance_reviews rename column manager_score to manager_rating;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'performance_reviews' and column_name = 'review_notes') then
    alter table public.performance_reviews rename column review_notes to feedback;
  end if;
end $$;

alter table public.performance_reviews add column if not exists reviewed_at timestamptz;
alter table public.performance_reviews drop column if exists organization_id;
alter table public.performance_reviews drop column if exists created_at;
alter table public.performance_reviews drop column if exists updated_at;
alter table public.performance_reviews drop constraint if exists performance_reviews_status_check;
