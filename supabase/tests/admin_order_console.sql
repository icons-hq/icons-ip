\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- ACL: user request is server-only; admin decisions stay authenticated + DB-gated.
-- ---------------------------------------------------------------------------
select 1 / case when (
  not has_function_privilege('anon', 'public.request_order_cancellation(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.request_order_cancellation(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.request_order_cancellation(uuid,uuid,text)', 'execute')
) then 1 else 0 end as assert_request_rpc_is_service_only;

select 1 / case when (
  not has_function_privilege('anon', 'public.admin_decide_order_cancellation(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_decide_order_cancellation(uuid,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_decide_order_cancellation(uuid,text,text)', 'execute')
) then 1 else 0 end as assert_decision_rpc_is_authenticated_only;

select 1 / case when (
  not has_function_privilege('anon', 'public.mark_order_cancellation_needs_review(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.mark_order_cancellation_needs_review(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.mark_order_cancellation_needs_review(uuid,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.complete_order_cancellation_request(uuid,text[],uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_order_cancellation_request(uuid,text[],uuid)', 'execute')
  and has_function_privilege('service_role', 'public.complete_order_cancellation_request(uuid,text[],uuid)', 'execute')
  and not has_function_privilege('anon', 'public.expire_stale_checkouts()', 'execute')
  and not has_function_privilege('authenticated', 'public.expire_stale_checkouts()', 'execute')
  and has_function_privilege('service_role', 'public.expire_stale_checkouts()', 'execute')
) then 1 else 0 end as assert_provider_reconciliation_is_service_only;

select 1 / case when (
  not has_function_privilege('anon', 'public.admin_begin_order_cancellation_reconcile(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_begin_order_cancellation_reconcile(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_begin_order_cancellation_reconcile(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_search_orders(text,date,date,text,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_search_orders(text,date,date,text,integer,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_search_orders(text,date,date,text,integer,integer)', 'execute')
) then 1 else 0 end as assert_admin_reconcile_and_search_are_authenticated_only;

select 1 / case when (
  not has_function_privilege('anon', 'public.admin_update_order_status(uuid,order_status,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_update_order_status(uuid,order_status,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_update_order_status(uuid,order_status,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_update_order_tracking(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_update_order_tracking(uuid,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_update_order_tracking(uuid,text,text)', 'execute')
) then 1 else 0 end as assert_shipping_rpc_is_authenticated_only;

-- 배송 후 청약철회(#176)는 새 상태기계 대신 claim의 원상태 허용값만 넓혔다.
select 1 / case when exists (
  select 1
  from pg_constraint
  where conname = 'order_cancellation_claims_previous_status_check'
    and pg_get_constraintdef(oid) like '%shipping%'
    and pg_get_constraintdef(oid) like '%done%'
) then 1 else 0 end as assert_cancellation_claim_allows_post_shipping_status;

select 1 / case when (
  not has_table_privilege('anon', 'public.order_cancellation_requests', 'select')
  and not has_table_privilege('authenticated', 'public.order_cancellation_requests', 'select')
  and has_column_privilege('authenticated', 'public.order_cancellation_requests', 'id', 'select')
  and has_column_privilege('authenticated', 'public.order_cancellation_requests', 'order_id', 'select')
  and has_column_privilege('authenticated', 'public.order_cancellation_requests', 'status', 'select')
  and has_column_privilege('authenticated', 'public.order_cancellation_requests', 'requested_at', 'select')
  and has_column_privilege('authenticated', 'public.order_cancellation_requests', 'decided_at', 'select')
  and has_column_privilege('authenticated', 'public.order_cancellation_requests', 'decision_note', 'select')
  and not has_column_privilege('authenticated', 'public.order_cancellation_requests', 'reason', 'select')
  and not has_column_privilege('authenticated', 'public.order_cancellation_requests', 'requested_by', 'select')
  and not has_column_privilege('authenticated', 'public.order_cancellation_requests', 'decided_by', 'select')
  and not has_column_privilege('authenticated', 'public.order_cancellation_requests', 'last_error_code', 'select')
  and not has_table_privilege('authenticated', 'public.order_cancellation_requests', 'insert')
  and not has_table_privilege('authenticated', 'public.order_cancellation_requests', 'update')
  and not has_table_privilege('authenticated', 'public.order_cancellation_requests', 'delete')
  and has_table_privilege('service_role', 'public.order_cancellation_requests', 'select')
  and not has_table_privilege('service_role', 'public.order_cancellation_requests', 'insert')
  and not has_table_privilege('service_role', 'public.order_cancellation_requests', 'update')
  and not has_table_privilege('service_role', 'public.order_cancellation_requests', 'delete')
) then 1 else 0 end as assert_request_table_is_read_only;

select 1 / case when (
  not has_function_privilege(
    'anon',
    'public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[])',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[])',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[])',
    'execute'
  )
  and not has_column_privilege(
    'authenticated',
    'public.refunds',
    'cancellation_request_id',
    'select'
  )
) then 1 else 0 end as assert_internal_finalizer_and_request_link_are_sealed;

