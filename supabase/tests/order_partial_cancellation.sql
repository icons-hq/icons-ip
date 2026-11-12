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
-- provider: 1·2·5·6·8 토스, 3 무통장, 4 나이스페이, 7 토스(버전 1 주문 — 배분 원장 없음). 9 이후는 리뷰 보완 시험(9절)용이고
-- a_coupon(A 쿠폰)·b_coupon(B 쿠폰)·ship_fee(배송 건마다 배송비)·initial(시작 상태)로 금액·상태를 바꾼다.
create function pg_temp.pc_order(n integer, provider text, version integer default 2, a_coupon bigint default 1000, b_coupon bigint default 0,
  ship_fee bigint default 3000, initial text default 'confirmed') returns void language plpgsql as $$
declare credit bigint := case when n = 8 then 2000 else 0 end;
  total bigint := (20000 - a_coupon - credit) + (10000 - b_coupon) + 5000 + 2 * ship_fee;
begin
 insert into public.orders(id, user_id, status, total, shipping_fee, discount_total, store_credit_total, calculation_version, address,
   payment_method, created_at, confirmed_at)
 values (pg_temp.pc_id('order', n), pg_temp.pc_id('user', 2), initial::public.order_status, total, 2 * ship_fee, a_coupon + b_coupon, credit, 1,
   '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
   (case when provider = 'bank_transfer' then 'bank_transfer' else 'card' end)::public.order_payment_method,
   case when n = 2 then '2031-04-01T03:00:00Z'::timestamptz else '2031-03-01T03:00:00Z'::timestamptz end,
   case when initial = 'confirmed' then clock_timestamp() - interval '1 hour' end);
 insert into public.order_items(id, order_id, good_id, variant_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
 select pg_temp.pc_id('item-'||g.id, n), pg_temp.pc_id('order', n), g.id, v.id, case when g.id = 'partial-cancel-a' then 2 else 1 end, g.price,
   g.name, '문구', 'partial-cancel-ip'
 from public.goods g join public.goods_variants v on v.good_id = g.id and v.is_default where g.id like 'partial-cancel-%';
 if version = 2 then
  -- 버전 2 주문은 거래 계약 묶음이 있어야 품목을 넣을 수 있다. 합성 주문은 품목을 넣은 뒤 버전을 올린다(배분 원장만 쓴다).
  update public.orders set calculation_version = 2 where id = pg_temp.pc_id('order', n);
  insert into private.order_price_allocations(order_item_id, order_id, calculation_version, subtotal, volume_discount, net_subtotal, coupon_discount, store_credit_discount, paid_goods_total)
  values (pg_temp.pc_id('item-partial-cancel-a', n), pg_temp.pc_id('order', n), 2, 20000, 0, 20000, a_coupon, credit, 20000 - a_coupon - credit),
   (pg_temp.pc_id('item-partial-cancel-b', n), pg_temp.pc_id('order', n), 2, 10000, 0, 10000, b_coupon, 0, 10000 - b_coupon),
   (pg_temp.pc_id('item-partial-cancel-c', n), pg_temp.pc_id('order', n), 2, 5000, 0, 5000, 0, 0, 5000);
 end if;
 insert into public.order_shipments(id, order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot)
 select pg_temp.pc_id('shipment-'||o, n), pg_temp.pc_id('order', n), pg_temp.pc_id('origin', o), 'TEST 부분취소 출고지 '||o, ship_fee, '{}' from generate_series(1, 2) o;
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
-- 9: A 전액 할인(결제 몫 0원), 10: B 전액 할인·배송비 0원(A·C를 빼면 남는 잔액 0원), 17·18·24: 발주확인 전(paid), 20: 무통장, 나머지 토스.
select pg_temp.pc_order(9, 'toss', 2, 20000), pg_temp.pc_order(10, 'toss', 2, 1000, 10000, 0), pg_temp.pc_order(20, 'bank_transfer');
select pg_temp.pc_order(n, 'toss', 2, 1000, 0, 3000, 'paid') from unnest(array[17, 18, 24]) n;
select pg_temp.pc_order(n, 'toss') from unnest(array[11, 12, 13, 14, 15, 16, 19, 21, 22, 23]) n;
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
 = '{"enabled": false, "canManage": true, "blockers": ["partial_cancel_disabled"], "history": []}'::jsonb, 'switch_off_context_hides_panel');
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
 -- 부분 복원은 주문 전체 취소의 복원(order.option_stock_restored)과 다른 액션이다(재고 대조·불량 재고 방어선이 섞지 않는다).
 and exists(select 1 from public.audit_log where action = 'order.option_stock_partially_restored' and diff->>'partialCancellationId' = (pg_temp.pc_head(1)).id::text
   and (diff->>'delta')::integer = 1 and diff->>'followedSuccessor' = 'false')
 and not exists(select 1 from public.audit_log where action = 'order.option_stock_restored' and diff ? 'partialCancellationId'),
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
select pg_temp.pc_assert(private.account_deletion_blockers(pg_temp.pc_id('user', 2)) @> '[{"code": "active_order_refund", "count": 1}]', 'awaiting_transfer_blocks_account_deletion');
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
select pg_temp.pc_assert(not (private.account_deletion_blockers(pg_temp.pc_id('user', 2)) @> '[{"code": "active_order_refund"}]'), 'transfer_completion_releases_deletion_blocker');
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

-- 9. 리뷰 보완: 0원 환불·잔액 0원·선물·합포장·반품/교환 회수·살아 있는 수량을 읽는 함수·환불 송금 대기·결제확인필요 해소 ---------------------
create function pg_temp.pc_variant(good text) returns uuid language sql as $$
 select id from public.goods_variants where good_id = good and is_default$$;
create function pg_temp.pc_ship(n integer) returns void language sql as $$
 update public.order_shipments s set status = 'shipping', shipped_at = clock_timestamp(), carrier = 'hanjin',
   tracking_number = 'TESTPC'||lpad((abs(hashtext(s.id::text)) % 100000000)::text, 8, '0')
 where s.order_id = pg_temp.pc_id('order', n) and s.status = 'ready';
 update public.order_shipments s set status = 'delivered', delivered_at = clock_timestamp() where s.order_id = pg_temp.pc_id('order', n) and s.status = 'shipping';$$;
create function pg_temp.pc_complete(op integer, amount bigint, n integer) returns text language sql as $$
 select public.service_complete_order_partial_cancellation((pg_temp.pc_head(op)).id, amount, 'TEST-PC-KEY-'||n, 'TEST-PC-TX-'||op, pg_temp.pc_id('user', 1))$$;
grant execute on function pg_temp.pc_variant(text) to authenticated;

-- 9-1. 0원 환불(전액 할인된 A만 고름): 결제사·송금 없이 시작 때 적용·완료한다. 돈은 움직이지 않는다.
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert(public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 9), pg_temp.pc_items('a:1@9'))
 @> '{"goodsRefundAmount": 0, "refundAmount": 0, "balanceBefore": 21000, "balanceAfter": 21000}', 'zero_refund_previewed');
