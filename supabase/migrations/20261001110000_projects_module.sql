-- Projects module: membership-based access scope, update feed, task checklist.
-- Membership (project_members) is a separate scope from can_view_employee so
-- cross-department collaboration does not widen salary/document access.

-- ------------------------------------------------------------
-- projects: extend stub
-- ------------------------------------------------------------
alter table public.projects
  add column if not exists description text,
  add column if not exists owner_id uuid references public.employees(id) on delete set null,
  add column if not exists status text not null default 'planning',
  add column if not exists start_date date,
  add column if not exists due_date date,
  add column if not exists priority text not null default 'medium',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz;

alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('planning', 'active', 'on-hold', 'completed', 'cancelled'));
alter table public.projects drop constraint if exists projects_priority_check;
alter table public.projects add constraint projects_priority_check
  check (priority in ('low', 'medium', 'high', 'urgent'));
alter table public.projects drop constraint if exists projects_dates_check;
alter table public.projects add constraint projects_dates_check
  check (start_date is null or due_date is null or due_date >= start_date);

-- ------------------------------------------------------------
-- project_members / project_messages
-- ------------------------------------------------------------
create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role_in_project text not null default 'contributor'
    check (role_in_project in ('owner', 'manager', 'contributor', 'observer')),
  added_by uuid references public.employees(id) on delete set null,
  added_at timestamptz not null default now(),
  unique (project_id, employee_id)
);
create index if not exists project_members_employee_idx on public.project_members (employee_id);

create table if not exists public.project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid references public.employees(id) on delete set null,
  body_html text not null default '',
  body_text text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint project_messages_body_len check (char_length(body_text) between 1 and 5000)
);
create index if not exists project_messages_project_idx on public.project_messages (project_id, created_at desc);

alter table public.tasks
  add column if not exists source_message_id uuid references public.project_messages(id) on delete set null;
create index if not exists tasks_project_idx on public.tasks (project_id);

-- ------------------------------------------------------------
-- Access helpers
-- ------------------------------------------------------------
create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id
      and m.employee_id = public.current_employee_id()
  );
$$;

create or replace function public.shares_project_with(p_employee_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.employee_id = public.current_employee_id()
      and theirs.employee_id = p_employee_id
  );
$$;

create or replace function public.can_manage_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_project_id is not null and (
    exists (
      select 1 from public.projects p
      where p.id = p_project_id
        and p.organization_id = public.dwr_actor_org()
        and (
          public.current_user_role() in ('admin', 'hr')
          or p.owner_id = public.current_employee_id()
        )
    )
    or exists (
      select 1 from public.project_members m
      where m.project_id = p_project_id
        and m.employee_id = public.current_employee_id()
        and m.role_in_project in ('owner', 'manager')
    )
  );
$$;

create or replace function public.is_project_member_of(p_project_id uuid, p_employee_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id and m.employee_id = p_employee_id
  );
$$;

-- ------------------------------------------------------------
-- Triggers: projects
-- ------------------------------------------------------------
create or replace function public.projects_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, public.current_employee_id());
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_before_write_trigger on public.projects;
create trigger projects_before_write_trigger
  before insert or update on public.projects
  for each row execute function public.projects_before_write();

create or replace function public.projects_after_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.owner_id is not null then
    insert into public.project_members (project_id, employee_id, role_in_project, added_by)
    values (new.id, new.owner_id, 'owner', public.current_employee_id())
    on conflict (project_id, employee_id)
    do update set role_in_project = 'owner';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_after_write_trigger on public.projects;
create trigger projects_after_write_trigger
  after insert or update of owner_id on public.projects
  for each row execute function public.projects_after_write();

-- ------------------------------------------------------------
-- Triggers: project_members
-- ------------------------------------------------------------
create or replace function public.project_members_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_open int;
  v_owner uuid;
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.projects p
      join public.employees e on e.id = new.employee_id
      where p.id = new.project_id and p.organization_id = e.organization_id
    ) then
      raise exception 'Employee is not in this project''s organisation.';
    end if;
    new.added_by := coalesce(new.added_by, public.current_employee_id());
    return new;
  elsif tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
       or new.employee_id is distinct from old.employee_id then
      raise exception 'Project and employee cannot be changed on a membership.';
    end if;
    select owner_id into v_owner from public.projects where id = old.project_id;
    if old.employee_id = v_owner and new.role_in_project <> 'owner' then
      raise exception 'The project owner must keep the owner role. Transfer ownership first.';
    end if;
    return new;
  else
    -- DELETE. Skip checks when the project itself is being deleted (cascade).
    select owner_id into v_owner from public.projects where id = old.project_id;
    if not found then
      return old;
    end if;
    if old.employee_id = v_owner then
      raise exception 'The project owner cannot be removed. Transfer ownership first.';
    end if;
    select count(*) into v_open
    from public.tasks t
    where t.project_id = old.project_id
      and t.assigned_to = old.employee_id
      and t.status <> 'done';
    if v_open > 0 then
      raise exception 'Cannot remove this member: % open task(s) are still assigned to them. Reassign or complete them first.', v_open;
    end if;
    return old;
  end if;
