-- Eight fixed product/image positions, separate from manual product bands.
create function private.is_valid_home_mosaic(candidate jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare slot jsonb; field text; caption text;
begin
  if jsonb_typeof(candidate) is distinct from 'object' or not(candidate ?& array['mosaic_title','mosaic_subtitle','slots'])
    or (select count(*) from jsonb_object_keys(candidate))<>3 then return false; end if;
  foreach field in array array['mosaic_title','mosaic_subtitle'] loop
    if jsonb_typeof(candidate->field) is distinct from 'string' then return false; end if;
    caption:=candidate->>field;
    if caption<>btrim(caption,E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') or caption ~ '[[:cntrl:]]'
      or char_length(caption)>(case field when 'mosaic_title' then 10 else 20 end) then return false; end if;
  end loop;
  if jsonb_typeof(candidate->'slots') is distinct from 'array' or jsonb_array_length(candidate->'slots')<>8 then return false; end if;
  for slot in select value from jsonb_array_elements(candidate->'slots') loop
    if jsonb_typeof(slot) is distinct from 'object' or not(slot ?& array['good_id','image_path'])
      or (select count(*) from jsonb_object_keys(slot))<>2 then return false; end if;
    if slot->'good_id'<>'null'::jsonb and (jsonb_typeof(slot->'good_id')<>'string' or slot->>'good_id' !~ '^[A-Za-z0-9_-]{1,64}$') then return false; end if;
    if slot->'image_path'<>'null'::jsonb and (jsonb_typeof(slot->'image_path')<>'string'
      or slot->>'image_path' !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$') then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function private.is_valid_home_mosaic(jsonb) from public,anon,authenticated,service_role;
alter table public.home_curations drop constraint home_curations_kind_check;
alter table public.home_curations add constraint home_curations_kind_check check(kind in (
  'hero','featured_ip','announcement','notice_strip','editor_pick','band_banner','best_tab','benefit','sales_best','review_best','product_mosaic'
));
alter table public.home_curations add constraint home_curations_mosaic_check check(kind<>'product_mosaic'
  or (char_length(title)<=15 and image_path is null and private.is_valid_home_mosaic(payload)));

-- Payload images are outside the legacy image_path trigger. Validate and consume
-- each unique new path once; paths retained in this same mosaic may move slots.
create function private.guard_home_mosaic_artwork() returns trigger
language plpgsql security definer set search_path='' as $$
declare image text; previous_paths text[]:='{}'; claim public.admin_artwork_upload_claims;
begin
  if new.kind<>'product_mosaic' then return new; end if;
  if not private.is_valid_home_mosaic(new.payload) then raise invalid_parameter_value using message='invalid_curation_mosaic'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('home_product_mosaic_count',0));
  if (select count(*) from public.home_curations where kind='product_mosaic' and id<>new.id)>=5 then
    raise check_violation using message='home_mosaic_limit';
  end if;
  if tg_op='UPDATE' and old.kind='product_mosaic' then
    select coalesce(array_agg(distinct item->>'image_path') filter(where item->>'image_path' is not null),'{}')
      into previous_paths from jsonb_array_elements(old.payload->'slots') item;
  end if;
  for image in select distinct item->>'image_path' from jsonb_array_elements(new.payload->'slots') item
    where item->>'image_path' is not null order by 1
  loop
    if image=any(previous_paths) then continue; end if;
    select * into claim from public.admin_artwork_upload_claims where path=substr(image,length('public-media/')+1) for update;
    if not found or claim.actor_id is distinct from auth.uid() or claim.kind<>'curation' or claim.status<>'verified'
      or claim.verified_at is null or claim.final_size is null or claim.attached_at is not null or claim.expires_at<=clock_timestamp()
    then raise check_violation using message='unverified_artwork'; end if;
    if claim.source_size>900*1024 or claim.final_size>900*1024 then raise check_violation using message='mosaic_image_too_large'; end if;
    update public.admin_artwork_upload_claims set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp() where path=claim.path;
  end loop;
  return new;
end $$;
revoke all on function private.guard_home_mosaic_artwork() from public,anon,authenticated,service_role;
create trigger home_curations_mosaic_artwork before insert or update on public.home_curations for each row execute function private.guard_home_mosaic_artwork();

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
      'notice_strip', 'editor_pick', 'band_banner', 'best_tab', 'benefit', 'sales_best', 'review_best', 'product_mosaic'
    )
  then
    raise invalid_parameter_value using message = 'invalid_curation_kind';
  end if;
  if normalized_title is null
    or pg_catalog.char_length(normalized_title) not between 1 and 120
    or (normalized_kind in ('sales_best','review_best','product_mosaic') and pg_catalog.char_length(normalized_title)>15)
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
    when 'best_tab' then array['good_ids', 'selection_mode', 'item_count']
    when 'benefit' then array['description']
    when 'sales_best' then array['exposure_mode','period']
    when 'review_best' then array['selection_mode','good_ids']
    when 'product_mosaic' then array['mosaic_title','mosaic_subtitle','slots']
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
      payload_good_id_limit := case normalized_kind when 'best_tab' then 12 when 'review_best' then 20 else 4 end;
      if pg_catalog.jsonb_typeof(payload_good_ids) <> 'array'
        or pg_catalog.jsonb_array_length(payload_good_ids) not between (case when normalized_kind='review_best' then 0 else 1 end) and payload_good_id_limit
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
  end if;

  if not private.is_valid_home_ranked_curation(normalized_kind, normalized_payload) then
    raise invalid_parameter_value using message='invalid_curation_payload';
  end if;

  if normalized_kind='product_mosaic' and (not private.is_valid_home_mosaic(normalized_payload) or normalized_image_path is not null) then
    raise invalid_parameter_value using message='invalid_curation_mosaic';
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


revoke all on function public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb) to authenticated;

