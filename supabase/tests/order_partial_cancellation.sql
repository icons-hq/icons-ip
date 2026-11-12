\set ON_ERROR_STOP on
-- 재고 부족 품목·수량 부분 취소(QNA-020, ADR-0032). 한 트랜잭션 안에서 합성 주문을 만들고 끝에 되돌린다 — 실결제·결제사 호출 없음.
--  1. 스위치 OFF: 문맥·미리보기·시작이 막히고 출고 파일·수량이 지금과 같다.
--  2. 토스(완료 기준): A 1개만 부분 취소 → 처리 중엔 출고·발송·다른 취소가 막힘 → 결제사 확인 기록 → A 재고 +1, 배송 건 A 수량 1,
--     출고 파일 금액이 남은 몫. 두 번째 부분 취소(A 나머지 + C)로 배송 건 하나가 닫혀 배송비 함께 환불, 출고 파일에 B만 남는다.
--     같은 결제 다회 부분 취소의 잔액 누적, 뒤의 운영자 전액 취소는 남은 잔액만 환불하고 남은 수량만 재고로 되돌린다.
--  3. 부분 취소 뒤 발송·배송완료·반품 접수 판정, 반품배송비 차감(T12a)은 남은 잔액 기준, 매출 보고는 부분 취소 몫을 뺀다.
--  4. 무통장: 시작 때 적용·송금 대기(송금액 = 배분액) → 송금 증빙으로 완료, 계좌 원문 열람 감사·파기 일정.
--  5. 진행하지 않음(결제사가 부분 취소를 받지 않음)·확인 필요·창고 출고 중단 확인·막힘 이유·적립금 되돌림·원장 불변·권한.
begin;
create function pg_temp.pc_id(kind text, n integer) returns uuid language sql immutable as $$select md5('partial-cancel:'||kind||':'||n)::uuid$$;
create function pg_temp.pc_assert(ok boolean, label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Partial cancellation assertion failed: %', label; end if; end $$;
create function pg_temp.pc_error(q text, expected text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if sqlstate = expected or sqlerrm = expected then return; end if; raise; end;
 raise exception 'Expected partial cancellation rejection: %', expected; end $$;
create function pg_temp.pc_auth(actor integer default 1) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub', '', true);
 perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.pc_id('user', actor),
  'session_id', pg_temp.pc_id('session', actor))::text, true);
end $$;
grant execute on function pg_temp.pc_id(text, integer), pg_temp.pc_assert(boolean, text), pg_temp.pc_error(text, text), pg_temp.pc_auth(integer) to authenticated, service_role;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
 select pg_temp.pc_id('user', n), 'authenticated', 'authenticated', 'partial-cancel-'||n||'@example.test', clock_timestamp(), '{}', '{}' from generate_series(1, 3) n;
insert into auth.sessions(id, user_id, created_at, updated_at, not_after)
 select pg_temp.pc_id('session', n), pg_temp.pc_id('user', n), clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 hour' from generate_series(1, 3) n;
update public.profiles set nickname = 'TEST 부분취소 '||right(id::text, 6),
 role = case when id = pg_temp.pc_id('user', 1) then 'admin'::public.user_role else 'user'::public.user_role end
 where id in (select pg_temp.pc_id('user', n) from generate_series(1, 3) n);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.pc_id('user', 1), 'primary');
insert into public.fulfillment_origins(id, code, name, default_carrier, base_fee, return_address, is_active)
 select pg_temp.pc_id('origin', n), 'partial-cancel-origin-'||n, 'TEST 부분취소 출고지 '||n, 'hanjin', 3000, 'TEST 반품 주소', true from generate_series(1, 2) n;
insert into public.ips(id, title, vertical_key) values ('partial-cancel-ip', 'TEST 부분취소 IP', 'character');
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty, origin_id) values
 ('partial-cancel-a', 'partial-cancel-ip', 'TEST 품절 상품 A', '문구', 10000, 'ok', 10, pg_temp.pc_id('origin', 1)),
 ('partial-cancel-b', 'partial-cancel-ip', 'TEST 남는 상품 B', '문구', 10000, 'ok', 10, pg_temp.pc_id('origin', 1)),
 ('partial-cancel-c', 'partial-cancel-ip', 'TEST 다른 출고지 상품 C', '문구', 5000, 'ok', 10, pg_temp.pc_id('origin', 2));
create function pg_temp.pc_stock(good text) returns integer language sql as $$
 select stock_qty from public.goods_variants where good_id = good and is_default$$;

