\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000981',
    'authenticated', 'authenticated', 'card-pool-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000982',
    'authenticated', 'authenticated', 'card-pool-fan@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000981',
    'card-pool-staff@example.test', 'card_pool_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000982',
    'card-pool-fan@example.test', 'card_pool_fan', '2000-01-01',
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
values ('admin-card-pool-test', '카드풀 테스트', '#000000')
on conflict (key) do nothing;

insert into public.ips (id, title, vertical_key)
values
  ('admin-card-pool-ip-a', '카드풀 테스트 IP A', 'admin-card-pool-test'),
  ('admin-card-pool-ip-b', '카드풀 테스트 IP B', 'admin-card-pool-test')
on conflict (id) do update set title = excluded.title;

-- Public catalog reads remain available, while all catalog mutations go through
-- authenticated, staff-guarded RPCs. Internal RNG/grant functions stay private.
select 1 / case when not has_function_privilege(
  'anon',
  'public.admin_upsert_card_pool(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone)',
  'execute'
) then 1 else 0 end as assert_anon_cannot_upsert_card_pool;

select 1 / case when has_function_privilege(
  'authenticated',
  'public.admin_upsert_card_pool(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone)',
  'execute'
) then 1 else 0 end as assert_authenticated_can_call_card_pool_rpc;

select 1 / case when not has_function_privilege(
  'service_role',
  'public.admin_upsert_card_pool(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone)',
  'execute'
) then 1 else 0 end as assert_service_role_cannot_upsert_card_pool;

select 1 / case when not has_function_privilege(
  'anon',
  'public.admin_set_pool_odds(uuid,uuid,numeric,numeric,numeric,numeric,numeric)',
  'execute'
) and has_function_privilege(
  'authenticated',
  'public.admin_set_pool_odds(uuid,uuid,numeric,numeric,numeric,numeric,numeric)',
  'execute'
) and not has_function_privilege(
  'service_role',
  'public.admin_set_pool_odds(uuid,uuid,numeric,numeric,numeric,numeric,numeric)',
  'execute'
) then 1 else 0 end as assert_pool_odds_rpc_acl;

select 1 / case when not has_function_privilege(
  'anon',
  'public.admin_upsert_card(text,text,text,text,rarity,text,text,uuid,boolean)',
  'execute'
) and has_function_privilege(
  'authenticated',
  'public.admin_upsert_card(text,text,text,text,rarity,text,text,uuid,boolean)',
  'execute'
) and not has_function_privilege(
  'service_role',
  'public.admin_upsert_card(text,text,text,text,rarity,text,text,uuid,boolean)',
  'execute'
) then 1 else 0 end as assert_card_rpc_acl;

select 1 / case when to_regprocedure(
  'public.admin_upsert_card(text,text,text,text,rarity,text,text)'
) is null then 1 else 0 end as assert_card_rpc_has_no_ambiguous_overload;

select 1 / case when not has_function_privilege(
  'anon',
  'public.grant_cards(uuid,uuid,text,uuid,text,integer)',
  'execute'
) and not has_function_privilege(
  'authenticated',
  'public.grant_cards(uuid,uuid,text,uuid,text,integer)',
  'execute'
) and not has_function_privilege(
  'service_role',
  'public.grant_cards(uuid,uuid,text,uuid,text,integer)',
  'execute'
) and not has_function_privilege('anon', 'public.roll_rarity(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.roll_rarity(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.roll_rarity(uuid)', 'execute')
  then 1 else 0 end as assert_internal_card_grant_functions_are_private;

select 1 / case when has_table_privilege('anon', 'public.card_pools', 'select')
  and has_table_privilege('anon', 'public.pool_odds', 'select')
  and has_table_privilege('anon', 'public.cards', 'select')
  and has_table_privilege('authenticated', 'public.card_pools', 'select')
  and has_table_privilege('authenticated', 'public.pool_odds', 'select')
  and has_table_privilege('authenticated', 'public.cards', 'select')
  then 1 else 0 end as assert_public_catalog_reads_remain_available;

