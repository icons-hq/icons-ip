-- Codex review follow-up on #325 (PR #358): the notice strip renders on both
-- desktop and mobile from a single artwork, but the two surfaces need very
-- different proportions (R-01 records separate PC/MO sources). Allow the same
-- payload-carried mobile artwork the hero already uses. Signature is unchanged,
-- so this is a body-only redefinition; the verified-claim consumption path is
-- key-driven and picks the new kind up automatically.

create or replace function public.admin_upsert_home_curation(
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
  target_enabled boolean,
  target_slot text default null,
  target_payload jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  -- Alias with a column-safe name: inside the claim UPDATE below, a bare
  -- actor_id would be ambiguous against admin_artwork_upload_claims.actor_id.
  claim_owner_id uuid := actor_id;
  normalized_kind text := pg_catalog.btrim(target_kind);
  normalized_ip_id text := nullif(pg_catalog.btrim(target_ip_id), '');
  normalized_title text := pg_catalog.btrim(target_title);
  normalized_image_path text := nullif(pg_catalog.btrim(target_image_path), '');
  normalized_link_path text := pg_catalog.btrim(target_link_path);
  normalized_slot text := nullif(pg_catalog.btrim(target_slot), '');
  normalized_payload jsonb := case
    when target_payload is null or target_payload = '{}'::jsonb then null
    else target_payload
  end;
  allowed_payload_keys text[];
  payload_key text;
  payload_text_value text;
  payload_good_ids jsonb;
  payload_good_id_limit integer;
  payload_good_id text;
  payload_mobile_image_path text;
  previous_mobile_image_path text;
  referenced_archived_at timestamptz;
  request_payload jsonb;
  previous_payload jsonb := 'null'::jsonb;
  after_payload jsonb;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  previous_curation public.home_curations%rowtype;
  curation_exists boolean := false;
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
    or normalized_kind not in (
      'hero', 'featured_ip', 'announcement',
      'notice_strip', 'editor_pick', 'band_banner', 'best_tab', 'benefit'
    )
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
  if normalized_kind in ('hero', 'notice_strip', 'editor_pick', 'band_banner')
    and normalized_image_path is null
  then
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

  if normalized_kind = 'best_tab' then
    if normalized_slot is null or normalized_slot not in ('category', 'popular') then
      raise invalid_parameter_value using message = 'invalid_curation_slot';
    end if;
  elsif normalized_slot is not null then
    raise invalid_parameter_value using message = 'invalid_curation_slot';
  end if;

  -- Per-kind payload whitelist. Unknown keys are rejected outright so typos
  -- never ship silently dead configuration.
  allowed_payload_keys := case normalized_kind
    when 'hero' then array['subtitle', 'mobile_image_path']
    when 'notice_strip' then array['mobile_image_path']
    when 'editor_pick' then array['badge', 'description']
    when 'band_banner' then array['subcopy', 'good_ids']
    when 'best_tab' then array['good_ids']
    when 'benefit' then array['description']
    else array[]::text[]
  end;

  if normalized_payload is not null then
    if pg_catalog.jsonb_typeof(normalized_payload) <> 'object' then
      raise invalid_parameter_value using message = 'invalid_curation_payload';
    end if;
    if pg_catalog.cardinality(allowed_payload_keys) = 0 then
      raise invalid_parameter_value using message = 'invalid_curation_payload';
    end if;
    for payload_key in
      select key from pg_catalog.jsonb_object_keys(normalized_payload) as keys(key)
    loop
      if not payload_key = any (allowed_payload_keys) then
        raise invalid_parameter_value using message = 'invalid_curation_payload';
      end if;
    end loop;

    for payload_key in
      select unnest from pg_catalog.unnest(array['subtitle', 'badge', 'description', 'subcopy'])
    loop
      if normalized_payload ? payload_key then
        if pg_catalog.jsonb_typeof(normalized_payload -> payload_key) <> 'string' then
          raise invalid_parameter_value using message = 'invalid_curation_payload';
        end if;
        payload_text_value := pg_catalog.btrim(normalized_payload ->> payload_key);
        if pg_catalog.char_length(payload_text_value) not between 1 and 200
          or (payload_key = 'badge' and pg_catalog.char_length(payload_text_value) > 20)
        then
          raise invalid_parameter_value using message = 'invalid_curation_payload';
        end if;
        normalized_payload := pg_catalog.jsonb_set(
          normalized_payload, array[payload_key], pg_catalog.to_jsonb(payload_text_value)
        );
      end if;
    end loop;

    if normalized_payload ? 'good_ids' then
      payload_good_ids := normalized_payload -> 'good_ids';
      payload_good_id_limit := case normalized_kind when 'best_tab' then 12 else 4 end;
      if pg_catalog.jsonb_typeof(payload_good_ids) <> 'array'
        or pg_catalog.jsonb_array_length(payload_good_ids) not between 1 and payload_good_id_limit
      then
        raise invalid_parameter_value using message = 'invalid_curation_payload';
      end if;
      for payload_good_id in
        select value from pg_catalog.jsonb_array_elements_text(payload_good_ids) as elements(value)
      loop
        if payload_good_id !~ '^[A-Za-z0-9_-]{1,64}$' then
          raise invalid_parameter_value using message = 'invalid_curation_payload';
        end if;
      end loop;
    end if;

    if normalized_payload ? 'mobile_image_path' then
      if pg_catalog.jsonb_typeof(normalized_payload -> 'mobile_image_path') <> 'string' then
        raise invalid_parameter_value using message = 'invalid_curation_payload';
      end if;
      payload_mobile_image_path := normalized_payload ->> 'mobile_image_path';
      if payload_mobile_image_path
        !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
      then
        raise check_violation using message = 'invalid_curation_image_path';
      end if;
    end if;
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
    'enabled', target_enabled,
    'slot', normalized_slot,
    'payload', normalized_payload
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
  curation_exists := found;

  if curation_exists then
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
      'enabled', previous_curation.enabled,
      'slot', previous_curation.slot,
      'payload', previous_curation.payload
    );
    previous_mobile_image_path := previous_curation.payload ->> 'mobile_image_path';
  end if;

  -- The artwork-claim trigger only guards the image_path column, so the
  -- mobile artwork carried inside payload consumes its verified upload claim
  -- here, under the same actor/kind/single-use rules (#112 contract).
  if payload_mobile_image_path is not null
    and payload_mobile_image_path is distinct from previous_mobile_image_path
  then
    update public.admin_artwork_upload_claims as claim
    set
      status = 'attached',
      attached_at = pg_catalog.clock_timestamp(),
      resolved_at = pg_catalog.clock_timestamp()
    where claim.actor_id = claim_owner_id
      and claim.path = pg_catalog.substr(
        payload_mobile_image_path,
        pg_catalog.length('public-media/') + 1
      )
      and claim.kind = 'curation'
      and claim.status = 'verified'
      and claim.verified_at is not null
      and claim.final_size is not null
      and claim.attached_at is null
      and claim.expires_at > pg_catalog.clock_timestamp();

    if not found then
      raise check_violation using message = 'unverified_artwork';
    end if;
  end if;

  if curation_exists then
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
      enabled = target_enabled,
      slot = normalized_slot,
      payload = normalized_payload
    where id = target_curation_id;
  else
    insert into public.home_curations (
      id, kind, ip_id, title, image_path, link_path,
      display_order, active_from, active_to, enabled, slot, payload
    )
    values (
      target_curation_id, normalized_kind, normalized_ip_id, normalized_title,
      normalized_image_path, normalized_link_path, target_display_order,
      target_active_from, target_active_to, target_enabled, normalized_slot,
      normalized_payload
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
    'enabled', target_enabled,
    'slot', normalized_slot,
    'payload', normalized_payload
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

-- Same-signature replace keeps the ACL, but re-seal explicitly to match the
-- repo convention that every function definition states its grants.
revoke all on function public.admin_upsert_home_curation(
  uuid, uuid, text, text, text, text, text, integer,
  timestamptz, timestamptz, boolean, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_home_curation(
  uuid, uuid, text, text, text, text, text, integer,
  timestamptz, timestamptz, boolean, text, jsonb
) to authenticated;
