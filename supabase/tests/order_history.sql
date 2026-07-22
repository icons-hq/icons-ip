\set ON_ERROR_STOP on

begin;

-- Historical item identity must be stored on every order item.
select 1 / case when (
  select count(*) = 3 and bool_and(is_nullable = 'NO')
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'order_items'
    and column_name in (
      'good_name_snapshot',
      'good_type_snapshot',
      'good_ip_id_snapshot'
    )
) then 1 else 0 end as assert_order_item_snapshots_are_required;

-- Browser clients can read only the payment summary columns needed by order history.
select 1 / case when not has_table_privilege('anon', 'public.payments', 'select') then 1 else 0 end
  as assert_anon_has_no_payment_table_select;
select 1 / case when not has_any_column_privilege('anon', 'public.payments', 'select') then 1 else 0 end
  as assert_anon_has_no_payment_column_select;
select 1 / case when not has_table_privilege('authenticated', 'public.payments', 'select') then 1 else 0 end
  as assert_authenticated_has_no_payment_table_select;
select 1 / case when (
  has_column_privilege('authenticated', 'public.payments', 'id', 'select')
  and has_column_privilege('authenticated', 'public.payments', 'user_id', 'select')
  and has_column_privilege('authenticated', 'public.payments', 'purpose', 'select')
  and has_column_privilege('authenticated', 'public.payments', 'ref_id', 'select')
  and has_column_privilege('authenticated', 'public.payments', 'amount', 'select')
  and has_column_privilege('authenticated', 'public.payments', 'status', 'select')
  and has_column_privilege('authenticated', 'public.payments', 'created_at', 'select')
) then 1 else 0 end as assert_authenticated_can_read_safe_payment_columns;
select 1 / case when (
  not has_column_privilege('authenticated', 'public.payments', 'payment_key', 'select')
  and not has_column_privilege('authenticated', 'public.payments', 'idempotency_key', 'select')
  and not has_column_privilege('authenticated', 'public.payments', 'raw', 'select')
) then 1 else 0 end as assert_authenticated_cannot_read_sensitive_payment_columns;
select 1 / case when not has_column_privilege(
  'authenticated', 'public.payments', 'updated_at', 'select'
) then 1 else 0 end as assert_authenticated_has_no_unused_payment_column_select;
select 1 / case when (
  not has_table_privilege('authenticated', 'public.payments', 'insert')
  and not has_table_privilege('authenticated', 'public.payments', 'update')
  and not has_table_privilege('authenticated', 'public.payments', 'delete')
  and not has_table_privilege('authenticated', 'public.payments', 'truncate')
  and not has_table_privilege('anon', 'public.payments', 'insert')
  and not has_table_privilege('anon', 'public.payments', 'update')
  and not has_table_privilege('anon', 'public.payments', 'delete')
  and not has_table_privilege('anon', 'public.payments', 'truncate')
) then 1 else 0 end as assert_client_roles_cannot_write_payments_directly;
select 1 / case when (
  has_table_privilege('service_role', 'public.payments', 'select')
  and has_table_privilege('service_role', 'public.payments', 'insert')
  and has_table_privilege('service_role', 'public.payments', 'update')
  and has_table_privilege('service_role', 'public.payments', 'delete')
  and has_function_privilege(
    'service_role',
    'public.confirm_order_payment(text,uuid,text,bigint,jsonb)',
    'execute'
  )
) then 1 else 0 end as assert_service_role_payment_flow_is_preserved;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000601',
    'authenticated', 'authenticated', 'order-history-one@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000602',
    'authenticated', 'authenticated', 'order-history-two@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values
  (
    '00000000-0000-4000-8000-000000000601',
    'order-history-one@example.test', 'order_history_one', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  ),
  (
    '00000000-0000-4000-8000-000000000602',
    'order-history-two@example.test', 'order_history_two', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at;

insert into public.ips (id, title, vertical_key)
values
  ('order-history-ip-a', '주문 스냅샷 IP A', 'character'),
  ('order-history-ip-b', '주문 스냅샷 IP B', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values (
  'order-history-good',
  'order-history-ip-a',
  '주문 당시 굿즈명',
  '아크릴 스탠드',
  25000,
  'ok',
  10
);

insert into public.card_pools (id, ip_id, name, active_from)
values
  (
    '20000000-0000-4000-8000-000000000601',
    'order-history-ip-a',
    '주문 스냅샷 IP A 카드풀',
    now() - interval '1 day'
  ),
  (
    '20000000-0000-4000-8000-000000000602',
    'order-history-ip-b',
    '주문 스냅샷 IP B 카드풀',
    now() - interval '1 day'
  );

insert into public.cards (id, ip_id, name, no, rarity, pool_id)
values
  (
    'order-history-card-a', 'order-history-ip-a', '주문 스냅샷 카드 A',
    '001', 'N', '20000000-0000-4000-8000-000000000601'
  ),
  (
    'order-history-card-b', 'order-history-ip-b', '주문 스냅샷 카드 B',
    '001', 'N', '20000000-0000-4000-8000-000000000602'
  );

insert into public.pool_odds (pool_id, rarity, probability)
select pool_id, rarity, case when rarity = 'N' then 1 else 0 end
from (values
  ('20000000-0000-4000-8000-000000000601'::uuid),
  ('20000000-0000-4000-8000-000000000602'::uuid)
) as pool(pool_id)
cross join unnest(enum_range(null::public.rarity)) as rarity;

insert into public.reward_policies (
  pool_id,
  trigger,
  target_ip_id,
  min_amount,
  tickets_per_grant,
  active,
  active_from
)
values
  (
    '20000000-0000-4000-8000-000000000601', 'order_paid',
    'order-history-ip-a', 0, 1, true, now() - interval '1 day'
  ),
  (
    '20000000-0000-4000-8000-000000000602', 'order_paid',
    'order-history-ip-b', 0, 1, true, now() - interval '1 day'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000601', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.cart_items (user_id, good_id, qty)
values (
  '00000000-0000-4000-8000-000000000601',
  'order-history-good',
  1
);

set local role service_role;
select public.place_order(
  '00000000-0000-4000-8000-000000000601',
  '{"recipientName":"주문기록","phone":"01012345678","postalCode":"12345","address1":"서울시 성동구"}'::jsonb,
  '30000000-0000-4000-8000-000000000601'
) as order_id \gset

reset role;

-- Catalog edits after checkout must never rewrite the historical receipt.
update public.goods
set
  ip_id = 'order-history-ip-b',
  name = '변경된 굿즈명',
  type = '변경된 유형'
where id = 'order-history-good';

select 1 / case when (
  select jsonb_build_object(
    'name', good_name_snapshot,
    'type', good_type_snapshot,
    'ipId', good_ip_id_snapshot,
    'qty', qty,
    'unitPrice', unit_price
  ) = '{"name":"주문 당시 굿즈명","type":"아크릴 스탠드","ipId":"order-history-ip-a","qty":1,"unitPrice":25000}'::jsonb
  from public.order_items
  where order_id = :'order_id'::uuid
) then 1 else 0 end as assert_order_item_identity_snapshot_is_immutable;

set local role service_role;
select public.confirm_order_payment(
  'order-history-payment-601',
  :'order_id'::uuid,
  'order-history-provider-key-secret',
  25000,
  '{"providerPayload":"must-not-reach-browser"}'::jsonb
);
reset role;

-- Reward attribution follows the order-time IP, not the goods row edited later.
select 1 / case when (
  select count(*) = 1
    and bool_and(pool_id = '20000000-0000-4000-8000-000000000601'::uuid)
  from public.draw_tickets
  where source = 'order_paid'
    and source_id = :'order_id'::uuid
) then 1 else 0 end as assert_reward_uses_order_item_ip_snapshot;
select 1 / case when not exists (
  select 1
  from public.draw_tickets
  where source = 'order_paid'
    and source_id = :'order_id'::uuid
    and pool_id = '20000000-0000-4000-8000-000000000602'::uuid
) then 1 else 0 end as assert_reward_ignores_current_goods_ip;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000602', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select 1 / case when not exists (
  select 1 from public.orders where id = :'order_id'::uuid
) then 1 else 0 end as assert_other_user_cannot_read_order;
select 1 / case when not exists (
  select 1 from public.order_items where order_id = :'order_id'::uuid
) then 1 else 0 end as assert_other_user_cannot_read_order_items;
select 1 / case when not exists (
  select id, user_id, purpose, ref_id, amount, status, created_at
  from public.payments
  where purpose = 'order'
    and ref_id = :'order_id'::uuid
) then 1 else 0 end as assert_other_user_cannot_read_payment_summary;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000601', true);

select 1 / case when (
  select count(*) = 1
  from public.payments
  where purpose = 'order'
    and ref_id = :'order_id'::uuid
    and user_id = '00000000-0000-4000-8000-000000000601'
    and amount = 25000
    and status = 'paid'
) then 1 else 0 end as assert_owner_can_read_safe_payment_summary;

do $$
begin
  begin
    perform payment_key from public.payments limit 1;
    raise exception 'authenticated must not read payment_key';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform idempotency_key from public.payments limit 1;
    raise exception 'authenticated must not read idempotency_key';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform raw from public.payments limit 1;
    raise exception 'authenticated must not read raw';
  exception
    when insufficient_privilege then null;
  end;

  begin
    execute 'select * from public.payments limit 1';
    raise exception 'authenticated must not use select star on payments';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

rollback;