select 1 / case when not has_table_privilege('authenticated', 'public.card_pools', 'insert')
  and not has_table_privilege('authenticated', 'public.card_pools', 'update')
  and not has_table_privilege('authenticated', 'public.card_pools', 'delete')
  and not has_table_privilege('authenticated', 'public.pool_odds', 'insert')
  and not has_table_privilege('authenticated', 'public.pool_odds', 'update')
  and not has_table_privilege('authenticated', 'public.pool_odds', 'delete')
  and not has_table_privilege('authenticated', 'public.cards', 'insert')
  and not has_table_privilege('authenticated', 'public.cards', 'update')
  and not has_table_privilege('authenticated', 'public.cards', 'delete')
  then 1 else 0 end as assert_authenticated_cannot_write_card_catalog_directly;

select 1 / case when not exists (
  select 1
  from pg_policies
  where schemaname = 'public'
    and tablename in ('card_pools', 'pool_odds', 'cards')
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
) then 1 else 0 end as assert_card_catalog_write_policies_are_removed;

select 1 / case when exists (
  select 1
  from pg_constraint
  where conrelid = 'public.card_pools'::regclass
    and conname = 'card_pools_active_window_check'
    and convalidated
) and exists (
  select 1
  from pg_constraint
  where conrelid = 'public.cards'::regclass
    and conname = 'cards_pool_ip_id_fkey'
    and convalidated
) then 1 else 0 end as assert_card_pool_integrity_constraints_exist;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000982', true);

