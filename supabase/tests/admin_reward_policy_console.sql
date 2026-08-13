\set ON_ERROR_STOP on

begin;

update private.card_reward_control set enabled = true where singleton;

-- The operating contract is explicit and legacy tickets remain valid.
select 1 / case when (
  select count(*) = 4
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'reward_policies'
    and column_name in ('target_ip_id', 'target_good_id', 'active_from', 'active_to')
) then 1 else 0 end as assert_reward_policy_operating_columns_exist;

select 1 / case when (
  select count(*) = 2
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'draw_tickets'
    and column_name in ('reward_policy_id', 'revoked_at')
) then 1 else 0 end as assert_draw_ticket_ledger_columns_exist;

select 1 / case when exists (
  select 1
  from pg_constraint
  where conrelid = 'public.draw_tickets'::regclass
    and conname = 'draw_tickets_consumed_revoked_check'
    and convalidated
) and exists (
  select 1
  from pg_constraint
  where conrelid = 'public.draw_tickets'::regclass
    and conname = 'draw_tickets_reward_policy_pool_fkey'
    and convalidated
) then 1 else 0 end as assert_draw_ticket_ledger_constraints_exist;

select 1 / case when exists (
  select 1
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'reward_policies'
    and indexdef ~* '\(target_good_id, target_ip_id\)'
) then 1 else 0 end as assert_reward_policy_target_good_fk_has_child_index;

-- Public reads remain, but every policy mutation crosses an audited RPC.
select 1 / case when (
  has_table_privilege('anon', 'public.reward_policies', 'select')
  and has_table_privilege('authenticated', 'public.reward_policies', 'select')
  and not has_table_privilege('anon', 'public.reward_policies', 'insert')
  and not has_table_privilege('authenticated', 'public.reward_policies', 'insert')
  and not has_table_privilege('authenticated', 'public.reward_policies', 'update')
  and not has_table_privilege('authenticated', 'public.reward_policies', 'delete')
  and not has_table_privilege('service_role', 'public.reward_policies', 'insert')
  and not has_table_privilege('service_role', 'public.reward_policies', 'update')
  and not has_table_privilege('service_role', 'public.reward_policies', 'delete')
) then 1 else 0 end as assert_reward_policy_direct_dml_is_closed;

select 1 / case when not exists (
  select 1
  from pg_policies
  where schemaname = 'public'
    and tablename = 'reward_policies'
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
) then 1 else 0 end as assert_reward_policy_write_policies_are_removed;

select 1 / case when (
  not has_function_privilege(
    'anon',
    'public.admin_upsert_reward_policy(uuid,uuid,uuid,text,text,text,bigint,integer,boolean,timestamp with time zone,timestamp with time zone)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.admin_upsert_reward_policy(uuid,uuid,uuid,text,text,text,bigint,integer,boolean,timestamp with time zone,timestamp with time zone)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_upsert_reward_policy(uuid,uuid,uuid,text,text,text,bigint,integer,boolean,timestamp with time zone,timestamp with time zone)',
    'execute'
  )
  and not has_function_privilege('anon', 'public.admin_list_reward_policies()', 'execute')
  and has_function_privilege('authenticated', 'public.admin_list_reward_policies()', 'execute')
  and not has_function_privilege('service_role', 'public.admin_list_reward_policies()', 'execute')
) then 1 else 0 end as assert_reward_policy_admin_rpc_acls;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000991',
    'authenticated', 'authenticated', 'reward-policy-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000992',
    'authenticated', 'authenticated', 'reward-policy-fan@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000991',
    'reward-policy-staff@example.test', 'reward_policy_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000992',
    'reward-policy-fan@example.test', 'reward_policy_fan', '2000-01-01',
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
values ('admin-reward-policy-test', '발급 정책 테스트', '#000000')
on conflict (key) do nothing;

insert into public.ips (id, title, vertical_key)
values
  ('admin-reward-policy-ip-a', '발급 정책 IP A', 'admin-reward-policy-test'),
  ('admin-reward-policy-ip-b', '발급 정책 IP B', 'admin-reward-policy-test')
