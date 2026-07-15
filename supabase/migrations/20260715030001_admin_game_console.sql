-- Audited card-game catalog operations and cross-catalog invariants (#100).

-- Older pools can already total 1.0 with only positive-rarity rows. Normalize
-- those valid pools to the five-row readiness contract without changing odds.
insert into public.pool_odds (pool_id, rarity, probability)
select complete_pool.pool_id, rarity_value.rarity, 0
from (
  select pool_odd.pool_id
  from public.pool_odds as pool_odd
  group by pool_odd.pool_id
  having count(*) > 0 and sum(pool_odd.probability) = 1
) as complete_pool
cross join unnest(enum_range(null::public.rarity)) as rarity_value(rarity)
on conflict (pool_id, rarity) do nothing;

alter table public.games
  add constraint games_id_slug_check
    check (id ~ '^[a-z0-9][a-z0-9-]*$')
    not valid,
  add constraint games_title_not_blank_check
    check (btrim(title, E' \t\n\r\f\v') <> '')
    not valid,
  add constraint games_active_window_check
    check (active_to is null or active_to > active_from)
    not valid;

alter table public.games validate constraint games_id_slug_check;
alter table public.games validate constraint games_title_not_blank_check;
alter table public.games validate constraint games_active_window_check;

create index games_reward_pool_idx
  on public.games (reward_pool_id)
  where reward_pool_id is not null;
create index games_event_idx
  on public.games (event_id)
  where event_id is not null;

-- A first play freezes the renderer/catalog identity. Operating copy and window
-- remain adjustable, including an explicit end operation.
create or replace function public.guard_played_game_catalog_mutation()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    old.id is distinct from new.id
    or old.type is distinct from new.type
    or old.reward_pool_id is distinct from new.reward_pool_id
    or old.event_id is distinct from new.event_id
    or old.config is distinct from new.config
  ) and exists (
    select 1
    from public.game_plays as game_play
    where game_play.game_id = old.id
  ) then
    raise exception 'game_catalog_locked' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger games_guard_played_catalog
before update on public.games
for each row execute function public.guard_played_game_catalog_mutation();

-- A pool edit cannot erase complete containment of any linked game interval.
create or replace function public.guard_game_pool_window()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.games as game
    where game.reward_pool_id = new.id
      and (
        new.active_from > game.active_from
        or (game.active_to is null and new.active_to is not null)
        or (
          game.active_to is not null
          and new.active_to is not null
          and new.active_to < game.active_to
        )
      )
  ) then
    raise exception 'game_pool_window_conflict' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger card_pools_guard_game_window
before update of active_from, active_to on public.card_pools
for each row
when (
  old.active_from is distinct from new.active_from
  or old.active_to is distinct from new.active_to
)
execute function public.guard_game_pool_window();

-- Linked event identity remains compatible with its reward-pool-derived IP.
create or replace function public.guard_game_event_contract()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    old.ip_id is distinct from new.ip_id
    or old.mode is distinct from new.mode
  ) and exists (
    select 1
    from public.games as game
    where game.event_id = old.id
  ) then
    raise exception 'game_event_contract_locked' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger events_guard_game_contract
before update of ip_id, mode on public.events
for each row
when (
  old.ip_id is distinct from new.ip_id
  or old.mode is distinct from new.mode
)
execute function public.guard_game_event_contract();

drop policy if exists games_insert on public.games;
drop policy if exists games_update on public.games;
drop policy if exists games_delete on public.games;

revoke all on table public.games from public, anon, authenticated, service_role;
grant select on table public.games to anon, authenticated, service_role;

