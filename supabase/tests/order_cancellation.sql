\set ON_ERROR_STOP on

begin;

-- Only trusted server paths may close a local order after provider cancellation.
select 1 / case when (
  not has_function_privilege(
    'anon',
    'public.cancel_order_with_provider_evidence(uuid,text,text[])',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.cancel_order_with_provider_evidence(uuid,text,text[])',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.cancel_order_with_provider_evidence(uuid,text,text[])',
    'execute'
  )
) then 1 else 0 end as assert_provider_evidence_rpc_is_service_only;

select 1 / case when (
  not has_function_privilege('anon', 'public.cancel_order(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.cancel_order(uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.cancel_order(uuid,text)', 'execute')
) then 1 else 0 end as assert_compatibility_rpc_remains_service_only;

select 1 / case when (
  to_regprocedure('public.claim_order_cancellation(uuid,uuid)') is null
  and not has_function_privilege('anon', 'public.request_order_cancellation(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.request_order_cancellation(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.request_order_cancellation(uuid,uuid,text)', 'execute')
) then 1 else 0 end as assert_durable_request_replaces_legacy_claim_rpc;

select 1 / case when (
  not has_table_privilege('anon', 'public.order_cancellation_claims', 'select')
  and not has_table_privilege('authenticated', 'public.order_cancellation_claims', 'select')
  and has_table_privilege('service_role', 'public.order_cancellation_claims', 'select')
  and not has_table_privilege('service_role', 'public.order_cancellation_claims', 'insert')
  and not has_table_privilege('service_role', 'public.order_cancellation_claims', 'update')
  and not has_table_privilege('service_role', 'public.order_cancellation_claims', 'delete')
) then 1 else 0 end as assert_cancellation_claim_table_is_server_read_only;

-- 승인과 취소는 주문 → 결제 순서로 잠가 동시 실행 교착을 피한다.
with definition as (
  select pg_get_functiondef(
    'public.confirm_order_payment(text,uuid,text,bigint,jsonb)'::regprocedure
  ) as body
)
select 1 / case when (
  strpos(body, 'from public.orders') > 0
  and strpos(body, 'from public.payments') > 0
  and strpos(body, 'from public.orders') < strpos(body, 'from public.payments')
) then 1 else 0 end as assert_confirm_locks_order_before_payment
from definition;

-- Refund summaries use row ownership plus explicit safe-column grants.
select 1 / case when (
  not has_table_privilege('anon', 'public.refunds', 'select')
  and not has_any_column_privilege('anon', 'public.refunds', 'select')
  and not has_table_privilege('authenticated', 'public.refunds', 'select')
) then 1 else 0 end as assert_refunds_have_no_client_table_grant;

select 1 / case when (
  has_column_privilege('authenticated', 'public.refunds', 'id', 'select')
  and has_column_privilege('authenticated', 'public.refunds', 'payment_id', 'select')
  and has_column_privilege('authenticated', 'public.refunds', 'amount', 'select')
  and has_column_privilege('authenticated', 'public.refunds', 'status', 'select')
  and has_column_privilege('authenticated', 'public.refunds', 'created_at', 'select')
  and not has_column_privilege('authenticated', 'public.refunds', 'reason', 'select')
) then 1 else 0 end as assert_authenticated_can_read_only_safe_refund_columns;

