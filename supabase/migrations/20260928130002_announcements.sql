-- Announcement targeting, expiry, and read state.
-- Existing rows stay organization-wide: target_scope defaults to organization
-- with no department or role, so they remain visible to the whole org.
-- Location targeting is intentionally absent (there is no locations table).

alter table public.announcements
  add column if not exists content text,
  add column if not exists expires_at timestamptz,
  add column if not exists is_active boolean default true,
  add column if not exists priority text,
  add column if not exists published_at timestamptz default now(),
  add column if not exists published_by uuid,
  add column if not exists target_scope text default 'organization',
  add column if not exists target_department_id uuid,
  add column if not exists target_role text;

-- Older replay schemas stored the body separately. Keep that text visible.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'announcements' and column_name = 'body'
  ) then
    update public.announcements
    set content = body
    where content is null and body is not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'announcements' and column_name = 'published_on'
  ) then
    update public.announcements
    set published_at = published_on
    where published_at is null and published_on is not null;
  end if;
end $$;

update public.announcements
set target_scope = 'organization'
where target_scope is null;

update public.announcements
set is_active = true
where is_active is null
  and target_scope = 'organization'
  and target_department_id is null
  and target_role is null;

alter table public.announcements
  alter column target_scope set default 'organization';

alter table public.announcements
  alter column target_scope set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'announcements_published_by_fk'
  ) then
    alter table public.announcements
      add constraint announcements_published_by_fk
      foreign key (published_by) references public.profiles(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'announcements_target_department_id_fkey'
  ) then
    alter table public.announcements
      add constraint announcements_target_department_id_fkey
      foreign key (target_department_id) references public.departments(id) on delete restrict;
  end if;
end $$;

alter table public.announcements drop constraint if exists announcements_target_scope_check;
alter table public.announcements drop constraint if exists announcements_target_shape_check;

alter table public.announcements
  add constraint announcements_target_scope_check
  check (target_scope in ('organization', 'department', 'role'));

alter table public.announcements
  add constraint announcements_target_shape_check
  check (
    (
      target_scope = 'organization'
      and target_department_id is null
      and target_role is null
    )
    or (
      target_scope = 'department'
      and target_department_id is not null
      and target_role is null
    )
    or (
      target_scope = 'role'
      and target_department_id is null
      and target_role in ('admin', 'hr', 'dept_head', 'team_lead', 'employee')
    )
  );

create index if not exists idx_announcements_org_visibility
  on public.announcements (organization_id, is_active, expires_at);

-- Reader may be the signed-in profile, the employee record, or both.
-- Partial unique indexes keep one read row per announcement per reader.
create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  read_at timestamptz not null default now(),
  constraint announcement_reads_reader_present check (user_id is not null or employee_id is not null)
);

alter table public.announcement_reads
  add column if not exists id uuid,
  add column if not exists employee_id uuid,
  add column if not exists read_at timestamptz default now();

update public.announcement_reads
set id = gen_random_uuid()
where id is null;

alter table public.announcement_reads
  alter column id set default gen_random_uuid();

alter table public.announcement_reads
  alter column read_at set default now();

update public.announcement_reads
set read_at = now()
where read_at is null;

alter table public.announcement_reads
  alter column read_at set not null;

do $$
declare
  v_pk name;
  v_cols text[];
begin
  select c.conname, array_agg(a.attname order by u.ord)
    into v_pk, v_cols
  from pg_constraint c
  join lateral unnest(c.conkey) with ordinality as u(attnum, ord) on true
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
  where c.conrelid = 'public.announcement_reads'::regclass
    and c.contype = 'p'
  group by c.conname;

  if v_pk is not null
     and v_cols @> array['announcement_id', 'user_id']
     and v_cols <@ array['announcement_id', 'user_id'] then
    execute format('alter table public.announcement_reads drop constraint %I', v_pk);
  end if;
end $$;

alter table public.announcement_reads
  alter column user_id drop not null;

alter table public.announcement_reads
  alter column id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.announcement_reads'::regclass
      and contype = 'p'
  ) then
    alter table public.announcement_reads
      add constraint announcement_reads_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'announcement_reads_employee_id_fkey'
  ) then
    alter table public.announcement_reads
      add constraint announcement_reads_employee_id_fkey
      foreign key (employee_id) references public.employees(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'announcement_reads_announcement_id_fkey'
  ) then
    alter table public.announcement_reads
      add constraint announcement_reads_announcement_id_fkey
      foreign key (announcement_id) references public.announcements(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'announcement_reads_user_id_fkey'
  ) then
    alter table public.announcement_reads
      add constraint announcement_reads_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

alter table public.announcement_reads drop constraint if exists announcement_reads_reader_present;
alter table public.announcement_reads
  add constraint announcement_reads_reader_present
  check (user_id is not null or employee_id is not null);

create unique index if not exists ux_announcement_reads_user
  on public.announcement_reads (announcement_id, user_id)
  where user_id is not null;

create unique index if not exists ux_announcement_reads_employee
  on public.announcement_reads (announcement_id, employee_id)
  where employee_id is not null;

create index if not exists idx_announcement_reads_announcement
  on public.announcement_reads (announcement_id);

alter table public.announcement_reads enable row level security;

-- One in-app notification per announcement per user. Skip when the live
-- notifications shape does not have the reference columns this insert uses.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications' and column_name = 'reference_type'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications' and column_name = 'reference_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications' and column_name = 'user_id'
  ) then
    delete from public.notifications newer
    using public.notifications older
    where newer.reference_type = 'announcement'
      and older.reference_type = 'announcement'
      and newer.user_id is not null
      and newer.user_id = older.user_id
      and newer.reference_id is not null
      and newer.reference_id = older.reference_id
      and newer.id > older.id;

    execute $index$
      create unique index if not exists ux_notifications_announcement_recipient
      on public.notifications (user_id, reference_id)
      where reference_type = 'announcement'
        and user_id is not null
        and reference_id is not null
    $index$;
  end if;
