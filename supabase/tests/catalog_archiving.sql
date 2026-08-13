\set ON_ERROR_STOP on

begin;

update private.community_write_control
set
  post_create_enabled = true,
  post_edit_enabled = true;

-- ---------------------------------------------------------------------------
-- Schema, read-history preservation, and callable boundaries.
-- ---------------------------------------------------------------------------
select 1 / case when (
  select count(*)
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('ips', 'goods', 'cards', 'events')
    and column_name = 'archived_at'
    and is_nullable = 'YES'
) = 4 then 1 else 0 end as assert_catalog_archive_columns;

select 1 / case when (
  select count(*)
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and indexname in (
      'ips_archived_at_idx',
      'goods_archived_at_idx',
      'cards_archived_at_idx',
      'events_archived_at_idx'
    )
) = 4 then 1 else 0 end as assert_catalog_archive_indexes;

select 1 / case when not exists (
  select 1
  from (values
    ('public.ips'::regclass),
    ('public.goods'::regclass),
    ('public.cards'::regclass),
    ('public.events'::regclass)
  ) as catalog_table(table_oid)
  where has_table_privilege('authenticated', catalog_table.table_oid, 'DELETE')
) then 1 else 0 end as assert_hard_delete_remains_closed;

select 1 / case when (
  select count(*)
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname in (
      'admin_archive_ip', 'admin_unarchive_ip',
      'admin_archive_good', 'admin_unarchive_good',
      'admin_archive_card', 'admin_unarchive_card',
      'admin_archive_event', 'admin_unarchive_event'
    )
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'target_id text'
    and pg_catalog.pg_get_function_result(proc.oid) = 'boolean'
    and proc.prosecdef
    and proc.provolatile = 'v'
    and proc.proconfig = array['search_path=""']
) = 8 then 1 else 0 end as assert_archive_rpc_security_contract;

select 1 / case when not exists (
  select 1
  from (values
    ('public.admin_archive_ip(text)'), ('public.admin_unarchive_ip(text)'),
    ('public.admin_archive_good(text)'), ('public.admin_unarchive_good(text)'),
    ('public.admin_archive_card(text)'), ('public.admin_unarchive_card(text)'),
    ('public.admin_archive_event(text)'), ('public.admin_unarchive_event(text)')
  ) as rpc(signature)
  where not has_function_privilege('authenticated', rpc.signature, 'EXECUTE')
     or has_function_privilege('anon', rpc.signature, 'EXECUTE')
     or has_function_privilege('service_role', rpc.signature, 'EXECUTE')
) and not exists (
  select 1
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  cross join lateral aclexplode(
    coalesce(proc.proacl, acldefault('f', proc.proowner))
  ) as function_acl
  where namespace.nspname = 'public'
    and proc.proname in (
      'admin_archive_ip', 'admin_unarchive_ip',
      'admin_archive_good', 'admin_unarchive_good',
      'admin_archive_card', 'admin_unarchive_card',
      'admin_archive_event', 'admin_unarchive_event'
    )
    and function_acl.grantee = 0
    and function_acl.privilege_type = 'EXECUTE'
) then 1 else 0 end as assert_archive_rpc_acls;

select 1 / case when (
  select count(*)
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and (
      (tablename = 'ips' and policyname = 'ips_read')
      or (tablename = 'goods' and policyname = 'goods_read')
      or (tablename = 'cards' and policyname = 'cards_read')
      or (tablename = 'events' and policyname = 'events_read')
    )
) = 4 and not exists (
  select 1
  from (values
    ('public.ips'::regclass),
    ('public.goods'::regclass),
    ('public.cards'::regclass),
    ('public.events'::regclass)
  ) as catalog_table(table_oid)
  where not has_table_privilege('anon', catalog_table.table_oid, 'SELECT')
     or not has_table_privilege('authenticated', catalog_table.table_oid, 'SELECT')
) then 1 else 0 end as assert_catalog_history_reads_unchanged;

select 1 / case when not exists (
  select 1
  from public.ips as ip
  where ip.goods_count <> (
      select count(*)::integer
      from public.goods as good
      where good.ip_id = ip.id
        and good.archived_at is null
    )
    or ip.cards_count <> (
      select count(*)::integer
      from public.cards as card
      where card.ip_id = ip.id
        and card.archived_at is null
    )
) then 1 else 0 end as assert_catalog_counts_backfilled;

select 1 / case when (
  select count(*)
  from pg_catalog.pg_trigger as trigger
  where not trigger.tgisinternal
    and trigger.tgname in (
      'ips_archive_children_guard',
      'goods_active_parent_guard',
      'cards_active_parent_guard',
      'events_active_parent_guard',
      'goods_refresh_ip_counts',
      'cards_refresh_ip_counts',
      'cart_items_catalog_guard',
      'order_items_catalog_guard',
      'ticket_orders_catalog_guard'
    )
) = 9 then 1 else 0 end as assert_catalog_invariant_triggers;

-- ---------------------------------------------------------------------------
-- Principals and fixtures.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000011301', 'authenticated', 'authenticated', 'archive-admin@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000011302', 'authenticated', 'authenticated', 'archive-user@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000011303', 'authenticated', 'authenticated', 'archive-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000011304', 'authenticated', 'authenticated', 'archive-follower@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

update public.profiles
set
  nickname = case id
    when '00000000-0000-4000-8000-000000011301' then 'archive_admin'
    when '00000000-0000-4000-8000-000000011302' then 'archive_user'
    when '00000000-0000-4000-8000-000000011303' then 'archive_buyer'
    else 'archive_follower'
  end,
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}'::jsonb,
  onboarded_at = now(),
  role = case
    when id = '00000000-0000-4000-8000-000000011301' then 'admin'
    else 'user'
  end::public.user_role,
  suspended_at = null
where id in (
  '00000000-0000-4000-8000-000000011301',
  '00000000-0000-4000-8000-000000011302',
  '00000000-0000-4000-8000-000000011303',
  '00000000-0000-4000-8000-000000011304'
);

insert into public.verticals (key, label, color)
values ('catalog-archive-test', '카탈로그 보관 테스트', '#8B5CFF')
on conflict (key) do update set label = excluded.label, color = excluded.color;

