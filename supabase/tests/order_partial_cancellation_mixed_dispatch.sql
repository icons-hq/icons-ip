\set ON_ERROR_STOP on
-- 혼합 출고지 주문의 일부 발송 뒤 재고 부족 부분 취소(원장 #15 SHP-010, ADR-0032 보완 2026-11-19). 합성 주문만 쓰고 끝에 되돌린다.
--  1. 김포(출고지 1) 배송 건이 발송된 주문: 운영자 전액 취소는 그대로 막힌다. 부분 취소는 열리고, 발송된 배송 건의
--     품목은 shipment_dispatched로 막힌다. 남양주(출고지 2) 몫을 고르면 그 배송 건이 닫혀 배송비를 함께 환불한다.
--  2. 토스: 처리 중에는 배송 중 반품·교환 접수가 막히고, 확인 뒤 재고 복원·배송 건 취소, 주문은 배송중 그대로(발송 시각 유지).
--     김포 배송완료 뒤 주문이 배송완료가 되고 구매확정 정책을 포착한다. 뒤의 반품 환불액은 남은 잔액이다.
--  3. 김포가 이미 배송완료인 주문: 부분 취소 적용과 함께 주문이 배송완료(김포 도착 시각)로 넘어가고 구매확정 정책을 포착한다.
--  4. 무통장: 시작 때 적용·송금 대기, 송금 증빙으로 완료. 버전 1 주문: 첫 부분 취소 때 배분 원장을 얼리고 합계를 지킨다.
--  5. 남양주 수량 일부만 취소: 배송 건이 남아 배송비는 환불하지 않고 적립금 몫만 되돌린다. 남은 수량은 그대로 발송된다.
--  6. 막힘: 모든 배송 건 발송(shipment_already_dispatched)·주문 배송완료(order_not_partial_cancelable).
--  7. 결제확인필요 → 해소(이미 취소됨): 그 사이 김포가 배송완료면 적용과 함께 주문이 배송완료가 된다.
begin;
update public.shipping_carriers set tracking_number_pattern=null,tracking_number_rule=null where tracking_number_pattern is not null;
create function pg_temp.md_id(kind text, n integer) returns uuid language sql immutable as $$select md5('partial-mixed:'||kind||':'||n)::uuid$$;
create function pg_temp.md_assert(ok boolean, label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Mixed dispatch partial cancellation assertion failed: %', label; end if; end $$;
create function pg_temp.md_error(q text, expected text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if sqlstate = expected or sqlerrm = expected then return; end if; raise; end;
 raise exception 'Expected mixed dispatch rejection: %', expected; end $$;
create function pg_temp.md_auth(actor integer default 1) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub', '', true);
 perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.md_id('user', actor),
  'session_id', pg_temp.md_id('session', actor))::text, true);
end $$;
grant execute on function pg_temp.md_id(text, integer), pg_temp.md_assert(boolean, text), pg_temp.md_error(text, text), pg_temp.md_auth(integer) to authenticated, service_role;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
 select pg_temp.md_id('user', n), 'authenticated', 'authenticated', 'partial-mixed-'||n||'@example.test', clock_timestamp(), '{}', '{}' from generate_series(1, 2) n;
insert into auth.sessions(id, user_id, created_at, updated_at, not_after)
 select pg_temp.md_id('session', n), pg_temp.md_id('user', n), clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 hour' from generate_series(1, 2) n;
update public.profiles set nickname = 'TEST 혼합부분취소 '||right(id::text, 6),
 role = case when id = pg_temp.md_id('user', 1) then 'admin'::public.user_role else 'user'::public.user_role end
 where id in (select pg_temp.md_id('user', n) from generate_series(1, 2) n);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.md_id('user', 1), 'primary');
