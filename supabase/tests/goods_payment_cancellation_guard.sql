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

select 1 / case when
  not has_function_privilege(
    'anon',
    'public.reconcile_expired_prepared_goods_cancellation(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reconcile_expired_prepared_goods_cancellation(uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.reconcile_expired_prepared_goods_cancellation(uuid,uuid)',
    'execute'
  )
then 1 else 0 end as assert_prepared_recovery_is_service_only;

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

update public.profiles
set role = 'admin'
where id = '00000000-0000-4000-8000-000000002071'::uuid;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-4000-8000-000000002072',
  'authenticated', 'authenticated',
  'goods-payment-cancel-mismatch@example.test', pg_catalog.now(),
  '{}', '{}', pg_catalog.now(), pg_catalog.now()
)
on conflict (id) do nothing;

insert into public.profiles (
  id, email, nickname, birth_date, consents, onboarded_at
)
values (
  '00000000-0000-4000-8000-000000002072',
  'goods-payment-cancel-mismatch@example.test',
  'goods_payment_cancel_mismatch', '2000-01-01',
  '{"terms":true,"privacy":true}'::jsonb, pg_catalog.now()
)
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at;

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
  '문구', 28000, 'ok', 10
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
    ('20000000-0000-4000-8000-000000002081'::uuid, '10000000-0000-4000-8000-000000002081'::uuid),
    ('20000000-0000-4000-8000-000000002082'::uuid, '10000000-0000-4000-8000-000000002082'::uuid),
    ('20000000-0000-4000-8000-000000002083'::uuid, '10000000-0000-4000-8000-000000002083'::uuid),
    ('20000000-0000-4000-8000-000000002084'::uuid, '10000000-0000-4000-8000-000000002084'::uuid)
) as fixture(order_id, checkout_key);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
select
  order_record.id,
  'goods-payment-cancel-guard-good',
  1, 28000,
  '결제 취소 guard 상품', '문구',
  'goods-payment-cancel-guard-ip'
from public.orders as order_record
where order_record.id between
  '20000000-0000-4000-8000-000000002071'::uuid
  and '20000000-0000-4000-8000-000000002084'::uuid;

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
    ('30000000-0000-4000-8000-000000002081'::uuid, '20000000-0000-4000-8000-000000002081'::uuid, 'confirming'),
    ('30000000-0000-4000-8000-000000002082'::uuid, '20000000-0000-4000-8000-000000002082'::uuid, 'prepared')
) as fixture(attempt_id, order_id, state);

update public.orders
set expires_at = pg_catalog.now() - interval '10 minutes'
where id in (
  '20000000-0000-4000-8000-000000002071',
  '20000000-0000-4000-8000-000000002072',
  '20000000-0000-4000-8000-000000002073',
  '20000000-0000-4000-8000-000000002074',
  '20000000-0000-4000-8000-000000002075',
  '20000000-0000-4000-8000-000000002079',
  '20000000-0000-4000-8000-000000002080',
  '20000000-0000-4000-8000-000000002081',
  '20000000-0000-4000-8000-000000002082',
  '20000000-0000-4000-8000-000000002083',
  '20000000-0000-4000-8000-000000002084'
);

update public.payment_attempts
set callback_nonce_digest = case id
  when '30000000-0000-4000-8000-000000002079'::uuid
    then pg_catalog.repeat('9', 64)
  when '30000000-0000-4000-8000-000000002080'::uuid
    then pg_catalog.repeat('a', 64)
  when '30000000-0000-4000-8000-000000002081'::uuid
    then pg_catalog.repeat('b', 64)
  else pg_catalog.repeat('c', 64)
end
where id in (
  '30000000-0000-4000-8000-000000002079',
  '30000000-0000-4000-8000-000000002080',
  '30000000-0000-4000-8000-000000002081',
  '30000000-0000-4000-8000-000000002082'
);

