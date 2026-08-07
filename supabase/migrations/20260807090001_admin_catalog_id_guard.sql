-- 어드민 카탈로그 신규 등록이 기존 레코드를 조용히 덮어쓰던 문제를 막는다 (#181).
--
-- 기존 admin_upsert_* 는 무조건 `on conflict (id) do update` 였다. 운영자가 신규
-- 등록 폼에 이미 존재하는 ID를 입력하면 경고 없이 기존 레코드가 교체됐다.
--
-- 저장 의도를 RPC 인자로 명시한다.
--   target_previous_id is null      → 신규 등록. 이미 있으면 catalog_id_taken.
--   target_previous_id is not null  → 목록에서 선택한 레코드 수정.
--                                     대상이 없으면 catalog_record_missing,
--                                     ID를 바꾸려 하면 catalog_id_immutable.
--
-- 게임(admin_upsert_game)은 이미 target_previous_game_id 로 같은 계약을 갖고
-- game_id_conflict 를 던진다. 그래서 여기서 다루지 않는다.

drop function if exists public.admin_upsert_ip(
  text, text, text, text, text, text, text, text, text, boolean
);

create function public.admin_upsert_ip(
  target_id text,
  target_title text,
  target_sub text,
  target_vertical_key text,
  target_tagline text,
  target_synopsis text,
  target_glyph text,
  target_bg text,
  target_image_path text,
  target_featured boolean,
  target_previous_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_id is not null then
    if normalized_previous_id is distinct from target_id then
      raise exception 'catalog_id_immutable' using errcode = '22023';
    end if;

    perform 1 from public.ips where id = target_id for update;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  -- 신규 등록(normalized_previous_id is null)에서는 do update 가 걸러진다.
  -- 충돌한 행이 갱신되지 않으므로 found 가 false 가 되고 아래에서 막는다.
  insert into public.ips (
    id,
    title,
    sub,
    vertical_key,
    tagline,
    synopsis,
    glyph,
    bg,
    image_path,
    featured
  )
  values (
    target_id,
    target_title,
    target_sub,
    target_vertical_key,
    target_tagline,
    target_synopsis,
    target_glyph,
    target_bg,
    target_image_path,
    target_featured
  )
  on conflict (id) do update set
    title = excluded.title,
    sub = excluded.sub,
    vertical_key = excluded.vertical_key,
    tagline = excluded.tagline,
    synopsis = excluded.synopsis,
    glyph = excluded.glyph,
    bg = excluded.bg,
    image_path = excluded.image_path,
    featured = excluded.featured,
    updated_at = now()
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.ip.upsert',
    'ips:' || target_id,
    jsonb_build_object(
      'id', target_id,
      'title', target_title,
      'vertical_key', target_vertical_key,
      'mode', case when normalized_previous_id is null then 'create' else 'update' end
    )
  );
end;
$$;

drop function if exists public.admin_upsert_good(
  text, text, text, text, integer, text, text, text, text
);

create function public.admin_upsert_good(
  target_id text,
  target_ip_id text,
  target_name text,
  target_type text,
  target_price integer,
  target_badge text,
  target_stock text,
  target_bg text,
  target_image_path text,
  target_previous_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
  previous_ip_id text;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_id is not null and normalized_previous_id is distinct from target_id then
    raise exception 'catalog_id_immutable' using errcode = '22023';
  end if;

  select ip_id into previous_ip_id from public.goods where id = target_id for update;

  if normalized_previous_id is not null and not found then
    raise exception 'catalog_record_missing' using errcode = 'P0002';
  end if;

  insert into public.goods (
    id,
    ip_id,
    name,
    type,
    price,
    badge,
    stock,
    bg,
    image_path
  )
  values (
    target_id,
    target_ip_id,
    target_name,
    target_type,
    target_price,
    target_badge,
    target_stock,
    target_bg,
    target_image_path
  )
  on conflict (id) do update set
    ip_id = excluded.ip_id,
    name = excluded.name,
    type = excluded.type,
    price = excluded.price,
    badge = excluded.badge,
    stock = excluded.stock,
    bg = excluded.bg,
    image_path = excluded.image_path,
    updated_at = now()
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  update public.ips
  set goods_count = (
      select count(*)::integer from public.goods where goods.ip_id = ips.id
    ),
    updated_at = now()
  where id in (target_ip_id, previous_ip_id);

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.good.upsert',
    'goods:' || target_id,
    jsonb_build_object(
      'id', target_id,
      'ip_id', target_ip_id,
      'name', target_name,
      'price', target_price,
      'mode', case when normalized_previous_id is null then 'create' else 'update' end
    )
  );
end;
$$;

drop function if exists public.admin_upsert_event(
  text, text, text, text, text, timestamptz, timestamptz, text, text, text, text
);

create function public.admin_upsert_event(
  target_id text,
  target_ip_id text,
  target_title text,
  target_mode text,
  target_status text,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  target_location text,
  target_accent text,
  target_bg text,
  target_image_path text,
  target_previous_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_id is not null then
    if normalized_previous_id is distinct from target_id then
      raise exception 'catalog_id_immutable' using errcode = '22023';
    end if;

    perform 1 from public.events where id = target_id for update;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  insert into public.events (
    id,
    ip_id,
    title,
    mode,
    status,
    starts_at,
    ends_at,
    location,
    accent,
    bg,
    image_path
  )
  values (
    target_id,
    target_ip_id,
    target_title,
    target_mode,
    target_status,
    target_starts_at,
    target_ends_at,
    target_location,
    target_accent,
    target_bg,
    target_image_path
  )
  on conflict (id) do update set
    ip_id = excluded.ip_id,
    title = excluded.title,
    mode = excluded.mode,
    status = excluded.status,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    location = excluded.location,
    accent = excluded.accent,
    bg = excluded.bg,
    image_path = excluded.image_path,
    updated_at = now()
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.event.upsert',
    'events:' || target_id,
    jsonb_build_object(
      'id', target_id,
      'ip_id', target_ip_id,
      'title', target_title,
      'status', target_status,
      'mode', case when normalized_previous_id is null then 'create' else 'update' end
    )
  );
end;
$$;

revoke all on function public.admin_upsert_ip(
  text, text, text, text, text, text, text, text, text, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_ip(
  text, text, text, text, text, text, text, text, text, boolean, text
) to authenticated;

revoke all on function public.admin_upsert_good(
  text, text, text, text, integer, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_good(
  text, text, text, text, integer, text, text, text, text, text
) to authenticated;

revoke all on function public.admin_upsert_event(
  text, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_event(
  text, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text
) to authenticated;

drop function if exists public.admin_upsert_card(
  text, text, text, text, rarity, text, text, uuid, boolean
);

create function public.admin_upsert_card(
  target_id text,
  target_ip_id text,
  target_name text,
  target_no text,
  target_rarity rarity,
  target_bg text,
  target_image_path text,
  target_pool_id uuid default null,
  target_pool_binding_provided boolean default false,
  target_previous_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_id text := btrim(target_id, E' \t\n\r\f\v');
  normalized_ip_id text := btrim(target_ip_id, E' \t\n\r\f\v');
  normalized_name text := btrim(target_name, E' \t\n\r\f\v');
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
  previous_card public.cards%rowtype;
  previous_payload jsonb := null;
  after_payload jsonb;
  request_payload jsonb;
  card_exists boolean := false;
  effective_pool_id uuid;
  target_pool_ip_id text;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_id is null or normalized_id = '' then
    raise exception 'invalid_card_id' using errcode = '22023';
  end if;

  if normalized_ip_id is null or normalized_ip_id = '' then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception 'invalid_card_name' using errcode = '22023';
  end if;

  if target_rarity is null then
    raise exception 'invalid_card_rarity' using errcode = '22004';
  end if;

  if target_pool_binding_provided is null
    or (not target_pool_binding_provided and target_pool_id is not null)
  then
    raise exception 'invalid_pool_binding_mode' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_card:' || normalized_id, 0)
  );

  select card.*
    into previous_card
  from public.cards as card
  where card.id = normalized_id
  for update;

  card_exists := found;

  -- #181 신규 등록이 기존 카드를 덮어쓰지 못하게 한다.
  if normalized_previous_id is null then
    if card_exists then
      raise exception 'catalog_id_taken' using errcode = '23505';
    end if;
  else
    if normalized_previous_id is distinct from normalized_id then
      raise exception 'catalog_id_immutable' using errcode = '22023';
    end if;

    if not card_exists then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  if target_pool_binding_provided then
    effective_pool_id := target_pool_id;
  elsif card_exists then
    effective_pool_id := previous_card.pool_id;
  else
    effective_pool_id := null;
  end if;

  perform pool.id
  from public.card_pools as pool
  where pool.id = previous_card.pool_id
     or pool.id = effective_pool_id
  order by pool.id
  for update;

  perform 1
  from public.ips
  where id = normalized_ip_id
  for key share;

  if not found then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  if card_exists then
    previous_payload := jsonb_build_object(
      'id', previous_card.id,
      'ip_id', previous_card.ip_id,
      'name', previous_card.name,
      'no', previous_card.no,
      'rarity', previous_card.rarity,
      'bg', previous_card.bg,
      'image_path', previous_card.image_path,
      'pool_id', previous_card.pool_id
    );

    if previous_card.pool_id is not null
      and (
        previous_card.ip_id is distinct from normalized_ip_id
        or previous_card.rarity is distinct from target_rarity
      )
    then
      raise exception 'pooled_card_catalog_contract_locked' using errcode = '23514';
    end if;
  end if;

  if effective_pool_id is not null then
    select pool.ip_id
      into target_pool_ip_id
    from public.card_pools as pool
    where pool.id = effective_pool_id;

    if not found then
      raise exception 'pool_not_found' using errcode = 'P0002';
    end if;

    if target_pool_ip_id is distinct from normalized_ip_id then
      raise exception 'card_pool_ip_mismatch' using errcode = '23514';
    end if;
  end if;

  if card_exists
    and previous_card.pool_id is not null
    and previous_card.pool_id is distinct from effective_pool_id
    and exists (
      select 1
      from public.pool_odds
      where pool_id = previous_card.pool_id
        and rarity = previous_card.rarity
        and probability > 0
    )
    and not exists (
      select 1
      from public.cards as other_card
      where other_card.pool_id = previous_card.pool_id
        and other_card.rarity = previous_card.rarity
        and other_card.id <> previous_card.id
    )
  then
    raise exception 'pool_rarity_uncovered' using errcode = '23514';
  end if;

  request_payload := jsonb_build_object(
    'id', normalized_id,
    'ip_id', normalized_ip_id,
    'name', normalized_name,
    'no', target_no,
    'rarity', target_rarity,
    'bg', target_bg,
    'image_path', target_image_path,
    'pool_id', effective_pool_id,
    'pool_binding_provided', target_pool_binding_provided,
    'mode', case when normalized_previous_id is null then 'create' else 'update' end
  );

  insert into public.cards (
    id,
    ip_id,
    name,
    no,
    rarity,
    bg,
    image_path,
    pool_id
  )
  values (
    normalized_id,
    normalized_ip_id,
    normalized_name,
    target_no,
    target_rarity,
    target_bg,
    target_image_path,
    effective_pool_id
  )
  on conflict (id) do update set
    ip_id = excluded.ip_id,
    name = excluded.name,
    no = excluded.no,
    rarity = excluded.rarity,
    bg = excluded.bg,
    image_path = excluded.image_path,
    pool_id = excluded.pool_id;

  update public.ips
  set cards_count = (
      select count(*)::integer from public.cards where cards.ip_id = ips.id
    ),
    updated_at = now()
  where id in (normalized_ip_id, previous_card.ip_id);

  after_payload := jsonb_build_object(
    'id', normalized_id,
    'ip_id', normalized_ip_id,
    'name', normalized_name,
    'no', target_no,
    'rarity', target_rarity,
    'bg', target_bg,
    'image_path', target_image_path,
    'pool_id', effective_pool_id
  );

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.card.upsert',
    'cards:' || normalized_id,
    jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', after_payload
    )
  );
end;
$$;

revoke all on function public.admin_upsert_card(
  text, text, text, text, rarity, text, text, uuid, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_card(
  text, text, text, text, rarity, text, text, uuid, boolean, text
) to authenticated;