insert into public.fulfillment_origins(id, code, name, default_carrier, base_fee, return_address, is_active)
 select pg_temp.md_id('origin', n), 'partial-mixed-origin-'||n, case n when 1 then 'TEST 김포' else 'TEST 남양주' end, 'hanjin', 3000, 'TEST 반품 주소', true
 from generate_series(1, 2) n;
insert into public.ips(id, title, vertical_key) values ('partial-mixed-ip', 'TEST 혼합 부분취소 IP', 'character');
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty, origin_id) values
 ('partial-mixed-a', 'partial-mixed-ip', 'TEST 김포 상품 A', '문구', 10000, 'ok', 20, pg_temp.md_id('origin', 1)),
 ('partial-mixed-b', 'partial-mixed-ip', 'TEST 김포 상품 B', '문구', 10000, 'ok', 20, pg_temp.md_id('origin', 1)),
 ('partial-mixed-c', 'partial-mixed-ip', 'TEST 남양주 품절 상품 C', '문구', 5000, 'ok', 20, pg_temp.md_id('origin', 2));
create function pg_temp.md_stock(good text) returns integer language sql as $$
 select stock_qty from public.goods_variants where good_id = good and is_default$$;
grant execute on function pg_temp.md_stock(text) to authenticated;

-- 주문 n: 김포 배송 건(A 2개·B 1개, A 쿠폰 1,000원) + 남양주 배송 건(C c_qty개, C 적립금 credit원). 배송비 배송 건마다 3,000원.
-- version 2: 결제 = 34,000 + 5,000×c_qty − credit + 6,000. version 1(쿠폰·적립금 없음): 결제 = 35,000 + 5,000×c_qty + 6,000(배분 원장은 첫 부분 취소 때 얼린다).
create function pg_temp.md_order(n integer, provider text, version integer default 2, c_qty integer default 1, credit bigint default 0) returns void language plpgsql as $$
declare coupon bigint := case when version = 2 then 1000 else 0 end; total bigint; lot uuid;
begin
 total := 30000 - coupon + 5000 * c_qty - credit + 6000;
 insert into public.orders(id, user_id, status, total, shipping_fee, discount_total, store_credit_total, calculation_version, address, payment_method,
   created_at, confirmed_at, shipping_fee_breakdown)
 values (pg_temp.md_id('order', n), pg_temp.md_id('user', 2), 'confirmed', total, 6000, coupon, credit, 1,
   '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
   (case when provider = 'bank_transfer' then 'bank_transfer' else 'card' end)::public.order_payment_method,
   '2031-03-01T03:00:00Z'::timestamptz, clock_timestamp() - interval '1 hour',
   (select jsonb_agg(jsonb_build_object('originId', pg_temp.md_id('origin', o), 'originName', case o when 1 then 'TEST 김포' else 'TEST 남양주' end, 'totalFee', 3000) order by o)
     from generate_series(1, 2) o));
 insert into public.order_items(id, order_id, good_id, variant_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
 select pg_temp.md_id('item-'||right(g.id, 1), n), pg_temp.md_id('order', n), g.id, v.id,
   case g.id when 'partial-mixed-a' then 2 when 'partial-mixed-c' then c_qty else 1 end, g.price, g.name, '문구', 'partial-mixed-ip'
 from public.goods g join public.goods_variants v on v.good_id = g.id and v.is_default where g.id like 'partial-mixed-%';
 if version = 2 then
  update public.orders set calculation_version = 2 where id = pg_temp.md_id('order', n);
  insert into private.order_price_allocations(order_item_id, order_id, calculation_version, subtotal, volume_discount, net_subtotal, coupon_discount, store_credit_discount, paid_goods_total)
  values (pg_temp.md_id('item-a', n), pg_temp.md_id('order', n), 2, 20000, 0, 20000, 1000, 0, 19000),
   (pg_temp.md_id('item-b', n), pg_temp.md_id('order', n), 2, 10000, 0, 10000, 0, 0, 10000),
   (pg_temp.md_id('item-c', n), pg_temp.md_id('order', n), 2, 5000 * c_qty, 0, 5000 * c_qty, 0, credit, 5000 * c_qty - credit);
 end if;
 insert into public.order_shipments(id, order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot)
 select pg_temp.md_id('shipment-'||o, n), pg_temp.md_id('order', n), pg_temp.md_id('origin', o), case o when 1 then 'TEST 김포' else 'TEST 남양주' end, 3000,
   jsonb_build_object('originId', pg_temp.md_id('origin', o), 'originName', case o when 1 then 'TEST 김포' else 'TEST 남양주' end, 'totalFee', 3000)
 from generate_series(1, 2) o;
 insert into public.order_shipment_items(order_id, shipment_id, order_item_id, qty)
 select i.order_id, pg_temp.md_id('shipment-'||case when i.good_id = 'partial-mixed-c' then 2 else 1 end, n), i.id, i.qty
 from public.order_items i where i.order_id = pg_temp.md_id('order', n);
 if credit > 0 then
  lot := private.issue_store_credit_lot(pg_temp.md_id('user', 2), credit, clock_timestamp() + interval '90 days', 'admin', null, pg_temp.md_id('user', 1),
    pg_temp.md_id('credit-op', n), 'TEST 혼합 적립금');
  update private.store_credit_lots set available_amount = available_amount - credit, spent_amount = spent_amount + credit where id = lot;
  insert into private.store_credit_allocations(order_id, user_id, lot_id, amount, state, original_expires_at, restore_grace_days, consumed_at)
  select pg_temp.md_id('order', n), pg_temp.md_id('user', 2), id, credit, 'consumed', expires_at, 30, clock_timestamp() from private.store_credit_lots where id = lot;
 end if;
 insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 values (pg_temp.md_id('payment', n), pg_temp.md_id('user', 2), provider::public.payment_provider, 'order', pg_temp.md_id('order', n), total, 'paid',
   case when provider = 'bank_transfer' then 'bank_transfer:'||pg_temp.md_id('order', n) else 'TEST-MD-KEY-'||n end, 'partial-mixed-payment-'||n, clock_timestamp() - interval '2 hours');
 insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values (pg_temp.md_id('attempt', n), provider::public.payment_provider, pg_temp.md_id('user', 2), 'order', pg_temp.md_id('order', n), total, 'KRW', 'approved',
   'partial-mixed-attempt-'||n, 'TEST-MD-ORDER-'||n, 'TEST-MD-PRODUCT-'||n, pg_temp.md_id('payment', n), clock_timestamp() + interval '1 hour');
end $$;
-- 배송 건 발송·배송완료(운송장 연동과 같은 열을 직접 바꾼다 — 배송 건 상태 갱신 트리거가 주문 상태를 다시 센다).
create function pg_temp.md_ship(n integer, origin integer) returns void language sql as $$
 update public.order_shipments set status = 'shipping', carrier = 'hanjin', tracking_number = 'TESTMD'||lpad((n * 10 + origin)::text, 8, '0'),
  shipped_at = clock_timestamp() - interval '2 days' where id = pg_temp.md_id('shipment-'||origin, n)$$;
create function pg_temp.md_deliver(n integer, origin integer) returns void language sql as $$
 update public.order_shipments set status = 'delivered', delivered_at = clock_timestamp() - interval '1 day' where id = pg_temp.md_id('shipment-'||origin, n)$$;
create function pg_temp.md_items(spec text) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('orderItemId', pg_temp.md_id('item-'||split_part(part, ':', 1), split_part(spec, '@', 2)::integer),
   'qty', split_part(part, ':', 2)::integer))
 from unnest(string_to_array(split_part(spec, '@', 1), ',')) part$$;