select 1 / case when (
  not has_table_privilege('authenticated', 'public.refunds', 'insert')
  and not has_table_privilege('authenticated', 'public.refunds', 'update')
  and not has_table_privilege('authenticated', 'public.refunds', 'delete')
  and has_table_privilege('service_role', 'public.refunds', 'select')
  and has_table_privilege('service_role', 'public.refunds', 'insert')
  and has_table_privilege('service_role', 'public.refunds', 'update')
  and has_table_privilege('service_role', 'public.refunds', 'delete')
) then 1 else 0 end as assert_refund_writes_remain_service_only;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000701',
    'authenticated', 'authenticated', 'order-cancel-one@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000702',
    'authenticated', 'authenticated', 'order-cancel-two@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000703',
    'authenticated', 'authenticated', 'order-cancel-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000701',
    'order-cancel-one@example.test', 'order_cancel_one', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000702',
    'order-cancel-two@example.test', 'order_cancel_two', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000703',
    'order-cancel-staff@example.test', 'order_cancel_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('order-cancel-ip', '주문 취소 IP', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('order-cancel-no-payment', 'order-cancel-ip', '무결제 취소 굿즈', '테스트', 10000, 'ok', 9),
  ('order-cancel-active', 'order-cancel-ip', '활성 결제 취소 굿즈', '테스트', 10000, 'ok', 9),
  ('order-cancel-no-evidence', 'order-cancel-ip', '결제 증거 누락 굿즈', '테스트', 10000, 'ok', 9),
  ('order-cancel-shipping', 'order-cancel-ip', '배송 중 굿즈', '테스트', 10000, 'ok', 9),
  ('order-cancel-done', 'order-cancel-ip', '배송 완료 굿즈', '테스트', 10000, 'ok', 9),
  ('order-cancel-terminal', 'order-cancel-ip', '종결 결제 취소 굿즈', '테스트', 10000, 'ok', 9),
  ('order-cancel-reward', 'order-cancel-ip', '리워드 취소 굿즈', '테스트', 10000, 'ok', 9),
  ('order-cancel-failed-evidence', 'order-cancel-ip', '실패 장부 취소 굿즈', '테스트', 10000, 'ok', 9),
  ('order-cancel-claim', 'order-cancel-ip', '취소 claim 굿즈', '테스트', 10000, 'ok', 9);

insert into public.orders (id, user_id, status, total, address, expires_at)
values
  (
    '40000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000000701', 'pending', 10000, '{}'::jsonb,
    now() + interval '15 minutes'
  ),
  (
    '40000000-0000-4000-8000-000000000702',
    '00000000-0000-4000-8000-000000000701', 'pending', 10000, '{}'::jsonb,
    now() + interval '15 minutes'
  ),
  (
    '40000000-0000-4000-8000-000000000703',
    '00000000-0000-4000-8000-000000000701', 'paid', 10000, '{}'::jsonb, null
  ),
  (
    '40000000-0000-4000-8000-000000000704',
    '00000000-0000-4000-8000-000000000701', 'shipping', 10000, '{}'::jsonb, null
  ),
  (
    '40000000-0000-4000-8000-000000000705',
    '00000000-0000-4000-8000-000000000701', 'done', 10000, '{}'::jsonb, null
  ),
  (
    '40000000-0000-4000-8000-000000000706',
    '00000000-0000-4000-8000-000000000701', 'paid', 10000, '{}'::jsonb, null
  ),
  (
    '40000000-0000-4000-8000-000000000707',
    '00000000-0000-4000-8000-000000000701', 'paid', 10000, '{}'::jsonb, null
  ),
  (
    '40000000-0000-4000-8000-000000000708',
    '00000000-0000-4000-8000-000000000701', 'paid', 10000, '{}'::jsonb, null
  ),
  (
    '40000000-0000-4000-8000-000000000709',
    '00000000-0000-4000-8000-000000000701', 'paid', 10000, '{}'::jsonb, null
  );