insert into public.ips (id, title, vertical_key)
values
  ('archive-free-ip', '보관 자유 IP', 'catalog-archive-test'),
  ('archive-life-ip', '보관 수명주기 IP', 'catalog-archive-test'),
  ('archive-child-ip', '보관 자식 가드 IP', 'catalog-archive-test'),
  ('archive-operation-ip', '보관 운영 가드 IP', 'catalog-archive-test'),
  ('archive-policy-ip', '보관 정책 가드 IP', 'catalog-archive-test'),
  ('archive-pool-owner-ip', '보관 풀 소유 IP', 'catalog-archive-test'),
  ('archive-good-guard-ip', '보관 굿즈 가드 IP', 'catalog-archive-test'),
  ('archive-card-guard-ip', '보관 카드 가드 IP', 'catalog-archive-test'),
  ('archive-event-guard-ip', '보관 이벤트 가드 IP', 'catalog-archive-test'),
  ('archive-parent-ip', '보관 부모 가드 IP', 'catalog-archive-test'),
  ('archive-history-ip', '카탈로그보관검색 IP', 'catalog-archive-test'),
  ('archive-transaction-ip', '보관 거래 가드 IP', 'catalog-archive-test'),
  ('archive-curation-active-ip', '활성 큐레이션 가드 IP', 'catalog-archive-test'),
  ('archive-curation-future-ip', '예약 큐레이션 가드 IP', 'catalog-archive-test'),
  ('archive-curation-disabled-ip', '비활성 큐레이션 허용 IP', 'catalog-archive-test'),
  ('archive-curation-ended-ip', '종료 큐레이션 허용 IP', 'catalog-archive-test');

insert into public.home_curations (
  id, kind, ip_id, title, link_path, display_order,
  active_from, active_to, enabled
)
values
  (
    '00000000-0000-4000-8000-000000011371',
    'featured_ip', 'archive-curation-active-ip', '활성 큐레이션',
    '/ip/archive-curation-active-ip', 0,
    now() - interval '1 day', now() + interval '1 day', true
  ),
  (
    '00000000-0000-4000-8000-000000011372',
    'featured_ip', 'archive-curation-future-ip', '예약 큐레이션',
    '/ip/archive-curation-future-ip', 1,
    now() + interval '1 day', now() + interval '2 days', true
  ),
  (
    '00000000-0000-4000-8000-000000011373',
    'featured_ip', 'archive-curation-disabled-ip', '비활성 큐레이션',
    '/ip/archive-curation-disabled-ip', 2,
    now() - interval '1 day', null, false
  ),
  (
    '00000000-0000-4000-8000-000000011374',
    'featured_ip', 'archive-curation-ended-ip', '종료 큐레이션',
    '/ip/archive-curation-ended-ip', 3,
    now() - interval '2 days', now() - interval '1 day', true
  );

insert into public.goods (
  id, ip_id, name, type, price, stock, stock_qty, archived_at
)
values
  ('archive-life-good', 'archive-life-ip', '수명주기 굿즈', '테스트', 1000, 'soldout', 0, null),
  ('archive-child-good', 'archive-child-ip', '활성 자식 굿즈', '테스트', 1000, 'soldout', 0, null),
  ('archive-stock-good', 'archive-good-guard-ip', '재고 가드 굿즈', '테스트', 1000, 'ok', 1, null),
  ('archive-policy-good', 'archive-good-guard-ip', '정책 가드 굿즈', '테스트', 1000, 'soldout', 0, null),
  ('archive-parent-good', 'archive-parent-ip', '부모 가드 굿즈', '테스트', 1000, 'soldout', 0, now()),
  ('archive-history-good', 'archive-history-ip', '카탈로그보관검색 굿즈', '테스트', 1000, 'soldout', 0, null),
  ('archive-transaction-good', 'archive-transaction-ip', '보관 거래 굿즈', '테스트', 1000, 'soldout', 0, null);

insert into public.cards (
  id, ip_id, name, no, rarity, pool_id, archived_at
)
values
  ('archive-life-card', 'archive-life-ip', '수명주기 카드', '001', 'N', null, null),
  ('archive-parent-card', 'archive-parent-ip', '부모 가드 카드', '002', 'N', null, now()),
  ('archive-history-card', 'archive-history-ip', '카탈로그보관검색 카드', '003', 'N', null, null);

insert into public.events (
  id, ip_id, title, mode, status, archived_at
)
values
  ('archive-life-event', 'archive-life-ip', '수명주기 이벤트', '온라인', '종료', null),
  ('archive-parent-event', 'archive-parent-ip', '부모 가드 이벤트', '온라인', '종료', now()),
  ('archive-ticket-event', 'archive-event-guard-ip', '티켓 가드 이벤트', '오프라인', '예매중', null),
  ('archive-game-event', 'archive-event-guard-ip', '게임 가드 이벤트', '온라인', '종료', null),
  ('archive-transaction-event', 'archive-transaction-ip', '거래 가드 이벤트', '오프라인', '종료', null);

insert into public.card_pools (id, ip_id, name, active_from, active_to)
values
  ('00000000-0000-4000-8000-000000011311', 'archive-operation-ip', 'IP 운영 가드 풀', now() - interval '1 day', now() + interval '1 day'),
  ('00000000-0000-4000-8000-000000011312', 'archive-pool-owner-ip', '정책 준비 풀', now() - interval '1 day', now() + interval '10 days'),
  ('00000000-0000-4000-8000-000000011313', 'archive-card-guard-ip', '카드 운영 풀', now() - interval '1 day', now() + interval '1 day'),
  ('00000000-0000-4000-8000-000000011314', 'archive-card-guard-ip', '카드 종료 풀', now() - interval '10 days', now() - interval '1 day');

insert into public.cards (id, ip_id, name, no, rarity, pool_id)
select
  'archive-ready-card-' || lower(rarity_value::text),
  'archive-pool-owner-ip',
  '준비 카드 ' || rarity_value::text,
  rarity_value::text,
  rarity_value,
  '00000000-0000-4000-8000-000000011312'::uuid
from unnest(enum_range(null::public.rarity)) as rarity_value;

