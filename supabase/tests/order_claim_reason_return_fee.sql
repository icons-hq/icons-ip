\set ON_ERROR_STOP on
-- 반품 사유 정정(CLM-029)과 일괄 환불 확인창의 부분 반품 금액(CLM-136). 한 트랜잭션 안에서 합성 주문을 만들고 끝에 되돌린다 — 결제사 호출 없음.
--  1. 주문 전체 반품(토스): 단순 변심 → 하자·오배송 정정이 반품배송비 3,000원 차감을 없앤다(정정 전후 이력·감사·영수증·고객 알림·고객 이력).
--     환불 접수는 정정된 사유로 전액을 정하고, 접수 뒤에는 정정이 막힌다(단계·금전 시작).
--  2. 주문 전체 반품: 하자·오배송 → 단순 변심 정정이 차감을 만든다(환불 접수 결정 3,000원, 환불 원장 37,000원).
--  3. 최초 무료배송 주문: 왕복 6,000원 → 하자 정정으로 0원.
--  4. 부분 반품: 일괄 확인창이 남은 결제 금액(40,000원)이 아니라 고른 몫(9,500원 − 반품배송비 3,000원)을 보이고, 정정이 그 금액을 다시
--     계산한다. 환불 접수 뒤에는 원장 금액을 보이되 일괄 환불에서는 빼고(상세에서 처리), 사유 정정은 막힌다.
--  5. 선물 주문: 정정 알림은 선물 클레임 알림 규칙(보낸 분·받는 분 모두, 일반 문구·/gifts/ 링크)이고 운영자 설명 원문은 알림에 없다.
begin;
update public.shipping_carriers set tracking_number_pattern=null,tracking_number_rule=null where tracking_number_pattern is not null;
create function pg_temp.rf_id(kind text, n integer) returns uuid language sql immutable as $$select md5('claim-reason-return:'||kind||':'||n)::uuid$$;
create function pg_temp.rf_assert(ok boolean, label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Return reason correction assertion failed: %', label; end if; end $$;
create function pg_temp.rf_error(q text, expected text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if sqlstate = expected or sqlerrm = expected then return; end if; raise; end;
 raise exception 'Expected return reason correction rejection: %', expected; end $$;
create function pg_temp.rf_auth(actor integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub', '', true);
 perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.rf_id('user', actor),
  'session_id', pg_temp.rf_id('session', actor))::text, true);
end $$;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
 select pg_temp.rf_id('user', n), 'authenticated', 'authenticated', 'claim-reason-return-'||n||'@example.test', clock_timestamp(), '{}', '{}' from generate_series(1, 3) n;
insert into auth.sessions(id, user_id, created_at, updated_at, not_after)
 select pg_temp.rf_id('session', n), pg_temp.rf_id('user', n), clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 hour' from generate_series(1, 3) n;
update public.profiles set nickname = 'TEST 반품사유 '||right(id::text, 6),
 role = case when id = pg_temp.rf_id('user', 1) then 'admin'::public.user_role else 'user'::public.user_role end
 where id in (select pg_temp.rf_id('user', n) from generate_series(1, 3) n);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.rf_id('user', 1), 'primary');
insert into public.fulfillment_origins(id, code, name, default_carrier, base_fee, return_address, is_active)
 select pg_temp.rf_id('origin', n), 'claim-reason-return-origin-'||n, 'TEST 반품사유 출고지 '||n, 'hanjin', 3000, 'TEST 반품 주소 '||n, true from generate_series(1, 2) n;
insert into public.ips(id, title, vertical_key) values ('claim-reason-return-ip', 'TEST 반품사유 IP', 'character');
insert into public.goods(id, ip_id, name, price, stock, stock_qty, origin_id) values
 ('claim-reason-return-a', 'claim-reason-return-ip', 'TEST 반품사유 상품 A', 10000, 'ok', 10, pg_temp.rf_id('origin', 1)),
 ('claim-reason-return-b', 'claim-reason-return-ip', 'TEST 반품사유 상품 B', 10000, 'ok', 10, pg_temp.rf_id('origin', 1)),
 ('claim-reason-return-c', 'claim-reason-return-ip', 'TEST 반품사유 상품 C', 5000, 'ok', 10, pg_temp.rf_id('origin', 2));

