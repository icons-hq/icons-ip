\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000001001',
    'authenticated', 'authenticated', 'game-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000001002',
    'authenticated', 'authenticated', 'game-fan@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000001001',
    'game-staff@example.test', 'game_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000001002',
    'game-fan@example.test', 'game_fan', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.verticals (key, label, color)
values ('admin-game-test', '게임 테스트', '#000000')
on conflict (key) do nothing;

insert into public.ips (id, title, vertical_key)
values
  ('admin-game-ip-a', '게임 테스트 IP A', 'admin-game-test'),
  ('admin-game-ip-b', '게임 테스트 IP B', 'admin-game-test')
on conflict (id) do update set title = excluded.title;

insert into public.events (id, ip_id, title, mode, status)
values
  ('admin-game-event-online-a', 'admin-game-ip-a', '온라인 이벤트 A', '온라인', '진행중'),
  ('admin-game-event-online-b', 'admin-game-ip-b', '온라인 이벤트 B', '온라인', '진행중'),
  ('admin-game-event-offline-a', 'admin-game-ip-a', '오프라인 이벤트 A', '오프라인', '진행중')
on conflict (id) do update set
  ip_id = excluded.ip_id,
  title = excluded.title,
  mode = excluded.mode,
  status = excluded.status;

insert into public.card_pools (id, ip_id, name, active_from, active_to)
values
  (
    '20000000-0000-4000-8000-000000001001',
    'admin-game-ip-a', '준비된 카드풀 A', '2025-01-01 00:00:00+00', '2099-01-01 00:00:00+00'
  ),
  (
    '20000000-0000-4000-8000-000000001002',
    'admin-game-ip-b', '준비된 카드풀 B', '2025-01-01 00:00:00+00', '2099-01-01 00:00:00+00'
  ),
  (
    '20000000-0000-4000-8000-000000001003',
    'admin-game-ip-a', '종료된 카드풀', '2020-01-01 00:00:00+00', '2021-01-01 00:00:00+00'
  ),
  (
    '20000000-0000-4000-8000-000000001004',
    'admin-game-ip-a', '준비되지 않은 카드풀', '2025-01-01 00:00:00+00', '2099-01-01 00:00:00+00'
  ),
  (
    '20000000-0000-4000-8000-000000001005',
    'admin-game-ip-a', '유한 카드풀', '2025-01-01 00:00:00+00', '2030-01-01 00:00:00+00'
  )
on conflict (id) do update set
  ip_id = excluded.ip_id,
  name = excluded.name,
  active_from = excluded.active_from,
  active_to = excluded.active_to;

insert into public.cards (id, ip_id, name, rarity, pool_id)
select
  'admin-game-card-a-' || lower(rarity::text),
  'admin-game-ip-a',
  '게임 카드 A ' || rarity::text,
  rarity,
  '20000000-0000-4000-8000-000000001001'::uuid
from unnest(enum_range(null::public.rarity)) as rarity
union all
select
  'admin-game-card-b-n', 'admin-game-ip-b', '게임 카드 B N',
  'N'::public.rarity, '20000000-0000-4000-8000-000000001002'::uuid
union all
select
  'admin-game-card-ended-n', 'admin-game-ip-a', '종료 카드 N',
  'N'::public.rarity, '20000000-0000-4000-8000-000000001003'::uuid
union all
select
  'admin-game-card-bounded-n', 'admin-game-ip-a', '유한 카드 N',
  'N'::public.rarity, '20000000-0000-4000-8000-000000001005'::uuid
on conflict (id) do nothing;