create or replace function private.is_valid_home_layout_blocks(candidate jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare entry jsonb; block_key text; seen text[] := '{}';
begin
  if candidate is null then return true; end if;
  if pg_catalog.jsonb_typeof(candidate) <> 'array'
    or pg_catalog.jsonb_array_length(candidate) not between 5 and 1000 then return false; end if;
  for entry in select value from pg_catalog.jsonb_array_elements(candidate)
  loop
    if pg_catalog.jsonb_typeof(entry) <> 'object'
      or pg_catalog.jsonb_typeof(entry->'key') is distinct from 'string'
      or pg_catalog.jsonb_typeof(entry->'enabled') is distinct from 'boolean'
      or exists(select 1 from pg_catalog.jsonb_object_keys(entry) field where field not in ('key','enabled'))
    then return false; end if;
    block_key := entry->>'key';
    if block_key = any(seen) then return false; end if;
    if block_key not in ('hero','editor_picks','category_best','popular','benefits')
      and block_key !~ '^(band|sales|reviews|mosaic):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then return false; end if;
    seen := pg_catalog.array_append(seen, block_key);
  end loop;
  return array['hero','editor_picks','category_best','popular','benefits']::text[] <@ seen;
end;
$$;
revoke all on function private.is_valid_home_layout_blocks(jsonb) from public, anon, authenticated, service_role;

create or replace function public.get_home_layout_order()
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare configured jsonb; result text[];
begin
  select blocks into configured from public.home_layout_settings where singleton;
  if configured is null then return null; end if;
  with requested as (
    select item->>'key' as key, item->'enabled'='true'::jsonb as enabled, position
    from pg_catalog.jsonb_array_elements(configured) with ordinality entries(item,position)
  ), active_bands as (
    select (case kind when 'band_banner' then 'band:' when 'sales_best' then 'sales:' when 'review_best' then 'reviews:' else 'mosaic:' end)||id::text as key,
      case kind when 'band_banner' then 0 when 'sales_best' then 1 when 'review_best' then 2 else 3 end as kind_order,display_order, active_from, id
    from public.home_curations
    where kind in ('band_banner','sales_best','review_best','product_mosaic') and enabled and active_from<=now()
      and (active_to is null or active_to>now())
  ), ordered as (
    select requested.key, requested.position
    from requested
    where requested.enabled and (
      requested.key in ('hero','editor_picks','category_best','popular','benefits')
      or exists(select 1 from active_bands where active_bands.key=requested.key)
    )
    union all
    select active_bands.key,
      pg_catalog.jsonb_array_length(configured)+row_number() over(order by kind_order,display_order,active_from,id)
    from active_bands where not exists(select 1 from requested where requested.key=active_bands.key)
  )
  select coalesce(pg_catalog.array_agg(key order by position),'{}'::text[]) into result from ordered;
  return result;
end;
$$;
revoke all on function public.get_home_layout_order() from public, anon, authenticated, service_role;
grant execute on function public.get_home_layout_order() to anon, authenticated;

create or replace function public.admin_save_home_layout(target_operation_id uuid, expected_revision bigint, target_blocks jsonb)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid()); previous public.home_layout_settings; saved public.home_layout_settings;
  audit_entry public.audit_log; request_payload jsonb; block_ref record;
begin
  if actor is null then raise invalid_authorization_specification using message='auth_required'; end if;
  if not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if target_operation_id is null or expected_revision is null or expected_revision<0
    or target_blocks is null or not private.is_valid_home_layout_blocks(target_blocks)
  then raise invalid_parameter_value using message='invalid_home_layout'; end if;
  request_payload := pg_catalog.jsonb_build_object('expected_revision',expected_revision,'blocks',target_blocks);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_home_layout_operation:'||target_operation_id::text,0));
  select * into audit_entry from public.audit_log where id=target_operation_id;
  if found then
    if audit_entry.actor_id=actor and audit_entry.action='admin.home_layout.saved'
      and audit_entry.target='home_layout_settings' and audit_entry.diff->'request'=request_payload
    then return (audit_entry.diff->'after'->>'revision')::bigint; end if;
    raise unique_violation using message='operation_conflict';
  end if;

  select * into previous from public.home_layout_settings where singleton for update;
  if not found or previous.revision<>expected_revision then
    raise serialization_failure using message='home_layout_conflict';
  end if;
  for block_ref in
    select split_part(entry->>'key',':',2)::uuid as id,
      case split_part(entry->>'key',':',1) when 'band' then 'band_banner' when 'sales' then 'sales_best' when 'reviews' then 'review_best' else 'product_mosaic' end as kind
    from pg_catalog.jsonb_array_elements(target_blocks) entry
    where position(':' in (entry->>'key'))>0 order by entry->>'key'
  loop
    perform 1 from public.home_curations where id=block_ref.id and kind=block_ref.kind for share;
    if not found then raise no_data_found using message='home_layout_block_not_found'; end if;
  end loop;

  update public.home_layout_settings set blocks=target_blocks,revision=revision+1,updated_at=clock_timestamp()
  where singleton returning * into saved;
  insert into public.audit_log(id,actor_id,action,target,diff)
  values(target_operation_id,actor,'admin.home_layout.saved','home_layout_settings',pg_catalog.jsonb_build_object(
    'request',request_payload,
    'before',pg_catalog.jsonb_build_object('blocks',previous.blocks,'revision',previous.revision),
    'after',pg_catalog.jsonb_build_object('blocks',saved.blocks,'revision',saved.revision)
  ));
  return saved.revision;
end;
$$;
revoke all on function public.admin_save_home_layout(uuid,bigint,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_home_layout(uuid,bigint,jsonb) to authenticated;

notify pgrst,'reload schema';
