-- Audited card-pool, odds, and pool-bound card operations (#98).

-- A pool's operating window must be coherent, and a bound card must belong to
-- the same IP as its pool. Validate current data before exposing the stronger
-- contract to subsequent migrations and RPCs.
alter table public.card_pools
  add constraint card_pools_active_window_check
  check (active_to is null or active_to > active_from)
  not valid;

alter table public.card_pools
  validate constraint card_pools_active_window_check;

alter table public.card_pools
  add constraint card_pools_id_ip_id_key unique (id, ip_id);

alter table public.cards
  drop constraint cards_pool_id_fkey;

alter table public.cards
  add constraint cards_pool_ip_id_fkey
  foreign key (pool_id, ip_id)
  references public.card_pools (id, ip_id)
  not valid;

alter table public.cards
  validate constraint cards_pool_ip_id_fkey;

-- Public catalog reads remain, but every card-pool mutation now crosses an
-- audited SECURITY DEFINER boundary.
drop policy if exists pools_insert on public.card_pools;
drop policy if exists pools_update on public.card_pools;
drop policy if exists pools_delete on public.card_pools;
drop policy if exists odds_insert on public.pool_odds;
drop policy if exists odds_update on public.pool_odds;
drop policy if exists odds_delete on public.pool_odds;
drop policy if exists cards_insert on public.cards;
drop policy if exists cards_update on public.cards;
drop policy if exists cards_delete on public.cards;

revoke all on table public.card_pools, public.pool_odds, public.cards
  from public, anon, authenticated;
grant select on table public.card_pools, public.pool_odds, public.cards
  to anon, authenticated;

create or replace function public.admin_upsert_card_pool(
  target_operation_id uuid,
  target_pool_id uuid,
  target_ip_id text,
  target_name text,
  target_active_from timestamptz,
  target_active_to timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_ip_id text := btrim(target_ip_id, E' \t\n\r\f\v');
  normalized_name text := btrim(target_name, E' \t\n\r\f\v');
  request_payload jsonb;
  previous_pool public.card_pools%rowtype;
  previous_payload jsonb := null;
  after_payload jsonb;
  pool_exists boolean := false;
  has_dependency boolean := false;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'invalid_operation_id' using errcode = '22004';
  end if;

  if target_pool_id is null then
    raise exception 'invalid_pool_id' using errcode = '22004';
  end if;

  if normalized_ip_id is null or normalized_ip_id = '' then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception 'invalid_pool_name' using errcode = '22023';
  end if;

  if target_active_from is null then
    raise exception 'invalid_active_from' using errcode = '22004';
  end if;

  if target_active_to is not null and target_active_to <= target_active_from then
    raise exception 'invalid_pool_active_window' using errcode = '23514';
  end if;

  request_payload := jsonb_build_object(
    'ip_id', normalized_ip_id,
    'name', normalized_name,
    'active_from', target_active_from,
    'active_to', target_active_to
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_card_pool_operation:' || target_operation_id::text,
      0
    )
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.card_pool.upserted'
      and existing_target = 'card_pools:' || target_pool_id::text
      and existing_diff -> 'request' = request_payload
    then
      return target_pool_id;
    end if;

    raise exception 'operation_conflict' using errcode = '23505';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_card_pool:' || target_pool_id::text, 0)
  );

  perform 1
  from public.ips
  where id = normalized_ip_id
  for key share;

  if not found then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  select pool.*
    into previous_pool
  from public.card_pools as pool
  where pool.id = target_pool_id
  for update;

  pool_exists := found;

  if pool_exists then
    previous_payload := jsonb_build_object(
      'id', previous_pool.id,
      'ip_id', previous_pool.ip_id,
      'name', previous_pool.name,
      'active_from', previous_pool.active_from,
      'active_to', previous_pool.active_to
    );

    if previous_pool.ip_id is distinct from normalized_ip_id then
      select exists (
        select 1 from public.cards where pool_id = target_pool_id
        union all
        select 1 from public.reward_policies where pool_id = target_pool_id
        union all
        select 1 from public.games where reward_pool_id = target_pool_id
        union all
        select 1 from public.draw_tickets where pool_id = target_pool_id
        union all
        select 1 from public.card_grants where pool_id = target_pool_id
      ) into has_dependency;

      if has_dependency then
        raise exception 'pool_ip_locked' using errcode = '23514';
      end if;
    end if;

    update public.card_pools
    set ip_id = normalized_ip_id,
        name = normalized_name,
        active_from = target_active_from,
        active_to = target_active_to
    where id = target_pool_id;
  else
    insert into public.card_pools (id, ip_id, name, active_from, active_to)
    values (
      target_pool_id,
      normalized_ip_id,
      normalized_name,
      target_active_from,
      target_active_to
    );
  end if;

  after_payload := jsonb_build_object(
    'id', target_pool_id,
    'ip_id', normalized_ip_id,
    'name', normalized_name,
    'active_from', target_active_from,
    'active_to', target_active_to
  );

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.card_pool.upserted',
    'card_pools:' || target_pool_id::text,
    jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', after_payload
    )
  );

  return target_pool_id;