-- 주문 n: A 2개(10,000원·쿠폰 1,000원) + B 1개(10,000원)는 출고지 1, C 1개(5,000원)는 출고지 2. 배송비 배송 건마다 3,000원.
-- 결제 40,000원 = 굿즈 결제 몫 34,000원 + 배송비 6,000원. n=8은 A에 적립금 2,000원(결제 38,000원).
-- provider: 1·2·5·6·8 토스, 3 무통장, 4 나이스페이, 7 토스(버전 1 주문 — 배분 원장 없음).
create function pg_temp.pc_order(n integer, provider text, version integer default 2) returns void language plpgsql as $$
declare credit bigint := case when n = 8 then 2000 else 0 end; total bigint := 40000 - credit;
begin
 insert into public.orders(id, user_id, status, total, shipping_fee, discount_total, store_credit_total, calculation_version, address,
   payment_method, created_at, confirmed_at)
 values (pg_temp.pc_id('order', n), pg_temp.pc_id('user', 2), 'confirmed', total, 6000, 1000, credit, 1,
   '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
   (case when provider = 'bank_transfer' then 'bank_transfer' else 'card' end)::public.order_payment_method,
   case when n = 2 then '2031-04-01T03:00:00Z'::timestamptz else '2031-03-01T03:00:00Z'::timestamptz end, clock_timestamp() - interval '1 hour');
 insert into public.order_items(id, order_id, good_id, variant_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
 select pg_temp.pc_id('item-'||g.id, n), pg_temp.pc_id('order', n), g.id, v.id, case when g.id = 'partial-cancel-a' then 2 else 1 end, g.price,
   g.name, '문구', 'partial-cancel-ip'
 from public.goods g join public.goods_variants v on v.good_id = g.id and v.is_default where g.id like 'partial-cancel-%';
 if version = 2 then
  -- 버전 2 주문은 거래 계약 묶음이 있어야 품목을 넣을 수 있다. 합성 주문은 품목을 넣은 뒤 버전을 올린다(배분 원장만 쓴다).
  update public.orders set calculation_version = 2 where id = pg_temp.pc_id('order', n);
  insert into private.order_price_allocations(order_item_id, order_id, calculation_version, subtotal, volume_discount, net_subtotal, coupon_discount, store_credit_discount, paid_goods_total)
  values (pg_temp.pc_id('item-partial-cancel-a', n), pg_temp.pc_id('order', n), 2, 20000, 0, 20000, 1000, credit, 19000 - credit),
   (pg_temp.pc_id('item-partial-cancel-b', n), pg_temp.pc_id('order', n), 2, 10000, 0, 10000, 0, 0, 10000),
   (pg_temp.pc_id('item-partial-cancel-c', n), pg_temp.pc_id('order', n), 2, 5000, 0, 5000, 0, 0, 5000);
 end if;
 insert into public.order_shipments(id, order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot)
 select pg_temp.pc_id('shipment-'||o, n), pg_temp.pc_id('order', n), pg_temp.pc_id('origin', o), 'TEST 부분취소 출고지 '||o, 3000, '{}' from generate_series(1, 2) o;
 insert into public.order_shipment_items(order_id, shipment_id, order_item_id, qty)
 select i.order_id, pg_temp.pc_id('shipment-'||case when i.good_id = 'partial-cancel-c' then 2 else 1 end, n), i.id, i.qty
 from public.order_items i where i.order_id = pg_temp.pc_id('order', n);
 insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 values (pg_temp.pc_id('payment', n), pg_temp.pc_id('user', 2), provider::public.payment_provider, 'order', pg_temp.pc_id('order', n), total, 'paid',
   case when provider = 'bank_transfer' then 'bank_transfer:'||pg_temp.pc_id('order', n) else 'TEST-PC-KEY-'||n end, 'partial-cancel-payment-'||n, clock_timestamp() - interval '2 hours');
 insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values (pg_temp.pc_id('attempt', n), provider::public.payment_provider, pg_temp.pc_id('user', 2), 'order', pg_temp.pc_id('order', n), total, 'KRW', 'approved',
   'partial-cancel-attempt-'||n, 'TEST-PC-ORDER-'||n, 'TEST-PC-PRODUCT-'||n, pg_temp.pc_id('payment', n), clock_timestamp() + interval '1 hour');
end $$;
select pg_temp.pc_order(1, 'toss'), pg_temp.pc_order(2, 'toss'), pg_temp.pc_order(3, 'bank_transfer'), pg_temp.pc_order(4, 'nicepay'),
 pg_temp.pc_order(5, 'toss'), pg_temp.pc_order(6, 'toss'), pg_temp.pc_order(7, 'toss', 1), pg_temp.pc_order(8, 'toss');
create function pg_temp.pc_items(spec text) returns jsonb language sql as $$
 -- 'a:1,c:1@2' → 주문 2의 A 1개·C 1개
 select jsonb_agg(jsonb_build_object('orderItemId', pg_temp.pc_id('item-partial-cancel-'||split_part(part, ':', 1), split_part(spec, '@', 2)::integer),
   'qty', split_part(part, ':', 2)::integer))
 from unnest(string_to_array(split_part(spec, '@', 1), ',')) part$$;
create function pg_temp.pc_start(spec text, op integer, expected bigint, decision text default 'TEST 11/12 통화 — 품절 상품만 취소하고 나머지 먼저 받기',
  warehouse boolean default false, account jsonb default null) returns jsonb language sql as $$
 select public.admin_start_order_partial_cancellation(pg_temp.pc_id('order', split_part(spec, '@', 2)::integer), pg_temp.pc_items(spec), decision, null,
  warehouse, expected, pg_temp.pc_id('operation', op), account)$$;
create function pg_temp.pc_head(op integer) returns private.order_partial_cancellations language sql security definer as $$
 select * from private.order_partial_cancellations where operation_id = pg_temp.pc_id('operation', op)$$;
grant execute on function pg_temp.pc_items(text), pg_temp.pc_start(text, integer, bigint, text, boolean, jsonb), pg_temp.pc_stock(text), pg_temp.pc_head(integer) to authenticated;
-- END FIXTURE

-- 1. 스위치 OFF -----------------------------------------------------------------------------------------------------------
select pg_temp.pc_assert((select not partial_cancel_enabled and partial_cancel_evidence is null from private.return_fee_deduction_settings)
 and not private.order_partial_cancel_enabled(), 'switch_off_by_default');
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert(public.admin_order_partial_cancellation_context(pg_temp.pc_id('order', 1))
 = '{"enabled": false, "blockers": ["partial_cancel_disabled"], "history": []}'::jsonb, 'switch_off_context_hides_panel');
select pg_temp.pc_error($$select public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 1), pg_temp.pc_items('a:1@1'))$$, 'partial_cancel_disabled');
select pg_temp.pc_error($$select pg_temp.pc_start('a:1@1', 1, 9500)$$, 'partial_cancel_disabled');
select pg_temp.pc_assert((select jsonb_agg(line->>'qty' order by line->>'goodName')
   from jsonb_array_elements(public.admin_smartstore_shipment_export(array[pg_temp.pc_id('shipment-1', 1)])#>'{shipments,0,lines}') line)
 = '["1", "2"]'::jsonb
 and (select (line#>>'{smartstore,itemTotal}')::bigint from jsonb_array_elements(public.admin_smartstore_shipment_export(array[pg_temp.pc_id('shipment-1', 1)])#>'{shipments,0,lines}') line
   where line->>'goodName' = 'TEST 품절 상품 A') = 19000, 'switch_off_export_unchanged');
reset role;
select pg_temp.pc_assert(not exists(select 1 from private.order_partial_cancellations) and private.order_item_active_qty(pg_temp.pc_id('item-partial-cancel-a', 1)) = 2
 and private.payment_partial_refunded_amount(pg_temp.pc_id('payment', 1)) = 0 and not private.order_partial_cancel_in_flight(pg_temp.pc_id('order', 1))
 and private.claim_refund_settled_amount(pg_temp.pc_id('payment', 1)) = 40000 and private.claim_refund_active_deduction(pg_temp.pc_id('payment', 1)) = 0,
 'switch_off_readers_unchanged');

-- 2. 스위치 켜기(운영에서는 후속 migration). 근거·시각이 없으면 켜지지 않고, T12a 행 감사에 같이 남는다. ----------------------------------
select pg_temp.pc_error('update private.return_fee_deduction_settings set partial_cancel_enabled = true where singleton', '23514');
update private.return_fee_deduction_settings set partial_cancel_enabled = true, partial_cancel_evidence = 'TEST 토스 부분 취소 사용 확인·서원 품절 통보 경로',
 partial_cancel_enabled_at = clock_timestamp() where singleton;
select pg_temp.pc_assert(exists(select 1 from public.audit_log where action = 'system.return_fee_deduction.settings_changed'
   and diff#>>'{after,partial_cancel_enabled}' = 'true' and diff#>>'{before,partial_cancel_enabled}' = 'false')
 and (select not enabled from private.return_fee_deduction_settings), 'switch_on_audited_independent_of_return_fee');

-- 3. 토스 — 완료 기준 ----------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert((select context->'blockers' = '[]'::jsonb and context->>'provider' = 'toss' and (context->>'balance')::bigint = 40000
   and jsonb_array_length(context->'items') = 3 and not exists(select 1 from jsonb_array_elements(context->'items') item where item->>'blocker' is not null)
  from (select public.admin_order_partial_cancellation_context(pg_temp.pc_id('order', 1)) context) s), 'context_open_for_toss_order');
select pg_temp.pc_assert((select plan @> '{"provider": "toss", "goodsRefundAmount": 9500, "shippingRefundAmount": 0, "refundAmount": 9500,
   "balanceBefore": 40000, "balanceAfter": 30500, "warehouseStopRequired": false, "closedShipments": []}'
   and plan->'lines'->0 @> '{"qty": 1, "orderedQty": 2, "remainingQtyAfter": 1, "couponDiscount": 500, "goodsRefundAmount": 9500}'
  from (select public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 1), pg_temp.pc_items('a:1@1')) plan) s), 'preview_allocates_coupon_share');
select pg_temp.pc_error($$select public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 1), pg_temp.pc_items('a:3@1'))$$, 'partial_cancel_qty_exceeds_remaining');
select pg_temp.pc_error($$select public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 1), pg_temp.pc_items('a:1,a:1@1'))$$, 'invalid_partial_cancel_items');
select pg_temp.pc_error($$select public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 1), pg_temp.pc_items('a:2,b:1,c:1@1'))$$, 'partial_cancel_leaves_nothing');
select pg_temp.pc_error($$select pg_temp.pc_start('a:1@1', 1, 9000)$$, 'partial_cancel_amount_changed');
select pg_temp.pc_error($$select pg_temp.pc_start('a:1@1', 1, 9500, ' ')$$, 'partial_cancel_customer_decision_required');
select pg_temp.pc_error($$select pg_temp.pc_start('a:1@1', 1, 9500, account => '{"bankName":"TEST","accountNumber":"00000000","accountHolder":"TEST"}')$$, 'partial_cancel_refund_account_not_allowed');
select pg_temp.pc_assert((pg_temp.pc_start('a:1@1', 1, 9500)) @> '{"state": "processing", "provider": "toss", "refundAmount": 9500, "replayed": false}', 'start_processing');
select pg_temp.pc_assert((pg_temp.pc_start('a:1@1', 1, 9500)) @> '{"state": "processing", "replayed": true}', 'start_replay_same_operation');
-- 처리 중: 출고지시·묶음 출고·다른 부분 취소·전액 취소가 막힌다.
select pg_temp.pc_assert(public.admin_order_partial_cancellation_context(pg_temp.pc_id('order', 1))->'blockers' ? 'partial_cancel_in_progress', 'in_flight_blocker');
select pg_temp.pc_error($$select public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 1), pg_temp.pc_items('b:1@1'))$$, 'partial_cancel_in_progress');
select pg_temp.pc_error($$select public.admin_shipment_export(array[pg_temp.pc_id('shipment-1', 1)])$$, 'order cancellation in progress');
select pg_temp.pc_error($$select public.admin_start_order_cancellation(pg_temp.pc_id('order', 1), 'out_of_stock', null, false)$$, 'order_claim_in_progress');
select pg_temp.pc_assert(not ((public.admin_origin_pending_export_ids(pg_temp.pc_id('origin', 1))->'ids') ? pg_temp.pc_id('shipment-1', 1)::text)
 and ((public.admin_origin_pending_export_ids(pg_temp.pc_id('origin', 1))->'ids') ? pg_temp.pc_id('shipment-1', 2)::text), 'in_flight_excluded_from_pending_exports');
