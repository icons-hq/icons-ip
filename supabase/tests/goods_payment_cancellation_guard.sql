\set ON_ERROR_STOP on

begin;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_trigger as trigger
  where trigger.tgrelid = 'public.orders'::regclass
    and trigger.tgname = 'orders_guard_unresolved_goods_payment_cancellation'
    and not trigger.tgisinternal
) then 1 else 0 end as assert_deep_order_cancellation_guard_exists;

select 1 / case when not has_function_privilege(
  'service_role',
  'private.guard_unresolved_goods_payment_cancellation()',
  'execute'
) then 1 else 0 end as assert_guard_helper_is_not_an_application_rpc;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-4000-8000-000000002071',
  'authenticated', 'authenticated',
  'goods-payment-cancel-guard@example.test', pg_catalog.now(),
  '{}', '{}', pg_catalog.now(), pg_catalog.now()
)
on conflict (id) do nothing;

insert into public.profiles (
  id, email, nickname, birth_date, consents, onboarded_at
)
values (
  '00000000-0000-4000-8000-000000002071',
  'goods-payment-cancel-guard@example.test',
  'goods_payment_cancel_guard', '2000-01-01',
  '{"terms":true,"privacy":true}'::jsonb, pg_catalog.now()
)
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  suspended_at = null,
  suspension_reason = null;

insert into public.verticals (key, label, color)
values ('goods-payment-cancel-guard', '결제 취소 guard', '#000000')
on conflict (key) do nothing;

insert into public.ips (id, title, vertical_key)
values (
  'goods-payment-cancel-guard-ip',
  '결제 취소 guard IP',
  'goods-payment-cancel-guard'
)
on conflict (id) do update set title = excluded.title;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values (
  'goods-payment-cancel-guard-good',
  'goods-payment-cancel-guard-ip',
  '결제 취소 guard 상품',
  '테스트', 28000, 'ok', 10
)
on conflict (id) do update set
  ip_id = excluded.ip_id,
  name = excluded.name,
  type = excluded.type,
  price = excluded.price,
  stock = excluded.stock,
  stock_qty = excluded.stock_qty;

insert into public.orders (
  id, user_id, status, total, shipping_fee, expires_at, checkout_key
)
select
  fixture.order_id,
  '00000000-0000-4000-8000-000000002071',
  'pending', 31000, 3000,
  pg_catalog.now() + interval '15 minutes',
  fixture.checkout_key
from (
  values
    ('20000000-0000-4000-8000-000000002071'::uuid, '10000000-0000-4000-8000-000000002071'::uuid),
    ('20000000-0000-4000-8000-000000002072'::uuid, '10000000-0000-4000-8000-000000002072'::uuid),
    ('20000000-0000-4000-8000-000000002073'::uuid, '10000000-0000-4000-8000-000000002073'::uuid),
    ('20000000-0000-4000-8000-000000002074'::uuid, '10000000-0000-4000-8000-000000002074'::uuid),
    ('20000000-0000-4000-8000-000000002075'::uuid, '10000000-0000-4000-8000-000000002075'::uuid),
    ('20000000-0000-4000-8000-000000002076'::uuid, '10000000-0000-4000-8000-000000002076'::uuid),
    ('20000000-0000-4000-8000-000000002077'::uuid, '10000000-0000-4000-8000-000000002077'::uuid),
    ('20000000-0000-4000-8000-000000002078'::uuid, '10000000-0000-4000-8000-000000002078'::uuid),
    ('20000000-0000-4000-8000-000000002079'::uuid, '10000000-0000-4000-8000-000000002079'::uuid),
    ('20000000-0000-4000-8000-000000002080'::uuid, '10000000-0000-4000-8000-000000002080'::uuid),
    ('20000000-0000-4000-8000-000000002081'::uuid, '10000000-0000-4000-8000-000000002081'::uuid)
) as fixture(order_id, checkout_key);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
select
  order_record.id,
  'goods-payment-cancel-guard-good',
  1, 28000,
  '결제 취소 guard 상품', '테스트',
  'goods-payment-cancel-guard-ip'
from public.orders as order_record
where order_record.id between
  '20000000-0000-4000-8000-000000002071'::uuid
  and '20000000-0000-4000-8000-000000002081'::uuid;

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state,
  idempotency_key, provider_order_id, provider_product_code,
  claim_token, claim_expires_at, expires_at
)
select
  fixture.attempt_id,
  'korpay',
  '00000000-0000-4000-8000-000000002071',
  'order',
  fixture.order_id,
  31000,
  'KRW',
  fixture.state::public.payment_attempt_state,
  'goods-cancel-guard:' || fixture.order_id::text,
  'O' || pg_catalog.replace(fixture.attempt_id::text, '-', ''),
  'P' || pg_catalog.replace(fixture.attempt_id::text, '-', ''),
  case
    when fixture.state = 'confirming'
      then '40000000-0000-4000-8000-000000002072'::uuid
    else null
  end,
  case
    when fixture.state = 'confirming'
      then pg_catalog.now() + interval '10 minutes'
    else null
  end,
  pg_catalog.now() + interval '10 minutes'
