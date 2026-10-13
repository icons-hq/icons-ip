\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 운영자가 시작하는 배송 전 전액 취소 (ADR-0018, 2026-10-12 점검 OPS-8·OPS-5·REF-1)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 시작 RPC는 staff 세션 전용이고 구매자·익명·service_role은 실행할 수 없다
--   · 모든 배송 건이 발송 전인 paid·confirmed 토스 결제 주문만 열린다
--   · 출고지시가 나간 배송 건이 있으면 창고 출고 중단 확인을 요구한다
--   · 사유·메모·운영자·확인 여부가 요청과 감사 로그에 남고, 구매자에게 알린다
--   · 고객 취소와 같은 원장 구조를 만들고 같은 완료 RPC로 재고·결제를 정확히 한 번 닫는다
--   · 고객 직접 신청 정책(ADR-0017)은 바뀌지 않는다
--   · 운영자 취소는 reason_type 'staff'로 남아 구매자 단순 변심과 갈리고, 운영 읽기
--     RPC(클레임 목록·상세·주문 통합검색·통계)가 운영 사유와 정합화 오류 코드를 싣는다
--     (브라우저 QA QA-4·QA-10)
-- ============================================================================

select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_start_order_cancellation(uuid,text,text,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.admin_start_order_cancellation(uuid,text,text,boolean)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_start_order_cancellation(uuid,text,text,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'private.order_cancel_eligible(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.order_cancel_eligible(uuid)', 'execute')
) then 1 else 0 end as assert_staff_cancellation_acl;

-- 운영 사유·처리자는 구매자 컬럼 grant 밖이다.
select 1 / case when (
  not has_column_privilege('authenticated', 'public.order_cancellation_requests', 'staff_note', 'select')
  and not has_column_privilege('authenticated', 'public.order_cancellation_requests', 'initiated_by', 'select')
  and not has_column_privilege('authenticated', 'public.order_cancellation_requests', 'staff_reason_code', 'select')
) then 1 else 0 end as assert_staff_reason_is_not_buyer_readable;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000c5d01', 'authenticated', 'authenticated', 'staff-cancel-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000c5d02', 'authenticated', 'authenticated', 'staff-cancel-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000c5d01', 'staff-cancel-buyer@example.test', 'staff_cancel_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role),
  ('00000000-0000-4000-8000-0000000c5d02', 'staff-cancel-staff@example.test', 'staff_cancel_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'::public.user_role)
on conflict (id) do update set role = excluded.role, nickname = excluded.nickname;

insert into public.ips (id, title, vertical_key) values ('staff-cancel-ip', '운영자 취소 IP', 'character');
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('staff-cancel-goods', 'staff-cancel-ip', '운영자 취소 굿즈', '문구', 10000, 'ok', 20);

insert into public.orders (id, user_id, status, total, address, confirmed_at)
values
  -- E: 발주확인 + 출고지시 나감(미발송)
  ('61000000-0000-4000-8000-0000000c5d01', '00000000-0000-4000-8000-0000000c5d01', 'confirmed', 10000, '{}'::jsonb, now() - interval '1 hour'),
  -- P: 발주확인 전 paid, 출고지시 없음
  ('61000000-0000-4000-8000-0000000c5d02', '00000000-0000-4000-8000-0000000c5d01', 'paid', 10000, '{}'::jsonb, null),
  -- S: 발주확인 + 한 배송 건 발송됨
  ('61000000-0000-4000-8000-0000000c5d03', '00000000-0000-4000-8000-0000000c5d01', 'confirmed', 10000, '{}'::jsonb, now() - interval '1 hour'),
  -- K: Korpay 결제 발주확인
  ('61000000-0000-4000-8000-0000000c5d04', '00000000-0000-4000-8000-0000000c5d01', 'confirmed', 10000, '{}'::jsonb, now() - interval '1 hour'),
  -- C: 고객 취소 클레임이 이미 진행 중
  ('61000000-0000-4000-8000-0000000c5d05', '00000000-0000-4000-8000-0000000c5d01', 'paid', 10000, '{}'::jsonb, null),
  -- N: 발주확인 주문 — 고객 직접 취소는 계속 닫혀 있어야 한다
  ('61000000-0000-4000-8000-0000000c5d06', '00000000-0000-4000-8000-0000000c5d01', 'confirmed', 10000, '{}'::jsonb, now() - interval '1 hour');

insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, variant_id)
select o.id, 'staff-cancel-goods', 1, 10000, '운영자 취소 굿즈', '문구', 'staff-cancel-ip',
  (select id from public.goods_variants where good_id = 'staff-cancel-goods' and is_default)