insert into public.order_items (
  order_id,
  good_id,
  qty,
  unit_price,
  good_name_snapshot,
  good_type_snapshot,
  good_ip_id_snapshot
)
values
  ('40000000-0000-4000-8000-000000000701', 'order-cancel-no-payment', 1, 10000, '무결제 취소 굿즈', '테스트', 'order-cancel-ip'),
  ('40000000-0000-4000-8000-000000000702', 'order-cancel-active', 1, 10000, '활성 결제 취소 굿즈', '테스트', 'order-cancel-ip'),
  ('40000000-0000-4000-8000-000000000703', 'order-cancel-no-evidence', 1, 10000, '결제 증거 누락 굿즈', '테스트', 'order-cancel-ip'),
  ('40000000-0000-4000-8000-000000000704', 'order-cancel-shipping', 1, 10000, '배송 중 굿즈', '테스트', 'order-cancel-ip'),
  ('40000000-0000-4000-8000-000000000705', 'order-cancel-done', 1, 10000, '배송 완료 굿즈', '테스트', 'order-cancel-ip'),
  ('40000000-0000-4000-8000-000000000706', 'order-cancel-terminal', 1, 10000, '종결 결제 취소 굿즈', '테스트', 'order-cancel-ip'),
  ('40000000-0000-4000-8000-000000000707', 'order-cancel-reward', 1, 10000, '리워드 취소 굿즈', '테스트', 'order-cancel-ip'),
  ('40000000-0000-4000-8000-000000000708', 'order-cancel-failed-evidence', 1, 10000, '실패 장부 취소 굿즈', '테스트', 'order-cancel-ip'),
  ('40000000-0000-4000-8000-000000000709', 'order-cancel-claim', 1, 10000, '취소 claim 굿즈', '테스트', 'order-cancel-ip');

insert into public.payments (
  id, user_id, purpose, ref_id, amount, status,
  payment_key, idempotency_key, raw
)
values
  (
    '50000000-0000-4000-8000-000000000702',
    '00000000-0000-4000-8000-000000000701', 'order',
    '40000000-0000-4000-8000-000000000702', 10000, 'pending',
    'provider-key-active', 'provider-key-active', '{"secret":"active"}'::jsonb
  ),
  (
    '50000000-0000-4000-8000-000000000712',
    '00000000-0000-4000-8000-000000000701', 'order',
    '40000000-0000-4000-8000-000000000702', 10000, 'pending',
    'provider-key-active-retry', 'provider-key-active-retry', '{"secret":"active-retry"}'::jsonb
  ),
  (
    '50000000-0000-4000-8000-000000000706',
    '00000000-0000-4000-8000-000000000701', 'order',
    '40000000-0000-4000-8000-000000000706', 10000, 'canceled',
    'provider-key-terminal', 'provider-key-terminal', '{"secret":"terminal"}'::jsonb
  ),
  (
    '50000000-0000-4000-8000-000000000707',
    '00000000-0000-4000-8000-000000000701', 'order',
    '40000000-0000-4000-8000-000000000707', 10000, 'paid',
    'provider-key-reward', 'provider-key-reward', '{"secret":"reward"}'::jsonb
  ),
  (
    '50000000-0000-4000-8000-000000000708',
    '00000000-0000-4000-8000-000000000701', 'order',
    '40000000-0000-4000-8000-000000000708', 10000, 'failed',
    'provider-key-failed', 'provider-key-failed', '{"secret":"failed"}'::jsonb
  ),
  (
    '50000000-0000-4000-8000-000000000709',
    '00000000-0000-4000-8000-000000000701', 'order',
    '40000000-0000-4000-8000-000000000709', 10000, 'paid',
    'provider-key-claim', 'provider-key-claim', '{"secret":"claim"}'::jsonb
  );

insert into public.card_pools (id, ip_id, name, active_from)
values (
  '20000000-0000-4000-8000-000000000701',
  'order-cancel-ip',
  '주문 취소 카드풀',
  now() - interval '1 day'
);

insert into public.draw_tickets (
  id, user_id, pool_id, source, source_id, ordinal, consumed_at
)
values
  (
    '60000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000000701',
    '20000000-0000-4000-8000-000000000701',
    'order_paid', '40000000-0000-4000-8000-000000000707', 1, now()
  ),
  (
    '60000000-0000-4000-8000-000000000702',
    '00000000-0000-4000-8000-000000000701',
    '20000000-0000-4000-8000-000000000701',
    'order_paid', '40000000-0000-4000-8000-000000000707', 2, null
  );