reset role;
select pg_temp.pc_error($$select private.assert_order_dispatch_allowed(pg_temp.pc_id('order', 1))$$, 'order cancellation in progress');
select pg_temp.pc_error($$update public.order_shipments set status = 'shipping', shipped_at = now(), carrier = 'hanjin', tracking_number = 'TESTPC00000001' where id = pg_temp.pc_id('shipment-1', 1)$$, 'order cancellation in progress');
select pg_temp.pc_assert(not private.order_cancel_eligible(pg_temp.pc_id('order', 1)) and pg_temp.pc_stock('partial-cancel-a') = 10
 and (select qty from public.order_shipment_items where order_item_id = pg_temp.pc_id('item-partial-cancel-a', 1)) = 2, 'in_flight_changes_nothing');
-- 결제사 확인 기록(오케스트레이터가 조회로 확인한 뒤 부른다). 금액·키·운영자가 맞아야 한다.
select pg_temp.pc_error(format('select public.service_complete_order_partial_cancellation(%L, 9000, %L, %L, %L)', (pg_temp.pc_head(1)).id, 'TEST-PC-KEY-1', 'TEST-PC-TX-1', pg_temp.pc_id('user', 1)), 'partial_cancel_evidence_mismatch');
select pg_temp.pc_error(format('select public.service_complete_order_partial_cancellation(%L, 9500, %L, %L, %L)', (pg_temp.pc_head(1)).id, 'TEST-OTHER-KEY', 'TEST-PC-TX-1', pg_temp.pc_id('user', 1)), 'partial_cancel_evidence_mismatch');
select pg_temp.pc_error(format('select public.service_complete_order_partial_cancellation(%L, 9500, %L, %L, null)', (pg_temp.pc_head(1)).id, 'TEST-PC-KEY-1', 'TEST-PC-TX-1'), 'operator_capability_required');
select pg_temp.pc_assert(public.service_complete_order_partial_cancellation((pg_temp.pc_head(1)).id, 9500, 'TEST-PC-KEY-1', 'TEST-PC-TX-1', pg_temp.pc_id('user', 1)) = 'completed'
 and public.service_complete_order_partial_cancellation((pg_temp.pc_head(1)).id, 9500, 'TEST-PC-KEY-1', 'TEST-PC-TX-1', pg_temp.pc_id('user', 1)) = 'completed', 'complete_idempotent');