update public.payment_attempts
set expires_at = pg_catalog.now() - interval '10 minutes'
where id in (
  '30000000-0000-4000-8000-000000002079',
  '30000000-0000-4000-8000-000000002081',
  '30000000-0000-4000-8000-000000002082'
);

insert into public.payments (
  id, user_id, purpose, ref_id, provider, amount, status,
  payment_key, idempotency_key, raw
)
values
  (
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
  ),
  (
    '50000000-0000-4000-8000-000000002084',
    '00000000-0000-4000-8000-000000002071',
    'order',
    '20000000-0000-4000-8000-000000002084',
    'toss',
    31000,
    'failed',
    'goods-cancel-guard-legacy-failed-key',
    'legacy-failed:20000000-0000-4000-8000-000000002084',
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

-- Model the exact stale-context race: loadContext saw processing, another
-- legacy path completed the request, and there is no Korpay attempt for the
-- dedicated preflight to classify when the waiting call acquires its locks.
delete from public.payment_attempts
where id = '30000000-0000-4000-8000-000000002076'::uuid;

select 1 / case when not exists (
  select 1
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = '20000000-0000-4000-8000-000000002076'::uuid
) then 1 else 0 end as assert_completed_legacy_race_has_no_korpay_attempt;

select 1 / case when public.reconcile_expired_prepared_goods_cancellation(
  (
    select request.id
    from public.order_cancellation_requests as request
    where request.order_id = '20000000-0000-4000-8000-000000002076'::uuid
  ),
  '00000000-0000-4000-8000-000000002071'
) = 'completed' then 1 else 0 end
as assert_completed_legacy_reconcile_race_converges_terminal;

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

-- Historical/admin-created requests can exist without a provider-neutral
-- attempt. The expiry worker must not infer provider safety from that absence.
insert into public.order_cancellation_requests (
  id,
  order_id,
  requested_by,
  reason,
  reason_type,
  status
)
values (
  '60000000-0000-4000-8000-000000002083',
  '20000000-0000-4000-8000-000000002083',
  '00000000-0000-4000-8000-000000002071',
  'provider attempt가 없는 기존 요청 보존',
  'change_of_mind',
  'requested'
);

do $request_expiry_candidates$
declare
  target_order uuid;
  result text;
begin
  foreach target_order in array array[
    '20000000-0000-4000-8000-000000002080'::uuid,
    '20000000-0000-4000-8000-000000002081'::uuid,
    '20000000-0000-4000-8000-000000002082'::uuid,
    '20000000-0000-4000-8000-000000002084'::uuid
  ]
  loop
    result := public.request_order_cancellation(
      target_order,
      '00000000-0000-4000-8000-000000002071',
      '결제 attempt 상태 확인 후 취소',
      'change_of_mind'
    );

    if result is distinct from 'requested' then
      raise exception 'expiry candidate request was not durable: order=%, result=%',
        target_order, result;
    end if;
  end loop;
end;
$request_expiry_candidates$;

select 1 / case when public.expire_stale_checkouts() = 2
  then 1 else 0 end as assert_expired_prepared_attempt_is_swept;

select 1 / case when (
  select
    order_record.status = 'canceled'
    and attempt.state = 'canceled'
    and attempt.callback_nonce_digest = pg_catalog.repeat('9', 64)
    and good.stock_qty = 15
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.ref_id = order_record.id
   and attempt.purpose = 'order'
  join public.goods as good
    on good.id = 'goods-payment-cancel-guard-good'
  where order_record.id = '20000000-0000-4000-8000-000000002079'
) then 1 else 0 end as assert_expired_prepared_attempt_releases_inventory_once;

select 1 / case when (
  select
    order_record.status = 'canceled'
    and attempt.state = 'canceled'
    and attempt.callback_nonce_digest = pg_catalog.repeat('c', 64)
    and request.status = 'completed'
    and request.completed_at is not null
    and good.stock_qty = 15
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.ref_id = order_record.id
   and attempt.purpose = 'order'
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  join public.goods as good
    on good.id = 'goods-payment-cancel-guard-good'
  where order_record.id = '20000000-0000-4000-8000-000000002082'
) then 1 else 0 end as assert_expired_prepared_request_completes_and_restores_once;

select 1 / case when (
  select pg_catalog.count(*) = 5
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.purpose = 'order'
   and attempt.ref_id = order_record.id
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  where order_record.id between
      '20000000-0000-4000-8000-000000002071'::uuid
      and '20000000-0000-4000-8000-000000002075'::uuid
    and order_record.status = 'pending'
    and request.status = 'requested'
    and attempt.state in (
      'prepared', 'confirming', 'unknown', 'needs_review', 'approved'
    )
) then 1 else 0 end as assert_unresolved_attempts_survive_order_expiry;

select 1 / case when (
  select
    order_record.status = 'pending'
    and request.status = 'requested'
  from public.orders as order_record
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  where order_record.id = '20000000-0000-4000-8000-000000002083'
) then 1 else 0 end as assert_no_attempt_request_is_not_inferred_safe;

select 1 / case when (
  select
    order_record.status = 'pending'
    and request.status = 'requested'
    and payment.provider = 'toss'
    and payment.status = 'failed'
  from public.orders as order_record
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  join public.payments as payment
    on payment.purpose = 'order'
   and payment.ref_id = order_record.id
  where order_record.id = '20000000-0000-4000-8000-000000002084'
) then 1 else 0 end as assert_failed_legacy_ledger_request_is_not_inferred_safe;

select 1 / case when public.expire_stale_checkouts() = 0
  then 1 else 0 end as assert_expiry_sweep_is_idempotent;

select 1 / case when (
  select
    order_record.status = 'pending'
    and attempt.state = 'prepared'
    and attempt.callback_nonce_digest = pg_catalog.repeat('a', 64)
    and attempt.expires_at > pg_catalog.clock_timestamp()
    and request.status = 'requested'
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.ref_id = order_record.id
   and attempt.purpose = 'order'
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  where order_record.id = '20000000-0000-4000-8000-000000002080'
) then 1 else 0 end as assert_fresh_prepared_action_ttl_remains_reserved;

select 1 / case when (
  select
    order_record.status = 'pending'
    and attempt.state = 'confirming'
    and attempt.callback_nonce_digest = pg_catalog.repeat('b', 64)
    and attempt.claim_token is not null
    and attempt.expires_at <= pg_catalog.clock_timestamp()
    and request.status = 'requested'
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.ref_id = order_record.id
   and attempt.purpose = 'order'
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  where order_record.id = '20000000-0000-4000-8000-000000002081'
) then 1 else 0 end as assert_confirming_attempt_remains_reserved_after_ttl;

select 1 / case when (
  select stock_qty = 15
  from public.goods
  where id = 'goods-payment-cancel-guard-good'
) then 1 else 0 end as assert_fresh_and_confirming_attempts_do_not_restore_inventory;

-- A processing/needs_review request is intentionally excluded from the global
-- expiry sweep. The dedicated staff orchestration must wait for the exact
-- attempt TTL and then close this no-capture path atomically.
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values (
  'goods-prepared-reconcile-good',
  'goods-payment-cancel-guard-ip',
  'prepared 만료 취소 정합화 상품',
  '문구', 28000, 'ok', 20
);

insert into public.orders (
  id, user_id, status, total, shipping_fee, expires_at, checkout_key
)
values
  (
    '20000000-0000-4000-8000-000000002085',
    '00000000-0000-4000-8000-000000002071',
    'pending', 31000, 3000, pg_catalog.now() + interval '15 minutes',
    '10000000-0000-4000-8000-000000002085'
  ),
  (
    '20000000-0000-4000-8000-000000002086',
    '00000000-0000-4000-8000-000000002071',
    'pending', 31000, 3000, pg_catalog.now() - interval '15 minutes',
    '10000000-0000-4000-8000-000000002086'
  ),
  (
    '20000000-0000-4000-8000-000000002087',
    '00000000-0000-4000-8000-000000002071',
    'pending', 31000, 3000, pg_catalog.now() - interval '15 minutes',
    '10000000-0000-4000-8000-000000002087'
  ),
  (
    '20000000-0000-4000-8000-000000002088',
    '00000000-0000-4000-8000-000000002071',
    'pending', 31000, 3000, pg_catalog.now() - interval '15 minutes',
    '10000000-0000-4000-8000-000000002088'
  );

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
select
  order_record.id,
  'goods-prepared-reconcile-good',
  1,
  28000,
  'prepared 만료 취소 정합화 상품',
  '문구',
  'goods-payment-cancel-guard-ip'
from public.orders as order_record
where order_record.id between
  '20000000-0000-4000-8000-000000002085'::uuid
  and '20000000-0000-4000-8000-000000002088'::uuid;

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state,
  idempotency_key, provider_order_id, provider_product_code, expires_at,
  claim_token, claim_expires_at
)
values
  (
    '30000000-0000-4000-8000-000000002085', 'korpay',
    '00000000-0000-4000-8000-000000002071', 'order',
    '20000000-0000-4000-8000-000000002085', 31000, 'KRW', 'prepared',
    'prepared-reconcile:2085', 'O-PREPARED-RECONCILE-2085',
    'P-PREPARED-RECONCILE-2085', pg_catalog.now() + interval '5 minutes',
    null, null
  ),
  (
    '30000000-0000-4000-8000-000000002086', 'korpay',
    '00000000-0000-4000-8000-000000002071', 'order',
    '20000000-0000-4000-8000-000000002086', 31000, 'KRW', 'prepared',
    'prepared-reconcile:2086', 'O-PREPARED-RECONCILE-2086',
    'P-PREPARED-RECONCILE-2086', pg_catalog.now() - interval '5 minutes',
    null, null
  ),
  (
    '30000000-0000-4000-8000-000000002087', 'korpay',
    '00000000-0000-4000-8000-000000002071', 'order',
    '20000000-0000-4000-8000-000000002087', 31000, 'KRW', 'declined',
    'prepared-reconcile:2087', 'O-PREPARED-RECONCILE-2087',
    'P-PREPARED-RECONCILE-2087', pg_catalog.now() - interval '5 minutes',
    null, null
  ),
  (
    '30000000-0000-4000-8000-000000002088', 'korpay',
    '00000000-0000-4000-8000-000000002071', 'order',
    '20000000-0000-4000-8000-000000002088', 31000, 'KRW', 'confirming',
    'prepared-reconcile:2088', 'O-PREPARED-RECONCILE-2088',
    'P-PREPARED-RECONCILE-2088', pg_catalog.now() - interval '5 minutes',
    '40000000-0000-4000-8000-000000002088',
    pg_catalog.now() + interval '5 minutes'
  );

