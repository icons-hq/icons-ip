\set ON_ERROR_STOP on

begin;

select 1 / case when exists (
  select 1
  from private.card_reward_control
  where singleton and not enabled
) then 1 else 0 end as assert_card_reward_gate_defaults_off;

select 1 / case when (
  not has_table_privilege('anon', 'private.card_reward_control', 'select')
  and not has_table_privilege('authenticated', 'private.card_reward_control', 'select')
  and not has_table_privilege('service_role', 'private.card_reward_control', 'select')
  and not has_table_privilege('anon', 'private.card_reward_control', 'update')
  and not has_table_privilege('authenticated', 'private.card_reward_control', 'update')
  and not has_table_privilege('service_role', 'private.card_reward_control', 'update')
) then 1 else 0 end as assert_card_reward_gate_table_is_private;

select 1 / case when (
  has_function_privilege('anon', 'public.card_rewards_enabled()', 'execute')
  and has_function_privilege('authenticated', 'public.card_rewards_enabled()', 'execute')
  and not has_function_privilege('service_role', 'public.card_rewards_enabled()', 'execute')
  and not has_function_privilege('anon', 'private.require_card_rewards_enabled()', 'execute')
  and not has_function_privilege('authenticated', 'private.require_card_rewards_enabled()', 'execute')
  and not has_function_privilege('service_role', 'private.require_card_rewards_enabled()', 'execute')
) then 1 else 0 end as assert_card_reward_gate_function_acls;

select 1 / case when not exists (
  select 1
  from unnest(array[
    'public.open_draw_ticket_unguarded(uuid)'::regprocedure,
    'public.play_game_unguarded(text)'::regprocedure,
    'public.admin_grant_draw_tickets_unguarded(uuid,uuid,uuid,integer,text)'::regprocedure,
    'public.admin_upsert_reward_policy_unguarded(uuid,uuid,uuid,text,text,text,bigint,integer,boolean,timestamptz,timestamptz)'::regprocedure,
    'public.admin_upsert_game_unguarded(uuid,text,text,text,uuid,text,integer,timestamptz,timestamptz,boolean)'::regprocedure
  ]) as implementation(signature)
  cross join unnest(array['anon', 'authenticated', 'service_role']) as app_role(name)
  where has_function_privilege(app_role.name, implementation.signature, 'execute')
) then 1 else 0 end as assert_unguarded_reward_implementations_are_sealed;

select 1 / case when (
  pg_catalog.pg_get_functiondef(
    'private.require_card_rewards_enabled()'::regprocedure
  ) ilike '%for share%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_draw_ticket_issuance()'::regprocedure
  ) ilike '%for share%'
) then 1 else 0 end as assert_gate_disable_serializes_with_reward_writes;

select 1 / case when (
  select not public.card_rewards_enabled()
) then 1 else 0 end as assert_public_capability_is_off;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000001901',
    'authenticated', 'authenticated', 'reward-gate-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000001902',
    'authenticated', 'authenticated', 'reward-gate-fan@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000001901',
    'reward-gate-staff@example.test', 'reward_gate_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000001902',
    'reward-gate-fan@example.test', 'reward_gate_fan', '2000-01-01',
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
values ('card-reward-gate-test', '카드 보상 게이트 테스트', '#000000')
on conflict (key) do nothing;

insert into public.ips (id, title, vertical_key)
values ('card-reward-gate-ip', '카드 보상 게이트 IP', 'card-reward-gate-test')
on conflict (id) do update set title = excluded.title;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values (
  'card-reward-gate-good', 'card-reward-gate-ip',
  '카드 보상 게이트 굿즈', '문구', 1000, 'ok', 10
)
on conflict (id) do update set ip_id = excluded.ip_id;

insert into public.card_pools (id, ip_id, name, active_from, active_to)
values (
  '20000000-0000-4000-8000-000000001901',
  'card-reward-gate-ip', '카드 보상 게이트 풀',
  now() - interval '1 day', now() + interval '30 days'
)
on conflict (id) do update set
  ip_id = excluded.ip_id,
  active_from = excluded.active_from,
  active_to = excluded.active_to;

insert into public.cards (id, ip_id, name, no, rarity, pool_id)
values (
  'card-reward-gate-card-n', 'card-reward-gate-ip',
  '카드 보상 게이트 N', '001', 'N',
  '20000000-0000-4000-8000-000000001901'
)
on conflict (id) do update set archived_at = null;

insert into public.pool_odds (pool_id, rarity, probability)
values
  ('20000000-0000-4000-8000-000000001901', 'N', 1.00000),
  ('20000000-0000-4000-8000-000000001901', 'R', 0.00000),
  ('20000000-0000-4000-8000-000000001901', 'SR', 0.00000),
  ('20000000-0000-4000-8000-000000001901', 'SSR', 0.00000),
  ('20000000-0000-4000-8000-000000001901', 'HOLO', 0.00000)
on conflict (pool_id, rarity) do update set probability = excluded.probability;

set constraints pool_odds_total_chk immediate;
set constraints pool_odds_total_chk deferred;