select pg_temp.pc_error($$select pg_temp.pc_start('a:1@9', 20, 0, account => '{"bankName":"TEST","accountNumber":"00000000","accountHolder":"TEST"}')$$, 'partial_cancel_refund_account_not_allowed');
select pg_temp.pc_assert(pg_temp.pc_start('a:1@9', 20, 0) @> '{"state": "completed", "provider": "toss", "refundAmount": 0}', 'zero_refund_completes_at_start');
reset role;
select pg_temp.pc_assert((select applied_at is not null and completed_at is not null and provider_transaction_key is null and filed_at is null
   from private.order_partial_cancellations where id = (pg_temp.pc_head(20)).id)
 and private.order_item_active_qty(pg_temp.pc_id('item-partial-cancel-a', 9)) = 1
 and (select qty from public.order_shipment_items where order_item_id = pg_temp.pc_id('item-partial-cancel-a', 9)) = 1
 and private.payment_partial_refunded_amount(pg_temp.pc_id('payment', 9)) = 0
 and exists(select 1 from public.notifications where source_id = (pg_temp.pc_head(20)).id::text and body like '%돌려드릴 결제 금액은 없습니다%'),
 'zero_refund_applied_without_money');

-- 9-2. 잔액 0원: A·C를 빼면 남는 B가 전액 할인이라 남은 잔액 전부(24,000원)를 결제사 부분 취소로 돌려준다.
--      뒤의 운영자 전액 취소는 돌려줄 잔액이 0원이라 환불 의도도 0원이고 결제사 없이 확정한다.
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert(public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 10), pg_temp.pc_items('a:2,c:1@10'))
 @> '{"refundAmount": 24000, "balanceBefore": 24000, "balanceAfter": 0, "remainingQty": 1}', 'remaining_balance_zero_previewed');
select pg_temp.pc_start('a:2,c:1@10', 21, 24000);
reset role;
select pg_temp.pc_complete(21, 24000, 10);
set local role authenticated;
select pg_temp.pc_auth();
select public.admin_start_order_cancellation(pg_temp.pc_id('order', 10), 'out_of_stock', null, false) as zero_request \gset
reset role;
select pg_temp.pc_assert((select amount = 0 and status = 'requested' from public.refunds where payment_id = pg_temp.pc_id('payment', 10)), 'zero_remainder_intent');
select public.complete_order_cancellation_request(:'zero_request', array['TEST-PC-KEY-10'], pg_temp.pc_id('user', 1));
select pg_temp.pc_assert((select amount = 0 and status = 'done' from public.refunds where payment_id = pg_temp.pc_id('payment', 10))
 and (select status = 'canceled' from public.orders where id = pg_temp.pc_id('order', 10))
 and private.payment_partial_refunded_amount(pg_temp.pc_id('payment', 10)) = 24000, 'zero_remainder_cancel_completes');

-- 9-3. 선물 주문: 열린다. 환불·알림은 결제한 분(주문자)에게, 결정 기록은 결제한 분의 결정이다.
insert into private.gift_intents(id, sender_id, recipient_id, state, sender_label, recipient_label, expires_at, order_id, ordered_source_revision)
 values (pg_temp.pc_id('gift', 11), pg_temp.pc_id('user', 2), pg_temp.pc_id('user', 3), 'ordered', 'TEST 보낸 사람', 'TEST 받는 사람',
  clock_timestamp() + interval '7 days', pg_temp.pc_id('order', 11), 'test');
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert((select context->'blockers' = '[]'::jsonb and (context->>'gift')::boolean and (context->>'canManage')::boolean
  from (select public.admin_order_partial_cancellation_context(pg_temp.pc_id('order', 11)) context) s), 'gift_order_opens_for_payer');
select pg_temp.pc_start('a:1@11', 22, 9500, 'TEST 결제자 11/12 통화 — 품절 상품만 취소');
reset role;
select pg_temp.pc_complete(22, 9500, 11);
select pg_temp.pc_assert(exists(select 1 from public.notifications where source_id = (pg_temp.pc_head(22)).id::text and user_id = pg_temp.pc_id('user', 2))
 and not exists(select 1 from public.notifications where source_id = (pg_temp.pc_head(22)).id::text and user_id = pg_temp.pc_id('user', 3)), 'gift_refund_goes_to_payer');

-- 9-4. 합포장: 팩에 묶인 배송 건을 비우는 부분 취소는 먼저 합포장을 해제하라고 막는다.
--      ⑨ 팩에 남는 배송 건(주문 16)은 부분 취소 진행 중엔 묶음 준비가 아니고, 끝나면 살아 있는 수량으로 다시 준비다.
insert into private.shipment_packs(id, created_by) values (pg_temp.pc_id('pack', 1), pg_temp.pc_id('user', 1));
insert into private.shipment_pack_members(pack_id, shipment_id, identity_digest)
 select pg_temp.pc_id('pack', 1), s, encode(extensions.digest(private.shipment_pack_identity(s)::text, 'sha256'), 'hex')
 from unnest(array[pg_temp.pc_id('shipment-1', 15), pg_temp.pc_id('shipment-1', 16)]) s;
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_error($$select public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 15), pg_temp.pc_items('a:2,b:1@15'))$$, 'partial_cancel_shipment_packed');
select pg_temp.pc_assert(public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 15), pg_temp.pc_items('c:1@15')) @> '{"shippingRefundAmount": 3000}',
 'unpacked_shipment_can_close');
select pg_temp.pc_start('a:1@16', 23, 9500);
reset role;
select pg_temp.pc_assert(not private.shipment_pack_ready(pg_temp.pc_id('shipment-1', 16)), 'pack_not_ready_while_partial_in_flight');
-- ⑥ 재고 대조의 출고 대기는 살아 있는 수량이고, 부분 복원은 '돌아온 수량'에 잡히지 않는다. 회원 누적 구매 한도도 살아 있는 수량만 센다.
select pending_qty as flows_pending_before, returned_since_qty as flows_returned_before
 from private.stock_reconcile_flows(array[pg_temp.pc_variant('partial-cancel-a')], clock_timestamp() - interval '1 day') \gset
select private.member_goods_reserved_qty(pg_temp.pc_id('user', 2), 'partial-cancel-a') as reserved_goods_before,
 private.member_variant_reserved_qty(pg_temp.pc_id('user', 2), pg_temp.pc_variant('partial-cancel-a')) as reserved_variant_before \gset
select pg_temp.pc_complete(23, 9500, 16);
select pg_temp.pc_assert(private.shipment_pack_ready(pg_temp.pc_id('shipment-1', 16)), 'pack_ready_with_live_quantity');
select pg_temp.pc_assert((select pending_qty = :flows_pending_before - 1 and returned_since_qty = :flows_returned_before
  from private.stock_reconcile_flows(array[pg_temp.pc_variant('partial-cancel-a')], clock_timestamp() - interval '1 day')), 'stock_reconcile_pending_is_live_quantity');
select pg_temp.pc_assert(private.member_goods_reserved_qty(pg_temp.pc_id('user', 2), 'partial-cancel-a') = :reserved_goods_before - 1
 and private.member_variant_reserved_qty(pg_temp.pc_id('user', 2), pg_temp.pc_variant('partial-cancel-a')) = :reserved_variant_before - 1,
 'member_purchase_limit_counts_live_quantity');
-- ⑦ 배송 목록 내보내기 줄은 살아 있는 수량·남은 결제 몫이다.
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert((select jsonb_agg(jsonb_build_object('good', line->>'goodId', 'qty', (line->>'qty')::integer, 'total', (line->>'itemTotal')::bigint)
   order by line->>'goodId')
  from jsonb_array_elements(public.admin_delivery_list_export_lines(array[pg_temp.pc_id('shipment-1', 16)])) line)
 = '[{"good": "partial-cancel-a", "qty": 1, "total": 9500}, {"good": "partial-cancel-b", "qty": 1, "total": 10000}]'::jsonb,
 'delivery_list_export_lines_use_remaining_share');