insert into public.pool_odds (pool_id, rarity, probability)
select
  '00000000-0000-4000-8000-000000011312'::uuid,
  rarity_value,
  0.2
from unnest(enum_range(null::public.rarity)) as rarity_value;

insert into public.cards (id, ip_id, name, no, rarity, pool_id)
values
  ('archive-open-pool-card', 'archive-card-guard-ip', '운영 풀 카드', '101', 'N', '00000000-0000-4000-8000-000000011313'),
  ('archive-ticket-card', 'archive-card-guard-ip', '미사용 티켓 카드', '102', 'N', '00000000-0000-4000-8000-000000011314');

insert into public.reward_policies (
  id, pool_id, trigger, target_ip_id, target_good_id,
  min_amount, tickets_per_grant, active, active_from, active_to
)
values
  (
    '00000000-0000-4000-8000-000000011321',
    '00000000-0000-4000-8000-000000011312',
    'order_paid', 'archive-policy-ip', null,
    0, 1, true, now() + interval '1 day', now() + interval '2 days'
  ),
  (
    '00000000-0000-4000-8000-000000011322',
    '00000000-0000-4000-8000-000000011312',
    'order_paid', 'archive-good-guard-ip', 'archive-policy-good',
    0, 1, true, now() + interval '1 day', now() + interval '2 days'
  );

insert into public.draw_tickets (
  id, user_id, pool_id, source, source_id, ordinal
)
values (
  '00000000-0000-4000-8000-000000011331',
  '00000000-0000-4000-8000-000000011303',
  '00000000-0000-4000-8000-000000011314',
  'order_paid',
  '00000000-0000-4000-8000-000000011332',
  1
);