insert into public.games (
  id, type, title, config, reward_pool_id,
  per_user_daily_limit, active_from, active_to
)
values (
  'card-reward-gate-game', 'marble_roulette', '카드 보상 게이트 게임',
  '{"marbleCount":10,"variant":{"kind":"card","rarityLineup":["N","N","N","N","N","N","N","N","N","N"]}}'::jsonb,
  '20000000-0000-4000-8000-000000001901', 1,
  now() - interval '1 day', now() + interval '30 days'
)
on conflict (id) do update set
  active_from = excluded.active_from,
  active_to = excluded.active_to;

update private.card_reward_control set enabled = true where singleton;

select 1 / case when (
  select enabled and changed_at > transaction_timestamp()
  from private.card_reward_control
  where singleton
) then 1 else 0 end as assert_gate_change_is_timestamped;

insert into public.draw_tickets (
  id, user_id, pool_id, source, source_id, ordinal
)
values (
  '30000000-0000-4000-8000-000000001901',
  '00000000-0000-4000-8000-000000001902',
  '20000000-0000-4000-8000-000000001901',
  'admin_grant', '40000000-0000-4000-8000-000000001901', 1
)
on conflict (id) do nothing;

update private.card_reward_control set enabled = false where singleton;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001902', true);

select 1 / case when not public.card_rewards_enabled()
  then 1 else 0 end as assert_authenticated_capability_is_off;

do $$
begin
  begin
    perform public.open_draw_ticket('30000000-0000-4000-8000-000000001901');
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'card_rewards_disabled' then return; end if;
      raise;
  end;
  raise exception 'open_draw_ticket should be disabled';
end;
$$;

do $$
begin
  begin
    perform public.play_game('card-reward-gate-game');
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'card_rewards_disabled' then return; end if;
      raise;
  end;
  raise exception 'play_game should be disabled';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001901', true);

do $$
begin
  begin
    perform public.admin_grant_draw_tickets(
      '40000000-0000-4000-8000-000000001902',
      '00000000-0000-4000-8000-000000001902',
      '20000000-0000-4000-8000-000000001901',
      1,
      '게이트 테스트'
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'card_rewards_disabled' then return; end if;
      raise;
  end;
  raise exception 'admin manual grant should be disabled';
end;
$$;

do $$
begin
  begin
    perform public.admin_upsert_reward_policy(
      '40000000-0000-4000-8000-000000001903',
      '50000000-0000-4000-8000-000000001901',
      '20000000-0000-4000-8000-000000001901',
      'order_paid', 'card-reward-gate-ip', null,
      1000, 1, true,
      now() - interval '1 hour', now() + interval '1 day'
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'card_rewards_disabled' then return; end if;
      raise;
  end;
  raise exception 'reward policy activation should be disabled';
end;
$$;

do $$
begin
  begin
    perform public.admin_upsert_game(
      '40000000-0000-4000-8000-000000001904',
      null, 'card-reward-gate-new-game', '차단된 카드 게임',
      '20000000-0000-4000-8000-000000001901', null, 1,
      now() - interval '1 hour', now() + interval '1 day', false
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'card_rewards_disabled' then return; end if;
      raise;
  end;
  raise exception 'card game activation should be disabled';
end;
$$;

-- Payment finalization remains available, but an active policy can no longer
-- turn that payment into a reward issuance while the gate is OFF.
reset role;
insert into public.reward_policies (
  id, pool_id, trigger, min_amount, tickets_per_grant, active,
  target_ip_id, active_from, active_to
)
values (
  '50000000-0000-4000-8000-000000001901',
  '20000000-0000-4000-8000-000000001901',
  'order_paid', 1000, 1, true,
  'card-reward-gate-ip', now() - interval '1 day', now() + interval '1 day'
);

insert into public.orders (id, user_id, status, total, address, expires_at)
values (
  '60000000-0000-4000-8000-000000001901',
  '00000000-0000-4000-8000-000000001902',
  'pending', 1000, '{}'::jsonb, now() + interval '15 minutes'
);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values (
  '60000000-0000-4000-8000-000000001901',
  'card-reward-gate-good', 1, 1000,
  '카드 보상 게이트 굿즈', '문구', 'card-reward-gate-ip'
);

set local role service_role;
select public.confirm_order_payment(
  'card-reward-gate-payment',
  '60000000-0000-4000-8000-000000001901',
  'card-reward-gate-provider-key',
  1000,
  '{"verified":true}'::jsonb
);
reset role;

select 1 / case when (
  select status = 'paid'
  from public.orders
  where id = '60000000-0000-4000-8000-000000001901'
) and exists (
  select 1 from public.payments
  where ref_id = '60000000-0000-4000-8000-000000001901'
) and not exists (
  select 1 from public.draw_tickets
  where source_id = '60000000-0000-4000-8000-000000001901'
) then 1 else 0 end as assert_order_reward_block_is_atomic;

reset role;

-- Existing holdings remain readable and no disabled path created a new grant.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001902', true);

select 1 / case when exists (
  select 1 from public.draw_tickets
  where id = '30000000-0000-4000-8000-000000001901'
    and consumed_at is null
) and not exists (
  select 1 from public.card_grants
  where user_id = '00000000-0000-4000-8000-000000001902'
) then 1 else 0 end as assert_disabled_paths_leave_ledger_unchanged;

rollback;