from (
  values
    ('30000000-0000-4000-8000-000000002071'::uuid, '20000000-0000-4000-8000-000000002071'::uuid, 'prepared'),
    ('30000000-0000-4000-8000-000000002072'::uuid, '20000000-0000-4000-8000-000000002072'::uuid, 'confirming'),
    ('30000000-0000-4000-8000-000000002073'::uuid, '20000000-0000-4000-8000-000000002073'::uuid, 'unknown'),
    ('30000000-0000-4000-8000-000000002074'::uuid, '20000000-0000-4000-8000-000000002074'::uuid, 'needs_review'),
    ('30000000-0000-4000-8000-000000002075'::uuid, '20000000-0000-4000-8000-000000002075'::uuid, 'approved'),
    ('30000000-0000-4000-8000-000000002076'::uuid, '20000000-0000-4000-8000-000000002076'::uuid, 'declined'),
    ('30000000-0000-4000-8000-000000002077'::uuid, '20000000-0000-4000-8000-000000002077'::uuid, 'canceled'),
    ('30000000-0000-4000-8000-000000002078'::uuid, '20000000-0000-4000-8000-000000002078'::uuid, 'approved'),
    ('30000000-0000-4000-8000-000000002079'::uuid, '20000000-0000-4000-8000-000000002079'::uuid, 'prepared'),
    ('30000000-0000-4000-8000-000000002080'::uuid, '20000000-0000-4000-8000-000000002080'::uuid, 'prepared'),
    ('30000000-0000-4000-8000-000000002081'::uuid, '20000000-0000-4000-8000-000000002081'::uuid, 'confirming')
) as fixture(attempt_id, order_id, state);

update public.orders
set expires_at = pg_catalog.now() - interval '10 minutes'
where id in (
  '20000000-0000-4000-8000-000000002079',
  '20000000-0000-4000-8000-000000002080',
  '20000000-0000-4000-8000-000000002081'
);

update public.payment_attempts
set callback_nonce_digest = case id
  when '30000000-0000-4000-8000-000000002079'::uuid
    then pg_catalog.repeat('9', 64)
  when '30000000-0000-4000-8000-000000002080'::uuid
    then pg_catalog.repeat('a', 64)
  else pg_catalog.repeat('b', 64)
end
where id in (
  '30000000-0000-4000-8000-000000002079',
  '30000000-0000-4000-8000-000000002080',
  '30000000-0000-4000-8000-000000002081'
);

update public.payment_attempts
set expires_at = pg_catalog.now() - interval '10 minutes'
where id in (
  '30000000-0000-4000-8000-000000002079',
  '30000000-0000-4000-8000-000000002081'
);

insert into public.payments (
  id, user_id, purpose, ref_id, provider, amount, status,
  payment_key, idempotency_key, raw
)
values (
  '50000000-0000-4000-8000-000000002078',
  '00000000-0000-4000-8000-000000002071',
  'order',
  '20000000-0000-4000-8000-000000002078',
  'korpay',
  31000,
  'paid',
  'goods-cancel-guard-refunded-provider-key',
  'attempt:30000000-0000-4000-8000-000000002078',
  null
);

update public.payment_attempts
set payment_id = '50000000-0000-4000-8000-000000002078'
where id = '30000000-0000-4000-8000-000000002078';

do $deep_guard$
declare
  guard_rejected boolean := false;
begin
  begin
    perform public.finalize_order_cancellation_with_provider_evidence(
      '20000000-0000-4000-8000-000000002071',
      '직접 취소 우회',
      array[]::text[]
    );
  exception
    when check_violation then
      guard_rejected := sqlerrm = 'goods_payment_attempt_requires_reconciliation';
  end;

  if not guard_rejected then
    raise exception 'deep goods cancellation guard did not reject direct finalization';
  end if;
end;
$deep_guard$;

select 1 / case when (
  select stock_qty = 10
  from public.goods
  where id = 'goods-payment-cancel-guard-good'
) then 1 else 0 end as assert_direct_finalizer_did_not_restore_inventory;

do $request_unresolved_attempts$
declare
  target_order uuid;
  result text;
begin
  foreach target_order in array array[
    '20000000-0000-4000-8000-000000002071'::uuid,
    '20000000-0000-4000-8000-000000002072'::uuid,
    '20000000-0000-4000-8000-000000002073'::uuid,
    '20000000-0000-4000-8000-000000002074'::uuid,
    '20000000-0000-4000-8000-000000002075'::uuid
  ]
  loop
    result := public.request_order_cancellation(
      target_order,
      '00000000-0000-4000-8000-000000002071',
      '결제 상태 조회 후 취소',
      'change_of_mind'
    );

    if result is distinct from 'requested' then
      raise exception 'unresolved attempt was not preserved: order=%, result=%',
        target_order, result;
    end if;
  end loop;
