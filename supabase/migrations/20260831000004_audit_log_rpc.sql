-- audit_logs previously had a working admin-only SELECT policy but no write
-- path at all (no INSERT policy, nothing calling one) -- the table was fully
-- readable and permanently empty. This adds a controlled write path via a
-- SECURITY DEFINER RPC rather than opening a raw INSERT policy: the caller
-- can never spoof organization_id or user_id (both resolved server-side from
-- the caller's own session), and still cannot read any row -- audit_logs
-- stays admin-read-only exactly as before.

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
set search_path to 'public'
as $$
declare
  v_org uuid;
begin
  v_org := public.current_org_id();
  if v_org is null then
    -- No org context yet (e.g. a profile not linked to an employee) --
    -- nothing meaningful to attribute the entry to.
    return;
  end if;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, old_data, new_data)
  values (v_org, auth.uid(), p_action, p_entity_type, p_entity_id, p_old_data, p_new_data);
end;
$$;

grant execute on function public.log_audit_event(text, text, uuid, jsonb, jsonb) to authenticated;