reset role;
-- ⑧ 유입 분석의 환불액에 부분 취소 환불이 들어간다.
insert into private.store_analytics_sessions(id, token_hash, notice_version, created_at, last_seen_at, event_count)
 values (pg_temp.pc_id('analytics-session', 16), repeat('7', 64), 'analytics-v1', clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours', 1);
insert into private.store_analytics_order_bindings(order_id, session_id, bound_at, channel, source, medium, page_kind, page_target)
 values (pg_temp.pc_id('order', 16), pg_temp.pc_id('analytics-session', 16), clock_timestamp() - interval '1 hour', 'direct', 'none', 'none', 'home', 'home');
insert into private.payment_provider_evidence(payment_attempt_id, evidence_kind, approved_at)
 values (pg_temp.pc_id('attempt', 16), 'confirm_approved', clock_timestamp() - interval '30 minutes');
select pg_temp.pc_assert((select gross_amount = 40000 and refund_amount = 9500
  from private.store_analytics_paid_orders(clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 day') where order_id = pg_temp.pc_id('order', 16)),
 'store_analytics_refund_includes_partial');

-- 9-5. 반품(출고지별 회수): 부분 취소 → 배송완료 → 반품 → 출고지마다 입고 확인 → 환불 확정. 남은 잔액만 환불하고 남은 수량만 되돌린다.
-- 입고일은 주문일 이후·오늘 이전이어야 하므로 회수 시험 주문은 이틀 전 주문으로 둔다.
update public.orders set created_at = clock_timestamp() - interval '2 days' where id in (pg_temp.pc_id('order', 12), pg_temp.pc_id('order', 13));
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_start('a:1@12', 24, 9500);
reset role;
select pg_temp.pc_complete(24, 9500, 12);
select pg_temp.pc_ship(12);
select pg_temp.pc_stock('partial-cancel-a') as a12_before, pg_temp.pc_stock('partial-cancel-b') as b12_before, pg_temp.pc_stock('partial-cancel-c') as c12_before \gset
-- 구매자 클레임 접수는 서버(서비스 역할)가 본인 확인 뒤 부른다.
select pg_temp.pc_assert(public.request_order_claim(pg_temp.pc_id('order', 12), pg_temp.pc_id('user', 2), 'return', 'TEST 반품 — 남은 상품', 'defect') = 'requested',
 'return_requested_after_partial');
set local role authenticated;
select pg_temp.pc_auth();
select id as return_claim from public.order_cancellation_requests where order_id = pg_temp.pc_id('order', 12) \gset
select public.admin_decide_order_claim(:'return_claim', 'approve', null);
select public.admin_record_order_claim_origin_collection(:'return_claim', pg_temp.pc_id('shipment-1', 12), 'TEST 출고지 1 입고 확인');
select public.admin_record_order_claim_origin_collection(:'return_claim', pg_temp.pc_id('shipment-2', 12), 'TEST 출고지 2 입고 확인');
-- 회수 스냅샷은 부분 취소로 줄어든 배송 건 수량(A 1개)이다. 살아 있는 수량과 맞으므로 회수가 끝난다.
select pg_temp.pc_assert((public.admin_order_claim_detail(:'return_claim')#>>'{claim,collectionComplete}')::boolean
 and (public.admin_order_claim_detail(:'return_claim')#>>'{claim,stage}') = 'collected', 'origin_collections_complete_with_live_quantity');
select public.admin_record_order_claim_refund(:'return_claim', 'pg_cancel', 'filed', null);
reset role;
select pg_temp.pc_assert((select amount = 30500 and status = 'requested' from public.refunds where payment_id = pg_temp.pc_id('payment', 12)), 'return_refund_intent_is_remaining_balance');
select public.complete_order_cancellation_request(:'return_claim', array['TEST-PC-KEY-12'], pg_temp.pc_id('user', 1));
select pg_temp.pc_assert((select amount = 30500 and status = 'done' from public.refunds where payment_id = pg_temp.pc_id('payment', 12))
 and (select status = 'canceled' from public.orders where id = pg_temp.pc_id('order', 12))
 and pg_temp.pc_stock('partial-cancel-a') = :a12_before + 1 and pg_temp.pc_stock('partial-cancel-b') = :b12_before + 1
 and pg_temp.pc_stock('partial-cancel-c') = :c12_before + 1, 'return_refunds_remaining_and_restores_live_quantity');
-- 연락처 보존 판정: 배송된 수량이 살아 있는 수량과 맞으므로 끝난 주문이다.
select pg_temp.pc_assert(private.contact_order_obligations(pg_temp.pc_id('order', 12)) is distinct from 'operational_unknown', 'contact_obligations_use_live_quantity');

-- 9-6. 교환(출고지 회수 → 재출고): 재출고 수량은 배송된 살아 있는 수량(A 1개)이고 재고 순변동은 0이다. 클레임 상세 품목도 살아 있는 수량이다.
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_start('a:1@13', 25, 9500);
reset role;
select pg_temp.pc_complete(25, 9500, 13);
select pg_temp.pc_ship(13);
select pg_temp.pc_assert(public.request_order_claim(pg_temp.pc_id('order', 13), pg_temp.pc_id('user', 2), 'exchange', 'TEST 교환 — 불량', 'defect') = 'requested',
 'exchange_requested_after_partial');
set local role authenticated;
select pg_temp.pc_auth();
select id as exchange_claim from public.order_cancellation_requests where order_id = pg_temp.pc_id('order', 13) \gset
select public.admin_decide_order_claim(:'exchange_claim', 'approve', null);
select pg_temp.pc_assert((select (item->>'qty')::integer = 1 from jsonb_array_elements(public.admin_order_claim_detail(:'exchange_claim')#>'{order,items}') item
   where item->>'goodId' = 'partial-cancel-a'), 'claim_detail_item_is_live_quantity');
reset role;
select pg_temp.pc_stock('partial-cancel-a') as a13_before \gset
set local role authenticated;
select pg_temp.pc_auth();
select public.admin_record_order_claim_origin_collection(:'exchange_claim', pg_temp.pc_id('shipment-1', 13), 'TEST 교환 회수 입고 확인');
reset role;
select pg_temp.pc_auth();
select private.record_order_claim_shipment_reshipment(:'exchange_claim', pg_temp.pc_id('shipment-1', 13), 'hanjin', 'TESTPC99990013', '[]'::jsonb);
select pg_temp.pc_assert((select r.qty = 1 from public.order_claim_reshipment_items r where r.claim_id = :'exchange_claim' and r.order_item_id = pg_temp.pc_id('item-partial-cancel-a', 13))
 and pg_temp.pc_stock('partial-cancel-a') = :a13_before, 'exchange_reships_live_quantity_with_net_zero_stock');

-- 9-7. 묶음 교환(통합 회수 → 묶음 재출고): 모두 취소된 품목은 넣지 않고, 일부 취소된 품목은 살아 있는 수량만 보낸다.
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_start('a:1,c:1@14', 26, 17500);
reset role;
select pg_temp.pc_complete(26, 17500, 14);
select pg_temp.pc_ship(14);
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy, collected_at, requested_at)
 values (pg_temp.pc_id('claim', 14), pg_temp.pc_id('order', 14), pg_temp.pc_id('user', 2), 'TEST 묶음 교환', 'defect', 'exchange', 'collected', 'legacy',
  clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '1 hour');
select pg_temp.pc_auth();
select private.record_group_claim_reshipment(pg_temp.pc_id('claim', 14), 'hanjin', 'TESTPC99990014', '[]'::jsonb);
select pg_temp.pc_assert((select jsonb_object_agg(i.good_id, a.qty) from private.group_claim_reshipment_allocations a join public.order_items i on i.id = a.order_item_id
   where a.claim_id = pg_temp.pc_id('claim', 14)) = '{"partial-cancel-a": 1, "partial-cancel-b": 1}'::jsonb, 'group_reshipment_uses_live_quantity');

-- 9-8. 발주확인 전(paid) 주문의 ① 고객 변심 취소(자동 승인)·② 하자 취소의 운영자 승인 환불 의도는 남은 잔액이다. ③ 일괄 처리 문맥도 남은 잔액이다.
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_start('a:1@17', 27, 9500);
select pg_temp.pc_start('a:1@18', 28, 9500);
select pg_temp.pc_start('a:1@24', 34, 9500);
reset role;
-- 결제사 확인 전에는 발주확인 전 주문도 취소 가능으로 보지 않는다(처리 중인 부분 취소가 끝나야 한다).
select pg_temp.pc_assert(private.order_cancel_eligible_before_digital(pg_temp.pc_id('order', 17)) and not private.order_cancel_eligible(pg_temp.pc_id('order', 17)),
 'paid_order_not_cancelable_while_partial_in_flight');
select pg_temp.pc_complete(27, 9500, 17), pg_temp.pc_complete(28, 9500, 18), pg_temp.pc_complete(34, 9500, 24);
select pg_temp.pc_assert(private.order_cancel_eligible(pg_temp.pc_id('order', 17)), 'paid_order_cancelable_after_partial');
select public.request_order_claim(pg_temp.pc_id('order', 17), pg_temp.pc_id('user', 2), 'cancel', 'TEST 변심 취소', 'change_of_mind');
select public.request_order_claim(pg_temp.pc_id('order', 18), pg_temp.pc_id('user', 2), 'cancel', 'TEST 하자 취소', 'defect');
select public.request_order_claim(pg_temp.pc_id('order', 24), pg_temp.pc_id('user', 2), 'cancel', 'TEST 하자 취소', 'defect');
select pg_temp.pc_assert((select amount = 30500 from public.refunds where payment_id = pg_temp.pc_id('payment', 17)), 'customer_auto_cancel_refunds_remaining');
select id as decide_claim from public.order_cancellation_requests where order_id = pg_temp.pc_id('order', 18) \gset
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert((select (row->>'refundAmount')::bigint = 30500 from jsonb_array_elements(public.admin_order_claim_bulk_context(array[:'decide_claim'::uuid])) row),
 'bulk_context_refund_is_remaining');
select public.admin_decide_order_claim(:'decide_claim', 'approve', null);
select public.admin_decide_order_cancellation((select id from public.order_cancellation_requests where order_id = pg_temp.pc_id('order', 24)), 'approve', null);
reset role;
select pg_temp.pc_assert((select amount = 30500 from public.refunds where payment_id = pg_temp.pc_id('payment', 18))
 and (select amount = 30500 from public.refunds where payment_id = pg_temp.pc_id('payment', 24)), 'approved_cancel_refunds_remaining');

-- 9-9. ⑤ 구매확정 적립은 부분 취소로 돌려준 굿즈 몫을 뺀 금액 기준이다(40,000 − 배송비 6,000 − 9,500 = 24,500원의 10%).
--      거래확정 엑셀 수집·주문 품목 조회는 부분 취소 수량·남은 수량·남은 금액을 덧붙인다.
update public.orders set store_credit_policy_snapshot = '{"earnKind": "rate_bps", "earnValue": 1000, "earnMaxPerOrder": 100000, "maxBalance": 10000000, "validityDays": 365}'
 where id = pg_temp.pc_id('order', 19);
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_start('a:1@19', 29, 9500);
reset role;
select pg_temp.pc_complete(29, 9500, 19);
select pg_temp.pc_ship(19);
update public.orders set status = 'done', done_at = clock_timestamp() where id = pg_temp.pc_id('order', 19);
select pg_temp.pc_assert((select issued_amount = 2450 from private.store_credit_lots where source_order_id = pg_temp.pc_id('order', 19) and source_kind = 'order_done'),
 'done_earn_basis_excludes_partial_goods');
select pg_temp.pc_assert((select o @> '{"partialRefundedAmount": 9500, "partialCancellations": [{"sequence": 1, "state": "completed", "refundAmount": 9500}]}'
   and (select item @> '{"qty": 2, "canceledQty": 1, "activeQty": 1, "partialCanceledPaidAmount": 9500, "partialCanceledGrossAmount": 10000, "partialCanceledCouponDiscount": 500}'
     from jsonb_array_elements(o->'items') item where item->>'goodId' = 'partial-cancel-a')
   and (select not (item ? 'canceledQty') from jsonb_array_elements(o->'items') item where item->>'goodId' = 'partial-cancel-b')
  from jsonb_array_elements(private.collect_settled_export_for_search('2031-03-01', '2031-03-01', '', 'ordered', 'all')->'orders') o
  where o->>'id' = pg_temp.pc_id('order', 19)::text), 'settled_export_carries_partial_cancellation');
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert((select row @> '{"qty": 2, "itemAmount": 20000, "canceledQty": 1, "activeQty": 1, "activeItemAmount": 10000, "partialCanceledPaidAmount": 9500}'
  from jsonb_array_elements(public.admin_search_order_items_console('done', '2031-03-01', '2031-03-01', null, 100, 0, 'all', 'ordered', 'newest', null)->'rows') row
  where row->>'orderId' = pg_temp.pc_id('order', 19)::text and row->>'goodId' = 'partial-cancel-a'), 'order_items_console_shows_canceled_quantity');

-- 9-10. 판매 분석: 굿즈 순위는 남은 수량·남은 매출이고 모두 취소된 굿즈는 빠진다. 구매 고객 세그먼트는 모두 취소된 품목을 구매로 세지 않는다.
--       (주문 2: 4절에서 A 1개·C 1개를 부분 취소했다.)
select pg_temp.pc_assert((select jsonb_agg(jsonb_build_object('good', r->>'goodId', 'qty', (r->>'qty')::integer, 'revenue', (r->>'revenue')::bigint) order by r->>'goodId')
  from jsonb_array_elements(public.admin_sales_goods_page('2031-04-01T00:00:00Z', '2031-04-02T00:00:00Z', null, 1, 20)->'rows') r)
 = '[{"good": "partial-cancel-a", "qty": 1, "revenue": 10000}, {"good": "partial-cancel-b", "qty": 1, "revenue": 10000}]'::jsonb, 'sales_goods_page_uses_live_quantity');
reset role;
update public.orders set created_at = date_trunc('hour', statement_timestamp()) - interval '30 minutes' where id = pg_temp.pc_id('order', 23);
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_start('a:2@23', 30, 19000);
reset role;
select pg_temp.pc_complete(30, 19000, 23);
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert((select jsonb_agg(jsonb_build_object('good', r->>'goodId', 'qty', (r->>'qty')::integer, 'revenue', (r->>'revenue')::bigint) order by r->>'goodId')
  from jsonb_array_elements(public.admin_sales_hourly_report()->'lastHourGoods') r)
 = '[{"good": "partial-cancel-b", "qty": 1, "revenue": 10000}, {"good": "partial-cancel-c", "qty": 1, "revenue": 5000}]'::jsonb
 and (public.admin_sales_hourly_report()#>>'{summary,current,revenue}')::bigint = 21000, 'sales_hourly_report_uses_live_quantity');
-- 홈 랭킹(공개 굿즈): 오늘 결제된 주문의 살아 있는 수량으로 순위를 매긴다(주문 23은 A 2개를 모두 취소했다).
reset role;
create function pg_temp.pc_publish(good text) returns void language plpgsql security definer set search_path = '' as $$
declare config jsonb; begin
 -- KC 검토는 실제 RPC로 남긴다(TEST-ONLY 합성 근거). 공개 트리거가 검토를 다시 확인한다.
 config := public.admin_read_goods_kc(good);
 perform public.admin_save_goods_kc(good, jsonb_build_array(jsonb_build_object('family', 'other', 'scheme', 'not_applicable', 'productCategory', '자동검증 합성자료',
   'modelName', 'TEST-ONLY:'||good, 'businessRole', 'manufacturer', 'businessName', '자동검증 전용 합성 사업자', 'identifier', '',
   'publicNote', '자동검증 전용 합성 고시이며 실제 판매 제품의 KC 적합성을 나타내지 않습니다.',
   'variantIds', (select coalesce(jsonb_agg(v.id::text order by v.id), '[]') from public.goods_variants v where v.good_id = good),
   'basis', '자동검증용 합성 fixture. 실제 제품의 적용성 또는 적합성을 판정하지 않습니다.',
   'evidence', jsonb_build_object('applicability', 'TEST-ONLY:fixtures/'||good, 'certificate', '', 'testReport', '', 'declaration', ''))),
  'reviewed', (config->>'revision')::integer, config->>'contextFingerprint', true);
 update public.goods set published_at = clock_timestamp() where id = good;
end $$;
select pg_temp.pc_auth();
select pg_temp.pc_publish(good) from unnest(array['partial-cancel-a', 'partial-cancel-b', 'partial-cancel-c']) good;
update public.ips set published_at = clock_timestamp() where id = 'partial-cancel-ip';
insert into private.payment_provider_evidence(payment_attempt_id, evidence_kind, approved_at) values (pg_temp.pc_id('attempt', 23), 'confirm_approved', clock_timestamp());
-- 살아 있는 수량: B 2개(주문 16·23) > A 1개(주문 16) = C 1개(주문 23). 취소된 수량까지 세면 A가 4개로 1위다.
select pg_temp.pc_assert(public.get_home_sales_rankings()#>>'{realtime,0}' = 'partial-cancel-b', 'home_rankings_use_live_quantity');
update public.profiles set onboarded_at = clock_timestamp(), consents = '{"terms": true, "privacy": true}', birth_date = '1990-01-01' where id = pg_temp.pc_id('user', 2);
select pg_temp.pc_assert(not exists(select 1 from private.customer_segment_members(
   '{"version": 1, "target": "purchased", "goodsScope": "goods", "goodIds": ["partial-cancel-c"], "months": 1}', '2031-04-01T03:30:00Z'))
 and exists(select 1 from private.customer_segment_members(
   '{"version": 1, "target": "purchased", "goodsScope": "goods", "goodIds": ["partial-cancel-b"], "months": 1}', '2031-04-01T03:30:00Z')),
 'segment_ignores_fully_canceled_items');

-- 9-11. 환불 송금 대기(T03) 목록·엑셀에 무통장 부분 취소가 같은 줄 순서로 합쳐진다.
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_start('a:1@20', 31, 9500, account => '{"bankName":"TEST 합성은행","accountNumber":"000000002020","accountHolder":"TEST 구매자"}');
select pg_temp.pc_assert((select (page->>'total')::integer = 1 and jsonb_array_length(page->'rows') = 1
   and page->'rows'->0 @> jsonb_build_object('kind', 'partial_cancellation', 'partialCancellationId', (pg_temp.pc_head(31)).id, 'orderId', pg_temp.pc_id('order', 20),
     'sequence', 1, 'amount', 9500, 'gift', false)
   and page->'rows'->0->>'filedAt' is not null
  from (select public.admin_list_bank_transfer_refunds_numbered(50, 0) page) s), 'refund_transfer_queue_includes_partial');
reset role;
set local role service_role;
select pg_temp.pc_assert(public.service_export_order_partial_cancellation_refund_accounts(pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1), pg_temp.pc_id('export', 1),
  jsonb_build_array(jsonb_build_object('partialCancellationId', (pg_temp.pc_head(31)).id, 'orderId', pg_temp.pc_id('order', 20))))
 = jsonb_build_object('exportId', pg_temp.pc_id('export', 1), 'rows', jsonb_build_array(jsonb_build_object('partialCancellationId', (pg_temp.pc_head(31)).id,
   'status', 'revealed', 'bankName', 'TEST 합성은행', 'accountNumber', '000000002020', 'accountHolder', 'TEST 구매자'))), 'partial_refund_account_export');
select pg_temp.pc_error(format('select public.service_export_order_partial_cancellation_refund_accounts(%L, %L, %L, %L)', pg_temp.pc_id('user', 3), pg_temp.pc_id('session', 3),
 pg_temp.pc_id('export', 2), jsonb_build_array(jsonb_build_object('partialCancellationId', (pg_temp.pc_head(31)).id, 'orderId', pg_temp.pc_id('order', 20)))), '42501');
select pg_temp.pc_error(format('select public.service_export_order_partial_cancellation_refund_accounts(%L, %L, %L, %L)', pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1),
 pg_temp.pc_id('export', 3), jsonb_build_array(jsonb_build_object('partialCancellationId', (pg_temp.pc_head(31)).id, 'orderId', pg_temp.pc_id('order', 19)))), 'PT409');
reset role;
select pg_temp.pc_assert(exists(select 1 from public.audit_log where action = 'admin.order.partial_cancellation_account_viewed'
   and diff->>'partialCancellationId' = (pg_temp.pc_head(31)).id::text and diff->>'exportId' = pg_temp.pc_id('export', 1)::text and diff->>'purpose' = 'list_export')
 and exists(select 1 from public.audit_log where action = 'admin.list_export.partial_cancel_refund_accounts_revealed'
   and diff->>'exportId' = pg_temp.pc_id('export', 1)::text and (diff->>'revealedCount')::integer = 1)
 and not exists(select 1 from public.audit_log where diff::text like '%000000002020%')
 and not has_function_privilege('authenticated', 'public.service_export_order_partial_cancellation_refund_accounts(uuid,uuid,uuid,jsonb)', 'execute'),
 'partial_refund_account_export_audited');

-- 9-12. 결제확인필요 해소(결제 담당 admin·세션·사유·감사). 결제사 조회 결과로만 닫는다.
--   주문 22: 잔액이 시작 때 그대로(돈이 안 움직임) → 진행하지 않음. 주문 21: 이미 취소됨 + 그 사이 재고 승계가 바뀜 → 승계를 따라 복원.
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_start('a:1@22', 32, 9500);
select pg_temp.pc_start('c:1@21', 33, 8000);
reset role;
select public.service_mark_order_partial_cancellation_needs_review((pg_temp.pc_head(32)).id, 'provider_unavailable', pg_temp.pc_id('user', 1));
select public.service_mark_order_partial_cancellation_needs_review((pg_temp.pc_head(33)).id, 'local_finalize_failed', pg_temp.pc_id('user', 1));
-- 해소 RPC는 서비스 전용이다(서버가 결제사를 조회해 정한 값만 받는다). authenticated는 레거시 관리자여도 직접 부르지 못한다.
reset role;
select (pg_temp.pc_head(32)).id as h32, (pg_temp.pc_head(33)).id as h33 \gset
set local role authenticated;
select pg_temp.pc_auth(3);
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, null, 40000, %L, %L)', :'h32', 'not_moved', 'TEST 잔액 그대로 확인', pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1)), '42501');
select pg_temp.pc_auth();
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, null, 40000, %L, %L)', :'h32', 'not_moved', 'TEST 우회 시험', pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1)), '42501');
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, %L, 30500, %L, %L)', :'h32', 'already_canceled', 'TEST 우회 시험', 'FABRICATED-TX-KEY', pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1)), '42501');
select pg_temp.pc_error(format('select public.admin_resolve_order_partial_cancellation(%L, %L, %L, null, 40000)', :'h32', 'not_moved', 'TEST 옛 이름'), '42883');
reset role;
select pg_temp.pc_assert((select state = 'needs_review' and resolution is null from private.order_partial_cancellations where id = :'h32'), 'direct_resolve_changes_nothing');
set local role service_role;
-- 신원 판정: 운영자가 아닌 사용자, 다른 사람의 세션, 없는 세션, 세션 없음은 모두 거절한다.
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, null, 40000, %L, %L)', :'h32', 'not_moved', 'TEST 잔액 그대로 확인', pg_temp.pc_id('user', 3), pg_temp.pc_id('session', 3)), '42501');
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, null, 40000, %L, %L)', :'h32', 'not_moved', 'TEST 잔액 그대로 확인', pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 3)), '42501');
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, null, 40000, %L, %L)', :'h32', 'not_moved', 'TEST 잔액 그대로 확인', pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 99)), '42501');
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, null, 40000, %L, null)', :'h32', 'not_moved', 'TEST 잔액 그대로 확인', pg_temp.pc_id('user', 1)), '42501');
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, null, 40000, null, %L)', :'h32', 'not_moved', 'TEST 잔액 그대로 확인', pg_temp.pc_id('session', 1)), '42501');
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, null, 40000, %L, %L)', :'h32', 'not_moved', 'TEST', pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1)), 'partial_cancel_resolution_reason_required');
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, null, 30500, %L, %L)', :'h32', 'not_moved', 'TEST 잔액 그대로 확인', pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1)), 'partial_cancel_resolution_evidence_mismatch');
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, %L, 40000, %L, %L)', :'h32', 'already_canceled', 'TEST 취소 확인', 'TEST-PC-TX-32', pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1)), 'partial_cancel_resolution_evidence_mismatch');
select pg_temp.pc_assert(public.service_resolve_order_partial_cancellation(:'h32', 'not_moved', 'TEST 결제사 잔액이 시작 때 그대로', null, 40000, pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1))
 @> '{"state": "rejected", "followedSuccessor": false}', 'resolve_not_moved_rejects');
