\set ON_ERROR_STOP on
-- 부분 반품(원장 #17 CLM-025, ADR-0047). 한 트랜잭션 안에서 합성 주문을 만들고 끝에 되돌린다 — 실결제·결제사 호출 없음.
--  1. 스위치 OFF: 고객 접수·대리 접수·문맥이 막히고 클레임 품목이 생기지 않는다(주문 전체 클레임 경로는 그대로).
--  2. 토스: A 1개 부분 반품 → 회수 행·묶음은 고른 품목만 → 환불 접수(원장 processing, 주문 전체 정합화 경로 거절) → 결제사 확인 →
--     클레임 완료·배송 건 품목 1개·A 재고 +1·알림. 같은 주문 두 번째 부분 반품(A 나머지 + B)이 배송 건 1을 비워 배송비 함께 환불,
--     반품배송비 편도 차감. 남은 C를 고르면 주문 전체 반품으로 접수되고 회수는 남은 배송 건만, 남은 잔액만 환불·남은 수량만 재고 복원.
--  3. 무료배송 주문: 첫 변심 부분 반품은 왕복, 다음 부분 반품·주문 전체 반품은 편도(나가는 쪽 운임은 한 번만).
--  4. 무통장: 환불 접수 때 적용·송금 대기(계좌 옮김) → 송금 증빙으로 클레임 완료. 계좌 없으면 거절.
--  5. 결제사가 부분 취소를 받지 않음 → 원장 rejected·클레임 확인 필요(전액 환불로 돌리지 않음) → 다시 접수 → 확인 필요 → 완료.
--  6. 불량 재고: 고른 품목만·반품 수량, 적용 때 판매 재고 제외, 적용 뒤 기록.
--  7. 판정: 발송 전 배송 건 품목·나이스페이·선물·수량 초과·진행 중 클레임·부분 취소 막힘·교환 전환 막힘. 운영자 대리 접수(회수 대상 좁힘·재전송).
--  8. 재고 대조: 부분 반품은 '창고를 떠난 수량'을 줄이지 않고 회수로 돌아온다.
begin;
update public.shipping_carriers set tracking_number_pattern=null,tracking_number_rule=null where tracking_number_pattern is not null;
create function pg_temp.pr_id(kind text, n integer) returns uuid language sql immutable as $$select md5('partial-return:'||kind||':'||n)::uuid$$;
create function pg_temp.pr_assert(ok boolean, label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Partial return assertion failed: %', label; end if; end $$;
create function pg_temp.pr_error(q text, expected text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if sqlstate = expected or sqlerrm = expected then return; end if; raise; end;
 raise exception 'Expected partial return rejection: %', expected; end $$;
create function pg_temp.pr_auth(actor integer default 1) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub', '', true);
 perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.pr_id('user', actor),
  'session_id', pg_temp.pr_id('session', actor))::text, true);
end $$;
grant execute on function pg_temp.pr_id(text, integer), pg_temp.pr_assert(boolean, text), pg_temp.pr_error(text, text), pg_temp.pr_auth(integer) to authenticated, service_role;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
 select pg_temp.pr_id('user', n), 'authenticated', 'authenticated', 'partial-return-'||n||'@example.test', clock_timestamp(), '{}', '{}' from generate_series(1, 3) n;
insert into auth.sessions(id, user_id, created_at, updated_at, not_after)
 select pg_temp.pr_id('session', n), pg_temp.pr_id('user', n), clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 hour' from generate_series(1, 3) n;
update public.profiles set nickname = 'TEST 부분반품 '||right(id::text, 6),
 role = case when id = pg_temp.pr_id('user', 1) then 'admin'::public.user_role else 'user'::public.user_role end
 where id in (select pg_temp.pr_id('user', n) from generate_series(1, 3) n);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.pr_id('user', 1), 'primary');
insert into public.fulfillment_origins(id, code, name, default_carrier, base_fee, return_address, is_active)
 select pg_temp.pr_id('origin', n), 'partial-return-origin-'||n, 'TEST 부분반품 출고지 '||n, 'hanjin', 3000, 'TEST 반품 주소 '||n, true from generate_series(1, 2) n;
insert into public.ips(id, title, vertical_key) values ('partial-return-ip', 'TEST 부분반품 IP', 'character');
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty, origin_id) values
 ('partial-return-a', 'partial-return-ip', 'TEST 반품 상품 A', '문구', 10000, 'ok', 10, pg_temp.pr_id('origin', 1)),
 ('partial-return-b', 'partial-return-ip', 'TEST 반품 상품 B', '문구', 10000, 'ok', 10, pg_temp.pr_id('origin', 1)),
 ('partial-return-c', 'partial-return-ip', 'TEST 다른 출고지 상품 C', '문구', 5000, 'ok', 10, pg_temp.pr_id('origin', 2));
create function pg_temp.pr_stock(good text) returns integer language sql as $$select stock_qty from public.goods_variants where good_id = good and is_default$$;
create function pg_temp.pr_variant(good text) returns uuid language sql as $$select id from public.goods_variants where good_id = good and is_default$$;