insert into public.order_cancellation_requests (
  id, order_id, requested_by, reason, reason_type, status,
  decided_by, decided_at, provider_started_at
)
select
  ('60000000-0000-4000-8000-' || pg_catalog.right(order_record.id::text, 12))::uuid,
  order_record.id,
  order_record.user_id,
  'prepared 결제 세션 만료 후 취소',
  'change_of_mind',
  case when order_record.id = '20000000-0000-4000-8000-000000002086'::uuid
    then 'needs_review' else 'processing' end,
  '00000000-0000-4000-8000-000000002071',
  pg_catalog.now(),
  pg_catalog.now()
from public.orders as order_record
where order_record.id between
  '20000000-0000-4000-8000-000000002085'::uuid
  and '20000000-0000-4000-8000-000000002088'::uuid;

insert into public.order_cancellation_claims (
  order_id, requested_by, previous_status
)
select order_record.id, order_record.user_id, 'pending'
from public.orders as order_record
where order_record.id between
  '20000000-0000-4000-8000-000000002085'::uuid
  and '20000000-0000-4000-8000-000000002088'::uuid;

do $prepared_recovery_rejects_user_actor$
begin
  begin
    perform public.reconcile_expired_prepared_goods_cancellation(
      '60000000-0000-4000-8000-000000002085',
      '00000000-0000-4000-8000-000000002072'
    );
    raise exception 'ordinary user actor was accepted';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'staff required' then
        raise;
      end if;
  end;