-- 주문 n(토스): A 2개(20,000원·쿠폰 1,000원) + B 1개는 출고지 1, C 1개는 출고지 2. 배송비 배송 건마다 ship_fee.
-- 결제 = 상품 결제 몫 34,000원 + 배송비 2 × ship_fee. 두 배송 건 모두 배송완료.
create function pg_temp.rf_order(n integer, ship_fee bigint default 3000) returns void language plpgsql as $$
declare total bigint := 19000 + 10000 + 5000 + 2 * ship_fee;
begin
 insert into public.orders(id, user_id, status, total, shipping_fee, discount_total, store_credit_total, calculation_version, address,
   payment_method, created_at, confirmed_at)
 values (pg_temp.rf_id('order', n), pg_temp.rf_id('user', 2), 'confirmed', total, 2 * ship_fee, 1000, 0, 1,
   '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
   'card'::public.order_payment_method, clock_timestamp() - interval '4 days', clock_timestamp() - interval '4 days');
 insert into public.order_items(id, order_id, good_id, variant_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot)
 select pg_temp.rf_id('item-'||g.id, n), pg_temp.rf_id('order', n), g.id, v.id, case when g.id = 'claim-reason-return-a' then 2 else 1 end, g.price,
   g.name, 'claim-reason-return-ip'
 from public.goods g join public.goods_variants v on v.good_id = g.id and v.is_default where g.id like 'claim-reason-return-%';
 update public.orders set calculation_version = 2 where id = pg_temp.rf_id('order', n);
 insert into private.order_price_allocations(order_item_id, order_id, calculation_version, subtotal, volume_discount, net_subtotal, coupon_discount, store_credit_discount, paid_goods_total)
 values (pg_temp.rf_id('item-claim-reason-return-a', n), pg_temp.rf_id('order', n), 2, 20000, 0, 20000, 1000, 0, 19000),
  (pg_temp.rf_id('item-claim-reason-return-b', n), pg_temp.rf_id('order', n), 2, 10000, 0, 10000, 0, 0, 10000),
  (pg_temp.rf_id('item-claim-reason-return-c', n), pg_temp.rf_id('order', n), 2, 5000, 0, 5000, 0, 0, 5000);
 insert into public.order_shipments(id, order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot)
 select pg_temp.rf_id('shipment-'||o, n), pg_temp.rf_id('order', n), pg_temp.rf_id('origin', o), 'TEST 반품사유 출고지 '||o, ship_fee, '{}' from generate_series(1, 2) o;
 insert into public.order_shipment_items(order_id, shipment_id, order_item_id, qty)
 select i.order_id, pg_temp.rf_id('shipment-'||case when i.good_id = 'claim-reason-return-c' then 2 else 1 end, n), i.id, i.qty
 from public.order_items i where i.order_id = pg_temp.rf_id('order', n);
 insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 values (pg_temp.rf_id('payment', n), pg_temp.rf_id('user', 2), 'toss', 'order', pg_temp.rf_id('order', n), total, 'paid',
   'TEST-RF-KEY-'||n, 'claim-reason-return-payment-'||n, clock_timestamp() - interval '4 days');
 insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values (pg_temp.rf_id('attempt', n), 'toss', pg_temp.rf_id('user', 2), 'order', pg_temp.rf_id('order', n), total, 'KRW', 'approved',
   'claim-reason-return-attempt-'||n, 'TEST-RF-ORDER-'||n, 'TEST-RF-PRODUCT-'||n, pg_temp.rf_id('payment', n), clock_timestamp() + interval '1 hour');
 update public.order_shipments set status = 'shipping', carrier = 'hanjin', tracking_number = 'RFTEST'||upper(right(replace(id::text, '-', ''), 10)),
   shipped_at = clock_timestamp() - interval '3 days'
 where order_id = pg_temp.rf_id('order', n);
 update public.order_shipments set status = 'delivered', delivered_at = clock_timestamp() - interval '2 days'
 where order_id = pg_temp.rf_id('order', n) and status = 'shipping';