create function pg_temp.md_start(spec text, op integer, expected bigint, account jsonb default null) returns jsonb language sql as $$
 select public.admin_start_order_partial_cancellation(pg_temp.md_id('order', split_part(spec, '@', 2)::integer), pg_temp.md_items(spec),
  'TEST 11/19 통화 — 남양주 품절분만 취소하고 김포분은 그대로 받기', null, false, expected, pg_temp.md_id('operation', op), account)$$;
create function pg_temp.md_head(op integer) returns private.order_partial_cancellations language sql security definer as $$
 select * from private.order_partial_cancellations where operation_id = pg_temp.md_id('operation', op)$$;
create function pg_temp.md_order_row(n integer) returns public.orders language sql security definer as $$
 select * from public.orders where id = pg_temp.md_id('order', n)$$;
grant execute on function pg_temp.md_items(text), pg_temp.md_start(text, integer, bigint, jsonb), pg_temp.md_head(integer), pg_temp.md_order_row(integer) to authenticated;

select pg_temp.md_order(1, 'toss'), pg_temp.md_order(2, 'toss'), pg_temp.md_order(3, 'bank_transfer'), pg_temp.md_order(4, 'toss', 1),
 pg_temp.md_order(5, 'toss', 2, 2, 2000), pg_temp.md_order(6, 'toss'), pg_temp.md_order(7, 'toss'), pg_temp.md_order(8, 'toss');