end;
$$;

create or replace function public.admin_set_pool_odds(
  target_operation_id uuid,
  target_pool_id uuid,
  target_n numeric,
  target_r numeric,
  target_sr numeric,
  target_ssr numeric,
  target_holo numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  request_payload jsonb;
  previous_payload jsonb;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'invalid_operation_id' using errcode = '22004';
  end if;

  if target_pool_id is null then
    raise exception 'invalid_pool_id' using errcode = '22004';
  end if;

  if target_n is null or target_r is null or target_sr is null
    or target_ssr is null or target_holo is null
    or target_n < 0 or target_n > 1
    or target_r < 0 or target_r > 1
    or target_sr < 0 or target_sr > 1
    or target_ssr < 0 or target_ssr > 1
    or target_holo < 0 or target_holo > 1
  then
    raise exception 'invalid_pool_probability' using errcode = '22023';
  end if;

  if target_n <> round(target_n, 5)
    or target_r <> round(target_r, 5)
    or target_sr <> round(target_sr, 5)
    or target_ssr <> round(target_ssr, 5)
    or target_holo <> round(target_holo, 5)
  then
    raise exception 'invalid_probability_precision' using errcode = '22023';
  end if;

  if target_n + target_r + target_sr + target_ssr + target_holo <> 1 then
    raise exception 'pool_odds_must_sum_to_one' using errcode = '23514';
  end if;

  request_payload := jsonb_build_object(
    'N', target_n,
    'R', target_r,
    'SR', target_sr,
    'SSR', target_ssr,
    'HOLO', target_holo
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_pool_odds_operation:' || target_operation_id::text,
      0
    )
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.card_pool.odds_set'
      and existing_target = 'card_pools:' || target_pool_id::text
      and existing_diff -> 'request' = request_payload
    then
      return;
    end if;

    raise exception 'operation_conflict' using errcode = '23505';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_card_pool:' || target_pool_id::text, 0)
  );

  perform 1
  from public.card_pools
  where id = target_pool_id
  for update;

  if not found then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from (values
      ('N'::public.rarity, target_n),
      ('R'::public.rarity, target_r),
      ('SR'::public.rarity, target_sr),
      ('SSR'::public.rarity, target_ssr),
      ('HOLO'::public.rarity, target_holo)
    ) as requested(rarity, probability)
    where requested.probability > 0
      and not exists (
        select 1
        from public.cards as card
        where card.pool_id = target_pool_id
          and card.rarity = requested.rarity
      )
  ) then
    raise exception 'pool_rarity_uncovered' using errcode = '23514';
  end if;

  select jsonb_build_object(
    'N', coalesce(max(probability) filter (where rarity = 'N'), 0),
    'R', coalesce(max(probability) filter (where rarity = 'R'), 0),
    'SR', coalesce(max(probability) filter (where rarity = 'SR'), 0),
    'SSR', coalesce(max(probability) filter (where rarity = 'SSR'), 0),
    'HOLO', coalesce(max(probability) filter (where rarity = 'HOLO'), 0)
  )
    into previous_payload
  from public.pool_odds
  where pool_id = target_pool_id;

  delete from public.pool_odds
  where pool_id = target_pool_id;

  insert into public.pool_odds (pool_id, rarity, probability)
  values
    (target_pool_id, 'N', target_n),
    (target_pool_id, 'R', target_r),
    (target_pool_id, 'SR', target_sr),
    (target_pool_id, 'SSR', target_ssr),
    (target_pool_id, 'HOLO', target_holo);

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.card_pool.odds_set',
    'card_pools:' || target_pool_id::text,
    jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', request_payload
    )
  );
end;
$$;

-- Replace, rather than overload, the catalog RPC. Postgres resolves calls that
-- omit trailing default parameters to this same function, so deployed seven-
-- argument clients preserve the existing pool binding during DB-first rollout.
drop function public.admin_upsert_card(text, text, text, text, rarity, text, text);