on conflict (id) do update set title = excluded.title;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('admin-reward-policy-good-a0', 'admin-reward-policy-ip-a', '정책 무료 굿즈 A0', '테스트', 0, 'ok', 20),
  ('admin-reward-policy-good-a1', 'admin-reward-policy-ip-a', '정책 굿즈 A1', '테스트', 5000, 'ok', 20),
  ('admin-reward-policy-good-a2', 'admin-reward-policy-ip-a', '정책 굿즈 A2', '테스트', 10000, 'ok', 20),
  ('admin-reward-policy-good-b1', 'admin-reward-policy-ip-b', '정책 굿즈 B1', '테스트', 5000, 'ok', 20)
on conflict (id) do update set ip_id = excluded.ip_id;

insert into public.card_pools (id, ip_id, name, active_from, active_to)
values
  (
    '20000000-0000-4000-8000-000000000991',
    'admin-reward-policy-ip-a', '준비된 정책 풀 A',
    now() - interval '1 day', now() + interval '30 days'
  ),
  (
    '20000000-0000-4000-8000-000000000992',
    'admin-reward-policy-ip-b', '준비된 정책 풀 B',
    now() - interval '1 day', now() + interval '30 days'
  ),
  (
    '20000000-0000-4000-8000-000000000993',
    'admin-reward-policy-ip-a', '미준비 정책 풀',
    now() - interval '1 day', now() + interval '30 days'
  ),
  (
    '20000000-0000-4000-8000-000000000994',
    'admin-reward-policy-ip-a', '종료 정책 풀',
    now() - interval '30 days', now() - interval '1 day'
  ),
  (
    '20000000-0000-4000-8000-000000000995',
    'admin-reward-policy-ip-a', '미준비 정책 풀',
    now() - interval '1 day', now() + interval '30 days'
  );

insert into public.cards (id, ip_id, name, no, rarity, pool_id)
values
  ('admin-reward-policy-card-a-n', 'admin-reward-policy-ip-a', '정책 카드 A N', '001', 'N', '20000000-0000-4000-8000-000000000991'),
  ('admin-reward-policy-card-a-r', 'admin-reward-policy-ip-a', '정책 카드 A R', '002', 'R', '20000000-0000-4000-8000-000000000991'),
  ('admin-reward-policy-card-a-sr', 'admin-reward-policy-ip-a', '정책 카드 A SR', '003', 'SR', '20000000-0000-4000-8000-000000000991'),
  ('admin-reward-policy-card-a-ssr', 'admin-reward-policy-ip-a', '정책 카드 A SSR', '004', 'SSR', '20000000-0000-4000-8000-000000000991'),
  ('admin-reward-policy-card-a-holo', 'admin-reward-policy-ip-a', '정책 카드 A HOLO', '005', 'HOLO', '20000000-0000-4000-8000-000000000991'),
  ('admin-reward-policy-card-b-n', 'admin-reward-policy-ip-b', '정책 카드 B N', '001', 'N', '20000000-0000-4000-8000-000000000992'),
  ('admin-reward-policy-card-b-r', 'admin-reward-policy-ip-b', '정책 카드 B R', '002', 'R', '20000000-0000-4000-8000-000000000992'),
  ('admin-reward-policy-card-b-sr', 'admin-reward-policy-ip-b', '정책 카드 B SR', '003', 'SR', '20000000-0000-4000-8000-000000000992'),
  ('admin-reward-policy-card-b-ssr', 'admin-reward-policy-ip-b', '정책 카드 B SSR', '004', 'SSR', '20000000-0000-4000-8000-000000000992'),
  ('admin-reward-policy-card-b-holo', 'admin-reward-policy-ip-b', '정책 카드 B HOLO', '005', 'HOLO', '20000000-0000-4000-8000-000000000992'),
  ('admin-reward-policy-card-c-n', 'admin-reward-policy-ip-a', '정책 카드 C N', '101', 'N', '20000000-0000-4000-8000-000000000993'),
  ('admin-reward-policy-card-c-r', 'admin-reward-policy-ip-a', '정책 카드 C R', '102', 'R', '20000000-0000-4000-8000-000000000993'),
  ('admin-reward-policy-card-c-sr', 'admin-reward-policy-ip-a', '정책 카드 C SR', '103', 'SR', '20000000-0000-4000-8000-000000000993'),
  ('admin-reward-policy-card-c-ssr', 'admin-reward-policy-ip-a', '정책 카드 C SSR', '104', 'SSR', '20000000-0000-4000-8000-000000000993'),
  ('admin-reward-policy-card-c-holo', 'admin-reward-policy-ip-a', '정책 카드 C HOLO', '105', 'HOLO', '20000000-0000-4000-8000-000000000993');

