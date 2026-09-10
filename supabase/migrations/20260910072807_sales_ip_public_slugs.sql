-- #473: keep internal catalog identity stable while making the public IP URL
-- editable. A previous canonical slug becomes an append-only alias and is
-- therefore never available for another IP or a later rename.

alter table public.ips
  add column public_slug text;

-- Existing internal ids were the public path before this seam existed. Keep
-- every currently reachable URL as the first canonical slug.
update public.ips
set public_slug = id
where public_slug is null;

alter table public.ips
  alter column public_slug set not null;

-- Do not add the editor's new strict format CHECK to the backfilled column.
-- Existing internal ids are historical public URLs and may be longer than 80
-- characters, end in a hyphen, or occupy a route that is now reserved. The
-- RPC and insert trigger below apply the strict contract only to new values.

create unique index ips_public_slug_key on public.ips (public_slug);

create table public.ip_public_slug_aliases (
  slug text primary key check (btrim(slug) <> ''),
  ip_id text not null references public.ips (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index ip_public_slug_aliases_ip_idx on public.ip_public_slug_aliases (ip_id);

alter table public.ip_public_slug_aliases enable row level security;
revoke insert, update, delete on public.ip_public_slug_aliases from anon, authenticated;
grant select on public.ip_public_slug_aliases to anon, authenticated;

-- Legacy metadata upserts do not know about public_slug yet. Existing-row
-- handling must happen before the global namespace lock: admin_upsert_ip can
-- already hold the IP row lock, while the identity RPC takes the global lock
-- before that row lock. This ordering avoids a row↔global advisory deadlock.
create function private.default_ip_public_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_public_slug text;
begin
  -- `admin_upsert_ip` uses INSERT ... ON CONFLICT(id) DO UPDATE. Its
  -- pre-existing call shape has no public_slug argument, so an update of a
  -- renamed IP must retain the current canonical value instead of treating
  -- the immutable id as a fresh slug candidate.
  select ip.public_slug
    into existing_public_slug
  from public.ips as ip
  where ip.id = new.id;
  if found then
    if new.public_slug is null then
      new.public_slug := existing_public_slug;
      return new;
    end if;
    if new.public_slug is distinct from existing_public_slug then
      raise insufficient_privilege using message = 'ip_public_slug_write_requires_rpc';
    end if;
    return new;
  end if;

  -- New internal IDs retain the existing catalog ID contract. A direct
  -- INSERT may only derive public_slug from that ID; selecting a different
  -- public slug belongs to the audited identity RPC after creation.
  if new.public_slug is null then
    new.public_slug := new.id;
  elsif new.public_slug is distinct from new.id then
    raise insufficient_privilege using message = 'ip_public_slug_write_requires_rpc';
  end if;

  -- Only the namespace check for a genuinely new ID needs the global lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ip_public_slug_identity', 0)
  );
  if exists (
    select 1 from public.ips as ip where ip.public_slug = new.public_slug
  ) or exists (
    select 1 from public.ip_public_slug_aliases as alias where alias.slug = new.public_slug
  ) then
    raise unique_violation using message = 'ip_public_slug_taken';
  end if;
  return new;
end;
$$;

revoke all on function private.default_ip_public_slug() from public, anon, authenticated, service_role;
create trigger ips_default_public_slug
before insert on public.ips
for each row execute function private.default_ip_public_slug();

-- Metadata upserts intentionally omit public_slug. Any other writer, including
-- a service-role maintenance script, must go through the alias-preserving RPC.
create function private.guard_ip_public_slug_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.public_slug is distinct from old.public_slug
     and coalesce(pg_catalog.current_setting('app.ip_public_slug_write', true), '')
       <> 'admin_update_ip_identity'
  then
    raise insufficient_privilege using message = 'ip_public_slug_write_requires_rpc';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_ip_public_slug_write() from public, anon, authenticated, service_role;
create trigger ips_public_slug_write_guard
before update of public_slug on public.ips
for each row execute function private.guard_ip_public_slug_write();

-- Aliases follow the same public visibility contract as their associated IP.
-- Staff can inspect draft/archived history in the workspace; anonymous readers
-- only see aliases whose target is currently published and unarchived.
drop policy if exists ip_public_slug_aliases_read on public.ip_public_slug_aliases;
create policy ip_public_slug_aliases_read
  on public.ip_public_slug_aliases for select
  using (
    exists (
      select 1
      from public.ips as ip
      where ip.id = ip_public_slug_aliases.ip_id
        and (
          (ip.archived_at is null and ip.published_at is not null)
          or (select public.is_staff())
        )
    )
  );

create function public.admin_update_ip_identity(
  target_id text,
  target_public_slug text,
  target_expected_public_slug text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_public_slug text;
begin
  if actor_id is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;
  if not public.is_staff() then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if target_id is null
     or target_id !~ '^[a-z0-9][a-z0-9-]*$'
     or target_public_slug is null
     or target_expected_public_slug is null
  then
    raise invalid_parameter_value using message = 'invalid_ip_identity';
  end if;
  if target_public_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'
     or target_public_slug = 'aouad'
  then
    raise invalid_parameter_value using message = 'invalid_ip_public_slug';
  end if;

  -- All slug checks and the alias append happen under one global identity lock.
  -- The row lock then makes the expected slug a real stale-write guard.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ip_public_slug_identity', 0)
  );
  select ip.public_slug
    into current_public_slug
  from public.ips as ip
  where ip.id = target_id
  for update of ip;

  if not found then
    raise no_data_found using message = 'catalog_not_found';
  end if;
  if current_public_slug is distinct from target_expected_public_slug then
    -- PostgREST retries SQLSTATE 40001 indefinitely. This is an expected
    -- business stale-write response, so use a private 409 class instead.
    raise exception using errcode = 'PT409', message = 'ip_public_slug_conflict';
  end if;
  if current_public_slug = target_public_slug then
    return false;
  end if;

  if exists (
    select 1 from public.ips as ip
    where ip.public_slug = target_public_slug
      and ip.id <> target_id
  ) or exists (
    select 1 from public.ip_public_slug_aliases as alias
    where alias.slug = target_public_slug
  ) then
    raise unique_violation using message = 'ip_public_slug_taken';
  end if;

  -- This FK deliberately prevents hard deletion of an IP whose old URL is a
  -- historical alias. The alias row is append-only and uniquely owned.
  insert into public.ip_public_slug_aliases (slug, ip_id)
  values (current_public_slug, target_id);

  perform pg_catalog.set_config('app.ip_public_slug_write', 'admin_update_ip_identity', true);
  update public.ips
  set public_slug = target_public_slug,
      updated_at = pg_catalog.now()
  where id = target_id;
  perform pg_catalog.set_config('app.ip_public_slug_write', '', true);

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'admin.ip.identity_updated',
    'ips:' || target_id,
    pg_catalog.jsonb_build_object(
      'internal_id', target_id,
      'previous_public_slug', current_public_slug,
      'public_slug', target_public_slug,
      'alias_preserved', true
    )
  );

  return true;
end;
$$;

revoke all on function public.admin_update_ip_identity(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_update_ip_identity(text, text, text) to authenticated;