create function public.admin_upsert_card(
  target_id text,
  target_ip_id text,
  target_name text,
  target_no text,
  target_rarity rarity,
  target_bg text,
  target_image_path text,
  target_pool_id uuid default null,
  target_pool_binding_provided boolean default false
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
    'pool_binding_provided', target_pool_binding_provided
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

-- Hold a shared lock on the pool while reading its current odds and cards. All
-- admin pool/odds/card mutations take the conflicting exclusive row lock.
create or replace function public.grant_cards(
  p_user_id uuid,
  p_pool_id uuid,
  p_source text,
  p_source_id uuid,
  p_idempotency_key text,
  p_count integer default 1
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_rarity rarity;
  v_card text;
  v_new boolean;
begin
  if p_count < 1 or p_count > 100 then
    raise exception 'invalid count';
  end if;

  perform 1
  from public.card_pools
  where id = p_pool_id
  for share;

  if not found then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  select granted_cards
    into v_existing
  from public.card_grants
  where idempotency_key = p_idempotency_key;

  if v_existing is not null then
    return v_existing;
  end if;

  for i in 1..p_count loop
    v_rarity := public.roll_rarity(p_pool_id);

    select card.id
      into v_card
    from public.cards as card
    where card.pool_id = p_pool_id
      and card.rarity = v_rarity
    order by random()
    limit 1;

    if v_card is null then
      raise exception 'pool has no card of rarity %', v_rarity;
    end if;

    v_new := not exists (
      select 1
      from public.user_cards
      where user_id = p_user_id
        and card_id = v_card
    );

    insert into public.user_cards as user_card (user_id, card_id, qty)
    values (p_user_id, v_card, 1)
    on conflict on constraint user_cards_pkey
    do update set qty = user_card.qty + 1;

    v_cards := v_cards || jsonb_build_object(
      'cardId', v_card,
      'rarity', v_rarity,
      'isNew', v_new
    );
  end loop;

  insert into public.card_grants (
    user_id,
    pool_id,
    source,
    source_id,
    granted_cards,
    idempotency_key
  )
  values (
    p_user_id,
    p_pool_id,
    p_source,
    p_source_id,
    v_cards,
    p_idempotency_key
  );

  return v_cards;
end;
$$;

-- New game grants require both their own operating window and the reward pool's
-- current operating window. A completed daily slot remains replayable after a
-- later pool end; otherwise the pool is locked before any grant ledger write.
create or replace function public.play_game(p_game_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_game record;
  v_pool record;
  v_today date;
  v_count integer;
  v_last jsonb;
  v_play uuid;
  v_idem text;
  v_seed text;
  v_cards jsonb;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'play_game:' || v_user::text || ':' || p_game_id,
      0
    )
  );

  select game.id,
         game.reward_pool_id,
         game.per_user_daily_limit,
         game.active_from,
         game.active_to
    into v_game
  from public.games as game
  where game.id = p_game_id
  for share;

  if v_game.id is null then
    raise exception 'game not found';
  end if;

  if now() < v_game.active_from
    or (v_game.active_to is not null and now() >= v_game.active_to)
  then
    raise exception 'game not active';
  end if;

  if v_game.reward_pool_id is null then
    raise exception 'game has no reward pool';
  end if;

  v_today := (now() at time zone 'Asia/Seoul')::date;

  select count(*)
    into v_count
  from public.game_plays
  where game_id = p_game_id
    and user_id = v_user
    and (created_at at time zone 'Asia/Seoul')::date = v_today;

  if v_count >= v_game.per_user_daily_limit then
    select result
      into v_last
    from public.game_plays
    where idempotency_key = 'game_play:' || p_game_id || ':' || v_user::text || ':'
      || to_char(v_today, 'YYYY-MM-DD') || ':' || v_count;

    if v_last is null then
      raise exception 'daily limit state corrupted';
    end if;

    return v_last;
  end if;

  select pool.id, pool.active_from, pool.active_to
    into v_pool
  from public.card_pools as pool
  where pool.id = v_game.reward_pool_id
  for share;

  if v_pool.id is null
    or now() < v_pool.active_from
    or (v_pool.active_to is not null and now() >= v_pool.active_to)
  then
    raise exception 'reward_pool_not_active' using errcode = '55000';
  end if;

  v_play := extensions.gen_random_uuid();
  v_idem := 'game_play:' || p_game_id || ':' || v_user::text || ':'
    || to_char(v_today, 'YYYY-MM-DD') || ':' || (v_count + 1);
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');

  v_cards := public.grant_cards(
    v_user,
    v_game.reward_pool_id,
    'game_play',
    v_play,
    v_idem,
    1
  );

  v_result := jsonb_build_object(
    'playId', v_play,
    'rewards', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('kind', 'card') || reward.elem
          order by reward.ordinality
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(v_cards) with ordinality as reward(elem, ordinality)
    ),
    'animationSeed', v_seed
  );

  insert into public.game_plays (id, game_id, user_id, result, idempotency_key)
  values (v_play, p_game_id, v_user, v_result, v_idem);

  return v_result;
end;
$$;

-- Explicit ACLs are required because default function privileges grant EXECUTE
-- to PUBLIC in this schema.
revoke all on function public.admin_upsert_card_pool(
  uuid, uuid, text, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_card_pool(
  uuid, uuid, text, text, timestamptz, timestamptz
) to authenticated;

revoke all on function public.admin_set_pool_odds(
  uuid, uuid, numeric, numeric, numeric, numeric, numeric
) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_pool_odds(
  uuid, uuid, numeric, numeric, numeric, numeric, numeric
) to authenticated;

revoke all on function public.admin_upsert_card(
  text, text, text, text, rarity, text, text, uuid, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_card(
  text, text, text, text, rarity, text, text, uuid, boolean
) to authenticated;

revoke all on function public.grant_cards(uuid, uuid, text, uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.roll_rarity(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.play_game(text)
  from public, anon, authenticated, service_role;
grant execute on function public.play_game(text) to authenticated;