end $$;
select pg_temp.rf_order(1), pg_temp.rf_order(2), pg_temp.rf_order(3, 0), pg_temp.rf_order(4), pg_temp.rf_order(5);
select pg_temp.rf_assert((select count(*) = 5 from public.orders where id in (select pg_temp.rf_id('order', n) from generate_series(1, 5) n) and status = 'delivered'),
 'fixture_orders_delivered');
-- 주문 5는 선물 주문(결제한 분 user 2 → 받는 분 user 3). 받는 분이 낸 단순 변심 반품(선물 신청의 설명은 일반 분류 문구).
insert into private.gift_intents(id, sender_id, recipient_id, state, sender_label, recipient_label, expires_at, order_id, ordered_source_revision)
 values (pg_temp.rf_id('gift', 5), pg_temp.rf_id('user', 2), pg_temp.rf_id('user', 3), 'ordered', 'TEST 보낸 분', 'TEST 받는 분',
  clock_timestamp() + interval '1 day', pg_temp.rf_id('order', 5), 'test');
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, requested_at)
 values (pg_temp.rf_id('claim', 5), pg_temp.rf_id('order', 5), pg_temp.rf_id('user', 3), '단순 변심', 'change_of_mind', 'return', 'requested', now());
insert into private.gift_claim_parties(claim_id, gift_id, payer_id, recipient_id, actual_requester)
 values (pg_temp.rf_id('claim', 5), pg_temp.rf_id('gift', 5), pg_temp.rf_id('user', 2), pg_temp.rf_id('user', 3), pg_temp.rf_id('user', 3));

create function pg_temp.rf_claim(n integer) returns public.order_cancellation_requests language sql security definer as $$
 select * from public.order_cancellation_requests where order_id = pg_temp.rf_id('order', n) order by requested_at desc, reference desc limit 1$$;
-- 승인 → 회수 행마다 입고 확인 → 입고완료.
create function pg_temp.rf_collect(claim uuid) returns void language plpgsql as $$
declare ship uuid;
begin
 perform public.admin_decide_order_claim(claim, 'approve', null);
 for ship in select shipment_id from public.order_claim_collections where claim_id = claim order by shipment_id loop
  perform public.admin_record_order_claim_origin_collection(claim, ship, 'TEST 입고 수량 대조');
 end loop;
end $$;
-- 운영자 정정(지금 버전으로). 결과는 영수증.
create function pg_temp.rf_correct(n integer, op integer, target text, description text) returns jsonb language plpgsql as $$
begin
 return public.admin_change_order_claim_reason((pg_temp.rf_claim(n)).id, pg_temp.rf_id('op', op), (pg_temp.rf_claim(n)).claim_revision,
  pg_temp.rf_id('user', 1), target, description, '상담 2026-11-25 · 회수품 검수로 실제 사유를 고객과 확인함', true, false);
end $$;
create function pg_temp.rf_bulk(n integer) returns jsonb language sql as $$
 select public.admin_order_claim_bulk_context(array[(pg_temp.rf_claim(n)).id])->0$$;

-- 반품배송비 차감·부분 반품 켬(켠 시각은 접수보다 앞). CI는 reset 뒤 스위치를 끄므로 이 트랜잭션에서 켠다.
update private.return_fee_deduction_settings set enabled = true, one_way_amount = 3000, evidence = 'TEST 반품배송비 차감',
 enabled_at = now() - interval '10 days', partial_return_enabled = true, partial_return_evidence = 'TEST 부분 반품',
 partial_return_enabled_at = now() - interval '10 days' where singleton;

-- END FIXTURE

-- 0. 봉인 ----------------------------------------------------------------------------------------------------------------
select pg_temp.rf_assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'
  and p.proname in ('claim_reason_return_fee_deduction', 'claim_bulk_partial_return_refund', 'order_claim_reason_blocker', 'order_claim_reason_receipt')
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')))
 and not has_function_privilege('anon', 'public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean)', 'execute')
 and not has_function_privilege('service_role', 'public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean)', 'execute')
 and has_function_privilege('authenticated', 'public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean)', 'execute')
 and exists(select 1 from private.operator_rpc_contracts where signature = 'public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean)'
  and capability = 'sales.manage' and guard_kind = 'write')
 and to_regprocedure('private.t4_patch_function(regprocedure,text,text,integer)') is null, 'sealed');