from public.orders o where o.user_id = '00000000-0000-4000-8000-0000000c5d01';

insert into public.fulfillment_origins (id, code, name, base_fee, return_address)
values ('00000000-0000-4000-8000-0000000c5d20', 'staff-cancel-test', '운영자 취소 검증 창고', 0, '합성 반송 주소 5d20');
insert into public.order_shipments (order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot, status, carrier, tracking_number, shipped_at, exported_at)
select o.id, '00000000-0000-4000-8000-0000000c5d20', '운영자 취소 검증 창고', 0, '{}',
  case when o.id = '61000000-0000-4000-8000-0000000c5d03' then 'shipping' else 'ready' end,
  case when o.id = '61000000-0000-4000-8000-0000000c5d03' then 'hanjin' end,
  case when o.id = '61000000-0000-4000-8000-0000000c5d03' then 'STAFFCANCEL503' end,
  case when o.id = '61000000-0000-4000-8000-0000000c5d03' then now() - interval '10 minutes' end,
  case when o.id in ('61000000-0000-4000-8000-0000000c5d01', '61000000-0000-4000-8000-0000000c5d03') then now() - interval '30 minutes' end
from public.orders o where o.user_id = '00000000-0000-4000-8000-0000000c5d01';
insert into public.order_shipment_items (order_id, shipment_id, order_item_id, qty)
select i.order_id, s.id, i.id, i.qty
from public.order_items i join public.order_shipments s on s.order_id = i.order_id
where s.origin_id = '00000000-0000-4000-8000-0000000c5d20';

insert into public.payments (id, user_id, purpose, ref_id, amount, status, payment_key, idempotency_key, provider)
values
  ('62000000-0000-4000-8000-0000000c5d01', '00000000-0000-4000-8000-0000000c5d01', 'order', '61000000-0000-4000-8000-0000000c5d01', 10000, 'paid', 'pk_staff_cancel_e', 'idem_staff_cancel_e', 'toss'),
  ('62000000-0000-4000-8000-0000000c5d02', '00000000-0000-4000-8000-0000000c5d01', 'order', '61000000-0000-4000-8000-0000000c5d02', 10000, 'paid', 'pk_staff_cancel_p', 'idem_staff_cancel_p', 'toss'),
  ('62000000-0000-4000-8000-0000000c5d03', '00000000-0000-4000-8000-0000000c5d01', 'order', '61000000-0000-4000-8000-0000000c5d03', 10000, 'paid', 'pk_staff_cancel_s', 'idem_staff_cancel_s', 'toss'),
  ('62000000-0000-4000-8000-0000000c5d04', '00000000-0000-4000-8000-0000000c5d01', 'order', '61000000-0000-4000-8000-0000000c5d04', 10000, 'paid', 'pk_staff_cancel_k', 'idem_staff_cancel_k', 'korpay'),
  ('62000000-0000-4000-8000-0000000c5d05', '00000000-0000-4000-8000-0000000c5d01', 'order', '61000000-0000-4000-8000-0000000c5d05', 10000, 'paid', 'pk_staff_cancel_c', 'idem_staff_cancel_c', 'toss'),
  ('62000000-0000-4000-8000-0000000c5d06', '00000000-0000-4000-8000-0000000c5d01', 'order', '61000000-0000-4000-8000-0000000c5d06', 10000, 'paid', 'pk_staff_cancel_n', 'idem_staff_cancel_n', 'toss');

-- C: 고객이 이미 하자 취소를 접수해 운영 판단 대기 중이다.
set local role service_role;
select 1 / case when public.request_order_claim(
  '61000000-0000-4000-8000-0000000c5d05', '00000000-0000-4000-8000-0000000c5d01',
  'cancel', '상품 하자·오배송 취소', 'defect'
) = 'requested' then 1 else 0 end as assert_customer_claim_fixture_is_pending_staff;

-- N: 발주확인 뒤 고객 직접 취소는 그대로 닫혀 있다(ADR-0017).
select 1 / case when public.request_order_claim(
  '61000000-0000-4000-8000-0000000c5d06', '00000000-0000-4000-8000-0000000c5d01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
) = 'not_cancelable' then 1 else 0 end as assert_customer_cancel_after_confirmation_stays_closed;
reset role;

-- ---------------------------------------------------------------------------
-- 권한·입력 가드
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000c5d01', true);
do $buyer_guard$
declare rejected boolean := false;
begin
  begin
    perform public.admin_start_order_cancellation('61000000-0000-4000-8000-0000000c5d02', 'customer_request', null, false);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'buyer started a staff cancellation'; end if;