end $$;

create or replace function public.announcement_visible_to_current_user(
  p_organization_id uuid,
  p_is_active boolean,
  p_expires_at timestamptz,
  p_target_scope text,
  p_target_department_id uuid,
  p_target_role text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_organization_id is not null
    and p_organization_id = public.current_org_id()
    and coalesce(p_is_active, true)
    and (p_expires_at is null or p_expires_at > now())
    and (
      coalesce(p_target_scope, 'organization') = 'organization'
      or (
        p_target_scope = 'department'
        and p_target_department_id is not null
        and p_target_department_id = (
          select e.department_id
          from public.employees e
          where e.id = public.current_employee_id()
          limit 1
        )
      )
      or (
        p_target_scope = 'role'
        and p_target_role is not null
        and lower(p_target_role) = lower(coalesce(public.current_user_role(), ''))
      )
    );
$$;

revoke all on function public.announcement_visible_to_current_user(uuid, boolean, timestamptz, text, uuid, text) from public;
grant execute on function public.announcement_visible_to_current_user(uuid, boolean, timestamptz, text, uuid, text) to authenticated;

create or replace function public.notify_announcement_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op is null then
    raise exception 'Announcement notifications are written only by the database trigger.';
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(old.is_active, false) is true then
      return new;
    end if;
    if coalesce(new.is_active, false) is not true then
      return new;
    end if;
  end if;

  if not coalesce(new.is_active, true) then
    return new;
  end if;

  if new.expires_at is not null and new.expires_at <= now() then
    return new;
  end if;

  insert into public.notifications (user_id, title, message, type, reference_type, reference_id, is_read)
  select recipients.user_id,
         coalesce(nullif(btrim(new.title), ''), 'Announcement'),
         left(coalesce(new.content, ''), 280),
         'system',
         'announcement',
         new.id,
         false
  from (
    select distinct p.id as user_id
    from public.profiles p
    where coalesce(p.is_active, true)
      and exists (
        select 1
        from public.employees e
        where e.organization_id = new.organization_id
          and (e.profile_id = p.id or p.employee_id = e.id)
          and (
            coalesce(new.target_scope, 'organization') = 'organization'
            or (
              new.target_scope = 'department'
              and new.target_department_id is not null
              and e.department_id = new.target_department_id
            )
            or (
              new.target_scope = 'role'
              and new.target_role is not null
              and lower(coalesce(p.role, '')) = lower(new.target_role)
            )
          )
      )
  ) recipients
  where recipients.user_id is not null
  on conflict (user_id, reference_id)
    where reference_type = 'announcement'
      and user_id is not null
      and reference_id is not null
  do nothing;

  return new;
end;
$$;

revoke all on function public.notify_announcement_published() from public, anon;
grant execute on function public.notify_announcement_published() to authenticated, service_role;

drop trigger if exists announcements_notify_published on public.announcements;
create trigger announcements_notify_published
  after insert or update of is_active
  on public.announcements
  for each row
  execute function public.notify_announcement_published();

-- Employees cannot update announcement content. Admin and HR keep the
-- existing all-command policy. The broad org-wide read policy is replaced
-- so employees only see active, unexpired rows targeted at them. Admin and
-- HR still see unpublished and expired rows through announcements_write_admin_hr.
drop policy if exists announcements_read_all on public.announcements;
drop policy if exists announcements_select on public.announcements;
drop policy if exists announcements_insert on public.announcements;
drop policy if exists announcements_update on public.announcements;
drop policy if exists announcements_targeted_select on public.announcements;

do $$
declare
  r record;
begin
  for r in
    select pol.polname as name
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'announcements'
      and pol.polcmd::text in ('w', 'a')
  loop
    execute format('drop policy if exists %I on public.announcements', r.name);
  end loop;
end $$;

drop policy if exists announcements_write_admin_hr on public.announcements;
create policy announcements_write_admin_hr
  on public.announcements
  for all
  to authenticated
  using (public.is_admin_or_hr() and organization_id = public.current_org_id())
  with check (public.is_admin_or_hr() and organization_id = public.current_org_id());

create policy announcements_targeted_select
  on public.announcements
  for select
  to authenticated
  using (
    public.announcement_visible_to_current_user(
      organization_id,
      is_active,
      expires_at,
      target_scope,
      target_department_id,
      target_role
    )
  );

drop policy if exists announcement_reads_self_all on public.announcement_reads;
drop policy if exists announcement_reads_self_select on public.announcement_reads;
drop policy if exists announcement_reads_self_insert on public.announcement_reads;
drop policy if exists announcement_reads_self_update on public.announcement_reads;
drop policy if exists announcement_reads_self_delete on public.announcement_reads;

create policy announcement_reads_self_select
  on public.announcement_reads
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or (employee_id is not null and employee_id = public.current_employee_id())
  );

create policy announcement_reads_self_insert
  on public.announcement_reads
  for insert
  to authenticated
  with check (
    (user_id is not null or employee_id is not null)
    and (user_id is null or user_id = auth.uid())
    and (employee_id is null or employee_id = public.current_employee_id())
    and exists (
      select 1
      from public.announcements a
      where a.id = announcement_id
    )
  );

revoke update, delete on public.announcement_reads from anon, authenticated;
grant select, insert on public.announcement_reads to authenticated;
grant all on public.announcement_reads to service_role;