-- 1. 주문 전체 반품: 단순 변심 → 하자·오배송 -------------------------------------------------------------------------------
select pg_temp.rf_auth(1);
select public.request_order_claim(pg_temp.rf_id('order', 1), pg_temp.rf_id('user', 2), 'return', '마음이 바뀌어 반품합니다', 'change_of_mind');
select pg_temp.rf_collect((pg_temp.rf_claim(1)).id);
select pg_temp.rf_assert((pg_temp.rf_claim(1)).stage = 'collected'
 and (private.return_fee_deduction_plan((pg_temp.rf_claim(1)).id)) @> '{"applicable": true, "deductionAmount": 3000, "refundAmount": 37000}', 'full_return_planned_deduction');
select pg_temp.rf_assert((select c->>'allowed' = 'true' and c->>'claimType' = 'return'
  and c->'returnFee' = '{"enabled": true, "oneWayAmount": 3000, "partialReturn": false, "deductionAmount": 3000, "feeInvoiceOpen": false}'::jsonb
 from (select public.admin_order_claim_reason_context((pg_temp.rf_claim(1)).id) c) s), 'full_return_context_shows_deduction');
-- 일괄 확인창(주문 전체 반품): 지금처럼 결제액 − 차감액이고 부분 반품 표시가 없다.
select pg_temp.rf_assert((select r->>'refundAmount' = '37000' and r->>'refundBlocker' is null and not (r ? 'partialReturn')
  and r#>>'{refundDeduction,deductionAmount}' = '3000' from (select pg_temp.rf_bulk(1) r) s), 'full_return_bulk_unchanged');
select pg_temp.rf_correct(1, 1, 'defect', '받은 상품이 깨져 있었어요') as full_saved \gset
select pg_temp.rf_assert(:'full_saved'::jsonb @> '{"changed": true, "claimType": "return", "fromReasonType": "change_of_mind", "toReasonType": "defect",
  "fromReturnFeeDeduction": 3000, "toReturnFeeDeduction": 0, "stage": "collected"}'
 and (pg_temp.rf_claim(1)).reason_type = 'defect' and (pg_temp.rf_claim(1)).reason = '받은 상품이 깨져 있었어요'
 and private.return_fee_deduction_plan((pg_temp.rf_claim(1)).id) is null
 and public.admin_read_order_claim_reason_change(pg_temp.rf_id('op', 1)) = :'full_saved'::jsonb, 'full_return_corrected_fee_removed');
-- 같은 작업 ID·입력의 다시 부름은 저장된 영수증 그대로다(차감액을 다시 계산하지 않는다).
select pg_temp.rf_assert(public.admin_change_order_claim_reason((pg_temp.rf_claim(1)).id, pg_temp.rf_id('op', 1), (:'full_saved'::jsonb->>'revision')::integer,
 pg_temp.rf_id('user', 1), 'defect', '받은 상품이 깨져 있었어요', '상담 2026-11-25 · 회수품 검수로 실제 사유를 고객과 확인함', true, false) = :'full_saved'::jsonb,
 'full_return_replay_same_receipt');
select pg_temp.rf_assert((select r->>'refundAmount' = '40000' and not (r ? 'refundDeduction') from (select pg_temp.rf_bulk(1) r) s), 'full_return_bulk_recomputed');
-- 정정 사유(내부 협의 근거)·처리자·전후 사유는 보호된 이력에, 감사 로그에는 전후 사유·차감·처리자만(근거 원문은 복사하지 않는다).
select pg_temp.rf_assert((select o.actor_id = pg_temp.rf_id('user', 1) and o.claim_type = 'return' and o.agreement like '상담 2026-11-25%'
   and o.from_return_fee_deduction = 3000 and o.to_return_fee_deduction = 0 and o.from_reason = '마음이 바뀌어 반품합니다'
  from private.order_claim_reason_operations o where o.id = pg_temp.rf_id('op', 1))
 and (select a.actor_id = pg_temp.rf_id('user', 1) and a.action = 'admin.order.claim_reason_changed'
   and a.diff @> '{"claimType": "return", "fromReasonType": "change_of_mind", "toReasonType": "defect", "partialReturn": false,
     "fromReturnFeeDeduction": 3000, "toReturnFeeDeduction": 0}' and not (a.diff ? 'agreement') and a.diff::text not like '%상담 2026-11-25%'
  from public.audit_log a where a.id = pg_temp.rf_id('op', 1)), 'full_return_audited');