insert into public.card_grants (
  user_id, pool_id, source, source_id, granted_cards, idempotency_key
)
values (
  '00000000-0000-4000-8000-000000000701',
  '20000000-0000-4000-8000-000000000701',
  'draw_ticket',
  '60000000-0000-4000-8000-000000000701',
  '[{"cardId":"historical-card","rarity":"common","isNew":true}]'::jsonb,
  'draw_ticket:60000000-0000-4000-8000-000000000701'
);

-- 사용자 요청은 소유권을 다시 확인하고 provider 호출 전 durable하게 배송을 봉인한다.
set local role service_role;

select 1 / case when public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000709',
  '00000000-0000-4000-8000-000000000702',
  '다른 사용자 취소 요청'
) = 'not_found' then 1 else 0 end as assert_other_user_cannot_request_order_cancellation;

select 1 / case when public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000709',
  '00000000-0000-4000-8000-000000000701',
  '사용자 청약철회 요청'
) = 'requested' then 1 else 0 end as assert_owner_requests_paid_order_cancellation;

-- 같은 요청 재시도는 기존 durable 요청을 그대로 반환한다.
select 1 / case when public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000709',
  '00000000-0000-4000-8000-000000000701',
  '사용자 청약철회 요청'
) = 'already_requested' then 1 else 0 end as assert_cancellation_request_is_idempotent;

reset role;

select 1 / case when (
  select count(*) = 1 and bool_and(status = 'requested')
  from public.order_cancellation_requests
  where order_id = '40000000-0000-4000-8000-000000000709'
) then 1 else 0 end as assert_cancellation_request_is_durable;

do $$
begin
  begin
    update public.orders
    set status = 'shipping'
    where id = '40000000-0000-4000-8000-000000000709';
    raise exception 'requested order should not enter shipping';
  exception
    when check_violation then
      if sqlerrm <> 'order cancellation in progress' then raise; end if;
  end;
end;
$$;

reset role;

select 1 / case when (
  select status = 'paid'
  from public.orders
  where id = '40000000-0000-4000-8000-000000000709'
) then 1 else 0 end as assert_request_blocks_fulfillment_transition;

-- staff 승인 시에만 provider 호출용 claim과 환불 intent가 생성된다.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000703', true);

select public.admin_decide_order_cancellation(
  (select id from public.order_cancellation_requests
   where order_id = '40000000-0000-4000-8000-000000000709'),
  'approve',
  null
);

reset role;

select 1 / case when (
  exists (
    select 1 from public.order_cancellation_claims
    where order_id = '40000000-0000-4000-8000-000000000709'
      and previous_status = 'paid'
  )
  and exists (
    select 1 from public.refunds
    where payment_id = '50000000-0000-4000-8000-000000000709'
      and status = 'requested'
  )
) then 1 else 0 end as assert_staff_approval_creates_claim_and_refund_intent;

set local role service_role;

do $$
begin
  begin
    perform public.confirm_order_payment(
      'provider-key-claim-race',
      '40000000-0000-4000-8000-000000000709',
      'provider-key-claim-race',
      10000,
      '{"verified":true}'::jsonb
    );
    raise exception 'claimed order should not confirm a new payment';
  exception
    when raise_exception then
      if sqlerrm <> 'order not payable' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.cancel_order_with_provider_evidence(
      '40000000-0000-4000-8000-000000000709',
      '검증 전 호환 RPC 우회 시도',
      array['provider-key-claim']::text[]
    );
  exception when others then
    if sqlerrm = 'verified cancellation completion required' then return; end if;
    raise;
  end;
  raise exception 'compatibility RPC should not complete an active cancellation request';
end;
$$;

reset role;