do $$
begin
  begin
    perform public.admin_upsert_card_pool(
      '10000000-0000-4000-8000-000000000981',
      '20000000-0000-4000-8000-000000000981',
      'admin-card-pool-ip-a',
      '권한 없는 카드풀',
      '2026-01-01 00:00:00+00',
      '2099-01-01 00:00:00+00'
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'forbidden' then return; end if;
      raise;
  end;
  raise exception 'non-staff card pool upsert should be rejected';
end;
$$;

select 1 / case when not exists (
  select 1 from public.card_pools where id = '20000000-0000-4000-8000-000000000981'
) and not exists (
  select 1 from public.audit_log where id = '10000000-0000-4000-8000-000000000981'
) then 1 else 0 end as assert_non_staff_call_has_no_side_effects;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000981', true);

-- Input validation must not leave catalog or audit rows behind.
do $$
declare
  invalid_call record;
begin
  for invalid_call in
    select *
    from (values
      (null::uuid, '20000000-0000-4000-8000-000000000911'::uuid, 'admin-card-pool-ip-a'::text, '풀'::text, '2026-01-01 00:00:00+00'::timestamptz, null::timestamptz, 'invalid_operation_id'::text),
      ('10000000-0000-4000-8000-000000000912'::uuid, null::uuid, 'admin-card-pool-ip-a', '풀', '2026-01-01 00:00:00+00', null, 'invalid_pool_id'),
      ('10000000-0000-4000-8000-000000000913'::uuid, '20000000-0000-4000-8000-000000000913'::uuid, 'missing-ip', '풀', '2026-01-01 00:00:00+00', null, 'ip_not_found'),
      ('10000000-0000-4000-8000-000000000914'::uuid, '20000000-0000-4000-8000-000000000914'::uuid, 'admin-card-pool-ip-a', '   ', '2026-01-01 00:00:00+00', null, 'invalid_pool_name'),
      ('10000000-0000-4000-8000-000000000915'::uuid, '20000000-0000-4000-8000-000000000915'::uuid, 'admin-card-pool-ip-a', '풀', null, null, 'invalid_active_from'),
      ('10000000-0000-4000-8000-000000000916'::uuid, '20000000-0000-4000-8000-000000000916'::uuid, 'admin-card-pool-ip-a', '풀', '2026-01-02 00:00:00+00', '2026-01-01 00:00:00+00', 'invalid_pool_active_window')
    ) as invalid_values(operation_id, pool_id, ip_id, name, active_from, active_to, expected_message)
  loop
    begin
      perform public.admin_upsert_card_pool(
        invalid_call.operation_id,
        invalid_call.pool_id,
        invalid_call.ip_id,
        invalid_call.name,
        invalid_call.active_from,
        invalid_call.active_to
      );
    exception
      when others then
        if sqlerrm = invalid_call.expected_message then continue; end if;
        raise;
    end;
    raise exception 'invalid pool call should fail with %', invalid_call.expected_message;
  end loop;
end;
$$;

-- Pool creation, normalization, audit payload, replay, conflict, and update.
select 1 / case when public.admin_upsert_card_pool(
  '10000000-0000-4000-8000-000000000901',
  '20000000-0000-4000-8000-000000000901',
  '  admin-card-pool-ip-a  ',
  '  운영 카드풀 A  ',
  '2026-01-01 00:00:00+00',
  '2099-01-01 00:00:00+00'
) = '20000000-0000-4000-8000-000000000901'::uuid then 1 else 0 end
  as assert_staff_can_create_card_pool;

select 1 / case when public.admin_upsert_card_pool(
  '10000000-0000-4000-8000-000000000901',
  '20000000-0000-4000-8000-000000000901',
  'admin-card-pool-ip-a',
  '운영 카드풀 A',
  '2026-01-01 00:00:00+00',
  '2099-01-01 00:00:00+00'
) = '20000000-0000-4000-8000-000000000901'::uuid then 1 else 0 end
  as assert_card_pool_operation_replay_is_idempotent;

select 1 / case when exists (
  select 1
  from public.audit_log
  where id = '10000000-0000-4000-8000-000000000901'
    and actor_id = '00000000-0000-4000-8000-000000000981'
    and action = 'admin.card_pool.upserted'
    and target = 'card_pools:20000000-0000-4000-8000-000000000901'
    and diff -> 'request' = '{"ip_id":"admin-card-pool-ip-a","name":"운영 카드풀 A","active_from":"2026-01-01T00:00:00+00:00","active_to":"2099-01-01T00:00:00+00:00"}'::jsonb
    and diff -> 'before' = 'null'::jsonb
    and diff -> 'after' = '{"id":"20000000-0000-4000-8000-000000000901","ip_id":"admin-card-pool-ip-a","name":"운영 카드풀 A","active_from":"2026-01-01T00:00:00+00:00","active_to":"2099-01-01T00:00:00+00:00"}'::jsonb
) and (
  select count(*) from public.audit_log where id = '10000000-0000-4000-8000-000000000901'
) = 1 then 1 else 0 end as assert_card_pool_create_audit_is_exact_and_once;

do $$
begin
  begin
    perform public.admin_upsert_card_pool(
      '10000000-0000-4000-8000-000000000901',
      '20000000-0000-4000-8000-000000000901',
      'admin-card-pool-ip-a',
      '다른 요청',
      '2026-01-01 00:00:00+00',
      '2099-01-01 00:00:00+00'
    );
  exception
    when unique_violation then
      if sqlerrm = 'operation_conflict' then return; end if;
      raise;
  end;
  raise exception 'pool operation id reuse should conflict';
end;
$$;

select public.admin_upsert_card_pool(
  '10000000-0000-4000-8000-000000000902',
  '20000000-0000-4000-8000-000000000902',
  'admin-card-pool-ip-a',
  '운영 카드풀 B',
  '2026-01-01 00:00:00+00',
  '2099-01-01 00:00:00+00'
);

select public.admin_upsert_card_pool(
  '10000000-0000-4000-8000-000000000903',
  '20000000-0000-4000-8000-000000000903',
  'admin-card-pool-ip-b',
  '운영 카드풀 C',
  '2026-01-01 00:00:00+00',
  '2099-01-01 00:00:00+00'
);

-- New card callers can bind/unbind explicitly. Existing seven-argument callers
-- retain the current binding through trailing defaults on the single RPC.
select public.admin_upsert_card(
  'admin-card-pool-card-r1',
  'admin-card-pool-ip-a',
  '테스트 카드 R1',
  '001/999',
  'R',
  null,
  null,
  '20000000-0000-4000-8000-000000000901',
  true
);

select public.admin_upsert_card(
  'admin-card-pool-card-r1',
  'admin-card-pool-ip-a',
  '테스트 카드 R1 수정',
  '001/999',
  'R',
  null,
  null
);

select 1 / case when (
  select pool_id = '20000000-0000-4000-8000-000000000901'::uuid
    and name = '테스트 카드 R1 수정'
  from public.cards
  where id = 'admin-card-pool-card-r1'
) then 1 else 0 end as assert_legacy_card_call_preserves_pool_binding;

do $$
begin
  begin
    perform public.admin_upsert_card(
      'admin-card-pool-cross-ip',
      'admin-card-pool-ip-b',
      '잘못된 IP 카드',
      null,
      'R',
      null,
      null,
      '20000000-0000-4000-8000-000000000901',
      true
    );
  exception
    when check_violation then
      if sqlerrm = 'card_pool_ip_mismatch' then return; end if;
      raise;
  end;
  raise exception 'cross-IP card binding should be rejected';
end;
$$;

select 1 / case when not exists (
  select 1 from public.cards where id = 'admin-card-pool-cross-ip'
) then 1 else 0 end as assert_cross_ip_card_call_has_no_side_effects;

-- Invalid odds never replace the prior set or create an audit entry.
do $$
declare
  invalid_call record;
begin
  for invalid_call in
    select *
    from (values
      ('30000000-0000-4000-8000-000000000911'::uuid, null::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 'invalid_pool_probability'::text),
      ('30000000-0000-4000-8000-000000000912'::uuid, 1.1, 0, 0, 0, 0, 'invalid_pool_probability'),
      ('30000000-0000-4000-8000-000000000913'::uuid, 0.500001, 0.499999, 0, 0, 0, 'invalid_probability_precision'),
      ('30000000-0000-4000-8000-000000000914'::uuid, 0.5, 0.4, 0, 0, 0, 'pool_odds_must_sum_to_one'),
      ('30000000-0000-4000-8000-000000000915'::uuid, 0, 0.5, 0, 0.5, 0, 'pool_rarity_uncovered')
    ) as invalid_values(operation_id, n, r, sr, ssr, holo, expected_message)
  loop
    begin
      perform public.admin_set_pool_odds(
        invalid_call.operation_id,
        '20000000-0000-4000-8000-000000000901',
        invalid_call.n,
        invalid_call.r,
        invalid_call.sr,
        invalid_call.ssr,
        invalid_call.holo
      );
    exception
      when others then
        if sqlerrm = invalid_call.expected_message then continue; end if;
        raise;
    end;
    raise exception 'invalid odds call should fail with %', invalid_call.expected_message;
  end loop;
end;
$$;

select 1 / case when not exists (
  select 1 from public.pool_odds where pool_id = '20000000-0000-4000-8000-000000000901'
) and not exists (
  select 1
  from public.audit_log
  where id between '30000000-0000-4000-8000-000000000911'::uuid
    and '30000000-0000-4000-8000-000000000915'::uuid
) then 1 else 0 end as assert_invalid_odds_calls_have_no_side_effects;

select public.admin_set_pool_odds(
  '30000000-0000-4000-8000-000000000901',
  '20000000-0000-4000-8000-000000000901',
  0, 1, 0, 0, 0
);

select public.admin_set_pool_odds(
  '30000000-0000-4000-8000-000000000901',
  '20000000-0000-4000-8000-000000000901',
  0, 1, 0, 0, 0
);

select 1 / case when (
  select count(*) = 5 and sum(probability) = 1
  from public.pool_odds
  where pool_id = '20000000-0000-4000-8000-000000000901'
) and exists (
  select 1
  from public.audit_log
  where id = '30000000-0000-4000-8000-000000000901'
    and actor_id = '00000000-0000-4000-8000-000000000981'
    and action = 'admin.card_pool.odds_set'
    and target = 'card_pools:20000000-0000-4000-8000-000000000901'
    and diff -> 'request' = '{"N":0,"R":1,"SR":0,"SSR":0,"HOLO":0}'::jsonb
    and diff -> 'before' = '{"N":0,"R":0,"SR":0,"SSR":0,"HOLO":0}'::jsonb
    and diff -> 'after' = '{"N":0,"R":1,"SR":0,"SSR":0,"HOLO":0}'::jsonb
) and (
  select count(*) from public.audit_log where id = '30000000-0000-4000-8000-000000000901'
) = 1 then 1 else 0 end as assert_odds_replace_and_audit_are_atomic_and_exact;

do $$
begin
  begin
    perform public.admin_set_pool_odds(
      '30000000-0000-4000-8000-000000000901',
      '20000000-0000-4000-8000-000000000901',
      0, 0.5, 0, 0, 0.5
    );
  exception
    when unique_violation then
      if sqlerrm = 'operation_conflict' then return; end if;
      raise;
  end;
  raise exception 'odds operation id reuse should conflict';
end;
$$;

-- A positive source rarity cannot lose its last card. A second card makes an
-- explicit unbind safe, and pooled IP/rarity fields stay immutable.
do $$
begin
  begin
    perform public.admin_upsert_card(
      'admin-card-pool-card-r1',
      'admin-card-pool-ip-a',
      '테스트 카드 R1 수정',
      '001/999',
      'R',
      null,
      null,
      null,
      true
    );
  exception
    when check_violation then
      if sqlerrm = 'pool_rarity_uncovered' then return; end if;
      raise;
  end;
  raise exception 'last positive-rarity card should not be unbound';
end;
$$;

select public.admin_upsert_card(
  'admin-card-pool-card-r2',
  'admin-card-pool-ip-a',
  '테스트 카드 R2',
  '002/999',
  'R',
  null,
  null,
  '20000000-0000-4000-8000-000000000901',
  true
);

select public.admin_upsert_card(
  'admin-card-pool-card-r1',
  'admin-card-pool-ip-a',
  '테스트 카드 R1 수정',
  '001/999',
  'R',
  null,
  null,
  null,
  true
);

select 1 / case when (
  select pool_id is null
  from public.cards
  where id = 'admin-card-pool-card-r1'
) and exists (
  select 1
  from public.audit_log
  where action = 'catalog.card.upsert'
    and target = 'cards:admin-card-pool-card-r1'
    and diff -> 'after' ->> 'pool_id' is null
) then 1 else 0 end as assert_safe_card_unbind_is_audited;

do $$
begin
  begin
    perform public.admin_upsert_card(
      'admin-card-pool-card-r2',
      'admin-card-pool-ip-a',
      '테스트 카드 R2',
      '002/999',
      'SSR',
      null,
      null,
      '20000000-0000-4000-8000-000000000901',
      true
    );
  exception
    when check_violation then
      if sqlerrm = 'pooled_card_catalog_contract_locked' then return; end if;
      raise;
  end;
  raise exception 'pooled card rarity should remain locked';
end;
$$;

-- Once any catalog/history dependency exists, a pool cannot move to another IP.
do $$
begin
  begin
    perform public.admin_upsert_card_pool(
      '10000000-0000-4000-8000-000000000904',
      '20000000-0000-4000-8000-000000000901',
      'admin-card-pool-ip-b',
      '운영 카드풀 A',
      '2026-01-01 00:00:00+00',
      '2099-01-01 00:00:00+00'
    );
  exception
    when check_violation then
      if sqlerrm = 'pool_ip_locked' then return; end if;
      raise;
  end;
  raise exception 'pool with bound cards should not move IP';
end;
$$;

select public.admin_upsert_card_pool(
  '10000000-0000-4000-8000-000000000905',
  '20000000-0000-4000-8000-000000000901',
  'admin-card-pool-ip-a',
  '운영 카드풀 A 수정',
  '2026-01-01 00:00:00+00',
  '2099-01-01 00:00:00+00'
);

-- Build future and expired reward pools for runtime contract checks.
select public.admin_upsert_card_pool(
  '10000000-0000-4000-8000-000000000906',
  '20000000-0000-4000-8000-000000000906',
  'admin-card-pool-ip-a',
  '미래 카드풀',
  '2099-01-01 00:00:00+00',
  null
);
select public.admin_upsert_card(
  'admin-card-pool-future-r', 'admin-card-pool-ip-a', '미래 R 카드', null,
  'R', null, null, '20000000-0000-4000-8000-000000000906', true
);
select public.admin_set_pool_odds(
  '30000000-0000-4000-8000-000000000906',
  '20000000-0000-4000-8000-000000000906',
  0, 1, 0, 0, 0
);

select public.admin_upsert_card_pool(
  '10000000-0000-4000-8000-000000000907',
  '20000000-0000-4000-8000-000000000907',
  'admin-card-pool-ip-a',
  '종료 카드풀',
  '2020-01-01 00:00:00+00',
  '2021-01-01 00:00:00+00'
);
select public.admin_upsert_card(
  'admin-card-pool-expired-r', 'admin-card-pool-ip-a', '종료 R 카드', null,
  'R', null, null, '20000000-0000-4000-8000-000000000907', true
);
select public.admin_set_pool_odds(
  '30000000-0000-4000-8000-000000000907',
  '20000000-0000-4000-8000-000000000907',
  0, 1, 0, 0, 0
);

reset role;

insert into public.games (
  id, type, title, config, reward_pool_id, per_user_daily_limit, active_from, active_to
)
values
  (
    'admin-card-pool-active-game', 'marble_roulette', '활성 풀 게임',
    '{"marbleCount":1,"variant":{"kind":"card"}}',
    '20000000-0000-4000-8000-000000000901', 1,
    now() - interval '1 day', now() + interval '1 day'
  ),
  (
    'admin-card-pool-future-game', 'marble_roulette', '미래 풀 게임',
    '{"marbleCount":1,"variant":{"kind":"card"}}',
    '20000000-0000-4000-8000-000000000906', 1,
    now() - interval '1 day', now() + interval '1 day'
  ),
  (
    'admin-card-pool-expired-game', 'marble_roulette', '종료 풀 게임',
    '{"marbleCount":1,"variant":{"kind":"card"}}',
    '20000000-0000-4000-8000-000000000907', 1,
    now() - interval '1 day', now() + interval '1 day'
  );

insert into public.draw_tickets (id, user_id, pool_id, source, source_id, ordinal)
values (
  '40000000-0000-4000-8000-000000000907',
  '00000000-0000-4000-8000-000000000982',
  '20000000-0000-4000-8000-000000000907',
  'order_paid',
  '50000000-0000-4000-8000-000000000907',
  1
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000982', true);

select public.play_game('admin-card-pool-active-game') as first_active_game_result \gset

select 1 / case when jsonb_array_length(
  :'first_active_game_result'::jsonb -> 'rewards'
) = 1 then 1 else 0 end as assert_active_game_and_pool_grant_one_card;

select 1 / case when (
  select count(*) from public.game_plays
  where game_id = 'admin-card-pool-active-game'
    and user_id = '00000000-0000-4000-8000-000000000982'
) = 1 and (
  select count(*) from public.card_grants
  where pool_id = '20000000-0000-4000-8000-000000000901'
    and user_id = '00000000-0000-4000-8000-000000000982'
) = 1 then 1 else 0 end as assert_active_game_writes_one_runtime_ledger;

reset role;
alter table public.card_pools disable trigger card_pools_guard_game_window;
update public.card_pools
set active_to = now() - interval '1 second'
where id = '20000000-0000-4000-8000-000000000901';
alter table public.card_pools enable trigger card_pools_guard_game_window;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000982', true);

select 1 / case when public.play_game(
  'admin-card-pool-active-game'
) = :'first_active_game_result'::jsonb then 1 else 0 end
  as assert_completed_game_replay_ignores_later_pool_end;

select 1 / case when (
  select count(*) from public.game_plays
  where game_id = 'admin-card-pool-active-game'
    and user_id = '00000000-0000-4000-8000-000000000982'
) = 1 and (
  select count(*) from public.card_grants
  where pool_id = '20000000-0000-4000-8000-000000000901'
    and user_id = '00000000-0000-4000-8000-000000000982'
) = 1 then 1 else 0 end as assert_completed_game_replay_writes_nothing;

do $$
declare
  invalid_game text;
begin
  foreach invalid_game in array array[
    'admin-card-pool-future-game',
    'admin-card-pool-expired-game'
  ]
  loop
    begin
      perform public.play_game(invalid_game);
    exception
      when others then
        if sqlerrm = 'reward_pool_not_active' then continue; end if;
        raise;
    end;
    raise exception 'game % should reject an inactive reward pool', invalid_game;
  end loop;
end;
$$;

select 1 / case when not exists (
  select 1
  from public.game_plays
  where game_id in ('admin-card-pool-future-game', 'admin-card-pool-expired-game')
) and not exists (
  select 1
  from public.card_grants
  where pool_id in (
    '20000000-0000-4000-8000-000000000906',
    '20000000-0000-4000-8000-000000000907'
  )
) then 1 else 0 end as assert_inactive_reward_pool_rejection_is_atomic;

select public.open_draw_ticket(
  '40000000-0000-4000-8000-000000000907'
) as first_expired_pool_ticket_result \gset

select 1 / case when public.open_draw_ticket(
  '40000000-0000-4000-8000-000000000907'
) = :'first_expired_pool_ticket_result'::jsonb then 1 else 0 end
  as assert_expired_pool_ticket_replay_is_stable;

select 1 / case when exists (
  select 1
  from public.draw_tickets
  where id = '40000000-0000-4000-8000-000000000907'
    and consumed_at is not null
) and (
  select count(*)
  from public.card_grants
  where idempotency_key = 'draw_ticket:40000000-0000-4000-8000-000000000907'
) = 1 then 1 else 0 end as assert_expired_pool_ticket_opens_once;

reset role;
set constraints pool_odds_total_chk immediate;

rollback;