select pg_temp.rf_assert((select n.title = '반품 요청 사유가 정정됐어요'
   and n.body = '상품 하자·오배송: 받은 상품이 깨져 있었어요 반품배송비 3,000원을 빼지 않고 환불합니다.' and n.type = 'claim_updated'
   and n.link_path = '/orders/'||pg_temp.rf_id('order', 1)
  from public.notifications n where n.user_id = pg_temp.rf_id('user', 2) and n.dedupe_key = 'claim:reason_changed:'||pg_temp.rf_id('op', 1)),
 'full_return_customer_notified');
select pg_temp.rf_auth(2);
select pg_temp.rf_assert((select jsonb_array_length(h) = 1 and h->0->>'toReasonType' = 'defect' and h->0->>'fromReasonType' = 'change_of_mind'
  and not (h->0 ? 'agreement') and not (h->0 ? 'actorId')
 from (select public.get_my_order_claim_reason_changes(pg_temp.rf_id('order', 1)) h) s), 'full_return_customer_history');
select pg_temp.rf_auth(1);
-- 환불 접수: 정정된 사유로 차감 없이 전액. 접수 뒤에는 정정이 막힌다.
select public.admin_record_order_claim_refund((pg_temp.rf_claim(1)).id, 'pg_cancel', 'filed', null);
select pg_temp.rf_assert(not exists(select 1 from private.claim_refund_deductions where claim_id = (pg_temp.rf_claim(1)).id)
 and (select amount = 40000 from public.refunds where payment_id = pg_temp.rf_id('payment', 1))
 and (pg_temp.rf_claim(1)).stage = 'processing', 'full_return_filed_without_deduction');
select pg_temp.rf_assert(private.order_claim_reason_blocker(pg_temp.rf_claim(1)) = 'claim_reason_stage_unavailable'
 and private.order_claim_reason_blocker(jsonb_populate_record(pg_temp.rf_claim(1), '{"stage": "collected"}')) = 'claim_reason_finance_started'
 and (select c->>'allowed' = 'false' and c#>'{returnFee,deductionAmount}' = 'null'::jsonb
  from (select public.admin_order_claim_reason_context((pg_temp.rf_claim(1)).id) c) s), 'full_return_filed_blocks_correction');
select pg_temp.rf_error('select pg_temp.rf_correct(1, 11, ''change_of_mind'', ''다시 단순 변심'')', 'claim_reason_stage_unavailable');

