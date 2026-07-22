-- Single operational source for home hero, featured IPs, and announcements.
-- CHECK constraints assume immutable predicates, so percent escapes are decoded
-- with immutable byte/code-point operations rather than encoding-dependent casts.
create function private.is_safe_home_curation_link(candidate text)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  candidate_length integer := pg_catalog.char_length(candidate);
  character_position integer := 1;
  consumed_characters integer;
  current_character text;
  first_byte integer;
  second_byte integer;
  third_byte integer;
  fourth_byte integer;
  decoded_codepoint integer;
  decoded_link text;
begin
  if candidate_length not between 1 and 2048
    or pg_catalog.left(candidate, 1) <> '/'
    or pg_catalog.left(candidate, 2) = '//'
    or pg_catalog.strpos(candidate, E'\\') > 0
    or candidate ~ '[[:cntrl:]]'
    or candidate ~ U&'[\061C\200E\200F\2028-\202E\2066-\2069]'
  then
    return false;
  end if;

  decoded_link := '';
  while character_position <= candidate_length loop
    current_character := pg_catalog.substr(candidate, character_position, 1);
    if current_character <> '%' then
      decoded_link := decoded_link || current_character;
      character_position := character_position + 1;
      continue;
    end if;

    if character_position + 2 > candidate_length
      or pg_catalog.substr(candidate, character_position + 1, 2)
        !~ '^[0-9A-Fa-f]{2}$'
    then
      return false;
    end if;

    first_byte := pg_catalog.get_byte(
      pg_catalog.decode(
        pg_catalog.substr(candidate, character_position + 1, 2),
        'hex'
      ),
      0
    );

    if first_byte <= 127 then
      decoded_codepoint := first_byte;
      consumed_characters := 3;
    elsif first_byte between 194 and 223 then
      if character_position + 5 > candidate_length
        or pg_catalog.substr(candidate, character_position + 3, 1) <> '%'
        or pg_catalog.substr(candidate, character_position + 4, 2)
          !~ '^[0-9A-Fa-f]{2}$'
      then
        return false;
      end if;
      second_byte := pg_catalog.get_byte(
        pg_catalog.decode(
          pg_catalog.substr(candidate, character_position + 4, 2),
          'hex'
        ),
        0
      );
      if second_byte not between 128 and 191 then
        return false;
      end if;
      decoded_codepoint := ((first_byte & 31) << 6) | (second_byte & 63);
      consumed_characters := 6;
    elsif first_byte between 224 and 239 then
      if character_position + 8 > candidate_length
        or pg_catalog.substr(candidate, character_position + 3, 1) <> '%'
        or pg_catalog.substr(candidate, character_position + 6, 1) <> '%'
        or pg_catalog.substr(candidate, character_position + 4, 2)
          !~ '^[0-9A-Fa-f]{2}$'
        or pg_catalog.substr(candidate, character_position + 7, 2)
          !~ '^[0-9A-Fa-f]{2}$'
      then
        return false;
      end if;
      second_byte := pg_catalog.get_byte(
        pg_catalog.decode(
          pg_catalog.substr(candidate, character_position + 4, 2),
          'hex'
        ),
        0
      );
      third_byte := pg_catalog.get_byte(
        pg_catalog.decode(
          pg_catalog.substr(candidate, character_position + 7, 2),
          'hex'
        ),
        0
      );
      if second_byte not between 128 and 191
        or third_byte not between 128 and 191
        or (first_byte = 224 and second_byte < 160)
        or (first_byte = 237 and second_byte > 159)
      then
        return false;
      end if;
      decoded_codepoint := ((first_byte & 15) << 12)
        | ((second_byte & 63) << 6)
        | (third_byte & 63);
      consumed_characters := 9;
    elsif first_byte between 240 and 244 then
      if character_position + 11 > candidate_length
        or pg_catalog.substr(candidate, character_position + 3, 1) <> '%'
        or pg_catalog.substr(candidate, character_position + 6, 1) <> '%'
        or pg_catalog.substr(candidate, character_position + 9, 1) <> '%'
        or pg_catalog.substr(candidate, character_position + 4, 2)
          !~ '^[0-9A-Fa-f]{2}$'
        or pg_catalog.substr(candidate, character_position + 7, 2)
          !~ '^[0-9A-Fa-f]{2}$'
        or pg_catalog.substr(candidate, character_position + 10, 2)
          !~ '^[0-9A-Fa-f]{2}$'
      then
        return false;
      end if;
      second_byte := pg_catalog.get_byte(
        pg_catalog.decode(
          pg_catalog.substr(candidate, character_position + 4, 2),
          'hex'
        ),
        0
      );
      third_byte := pg_catalog.get_byte(
        pg_catalog.decode(
          pg_catalog.substr(candidate, character_position + 7, 2),
          'hex'
        ),
        0
      );
      fourth_byte := pg_catalog.get_byte(
        pg_catalog.decode(
          pg_catalog.substr(candidate, character_position + 10, 2),
          'hex'
        ),
        0
      );
      if second_byte not between 128 and 191
        or third_byte not between 128 and 191
        or fourth_byte not between 128 and 191
        or (first_byte = 240 and second_byte < 144)
        or (first_byte = 244 and second_byte > 143)
      then
        return false;
      end if;
      decoded_codepoint := ((first_byte & 7) << 18)
        | ((second_byte & 63) << 12)
        | ((third_byte & 63) << 6)
        | (fourth_byte & 63);
      consumed_characters := 12;
    else
      return false;
    end if;

    if decoded_codepoint between 0 and 31
      or decoded_codepoint between 127 and 159
      or decoded_codepoint = 1564
      or decoded_codepoint in (8206, 8207)
      or decoded_codepoint between 8232 and 8238
      or decoded_codepoint between 8294 and 8297
    then
      return false;
    end if;

    decoded_link := decoded_link || pg_catalog.chr(decoded_codepoint);
    character_position := character_position + consumed_characters;
  end loop;

  return pg_catalog.left(decoded_link, 1) = '/'
    and pg_catalog.left(decoded_link, 2) <> '//'
    and pg_catalog.strpos(decoded_link, E'\\') = 0
    and decoded_link !~ '[[:cntrl:]]'
    and decoded_link !~ U&'[\061C\200E\200F\2028-\202E\2066-\2069]';