create or replace function public.admin_upsert_game(
  target_operation_id uuid,
  target_previous_game_id text,
  target_game_id text,
  target_title text,
  target_reward_pool_id uuid,
  target_event_id text,
  target_per_user_daily_limit integer,
  target_active_from timestamptz,
  target_active_to timestamptz,
  target_end_now boolean
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_previous_game_id text := case
    when target_previous_game_id is null then null
    else nullif(btrim(target_previous_game_id, E' \t\n\r\f\v'), '')
  end;
  normalized_game_id text := case
    when target_game_id is null then null
    else nullif(btrim(target_game_id, E' \t\n\r\f\v'), '')
  end;
  normalized_title text := case
    when target_title is null then null
    else nullif(btrim(target_title, E' \t\n\r\f\v'), '')
  end;
  normalized_event_id text := case
    when target_event_id is null then null
    else nullif(btrim(target_event_id, E' \t\n\r\f\v'), '')
  end;
  request_payload jsonb;
  previous_game public.games%rowtype;
  new_pool public.card_pools%rowtype;
  new_event public.events%rowtype;
  previous_payload jsonb := null;
  after_payload jsonb;
  generated_config jsonb;
  effective_config jsonb;
  rarity_lineup jsonb;
  previous_game_exists boolean := false;
  has_plays boolean := false;
  pool_is_ready boolean := false;
  effective_end timestamptz;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  locked_game_id text;
  locked_pool_id uuid;
  locked_event_id text;
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

  if target_end_now is true then
    if normalized_previous_game_id is null
      or normalized_previous_game_id !~ '^[a-z0-9][a-z0-9-]*$'
    then
      raise exception 'invalid_game_id' using errcode = '22023';
    end if;

    request_payload := jsonb_build_object(
      'game_id', normalized_previous_game_id,
      'end_now', true
    );

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'admin_game_operation:' || target_operation_id::text,
        0
      )
    );

    select audit.actor_id, audit.action, audit.target, audit.diff
      into existing_actor_id, existing_action, existing_target, existing_diff
    from public.audit_log as audit
    where audit.id = target_operation_id;

    if found then
      if existing_actor_id = actor_id
        and existing_action = 'admin.game.ended'
        and existing_target = 'games:' || normalized_previous_game_id
        and existing_diff -> 'request' = request_payload
      then
        return normalized_previous_game_id;
      end if;

      raise exception 'operation_conflict' using errcode = '23505';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'admin_game:' || normalized_previous_game_id,
        0
      )
    );

    select game.*
      into previous_game
    from public.games as game
    where game.id = normalized_previous_game_id
    for update;

    if not found then
      raise exception 'game_not_found' using errcode = 'P0002';
    end if;

    if previous_game.type is distinct from 'marble_roulette'
      or previous_game.config #>> '{variant,kind}' is distinct from 'card'
      or previous_game.config ->> 'marbleCount' is distinct from '10'
      or previous_game.reward_pool_id is null
    then
      raise exception 'game_variant_read_only' using errcode = '23514';
    end if;

    effective_end := statement_timestamp();

    if effective_end <= previous_game.active_from
      or (
        previous_game.active_to is not null
        and effective_end >= previous_game.active_to
      )
    then
      raise exception 'game_not_active' using errcode = '55000';
    end if;

    previous_payload := jsonb_build_object(
      'id', previous_game.id,
      'type', previous_game.type,
      'title', previous_game.title,
      'event_id', previous_game.event_id,
      'config', previous_game.config,
      'reward_pool_id', previous_game.reward_pool_id,
      'per_user_daily_limit', previous_game.per_user_daily_limit,
      'active_from', previous_game.active_from,
      'active_to', previous_game.active_to
    );

    update public.games
    set active_to = effective_end
    where id = normalized_previous_game_id;

    after_payload := previous_payload || jsonb_build_object('active_to', effective_end);

    insert into public.audit_log (id, actor_id, action, target, diff)
    values (
      target_operation_id,
      actor_id,
      'admin.game.ended',
      'games:' || normalized_previous_game_id,
      jsonb_build_object(
        'request', request_payload,
        'before', previous_payload,
        'after', after_payload
      )
    );

    return normalized_previous_game_id;
  end if;

  if normalized_game_id is null
    or normalized_game_id !~ '^[a-z0-9][a-z0-9-]*$'
    or (
      normalized_previous_game_id is not null
      and normalized_previous_game_id !~ '^[a-z0-9][a-z0-9-]*$'
    )
  then
    raise exception 'invalid_game_id' using errcode = '22023';
  end if;

  if normalized_title is null then
    raise exception 'invalid_game_title' using errcode = '22023';
  end if;

  if target_per_user_daily_limit is null
    or target_per_user_daily_limit not between 1 and 100
  then
    raise exception 'invalid_game_daily_limit' using errcode = '22023';
  end if;

  if target_active_from is null then
    raise exception 'invalid_game_active_from' using errcode = '22004';
  end if;

  if target_active_to is not null and target_active_to <= target_active_from then
    raise exception 'invalid_game_active_window' using errcode = '23514';
  end if;

  if target_reward_pool_id is null then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  request_payload := jsonb_build_object(
    'previous_game_id', normalized_previous_game_id,
    'game_id', normalized_game_id,
    'title', normalized_title,
    'reward_pool_id', target_reward_pool_id,
    'event_id', normalized_event_id,
    'per_user_daily_limit', target_per_user_daily_limit,
    'active_from', target_active_from,
    'active_to', target_active_to,
    'end_now', false
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_game_operation:' || target_operation_id::text,
      0
    )
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.game.upserted'
      and existing_target = 'games:' || normalized_game_id
      and existing_diff -> 'request' = request_payload
    then
      return normalized_game_id;
    end if;

    raise exception 'operation_conflict' using errcode = '23505';
  end if;

  -- A->B and B->A renames take identical advisory locks in lexical order.
  for locked_game_id in
    select distinct locked.id
    from unnest(array[normalized_previous_game_id, normalized_game_id]::text[])
      as locked(id)
    where locked.id is not null
    order by locked.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('admin_game:' || locked_game_id, 0)
    );
  end loop;

  if normalized_previous_game_id is null then
    perform 1
    from public.games as game
    where game.id = normalized_game_id
    for update;

    if found then
      raise exception 'game_id_conflict' using errcode = '23505';
    end if;
  else
    select game.*
      into previous_game
    from public.games as game
    where game.id = normalized_previous_game_id
    for update;

    if not found then
      raise exception 'game_not_found' using errcode = 'P0002';
    end if;

    previous_game_exists := true;

    if previous_game.type is distinct from 'marble_roulette'
      or previous_game.config #>> '{variant,kind}' is distinct from 'card'
      or previous_game.config ->> 'marbleCount' is distinct from '10'
      or previous_game.reward_pool_id is null
    then
      raise exception 'game_variant_read_only' using errcode = '23514';
    end if;

    if normalized_game_id is distinct from normalized_previous_game_id then
      perform 1
      from public.games as game
      where game.id = normalized_game_id
      for update;

      if found then
        raise exception 'game_id_conflict' using errcode = '23505';
      end if;
    end if;

    -- This separate statement runs after the row lock wait, so a concurrent
    -- play committed ahead of us is visible before any immutable mutation.
    select exists (
      select 1
      from public.game_plays as game_play
      where game_play.game_id = normalized_previous_game_id
    ) into has_plays;

    if has_plays and (
      normalized_game_id is distinct from previous_game.id
      or target_reward_pool_id is distinct from previous_game.reward_pool_id
      or normalized_event_id is distinct from previous_game.event_id
    ) then
      raise exception 'game_catalog_locked' using errcode = '23514';
    end if;
  end if;

  -- Pool rows are shared in a stable order. This serializes both play/runtime
  -- reads and pool-window mutations with the same catalog snapshot.
  for locked_pool_id in
    select distinct locked.id
    from unnest(array[
      case when previous_game_exists then previous_game.reward_pool_id else null end,
      target_reward_pool_id
    ]::uuid[]) as locked(id)
    where locked.id is not null
    order by locked.id
  loop
    perform 1
    from public.card_pools as pool
    where pool.id = locked_pool_id
    for share;
  end loop;

  select pool.*
    into new_pool
  from public.card_pools as pool
  where pool.id = target_reward_pool_id;

  if not found then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  if new_pool.active_to is not null
    and statement_timestamp() >= new_pool.active_to
  then
    raise exception 'reward_pool_not_ready' using errcode = '55000';
  end if;

  select
    count(*) = 5
    and coalesce(sum(pool_odd.probability), 0) = 1
    and coalesce(bool_and(pool_odd.probability between 0 and 1), false)
    and not exists (
      select 1
      from public.pool_odds as positive_odd
      where positive_odd.pool_id = target_reward_pool_id
        and positive_odd.probability > 0
        and not exists (
          select 1
          from public.cards as card
          where card.pool_id = target_reward_pool_id
            and card.rarity = positive_odd.rarity
        )
    )
    into pool_is_ready
  from public.pool_odds as pool_odd
  where pool_odd.pool_id = target_reward_pool_id;

  if not pool_is_ready then
    raise exception 'reward_pool_not_ready' using errcode = '55000';
  end if;

  if new_pool.active_from > target_active_from
    or (target_active_to is null and new_pool.active_to is not null)
    or (
      target_active_to is not null
      and new_pool.active_to is not null
      and new_pool.active_to < target_active_to
    )
  then
    raise exception 'game_pool_window_not_covered' using errcode = '23514';
  end if;

  -- Existing and requested events are shared in lexical order. FOR SHARE is
  -- required because IP/mode updates do not necessarily change key columns.
  for locked_event_id in
    select distinct locked.id
    from unnest(array[
      case when previous_game_exists then previous_game.event_id else null end,
      normalized_event_id
    ]::text[]) as locked(id)
    where locked.id is not null
    order by locked.id
  loop
    perform 1
    from public.events as event
    where event.id = locked_event_id
    for share;
  end loop;

  if normalized_event_id is not null then
    select event.*
      into new_event
    from public.events as event
    where event.id = normalized_event_id;

    if not found then
      raise exception 'event_not_found' using errcode = 'P0002';
    end if;

    if new_event.ip_id is distinct from new_pool.ip_id then
      raise exception 'game_event_ip_mismatch' using errcode = '23514';
    end if;

    if new_event.mode is distinct from '온라인' then
      raise exception 'game_event_mode_invalid' using errcode = '23514';
    end if;
  end if;

  -- Hamilton/largest-remainder allocation. Equal remainders and the final
  -- cosmetic lineup both use the public.rarity enum order N,R,SR,SSR,HOLO.
  with slot_share as (
    select
      pool_odd.rarity,
      floor(pool_odd.probability * 10)::integer as base_slots,
      pool_odd.probability * 10 - floor(pool_odd.probability * 10) as remainder
    from public.pool_odds as pool_odd
    where pool_odd.pool_id = target_reward_pool_id
  ),
  ranked_share as (
    select
      slot_share.*,
      row_number() over (
        order by slot_share.remainder desc, slot_share.rarity
      ) as remainder_rank,
      10 - sum(slot_share.base_slots) over () as remaining_slots
    from slot_share
  ),
  expanded_slot as (
    select ranked_share.rarity, generated.slot
    from ranked_share
    cross join lateral generate_series(
      1,
      ranked_share.base_slots
        + case
            when ranked_share.remainder_rank <= ranked_share.remaining_slots then 1
            else 0
          end
    ) as generated(slot)
  )
  select jsonb_agg(to_jsonb(expanded_slot.rarity::text)
    order by expanded_slot.rarity, expanded_slot.slot)
    into rarity_lineup
  from expanded_slot;

  generated_config := jsonb_build_object(
    'marbleCount', 10,
    'variant', jsonb_build_object(
      'kind', 'card',
      'rarityLineup', rarity_lineup
    )
  );

  if previous_game_exists then
    previous_payload := jsonb_build_object(
      'id', previous_game.id,
      'type', previous_game.type,
      'title', previous_game.title,
      'event_id', previous_game.event_id,
      'config', previous_game.config,
      'reward_pool_id', previous_game.reward_pool_id,
      'per_user_daily_limit', previous_game.per_user_daily_limit,
      'active_from', previous_game.active_from,
      'active_to', previous_game.active_to
    );
  end if;

  effective_config := case
    when has_plays then previous_game.config
    else generated_config
  end;

  if previous_game_exists then
    update public.games
    set
      id = normalized_game_id,
      type = 'marble_roulette',
      title = normalized_title,
      event_id = normalized_event_id,
      config = effective_config,
      reward_pool_id = target_reward_pool_id,
      per_user_daily_limit = target_per_user_daily_limit,
      active_from = target_active_from,
      active_to = target_active_to
    where id = normalized_previous_game_id;
  else
    insert into public.games (
      id,
      type,
      title,
      event_id,
      config,
      reward_pool_id,
      per_user_daily_limit,
      active_from,
      active_to
    )
    values (
      normalized_game_id,
      'marble_roulette',
      normalized_title,
      normalized_event_id,
      effective_config,
      target_reward_pool_id,
      target_per_user_daily_limit,
      target_active_from,
      target_active_to
    );
  end if;

  after_payload := jsonb_build_object(
    'id', normalized_game_id,
    'type', 'marble_roulette',
    'title', normalized_title,
    'event_id', normalized_event_id,
    'config', effective_config,
    'reward_pool_id', target_reward_pool_id,
    'per_user_daily_limit', target_per_user_daily_limit,
    'active_from', target_active_from,
    'active_to', target_active_to
  );

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.game.upserted',
    'games:' || normalized_game_id,
    jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', after_payload
    )
  );

  return normalized_game_id;