-- The superseded direct technical claim entrypoint must no longer be callable.
select 1 / case when (
  to_regprocedure('public.claim_order_cancellation(uuid,uuid)') is null
) then 1 else 0 end as assert_legacy_claim_rpc_removed;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000000801', 'authenticated', 'authenticated', 'order-admin@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000802', 'authenticated', 'authenticated', 'order-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000803', 'authenticated', 'authenticated', 'order-fan@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000804', 'authenticated', 'authenticated', 'order-other@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-000000000801', 'order-admin@example.test', 'order_admin', '2000-01-01', '{"terms":true,"privacy":true}', now(), 'admin'),
  ('00000000-0000-4000-8000-000000000802', 'order-staff@example.test', 'order_staff', '2000-01-01', '{"terms":true,"privacy":true}', now(), 'staff'),
  ('00000000-0000-4000-8000-000000000803', 'order-fan@example.test', 'order_fan', '2000-01-01', '{"terms":true,"privacy":true}', now(), 'user'),
  ('00000000-0000-4000-8000-000000000804', 'order-other@example.test', 'order_other', '2000-01-01', '{"terms":true,"privacy":true}', now(), 'user')
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('admin-order-ip', '어드민 주문 IP', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('admin-order-auto', 'admin-order-ip', '자동 취소 굿즈', '테스트', 10000, 'ok', 9),
  ('admin-order-reject', 'admin-order-ip', '거절 굿즈', '테스트', 10000, 'ok', 9),
  ('admin-order-review', 'admin-order-ip', '검토 굿즈', '테스트', 20000, 'ok', 9),
  ('admin-order-shipping', 'admin-order-ip', '배송 굿즈', '테스트', 10000, 'ok', 9),
  ('admin-order-pending-paid', 'admin-order-ip', '결제행 보유 pending 굿즈', '테스트', 10000, 'ok', 9),
  ('admin-order-post-shipping', 'admin-order-ip', '반품 굿즈', '테스트', 10000, 'ok', 9);

insert into public.orders (id, user_id, status, total, address, expires_at)
values
  ('40000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000803', 'pending', 10000, '{}'::jsonb, now() + interval '15 minutes'),
  ('40000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000803', 'paid', 10000, '{}'::jsonb, null),
  ('40000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000803', 'paid', 20000, '{}'::jsonb, null),
  ('40000000-0000-4000-8000-000000000804', '00000000-0000-4000-8000-000000000803', 'paid', 10000, '{}'::jsonb, null),
  ('40000000-0000-4000-8000-000000000805', '00000000-0000-4000-8000-000000000803', 'pending', 10000, '{}'::jsonb, now() + interval '15 minutes'),
  ('40000000-0000-4000-8000-000000000806', '00000000-0000-4000-8000-000000000803', 'paid', 10000, '{}'::jsonb, null);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values
  ('40000000-0000-4000-8000-000000000801', 'admin-order-auto', 1, 10000, '자동 취소 굿즈', '테스트', 'admin-order-ip'),
  ('40000000-0000-4000-8000-000000000802', 'admin-order-reject', 1, 10000, '거절 굿즈', '테스트', 'admin-order-ip'),
  ('40000000-0000-4000-8000-000000000803', 'admin-order-review', 1, 20000, '검토 굿즈', '테스트', 'admin-order-ip'),
  ('40000000-0000-4000-8000-000000000804', 'admin-order-shipping', 1, 10000, '배송 굿즈', '테스트', 'admin-order-ip'),
  ('40000000-0000-4000-8000-000000000805', 'admin-order-pending-paid', 1, 10000, '결제행 보유 pending 굿즈', '테스트', 'admin-order-ip'),
  ('40000000-0000-4000-8000-000000000806', 'admin-order-post-shipping', 1, 10000, '반품 굿즈', '테스트', 'admin-order-ip');

insert into public.payments (
  id, user_id, purpose, ref_id, amount, status,
  payment_key, idempotency_key, raw
)
values
  ('50000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000803', 'order', '40000000-0000-4000-8000-000000000802', 10000, 'paid', 'admin-reject-key', 'admin-reject-key', '{}'),
  ('50000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000803', 'order', '40000000-0000-4000-8000-000000000803', 10000, 'paid', 'admin-review-key-one', 'admin-review-key-one', '{}'),
  ('50000000-0000-4000-8000-000000000813', '00000000-0000-4000-8000-000000000803', 'order', '40000000-0000-4000-8000-000000000803', 10000, 'paid', 'admin-review-key-two', 'admin-review-key-two', '{}'),
  ('50000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000803', 'order', '40000000-0000-4000-8000-000000000803', 10000, 'failed', 'admin-review-old-failed-key', 'admin-review-old-failed-key', '{}'),
  ('50000000-0000-4000-8000-000000000805', '00000000-0000-4000-8000-000000000803', 'order', '40000000-0000-4000-8000-000000000805', 10000, 'pending', 'admin-pending-key', 'admin-pending-key', '{}'),
  ('50000000-0000-4000-8000-000000000806', '00000000-0000-4000-8000-000000000803', 'order', '40000000-0000-4000-8000-000000000806', 10000, 'paid', 'admin-post-shipping-key', 'admin-post-shipping-key', '{}');

do $$
begin
  begin
    insert into public.payments (
      id, user_id, purpose, ref_id, amount, status,
      payment_key, idempotency_key, raw
    ) values (
      '50000000-0000-4000-8000-000000000815',
      '00000000-0000-4000-8000-000000000803',
      'order',
      '40000000-0000-4000-8000-000000000805',
      10000,
      'failed',
      'admin-pending-key',
      'admin-pending-key-duplicate-attempt',
      '{}'
    );
  exception when unique_violation then
    return;
  end;

  raise exception 'payment_key should be unique when present';
end;
$$;

-- ---------------------------------------------------------------------------
-- No-payment pending cancellation auto-completes exactly once.
-- ---------------------------------------------------------------------------
set local role service_role;

select public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000801',
  '00000000-0000-4000-8000-000000000803',
  '사용자 주문 취소'
);