reset role;
select pg_temp.pc_assert((select state = 'rejected' and applied_at is null and resolution = 'not_moved' and resolved_by = pg_temp.pc_id('user', 1)
   and resolution_reason = 'TEST 결제사 잔액이 시작 때 그대로' from private.order_partial_cancellations where id = (pg_temp.pc_head(32)).id)
 and (select qty from public.order_shipment_items where order_item_id = pg_temp.pc_id('item-partial-cancel-a', 22)) = 2
 and not private.order_partial_cancel_in_flight(pg_temp.pc_id('order', 22))
 and exists(select 1 from public.audit_log where action = 'admin.order.partial_cancellation_resolved' and diff->>'resolution' = 'not_moved'
   and diff->>'partialCancellationId' = (pg_temp.pc_head(32)).id::text), 'not_moved_changes_nothing_but_closes');
-- 그 사이 C가 D로 재고 승계됐다(상품 통합). 수량 단위 복원이 막히므로 해소는 승계를 따라 지금의 실물 옵션(D)에 되돌린다.
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty, origin_id)
 values ('partial-cancel-d', 'partial-cancel-ip', 'TEST 통합 대상 상품 D', '문구', 5000, 'ok', 10, pg_temp.pc_id('origin', 2));
insert into private.goods_group_operations(operation_id, actor_id, session_id, command, request_hash)
 values (pg_temp.pc_id('goods-op', 1), pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1), 'convert', repeat('a', 64));
