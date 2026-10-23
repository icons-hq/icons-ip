-- L8a (#573, CH-01·CH-02): text notice bar kind and page-type targeting for
-- the global-shell notices. The shell reads every valid notice with a
-- cookie-free cached query (lib/notice-strip.server.ts) and decides page type,
-- session dismissal and the random strip on the client, so these rows carry
-- only what that read needs.
--
-- * notice_bar: one line of copy (title, 1..60 chars), an optional internal
--   link whose button label lives in payload.cta_label (required exactly when
--   a link exists), and payload.page_types. Text only: no artwork.
-- * notice_strip: may now carry payload.page_types. A strip without it keeps
--   the previous behavior (every shell page), so existing rows stay valid.
-- * page_types is a non-empty, duplicate-free subset of
--   home | collection | product | content | other, stored in that order.

create function private.is_valid_home_notice_page_types(candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- plpgsql keeps the evaluation order explicit: the array functions below
  -- would raise on a scalar instead of rejecting it.
  if candidate is null or pg_catalog.jsonb_typeof(candidate) <> 'array' then return false; end if;
  if pg_catalog.jsonb_array_length(candidate) not between 1 and 5 then return false; end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(candidate) as entries(entry)
    where pg_catalog.jsonb_typeof(entry) <> 'string'
      or entry #>> '{}' not in ('home', 'collection', 'product', 'content', 'other')
  ) then
    return false;
  end if;
  return (
    select pg_catalog.count(distinct entry)
    from pg_catalog.jsonb_array_elements_text(candidate) as entries(entry)
  ) = pg_catalog.jsonb_array_length(candidate);
end $$;
revoke all on function private.is_valid_home_notice_page_types(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.is_valid_home_notice_page_types(jsonb) to postgres;

create function private.is_valid_home_notice_payload(candidate_kind text, candidate jsonb, candidate_link text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  label text;
begin
  if candidate_kind is null or candidate_kind not in ('notice_bar', 'notice_strip') then return true; end if;
  if candidate is not null and pg_catalog.jsonb_typeof(candidate) <> 'object' then return false; end if;

  if candidate_kind = 'notice_strip' then
    if candidate is null then return true; end if;
    if exists (
      select 1 from pg_catalog.jsonb_object_keys(candidate) as keys(key)
      where key not in ('mobile_image_path', 'page_types')
    ) then
      return false;
    end if;
    return not (candidate ? 'page_types')
      or private.is_valid_home_notice_page_types(candidate -> 'page_types');
  end if;

  if candidate is null or not (candidate ? 'page_types') then return false; end if;
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(candidate) as keys(key)
    where key not in ('cta_label', 'page_types')
  ) then
    return false;
  end if;
  if not private.is_valid_home_notice_page_types(candidate -> 'page_types') then return false; end if;
  -- A button needs a destination and a destination needs a visible button.
  if candidate_link is null then return not (candidate ? 'cta_label'); end if;
  if not (candidate ? 'cta_label') or pg_catalog.jsonb_typeof(candidate -> 'cta_label') <> 'string' then
    return false;
  end if;
  label := candidate ->> 'cta_label';
  return label = pg_catalog.btrim(label)
    and pg_catalog.char_length(label) between 1 and 12
    and label !~ '[[:cntrl:]]';
end $$;
revoke all on function private.is_valid_home_notice_payload(text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function private.is_valid_home_notice_payload(text, jsonb, text) to postgres;

alter table public.home_curations
  drop constraint home_curations_kind_check,
  drop constraint home_curations_link_path_check,
  add constraint home_curations_kind_check check (
    kind in (
      'hero', 'featured_ip', 'announcement',
      'notice_strip', 'notice_bar', 'editor_pick', 'band_banner', 'best_tab', 'benefit',
      'sales_best', 'review_best', 'product_mosaic', 'product_collection'
    )
  ),
  -- Same rule as before, with the text notice bar joining the hero in allowing
  -- a row without a destination (the bar then renders without a button).
  add constraint home_curations_link_path_check check (
    (kind in ('hero', 'notice_bar', 'product_collection') and link_path is null)
    or (kind <> 'product_collection' and link_path is not null and private.is_safe_home_curation_link(link_path))
  ),
  add constraint home_curations_notice_check check (
    private.is_valid_home_notice_payload(kind, payload, link_path)
    and (
      kind <> 'notice_bar'
      or (
        image_path is null
        and pg_catalog.char_length(title) between 1 and 60
        and title !~ '[[:cntrl:]]'
      )
    )
  );

-- Shared write core: notice_bar kind, notice payload whitelist/normalization.
create or replace function private.save_home_curation(target_operation_id uuid, target_curation_id uuid, target_kind text, target_ip_id text, target_title text, target_image_path text, target_link_path text, target_display_order integer, target_active_from timestamp with time zone, target_active_to timestamp with time zone, target_enabled boolean, target_slot text, target_payload jsonb, target_expected_updated_at timestamp with time zone, require_saved_version boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  -- Alias with a column-safe name: inside the claim UPDATE below, a bare
  -- actor_id would be ambiguous against admin_artwork_upload_claims.actor_id.
  claim_owner_id uuid := actor_id;
  normalized_kind text := pg_catalog.btrim(target_kind);
  normalized_ip_id text := nullif(pg_catalog.btrim(target_ip_id), '');
  normalized_title text := pg_catalog.btrim(target_title);
  normalized_image_path text := nullif(pg_catalog.btrim(target_image_path), '');
  normalized_link_path text := nullif(pg_catalog.btrim(target_link_path),'');
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
  perform private.require_operator_capability('store.manage',false);

  if actor_id is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  perform 1 from public.profiles where id=actor_id and role in ('staff','admin') and suspended_at is null for share;
  if not found then
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
      'notice_strip', 'notice_bar', 'editor_pick', 'band_banner', 'best_tab', 'benefit', 'sales_best', 'review_best', 'product_mosaic', 'product_collection'
    )
  then
    raise invalid_parameter_value using message = 'invalid_curation_kind';
  end if;
  if normalized_title is null
    or pg_catalog.char_length(normalized_title) not between (case when normalized_kind='hero' then 0 else 1 end) and 120
    or (normalized_kind in ('sales_best','review_best','product_mosaic','product_collection') and pg_catalog.char_length(normalized_title)>15)
    -- The text notice bar is one short line of copy in the global shell.
    or (normalized_kind='notice_bar' and (pg_catalog.char_length(normalized_title)>60 or normalized_title ~ '[[:cntrl:]]'))
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
  if normalized_kind = 'notice_bar' and normalized_image_path is not null then
    raise invalid_parameter_value using message = 'invalid_curation_notice';
  end if;
  if normalized_image_path is not null
    and normalized_image_path !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  then
    raise check_violation using message = 'invalid_curation_image_path';
  end if;
  if (normalized_link_path is null and normalized_kind not in ('hero','product_collection','notice_bar'))
    or (normalized_kind='product_collection' and normalized_link_path is not null)
    or (normalized_link_path is not null and not private.is_safe_home_curation_link(normalized_link_path))
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
    when 'hero' then array['subtitle', 'mobile_image_path', 'alt_enabled', 'alt_title', 'alt_content', 'image_dim', 'text_color']
    when 'notice_strip' then array['mobile_image_path', 'page_types']
    when 'notice_bar' then array['cta_label', 'page_types']
    when 'editor_pick' then array['badge', 'description']
    when 'band_banner' then array['subcopy', 'good_ids']
    when 'best_tab' then array['good_ids', 'selection_mode', 'item_count']
    when 'benefit' then array['description']
    when 'sales_best' then array['exposure_mode','period']
    when 'review_best' then array['selection_mode','good_ids']
    when 'product_mosaic' then array['mosaic_title','mosaic_subtitle','slots']
    when 'product_collection' then array['layout','image_shape','item_count','good_ids']
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
      payload_good_id_limit := case normalized_kind when 'best_tab' then 12 when 'review_best' then 20 when 'product_collection' then 100 else 4 end;
      if pg_catalog.jsonb_typeof(payload_good_ids) <> 'array'
        or pg_catalog.jsonb_array_length(payload_good_ids) not between (case when normalized_kind in ('review_best','product_collection') then 0 else 1 end) and payload_good_id_limit
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

    -- Automatic selection is a rule, never a saved snapshot of product IDs.
    if normalized_kind='best_tab' and normalized_payload ? 'selection_mode' then
      if pg_catalog.jsonb_typeof(normalized_payload -> 'selection_mode') <> 'string'
        or normalized_payload ->> 'selection_mode' <> 'latest'
        or normalized_payload ? 'good_ids'
        or not normalized_payload ? 'item_count'
        or pg_catalog.jsonb_typeof(normalized_payload -> 'item_count') <> 'number'
      then
        raise invalid_parameter_value using message = 'invalid_curation_payload';
      end if;
      if (normalized_payload ->> 'item_count')::numeric not between 3 and 10
        or pg_catalog.trunc((normalized_payload ->> 'item_count')::numeric)
          <> (normalized_payload ->> 'item_count')::numeric
      then
        raise invalid_parameter_value using message = 'invalid_curation_payload';
      end if;
      normalized_payload := pg_catalog.jsonb_set(
        normalized_payload, array['item_count'],
        pg_catalog.to_jsonb(((normalized_payload ->> 'item_count')::numeric)::integer)
      );
    elsif normalized_kind='best_tab' and normalized_payload ? 'item_count' then
      raise invalid_parameter_value using message = 'invalid_curation_payload';
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

    if normalized_payload ? 'cta_label' then
      if pg_catalog.jsonb_typeof(normalized_payload -> 'cta_label') <> 'string' then
        raise invalid_parameter_value using message = 'invalid_curation_notice';
      end if;
      normalized_payload := pg_catalog.jsonb_set(
        normalized_payload, array['cta_label'],
        pg_catalog.to_jsonb(pg_catalog.btrim(normalized_payload ->> 'cta_label'))
      );
    end if;

    -- Page-type targeting is stored in one canonical order so an identical
    -- operator request replays byte-for-byte (operation receipt comparison).
    if normalized_payload ? 'page_types' then
      if not private.is_valid_home_notice_page_types(normalized_payload -> 'page_types') then
        raise invalid_parameter_value using message = 'invalid_curation_notice';
      end if;
      normalized_payload := pg_catalog.jsonb_set(
        normalized_payload, array['page_types'],
        (
          select pg_catalog.jsonb_agg(page_type order by pg_catalog.array_position(
            array['home', 'collection', 'product', 'content', 'other']::text[], page_type
          ))
          from pg_catalog.jsonb_array_elements_text(normalized_payload -> 'page_types') as page_types(page_type)
        )
      );
    end if;
  end if;

  if not private.is_valid_home_ranked_curation(normalized_kind, normalized_payload) then
    raise invalid_parameter_value using message='invalid_curation_payload';
  end if;

  if not private.is_valid_home_notice_payload(normalized_kind, normalized_payload, normalized_link_path) then
    raise invalid_parameter_value using message='invalid_curation_notice';
  end if;

  if normalized_kind='product_mosaic' and (not private.is_valid_home_mosaic(normalized_payload) or normalized_image_path is not null) then
    raise invalid_parameter_value using message='invalid_curation_mosaic';
  end if;

  if normalized_kind='hero' and not private.is_valid_home_hero_style(normalized_payload) then
    raise invalid_parameter_value using message='invalid_hero_style';
  end if;

  if normalized_kind='hero' and not private.is_valid_home_hero_alt(normalized_payload) then
    raise invalid_parameter_value using message='invalid_hero_alt';
  end if;

  if normalized_kind='product_collection' and (not private.is_valid_home_product_collection(normalized_payload)
    or normalized_image_path is not null or normalized_title~'[[:cntrl:]]') then
    raise invalid_parameter_value using message='invalid_curation_product_collection';
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

  if require_saved_version then
    request_payload := request_payload || pg_catalog.jsonb_build_object('expected_updated_at',target_expected_updated_at);
  end if;

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
  if curation_exists and previous_curation.archived_at is not null then
    raise sqlstate 'PT409' using message='curation_archived';
  end if;

  if require_saved_version and ((curation_exists and previous_curation.updated_at is distinct from target_expected_updated_at)
    or (not curation_exists and target_expected_updated_at is not null)) then
    raise sqlstate 'PT409' using message='curation_conflict';
  end if;

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
$function$;

revoke all on function private.save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz,boolean) from public, anon, authenticated, service_role;
grant execute on function private.save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz,boolean) to postgres;

-- The public wrappers keep their signatures and bodies; only the shared core
-- changed. Re-register the core's execution metadata and re-assert both
-- wrapper contracts so operator_capability_coverage.sql stays exact.
select private.register_operator_internal_contract('private.is_valid_home_notice_page_types(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.is_valid_home_notice_payload(text,jsonb,text)'::regprocedure);
select private.register_operator_internal_contract('private.save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz,boolean)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb)'::regprocedure, 'store.manage', 'manual', false);
select private.register_operator_rpc_contract('public.admin_save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz)'::regprocedure, 'store.manage', 'manual', false);

notify pgrst, 'reload schema';
