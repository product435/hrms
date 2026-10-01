-- Phase 4: AI analysis layer. Separate from kpi_scores; nothing here writes to kpi_scores.
-- Rows are written only by the analyze-dwr Edge Function (service role).

create table if not exists public.dwr_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'ok' check (status in ('ok', 'insufficient_data')),
  model text,
  prompt_version text not null,
  scores jsonb,
  summary_text text,
  strengths jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  on_time_stats jsonb,
  input_hash text not null,
  tokens_used integer not null default 0,
  requested_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint dwr_ai_period_ok check (period_end >= period_start),
  unique (employee_id, period_start, period_end, prompt_version)
);

create table if not exists public.dwr_ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references public.employees(id) on delete set null,
  trigger_source text not null default 'manual' check (trigger_source in ('manual', 'cron')),
  period_start date not null,
  period_end date not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  employees_total integer not null default 0,
  analyzed integer not null default 0,
  cached integer not null default 0,
  insufficient integer not null default 0,
  failed integer not null default 0,
  tokens_used integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_dwr_ai_analyses_org_period on public.dwr_ai_analyses (organization_id, period_end desc);
create index if not exists idx_dwr_ai_analyses_employee on public.dwr_ai_analyses (employee_id, period_end desc);
create index if not exists idx_dwr_ai_runs_org on public.dwr_ai_runs (organization_id, started_at desc);

alter table public.dwr_ai_analyses enable row level security;
alter table public.dwr_ai_runs enable row level security;

drop policy if exists dwr_ai_analyses_select on public.dwr_ai_analyses;
create policy dwr_ai_analyses_select on public.dwr_ai_analyses
  for select
  using (
    organization_id = public.dwr_actor_org()
    and (
      public.current_user_role() in ('admin', 'hr')
      or public.can_view_employee(employee_id)
    )
  );

drop policy if exists dwr_ai_runs_select on public.dwr_ai_runs;
create policy dwr_ai_runs_select on public.dwr_ai_runs
  for select
  using (
    organization_id = public.dwr_actor_org()
    and public.current_user_role() in ('admin', 'hr')
  );

revoke all on public.dwr_ai_analyses from public, anon, authenticated;
revoke all on public.dwr_ai_runs from public, anon, authenticated;
grant select on public.dwr_ai_analyses to authenticated;
grant select on public.dwr_ai_runs to authenticated;
grant select, insert, update, delete on public.dwr_ai_analyses to service_role;
grant select, insert, update, delete on public.dwr_ai_runs to service_role;