select pg_temp.pc_assert(pg_temp.pc_stock('partial-cancel-a') = 11
 and (select qty from public.order_shipment_items where order_item_id = pg_temp.pc_id('item-partial-cancel-a', 1)) = 1
 and private.order_item_active_qty(pg_temp.pc_id('item-partial-cancel-a', 1)) = 1
 and private.payment_partial_refunded_amount(pg_temp.pc_id('payment', 1)) = 9500
 and (select status = 'paid' and amount = 40000 from public.payments where id = pg_temp.pc_id('payment', 1))
 and not exists(select 1 from public.refunds where payment_id = pg_temp.pc_id('payment', 1))
 and (select status = 'confirmed' from public.orders where id = pg_temp.pc_id('order', 1))
 and exists(select 1 from public.notifications where source_type = 'order_partial_cancellation' and source_id = (pg_temp.pc_head(1)).id::text
   and user_id = pg_temp.pc_id('user', 2) and body like '%TEST 품절 상품 A 1개%9,500원%')
 and exists(select 1 from public.audit_log where action = 'admin.order.partial_cancellation_applied' and diff->>'partialCancellationId' = (pg_temp.pc_head(1)).id::text)
 and exists(select 1 from public.audit_log where action = 'order.option_stock_restored' and diff->>'partialCancellationId' = (pg_temp.pc_head(1)).id::text and (diff->>'delta')::integer = 1),
 'completed_restores_one_unit_and_keeps_payment_ledger');
