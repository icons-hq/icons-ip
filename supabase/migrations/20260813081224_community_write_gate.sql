-- Keep user-authored community writes closed until the policy's human
-- operations, alerting, and legal workflows exist. Reopening any capability is
-- intentionally a database-owner migration, not an admin/app runtime toggle.

create table private.community_write_control (
  singleton boolean primary key default true,
  post_create_enabled boolean not null default false,
  post_edit_enabled boolean not null default false,
  comment_create_enabled boolean not null default false,
  comment_edit_enabled boolean not null default false,
  changed_at timestamptz not null default now(),
  constraint community_write_control_singleton_check check (singleton)
);

insert into private.community_write_control (
  singleton,
  post_create_enabled,
  post_edit_enabled,
  comment_create_enabled,
  comment_edit_enabled
)
values (true, false, false, false, false);

alter table private.community_write_control enable row level security;

revoke all on table private.community_write_control
  from public, anon, authenticated, service_role;

-- Storage RLS uses this fixed-search-path predicate as an additional
-- restrictive policy. Non-community paths keep their existing policy contract;
-- community uploads follow the same post-create capability as the post row.
create function private.can_write_community_storage_object(target_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_name !~ '^[^/]+/community/'
    or coalesce(
      (
        select control.post_create_enabled
        from private.community_write_control as control
        where control.singleton
      ),
      false
    );
$$;

revoke all on function private.can_write_community_storage_object(text)
  from public, anon, authenticated, service_role;
grant execute on function private.can_write_community_storage_object(text)
  to authenticated;

create policy user_uploads_community_write_gate_insert
on storage.objects
as restrictive
for insert
to authenticated
with check (
  bucket_id <> 'user-uploads'
  or private.can_write_community_storage_object(name)
);

-- Storage upsert needs UPDATE in addition to INSERT. No permissive UPDATE
-- policy exists today, so updates remain closed; this restriction also prevents
-- a future permissive policy from silently bypassing the community gate.
create policy user_uploads_community_write_gate_update
on storage.objects
as restrictive
for update
to authenticated
using (
  bucket_id <> 'user-uploads'
  or private.can_write_community_storage_object(name)
)
with check (
  bucket_id <> 'user-uploads'
  or private.can_write_community_storage_object(name)
);

-- Database-owner sessions need to seed historical fixtures and run future
-- reviewed migrations. SET ROLE application requests remain subject to the
-- gate, including writes issued inside SECURITY DEFINER RPCs.
create function private.is_community_write_maintenance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select session_user = (
      select pg_catalog.pg_get_userbyid(database.datdba)
      from pg_catalog.pg_database as database
      where database.datname = pg_catalog.current_database()
    )
    and (
      coalesce(
        nullif(pg_catalog.current_setting('role', true), ''),
        'none'
      ) = 'none'
      or pg_catalog.current_setting('role', true) = session_user
    );
$$;

revoke all on function private.is_community_write_maintenance()
  from public, anon, authenticated, service_role;

create function private.guard_community_post_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_enabled boolean := false;
  moderation_hide_only boolean := false;
begin
  -- App-role requests may enter through SECURITY DEFINER RPCs. The session
  -- helper stays false whenever SET ROLE carries an application role.
  if private.is_community_write_maintenance() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select control.post_create_enabled
      into selected_enabled
    from private.community_write_control as control
    where control.singleton;
  elsif tg_op = 'UPDATE' then
    moderation_hide_only := new.status = 'hidden'
      and (to_jsonb(new) - 'status' - 'updated_at')
        is not distinct from
        (to_jsonb(old) - 'status' - 'updated_at');

    if moderation_hide_only then
      return new;
    end if;

    select control.post_edit_enabled
      into selected_enabled
    from private.community_write_control as control
    where control.singleton;
  end if;

  if not coalesce(selected_enabled, false) then
    raise exception 'community_writes_disabled' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_community_post_write()
  from public, anon, authenticated, service_role;

create function private.guard_community_comment_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_enabled boolean := false;
  moderation_hide_only boolean := false;
begin
  if private.is_community_write_maintenance() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select control.comment_create_enabled
      into selected_enabled
    from private.community_write_control as control
    where control.singleton;
  elsif tg_op = 'UPDATE' then
    moderation_hide_only := new.status = 'hidden'
      and (to_jsonb(new) - 'status' - 'updated_at')
        is not distinct from
        (to_jsonb(old) - 'status' - 'updated_at');

    if moderation_hide_only then
      return new;
    end if;

    select control.comment_edit_enabled
      into selected_enabled
    from private.community_write_control as control
    where control.singleton;
  end if;

  if not coalesce(selected_enabled, false) then
    raise exception 'community_writes_disabled' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_community_comment_write()
  from public, anon, authenticated, service_role;

create trigger trg_community_write_gate_posts
before insert or update on public.posts
for each row execute function private.guard_community_post_write();

create trigger trg_community_write_gate_comments
before insert or update on public.comments
for each row execute function private.guard_community_comment_write();

-- The app may read capabilities to fail closed before uploading an image. It
-- cannot mutate the authoritative private row or invoke either trigger helper.
create function public.community_write_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select pg_catalog.jsonb_build_object(
        'postCreate', control.post_create_enabled,
        'postEdit', control.post_edit_enabled,
        'commentCreate', control.comment_create_enabled,
        'commentEdit', control.comment_edit_enabled
      )
      from private.community_write_control as control
      where control.singleton
    ),
    pg_catalog.jsonb_build_object(
      'postCreate', false,
      'postEdit', false,
      'commentCreate', false,
      'commentEdit', false
    )
  );
$$;

revoke all on function public.community_write_capabilities()
  from public, anon, authenticated, service_role;
grant execute on function public.community_write_capabilities()
  to anon, authenticated;