insert into public.ticket_types (
  id, event_id, name, price, capacity, sold, per_user_limit, sales_open_at
)
values
  ('00000000-0000-4000-8000-000000011341', 'archive-ticket-event', '보관 가드 티켓', 1000, 10, 0, 4, now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000011342', 'archive-transaction-event', '보관 거래 티켓', 1000, 10, 0, 4, now() - interval '1 day');

insert into public.games (
  id, type, title, event_id, config, reward_pool_id,
  per_user_daily_limit, active_from, active_to
)
values (
  'archive-open-game',
  'marble_roulette',
  '보관 진행 게임',
  'archive-game-event',
  '{"marbleCount":10,"variant":{"kind":"goods"}}'::jsonb,
  null,
  1,
  now() - interval '1 day',
  now() + interval '1 day'
);

insert into public.posts (id, user_id, ip_id, text, tag, status)
values (
  '00000000-0000-4000-8000-000000011351',
  '00000000-0000-4000-8000-000000011303',
  'archive-history-ip',
  '카탈로그보관검색 커뮤니티 이력',
  '카탈로그보관검색태그',
  'visible'
);

insert into public.orders (id, user_id, status, total, address)
values (
  '00000000-0000-4000-8000-000000011361',
  '00000000-0000-4000-8000-000000011303',
  'paid', 1000, '{}'::jsonb
);

insert into public.order_items (
  id, order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values (
  '00000000-0000-4000-8000-000000011362',
  '00000000-0000-4000-8000-000000011361',
  'archive-history-good',
  1, 1000,
  '카탈로그보관검색 굿즈', '테스트', 'archive-history-ip'
);

insert into public.user_cards (user_id, card_id, qty)
values (
  '00000000-0000-4000-8000-000000011303',
  'archive-history-card',
  1
);

insert into public.cart_items (user_id, good_id, qty)
values (
  '00000000-0000-4000-8000-000000011303',
  'archive-transaction-good',
  1
);

insert into public.ip_follows (user_id, ip_id)
values (
  '00000000-0000-4000-8000-000000011303',
  'archive-history-ip'
);

-- ---------------------------------------------------------------------------
-- Every RPC is authenticated staff-only before target/idempotence handling.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011302', true);

do $$
declare
  rpc_call record;
begin
  for rpc_call in
    select *
    from (values
      ('admin_archive_ip', 'archive-free-ip'),
      ('admin_unarchive_ip', 'archive-free-ip'),
      ('admin_archive_good', 'archive-life-good'),
      ('admin_unarchive_good', 'archive-life-good'),
      ('admin_archive_card', 'archive-life-card'),
      ('admin_unarchive_card', 'archive-life-card'),
      ('admin_archive_event', 'archive-life-event'),
      ('admin_unarchive_event', 'archive-life-event')
    ) as calls(function_name, target_id)
  loop
    begin
      execute format('select public.%I($1)', rpc_call.function_name)
        using rpc_call.target_id;
    exception
      when insufficient_privilege then
        if sqlerrm = 'forbidden' then
          continue;
        end if;
        raise;
    end;
    raise exception '% should reject non-staff', rpc_call.function_name;
  end loop;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011301', true);

do $$
begin
  begin
    perform public.admin_archive_ip('missing-catalog-target');
  exception
    when no_data_found then
      if sqlerrm = 'catalog_not_found' then
        return;
      end if;
      raise;
  end;
  raise exception 'missing catalog target should fail';
end;
$$;

-- ---------------------------------------------------------------------------
-- Dependency guards use stable, operator-facing tokens.
-- ---------------------------------------------------------------------------
do $$
begin
  begin perform public.admin_archive_ip('archive-child-ip');
  exception when check_violation then
    if sqlerrm = 'ip_has_active_children' then return; end if;
    raise;
  end;
  raise exception 'active IP child should block archive';
end;
$$;

do $$
begin
  begin perform public.admin_archive_ip('archive-operation-ip');
  exception when check_violation then
    if sqlerrm = 'ip_has_active_operations' then return; end if;
    raise;
  end;
  raise exception 'open IP pool should block archive';
end;
$$;

do $$
begin
  begin perform public.admin_archive_ip('archive-policy-ip');
  exception when check_violation then
    if sqlerrm = 'ip_has_active_operations' then return; end if;
    raise;
  end;
  raise exception 'scheduled IP policy should block archive';
end;
$$;

do $$
begin
  begin perform public.admin_archive_ip('archive-curation-active-ip');
  exception when check_violation then
    if sqlerrm = 'ip_has_active_home_curation' then return; end if;
    raise;
  end;
  raise exception 'active featured curation should block IP archive';
end;
$$;

do $$
begin
  begin perform public.admin_archive_ip('archive-curation-future-ip');
  exception when check_violation then
    if sqlerrm = 'ip_has_active_home_curation' then return; end if;
    raise;
  end;
  raise exception 'future featured curation should block IP archive';
end;
$$;

select 1 / case when public.admin_archive_ip('archive-curation-disabled-ip')
  then 1 else 0 end as assert_disabled_curation_does_not_block_ip_archive;

select 1 / case when public.admin_archive_ip('archive-curation-ended-ip')
  then 1 else 0 end as assert_ended_curation_does_not_block_ip_archive;

do $$
begin
  begin perform public.admin_archive_good('archive-stock-good');
  exception when check_violation then
    if sqlerrm = 'good_has_stock' then return; end if;
    raise;
  end;
  raise exception 'positive stock should block good archive';
end;
$$;

do $$
begin
  begin perform public.admin_archive_good('archive-policy-good');
  exception when check_violation then
    if sqlerrm = 'good_has_active_policy' then return; end if;
    raise;
  end;
  raise exception 'scheduled good policy should block archive';
end;
$$;

do $$
begin
  begin perform public.admin_archive_card('archive-open-pool-card');
  exception when check_violation then
    if sqlerrm = 'card_has_open_pool' then return; end if;
    raise;
  end;
  raise exception 'open pool should block card archive';
end;
$$;

do $$
begin
  begin perform public.admin_archive_card('archive-ticket-card');
  exception when check_violation then
    if sqlerrm = 'card_has_open_tickets' then return; end if;
    raise;
  end;
  raise exception 'open draw ticket should block card archive';
end;
$$;

do $$
begin
  begin perform public.admin_archive_event('archive-ticket-event');
  exception when check_violation then
    if sqlerrm = 'event_has_open_ticketing' then return; end if;
    raise;
  end;
  raise exception 'open ticketing should block event archive';
end;
$$;

do $$
begin
  begin perform public.admin_archive_event('archive-game-event');
  exception when check_violation then
    if sqlerrm = 'event_has_open_game' then return; end if;
    raise;
  end;
  raise exception 'open game should block event archive';
end;
$$;

-- ---------------------------------------------------------------------------
-- Parent invariants apply to RPC restoration and privileged direct DML.
-- ---------------------------------------------------------------------------
select 1 / case when public.admin_archive_ip('archive-parent-ip') then 1 else 0 end
  as assert_parent_archived;

do $$
declare
  rpc_call record;
begin
  for rpc_call in
    select *
    from (values
      ('admin_unarchive_good', 'archive-parent-good'),
      ('admin_unarchive_card', 'archive-parent-card'),
      ('admin_unarchive_event', 'archive-parent-event')
    ) as calls(function_name, target_id)
  loop
    begin
      execute format('select public.%I($1)', rpc_call.function_name)
        using rpc_call.target_id;
    exception
      when check_violation then
        if sqlerrm = 'parent_archived' then
          continue;
        end if;
        raise;
    end;
    raise exception '% should reject archived parent', rpc_call.function_name;
  end loop;
end;
$$;

reset role;

do $$
begin
  begin
    update public.goods
    set archived_at = null
    where id = 'archive-parent-good';
  exception
    when check_violation then
      if sqlerrm = 'parent_archived' then return; end if;
      raise;
  end;
  raise exception 'direct active child update should reject archived parent';
end;
$$;

do $$
begin
  begin
    insert into public.goods (
      id, ip_id, name, type, price, stock, stock_qty
    ) values (
      'archive-parent-active-insert', 'archive-parent-ip',
      '부모 가드 신규 굿즈', '테스트', 1000, 'soldout', 0
    );
  exception
    when check_violation then
      if sqlerrm = 'parent_archived' then return; end if;
      raise;
  end;
  raise exception 'direct active child insert should reject archived parent';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011301', true);

-- ---------------------------------------------------------------------------
-- Archive/unarchive transitions are audited once and idempotent.
-- Counts include only unarchived goods/cards, even through legacy upserts.
-- ---------------------------------------------------------------------------
select 1 / case when public.admin_archive_ip('archive-free-ip') then 1 else 0 end
  as assert_ip_archive_transition;
select 1 / case when not public.admin_archive_ip('archive-free-ip') then 1 else 0 end
  as assert_ip_archive_replay;
select 1 / case when public.admin_unarchive_ip('archive-free-ip') then 1 else 0 end
  as assert_ip_unarchive_transition;
select 1 / case when not public.admin_unarchive_ip('archive-free-ip') then 1 else 0 end
  as assert_ip_unarchive_replay;

select 1 / case when public.admin_archive_good('archive-life-good') then 1 else 0 end
  as assert_good_archive_transition;
select 1 / case when not public.admin_archive_good('archive-life-good') then 1 else 0 end
  as assert_good_archive_replay;
select 1 / case when (
  select goods_count = 0 from public.ips where id = 'archive-life-ip'
) then 1 else 0 end as assert_archived_good_removed_from_count;

select public.admin_upsert_good(
  'archive-life-good', 'archive-life-ip', '수명주기 굿즈 수정',
  '테스트', 1000, null, 'soldout', null, null,
  '(주)아이콘즈', '대한민국', 'PVC', '80x80x30mm / 120g', '2026-07', '아이콘즈 CS', '02-000-0000',
  null, null, null,
  'archive-life-good'
);
select 1 / case when (
  select goods_count = 0 from public.ips where id = 'archive-life-ip'
) then 1 else 0 end as assert_legacy_good_upsert_keeps_archived_count_zero;

select 1 / case when public.admin_unarchive_good('archive-life-good') then 1 else 0 end
  as assert_good_unarchive_transition;
select 1 / case when not public.admin_unarchive_good('archive-life-good') then 1 else 0 end
  as assert_good_unarchive_replay;
select 1 / case when (
  select goods_count = 1 from public.ips where id = 'archive-life-ip'
) then 1 else 0 end as assert_unarchived_good_restored_to_count;

select 1 / case when public.admin_archive_card('archive-life-card') then 1 else 0 end
  as assert_card_archive_transition;
select 1 / case when not public.admin_archive_card('archive-life-card') then 1 else 0 end
  as assert_card_archive_replay;
select 1 / case when (
  select cards_count = 0 from public.ips where id = 'archive-life-ip'
) then 1 else 0 end as assert_archived_card_removed_from_count;

select public.admin_upsert_card(
  'archive-life-card', 'archive-life-ip', '수명주기 카드 수정',
  '001', 'N', null, null, null, false, 'archive-life-card'
);
select 1 / case when (
  select cards_count = 0 from public.ips where id = 'archive-life-ip'
) then 1 else 0 end as assert_legacy_card_upsert_keeps_archived_count_zero;

select 1 / case when public.admin_unarchive_card('archive-life-card') then 1 else 0 end
  as assert_card_unarchive_transition;
select 1 / case when not public.admin_unarchive_card('archive-life-card') then 1 else 0 end
  as assert_card_unarchive_replay;
select 1 / case when (
  select cards_count = 1 from public.ips where id = 'archive-life-ip'
) then 1 else 0 end as assert_unarchived_card_restored_to_count;

select 1 / case when public.admin_archive_event('archive-life-event') then 1 else 0 end
  as assert_event_archive_transition;
select 1 / case when not public.admin_archive_event('archive-life-event') then 1 else 0 end
  as assert_event_archive_replay;
select 1 / case when public.admin_unarchive_event('archive-life-event') then 1 else 0 end
  as assert_event_unarchive_transition;
select 1 / case when not public.admin_unarchive_event('archive-life-event') then 1 else 0 end
  as assert_event_unarchive_replay;

select 1 / case when not exists (
  select expected.action
  from (values
    ('catalog.ip.archived'), ('catalog.ip.unarchived'),
    ('catalog.good.archived'), ('catalog.good.unarchived'),
    ('catalog.card.archived'), ('catalog.card.unarchived'),
    ('catalog.event.archived'), ('catalog.event.unarchived')
  ) as expected(action)
  left join lateral (
    select count(*) as audit_count
    from public.audit_log as audit
    where audit.actor_id = '00000000-0000-4000-8000-000000011301'
      and audit.action = expected.action
      and audit.target in (
        'ips:archive-free-ip',
        'goods:archive-life-good',
        'cards:archive-life-card',
        'events:archive-life-event'
      )
  ) as actual on true
  where actual.audit_count <> 1
) then 1 else 0 end as assert_transitions_audited_once;

-- ---------------------------------------------------------------------------
-- Archived catalog disappears from catalog search while community history,
-- existing follows, and historical foreign keys remain intact.
-- ---------------------------------------------------------------------------
select public.admin_archive_good('archive-history-good');
select public.admin_archive_card('archive-history-card');
select public.admin_archive_ip('archive-history-ip');

reset role;
set local role anon;

select 1 / case when not exists (
  select 1
  from public.search_public_content('카탈로그보관검색', 20)
  where (kind = 'ip' and id = 'archive-history-ip')
     or (kind = 'good' and id = 'archive-history-good')
     or (kind = 'card' and id = 'archive-history-card')
) then 1 else 0 end as assert_archived_catalog_excluded_from_search;

select 1 / case when exists (
  select 1
  from public.search_public_content('카탈로그보관검색 커뮤니티', 20)
  where kind = 'post'
    and id = '00000000-0000-4000-8000-000000011351'
) and exists (
  select 1
  from public.search_public_content('카탈로그보관검색태그', 20)
  where kind = 'tag'
    and id = '카탈로그보관검색태그'
) then 1 else 0 end as assert_archived_ip_community_history_searchable;

reset role;
select 1 / case when exists (
  select 1 from public.ip_follows
  where user_id = '00000000-0000-4000-8000-000000011303'
    and ip_id = 'archive-history-ip'
) and exists (
  select 1 from public.order_items
  where id = '00000000-0000-4000-8000-000000011362'
    and good_id = 'archive-history-good'
) and exists (
  select 1 from public.user_cards
  where user_id = '00000000-0000-4000-8000-000000011303'
    and card_id = 'archive-history-card'
) and exists (
  select 1 from public.posts
  where id = '00000000-0000-4000-8000-000000011351'
    and ip_id = 'archive-history-ip'
) then 1 else 0 end as assert_archive_preserves_historical_foreign_keys;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011304', true);

do $$
begin
  begin
    perform public.follow_ip('archive-history-ip');
  exception
    when no_data_found then
      if sqlerrm = 'ip_not_found' then return; end if;
      raise;
  end;
  raise exception 'new follow should reject archived IP';
end;
$$;

select 1 / case when not exists (
  select 1 from public.ip_follows
  where user_id = '00000000-0000-4000-8000-000000011304'
    and ip_id = 'archive-history-ip'
) then 1 else 0 end as assert_archived_follow_not_created;

-- ---------------------------------------------------------------------------
-- Existing SECURITY DEFINER transaction paths cannot bypass archive state.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011301', true);
select public.admin_archive_good('archive-transaction-good');
select public.admin_archive_event('archive-transaction-event');

reset role;
update public.goods
set stock = 'ok', stock_qty = 5
where id = 'archive-transaction-good';
update public.events
set status = '예매중'
where id = 'archive-transaction-event';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011303', true);

do $$
begin
  begin
    perform public.merge_cart_items(
      '[{"good_id":"archive-transaction-good","qty":2}]'::jsonb
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_unavailable' then return; end if;
      raise;
  end;
  raise exception 'merge_cart_items should reject archived good';
end;
$$;

select 1 / case when (
  select qty = 1
  from public.cart_items
  where user_id = '00000000-0000-4000-8000-000000011303'
    and good_id = 'archive-transaction-good'
) then 1 else 0 end as assert_failed_cart_merge_is_atomic;

set local role service_role;
do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000011303',
      '{"recipientName":"보관 구매자","phone":"01012345678","postalCode":"12345","address1":"서울시 테스트로 1"}'::jsonb,
      '00000000-0000-4000-8000-000000011371'
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_unavailable' then return; end if;
      raise;
  end;
  raise exception 'place_order should reject archived good';
end;
$$;

reset role;
select 1 / case when not exists (
  select 1
  from public.orders
  where checkout_key = '00000000-0000-4000-8000-000000011371'
) and (
  select stock_qty = 5
  from public.goods
  where id = 'archive-transaction-good'
) and (
  select qty = 1
  from public.cart_items
  where user_id = '00000000-0000-4000-8000-000000011303'
    and good_id = 'archive-transaction-good'
) then 1 else 0 end as assert_failed_archived_order_is_atomic;

set local role service_role;
do $$
begin
  begin
    perform public.reserve_tickets(
      '00000000-0000-4000-8000-000000011303',
      '00000000-0000-4000-8000-000000011342',
      1,
      '00000000-0000-4000-8000-000000011372'
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_unavailable' then return; end if;
      raise;
  end;
  raise exception 'reserve_tickets should reject archived event';
end;
$$;

reset role;
select 1 / case when (
  select sold = 0
  from public.ticket_types
  where id = '00000000-0000-4000-8000-000000011342'
) and not exists (
  select 1
  from public.ticket_orders
  where reservation_key = '00000000-0000-4000-8000-000000011372'
) then 1 else 0 end as assert_failed_archived_reservation_is_atomic;

-- ---------------------------------------------------------------------------
-- Persistent cross-catalog invariants close writes made after retirement.
-- ---------------------------------------------------------------------------
select 1 / case when (
  select count(*)
  from pg_catalog.pg_trigger as trigger
  where not trigger.tgisinternal
    and trigger.tgname in (
      'goods_archive_dependency_guard',
      'cards_archive_dependency_guard',
      'events_archive_dependency_guard',
      'card_pools_catalog_guard',
      'cards_pool_catalog_guard',
      'reward_policies_catalog_guard',
      'pool_odds_catalog_guard',
      'games_catalog_guard',
      'game_plays_catalog_guard',
      'ticket_types_catalog_guard',
      'posts_catalog_guard'
    )
) = 11 then 1 else 0 end as assert_persistent_catalog_guard_triggers;

select 1 / case when (
  select policy.with_check ilike '%archived_at IS NULL%'
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'posts'
    and policy.policyname = 'posts_insert'
) then 1 else 0 end as assert_post_insert_rls_requires_active_ip;

select 1 / case when (
  pg_catalog.pg_get_functiondef(
    'public.grant_cards(uuid,uuid,text,uuid,text,integer)'::regprocedure
  ) ilike '%card.archived_at is null%'
  and pg_catalog.pg_get_functiondef(
    'public.admin_adjust_stock(uuid,text,integer,integer,text)'::regprocedure
  ) ilike '%selected_archived_at%'
  and pg_catalog.pg_get_functiondef(
    'public.edit_own_post(uuid,text,text,text)'::regprocedure
  ) ilike '%selected_archived_at%'
  and pg_catalog.pg_get_functiondef(
    'public.play_game(text)'::regprocedure
  ) ilike '%event_record.archived_at%'
  and pg_catalog.pg_get_functiondef(
    'public.admin_list_games()'::regprocedure
  ) ilike '%catalog_pool_has_active_lineup%'
) then 1 else 0 end as assert_rpc_archive_guards_present;

select 1 / case when not exists (
  select 1
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  cross join lateral aclexplode(
    coalesce(proc.proacl, acldefault('f', proc.proowner))
  ) as function_acl
  where namespace.nspname = 'private'
    and proc.proname in (
      'guard_catalog_archive_dependencies',
      'guard_catalog_card_pool',
      'guard_catalog_card_binding',
      'guard_catalog_reward_policy',
      'guard_catalog_pool_odd',
      'guard_catalog_game',
      'guard_catalog_game_play',
      'guard_catalog_ticket_type',
      'guard_catalog_post',
      'catalog_pool_has_active_lineup',
      'play_game_without_catalog_guard'
    )
    and (
      function_acl.grantee = 0
      or function_acl.grantee in (
        'anon'::regrole,
        'authenticated'::regrole,
        'service_role'::regrole
      )
    )
) then 1 else 0 end as assert_private_catalog_helpers_sealed;

select 1 / case when (
  pg_catalog.pg_get_functiondef(
    'private.guard_catalog_card_pool()'::regprocedure
  ) ilike '%for share%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_catalog_card_binding()'::regprocedure
  ) ilike '%for update%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_catalog_reward_policy()'::regprocedure
  ) ilike '%for share%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_catalog_game()'::regprocedure
  ) ilike '%for share%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_catalog_ticket_type()'::regprocedure
  ) ilike '%for share%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_catalog_post()'::regprocedure
  ) ilike '%for share%'
  and pg_catalog.pg_get_functiondef(
    'public.follow_ip(text)'::regprocedure
  ) ilike '%for update%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_active_catalog_parent()'::regprocedure
  ) ilike '%for update%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_active_catalog_parent()'::regprocedure
  ) ilike '%old.pool_id%order by pool.id%old.ip_id%order by ip.id%'
  and pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'private.guard_active_catalog_parent()'::regprocedure
    )),
    'from public.card_pools'
  ) < pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'private.guard_active_catalog_parent()'::regprocedure
    )),
    'from public.ips'
  )
  and pg_catalog.pg_get_functiondef(
    'private.guard_catalog_archive_dependencies()'::regprocedure
  ) not ilike '%for share%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_catalog_card_pool()'::regprocedure
  ) not ilike '%for share of card%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_catalog_reward_policy()'::regprocedure
  ) not ilike '%for share of card%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_catalog_game()'::regprocedure
  ) not ilike '%for share of card%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_catalog_pool_odd()'::regprocedure
  ) not ilike '%for share of card%'
  and pg_catalog.pg_get_functiondef(
    'public.grant_cards(uuid,uuid,text,uuid,text,integer)'::regprocedure
  ) not ilike '%for share of card%'
) then 1 else 0 end as assert_catalog_guards_lock_references;

