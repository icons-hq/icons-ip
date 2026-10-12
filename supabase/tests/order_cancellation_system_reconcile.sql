\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 승인된 취소의 즉시 결제사 취소 계약 (2026-10-12 점검 REF-2)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 오케스트레이터 RPC 4종은 계속 service_role 전용이다
--   · p_actor_id null(시스템)은 취소 유형에만 허용되고 system.order.* 감사로 남는다
--   · staff actor 경로는 그대로 admin.order.* 감사로 남는다
--   · 토스 취소가 검증된 완료는 환불 원장(pg_cancel·접수·완료 시각)까지 닫고,
--     구매자에게는 그 시점에만 "결제 취소가 완료됐어요"를 보낸다
--   · 토스 결제의 pg_cancel 접수 알림은 "결제사에 접수했다"고 말하지 않는다
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 계약: 실행 권한
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('service_role', 'public.assert_order_cancellation_reconciliation_allowed(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.assert_order_cancellation_reconciliation_allowed(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.assert_order_cancellation_reconciliation_allowed(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.reconcile_expired_prepared_goods_cancellation(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.reconcile_expired_prepared_goods_cancellation(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.reconcile_expired_prepared_goods_cancellation(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.complete_order_cancellation_request(uuid,text[],uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_order_cancellation_request(uuid,text[],uuid)', 'execute')
  and not has_function_privilege('anon', 'public.complete_order_cancellation_request(uuid,text[],uuid)', 'execute')
  and has_function_privilege('service_role', 'public.mark_order_cancellation_needs_review(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.mark_order_cancellation_needs_review(uuid,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.mark_order_cancellation_needs_review(uuid,uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_record_order_claim_refund(uuid,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_record_order_claim_refund(uuid,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_record_order_claim_refund(uuid,text,text,text)', 'execute')
) then 1 else 0 end as assert_reconcile_rpcs_stay_service_only;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-0000000c5c01', 'authenticated', 'authenticated', 'sys-cancel-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000c5c02', 'authenticated', 'authenticated', 'sys-cancel-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000c5c01', 'sys-cancel-buyer@example.test', 'sys_cancel_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role),
  ('00000000-0000-4000-8000-0000000c5c02', 'sys-cancel-staff@example.test', 'sys_cancel_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'::public.user_role)
on conflict (id) do update set role = excluded.role, nickname = excluded.nickname;

insert into public.ips (id, title, vertical_key) values ('sys-cancel-ip', '시스템 취소 IP', 'character');
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('sys-cancel-goods', 'sys-cancel-ip', '시스템 취소 굿즈', '문구', 10000, 'ok', 20);

insert into public.orders (id, user_id, status, total, address, shipped_at, delivered_at)
values
  -- A: 자동 승인 → 시스템 완료
  ('51000000-0000-4000-8000-0000000c5c01', '00000000-0000-4000-8000-0000000c5c01', 'paid', 10000, '{}'::jsonb, null, null),
  -- B: 자동 승인 → 시스템 needs_review
  ('51000000-0000-4000-8000-0000000c5c02', '00000000-0000-4000-8000-0000000c5c01', 'paid', 10000, '{}'::jsonb, null, null),
  -- C: 자동 승인 → staff 완료(기존 계약)
  ('51000000-0000-4000-8000-0000000c5c03', '00000000-0000-4000-8000-0000000c5c01', 'paid', 10000, '{}'::jsonb, null, null),
  -- R: 입고 확인된 반품 — 시스템은 닫을 수 없다
  ('51000000-0000-4000-8000-0000000c5c04', '00000000-0000-4000-8000-0000000c5c01', 'delivered', 10000, '{}'::jsonb,
    now() - interval '3 days', now() - interval '1 day'),
  -- W: 무통장 입금 확인 주문 — 완료 RPC가 결제사 증거 없이 닫지 않는다(REF-4 런북 근거)
  ('51000000-0000-4000-8000-0000000c5c05', '00000000-0000-4000-8000-0000000c5c01', 'paid', 10000, '{}'::jsonb, null, null);

insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, variant_id)
select o.id, 'sys-cancel-goods', 1, 10000, '시스템 취소 굿즈', '문구', 'sys-cancel-ip',
  (select id from public.goods_variants where good_id = 'sys-cancel-goods' and is_default)
from public.orders o where o.user_id = '00000000-0000-4000-8000-0000000c5c01';

