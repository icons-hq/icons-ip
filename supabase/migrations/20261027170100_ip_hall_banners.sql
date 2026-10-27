-- L8b (#574, IP-06): separate PC and mobile banner artwork for an IP hall
-- (/ip/[id]). The hall banner used to have only the IP key art (ips.bg /
-- ips.image_path). Both new paths are optional; when one is missing the hall
-- keeps its current rendering for that width (mobile falls back to the PC
-- banner, then to the key art), so existing IPs render exactly as before.
--
-- The canonical value is a Storage key under the IP artwork prefix — never a
-- /generated static path. A path may only be attached through a verified,
-- unattached upload claim of the same actor (the #112 artwork contract that
-- enforce_admin_catalog_artwork_claim applies to ips.image_path).

alter table public.ips
  add column hall_banner_image_path text,
  add column hall_banner_mobile_image_path text,
  add constraint ips_hall_banner_image_path_check check (
    hall_banner_image_path is null
    or hall_banner_image_path ~ '^public-media/catalog/ip/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  ),
  add constraint ips_hall_banner_mobile_image_path_check check (
    hall_banner_mobile_image_path is null
    or hall_banner_mobile_image_path ~ '^public-media/catalog/ip/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  );

-- Claim guard for the two banner columns. The shared artwork trigger only
-- watches image_path, and ips_update RLS lets a platform operator write the row
-- directly, so the claim rule lives on the table rather than only in the RPC.
-- A path that this row already carried (in either column) needs no new claim:
-- swapping or re-saving the same artwork never consumes another upload.
create function private.guard_ip_hall_banner_artwork()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := (select auth.uid());
  previous_paths text[] := '{}';
  banner_path text;
begin
  if tg_op = 'UPDATE' then
    previous_paths := pg_catalog.array_remove(
      array[old.hall_banner_image_path, old.hall_banner_mobile_image_path], null
    );
  end if;

  for banner_path in
    select distinct candidate
    from pg_catalog.unnest(array[new.hall_banner_image_path, new.hall_banner_mobile_image_path]) as paths(candidate)
    where candidate is not null
    order by candidate
  loop
    if banner_path = any(previous_paths) then continue; end if;

    if current_actor_id is null then
      -- Migrations and seeds run as postgres without a request actor.
      if session_user = 'postgres' then continue; end if;
      raise check_violation using message = 'unverified_artwork';
    end if;

    update public.admin_artwork_upload_claims as claim
    set
      status = 'attached',
      attached_at = pg_catalog.clock_timestamp(),
      resolved_at = pg_catalog.clock_timestamp()
    where claim.actor_id = current_actor_id
      and claim.path = pg_catalog.substr(banner_path, pg_catalog.length('public-media/') + 1)
      and claim.kind = 'ip'
      and claim.status = 'verified'
      and claim.verified_at is not null
      and claim.final_size is not null
      and claim.attached_at is null
      and claim.expires_at > pg_catalog.clock_timestamp();

    if not found then
      raise check_violation using message = 'unverified_artwork';
    end if;
  end loop;

  return new;
end $$;
revoke all on function private.guard_ip_hall_banner_artwork() from public, anon, authenticated, service_role;

create trigger ips_hall_banner_artwork
  before insert or update of hall_banner_image_path, hall_banner_mobile_image_path on public.ips
  for each row execute function private.guard_ip_hall_banner_artwork();

-- Audited write for the admin IP form. admin_upsert_ip keeps its signature
-- (its save-intent contract is coupled to many smokes); the banner has its own
-- form and RPC under the same platform.manage authority.
create function public.admin_save_ip_hall_banner(
  target_ip_id text,
  target_image_path text,
  target_mobile_image_path text
)
returns timestamp with time zone
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_image_path text := nullif(pg_catalog.btrim(target_image_path), '');
  normalized_mobile_image_path text := nullif(pg_catalog.btrim(target_mobile_image_path), '');
  previous_ip public.ips%rowtype;
  saved_at timestamptz;
begin
  perform private.require_operator_capability('platform.manage', false);

  if actor_id is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;
  if target_ip_id is null or pg_catalog.btrim(target_ip_id) = '' then
    raise invalid_parameter_value using message = 'invalid_ip_id';
  end if;
  if (normalized_image_path is not null
      and normalized_image_path !~ '^public-media/catalog/ip/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$')
    or (normalized_mobile_image_path is not null
      and normalized_mobile_image_path !~ '^public-media/catalog/ip/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$')
  then
    raise check_violation using message = 'invalid_ip_banner_image_path';
  end if;

  select ip.* into previous_ip from public.ips as ip where ip.id = target_ip_id for update of ip;
  if not found then
    raise no_data_found using message = 'catalog_record_missing';
  end if;

  -- Saving the same pair again is a no-op: no new version, no audit noise.
  if previous_ip.hall_banner_image_path is not distinct from normalized_image_path
    and previous_ip.hall_banner_mobile_image_path is not distinct from normalized_mobile_image_path
  then
    return previous_ip.updated_at;
  end if;

  update public.ips
  set
    hall_banner_image_path = normalized_image_path,
    hall_banner_mobile_image_path = normalized_mobile_image_path
  where id = target_ip_id
  returning updated_at into saved_at;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.ip.hall_banner',
    'ips:' || target_ip_id,
    pg_catalog.jsonb_build_object(
      'before', pg_catalog.jsonb_build_object(
        'hall_banner_image_path', previous_ip.hall_banner_image_path,
        'hall_banner_mobile_image_path', previous_ip.hall_banner_mobile_image_path
      ),
      'after', pg_catalog.jsonb_build_object(
        'hall_banner_image_path', normalized_image_path,
        'hall_banner_mobile_image_path', normalized_mobile_image_path
      )
    )
  );

  return saved_at;
end $$;
revoke all on function public.admin_save_ip_hall_banner(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_ip_hall_banner(text, text, text) to authenticated;

select private.register_operator_rpc_contract('public.admin_save_ip_hall_banner(text,text,text)'::regprocedure, 'platform.manage', 'write', false);

notify pgrst, 'reload schema';