reset role;

select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000801') = 'canceled'
  and (select stock_qty from public.goods where id = 'admin-order-auto') = 10
  and (select status from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000801') = 'completed'
  and not exists (select 1 from public.order_cancellation_claims where order_id = '40000000-0000-4000-8000-000000000801')
) then 1 else 0 end as assert_no_payment_pending_auto_completes;

set local role service_role;
select public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000801',
  '00000000-0000-4000-8000-000000000803',
  '사용자 주문 취소'
);
reset role;

select 1 / case when (
  (select stock_qty from public.goods where id = 'admin-order-auto') = 10
) then 1 else 0 end as assert_auto_cancel_retry_does_not_restore_twice;

-- 늦게 관측된 provider 결제도 이미 완료된 durable 요청에 연결해 이력을 잃지 않는다.
insert into public.payments (
  id, user_id, purpose, ref_id, amount, status,
  payment_key, idempotency_key, raw
)
values (
  '50000000-0000-4000-8000-000000000801',
  '00000000-0000-4000-8000-000000000803',
  'order',
  '40000000-0000-4000-8000-000000000801',
  10000,
  'pending',
  'admin-auto-late-key',
  'admin-auto-late-key',
  '{}'
);

set local role service_role;
select public.cancel_order_with_provider_evidence(
  '40000000-0000-4000-8000-000000000801',
  '늦은 provider 결제 취소 완료',
  array['admin-auto-late-key']
);
reset role;