end;
$buyer_guard$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000c5d02', true);
do $staff_guards$
declare
  v_code text;
  v_expected text[] := array[
    'invalid_staff_cancellation_reason',
    'invalid_staff_cancellation_note',
    'warehouse_stop_confirmation_required',
    'shipment_already_dispatched',
    'staff_cancellation_toss_only',
    'order_claim_in_progress'
  ];
  v_actual text[] := array[]::text[];
begin
  begin perform public.admin_start_order_cancellation('61000000-0000-4000-8000-0000000c5d02', 'refund_anyway', null, false);
  exception when check_violation then get stacked diagnostics v_code = message_text; v_actual := v_actual || v_code; end;
  begin perform public.admin_start_order_cancellation('61000000-0000-4000-8000-0000000c5d02', 'other', null, false);
  exception when check_violation then get stacked diagnostics v_code = message_text; v_actual := v_actual || v_code; end;
  begin perform public.admin_start_order_cancellation('61000000-0000-4000-8000-0000000c5d01', 'out_of_stock', null, false);
  exception when check_violation then get stacked diagnostics v_code = message_text; v_actual := v_actual || v_code; end;
  begin perform public.admin_start_order_cancellation('61000000-0000-4000-8000-0000000c5d03', 'out_of_stock', null, true);
  exception when check_violation then get stacked diagnostics v_code = message_text; v_actual := v_actual || v_code; end;
  begin perform public.admin_start_order_cancellation('61000000-0000-4000-8000-0000000c5d04', 'out_of_stock', null, false);
  exception when check_violation then get stacked diagnostics v_code = message_text; v_actual := v_actual || v_code; end;
  begin perform public.admin_start_order_cancellation('61000000-0000-4000-8000-0000000c5d05', 'customer_request', null, false);
  exception when check_violation then get stacked diagnostics v_code = message_text; v_actual := v_actual || v_code; end;
  if v_actual is distinct from v_expected then
    raise exception 'staff cancellation guards mismatch: %', v_actual;
  end if;
end;
$staff_guards$;
reset role;

select 1 / case when not exists (
  select 1 from public.order_cancellation_requests r
  where r.origin = 'staff'
    and r.order_id in (
      '61000000-0000-4000-8000-0000000c5d01', '61000000-0000-4000-8000-0000000c5d03',
      '61000000-0000-4000-8000-0000000c5d04', '61000000-0000-4000-8000-0000000c5d05'
    )
) then 1 else 0 end as assert_rejected_starts_leave_no_ledger;

-- ---------------------------------------------------------------------------
-- E: 발주확인·출고지시 이후, 창고 중단 확인과 함께 시작 → 같은 완료 경로로 종결
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000c5d02', true);
select public.admin_start_order_cancellation(
  '61000000-0000-4000-8000-0000000c5d01', 'out_of_stock', '창고 재고 불일치로 출고 불가 확인', true
) as staff_request_e \gset
reset role;

select 1 / case when (
  select r.origin = 'staff' and r.claim_type = 'cancel' and r.stage = 'processing' and r.status = 'processing'
    and r.requested_by = '00000000-0000-4000-8000-0000000c5d01'
    and r.initiated_by = '00000000-0000-4000-8000-0000000c5d02'
    and r.decided_by = '00000000-0000-4000-8000-0000000c5d02'
    and r.staff_reason_code = 'out_of_stock'
    and r.staff_note = '창고 재고 불일치로 출고 불가 확인'
    and r.warehouse_stop_confirmed
    and r.reason = '운영자 전액 취소 · 품절·출고 불가'
    and r.reason_type = 'staff'
    and not r.collection_required
    and exists (select 1 from public.order_cancellation_claims c where c.order_id = r.order_id and c.previous_status = 'confirmed')
    and (select count(*) = 1 from public.refunds f where f.cancellation_request_id = r.id and f.status = 'requested')
  from public.order_cancellation_requests r where r.id = :'staff_request_e'
) then 1 else 0 end as assert_staff_start_opens_the_customer_cancellation_ledger;

select 1 / case when (
  select count(*) = 1
    and bool_and(a.actor_id = '00000000-0000-4000-8000-0000000c5d02')
    and bool_and(a.diff->>'reasonCode' = 'out_of_stock')
    and bool_and((a.diff->>'exportedShipmentCount')::int = 1)
    and bool_and((a.diff->>'warehouseStopConfirmed')::boolean)
  from public.audit_log a
  where a.target = 'order:61000000-0000-4000-8000-0000000c5d01' and a.action = 'admin.order.staff_cancellation_started'
) then 1 else 0 end as assert_staff_start_is_audited;