insert into private.goods_stock_successors(source_variant_id, source_good_id, target_variant_id, target_good_id, operation_id, moved_qty, actor_id)
 values (pg_temp.pc_variant('partial-cancel-c'), 'partial-cancel-c', pg_temp.pc_variant('partial-cancel-d'), 'partial-cancel-d', pg_temp.pc_id('goods-op', 1), 0, pg_temp.pc_id('user', 1));
select pg_temp.pc_stock('partial-cancel-c') as c21_before, pg_temp.pc_stock('partial-cancel-d') as d21_before \gset
set local role service_role;
select pg_temp.pc_assert(public.service_resolve_order_partial_cancellation(:'h33', 'already_canceled', 'TEST 상점관리자에서 취소 거래 확인', 'TEST-PC-TX-33', 32000, pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1))
 @> '{"state": "completed", "followedSuccessor": true}', 'resolve_already_canceled_applies');
select pg_temp.pc_error(format('select public.service_resolve_order_partial_cancellation(%L, %L, %L, %L, 32000, %L, %L)', :'h33', 'already_canceled', 'TEST 다시 해소', 'TEST-PC-TX-33', pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1)), 'partial_cancel_not_needs_review');
reset role;
select pg_temp.pc_assert((select state = 'completed' and provider_transaction_key = 'TEST-PC-TX-33' and resolution = 'already_canceled'
   from private.order_partial_cancellations where id = (pg_temp.pc_head(33)).id)
 and pg_temp.pc_stock('partial-cancel-c') = :c21_before and pg_temp.pc_stock('partial-cancel-d') = :d21_before + 1
 and (select status = 'canceled' from public.order_shipments where id = pg_temp.pc_id('shipment-2', 21))
 and private.payment_partial_refunded_amount(pg_temp.pc_id('payment', 21)) = 8000
 and exists(select 1 from public.audit_log where action = 'order.option_stock_partially_restored' and diff->>'partialCancellationId' = (pg_temp.pc_head(33)).id::text
   and diff->>'followedSuccessor' = 'true' and diff->>'goodId' = 'partial-cancel-d'), 'already_canceled_follows_stock_successor');
