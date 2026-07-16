do $$
begin
  update storage.buckets
  set
    public = true,
    file_size_limit = 5 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  where id = 'public-media';

  if not found then
    raise exception using message = 'public-media bucket is missing';
  end if;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'admin-artwork-staging',
  'admin-artwork-staging',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.admin_artwork_upload_claims (
  path text primary key,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('ip', 'good', 'card', 'event')),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  source_size integer not null check (source_size between 1 and 5 * 1024 * 1024),
  final_size integer check (final_size between 1 and 5 * 1024 * 1024),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'verified', 'attached', 'rejected', 'expired')),
  expires_at timestamptz not null,
  processing_started_at timestamptz,
  verified_at timestamptz,
  attached_at timestamptz,
  resolved_at timestamptz,
  staging_cleaned_at timestamptz,
  cleanup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint admin_artwork_claim_path_format check (
    path ~ '^catalog/(ip|good|card|event)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  ),
  constraint admin_artwork_claim_kind_path check (
    path like 'catalog/' || kind || '/%'
  ),
  constraint admin_artwork_claim_mime_extension check (
    (mime_type = 'image/jpeg' and path like '%.jpg')
    or (mime_type = 'image/png' and path like '%.png')
    or (mime_type = 'image/webp' and path like '%.webp')
  ),
  constraint admin_artwork_claim_verified_state check (
    status not in ('verified', 'attached')
    or (verified_at is not null and final_size is not null)
  ),
  constraint admin_artwork_claim_processing_state check (
    status not in ('processing', 'verified', 'attached')
    or processing_started_at is not null
  ),
  constraint admin_artwork_claim_attached_state check (
    status <> 'attached' or attached_at is not null
  )
);

create index admin_artwork_upload_claims_cleanup_idx
  on public.admin_artwork_upload_claims (status, expires_at, created_at);
create index admin_artwork_upload_claims_actor_active_idx
  on public.admin_artwork_upload_claims (actor_id, status, expires_at);
create index admin_artwork_upload_claims_actor_processing_rate_idx
  on public.admin_artwork_upload_claims (actor_id, processing_started_at)
  where processing_started_at is not null;

alter table public.admin_artwork_upload_claims enable row level security;

revoke all on table public.admin_artwork_upload_claims
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.admin_artwork_upload_claims
  to service_role;

create or replace function public.service_prepare_admin_artwork_upload(
  p_actor_id uuid,
  p_path text,
  p_kind text,
  p_mime_type text,
  p_source_size integer,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null
    or p_path is null
    or p_kind is null
    or p_kind not in ('ip', 'good', 'card', 'event')
    or p_mime_type is null
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_source_size is null
    or p_source_size < 1
    or p_source_size > 5 * 1024 * 1024
    or p_expires_at is null
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '15 minutes'
    or p_path !~ '^catalog/(ip|good|card|event)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    or p_path not like 'catalog/' || p_kind || '/%'
    or not (
      (p_mime_type = 'image/jpeg' and p_path like '%.jpg')
      or (p_mime_type = 'image/png' and p_path like '%.png')
      or (p_mime_type = 'image/webp' and p_path like '%.webp')
    )
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-artwork-upload:' || p_actor_id::text, 0)
  );

  if (
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status in ('pending', 'processing', 'verified')
      and claim.expires_at > clock_timestamp()
  ) >= 4 then
    return false;
  end if;

  insert into public.admin_artwork_upload_claims (
    path,
    actor_id,
    kind,
    mime_type,
    source_size,
    expires_at
  )
  values (
    p_path,
    p_actor_id,
    p_kind,
    p_mime_type,
    p_source_size,
    p_expires_at
  )
  on conflict (path) do nothing;

  return found;
end;
$$;

create or replace function public.service_begin_admin_artwork_verification(
  p_actor_id uuid,
  p_path text
)
returns table (
  kind text,
  mime_type text,
  source_size integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null
    or p_path is null
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-artwork-upload:' || p_actor_id::text, 0)
  );

  if exists (
    select 1
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status = 'processing'
      and claim.expires_at > clock_timestamp()
  ) or (
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.processing_started_at >= clock_timestamp() - interval '1 minute'
  ) >= 4 then
    return;
  end if;

  return query
  update public.admin_artwork_upload_claims as claim
  set
    status = 'processing',
    processing_started_at = clock_timestamp()
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status = 'pending'
    and claim.expires_at > clock_timestamp()
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = claim.actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  returning claim.kind, claim.mime_type, claim.source_size;
end;
$$;