select 1 / case when (
  select count(*) = 1
  from public.notifications n
  where n.user_id = '00000000-0000-4000-8000-0000000c5d01'
    and n.source_id = :'staff_request_e'
    and n.dedupe_key like 'claim:staff_cancel_started:%'
    and n.body like '판매자 사정(품절·출고 불가)%'
) then 1 else 0 end as assert_buyer_is_notified_of_staff_cancellation;

-- 운영 화면은 운영자 취소를 구매자 단순 변심과 구분해 운영 사유로 보여준다(QA-4).
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000c5d02', true);
select 1 / case when (
  exists (
    select 1 from public.admin_search_order_claims('cancel', null, 'staff:out_of_stock', null, null, '61000000-0000-4000-8000-0000000c5d01', 20, 0) c
    where c.id = :'staff_request_e' and c.reason_type = 'staff' and c.staff_reason_code = 'out_of_stock'
  )
  and exists (
    select 1 from public.admin_search_order_claims('cancel', null, 'staff', null, null, '61000000-0000-4000-8000-0000000c5d01', 20, 0) c
    where c.id = :'staff_request_e'
  )
  and not exists (
    select 1 from public.admin_search_order_claims('cancel', null, 'change_of_mind', null, null, '61000000-0000-4000-8000-0000000c5d01', 20, 0)
  )
  and not exists (
    select 1 from public.admin_search_order_claims('cancel', null, 'staff:test_payment_cleanup', null, null, '61000000-0000-4000-8000-0000000c5d01', 20, 0)
  )
  -- 구매자 하자 취소는 운영 사유 코드 없이 구매자 사유로 남는다.
  and exists (
    select 1 from public.admin_search_order_claims('cancel', null, 'defect', null, null, '61000000-0000-4000-8000-0000000c5d05', 20, 0) c
    where c.staff_reason_code is null
  )
) then 1 else 0 end as assert_claim_list_separates_staff_reason;

do $reason_filter_guard$
declare rejected boolean := false;
begin
  begin
    perform public.admin_search_order_claims('cancel', null, 'staff:refund_anyway', null, null, null, 20, 0);
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'unknown claim reason filter was accepted'; end if;
end;
$reason_filter_guard$;

select 1 / case when (
  select detail -> 'claim' ->> 'reasonType' = 'staff'
    and detail -> 'claim' ->> 'origin' = 'staff'
    and detail -> 'claim' ->> 'staffReasonCode' = 'out_of_stock'
    and detail -> 'claim' ->> 'staffNote' = '창고 재고 불일치로 출고 불가 확인'
  from (select public.admin_order_claim_detail(:'staff_request_e') as detail) as loaded
) then 1 else 0 end as assert_claim_detail_carries_staff_reason;

select 1 / case when exists (
  select 1 from public.admin_search_orders(p_field := 'order', p_query := '61000000-0000-4000-8000-0000000c5d01') o
  where o.cancellation_request_id = :'staff_request_e'
    and o.cancellation_reason_type = 'staff'
    and o.cancellation_staff_reason_code = 'out_of_stock'
    and o.cancellation_last_error_code is null
) then 1 else 0 end as assert_order_search_carries_staff_reason;

select 1 / case when exists (
  select 1
  from jsonb_array_elements(public.admin_claims_report(now() - interval '1 day', now() + interval '1 day') -> 'byReason') as entry
  where entry ->> 'claimType' = 'cancel'
    and entry ->> 'reasonType' = 'staff'
    and entry ->> 'staffReasonCode' = 'out_of_stock'
    and (entry ->> 'total')::int >= 1
) and exists (
  select 1
  from jsonb_array_elements(public.admin_claims_report(now() - interval '1 day', now() + interval '1 day') -> 'byReason') as entry
  where entry ->> 'reasonType' = 'defect'
    and entry -> 'staffReasonCode' = 'null'::jsonb
) then 1 else 0 end as assert_claim_report_splits_staff_reasons;
reset role;

-- 구매자 발원 요청은 운영자 취소 사유를 가질 수 없다.
do $customer_staff_reason_guard$
declare rejected boolean := false;
begin
  begin
    update public.order_cancellation_requests set reason_type = 'staff'
    where order_id = '61000000-0000-4000-8000-0000000c5d05';
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'customer request accepted the staff reason type'; end if;
end;
$customer_staff_reason_guard$;