select pg_temp.md_ship(n, 1) from unnest(array[1, 2, 3, 4, 5, 6, 7, 8]) n;
select pg_temp.md_deliver(2, 1);
select pg_temp.md_ship(6, 2), pg_temp.md_ship(7, 2);
select pg_temp.md_deliver(7, 1), pg_temp.md_deliver(7, 2);
update private.return_fee_deduction_settings set partial_cancel_enabled = true, partial_cancel_evidence = 'TEST 혼합 출고지 부분 취소 시험',
 partial_cancel_enabled_at = clock_timestamp() where singleton;
-- END FIXTURE

select pg_temp.md_assert((select status = 'shipping' and shipped_at is not null and delivered_at is null from public.orders where id = pg_temp.md_id('order', 1))
 and (select status = 'shipping' from public.orders where id = pg_temp.md_id('order', 2))
 and (select status = 'delivered' from public.orders where id = pg_temp.md_id('order', 7)), 'fixture_orders_partially_dispatched');

-- 1. 막힘과 열림 ---------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.md_auth();
-- 운영자 전액 취소는 그대로 막힌다(ADR-0018 — 배송중 주문은 order_not_staff_cancelable). 발송 전 몫은 재고 부족 부분 취소로 간다.
select pg_temp.md_error($$select public.admin_start_order_cancellation(pg_temp.md_id('order', 1), 'out_of_stock', null, false)$$, 'order_not_staff_cancelable');
select pg_temp.md_assert((select context->'blockers' = '[]'::jsonb and (context->>'balance')::bigint = 40000
   and (select item->>'blocker' from jsonb_array_elements(context->'items') item where item->>'orderItemId' = pg_temp.md_id('item-a', 1)::text) = 'shipment_dispatched'
   and (select item->>'blocker' from jsonb_array_elements(context->'items') item where item->>'orderItemId' = pg_temp.md_id('item-b', 1)::text) = 'shipment_dispatched'
   and (select item->'blocker' from jsonb_array_elements(context->'items') item where item->>'orderItemId' = pg_temp.md_id('item-c', 1)::text) = 'null'::jsonb
  from (select public.admin_order_partial_cancellation_context(pg_temp.md_id('order', 1)) context) s), 'context_opens_unsent_origin_only');