-- Keep the old RPC as an admission wrapper while Supabase deploys before Vercel.
create or replace function public.service_get_admin_artwork_upload_claim(
  p_actor_id uuid,
  p_path text
)
returns table (
  kind text,
  mime_type text,
  source_size integer
)
language sql
volatile
security definer
set search_path = ''
as $$
  select admission.kind, admission.mime_type, admission.source_size
  from public.service_begin_admin_artwork_verification(p_actor_id, p_path) as admission;
$$;

create or replace function public.service_verify_admin_artwork_upload(
  p_actor_id uuid,
  p_path text,
  p_final_size integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_final_size is null or p_final_size < 1 or p_final_size > 5 * 1024 * 1024 then
    return false;
  end if;

  update public.admin_artwork_upload_claims as claim
  set
    status = 'verified',
    final_size = p_final_size,
    verified_at = clock_timestamp()
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status = 'processing'
    and claim.expires_at > clock_timestamp()
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = claim.actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    );

  return found;
end;
$$;

create or replace function public.service_cancel_admin_artwork_upload(
  p_actor_id uuid,
  p_path text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.admin_artwork_upload_claims as claim
  set
    status = 'rejected',
    resolved_at = coalesce(claim.resolved_at, clock_timestamp()),
    cleanup_completed_at = null
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status in ('pending', 'processing', 'verified');

  return found;
end;
$$;

create or replace function public.service_reject_admin_artwork_upload(
  p_actor_id uuid,
  p_path text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.admin_artwork_upload_claims as claim
  set
    status = 'rejected',
    resolved_at = coalesce(claim.resolved_at, clock_timestamp()),
    cleanup_completed_at = null
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status in ('pending', 'processing', 'verified', 'rejected', 'expired');

  return found;
end;
$$;

create or replace function public.service_list_admin_artwork_cleanup_candidates(
  p_limit integer default 50
)
returns table (
  actor_id uuid,
  path text,
  cleanup_mode text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    claim.actor_id,
    claim.path,
    case
      when claim.status = 'attached'
      then 'staging'::text
      when claim.status = 'verified'
        and claim.expires_at > clock_timestamp()
      then 'staging'::text
      else 'all'::text
    end as cleanup_mode
  from public.admin_artwork_upload_claims as claim
  where (
      claim.status = 'rejected'
      and claim.cleanup_completed_at is null
    )
    or (
      claim.status in ('pending', 'processing', 'verified')
      and claim.expires_at <= clock_timestamp()
      and claim.cleanup_completed_at is null
    )
    or (
      claim.status in ('verified', 'attached')
      and claim.staging_cleaned_at is null
    )
  order by claim.created_at
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.service_complete_admin_artwork_cleanup(
  p_actor_id uuid,
  p_path text,
  p_mode text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_mode = 'staging' then
    update public.admin_artwork_upload_claims as claim
    set staging_cleaned_at = clock_timestamp()
    where claim.actor_id = p_actor_id
      and claim.path = p_path
      and claim.status in ('verified', 'attached')
      and claim.staging_cleaned_at is null;
  elsif p_mode = 'all' then
    update public.admin_artwork_upload_claims as claim
    set
      status = case
        when claim.status in ('pending', 'processing', 'verified') then 'expired'
        else claim.status
      end,
      resolved_at = coalesce(claim.resolved_at, clock_timestamp()),
      staging_cleaned_at = coalesce(claim.staging_cleaned_at, clock_timestamp()),
      cleanup_completed_at = clock_timestamp()
    where claim.actor_id = p_actor_id
      and claim.path = p_path
      and claim.cleanup_completed_at is null
      and (
        claim.status = 'rejected'
        or (
          claim.status in ('pending', 'processing', 'verified')
          and claim.expires_at <= clock_timestamp()
        )
      );
  else
    return false;
  end if;

  return found;
end;
$$;

create or replace function public.service_log_admin_artwork_cleanup_failure(
  p_actor_id uuid,
  p_path text,
  p_bucket text,
  p_stage text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null
    or p_path is null
    or p_bucket not in ('admin-artwork-staging', 'public-media')
    or p_stage not in ('gc', 'promote', 'reject')
    or not exists (
      select 1
      from public.admin_artwork_upload_claims as claim
      where claim.actor_id = p_actor_id
        and claim.path = p_path
    )
  then
    return false;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'admin_artwork_cleanup_failed',
    p_bucket || ':' || p_path,
    jsonb_build_object('stage', p_stage)
  );

  return true;
end;
$$;

create or replace function public.can_stage_admin_artwork(target_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_staff()
    and exists (
      select 1
      from public.admin_artwork_upload_claims as claim
      where claim.actor_id = (select auth.uid())
        and claim.path = target_path
        and claim.status = 'pending'
        and claim.expires_at > clock_timestamp()
    );
$$;

drop policy if exists public_media_catalog_insert on storage.objects;
drop policy if exists admin_artwork_staging_insert on storage.objects;
create policy admin_artwork_staging_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'admin-artwork-staging'
    and public.can_stage_admin_artwork(name)
  );

create or replace function public.enforce_admin_catalog_artwork_claim()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := (select auth.uid());
  object_path text;
  expected_kind text := tg_argv[0];
begin
  if new.image_path is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.image_path is not distinct from old.image_path then
    return new;
  end if;

  if current_actor_id is null then
    if session_user = 'postgres' then
      return new;
    end if;
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  if not public.is_staff()
    or new.image_path !~ '^public-media/catalog/(ip|good|card|event)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  then
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  object_path := substring(new.image_path from length('public-media/') + 1);
  if object_path not like 'catalog/' || expected_kind || '/%' then
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  update public.admin_artwork_upload_claims as claim
  set
    status = 'attached',
    attached_at = clock_timestamp(),
    resolved_at = clock_timestamp()
  where claim.actor_id = current_actor_id
    and claim.path = object_path
    and claim.kind = expected_kind
    and claim.status = 'verified'
    and claim.verified_at is not null
    and claim.final_size is not null
    and claim.attached_at is null
    and claim.expires_at > clock_timestamp();

  if not found then
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_admin_catalog_artwork_claim on public.ips;
create trigger enforce_admin_catalog_artwork_claim
after insert or update of image_path on public.ips
for each row execute function public.enforce_admin_catalog_artwork_claim('ip');

drop trigger if exists enforce_admin_catalog_artwork_claim on public.goods;
create trigger enforce_admin_catalog_artwork_claim
after insert or update of image_path on public.goods
for each row execute function public.enforce_admin_catalog_artwork_claim('good');

drop trigger if exists enforce_admin_catalog_artwork_claim on public.cards;
create trigger enforce_admin_catalog_artwork_claim
after insert or update of image_path on public.cards
for each row execute function public.enforce_admin_catalog_artwork_claim('card');

drop trigger if exists enforce_admin_catalog_artwork_claim on public.events;
create trigger enforce_admin_catalog_artwork_claim
after insert or update of image_path on public.events
for each row execute function public.enforce_admin_catalog_artwork_claim('event');

revoke all on function public.can_stage_admin_artwork(text)
  from public, anon, authenticated, service_role;
grant execute on function public.can_stage_admin_artwork(text) to authenticated;

revoke all on function public.service_prepare_admin_artwork_upload(uuid, text, text, text, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.service_begin_admin_artwork_verification(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.service_get_admin_artwork_upload_claim(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.service_verify_admin_artwork_upload(uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.service_cancel_admin_artwork_upload(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.service_reject_admin_artwork_upload(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.service_list_admin_artwork_cleanup_candidates(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.service_complete_admin_artwork_cleanup(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.service_log_admin_artwork_cleanup_failure(uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_admin_catalog_artwork_claim()
  from public, anon, authenticated, service_role;

grant execute on function public.service_prepare_admin_artwork_upload(uuid, text, text, text, integer, timestamptz)
  to service_role;
grant execute on function public.service_begin_admin_artwork_verification(uuid, text)
  to service_role;
grant execute on function public.service_get_admin_artwork_upload_claim(uuid, text)
  to service_role;
grant execute on function public.service_verify_admin_artwork_upload(uuid, text, integer)
  to service_role;
grant execute on function public.service_cancel_admin_artwork_upload(uuid, text)
  to service_role;
grant execute on function public.service_reject_admin_artwork_upload(uuid, text)
  to service_role;
grant execute on function public.service_list_admin_artwork_cleanup_candidates(integer)
  to service_role;
grant execute on function public.service_complete_admin_artwork_cleanup(uuid, text, text)
  to service_role;
grant execute on function public.service_log_admin_artwork_cleanup_failure(uuid, text, text, text)
  to service_role;