-- 진행 중에는 다른 접수·발송이 끼어들지 못한다.
set local role service_role;
select 1 / case when public.request_order_claim(
  '61000000-0000-4000-8000-0000000c5d01', '00000000-0000-4000-8000-0000000c5d01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
) = 'already_requested' then 1 else 0 end as assert_customer_duplicate_is_absorbed;

select 1 / case when public.assert_order_cancellation_reconciliation_allowed(:'staff_request_e', '00000000-0000-4000-8000-0000000c5d02') = 'allowed'
  then 1 else 0 end as assert_staff_request_passes_reconciliation_preflight;

select public.complete_order_cancellation_request(:'staff_request_e', array['pk_staff_cancel_e'], '00000000-0000-4000-8000-0000000c5d02');
reset role;

select 1 / case when (
  select o.status = 'canceled' and r.status = 'completed' and p.status = 'refunded'
    and f.status = 'done' and f.method = 'pg_cancel'
    and not exists (select 1 from public.order_shipments s where s.order_id = o.id and s.status <> 'canceled')
    and not exists (select 1 from public.order_cancellation_claims c where c.order_id = o.id)
  from public.orders o
  join public.order_cancellation_requests r on r.order_id = o.id
  join public.payments p on p.ref_id = o.id and p.purpose = 'order'
  join public.refunds f on f.payment_id = p.id
  where o.id = '61000000-0000-4000-8000-0000000c5d01'
) then 1 else 0 end as assert_staff_cancellation_completes_through_the_finalizer;

select 1 / case when (
  select stock_qty = 21 from public.goods_variants where good_id = 'staff-cancel-goods' and is_default
) then 1 else 0 end as assert_staff_cancellation_restores_stock_once;

-- ---------------------------------------------------------------------------
-- P: 발주확인 전 paid — 진행 중 발주확인 차단, needs_review → 재시도
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000c5d02', true);
select public.admin_start_order_cancellation(
  '61000000-0000-4000-8000-0000000c5d02', 'test_payment_cleanup', null, false
) as staff_request_p \gset

do $dispatch_guard$
declare blocked boolean := false;
begin
  begin
    perform public.admin_update_order_status('61000000-0000-4000-8000-0000000c5d02', 'confirmed', null, null);
  exception when others then
    blocked := sqlerrm like '%cancellation in progress%';
  end;
  if not blocked then raise exception 'order confirmation was not blocked during a staff cancellation'; end if;
end;
$dispatch_guard$;
reset role;

set local role service_role;
select public.mark_order_cancellation_needs_review(:'staff_request_p', '00000000-0000-4000-8000-0000000c5d02', 'provider_unavailable');
reset role;

select 1 / case when (
  select o.status = 'paid' and r.status = 'needs_review' and not r.warehouse_stop_confirmed
  from public.orders o join public.order_cancellation_requests r on r.order_id = o.id
  where r.id = :'staff_request_p'
) then 1 else 0 end as assert_failed_staff_cancellation_keeps_the_order;

-- 주문 패널은 결제확인필요 요청의 정합화 오류 코드를 함께 받는다(QA-10).
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000c5d02', true);
select 1 / case when exists (
  select 1 from public.admin_search_orders(p_field := 'order', p_query := '61000000-0000-4000-8000-0000000c5d02') o
  where o.cancellation_request_id = :'staff_request_p'
    and o.cancellation_request_status = 'needs_review'
    and o.cancellation_staff_reason_code = 'test_payment_cleanup'
    and o.cancellation_last_error_code = 'provider_unavailable'
) then 1 else 0 end as assert_order_search_carries_reconciliation_error_code;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000c5d02', true);
select public.admin_begin_order_cancellation_reconcile(:'staff_request_p');
reset role;
set local role service_role;
select public.complete_order_cancellation_request(:'staff_request_p', array['pk_staff_cancel_p'], '00000000-0000-4000-8000-0000000c5d02');
reset role;

select 1 / case when (
  select o.status = 'canceled' and r.status = 'completed'
    and (select stock_qty = 22 from public.goods_variants where good_id = 'staff-cancel-goods' and is_default)
  from public.orders o join public.order_cancellation_requests r on r.order_id = o.id
  where r.id = :'staff_request_p'
) then 1 else 0 end as assert_staff_cancellation_retry_completes_once;

-- ---------------------------------------------------------------------------
-- 고객 직접 신청 경계는 그대로다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000c5d01', true);
select 1 / case when (public.order_claim_eligibility('61000000-0000-4000-8000-0000000c5d06')->>'cancel')::boolean = false
  then 1 else 0 end as assert_customer_eligibility_after_confirmation_is_closed;
reset role;

rollback;