end;
$prepared_recovery_rejects_user_actor$;

update public.profiles
set role = 'staff'
where id = '00000000-0000-4000-8000-000000002072'::uuid;

select 1 / case when public.reconcile_expired_prepared_goods_cancellation(
  '60000000-0000-4000-8000-000000002085',
  '00000000-0000-4000-8000-000000002072'
) = 'in_progress' then 1 else 0 end as assert_staff_actor_can_check_prepared_expiry;

select 1 / case when public.reconcile_expired_prepared_goods_cancellation(
  '60000000-0000-4000-8000-000000002085',
  '00000000-0000-4000-8000-000000002071'
) = 'in_progress' then 1 else 0 end as assert_fresh_prepared_recovery_waits;

select 1 / case when (
  select
    order_record.status = 'pending'
    and attempt.state = 'prepared'
    and request.status = 'processing'
    and good.stock_qty = 20
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.purpose = 'order' and attempt.ref_id = order_record.id
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  join public.goods as good on good.id = 'goods-prepared-reconcile-good'
  where order_record.id = '20000000-0000-4000-8000-000000002085'
) then 1 else 0 end as assert_fresh_prepared_recovery_preserves_state;

select 1 / case when public.reconcile_expired_prepared_goods_cancellation(
  '60000000-0000-4000-8000-000000002087',
  '00000000-0000-4000-8000-000000002071'
) = 'not_applicable' then 1 else 0 end as assert_declined_attempt_uses_legacy_reconcile;