select pg_temp.md_error($$select public.admin_preview_order_partial_cancellation(pg_temp.md_id('order', 1), pg_temp.md_items('a:1@1'))$$, 'partial_cancel_item_shipment_dispatched');
select pg_temp.md_error($$select public.admin_preview_order_partial_cancellation(pg_temp.md_id('order', 1), pg_temp.md_items('a:1,c:1@1'))$$, 'partial_cancel_item_shipment_dispatched');
select pg_temp.md_assert((select plan @> '{"provider": "toss", "goodsRefundAmount": 5000, "shippingRefundAmount": 3000, "refundAmount": 8000,
   "balanceBefore": 40000, "balanceAfter": 32000, "remainingQty": 3}'
   and jsonb_array_length(plan->'closedShipments') = 1 and plan#>>'{closedShipments,0,shipmentId}' = pg_temp.md_id('shipment-2', 1)::text
  from (select public.admin_preview_order_partial_cancellation(pg_temp.md_id('order', 1), pg_temp.md_items('c:1@1')) plan) s), 'preview_closes_unsent_origin_with_its_fee');
-- 모든 배송 건 발송·배송완료 주문은 계속 막힌다.
select pg_temp.md_assert(public.admin_order_partial_cancellation_context(pg_temp.md_id('order', 6))->'blockers' = '["shipment_already_dispatched"]'::jsonb
 and public.admin_order_partial_cancellation_context(pg_temp.md_id('order', 7))->'blockers' ? 'order_not_partial_cancelable', 'fully_dispatched_orders_stay_blocked');
select pg_temp.md_error($$select public.admin_preview_order_partial_cancellation(pg_temp.md_id('order', 6), pg_temp.md_items('c:1@6'))$$, 'shipment_already_dispatched');

-- 2. 토스: 처리 중 → 확인 → 김포 배송완료 ----------------------------------------------------------------------------------------
select pg_temp.md_assert(pg_temp.md_start('c:1@1', 1, 8000) @> '{"state": "processing", "refundAmount": 8000, "replayed": false}', 'start_processing_after_partial_dispatch');
reset role;
select pg_temp.md_assert(not private.order_return_intake_eligible(pg_temp.md_id('order', 1)), 'in_flight_blocks_in_transit_claim_intake');
select pg_temp.md_error($$select pg_temp.md_ship(1, 2)$$, 'order cancellation in progress');
select pg_temp.md_assert(public.service_complete_order_partial_cancellation((pg_temp.md_head(1)).id, 8000, 'TEST-MD-KEY-1', 'TEST-MD-TX-1', pg_temp.md_id('user', 1)) = 'completed',
 'complete_after_partial_dispatch');
select pg_temp.md_assert(pg_temp.md_stock('partial-mixed-c') = 21
 and (select status = 'canceled' from public.order_shipments where id = pg_temp.md_id('shipment-2', 1))
 and private.shipment_closed_by_partial_cancel(pg_temp.md_id('shipment-2', 1))
 and (select status = 'shipping' and shipped_at = (select shipped_at from public.order_shipments where id = pg_temp.md_id('shipment-1', 1)) and delivered_at is null
   from public.orders where id = pg_temp.md_id('order', 1))
 and private.payment_partial_refunded_amount(pg_temp.md_id('payment', 1)) = 8000
 and private.claim_refund_settled_amount(pg_temp.md_id('payment', 1)) = 32000
 and private.order_return_intake_eligible(pg_temp.md_id('order', 1))
 and not exists(select 1 from private.order_purchase_confirmations where order_id = pg_temp.md_id('order', 1)),
 'applied_closes_unsent_origin_and_keeps_order_shipping');
-- 김포가 도착하면 닫힌 배송 건을 빼고 주문이 배송완료가 되고 구매확정 정책을 포착한다.
select pg_temp.md_deliver(1, 1);
select pg_temp.md_assert((select status = 'delivered' and delivered_at = (select delivered_at from public.order_shipments where id = pg_temp.md_id('shipment-1', 1))
   from public.orders where id = pg_temp.md_id('order', 1))
 and exists(select 1 from private.order_purchase_confirmations where order_id = pg_temp.md_id('order', 1))
 and private.order_all_items_delivered(pg_temp.md_id('order', 1)), 'later_delivery_completes_order_without_closed_shipment');