insert into public.pool_odds (pool_id, rarity, probability)
values
  ('20000000-0000-4000-8000-000000001001', 'N', 0.26000),
  ('20000000-0000-4000-8000-000000001001', 'R', 0.24000),
  ('20000000-0000-4000-8000-000000001001', 'SR', 0.20000),
  ('20000000-0000-4000-8000-000000001001', 'SSR', 0.15000),
  ('20000000-0000-4000-8000-000000001001', 'HOLO', 0.15000),
  ('20000000-0000-4000-8000-000000001002', 'N', 1.00000),
  ('20000000-0000-4000-8000-000000001002', 'R', 0.00000),
  ('20000000-0000-4000-8000-000000001002', 'SR', 0.00000),
  ('20000000-0000-4000-8000-000000001002', 'SSR', 0.00000),
  ('20000000-0000-4000-8000-000000001002', 'HOLO', 0.00000),
  ('20000000-0000-4000-8000-000000001003', 'N', 1.00000),
  ('20000000-0000-4000-8000-000000001003', 'R', 0.00000),
  ('20000000-0000-4000-8000-000000001003', 'SR', 0.00000),
  ('20000000-0000-4000-8000-000000001003', 'SSR', 0.00000),
  ('20000000-0000-4000-8000-000000001003', 'HOLO', 0.00000),
  ('20000000-0000-4000-8000-000000001004', 'N', 0.00000),
  ('20000000-0000-4000-8000-000000001004', 'R', 1.00000),
  ('20000000-0000-4000-8000-000000001004', 'SR', 0.00000),
  ('20000000-0000-4000-8000-000000001004', 'SSR', 0.00000),
  ('20000000-0000-4000-8000-000000001004', 'HOLO', 0.00000),
  ('20000000-0000-4000-8000-000000001005', 'N', 1.00000),
  ('20000000-0000-4000-8000-000000001005', 'R', 0.00000),
  ('20000000-0000-4000-8000-000000001005', 'SR', 0.00000),
  ('20000000-0000-4000-8000-000000001005', 'SSR', 0.00000),
  ('20000000-0000-4000-8000-000000001005', 'HOLO', 0.00000)
on conflict (pool_id, rarity) do update set probability = excluded.probability;

set constraints pool_odds_total_chk immediate;
set constraints pool_odds_total_chk deferred;

-- Only authenticated staff RPC access is exposed; catalog reads remain public.
select 1 / case when not has_function_privilege(
  'anon',
  'public.admin_upsert_game(uuid,text,text,text,uuid,text,integer,timestamp with time zone,timestamp with time zone,boolean)',
  'execute'
) and has_function_privilege(
  'authenticated',
  'public.admin_upsert_game(uuid,text,text,text,uuid,text,integer,timestamp with time zone,timestamp with time zone,boolean)',
  'execute'
) and not has_function_privilege(
  'service_role',
  'public.admin_upsert_game(uuid,text,text,text,uuid,text,integer,timestamp with time zone,timestamp with time zone,boolean)',
  'execute'
) then 1 else 0 end as assert_game_upsert_rpc_acl;

select 1 / case when not has_function_privilege(
  'anon', 'public.admin_list_games()', 'execute'
) and has_function_privilege(
  'authenticated', 'public.admin_list_games()', 'execute'
) and not has_function_privilege(
  'service_role', 'public.admin_list_games()', 'execute'
) then 1 else 0 end as assert_game_list_rpc_acl;

select 1 / case when has_table_privilege('anon', 'public.games', 'select')
  and has_table_privilege('authenticated', 'public.games', 'select')
  and has_table_privilege('service_role', 'public.games', 'select')
  and not has_table_privilege('anon', 'public.games', 'insert')
  and not has_table_privilege('anon', 'public.games', 'update')
  and not has_table_privilege('anon', 'public.games', 'delete')
  and not has_table_privilege('authenticated', 'public.games', 'insert')
  and not has_table_privilege('authenticated', 'public.games', 'update')
  and not has_table_privilege('authenticated', 'public.games', 'delete')
  and not has_table_privilege('service_role', 'public.games', 'insert')
  and not has_table_privilege('service_role', 'public.games', 'update')
  and not has_table_privilege('service_role', 'public.games', 'delete')
  then 1 else 0 end as assert_games_direct_dml_is_closed;

select 1 / case when not exists (
  select 1
  from pg_policies
  where schemaname = 'public'
    and tablename = 'games'
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
) then 1 else 0 end as assert_game_write_policies_are_removed;

select 1 / case when exists (
  select 1 from pg_constraint
  where conrelid = 'public.games'::regclass
    and conname = 'games_id_slug_check'
    and convalidated
) and exists (
  select 1 from pg_constraint
  where conrelid = 'public.games'::regclass
    and conname = 'games_title_not_blank_check'
    and convalidated
) and exists (
  select 1 from pg_constraint
  where conrelid = 'public.games'::regclass
    and conname = 'games_active_window_check'
    and convalidated
) and to_regclass('public.games_reward_pool_idx') is not null
  and to_regclass('public.games_event_idx') is not null