insert into public.fulfillment_origins (id, code, name, base_fee, return_address)
values ('00000000-0000-4000-8000-0000000c5c20', 'sys-cancel-test', '시스템 취소 검증 창고', 0, '합성 반송 주소 5c20');
insert into public.order_shipments (order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot, status, carrier, tracking_number, shipped_at, delivered_at)
select o.id, '00000000-0000-4000-8000-0000000c5c20', '시스템 취소 검증 창고', 0, '{}',
  case when o.status = 'delivered' then 'delivered' else 'ready' end,
  case when o.shipped_at is not null then 'hanjin' end,
  case when o.shipped_at is not null then 'SYSCANCEL' || upper(right(o.id::text, 3)) end,
  o.shipped_at, o.delivered_at
from public.orders o where o.user_id = '00000000-0000-4000-8000-0000000c5c01';
insert into public.order_shipment_items (order_id, shipment_id, order_item_id, qty)
select i.order_id, s.id, i.id, i.qty
from public.order_items i join public.order_shipments s on s.order_id = i.order_id
where s.origin_id = '00000000-0000-4000-8000-0000000c5c20';

insert into public.payments (id, user_id, purpose, ref_id, amount, status, payment_key, idempotency_key, provider)
values
  ('52000000-0000-4000-8000-0000000c5c01', '00000000-0000-4000-8000-0000000c5c01', 'order', '51000000-0000-4000-8000-0000000c5c01', 10000, 'paid', 'pk_sys_cancel_a', 'idem_sys_cancel_a', 'toss'),
  ('52000000-0000-4000-8000-0000000c5c02', '00000000-0000-4000-8000-0000000c5c01', 'order', '51000000-0000-4000-8000-0000000c5c02', 10000, 'paid', 'pk_sys_cancel_b', 'idem_sys_cancel_b', 'toss'),
  ('52000000-0000-4000-8000-0000000c5c03', '00000000-0000-4000-8000-0000000c5c01', 'order', '51000000-0000-4000-8000-0000000c5c03', 10000, 'paid', 'pk_sys_cancel_c', 'idem_sys_cancel_c', 'toss'),
  ('52000000-0000-4000-8000-0000000c5c04', '00000000-0000-4000-8000-0000000c5c01', 'order', '51000000-0000-4000-8000-0000000c5c04', 10000, 'paid', 'pk_sys_cancel_r', 'idem_sys_cancel_r', 'toss'),
  ('52000000-0000-4000-8000-0000000c5c05', '00000000-0000-4000-8000-0000000c5c01', 'order', '51000000-0000-4000-8000-0000000c5c05', 10000, 'paid', 'bt_sys_cancel_w', 'idem_sys_cancel_w', 'bank_transfer');

-- 입고까지 확인된 레거시 반품. 회수 스냅샷 없이 complete로 판정되는 legacy 정책을 쓴다.
insert into public.order_cancellation_requests (
  id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy, collected_at
)
values (
  '53000000-0000-4000-8000-0000000c5c04', '51000000-0000-4000-8000-0000000c5c04',
  '00000000-0000-4000-8000-0000000c5c01', '단순 변심 반품', 'change_of_mind', 'return', 'collected', 'legacy', now()
);

-- ---------------------------------------------------------------------------
-- 자동 승인 → 시스템 actor로 결제사 취소 검증 완료
-- ---------------------------------------------------------------------------
set local role service_role;

select 1 / case when public.request_order_claim(
  '51000000-0000-4000-8000-0000000c5c01', '00000000-0000-4000-8000-0000000c5c01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
) = 'auto_approved' then 1 else 0 end as assert_paid_cancel_auto_approves;

select 1 / case when public.assert_order_cancellation_reconciliation_allowed(
  (select id from public.order_cancellation_requests where order_id = '51000000-0000-4000-8000-0000000c5c01'),
  null
) = 'allowed' then 1 else 0 end as assert_system_preflight_allows_cancel;

select 1 / case when public.reconcile_expired_prepared_goods_cancellation(
  (select id from public.order_cancellation_requests where order_id = '51000000-0000-4000-8000-0000000c5c01'),
  null
) = 'not_applicable' then 1 else 0 end as assert_system_prepared_check_is_not_applicable_for_capture;

select public.complete_order_cancellation_request(
  (select id from public.order_cancellation_requests where order_id = '51000000-0000-4000-8000-0000000c5c01'),
  array['pk_sys_cancel_a'],
  null
);

reset role;