-- Archive and curation upsert serialize on the same IP row. Whichever wins
-- the lock makes the loser observe either archived state or the enabled
-- current/future featured curation before it can commit.
select 1 / case when
  pg_catalog.pg_get_functiondef(
    'private.set_catalog_archived(text,text,boolean)'::regprocedure
  ) ilike '%for update of ip%'
  and pg_catalog.pg_get_functiondef(
    'private.set_catalog_archived(text,text,boolean)'::regprocedure
  ) ilike '%from public.home_curations%'
  and pg_catalog.pg_get_functiondef(
    'private.set_catalog_archived(text,text,boolean)'::regprocedure
  ) ilike '%curation.enabled%'
  and pg_catalog.pg_get_functiondef(
    'private.set_catalog_archived(text,text,boolean)'::regprocedure
  ) ilike '%curation.active_to is null%'
then 1 else 0 end as assert_featured_curation_archive_lock_contract;

reset role;

insert into public.card_pools (id, ip_id, name, active_from, active_to)
values (
  '00000000-0000-4000-8000-000000011380',
  'archive-free-ip',
  '보관 IP 종료 풀',
  now() - interval '2 days',
  now() - interval '1 day'
);

insert into public.ips (id, title, vertical_key)
values ('archive-ended-pool-ip', '보관 카드 종료 풀 IP', 'catalog-archive-test');