-- 3. 김포가 이미 배송완료: 적용과 함께 주문이 배송완료로 넘어간다 ---------------------------------------------------------------
set local role authenticated;
select pg_temp.md_auth();
select pg_temp.md_assert(pg_temp.md_start('c:1@2', 2, 8000) @> '{"state": "processing"}', 'start_with_other_origin_delivered');
reset role;
select public.service_complete_order_partial_cancellation((pg_temp.md_head(2)).id, 8000, 'TEST-MD-KEY-2', 'TEST-MD-TX-2', pg_temp.md_id('user', 1));
select pg_temp.md_assert((select status = 'delivered' and delivered_at = (select delivered_at from public.order_shipments where id = pg_temp.md_id('shipment-1', 2))
   from public.orders where id = pg_temp.md_id('order', 2))
 and (select policy_snapshot ? 'autoEnabled' from private.order_purchase_confirmations where order_id = pg_temp.md_id('order', 2))
 and exists(select 1 from public.audit_log where action = 'admin.order.partial_cancellation_applied' and diff->>'partialCancellationId' = (pg_temp.md_head(2)).id::text)
 and private.order_return_intake_eligible(pg_temp.md_id('order', 2)), 'apply_moves_order_to_delivered_and_captures_confirmation_policy');

-- 4. 무통장·버전 1 ---------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.md_auth();
select pg_temp.md_assert(pg_temp.md_start('c:1@3', 3, 8000, '{"bankName":"TEST은행","accountNumber":"12345678","accountHolder":"TEST"}')
 @> '{"state": "awaiting_transfer", "provider": "bank_transfer", "refundAmount": 8000}', 'bank_transfer_applies_at_start_after_partial_dispatch');
select pg_temp.md_assert(pg_temp.md_stock('partial-mixed-c') = 23
 and (select status = 'canceled' from public.order_shipments where id = pg_temp.md_id('shipment-2', 3))
 and (pg_temp.md_order_row(3)).status = 'shipping', 'bank_transfer_closed_unsent_origin');
select pg_temp.md_assert(public.admin_record_order_partial_cancellation_transfer((pg_temp.md_head(3)).id, 'TEST 송금 증빙 11/19', 'TEST 확인 메모', pg_temp.md_id('transfer', 3))
 @> '{"state": "completed"}', 'bank_transfer_completed_by_evidence');
-- 버전 1: 첫 부분 취소가 배분 원장을 얼린다. 남양주 몫 5,000원 + 배송비 3,000원, 남은 잔액 + 환불 = 결제액.
select pg_temp.md_assert((select plan @> '{"goodsRefundAmount": 5000, "shippingRefundAmount": 3000, "refundAmount": 8000, "balanceBefore": 41000, "balanceAfter": 33000}'
  from (select public.admin_preview_order_partial_cancellation(pg_temp.md_id('order', 4), pg_temp.md_items('c:1@4')) plan) s), 'v1_preview_after_partial_dispatch');
select pg_temp.md_start('c:1@4', 4, 8000);
reset role;
select public.service_complete_order_partial_cancellation((pg_temp.md_head(4)).id, 8000, 'TEST-MD-KEY-4', 'TEST-MD-TX-4', pg_temp.md_id('user', 1));
select pg_temp.md_assert(exists(select 1 from private.order_v1_price_allocation_heads where order_id = pg_temp.md_id('order', 4) and payment_amount = 41000)
 and private.payment_partial_refunded_amount(pg_temp.md_id('payment', 4)) + private.claim_refund_settled_amount(pg_temp.md_id('payment', 4)) = 41000
 and (pg_temp.md_order_row(4)).status = 'shipping', 'v1_allocation_frozen_and_sums_hold');