select 1 / case when (
  (select status = 'paid' from public.orders where id = '40000000-0000-4000-8000-000000000709')
  and (select stock_qty = 9 from public.goods where id = 'order-cancel-claim')
  and (select status = 'paid' from public.payments where id = '50000000-0000-4000-8000-000000000709')
  and exists (
    select 1 from public.order_cancellation_claims
    where order_id = '40000000-0000-4000-8000-000000000709'
  )
  and (
    select status = 'processing'
    from public.order_cancellation_requests
    where order_id = '40000000-0000-4000-8000-000000000709'
  )
) then 1 else 0 end as assert_compatibility_rpc_preserves_active_request;

set local role service_role;

select public.complete_order_cancellation_request(
  (select id from public.order_cancellation_requests
   where order_id = '40000000-0000-4000-8000-000000000709'),
  array['provider-key-claim']::text[],
  '00000000-0000-4000-8000-000000000703'
);

reset role;

select 1 / case when (
  (select status = 'canceled' from public.orders where id = '40000000-0000-4000-8000-000000000709')
  and (select stock_qty = 10 from public.goods where id = 'order-cancel-claim')
  and (select status = 'refunded' from public.payments where id = '50000000-0000-4000-8000-000000000709')
  and not exists (
    select 1
    from public.payments
    where idempotency_key = 'provider-key-claim-race'
  )
  and not exists (
    select 1
    from public.order_cancellation_claims
    where order_id = '40000000-0000-4000-8000-000000000709'
  )
  and (
    select status = 'completed'
    from public.order_cancellation_requests
    where order_id = '40000000-0000-4000-8000-000000000709'
  )
) then 1 else 0 end as assert_cancel_finalization_closes_request_and_claim_once;

set local role service_role;

-- A pending order with no payment is safe to release through the compatibility wrapper.
select public.cancel_order(
  '40000000-0000-4000-8000-000000000701',
  '결제 전 사용자 취소'
);

reset role;

select 1 / case when (
  select status = 'canceled'
  from public.orders
  where id = '40000000-0000-4000-8000-000000000701'
) then 1 else 0 end as assert_pending_order_without_payment_is_canceled;

select 1 / case when (
  select stock_qty = 10
  from public.goods
  where id = 'order-cancel-no-payment'
) then 1 else 0 end as assert_pending_cancel_restores_inventory;

-- Repeating a completed cancellation cannot restore stock twice.
select public.cancel_order(
  '40000000-0000-4000-8000-000000000701',
  '결제 전 사용자 취소 재시도'
);

select 1 / case when (
  select stock_qty = 10
  from public.goods
  where id = 'order-cancel-no-payment'
) then 1 else 0 end as assert_canceled_retry_does_not_restore_twice;

-- A provider approval record may arrive after the no-payment cancellation commits.
-- Missing evidence must still fail closed even though the order is already canceled.
insert into public.payments (
  id, user_id, purpose, ref_id, amount, status,
  payment_key, idempotency_key, raw
)
values (
  '50000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000701', 'order',
  '40000000-0000-4000-8000-000000000701', 10000, 'pending',
  'provider-key-late', 'provider-key-late', '{"secret":"late"}'::jsonb
);

do $$
begin
  begin
    perform public.cancel_order(
      '40000000-0000-4000-8000-000000000701',
      '늦은 provider 결제 증거 없음'
    );
    raise exception 'late active payment should require provider evidence';
  exception
    when raise_exception then
      if sqlerrm <> 'provider cancellation required' then raise; end if;
  end;
end;
$$;

select 1 / case when (
  (select stock_qty = 10 from public.goods where id = 'order-cancel-no-payment')
  and (
    select status = 'pending'
    from public.payments
    where id = '50000000-0000-4000-8000-000000000701'
  )
  and not exists (
    select 1
    from public.refunds
    where payment_id = '50000000-0000-4000-8000-000000000701'
  )
) then 1 else 0 end as assert_late_payment_without_evidence_preserves_local_state;

select public.cancel_order_with_provider_evidence(
  '40000000-0000-4000-8000-000000000701',
  '늦은 provider 결제 취소 완료',
  array['provider-key-late']::text[]
);