insert into public.card_pools (id, ip_id, name, active_from, active_to)
values (
  '00000000-0000-4000-8000-000000011390',
  'archive-ended-pool-ip',
  '보관 카드 종료 풀',
  now() - interval '2 days',
  now() - interval '1 day'
);

insert into public.cards (
  id, ip_id, name, no, rarity, pool_id, archived_at
)
values (
  'archive-ended-pool-card',
  'archive-ended-pool-ip',
  '종료 풀 보관 카드',
  '901',
  'N',
  '00000000-0000-4000-8000-000000011390',
  now()
);

insert into public.pool_odds (pool_id, rarity, probability)
values
  ('00000000-0000-4000-8000-000000011390', 'N', 1),
  ('00000000-0000-4000-8000-000000011390', 'R', 0),
  ('00000000-0000-4000-8000-000000011390', 'SR', 0),
  ('00000000-0000-4000-8000-000000011390', 'SSR', 0),
  ('00000000-0000-4000-8000-000000011390', 'HOLO', 0);

insert into public.games (
  id, type, title, event_id, config, reward_pool_id,
  per_user_daily_limit, active_from, active_to
)
values (
  'archive-ended-lineup-game',
  'marble_roulette',
  '보관 카드 준비 상태 게임',
  null,
  '{"marbleCount":10,"variant":{"kind":"card"}}'::jsonb,
  '00000000-0000-4000-8000-000000011390',
  1,
  now() - interval '2 days',
  now() - interval '1 day'
);