select pg_temp.pc_assert(private.order_cancel_eligible(pg_temp.pc_id('order', 1)) is not distinct from private.order_cancel_eligible_before_digital(pg_temp.pc_id('order', 1)),
 'after_completion_cancel_eligibility_restored');
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert((select jsonb_agg(jsonb_build_object('good', line->>'goodName', 'qty', line->'qty', 'total', line#>'{smartstore,itemTotal}') order by line->>'goodName')
   from jsonb_array_elements(public.admin_smartstore_shipment_export(array[pg_temp.pc_id('shipment-1', 1)])#>'{shipments,0,lines}') line)
 = '[{"good": "TEST 남는 상품 B", "qty": 1, "total": 10000}, {"good": "TEST 품절 상품 A", "qty": 1, "total": 9500}]'::jsonb, 'export_reads_remaining_quantity_and_amount');
select pg_temp.pc_auth(2);
select pg_temp.pc_assert((select jsonb_array_length(rows) = 1 and rows->0 @> '{"state": "completed", "refundAmount": 9500, "items": [{"goodName": "TEST 품절 상품 A", "qty": 1}]}'
   and not (rows->0 ? 'customerDecision')
  from (select public.get_my_order_partial_cancellations(pg_temp.pc_id('order', 1)) rows) s), 'buyer_sees_applied_partial');
select pg_temp.pc_auth(3);
select pg_temp.pc_assert(public.get_my_order_partial_cancellations(pg_temp.pc_id('order', 1)) = '[]'::jsonb, 'other_user_sees_nothing');
select pg_temp.pc_error($$select public.admin_order_partial_cancellation_context(pg_temp.pc_id('order', 1))$$, '42501');
select pg_temp.pc_auth();
-- 두 번째 부분 취소: A 나머지 1개 + C 1개 → 출고지 2 배송 건이 비어 닫히고 배송비 3,000원을 함께 환불. 잔액 30,500원에서 17,500원.
select pg_temp.pc_assert((select plan @> '{"goodsRefundAmount": 14500, "shippingRefundAmount": 3000, "refundAmount": 17500, "balanceBefore": 30500, "balanceAfter": 13000}'
   and jsonb_array_length(plan->'closedShipments') = 1 and plan->'closedShipments'->0->>'shipmentId' = pg_temp.pc_id('shipment-2', 1)::text
  from (select public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 1), pg_temp.pc_items('a:1,c:1@1')) plan) s), 'second_partial_accumulates_balance');
select pg_temp.pc_start('a:1,c:1@1', 2, 17500);
reset role;
select public.service_complete_order_partial_cancellation((pg_temp.pc_head(2)).id, 17500, 'TEST-PC-KEY-1', 'TEST-PC-TX-2', pg_temp.pc_id('user', 1));
select pg_temp.pc_assert(not exists(select 1 from public.order_shipment_items where order_item_id in (pg_temp.pc_id('item-partial-cancel-a', 1), pg_temp.pc_id('item-partial-cancel-c', 1)))
 and (select status = 'canceled' from public.order_shipments where id = pg_temp.pc_id('shipment-2', 1))
 and private.shipment_closed_by_partial_cancel(pg_temp.pc_id('shipment-2', 1))
 and (select status = 'confirmed' from public.orders where id = pg_temp.pc_id('order', 1))
 and pg_temp.pc_stock('partial-cancel-a') = 12 and pg_temp.pc_stock('partial-cancel-c') = 11
 and private.payment_partial_refunded_amount(pg_temp.pc_id('payment', 1)) = 27000
 and (select shipping_refund_amount = 3000 from private.order_partial_cancellations where id = (pg_temp.pc_head(2)).id), 'second_partial_closes_empty_shipment');
set local role authenticated;
select pg_temp.pc_auth();
-- 완료 기준: 배송 건에 B만 남아 출고 파일에 B만.
select pg_temp.pc_assert((select jsonb_agg(line->>'goodName') from jsonb_array_elements(public.admin_shipment_export(array[pg_temp.pc_id('shipment-1', 1)])#>'{shipments,0,lines}') line)
 = '["TEST 남는 상품 B"]'::jsonb, 'warehouse_export_has_only_remaining_item');
select pg_temp.pc_error($$select public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 1), pg_temp.pc_items('b:1@1'))$$, 'partial_cancel_leaves_nothing');
select pg_temp.pc_assert((select jsonb_array_length(context->'history') = 2 and context->'history'->1 @> '{"state": "completed", "closedShipmentCount": 1}'
   and context->'items' @> '[{"activeQty": 0, "blocker": "fully_canceled"}]'
  from (select public.admin_order_partial_cancellation_context(pg_temp.pc_id('order', 1)) context) s), 'context_history_and_item_state');
-- 남은 주문을 운영자 전액 취소: 환불 의도 13,000원, 결제사 확인 뒤 finalizer가 남은 잔액만 환불하고 남은 수량(B 1개)만 복원한다.
select public.admin_start_order_cancellation(pg_temp.pc_id('order', 1), 'out_of_stock', null, false) as remainder_request \gset
reset role;
select pg_temp.pc_assert((select amount = 13000 and status = 'requested' from public.refunds where payment_id = pg_temp.pc_id('payment', 1)), 'remainder_intent_is_remaining_balance');
select public.complete_order_cancellation_request(:'remainder_request', array['TEST-PC-KEY-1'], pg_temp.pc_id('user', 1));
select pg_temp.pc_assert((select amount = 13000 and status = 'done' from public.refunds where payment_id = pg_temp.pc_id('payment', 1))
 and (select status = 'refunded' from public.payments where id = pg_temp.pc_id('payment', 1))
 and (select status = 'canceled' from public.orders where id = pg_temp.pc_id('order', 1))
 and pg_temp.pc_stock('partial-cancel-a') = 12 and pg_temp.pc_stock('partial-cancel-b') = 11 and pg_temp.pc_stock('partial-cancel-c') = 11,
 'remainder_cancel_refunds_and_restores_only_what_is_left');
-- PG 정산 대사: 부분 취소 거래키는 그 부분 취소 금액과 맞춘다.
create function pg_temp.pc_settlement(tx text, amount text) returns jsonb language sql as $$
 select private.pg_settlement_match(jsonb_build_object('orderId', 'TEST-PC-ORDER-1', 'paymentKey', 'TEST-PC-KEY-1', 'currency', 'KRW', 'amount', '40000',
  'transactionKey', tx, 'cancel', jsonb_build_object('cancelAmount', amount, 'canceledAt', '2031-03-02T00:00:00+09:00', 'transactionKey', tx)))$$;
select pg_temp.pc_assert(pg_temp.pc_settlement('TEST-PC-TX-1', '9500') @> '{"state": "matched", "reason": "verified"}'
 and pg_temp.pc_settlement('TEST-PC-TX-2', '17500') @> '{"state": "matched"}'
 and pg_temp.pc_settlement('TEST-PC-TX-2', '17000') @> '{"state": "mismatch", "reason": "refund_amount_mismatch"}'
 and pg_temp.pc_settlement('TEST-PC-TX-UNKNOWN', '13000') @> '{"state": "unlinked", "reason": "transaction_evidence_missing"}', 'settlement_matches_partial_transactions');

-- 4. 부분 취소 뒤 발송·배송완료·반품 판정, 반품배송비 차감은 남은 잔액 기준, 매출 보고 ------------------------------------------------
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_start('a:1,c:1@2', 3, 17500);
reset role;
select public.service_complete_order_partial_cancellation((pg_temp.pc_head(3)).id, 17500, 'TEST-PC-KEY-2', 'TEST-PC-TX-3', pg_temp.pc_id('user', 1));
update public.order_shipments set status = 'shipping', shipped_at = now(), carrier = 'hanjin', tracking_number = 'TESTPC00000002' where id = pg_temp.pc_id('shipment-1', 2);
select pg_temp.pc_assert((select status = 'shipping' from public.orders where id = pg_temp.pc_id('order', 2)) and private.order_return_intake_eligible(pg_temp.pc_id('order', 2)),
 'shipping_with_closed_shipment');
update public.order_shipments set status = 'delivered', delivered_at = now() where id = pg_temp.pc_id('shipment-1', 2);
select pg_temp.pc_assert((select status = 'delivered' and delivered_at is not null from public.orders where id = pg_temp.pc_id('order', 2))
 and private.order_all_items_delivered(pg_temp.pc_id('order', 2)) and private.order_return_intake_eligible(pg_temp.pc_id('order', 2)),
 'delivered_ignores_closed_shipment_and_canceled_quantity');
update private.return_fee_deduction_settings set enabled = true, one_way_amount = 3000, evidence = 'TEST 반품배송비', enabled_at = clock_timestamp() where singleton;
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy, collected_at, requested_at)
 values (pg_temp.pc_id('claim', 2), pg_temp.pc_id('order', 2), pg_temp.pc_id('user', 2), 'TEST 단순 변심 반품', 'change_of_mind', 'return', 'collected', 'legacy',
  clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '1 hour');
select pg_temp.pc_assert(private.return_fee_deduction_plan(pg_temp.pc_id('claim', 2)) @> '{"applicable": true, "paymentAmount": 22500, "deductionAmount": 3000, "refundAmount": 19500}'
 and private.claim_refund_settled_amount(pg_temp.pc_id('payment', 2)) = 22500, 'return_fee_deduction_uses_remaining_balance');
update private.return_fee_deduction_settings set enabled = false where singleton;
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert((select (report#>>'{daily,0,revenue}')::bigint = 22500
   and (select jsonb_agg(jsonb_build_object('id', g->>'goodId', 'qty', (g->>'qty')::bigint, 'revenue', (g->>'revenue')::bigint)) from jsonb_array_elements(report->'goods') g
     where g->>'goodId' = 'partial-cancel-a') = '[{"id": "partial-cancel-a", "qty": 1, "revenue": 10000}]'::jsonb
  from (select public.admin_sales_report('2031-04-01T00:00:00Z', '2031-04-02T00:00:00Z') report) s), 'sales_report_subtracts_partial');
reset role;

-- 5. 무통장: 시작 때 적용·송금 대기 → 송금 증빙으로 완료 ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_error($$select pg_temp.pc_start('a:1@3', 4, 9500)$$, 'partial_cancel_refund_account_required');
select pg_temp.pc_assert(pg_temp.pc_start('a:1@3', 4, 9500, account => '{"bankName":"TEST 합성은행","accountNumber":"000000001234","accountHolder":"TEST 구매자"}')
 @> '{"state": "awaiting_transfer", "provider": "bank_transfer", "refundAmount": 9500}', 'bank_transfer_applies_immediately');
reset role;
select pg_temp.pc_assert(pg_temp.pc_stock('partial-cancel-a') = 14
 and (select qty from public.order_shipment_items where order_item_id = pg_temp.pc_id('item-partial-cancel-a', 3)) = 1
 and (select masked_account like 'TEST 합성은행 %1234' and account_number = '000000001234' and purge_after is null
   from private.order_partial_cancellation_refund_accounts where partial_cancellation_id = (pg_temp.pc_head(4)).id)
 and private.claim_refund_active_deduction(pg_temp.pc_id('payment', 3)) = 9500
 and not private.order_partial_cancel_in_flight(pg_temp.pc_id('order', 3)), 'bank_transfer_awaiting_transfer');
select private.assert_order_dispatch_allowed(pg_temp.pc_id('order', 3));
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert(public.admin_view_order_partial_cancellation_refund_account((pg_temp.pc_head(4)).id)
 = '{"bankName": "TEST 합성은행", "accountNumber": "000000001234", "accountHolder": "TEST 구매자", "amount": 9500}'::jsonb, 'bank_account_revealed');
select pg_temp.pc_error(format('select public.admin_record_order_partial_cancellation_transfer(%L, %L, %L, %L)', (pg_temp.pc_head(4)).id, 'x', 'TEST 확인', pg_temp.pc_id('transfer', 1)), 'partial_cancel_transfer_evidence_required');
select pg_temp.pc_assert(public.admin_record_order_partial_cancellation_transfer((pg_temp.pc_head(4)).id, 'TEST 이체확인 0001', 'TEST-ONLY 합성 송금. 실제 송금 없음.', pg_temp.pc_id('transfer', 1)) @> '{"state": "completed", "replayed": false}'
 and public.admin_record_order_partial_cancellation_transfer((pg_temp.pc_head(4)).id, 'TEST 이체확인 0001', 'TEST-ONLY 합성 송금. 실제 송금 없음.', pg_temp.pc_id('transfer', 1)) @> '{"replayed": true}', 'transfer_recorded_once');
select pg_temp.pc_error(format('select public.admin_record_order_partial_cancellation_transfer(%L, %L, %L, %L)', (pg_temp.pc_head(4)).id, 'TEST 다른 증빙', 'TEST 다른 메모', pg_temp.pc_id('transfer', 2)), 'partial_cancel_transfer_already_recorded');
select pg_temp.pc_error(format('select public.admin_view_order_partial_cancellation_refund_account(%L)', (pg_temp.pc_head(4)).id), 'partial_cancel_not_awaiting_transfer');
reset role;
select pg_temp.pc_assert((select state = 'completed' and transferred_by = pg_temp.pc_id('user', 1) from private.order_partial_cancellations where id = (pg_temp.pc_head(4)).id)
 and (select purge_after > now() from private.order_partial_cancellation_refund_accounts where partial_cancellation_id = (pg_temp.pc_head(4)).id)
 and exists(select 1 from public.audit_log where action = 'admin.order.partial_cancellation_account_viewed' and diff->>'partialCancellationId' = (pg_temp.pc_head(4)).id::text)
 and exists(select 1 from public.notifications where dedupe_key = 'partial-cancel:transferred:'||(pg_temp.pc_head(4)).id), 'bank_transfer_completed');
update private.order_partial_cancellation_refund_accounts set purge_after = now() - interval '1 second' where partial_cancellation_id = (pg_temp.pc_head(4)).id;
select pg_temp.pc_assert(public.purge_expired_claim_refund_accounts() >= 1, 'purge_counts_partial_accounts');
select pg_temp.pc_assert((select account_number is null and purged_at is not null from private.order_partial_cancellation_refund_accounts where partial_cancellation_id = (pg_temp.pc_head(4)).id),
 'bank_account_purged_on_schedule');

-- 6. 막힘 이유·진행하지 않음·확인 필요·창고 출고 중단 확인 ----------------------------------------------------------------------
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert(public.admin_order_partial_cancellation_context(pg_temp.pc_id('order', 4))->'blockers' ? 'partial_cancel_unsupported'
 and public.admin_order_partial_cancellation_context(pg_temp.pc_id('order', 7))->'blockers' ? 'legacy_order', 'unsupported_payments_and_legacy_orders_blocked');
select pg_temp.pc_error($$select pg_temp.pc_start('a:1@4', 5, 9500)$$, 'partial_cancel_unsupported');
select pg_temp.pc_start('a:1@5', 6, 9500);
reset role;
select pg_temp.pc_error(format('select public.service_reject_order_partial_cancellation(%L, %L, %L)', (pg_temp.pc_head(6)).id, 'provider_cancel_failed', pg_temp.pc_id('user', 1)), 'invalid_partial_cancel_reason');
select pg_temp.pc_assert(public.service_mark_order_partial_cancellation_needs_review((pg_temp.pc_head(6)).id, 'provider_unavailable', pg_temp.pc_id('user', 1)) = 'needs_review'
 and private.order_partial_cancel_in_flight(pg_temp.pc_id('order', 5)), 'needs_review_keeps_dispatch_blocked');
select pg_temp.pc_error($$select private.assert_order_dispatch_allowed(pg_temp.pc_id('order', 5))$$, 'order cancellation in progress');
select pg_temp.pc_assert(public.service_reject_order_partial_cancellation((pg_temp.pc_head(6)).id, 'provider_partial_cancel_unavailable', pg_temp.pc_id('user', 1)) = 'rejected', 'reject_returns_rejected');
select pg_temp.pc_assert((select state = 'rejected' and applied_at is null and last_error_code = 'provider_partial_cancel_unavailable' from private.order_partial_cancellations where id = (pg_temp.pc_head(6)).id)
 and (select qty from public.order_shipment_items where order_item_id = pg_temp.pc_id('item-partial-cancel-a', 5)) = 2
 and private.payment_partial_refunded_amount(pg_temp.pc_id('payment', 5)) = 0 and pg_temp.pc_stock('partial-cancel-a') = 14
 and not exists(select 1 from public.notifications where source_id = (pg_temp.pc_head(6)).id::text), 'rejected_changes_nothing');
select private.assert_order_dispatch_allowed(pg_temp.pc_id('order', 5));
select pg_temp.pc_error(format('select public.service_complete_order_partial_cancellation(%L, 9500, %L, %L, %L)', (pg_temp.pc_head(6)).id, 'TEST-PC-KEY-5', 'TEST-PC-TX-6', pg_temp.pc_id('user', 1)), 'partial_cancel_not_processing');
update public.order_shipments set exported_at = now(), exported_by = pg_temp.pc_id('user', 1) where id = pg_temp.pc_id('shipment-1', 6);
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert((public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 6), pg_temp.pc_items('a:1@6'))->>'warehouseStopRequired')::boolean, 'exported_shipment_requires_warehouse_stop');
select pg_temp.pc_error($$select pg_temp.pc_start('a:1@6', 7, 9500)$$, 'warehouse_stop_confirmation_required');
select pg_temp.pc_assert(pg_temp.pc_start('a:1@6', 7, 9500, warehouse => true) @> '{"state": "processing"}', 'warehouse_stop_confirmed_start');
reset role;
select pg_temp.pc_assert((pg_temp.pc_head(7)).warehouse_stop_confirmed, 'warehouse_stop_recorded');