end;
$$;

drop trigger if exists project_members_guard_trigger on public.project_members;
create trigger project_members_guard_trigger
  before insert or update or delete on public.project_members
  for each row execute function public.project_members_guard();

-- ------------------------------------------------------------
-- Triggers: project_messages (plain mirror, mention validation, notifications)
-- ------------------------------------------------------------
create or replace function public.project_messages_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_text text;
begin
  if tg_op = 'INSERT' then
    new.author_id := public.current_employee_id();
    new.edited_at := null;
    new.deleted_at := null;
  else
    if new.project_id is distinct from old.project_id
       or new.author_id is distinct from old.author_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Immutable message fields cannot be changed.';
    end if;
    if new.body_text is distinct from old.body_text then
      if old.author_id is distinct from public.current_employee_id() then
        raise exception 'Only the author can edit a message.';
      end if;
      new.edited_at := now();
    end if;
  end if;

  v_text := btrim(coalesce(new.body_text, ''));
  new.body_text := v_text;
  -- The plain text is the source of truth; HTML is derived and always escaped.
  new.body_html := '<p>' || replace(replace(replace(replace(v_text, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>') || '</p>';

  -- Keep only mentions that are current members of this project.
  select coalesce(array_agg(distinct m.employee_id), '{}')
    into new.mentions
  from public.project_members m
  where m.project_id = new.project_id
    and m.employee_id = any (coalesce(new.mentions, '{}'));
  return new;
end;
$$;

drop trigger if exists project_messages_before_write_trigger on public.project_messages;
create trigger project_messages_before_write_trigger
  before insert or update on public.project_messages
  for each row execute function public.project_messages_before_write();

create or replace function public.project_messages_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_emp uuid;
  v_name text;
  v_project text;
begin
  if array_length(new.mentions, 1) is null then
    return new;
  end if;
  select p.name into v_project from public.projects p where p.id = new.project_id;
  select btrim(e.first_name || ' ' || coalesce(e.last_name, '')) into v_name from public.employees e where e.id = new.author_id;
  foreach v_emp in array new.mentions loop
    if v_emp is distinct from new.author_id then
      perform public.dwr_notify(
        v_emp,
        coalesce(v_name, 'Someone') || ' mentioned you in ' || coalesce(v_project, 'a project'),
        left(new.body_text, 200),
        'project_message',
        new.id,
        false
      );
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists project_messages_notify_trigger on public.project_messages;
create trigger project_messages_notify_trigger
  after insert on public.project_messages
  for each row execute function public.project_messages_notify();

-- ------------------------------------------------------------
-- tasks_guard_write: project managers may edit project tasks
-- ------------------------------------------------------------
create or replace function public.tasks_guard_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.organization_id is null then
      select e.organization_id into new.organization_id
      from public.employees e
      where e.id = new.assigned_to;
    end if;
  elsif public.can_manage_employee(old.assigned_to)
     or public.current_user_role() in ('admin', 'hr')
     or (old.project_id is not null and public.can_manage_project(old.project_id)) then
    null;
  elsif old.assigned_to = public.current_employee_id() then
    if new.assigned_to is distinct from old.assigned_to
       or new.assigned_by is distinct from old.assigned_by
       or new.organization_id is distinct from old.organization_id
       or new.project_id is distinct from old.project_id
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.priority is distinct from old.priority
       or new.due_date is distinct from old.due_date
       or new.estimated_hours is distinct from old.estimated_hours
       or new.source_message_id is distinct from old.source_message_id
    then
      raise exception 'You can only update the status of a task assigned to you.';
    end if;
  else
    raise exception 'You cannot update this task.';
  end if;

  if new.project_id is not null and not exists (
    select 1
    from public.projects p
    where p.id = new.project_id
      and p.organization_id = new.organization_id
  ) then
    raise exception 'Project is not in this organisation.';
  end if;

  if new.status = 'done' then
    if tg_op = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status is distinct from 'done' or new.completed_at is null then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.project_members enable row level security;
alter table public.project_messages enable row level security;

-- projects: replace policies (no stacking). No delete policy: archive instead.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (
    organization_id = public.dwr_actor_org()
    and (
      public.current_user_role() in ('admin', 'hr')
      or public.is_lead()
      or owner_id = public.current_employee_id()
      or public.is_project_member(id)
    )
  );

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (
    organization_id = public.dwr_actor_org()
    and (public.current_user_role() in ('admin', 'hr') or public.is_lead())
  );

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (organization_id = public.dwr_actor_org() and public.can_manage_project(id))
  with check (organization_id = public.dwr_actor_org());

-- project_members
drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
  for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_members.project_id
        and p.organization_id = public.dwr_actor_org()
    )
    and (
      public.current_user_role() in ('admin', 'hr')
      or public.is_lead()
      or public.is_project_member(project_id)
    )
  );

drop policy if exists project_members_insert on public.project_members;
create policy project_members_insert on public.project_members
  for insert to authenticated
  with check (public.can_manage_project(project_id));

drop policy if exists project_members_update on public.project_members;
create policy project_members_update on public.project_members
  for update to authenticated
  using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));