-- 2. 주문 전체 반품: 하자·오배송 → 단순 변심(차감이 생긴다) -------------------------------------------------------------------
select public.request_order_claim(pg_temp.rf_id('order', 2), pg_temp.rf_id('user', 2), 'return', '상품이 고장 났어요', 'defect');
select pg_temp.rf_collect((pg_temp.rf_claim(2)).id);
select pg_temp.rf_assert(private.return_fee_deduction_plan((pg_temp.rf_claim(2)).id) is null
 and (public.admin_order_claim_reason_context((pg_temp.rf_claim(2)).id))#>>'{returnFee,deductionAmount}' = '0', 'defect_return_no_deduction');
select pg_temp.rf_assert(pg_temp.rf_correct(2, 2, 'change_of_mind', '확인해 보니 정상 상품이라 단순 변심으로 정정')
 @> '{"changed": true, "fromReturnFeeDeduction": 0, "toReturnFeeDeduction": 3000}', 'defect_to_change_of_mind_adds_deduction');
select pg_temp.rf_assert((select body = '단순 변심: 확인해 보니 정상 상품이라 단순 변심으로 정정 환불 금액에서 반품배송비 3,000원을 뺍니다.'
 from public.notifications where user_id = pg_temp.rf_id('user', 2) and dedupe_key = 'claim:reason_changed:'||pg_temp.rf_id('op', 2)), 'deduction_added_notice');
select public.admin_record_order_claim_refund((pg_temp.rf_claim(2)).id, 'pg_cancel', 'filed', null);
select pg_temp.rf_assert((select deduction_amount = 3000 and refund_amount = 37000 and basis = 'one_way' and state = 'planned'
  from private.claim_refund_deductions where claim_id = (pg_temp.rf_claim(2)).id)
 and (select amount = 37000 from public.refunds where payment_id = pg_temp.rf_id('payment', 2)), 'corrected_reason_decides_deduction');

-- 3. 최초 무료배송 주문: 왕복 6,000원 → 하자 정정으로 0원 -------------------------------------------------------------------
select public.request_order_claim(pg_temp.rf_id('order', 3), pg_temp.rf_id('user', 2), 'return', '단순 변심', 'change_of_mind');
select pg_temp.rf_collect((pg_temp.rf_claim(3)).id);
select pg_temp.rf_assert((public.admin_order_claim_reason_context((pg_temp.rf_claim(3)).id))#>>'{returnFee,deductionAmount}' = '6000', 'round_trip_planned');
select pg_temp.rf_assert(pg_temp.rf_correct(3, 3, 'defect', '오배송으로 확인') @> '{"fromReturnFeeDeduction": 6000, "toReturnFeeDeduction": 0}', 'round_trip_corrected');
select pg_temp.rf_assert((select body like '%반품배송비 6,000원을 빼지 않고 환불합니다.' from public.notifications
  where user_id = pg_temp.rf_id('user', 2) and dedupe_key = 'claim:reason_changed:'||pg_temp.rf_id('op', 3)), 'round_trip_removed_notice');

-- 4. 부분 반품(A 1개): 일괄 확인창은 고른 몫, 정정은 그 금액을 다시 계산 -------------------------------------------------------
select pg_temp.rf_assert(public.request_order_partial_return(pg_temp.rf_id('order', 4), pg_temp.rf_id('user', 2),
 jsonb_build_array(jsonb_build_object('orderItemId', pg_temp.rf_id('item-claim-reason-return-a', 4), 'qty', 1)),
 '단순 변심 반품', 'change_of_mind', null, null, null) = 'requested', 'partial_requested');
select pg_temp.rf_assert(private.claim_is_partial_return((pg_temp.rf_claim(4)).id), 'partial_claim_items');
select pg_temp.rf_collect((pg_temp.rf_claim(4)).id);
-- 고른 A 1개 = 9,500원(쿠폰 몫 제외), 배송 건 1에 A·B가 남아 배송비 환불 없음, 단순 변심 편도 3,000원 차감 → 6,500원. 남은 결제 금액(40,000원)이 아니다.
select pg_temp.rf_assert((select r->>'refundAmount' = '6500' and r->>'refundBlocker' is null and r->>'partialReturn' = 'true'
  and r#>>'{refundDeduction,deductionAmount}' = '3000' and r#>>'{refundDeduction,source}' = 'partial_return'
  and (r->>'refundAmount')::bigint = (private.order_partial_return_plan((pg_temp.rf_claim(4)).id)->>'refundAmount')::bigint
 from (select pg_temp.rf_bulk(4) r) s), 'bulk_partial_return_shows_selected_share');
select pg_temp.rf_assert((public.admin_order_claim_reason_context((pg_temp.rf_claim(4)).id))->'returnFee'
 @> '{"partialReturn": true, "deductionAmount": 3000}', 'partial_context_shows_deduction');
select pg_temp.rf_assert(pg_temp.rf_correct(4, 4, 'defect', '반품한 상품에 흠집이 있었어요')
 @> '{"changed": true, "claimType": "return", "fromReturnFeeDeduction": 3000, "toReturnFeeDeduction": 0}', 'partial_corrected');
select pg_temp.rf_assert((select a.diff @> '{"partialReturn": true}' from public.audit_log a where a.id = pg_temp.rf_id('op', 4)), 'partial_correction_audited');
select pg_temp.rf_assert((select r->>'refundAmount' = '9500' and r->>'refundBlocker' is null and not (r ? 'refundDeduction')
 from (select pg_temp.rf_bulk(4) r) s), 'bulk_partial_return_recomputed');
select pg_temp.rf_assert(public.admin_record_order_claim_refund((pg_temp.rf_claim(4)).id, 'pg_cancel', 'filed', null) = 'filed', 'partial_filed');
select pg_temp.rf_assert((select refund_amount = 9500 and return_fee_deduction = 0 and state = 'processing'
  from private.order_partial_cancellations where claim_id = (pg_temp.rf_claim(4)).id), 'partial_filed_with_corrected_reason');
-- 접수 뒤: 일괄 확인창은 원장 금액을 보이되 일괄 환불에서 뺀다(상세의 부분 반품 칸에서 처리). 사유 정정은 막힌다.
select pg_temp.rf_assert((select r->>'refundAmount' = '9500' and r->>'refundBlocker' = 'partial_return_in_progress' from (select pg_temp.rf_bulk(4) r) s)
 and private.order_claim_reason_blocker(jsonb_populate_record(pg_temp.rf_claim(4), '{"stage": "collected"}')) = 'claim_reason_finance_started',
 'partial_filed_blocks');
select pg_temp.rf_error('select pg_temp.rf_correct(4, 44, ''change_of_mind'', ''다시 단순 변심'')', 'claim_reason_stage_unavailable');

-- 5. 선물 주문 반품 정정: 보낸 분·받는 분 모두 선물 알림(일반 문구·/gifts/ 링크), 운영자 설명 원문·/orders/ 알림은 없다.
select pg_temp.rf_auth(1);
select pg_temp.rf_assert(pg_temp.rf_correct(5, 5, 'defect', '받는 분 사진으로 박스 파손 확인(수령인 통화)')
 @> '{"changed": true, "claimType": "return", "fromReturnFeeDeduction": 0, "toReturnFeeDeduction": 0}', 'gift_return_corrected');
select pg_temp.rf_assert(not exists(select 1 from public.notifications where dedupe_key = 'claim:reason_changed:'||pg_temp.rf_id('op', 5))
 and (select count(*) = 2 and count(distinct user_id) = 2
   and bool_and(user_id in (pg_temp.rf_id('user', 2), pg_temp.rf_id('user', 3)))
   and bool_and(link_path = '/gifts/'||pg_temp.rf_id('gift', 5) and type = 'claim_updated' and source_id = pg_temp.rf_id('claim', 5)::text)
   and bool_and(body not like '%박스 파손%' and title not like '%박스 파손%')
  from public.notifications where source_id = pg_temp.rf_id('claim', 5)::text and dedupe_key like 'gift-claim:reason_changed:%')
 and not exists(select 1 from public.notifications where body like '%박스 파손%'), 'gift_correction_uses_gift_notice');
-- 보낸 분의 고객 이력도 선물 주문 설명을 일반 분류로 가린다(알림과 같은 규칙).
select pg_temp.rf_auth(2);
select pg_temp.rf_assert((select h->0->>'toReason' = '상품 하자' and h::text not like '%박스 파손%'
 from (select public.get_my_order_claim_reason_changes(pg_temp.rf_id('order', 5)) h) s), 'gift_history_masked');
select pg_temp.rf_auth(1);

-- 6. 합계: 실제 정정 5건, 감사 5건, 선물 아닌 주문의 정정 알림 4건(같은 내용 재요청은 이력을 늘리지 않는다).
select pg_temp.rf_assert((select count(*) = 5 from private.order_claim_reason_operations
  where order_id in (select pg_temp.rf_id('order', n) from generate_series(1, 5) n) and changed)
 and (select count(*) = 5 from public.audit_log where action = 'admin.order.claim_reason_changed'
  and target in (select 'order:'||pg_temp.rf_id('order', n) from generate_series(1, 5) n))
 and (select count(*) = 4 from public.notifications where user_id = pg_temp.rf_id('user', 2) and dedupe_key like 'claim:reason_changed:%'), 'totals');
rollback;