-- 5. 남양주 수량 일부만: 배송 건이 남아 배송비는 그대로, 적립금 몫은 적립금으로 -------------------------------------------------
set local role authenticated;
select pg_temp.md_auth();
select pg_temp.md_assert((select plan @> '{"goodsRefundAmount": 4000, "shippingRefundAmount": 0, "refundAmount": 4000, "storeCreditRestoreAmount": 1000, "closedShipments": []}'
  from (select public.admin_preview_order_partial_cancellation(pg_temp.md_id('order', 5), pg_temp.md_items('c:1@5')) plan) s), 'partial_quantity_keeps_shipment_and_restores_credit_share');
select pg_temp.md_start('c:1@5', 5, 4000);
reset role;
select public.service_complete_order_partial_cancellation((pg_temp.md_head(5)).id, 4000, 'TEST-MD-KEY-5', 'TEST-MD-TX-5', pg_temp.md_id('user', 1));
select pg_temp.md_assert((select qty = 1 from public.order_shipment_items where order_item_id = pg_temp.md_id('item-c', 5))
 and (select status = 'ready' from public.order_shipments where id = pg_temp.md_id('shipment-2', 5))
 and (select coalesce(sum(amount), 0) = 1000 from private.store_credit_allocations where order_id = pg_temp.md_id('order', 5) and state = 'consumed')
 and (pg_temp.md_order_row(5)).status = 'shipping', 'partial_quantity_applied');
-- 남은 1개는 그대로 발송·도착하고 주문이 배송완료가 된다.
select pg_temp.md_ship(5, 2), pg_temp.md_deliver(5, 1), pg_temp.md_deliver(5, 2);
select pg_temp.md_assert((pg_temp.md_order_row(5)).status = 'delivered' and private.order_all_items_delivered(pg_temp.md_id('order', 5)), 'remaining_quantity_ships_normally');

-- 6. 결제확인필요 → 해소(이미 취소됨). 그 사이 김포가 도착했으면 적용과 함께 주문이 배송완료가 된다 ------------------------------
set local role authenticated;
select pg_temp.md_auth();
select pg_temp.md_start('c:1@8', 8, 8000);
reset role;
select public.service_mark_order_partial_cancellation_needs_review((pg_temp.md_head(8)).id, 'provider_cancel_ambiguous', pg_temp.md_id('user', 1));
-- 처리 중에도 이미 나간 김포 배송 건의 도착 기록은 막지 않는다(주문은 남양주가 남아 배송중 그대로).
select pg_temp.md_deliver(8, 1);
select pg_temp.md_assert((pg_temp.md_order_row(8)).status = 'shipping' and not private.order_return_intake_eligible(pg_temp.md_id('order', 8)), 'needs_review_keeps_claims_closed');
select pg_temp.md_assert(public.service_resolve_order_partial_cancellation((pg_temp.md_head(8)).id, 'already_canceled', 'TEST 상점관리자 취소 내역 확인', 'TEST-MD-TX-8',
   32000, pg_temp.md_id('user', 1), pg_temp.md_id('session', 1)) @> '{"state": "completed"}', 'resolution_completes_after_partial_dispatch');
select pg_temp.md_assert((pg_temp.md_order_row(8)).status = 'delivered'
 and (select status = 'canceled' from public.order_shipments where id = pg_temp.md_id('shipment-2', 8)), 'resolution_applies_and_delivers_order');

-- 7. 원장·감사: 부분 취소 기록의 줄 배송 건은 모두 발송 전이던 남양주 배송 건이다.
select pg_temp.md_assert(not exists(select 1 from private.order_partial_cancellation_items l join private.order_partial_cancellations h on h.id = l.partial_cancellation_id
   where h.order_id in (select pg_temp.md_id('order', n) from generate_series(1, 8) n) and l.shipment_id not in (select pg_temp.md_id('shipment-2', n) from generate_series(1, 8) n))
 and (select count(*) = 6 from private.order_partial_cancellations where order_id in (select pg_temp.md_id('order', n) from generate_series(1, 8) n) and applied_at is not null),
 'ledger_lines_only_touch_unsent_shipments');

rollback;