select 1 / case when (
  (select status = 'canceled' from public.orders where id = '40000000-0000-4000-8000-000000000701')
  and (select stock_qty = 10 from public.goods where id = 'order-cancel-no-payment')
  and (
    select status = 'refunded'
    from public.payments
    where id = '50000000-0000-4000-8000-000000000701'
  )
  and (
    select count(*) = 1 and bool_and(status = 'done')
    from public.refunds
    where payment_id = '50000000-0000-4000-8000-000000000701'
  )
) then 1 else 0 end as assert_canceled_order_converges_late_payment_once;

-- Any active provider payment blocks local cancellation without matching evidence.
set local role service_role;
select 1 / case when public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000702',
  '00000000-0000-4000-8000-000000000701',
  '사용자 청약철회 요청'
) = 'requested' then 1 else 0 end as assert_active_order_request_is_durable;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000703', true);
select public.admin_decide_order_cancellation(
  (select id from public.order_cancellation_requests
   where order_id = '40000000-0000-4000-8000-000000000702'),
  'approve',
  null
);
reset role;

do $$
begin
  begin
    perform public.complete_order_cancellation_request(
      (select id from public.order_cancellation_requests
       where order_id = '40000000-0000-4000-8000-000000000702'),
      array[]::text[],
      '00000000-0000-4000-8000-000000000703'
    );
    raise exception 'active provider payment should block local cancellation';
  exception
    when raise_exception then
      if sqlerrm <> 'provider cancellation required' then raise; end if;
  end;
end;
$$;

select 1 / case when (
  (select status = 'pending' from public.orders where id = '40000000-0000-4000-8000-000000000702')
  and (select stock_qty = 9 from public.goods where id = 'order-cancel-active')
  and exists (
    select 1
    from public.order_cancellation_claims
    where order_id = '40000000-0000-4000-8000-000000000702'
  )
) then 1 else 0 end as assert_blocked_provider_cancel_preserves_order_and_stock;

-- Every active attempt must be provider-canceled; one matching key is not enough.
do $$
begin
  begin
    perform public.complete_order_cancellation_request(
      (select id from public.order_cancellation_requests
       where order_id = '40000000-0000-4000-8000-000000000702'),
      array['provider-key-active']::text[],
      '00000000-0000-4000-8000-000000000703'
    );
    raise exception 'partial provider evidence should block local cancellation';
  exception
    when raise_exception then
      if sqlerrm <> 'provider cancellation required' then raise; end if;
  end;
end;
$$;

select 1 / case when (
  (select status = 'pending' from public.orders where id = '40000000-0000-4000-8000-000000000702')
  and (select stock_qty = 9 from public.goods where id = 'order-cancel-active')
  and (
    select count(*) = 2 and bool_and(status = 'pending')
    from public.payments
    where ref_id = '40000000-0000-4000-8000-000000000702'
  )
  and (
    select count(*) = 2 and bool_and(refund.status = 'requested')
    from public.refunds as refund
    join public.payments as payment on payment.id = refund.payment_id
    where payment.ref_id = '40000000-0000-4000-8000-000000000702'
  )
  and exists (
    select 1
    from public.order_cancellation_claims
    where order_id = '40000000-0000-4000-8000-000000000702'
  )
) then 1 else 0 end as assert_partial_provider_evidence_preserves_all_local_state;

select public.complete_order_cancellation_request(
  (select id from public.order_cancellation_requests
   where order_id = '40000000-0000-4000-8000-000000000702'),
  array['provider-key-active', 'provider-key-active-retry']::text[],
  '00000000-0000-4000-8000-000000000703'
);