end;
$$;

revoke all on function private.is_safe_home_curation_link(text)
  from public, anon, authenticated, service_role;

create table public.home_curations (
  id uuid primary key,
  kind text not null
    constraint home_curations_kind_check
    check (kind in ('hero', 'featured_ip', 'announcement')),
  ip_id text references public.ips (id) on delete restrict,
  title text not null,
  image_path text,
  link_path text not null,
  display_order integer not null default 0,
  active_from timestamptz not null,
  active_to timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_curations_title_check check (
    title = pg_catalog.btrim(title)
    and pg_catalog.char_length(title) between 1 and 120
  ),
  constraint home_curations_kind_ip_check check (
    (kind = 'featured_ip' and ip_id is not null)
    or (kind in ('hero', 'announcement') and ip_id is null)
  ),
  constraint home_curations_hero_image_check check (
    kind <> 'hero' or image_path is not null
  ),
  constraint home_curations_image_path_check check (
    image_path is null
    or image_path ~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  ),
  constraint home_curations_link_path_check check (
    private.is_safe_home_curation_link(link_path)
  ),
  constraint home_curations_display_order_check check (display_order >= 0),
  constraint home_curations_active_window_check check (
    pg_catalog.isfinite(active_from)
    and (
      active_to is null
      or (pg_catalog.isfinite(active_to) and active_to > active_from)
    )
  )
);

create trigger trg_home_curations_updated
before update on public.home_curations
for each row execute function public.set_updated_at();

create index home_curations_active_read_idx
  on public.home_curations (kind, display_order, active_from, id)
  where enabled;

create index home_curations_staff_read_idx
  on public.home_curations (updated_at desc, id desc);