end;
$request_unresolved_attempts$;

select 1 / case when (
  select pg_catalog.count(*) = 5
  from public.orders as order_record
  where order_record.id between
    '20000000-0000-4000-8000-000000002071'::uuid
    and '20000000-0000-4000-8000-000000002075'::uuid
    and order_record.status = 'pending'
) then 1 else 0 end as assert_unresolved_attempt_orders_remain_reserved;

select 1 / case when (
  select pg_catalog.count(*) = 5
  from public.order_cancellation_requests as request
  where request.order_id between
    '20000000-0000-4000-8000-000000002071'::uuid
    and '20000000-0000-4000-8000-000000002075'::uuid
    and request.status = 'requested'
) then 1 else 0 end as assert_unresolved_attempt_requests_are_durable;

do $request_terminal_attempts$
declare
  target_order uuid;
  result text;
begin
  foreach target_order in array array[
    '20000000-0000-4000-8000-000000002076'::uuid,
    '20000000-0000-4000-8000-000000002077'::uuid
  ]
  loop
    result := public.request_order_cancellation(
      target_order,
      '00000000-0000-4000-8000-000000002071',
      '결제 거절 또는 취소 후 주문 취소',
      'change_of_mind'
    );

    if result is distinct from 'completed' then
      raise exception 'terminal attempt did not complete cancellation: order=%, result=%',
        target_order, result;
    end if;
  end loop;
end;
$request_terminal_attempts$;

select 1 / case when (
  select pg_catalog.count(*) = 2
  from public.orders as order_record
  where order_record.id in (
    '20000000-0000-4000-8000-000000002076'::uuid,
    '20000000-0000-4000-8000-000000002077'::uuid
  )
    and order_record.status = 'canceled'
) then 1 else 0 end as assert_terminal_attempt_orders_cancel_normally;

select 1 / case when (
  select stock_qty = 12
  from public.goods
  where id = 'goods-payment-cancel-guard-good'
) then 1 else 0 end as assert_terminal_attempt_inventory_restores_once;

select public.finalize_order_cancellation_with_provider_evidence(
  '20000000-0000-4000-8000-000000002078',
  '검증된 provider 환불',
  array['goods-cancel-guard-refunded-provider-key']::text[]
);

select 1 / case when (
  select
    order_record.status = 'canceled'
    and payment.status = 'refunded'
    and attempt.state = 'approved'
    and good.stock_qty = 13
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.ref_id = order_record.id
   and attempt.purpose = 'order'
  join public.payments as payment
    on payment.id = attempt.payment_id
  join public.goods as good
    on good.id = 'goods-payment-cancel-guard-good'
  where order_record.id = '20000000-0000-4000-8000-000000002078'
) then 1 else 0 end as assert_approved_attempt_allows_verified_refund_finalization;

select 1 / case when public.expire_stale_checkouts() = 1
  then 1 else 0 end as assert_expired_prepared_attempt_is_swept;

select 1 / case when (
  select
    order_record.status = 'canceled'
    and attempt.state = 'canceled'
    and attempt.callback_nonce_digest = pg_catalog.repeat('9', 64)
    and good.stock_qty = 14
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.ref_id = order_record.id
   and attempt.purpose = 'order'
  join public.goods as good
    on good.id = 'goods-payment-cancel-guard-good'
  where order_record.id = '20000000-0000-4000-8000-000000002079'
) then 1 else 0 end as assert_expired_prepared_attempt_releases_inventory_once;

select 1 / case when public.expire_stale_checkouts() = 0
  then 1 else 0 end as assert_expiry_sweep_is_idempotent;

select 1 / case when (
  select
    order_record.status = 'pending'
    and attempt.state = 'prepared'
    and attempt.callback_nonce_digest = pg_catalog.repeat('a', 64)
    and attempt.expires_at > pg_catalog.clock_timestamp()
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.ref_id = order_record.id
   and attempt.purpose = 'order'
  where order_record.id = '20000000-0000-4000-8000-000000002080'
) then 1 else 0 end as assert_fresh_prepared_action_ttl_remains_reserved;

select 1 / case when (
  select
    order_record.status = 'pending'
    and attempt.state = 'confirming'
    and attempt.callback_nonce_digest = pg_catalog.repeat('b', 64)
    and attempt.claim_token is not null
    and attempt.expires_at <= pg_catalog.clock_timestamp()
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.ref_id = order_record.id
   and attempt.purpose = 'order'
  where order_record.id = '20000000-0000-4000-8000-000000002081'
) then 1 else 0 end as assert_confirming_attempt_remains_reserved_after_ttl;

select 1 / case when (
  select stock_qty = 14
  from public.goods
  where id = 'goods-payment-cancel-guard-good'
) then 1 else 0 end as assert_fresh_and_confirming_attempts_do_not_restore_inventory;

rollback;