then 1 else 0 end as assert_game_catalog_constraints_exist;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001002', true);

do $$
begin
  begin
    perform public.admin_upsert_game(
      '10000000-0000-4000-8000-000000001001', null, 'fan-game', '권한 없는 게임',
      '20000000-0000-4000-8000-000000001001', null, 1,
      '2026-01-01 00:00:00+00', '2027-01-01 00:00:00+00', false
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'forbidden' then return; end if;
      raise;
  end;
  raise exception 'non-staff game upsert should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.admin_list_games();
  exception
    when insufficient_privilege then
      if sqlerrm = 'forbidden' then return; end if;
      raise;
  end;
  raise exception 'non-staff game list should be rejected';
end;
$$;

select 1 / case when not exists (
  select 1 from public.games where id = 'fan-game'
) and not exists (
  select 1 from public.audit_log where id = '10000000-0000-4000-8000-000000001001'
) then 1 else 0 end as assert_non_staff_game_call_is_atomic;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001001', true);

-- Scalar validation is database-owned and leaves neither catalog nor audit rows.
do $$
declare
  invalid_call record;
begin
  for invalid_call in
    select *
    from (values
      (null::uuid, null::text, 'valid-game'::text, '게임'::text, '20000000-0000-4000-8000-000000001001'::uuid, 1::integer, '2026-01-01 00:00:00+00'::timestamptz, '2027-01-01 00:00:00+00'::timestamptz, 'invalid_operation_id'::text),
      ('10000000-0000-4000-8000-000000001011'::uuid, null, 'Invalid_Game', '게임', '20000000-0000-4000-8000-000000001001', 1, '2026-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'invalid_game_id'),
      ('10000000-0000-4000-8000-000000001012'::uuid, 'Invalid_Previous', 'valid-game', '게임', '20000000-0000-4000-8000-000000001001', 1, '2026-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'invalid_game_id'),
      ('10000000-0000-4000-8000-000000001013'::uuid, null, 'blank-title-game', '   ', '20000000-0000-4000-8000-000000001001', 1, '2026-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'invalid_game_title'),
      ('10000000-0000-4000-8000-000000001014'::uuid, null, 'zero-limit-game', '게임', '20000000-0000-4000-8000-000000001001', 0, '2026-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'invalid_game_daily_limit'),
      ('10000000-0000-4000-8000-000000001015'::uuid, null, 'large-limit-game', '게임', '20000000-0000-4000-8000-000000001001', 101, '2026-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'invalid_game_daily_limit'),
      ('10000000-0000-4000-8000-000000001016'::uuid, null, 'missing-start-game', '게임', '20000000-0000-4000-8000-000000001001', 1, null, null, 'invalid_game_active_from'),
      ('10000000-0000-4000-8000-000000001017'::uuid, null, 'invalid-window-game', '게임', '20000000-0000-4000-8000-000000001001', 1, '2027-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'invalid_game_active_window')
    ) as invalid_values(
      operation_id, previous_game_id, game_id, title, pool_id,
      daily_limit, active_from, active_to, expected_message
    )
  loop
    begin
      perform public.admin_upsert_game(
        invalid_call.operation_id,
        invalid_call.previous_game_id,
        invalid_call.game_id,
        invalid_call.title,
        invalid_call.pool_id,
        null,
        invalid_call.daily_limit,
        invalid_call.active_from,
        invalid_call.active_to,
        false
      );
    exception
      when others then
        if sqlerrm = invalid_call.expected_message then continue; end if;
        raise;
    end;
    raise exception 'invalid game call should fail with %', invalid_call.expected_message;
  end loop;
end;
$$;

-- Pool eligibility, complete interval coverage, and optional event contract.
do $$
declare
  invalid_call record;
begin
  for invalid_call in
    select *
    from (values
      ('10000000-0000-4000-8000-000000001021'::uuid, 'missing-pool-game'::text, null::uuid, null::text, '2026-01-01 00:00:00+00'::timestamptz, '2027-01-01 00:00:00+00'::timestamptz, 'pool_not_found'::text),
      ('10000000-0000-4000-8000-000000001022'::uuid, 'unknown-pool-game', '20000000-0000-4000-8000-000000001099', null, '2026-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'pool_not_found'),
      ('10000000-0000-4000-8000-000000001023'::uuid, 'ended-pool-game', '20000000-0000-4000-8000-000000001003', null, '2020-02-01 00:00:00+00', '2020-03-01 00:00:00+00', 'reward_pool_not_ready'),
      ('10000000-0000-4000-8000-000000001024'::uuid, 'unready-pool-game', '20000000-0000-4000-8000-000000001004', null, '2026-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'reward_pool_not_ready'),
      ('10000000-0000-4000-8000-000000001025'::uuid, 'early-window-game', '20000000-0000-4000-8000-000000001001', null, '2024-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'game_pool_window_not_covered'),
      ('10000000-0000-4000-8000-000000001026'::uuid, 'late-window-game', '20000000-0000-4000-8000-000000001005', null, '2026-01-01 00:00:00+00', '2031-01-01 00:00:00+00', 'game_pool_window_not_covered'),
      ('10000000-0000-4000-8000-000000001027'::uuid, 'indefinite-window-game', '20000000-0000-4000-8000-000000001005', null, '2026-01-01 00:00:00+00', null, 'game_pool_window_not_covered'),
      ('10000000-0000-4000-8000-000000001028'::uuid, 'missing-event-game', '20000000-0000-4000-8000-000000001001', 'missing-event', '2026-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'event_not_found'),
      ('10000000-0000-4000-8000-000000001029'::uuid, 'cross-ip-event-game', '20000000-0000-4000-8000-000000001001', 'admin-game-event-online-b', '2026-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'game_event_ip_mismatch'),
      ('10000000-0000-4000-8000-000000001030'::uuid, 'offline-event-game', '20000000-0000-4000-8000-000000001001', 'admin-game-event-offline-a', '2026-01-01 00:00:00+00', '2027-01-01 00:00:00+00', 'game_event_mode_invalid')
    ) as invalid_values(
      operation_id, game_id, pool_id, event_id, active_from, active_to, expected_message
    )
  loop
    begin
      perform public.admin_upsert_game(
        invalid_call.operation_id, null, invalid_call.game_id, '검증 게임',
        invalid_call.pool_id, invalid_call.event_id, 1,
        invalid_call.active_from, invalid_call.active_to, false
      );
    exception
      when others then
        if sqlerrm = invalid_call.expected_message then continue; end if;
        raise;
    end;
    raise exception 'invalid game relation should fail with %', invalid_call.expected_message;
  end loop;
end;
$$;

-- Creation derives a deterministic ten-slot cosmetic lineup. Runtime RNG remains pool_odds.
select 1 / case when public.admin_upsert_game(
  '10000000-0000-4000-8000-000000001101',
  null,
  '  admin-card-marble  ',
  '  카드 마블 룰렛  ',
  '20000000-0000-4000-8000-000000001001',
  '  admin-game-event-online-a  ',
  1,
  '2026-01-01 00:00:00+00',
  '2028-01-01 00:00:00+00',
  false
) = 'admin-card-marble' then 1 else 0 end as assert_staff_can_create_card_game;

select 1 / case when (
  select type = 'marble_roulette'
    and title = '카드 마블 룰렛'
    and event_id = 'admin-game-event-online-a'
    and reward_pool_id = '20000000-0000-4000-8000-000000001001'::uuid
    and per_user_daily_limit = 1
    and config = '{"marbleCount":10,"variant":{"kind":"card","rarityLineup":["N","N","N","R","R","SR","SR","SSR","SSR","HOLO"]}}'::jsonb
  from public.games
  where id = 'admin-card-marble'
) then 1 else 0 end as assert_game_config_uses_largest_remainder_with_enum_ties;

select 1 / case when public.admin_upsert_game(
  '10000000-0000-4000-8000-000000001101',
  null,
  'admin-card-marble',
  '카드 마블 룰렛',
  '20000000-0000-4000-8000-000000001001',
  'admin-game-event-online-a',
  1,
  '2026-01-01 00:00:00+00',
  '2028-01-01 00:00:00+00',
  false
) = 'admin-card-marble' then 1 else 0 end as assert_game_operation_replay_is_idempotent;

select 1 / case when exists (
  select 1
  from public.audit_log
  where id = '10000000-0000-4000-8000-000000001101'
    and actor_id = '00000000-0000-4000-8000-000000001001'
    and action = 'admin.game.upserted'
    and target = 'games:admin-card-marble'
    and diff -> 'request' = jsonb_build_object(
      'previous_game_id', null,
      'game_id', 'admin-card-marble',
      'title', '카드 마블 룰렛',
      'reward_pool_id', '20000000-0000-4000-8000-000000001001'::uuid,
      'event_id', 'admin-game-event-online-a',
      'per_user_daily_limit', 1,
      'active_from', '2026-01-01 00:00:00+00'::timestamptz,
      'active_to', '2028-01-01 00:00:00+00'::timestamptz,
      'end_now', false
    )
    and diff -> 'before' = 'null'::jsonb
    and diff #>> '{after,id}' = 'admin-card-marble'
    and diff #>> '{after,config,variant,kind}' = 'card'
) and (
  select count(*) = 1
  from public.audit_log
  where id = '10000000-0000-4000-8000-000000001101'
) then 1 else 0 end as assert_game_create_audit_is_exactly_once;

do $$
begin
  begin
    perform public.admin_upsert_game(
      '10000000-0000-4000-8000-000000001101', null, 'admin-card-marble', '다른 요청',
      '20000000-0000-4000-8000-000000001001', 'admin-game-event-online-a', 2,
      '2026-01-01 00:00:00+00', '2028-01-01 00:00:00+00', false
    );
  exception
    when unique_violation then
      if sqlerrm = 'operation_conflict' then return; end if;
      raise;
  end;
  raise exception 'changed game operation replay should conflict';
end;
$$;

do $$
begin
  begin
    perform public.admin_upsert_game(
      '10000000-0000-4000-8000-000000001102', null, 'admin-card-marble', '중복 게임',
      '20000000-0000-4000-8000-000000001001', null, 1,
      '2026-01-01 00:00:00+00', '2028-01-01 00:00:00+00', false
    );
  exception
    when unique_violation then
      if sqlerrm = 'game_id_conflict' then return; end if;
      raise;
  end;
  raise exception 'create with an existing game id should conflict';
end;
$$;

-- Before the first play, rename and catalog rebinding are atomic.
select public.admin_upsert_game(
  '10000000-0000-4000-8000-000000001111', null, 'rename-source', '이름 변경 전',
  '20000000-0000-4000-8000-000000001001', 'admin-game-event-online-a', 1,
  '2026-01-01 00:00:00+00', '2028-01-01 00:00:00+00', false
);

select 1 / case when public.admin_upsert_game(
  '10000000-0000-4000-8000-000000001112', 'rename-source', 'rename-target', '이름 변경 후',
  '20000000-0000-4000-8000-000000001002', 'admin-game-event-online-b', 3,
  '2026-02-01 00:00:00+00', '2028-02-01 00:00:00+00', false
) = 'rename-target' then 1 else 0 end as assert_unplayed_game_can_be_renamed;

select 1 / case when not exists (
  select 1 from public.games where id = 'rename-source'
) and exists (
  select 1
  from public.games
  where id = 'rename-target'
    and title = '이름 변경 후'
    and reward_pool_id = '20000000-0000-4000-8000-000000001002'
    and event_id = 'admin-game-event-online-b'
    and config = '{"marbleCount":10,"variant":{"kind":"card","rarityLineup":["N","N","N","N","N","N","N","N","N","N"]}}'::jsonb
) then 1 else 0 end as assert_rename_updates_card_contract_atomically;

do $$
begin
  begin
    perform public.admin_upsert_game(
      '10000000-0000-4000-8000-000000001113', 'missing-game', 'missing-game', '없음',
      '20000000-0000-4000-8000-000000001001', null, 1,
      '2026-01-01 00:00:00+00', '2028-01-01 00:00:00+00', false
    );
  exception
    when no_data_found then
      if sqlerrm = 'game_not_found' then return; end if;
      raise;
  end;
  raise exception 'updating a missing game should fail';
end;
$$;

-- Existing goods/unknown variants stay visible but cannot cross this card-only boundary.
do $$
begin
  begin
    perform public.admin_upsert_game(
      '10000000-0000-4000-8000-000000001114', 'goods-marble', 'goods-marble', '굿즈 수정',
      '20000000-0000-4000-8000-000000001001', null, 1,
      '2026-01-01 00:00:00+00', '2028-01-01 00:00:00+00', false
    );
  exception
    when check_violation then
      if sqlerrm = 'game_variant_read_only' then return; end if;
      raise;
  end;
  raise exception 'goods game should be read-only';
end;
$$;

-- Runtime play stays server-owned and makes catalog identity/config immutable.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001002', true);

select public.play_game('admin-card-marble') as first_game_result \gset

select 1 / case when jsonb_array_length(:'first_game_result'::jsonb -> 'rewards') = 1
  and public.play_game('admin-card-marble') = :'first_game_result'::jsonb
  then 1 else 0 end as assert_play_game_replay_stays_idempotent;

select 1 / case when (
  select count(*) = 1
  from public.game_plays
  where game_id = 'admin-card-marble'
    and user_id = '00000000-0000-4000-8000-000000001002'
) and (
  select count(*) = 1
  from public.card_grants
  where user_id = '00000000-0000-4000-8000-000000001002'
    and pool_id = '20000000-0000-4000-8000-000000001001'
    and source = 'game_play'
) then 1 else 0 end as assert_play_game_writes_one_server_ledger;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001001', true);

do $$
declare
  locked_call record;
begin
  for locked_call in
    select *
    from (values
      ('10000000-0000-4000-8000-000000001121'::uuid, 'renamed-after-play'::text, '20000000-0000-4000-8000-000000001001'::uuid, 'admin-game-event-online-a'::text),
      ('10000000-0000-4000-8000-000000001122'::uuid, 'admin-card-marble', '20000000-0000-4000-8000-000000001002', 'admin-game-event-online-a'),
      ('10000000-0000-4000-8000-000000001123'::uuid, 'admin-card-marble', '20000000-0000-4000-8000-000000001001', null)
    ) as locked_values(operation_id, game_id, pool_id, event_id)
  loop
    begin
      perform public.admin_upsert_game(
        locked_call.operation_id, 'admin-card-marble', locked_call.game_id, '플레이 후 게임',
        locked_call.pool_id, locked_call.event_id, 2,
        '2026-01-01 00:00:00+00', '2028-01-01 00:00:00+00', false
      );
    exception
      when check_violation then
        if sqlerrm = 'game_catalog_locked' then continue; end if;
        raise;
    end;
    raise exception 'played catalog change should be locked';
  end loop;
end;
$$;

select 1 / case when public.admin_upsert_game(
  '10000000-0000-4000-8000-000000001124',
  'admin-card-marble', 'admin-card-marble', '플레이 후 제목 수정',
  '20000000-0000-4000-8000-000000001001', 'admin-game-event-online-a', 4,
  '2025-01-02 00:00:00+00', '2098-01-01 00:00:00+00', false
) = 'admin-card-marble' then 1 else 0 end as assert_played_game_operating_fields_remain_mutable;

select 1 / case when (
  select title = '플레이 후 제목 수정'
    and per_user_daily_limit = 4
    and active_from = '2025-01-02 00:00:00+00'::timestamptz
    and active_to = '2098-01-01 00:00:00+00'::timestamptz
    and config = '{"marbleCount":10,"variant":{"kind":"card","rarityLineup":["N","N","N","R","R","SR","SR","SSR","SSR","HOLO"]}}'::jsonb
  from public.games
  where id = 'admin-card-marble'
) then 1 else 0 end as assert_played_game_preserves_server_config;

reset role;

do $$
begin
  begin
    update public.games
    set config = '{"marbleCount":10,"variant":{"kind":"card","rarityLineup":["N"]}}'
    where id = 'admin-card-marble';
  exception
    when check_violation then
      if sqlerrm = 'game_catalog_locked' then return; end if;
      raise;
  end;
  raise exception 'privileged direct config mutation should still respect play history';
end;
$$;

do $$
begin
  begin
    update public.games
    set type = 'future_game_type'
    where id = 'admin-card-marble';
  exception
    when check_violation then
      if sqlerrm = 'game_catalog_locked' then return; end if;
      raise;
  end;
  raise exception 'privileged direct type mutation should still respect play history';
end;
$$;

do $$
begin
  begin
    update public.games
    set type = 'marble_roulette', event_id = null
    where id = 'admin-card-marble';
  exception
    when check_violation then
      if sqlerrm = 'game_catalog_locked' then return; end if;
      raise;
  end;
  raise exception 'privileged direct event mutation should still respect play history';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001001', true);

-- End-now trusts database execution time only and ignores all other form fields.
select active_to as active_to_before_end
from public.games where id = 'admin-card-marble' \gset

select statement_timestamp() as end_call_started_at \gset

select 1 / case when public.admin_upsert_game(
  '10000000-0000-4000-8000-000000001131',
  'admin-card-marble', null, null, null, 'ignored-event', null, null, null, true
) = 'admin-card-marble' then 1 else 0 end as assert_end_now_uses_existing_game_only;

select active_to as active_to_after_end
from public.games where id = 'admin-card-marble' \gset

select 1 / case when :'active_to_after_end'::timestamptz >= :'end_call_started_at'::timestamptz
  and :'active_to_after_end'::timestamptz <= statement_timestamp()
  and :'active_to_after_end'::timestamptz is distinct from :'active_to_before_end'::timestamptz
  then 1 else 0 end as assert_end_now_uses_statement_time;

select 1 / case when public.admin_upsert_game(
  '10000000-0000-4000-8000-000000001131',
  'admin-card-marble', 'totally-different', 'ignored', null, null, 99, null, null, true
) = 'admin-card-marble' then 1 else 0 end as assert_end_now_replay_ignores_non_identity_fields;

select 1 / case when (
  select active_to = :'active_to_after_end'::timestamptz
  from public.games where id = 'admin-card-marble'
) and exists (
  select 1
  from public.audit_log
  where id = '10000000-0000-4000-8000-000000001131'
    and action = 'admin.game.ended'
    and target = 'games:admin-card-marble'
    and diff -> 'request' = '{"game_id":"admin-card-marble","end_now":true}'::jsonb
    and diff #>> '{before,id}' = 'admin-card-marble'
    and diff #>> '{after,id}' = 'admin-card-marble'
) and (
  select count(*) = 1
  from public.audit_log where id = '10000000-0000-4000-8000-000000001131'
) then 1 else 0 end as assert_end_now_is_replayed_and_audited_once;

do $$
begin
  begin
    perform public.admin_upsert_game(
      '10000000-0000-4000-8000-000000001132',
      'admin-card-marble', 'admin-card-marble', null, null, null, null, null, null, true
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'game_not_active' then return; end if;
      raise;
  end;
  raise exception 'already-ended game should not end twice under a new operation';
end;
$$;

do $$
begin
  begin
    perform public.admin_upsert_game(
      '10000000-0000-4000-8000-000000001133',
      'goods-marble', 'goods-marble', null, null, null, null, null, null, true
    );
  exception
    when check_violation then
      if sqlerrm = 'game_variant_read_only' then return; end if;
      raise;
  end;
  raise exception 'goods game cannot use card-game end operation';
end;
$$;

-- Staff list is PII-free and includes derived catalog plus aggregate play truth.
select 1 / case when exists (
  select 1
  from public.admin_list_games()
  where id = 'admin-card-marble'
    and type = 'marble_roulette'
    and title = '플레이 후 제목 수정'
    and event_id = 'admin-game-event-online-a'
    and event_title = '온라인 이벤트 A'
    and variant_kind = 'card'
    and marble_count = 10
    and reward_pool_id = '20000000-0000-4000-8000-000000001001'
    and reward_pool_name = '준비된 카드풀 A'
    and reward_pool_ready
    and ip_id = 'admin-game-ip-a'
    and ip_title = '게임 테스트 IP A'
    and per_user_daily_limit = 4
    and play_count = 1
    and last_played_at is not null
) and exists (
  select 1
  from public.admin_list_games()
  where id = 'goods-marble'
    and variant_kind = 'goods'
    and reward_pool_id is null
    and play_count = 0
) then 1 else 0 end as assert_admin_game_list_has_catalog_and_aggregate_truth;

select 1 / case when pg_get_function_result('public.admin_list_games()'::regprocedure)
  not ilike '%user_id%'
  and pg_get_function_result('public.admin_list_games()'::regprocedure) not ilike '%result%'
  then 1 else 0 end as assert_admin_game_list_contract_is_pii_free;

-- A pool may not stop covering any connected game, even through the older pool RPC.
select public.admin_upsert_game(
  '10000000-0000-4000-8000-000000001141', null, 'pool-guard-game', '풀 가드 게임',
  '20000000-0000-4000-8000-000000001002', 'admin-game-event-online-b', 1,
  '2026-01-01 00:00:00+00', '2028-01-01 00:00:00+00', false
);

do $$
begin
  begin
    perform public.admin_upsert_card_pool(
      '10000000-0000-4000-8000-000000001142',
      '20000000-0000-4000-8000-000000001002',
      'admin-game-ip-b', '준비된 카드풀 B',
      '2027-01-01 00:00:00+00', '2099-01-01 00:00:00+00'
    );
  exception
    when check_violation then
      if sqlerrm = 'game_pool_window_conflict' then return; end if;
      raise;
  end;
  raise exception 'pool window must continue to cover linked game';
end;
$$;

select 1 / case when (
  select active_from = '2025-01-01 00:00:00+00'::timestamptz
  from public.card_pools where id = '20000000-0000-4000-8000-000000001002'
) and not exists (
  select 1 from public.audit_log where id = '10000000-0000-4000-8000-000000001142'
) then 1 else 0 end as assert_rejected_pool_window_change_is_atomic;

-- A linked event's IP/mode are contractual; display-only fields remain editable.
do $$
begin
  begin
    perform public.admin_upsert_event(
      'admin-game-event-online-b', 'admin-game-ip-a', '온라인 이벤트 B', '온라인', '진행중',
      null, null, null, null, null, null
    );
  exception
    when check_violation then
      if sqlerrm = 'game_event_contract_locked' then return; end if;
      raise;
  end;
  raise exception 'linked event IP should remain locked';
end;
$$;

do $$
begin
  begin
    perform public.admin_upsert_event(
      'admin-game-event-online-b', 'admin-game-ip-b', '온라인 이벤트 B', '오프라인', '진행중',
      null, null, null, null, null, null
    );
  exception
    when check_violation then
      if sqlerrm = 'game_event_contract_locked' then return; end if;
      raise;
  end;
  raise exception 'linked event mode should remain locked';
end;
$$;

select public.admin_upsert_event(
  'admin-game-event-online-b', 'admin-game-ip-b', '온라인 이벤트 B 수정', '온라인', '진행중',
  null, null, null, null, null, null
);

select 1 / case when (
  select title = '온라인 이벤트 B 수정'
    and ip_id = 'admin-game-ip-b'
    and mode = '온라인'
  from public.events where id = 'admin-game-event-online-b'
) then 1 else 0 end as assert_linked_event_display_fields_remain_mutable;

select lower(pg_get_functiondef(
  'public.admin_upsert_game(uuid,text,text,text,uuid,text,integer,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure
)) as admin_game_function_body \gset

select 1 / case when strpos(:'admin_game_function_body', 'pg_advisory_xact_lock') > 0
  and strpos(:'admin_game_function_body', 'for update') > 0
  and strpos(:'admin_game_function_body', 'for share') > 0
  then 1 else 0 end as assert_game_upsert_serializes_catalog_dependencies;

select lower(pg_get_functiondef('public.play_game(text)'::regprocedure))
  as play_game_function_body \gset

select 1 / case when strpos(:'play_game_function_body', 'for share') > 0
  then 1 else 0 end as assert_play_game_shares_the_same_game_lock_boundary;

reset role;
set constraints pool_odds_total_chk immediate;

rollback;