select 1 / case when (
  (select status = 'canceled' from public.orders where id = '40000000-0000-4000-8000-000000000702')
  and (select stock_qty = 10 from public.goods where id = 'order-cancel-active')
  and (
    select count(*) = 2 and bool_and(status = 'refunded')
    from public.payments
    where id in (
      '50000000-0000-4000-8000-000000000702',
      '50000000-0000-4000-8000-000000000712'
    )
  )
  and (
    select count(*) = 2 and bool_and(status = 'done')
    from public.refunds
    where payment_id in (
      '50000000-0000-4000-8000-000000000702',
      '50000000-0000-4000-8000-000000000712'
    )
  )
  and not exists (
    select 1
    from public.order_cancellation_claims
    where order_id = '40000000-0000-4000-8000-000000000702'
  )
) then 1 else 0 end as assert_provider_evidence_closes_order_payment_and_refund;

-- A paid order can never be locally canceled without payment evidence.
set local role service_role;
select 1 / case when public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000703',
  '00000000-0000-4000-8000-000000000701',
  '사용자 청약철회 요청'
) = 'requested' then 1 else 0 end as assert_paid_order_requested_before_evidence_check;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000703', true);
select public.admin_decide_order_cancellation(
  (select id from public.order_cancellation_requests
   where order_id = '40000000-0000-4000-8000-000000000703'),
  'approve',
  null
);
reset role;

do $$
begin
  begin
    perform public.complete_order_cancellation_request(
      (select id from public.order_cancellation_requests
       where order_id = '40000000-0000-4000-8000-000000000703'),
      array[]::text[],
      '00000000-0000-4000-8000-000000000703'
    );
    raise exception 'paid order without evidence should be rejected';
  exception
    when raise_exception then
      if sqlerrm <> 'payment evidence required' then raise; end if;
  end;
end;
$$;

select 1 / case when (
  (select status = 'paid' from public.orders where id = '40000000-0000-4000-8000-000000000703')
  and (select stock_qty = 9 from public.goods where id = 'order-cancel-no-evidence')
  and exists (
    select 1
    from public.order_cancellation_claims
    where order_id = '40000000-0000-4000-8000-000000000703'
  )
) then 1 else 0 end as assert_missing_evidence_preserves_paid_order_and_stock;

-- A local failed record is not refund evidence by itself.
do $$
begin
  begin
    perform public.cancel_order(
      '40000000-0000-4000-8000-000000000708',
      'failed 장부의 provider 증거 없음'
    );
    raise exception 'failed payment without provider evidence should be rejected';
  exception
    when raise_exception then
      if sqlerrm <> 'payment evidence required' then raise; end if;
  end;
end;
$$;

select 1 / case when (
  (select status = 'paid' from public.orders where id = '40000000-0000-4000-8000-000000000708')
  and (select stock_qty = 9 from public.goods where id = 'order-cancel-failed-evidence')
  and (
    select status = 'failed'
    from public.payments
    where id = '50000000-0000-4000-8000-000000000708'
  )
  and not exists (
    select 1
    from public.refunds
    where payment_id = '50000000-0000-4000-8000-000000000708'
  )
) then 1 else 0 end as assert_failed_payment_without_evidence_is_untouched;

select public.cancel_order_with_provider_evidence(
  '40000000-0000-4000-8000-000000000708',
  'verified CANCELED failed 장부 정합화',
  array['provider-key-failed']::text[]
);

select 1 / case when (
  (select status = 'canceled' from public.orders where id = '40000000-0000-4000-8000-000000000708')
  and (select stock_qty = 10 from public.goods where id = 'order-cancel-failed-evidence')
  and (
    select status = 'refunded'
    from public.payments
    where id = '50000000-0000-4000-8000-000000000708'
  )
  and (
    select count(*) = 1 and bool_and(status = 'done')
    from public.refunds
    where payment_id = '50000000-0000-4000-8000-000000000708'
  )
) then 1 else 0 end as assert_verified_failed_payment_converges_to_refund;

-- Shipping and completed orders are outside the self-service cancellation boundary.
do $$
declare
  blocked_order uuid;