drop policy if exists project_members_delete on public.project_members;
create policy project_members_delete on public.project_members
  for delete to authenticated
  using (public.can_manage_project(project_id));

-- project_messages: gated on CURRENT membership, not authorship
drop policy if exists project_messages_select on public.project_messages;
create policy project_messages_select on public.project_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_messages.project_id
        and p.organization_id = public.dwr_actor_org()
    )
    and (
      public.current_user_role() in ('admin', 'hr')
      or public.is_project_member(project_id)
    )
  );

drop policy if exists project_messages_insert on public.project_messages;
create policy project_messages_insert on public.project_messages
  for insert to authenticated
  with check (public.is_project_member(project_id));

-- update = edit own message, or soft-delete by author / project manager
drop policy if exists project_messages_update on public.project_messages;
create policy project_messages_update on public.project_messages
  for update to authenticated
  using (
    author_id = public.current_employee_id()
    or public.can_manage_project(project_id)
  )
  with check (
    author_id = public.current_employee_id()
    or public.can_manage_project(project_id)
  );

-- tasks: replace policies (overlapping permissive policies would OR together)
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    organization_id = public.dwr_actor_org()
    and (
      public.can_view_employee(assigned_to)
      or assigned_by = public.current_employee_id()
      or (project_id is not null and public.is_project_member(project_id))
    )
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    assigned_by = public.current_employee_id()
    and organization_id = (select e.organization_id from public.employees e where e.id = assigned_to)
    and (
      public.can_manage_employee(assigned_to)
      or (
        project_id is not null
        and public.can_manage_project(project_id)
        and public.is_project_member_of(project_id, assigned_to)
      )
    )
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    organization_id = public.dwr_actor_org()
    and (
      assigned_to = public.current_employee_id()
      or public.can_manage_employee(assigned_to)
      or (project_id is not null and public.can_manage_project(project_id))
    )
  )
  with check (
    organization_id = public.dwr_actor_org()
    and (
      assigned_to = public.current_employee_id()
      or public.can_manage_employee(assigned_to)
      or (
        project_id is not null
        and public.can_manage_project(project_id)
        and public.is_project_member_of(project_id, assigned_to)
      )
    )
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (
    organization_id = public.dwr_actor_org()
    and (
      public.can_manage_employee(assigned_to)
      or (project_id is not null and public.can_manage_project(project_id))
    )
  );

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
revoke all on public.project_members, public.project_messages from public, anon;
revoke delete on public.projects from authenticated;
grant select, insert, update, delete on public.project_members to authenticated, service_role;
grant select, insert, update on public.project_messages to authenticated, service_role;

revoke all on function public.is_project_member(uuid) from public, anon;
revoke all on function public.shares_project_with(uuid) from public, anon;
revoke all on function public.can_manage_project(uuid) from public, anon;
revoke all on function public.is_project_member_of(uuid, uuid) from public, anon;
grant execute on function public.is_project_member(uuid) to authenticated, service_role;
grant execute on function public.shares_project_with(uuid) to authenticated, service_role;
grant execute on function public.can_manage_project(uuid) to authenticated, service_role;
grant execute on function public.is_project_member_of(uuid, uuid) to authenticated, service_role;

-- Realtime feed
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_messages'
     ) then
    alter publication supabase_realtime add table public.project_messages;
  end if;
end $$;

-- Backfill: existing projects get their owner as a member (if any owner set).
insert into public.project_members (project_id, employee_id, role_in_project)
select p.id, p.owner_id, 'owner' from public.projects p where p.owner_id is not null
on conflict do nothing;