insert into public.pool_odds (pool_id, rarity, probability)
select pool_id, rarity, 0.2
from (values
  ('20000000-0000-4000-8000-000000000991'::uuid),
  ('20000000-0000-4000-8000-000000000992'::uuid),
  ('20000000-0000-4000-8000-000000000993'::uuid)
) as pool(pool_id)
cross join unnest(enum_range(null::public.rarity)) as rarity;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000992', true);

do $$
begin
  begin
    perform public.admin_upsert_reward_policy(
      '10000000-0000-4000-8000-000000000991',
      '30000000-0000-4000-8000-000000000991',
      '20000000-0000-4000-8000-000000000991',
      'order_paid',
      'admin-reward-policy-ip-a',
      null,
      10000,
      1,
      false,
      now() - interval '1 hour',
      now() + interval '1 day'
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'forbidden' then return; end if;
      raise;
  end;
  raise exception 'non-staff reward policy upsert should be rejected';
end;
$$;

do $$
begin
  begin
    perform * from public.admin_list_reward_policies();
  exception
    when insufficient_privilege then
      if sqlerrm = 'forbidden' then return; end if;
      raise;
  end;
  raise exception 'non-staff reward policy list should be rejected';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000991', true);

-- Invalid target, readiness, and window requests leave no policy or audit row.
do $$
declare
  invalid_call record;
begin
  for invalid_call in
    select *
    from (values
      (null::uuid, '30000000-0000-4000-8000-000000000900'::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'order_paid'::text, 'admin-reward-policy-ip-a'::text, null::text, 0::bigint, 1::integer, false, now() - interval '1 hour', null::timestamptz, 'invalid_operation_id'::text),
      ('10000000-0000-4000-8000-000000000901'::uuid, null::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'order_paid', 'admin-reward-policy-ip-a', null, 0, 1, false, now() - interval '1 hour', null, 'invalid_reward_policy_id'),
      ('10000000-0000-4000-8000-000000000902'::uuid, '30000000-0000-4000-8000-000000000902'::uuid, '20000000-0000-4000-8000-000000000999'::uuid, 'order_paid', 'admin-reward-policy-ip-a', null, 0, 1, false, now() - interval '1 hour', null, 'pool_not_found'),
      ('10000000-0000-4000-8000-000000000903'::uuid, '30000000-0000-4000-8000-000000000903'::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'not_supported', 'admin-reward-policy-ip-a', null, 0, 1, false, now() - interval '1 hour', null, 'invalid_reward_trigger'),
      ('10000000-0000-4000-8000-000000000904'::uuid, '30000000-0000-4000-8000-000000000904'::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'order_paid', 'missing-ip', null, 0, 1, false, now() - interval '1 hour', null, 'ip_not_found'),
      ('10000000-0000-4000-8000-000000000905'::uuid, '30000000-0000-4000-8000-000000000905'::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'order_paid', 'admin-reward-policy-ip-a', 'missing-good', 0, 1, false, now() - interval '1 hour', null, 'good_not_found'),
      ('10000000-0000-4000-8000-000000000906'::uuid, '30000000-0000-4000-8000-000000000906'::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'order_paid', 'admin-reward-policy-ip-a', 'admin-reward-policy-good-b1', 0, 1, false, now() - interval '1 hour', null, 'reward_policy_good_ip_mismatch'),
      ('10000000-0000-4000-8000-000000000907'::uuid, '30000000-0000-4000-8000-000000000907'::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'order_paid', 'admin-reward-policy-ip-a', null, -1, 1, false, now() - interval '1 hour', null, 'invalid_min_amount'),
      ('10000000-0000-4000-8000-000000000908'::uuid, '30000000-0000-4000-8000-000000000908'::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'order_paid', 'admin-reward-policy-ip-a', null, 0, 0, false, now() - interval '1 hour', null, 'invalid_tickets_per_grant'),
      ('10000000-0000-4000-8000-000000000909'::uuid, '30000000-0000-4000-8000-000000000909'::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'order_paid', 'admin-reward-policy-ip-a', null, 0, 101, false, now() - interval '1 hour', null, 'invalid_tickets_per_grant'),
      ('10000000-0000-4000-8000-000000000911'::uuid, '30000000-0000-4000-8000-000000000911'::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'order_paid', 'admin-reward-policy-ip-a', null, 0, 1, false, null, null, 'invalid_reward_policy_active_from'),
      ('10000000-0000-4000-8000-000000000912'::uuid, '30000000-0000-4000-8000-000000000912'::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'order_paid', 'admin-reward-policy-ip-a', null, 0, 1, false, now(), now() - interval '1 hour', 'invalid_reward_policy_active_window'),
      ('10000000-0000-4000-8000-000000000913'::uuid, '30000000-0000-4000-8000-000000000913'::uuid, '20000000-0000-4000-8000-000000000995'::uuid, 'order_paid', 'admin-reward-policy-ip-a', null, 0, 1, false, now() - interval '1 hour', now() + interval '1 day', 'reward_pool_not_ready'),
      ('10000000-0000-4000-8000-000000000914'::uuid, '30000000-0000-4000-8000-000000000914'::uuid, '20000000-0000-4000-8000-000000000994'::uuid, 'order_paid', 'admin-reward-policy-ip-a', null, 0, 1, false, now() - interval '30 days', now() - interval '2 days', 'reward_pool_not_ready'),
      ('10000000-0000-4000-8000-000000000915'::uuid, '30000000-0000-4000-8000-000000000915'::uuid, '20000000-0000-4000-8000-000000000991'::uuid, 'order_paid', 'admin-reward-policy-ip-a', null, 0, 1, true, now() + interval '31 days', now() + interval '32 days', 'reward_policy_pool_window_disjoint')
    ) as invalid_values(
      operation_id, policy_id, pool_id, reward_trigger, target_ip_id, target_good_id,
      min_amount, tickets_per_grant, active, active_from, active_to, expected_message
    )
  loop
    begin
      perform public.admin_upsert_reward_policy(
        invalid_call.operation_id,
        invalid_call.policy_id,
        invalid_call.pool_id,
        invalid_call.reward_trigger,
        invalid_call.target_ip_id,
        invalid_call.target_good_id,
        invalid_call.min_amount,
        invalid_call.tickets_per_grant,
        invalid_call.active,
        invalid_call.active_from,
        invalid_call.active_to
      );
    exception
      when others then
        if sqlerrm = invalid_call.expected_message then continue; end if;
        raise;
    end;
    raise exception 'invalid policy call should fail with %', invalid_call.expected_message;
  end loop;
end;
$$;

-- New policies require an eligible pool. Once readiness later disappears, the
-- existing policy can retain the same pool while being deactivated.
select public.admin_upsert_reward_policy(
  '10000000-0000-4000-8000-000000000910',
  '30000000-0000-4000-8000-000000000910',
  '20000000-0000-4000-8000-000000000993',
  'order_paid',
  'admin-reward-policy-ip-a',
  null,
  0,
  1,
  true,
  now() - interval '1 hour',
  now() + interval '1 day'
);

reset role;
delete from public.pool_odds
where pool_id = '20000000-0000-4000-8000-000000000993';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000991', true);

select public.admin_upsert_reward_policy(
  '10000000-0000-4000-8000-000000000916',
  '30000000-0000-4000-8000-000000000910',
  '20000000-0000-4000-8000-000000000993',
  'order_paid',
  'admin-reward-policy-ip-a',
  null,
  0,
  1,
  false,
  (select active_from from public.reward_policies where id = '30000000-0000-4000-8000-000000000910'),
  (select active_to from public.reward_policies where id = '30000000-0000-4000-8000-000000000910')
);

-- The IP-wide and exact-good policies both match. The second deliberately
-- issues a different IP's pool to prove target and reward pool are independent.
select public.admin_upsert_reward_policy(
  '10000000-0000-4000-8000-000000000920',
  '30000000-0000-4000-8000-000000000920',
  '20000000-0000-4000-8000-000000000991',
  'order_paid',
  'admin-reward-policy-ip-a',
  null,
  14000,
  2,
  true,
  now() - interval '1 hour',
  now() + interval '1 day'
);

select public.admin_upsert_reward_policy(
  '10000000-0000-4000-8000-000000000921',
  '30000000-0000-4000-8000-000000000921',
  '20000000-0000-4000-8000-000000000992',
  'order_paid',
  'admin-reward-policy-ip-a',
  'admin-reward-policy-good-a1',
  6000,
  1,
  true,
  now() - interval '1 hour',
  now() + interval '1 day'
);

select public.admin_upsert_reward_policy(
  '10000000-0000-4000-8000-000000000926',
  '30000000-0000-4000-8000-000000000926',
  '20000000-0000-4000-8000-000000000992',
  'order_paid',
  'admin-reward-policy-ip-a',
  'admin-reward-policy-good-a1',
  5000,
  1,
  true,
  now() - interval '1 hour',
  now() + interval '1 day'
);

-- A scheduled policy is valid but must not issue before its half-open start.
select public.admin_upsert_reward_policy(
  '10000000-0000-4000-8000-000000000922',
  '30000000-0000-4000-8000-000000000922',
  '20000000-0000-4000-8000-000000000991',
  'order_paid',
  'admin-reward-policy-ip-a',
  null,
  0,
  5,
  true,
  now() + interval '1 day',
  now() + interval '2 days'
);

-- Same operation and payload replays exactly once; changed payload conflicts.
select public.admin_upsert_reward_policy(
  '10000000-0000-4000-8000-000000000920',
  '30000000-0000-4000-8000-000000000920',
  '20000000-0000-4000-8000-000000000991',
  'order_paid',
  'admin-reward-policy-ip-a',
  null,
  14000,
  2,
  true,
  (select active_from from public.reward_policies where id = '30000000-0000-4000-8000-000000000920'),
  (select active_to from public.reward_policies where id = '30000000-0000-4000-8000-000000000920')
);

select 1 / case when (
  select count(*) = 1
  from public.audit_log
  where id = '10000000-0000-4000-8000-000000000920'
    and actor_id = '00000000-0000-4000-8000-000000000991'
    and action = 'admin.reward_policy.upserted'
    and target = 'reward_policies:30000000-0000-4000-8000-000000000920'
    and diff -> 'request' = jsonb_build_object(
      'pool_id', '20000000-0000-4000-8000-000000000991'::uuid,
      'trigger', 'order_paid',
      'target_ip_id', 'admin-reward-policy-ip-a',
      'target_good_id', null,
      'min_amount', 14000,
      'tickets_per_grant', 2,
      'active', true,
      'active_from', (select active_from from public.reward_policies where id = '30000000-0000-4000-8000-000000000920'),
      'active_to', (select active_to from public.reward_policies where id = '30000000-0000-4000-8000-000000000920')
    )
    and diff -> 'before' = 'null'::jsonb
    and diff -> 'after' = jsonb_build_object(
      'id', '30000000-0000-4000-8000-000000000920'::uuid,
      'pool_id', '20000000-0000-4000-8000-000000000991'::uuid,
      'trigger', 'order_paid',
      'target_ip_id', 'admin-reward-policy-ip-a',
      'target_good_id', null,
      'min_amount', 14000,
      'tickets_per_grant', 2,
      'active', true,
      'active_from', (select active_from from public.reward_policies where id = '30000000-0000-4000-8000-000000000920'),
      'active_to', (select active_to from public.reward_policies where id = '30000000-0000-4000-8000-000000000920')
    )
) then 1 else 0 end as assert_reward_policy_audit_is_exactly_once;

do $$
begin
  begin
    perform public.admin_upsert_reward_policy(
      '10000000-0000-4000-8000-000000000920',
      '30000000-0000-4000-8000-000000000920',
      '20000000-0000-4000-8000-000000000991',
      'order_paid',
      'admin-reward-policy-ip-a',
      null,
      15001,
      2,
      true,
      (select active_from from public.reward_policies where id = '30000000-0000-4000-8000-000000000920'),
      (select active_to from public.reward_policies where id = '30000000-0000-4000-8000-000000000920')
    );
  exception
    when unique_violation then
      if sqlerrm = 'operation_conflict' then return; end if;
      raise;
  end;
  raise exception 'changed reward policy operation replay should conflict';
end;
$$;

select public.admin_upsert_reward_policy(
  '10000000-0000-4000-8000-000000000924',
  '30000000-0000-4000-8000-000000000920',
  '20000000-0000-4000-8000-000000000991',
  'order_paid',
  'admin-reward-policy-ip-a',
  null,
  15000,
  2,
  true,
  (select active_from from public.reward_policies where id = '30000000-0000-4000-8000-000000000920'),
  (select active_to from public.reward_policies where id = '30000000-0000-4000-8000-000000000920')
);

select 1 / case when exists (
  select 1
  from public.audit_log
  where id = '10000000-0000-4000-8000-000000000924'
    and action = 'admin.reward_policy.upserted'
    and diff -> 'request' -> 'min_amount' = '15000'::jsonb
    and diff -> 'before' -> 'min_amount' = '14000'::jsonb
    and diff -> 'after' -> 'min_amount' = '15000'::jsonb
    and diff -> 'before' -> 'id' = '"30000000-0000-4000-8000-000000000920"'::jsonb
    and diff -> 'after' -> 'id' = '"30000000-0000-4000-8000-000000000920"'::jsonb
) then 1 else 0 end as assert_reward_policy_update_audit_has_exact_before_after;

reset role;

insert into public.orders (id, user_id, status, total, address, expires_at)
values (
  '40000000-0000-4000-8000-000000000991',
  '00000000-0000-4000-8000-000000000992',
  'pending',
  15000,
  '{}'::jsonb,
  now() + interval '15 minutes'
);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values
  (
    '40000000-0000-4000-8000-000000000991',
    'admin-reward-policy-good-a1', 1, 5000,
    '정책 굿즈 A1', '테스트', 'admin-reward-policy-ip-a'
  ),
  (
    '40000000-0000-4000-8000-000000000991',
    'admin-reward-policy-good-a2', 1, 10000,
    '정책 굿즈 A2', '테스트', 'admin-reward-policy-ip-a'
  );

-- Runtime matching must use the immutable order snapshot, not mutable catalog IP.
update public.goods
set ip_id = 'admin-reward-policy-ip-b'
where id = 'admin-reward-policy-good-a2';

set local role service_role;
select public.confirm_order_payment(
  'reward-policy-payment-991',
  '40000000-0000-4000-8000-000000000991',
  'reward-policy-provider-key-991',
  15000,
  '{"verified":true}'::jsonb
);

-- Webhook replay is a no-op and cannot duplicate any policy grants.
select public.confirm_order_payment(
  'reward-policy-payment-991',
  '40000000-0000-4000-8000-000000000991',
  'reward-policy-provider-key-991',
  15000,
  '{"verified":true}'::jsonb
);
reset role;

select 1 / case when (
  select count(*) = 3
    and count(*) filter (
      where reward_policy_id = '30000000-0000-4000-8000-000000000920'
        and pool_id = '20000000-0000-4000-8000-000000000991'
    ) = 2
    and count(*) filter (
      where reward_policy_id = '30000000-0000-4000-8000-000000000926'
        and pool_id = '20000000-0000-4000-8000-000000000992'
    ) = 1
    and min(ordinal) = 1
    and max(ordinal) = 3
  from public.draw_tickets
  where source = 'order_paid'
    and source_id = '40000000-0000-4000-8000-000000000991'
) then 1 else 0 end as assert_matching_policies_accumulate_with_attribution;

select 1 / case when not exists (
  select 1
  from public.draw_tickets
  where source = 'order_paid'
    and source_id = '40000000-0000-4000-8000-000000000991'
    and reward_policy_id = '30000000-0000-4000-8000-000000000921'
) then 1 else 0 end as assert_exact_good_subtotal_excludes_other_goods;

-- A zero-price target is still present and must match min_amount=0. A missing
-- target must remain distinct from a present target whose subtotal is zero.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000991', true);

select public.admin_upsert_reward_policy(
  '10000000-0000-4000-8000-000000000927',
  '30000000-0000-4000-8000-000000000927',
  '20000000-0000-4000-8000-000000000991',
  'order_paid',
  'admin-reward-policy-ip-a',
  'admin-reward-policy-good-a0',
  0,
  1,
  true,
  now() - interval '1 hour',
  now() + interval '1 day'
);

select public.admin_upsert_reward_policy(
  '10000000-0000-4000-8000-000000000928',
  '30000000-0000-4000-8000-000000000928',
  '20000000-0000-4000-8000-000000000991',
  'order_paid',
  'admin-reward-policy-ip-a',
  'admin-reward-policy-good-a1',
  0,
  1,
  true,
  now() - interval '1 hour',
  now() + interval '1 day'
);

reset role;

insert into public.orders (id, user_id, status, total, address, expires_at)
values (
  '40000000-0000-4000-8000-000000000992',
  '00000000-0000-4000-8000-000000000992',
  'pending',
  5000,
  '{}'::jsonb,
  now() + interval '15 minutes'
);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values
  (
    '40000000-0000-4000-8000-000000000992',
    'admin-reward-policy-good-a0', 1, 0,
    '정책 무료 굿즈 A0', '테스트', 'admin-reward-policy-ip-a'
  ),
  (
    '40000000-0000-4000-8000-000000000992',
    'admin-reward-policy-good-b1', 1, 5000,
    '정책 굿즈 B1', '테스트', 'admin-reward-policy-ip-b'
  );

set local role service_role;
select public.confirm_order_payment(
  'reward-policy-payment-992',
  '40000000-0000-4000-8000-000000000992',
  'reward-policy-provider-key-992',
  5000,
  '{"verified":true}'::jsonb
);
reset role;

select 1 / case when (
  select count(*) = 1
    and count(*) filter (
      where reward_policy_id = '30000000-0000-4000-8000-000000000927'
    ) = 1
    and count(*) filter (
      where reward_policy_id = '30000000-0000-4000-8000-000000000928'
    ) = 0
  from public.draw_tickets
  where source = 'order_paid'
    and source_id = '40000000-0000-4000-8000-000000000992'
) then 1 else 0 end as assert_zero_price_target_matches_but_missing_target_does_not;

-- Issued policy pool bindings are immutable through both the RPC and FK.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000991', true);

do $$
begin
  begin
    perform public.admin_upsert_reward_policy(
      '10000000-0000-4000-8000-000000000923',
      '30000000-0000-4000-8000-000000000920',
      '20000000-0000-4000-8000-000000000992',
      'order_paid',
      'admin-reward-policy-ip-a',
      null,
      15000,
      2,
      true,
      (select active_from from public.reward_policies where id = '30000000-0000-4000-8000-000000000920'),
      (select active_to from public.reward_policies where id = '30000000-0000-4000-8000-000000000920')
    );
  exception
    when check_violation then
      if sqlerrm = 'reward_policy_pool_locked' then return; end if;
      raise;
  end;
  raise exception 'issued reward policy pool should be locked';
end;
$$;

-- Pool edits cannot erase the interval shared with an active policy.
do $$
begin
  begin
    perform public.admin_upsert_card_pool(
      '10000000-0000-4000-8000-000000000925',
      '20000000-0000-4000-8000-000000000991',
      'admin-reward-policy-ip-a',
      '준비된 정책 풀 A',
      now() + interval '10 days',
      now() + interval '20 days'
    );
  exception
    when check_violation then
      if sqlerrm = 'active_reward_policy_window_conflict' then return; end if;
      raise;
  end;
  raise exception 'pool edit should not dead-window an active policy';
end;
$$;

reset role;

select id as opened_ticket_id
from public.draw_tickets
where source = 'order_paid'
  and source_id = '40000000-0000-4000-8000-000000000991'
order by ordinal
limit 1
\gset

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000992', true);
select public.open_draw_ticket(:'opened_ticket_id'::uuid);
reset role;

set local role service_role;
select public.cancel_order_with_provider_evidence(
  '40000000-0000-4000-8000-000000000991',
  '정책 리워드 주문 취소',
  array['reward-policy-provider-key-991']::text[]
);
reset role;

select 1 / case when (
  select count(*) = 3
    and count(*) filter (where consumed_at is not null and revoked_at is null) = 1
    and count(*) filter (where consumed_at is null and revoked_at is not null) = 2
  from public.draw_tickets
  where source = 'order_paid'
    and source_id = '40000000-0000-4000-8000-000000000991'
) then 1 else 0 end as assert_cancel_soft_revokes_unused_and_preserves_opened;

select id as revoked_ticket_id
from public.draw_tickets
where source = 'order_paid'
  and source_id = '40000000-0000-4000-8000-000000000991'
  and revoked_at is not null
order by ordinal
limit 1
\gset

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000992', true);

do $$
declare
  v_ticket_id uuid;
begin
  select id
    into v_ticket_id
  from public.draw_tickets
  where source = 'order_paid'
    and source_id = '40000000-0000-4000-8000-000000000991'
    and revoked_at is not null
  order by ordinal
  limit 1;

  begin
    perform public.open_draw_ticket(v_ticket_id);
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'ticket_revoked' then return; end if;
      raise;
  end;
  raise exception 'revoked ticket should not open';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000991', true);

select 1 / case when (
  select issued_count = 2
    and available_count = 0
    and opened_count = 1
    and revoked_count = 1
    and order_count = 1
    and last_issued_at is not null
  from public.admin_list_reward_policies()
  where id = '30000000-0000-4000-8000-000000000920'
) then 1 else 0 end as assert_staff_summary_counts_are_policy_scoped;

select 1 / case when (
  pg_get_function_result('public.admin_list_reward_policies()'::regprocedure)
    !~ '(user_id|source_id|order_id)'
) then 1 else 0 end as assert_staff_summary_signature_is_pii_free;

reset role;

-- The row lock and mutually exclusive predicates are the DB race contract.
with definitions as (
  select
    pg_get_functiondef('public.open_draw_ticket_unguarded(uuid)'::regprocedure) as open_body,
    pg_get_functiondef(
      'public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[])'::regprocedure
    ) as cancel_body
)
select 1 / case when (
  open_body ~* 'from public[.]draw_tickets[[:space:][:print:]]*for update'
  and cancel_body ~* 'update public[.]draw_tickets'
  and cancel_body ~* 'consumed_at is null'
  and cancel_body ~* 'revoked_at is null'
) then 1 else 0 end as assert_open_and_cancel_use_serialized_ticket_state
from definitions;

rollback;