-- 7. 적립금 몫은 적립금으로 되돌리고, 뒤의 전액 취소는 남은 몫만 되돌린다 -----------------------------------------------------------
select private.issue_store_credit_lot(pg_temp.pc_id('user', 2), 5000, clock_timestamp() + interval '90 days', 'admin', null, pg_temp.pc_id('user', 1), pg_temp.pc_id('credit-op', 1), 'TEST 적립금') as credit_lot \gset
update private.store_credit_lots set available_amount = available_amount - 2000, spent_amount = spent_amount + 2000 where id = :'credit_lot';
insert into private.store_credit_allocations(order_id, user_id, lot_id, amount, state, original_expires_at, restore_grace_days, consumed_at)
 select pg_temp.pc_id('order', 8), pg_temp.pc_id('user', 2), id, 2000, 'consumed', expires_at, 30, clock_timestamp() from private.store_credit_lots where id = :'credit_lot';
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert(public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 8), pg_temp.pc_items('a:1@8'))
 @> '{"goodsRefundAmount": 8500, "storeCreditRestoreAmount": 1000, "balanceBefore": 38000}', 'store_credit_share_previewed');
select pg_temp.pc_start('a:1@8', 8, 8500);
reset role;
select public.service_complete_order_partial_cancellation((pg_temp.pc_head(8)).id, 8500, 'TEST-PC-KEY-8', 'TEST-PC-TX-8', pg_temp.pc_id('user', 1));
select pg_temp.pc_assert((select amount = 1000 and state = 'consumed' from private.store_credit_allocations where order_id = pg_temp.pc_id('order', 8))
 and (select coalesce(sum(issued_amount), 0) = 1000 from private.store_credit_lots where source_order_id = pg_temp.pc_id('order', 8) and source_kind = 'restoration')
 and (select spent_amount = 1000 and transferred_amount = 1000 from private.store_credit_lots where id = :'credit_lot'), 'store_credit_share_restored');