select 1 / case when public.reconcile_expired_prepared_goods_cancellation(
  '60000000-0000-4000-8000-000000002088',
  '00000000-0000-4000-8000-000000002071'
) = 'in_progress' then 1 else 0 end as assert_callback_owned_attempt_stays_in_progress;

update public.payment_attempts
set user_id = '00000000-0000-4000-8000-000000002072'
where id = '30000000-0000-4000-8000-000000002086';

do $prepared_owner_mismatch$
begin
  begin
    perform public.reconcile_expired_prepared_goods_cancellation(
      '60000000-0000-4000-8000-000000002086',
      '00000000-0000-4000-8000-000000002071'
    );
    raise exception 'prepared owner mismatch was accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'prepared_goods_cancellation_order_attempt_mismatch' then
        raise;
      end if;
  end;
end;
$prepared_owner_mismatch$;

update public.payment_attempts
set user_id = '00000000-0000-4000-8000-000000002071'
where id = '30000000-0000-4000-8000-000000002086';

update public.payment_attempts
set amount = 30000
where id = '30000000-0000-4000-8000-000000002086';

do $prepared_amount_mismatch$
begin
  begin
    perform public.reconcile_expired_prepared_goods_cancellation(
      '60000000-0000-4000-8000-000000002086',
      '00000000-0000-4000-8000-000000002071'
    );
    raise exception 'prepared amount mismatch was accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'prepared_goods_cancellation_order_attempt_mismatch' then
        raise;
      end if;
  end;
end;
$prepared_amount_mismatch$;

update public.payment_attempts
set amount = 31000, currency = 'USD'
where id = '30000000-0000-4000-8000-000000002086';

do $prepared_currency_mismatch$
begin
  begin
    perform public.reconcile_expired_prepared_goods_cancellation(
      '60000000-0000-4000-8000-000000002086',
      '00000000-0000-4000-8000-000000002071'
    );
    raise exception 'prepared currency mismatch was accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'prepared_goods_cancellation_order_attempt_mismatch' then
        raise;
      end if;
  end;
