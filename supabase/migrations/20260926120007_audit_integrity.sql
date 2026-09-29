-- Audit history is append-only. Clients write only through log_audit_event
-- (security definer, owner privileges). IP and user agent are filled here
-- from the PostgREST request when the caller leaves them null, so existing
-- RPC signatures stay the same. Admin and HR in the caller's organization
-- can read the log; nobody authenticated can update or delete it.

do $cols$
begin
  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_logs'
      and column_name in ('organization_id', 'ip_address', 'user_agent')
  ) < 3 then
    raise exception 'audit_logs is missing organization_id, ip_address, or user_agent';
  end if;
end;
$cols$;

-- ------------------------------------------------------------
-- Append-only
-- ------------------------------------------------------------

revoke insert, update, delete, truncate on table public.audit_logs from public;
revoke insert, update, delete, truncate on table public.audit_logs from anon;
revoke insert, update, delete, truncate on table public.audit_logs from authenticated;

grant select on table public.audit_logs to authenticated;

-- Drop any client write policy. Select policies stay. The live catalog has
-- audit_logs_admin_select (is_admin() and organization_id = current_org_id());
-- older tracked names (audit_logs_insert / _update / _delete) may still exist.
do $drop_writes$
declare
  v_policy text;
begin
  for v_policy in
    select pol.polname
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'audit_logs'
      and pol.polcmd::text in ('a', 'w', 'd', '*')
  loop
    execute format('drop policy %I on public.audit_logs', v_policy);
  end loop;
end;
$drop_writes$;

create or replace function public.audit_logs_block_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  raise exception 'audit_logs is append-only';
end;
$fn$;

revoke all on function public.audit_logs_block_mutation() from public, anon, authenticated;

drop trigger if exists audit_logs_append_only on public.audit_logs;
create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row
  execute function public.audit_logs_block_mutation();

-- Fires for the table owner too, including when session_replication_role is replica.
alter table public.audit_logs enable always trigger audit_logs_append_only;

drop trigger if exists audit_logs_block_truncate on public.audit_logs;
create trigger audit_logs_block_truncate
  before truncate on public.audit_logs
  for each statement
  execute function public.audit_logs_block_mutation();

alter table public.audit_logs enable always trigger audit_logs_block_truncate;

-- ------------------------------------------------------------
-- IP and user agent from the PostgREST request
-- ------------------------------------------------------------

create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_old_data jsonb default null,
  p_new_data jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_headers jsonb;
  v_forwarded text;
  v_ip inet;
  v_user_agent text;
begin
  v_org := public.current_org_id();
  if v_org is null then
    return;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  if v_headers is not null then
    v_forwarded := nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), '');
    v_user_agent := nullif(btrim(coalesce(v_headers->>'user-agent', '')), '');

    if v_forwarded is not null then
      begin
        v_ip := v_forwarded::inet;
      exception when others then
        v_ip := null;
      end;
    end if;
  end if;

  insert into public.audit_logs (
    organization_id,
    user_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data,
    ip_address,
    user_agent
  )
  values (
    v_org,
    auth.uid(),
    p_action,
    p_entity_type,
    p_entity_id,
    p_old_data,
    p_new_data,
    v_ip,
    v_user_agent
  );
end;
$fn$;

revoke all on function public.log_audit_event(text, text, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.log_audit_event(text, text, uuid, jsonb, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------
-- HR can read this organization's log
-- organization_id is written by log_audit_event from current_org_id().
-- ------------------------------------------------------------

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_admin_hr_select on public.audit_logs;
create policy audit_logs_admin_hr_select on public.audit_logs for select
  using (public.is_admin_or_hr() and organization_id = public.current_org_id());