alter table public.home_curations enable row level security;

create policy home_curations_public_read
on public.home_curations
for select
to anon, authenticated
using (
  enabled
  and active_from <= pg_catalog.now()
  and (active_to is null or active_to > pg_catalog.now())
  and (
    ip_id is null
    or exists (
      select 1
      from public.ips as ip
      where ip.id = home_curations.ip_id
        and ip.archived_at is null
    )
  )
);

create policy home_curations_staff_read
on public.home_curations
for select
to authenticated
using (public.is_staff());

revoke all on table public.home_curations
  from public, anon, authenticated, service_role;
grant select on table public.home_curations to anon, authenticated;

create function public.admin_upsert_home_curation(
  target_operation_id uuid,
  target_curation_id uuid,
  target_kind text,
  target_ip_id text,
  target_title text,
  target_image_path text,
  target_link_path text,
  target_display_order integer,
  target_active_from timestamptz,
  target_active_to timestamptz,
  target_enabled boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_kind text := pg_catalog.btrim(target_kind);
  normalized_ip_id text := nullif(pg_catalog.btrim(target_ip_id), '');
  normalized_title text := pg_catalog.btrim(target_title);
  normalized_image_path text := nullif(pg_catalog.btrim(target_image_path), '');
  normalized_link_path text := pg_catalog.btrim(target_link_path);
  referenced_archived_at timestamptz;
  request_payload jsonb;
  previous_payload jsonb := 'null'::jsonb;
  after_payload jsonb;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  previous_curation public.home_curations%rowtype;
begin
  if actor_id is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  if not public.is_staff() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if target_operation_id is null then
    raise null_value_not_allowed using message = 'invalid_operation_id';
  end if;
  if target_curation_id is null then
    raise null_value_not_allowed using message = 'invalid_curation_id';
  end if;
  if normalized_kind is null
    or normalized_kind not in ('hero', 'featured_ip', 'announcement')
  then
    raise invalid_parameter_value using message = 'invalid_curation_kind';
  end if;
  if normalized_title is null
    or pg_catalog.char_length(normalized_title) not between 1 and 120
  then
    raise invalid_parameter_value using message = 'invalid_curation_title';
  end if;
  if normalized_kind = 'featured_ip' and normalized_ip_id is null then
    raise invalid_parameter_value using message = 'invalid_curation_ip';
  end if;
  if normalized_kind <> 'featured_ip' and normalized_ip_id is not null then
    raise invalid_parameter_value using message = 'invalid_curation_ip';
  end if;
  if normalized_kind = 'hero' and normalized_image_path is null then
    raise check_violation using message = 'curation_image_required';
  end if;
  if normalized_image_path is not null
    and normalized_image_path !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  then
    raise check_violation using message = 'invalid_curation_image_path';
  end if;
  if normalized_link_path is null
    or not private.is_safe_home_curation_link(normalized_link_path)
  then
    raise invalid_parameter_value using message = 'invalid_curation_link_path';
  end if;
  if target_display_order is null or target_display_order < 0 then
    raise invalid_parameter_value using message = 'invalid_curation_display_order';
  end if;
  if target_active_from is null then
    raise null_value_not_allowed using message = 'invalid_curation_active_from';
  end if;
  if not pg_catalog.isfinite(target_active_from) then
    raise invalid_parameter_value using message = 'invalid_curation_active_from';
  end if;
  if target_active_to is not null
    and (
      not pg_catalog.isfinite(target_active_to)
      or target_active_to <= target_active_from
    )
  then
    raise check_violation using message = 'invalid_curation_active_window';
  end if;
  if target_enabled is null then
    raise null_value_not_allowed using message = 'invalid_curation_enabled';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'kind', normalized_kind,
    'ip_id', normalized_ip_id,
    'title', normalized_title,
    'image_path', normalized_image_path,
    'link_path', normalized_link_path,
    'display_order', target_display_order,
    'active_from', target_active_from,
    'active_to', target_active_to,
    'enabled', target_enabled
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_home_curation_operation:' || target_operation_id::text,
      0
    )
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.home_curation.upserted'
      and existing_target = 'home_curations:' || target_curation_id::text
      and existing_diff -> 'request' = request_payload
    then
      return target_curation_id;
    end if;

    raise unique_violation using message = 'operation_conflict';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_home_curation:' || target_curation_id::text,
      0
    )
  );

  if normalized_ip_id is not null then
    select ip.archived_at
      into referenced_archived_at
    from public.ips as ip
    where ip.id = normalized_ip_id
    for update of ip;

    if not found then
      raise no_data_found using message = 'curation_ip_not_found';
    end if;
    if referenced_archived_at is not null then
      raise check_violation using message = 'catalog_item_archived';
    end if;
  end if;

  select curation.*
    into previous_curation
  from public.home_curations as curation
  where curation.id = target_curation_id
  for update of curation;

  if found then
    previous_payload := pg_catalog.jsonb_build_object(
      'id', previous_curation.id,
      'kind', previous_curation.kind,
      'ip_id', previous_curation.ip_id,
      'title', previous_curation.title,
      'image_path', previous_curation.image_path,
      'link_path', previous_curation.link_path,
      'display_order', previous_curation.display_order,
      'active_from', previous_curation.active_from,
      'active_to', previous_curation.active_to,
      'enabled', previous_curation.enabled
    );

    update public.home_curations
    set
      kind = normalized_kind,
      ip_id = normalized_ip_id,
      title = normalized_title,
      image_path = normalized_image_path,
      link_path = normalized_link_path,
      display_order = target_display_order,
      active_from = target_active_from,
      active_to = target_active_to,
      enabled = target_enabled
    where id = target_curation_id;
  else
    insert into public.home_curations (
      id, kind, ip_id, title, image_path, link_path,
      display_order, active_from, active_to, enabled
    )
    values (
      target_curation_id, normalized_kind, normalized_ip_id, normalized_title,
      normalized_image_path, normalized_link_path, target_display_order,
      target_active_from, target_active_to, target_enabled
    );
  end if;

  after_payload := pg_catalog.jsonb_build_object(
    'id', target_curation_id,
    'kind', normalized_kind,
    'ip_id', normalized_ip_id,
    'title', normalized_title,
    'image_path', normalized_image_path,
    'link_path', normalized_link_path,
    'display_order', target_display_order,
    'active_from', target_active_from,
    'active_to', target_active_to,
    'enabled', target_enabled
  );

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.home_curation.upserted',
    'home_curations:' || target_curation_id::text,
    pg_catalog.jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', after_payload
    )
  );

  return target_curation_id;