select 1 / case when (
  select
    o.status = 'canceled'
    and r.status = 'completed'
    and p.status = 'refunded'
    and f.status = 'done'
    and f.method = 'pg_cancel'
    and f.filed_at is not null
    and f.completed_at is not null
    and f.handled_by is null
  from public.orders o
  join public.order_cancellation_requests r on r.order_id = o.id
  join public.payments p on p.ref_id = o.id and p.purpose = 'order'
  join public.refunds f on f.payment_id = p.id
  where o.id = '51000000-0000-4000-8000-0000000c5c01'
) then 1 else 0 end as assert_system_completion_closes_order_and_refund_ledger;

select 1 / case when (
  select stock_qty = 21 from public.goods where id = 'sys-cancel-goods'
) then 1 else 0 end as assert_system_completion_restores_stock_once;

select 1 / case when (
  select count(*) = 1
    and bool_and(a.actor_id is null)
    and bool_and(a.diff->>'actor' = 'system')
    and bool_and((a.diff->>'providerRefundCount')::int = 1)
  from public.audit_log a
  where a.target = 'order:51000000-0000-4000-8000-0000000c5c01'
    and a.action = 'system.order.cancellation_completed'
) then 1 else 0 end as assert_system_completion_is_audited_as_system;

select 1 / case when (
  select count(*) = 1
  from public.notifications n
  where n.user_id = '00000000-0000-4000-8000-0000000c5c01'
    and n.source_type = 'order_claim'
    and n.source_id = (select id::text from public.order_cancellation_requests where order_id = '51000000-0000-4000-8000-0000000c5c01')
    and n.title = '결제 취소가 완료됐어요'
    and n.dedupe_key like 'claim:refund_completed:%'
) then 1 else 0 end as assert_buyer_is_told_only_after_verified_provider_cancel;

-- 같은 완료 재호출은 멱등이다(원장·알림·재고가 다시 움직이지 않는다).
set local role service_role;
select public.complete_order_cancellation_request(
  (select id from public.order_cancellation_requests where order_id = '51000000-0000-4000-8000-0000000c5c01'),
  array['pk_sys_cancel_a'],
  null
);
reset role;
select 1 / case when (
  (select stock_qty = 21 from public.goods where id = 'sys-cancel-goods')
  and (select count(*) = 1 from public.audit_log where target = 'order:51000000-0000-4000-8000-0000000c5c01' and action = 'system.order.cancellation_completed')
) then 1 else 0 end as assert_system_completion_replay_is_idempotent;

-- ---------------------------------------------------------------------------
-- 시스템 actor의 needs_review
-- ---------------------------------------------------------------------------
set local role service_role;
select public.request_order_claim(
  '51000000-0000-4000-8000-0000000c5c02', '00000000-0000-4000-8000-0000000c5c01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
);
select public.mark_order_cancellation_needs_review(
  (select id from public.order_cancellation_requests where order_id = '51000000-0000-4000-8000-0000000c5c02'),
  null,
  'provider_unavailable'
);
reset role;

select 1 / case when (
  select r.status = 'needs_review' and r.stage = 'needs_review' and r.last_error_code = 'provider_unavailable'
    and o.status = 'paid'
    and exists (
      select 1 from public.audit_log a
      where a.target = 'order:51000000-0000-4000-8000-0000000c5c02'
        and a.action = 'system.order.cancellation_needs_review'
        and a.actor_id is null
    )
  from public.order_cancellation_requests r join public.orders o on o.id = r.order_id
  where r.order_id = '51000000-0000-4000-8000-0000000c5c02'
) then 1 else 0 end as assert_system_needs_review_keeps_order_and_audits_system;

-- ---------------------------------------------------------------------------
-- staff actor 경로는 기존 감사 액션을 유지한다
-- ---------------------------------------------------------------------------
set local role service_role;
select public.request_order_claim(
  '51000000-0000-4000-8000-0000000c5c03', '00000000-0000-4000-8000-0000000c5c01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
);
select public.complete_order_cancellation_request(
  (select id from public.order_cancellation_requests where order_id = '51000000-0000-4000-8000-0000000c5c03'),
  array['pk_sys_cancel_c'],
  '00000000-0000-4000-8000-0000000c5c02'
);
reset role;

select 1 / case when (
  select f.handled_by = '00000000-0000-4000-8000-0000000c5c02' and f.method = 'pg_cancel'
    and exists (
      select 1 from public.audit_log a
      where a.target = 'order:51000000-0000-4000-8000-0000000c5c03'
        and a.action = 'admin.order.cancellation_completed'
        and a.actor_id = '00000000-0000-4000-8000-0000000c5c02'
    )
  from public.refunds f where f.payment_id = '52000000-0000-4000-8000-0000000c5c03'
) then 1 else 0 end as assert_staff_completion_keeps_admin_audit;