-- 사용자 화면 문맥(sales.read)은 기록을 읽고 해소를 보인다.
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert((select context->'history'->0 @> '{"state": "rejected", "resolution": "not_moved"}'
  from (select public.admin_order_partial_cancellation_context(pg_temp.pc_id('order', 22)) context) s), 'context_shows_resolution');
reset role;

-- 9-12b. 기록 읽기 범위: sales.read(influencer)는 고객 결정 요약까지, sales.manage(레거시 코호트 staff)는 운영 메모·처리자까지,
--   송금 증빙·메모·계좌(마스킹 포함)·해소 사유는 레거시 관리자(여기서는 configured primary)만 본다.
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
 select pg_temp.pc_id('user', n), 'authenticated', 'authenticated', 'partial-cancel-'||n||'@example.test', clock_timestamp(), '{}', '{}' from generate_series(4, 5) n;
insert into auth.sessions(id, user_id, created_at, updated_at, not_after)
 select pg_temp.pc_id('session', n), pg_temp.pc_id('user', n), clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 hour' from generate_series(4, 5) n;
update public.profiles set role = 'staff', nickname = 'TEST 열람자 '||right(id::text, 6) where id in (pg_temp.pc_id('user', 4), pg_temp.pc_id('user', 5));
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.pc_id('user', 4), 'influencer');
insert into private.operator_legacy_cohort(profile_id, legacy_role) values (pg_temp.pc_id('user', 5), 'staff');
create function pg_temp.pc_history(actor integer, ord integer) returns jsonb language plpgsql as $$
begin
 perform pg_temp.pc_auth(actor);
 return (public.admin_order_partial_cancellation_context(pg_temp.pc_id('order', 22)))->'history'->ord;