end;
$prepared_currency_mismatch$;

update public.payment_attempts
set currency = 'KRW'
where id = '30000000-0000-4000-8000-000000002086';

update public.order_items
set unit_price = 27000
where order_id = '20000000-0000-4000-8000-000000002086';

do $prepared_snapshot_mismatch$
begin
  begin
    perform public.reconcile_expired_prepared_goods_cancellation(
      '60000000-0000-4000-8000-000000002086',
      '00000000-0000-4000-8000-000000002071'
    );
    raise exception 'prepared snapshot mismatch was accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'prepared_goods_cancellation_order_attempt_mismatch' then
        raise;
      end if;
  end;
end;
$prepared_snapshot_mismatch$;

update public.order_items
set unit_price = 28000
where order_id = '20000000-0000-4000-8000-000000002086';

insert into public.payments (
  user_id, purpose, ref_id, provider, amount, status,
  idempotency_key, raw
)
values (
  '00000000-0000-4000-8000-000000002071', 'order',
  '20000000-0000-4000-8000-000000002086', 'korpay', 31000,
  'pending', 'prepared-reconcile-payment:2086', null
);

do $prepared_nonfailed_payment$
begin
  begin
    perform public.reconcile_expired_prepared_goods_cancellation(
      '60000000-0000-4000-8000-000000002086',
      '00000000-0000-4000-8000-000000002071'
    );
    raise exception 'prepared nonfailed payment was accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'prepared_goods_cancellation_payment_evidence_invalid' then
        raise;
      end if;
  end;
end;
$prepared_nonfailed_payment$;

delete from public.payments
where idempotency_key = 'prepared-reconcile-payment:2086';

select 1 / case when public.reconcile_expired_prepared_goods_cancellation(
  '60000000-0000-4000-8000-000000002086',
  '00000000-0000-4000-8000-000000002071'
) = 'completed' then 1 else 0 end as assert_expired_prepared_recovery_completes;

select 1 / case when (
  select
    order_record.status = 'canceled'
    and attempt.state = 'canceled'
    and request.status = 'completed'
    and request.completed_at is not null
    and good.stock_qty = 21
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.purpose = 'order' and attempt.ref_id = order_record.id
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  join public.goods as good on good.id = 'goods-prepared-reconcile-good'
  where order_record.id = '20000000-0000-4000-8000-000000002086'
) then 1 else 0 end as assert_expired_prepared_recovery_finalizes_stock_once;

select 1 / case when (
  select pg_catalog.count(*) = 0
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = '20000000-0000-4000-8000-000000002086'
) and (
  select pg_catalog.count(*) = 0
  from public.refunds as refund
  join public.payments as payment on payment.id = refund.payment_id
  where payment.purpose = 'order'
    and payment.ref_id = '20000000-0000-4000-8000-000000002086'
) then 1 else 0 end as assert_expired_prepared_recovery_synthesizes_no_ledger;

select 1 / case when public.reconcile_expired_prepared_goods_cancellation(
  '60000000-0000-4000-8000-000000002086',
  '00000000-0000-4000-8000-000000002071'
) = 'completed' then 1 else 0 end as assert_expired_prepared_recovery_replays_terminal;

select 1 / case when (
  select pg_catalog.count(*) = 1
    and bool_and(diff = pg_catalog.jsonb_build_object(
      'attemptId', '30000000-0000-4000-8000-000000002086'::uuid,
      'requestId', '60000000-0000-4000-8000-000000002086'::uuid,
      'outcome', 'expired_no_capture'
    ))
  from public.audit_log
  where action = 'admin.order.prepared_goods_cancellation_completed'
    and target = 'order:20000000-0000-4000-8000-000000002086'
) and (
  select stock_qty = 21
  from public.goods
  where id = 'goods-prepared-reconcile-good'
) then 1 else 0 end as assert_expired_prepared_recovery_audits_and_restores_once;

rollback;