end;
$$;

create or replace function public.admin_list_games()
returns table (
  id text,
  type text,
  title text,
  event_id text,
  event_title text,
  config jsonb,
  variant_kind text,
  marble_count integer,
  reward_pool_id uuid,
  reward_pool_name text,
  reward_pool_active_from timestamptz,
  reward_pool_active_to timestamptz,
  reward_pool_ready boolean,
  ip_id text,
  ip_title text,
  per_user_daily_limit integer,
  active_from timestamptz,
  active_to timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  play_count bigint,
  last_played_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    game.id,
    game.type,
    game.title,
    game.event_id,
    event.title as event_title,
    game.config,
    case
      when game.config #>> '{variant,kind}' in ('card', 'goods')
        then game.config #>> '{variant,kind}'
      else 'unknown'
    end as variant_kind,
    case
      when game.config ->> 'marbleCount' ~ '^[0-9]{1,9}$'
        then (game.config ->> 'marbleCount')::integer
      else null
    end as marble_count,
    game.reward_pool_id,
    pool.name as reward_pool_name,
    pool.active_from as reward_pool_active_from,
    pool.active_to as reward_pool_active_to,
    coalesce(pool_readiness.ready, false) as reward_pool_ready,
    pool.ip_id,
    ip.title as ip_title,
    game.per_user_daily_limit,
    game.active_from,
    game.active_to,
    game.created_at,
    game.updated_at,
    play_summary.play_count,
    play_summary.last_played_at
  from public.games as game
  left join public.card_pools as pool
    on pool.id = game.reward_pool_id
  left join public.ips as ip
    on ip.id = pool.ip_id
  left join public.events as event
    on event.id = game.event_id
  left join lateral (
    select
      count(*) = 5
      and coalesce(sum(pool_odd.probability), 0) = 1
      and coalesce(bool_and(pool_odd.probability between 0 and 1), false)
      and not exists (
        select 1
        from public.pool_odds as positive_odd
        where positive_odd.pool_id = pool.id
          and positive_odd.probability > 0
          and not exists (
            select 1
            from public.cards as card
            where card.pool_id = pool.id
              and card.rarity = positive_odd.rarity
          )
      ) as ready
    from public.pool_odds as pool_odd
    where pool_odd.pool_id = pool.id
  ) as pool_readiness on true
  left join lateral (
    select
      count(*)::bigint as play_count,
      max(game_play.created_at) as last_played_at
    from public.game_plays as game_play
    where game_play.game_id = game.id
  ) as play_summary on true
  order by game.created_at desc, game.id;
end;
$$;

revoke all on function public.admin_upsert_game(
  uuid, text, text, text, uuid, text, integer, timestamptz, timestamptz, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_game(
  uuid, text, text, text, uuid, text, integer, timestamptz, timestamptz, boolean
) to authenticated;

revoke all on function public.admin_list_games()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_games() to authenticated;

revoke all on function public.guard_played_game_catalog_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_game_pool_window()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_game_event_contract()
  from public, anon, authenticated, service_role;