-- ---------------------------------------------------------------------------
-- 시스템 actor는 반품을 닫을 수 없다
-- ---------------------------------------------------------------------------
-- 반품 환불 접수는 staff 세션이다. 토스 결제라 "결제사에 접수했다"고 말하지 않는다.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000c5c02', true);
select public.admin_record_order_claim_refund('53000000-0000-4000-8000-0000000c5c04', 'pg_cancel', 'filed', null);
reset role;

select 1 / case when (
  select count(*) = 1
  from public.notifications n
  where n.source_id = '53000000-0000-4000-8000-0000000c5c04'
    and n.dedupe_key like 'claim:refund_filed:%'
    and n.body = '환불 절차를 시작했습니다. 결제사 취소가 확인되면 다시 알려드립니다.'
) then 1 else 0 end as assert_toss_refund_filing_does_not_claim_provider_cancel;

select 1 / case when (
  select stage = 'processing' from public.order_cancellation_requests where id = '53000000-0000-4000-8000-0000000c5c04'
) then 1 else 0 end as assert_return_refund_filing_moves_to_processing;

set local role service_role;
do $system_return_guard$
declare
  rejected_preflight boolean := false;
  rejected_complete boolean := false;
  rejected_review boolean := false;
begin
  begin
    perform public.assert_order_cancellation_reconciliation_allowed('53000000-0000-4000-8000-0000000c5c04', null);
  exception when insufficient_privilege then rejected_preflight := true;
  end;
  begin
    perform public.complete_order_cancellation_request('53000000-0000-4000-8000-0000000c5c04', array['pk_sys_cancel_r'], null);
  exception when insufficient_privilege then rejected_complete := true;
  end;
  begin
    perform public.mark_order_cancellation_needs_review('53000000-0000-4000-8000-0000000c5c04', null, 'provider_unavailable');
  exception when insufficient_privilege then rejected_review := true;
  end;
  if not (rejected_preflight and rejected_complete and rejected_review) then
    raise exception 'system actor reached a return claim: preflight=%, complete=%, review=%',
      rejected_preflight, rejected_complete, rejected_review;
  end if;
end;
$system_return_guard$;

-- staff가 아닌 실제 사용자 id는 여전히 거절된다(null만 시스템이다).
do $buyer_actor_guard$
declare rejected boolean := false;
begin
  begin
    perform public.complete_order_cancellation_request(
      (select id from public.order_cancellation_requests where order_id = '51000000-0000-4000-8000-0000000c5c02'),
      array['pk_sys_cancel_b'],
      '00000000-0000-4000-8000-0000000c5c01'
    );
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'buyer id was accepted as a cancellation actor'; end if;
end;
$buyer_actor_guard$;
reset role;

select 1 / case when (
  select status = 'delivered' from public.orders where id = '51000000-0000-4000-8000-0000000c5c04'
) then 1 else 0 end as assert_return_order_untouched_by_system_attempts;

-- ---------------------------------------------------------------------------
-- 무통장 결제 주문의 취소는 결제사 증거가 없어 완료되지 않는다(REF-4, #280)
-- 런북(admin-store-settings)의 "계좌 설정 전 선행 조건"이 기대는 DB 계약이다.
-- ---------------------------------------------------------------------------
set local role service_role;
select public.request_order_claim(
  '51000000-0000-4000-8000-0000000c5c05', '00000000-0000-4000-8000-0000000c5c01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
);
do $bank_transfer_completion$
declare rejected boolean := false;
begin
  begin
    perform public.complete_order_cancellation_request(
      (select id from public.order_cancellation_requests where order_id = '51000000-0000-4000-8000-0000000c5c05'),
      array[]::text[],
      '00000000-0000-4000-8000-0000000c5c02'
    );
  exception when others then
    rejected := sqlerrm = 'provider cancellation required';
  end;
  if not rejected then raise exception 'bank transfer order completed without provider evidence'; end if;
end;
$bank_transfer_completion$;
reset role;

select 1 / case when (
  select o.status = 'paid' and r.status = 'processing'
  from public.orders o join public.order_cancellation_requests r on r.order_id = o.id
  where o.id = '51000000-0000-4000-8000-0000000c5c05'
) then 1 else 0 end as assert_bank_transfer_cancellation_stays_open;

rollback;