select 1 / case when (
  (select stock_qty from public.goods where id = 'admin-order-auto') = 10
  and (select status from public.payments where id = '50000000-0000-4000-8000-000000000801') = 'refunded'
  and exists (
    select 1
    from public.refunds as refund
    join public.order_cancellation_requests as request
      on request.id = refund.cancellation_request_id
    where refund.payment_id = '50000000-0000-4000-8000-000000000801'
      and refund.status = 'done'
      and request.order_id = '40000000-0000-4000-8000-000000000801'
      and request.status = 'completed'
  )
) then 1 else 0 end as assert_late_payment_links_to_completed_request;

-- ---------------------------------------------------------------------------
-- Paid/provider-backed orders create a durable request but do not call provider.
-- ---------------------------------------------------------------------------
set local role service_role;

select public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000802',
  '00000000-0000-4000-8000-000000000803',
  '사용자 청약철회'
);
select public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000803',
  '00000000-0000-4000-8000-000000000803',
  '사용자 청약철회'
);
select public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000805',
  '00000000-0000-4000-8000-000000000803',
  '사용자 청약철회'
);

reset role;

select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000802') = 'paid'
  and (select status from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000802') = 'requested'
  and not exists (select 1 from public.order_cancellation_claims where order_id = '40000000-0000-4000-8000-000000000802')
  and not exists (
    select 1 from public.refunds where payment_id = '50000000-0000-4000-8000-000000000802'
  )
  and (select status from public.orders where id = '40000000-0000-4000-8000-000000000805') = 'pending'
  and (select status from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000805') = 'requested'
) then 1 else 0 end as assert_paid_and_provider_backed_pending_only_request;

-- requested 상태가 pending provider 결제의 새 확정도 transaction 전체에서 막는다.
set local role service_role;

do $$
begin
  begin
    perform public.confirm_order_payment(
      'admin-pending-key',
      '40000000-0000-4000-8000-000000000805',
      'admin-pending-key',
      10000,
      '{"verified":true}'::jsonb
    );
  exception when check_violation then
    if sqlerrm = 'order cancellation in progress' then return; end if;
    raise;
  end;
  raise exception 'requested cancellation should block payment confirmation';
end;
$$;

reset role;

select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000805') = 'pending'
  and (select status from public.payments where id = '50000000-0000-4000-8000-000000000805') = 'pending'
) then 1 else 0 end as assert_requested_cancellation_blocks_payment_confirmation;

-- 만료 sweep은 provider 전체 검증이 필요한 active 요청을 호환 RPC로 우회하지 않는다.
update public.payments
set status = 'failed'
where id = '50000000-0000-4000-8000-000000000805';

update public.orders
set expires_at = now() - interval '10 minutes'
where id = '40000000-0000-4000-8000-000000000805';

select 1 / case when public.expire_stale_checkouts() = 0
then 1 else 0 end as assert_expiry_sweep_skips_active_cancellation_request;

with definition as (
  select lower(pg_get_functiondef('public.expire_stale_checkouts()'::regprocedure)) as body
)
select 1 / case when strpos(body, 'for update of orders skip locked') > 0
then 1 else 0 end as assert_expiry_sweep_serializes_order_requests
from definition;

select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000805') = 'pending'
  and (select status from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000805') = 'requested'
  and (select stock_qty from public.goods where id = 'admin-order-pending-paid') = 9
) then 1 else 0 end as assert_expiry_sweep_preserves_active_cancellation_request;

-- 사용자는 본인 요청의 안전 상태만 보고, 다른 사용자는 행 자체를 볼 수 없다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000803', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select 1 / case when (
  (select count(*) from public.order_cancellation_requests) = 4
) then 1 else 0 end as assert_owner_reads_safe_cancellation_request_rows;

do $$
begin
  begin
    perform reason from public.order_cancellation_requests limit 1;
  exception when insufficient_privilege then return;
  end;
  raise exception 'request reason should remain internal';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000804', true);

select 1 / case when not exists (
  select id, order_id, status, requested_at, decided_at, decision_note
  from public.order_cancellation_requests
) then 1 else 0 end as assert_other_user_cannot_read_cancellation_requests;

reset role;

do $$
begin
  begin
    update public.orders set status = 'shipping'
    where id = '40000000-0000-4000-8000-000000000802';
  exception
    when check_violation then return;
    when others then
      if sqlerrm = 'order cancellation in progress' then return; end if;
      raise;
  end;
  raise exception 'requested cancellation should block shipping';
end;
$$;