-- 주문 n: A 2개(20,000원·쿠폰 1,000원) + B 1개(10,000원)는 출고지 1, C 1개(5,000원)는 출고지 2. 배송비 배송 건마다 ship_fee.
-- 결제 40,000원 = 굿즈 결제 몫 34,000원 + 배송비 6,000원(무료배송 주문은 34,000원). 두 배송 건 모두 배송완료(ready2면 배송 건 2는 발송 전).
create function pg_temp.pr_order(n integer, provider text, ship_fee bigint default 3000, ready2 boolean default false) returns void language plpgsql as $$
declare total bigint := 19000 + 10000 + 5000 + 2 * ship_fee;
begin
 insert into public.orders(id, user_id, status, total, shipping_fee, discount_total, store_credit_total, calculation_version, address,
   payment_method, created_at, confirmed_at)
 values (pg_temp.pr_id('order', n), pg_temp.pr_id('user', 2), 'confirmed', total, 2 * ship_fee, 1000, 0, 1,
   '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
   (case when provider = 'bank_transfer' then 'bank_transfer' else 'card' end)::public.order_payment_method,
   clock_timestamp() - interval '4 days', clock_timestamp() - interval '4 days');
 insert into public.order_items(id, order_id, good_id, variant_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
 select pg_temp.pr_id('item-'||g.id, n), pg_temp.pr_id('order', n), g.id, v.id, case when g.id = 'partial-return-a' then 2 else 1 end, g.price,
   g.name, '문구', 'partial-return-ip'
 from public.goods g join public.goods_variants v on v.good_id = g.id and v.is_default where g.id like 'partial-return-%';
 update public.orders set calculation_version = 2 where id = pg_temp.pr_id('order', n);
 insert into private.order_price_allocations(order_item_id, order_id, calculation_version, subtotal, volume_discount, net_subtotal, coupon_discount, store_credit_discount, paid_goods_total)
 values (pg_temp.pr_id('item-partial-return-a', n), pg_temp.pr_id('order', n), 2, 20000, 0, 20000, 1000, 0, 19000),
  (pg_temp.pr_id('item-partial-return-b', n), pg_temp.pr_id('order', n), 2, 10000, 0, 10000, 0, 0, 10000),
  (pg_temp.pr_id('item-partial-return-c', n), pg_temp.pr_id('order', n), 2, 5000, 0, 5000, 0, 0, 5000);
 insert into public.order_shipments(id, order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot)
 select pg_temp.pr_id('shipment-'||o, n), pg_temp.pr_id('order', n), pg_temp.pr_id('origin', o), 'TEST 부분반품 출고지 '||o, ship_fee, '{}' from generate_series(1, 2) o;
 insert into public.order_shipment_items(order_id, shipment_id, order_item_id, qty)
 select i.order_id, pg_temp.pr_id('shipment-'||case when i.good_id = 'partial-return-c' then 2 else 1 end, n), i.id, i.qty
 from public.order_items i where i.order_id = pg_temp.pr_id('order', n);
 insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 values (pg_temp.pr_id('payment', n), pg_temp.pr_id('user', 2), provider::public.payment_provider, 'order', pg_temp.pr_id('order', n), total, 'paid',
   case when provider = 'bank_transfer' then 'bank_transfer:'||pg_temp.pr_id('order', n) else 'TEST-PR-KEY-'||n end, 'partial-return-payment-'||n, clock_timestamp() - interval '4 days');
 insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values (pg_temp.pr_id('attempt', n), provider::public.payment_provider, pg_temp.pr_id('user', 2), 'order', pg_temp.pr_id('order', n), total, 'KRW', 'approved',
   'partial-return-attempt-'||n, 'TEST-PR-ORDER-'||n, 'TEST-PR-PRODUCT-'||n, pg_temp.pr_id('payment', n), clock_timestamp() + interval '1 hour');
 update public.order_shipments set status = 'shipping', carrier = 'hanjin', tracking_number = 'PRTEST'||upper(right(replace(id::text, '-', ''), 10)),
   shipped_at = clock_timestamp() - interval '3 days'
 where order_id = pg_temp.pr_id('order', n) and (not ready2 or id = pg_temp.pr_id('shipment-1', n));
 update public.order_shipments set status = 'delivered', delivered_at = clock_timestamp() - interval '2 days'
 where order_id = pg_temp.pr_id('order', n) and status = 'shipping';
end $$;
select pg_temp.pr_order(n, 'toss') from unnest(array[1, 2, 6, 7, 10, 11]) n;
select pg_temp.pr_order(3, 'bank_transfer'), pg_temp.pr_order(12, 'bank_transfer'), pg_temp.pr_order(4, 'nicepay'),
 pg_temp.pr_order(5, 'toss', 0), pg_temp.pr_order(8, 'toss', 3000, true);
select pg_temp.pr_assert((select count(*) = 10 from public.orders where id in (select pg_temp.pr_id('order', n) from unnest(array[1,2,3,4,5,6,7,10,11,12]) n) and status = 'delivered')
 and (select status = 'shipping' from public.orders where id = pg_temp.pr_id('order', 8)), 'fixture_orders_delivered');

create function pg_temp.pr_items(spec text) returns jsonb language sql as $$
 -- 'a:1,c:1@2' → 주문 2의 A 1개·C 1개
 select jsonb_agg(jsonb_build_object('orderItemId', pg_temp.pr_id('item-partial-return-'||split_part(part, ':', 1), split_part(spec, '@', 2)::integer),
   'qty', split_part(part, ':', 2)::integer))
 from unnest(string_to_array(split_part(spec, '@', 1), ',')) part$$;
create function pg_temp.pr_request(spec text, reason_type text default 'change_of_mind', bank boolean default false) returns text language sql as $$
 select public.request_order_partial_return(pg_temp.pr_id('order', split_part(spec, '@', 2)::integer), pg_temp.pr_id('user', 2), pg_temp.pr_items(spec),
  case when reason_type = 'defect' then '굿즈 하자·오배송 반품' else '단순 변심 반품' end, reason_type,
  case when bank then 'TEST 합성은행' end, case when bank then '000000005678' end, case when bank then 'TEST 구매자' end)$$;
create function pg_temp.pr_claim(n integer) returns public.order_cancellation_requests language sql security definer as $$
 select * from public.order_cancellation_requests where order_id = pg_temp.pr_id('order', n) order by requested_at desc, reference desc limit 1$$;
create function pg_temp.pr_head(claim uuid) returns private.order_partial_cancellations language sql security definer as $$
 select * from private.order_partial_cancellations where claim_id = claim order by created_at desc, sequence desc limit 1$$;
-- 승인 → 회수 행마다 입고 확인 → 입고완료.
create function pg_temp.pr_collect(claim uuid) returns void language plpgsql as $$
declare ship uuid;
begin
 perform public.admin_decide_order_claim(claim, 'approve', null);
 for ship in select shipment_id from public.order_claim_collections where claim_id = claim order by shipment_id loop
  perform public.admin_record_order_claim_origin_collection(claim, ship, 'TEST 입고 수량 대조');
 end loop;
end $$;

-- END FIXTURE

-- 0. 봉인·권한 -----------------------------------------------------------------------------------------------------------
select pg_temp.pr_assert(
 has_function_privilege('service_role', 'public.request_order_partial_return(uuid,uuid,jsonb,text,text,text,text,text)', 'execute')
 and not has_function_privilege('authenticated', 'public.request_order_partial_return(uuid,uuid,jsonb,text,text,text,text,text)', 'execute')
 and not has_function_privilege('anon', 'public.request_order_partial_return(uuid,uuid,jsonb,text,text,text,text,text)', 'execute')
 and has_function_privilege('authenticated', 'public.get_my_order_partial_return_context(uuid)', 'execute')
 and not has_function_privilege('anon', 'public.get_my_order_partial_return_context(uuid)', 'execute')
 and exists(select 1 from private.operator_rpc_contracts where signature = 'public.admin_submit_seller_partial_return_intake(uuid,jsonb,jsonb,jsonb)' and capability = 'sales.manage' and guard_kind = 'write')
 and exists(select 1 from private.operator_rpc_contracts where signature = 'public.admin_save_partial_return_switch(boolean,text,integer,uuid)' and capability = 'platform.manage' and legacy_admin_only)
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'
  and p.proname in ('order_partial_return_plan', 'record_partial_return_refund', 'apply_order_partial_return', 'order_partial_return_selection',
    'restore_order_item_returned_supply', 'partial_return_fee_deduction', 'claim_is_partial_return', 'order_partial_return_order_blocker')
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')))
 and not has_table_privilege('authenticated', 'public.order_claim_items', 'insert') and not has_table_privilege('service_role', 'public.order_claim_items', 'insert'),
 'grants_sealed');

-- 1. 스위치 OFF ---------------------------------------------------------------------------------------------------------
select pg_temp.pr_assert(not private.order_partial_return_enabled() and pg_temp.pr_request('a:1@11') = 'partial_return_disabled'
 and not exists(select 1 from public.order_cancellation_requests where order_id = pg_temp.pr_id('order', 11)), 'switch_off_customer_intake_disabled');
set local role authenticated;
select pg_temp.pr_auth(2);
select pg_temp.pr_assert(public.get_my_order_partial_return_context(pg_temp.pr_id('order', 11)) = '{"enabled": false}'::jsonb
 and public.get_my_order_partial_return_context(pg_temp.pr_id('order', 99)) is null, 'switch_off_context');
select pg_temp.pr_auth(1);
select pg_temp.pr_error(format('select public.admin_submit_seller_partial_return_intake(%L, %L::jsonb, %L::jsonb)', pg_temp.pr_id('request', 1),
 jsonb_build_object('orderId', pg_temp.pr_id('order', 11), 'claimType', 'return'), pg_temp.pr_items('a:1@11')), 'partial_return_disabled');
select pg_temp.pr_assert(public.admin_order_partial_return_context(pg_temp.pr_id('order', 11)) = '{"enabled": false}'::jsonb, 'switch_off_staff_context');
reset role;
-- 주문 전체 반품은 그대로다(클레임 품목 없음, 회수는 두 배송 건 전부).
select pg_temp.pr_auth(1);
select public.request_order_claim(pg_temp.pr_id('order', 11), pg_temp.pr_id('user', 2), 'return', '단순 변심 반품', 'change_of_mind');
select public.admin_decide_order_claim((pg_temp.pr_claim(11)).id, 'approve', null);
select pg_temp.pr_assert(not exists(select 1 from public.order_claim_items where order_id = pg_temp.pr_id('order', 11))
 and (select count(*) = 2 from public.order_claim_collections where claim_id = (pg_temp.pr_claim(11)).id)
 and (select (x.items_snapshot) = jsonb_build_array(jsonb_build_object('orderItemId', pg_temp.pr_id('item-partial-return-a', 11), 'name', 'TEST 반품 상품 A', 'qty', 2))
    || jsonb_build_array(jsonb_build_object('orderItemId', pg_temp.pr_id('item-partial-return-b', 11), 'name', 'TEST 반품 상품 B', 'qty', 1))
    or (x.items_snapshot) = jsonb_build_array(jsonb_build_object('orderItemId', pg_temp.pr_id('item-partial-return-b', 11), 'name', 'TEST 반품 상품 B', 'qty', 1))
    || jsonb_build_array(jsonb_build_object('orderItemId', pg_temp.pr_id('item-partial-return-a', 11), 'name', 'TEST 반품 상품 A', 'qty', 2))
  from public.order_claim_collections x where x.claim_id = (pg_temp.pr_claim(11)).id and x.shipment_id = pg_temp.pr_id('shipment-1', 11)),
 'whole_order_claim_unchanged');

-- 스위치 켜기(반품배송비 차감은 아직 꺼짐): 운영 스위치 화면의 저장 RPC — 근거 필수, 작업 ID 멱등, 낡은 리비전 거절, 감사 한 줄.
create temp table pr_switch_rev on commit drop as select revision from private.return_fee_deduction_settings where singleton;
grant select on pr_switch_rev to authenticated;
set local role authenticated;
select pg_temp.pr_auth(1);
select pg_temp.pr_error(format('select public.admin_save_partial_return_switch(true, null, %s, %L)',
 (select revision from pr_switch_rev), pg_temp.pr_id('switch', 1)), 'operations_switch_evidence_required');
select pg_temp.pr_error(format('select public.admin_save_partial_return_switch(true, %L, 999, %L)', 'TEST 약관 개정 공지', pg_temp.pr_id('switch', 1)), 'PT409');
select pg_temp.pr_assert((public.admin_save_partial_return_switch(true, 'TEST 약관 개정 공지', (select revision from pr_switch_rev), pg_temp.pr_id('switch', 1)))
 #>> '{partialReturn,enabled}' = 'true', 'switch_saved');
select pg_temp.pr_assert((public.admin_save_partial_return_switch(true, 'TEST 약관 개정 공지', (select revision from pr_switch_rev), pg_temp.pr_id('switch', 1)))
 #>> '{partialReturn,enabled}' = 'true', 'switch_replayed');
reset role;
select pg_temp.pr_assert(private.order_partial_return_enabled()
 and (select count(*) = 1 from public.audit_log where id = pg_temp.pr_id('switch', 1) and action = 'admin.operations_switch.partial_return')
 and not exists(select 1 from public.audit_log where action = 'system.return_fee_deduction.settings_changed' and diff#>>'{after,partial_return_enabled}' = 'true'),
 'switch_audited_once');

-- 2. 판정 -------------------------------------------------------------------------------------------------------------
select pg_temp.pr_assert(pg_temp.pr_request('a:1@4') = 'partial_return_unavailable'
 and private.order_partial_return_order_blocker(pg_temp.pr_id('order', 4)) = 'unsupported_payment', 'nicepay_partial_unavailable');
select pg_temp.pr_assert(pg_temp.pr_request('a:3@1') = 'partial_return_item_unavailable'
 and (private.order_partial_return_selection(pg_temp.pr_id('order', 1), pg_temp.pr_items('a:3@1')))->>'code' = 'partial_return_qty_exceeds_remaining', 'qty_exceeds');
select pg_temp.pr_assert(pg_temp.pr_request('c:1@8') = 'partial_return_item_unavailable'
 and private.order_partial_return_item_blocker(pg_temp.pr_id('item-partial-return-c', 8)) = 'shipment_not_dispatched'
 and private.order_partial_return_item_blocker(pg_temp.pr_id('item-partial-return-a', 8)) is null, 'undispatched_item_blocked');
select pg_temp.pr_error($$select private.order_partial_return_selection(pg_temp.pr_id('order', 1), '[{"orderItemId": "x", "qty": 1}]')$$, 'invalid_partial_return_items');
select pg_temp.pr_error(format('select private.order_partial_return_selection(%L, %L::jsonb)', pg_temp.pr_id('order', 1),
 pg_temp.pr_items('a:1@1') || pg_temp.pr_items('a:1@1')), 'invalid_partial_return_items');
set local role authenticated;
select pg_temp.pr_auth(2);
select pg_temp.pr_assert((select (c->>'enabled')::boolean and c->>'blocker' is null and jsonb_array_length(c->'items') = 3
  and (select (i->>'activeQty')::integer = 2 and i->>'blocker' is null from jsonb_array_elements(c->'items') i where i->>'orderItemId' = pg_temp.pr_id('item-partial-return-a', 1)::text)
 from (select public.get_my_order_partial_return_context(pg_temp.pr_id('order', 1)) c) s), 'customer_context');
reset role;

-- 3. 토스 부분 반품: A 1개 ----------------------------------------------------------------------------------------------
select pg_temp.pr_assert(pg_temp.pr_request('a:1@1') = 'requested', 'first_partial_requested');
select pg_temp.pr_assert(pg_temp.pr_request('b:1@1') = 'already_requested', 'one_active_claim');
select pg_temp.pr_assert((select count(*) = 1 and min(qty) = 1 and min(shipment_id::text) = pg_temp.pr_id('shipment-1', 1)::text from public.order_claim_items
  where claim_id = (pg_temp.pr_claim(1)).id)
 and private.claim_is_partial_return((pg_temp.pr_claim(1)).id)
 and exists(select 1 from public.audit_log where action = 'order.claim_partial_return_requested' and diff->>'claimId' = (pg_temp.pr_claim(1)).id::text), 'claim_items_recorded');
-- 진행 중 부분 반품은 교환 전환을 열지 않는다.
select pg_temp.pr_assert(private.order_claim_type_change_blocker(pg_temp.pr_claim(1)) = 'claim_conversion_partial_return', 'no_conversion_for_partial');
select pg_temp.pr_auth(1);
select public.admin_decide_order_claim((pg_temp.pr_claim(1)).id, 'approve', null);
select pg_temp.pr_assert((select count(*) = 1 from public.order_claim_collections where claim_id = (pg_temp.pr_claim(1)).id)
 and (select items_snapshot = jsonb_build_array(jsonb_build_object('orderItemId', pg_temp.pr_id('item-partial-return-a', 1), 'name', 'TEST 반품 상품 A', 'qty', 1))
   from public.order_claim_collections where claim_id = (pg_temp.pr_claim(1)).id and shipment_id = pg_temp.pr_id('shipment-1', 1))
 and (select items_snapshot = jsonb_build_array(jsonb_build_object('orderItemId', pg_temp.pr_id('item-partial-return-a', 1), 'name', 'TEST 반품 상품 A', 'qty', 1))
   from public.order_claim_collection_bundles where claim_id = (pg_temp.pr_claim(1)).id)
 and not private.claim_collections_complete((pg_temp.pr_claim(1)).id), 'collections_only_selected');
select public.admin_record_order_claim_origin_collection((pg_temp.pr_claim(1)).id, pg_temp.pr_id('shipment-1', 1), 'TEST A 1개 입고');
select pg_temp.pr_assert((pg_temp.pr_claim(1)).stage = 'collected' and private.claim_collections_complete((pg_temp.pr_claim(1)).id), 'collected_with_selected_qty');
-- 미리보기(운영 상세)
select pg_temp.pr_assert((select p->'preview' @> '{"refundAmount": 9500, "goodsRefundAmount": 9500, "shippingRefundAmount": 0, "returnFeeDeduction": 0, "balanceBefore": 40000}'
  and jsonb_array_length(p->'items') = 1 from (select public.admin_order_claim_partial_return((pg_temp.pr_claim(1)).id) p) s), 'staff_preview');
select pg_temp.pr_error(format('select public.admin_record_order_claim_refund(%L, ''bank_transfer'', ''filed'', null)', (pg_temp.pr_claim(1)).id), 'partial_return_refund_method_mismatch');
select pg_temp.pr_assert(public.admin_record_order_claim_refund((pg_temp.pr_claim(1)).id, 'pg_cancel', 'filed', null) = 'filed'
 and public.admin_record_order_claim_refund((pg_temp.pr_claim(1)).id, 'pg_cancel', 'filed', null) = 'filed', 'filed_idempotent');
select pg_temp.pr_assert((select state = 'processing' and reason_code = 'return' and refund_amount = 9500 and goods_refund_amount = 9500
   and shipping_refund_amount = 0 and return_fee_deduction = 0 and balance_before = 40000 and provider = 'toss'
   from private.order_partial_cancellations where claim_id = (pg_temp.pr_claim(1)).id)
 and (pg_temp.pr_claim(1)).stage = 'processing'
 and not exists(select 1 from public.refunds where payment_id = pg_temp.pr_id('payment', 1))
 and not exists(select 1 from public.order_cancellation_claims where order_id = pg_temp.pr_id('order', 1))
 and private.order_partial_cancel_in_flight(pg_temp.pr_id('order', 1))
 and pg_temp.pr_stock('partial-return-a') = 10, 'filed_creates_partial_ledger');
-- 주문 전체 결제 취소 경로는 부분 반품을 받지 않는다(결제사 전액 취소 전에 막힘).
select pg_temp.pr_error(format('select public.assert_order_cancellation_reconciliation_allowed(%L, %L)', (pg_temp.pr_claim(1)).id, pg_temp.pr_id('user', 1)), 'partial_return_uses_partial_refund');
select pg_temp.pr_error(format('select public.admin_record_order_claim_refund(%L, ''pg_cancel'', ''completed'', null)', (pg_temp.pr_claim(1)).id), 'claim_refund_finalization_required');
select pg_temp.pr_assert((select x->>'paymentKey' = 'TEST-PR-KEY-1' and x->>'reasonCode' = 'return' and (x->>'refundAmount')::bigint = 9500 and (x->>'balanceBefore')::bigint = 40000
 from (select public.service_order_partial_cancellation((pg_temp.pr_head((pg_temp.pr_claim(1)).id)).id) x) s), 'service_row');
select pg_temp.pr_assert(public.service_complete_order_partial_cancellation((pg_temp.pr_head((pg_temp.pr_claim(1)).id)).id, 9500, 'TEST-PR-KEY-1', 'TEST-PR-TX-1', pg_temp.pr_id('user', 1)) = 'completed', 'provider_confirmed');
select pg_temp.pr_assert((pg_temp.pr_claim(1)).stage = 'completed' and (pg_temp.pr_claim(1)).status = 'completed'
 and (select status = 'delivered' from public.orders where id = pg_temp.pr_id('order', 1))
 and (select qty = 1 from public.order_shipment_items where order_item_id = pg_temp.pr_id('item-partial-return-a', 1))
 and private.order_item_active_qty(pg_temp.pr_id('item-partial-return-a', 1)) = 1 and private.order_item_returned_qty(pg_temp.pr_id('item-partial-return-a', 1)) = 1
 and pg_temp.pr_stock('partial-return-a') = 11
 and exists(select 1 from public.audit_log where action = 'order.option_stock_partially_restored' and diff->>'claimId' = (pg_temp.pr_claim(1)).id::text and (diff->>'delta')::integer = 1)
 and exists(select 1 from public.audit_log where action = 'admin.order.partial_return_applied' and diff->>'claimId' = (pg_temp.pr_claim(1)).id::text)
 and exists(select 1 from public.notifications where dedupe_key = 'partial-return:applied:'||(pg_temp.pr_head((pg_temp.pr_claim(1)).id)).id and title = '반품 환불이 완료됐어요')
 and private.payment_partial_refunded_amount(pg_temp.pr_id('payment', 1)) = 9500
 and not private.order_partial_cancel_in_flight(pg_temp.pr_id('order', 1)), 'applied_on_confirmation');
select pg_temp.pr_assert(public.admin_record_order_claim_refund((pg_temp.pr_claim(1)).id, 'pg_cancel', 'completed', null) = 'completed', 'completed_recorded');
-- 클레임 완료 뒤에도 회수 완료 판정은 고른 수량 기준이다. 남은 품목으로 반품 접수 판정이 그대로 열린다.
select pg_temp.pr_assert(private.claim_collections_complete((pg_temp.pr_claim(1)).id) and private.order_return_intake_eligible(pg_temp.pr_id('order', 1)), 'remaining_items_claimable');
-- 구매자 주문 상세의 기록
set local role authenticated;
select pg_temp.pr_auth(2);
select pg_temp.pr_assert((select x @> '{"reasonCode": "return", "refundAmount": 9500, "returnFeeDeduction": 0}'
  from jsonb_array_elements(public.get_my_order_partial_cancellations(pg_temp.pr_id('order', 1))) x)
 and (public.get_my_order_claim_items(pg_temp.pr_id('order', 1)))->0 @> jsonb_build_object('qty', 1, 'goodName', 'TEST 반품 상품 A'), 'customer_reads_partial_return');
reset role;

-- 4. 두 번째 부분 반품(A 나머지 + B)이 배송 건 1을 비운다 + 반품배송비 편도 차감 -----------------------------------------
update private.return_fee_deduction_settings set enabled = true, one_way_amount = 3000, evidence = 'TEST 반품배송비', enabled_at = now() - interval '10 days' where singleton;
select pg_temp.pr_assert(pg_temp.pr_request('a:1,b:1@1') = 'requested', 'second_partial_requested');
select pg_temp.pr_auth(1);
select pg_temp.pr_collect((pg_temp.pr_claim(1)).id);
select public.admin_record_order_claim_refund((pg_temp.pr_claim(1)).id, 'pg_cancel', 'filed', null);
select pg_temp.pr_assert((select goods_refund_amount = 19500 and shipping_refund_amount = 3000 and return_fee_deduction = 3000 and return_fee_basis = 'one_way'
   and refund_amount = 19500 and balance_before = 30500
   from private.order_partial_cancellations where claim_id = (pg_temp.pr_claim(1)).id)
 and (select count(*) = 1 from private.order_partial_return_shipments r join private.order_partial_cancellations h on h.id = r.partial_cancellation_id
   where h.claim_id = (pg_temp.pr_claim(1)).id and r.shipment_id = pg_temp.pr_id('shipment-1', 1) and r.shipping_fee_refund = 3000)
 and (select line.canceled_qty_before = 1 and line.goods_refund_amount = 9500 from private.order_partial_cancellation_items line
   join private.order_partial_cancellations h on h.id = line.partial_cancellation_id
   where h.claim_id = (pg_temp.pr_claim(1)).id and line.order_item_id = pg_temp.pr_id('item-partial-return-a', 1)), 'second_partial_amounts');
select public.service_complete_order_partial_cancellation((pg_temp.pr_head((pg_temp.pr_claim(1)).id)).id, 19500, 'TEST-PR-KEY-1', 'TEST-PR-TX-2', pg_temp.pr_id('user', 1));
select pg_temp.pr_assert((pg_temp.pr_claim(1)).stage = 'completed'
 and not exists(select 1 from public.order_shipment_items where shipment_id = pg_temp.pr_id('shipment-1', 1))
 and (select status = 'delivered' from public.order_shipments where id = pg_temp.pr_id('shipment-1', 1))
 and (select status = 'delivered' from public.orders where id = pg_temp.pr_id('order', 1))
 and pg_temp.pr_stock('partial-return-a') = 12 and pg_temp.pr_stock('partial-return-b') = 11
 and private.payment_partial_refunded_amount(pg_temp.pr_id('payment', 1)) = 29000
 and exists(select 1 from public.notifications where dedupe_key = 'partial-return:applied:'||(pg_temp.pr_head((pg_temp.pr_claim(1)).id)).id and body like '%반품배송비 3,000원을 뺀%'),
 'second_partial_applied');
-- 정산(거래확정 엑셀): 비게 된 배송 건은 닫힌 배송 건처럼 세고, 남긴 반품배송비는 따로 싣는다.
select pg_temp.pr_assert(private.shipment_emptied_by_partial_return(pg_temp.pr_id('shipment-1', 1))
 and not private.shipment_emptied_by_partial_return(pg_temp.pr_id('shipment-2', 1))
 and private.order_partial_cancel_report_fields(pg_temp.pr_id('order', 1)) @> '{"partialRefundedAmount": 29000, "returnFeeRetained": 3000}'
 and not (private.order_partial_cancel_report_fields(pg_temp.pr_id('order', 7)) ? 'returnFeeRetained'), 'settlement_fields');
-- 재고 대조: 합성 주문 11건의 A 22개가 창고를 떠났고(부분 반품은 이 수량을 줄이지 않는다) 주문 1의 2개가 회수로 돌아와 복원됐다.
select pg_temp.pr_assert((select shipped_since_qty = 22 and returned_since_qty = 2 and awaiting_return_qty = 0
 from private.stock_reconcile_flows(array[pg_temp.pr_variant('partial-return-a')], now() - interval '10 days')), 'stock_reconcile_counts_return');

-- 5. 남은 C를 고르면 주문 전체 반품으로 접수된다 ----------------------------------------------------------------------------
select pg_temp.pr_assert(pg_temp.pr_request('c:1@1') = 'requested' and not private.claim_is_partial_return((pg_temp.pr_claim(1)).id), 'covers_all_becomes_whole_order');
select public.admin_decide_order_claim((pg_temp.pr_claim(1)).id, 'approve', null);
select pg_temp.pr_assert((select count(*) = 1 and min(shipment_id::text) = pg_temp.pr_id('shipment-2', 1)::text from public.order_claim_collections where claim_id = (pg_temp.pr_claim(1)).id)
 and (private.return_fee_deduction_plan((pg_temp.pr_claim(1)).id)) @> '{"basis": "one_way", "deductionAmount": 3000, "paymentAmount": 11000, "refundAmount": 8000}',
 'whole_order_after_partial_collects_remaining');
update private.return_fee_deduction_settings set enabled = false where singleton;
select public.admin_record_order_claim_origin_collection((pg_temp.pr_claim(1)).id, pg_temp.pr_id('shipment-2', 1), 'TEST C 입고');
select public.admin_record_order_claim_refund((pg_temp.pr_claim(1)).id, 'pg_cancel', 'filed', null);
select pg_temp.pr_assert((select amount = 11000 from public.refunds where payment_id = pg_temp.pr_id('payment', 1)), 'whole_order_refunds_remaining_balance');
select public.complete_order_cancellation_request((pg_temp.pr_claim(1)).id, array['TEST-PR-KEY-1'], pg_temp.pr_id('user', 1));
select pg_temp.pr_assert((select status = 'canceled' from public.orders where id = pg_temp.pr_id('order', 1))
 and pg_temp.pr_stock('partial-return-a') = 12 and pg_temp.pr_stock('partial-return-b') = 11 and pg_temp.pr_stock('partial-return-c') = 11,
 'whole_order_restores_only_remaining');

-- 6. 무료배송 주문: 왕복은 한 번, 그 뒤는 편도 --------------------------------------------------------------------------------
update private.return_fee_deduction_settings set enabled = true where singleton;
select pg_temp.pr_request('a:1@5');
select pg_temp.pr_collect((pg_temp.pr_claim(5)).id);
select public.admin_record_order_claim_refund((pg_temp.pr_claim(5)).id, 'pg_cancel', 'filed', null);
select pg_temp.pr_assert((select return_fee_basis = 'round_trip' and return_fee_deduction = 6000 and refund_amount = 3500 and return_fee_one_way_amount = 3000
 from private.order_partial_cancellations where claim_id = (pg_temp.pr_claim(5)).id), 'free_shipping_first_round_trip');
select public.service_complete_order_partial_cancellation((pg_temp.pr_head((pg_temp.pr_claim(5)).id)).id, 3500, 'TEST-PR-KEY-5', 'TEST-PR-TX-5', pg_temp.pr_id('user', 1));
select pg_temp.pr_request('b:1@5');
select pg_temp.pr_collect((pg_temp.pr_claim(5)).id);
select pg_temp.pr_assert((select p->'preview' @> '{"returnFeeDeduction": 3000, "refundAmount": 7000}' and p#>>'{preview,returnFee,basis}' = 'one_way'
 from (select public.admin_order_claim_partial_return((pg_temp.pr_claim(5)).id) p) s), 'free_shipping_second_one_way');
-- 하자로 정정하면 차감하지 않는다(접수 전 미리보기).
update public.order_cancellation_requests set reason_type = 'defect' where id = (pg_temp.pr_claim(5)).id;
select pg_temp.pr_assert((select p->'preview' @> '{"returnFeeDeduction": 0, "refundAmount": 10000}' from (select public.admin_order_claim_partial_return((pg_temp.pr_claim(5)).id) p) s), 'defect_no_deduction');
update public.order_cancellation_requests set reason_type = 'change_of_mind' where id = (pg_temp.pr_claim(5)).id;
select public.admin_record_order_claim_refund((pg_temp.pr_claim(5)).id, 'pg_cancel', 'filed', null);
select public.service_complete_order_partial_cancellation((pg_temp.pr_head((pg_temp.pr_claim(5)).id)).id, 7000, 'TEST-PR-KEY-5', 'TEST-PR-TX-6', pg_temp.pr_id('user', 1));
select pg_temp.pr_request('a:1,c:1@5');
select public.admin_decide_order_claim((pg_temp.pr_claim(5)).id, 'approve', null);
select pg_temp.pr_assert(not private.claim_is_partial_return((pg_temp.pr_claim(5)).id)
 and private.order_outbound_leg_charged(pg_temp.pr_id('order', 5))
 and (private.return_fee_deduction_plan((pg_temp.pr_claim(5)).id)) @> '{"basis": "one_way", "deductionAmount": 3000}', 'whole_order_after_round_trip_is_one_way');

-- 7. 무통장: 접수 때 적용·송금 대기 → 송금 증빙으로 클레임 완료 ---------------------------------------------------------------
select pg_temp.pr_assert(pg_temp.pr_request('a:1@3', bank => true) = 'requested', 'bank_partial_requested');
select pg_temp.pr_collect((pg_temp.pr_claim(3)).id);
select pg_temp.pr_error(format('select public.admin_record_order_claim_refund(%L, ''pg_cancel'', ''filed'', null)', (pg_temp.pr_claim(3)).id), 'partial_return_refund_method_mismatch');
set local role authenticated;
select pg_temp.pr_auth(1);
select pg_temp.pr_assert(public.admin_record_order_claim_refund((pg_temp.pr_claim(3)).id, 'bank_transfer', 'filed', null) = 'filed', 'bank_filed');
reset role;
select pg_temp.pr_assert((select state = 'awaiting_transfer' and applied_at is not null and filed_at is not null and refund_amount = 6500 and return_fee_deduction = 3000
   from private.order_partial_cancellations where claim_id = (pg_temp.pr_claim(3)).id)
 and (pg_temp.pr_claim(3)).stage = 'processing'
 and (select account_number = '000000005678' and masked_account like 'TEST 합성은행 %5678' from private.order_partial_cancellation_refund_accounts
   where partial_cancellation_id = (pg_temp.pr_head((pg_temp.pr_claim(3)).id)).id)
 and (select qty = 1 from public.order_shipment_items where order_item_id = pg_temp.pr_id('item-partial-return-a', 3))
 and exists(select 1 from public.notifications where dedupe_key = 'partial-return:applied:'||(pg_temp.pr_head((pg_temp.pr_claim(3)).id)).id and title = '반품 환불 송금을 접수했어요'),
 'bank_awaiting_transfer');
set local role authenticated;
select pg_temp.pr_auth(1);
select pg_temp.pr_assert(public.admin_record_order_partial_cancellation_transfer((pg_temp.pr_head((pg_temp.pr_claim(3)).id)).id, 'TEST 이체확인 0047', 'TEST-ONLY 합성 송금. 실제 송금 없음.', pg_temp.pr_id('transfer', 1))
 @> '{"state": "completed"}', 'bank_transfer_recorded');
reset role;
select pg_temp.pr_assert((pg_temp.pr_claim(3)).stage = 'completed'
 and exists(select 1 from public.notifications where dedupe_key = 'partial-return:transferred:'||(pg_temp.pr_head((pg_temp.pr_claim(3)).id)).id), 'bank_claim_completed');
-- 환불계좌 없는 무통장 부분 반품은 환불 접수에서 멈춘다.
select pg_temp.pr_request('a:1@12');
select pg_temp.pr_collect((pg_temp.pr_claim(12)).id);
set local role authenticated;
select pg_temp.pr_auth(1);
select pg_temp.pr_error(format('select public.admin_record_order_claim_refund(%L, ''bank_transfer'', ''filed'', null)', (pg_temp.pr_claim(12)).id), 'claim_refund_account_missing');
reset role;
update private.return_fee_deduction_settings set enabled = false where singleton;

-- 8. 결제사가 부분 취소를 받지 않음 → 확인 필요(전액 환불로 돌리지 않음) → 다시 접수 ----------------------------------------
select pg_temp.pr_request('b:1@6');
select pg_temp.pr_auth(1);
select pg_temp.pr_collect((pg_temp.pr_claim(6)).id);
select public.admin_record_order_claim_refund((pg_temp.pr_claim(6)).id, 'pg_cancel', 'filed', null);
select public.service_reject_order_partial_cancellation((pg_temp.pr_head((pg_temp.pr_claim(6)).id)).id, 'provider_partial_cancel_unavailable', pg_temp.pr_id('user', 1));
select pg_temp.pr_assert((pg_temp.pr_claim(6)).stage = 'needs_review' and (pg_temp.pr_claim(6)).last_error_code = 'partial_return_provider_refused'
 and (select state = 'rejected' from private.order_partial_cancellations where claim_id = (pg_temp.pr_claim(6)).id)
 and not exists(select 1 from public.refunds where payment_id = pg_temp.pr_id('payment', 6))
 and private.payment_partial_refunded_amount(pg_temp.pr_id('payment', 6)) = 0
 and (select qty = 1 from public.order_shipment_items where order_item_id = pg_temp.pr_id('item-partial-return-b', 6))
 and exists(select 1 from public.audit_log where action = 'admin.order.partial_return_provider_refused' and diff->>'claimId' = (pg_temp.pr_claim(6)).id::text),
 'refused_needs_review_no_full_refund');
select pg_temp.pr_assert(public.admin_record_order_claim_refund((pg_temp.pr_claim(6)).id, 'pg_cancel', 'filed', null) = 'filed', 'refile_returns_filed');
select pg_temp.pr_assert((select count(*) = 2 from private.order_partial_cancellations where claim_id = (pg_temp.pr_claim(6)).id)
 and (pg_temp.pr_head((pg_temp.pr_claim(6)).id)).state = 'processing' and (pg_temp.pr_claim(6)).stage = 'processing', 'refile_after_refusal');
select public.service_mark_order_partial_cancellation_needs_review((pg_temp.pr_head((pg_temp.pr_claim(6)).id)).id, 'provider_unavailable', pg_temp.pr_id('user', 1));
select pg_temp.pr_assert((pg_temp.pr_claim(6)).stage = 'needs_review' and (pg_temp.pr_claim(6)).last_error_code = 'provider_unavailable', 'needs_review_synced');
select public.service_complete_order_partial_cancellation((pg_temp.pr_head((pg_temp.pr_claim(6)).id)).id, 10000, 'TEST-PR-KEY-6', 'TEST-PR-TX-7', pg_temp.pr_id('user', 1));
-- B: 주문 1·5의 부분 반품으로 12, 이번 반품으로 13.
select pg_temp.pr_assert((pg_temp.pr_claim(6)).stage = 'completed' and pg_temp.pr_stock('partial-return-b') = 13, 'completed_after_review');

-- 9. 불량 재고: 고른 품목만·반품 수량, 적용 때 판매 재고 제외, 적용 뒤 기록 ---------------------------------------------------
select pg_temp.pr_request('a:1@7', 'defect');
select pg_temp.pr_collect((pg_temp.pr_claim(7)).id);
select pg_temp.pr_error(format('select public.admin_plan_claim_defective_stock(%L, %L::uuid[])', (pg_temp.pr_claim(7)).id, array[pg_temp.pr_id('item-partial-return-b', 7)]), 'defective_stock_item_not_in_claim');
select public.admin_plan_claim_defective_stock((pg_temp.pr_claim(7)).id, array[pg_temp.pr_id('item-partial-return-a', 7)]);
select pg_temp.pr_assert((select qty = 1 and state = 'planned' from private.claim_defective_stock where claim_id = (pg_temp.pr_claim(7)).id), 'defective_qty_is_return_qty');
select public.admin_record_order_claim_refund((pg_temp.pr_claim(7)).id, 'pg_cancel', 'filed', null);
select public.service_complete_order_partial_cancellation((pg_temp.pr_head((pg_temp.pr_claim(7)).id)).id, 9500, 'TEST-PR-KEY-7', 'TEST-PR-TX-8', pg_temp.pr_id('user', 1));
-- A: 주문 1(2개)·5·3의 부분 반품으로 14. 불량으로 고른 이번 반품은 판매 재고에 넣지 않는다.
select pg_temp.pr_assert(pg_temp.pr_stock('partial-return-a') = 14 and (pg_temp.pr_claim(7)).stage = 'completed'
 and (select qty = 1 from public.order_shipment_items where order_item_id = pg_temp.pr_id('item-partial-return-a', 7)), 'defective_not_restocked');
select pg_temp.pr_error(format('select public.admin_plan_claim_defective_stock(%L, %L::uuid[])', (pg_temp.pr_claim(7)).id, array[pg_temp.pr_id('item-partial-return-a', 7)]), 'defective_stock_claim_closed');
select pg_temp.pr_assert((public.admin_record_claim_defective_stock((pg_temp.pr_claim(7)).id))->>'recorded' = '1', 'defective_record_call');
select pg_temp.pr_assert((select state = 'recorded' from private.claim_defective_stock where claim_id = (pg_temp.pr_claim(7)).id), 'defective_recorded_after_apply');

-- 10. 부분 반품 진행 중에는 재고 부족 부분 취소·다른 클레임이 막힌다(발송 전 배송 건이 있는 주문 8) --------------------------
update private.return_fee_deduction_settings set partial_cancel_enabled = true, partial_cancel_evidence = 'TEST', partial_cancel_enabled_at = now() where singleton;
select pg_temp.pr_assert(pg_temp.pr_request('a:1@8') = 'requested', 'partial_return_with_undispatched_shipment');
select pg_temp.pr_assert('order_claim_in_progress' = any(private.order_partial_cancellation_blockers(pg_temp.pr_id('order', 8))), 'partial_cancel_blocked_by_return');
select pg_temp.pr_assert(public.request_order_claim(pg_temp.pr_id('order', 8), pg_temp.pr_id('user', 2), 'return', '단순 변심 반품', 'change_of_mind') = 'already_requested', 'whole_return_blocked');

-- 11. 운영자 대리 접수: 회수 대상은 고른 품목의 배송 건만, 같은 요청 재전송은 같은 결과 -------------------------------------------
set local role authenticated;
select pg_temp.pr_auth(1);
select pg_temp.pr_assert((select (c->>'enabled')::boolean and jsonb_array_length(c->'items') = 3 from (select public.admin_order_partial_return_context(pg_temp.pr_id('order', 10)) c) s), 'staff_context');
create temp table pr_payload on commit drop as select jsonb_build_object('orderId', pg_temp.pr_id('order', 10), 'claimType', 'return', 'reasonType', 'change_of_mind',
 'reason', 'TEST 전화로 받은 부분 반품', 'source', 'phone', 'inquiryId', null, 'customerRequestedAt', to_char(now() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'agreementEvidence', 'TEST 11/19 통화 — C만 반품', 'agreementConfirmed', true,
 'collectionAddress', jsonb_build_object('recipientName', 'TEST 수령인', 'phone', '01000000000', 'postalCode', '12345', 'address1', 'TEST 합성 주소', 'address2', ''),
 'collections', jsonb_build_array(jsonb_build_object('shipmentId', pg_temp.pr_id('shipment-2', 10), 'method', 'not_requested', 'carrier', null, 'trackingNumber', null, 'note', '')))
 as payload;
grant select on pr_payload to authenticated;
-- 회수 대상이 고른 품목의 배송 건과 다르면 기존 대리 접수 검사가 거절한다(배송 건 2만 보냈는데 A·C를 고름).
select pg_temp.pr_error(format('select public.admin_submit_seller_partial_return_intake(%L, %L::jsonb, %L::jsonb)', pg_temp.pr_id('request', 10),
 (select payload from pr_payload), pg_temp.pr_items('a:1,c:1@10')), 'seller_claim_collections_changed');
select pg_temp.pr_assert((public.admin_submit_seller_partial_return_intake(pg_temp.pr_id('request', 10), (select payload from pr_payload), pg_temp.pr_items('c:1@10'))) @> '{"partialReturn": true}'
 and (public.admin_submit_seller_partial_return_intake(pg_temp.pr_id('request', 10), (select payload from pr_payload), pg_temp.pr_items('c:1@10'))) @> '{"partialReturn": true}',
 'staff_partial_intake_replay');
select pg_temp.pr_error(format('select public.admin_submit_seller_partial_return_intake(%L, %L::jsonb, %L::jsonb)', pg_temp.pr_id('request', 10),
 (select payload from pr_payload), pg_temp.pr_items('b:1@10')), 'PT409');
reset role;
select pg_temp.pr_assert((select count(*) = 1 and min(qty) = 1 from public.order_claim_items where claim_id = pg_temp.pr_id('request', 10))
 and (select jsonb_array_length(collection_snapshot) = 1 and collection_snapshot->0->>'shipmentId' = pg_temp.pr_id('shipment-2', 10)::text
   and (collection_snapshot->0->'items'->0->>'qty')::integer = 1 from private.seller_order_claim_intakes where claim_id = pg_temp.pr_id('request', 10))
 and exists(select 1 from public.audit_log where action = 'admin.order.claim_partial_return_intake' and diff->>'claimId' = pg_temp.pr_id('request', 10)::text),
 'staff_partial_intake_recorded');
select pg_temp.pr_auth(1);
select public.admin_decide_order_claim(pg_temp.pr_id('request', 10), 'approve', null);
select pg_temp.pr_assert((select count(*) = 1 from public.order_claim_collections where claim_id = pg_temp.pr_id('request', 10) and shipment_id = pg_temp.pr_id('shipment-2', 10))
 and not exists(select 1 from public.order_claim_collections where claim_id = pg_temp.pr_id('request', 10) and shipment_id = pg_temp.pr_id('shipment-1', 10)),
 'staff_partial_collections');

-- 선물 주문은 부분 반품을 열지 않는다(받는 분·보낸 분 클레임 흐름이 따로다). 주문 2를 선물 주문으로 바꿔 판정만 본다.
insert into private.gift_intents(id, sender_id, recipient_id, state, sender_label, recipient_label, expires_at, order_id, ordered_source_revision)
values (pg_temp.pr_id('gift', 2), pg_temp.pr_id('user', 2), pg_temp.pr_id('user', 3), 'ordered', 'TEST 보낸 분', 'TEST 받는 분', now() + interval '7 days', pg_temp.pr_id('order', 2), 1);
select pg_temp.pr_assert(private.order_partial_return_order_blocker(pg_temp.pr_id('order', 2)) = 'gift_order'
 and pg_temp.pr_request('a:1@2') = 'partial_return_unavailable', 'gift_partial_unavailable');

-- 13. 진행 중 부분 반품(주문 8: 배송 건 1의 A)은 고른 품목이 없는 배송 건 2(C, 발송 전)의 예약 할당·출고·발송·배송완료를 막지 않는다.
--     고른 품목이 든 배송 건과 배송 건 문맥이 없는 주문 단위 판정은 그대로 막는다(적대적 리뷰 2026-11-19, 결정: 범위를 좁히지 않음).
select pg_temp.pr_error(format('select private.assert_order_dispatch_allowed(%L::uuid)', pg_temp.pr_id('order', 8)), 'order cancellation in progress');
select pg_temp.pr_error(format('select private.assert_order_dispatch_allowed(%L::uuid, %L::uuid[])', pg_temp.pr_id('order', 8),
 array[pg_temp.pr_id('shipment-1', 8)]), 'order cancellation in progress');
select private.assert_order_dispatch_allowed(pg_temp.pr_id('order', 8), array[pg_temp.pr_id('shipment-2', 8)]);
select pg_temp.pr_assert(coalesce(current_setting('icons.dispatch_shipments', true), '') = ''
 and private.shipment_pack_ready(pg_temp.pr_id('shipment-2', 8)) and not private.shipment_pack_ready(pg_temp.pr_id('shipment-1', 8)), 'dispatch_scope_per_shipment');
insert into private.goods_preorder_policies(id, variant_id, created_by) values (pg_temp.pr_id('policy', 8), pg_temp.pr_variant('partial-return-c'), pg_temp.pr_id('user', 1));
insert into private.goods_preorder_reservations(order_item_id, order_id, policy_id, qty)
values (pg_temp.pr_id('item-partial-return-c', 8), pg_temp.pr_id('order', 8), pg_temp.pr_id('policy', 8), 1);
create temp table pr_dispatch on commit drop as select pg_temp.pr_stock('partial-return-c') as c_stock;
grant select on pr_dispatch to authenticated;
set local role authenticated;
select pg_temp.pr_auth(1);
select pg_temp.pr_assert((public.admin_allocate_goods_preorders('partial-return-c', array[pg_temp.pr_id('item-partial-return-c', 8)],
  jsonb_build_object(pg_temp.pr_variant('partial-return-c')::text, (select c_stock from pr_dispatch)), 'TEST 입고 확인 0047'))->>'allocatedItems' = '1',
 'preorder_allocated_during_partial_return');
select pg_temp.pr_assert((public.admin_origin_pending_export_ids(pg_temp.pr_id('origin', 2)))->'ids' @> to_jsonb(array[pg_temp.pr_id('shipment-2', 8)]), 'export_list_other_shipment');
select pg_temp.pr_assert(public.admin_mark_shipments_exported(jsonb_build_array(jsonb_build_object('id', pg_temp.pr_id('shipment-2', 8),
  'updatedAt', (select updated_at from public.order_shipments where id = pg_temp.pr_id('shipment-2', 8))))) = 1, 'export_other_shipment');
select public.admin_update_shipment_status(pg_temp.pr_id('shipment-2', 8), 'shipping', 'hanjin', 'PRTEST8SHIPMENT2');
select public.admin_update_shipment_status(pg_temp.pr_id('shipment-2', 8), 'delivered', 'hanjin', 'PRTEST8SHIPMENT2');
reset role;
select pg_temp.pr_assert((select status = 'delivered' from public.order_shipments where id = pg_temp.pr_id('shipment-2', 8))
 and (select status = 'delivered' from public.orders where id = pg_temp.pr_id('order', 8))
 and (select state = 'allocated' from private.goods_preorder_reservations where order_item_id = pg_temp.pr_id('item-partial-return-c', 8))
 and (pg_temp.pr_claim(8)).status = 'requested' and (pg_temp.pr_claim(8)).stage = 'requested', 'other_shipment_dispatched_claim_intact');

-- 환불 접수 뒤 결제사 확인을 기다리는 부분 반품 원장(processing)도 다른 배송 건의 출고를 막지 않는다(주문 15). 주문 단위 판정은 그대로 본다.
select pg_temp.pr_order(15, 'toss', 3000, true);
select pg_temp.pr_request('a:1@15');
select pg_temp.pr_collect((pg_temp.pr_claim(15)).id);
select public.admin_record_order_claim_refund((pg_temp.pr_claim(15)).id, 'pg_cancel', 'filed', null);
select pg_temp.pr_assert((pg_temp.pr_head((pg_temp.pr_claim(15)).id)).state = 'processing'
 and private.order_partial_cancel_in_flight(pg_temp.pr_id('order', 15)) and not private.order_partial_cancel_blocks_dispatch(pg_temp.pr_id('order', 15))
 and private.shipment_pack_ready(pg_temp.pr_id('shipment-2', 15)), 'return_refund_in_flight_leaves_other_shipment');
select private.assert_order_dispatch_allowed(pg_temp.pr_id('order', 15), array[pg_temp.pr_id('shipment-2', 15)]);
select pg_temp.pr_error(format('select private.assert_order_dispatch_allowed(%L::uuid, %L::uuid[])', pg_temp.pr_id('order', 15),
 array[pg_temp.pr_id('shipment-1', 15)]), 'order cancellation in progress');

-- 14. 리뷰 이벤트 자격·판매 집계: 부분 반품 완료(주문 6: B 1개)는 주문 전체 반품 완료가 아니다. 남은 굿즈(A·C)는 자격·판매 수량에
--     남고, 모두 반품된 B만 빠진다. 결제 증빙이 있는 합성 주문은 6뿐이다.
insert into private.payment_provider_evidence(payment_attempt_id, evidence_kind, provider_payment_key, payment_method, approved_at)
values (pg_temp.pr_id('attempt', 6), 'confirm', 'TEST-PR-KEY-6', '카드', clock_timestamp() - interval '4 days');
select pg_temp.pr_assert((pg_temp.pr_claim(6)).stage = 'completed'
 and private.review_event_purchase_eligible(pg_temp.pr_id('order', 6), pg_temp.pr_id('user', 2), 'partial-return-a')
 and private.review_event_purchase_eligible(pg_temp.pr_id('order', 6), pg_temp.pr_id('user', 2), 'partial-return-c')
 and not private.review_event_purchase_eligible(pg_temp.pr_id('order', 6), pg_temp.pr_id('user', 2), 'partial-return-b')
 and exists(select 1 from private.product_detail_paid_orders(now() - interval '30 days', now()) p where p.id = pg_temp.pr_id('order', 6))
 and (select jsonb_object_agg(good_id, quantity) from private.goods_effective_sales(now() - interval '30 days', now())
   where good_id like 'partial-return-%') = '{"partial-return-a": 2, "partial-return-c": 1}'::jsonb, 'review_and_sales_keep_remaining_goods');

-- 15. 부분 반품 원장이 반품배송비를 뺐으면 같은 요청에 배송비 청구를 또 발행하지 않는다(주문 13: A 1개 변심).
select pg_temp.pr_order(13, 'toss'), pg_temp.pr_order(14, 'toss');
update private.return_fee_deduction_settings set enabled = true, one_way_amount = 3000, evidence = 'TEST 반품배송비', enabled_at = now() - interval '10 days' where singleton;
update private.claim_fee_policy set enabled = true, return_amount = 3000, exchange_amount = 6000, evidence = 'TEST 정책' where singleton;
select pg_temp.pr_request('a:1@13');
select pg_temp.pr_auth(1);
select pg_temp.pr_collect((pg_temp.pr_claim(13)).id);
select pg_temp.pr_assert((private.claim_fee_document((pg_temp.pr_claim(13)).id, pg_temp.pr_id('user', 1), true))->>'canIssue' = 'true', 'claim_fee_open_before_refund');
select public.admin_record_order_claim_refund((pg_temp.pr_claim(13)).id, 'pg_cancel', 'filed', null);
select pg_temp.pr_assert((pg_temp.pr_head((pg_temp.pr_claim(13)).id)).return_fee_deduction = 3000
 and (private.claim_fee_document((pg_temp.pr_claim(13)).id, pg_temp.pr_id('user', 1), true))->>'canIssue' = 'false', 'claim_fee_closed_after_deduction');
create function pg_temp.pr_claim_revision(n integer) returns integer language sql security definer as $$select (pg_temp.pr_claim(n)).claim_revision$$;
create function pg_temp.pr_claim_id(n integer) returns uuid language sql security definer as $$select (pg_temp.pr_claim(n)).id$$;
grant execute on function pg_temp.pr_claim_revision(integer), pg_temp.pr_claim_id(integer) to authenticated;
set local role authenticated;
select pg_temp.pr_auth(1);
select pg_temp.pr_error(format('select public.admin_change_claim_fee(%L, null, ''issue'', %L::jsonb, 0, %s, %L, %L, %L)', pg_temp.pr_claim_id(13),
 jsonb_build_object('amount', 3000, 'payerRole', 'buyer', 'customerNote', 'TEST 반품배송비 입금 요청', 'evidence', 'TEST 통화', 'confirmed', true),
 pg_temp.pr_claim_revision(13), pg_temp.pr_id('fee', 13), pg_temp.pr_id('user', 1), pg_temp.pr_id('session', 1)), 'claim_fee_issue_blocked');
reset role;
update private.return_fee_deduction_settings set enabled = false where singleton;
update private.claim_fee_policy set enabled = false where singleton;

-- 16. 결제사가 부분 취소를 받지 않아 닫힌 부분 반품의 출구: 계좌 송금 부분 환불로 전환(주문 14: B 1개). 결제 담당만, 사유·계좌 필수,
--     같은 작업 ID는 같은 결과. 송금 증빙으로 원장·클레임 완료. 전환한 결제는 다음 부분 반품을 받지 않고 주문 전체 환불의 계좌 송금 기록을 막는다.
select pg_temp.pr_request('b:1@14');
select pg_temp.pr_collect((pg_temp.pr_claim(14)).id);
select public.admin_record_order_claim_refund((pg_temp.pr_claim(14)).id, 'pg_cancel', 'filed', null);
select public.service_reject_order_partial_cancellation((pg_temp.pr_head((pg_temp.pr_claim(14)).id)).id, 'provider_partial_cancel_unavailable', pg_temp.pr_id('user', 1));
-- 전환 전에 고른 품목의 불량 재고를 고를 수 있고, 전환(적용) 때 불량 품목은 판매 재고로 되돌리지 않는다.
select pg_temp.pr_auth(1);
select public.admin_plan_claim_defective_stock((pg_temp.pr_claim(14)).id, array[pg_temp.pr_id('item-partial-return-b', 14)]);
create temp table pr_convert on commit drop as select jsonb_build_object('bankName', 'TEST 합성은행', 'accountNumber', '000000001414', 'accountHolder', 'TEST 구매자') as account,
 pg_temp.pr_stock('partial-return-b') as b_stock;
grant select on pr_convert to authenticated;
set local role authenticated;
select pg_temp.pr_auth(1);
select pg_temp.pr_assert((public.admin_order_claim_partial_return(pg_temp.pr_claim_id(14)))->>'transferConvertible' = 'true', 'transfer_convertible_flag');
select pg_temp.pr_error(format('select public.admin_convert_partial_return_refund_to_transfer(%L, %L, %L::jsonb, %L)', pg_temp.pr_claim_id(14), '짧음',
 (select account from pr_convert), pg_temp.pr_id('convert', 14)), 'partial_return_transfer_reason_required');
select pg_temp.pr_error(format('select public.admin_convert_partial_return_refund_to_transfer(%L, %L, %L::jsonb, %L)', pg_temp.pr_claim_id(14), 'TEST 카드사 부분 취소 불가 확인',
 jsonb_build_object('bankName', 'TEST 합성은행', 'accountNumber', '12', 'accountHolder', 'TEST 구매자'), pg_temp.pr_id('convert', 14)), 'partial_return_transfer_account_required');
select pg_temp.pr_assert((public.admin_convert_partial_return_refund_to_transfer(pg_temp.pr_claim_id(14), 'TEST 카드사 부분 취소 불가 확인 — 고객 계좌로 송금',
  (select account from pr_convert), pg_temp.pr_id('convert', 14))) @> '{"state": "awaiting_transfer", "refundAmount": 10000, "replayed": false}'
 and (public.admin_convert_partial_return_refund_to_transfer(pg_temp.pr_claim_id(14), 'TEST 카드사 부분 취소 불가 확인 — 고객 계좌로 송금',
  (select account from pr_convert), pg_temp.pr_id('convert', 14))) @> '{"replayed": true}', 'transfer_converted_replay');
select pg_temp.pr_error(format('select public.admin_convert_partial_return_refund_to_transfer(%L, %L, %L::jsonb, %L)', pg_temp.pr_claim_id(14), 'TEST 두 번째 전환 시도',
 (select account from pr_convert), pg_temp.pr_id('convert', 15)), 'partial_return_transfer_unavailable');
reset role;
select pg_temp.pr_assert((select provider = 'bank_transfer' and payment_id = pg_temp.pr_id('payment', 14) and state = 'awaiting_transfer' and applied_at is not null
   and filed_by = pg_temp.pr_id('user', 1) and note like 'TEST 카드사 부분 취소 불가%' from private.order_partial_cancellations h
   where h.claim_id = (pg_temp.pr_claim(14)).id and h.state <> 'rejected')
 and (select masked_account like 'TEST 합성은행 %1414' and account_number = '000000001414' from private.order_partial_cancellation_refund_accounts a
   where a.partial_cancellation_id = (pg_temp.pr_head((pg_temp.pr_claim(14)).id)).id)
 and (pg_temp.pr_claim(14)).stage = 'processing' and (pg_temp.pr_claim(14)).last_error_code is null
 and private.payment_partial_refunded_amount(pg_temp.pr_id('payment', 14)) = 10000
 and exists(select 1 from public.audit_log where action = 'admin.order.partial_return_transfer_converted' and diff->>'claimId' = (pg_temp.pr_claim(14)).id::text
   and diff->>'maskedAccount' like '%1414' and diff->>'refusedPartialCancellationId' is not null)
 and exists(select 1 from public.notifications where dedupe_key = 'partial-return:applied:'||(pg_temp.pr_head((pg_temp.pr_claim(14)).id)).id
   and body like '%결제사가 이 결제의 부분 취소를 받지 않아%')
 and private.order_partial_return_order_blocker(pg_temp.pr_id('order', 14)) = 'payment_refunded_by_transfer'
 and pg_temp.pr_stock('partial-return-b') = (select b_stock from pr_convert)
 and not exists(select 1 from public.order_shipment_items where order_item_id = pg_temp.pr_id('item-partial-return-b', 14)),
 'transfer_conversion_state');
set local role authenticated;
select pg_temp.pr_auth(1);
select public.admin_record_order_partial_cancellation_transfer((pg_temp.pr_head(pg_temp.pr_claim_id(14))).id, 'TEST 이체확인 1414', 'TEST-ONLY 합성 송금. 실제 송금 없음.', pg_temp.pr_id('transfer', 14));
reset role;
select pg_temp.pr_assert((pg_temp.pr_claim(14)).stage = 'completed' and (pg_temp.pr_head((pg_temp.pr_claim(14)).id)).state = 'completed', 'converted_transfer_completed');
-- 남은 굿즈의 주문 전체 반품: 결제사 나머지 취소는 기대 잔액 대조에서 멈추고(돈을 움직이지 않는다), 계좌 송금 기록은 막는다.
select pg_temp.pr_assert(public.request_order_claim(pg_temp.pr_id('order', 14), pg_temp.pr_id('user', 2), 'return', '단순 변심 반품', 'change_of_mind') = 'requested',
 'whole_return_after_conversion');
select pg_temp.pr_collect((pg_temp.pr_claim(14)).id);
select pg_temp.pr_error(format('select public.admin_record_order_claim_refund(%L, ''bank_transfer'', ''filed'', null)', (pg_temp.pr_claim(14)).id), 'partial_return_transfer_remainder_manual');
select pg_temp.pr_assert((public.service_order_payment_partial_refunds(pg_temp.pr_id('order', 14)))->0->>'refundedAmount' = '10000', 'remainder_counts_transfer');

-- 12. 원장 불변: 부분 반품 줄의 클레임·차감 칸도 바뀌지 않는다. 클레임 품목은 고칠 수 없다.
select pg_temp.pr_error(format('update private.order_partial_cancellations set return_fee_deduction = 0 where id = %L', (pg_temp.pr_head((pg_temp.pr_claim(3)).id)).id), 'partial_cancellation_immutable');
select pg_temp.pr_error(format('update public.order_claim_items set qty = 2 where claim_id = %L', pg_temp.pr_id('request', 10)), 'order_claim_items_immutable');
select pg_temp.pr_error(format('delete from public.order_claim_items where claim_id = %L', pg_temp.pr_id('request', 10)), 'order_claim_items_immutable');

rollback;