end $$;
grant execute on function pg_temp.pc_history(integer, integer) to authenticated;
set local role authenticated;
select pg_temp.pc_assert((select h ? 'customerDecision' and h->>'state' = 'rejected'
   and not (h ?| array['note', 'createdBy', 'lastErrorCode', 'balanceBefore', 'paymentAmount', 'closedShipments', 'transferEvidence', 'transferNote',
     'refundAccount', 'resolution', 'resolutionReason', 'filedAt', 'resolvedAt'])
  from (select pg_temp.pc_history(4, 0) h) s), 'sales_read_sees_customer_decision_only');
select pg_temp.pc_assert((select h ? 'createdBy' and h ? 'note' and h ? 'closedShipments' and h->>'resolution' = 'not_moved'
   and not (h ?| array['transferEvidence', 'transferNote', 'refundAccount', 'resolutionReason'])
  from (select pg_temp.pc_history(5, 0) h) s), 'sales_manage_without_legacy_hides_finance_fields');
select pg_temp.pc_assert((select h->>'createdBy' like 'TEST 부분취소 %' and h ?& array['transferEvidence', 'transferNote', 'refundAccount']
   and h->>'resolutionReason' = 'TEST 결제사 잔액이 시작 때 그대로'
  from (select pg_temp.pc_history(1, 0) h) s), 'legacy_admin_sees_finance_fields');
select pg_temp.pc_auth();
reset role;

-- 9-13. ③·④ 4절 반품(주문 2)의 일괄 처리 문맥 환불 예정액, 차감 결정, 결제사가 부분 취소를 받지 않아 전액 환불로 돌릴 때의 금액은 모두 남은 잔액 기준이다.
update private.return_fee_deduction_settings set enabled = true where singleton;
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert((select (row->>'refundAmount')::bigint = 19500 from jsonb_array_elements(public.admin_order_claim_bulk_context(array[pg_temp.pc_id('claim', 2)])) row),
 'bulk_context_preview_deducts_from_remaining');
select public.admin_record_order_claim_refund(pg_temp.pc_id('claim', 2), 'pg_cancel', 'filed', null);
reset role;
select pg_temp.pc_assert((select amount = 19500 from public.refunds where payment_id = pg_temp.pc_id('payment', 2)), 'deduction_plan_refund_is_remaining_minus_fee');
select pg_temp.pc_assert(public.service_fallback_order_claim_refund_deduction(pg_temp.pc_id('claim', 2), pg_temp.pc_id('payment', 2), pg_temp.pc_id('user', 1)) = 'not_applied',
 'deduction_fallback_not_applied');
select pg_temp.pc_assert((select amount = 22500 from public.refunds where payment_id = pg_temp.pc_id('payment', 2))
 and exists(select 1 from public.audit_log where action = 'admin.order.claim_refund_deduction_not_applied' and diff->>'claimId' = pg_temp.pc_id('claim', 2)::text
   and (diff->>'refundAmount')::bigint = 22500), 'deduction_fallback_refunds_remaining_balance');
update private.return_fee_deduction_settings set enabled = false where singleton;

-- 9-14. 무통장: 부분 취소들이 결제액을 모두 돌려준 뒤(남은 잔액 0원) 전체 취소는 송금 대기 원장 없이 환불 0원으로 닫는다.
--   주문 25: A와 전액 할인 B가 한 배송 건. A를 부분 취소하면 송금 대기 19,000원이 생기고 잔액은 0원이 된다.
create function pg_temp.pc_order_ab(n integer, provider text, version integer default 2, a_coupon bigint default 1000, b_coupon bigint default 0,
  ship_fee bigint default 3000, initial text default 'confirmed') returns void language plpgsql as $$
declare credit bigint := case when n = 8 then 2000 else 0 end;
  total bigint := (20000 - a_coupon - credit) + (10000 - b_coupon) + ship_fee;
begin
 insert into public.orders(id, user_id, status, total, shipping_fee, discount_total, store_credit_total, calculation_version, address,
   payment_method, created_at, confirmed_at)
 values (pg_temp.pc_id('order', n), pg_temp.pc_id('user', 2), initial::public.order_status, total, ship_fee, a_coupon + b_coupon, credit, 1,
   '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
   (case when provider = 'bank_transfer' then 'bank_transfer' else 'card' end)::public.order_payment_method,
   case when n = 2 then '2031-04-01T03:00:00Z'::timestamptz else '2031-03-01T03:00:00Z'::timestamptz end,
   case when initial = 'confirmed' then clock_timestamp() - interval '1 hour' end);
 insert into public.order_items(id, order_id, good_id, variant_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
 select pg_temp.pc_id('item-'||g.id, n), pg_temp.pc_id('order', n), g.id, v.id, case when g.id = 'partial-cancel-a' then 2 else 1 end, g.price,
   g.name, '문구', 'partial-cancel-ip'
 from public.goods g join public.goods_variants v on v.good_id = g.id and v.is_default where g.id in ('partial-cancel-a','partial-cancel-b');
 if version = 2 then
  -- 버전 2 주문은 거래 계약 묶음이 있어야 품목을 넣을 수 있다. 합성 주문은 품목을 넣은 뒤 버전을 올린다(배분 원장만 쓴다).
  update public.orders set calculation_version = 2 where id = pg_temp.pc_id('order', n);
  insert into private.order_price_allocations(order_item_id, order_id, calculation_version, subtotal, volume_discount, net_subtotal, coupon_discount, store_credit_discount, paid_goods_total)
  values (pg_temp.pc_id('item-partial-cancel-a', n), pg_temp.pc_id('order', n), 2, 20000, 0, 20000, a_coupon, credit, 20000 - a_coupon - credit),
   (pg_temp.pc_id('item-partial-cancel-b', n), pg_temp.pc_id('order', n), 2, 10000, 0, 10000, b_coupon, 0, 10000 - b_coupon);
 end if;
 insert into public.order_shipments(id, order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot)
 select pg_temp.pc_id('shipment-'||o, n), pg_temp.pc_id('order', n), pg_temp.pc_id('origin', o), 'TEST 부분취소 출고지 '||o, ship_fee, '{}' from generate_series(1, 1) o;
 insert into public.order_shipment_items(order_id, shipment_id, order_item_id, qty)
 select i.order_id, pg_temp.pc_id('shipment-1', n), i.id, i.qty
 from public.order_items i where i.order_id = pg_temp.pc_id('order', n);
 insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 values (pg_temp.pc_id('payment', n), pg_temp.pc_id('user', 2), provider::public.payment_provider, 'order', pg_temp.pc_id('order', n), total, 'paid',
   case when provider = 'bank_transfer' then 'bank_transfer:'||pg_temp.pc_id('order', n) else 'TEST-PC-KEY-'||n end, 'partial-cancel-payment-'||n, clock_timestamp() - interval '2 hours');
 insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values (pg_temp.pc_id('attempt', n), provider::public.payment_provider, pg_temp.pc_id('user', 2), 'order', pg_temp.pc_id('order', n), total, 'KRW', 'approved',
   'partial-cancel-attempt-'||n, 'TEST-PC-ORDER-'||n, 'TEST-PC-PRODUCT-'||n, pg_temp.pc_id('payment', n), clock_timestamp() + interval '1 hour');
end $$;
select pg_temp.pc_order_ab(25, 'bank_transfer', 2, 1000, 10000, 0, 'paid');
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_start('a:2@25', 90, 19000, account => '{"bankName":"TEST 합성은행","accountNumber":"000000001234","accountHolder":"TEST 구매자"}');
reset role;
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, claim_type, stage, collection_policy, requested_at)
 values (pg_temp.pc_id('claim', 25), pg_temp.pc_id('order', 25), pg_temp.pc_id('user', 2), 'TEST 무통장 전액 취소', 'cancel', 'processing', 'origin', clock_timestamp() - interval '40 minutes');