insert into public.cards (id, ip_id, name, no, rarity, archived_at)
values (
  'archive-pool-owner-card',
  'archive-pool-owner-ip',
  '활성 풀 연결 금지 카드',
  '902',
  'N',
  now()
);

insert into public.posts (id, user_id, ip_id, text, tag, status)
values (
  '00000000-0000-4000-8000-000000011395',
  '00000000-0000-4000-8000-000000011303',
  'archive-life-ip',
  '활성 IP 포스트',
  '활성태그',
  'visible'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011301', true);
select public.admin_archive_ip('archive-free-ip');
select public.admin_archive_good('archive-life-good');

do $$
begin
  begin
    perform public.admin_upsert_card_pool(
      '00000000-0000-4000-8000-000000011381',
      '00000000-0000-4000-8000-000000011382',
      'archive-free-ip',
      '보관 IP 신규 풀',
      now() + interval '1 day',
      now() + interval '2 days'
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'archived IP should reject a scheduled pool';
end;
$$;

select 1 / case when (
  select not reward_pool_ready
  from public.admin_list_games()
  where id = 'archive-ended-lineup-game'
) then 1 else 0 end as assert_admin_game_readiness_ignores_archived_cards;

reset role;
do $$
begin
  begin
    update public.card_pools
    set active_to = now() + interval '1 day'
    where id = '00000000-0000-4000-8000-000000011380';
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'archived IP should reject pool reactivation';
end;
$$;

do $$
begin
  begin
    update public.cards
    set pool_id = '00000000-0000-4000-8000-000000011312'
    where id = 'archive-pool-owner-card';
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'active pool should reject an archived card binding';
end;
$$;

do $$
begin
  begin
    update public.card_pools
    set active_to = now() + interval '1 day'
    where id = '00000000-0000-4000-8000-000000011390';
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'pool with archived cards should reject reactivation';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011301', true);

do $$
begin
  begin
    perform public.admin_upsert_reward_policy(
      '00000000-0000-4000-8000-000000011383',
      '00000000-0000-4000-8000-000000011391',
      '00000000-0000-4000-8000-000000011312',
      'order_paid',
      'archive-free-ip',
      null,
      0,
      1,
      true,
      now() + interval '1 day',
      now() + interval '2 days'
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'archived IP should reject a scheduled reward policy';
end;
$$;

do $$
begin
  begin
    perform public.admin_upsert_reward_policy(
      '00000000-0000-4000-8000-000000011384',
      '00000000-0000-4000-8000-000000011392',
      '00000000-0000-4000-8000-000000011312',
      'order_paid',
      'archive-life-ip',
      'archive-life-good',
      0,
      1,
      true,
      now() + interval '1 day',
      now() + interval '2 days'
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'archived good should reject a scheduled reward policy';
end;
$$;

do $$
begin
  begin
    perform public.admin_adjust_stock(
      '00000000-0000-4000-8000-000000011385',
      'archive-transaction-good',
      5,
      1,
      '보관 굿즈 수동 입고 거부'
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'manual positive stock adjustment should reject archived good';
end;
$$;

reset role;
select 1 / case when (
  select stock_qty = 5
  from public.goods
  where id = 'archive-transaction-good'
) and not exists (
  select 1
  from public.audit_log
  where id = '00000000-0000-4000-8000-000000011385'
) then 1 else 0 end as assert_archived_stock_adjustment_is_atomic;

update public.orders
set status = 'pending'
where id = '00000000-0000-4000-8000-000000011361';

select public.finalize_order_cancellation_with_provider_evidence(
  '00000000-0000-4000-8000-000000011361',
  '보관 후 주문 취소 재입고',
  array[]::text[]
);

select 1 / case when (
  select archived_at is not null and stock_qty = 1
  from public.goods
  where id = 'archive-history-good'
) then 1 else 0 end as assert_internal_cancellation_can_restock_archived_good;

do $$
begin
  begin
    insert into public.ticket_types (
      id, event_id, name, price, capacity, sold, per_user_limit
    ) values (
      '00000000-0000-4000-8000-000000011394',
      'archive-transaction-event',
      '보관 이벤트 신규 티켓',
      1000,
      10,
      0,
      4
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'archived event should reject a new ticket type';
end;
$$;

do $$
begin
  begin
    update public.ticket_types
    set event_id = 'archive-transaction-event'
    where id = '00000000-0000-4000-8000-000000011341';
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'archived event should reject a ticket type relink';
end;
$$;

update public.ticket_types
set capacity = capacity + 1
where id = '00000000-0000-4000-8000-000000011342';

select 1 / case when (
  select capacity = 11 and event_id = 'archive-transaction-event'
  from public.ticket_types
  where id = '00000000-0000-4000-8000-000000011342'
) then 1 else 0 end as assert_archived_event_ticket_history_remains_mutable;

insert into public.games (
  id, type, title, event_id, config, reward_pool_id,
  per_user_daily_limit, active_from, active_to
)
values (
  'archive-ended-event-game',
  'marble_roulette',
  '보관 이벤트 종료 게임',
  'archive-transaction-event',
  '{"marbleCount":10,"variant":{"kind":"card"}}'::jsonb,
  '00000000-0000-4000-8000-000000011312',
  1,
  now() - interval '2 days',
  now() - interval '1 day'
);

do $$
begin
  begin
    update public.games
    set active_to = now() + interval '1 day'
    where id = 'archive-ended-event-game';
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'archived event should reject game reactivation';
end;
$$;

do $$
begin
  begin
    insert into public.games (
      id, type, title, event_id, config, reward_pool_id,
      per_user_daily_limit, active_from, active_to
    ) values (
      'archive-active-event-game',
      'marble_roulette',
      '보관 이벤트 신규 게임',
      'archive-transaction-event',
      '{"marbleCount":10,"variant":{"kind":"card"}}'::jsonb,
      '00000000-0000-4000-8000-000000011312',
      1,
      now() - interval '1 day',
      now() + interval '1 day'
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'archived event should reject an active game';
end;
$$;

set local session_replication_role = replica;
update public.games
set active_to = now() + interval '1 day'
where id = 'archive-ended-event-game';
set local session_replication_role = origin;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011303', true);

do $$
begin
  begin
    perform public.play_game('archive-ended-event-game');
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'play_game should reject an archived linked event';
end;
$$;

do $$
begin
  begin
    insert into public.posts (id, user_id, ip_id, text, tag, status)
    values (
      '00000000-0000-4000-8000-000000011396',
      '00000000-0000-4000-8000-000000011303',
      'archive-history-ip',
      '보관 IP 신규 포스트',
      '보관신규',
      'visible'
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'new post should reject archived IP';
end;
$$;

do $$
begin
  begin
    perform public.edit_own_post(
      '00000000-0000-4000-8000-000000011395',
      '보관 IP로 이동 시도',
      'archive-history-ip',
      '보관이동'
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'post edit should reject moving to archived IP';
end;
$$;

select public.edit_own_post(
  '00000000-0000-4000-8000-000000011351',
  '보관 IP 포스트 본문 수정',
  'archive-history-ip',
  '보관이력수정'
);

reset role;
select 1 / case when (
  select text = '보관 IP 포스트 본문 수정'
    and tag = '보관이력수정'
    and ip_id = 'archive-history-ip'
  from public.posts
  where id = '00000000-0000-4000-8000-000000011351'
) then 1 else 0 end as assert_archived_ip_post_text_edit_preserved;

-- Build an invalid pre-migration active pool to prove runtime/readiness paths
-- remain closed even if legacy data bypassed the new mutation triggers.
set local session_replication_role = replica;
update public.card_pools
set active_to = now() + interval '1 day'
where id = '00000000-0000-4000-8000-000000011390';
set local session_replication_role = origin;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011301', true);

do $$
begin
  begin
    perform public.admin_set_pool_odds(
      '00000000-0000-4000-8000-000000011386',
      '00000000-0000-4000-8000-000000011390',
      1, 0, 0, 0, 0
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'pool readiness should reject archived-only rarity coverage';
end;
$$;

reset role;
do $$
begin
  begin
    insert into public.reward_policies (
      id, pool_id, trigger, target_ip_id, target_good_id,
      min_amount, tickets_per_grant, active, active_from, active_to
    ) values (
      '00000000-0000-4000-8000-000000011393',
      '00000000-0000-4000-8000-000000011390',
      'order_paid',
      'archive-ended-pool-ip',
      null,
      0,
      1,
      true,
      now() - interval '1 hour',
      now() + interval '1 hour'
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'reward policy should reject archived-only pool readiness';
end;
$$;

do $$
begin
  begin
    insert into public.games (
      id, type, title, event_id, config, reward_pool_id,
      per_user_daily_limit, active_from, active_to
    ) values (
      'archive-lineup-game',
      'marble_roulette',
      '보관 카드 라인업 게임',
      null,
      '{"marbleCount":10,"variant":{"kind":"card"}}'::jsonb,
      '00000000-0000-4000-8000-000000011390',
      1,
      now() - interval '1 hour',
      now() + interval '1 hour'
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'game should reject archived-only pool readiness';
end;
$$;

do $$
begin
  begin
    perform public.grant_cards(
      '00000000-0000-4000-8000-000000011303',
      '00000000-0000-4000-8000-000000011390',
      'game_play',
      '00000000-0000-4000-8000-000000011397',
      'catalog-archived-card-grant',
      1
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'grant_cards should reject archived-only card selection';
end;
$$;

select 1 / case when not exists (
  select 1
  from public.user_cards
  where user_id = '00000000-0000-4000-8000-000000011303'
    and card_id = 'archive-ended-pool-card'
) and not exists (
  select 1
  from public.card_grants
  where idempotency_key = 'catalog-archived-card-grant'
) then 1 else 0 end as assert_archived_card_grant_is_atomic;

rollback;