-- ---------------------------------------------------------------------------
-- Non-staff cannot decide; staff rejection is terminal and re-enables shipping.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000804', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare request_id uuid;
begin
  select id into request_id from public.order_cancellation_requests
  where order_id = '40000000-0000-4000-8000-000000000802';
  begin
    perform public.admin_decide_order_cancellation(request_id, 'reject', '거절 사유를 충분히 기록합니다');
  exception when insufficient_privilege then return;
  end;
  raise exception 'non-staff cancellation decision should be blocked';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);

select public.admin_decide_order_cancellation(
  (select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000802'),
  'reject',
  '구매자 확인 결과 청약철회 요청을 거절합니다'
);

select 1 / case when (
  (select status from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000802') = 'rejected'
  and exists (
    select 1 from public.audit_log
    where actor_id = '00000000-0000-4000-8000-000000000802'
      and action = 'admin.order.cancellation_rejected'
      and target = 'order:40000000-0000-4000-8000-000000000802'
  )
) then 1 else 0 end as assert_requested_cancellation_can_be_rejected_and_audited;

select public.admin_update_order_status(
  '40000000-0000-4000-8000-000000000802',
  'shipping',
  'hanjin',
  '111122223333'
);

select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000802') = 'shipping'
) then 1 else 0 end as assert_rejected_request_releases_shipping;

-- ---------------------------------------------------------------------------
-- Approval creates claim/refund intent; uncertain provider state stays fail closed.
-- ---------------------------------------------------------------------------
select public.admin_decide_order_cancellation(
  (select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803'),
  'approve',
  null
);

reset role;

select 1 / case when (
  (select status from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803') = 'processing'
  and exists (select 1 from public.order_cancellation_claims where order_id = '40000000-0000-4000-8000-000000000803')
  and (select count(*) from public.refunds where cancellation_request_id = (
    select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803'
  ) and status = 'requested') = 2
  and not exists (
    select 1 from public.refunds
    where payment_id = '50000000-0000-4000-8000-000000000823'
  )
) then 1 else 0 end as assert_approval_claims_order_and_creates_refund_intent;

-- 기존 checkout/webhook 호환 RPC는 provider 전체 검증을 수행하지 않으므로,
-- active 청약철회 요청을 완료하거나 로컬 환불로 확정할 수 없다.
set local role service_role;

do $$
begin
  begin
    perform public.cancel_order_with_provider_evidence(
      '40000000-0000-4000-8000-000000000803',
      '호환 RPC 우회 시도',
      array['admin-review-key-one', 'admin-review-key-two']
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
  (select status from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803') = 'processing'
  and (select status from public.orders where id = '40000000-0000-4000-8000-000000000803') = 'paid'
  and (select stock_qty from public.goods where id = 'admin-order-review') = 9
  and exists (select 1 from public.order_cancellation_claims where order_id = '40000000-0000-4000-8000-000000000803')
  and (select count(*) from public.refunds where cancellation_request_id = (
    select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803'
  ) and status = 'requested') = 2
) then 1 else 0 end as assert_compatibility_rpc_cannot_bypass_provider_verification;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare request_id uuid;
begin
  select id into request_id from public.order_cancellation_requests
  where order_id = '40000000-0000-4000-8000-000000000803';
  begin
    perform public.admin_decide_order_cancellation(request_id, 'reject', 'provider 호출 뒤에는 거절할 수 없습니다');
  exception when others then
    if sqlerrm = 'cancellation_request_not_decidable' then return; end if;
    raise;
  end;
  raise exception 'processing cancellation should not be rejectable';
end;
$$;

reset role;
set local role service_role;

select public.mark_order_cancellation_needs_review(
  (select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803'),
  '00000000-0000-4000-8000-000000000802',
  'provider_unreachable'
);

reset role;

select 1 / case when (
  (select status from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803') = 'needs_review'
  and (select status from public.orders where id = '40000000-0000-4000-8000-000000000803') = 'paid'
  and (select stock_qty from public.goods where id = 'admin-order-review') = 9
  and exists (select 1 from public.order_cancellation_claims where order_id = '40000000-0000-4000-8000-000000000803')
  and (select count(*) from public.refunds where cancellation_request_id = (
    select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803'
  ) and status = 'failed') = 2
) then 1 else 0 end as assert_needs_review_preserves_order_stock_and_claim;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.admin_begin_order_cancellation_reconcile(
  (select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803')
);

reset role;

select 1 / case when (
  (select status from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803') = 'processing'
  and (select count(*) from public.refunds where cancellation_request_id = (
    select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803'
  ) and status = 'requested') = 2
) then 1 else 0 end as assert_reconcile_reuses_request_and_refund_intent;

set local role service_role;

do $$
declare request_id uuid;
begin
  select id into request_id from public.order_cancellation_requests
  where order_id = '40000000-0000-4000-8000-000000000803';
  begin
    perform public.complete_order_cancellation_request(
      request_id,
      array['admin-review-key-one'],
      '00000000-0000-4000-8000-000000000802'
    );
  exception when others then
    if sqlerrm = 'provider cancellation required' then return; end if;
    raise;
  end;
  raise exception 'partial provider evidence should be rejected';
end;
$$;

do $$
declare request_id uuid;
begin
  select id into request_id from public.order_cancellation_requests
  where order_id = '40000000-0000-4000-8000-000000000803';

  begin
    update public.payments
    set status = 'refunded'
    where id = '50000000-0000-4000-8000-000000000813';

    perform public.complete_order_cancellation_request(
      request_id,
      array['admin-review-key-one'],
      '00000000-0000-4000-8000-000000000802'
    );

    raise exception 'local terminal payment without fresh provider evidence should be rejected';
  exception when others then
    if sqlerrm = 'provider cancellation required' then return; end if;
    raise;
  end;
end;
$$;

select public.complete_order_cancellation_request(
  (select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803'),
  array['admin-review-key-one', 'admin-review-key-two'],
  '00000000-0000-4000-8000-000000000802'
);

reset role;

select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000803') = 'canceled'
  and (select status from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803') = 'completed'
  and (select stock_qty from public.goods where id = 'admin-order-review') = 10
  and (select count(*) from public.refunds where cancellation_request_id = (
    select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803'
  ) and status = 'done') = 2
  and not exists (select 1 from public.order_cancellation_claims where order_id = '40000000-0000-4000-8000-000000000803')
  and (select status from public.payments where id = '50000000-0000-4000-8000-000000000823') = 'failed'
  and not exists (
    select 1 from public.refunds
    where payment_id = '50000000-0000-4000-8000-000000000823'
  )
  and exists (
    select 1 from public.audit_log
    where actor_id = '00000000-0000-4000-8000-000000000802'
      and action = 'admin.order.cancellation_completed'
  )
) then 1 else 0 end as assert_full_provider_evidence_completes_once;

set local role service_role;
select public.complete_order_cancellation_request(
  (select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803'),
  array['admin-review-key-one', 'admin-review-key-two'],
  '00000000-0000-4000-8000-000000000802'
);
reset role;

select 1 / case when (
  (select stock_qty from public.goods where id = 'admin-order-review') = 10
  and (select count(*) from public.refunds where cancellation_request_id = (
    select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000803'
  )) = 2
) then 1 else 0 end as assert_completion_retry_is_idempotent;

-- ---------------------------------------------------------------------------
-- Shipping state machine: paid -> shipping -> done, no skips or reversals.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- 운송장 없이 배송 시작은 DB에서 fail closed한다(#178).
do $$
begin
  begin
    perform public.admin_update_order_status(
      '40000000-0000-4000-8000-000000000804', 'shipping', null, null
    );
  exception when check_violation then
    if sqlerrm = 'tracking_required' then return; end if;
    raise;
  end;
  raise exception 'shipping without a waybill should be rejected';
end;
$$;

select public.admin_update_order_status(
  '40000000-0000-4000-8000-000000000804', 'shipping', 'hanjin', '444455556666'
);
select public.admin_update_order_status('40000000-0000-4000-8000-000000000804', 'done', null, null);
select public.admin_update_order_status('40000000-0000-4000-8000-000000000804', 'done', null, null);

do $$
begin
  begin
    perform public.admin_update_order_status(
      '40000000-0000-4000-8000-000000000804', 'shipping', 'hanjin', '444455556666'
    );
  exception when others then
    if sqlerrm = 'invalid_order_transition' then return; end if;
    raise;
  end;
  raise exception 'done order should not transition backwards';
end;
$$;

select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000804') = 'done'
  and (select count(*) from public.audit_log
    where actor_id = '00000000-0000-4000-8000-000000000802'
      and action = 'admin.order.status_updated'
      and target = 'order:40000000-0000-4000-8000-000000000804') = 2
) then 1 else 0 end as assert_shipping_transitions_are_guarded_idempotent_and_audited;

-- 완료 전이는 등록된 운송장을 지우지 않고, 정정은 이전 값과 함께 감사된다.
select 1 / case when (
  (select shipping_carrier = 'hanjin' and tracking_number = '444455556666'
   from public.orders where id = '40000000-0000-4000-8000-000000000804')
) then 1 else 0 end as assert_done_transition_keeps_the_waybill;

select public.admin_update_order_tracking(
  '40000000-0000-4000-8000-000000000804', 'hanjin', '777788889999'
);
select public.admin_update_order_tracking(
  '40000000-0000-4000-8000-000000000804', 'hanjin', '777788889999'
);

select 1 / case when (
  (select tracking_number = '777788889999'
   from public.orders where id = '40000000-0000-4000-8000-000000000804')
  and (select count(*) from public.audit_log
    where actor_id = '00000000-0000-4000-8000-000000000802'
      and action = 'admin.order.tracking_updated'
      and target = 'order:40000000-0000-4000-8000-000000000804'
      and diff->>'fromTrackingNumber' = '444455556666'
      and diff->>'toTrackingNumber' = '777788889999') = 1
) then 1 else 0 end as assert_waybill_correction_is_idempotent_and_audited;

-- ---------------------------------------------------------------------------
-- 배송 후 청약철회(#176)는 staff 승인 경로에서만 열린다.
-- ---------------------------------------------------------------------------
select public.admin_update_order_status(
  '40000000-0000-4000-8000-000000000806', 'shipping', 'hanjin', '222233334444'
);

reset role;
set local role service_role;

-- 승인 전에는 결제 증거가 있어도 배송된 주문을 호환 RPC로 취소할 수 없다.
do $$
begin
  begin
    perform public.cancel_order_with_provider_evidence(
      '40000000-0000-4000-8000-000000000806',
      '운영 수기 정합화',
      array['admin-post-shipping-key']
    );
  exception when raise_exception then
    if sqlerrm = 'order not cancelable' then return; end if;
    raise;
  end;
  raise exception 'post-shipping cancellation without a staff claim should be rejected';
end;
$$;

select public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000806',
  '00000000-0000-4000-8000-000000000803',
  '수령 후 반품 요청'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.admin_decide_order_cancellation(
  (select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000806'),
  'approve',
  null
);

reset role;
set local role service_role;

select public.complete_order_cancellation_request(
  (select id from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000806'),
  array['admin-post-shipping-key'],
  '00000000-0000-4000-8000-000000000802'
);

reset role;

select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000806') = 'canceled'
  and (select stock_qty from public.goods where id = 'admin-order-post-shipping') = 10
  and (select status from public.order_cancellation_requests where order_id = '40000000-0000-4000-8000-000000000806') = 'completed'
  and (select status from public.payments where id = '50000000-0000-4000-8000-000000000806') = 'refunded'
  and not exists (
    select 1 from public.order_cancellation_claims
    where order_id = '40000000-0000-4000-8000-000000000806'
  )
) then 1 else 0 end as assert_approved_post_shipping_withdrawal_still_completes;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Search stays DB-side and staff-gated.
select 1 / case when (
  (select count(*) from public.admin_search_orders(null, null, null, 'order-fan@example.test', 20, 0)) >= 4
  and (select count(*) from public.admin_search_orders('done', null, null, '40000000-0000-4000-8000-000000000804', 20, 0)) = 1
  and exists (
    select 1
    from public.admin_search_orders(null, null, null, '40000000-0000-4000-8000-000000000803', 20, 0)
    where buyer_name = 'order_fan'
      and buyer_email = 'order-fan@example.test'
      and address = '{}'::jsonb
      and cancellation_request_status = 'completed'
      and cancellation_requested_at is not null
      and cancellation_decided_at is not null
      and cancellation_decision_note is null
      and total_count = 1
  )
) then 1 else 0 end as assert_admin_search_filters_in_database;

rollback;