insert into public.order_cancellation_claims(order_id, requested_by, previous_status) values (pg_temp.pc_id('order', 25), pg_temp.pc_id('user', 2), 'paid');
insert into public.refunds(payment_id, amount, status, cancellation_request_id) values (pg_temp.pc_id('payment', 25), 0, 'requested', pg_temp.pc_id('claim', 25));
insert into private.claim_refund_accounts(claim_id, bank_name, account_number, account_holder, masked_account, masked_holder)
 values (pg_temp.pc_id('claim', 25), 'TEST 합성은행', '000000001234', 'TEST 합성구매자', 'TEST 합성은행 ********1234', 'T*********');
select pg_temp.pc_assert(private.bank_transfer_zero_refund_payment(pg_temp.pc_id('order', 25)) = pg_temp.pc_id('payment', 25)
 and private.bank_transfer_zero_refund_payment(pg_temp.pc_id('order', 3)) is null and private.bank_transfer_zero_refund_payment(pg_temp.pc_id('order', 1)) is null,
 'zero_refund_only_when_partials_returned_everything');
select claim_revision as zero_rev from public.order_cancellation_requests where id = pg_temp.pc_id('claim', 25) \gset
select pg_temp.pc_stock('partial-cancel-a') as a25_before, pg_temp.pc_stock('partial-cancel-b') as b25_before \gset
set local role authenticated;
select pg_temp.pc_auth();
select pg_temp.pc_assert(public.admin_record_bank_transfer_refund(pg_temp.pc_id('order', 25), pg_temp.pc_id('claim', 25), pg_temp.pc_id('operation', 91), 'confirm_cancellation',
  :zero_rev, 19000, clock_timestamp(), 'TEST 증빙', 'TEST-ONLY 합성 0원 환불. 실제 송금 없음.', true, pg_temp.pc_id('user', 1), pg_temp.pc_id('session', 1)) @> '{"state": "recorded"}',
 'zero_remaining_bank_cancel_confirms');
reset role;
select pg_temp.pc_assert((select status = 'canceled' from public.orders where id = pg_temp.pc_id('order', 25))
 and (select status = 'refunded' from public.payments where id = pg_temp.pc_id('payment', 25))
 and (select amount = 0 and status = 'done' and method = 'bank_transfer' from public.refunds where payment_id = pg_temp.pc_id('payment', 25))
 and (select status = 'completed' from public.order_cancellation_requests where id = pg_temp.pc_id('claim', 25))
 and not exists(select 1 from private.bank_transfer_claim_refunds where order_id = pg_temp.pc_id('order', 25))
 and not exists(select 1 from public.order_cancellation_claims where order_id = pg_temp.pc_id('order', 25))
 and pg_temp.pc_stock('partial-cancel-a') = :a25_before and pg_temp.pc_stock('partial-cancel-b') = :b25_before + 1
 and private.payment_partial_refunded_amount(pg_temp.pc_id('payment', 25)) = 19000, 'zero_remaining_bank_cancel_closes_without_transfer_ledger');

-- 8. 원장 불변·권한 ---------------------------------------------------------------------------------------------------------
select pg_temp.pc_error(format('update private.order_partial_cancellations set refund_amount = 1 where id = %L', (pg_temp.pc_head(1)).id), 'partial_cancellation_immutable');
select pg_temp.pc_error(format('delete from private.order_partial_cancellations where id = %L', (pg_temp.pc_head(1)).id), 'partial_cancellation_immutable');
select pg_temp.pc_error(format('update private.order_partial_cancellation_items set qty = 2 where partial_cancellation_id = %L', (pg_temp.pc_head(1)).id), 'partial_cancellation_immutable');
select pg_temp.pc_assert(not has_function_privilege('anon', 'public.admin_start_order_partial_cancellation(uuid,jsonb,text,text,boolean,bigint,uuid,jsonb)', 'execute')
 and not has_function_privilege('service_role', 'public.admin_start_order_partial_cancellation(uuid,jsonb,text,text,boolean,bigint,uuid,jsonb)', 'execute')
 and not has_function_privilege('authenticated', 'public.service_complete_order_partial_cancellation(uuid,bigint,text,text,uuid)', 'execute')
 and has_function_privilege('service_role', 'public.service_complete_order_partial_cancellation(uuid,bigint,text,text,uuid)', 'execute')
 and not has_function_privilege('authenticated', 'public.service_resolve_order_partial_cancellation(uuid,text,text,text,bigint,uuid,uuid)', 'execute')
 and not has_function_privilege('anon', 'public.service_resolve_order_partial_cancellation(uuid,text,text,text,bigint,uuid,uuid)', 'execute')
 and has_function_privilege('service_role', 'public.service_resolve_order_partial_cancellation(uuid,text,text,text,bigint,uuid,uuid)', 'execute')
 and has_function_privilege('authenticated', 'public.get_my_order_partial_cancellations(uuid)', 'execute')
 and not has_function_privilege('anon', 'public.get_my_order_partial_cancellations(uuid)', 'execute')
 and not has_table_privilege('authenticated', 'private.order_partial_cancellations', 'select')
 -- 운영자 능력 검사가 행 잠금을 쓰므로 PostgREST 읽기 전용 트랜잭션에 걸리지 않게 읽기 RPC도 VOLATILE이다.
 and (select bool_and(provolatile = 'v') from pg_proc where oid in ('public.admin_order_partial_cancellation_context(uuid)'::regprocedure,
   'public.admin_preview_order_partial_cancellation(uuid,jsonb)'::regprocedure)), 'grants_sealed');
set local role authenticated;
select pg_temp.pc_auth(3);
select pg_temp.pc_error($$select pg_temp.pc_start('b:1@6', 9, 10000)$$, '42501');
reset role;

select 'order_partial_cancellation ok' as result;
rollback;