begin
  foreach blocked_order in array array[
    '40000000-0000-4000-8000-000000000704'::uuid,
    '40000000-0000-4000-8000-000000000705'::uuid
  ]
  loop
    begin
      perform public.cancel_order_with_provider_evidence(
        blocked_order,
        '배송 이후 취소 시도',
        array['irrelevant-provider-key']::text[]
      );
      raise exception 'shipping or done order should be rejected';
    exception
      when raise_exception then
        if sqlerrm <> 'order not cancelable' then raise; end if;
    end;
  end loop;
end;
$$;

select 1 / case when (
  (select stock_qty = 9 from public.goods where id = 'order-cancel-shipping')
  and (select stock_qty = 9 from public.goods where id = 'order-cancel-done')
) then 1 else 0 end as assert_shipping_and_done_inventory_is_unchanged;

-- Existing provider-terminal evidence is enough to converge local state on retries/webhooks.
select public.cancel_order(
  '40000000-0000-4000-8000-000000000706',
  '이미 취소된 provider 결제 정합화'
);

select 1 / case when (
  (select status = 'canceled' from public.orders where id = '40000000-0000-4000-8000-000000000706')
  and (select stock_qty = 10 from public.goods where id = 'order-cancel-terminal')
  and (select status = 'refunded' from public.payments where id = '50000000-0000-4000-8000-000000000706')
  and (
    select count(*) = 1 and bool_and(status = 'done')
    from public.refunds
    where payment_id = '50000000-0000-4000-8000-000000000706'
  )
) then 1 else 0 end as assert_terminal_payment_is_idempotently_normalized;

-- Successful cancellation removes only unused packs and preserves consumed rewards/history.
select public.cancel_order_with_provider_evidence(
  '40000000-0000-4000-8000-000000000707',
  '리워드 주문 provider 취소 완료',
  array['provider-key-reward']::text[]
);

select 1 / case when (
  (select status = 'canceled' from public.orders where id = '40000000-0000-4000-8000-000000000707')
  and (select stock_qty = 10 from public.goods where id = 'order-cancel-reward')
  and (
    select count(*) = 1 and bool_and(consumed_at is not null)
    from public.draw_tickets
    where source = 'order_paid'
      and source_id = '40000000-0000-4000-8000-000000000707'
  )
  and exists (
    select 1
    from public.card_grants
    where source = 'draw_ticket'
      and source_id = '60000000-0000-4000-8000-000000000701'
  )
) then 1 else 0 end as assert_unused_pack_is_recalled_but_consumed_reward_is_preserved;

-- Retrying with the same evidence is a no-op across inventory and refund ledgers.
select public.cancel_order_with_provider_evidence(
  '40000000-0000-4000-8000-000000000707',
  '리워드 주문 provider 취소 재시도',
  array['provider-key-reward']::text[]
);

select 1 / case when (
  (select stock_qty = 10 from public.goods where id = 'order-cancel-reward')
  and (
    select count(*) = 1
    from public.refunds
    where payment_id = '50000000-0000-4000-8000-000000000707'
  )
) then 1 else 0 end as assert_provider_cancel_retry_is_idempotent;

-- Owners see the safe refund summary; another user sees no row.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);

select 1 / case when (
  select count(*) = 7
  from public.refunds
) then 1 else 0 end as assert_owner_can_read_safe_refund_summaries;

do $$
begin
  begin
    perform reason from public.refunds limit 1;
    raise exception 'refund reason should not be readable by authenticated users';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

do $$
begin
  begin
    execute 'select * from public.refunds limit 1';
    raise exception 'refund select star should be blocked by column privileges';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);

select 1 / case when not exists (
  select id, payment_id, amount, status, created_at
  from public.refunds
) then 1 else 0 end as assert_other_user_cannot_read_refund_summaries;

do $$
begin
  begin
    perform raw from public.payments limit 1;
    raise exception 'payment raw should remain unreadable by authenticated users';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

rollback;