end;
$$;

revoke all on function public.admin_upsert_home_curation(
  uuid, uuid, text, text, text, text, text, integer,
  timestamptz, timestamptz, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_home_curation(
  uuid, uuid, text, text, text, text, text, integer,
  timestamptz, timestamptz, boolean
) to authenticated;

-- Extend #112's verified artwork claim contract without weakening its
-- actor/kind/path/single-use isolation.
alter table public.admin_artwork_upload_claims
  drop constraint admin_artwork_upload_claims_kind_check,
  drop constraint admin_artwork_claim_path_format,
  add constraint admin_artwork_upload_claims_kind_check
    check (kind in ('ip', 'good', 'card', 'event', 'curation')),
  add constraint admin_artwork_claim_path_format check (
    path ~ '^catalog/(ip|good|card|event|curation)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  );

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
    or p_kind not in ('ip', 'good', 'card', 'event', 'curation')
    or p_mime_type is null
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_source_size is null
    or p_source_size < 1
    or p_source_size > 5 * 1024 * 1024
    or p_expires_at is null
    or p_expires_at <= pg_catalog.clock_timestamp()
    or p_expires_at > pg_catalog.clock_timestamp() + interval '15 minutes'
    or p_path !~ '^catalog/(ip|good|card|event|curation)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
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
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) >= 4 then
    return false;
  end if;

  insert into public.admin_artwork_upload_claims (
    path, actor_id, kind, mime_type, source_size, expires_at
  )
  values (
    p_path, p_actor_id, p_kind, p_mime_type, p_source_size, p_expires_at
  )
  on conflict (path) do nothing;

  return found;
end;
$$;

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
    raise check_violation using message = 'unverified_artwork';
  end if;

  if not public.is_staff()
    or new.image_path !~ '^public-media/catalog/(ip|good|card|event|curation)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  then
    raise check_violation using message = 'unverified_artwork';
  end if;

  object_path := pg_catalog.substr(
    new.image_path,
    pg_catalog.length('public-media/') + 1
  );
  if object_path not like 'catalog/' || expected_kind || '/%' then
    raise check_violation using message = 'unverified_artwork';
  end if;

  update public.admin_artwork_upload_claims as claim
  set
    status = 'attached',
    attached_at = pg_catalog.clock_timestamp(),
    resolved_at = pg_catalog.clock_timestamp()
  where claim.actor_id = current_actor_id
    and claim.path = object_path
    and claim.kind = expected_kind
    and claim.status = 'verified'
    and claim.verified_at is not null
    and claim.final_size is not null
    and claim.attached_at is null
    and claim.expires_at > pg_catalog.clock_timestamp();

  if not found then
    raise check_violation using message = 'unverified_artwork';
  end if;

  return new;
end;
$$;

create trigger enforce_admin_catalog_artwork_claim
after insert or update of image_path on public.home_curations
for each row execute function public.enforce_admin_catalog_artwork_claim('curation');

revoke all on function public.service_prepare_admin_artwork_upload(
  uuid, text, text, text, integer, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.service_prepare_admin_artwork_upload(
  uuid, text, text, text, integer, timestamptz
) to service_role;

-- Extend #113's IP archive guard. Both this function and curation upsert lock
-- the referenced IP row, so concurrent archive/create/update is serialized.
create or replace function private.guard_ip_archive()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.goods as good
    where good.ip_id = new.id
      and good.archived_at is null
  ) or exists (
    select 1
    from public.cards as card
    where card.ip_id = new.id
      and card.archived_at is null
  ) or exists (
    select 1
    from public.events as event_record
    where event_record.ip_id = new.id
      and event_record.archived_at is null
  ) then
    raise check_violation using message = 'ip_has_active_children';
  end if;

  if exists (
    select 1
    from public.card_pools as pool
    where pool.ip_id = new.id
      and (pool.active_to is null or pool.active_to > pg_catalog.now())
  ) or exists (
    select 1
    from public.reward_policies as policy
    where policy.target_ip_id = new.id
      and policy.active
      and (policy.active_to is null or policy.active_to > pg_catalog.now())
  ) or exists (
    select 1
    from public.games as game
    join public.events as event_record on event_record.id = game.event_id
    where event_record.ip_id = new.id
      and (game.active_to is null or game.active_to > pg_catalog.now())
  ) or exists (
    select 1
    from public.games as game
    join public.card_pools as pool on pool.id = game.reward_pool_id
    where pool.ip_id = new.id
      and (game.active_to is null or game.active_to > pg_catalog.now())
  ) then
    raise check_violation using message = 'ip_has_active_operations';
  end if;

  if exists (
    select 1
    from public.home_curations as curation
    where curation.kind = 'featured_ip'
      and curation.ip_id = new.id
      and curation.enabled
      and (curation.active_to is null or curation.active_to > pg_catalog.now())
  ) then
    raise check_violation using message = 'ip_has_active_home_curation';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_ip_archive()
  from public, anon, authenticated, service_role;

create or replace function private.set_catalog_archived(
  target_kind text,
  target_id text,
  archive_requested boolean
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  selected_archived_at timestamptz;
  transition_at timestamptz;
  audit_action text;
  audit_target text;
begin
  if actor_id is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  if not public.is_staff() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if target_kind = 'ip' then
    select ip.archived_at
      into selected_archived_at
    from public.ips as ip
    where ip.id = target_id
    for update of ip;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    if archive_requested and exists (
      select 1
      from public.home_curations as curation
      where curation.kind = 'featured_ip'
        and curation.ip_id = target_id
        and curation.enabled
        and (curation.active_to is null or curation.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'ip_has_active_home_curation';
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.ips set archived_at = transition_at where id = target_id;
    audit_action := case when archive_requested then 'catalog.ip.archived' else 'catalog.ip.unarchived' end;
    audit_target := 'ips:' || target_id;

  elsif target_kind = 'good' then
    select good.archived_at
      into selected_archived_at
    from public.goods as good
    where good.id = target_id
    for update of good;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    if archive_requested and exists (
      select 1
      from public.goods as good
      where good.id = target_id
        and good.stock_qty > 0
    ) then
      raise check_violation using message = 'good_has_stock';
    end if;

    if archive_requested and exists (
      select 1
      from public.reward_policies as policy
      where policy.target_good_id = target_id
        and policy.active
        and (policy.active_to is null or policy.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'good_has_active_policy';
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.goods set archived_at = transition_at where id = target_id;
    audit_action := case when archive_requested then 'catalog.good.archived' else 'catalog.good.unarchived' end;
    audit_target := 'goods:' || target_id;

  elsif target_kind = 'card' then
    select card.archived_at
      into selected_archived_at
    from public.cards as card
    where card.id = target_id
    for update of card;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    if archive_requested and exists (
      select 1
      from public.cards as card
      join public.card_pools as pool on pool.id = card.pool_id
      where card.id = target_id
        and (pool.active_to is null or pool.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'card_has_open_pool';
    end if;

    if archive_requested and exists (
      select 1
      from public.cards as card
      join public.draw_tickets as ticket on ticket.pool_id = card.pool_id
      where card.id = target_id
        and ticket.consumed_at is null
        and ticket.revoked_at is null
    ) then
      raise check_violation using message = 'card_has_open_tickets';
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.cards set archived_at = transition_at where id = target_id;
    audit_action := case when archive_requested then 'catalog.card.archived' else 'catalog.card.unarchived' end;
    audit_target := 'cards:' || target_id;

  elsif target_kind = 'event' then
    select event_record.archived_at
      into selected_archived_at
    from public.events as event_record
    where event_record.id = target_id
    for update of event_record;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    if archive_requested and exists (
      select 1
      from public.events as event_record
      join public.ticket_types as ticket_type on ticket_type.event_id = event_record.id
      where event_record.id = target_id
        and event_record.status in ('예정', '예매중', '진행중')
    ) then
      raise check_violation using message = 'event_has_open_ticketing';
    end if;

    if archive_requested and exists (
      select 1
      from public.games as game
      where game.event_id = target_id
        and (game.active_to is null or game.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'event_has_open_game';
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.events set archived_at = transition_at where id = target_id;
    audit_action := case when archive_requested then 'catalog.event.archived' else 'catalog.event.unarchived' end;
    audit_target := 'events:' || target_id;
  else
    raise invalid_parameter_value using message = 'invalid_catalog_kind';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    audit_action,
    audit_target,
    pg_catalog.jsonb_build_object('archived_at', transition_at)
  );

  return true;
end;
$$;

revoke all on function private.set_catalog_archived(text, text, boolean)
  from public, anon, authenticated, service_role;

-- One-time deterministic inheritance from the legacy featured flag.
insert into public.home_curations (
  id, kind, ip_id, title, image_path, link_path,
  display_order, active_from, active_to, enabled
)
select
  pg_catalog.md5('home_curations:featured_ip:' || ip.id)::uuid,
  'featured_ip',
  ip.id,
  ip.title,
  null,
  '/ip/' || ip.id,
  (pg_catalog.row_number() over (order by ip.id) - 1)::integer,
  ip.created_at,
  null,
  true
from public.ips as ip
where ip.featured
  and ip.archived_at is null
order by ip.id
on conflict (id) do nothing;