set local role authenticated;
select pg_temp.pc_auth();
select public.admin_start_order_cancellation(pg_temp.pc_id('order', 8), 'customer_request', null, false) as credit_request \gset
reset role;
select public.complete_order_cancellation_request(:'credit_request', array['TEST-PC-KEY-8'], pg_temp.pc_id('user', 1));
select pg_temp.pc_assert((select amount = 29500 and status = 'done' from public.refunds where payment_id = pg_temp.pc_id('payment', 8))
 and (select coalesce(sum(issued_amount), 0) = 2000 from private.store_credit_lots where source_order_id = pg_temp.pc_id('order', 8) and source_kind = 'restoration')
 and (select state = 'released' from private.store_credit_allocations where order_id = pg_temp.pc_id('order', 8)), 'store_credit_never_restored_twice');

-- 8. 원장 불변·권한 ---------------------------------------------------------------------------------------------------------
select pg_temp.pc_error(format('update private.order_partial_cancellations set refund_amount = 1 where id = %L', (pg_temp.pc_head(1)).id), 'partial_cancellation_immutable');
select pg_temp.pc_error(format('delete from private.order_partial_cancellations where id = %L', (pg_temp.pc_head(1)).id), 'partial_cancellation_immutable');
select pg_temp.pc_error(format('update private.order_partial_cancellation_items set qty = 2 where partial_cancellation_id = %L', (pg_temp.pc_head(1)).id), 'partial_cancellation_immutable');
select pg_temp.pc_assert(not has_function_privilege('anon', 'public.admin_start_order_partial_cancellation(uuid,jsonb,text,text,boolean,bigint,uuid,jsonb)', 'execute')
 and not has_function_privilege('service_role', 'public.admin_start_order_partial_cancellation(uuid,jsonb,text,text,boolean,bigint,uuid,jsonb)', 'execute')
 and not has_function_privilege('authenticated', 'public.service_complete_order_partial_cancellation(uuid,bigint,text,text,uuid)', 'execute')
 and has_function_privilege('service_role', 'public.service_complete_order_partial_cancellation(uuid,bigint,text,text,uuid)', 'execute')
 and has_function_privilege('authenticated', 'public.get_my_order_partial_cancellations(uuid)', 'execute')
 and not has_function_privilege('anon', 'public.get_my_order_partial_cancellations(uuid)', 'execute')
 and not has_table_privilege('authenticated', 'private.order_partial_cancellations', 'select'), 'grants_sealed');
set local role authenticated;
select pg_temp.pc_auth(3);
select pg_temp.pc_error($$select pg_temp.pc_start('b:1@6', 9, 10000)$$, '42501');
reset role;

select 'order_partial_cancellation ok' as result;
rollback;
